import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
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
    const refreshToken = 'fake-refresh-token';
    const expiresAt = Date.now() + 3600_000;
    const page = tokenHandoffPage(token, refreshToken, expiresAt);
    assert.match(page, /<button id="save-token" type="button">Save Yahoo credentials locally<\/button>/);
    assert.match(page, /name="yahoo-access-token" content="fake\+access\/token=="/);
    assert.match(page, /name="yahoo-refresh-token" content="fake-refresh-token"/);
    assert.doesNotMatch(page, /fake\+access\/token==<|<textarea|<input[^>]+access-token/);
    assert.doesNotMatch(page, /fake-refresh-token<|<textarea|<input[^>]+refresh-token/);
    assert.match(page, /front-office-bridge\.js/);
    assert.doesNotMatch(page, /<script[^>]*>[^<]/);
    assert.match(page, new RegExp(new Date(expiresAt).toISOString()));
    assert.match(PRIVATE_HEADERS['Cache-Control'], /no-store/);
    assert.equal(PRIVATE_HEADERS['Referrer-Policy'], 'no-referrer');
    assert.match(PRIVATE_HEADERS['Content-Security-Policy'], /script-src 'self'/);
    assert.match(PRIVATE_HEADERS['Content-Security-Policy'], /connect-src http:\/\/127\.0\.0\.1:8765/);
    assert.doesNotMatch(PRIVATE_HEADERS['Content-Security-Policy'], /https?:\/\/(?!127\.0\.0\.1)/);
    assert.throws(() => tokenHandoffPage('<script>alert(1)</script>', refreshToken, expiresAt), /Invalid Yahoo handoff/);
    assert.throws(() => tokenHandoffPage(token, '<script>alert(1)</script>', expiresAt), /Invalid Yahoo handoff/);
});

test('handoff script uses the one-time local receiver without clipboard or token logging', () => {
    const script = readFileSync(new URL('../public/front-office-bridge.js', import.meta.url), 'utf8');
    assert.match(script, /const receiver = 'http:\/\/127\.0\.0\.1:8765'/);
    assert.match(script, /\$\{receiver\}\/challenge/);
    assert.match(script, /\$\{receiver\}\/token/);
    assert.match(script, /X-Front-Office-Challenge/);
    assert.match(script, /refresh_token: refreshToken/);
    assert.match(script, /history\.replaceState/);
    assert.match(script, /tokenElement\.content = ''/);
    assert.match(script, /refreshTokenElement\.content = ''/);
    assert.doesNotMatch(script, /clipboard|console\.(?:log|debug|info)/i);
    assert.doesNotMatch(script, /https?:\/\/(?!127\.0\.0\.1)/);
});

test('handoff script posts the exact token pair and clears it only after receiver confirmation', async () => {
    const script = readFileSync(new URL('../public/front-office-bridge.js', import.meta.url), 'utf8');
    const tokenElement = { content: 'fake-access-token' };
    const refreshTokenElement = { content: 'fake-refresh-token' };
    const status = { textContent: '' };
    let clickHandler;
    const button = {
        disabled: false,
        addEventListener(type, handler) {
            assert.equal(type, 'click');
            clickHandler = handler;
        }
    };
    const elements = new Map([
        ['meta[name="yahoo-access-token"]', tokenElement],
        ['meta[name="yahoo-refresh-token"]', refreshTokenElement],
        ['#save-token', button],
        ['#save-status', status]
    ]);
    const requests = [];
    let confirmSave;
    const fetch = async (url, options) => {
        requests.push({ url, options });
        if (url.endsWith('/challenge')) {
            return { ok: true, json: async () => ({ challenge: 'x'.repeat(43) }) };
        }
        return { ok: true, json: () => new Promise(resolve => { confirmSave = resolve; }) };
    };

    vm.runInNewContext(script, {
        AbortSignal: { timeout: () => ({}) },
        Error,
        JSON,
        document: { querySelector: selector => elements.get(selector) },
        fetch,
        history: { replaceState() {} }
    });
    assert.equal(typeof clickHandler, 'function');

    const completion = clickHandler();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 2);
    assert.deepEqual(JSON.parse(requests[1].options.body), {
        access_token: 'fake-access-token',
        refresh_token: 'fake-refresh-token'
    });
    assert.equal(tokenElement.content, 'fake-access-token');
    assert.equal(refreshTokenElement.content, 'fake-refresh-token');

    confirmSave({ saved: true });
    await completion;
    assert.equal(tokenElement.content, '');
    assert.equal(refreshTokenElement.content, '');
    assert.match(status.textContent, /credentials saved/i);
});
