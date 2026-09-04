import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createTask, getTask } from "../db/tasks.js";
import { getTaskHistory } from "../db/audit.js";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

const REPO_ROOT = join(import.meta.dir, "../..");
const STALE_LOCK_VERSION = "2020-01-01T00:00:00.000Z";

let root = "";
let home = "";
let dbPath = "";
let db: Database;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "todos-stale-lock-handoff-cli-"));
  home = join(root, "home");
  mkdirSync(home);
  dbPath = join(root, "todos.db");
  resetDatabase();
  db = getDatabase(dbPath);
});

afterEach(() => {
  closeDatabase();
  rmSync(root, { recursive: true, force: true });
});

function seedLockedTask(title: string) {
  const task = createTask({ title }, db);
  db.run(
    "UPDATE tasks SET locked_by = ?, locked_at = ?, updated_at = ?, version = version + 1 WHERE id = ?",
    ["holder-a", STALE_LOCK_VERSION, STALE_LOCK_VERSION, task.id],
  );
  return task;
}

async function runCli(args: string[]) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: localRoutingTestEnv({
      HOME: home,
      HASNA_EVENTS_DIR: join(root, "events"),
      HASNA_TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function commandArgs(taskId: string): string[] {
  return [
    "--agent", "nausicaa",
    "stale-lock-handoff", taskId,
    "--expected-holder", "holder-a",
    "--expected-lock-version", STALE_LOCK_VERSION,
    "--stale-after-seconds", "3600",
    "--new-holder", "nausicaa",
    "--reason", "CLI exact stale lock",
  ];
}

describe("todos stale-lock-handoff", () => {
  test("--json uses the real local CLI path and returns the persisted audit receipt", async () => {
    const task = seedLockedTask("JSON CLI stale lock");
    const beforeHistory = getTaskHistory(task.id, db);

    const result = await runCli(["--json", ...commandArgs(task.id)]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('"event":"todos-local-fallback"'); // local-mode notice (incident 715712)
    const payload = JSON.parse(result.stdout) as {
      receipt: {
        receipt_id: string;
        task_id: string;
        new_holder: string;
        new_lock_version: string;
      };
    };
    expect(payload.receipt).toMatchObject({
      task_id: task.id,
      new_holder: "nausicaa",
    });
    expect(getTask(task.id, db)).toMatchObject({
      locked_by: "nausicaa",
      locked_at: payload.receipt.new_lock_version,
    });
    const history = getTaskHistory(task.id, db);
    expect(history).toHaveLength(beforeHistory.length + 1);
    expect(history.some((entry) => entry.id === payload.receipt.receipt_id)).toBe(true);
  });

  test("human output names the transfer, cutoff, receipt, and reason", async () => {
    const task = seedLockedTask("Human CLI stale lock");

    const result = await runCli(commandArgs(task.id));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('"event":"todos-local-fallback"'); // local-mode notice (incident 715712)
    expect(result.stdout).toContain(`Stale lock transferred on task ${task.id}.`);
    expect(result.stdout).toContain("holder-a @ 2020-01-01T00:00:00.000Z");
    expect(result.stdout).toContain("-> nausicaa @");
    expect(result.stdout).toContain("stale after 3600s (cutoff ");
    expect(result.stdout).toContain("receipt ");
    expect(result.stdout).toContain("reason CLI exact stale lock");
  });

  test("a short task prefix is rejected and the exact task remains untouched", async () => {
    const task = seedLockedTask("CLI exact id control");
    const before = getTask(task.id, db);
    const historyBefore = getTaskHistory(task.id, db);

    const result = await runCli(commandArgs(task.id.slice(0, 8)));
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("requires one exact full task UUID");
    expect(getTask(task.id, db)).toEqual(before);
    expect(getTaskHistory(task.id, db)).toEqual(historyBefore);
  });
});
