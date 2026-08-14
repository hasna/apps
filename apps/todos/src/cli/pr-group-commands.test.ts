import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/schema.js";
import { createLocalPrGroupLedger } from "../pr-groups/index.js";

let dir: string;
let dbPath: string;

function childEnv(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([, value]): value is string => value !== undefined),
  );
  delete env["HASNA_TODOS_API_URL"];
  delete env["HASNA_TODOS_API_KEY"];
  delete env["TODOS_API_URL"];
  delete env["TODOS_API_KEY"];
  env["HASNA_TODOS_STORAGE_MODE"] = "local";
  env["TODOS_STORAGE_MODE"] = "local";
  env["HASNA_TODOS_DB_PATH"] = dbPath;
  return env;
}

async function run(args: string[], env = childEnv()) {
  const child = Bun.spawn({
    cmd: [process.execPath, "run", "src/cli/index.tsx", ...args],
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pr-group-cli-"));
  dbPath = join(dir, "todos.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("PR-group CLI views", () => {
  test("prints bounded machine-readable current state and event history", async () => {
    const db = new Database(dbPath);
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db);
    const ledger = createLocalPrGroupLedger(db);
    const admitted = await ledger.admit({
      root_request_id: "request-root",
      repository: "hasna/todos",
      leaf_task_id: "leaf-task",
      dispatch_attempt: "dispatch-1",
      writer_generation: "generation-1",
      worktree: "/tmp/pr-group",
      branch: "feat/pr-group",
      pr_number: 78,
      base_sha: "a".repeat(40),
    });
    db.close();

    const show = await run(["plans", "pr-group", "show", admitted.view.group.id, "--json"]);
    expect(show.exitCode).toBe(0);
    expect(JSON.parse(show.stdout)).toMatchObject({
      authoritative: true,
      authority: "local",
      group: { id: admitted.view.group.id },
    });

    const events = await run([
      "plans",
      "pr-group",
      "events",
      admitted.view.group.id,
      "--limit",
      "1",
      "--json",
    ]);
    expect(events.exitCode).toBe(0);
    expect(JSON.parse(events.stdout)).toMatchObject({
      authoritative: true,
      count: 1,
      events: [{ event_type: "admission" }],
    });
  }, 15_000);

  test("remote failure exits explicitly and never creates shadow local state", async () => {
    const shadowPath = join(dir, "must-not-exist.db");
    const env = childEnv();
    env["HASNA_TODOS_STORAGE_MODE"] = "remote";
    env["TODOS_STORAGE_MODE"] = "remote";
    env["HASNA_TODOS_API_URL"] = "http://127.0.0.1:1";
    env["HASNA_TODOS_API_KEY"] = "opaque-test-key";
    env["HASNA_TODOS_DB_PATH"] = shadowPath;
    const result = await run(["plans", "pr-group", "show", "prg_missing", "--json"], env);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/local SQLite fallback is disabled/i);
    expect(existsSync(shadowPath)).toBe(false);
    // The `--json` error contract emits only the machine-readable error envelope
    // on stdout (never an authoritative view), so fail-closed behavior holds.
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: expect.stringMatching(/local SQLite fallback is disabled/i),
    });
  });

  test("malformed authoritative remote envelopes map to REMOTE_API_INCOMPATIBLE", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ view: { authoritative: true } }),
    });
    try {
      const shadowPath = join(dir, "malformed-must-not-exist.db");
      const env = childEnv();
      env["HASNA_TODOS_STORAGE_MODE"] = "remote";
      env["TODOS_STORAGE_MODE"] = "remote";
      env["HASNA_TODOS_API_URL"] = `http://127.0.0.1:${server.port}`;
      env["HASNA_TODOS_API_KEY"] = "opaque-test-key";
      env["HASNA_TODOS_DB_PATH"] = shadowPath;
      const result = await run(["plans", "pr-group", "show", "prg_malformed", "--json"], env);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("REMOTE_API_INCOMPATIBLE");
      expect(result.stderr).toMatch(/local SQLite fallback is disabled/i);
      expect(existsSync(shadowPath)).toBe(false);
      // The `--json` error contract emits only the machine-readable error envelope
      // on stdout (never an authoritative view), so fail-closed behavior holds.
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: expect.stringContaining("REMOTE_API_INCOMPATIBLE"),
      });
    } finally {
      server.stop(true);
    }
  });
});
