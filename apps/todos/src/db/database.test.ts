import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase, resolvePartialId, resolveAssignedToAliases, assignedToAliasSet, lowerInClause, isLockExpired, lockExpiryCutoff, clearExpiredLocks, now, uuid, getDatabasePath } from "./database.js";
import { createTask, getTask, listTasks } from "./tasks.js";
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  delete process.env["HASNA_TODOS_DB_PATH"];
  delete process.env["TODOS_DB_SCOPE"];
});

describe("global database path", () => {
  it("uses the todos data root/todos.db when no global database exists", () => {
    closeDatabase();
    resetDatabase();
    delete process.env["TODOS_DB_PATH"];

    const originalHome = process.env["HOME"];
    const originalCwd = process.cwd();
    const tmp = join(tmpdir(), `todos-global-db-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const home = join(tmp, "home");
    const cwd = join(tmp, "workspace");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(cwd, ".git"), { recursive: true });

    try {
      process.env["HOME"] = home;
      process.chdir(cwd);

      const globalDb = getDatabase();
      globalDb.close();
      resetDatabase();

      expect(existsSync(join(todosDataRoot(home), "todos.db"))).toBe(true);
      expect(existsSync(join(home, ".todos", "todos.db"))).toBe(false);
    } finally {
      process.chdir(originalCwd);
      if (originalHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = originalHome;
      rmSync(tmp, { recursive: true, force: true });
      resetDatabase();
    }
  });

  it("uses the todos data root/todos.db even when a legacy ~/.todos/todos.db exists", () => {
    closeDatabase();
    resetDatabase();
    delete process.env["TODOS_DB_PATH"];

    const originalHome = process.env["HOME"];
    const originalCwd = process.cwd();
    const tmp = join(tmpdir(), `todos-legacy-global-db-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const home = join(tmp, "home");
    const cwd = join(tmp, "workspace");
    const legacyDir = join(home, ".todos");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(cwd, ".git"), { recursive: true });
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "todos.db"), "");

    try {
      process.env["HOME"] = home;
      process.chdir(cwd);

      const globalDb = getDatabase();
      globalDb.close();
      resetDatabase();

      expect(existsSync(join(todosDataRoot(home), "todos.db"))).toBe(true);
      expect(existsSync(join(home, ".todos", "todos.db"))).toBe(true);
    } finally {
      process.chdir(originalCwd);
      if (originalHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = originalHome;
      rmSync(tmp, { recursive: true, force: true });
      resetDatabase();
    }
  });

  it("uses the nearest project-relative todos store instead of the global database", () => {
    closeDatabase();
    resetDatabase();
    delete process.env["TODOS_DB_PATH"];

    const originalHome = process.env["HOME"];
    const originalCwd = process.cwd();
    const tmp = join(tmpdir(), `todos-project-db-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const home = join(tmp, "home");
    const project = join(tmp, "workspace", "project");
    const nested = join(project, "src");
    const projectDbDir = join(project, ".hasna", "todos");
    const projectDbPath = join(projectDbDir, "todos.db");
    mkdirSync(join(project, ".git"), { recursive: true });
    mkdirSync(nested, { recursive: true });
    mkdirSync(projectDbDir, { recursive: true });
    writeFileSync(projectDbPath, "");

    try {
      process.env["HOME"] = home;
      process.chdir(nested);

      const projectDb = getDatabase();
      projectDb.close();
      resetDatabase();

      expect(existsSync(projectDbPath)).toBe(true);
      expect(existsSync(join(home, ".hasna", "todos", "todos.db"))).toBe(false);
      expect(existsSync(join(project, ".todos", "todos.db"))).toBe(false);
    } finally {
      process.chdir(originalCwd);
      if (originalHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = originalHome;
      rmSync(tmp, { recursive: true, force: true });
      resetDatabase();
    }
  });

  it("does not create a project-scoped database for non-initialization calls", () => {
    closeDatabase();
    resetDatabase();
    delete process.env["TODOS_DB_PATH"];

    const originalHome = process.env["HOME"];
    const originalCwd = process.cwd();
    const tmp = join(tmpdir(), `todos-project-scope-db-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const home = join(tmp, "home");
    const project = join(tmp, "workspace", "project");
    const nested = join(project, "src");
    mkdirSync(join(project, ".git"), { recursive: true });
    mkdirSync(nested, { recursive: true });

    try {
      process.env["HOME"] = home;
      process.env["TODOS_DB_SCOPE"] = "project";
      process.chdir(nested);

      const projectDb = getDatabase();
      projectDb.close();
      resetDatabase();

      expect(existsSync(join(project, ".hasna", "todos", "todos.db"))).toBe(false);
      expect(existsSync(join(project, ".todos", "todos.db"))).toBe(false);
      expect(existsSync(join(todosDataRoot(home), "todos.db"))).toBe(true);
    } finally {
      process.chdir(originalCwd);
      if (originalHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = originalHome;
      delete process.env["TODOS_DB_SCOPE"];
      rmSync(tmp, { recursive: true, force: true });
      resetDatabase();
    }
  });

  it("reopens the database when project scope resolves to a different path", () => {
    closeDatabase();
    resetDatabase();
    delete process.env["TODOS_DB_PATH"];

    const originalHome = process.env["HOME"];
    const originalCwd = process.cwd();
    const tmp = join(tmpdir(), `todos-project-switch-db-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const home = join(tmp, "home");
    const projectA = join(tmp, "workspace", "project-a");
    const projectB = join(tmp, "workspace", "project-b");
    const nestedA = join(projectA, "src");
    const nestedB = join(projectB, "src");
    const projectDbA = join(projectA, ".hasna", "todos", "todos.db");
    const projectDbB = join(projectB, ".hasna", "todos", "todos.db");
    mkdirSync(join(projectA, ".git"), { recursive: true });
    mkdirSync(join(projectB, ".git"), { recursive: true });
    mkdirSync(nestedA, { recursive: true });
    mkdirSync(nestedB, { recursive: true });
    mkdirSync(join(projectA, ".hasna", "todos"), { recursive: true });
    mkdirSync(join(projectB, ".hasna", "todos"), { recursive: true });
    writeFileSync(projectDbA, "");
    writeFileSync(projectDbB, "");

    try {
      process.env["HOME"] = home;
      process.env["TODOS_DB_SCOPE"] = "project";

      process.chdir(nestedA);
      const pathA = getDatabasePath();
      createTask({ title: "Project A task" });
      expect(listTasks({}).map(task => task.title)).toEqual(["Project A task"]);

      process.chdir(nestedB);
      const pathB = getDatabasePath();
      expect(pathB).not.toBe(pathA);
      createTask({ title: "Project B task" });
      expect(listTasks({}).map(task => task.title)).toEqual(["Project B task"]);

      closeDatabase();
      process.env["TODOS_DB_PATH"] = pathA;
      delete process.env["TODOS_DB_SCOPE"];
      expect(listTasks({}).map(task => task.title)).toEqual(["Project A task"]);
    } finally {
      closeDatabase();
      process.chdir(originalCwd);
      if (originalHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = originalHome;
      delete process.env["TODOS_DB_PATH"];
      delete process.env["TODOS_DB_SCOPE"];
      rmSync(tmp, { recursive: true, force: true });
      resetDatabase();
    }
  }, 30000);
});

describe("resolvePartialId", () => {
  it("should match exact full UUID", () => {
    const task = createTask({ title: "Test task" }, db);
    const resolved = resolvePartialId(db, "tasks", task.id);
    expect(resolved).toBe(task.id);
  });

  it("should find unique match with 8-char prefix", () => {
    const task = createTask({ title: "Test task" }, db);
    const prefix = task.id.substring(0, 8);
    const resolved = resolvePartialId(db, "tasks", prefix);
    expect(resolved).toBe(task.id);
  });

  it("should return null for no match", () => {
    createTask({ title: "Test task" }, db);
    const resolved = resolvePartialId(db, "tasks", "aaaaaaaa");
    // Very unlikely to match a random UUID prefix
    // If by extreme chance it matches, we skip this assertion
    if (resolved !== null) {
      // Extremely unlikely but handle gracefully
      return;
    }
    expect(resolved).toBeNull();
  });

  it("should return null for non-existent full UUID", () => {
    const resolved = resolvePartialId(db, "tasks", "00000000-0000-0000-0000-000000000000");
    expect(resolved).toBeNull();
  });
});

describe("isLockExpired", () => {
  it("should return true for null locked_at", () => {
    expect(isLockExpired(null)).toBe(true);
  });

  it("should return true for old timestamp (>30 min ago)", () => {
    const oldTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    expect(isLockExpired(oldTime)).toBe(true);
  });

  it("should return false for recent timestamp (<30 min ago)", () => {
    const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(isLockExpired(recentTime)).toBe(false);
  });

  it("should return false for current timestamp", () => {
    expect(isLockExpired(new Date().toISOString())).toBe(false);
  });

  it("should return false for exactly 30 minutes ago (boundary)", () => {
    const fixedNow = new Date("2026-01-15T12:00:00.000Z").getTime();
    const exactBoundary = new Date(fixedNow - 30 * 60 * 1000).toISOString();
    expect(isLockExpired(exactBoundary, fixedNow)).toBe(false);
  });

  it("should return true just after the 30 minute boundary", () => {
    const fixedNow = new Date("2026-01-15T12:00:00.001Z").getTime();
    const exactBoundary = new Date("2026-01-15T11:30:00.000Z").toISOString();
    expect(isLockExpired(exactBoundary, fixedNow)).toBe(true);
  });
});

describe("lockExpiryCutoff", () => {
  it("should return a valid ISO string", () => {
    const cutoff = lockExpiryCutoff();
    const parsed = new Date(cutoff);
    expect(parsed.toISOString()).toBe(cutoff);
    expect(isNaN(parsed.getTime())).toBe(false);
  });

  it("should return a time 30 minutes before the given timestamp", () => {
    const fixedNow = new Date("2026-01-15T12:00:00.000Z").getTime();
    const cutoff = lockExpiryCutoff(fixedNow);
    const expected = new Date("2026-01-15T11:30:00.000Z").toISOString();
    expect(cutoff).toBe(expected);
  });

  it("should default to 30 minutes before current time", () => {
    const before = Date.now();
    const cutoff = lockExpiryCutoff();
    const after = Date.now();

    const cutoffMs = new Date(cutoff).getTime();
    const thirtyMinMs = 30 * 60 * 1000;

    // cutoff should be approximately (now - 30 min)
    expect(cutoffMs).toBeGreaterThanOrEqual(before - thirtyMinMs);
    expect(cutoffMs).toBeLessThanOrEqual(after - thirtyMinMs);
  });
});

describe("now", () => {
  it("should return a valid ISO string", () => {
    const result = now();
    const parsed = new Date(result);
    expect(isNaN(parsed.getTime())).toBe(false);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("should return current time (within 1 second tolerance)", () => {
    const before = Date.now();
    const result = now();
    const after = Date.now();
    const resultMs = new Date(result).getTime();
    expect(resultMs).toBeGreaterThanOrEqual(before - 1000);
    expect(resultMs).toBeLessThanOrEqual(after + 1000);
  });
});

describe("uuid", () => {
  it("should return a valid UUID format (36 chars with dashes)", () => {
    const id = uuid();
    expect(id).toHaveLength(36);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("should return unique values on each call", () => {
    const id1 = uuid();
    const id2 = uuid();
    const id3 = uuid();
    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });
});

describe("isLockExpired - additional", () => {
  it("should return false for recent lock (just now)", () => {
    expect(isLockExpired(new Date().toISOString())).toBe(false);
  });

  it("should return false for lock exactly at 29 minutes", () => {
    const recent = new Date(Date.now() - 29 * 60 * 1000).toISOString();
    expect(isLockExpired(recent)).toBe(false);
  });
});

describe("lockExpiryCutoff - additional", () => {
  it("should return ISO string 30 minutes in the past", () => {
    const cutoff = lockExpiryCutoff();
    const cutoffTime = new Date(cutoff).getTime();
    const expected = Date.now() - 30 * 60 * 1000;
    expect(Math.abs(cutoffTime - expected)).toBeLessThan(1000);
  });

  it("should accept custom now timestamp", () => {
    const customNow = Date.now() - 60 * 60 * 1000; // 1 hour ago
    const cutoff = lockExpiryCutoff(customNow);
    const cutoffTime = new Date(cutoff).getTime();
    const expected = customNow - 30 * 60 * 1000;
    expect(Math.abs(cutoffTime - expected)).toBeLessThan(1000);
  });
});

describe("clearExpiredLocks", () => {
  it("should clear locks older than 30 minutes", () => {
    const task = createTask({ title: "Locked task" }, db);
    const oldTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.run("UPDATE tasks SET locked_by = 'agent1', locked_at = ? WHERE id = ?", [oldTime, task.id]);

    clearExpiredLocks(db);

    const updated = getTask(task.id, db)!;
    expect(updated.locked_by).toBeNull();
    expect(updated.locked_at).toBeNull();
  });

  it("should not clear recent locks", () => {
    const task = createTask({ title: "Recent lock" }, db);
    const recentTime = new Date().toISOString();
    db.run("UPDATE tasks SET locked_by = 'agent1', locked_at = ? WHERE id = ?", [recentTime, task.id]);

    clearExpiredLocks(db);

    const updated = getTask(task.id, db)!;
    expect(updated.locked_by).toBe("agent1");
  });
});

describe("resolvePartialId - additional", () => {
  it("should return null for ambiguous partial match", () => {
    createTask({ title: "Task 1" }, db);
    createTask({ title: "Task 2" }, db);
    // Empty string with LIKE prefix would match all rows — should return null (ambiguous)
    const resolved = resolvePartialId(db, "tasks", "");
    expect(resolved).toBeNull();
  });

  it("should work with projects table", () => {
    const { createProject } = require("../db/projects.js");
    const project = createProject({ name: "Test", path: "/test/resolve-" + Date.now() }, db);
    const resolved = resolvePartialId(db, "projects", project.id.slice(0, 8));
    expect(resolved).toBe(project.id);
  });

  it("resolves an agent by NAME (regression: MCP assigned_to='<name>' threw UNKNOWN_ERROR)", () => {
    const { registerAgent } = require("../db/agents.js");
    const agent = registerAgent({ name: "gaius" }, db);
    // MCP create_task/list_tasks/update_task call resolveId(name, "agents").
    // Before the fix, resolvePartialId had no agents-by-name fallback, so a
    // name returned null -> resolveId threw -> UNKNOWN_ERROR.
    expect(resolvePartialId(db, "agents", "gaius")).toBe(agent.id);
    expect(resolvePartialId(db, "agents", "GAIUS")).toBe(agent.id); // case-insensitive
    expect(resolvePartialId(db, "agents", agent.id.slice(0, 8))).toBe(agent.id); // id prefix still works
  });
});

describe("resolveAssignedToAliases / assignedToAliasSet / lowerInClause (task 84c77210)", () => {
  // These moved here from db/task-crud.ts (PR #160) so every sibling
  // exact-match `assigned_to` call site can share ONE resolver instead of
  // re-deriving the logic. `tasks.test.ts` already covers the behaviour at
  // the `listTasks`/`countTasks` call sites (task 8f07bc15); this covers the
  // helper itself, and the JS-level `assignedToAliasSet` variant the
  // sibling sites (which filter in-memory rather than in SQL) need.
  it("resolves both directions: id -> [id, name], and name -> [id, name]", () => {
    const { registerAgent } = require("../db/agents.js");
    const agent = registerAgent({ name: "cinna" }, db);

    expect(resolveAssignedToAliases(db, agent.id).sort()).toEqual([agent.id, agent.name].sort());
    expect(resolveAssignedToAliases(db, agent.name).sort()).toEqual([agent.id, agent.name].sort());
    // A ref in a different case than the registered name still resolves the
    // agent (case-insensitive lookup), so the alias set carries BOTH the
    // literal input (still its original case) and the registered form.
    expect(resolveAssignedToAliases(db, "CINNA").sort()).toEqual([agent.id, agent.name, "CINNA"].sort());
  });

  it("falls back to literal-only for a ref matching zero agents (a nonsense identifier still returns nothing)", () => {
    const aliases = resolveAssignedToAliases(db, "zzz-no-such-agent");
    expect(aliases).toEqual(["zzz-no-such-agent"]);
    // And the alias SET built from it matches nothing but its own literal.
    const set = assignedToAliasSet(db, "zzz-no-such-agent");
    expect(set.has("zzz-no-such-agent")).toBe(true);
    expect(set.has("some-other-agent")).toBe(false);
  });

  it("degrades an ambiguous name (2+ registered rows, case-insensitive) to literal-only, matching the SQLite listTasks path", () => {
    const timestamp = new Date().toISOString();
    db.run(
      "INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      ["01d4cc12", "fabricius", timestamp, timestamp, "4d77b218", "Fabricius", timestamp, timestamp],
    );
    expect(() => resolveAssignedToAliases(db, "fabricius")).not.toThrow();
    expect(resolveAssignedToAliases(db, "fabricius")).toEqual(["fabricius"]);
  });

  it("assignedToAliasSet is lowercased, for case-insensitive in-memory filtering", () => {
    const { registerAgent } = require("../db/agents.js");
    const agent = registerAgent({ name: "Livia" }, db);
    const set = assignedToAliasSet(db, agent.id);
    expect(set.has(agent.id.toLowerCase())).toBe(true);
    expect(set.has("livia")).toBe(true); // registered name, lowercased
    expect(set.has("LIVIA")).toBe(false); // the set itself is lowercase; callers lowercase the probe
  });

  it("lowerInClause builds a case-insensitive IN(...) and pushes lowercased params", () => {
    const params: unknown[] = [];
    const clause = lowerInClause("assigned_to", ["Alpha", "BETA"], params);
    expect(clause).toBe("LOWER(assigned_to) IN (?,?)");
    expect(params).toEqual(["alpha", "beta"]);
  });

  it("lowerInClause on an empty alias list is an always-false clause, never an empty IN()", () => {
    const params: unknown[] = [];
    const clause = lowerInClause("assigned_to", [], params);
    expect(clause).toBe("1=0");
    expect(params).toEqual([]);
  });
});
