import { createHmac, timingSafeEqual } from 'node:crypto';

export const HOSTED_STATE_COOKIE = 'yahoo_hosted_oauth_state';

const TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const FANTASY_URL = 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games?format=json';

export class HostedAccessError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

function stateSignature(state, secret) {
    return createHmac('sha256', secret).update(`hosted-yahoo-state:${state}`).digest('base64url');
}

export function signedHostedState(state, secret) {
    return `${state}.${stateSignature(state, secret)}`;
}

export function hostedCallbackPreflight(params, cookie, secret) {
    const match = typeof cookie === 'string' && /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(cookie);
    if (!match) return { status: 400, message: 'Authorization could not be verified. Start again.' };
    const actual = Buffer.from(match[2], 'base64url');
    const expected = Buffer.from(stateSignature(match[1], secret), 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return { status: 400, message: 'Authorization could not be verified. Start again.' };
    }

    const states = params.getAll('state');
    if (states.length !== 1 || states[0] !== match[1]) {
        return { status: 400, message: 'Authorization could not be verified. Start again.' };
    }
    const codes = params.getAll('code');
    if (params.has('error') || codes.length !== 1 || !codes[0]) {
        return { status: 400, message: 'Yahoo authorization was not completed.' };
    }
    return null;
}

export async function exchangeHostedCode(code, config, fetchImpl = fetch, now = Date.now()) {
    if (typeof code !== 'string' || !code || code.length > 4096) throw new HostedAccessError('token_error');
    let response;
    try {
        response = await fetchImpl(TOKEN_URL, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({ grant_type: 'authorization_code', redirect_uri: config.redirectUri, code }),
            signal: AbortSignal.timeout(10000),
            redirect: 'error',
            cache: 'no-store'
        });
    } catch {
        throw new HostedAccessError('token_error');
    }
    if (!response.ok) throw new HostedAccessError('token_error');
    let data;
    try { data = await response.json(); } catch { throw new HostedAccessError('token_error'); }
    const lifetime = Number(data.expires_in);
    const tokenPattern = /^[A-Za-z0-9._~+/-]{8,8192}={0,}$/;
    if (typeof data.access_token !== 'string' || !tokenPattern.test(data.access_token) ||
        typeof data.refresh_token !== 'string' || !tokenPattern.test(data.refresh_token) ||
        !Number.isSafeInteger(lifetime) || lifetime < 1 || lifetime > 3600) {
        throw new HostedAccessError('token_error');
    }
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: now + lifetime * 1000
    };
}

export async function verifyHostedRead(accessToken, fetchImpl = fetch) {
    let response;
    try {
        response = await fetchImpl(FANTASY_URL, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(10000),
            redirect: 'error',
            cache: 'no-store'
        });
    } catch {
        throw new HostedAccessError('fantasy_error');
    }
    try { await response.body?.cancel(); } catch { /* The response status remains authoritative. */ }
    if (!response.ok) throw new HostedAccessError('fantasy_error');
}
