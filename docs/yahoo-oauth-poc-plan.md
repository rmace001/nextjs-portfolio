# Yahoo Fantasy OAuth proof of concept

The proof of concept will live in this Netlify-hosted Next.js app. Its production callback will be `https://rogeliomc.com/api/redirect`. There is no working production OAuth integration to migrate from `api.bigdubs.org`.

## Phase 1 — Upgrade the portfolio foundation

- Upgrade the application, styling, linting, and Netlify Blobs dependencies together.
- Pin a supported Node.js version for Netlify builds and functions.
- Confirm a clean dependency install, lint, and production build. Check the deploy preview visually before merging, because styling has major-version changes.
- Document the new callback in `.env.example`. Do not add Yahoo credentials or change Yahoo registration in this phase.

Exit condition: the existing portfolio still builds and behaves as before on a Netlify deploy preview.

## Phase 2 — Prepare the production callback

- Add server-side Next.js route handlers for `/api/yahoo/connect` and `/api/redirect`.
- Keep the Yahoo client secret and an admin access secret in Netlify runtime environment variables, never in browser code or the repository. Use the variable names in `.env.example`; keep any real `.env` ignored.
- Restrict the connect route to the owner. Bind each authorization attempt to a short-lived, secure, HTTP-only `state` cookie and reject callbacks without a matching state.
- Exchange the authorization code on the server, call one read-only Yahoo Fantasy endpoint, and show only a safe success/failure result. Do not persist tokens yet.
- Add automated tests for state checks, token exchange failures, and safe responses. Deploy the callback code to the production domain.

Exit condition: the callback route is reachable at the exact production URL, and required secrets are configured in Netlify. The route can exist before Yahoo registration is changed.

## Phase 3 — Register and run the one-shot proof

- Update the Yahoo application's redirect URI to `https://rogeliomc.com/api/redirect` and confirm Fantasy Sports read permission.
- Open the protected connect route, approve access in Yahoo, and verify that the callback reports a successful authenticated Fantasy API read.
- Inspect status codes and server logs without recording authorization codes, access tokens, refresh tokens, or private Fantasy response bodies.

Exit condition: one complete browser authorization and authenticated Fantasy API request succeed on `rogeliomc.com`.

## Phase 4 — Add durable access only if needed

- Store the latest refresh token in a site-wide Netlify Blob (or a database if the app grows beyond one account), and replace it whenever Yahoo rotates it.
- Keep token-writing routes unavailable to deploy previews, because site-wide Blobs are shared across deploy contexts.
- Protect follow-up status and data routes, and test refresh, revocation, and reauthorization.

Exit condition: an authenticated API read succeeds after the original access token expires, without another Yahoo consent prompt.

## Phase 5 — Connect the fantasy application

- Move only the minimum Fantasy data needed by the front-office app through a server-side API boundary.
- Keep credentials and tokens on the Netlify side, or deliberately choose a different backend before implementing cross-domain data access.

Exit condition: the front-office app can use authorized Yahoo data without receiving Yahoo secrets or tokens.
