import { NextResponse } from 'next/server';
import {
    accessTokenPage,
    callbackPreflight,
    getYahooConfig,
    PRIVATE_HEADERS,
    STATE_COOKIE,
    verifyYahooFantasyRead
} from '../../../lib/yahoo-oauth.mjs';
import { expectedRequestOrigin, getFrontOfficeConfig } from '../../../lib/front-office-session.mjs';
import { exchangeHostedCode, HOSTED_STATE_COOKIE, hostedCallbackPreflight, saveAccess, verifyHostedRead } from '../../../lib/yahoo-hosted-access.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function result(text, status) {
    const response = new NextResponse(text, {
        status,
        headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }
    });
    clearState(response);
    return response;
}

function clearState(response) {
    for (const name of [STATE_COOKIE, HOSTED_STATE_COOKIE]) {
        response.cookies.set(name, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/redirect', maxAge: 0 });
    }
}

export async function GET(request) {
    const config = getYahooConfig();
    if (!config) return result('Yahoo connection is not configured.', 503);

    const params = new URL(request.url).searchParams;
    const hostedCookie = request.cookies.get(HOSTED_STATE_COOKIE)?.value;
    if (hostedCookie) {
        const frontOffice = getFrontOfficeConfig();
        const origin = expectedRequestOrigin(request);
        if (!frontOffice || !origin) return result('Front Office is not configured.', 503);
        const hostedPreflight = hostedCallbackPreflight(params, hostedCookie, frontOffice.sessionSecret);
        if (hostedPreflight) return result(hostedPreflight.message, hostedPreflight.status);
        try {
            const access = await exchangeHostedCode(params.get('code'), config);
            await verifyHostedRead(access.accessToken);
            await saveAccess(access, frontOffice.sessionSecret);
        } catch {
            return result('Yahoo connection could not be saved. Return to Front Office and try again.', 502);
        }
        const response = NextResponse.redirect(new URL('/front-office', origin), 303);
        for (const [name, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(name, value);
        clearState(response);
        return response;
    }
    const preflight = callbackPreflight(params, request.cookies.get(STATE_COOKIE)?.value);
    if (preflight) return result(preflight.message, preflight.status);

    const outcome = await verifyYahooFantasyRead(params.get('code'), config);
    if (outcome.accessToken) {
        const response = result(accessTokenPage(outcome.accessToken, outcome), 200);
        response.headers.set('Content-Type', 'text/html; charset=utf-8');
        return response;
    }
    if (outcome.outcome === 'token_error') {
        return result('Yahoo token exchange failed. Check the redirect URI and app credentials.', 502);
    }
    return result('Yahoo authorization did not complete.', 502);
}
