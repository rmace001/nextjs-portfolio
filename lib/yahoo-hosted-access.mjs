import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { callbackPreflight } from './yahoo-oauth.mjs';

export const HOSTED_STATE_COOKIE = 'yahoo_hosted_oauth_state';

const STORE_KEY = 'owner-access-v1';
const PURPOSE = 'front-office-yahoo-access-v1';
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
    return callbackPreflight(params, match[1]);
}

function key(secret) {
    return Buffer.from(hkdfSync('sha256', Buffer.from(secret), Buffer.alloc(0), Buffer.from(PURPOSE), 32));
}

function validRecord(record) {
    return record && typeof record.accessToken === 'string' && record.accessToken.length > 0 &&
        Number.isSafeInteger(record.expiresAt) && record.expiresAt > 0;
}

export function sealAccess(record, secret) {
    if (!validRecord(record)) throw new HostedAccessError('invalid_token');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
    cipher.setAAD(Buffer.from(PURPOSE));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()]);
    return { version: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') };
}

export function openAccess(sealed, secret) {
    try {
        if (sealed?.version !== 1 || typeof sealed.iv !== 'string' || typeof sealed.tag !== 'string' || typeof sealed.ciphertext !== 'string') {
            throw new Error('Invalid envelope');
        }
        const iv = Buffer.from(sealed.iv, 'base64url');
        const tag = Buffer.from(sealed.tag, 'base64url');
        if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid envelope');
        const decipher = createDecipheriv('aes-256-gcm', key(secret), iv);
        decipher.setAAD(Buffer.from(PURPOSE));
        decipher.setAuthTag(tag);
        const record = JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64url')), decipher.final()]).toString('utf8'));
        if (!validRecord(record)) throw new Error('Invalid record');
        return record;
    } catch {
        throw new HostedAccessError('storage_error');
    }
}

export function accessStore() {
    return getStore({ name: 'front-office-yahoo', consistency: 'strong' });
}

export async function saveAccess(record, secret, store = accessStore()) {
    await store.setJSON(STORE_KEY, sealAccess(record, secret));
}

export async function currentAccess(secret, store = accessStore(), now = Date.now()) {
    const sealed = await store.get(STORE_KEY, { type: 'json' });
    if (!sealed) return null;
    const record = openAccess(sealed, secret);
    return record.expiresAt > now + 30000 ? record : null;
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
    if (typeof data.access_token !== 'string' || !data.access_token ||
        !Number.isSafeInteger(lifetime) || lifetime < 1 || lifetime > 86400) {
        throw new HostedAccessError('token_error');
    }
    return { accessToken: data.access_token, expiresAt: now + lifetime * 1000 };
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
