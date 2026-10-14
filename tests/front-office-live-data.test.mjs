import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { dashboardPage } from '../lib/front-office-view.mjs';
import { fetchYahooLeague, YahooDataError } from '../lib/yahoo-league.mjs';
import {
    currentAccess, exchangeHostedCode, hostedCallbackPreflight, openAccess,
    saveAccess, sealAccess, signedHostedState, verifyHostedRead
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

test('dashboard escapes Yahoo strings and shows attribution and the captured safety rule', () => {
    const page = dashboardPage({
        week: 5, teamName: '<script>bad()</script>', leagueName: 'Test League', opponent: 'Opponent & Co',
        fetchedAt: '2026-10-15T12:00:00.000Z', points: '0', opponentPoints: '0',
        projectedPoints: '110.5', opponentProjectedPoints: '105.0',
        roster: [{ name: '<img src=x>', position: 'QB', slot: 'QB', status: 'Q', byeWeek: null }],
        opponentRoster: [], checks: ['Review <player>'], safetyPoints: 100
    });
    assert.doesNotMatch(page, /<script>|<img src=x>/);
    assert.match(page, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
    assert.match(page, /100 points/);
    assert.match(page, /Fantasy data provided by/);
    assert.doesNotMatch(page, /secret-token/);
});

test('hosted OAuth state is signed and cannot bind an arbitrary Yahoo account', () => {
    const state = createState();
    const secret = 'fake-session-secret-at-least-32-characters';
    const params = new URLSearchParams({ state, code: 'fake-code' });
    const cookie = signedHostedState(state, secret);
    assert.equal(hostedCallbackPreflight(params, cookie, secret), null);
    assert.equal(hostedCallbackPreflight(params, signedHostedState(state, 'another-secret-at-least-32-characters'), secret).status, 400);
    assert.equal(hostedCallbackPreflight(new URLSearchParams({ state: createState(), code: 'fake-code' }), cookie, secret).status, 400);
});

test('hosted authorization stores only encrypted, short-lived access and requires reconnect after expiry', async () => {
    const secret = 'fake-session-secret-at-least-32-characters';
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
    assert.equal(record.refreshToken, undefined);

    const store = {
        saved: null,
        async setJSON(key, value) { assert.equal(key, 'owner-access-v1'); this.saved = value; },
        async get(key) { assert.equal(key, 'owner-access-v1'); return this.saved; }
    };
    await saveAccess(record, secret, store);
    assert.ok(!JSON.stringify(store.saved).includes('fake-access-token'));
    assert.ok(!JSON.stringify(store.saved).includes('fake-refresh-token'));
    assert.deepEqual(openAccess(store.saved, secret), record);
    assert.deepEqual(await currentAccess(secret, store, now), record);
    assert.equal(await currentAccess(secret, store, now + 3600_000), null);
    assert.throws(() => openAccess({ ...store.saved, ciphertext: 'tampered' }, secret), /storage_error/);
    assert.throws(() => openAccess(store.saved, 'different-secret-at-least-32-characters'), /storage_error/);
    assert.deepEqual(sealAccess(record, secret).version, 1);
});
