import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { bridgePage } from '../lib/front-office-view.mjs';
import { fetchYahooLeague, YahooDataError } from '../lib/yahoo-league.mjs';
import {
    deleteLegacyAccess, exchangeHostedCode, hostedCallbackPreflight,
    signedHostedState, verifyHostedRead
} from '../lib/yahoo-hosted-access.mjs';
import { createState, REDIRECT_URI } from '../lib/yahoo-oauth.mjs';

const fixture = readFileSync(new URL('./fixtures/yahoo.xml', import.meta.url), 'utf8');
const contents = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false }).parse(fixture).fixtures;
const builder = new XMLBuilder({ ignoreAttributes: true });
const resources = [
    'game/nfl', 'league/999.l.285072/settings', 'users;use_login=1/games;game_keys=999/teams',
    'league/999.l.285072/scoreboard;week=5', 'team/999.l.285072.t.1/roster;week=5',
    'team/999.l.285072.t.2/roster;week=5'
];
const sections = ['game', 'settings', 'owned', 'scoreboard', 'roster', 'opponent'];
const xmlByResource = Object.fromEntries(resources.map((resource, index) => [
    resource, builder.build({ fantasy_content: contents[sections[index]].fantasy_content })
]));

test('fetches and normalizes the current Yahoo matchup without changing league scoring', async () => {
    const calls = [];
    const fakeFetch = async (url, options) => {
        calls.push({ url, options });
        const resource = url.split('/fantasy/v2/')[1];
        assert.ok(xmlByResource[resource], `Unexpected resource: ${resource}`);
        return { ok: true, status: 200, text: async () => xmlByResource[resource] };
    };
    const data = await fetchYahooLeague('fake-access-token', fakeFetch, new Date('2026-10-15T12:00:00Z'));
    assert.equal(data.week, 5);
    assert.equal(data.opponent, 'Opponent & Co');
    assert.equal(data.roster.length, 3);
    assert.equal(data.opponentRoster.length, 1);
    assert.equal(data.checks.length, 3);
    assert.match(data.checks[0], /bye/);
    assert.match(data.checks[1], /status Q/);
    assert.match(data.checks[2], /1 empty RB/);
    assert.equal(data.safetyPoints, 100);
    assert.equal(data.fetchedAt, '2026-10-15T12:00:00.000Z');
    assert.equal(calls.length, 6);
    assert.ok(calls.every(call => call.options.method === 'GET' && call.options.headers.Authorization === 'Bearer fake-access-token'));
});

test('Yahoo authorization and malformed responses fail with safe errors', async () => {
    await assert.rejects(fetchYahooLeague('secret-token', async () => ({ ok: false, status: 401 })),
        error => error instanceof YahooDataError && error.code === 'unauthorized' && !String(error).includes('secret-token'));
    await assert.rejects(fetchYahooLeague('secret-token', async () => ({ ok: true, status: 200, text: async () => '<broken>' })),
        error => error instanceof YahooDataError && error.code === 'invalid_data');
    await assert.rejects(fetchYahooLeague('secret-token', async () => ({ ok: true, status: 200, text: async () => '<!DOCTYPE foo><fantasy_content />' })),
        error => error instanceof YahooDataError && error.code === 'invalid_data');
});

test('front-office bridge page tells the owner how to save locally and does not expose a token', () => {
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

test('hosted authorization returns only a bounded short-lived access token and removes legacy persistence', async () => {
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

    const store = {
        deleted: null,
        async delete(key) { this.deleted = key; }
    };
    await deleteLegacyAccess(store);
    assert.equal(store.deleted, 'owner-access-v1');
    await assert.rejects(exchangeHostedCode('fake-code', config, async () => ({
        ok: true, json: async () => ({ access_token: 'fake-access-token', expires_in: 3601 })
    }), now), /token_error/);
});
