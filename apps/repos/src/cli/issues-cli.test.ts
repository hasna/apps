import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb } from "../db/database.js";
import { upsertRepo } from "../db/repos.js";

/**
 * `repos issues` / `repos sync-issues` CLI tests.
 *
 * The verbs are exercised as real subprocesses against an isolated registry DB
 * with a fake `gh` on PATH, so no live GitHub call is made. These are the
 * end-to-end arms of the guard fixtures: the degraded run must not read as
 * "0 new", and the guards must hold through the CLI, not only in unit tests.
 */

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

const ISSUE_NODE = `{"number":7,"title":"fix the thing","state":"OPEN","stateReason":null,`
  + `"createdAt":"2026-09-10T00:00:00Z","updatedAt":"2026-09-10T00:00:00Z","closedAt":null,`
  + `"url":"https://github.com/hasna/apps/issues/7","author":{"login":"andrei-hasna"}}`;

const CLEAN_PAGE = `{"data":{"repository":{"issues":{"totalCount":1,`
  + `"pageInfo":{"hasNextPage":false,"endCursor":"c1"},"nodes":[${ISSUE_NODE}]}}}}`;

/** Real `gh api graphql` exits non-zero for an error-carrying body it still prints. */
const ERROR_PAGE = `{"data":{"repository":{"issues":{"totalCount":1,`
  + `"pageInfo":{"hasNextPage":true,"endCursor":"c1"},"nodes":[${ISSUE_NODE}]}}},`
  + `"errors":[{"message":"Something went wrong"}]}`;

function writeFakeGh(body: string, exitCode = 0) {
  writeFileSync(join(binDir, "gh"), `#!/usr/bin/env bash
cat <<'EOF'
${body}
EOF
exit ${exitCode}
`);
  chmodSync(join(binDir, "gh"), 0o755);
}

function seedRepo() {
  getDb(dbPath);
  upsertRepo({
    path: join(tempDir, "nowhere", "hasna-apps"),
    name: "apps",
    org: "hasna",
    remote_url: "github.com/hasna/apps",
  });
  closeDb();
}

beforeEach(() => {
  tempDir = join(tmpdir(), `repos-cli-issues-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  binDir = join(tempDir, "bin");
  dbPath = join(tempDir, "repos.db");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(join(tempDir, "nowhere"), { recursive: true });
});

afterEach(() => {
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("repos issues CLI verb", () => {
  test("--help smoke: lists the verb and every option", () => {
    const result = runCli(["issues", "--help"]);
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    expect(result.exitCode, stderr).toBe(0);
    for (const token of [
      "issues",
      "--repo",
      "--org",
      "--repo-name",
      "--state",
      "--author",
      "--duplicates",
      "-n, --limit",
      "--verbose",
      "--json",
    ]) {
      expect(stdout, `missing ${token}`).toContain(token);
    }
  });

  test("lists synced issues and de-duplicates by issue, not by checkout", () => {
    seedRepo();
    writeFakeGh(CLEAN_PAGE);
    closeDb();

    const synced = runCli(["sync-issues", "--repo", "apps", "--json"]);
    expect(synced.exitCode, new TextDecoder().decode(synced.stderr)).toBe(0);

    const listed = runCli(["issues", "--json"]);
    const stdout = new TextDecoder().decode(listed.stdout);
    expect(listed.exitCode, new TextDecoder().decode(listed.stderr)).toBe(0);
    const rows = JSON.parse(stdout);
    expect(rows).toHaveLength(1);
    expect(rows[0].number).toBe(7);
    expect(rows[0].state).toBe("open");
    expect(rows[0].org).toBe("hasna");
    expect(rows[0].repo).toBe("apps");
  });

  test("the first complete run is a baseline; a later quiet run may say 0 new", () => {
    seedRepo();
    writeFakeGh(CLEAN_PAGE);
    closeDb();

    const first = runCli(["sync-issues", "--repo", "apps"]);
    const firstOut = new TextDecoder().decode(first.stdout);
    expect(first.exitCode, new TextDecoder().decode(first.stderr)).toBe(0);
    expect(firstOut).toContain("baseline");
    expect(firstOut).not.toContain("0 new");

    const second = runCli(["sync-issues", "--repo", "apps"]);
    const secondOut = new TextDecoder().decode(second.stdout);
    expect(second.exitCode, new TextDecoder().decode(second.stderr)).toBe(0);
    expect(secondOut).toContain("0 new");
  });

  test("sync rejects filtered state before reading GitHub", () => {
    seedRepo();
    writeFakeGh(CLEAN_PAGE);
    closeDb();

    const result = runCli(["sync-issues", "--repo", "apps", "--state", "open", "--json"]);
    const stderr = new TextDecoder().decode(result.stderr);
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain("--state must be all");
  });

  test("a degraded run reports incomplete[] and never renders as 0 new", () => {
    seedRepo();
    writeFakeGh(ERROR_PAGE, 1);
    closeDb();

    const result = runCli(["sync-issues", "--repo", "apps", "--json"]);
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    // Degraded is an operator-visible failure, not a quiet success.
    expect(result.exitCode, stderr).toBe(1);
    const envelope = JSON.parse(stdout);
    expect(envelope.sealed).toBe(false);
    expect(envelope.watermark_advanced).toBe(false);
    expect(envelope.watermark).toBeNull();
    expect(envelope.incomplete).toHaveLength(1);
    expect(envelope.incomplete[0].repo).toBe("hasna/apps");
    expect(envelope.incomplete[0].reason).toBe("page_transient");

    const human = runCli(["sync-issues", "--repo", "apps"]);
    const humanOut = new TextDecoder().decode(human.stdout);
    expect(human.exitCode).toBe(1);
    expect(humanOut).toContain("degraded");
    expect(humanOut).not.toContain("0 new");
  });

  test("a rate-limited run stops and reports it without claiming a result", () => {
    seedRepo();
    writeFakeGh(`{"data":null,"errors":[{"message":"API rate limit exceeded for user ID 1."}]}`, 1);
    closeDb();

    const result = runCli(["sync-issues", "--org", "hasna"]);
    const stdout = new TextDecoder().decode(result.stdout);
    expect(result.exitCode).toBe(1);
    expect(stdout).toContain("degraded");
    expect(stdout).not.toContain("0 new");
  });
});
