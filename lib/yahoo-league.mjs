import { XMLParser, XMLValidator } from 'fast-xml-parser';

const API = 'https://fantasysports.yahooapis.com/fantasy/v2/';
const LEAGUE_ID = 285072; // docs/LEAGUE_RULES.md in fantasy-football-front-office
export const SAFETY_POINTS = 100; // Preserve the league's unusual D/ST safety setting.
const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false });

export class YahooDataError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

const array = value => value == null ? [] : Array.isArray(value) ? value : [value];

function required(value) {
    if (typeof value !== 'string' || !value.trim()) throw new YahooDataError('invalid_data');
    return value;
}

function parseXml(xml) {
    if (typeof xml !== 'string' || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new YahooDataError('invalid_data');
    try {
        if (XMLValidator.validate(xml) !== true) throw new Error('Invalid XML');
        const root = parser.parse(xml)?.fantasy_content;
        if (!root || typeof root !== 'object') throw new Error('Invalid XML root');
        return root;
    } catch {
        throw new YahooDataError('invalid_data');
    }
}

function findTeams(node, found = []) {
    if (Array.isArray(node)) {
        for (const item of node) findTeams(item, found);
    } else if (node && typeof node === 'object') {
        if (typeof node.team_key === 'string') found.push(node);
        else for (const value of Object.values(node)) findTeams(value, found);
    }
    return found;
}

function rosterPlayers(root, week) {
    const roster = root.team?.roster;
    if (roster?.week !== String(week)) throw new YahooDataError('invalid_data');
    const players = array(roster.players?.player).map(node => {
        const slot = required(node.selected_position?.position);
        return {
            key: required(node.player_key),
            name: required(node.name?.full),
            position: required(node.display_position),
            slot,
            starter: !['BN', 'IR', 'IR+', 'NA'].includes(slot),
            status: typeof node.status === 'string' ? node.status : 'No Yahoo injury designation',
            byeWeek: typeof node.bye_weeks?.week === 'string' ? node.bye_weeks.week : null,
            nflTeam: typeof node.editorial_team_abbr === 'string' ? node.editorial_team_abbr : null
        };
    });
    if (!players.length) throw new YahooDataError('invalid_data');
    return players;
}

function lineupChecks(players, week, slots) {
    const checks = [];
    for (const player of players.filter(player => player.starter)) {
        if (player.byeWeek === String(week)) checks.push(`${player.name} (${player.slot}) has a bye this week.`);
        else if (['O', 'IR', 'PUP', 'SUSP', 'NA', 'D', 'Q'].includes(player.status)) {
            checks.push(`${player.name} (${player.slot}) has Yahoo status ${player.status}.`);
        }
    }
    for (const [slot, count] of Object.entries(slots)) {
        if (['BN', 'IR', 'IR+', 'NA'].includes(slot)) continue;
        const filled = players.filter(player => player.starter && player.slot === slot).length;
        if (filled < count) checks.push(`Fill ${count - filled} empty ${slot} slot(s) before lock.`);
    }
    return checks;
}

export async function fetchYahooLeague(accessToken, fetchImpl = fetch, fetchedAt = new Date()) {
    async function get(resource) {
        let response;
        try {
            response = await fetchImpl(API + resource, {
                method: 'GET',
                headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/xml' },
                signal: AbortSignal.timeout(10000),
                redirect: 'error',
                cache: 'no-store'
            });
        } catch {
            throw new YahooDataError('unavailable');
        }
        if (response.status === 401 || response.status === 403) throw new YahooDataError('unauthorized');
        if (!response.ok) throw new YahooDataError('unavailable');
        let xml;
        try { xml = await response.text(); } catch { throw new YahooDataError('unavailable'); }
        if (Buffer.byteLength(xml) > 8_000_000) throw new YahooDataError('invalid_data');
        return parseXml(xml);
    }

    const gameKey = required((await get('game/nfl')).game?.game_key);
    if (!/^\d+$/.test(gameKey)) throw new YahooDataError('invalid_data');
    const leagueKey = `${gameKey}.l.${LEAGUE_ID}`;
    const [settings, owned] = await Promise.all([
        get(`league/${leagueKey}/settings`),
        get(`users;use_login=1/games;game_keys=${gameKey}/teams`)
    ]);
    const league = settings.league;
    if (required(league?.league_key) !== leagueKey) throw new YahooDataError('invalid_data');
    const week = Number(league.current_week);
    if (!Number.isSafeInteger(week) || week < 1 || week > 30) throw new YahooDataError('invalid_data');
    const ownedTeams = findTeams(owned.users).filter(team => typeof team.team_key === 'string' && team.team_key.startsWith(`${leagueKey}.t.`));
    if (ownedTeams.length !== 1) throw new YahooDataError('invalid_data');
    const teamKey = required(ownedTeams[0].team_key);
    if (!/^\d+\.l\.\d+\.t\.\d+$/.test(teamKey)) throw new YahooDataError('invalid_data');

    const board = await get(`league/${leagueKey}/scoreboard;week=${week}`);
    const matchups = array(board.league?.scoreboard?.matchups?.matchup);
    const selected = matchups.filter(matchup => matchup.week === String(week) &&
        array(matchup.teams?.team).some(team => team.team_key === teamKey));
    if (selected.length !== 1) throw new YahooDataError('invalid_data');
    const teams = array(selected[0].teams?.team);
    if (teams.length !== 2) throw new YahooDataError('invalid_data');
    const ours = teams.find(team => team.team_key === teamKey);
    const opponent = teams.find(team => team.team_key !== teamKey);
    const opponentKey = required(opponent?.team_key);
    if (!new RegExp(`^${gameKey}\\.l\\.${LEAGUE_ID}\\.t\\.\\d+$`).test(opponentKey)) throw new YahooDataError('invalid_data');

    const [ourRoster, theirRoster] = await Promise.all([
        get(`team/${teamKey}/roster;week=${week}`),
        get(`team/${opponentKey}/roster;week=${week}`)
    ]);
    const slots = {};
    for (const item of array(league.settings?.roster_positions?.roster_position)) {
        const count = Number(item.count);
        if (!Number.isSafeInteger(count) || count < 0) throw new YahooDataError('invalid_data');
        slots[required(item.position)] = count;
    }
    if (!Object.keys(slots).length) throw new YahooDataError('invalid_data');
    const roster = rosterPlayers(ourRoster, week);
    const opponentRoster = rosterPlayers(theirRoster, week);
    const total = (team, field) => typeof team[field]?.total === 'string' ? team[field].total : 'Unavailable';
    return {
        source: 'Yahoo Fantasy Sports', fetchedAt: fetchedAt.toISOString(), leagueKey,
        leagueName: typeof league.name === 'string' ? league.name : 'Yahoo Fantasy Football',
        week, teamName: required(ours?.name), opponent: required(opponent?.name),
        points: total(ours, 'team_points'), opponentPoints: total(opponent, 'team_points'),
        projectedPoints: total(ours, 'team_projected_points'),
        opponentProjectedPoints: total(opponent, 'team_projected_points'),
        roster, opponentRoster, checks: lineupChecks(roster, week, slots),
        safetyPoints: SAFETY_POINTS
    };
}
