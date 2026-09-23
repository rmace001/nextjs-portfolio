# Next.js portfolio on Netlify

[Live Demo](https://nextjs-platform-starter.netlify.app/)

A portfolio based on Next.js 16 (App Router), Tailwind CSS 4, daisyUI 5, and [Netlify platform primitives](https://docs.netlify.com/start/core-concepts/primitives/) (Edge Functions, Image CDN, and Blobs).

In this site, Netlify Core Primitives are used both implictly for running Next.js features (e.g. Route Handlers, image optimization via `next/image`, and more) and also explicitly by the user code. 

Implicit usage means you're using any Next.js functionality and everything "just works" when deployed - all the plumbing is done for you. Explicit usage is framework-agnostic and typically provides more features than what Next.js exposes.

## Deploying to Netlify

Netlify's [Next.js adapter](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/) handles Route Handlers and other server-side features. The project pins Node.js 24 in `.nvmrc` and uses webpack for production builds.

The phased Yahoo Fantasy OAuth proof of concept is documented in [docs/yahoo-oauth-poc-plan.md](docs/yahoo-oauth-poc-plan.md). No Yahoo credentials belong in this repository.

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


