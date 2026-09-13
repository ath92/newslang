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
GET    /api/progress?tzOffsetMinutes=<n> -> { targetMinutes, today, history, streak }
POST   /api/progress/read -> credit an article; body { articleUrl, articleTitle?, minutes, tzOffsetMinutes }
PUT    /api/progress/target -> set the daily goal; body { targetMinutes, tzOffsetMinutes }
GET    /api/notifications -> { enabled, reminderMinutes, timezone, vapidPublicKey, subscribed }
PUT    /api/notifications -> enable/disable + set the reminder time; body { enabled, reminderMinutes?, timezone? }
POST   /api/notifications/subscribe -> register this device's push subscription; body { endpoint, keys }
POST   /api/notifications/unsubscribe -> remove it; body { endpoint }
POST   /api/notifications/test -> send a one-off test push
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

### Daily reading goal

Readers can set a daily target in minutes (default 10, with presets and an
"off" option) from the chip in the Home and article headers. Opening an article
credits its **estimated** read time (see `shared/reading.ts`, 100 wpm) to the
per-user, per-local-day counter exactly once per article; reopening it the same
day is deduped. A subtle toast confirms each credit and a celebratory one fires
when the day's target is crossed. The chip shows today's progress plus the
current streak, and the goal dialog shows a 7-day history strip.

Progress lives in the same per-user Durable Object as the vocabulary
(`reading_goal` + `reading_log` tables in `worker/store.ts`). Instants are
stored as UTC (`created_at`) together with the reader's `tzOffsetMinutes`, and
the local calendar day is derived in `shared/progress.ts` — so "today" follows
the reader's timezone without any server-side tz math. Streaks are computed
from a 30-day window and shown with the last 7 days.

### Daily reminders (Web Push)

Each device can opt into one reminder a day — by default at 20:00 local — that
fires only when the day's target is still unmet. The plumbing reuses the same
per-user Durable Object:

- `notification_settings` stores `enabled`, `reminderMinutes` (minutes after
  local midnight) and an IANA `timezone`, so the reminder keeps its wall-clock
  time across daylight-saving changes (`shared/reminders.ts` derives the next
  instant with `Intl.DateTimeFormat`; `Date` is always UTC in Workers).
- `push_subscriptions` holds the browser's Web Push subscription, and
  `reminder_log` claims one reminder per local day so an alarm retry can never
  double-send.
- The DO arms a single `alarm()` at the next reminder instant; when it fires it
  checks `getDailyProgress` against the target, sends if needed, then re-arms
  for tomorrow. Enabling notifications _after_ the reminder time sends the
  nudge immediately instead of waiting a day.
- Delivery uses **`@mmmike/web-push`** (RFC 8291 `aes128gcm` + RFC 8292 VAPID,
  built on Web Crypto) so it runs in Workers without `nodejs_compat`. The
  service worker (`public/sw.js`) shows the payload and opens `/` on click.
  Dead endpoints (HTTP 404/410) are pruned automatically.

Because identity is still an anonymous cookie, reminders are **per device**: a
phone and a laptop are separate "users" until real accounts exist. On iOS,
Safari only delivers Web Push to a PWA **installed to the Home Screen**
(iOS 16.4+); the settings UI degrades gracefully elsewhere. Endpoints are
allowlisted to the real push services (FCM, Mozilla, Apple) so a hostile client
can't turn the Worker into an SSRF proxy.

Opting in is offered in two places: a small 🔔 on the daily-progress chip
whenever reminders are off, and a one-time banner. The banner keeps its two
feedback paths separate — “Non ora” snoozes it for a few days, while “Non
chiedermelo più” opts out for good — and both are remembered in `localStorage`.

### Installing as an app (PWA)

Newslang is installable from the browser. `public/manifest.webmanifest` declares
the name, standalone display, theme colors and icons (192/512 plus a maskable
variant), and `index.html` carries the manifest link, `theme-color` and the
`apple-touch-icon`/`apple-mobile-web-app-*` meta tags used by iOS.

`public/sw.js` is a small service worker that keeps the app shell and
content-hashed build output in a versioned cache, so the app opens offline and
reloads are fast. It uses network-first for HTML navigations, cache-first for
`/assets/*`, and never caches `/api/*`. Registration is production-only (see
`src/main.tsx`).

`src/InstallPrompt.tsx` turns Chromium's `beforeinstallprompt` into an in-app
"Installa" button and, on iOS (which has no install event), shows the Share →
"Aggiungi a Home" instructions instead. Dismissal is remembered.

Icons are generated with a dependency-free Node script and committed under
`public/`; regenerate them with `pnpm icons` after editing
`scripts/generate-icons.mjs`. `public/_headers` sets `no-cache` on the service
worker and manifest and a long immutable cache on `/assets/*`; Cloudflare's
static-asset layer applies these at build, preview and deploy time.

To verify installability, run `pnpm build && pnpm preview` and check DevTools →
Application → Manifest (the install criteria are listed there), or open the
deployed site on an Android phone and use _Add to Home screen_.

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

### Web Push (VAPID) keys

Reminders need a VAPID key pair. Generate one and set it per environment:

```sh
node --input-type=module -e "import {generateVapidKeys} from '@mmmike/web-push/vapid'; console.log(await generateVapidKeys())"

wrangler secret put VAPID_PUBLIC_KEY             # production
wrangler secret put VAPID_PRIVATE_KEY            # production
wrangler secret put VAPID_PUBLIC_KEY --env staging
wrangler secret put VAPID_PRIVATE_KEY --env staging
```

`VAPID_SUBJECT` (a `mailto:` contact URI) is a plain var in `wrangler.jsonc`.
Without the key pair, the notification settings UI reports that push is
unconfigured and no sends are attempted. Local dev uses the dev-only pair in
`.dev.vars`.

## Deploying to Cloudflare

Both environments deploy to the default `*.workers.dev` subdomain (no custom domain
configured yet):

- Production: `https://newslang.<your-subdomain>.workers.dev`
- Staging: `https://newslang-staging.<your-subdomain>.workers.dev`

### Secrets

CI authenticates with two repository secrets (the same approach chesspath uses):

- `CLOUDFLARE_API_TOKEN` — a Cloudflare API token with Workers deploy permission
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account id

App secrets (e.g. `DEEPL_API_KEY` and the VAPID key pair) are set per
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
public/         — PWA manifest, service worker, icons, favicon, _headers
worker/         — the Cloudflare Worker (API + static asset serving)
shared/         — API contracts shared between the app and the Worker
scripts/        — build/deploy helpers + icon generator (pure stdlib, no deps)
test/           — Vitest specs
wrangler.jsonc  — Worker config (assets + vars + env.staging)
```

# newslang
