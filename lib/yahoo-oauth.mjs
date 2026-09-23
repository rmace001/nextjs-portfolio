import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const REDIRECT_URI = 'https://rogeliomc.com/api/redirect';
export const STATE_COOKIE = 'yahoo_oauth_state';
export const STATE_MAX_AGE_SECONDS = 600;

const AUTHORIZATION_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const FANTASY_URL = 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games?format=json';

export const PRIVATE_HEADERS = {
    'Cache-Control': 'private, no-store, max-age=0',
    'CDN-Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'"
};

// A no-referrer policy on an HTML form can make its POST carry Origin: null.
// The form posts only to this origin; callback and redirect responses stay no-referrer.
export const FORM_HEADERS = {
    ...PRIVATE_HEADERS,
    'Referrer-Policy': 'same-origin'
};

export function getYahooConfig(env = process.env) {
    const clientId = env.YAHOO_CLIENT_ID;
    const clientSecret = env.YAHOO_CLIENT_SECRET;
    const adminPassword = env.YAHOO_ADMIN_PASSWORD;

    if (env.YAHOO_REDIRECT_URI !== REDIRECT_URI ||
        !clientId || !clientSecret ||
        !adminPassword || adminPassword.length < 16) {
        return null;
    }

    return { clientId, clientSecret, adminPassword, redirectUri: REDIRECT_URI };
}

function equalSecret(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;

    const leftHash = createHash('sha256').update(left).digest();
    const rightHash = createHash('sha256').update(right).digest();
    return timingSafeEqual(leftHash, rightHash);
}

export function validAdminPassword(submitted, expected) {
    return equalSecret(submitted, expected);
}

export function createState() {
    return randomBytes(32).toString('base64url');
}

export function stateMatches(cookieState, returnedState) {
    const statePattern = /^[A-Za-z0-9_-]{43}$/;
    return typeof cookieState === 'string' && typeof returnedState === 'string' &&
        statePattern.test(cookieState) && statePattern.test(returnedState) &&
        equalSecret(cookieState, returnedState);
}

export function callbackPreflight(params, cookieState) {
    const states = params.getAll('state');
    if (states.length !== 1 || !stateMatches(cookieState, states[0])) {
        return { status: 400, message: 'Authorization could not be verified. Start again.' };
    }

    const codes = params.getAll('code');
    if (params.has('error') || codes.length !== 1 || !codes[0]) {
        return { status: 400, message: 'Yahoo authorization was not completed.' };
    }

    return null;
}

export function authorizationUrl(clientId, state) {
    const url = new URL(AUTHORIZATION_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    return url;
}

function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

export function accessTokenPage(accessToken, readResult) {
    const readMessage = readResult.outcome === 'verified'
        ? 'Yahoo Fantasy read succeeded.'
        : readResult.outcome === 'fantasy_http_error'
            ? `Yahoo Fantasy read returned HTTP ${readResult.httpStatus ?? 'error'}.`
            : 'Yahoo Fantasy read did not complete.';

    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Yahoo access token</title></head>
<body>
  <h1>Yahoo access token</h1>
  <p>${readMessage} Yahoo issued an access token for local testing.</p>
  <label for="access-token">Access token</label><br>
  <textarea id="access-token" readonly rows="6" cols="80" spellcheck="false">${escapeHtml(accessToken)}</textarea>
  <p>Copy this token into your local API client, then close this page. Do not share it. It expires in about one hour.</p>
  <p>The refresh token is discarded. Neither it nor the client secret is shown. This page will not show the token again if reloaded.</p>
</body>
</html>`;
}

export async function verifyYahooFantasyRead(code, config, fetchImpl = fetch) {
    if (typeof code !== 'string' || !code || code.length > 4096) return { outcome: 'token_error' };

    let failureStage = 'token_error';
    let accessToken;
    try {
        const tokenResponse = await fetchImpl(TOKEN_URL, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                redirect_uri: config.redirectUri,
                code
            }),
            signal: AbortSignal.timeout(10000),
            redirect: 'error',
            cache: 'no-store'
        });

        if (!tokenResponse.ok) return { outcome: 'token_error' };

        const tokenData = await tokenResponse.json();
        if (typeof tokenData.access_token !== 'string' || !tokenData.access_token) {
            return { outcome: 'token_error' };
        }
        accessToken = tokenData.access_token;

        failureStage = 'fantasy_request_error';
        const fantasyResponse = await fetchImpl(FANTASY_URL, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(10000),
            redirect: 'error',
            cache: 'no-store'
        });

        // The status is enough for this POC. Never return or save Yahoo Fantasy data.
        // Discarding the unread body must not turn a valid response into a false failure.
        try {
            await fantasyResponse.body?.cancel();
        } catch {
            // The response status remains authoritative even if stream cleanup fails.
        }

        if (fantasyResponse.ok) return { outcome: 'verified', accessToken };
        const httpStatus = fantasyResponse.status;
        return Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599
            ? { outcome: 'fantasy_http_error', httpStatus, accessToken }
            : { outcome: 'fantasy_http_error', accessToken };
    } catch {
        return accessToken ? { outcome: failureStage, accessToken } : { outcome: failureStage };
    }
}
