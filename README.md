# newslang

A minimal language-learning web app that reads Italian news. It pulls the
latest headlines from a choice of free RSS feeds (**ANSA** and **Rai News**),
and opening an article shows a clean reader view extracted with **Mozilla's
Readability**. Select any word or phrase — in the article body, the headline,
the summary, or anywhere in the interface — to translate it and save it
to a personal vocabulary; a review view brings saved phrases back for practice.
It ships the full tooling: Vite + React, TypeScript, a tiny hand-rolled router,
ESLint + Prettier, Vitest, and a Cloudflare Worker backend with production and
staging environments.

## Tech stack

- [Vite](https://vite.dev/) + [React 19](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [ESLint](https://eslint.org/) (flat config) + [Prettier](https://prettier.io/)
- [Vitest](https://vitest.dev/)
- [pnpm](https://pnpm.io/) for package management
- [Cloudflare Workers](https://developers.cloudflare.com/workers/) via
  [`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/)

## Development

```sh
corepack enable        # one-time: makes the pinned pnpm available
pnpm install
pnpm dev               # frontend + Worker, one server (Vite plugin)
pnpm build             # typecheck (app + worker) + production build to dist/
pnpm preview           # serve the production build in the Workers runtime

pnpm typecheck         # tsc for app + worker
pnpm lint              # eslint
pnpm format            # prettier --write
pnpm test              # vitest
```

`pnpm dev` runs the Worker in Miniflare via the Vite plugin. Copy `.dev.vars.example`
to `.dev.vars` (already gitignored) to set local environment variables.

## Backend (Worker)

`worker/index.ts` exposes these JSON endpoints:

```
GET    /api/health        -> { ok: true, env: "production" | "staging" | "development" }
GET    /api/headlines?source=ansa|rai -> [{ id, title, link, summary, author?, pubDate?, category?, image? }]
GET    /api/article-html?url=<article-url> -> raw article HTML (ansa.it / rainews.it only)
POST   /api/translate     -> translate + save a selection; body { text, context?, before?, after?, articleUrl?, articleTitle? }
GET    /api/translations?q=<search> -> { entries: TranslationEntry[] }
POST   /api/translations/:id/review -> record a review; body { result: "again" | "known" }
DELETE /api/translations/:id
```

`worker/rss.ts` fetches and parses each source's RSS feed with
`fast-xml-parser` (`ANSA` → `ansa.it/.../topnews_rss.xml`, `Rai News` →
`rainews.it/rss/tutti`). The `/api/article-html` endpoint proxies an article
page (server-side, to avoid CORS and host allow-listing); the React app then
extracts the readable body with `@mozilla/readability` in the browser.

### Translation & vocabulary

Each browser is assigned an anonymous UUID in an HttpOnly cookie
(`worker/user.ts`). That id names a **SQLite-backed Durable Object**
(`TranslationStore`, `worker/store.ts`) — so every user gets their own embedded
SQLite database holding their saved phrases, their translations, the sentences
they appeared in, and spaced-repetition state. Because the id lives in a cookie
and never reaches app code, swapping in real accounts later is a change to one
file.

`worker/translation.ts` is the provider seam. **DeepL** is the default recommendation:

- best translation quality for European language pairs (Italian → English);
- its `context` parameter carries the surrounding sentence for context-aware
  translations, and is **not billed**;
- priced per source character, so a learner who translates ~50 phrases/day stays
  comfortably within a free or entry-level plan.

DeepL's **API Free** tier (500k characters/month, keys ending in `:fx`, served
from `api-free.deepl.com`) has been retired for new signups, so check what your
account can sign up for. If you want the cheapest option without any monthly
fee, **Azure AI Translator** is the better pick: 2M characters/month free
forever on the F0 tier, then $10 per million (roughly half of Google's $20/M).
**Google Cloud Translation** also has 500k characters/month free. All three slot
in behind the same seam — it is a single function in `worker/translation.ts`.

Without `DEEPL_API_KEY`, `APP_ENV=development` uses a deterministic mock
translator so the whole flow (selection → storage → review) works offline.
When a key is later configured, any entries still stored with the mock
provider are re-translated and updated in place: `GET /api/translations`
refreshes them before returning the list (so the review view shows real
translations without re-selecting each phrase), and re-selecting a mock phrase
refreshes it too. If the provider call fails the mock is kept, so a later
request can retry.

### Selection translation

`src/SelectionTranslator.tsx` is mounted once in `App.tsx`, so it watches
`selectionchange` across the whole document rather than a single article-body
element. Any selectable text — article body, headline, excerpt, byline,
navigation, buttons, review cards — offers the same "Traduci" popover. The
current article's URL and title are published through `src/article-meta.tsx` so
saved phrases keep that context.

Elements marked with `data-translate-ignore` (and form controls) are skipped, so
selecting a translation to copy — or the review search box — never triggers a
new translation.

Vocabulary helpers (whitespace normalization, phrase identity, the review
scheduler) live in `shared/vocab.ts` and are unit-tested in `test/`.

The Worker's `Env` type comes from `worker/env.d.ts` (bindings/secrets that aren't in
`wrangler.jsonc`) merged with `worker-configuration.d.ts` (generated by
`pnpm cf-typegen`).

### Translation provider key

Set `DEEPL_API_KEY` per environment:

```sh
wrangler secret put DEEPL_API_KEY             # production
wrangler secret put DEEPL_API_KEY --env staging
```

## Deploying to Cloudflare

Both environments deploy to the default `*.workers.dev` subdomain (no custom domain
configured yet):

- Production: `https://newslang.<your-subdomain>.workers.dev`
- Staging: `https://newslang-staging.<your-subdomain>.workers.dev`

### Secrets

CI authenticates with two repository secrets (the same approach chesspath uses):

- `CLOUDFLARE_API_TOKEN` — a Cloudflare API token with Workers deploy permission
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account id

App secrets (e.g. `DEEPL_API_KEY`, and the placeholder `JWT_SECRET`) are set per
environment with `wrangler secret put` (or the `secrets` input of
`wrangler-action` in CI), and read locally from `.dev.vars`.

### Production

A push to `main` runs CI; on success the `Deploy to Cloudflare` workflow builds and
runs `wrangler deploy`. You can also trigger it manually from **Actions → Deploy to
Cloudflare** (`workflow_dispatch`).

### Staging

`.github/workflows/deploy-staging.yml` deploys any branch to the staging Worker. Two
ways to trigger it:

- Comment `/deploy-staging` on a pull request (new PRs get an automatic reminder
  comment). This only works for repository owners/members/collaborators, and only for
  PRs from this repository (not forks).
- Run **Actions → Deploy to Staging** manually with a `ref`, or locally with
  `pnpm deploy:staging:gh`.

Staging is built with `--mode staging`, then `scripts/patch-staging-config.mjs`
rewrites the Vite-generated Worker config to point at the staging Worker before
`wrangler deploy --config dist/newslang/wrangler.json`.

## Project layout

```
src/            — the React app (router, views, readability extraction, styles)
worker/         — the Cloudflare Worker (API + static asset serving)
shared/         — API contracts shared between the app and the Worker
scripts/        — build/deploy helpers (pure stdlib, no deps)
test/           — Vitest specs
wrangler.jsonc  — Worker config (assets + vars + env.staging)
```

# newslang
