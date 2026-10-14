import { NextResponse } from 'next/server';
import { expectedRequestOrigin, getFrontOfficeConfig, SESSION_COOKIE, validSession } from '../../../../lib/front-office-session.mjs';
import { authorizationUrl, createState, getYahooConfig, PRIVATE_HEADERS, STATE_MAX_AGE_SECONDS } from '../../../../lib/yahoo-oauth.mjs';
import { HOSTED_STATE_COOKIE, signedHostedState } from '../../../../lib/yahoo-hosted-access.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
    const origin = expectedRequestOrigin(request);
    const frontOffice = getFrontOfficeConfig();
    const yahoo = getYahooConfig();
    if (!origin || !frontOffice || !yahoo) return new NextResponse('Yahoo connection is not configured.', { status: 503, headers: PRIVATE_HEADERS });
    if (request.headers.get('origin') !== origin ||
        !validSession(request.cookies.get(SESSION_COOKIE)?.value, frontOffice.sessionSecret)) {
        return new NextResponse('Sign in to Front Office first.', { status: 401, headers: PRIVATE_HEADERS });
    }
    const state = createState();
    const response = NextResponse.redirect(authorizationUrl(yahoo.clientId, state), 303);
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(name, value);
    response.cookies.set(HOSTED_STATE_COOKIE, signedHostedState(state, frontOffice.sessionSecret), {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/api/redirect',
        maxAge: STATE_MAX_AGE_SECONDS
    });
    return response;
}
