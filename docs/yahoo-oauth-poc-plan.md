# Yahoo Fantasy OAuth proof of concept

**Status (October 8, 2026): Complete.** The Netlify-hosted callback at `https://rogeliomc.com/api/redirect` completed browser authorization and an authenticated Yahoo Fantasy API read. That access unblocked the companion Fantasy Football Front Office repository, where Rogi completed a local GET-only league sync and verified the dashboard with live league data.

There is no production OAuth integration to migrate from `api.bigdubs.org`. The completed proof remains the basis for future private hosting on `rogeliomc.com`.

## Phase 1 — Upgrade the portfolio foundation (complete)

- Upgrade the application, styling, linting, and Netlify Blobs dependencies together.
- Pin a supported Node.js version for Netlify builds and functions.
- Confirm a clean dependency install, lint, and production build. Check the deploy preview visually before merging, because styling has major-version changes.
- Document the new callback in `.env.example`. Do not add Yahoo credentials or change Yahoo registration in this phase.

Exit condition: the existing portfolio still builds and behaves as before on a Netlify deploy preview.

## Phase 2 — Prepare the production callback (complete)

- Add server-side Next.js route handlers for `/api/yahoo/connect` and `/api/redirect`.
- Keep the Yahoo client secret and an admin access secret in Netlify runtime environment variables, never in browser code or the repository. Use the variable names in `.env.example`; keep any real `.env` ignored.
- Restrict the connect route to the owner. Bind each authorization attempt to a short-lived, secure, HTTP-only `state` cookie and reject callbacks without a matching state.
- Exchange the authorization code on the server, call one read-only Yahoo Fantasy endpoint, and show only a safe success/failure result. Do not persist tokens yet.
- Add automated tests for state checks, token exchange failures, and safe responses. Deploy the callback code to the production domain.

Exit condition: the callback route is reachable at the exact production URL, and required secrets are configured in Netlify. The route can exist before Yahoo registration is changed.

### Phase 2 deployment runbook

The routes are implemented in `app/api/yahoo/connect/route.js` and `app/api/redirect/route.js`. Configure Yahoo credentials only for the Netlify production deploy context. Netlify may present an internal URL to Next.js route handlers, so they do not gate on `request.url`'s origin. The password form POST still requires the exact `https://rogeliomc.com` browser Origin; the callback still requires the matching short-lived state cookie. There is no token persistence and no Fantasy data is sent to the browser.

1. In Netlify **Project configuration → Environment variables**, add the four names from `.env.example` for the production deploy context. If your plan supports variable scopes, include **Functions**. Set `YAHOO_REDIRECT_URI` to exactly `https://rogeliomc.com/api/redirect`. Set `YAHOO_ADMIN_PASSWORD` to a unique, randomly generated password of at least 16 characters. Do not use `NEXT_PUBLIC_` names, put values in `netlify.toml`, or commit a populated `.env` file.
2. Keep sensitive variables unavailable to untrusted deploy previews. The connect POST rejects preview browser origins, but preview functions should not receive the credentials at all.
3. Deploy the routes to production. Visit `https://rogeliomc.com/api/yahoo/connect`; it should show the owner-password form. A direct visit to `https://rogeliomc.com/api/redirect` should show a safe state-validation error, not a 404. Do not paste a Yahoo authorization code into the URL for testing.
4. This deployment configuration and matching Yahoo registration were completed before the authenticated read in Phase 3.

The password form sends a same-origin POST over HTTPS. A valid password starts a ten-minute OAuth attempt. The callback compares Yahoo's returned `state` to an HTTP-only, Secure, SameSite=Lax cookie, exchanges the code server-side, and performs one read-only Fantasy `users/.../games` request. The temporary diagnostic behavior below overrides the original no-token-in-browser design.

### Temporary access-token diagnostic (follow-up cleanup)

The 403 investigation is resolved, but the current callback still displays **only the access token** on a private, no-store HTML page after a successful code exchange. This legacy diagnostic must be removed before the OAuth route becomes part of a durable hosted-dashboard workflow. The refresh token is discarded; the client secret, refresh token, full token response, and Fantasy response body are not included in the page. Yahoo's one-time authorization code still appears in the callback URL. The one-time state cookie is cleared; reloading the callback cannot retrieve the token again. Treat the displayed access token as a password, use it promptly (Yahoo documents about one hour of validity), and close the page afterward.

To test locally without putting the token in a command, shell history, or a `curl` argument, run these commands in a trusted terminal. Paste the access token at the hidden prompt, then press Enter:

```bash
read -rs -p 'Yahoo access token: ' YAHOO_POC_ACCESS_TOKEN; printf '\n'
printf 'header = "Authorization: Bearer %s"\n' "$YAHOO_POC_ACCESS_TOKEN" | curl --silent --show-error --config - 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games?format=json'
unset YAHOO_POC_ACCESS_TOKEN
```

The response may contain private Fantasy data; do not paste the token or full response into chats or issue trackers. Run the `unset` command even if `curl` fails.

## Phase 3 — Register and run the one-shot proof (complete)

- Update the Yahoo application's redirect URI to `https://rogeliomc.com/api/redirect` and confirm Fantasy Sports read permission.
- Open the protected connect route, approve access in Yahoo, and verify that the callback reports a successful authenticated Fantasy API read.
- Inspect status codes and server logs without recording authorization codes, access tokens, refresh tokens, or private Fantasy response bodies.

Exit condition: Met. A complete browser authorization and authenticated Fantasy API request succeeded on `rogeliomc.com`.

## Phase 4 — Add durable access for hosted use

- Store the latest refresh token in a site-wide Netlify Blob (or a database if the app grows beyond one account), and replace it whenever Yahoo rotates it.
- Keep token-writing routes unavailable to deploy previews, because site-wide Blobs are shared across deploy contexts.
- Protect follow-up status and data routes, and test refresh, revocation, and reauthorization.

Function memory can hold a fetched response only during a live request. It is not durable storage: a serverless function may restart or serve a later request on a different instance. A seamless private dashboard therefore needs durable server-side refresh-token storage and a private normalized snapshot or cache; browser clients must never receive Yahoo credentials or tokens.

Exit condition: an authenticated API read succeeds after the original access token expires, without another Yahoo consent prompt.

## Phase 5 — Host the private Front Office dashboard

- Add an owner-only Front Office route on `rogeliomc.com`, using a durable password-session gate rather than the one-time OAuth diagnostic form.
- Fetch and normalize only the Fantasy data the dashboard needs through a server-side boundary.
- Keep credentials, refresh tokens, and private raw responses on the server. Render or return only the normalized dashboard data to the authenticated owner.

Exit condition: the owner can reach the dashboard from anywhere after authentication, and the dashboard refreshes authorized Yahoo data without receiving Yahoo secrets or tokens.
