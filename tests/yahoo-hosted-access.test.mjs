import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgePage } from '../lib/front-office-view.mjs';
import {
    exchangeHostedCode, hostedCallbackPreflight,
    signedHostedState, verifyHostedRead
} from '../lib/yahoo-hosted-access.mjs';
import { createState, REDIRECT_URI } from '../lib/yahoo-oauth.mjs';

test('front-office bridge page tells the owner how to save locally without exposing a token', () => {
    const page = bridgePage('Connected.');
    assert.match(page, /Yahoo authentication bridge/);
    assert.match(page, /python3 yahoo_token_receiver\.py/);
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

test('hosted authorization returns only a bounded short-lived access token', async () => {
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
    assert.deepEqual(record, { accessToken: 'fake-access-token', expiresAt: now + 3600_000 });
    await assert.rejects(exchangeHostedCode('fake-code', config, async () => ({
        ok: true, json: async () => ({ access_token: 'fake-access-token', expires_in: 3601 })
    }), now), /token_error/);
});
