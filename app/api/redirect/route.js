import { NextResponse } from 'next/server';
import { tokenHandoffPage, getYahooConfig, PRIVATE_HEADERS } from '../../../lib/yahoo-oauth.mjs';
import {
    expectedRequestOrigin, getFrontOfficeConfig, SESSION_COOKIE, validSession
} from '../../../lib/front-office-session.mjs';
import {
    exchangeHostedCode, HOSTED_STATE_COOKIE,
    hostedCallbackPreflight, verifyHostedRead
} from '../../../lib/yahoo-hosted-access.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clearState(response) {
    response.cookies.set(HOSTED_STATE_COOKIE, '', {
        httpOnly: true, secure: true, sameSite: 'lax', path: '/api/redirect', maxAge: 0
    });
}

function result(text, status) {
    const response = new NextResponse(text, {
        status,
        headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }
    });
    clearState(response);
    return response;
}

export async function GET(request) {
    const origin = expectedRequestOrigin(request);
    const frontOffice = getFrontOfficeConfig();
    const yahoo = getYahooConfig();
    if (!origin || !frontOffice || !yahoo) return result('Yahoo connection is not configured.', 503);
    if (!validSession(request.cookies.get(SESSION_COOKIE)?.value, frontOffice.sessionSecret)) {
        return result('Sign in to Front Office and connect Yahoo again.', 401);
    }

    const params = new URL(request.url).searchParams;
    const stateCookie = request.cookies.get(HOSTED_STATE_COOKIE)?.value;
    const preflight = hostedCallbackPreflight(params, stateCookie, frontOffice.sessionSecret);
    if (preflight) return result(preflight.message, preflight.status);

    let access;
    try {
        access = await exchangeHostedCode(params.get('code'), yahoo);
        await verifyHostedRead(access.accessToken);
    } catch {
        return result('Yahoo authorization could not be verified. Return to Front Office and try again.', 502);
    }

    let body;
    try {
        body = tokenHandoffPage(access.accessToken, access.expiresAt);
    } catch {
        return result('Yahoo authorization returned an unusable token. Reconnect and try again.', 502);
    }
    const response = new NextResponse(body, {
        status: 200,
        headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' }
    });
    clearState(response);
    return response;
}
