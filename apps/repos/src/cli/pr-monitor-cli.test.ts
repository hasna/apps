import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb } from "../db/database.js";
import { upsertRepo } from "../db/repos.js";

/**
 * pr-monitor CLI verb tests (T7; design sections 2.1-2.2 and the task gate
 * "--help smoke + --json shape"). The verb is exercised as a real
 * subprocess against an isolated registry DB; GitHub access is a fake `gh`
 * on PATH so no live API is touched.
 */

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const MAIN = "fedcba9876543210fedcba9876543210fedcba98";

let tempDir = "";
let binDir = "";
let dbPath = "";

function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.tsx", ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HASNA_REPOS_AUTO_BOOTSTRAP: "0",
      NO_COLOR: "1",
      HASNA_REPOS_DB_PATH: dbPath,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      ...extraEnv,
    },
  });
}

/** Fake gh: answers the comment batch and the current-main REST call. */
function writeFakeGh(opts: { failComments?: boolean; main?: string } = {}) {
  const main = opts.main ?? MAIN;
  writeFileSync(join(binDir, "gh"), `#!/usr/bin/env bash
if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  ${opts.failComments ? 'echo "GitHub CLI request failed exit=8" >&2; exit 8' : `cat <<'EOF'
{"data":{"repository":{"pr1":{"comments":{"nodes":[{"databaseId":7,"createdAt":"2026-08-18T10:00:00Z","author":{"login":"reviewer1"},"body":"[REVIEW] GO — hasna/apps#1 @ ${HEAD} — lens: correctness, reviewer reviewer1"}]}}}}}
EOF`}
  exit 0
fi
if [[ "$1" == "api" && "$2" == repos/* ]]; then
  echo "${main}"
  exit 0
fi
echo "unhandled gh call: $*" >&2
exit 2
`);
  chmodSync(join(binDir, "gh"), 0o755);
}

/** Seed the registry with one open hasna/apps PR (direct row insert, same shape bulkInsertPullRequests writes). */
function seedOpenPr() {
  getDb(dbPath);
  const repoId = upsertRepo({
    path: join(tempDir, "nowhere", "hasna-apps"),
    name: "apps",
    org: "hasna",
    remote_url: "github.com/hasna/apps",
  }).id;
  const db = getDb();
  db.query(
    `INSERT INTO pull_requests
      (repo_id, number, title, state, author, created_at, updated_at, merged_at, closed_at, url,
       base_branch, head_branch, additions, deletions, changed_files,
       head_sha, base_ref_oid, mergeable, merge_state_status, ci_state, ci_contexts_json,
       is_draft, review_decision, gh_owner, gh_repo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    repoId, 1, "fix the thing", "open", "andrei-hasna",
    "2026-08-18T09:00:00Z", "2026-08-18T09:30:00Z", null, null,
    "https://github.com/hasna/apps/pull/1",
    "main", "plan/pr-monitor", 10, 2, 3,
    HEAD, MAIN, "MERGEABLE", "CLEAN", "SUCCESS", "[]", 0, null, "hasna", "apps",
  );
  closeDb();
}

beforeEach(() => {
  tempDir = join(tmpdir(), `repos-cli-pr-monitor-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  binDir = join(tempDir, "bin");
  dbPath = join(tempDir, "repos.db");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(join(tempDir, "nowhere"), { recursive: true });
});

afterEach(() => {
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("repos pr-monitor CLI verb", () => {
  test("--help smoke: lists the verb and every option", () => {
    const result = runCli(["pr-monitor", "--help"]);
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    expect(result.exitCode, stderr).toBe(0);
    for (const token of [
      "pr-monitor",
      "--org",
      "--repo",
      "-n, --limit",
      "--no-sync",
      "--baseline",
      "--verbose",
      "--json",
    ]) {
      expect(stdout, `missing ${token}`).toContain(token);
    }
  });

  test("--json negative control: empty registry yields the zero-filled envelope, exit 0", () => {
    const result = runCli(["pr-monitor", "--no-sync", "--json"]);
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    expect(result.exitCode, stderr).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.schema).toBe("open-repos.pr-monitor.v1");
    expect(envelope.synced).toBeNull();
    expect(envelope.baseline).toBe(false);
    expect(envelope.summary.open).toBe(0);
    expect(envelope.summary.events).toBe(0);
    expect(envelope.events).toEqual([]);
    expect(envelope.state).toEqual([]);
    expect(envelope.errors).toEqual([]);
    expect(envelope.filters.limit).toBe(500);
  });

  test("--sync (the loop form) parses and fills the synced section", () => {
    // Regression: commander 13's combined "--sync, --no-sync" option makes
    // --sync behave as the negated flag (measured sync=false); the loop calls
    // `repos pr-monitor --sync --org hasna --json`, so --sync must work.
    const result = runCli(["pr-monitor", "--sync", "--org", "hasna", "--json"]);
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    expect(result.exitCode, stderr).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.synced).not.toBeNull();
    expect(envelope.synced.repos_seen).toBe(0);
    expect(envelope.filters.org).toBe("hasna");
  });

  test("--baseline --json records watch state without a NEW storm", () => {
    seedOpenPr();
    writeFakeGh();
    const result = runCli(["pr-monitor", "--no-sync", "--baseline", "--json"]);
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    expect(result.exitCode, stderr).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.baseline).toBe(true);
    expect(envelope.summary.open).toBe(1);
    expect(envelope.events).toEqual([]);
    expect(envelope.state[0].class).toBe("NEW");
  });

  test("full flow: NEW on first run, class on the second, nothing on the third (acceptance 4)", () => {
    seedOpenPr();
    writeFakeGh();

    const run1 = runCli(["pr-monitor", "--no-sync", "--json"]);
    const out1 = JSON.parse(new TextDecoder().decode(run1.stdout));
    expect(run1.exitCode).toBe(0);
    expect(out1.events).toHaveLength(1);
    expect(out1.events[0].class).toBe("NEW");
    expect(out1.events[0].id).toMatch(/^[0-9a-f]{16}$/);
    expect(out1.state[0]).toMatchObject({ owner: "hasna", repo: "apps", number: 1 });

    const run2 = runCli(["pr-monitor", "--no-sync", "--json"]);
    const out2 = JSON.parse(new TextDecoder().decode(run2.stdout));
    expect(run2.exitCode).toBe(0);
    expect(out2.events[0].class).toBe("READY_TO_MERGE");

    const run3 = runCli(["pr-monitor", "--no-sync", "--json"]);
    const out3 = JSON.parse(new TextDecoder().decode(run3.stdout));
    expect(run3.exitCode).toBe(0);
    expect(out3.events).toEqual([]);
  });

  test("comment-fetch failure exits non-zero with the error in the envelope", () => {
    seedOpenPr();
    writeFakeGh({ failComments: true });
    const result = runCli(["pr-monitor", "--no-sync", "--json"]);
    const stdout = new TextDecoder().decode(result.stdout);
    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(stdout);
    expect(envelope.errors.length).toBeGreaterThan(0);
    expect(envelope.errors.some((e: string) => e.includes("hasna/apps"))).toBe(true);
  });
});
