import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    authorizationUrl, getYahooConfig, PRIVATE_HEADERS, REDIRECT_URI, tokenHandoffPage,
    validAdminPassword
} from '../lib/yahoo-oauth.mjs';

const config = {
    clientId: 'fake-client-id',
    clientSecret: 'fake-client-secret',
    adminPassword: 'fake-long-admin-password',
    redirectUri: REDIRECT_URI
};

test('requires complete production Yahoo configuration and the exact callback', () => {
    const env = {
        YAHOO_CLIENT_ID: config.clientId,
        YAHOO_CLIENT_SECRET: config.clientSecret,
        YAHOO_ADMIN_PASSWORD: config.adminPassword,
        YAHOO_REDIRECT_URI: REDIRECT_URI
    };
    assert.deepEqual(getYahooConfig(env), config);
    assert.equal(getYahooConfig({ ...env, YAHOO_REDIRECT_URI: 'https://other.example/api/redirect' }), null);
    assert.equal(getYahooConfig({ ...env, YAHOO_ADMIN_PASSWORD: 'short' }), null);
    assert.equal(getYahooConfig({ YAHOO_REDIRECT_URI: REDIRECT_URI }), null);
    assert.equal(validAdminPassword(config.adminPassword, config.adminPassword), true);
    assert.equal(validAdminPassword('wrong', config.adminPassword), false);
});

test('authorization URL carries only public OAuth parameters', () => {
    const url = authorizationUrl(config.clientId, 'signed-state-value');
    assert.equal(url.origin, 'https://api.login.yahoo.com');
    assert.equal(url.searchParams.get('redirect_uri'), REDIRECT_URI);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('state'), 'signed-state-value');
    assert.equal(url.toString().includes(config.clientSecret), false);
    assert.equal(url.toString().includes(config.adminPassword), false);
});

test('handoff page never displays the token or loads third-party resources', () => {
    const token = 'fake+access/token==';
    const expiresAt = Date.now() + 3600_000;
    const page = tokenHandoffPage(token, expiresAt);
    assert.match(page, /<button id="save-token" type="button">Save token locally<\/button>/);
    assert.match(page, /name="yahoo-access-token" content="fake\+access\/token=="/);
    assert.doesNotMatch(page, /fake\+access\/token==<|<textarea|<input[^>]+access-token/);
    assert.match(page, /front-office-bridge\.js/);
    assert.doesNotMatch(page, /<script[^>]*>[^<]/);
    assert.match(page, new RegExp(new Date(expiresAt).toISOString()));
    assert.match(PRIVATE_HEADERS['Cache-Control'], /no-store/);
    assert.equal(PRIVATE_HEADERS['Referrer-Policy'], 'no-referrer');
    assert.match(PRIVATE_HEADERS['Content-Security-Policy'], /script-src 'self'/);
    assert.match(PRIVATE_HEADERS['Content-Security-Policy'], /connect-src http:\/\/127\.0\.0\.1:8765/);
    assert.doesNotMatch(PRIVATE_HEADERS['Content-Security-Policy'], /https?:\/\/(?!127\.0\.0\.1)/);
    assert.throws(() => tokenHandoffPage('<script>alert(1)</script>', expiresAt), /Invalid Yahoo handoff/);
});

test('handoff script uses the one-time local receiver without clipboard or token logging', () => {
    const script = readFileSync(new URL('../public/front-office-bridge.js', import.meta.url), 'utf8');
    assert.match(script, /const receiver = 'http:\/\/127\.0\.0\.1:8765'/);
    assert.match(script, /\$\{receiver\}\/challenge/);
    assert.match(script, /\$\{receiver\}\/token/);
    assert.match(script, /X-Front-Office-Challenge/);
    assert.match(script, /history\.replaceState/);
    assert.match(script, /tokenElement\.content = ''/);
    assert.doesNotMatch(script, /clipboard|console\.(?:log|debug|info)/i);
    assert.doesNotMatch(script, /https?:\/\/(?!127\.0\.0\.1)/);
});
