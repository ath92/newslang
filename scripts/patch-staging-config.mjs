/**
 * Patches the Vite-generated dist/newslang/wrangler.json for staging deploys.
 *
 * The @cloudflare/vite-plugin generates a "redirected config" that explicitly
 * forbids wrangler environments, so `--env staging` is silently swallowed and
 * the deploy hits production.
 *
 * Instead this script strips the redirect metadata and overlays the staging
 * overrides from wrangler.jsonc onto the generated config, producing a standalone
 * staging wrangler config ready for `wrangler deploy --config ...`.
 *
 * Usage: node scripts/patch-staging-config.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const generatedPath = resolve(root, "dist", "newslang", "wrangler.json");
const generated = JSON.parse(readFileSync(generatedPath, "utf-8"));

// Strip redirect metadata fields — these mark the config as "redirected" and
// cause wrangler to reject environments. We're producing a standalone config.
delete generated.configPath;
delete generated.userConfigPath;
delete generated.topLevelName;
delete generated.definedEnvironments;
delete generated.legacy_env;

// ── Staging overrides (mirrors env.staging in wrangler.jsonc) ──────────
generated.name = "newslang-staging";
generated.workers_dev = true;
generated.vars = { ...(generated.vars ?? {}), APP_ENV: "staging" };

writeFileSync(generatedPath, JSON.stringify(generated, null, 2) + "\n");
console.log("✓ Patched dist/newslang/wrangler.json for staging deploy");
