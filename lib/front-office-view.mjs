function html(value) {
    return String(value ?? '—').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

const head = title => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)} | Front Office</title><link rel="stylesheet" href="/front-office.css"></head><body><main class="wrap">`;
const end = '</main></body></html>';
const signOut = '<form method="post" action="/front-office/logout"><button type="submit" class="quiet">Sign out</button></form>';
const connect = '<form method="post" action="/front-office/yahoo/connect"><button type="submit">Connect Yahoo</button></form>';

export const loginPage = `${head('Sign in')}<section class="card"><h1>Fantasy Football Front Office</h1><p>Sign in to view your private dashboard.</p><form method="post" action="/front-office"><label for="password">Owner password</label><input id="password" type="password" name="password" autocomplete="current-password" required><button type="submit">Sign in</button></form></section>${end}`;

export function reconnectPage(message = 'Connect Yahoo to load your current matchup and rosters.') {
    return `${head('Connect Yahoo')}<header class="top"><h1>Fantasy Football Front Office</h1>${signOut}</header><section class="card"><h2>Yahoo connection needed</h2><p>${html(message)}</p>${connect}</section>${end}`;
}

export function errorPage(message) {
    return `${head('Yahoo unavailable')}<header class="top"><h1>Fantasy Football Front Office</h1>${signOut}</header><section class="card"><h2>Could not load Yahoo data</h2><p>${html(message)}</p><a href="/front-office">Try again</a></section>${end}`;
}

function roster(items) {
    return `<ul class="roster">${items.map(player => `<li><strong>${html(player.name)}</strong><span>${html(player.position)} · ${html(player.slot)} · ${html(player.status)}${player.byeWeek ? ` · Bye ${html(player.byeWeek)}` : ''}</span></li>`).join('')}</ul>`;
}

export function dashboardPage(data) {
    const checks = data.checks.length
        ? `<ul>${data.checks.map(item => `<li>${html(item)}</li>`).join('')}</ul>`
        : '<p>No empty slots or Yahoo availability flags detected. Verify current inactives before lock.</p>';
    return `${head('Dashboard')}
<header class="top"><div><p class="eyebrow">Yahoo Fantasy Sports · Week ${html(data.week)}</p><h1>${html(data.teamName)}</h1><p>${html(data.leagueName)}</p></div>${signOut}</header>
<p class="freshness">Last fetched: <time datetime="${html(data.fetchedAt)}">${html(data.fetchedAt)}</time> · <a href="/front-office">Refresh Yahoo data</a></p>
<div class="grid"><section class="card"><h2>This matchup</h2><p>Against <strong>${html(data.opponent)}</strong></p><div class="score"><div><strong>${html(data.points)}</strong><span>Your points</span></div><div><strong>${html(data.opponentPoints)}</strong><span>Opponent points</span></div></div><p>Projected: ${html(data.projectedPoints)} – ${html(data.opponentProjectedPoints)}</p><p class="muted">Projections are estimates, not start/sit advice.</p></section>
<section class="card"><h2>Lineup review</h2>${checks}</section>
<section class="card"><h2>Your roster</h2>${roster(data.roster)}</section>
<section class="card"><h2>Opponent roster</h2>${roster(data.opponentRoster)}</section></div>
<section class="card"><h2>League scoring reminder</h2><p>D/ST safety: <strong>${html(data.safetyPoints)} points</strong>. Preserve the captured rule when evaluating players.</p></section>
<footer><p>Fantasy data provided by <a href="https://football.fantasysports.yahoo.com/">Yahoo Fantasy</a>. Confirm injury news and lineup locks in Yahoo before acting.</p></footer>${end}`;
}
