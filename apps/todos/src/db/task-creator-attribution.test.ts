import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { ensureSchema, runMigrations } from "./schema.js";
import { createTask, getTask, listTasks, startTask, updateTask } from "./tasks.js";
import {
  clearPersistedIdentity,
  persistIdentity,
  readPersistedIdentity,
  resolveCreatorIdentity,
} from "../lib/creator-identity.js";

/**
 * Regression coverage for task authorship (todos task a98803b4).
 *
 * The defect: `todos add` recorded who a task was FOR and never who FILED it.
 * Measured live on the hosted API before the fix, `todos add "<title>"` returned
 * agent_id, assigned_to, assigned_by, session_id, machine_id and working_dir all
 * null — every attribution field empty — and there was no created_by field at all.
 *
 * These tests assert the STORED VALUE, not that a code path ran. Each one fails on
 * the pre-fix bytes: the created_by column, the not_created_by filter and the
 * creator-identity module do not exist there.
 */

let db: Database;
let homeDir: string;
let prevHome: string | undefined;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  // Isolate the persisted-identity file from the real ~/.hasna/todos.
  homeDir = mkdtempSync(join(tmpdir(), "todos-identity-test-"));
  prevHome = process.env["HOME"];
  process.env["HOME"] = homeDir;
  delete process.env["TODOS_AGENT_ID"];
  delete process.env["HASNA_TODOS_AGENT_ID"];
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  if (prevHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = prevHome;
  delete process.env["TODOS_AGENT_ID"];
  delete process.env["HASNA_TODOS_AGENT_ID"];
  rmSync(homeDir, { recursive: true, force: true });
});

describe("created_by — who FILED the task", () => {
  it("persists created_by on create", () => {
    const task = createTask({ title: "filed by cassius", created_by: "cassius" }, db);
    expect(task.created_by).toBe("cassius");
    expect(getTask(task.id, db)!.created_by).toBe("cassius");
  });

  it("falls back to agent_id when created_by is not given", () => {
    const task = createTask({ title: "legacy caller", agent_id: "brutus" }, db);
    expect(task.created_by).toBe("brutus");
  });

  it("prefers an explicit created_by over agent_id", () => {
    const task = createTask({ title: "explicit wins", agent_id: "brutus", created_by: "cassius" }, db);
    expect(task.created_by).toBe("cassius");
    expect(task.agent_id).toBe("brutus");
  });

  it("leaves created_by null when nothing identifies the caller — unattributable, not guessed", () => {
    const task = createTask({ title: "anonymous" }, db);
    expect(task.created_by).toBeNull();
  });
});

describe("created_by is write-once", () => {
  it("survives a claim — the claimer must not become the author", () => {
    const task = createTask({ title: "filed by one, worked by another", created_by: "cassius" }, db);
    startTask(task.id, "brutus", db);
    const after = getTask(task.id, db)!;
    expect(after.assigned_to).toBe("brutus");
    expect(after.created_by).toBe("cassius");
  });

  it("survives an update", () => {
    const task = createTask({ title: "before", created_by: "cassius" }, db);
    updateTask(task.id, { title: "after", version: task.version }, db);
    expect(getTask(task.id, db)!.created_by).toBe("cassius");
  });
});

describe("the inbox query operating rule 29 requires", () => {
  beforeEach(() => {
    // Work someone else routed to me — this is what an inbox should surface.
    createTask({ title: "routed to me by brutus", created_by: "brutus", assigned_to: "cassius" }, db);
    // My own filing, assigned to myself — this is the self-noise that mutes a monitor.
    createTask({ title: "my own note to self", created_by: "cassius", assigned_to: "cassius" }, db);
    // Someone else's work entirely.
    createTask({ title: "not mine at all", created_by: "brutus", assigned_to: "brutus" }, db);
  });

  it("answers 'assigned to me, filed by someone ELSE'", () => {
    const inbox = listTasks({ assigned_to: "cassius", not_created_by: "cassius" }, db);
    expect(inbox.map((t) => t.title)).toEqual(["routed to me by brutus"]);
  });

  it("still shows everything assigned to me without the filter — proving the filter is what excludes", () => {
    const all = listTasks({ assigned_to: "cassius" }, db);
    expect(all).toHaveLength(2);
  });

  it("filters by created_by", () => {
    expect(listTasks({ created_by: "brutus" }, db)).toHaveLength(2);
  });

  it("keeps rows whose created_by is NULL — unattributable is not the same claim as 'someone else'", () => {
    createTask({ title: "pre-fix row", assigned_to: "cassius" }, db);
    const inbox = listTasks({ assigned_to: "cassius", not_created_by: "cassius" }, db);
    expect(inbox.map((t) => t.title).sort()).toEqual(["pre-fix row", "routed to me by brutus"]);
  });
});

describe("ambient creator identity", () => {
  it("returns none when nothing is registered", () => {
    expect(resolveCreatorIdentity()).toEqual({ agent_id: null, source: "none" });
  });

  it("prefers an explicit value over everything else", () => {
    process.env["TODOS_AGENT_ID"] = "from-env";
    persistIdentity({ agent_id: "from-file" });
    expect(resolveCreatorIdentity("explicit")).toEqual({ agent_id: "explicit", source: "explicit" });
  });

  it("prefers the environment over the persisted file", () => {
    process.env["TODOS_AGENT_ID"] = "from-env";
    persistIdentity({ agent_id: "from-file" });
    expect(resolveCreatorIdentity()).toEqual({ agent_id: "from-env", source: "env" });
  });

  it("falls back to the identity `todos init` persisted", () => {
    persistIdentity({ agent_id: "uuid-from-file", agent_name: "Cassius" });
    // The NAME, not the UUID — the fleet populates assigned_to/agent_id with names,
    // so attributing to the UUID would produce a created_by nothing else matches.
    expect(resolveCreatorIdentity()).toEqual({ agent_id: "Cassius", source: "persisted" });
    expect(readPersistedIdentity()?.agent_id).toBe("uuid-from-file");
  });

  it("uses the id when init recorded no name", () => {
    persistIdentity({ agent_id: "uuid-only" });
    expect(resolveCreatorIdentity()).toEqual({ agent_id: "uuid-only", source: "persisted" });
  });

  it("clears the persisted identity on release", () => {
    persistIdentity({ agent_id: "from-file" });
    expect(clearPersistedIdentity()).toBe(true);
    expect(resolveCreatorIdentity().agent_id).toBeNull();
  });

  it("ignores a blank or malformed identity file rather than attributing to an empty string", () => {
    mkdirSync(join(homeDir, ".hasna", "todos"), { recursive: true });
    writeFileSync(join(homeDir, ".hasna", "todos", "identity.json"), '{"agent_id":"   "}');
    expect(resolveCreatorIdentity().agent_id).toBeNull();
  });
});

describe("upgrading a database that predates created_by", () => {
  it("adds the column back to an existing store without disturbing the rows in it", () => {
    // Build the real modern schema, then remove created_by to reproduce exactly what
    // a database written by the previous release looks like. Simulating with a
    // hand-rolled minimal table instead would test a schema we never shipped.
    const legacy = new Database(":memory:");
    runMigrations(legacy);
    // The indexes reference the column, so they go first — same order the column
    // was introduced in, reversed.
    legacy.exec("DROP INDEX IF EXISTS idx_tasks_created_by");
    legacy.exec("DROP INDEX IF EXISTS idx_tasks_assigned_created");
    legacy.exec("ALTER TABLE tasks DROP COLUMN created_by");

    const columnNames = (db_: Database) =>
      (db_.query("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(columnNames(legacy)).not.toContain("created_by");

    legacy.run("INSERT INTO tasks (id, title, status, priority) VALUES (?, ?, 'pending', 'medium')", [
      "legacy-1",
      "filed before the column existed",
    ]);

    ensureSchema(legacy);

    expect(columnNames(legacy)).toContain("created_by");
    // The pre-existing row survives and stays honestly unattributed rather than
    // being backfilled with a guess — the data to attribute it does not exist.
    const row = legacy.query("SELECT title, created_by FROM tasks WHERE id = ?").get("legacy-1") as
      { title: string; created_by: string | null };
    expect(row.title).toBe("filed before the column existed");
    expect(row.created_by).toBeNull();

    // And the upgraded store accepts an attributed write.
    const fresh = createTask({ title: "filed after the upgrade", created_by: "cassius" }, legacy);
    expect(fresh.created_by).toBe("cassius");
    legacy.close();
  });
});
