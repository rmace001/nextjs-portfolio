function html(value) {
    return String(value ?? '—').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

const head = title => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)} | Front Office</title><link rel="stylesheet" href="/front-office.css"></head><body><main class="wrap">`;
const end = '</main></body></html>';
const signOut = '<form method="post" action="/front-office/logout"><button type="submit" class="quiet">Sign out</button></form>';
const connect = '<form method="post" action="/front-office/yahoo/connect"><button type="submit">Connect Yahoo</button></form>';

export const loginPage = `${head('Sign in')}<section class="card"><h1>Fantasy Football Front Office</h1><p>Sign in to connect Yahoo and save a short-lived access token to your local project.</p><form method="post" action="/front-office"><label for="password">Owner password</label><input id="password" type="password" name="password" autocomplete="current-password" required><button type="submit">Sign in</button></form></section>${end}`;

export function bridgePage(message = 'Connect Yahoo to obtain a fresh token for your local agent workflow.') {
    return `${head('Yahoo authentication')}<header class="top"><h1>Fantasy Football Front Office</h1>${signOut}</header><section class="card"><h2>Yahoo authentication bridge</h2><p>${html(message)}</p><p>Start <code>python3 yahoo_token_receiver.py</code> in the fantasy-football project folder, then connect Yahoo here. The one-time page sends the short-lived access token directly to that local helper; it will not display or copy the token.</p>${connect}</section>${end}`;
}
