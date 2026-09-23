import { NextResponse } from 'next/server';
import {
    callbackPreflight,
    getYahooConfig,
    isProductionOrigin,
    PRIVATE_HEADERS,
    STATE_COOKIE,
    verifyYahooFantasyRead
} from '../../../lib/yahoo-oauth.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function result(text, status) {
    const response = new NextResponse(text, {
        status,
        headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }
    });
    response.cookies.set(STATE_COOKIE, '', {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/api/redirect',
        maxAge: 0
    });
    return response;
}

export async function GET(request) {
    if (!isProductionOrigin(request.url)) return result('Not found.', 404);

    const config = getYahooConfig();
    if (!config) return result('Yahoo connection is not configured.', 503);

    const params = new URL(request.url).searchParams;
    const preflight = callbackPreflight(params, request.cookies.get(STATE_COOKIE)?.value);
    if (preflight) return result(preflight.message, preflight.status);

    const outcome = await verifyYahooFantasyRead(params.get('code'), config);
    if (outcome === 'verified') {
        return result('Yahoo Fantasy access verified. No tokens or data were saved.', 200);
    }
    return outcome === 'token_error'
        ? result('Yahoo token exchange failed. Check the redirect URI and app credentials.', 502)
        : result('Yahoo issued a token, but the Fantasy API read failed. Check Fantasy Sports read permission.', 502);
}
