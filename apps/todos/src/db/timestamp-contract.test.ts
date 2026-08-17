/**
 * REGRESSION: the terminal-status timestamp contract on the SQLite lane.
 *
 * Measured on the fleet 2026-08-17 (export of 63,603 rows): 1,569 completed
 * tasks carried a NULL `completed_at` and 123 failed tasks carried NULL
 * `started_at` AND NULL `completed_at`. Recency-based reads (todos recap,
 * standup — "what happened in the last N hours") filter on
 * `completed_at > since`, so a row with a NULL `completed_at` is NOT datable
 * and silently drops out of activity surfaces.
 *
 * Two write paths could mint an undatable terminal row:
 *
 *  1. `updateTask` (the generic PATCH / `todos update --status <terminal>`
 *     path) stamped `completed_at` ONLY for the "completed" status — a task
 *     driven to "failed" or "cancelled" through the generic path left the
 *     column NULL, and a task driven to "in_progress" without `startTask`
 *     left `started_at` NULL.
 *  2. `failTask` (the dedicated fail verb) never wrote `completed_at`.
 *
 * The contract under test: reaching a TERMINAL status stamps the end
 * timestamp when none exists (never clobbering an existing one), and
 * reaching "in_progress" stamps `started_at` when none exists. Assignment
 * alone MUST NOT stamp `started_at` — that property keeps a delegated row
 * visibly dispatched-but-unclaimed (delegation-lineage semantics).
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase, now } from "./database.js";
import { createTask, getTask, updateTask } from "./task-crud.js";
import { startTask, completeTask, failTask } from "./task-lifecycle.js";

// Pre-warm: pay the one-time fresh-DB migration cost OUTSIDE the per-test
// timeout window. Bun's default per-test timeout (5s) is smaller than a cold
// migration of a fresh temp database on this machine, and the first
// beforeEach would otherwise time out. Re-opens afterwards are fast because
// runMigrations short-circuits on the already-applied user_version.
resetDatabase();
getDatabase();
closeDatabase();

describe("timestamp contract — updateTask status transitions (SQLite)", () => {
  let db: ReturnType<typeof getDatabase>;

  beforeEach(() => {
    resetDatabase();
    db = getDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  it("stamps started_at when status becomes in_progress and none exists", () => {
    const task = createTask({ title: "To be started via update" }, db);
    expect(task.started_at).toBeNull();

    const updated = updateTask(task.id, { version: task.version, status: "in_progress" }, db);

    expect(updated.status).toBe("in_progress");
    expect(updated.started_at).toBeTruthy();
    // Read back from the row, not just the returned object.
    expect(getTask(task.id, db)?.started_at).toBeTruthy();
  });

  it("does NOT clobber an existing started_at on a later in_progress update", () => {
    const task = createTask({ title: "Already started" }, db);
    startTask(task.id, "holder-a", db);
    const startedAt = getTask(task.id, db)?.started_at;
    expect(startedAt).toBeTruthy();

    const fresh = getTask(task.id, db)!;
    const updated = updateTask(fresh.id, { version: fresh.version, status: "in_progress" }, db);

    expect(updated.started_at).toBe(startedAt);
    expect(getTask(task.id, db)?.started_at).toBe(startedAt);
  });

  it("does NOT stamp started_at on an assignment-only update (delegation semantics)", () => {
    const task = createTask({ title: "Delegated, not claimed" }, db);

    updateTask(
      task.id,
      { version: task.version, assigned_to: "worker-alpha" },
      db,
    );

    expect(getTask(task.id, db)?.started_at).toBeNull();
  });

  it("stamps completed_at when status becomes failed and none exists", () => {
    const task = createTask({ title: "Doomed via generic update" }, db);

    const updated = updateTask(task.id, { version: task.version, status: "failed" }, db);

    expect(updated.status).toBe("failed");
    expect(updated.completed_at).toBeTruthy();
    expect(getTask(task.id, db)?.completed_at).toBeTruthy();
  });

  it("stamps completed_at when status becomes cancelled and none exists", () => {
    const task = createTask({ title: "Cancelled via generic update" }, db);

    const updated = updateTask(task.id, { version: task.version, status: "cancelled" }, db);

    expect(updated.status).toBe("cancelled");
    expect(updated.completed_at).toBeTruthy();
    expect(getTask(task.id, db)?.completed_at).toBeTruthy();
  });

  it("does NOT clobber an existing completed_at when a completed row is failed", () => {
    const task = createTask({ title: "Completed then failed" }, db);
    const completed = completeTask(task.id, "holder-a", db);
    const completedAt = completed.completed_at;
    expect(completedAt).toBeTruthy();

    // Reopen to a non-terminal status, which clears the stale completion clock,
    // then fail. The end timestamp is the failure moment — non-null either way.
    const reopened = getTask(task.id, db)!;
    updateTask(reopened.id, { version: reopened.version, status: "in_progress" }, db);
    const afterReopen = getTask(task.id, db)!;
    expect(afterReopen.completed_at).toBeNull();

    const failed = updateTask(afterReopen.id, { version: afterReopen.version, status: "failed" }, db);
    expect(failed.completed_at).toBeTruthy();
    expect(getTask(task.id, db)?.completed_at).toBeTruthy();
  });

  it("stamps completed_at when a row failed via failTask has none", () => {
    const task = createTask({ title: "Doomed via fail verb" }, db);
    expect(task.started_at).toBeNull();

    const result = failTask(task.id, "holder-a", "real failure", undefined, db);

    expect(result.task.status).toBe("failed");
    expect(result.task.completed_at).toBeTruthy();
    expect(getTask(task.id, db)?.completed_at).toBeTruthy();
  });

  it("failTask does NOT clobber an existing completed_at", () => {
    const task = createTask({ title: "Was completed, then reopened, then failed" }, db);
    const completed = completeTask(task.id, "holder-a", db);
    expect(completed.completed_at).toBeTruthy();

    const reopened = getTask(task.id, db)!;
    updateTask(reopened.id, { version: reopened.version, status: "pending" }, db);
    expect(getTask(task.id, db)?.completed_at).toBeNull();

    const result = failTask(task.id, "holder-a", "after reopen", undefined, db);
    expect(result.task.completed_at).toBeTruthy();
    expect(getTask(task.id, db)?.completed_at).toBeTruthy();
  });

  it("leaves completed_at NULL on a NON-terminal status change (negative control)", () => {
    const task = createTask({ title: "Still open" }, db);

    const updated = updateTask(
      task.id,
      { version: task.version, status: "pending", priority: "high" },
      db,
    );

    expect(updated.completed_at).toBeNull();
    expect(getTask(task.id, db)?.completed_at).toBeNull();
  });

  it("the recap read can date a task failed through the generic path", () => {
    const { getRecap } = require("./audit.js") as typeof import("./audit.js");
    const task = createTask({ title: "Recently failed" }, db);
    updateTask(task.id, { version: task.version, status: "failed" }, db);

    // The contract: after the terminal transition the row carries a datable
    // end timestamp near `now`, so a recency read CAN date it. (Recap itself
    // lists completed rows; failed rows are dated by the same column.)
    const stored = getTask(task.id, db)!;
    const windowStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(stored.completed_at).toBeTruthy();
    expect(stored.completed_at! >= windowStart).toBe(true);
    expect(stored.completed_at! <= now()).toBe(true);

    // The failed row stays out of the completed bucket (recap distinguishes
    // by status) while remaining datable for any read that wants it.
    const recap = getRecap(8, undefined, db);
    expect(recap.completed.map((t) => t.id)).not.toContain(task.id);
  });
});
