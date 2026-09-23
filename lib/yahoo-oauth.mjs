import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const REDIRECT_URI = 'https://rogeliomc.com/api/redirect';
export const STATE_COOKIE = 'yahoo_oauth_state';
export const STATE_MAX_AGE_SECONDS = 600;

const AUTHORIZATION_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const FANTASY_URL = 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games?format=json';

export const PRIVATE_HEADERS = {
    'Cache-Control': 'no-store, max-age=0',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
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

export function isProductionOrigin(requestUrl) {
    try {
        return new URL(requestUrl).origin === new URL(REDIRECT_URI).origin;
    } catch {
        return false;
    }
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

export async function verifyYahooFantasyRead(code, config, fetchImpl = fetch) {
    if (typeof code !== 'string' || !code || code.length > 4096) return 'token_error';

    let failureStage = 'token_error';
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

        if (!tokenResponse.ok) return 'token_error';

        const tokenData = await tokenResponse.json();
        if (typeof tokenData.access_token !== 'string' || !tokenData.access_token) return 'token_error';

        failureStage = 'fantasy_error';
        const fantasyResponse = await fetchImpl(FANTASY_URL, {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
            signal: AbortSignal.timeout(10000),
            redirect: 'error',
            cache: 'no-store'
        });

        // A successful authenticated read is enough for this POC. Do not return or save the data or tokens.
        await fantasyResponse.body?.cancel();
        return fantasyResponse.ok ? 'verified' : 'fantasy_error';
    } catch {
        return failureStage;
    }
}
