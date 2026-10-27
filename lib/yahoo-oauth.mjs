import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const REDIRECT_URI = 'https://rogeliomc.com/api/redirect';
export const STATE_MAX_AGE_SECONDS = 600;

const AUTHORIZATION_URL = 'https://api.login.yahoo.com/oauth2/request_auth';

export const PRIVATE_HEADERS = {
    'Cache-Control': 'private, no-store, max-age=0',
    'CDN-Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src http://127.0.0.1:8765; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'none'"
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

export function tokenHandoffPage(accessToken, refreshToken, expiresAt) {
    const tokenPattern = /^[A-Za-z0-9._~+/-]{8,8192}={0,}$/;
    if (typeof accessToken !== 'string' || !tokenPattern.test(accessToken) ||
        typeof refreshToken !== 'string' || !tokenPattern.test(refreshToken) ||
        !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
        throw new TypeError('Invalid Yahoo handoff data.');
    }
    const expiry = new Date(expiresAt).toISOString();
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="yahoo-access-token" content="${escapeHtml(accessToken)}">
  <meta name="yahoo-refresh-token" content="${escapeHtml(refreshToken)}">
  <meta name="yahoo-token-expires-at" content="${expiry}">
  <title>Save Yahoo credentials locally</title>
  <script src="/front-office-bridge.js" defer></script>
</head>
<body>
  <main>
    <h1>Save Yahoo credentials locally</h1>
    <p>Yahoo Fantasy access was verified. The current access token expires at <time datetime="${expiry}">${expiry}</time>.</p>
    <p>Start the local receiver in the project folder, then save the access and refresh tokens directly to its ignored <code>.env</code> file. The credentials will not be displayed or copied to your clipboard.</p>
    <button id="save-token" type="button">Save Yahoo credentials locally</button>
    <p id="save-status" role="status" aria-live="polite">Waiting for the local receiver.</p>
    <p>If your browser asks whether this site may connect to your local network, allow it for this save.</p>
  </main>
</body>
</html>`;
}
