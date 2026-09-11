/**
 * Build every hosted member (tooling/fleet/hosted-apps.json `source: monorepo`
 * ∪ manifest-declared hosted members) for the `client-gates` CI job. The
 * client gates read BUILT `<name>` / `<name>-mcp` bins; the standard
 * `prepare:ordered` chain builds only the members with install-time ordering
 * constraints, so the rest must be built here first.
 *
 * One turbo invocation, `--concurrency=1`, `--continue`: turbo expands each
 * hosted member's `^build` dependencies (contracts, events, and for projects
 * the conversations/mementos/todos members it bundles) in topological order —
 * a per-member `bun run --filter <m> build` does not, and a member whose
 * build imports a sibling's dist would fail on a runner that never built it.
 * Serial on purpose: ci.yml documents that the 8–14 GB member builds must
 * never run in parallel inside one runner; `--continue` so a failing member
 * does not hide the others (every failure is reported, then exit 1).
 *
 * Measured 2026-09-11 on the pinned toolchain: 3–6 s per hosted member.
 *
 * Usage: bun tooling/ci/build-hosted-members.ts [--list]
 */
import { spawnSync } from "node:child_process";
import { APPS_DIR, REPO_ROOT } from "./tests/standard/census";
import { hostedMembersIn } from "./tests/standard/hosted";

const members = hostedMembersIn(APPS_DIR);
if (process.argv.includes("--list")) {
  console.log(members.join("\n"));
  process.exit(0);
}
const args = ["x", "turbo", "run", "build", "--concurrency=1", "--continue", ...members.map((m) => `--filter=@hasna/${m}`)];
console.log(`build-hosted-members: ${members.length} hosted members via ${process.execPath} ${args.join(" ")}`);
const started = Date.now();
const res = spawnSync(process.execPath, args, { cwd: REPO_ROOT, stdio: "inherit", env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1", TURBO_NO_UPDATE_NOTIFIER: "1" } });
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (res.status !== 0) {
  console.error(`build-hosted-members: turbo exited ${res.status} after ${seconds}s — at least one hosted member (or a dependency it bundles) failed to build; see the task output above`);
  process.exit(1);
}
console.log(`build-hosted-members: ${members.length}/${members.length} hosted members built in ${seconds}s`);
