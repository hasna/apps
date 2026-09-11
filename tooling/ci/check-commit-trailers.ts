/**
 * Commit-trailer gate — repo law 6 (AGENTS.md): agent-made commits end with
 * `Agent: <registered-name>` and NEVER carry `Co-Authored-By`; git identity
 * is never overridden.
 *
 * Nothing enforced this (W9 audit 2026-09-11: no gate in tooling/ or
 * .github/ of any fleet repo reads a commit message), so a wave of PRs
 * picked up a forbidden trailer from an execution-rules file that
 * contradicted the law. This gate reads every NON-MERGE commit the PR (or
 * push) carries and refuses:
 *
 *   - a commit without an `Agent: <name>` trailer line;
 *   - a commit carrying any `Co-Authored-By:` line (any case).
 *
 * Merge commits are skipped (their message is git's, not an agent's). The
 * range is `<base>..HEAD`, resolved exactly like check-secrets.ts: the PR
 * base branch on pull_request, `github.event.before` on push. A base that
 * cannot be resolved exits 2 (could-not-scan) — never a vacuous pass.
 *
 * Usage:
 *   bun tooling/ci/check-commit-trailers.ts --base <ref>            # refuse (exit 1) on violations
 *   bun tooling/ci/check-commit-trailers.ts --base <ref> --report   # report-only (exit 0), the landing mode
 *   bun tooling/ci/check-commit-trailers.ts --self-test
 *
 * MODE: report-only at landing (2026-09-11 sprint rule: no new hard gate
 * mid-wave). Drop `--report` in ci.yml to make it refuse.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const AGENT_TRAILER = /^Agent:\s*[A-Za-z0-9][A-Za-z0-9._-]*\s*$/m;
const FORBIDDEN_TRAILER = /^\s*co-authored-by\s*:/im;

export interface TrailerViolation {
  sha: string;
  subject: string;
  problems: string[];
}

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { ok: res.status === 0, out: String(res.stdout ?? "") };
}

export function commitMessageProblems(message: string): string[] {
  const problems: string[] = [];
  if (!AGENT_TRAILER.test(message)) problems.push("missing `Agent: <registered-name>` trailer (repo law 6)");
  if (FORBIDDEN_TRAILER.test(message)) problems.push("carries a `Co-Authored-By:` line (forbidden by repo law 6 — remove it)");
  return problems;
}

/** Non-merge commits in base..HEAD with their problems; null when the range cannot be resolved. */
export function scanRange(cwd: string, base: string): TrailerViolation[] | null {
  const resolved = git(cwd, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  if (!resolved.ok) return null;
  const list = git(cwd, ["rev-list", "--no-merges", `${base}..HEAD`]);
  if (!list.ok) return null;
  const out: TrailerViolation[] = [];
  for (const sha of list.out.split("\n").map((s) => s.trim()).filter(Boolean)) {
    const msg = git(cwd, ["log", "-1", "--format=%B", sha]).out;
    const subject = msg.split("\n")[0] ?? "";
    const problems = commitMessageProblems(msg);
    if (problems.length > 0) out.push({ sha: sha.slice(0, 12), subject: subject.slice(0, 80), problems });
  }
  return out;
}

function run(base: string, reportOnly: boolean): number {
  const violations = scanRange(process.cwd(), base);
  if (violations === null) {
    console.error(`commit-trailer gate: could not resolve range ${base}..HEAD (exit 2 — could not scan, not a pass)`);
    return 2;
  }
  const count = git(process.cwd(), ["rev-list", "--no-merges", "--count", `${base}..HEAD`]).out.trim();
  if (violations.length === 0) {
    console.log(`commit-trailer gate: ${count} non-merge commit(s) in ${base}..HEAD, every one carries an Agent: trailer and none carries Co-Authored-By`);
    return 0;
  }
  const log = reportOnly ? console.log : console.error;
  log(`${reportOnly ? "COMMIT-TRAILER REPORT (report-only; not refused yet)" : "COMMIT-TRAILER VIOLATIONS"} (${violations.length} of ${count} commit(s)):`);
  for (const v of violations) {
    log(`  ${v.sha} ${v.subject}`);
    for (const p of v.problems) log(`      - ${p}`);
  }
  log(`  remedy: rewrite the commit message(s) so each ends with \`Agent: <registered-name>\` and carries no Co-Authored-By line (git commit --amend / rebase -i on YOUR branch; never override git identity). Squash-merge bodies inherit every commit message: fix them before merging.`);
  return reportOnly ? 0 : 1;
}

function selfTest(): number {
  let failed = false;
  const check = (name: string, ok: boolean) => {
    console.log(`  ${ok ? "PASS" : "FAIL"} — ${name}`);
    if (!ok) failed = true;
  };
  check("message with Agent trailer passes", commitMessageProblems("fix: x\n\nbody\n\nAgent: codex-lane-1").length === 0);
  check("message without Agent trailer fires", commitMessageProblems("fix: x\n\nbody\n").length === 1);
  check("Co-Authored-By fires even with an Agent trailer", commitMessageProblems("fix: x\n\nCo-Authored-By: Someone <s@example.com>\nAgent: a-b").length === 1);
  check("lower-case co-authored-by fires", commitMessageProblems("fix: x\n\nco-authored-by: x\n").length === 2);
  check("`Agent:` inside prose does not count as a trailer", commitMessageProblems("fix: x\n\nThe Agent: field is documented below\n").length === 1);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "commit-trailers-self-test-"));
  try {
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
    const g = (...args: string[]) => {
      const r = spawnSync("git", args, { cwd: tmp, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
      return r.stdout.trim();
    };
    g("init", "-q", "-b", "main");
    fs.writeFileSync(path.join(tmp, "a"), "1");
    g("add", "a");
    g("commit", "-q", "-m", "base\n\nAgent: base-lane");
    const base = g("rev-parse", "HEAD");
    fs.writeFileSync(path.join(tmp, "a"), "2");
    g("commit", "-q", "-am", "good change\n\nAgent: fixture-lane");
    fs.writeFileSync(path.join(tmp, "a"), "3");
    g("commit", "-q", "-am", "bad change\n\nCo-Authored-By: Bot <bot@example.com>");
    // A merge commit must be skipped.
    g("checkout", "-q", "-b", "side", base);
    fs.writeFileSync(path.join(tmp, "b"), "1");
    g("add", "b");
    g("commit", "-q", "-m", "side\n\nAgent: side-lane");
    g("checkout", "-q", "main");
    g("merge", "-q", "--no-ff", "-m", "Merge branch side", "side");
    const v = scanRange(tmp, base);
    check("range scan finds exactly the one bad non-merge commit", v !== null && v.length === 1 && v[0]!.subject === "bad change");
    check("merge commit is skipped", v !== null && !v.some((x) => x.subject.startsWith("Merge")));
    check("unresolvable base returns null (exit 2 path)", scanRange(tmp, "no-such-ref") === null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (failed) {
    console.error("self-test FAILED — the gate cannot be trusted");
    return 1;
  }
  console.log("self-test: PASS (can fire AND stay silent)");
  return 0;
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) process.exit(selfTest());
const baseIdx = args.indexOf("--base");
if (baseIdx < 0 || !args[baseIdx + 1]) {
  console.error("usage: bun tooling/ci/check-commit-trailers.ts --base <ref> | --self-test");
  process.exit(2);
}
process.exit(run(args[baseIdx + 1]!, args.includes("--report")));
