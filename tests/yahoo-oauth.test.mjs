import assert from 'node:assert/strict';
import test from 'node:test';
import {
    accessTokenPage,
    authorizationUrl,
    callbackPreflight,
    createState,
    FORM_HEADERS,
    getYahooConfig,
    PRIVATE_HEADERS,
    REDIRECT_URI,
    stateMatches,
    validAdminPassword,
    verifyYahooFantasyRead
} from '../lib/yahoo-oauth.mjs';

const config = {
    clientId: 'fake-client-id',
    clientSecret: 'fake-client-secret',
    adminPassword: 'fake-long-admin-password',
    redirectUri: REDIRECT_URI
};

test('requires complete server-side configuration and the exact callback', () => {
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
});

test('checks admin password and OAuth state without accepting missing or malformed values', () => {
    const state = createState();
    assert.match(state, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(validAdminPassword(config.adminPassword, config.adminPassword), true);
    assert.equal(validAdminPassword('wrong', config.adminPassword), false);
    assert.equal(stateMatches(state, state), true);
    assert.equal(stateMatches(state, createState()), false);
    assert.equal(stateMatches(undefined, state), false);
    assert.equal(stateMatches(state, 'bad'), false);
});

test('callback rejects missing, mismatched, duplicate, and denied requests with safe messages', () => {
    const state = createState();
    const cookieState = state;
    const code = 'fake-private-authorization-code';
    const bad = [
        new URLSearchParams({ code }),
        new URLSearchParams({ state: createState(), code }),
        new URLSearchParams({ state, error: 'fake-private-upstream-detail' })
    ];
    for (const params of bad) {
        const result = callbackPreflight(params, cookieState);
        assert.equal(result.status, 400);
        assert.equal(result.message.includes(code), false);
        assert.equal(result.message.includes('fake-private-upstream-detail'), false);
    }

    const duplicate = new URLSearchParams({ state, code });
    duplicate.append('state', state);
    assert.equal(callbackPreflight(duplicate, cookieState).status, 400);
    assert.equal(callbackPreflight(new URLSearchParams({ state, code }), cookieState), null);
});

test('authorization URL carries only public OAuth parameters', () => {
    const state = createState();
    const url = authorizationUrl(config.clientId, state);
    assert.equal(url.origin, 'https://api.login.yahoo.com');
    assert.equal(url.searchParams.get('redirect_uri'), REDIRECT_URI);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('state'), state);
    assert.equal(url.toString().includes(config.clientSecret), false);
    assert.equal(url.toString().includes(config.adminPassword), false);
});

test('exchanges the code server-side and makes one authenticated Fantasy read', async () => {
    const calls = [];
    const fakeFetch = async (url, options) => {
        calls.push({ url, options });
        if (calls.length === 1) {
            return { ok: true, json: async () => ({ access_token: 'fake-access-token', refresh_token: 'fake-refresh-token' }) };
        }
        return { ok: true, body: { cancel: async () => {} } };
    };

    assert.deepEqual(await verifyYahooFantasyRead('fake-code', config, fakeFetch), {
        outcome: 'verified', accessToken: 'fake-access-token'
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://api.login.yahoo.com/oauth2/get_token');
    assert.equal(calls[0].options.body.get('code'), 'fake-code');
    assert.equal(calls[0].options.body.get('redirect_uri'), REDIRECT_URI);
    assert.equal(calls[1].url, 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games?format=json');
    assert.equal(calls[1].options.headers.Authorization, 'Bearer fake-access-token');
});

test('callback page displays only an HTML-escaped access token and a safe read result', () => {
    const token = 'fake<&>"\'-access-token';
    const page = accessTokenPage(token, { outcome: 'fantasy_http_error', httpStatus: 403 });
    assert.match(page, /Yahoo Fantasy read returned HTTP 403/);
    assert.match(page, /fake&lt;&amp;&gt;&quot;&#39;-access-token/);
    assert.equal(page.includes(token), false);
    assert.equal(page.includes('fake-refresh-token'), false);
    assert.equal(page.includes('<script'), false);
    assert.match(page, /will not show the token again if reloaded/);
});

test('fails closed on token and Fantasy errors without returning upstream data', async () => {
    let calls = 0;
    const tokenFailure = async () => { calls++; return { ok: false, status: 401 }; };
    assert.deepEqual(await verifyYahooFantasyRead('fake-code', config, tokenFailure), { outcome: 'token_error' });
    assert.equal(calls, 1);

    const malformedToken = async () => ({ ok: true, json: async () => ({ error: 'fake-upstream-error' }) });
    assert.deepEqual(await verifyYahooFantasyRead('fake-code', config, malformedToken), { outcome: 'token_error' });

    let fantasyCalls = 0;
    const fantasyFailure = async () => {
        fantasyCalls++;
        return fantasyCalls === 1
            ? { ok: true, json: async () => ({ access_token: 'fake-access-token' }) }
            : { ok: false, status: 403, body: { cancel: async () => {} } };
    };
    assert.deepEqual(await verifyYahooFantasyRead('fake-code', config, fantasyFailure), {
        outcome: 'fantasy_http_error', httpStatus: 403, accessToken: 'fake-access-token'
    });
    assert.equal(fantasyCalls, 2);
    assert.deepEqual(await verifyYahooFantasyRead('fake-code', config, async () => {
        throw new Error('fake sensitive error');
    }), { outcome: 'token_error' });
    let networkCalls = 0;
    const fantasyNetworkFailure = async () => {
        networkCalls++;
        if (networkCalls === 1) return { ok: true, json: async () => ({ access_token: 'fake-access-token' }) };
        throw new Error('fake private Fantasy response');
    };
    assert.deepEqual(await verifyYahooFantasyRead('fake-code', config, fantasyNetworkFailure), {
        outcome: 'fantasy_request_error', accessToken: 'fake-access-token'
    });
    assert.deepEqual(await verifyYahooFantasyRead('', config, tokenFailure), { outcome: 'token_error' });
});

test('body cleanup failures do not hide the Fantasy HTTP status or expose response data', async () => {
    const fakeFetch = async (url) => url.includes('/get_token')
        ? { ok: true, json: async () => ({ access_token: 'fake-access-token' }) }
        : {
            ok: true,
            status: 200,
            body: { cancel: async () => { throw new Error('fake private response body'); } }
        };
    assert.deepEqual(await verifyYahooFantasyRead('fake-code', config, fakeFetch), {
        outcome: 'verified', accessToken: 'fake-access-token'
    });

    const failingFetch = async (url) => url.includes('/get_token')
        ? { ok: true, json: async () => ({ access_token: 'fake-access-token' }) }
        : {
            ok: false,
            status: 429,
            body: { cancel: async () => { throw new Error('fake private response body'); } }
        };
    assert.deepEqual(await verifyYahooFantasyRead('fake-code', config, failingFetch), {
        outcome: 'fantasy_http_error', httpStatus: 429, accessToken: 'fake-access-token'
    });
});

test('responses are explicitly private and do not forward referrers', () => {
    assert.match(PRIVATE_HEADERS['Cache-Control'], /no-store/);
    assert.equal(PRIVATE_HEADERS['CDN-Cache-Control'], 'no-store');
    assert.equal(PRIVATE_HEADERS['Referrer-Policy'], 'no-referrer');
    assert.match(PRIVATE_HEADERS['X-Robots-Tag'], /noarchive/);
    assert.equal(FORM_HEADERS['Referrer-Policy'], 'same-origin');
    assert.equal(FORM_HEADERS['Cache-Control'], PRIVATE_HEADERS['Cache-Control']);
    assert.match(PRIVATE_HEADERS['Content-Security-Policy'], /frame-ancestors 'none'/);
});
