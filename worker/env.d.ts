/**
 * Augments the generated Env interface (worker-configuration.d.ts, produced by
 * `pnpm cf-typegen`) with bindings and secrets that aren't declared in
 * wrangler.jsonc. Keeping them here lets the Worker type-check even before the
 * generated file exists.
 */

interface Env {
  /** Optional runtime label; `development` enables local-only helpers. */
  APP_ENV?: string;
  /** Static assets binding, auto-populated by @cloudflare/vite-plugin. */
  ASSETS: Fetcher;
  /** DeepL API key (set via `wrangler secret put DEEPL_API_KEY`). */
  DEEPL_API_KEY?: string;
  /** Web Push VAPID public key, URL-safe base64 (set via `wrangler secret put`). */
  VAPID_PUBLIC_KEY?: string;
  /** Web Push VAPID private key, URL-safe base64 (set via `wrangler secret put`). */
  VAPID_PRIVATE_KEY?: string;
  /** VAPID contact URI, e.g. `mailto:you@example.com`. */
  VAPID_SUBJECT?: string;
}
