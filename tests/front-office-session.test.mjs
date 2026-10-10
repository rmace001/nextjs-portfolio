import assert from 'node:assert/strict';
import test from 'node:test';
import { createSession, expectedRequestOrigin, getFrontOfficeConfig, PRIVATE_PAGE_HEADERS, SESSION_SECONDS, validSession } from '../lib/front-office-session.mjs';

const password = 'owner-password-long-enough';
const sessionSecret = 'a-random-session-key-longer-than-32-characters';
const now = 1_790_000_000_000;

test('configuration is production-only on Netlify and requires separate strong secrets', () => {
    const config = { YAHOO_ADMIN_PASSWORD: password, FRONT_OFFICE_SESSION_SECRET: sessionSecret, CONTEXT: 'production' };
    assert.deepEqual(getFrontOfficeConfig(config), { password, sessionSecret });
    assert.equal(getFrontOfficeConfig({ ...config, CONTEXT: 'deploy-preview' }), null);
    assert.equal(getFrontOfficeConfig({ ...config, FRONT_OFFICE_SESSION_SECRET: 'too-short' }), null);
    assert.equal(getFrontOfficeConfig({ ...config, YAHOO_ADMIN_PASSWORD: 'short' }), null);
});

test('sessions survive requests but reject tampering, expiry, and far-future timestamps', () => {
    const cookie = createSession(sessionSecret, now);
    assert.equal(validSession(cookie, sessionSecret, now), true);
    assert.equal(validSession(cookie, sessionSecret, now + (SESSION_SECONDS - 1) * 1000), true);
    assert.equal(validSession(cookie, sessionSecret, now + SESSION_SECONDS * 1000), false);
    assert.equal(validSession(cookie, 'another-session-key-longer-than-32-characters', now), false);
    const tampered = `${cookie.slice(0, -1)}${cookie.endsWith('x') ? 'y' : 'x'}`;
    assert.equal(validSession(tampered, sessionSecret, now), false);
    assert.equal(validSession(undefined, sessionSecret, now), false);
    assert.equal(validSession(createSession(sessionSecret, now + 60_000), sessionSecret, now), false);
});

test('production requests use the registered domain and private responses do not cache', () => {
    const request = { url: 'https://internal.netlify.app/front-office' };
    assert.equal(expectedRequestOrigin(request, { CONTEXT: 'production' }), 'https://rogeliomc.com');
    assert.equal(expectedRequestOrigin(request, { CONTEXT: 'deploy-preview' }), null);
    assert.equal(expectedRequestOrigin({ url: 'http://localhost:3000/front-office' }, {}), 'http://localhost:3000');
    assert.equal(expectedRequestOrigin(request, {}), null);
    assert.match(PRIVATE_PAGE_HEADERS['Cache-Control'], /no-store/);
    assert.equal(PRIVATE_PAGE_HEADERS['CDN-Cache-Control'], 'no-store');
    assert.match(PRIVATE_PAGE_HEADERS['X-Robots-Tag'], /noindex/);
});
