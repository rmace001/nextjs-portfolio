import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'front_office_session';
export const SESSION_SECONDS = 12 * 60 * 60;
const PRODUCTION_ORIGIN = 'https://rogeliomc.com';

export const PRIVATE_PAGE_HEADERS = {
    'Cache-Control': 'private, no-store, max-age=0',
    'CDN-Cache-Control': 'no-store',
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Content-Security-Policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};

export function getFrontOfficeConfig(env = process.env) {
    if (env.CONTEXT && env.CONTEXT !== 'production') return null;
    const password = env.YAHOO_ADMIN_PASSWORD;
    const sessionSecret = env.FRONT_OFFICE_SESSION_SECRET;
    if (typeof password !== 'string' || password.length < 16 ||
        typeof sessionSecret !== 'string' || sessionSecret.length < 32) return null;
    return { password, sessionSecret };
}

export function expectedRequestOrigin(request, env = process.env) {
    if (env.CONTEXT && env.CONTEXT !== 'production') return null;
    const url = new URL(request.url);
    if (!env.URL && ['localhost', '127.0.0.1'].includes(url.hostname)) return url.origin;

    // Netlify Functions provide URL, but not CONTEXT, at runtime. URL alone is
    // shared across deploy contexts, so also require the production request host.
    let siteOrigin;
    try {
        siteOrigin = new URL(env.URL).origin;
    } catch {
        return null;
    }
    return siteOrigin === PRODUCTION_ORIGIN && request.headers.get('host') === new URL(PRODUCTION_ORIGIN).host
        ? PRODUCTION_ORIGIN : null;
}

function signature(payload, secret) {
    return createHmac('sha256', secret).update(`front-office-v1:${payload}`).digest('base64url');
}

export function createSession(secret, now = Date.now()) {
    const payload = `${Math.floor(now / 1000) + SESSION_SECONDS}.${randomBytes(24).toString('base64url')}`;
    return `${payload}.${signature(payload, secret)}`;
}

export function validSession(cookie, secret, now = Date.now()) {
    if (typeof cookie !== 'string' || typeof secret !== 'string') return false;
    const match = /^(\d{10})\.([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/.exec(cookie);
    if (!match) return false;
    const expires = Number(match[1]);
    const current = Math.floor(now / 1000);
    if (expires <= current || expires > current + SESSION_SECONDS) return false;
    const payload = `${match[1]}.${match[2]}`;
    const actual = Buffer.from(match[3], 'base64url');
    const expected = Buffer.from(signature(payload, secret), 'base64url');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}
