import { NextResponse } from 'next/server';
import {
    authorizationUrl,
    createState,
    FORM_HEADERS,
    getYahooConfig,
    PRIVATE_HEADERS,
    STATE_COOKIE,
    STATE_MAX_AGE_SECONDS,
    validAdminPassword
} from '../../../../lib/yahoo-oauth.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOGIN_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Connect Yahoo Fantasy</title></head>
<body>
  <h1>Connect Yahoo Fantasy</h1>
  <p>Owner-only, one-time connection test. The callback will show only the short-lived access token; no Yahoo tokens will be saved.</p>
  <form method="post" action="/api/yahoo/connect">
    <label>Admin password <input type="password" name="password" autocomplete="current-password" required></label>
    <button type="submit">Continue to Yahoo</button>
  </form>
</body>
</html>`;

function message(text, status) {
    return new NextResponse(text, {
        status,
        headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }
    });
}

export async function GET() {
    if (!getYahooConfig()) return message('Yahoo connection is not configured.', 503);

    return new NextResponse(LOGIN_PAGE, {
        headers: { ...FORM_HEADERS, 'Content-Type': 'text/html; charset=utf-8' }
    });
}

export async function POST(request) {
    const config = getYahooConfig();
    if (!config) return message('Yahoo connection is not configured.', 503);

    if (request.headers.get('origin') !== new URL(config.redirectUri).origin ||
        request.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded' ||
        Number(request.headers.get('content-length') || 0) > 1024) {
        return message('Request rejected.', 403);
    }

    let password;
    try {
        password = (await request.formData()).get('password');
    } catch {
        return message('Request rejected.', 403);
    }

    if (!validAdminPassword(password, config.adminPassword)) {
        return message('Invalid admin password.', 401);
    }

    const state = createState();
    const response = NextResponse.redirect(authorizationUrl(config.clientId, state), 303);
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(name, value);
    response.cookies.set(STATE_COOKIE, state, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/api/redirect',
        maxAge: STATE_MAX_AGE_SECONDS
    });
    return response;
}
