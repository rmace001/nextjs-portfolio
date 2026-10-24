# Next.js portfolio on Netlify

[Live Demo](https://nextjs-platform-starter.netlify.app/)

A portfolio based on Next.js 16 (App Router), Tailwind CSS 4, daisyUI 5, and [Netlify platform primitives](https://docs.netlify.com/start/core-concepts/primitives/) (Edge Functions, Image CDN, and Blobs).

In this site, Netlify Core Primitives are used both implictly for running Next.js features (e.g. Route Handlers, image optimization via `next/image`, and more) and also explicitly by the user code. 

Implicit usage means you're using any Next.js functionality and everything "just works" when deployed - all the plumbing is done for you. Explicit usage is framework-agnostic and typically provides more features than what Next.js exposes.

## Deploying to Netlify

Netlify's [Next.js adapter](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/) handles Route Handlers and other server-side features. The project pins Node.js 26.12.1 in `.nvmrc` and uses webpack for production builds.

The Yahoo OAuth integration is an owner-only authentication bridge for Rogi's local fantasy agents. A terminal-started helper receives a short-lived access token from a **Save token locally** button and writes it to the companion project's Git-ignored `.env`. The callback page never displays the token or copies it to the clipboard. The current workflow and security boundaries are in the [Front Office specification](https://github.com/rmace001/fantasy-football-front-office/blob/main/spec.md). No Yahoo credentials belong in this repository.

The private `/front-office` entrance uses a signed, 12-hour owner session. It uses `YAHOO_ADMIN_PASSWORD` and a separate `FRONT_OFFICE_SESSION_SECRET` of at least 32 random characters, configured only for the production deploy context. The route requires the exact `rogeliomc.com` site URL and incoming host; preview hosts return 503. After sign-in, start `python3 yahoo_token_receiver.py` in the companion project and choose **Connect Yahoo**. The callback requires the owner session and signed OAuth state, exchanges the authorization code server-side, verifies one Fantasy read, and returns a private/no-store handoff page with the reported expiry and **Save token locally** button. The page sends only the access token to `127.0.0.1:8765`; refresh tokens are discarded and newly issued access tokens are not persisted by this site. The local receiver may trigger a browser Local Network Access permission prompt. Automatic renewal is not implemented. See [the Front Office milestone](https://github.com/rmace001/nextjs-portfolio/issues/7).

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/netlify-templates/next-platform-starter)

## Developing Locally

1. Clone this repository, then run `npm install` in its root directory.

2. For the starter to have full functionality locally (e.g. edge functions, blob store), please ensure you have an up-to-date version of Netlify CLI. Run:

```
npm install netlify-cli@latest -g
```

3. Link your local repository to the deployed Netlify site. This will ensure you're using the same runtime version for both local development and your deployed site.

```
netlify link
```

4. Then, run the Next.js development server via Netlify CLI:

```
netlify dev
```

If your browser doesn't navigate to the site automatically, visit [localhost:8888](http://localhost:8888).
