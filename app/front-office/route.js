import { NextResponse } from 'next/server';
import { createSession, expectedRequestOrigin, getFrontOfficeConfig, PRIVATE_PAGE_HEADERS, SESSION_COOKIE, SESSION_SECONDS, validSession } from '../../lib/front-office-session.mjs';
import { validAdminPassword } from '../../lib/yahoo-oauth.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOGIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Front Office sign in</title></head>
<body><main><h1>Fantasy Football Front Office</h1><p>Sign in to view your private dashboard.</p>
<form method="post" action="/front-office"><label>Owner password <input type="password" name="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form></main></body></html>`;

const PRIVATE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fantasy Football Front Office</title></head>
<body><main><h1>Fantasy Football Front Office</h1><p>Private access is ready. Live Yahoo data will be added in the next milestone.</p>
<form method="post" action="/front-office/logout"><button type="submit">Sign out</button></form></main></body></html>`;

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
    return page(validSession(request.cookies.get(SESSION_COOKIE)?.value, config.sessionSecret) ? PRIVATE_PAGE : LOGIN_PAGE);
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
