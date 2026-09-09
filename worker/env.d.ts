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
  /** Placeholder auth secret (set via `wrangler secret put`); unused for now. */
  JWT_SECRET?: string;
}
