import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgePage } from '../lib/front-office-view.mjs';
import { verifiedHandoffPage } from '../lib/yahoo-callback.mjs';
import {
    exchangeHostedCode, hostedCallbackPreflight,
    signedHostedState, verifyHostedRead
} from '../lib/yahoo-hosted-access.mjs';
import { createState, REDIRECT_URI } from '../lib/yahoo-oauth.mjs';

test('front-office bridge page tells the owner how to save locally without exposing a token', () => {
    const page = bridgePage('Connected.');
    assert.match(page, /Yahoo authentication bridge/);
    assert.match(page, /bin\/fantasy-office receiver/);
    assert.match(page, /Connect Yahoo/);
    assert.doesNotMatch(page, /This matchup|Your roster|Opponent roster|access_token=/i);
});

test('hosted OAuth state is signed and cannot bind an arbitrary Yahoo account', () => {
    const state = createState();
    const secret = 'fake-session-secret-at-least-32-characters';
    const params = new URLSearchParams({ state, code: 'fake-code' });
    const cookie = signedHostedState(state, secret);
    assert.equal(hostedCallbackPreflight(params, cookie, secret), null);
    assert.equal(hostedCallbackPreflight(params, signedHostedState(state, 'another-secret-at-least-32-characters'), secret).status, 400);
    assert.equal(hostedCallbackPreflight(new URLSearchParams({ state: createState(), code: 'fake-code' }), cookie, secret).status, 400);
    const duplicate = new URLSearchParams({ state, code: 'fake-code' });
    duplicate.append('state', state);
    assert.equal(hostedCallbackPreflight(duplicate, cookie, secret).status, 400);
    assert.equal(hostedCallbackPreflight(new URLSearchParams({ state, error: 'access_denied' }), cookie, secret).status, 400);
});

test('hosted authorization returns a bounded access and refresh token pair', async () => {
    const config = { clientId: 'fake-id', clientSecret: 'fake-secret', redirectUri: REDIRECT_URI };
    const calls = [];
    const fakeFetch = async (url, options) => {
        calls.push({ url, options });
        if (url.includes('/get_token')) return { ok: true, json: async () => ({ access_token: 'fake-access-token', refresh_token: 'fake-refresh-token', expires_in: 3600 }) };
        return { ok: true, body: { cancel: async () => {} } };
    };
    const now = Date.parse('2026-10-15T12:00:00Z');
    const record = await exchangeHostedCode('fake-code', config, fakeFetch, now);
    await verifyHostedRead(record.accessToken, fakeFetch);
    assert.equal(calls[0].options.body.get('grant_type'), 'authorization_code');
    assert.equal(calls[1].options.headers.Authorization, 'Bearer fake-access-token');
    assert.deepEqual(record, {
        accessToken: 'fake-access-token',
        refreshToken: 'fake-refresh-token',
        expiresAt: now + 3600_000
    });
    await assert.rejects(exchangeHostedCode('fake-code', config, async () => ({
        ok: true, json: async () => ({ access_token: 'fake-access-token', expires_in: 3601 })
    }), now), /token_error/);
    await assert.rejects(exchangeHostedCode('fake-code', config, async () => ({
        ok: true, json: async () => ({ access_token: 'fake-access-token', refresh_token: '<bad>', expires_in: 3600 })
    }), now), /token_error/);
});

test('callback verifies the access token before rendering the exact credential pair', async () => {
    const calls = [];
    const expiresAt = Date.now() + 3600_000;
    const page = await verifiedHandoffPage('fake-code', { clientId: 'fake-id' }, {
        exchangeCode: async (code, config) => {
            calls.push(['exchange', code, config.clientId]);
            return {
                accessToken: 'fake-access-token',
                refreshToken: 'fake-refresh-token',
                expiresAt
            };
        },
        verifyRead: async accessToken => {
            calls.push(['verify', accessToken]);
        },
        renderHandoff: (accessToken, refreshToken, expiry) => {
            calls.push(['render', accessToken, refreshToken, expiry]);
            return 'private-handoff-page';
        }
    });

    assert.equal(page, 'private-handoff-page');
    assert.deepEqual(calls, [
        ['exchange', 'fake-code', 'fake-id'],
        ['verify', 'fake-access-token'],
        ['render', 'fake-access-token', 'fake-refresh-token', expiresAt]
    ]);
});
