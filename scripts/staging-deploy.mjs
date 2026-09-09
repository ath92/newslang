// Trigger a staging deploy of the current branch through GitHub Actions (never a
// local `wrangler deploy`, which can't see the Cloudflare credentials staging runs
// under). Warns about uncommitted changes, then two interactive steps:
//   1. If the branch isn't fully pushed, ask before pushing.
//   2. Ask before dispatching the "Deploy to Staging" workflow for this branch via the gh CLI.
// Pure stdlib (no deps). Usage: pnpm deploy:staging:gh
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const run = (file, args) =>
  execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const runLive = (file, args) => execFileSync(file, args, { stdio: "inherit" });

const rl = createInterface({ input: stdin, output: stdout });

async function confirm(question) {
  const answer = (await rl.question(question)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

function die(message) {
  console.error(message);
  process.exit(1);
}

const dirty = run("git", ["status", "--porcelain"])
  .split("\n")
  .filter(Boolean);
if (dirty.length > 0) {
  console.warn(
    `⚠  ${dirty.length} uncommitted change${dirty.length === 1 ? "" : "s"} — these will NOT be deployed:`,
  );
  for (const line of dirty.slice(0, 20)) console.warn(`   ${line}`);
}

const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);

let upstream = "";
try {
  upstream = run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
} catch {
  // No upstream yet.
}

let ahead = 0;
if (upstream) {
  const [, a] = run("git", ["rev-list", "--left-right", "--count", "@{u}...HEAD"])
    .split(/\s+/)
    .map(Number);
  ahead = a || 0;
}

if (!upstream || ahead > 0) {
  const detail = !upstream
    ? `"${branch}" has no upstream yet`
    : `${ahead} commit${ahead === 1 ? "" : "s"} unpushed on "${branch}"`;
  const ok = await confirm(`${detail}. Push to origin now? [y/N] `);
  if (!ok) {
    rl.close();
    die("Aborted — nothing pushed, nothing deployed.");
  }
  if (upstream) runLive("git", ["push"]);
  else runLive("git", ["push", "-u", "origin", branch]);
} else {
  console.log(`"${branch}" is up to date with ${upstream}.`);
}

const ok = await confirm(`Trigger a staging deploy of "${branch}" via GitHub Actions? [y/N] `);
rl.close();
if (!ok) {
  console.log("Aborted — not deployed.");
  process.exit(0);
}

runLive("gh", ["workflow", "run", "Deploy to Staging", "-f", `ref=${branch}`]);
console.log(`Staging deploy triggered for "${branch}".`);
console.log("Follow it with:  gh run watch");
