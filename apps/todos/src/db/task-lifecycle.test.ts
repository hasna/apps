import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import {
  createTask,
  getTask,
  listTasks,
  countTasks,
  updateTask,
  startTask,
  completeTask,
  failTask,
  claimNextTask,
  setTaskStatus,
  upsertTaskByFingerprint,
  getTaskByFingerprint,
} from "./tasks.js";
import { VersionConflictError } from "../types/index.js";

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("completeTask — version correctness (H2)", () => {
  it("returns the true post-commit version (no evidence => +1)", () => {
    const t = createTask({ title: "v" }, db);
    startTask(t.id, "agent", db); // version -> 2
    const started = getTask(t.id, db)!;
    const done = completeTask(t.id, "agent", db);
    const fresh = getTask(t.id, db)!;
    expect(done.version).toBe(fresh.version);
    expect(done.version).toBe(started.version + 1);
  });

  it("returns the true post-commit version when metadata is written (+2)", () => {
    const t = createTask({ title: "v2" }, db);
    startTask(t.id, "agent", db);
    const started = getTask(t.id, db)!;
    const done = completeTask(t.id, "agent", db, { notes: "did work", confidence: 0.9 });
    const fresh = getTask(t.id, db)!;
    expect(done.version).toBe(fresh.version);
    expect(done.version).toBe(started.version + 2);
  });

  it("the returned task can be used for a subsequent updateTask without VersionConflictError", () => {
    const t = createTask({ title: "chain" }, db);
    startTask(t.id, "agent", db);
    const done = completeTask(t.id, "agent", db, { notes: "x" });
    // Previously done.version was stale (task.version+1) while the DB was +2,
    // so this updateTask threw VersionConflictError.
    expect(() => updateTask(t.id, { version: done.version, priority: "high" }, db)).not.toThrow();
  });
});

describe("completeTask — idempotency (H3)", () => {
  it("does not spawn a duplicate recurrence when completed twice", () => {
    const t = createTask({ title: "recurring", recurrence_rule: "every day" }, db);
    startTask(t.id, "agent", db);
    completeTask(t.id, "agent", db);
    const afterFirst = listTasks({ has_recurrence: true }, db).length;
    // Re-complete the already-completed task.
    const second = completeTask(t.id, "agent", db);
    const afterSecond = listTasks({ has_recurrence: true }, db).length;
    expect(second.status).toBe("completed");
    expect(afterSecond).toBe(afterFirst); // no new occurrence spawned
  });

  it("refuses to complete a cancelled task", () => {
    const t = createTask({ title: "c" }, db);
    setTaskStatus(t.id, "cancelled", undefined, db);
    expect(() => completeTask(t.id, "agent", db)).toThrow(/cancelled/);
  });
});

describe("completeTask — confidence preservation (M2)", () => {
  it("does not wipe a previously stored confidence when none is passed", () => {
    const t = createTask({ title: "conf", confidence: 0.7 }, db);
    startTask(t.id, "agent", db);
    const done = completeTask(t.id, "agent", db); // no confidence in options
    expect(done.confidence).toBe(0.7);
    expect(getTask(t.id, db)!.confidence).toBe(0.7);
  });

  it("still overrides confidence when explicitly passed", () => {
    const t = createTask({ title: "conf2", confidence: 0.7 }, db);
    startTask(t.id, "agent", db);
    const done = completeTask(t.id, "agent", db, { confidence: 0.1 });
    expect(done.confidence).toBe(0.1);
  });
});

describe("completeTask/failTask — optimistic guard (M4)", () => {
  it("completeTask leaves version consistent so stale writers are rejected", () => {
    const t = createTask({ title: "race" }, db);
    startTask(t.id, "agent", db);
    const staleVersion = getTask(t.id, db)!.version;
    const done = completeTask(t.id, "agent", db, { notes: "x" }); // hasMeta => +2
    // Optimistic locking is intact end-to-end: a writer holding the pre-complete
    // version is rejected, while the version returned by completeTask is accepted.
    expect(() => updateTask(t.id, { version: staleVersion, priority: "low" }, db)).toThrow(VersionConflictError);
    expect(done.version).toBe(getTask(t.id, db)!.version);
  });

  it("failTask writes atomically and advances version", () => {
    const t = createTask({ title: "fail" }, db);
    startTask(t.id, "agent", db);
    const before = getTask(t.id, db)!;
    const { task } = failTask(t.id, "agent", "boom", undefined, db);
    const fresh = getTask(t.id, db)!;
    expect(task.status).toBe("failed");
    expect(task.version).toBe(fresh.version);
    expect(task.version).toBe(before.version + 1);
    expect(task.locked_by).toBeNull();
  });
});

describe("claimNextTask — contention (M7)", () => {
  it("two agents claiming concurrently never get the same task", () => {
    const a = createTask({ title: "A", priority: "high" }, db);
    const b = createTask({ title: "B", priority: "high" }, db);
    const first = claimNextTask("agent1", undefined, db);
    const second = claimNextTask("agent2", undefined, db);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first!.id).not.toBe(second!.id);
    const ids = new Set([a.id, b.id]);
    expect(ids.has(first!.id)).toBe(true);
    expect(ids.has(second!.id)).toBe(true);
  });

  it("returns null when nothing is claimable", () => {
    expect(claimNextTask("agent", undefined, db)).toBeNull();
  });
});

describe("setTaskStatus completed routes through lifecycle (M1)", () => {
  it("spawns the next recurrence and clears the lock", () => {
    const t = createTask({ title: "daily", recurrence_rule: "every day" }, db);
    startTask(t.id, "agent", db);
    const before = listTasks({ has_recurrence: true }, db).length;
    const done = setTaskStatus(t.id, "completed", "agent", db);
    const after = listTasks({ has_recurrence: true }, db).length;
    expect(done.status).toBe("completed");
    expect(done.locked_by).toBeNull();
    expect(after).toBe(before + 1); // recurrence chain continued
  });
});

describe("updateTask completion continues recurrence (M1 — dashboard PATCH / CLI update path)", () => {
  it("spawns exactly one child when completing a recurring task via updateTask, none on re-save", () => {
    // This is the exact call the dashboard PATCH (routes.ts) and CLI
    // `update --status completed` make — completeTask is NOT involved.
    const t = createTask({ title: "daily", recurrence_rule: "every day" }, db);
    const before = listTasks({ has_recurrence: true }, db).length; // the original
    const done = updateTask(t.id, { version: t.version, status: "completed" }, db);
    const afterFirst = listTasks({ has_recurrence: true }, db).length;
    expect(done.status).toBe("completed");
    expect(afterFirst).toBe(before + 1); // exactly one child spawned

    // Re-PATCH the already-completed task → idempotent, no additional child.
    const done2 = updateTask(t.id, { version: done.version, status: "completed" }, db);
    const afterSecond = listTasks({ has_recurrence: true }, db).length;
    expect(done2.status).toBe("completed");
    expect(afterSecond).toBe(afterFirst); // 0 additional
  });

  it("does not double-spawn: setTaskStatus(completed) routes to completeTask only", () => {
    const t = createTask({ title: "d2", recurrence_rule: "every day" }, db);
    const before = listTasks({ has_recurrence: true }, db).length;
    setTaskStatus(t.id, "completed", "agent", db);
    const after = listTasks({ has_recurrence: true }, db).length;
    expect(after).toBe(before + 1); // exactly one, not two
  });

  it("a malformed recurrence_rule does not throw after the status is committed (defensive #3)", () => {
    const t = createTask({ title: "bad", recurrence_rule: "definitely not a valid rule zzz" }, db);
    let done!: ReturnType<typeof updateTask>;
    expect(() => { done = updateTask(t.id, { version: t.version, status: "completed" }, db); }).not.toThrow();
    expect(done.status).toBe("completed");
    expect(getTask(t.id, db)!.status).toBe("completed");
  });
});

describe("updateTask reopen clears completed_at (M3)", () => {
  it("clears completed_at when transitioning away from completed", () => {
    const t = createTask({ title: "reopen" }, db);
    startTask(t.id, "agent", db);
    const done = completeTask(t.id, "agent", db);
    expect(getTask(t.id, db)!.completed_at).toBeTruthy();
    const reopened = updateTask(t.id, { version: done.version, status: "pending" }, db);
    expect(reopened.completed_at).toBeNull();
    expect(getTask(t.id, db)!.completed_at).toBeNull();
  });
});

describe("upsertTaskByFingerprint — dedupe incl. archived (M9)", () => {
  it("updates the existing archived task instead of creating a duplicate", () => {
    const created = upsertTaskByFingerprint({ title: "fp", fingerprint: "abc" }, db);
    expect(created.created).toBe(true);
    // Archive it.
    db.run("UPDATE tasks SET archived_at = ? WHERE id = ?", [new Date().toISOString(), created.task.id]);
    // getTaskByFingerprint must still find it (includes archived).
    expect(getTaskByFingerprint("abc", db)?.id).toBe(created.task.id);
    const again = upsertTaskByFingerprint({ title: "fp2", fingerprint: "abc" }, db);
    expect(again.created).toBe(false);
    expect(again.task.id).toBe(created.task.id);
  });
});

describe("countTasks mirrors listTasks filters (M10)", () => {
  it("honours task_type and has_recurrence", () => {
    createTask({ title: "r", recurrence_rule: "every day" }, db);
    createTask({ title: "n" }, db);
    createTask({ title: "typed", task_type: "review" }, db);
    expect(countTasks({ has_recurrence: true }, db)).toBe(listTasks({ has_recurrence: true }, db).length);
    expect(countTasks({ has_recurrence: false }, db)).toBe(listTasks({ has_recurrence: false }, db).length);
    expect(countTasks({ task_type: "review" }, db)).toBe(1);
  });
});

describe("listTasks pagination is stable (L1)", () => {
  it("orders by id within equal (priority, created_at) so pages don't overlap", () => {
    // Same priority; created_at may collide at ms resolution.
    for (let i = 0; i < 10; i++) createTask({ title: `p${i}`, priority: "medium" }, db);
    const all = listTasks({}, db).map(t => t.id);
    const unique = new Set(all);
    expect(unique.size).toBe(all.length);
    // Second listing is deterministic.
    const again = listTasks({}, db).map(t => t.id);
    expect(again).toEqual(all);
  });
});
