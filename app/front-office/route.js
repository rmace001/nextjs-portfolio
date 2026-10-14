import { NextResponse } from 'next/server';
import { createSession, expectedRequestOrigin, getFrontOfficeConfig, PRIVATE_PAGE_HEADERS, SESSION_COOKIE, SESSION_SECONDS, validSession } from '../../lib/front-office-session.mjs';
import { getYahooConfig, validAdminPassword } from '../../lib/yahoo-oauth.mjs';
import { currentAccess, HostedAccessError } from '../../lib/yahoo-hosted-access.mjs';
import { fetchYahooLeague, YahooDataError } from '../../lib/yahoo-league.mjs';
import { dashboardPage, errorPage, loginPage, reconnectPage } from '../../lib/front-office-view.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function page(body, status = 200) {
    return new NextResponse(body, { status, headers: { ...PRIVATE_PAGE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' } });
}

async function readPassword(request) {
    if (!request.body) return null;
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 1024) {
                await reader.cancel();
                return null;
            }
            chunks.push(value);
        }
        return new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('password');
    } catch {
        return null;
    }
}

export async function GET(request) {
    const config = getFrontOfficeConfig();
    if (!config || !expectedRequestOrigin(request)) return page('Front Office is not configured.', 503);
    if (!validSession(request.cookies.get(SESSION_COOKIE)?.value, config.sessionSecret)) return page(loginPage, 401);
    const yahoo = getYahooConfig();
    if (!yahoo) return page(errorPage('Yahoo connection is not configured.'), 503);
    let access;
    try {
        access = await currentAccess(config.sessionSecret);
    } catch (error) {
        if (error instanceof HostedAccessError && error.code === 'storage_error') {
            return page(reconnectPage('The saved Yahoo connection cannot be opened. Reconnect to continue.'), 401);
        }
        return page(errorPage('Could not read the private Yahoo connection. Try again later.'), 503);
    }
    if (!access) return page(reconnectPage('Yahoo access has expired or is not connected. Reconnect to load current data.'), 401);
    try {
        const data = await fetchYahooLeague(access.accessToken);
        return page(dashboardPage(data));
    } catch (error) {
        if (error instanceof YahooDataError && error.code === 'unauthorized') {
            return page(reconnectPage('Yahoo rejected the current access. Reconnect to continue.'), 401);
        }
        return page(errorPage('Yahoo data could not be refreshed. Check again shortly.'), 502);
    }
}

export async function POST(request) {
    const config = getFrontOfficeConfig();
    const origin = expectedRequestOrigin(request);
    if (!config || !origin) return page('Front Office is not configured.', 503);
    if (request.headers.get('origin') !== origin ||
        request.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded' ||
        Number(request.headers.get('content-length') || 0) > 1024) return page('Request rejected.', 403);

    const password = await readPassword(request);
    if (password === null) return page('Request rejected.', 403);
    if (!validAdminPassword(password, config.password)) return page('Invalid password.', 401);

    const response = NextResponse.redirect(new URL('/front-office', origin), 303);
    for (const [name, value] of Object.entries(PRIVATE_PAGE_HEADERS)) response.headers.set(name, value);
    response.cookies.set(SESSION_COOKIE, createSession(config.sessionSecret), {
        httpOnly: true,
        secure: origin.startsWith('https:'),
        sameSite: 'strict',
        path: '/',
        maxAge: SESSION_SECONDS
    });
    return response;
}
