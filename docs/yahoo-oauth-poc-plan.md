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

The 403 investigation is resolved, but the original `/api/yahoo/connect` flow still displays **only the access token** on a private, no-store HTML page after a successful code exchange. This legacy diagnostic remains temporarily for the local Front Office sync. The new hosted Front Office connection flow uses a separate signed state cookie and never displays a token. Retire the diagnostic once the local workflow no longer depends on copying a short-lived token. The refresh token is discarded; the client secret, refresh token, full token response, and Fantasy response body are not included in the legacy page. Treat the displayed access token as a password, use it promptly, and close the page afterward.

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

## Phase 4 — Hosted Front Office with manual Yahoo reauthorization (in progress)

- Require the existing Front Office owner session before beginning the hosted Yahoo OAuth flow. Bind the callback to a signed, short-lived state cookie.
- Verify a read-only Fantasy request, then encrypt and save only the short-lived access token in a site-wide Netlify Blob. The production signing secret also derives the encryption key. The hosted routes reject preview hosts before accessing the store; keep the secret unavailable to deploy previews because site-wide Blobs are shared across deploys.
- On a signed-in dashboard request, fetch and normalize the current Yahoo league, matchup, and rosters in memory. Preserve the 100-point D/ST safety rule and show a precise fetch time.
- Return a sign-in page with HTTP 401 when the owner session expires. Return a Yahoo reconnect page with HTTP 401 when Yahoo access expires or is rejected. Do not refresh tokens automatically.

Function memory holds the fetched league data only for the request. The encrypted short-lived access token persists across serverless instances; no refresh token or raw Fantasy response is stored. Yahoo's one-hour token lifetime means the owner will reconnect Yahoo after expiry.

Exit condition: the owner can sign in from another device, connect Yahoo, and see current private league data without a Yahoo token in the hosted browser response. Verify expired-session and expired-Yahoo recovery on production before marking this complete.

## Phase 5 — Optional continuity improvements

If repeated Yahoo authorization becomes too cumbersome, add server-side refresh-token rotation and a private last-good snapshot. Both require their own recovery and concurrency design; neither is needed for the manually reauthorized dashboard.

Exit condition: the dashboard survives token expiry and temporary Yahoo outages without another authorization prompt when those behaviors are explicitly requested.
