import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createTask, getTask, updateTask } from "./tasks.js";

/**
 * THE COLUMNS EXIST AND ARE INERT — this suite is what makes them live.
 *
 * `tasks.delegated_from` and `tasks.delegation_depth` have been in the schema
 * since migration 520-521, and `assigned_by` since 410. All three are readable,
 * indexed, and until now UNWRITABLE AFTER CREATION: `updateTask` had no branch
 * for any of them, so a PATCH carrying them returned a 200 and a version bump
 * while changing nothing.
 *
 * That is the worst available failure shape for `todos delegate`, whose whole
 * claim over `todos assign` is that it records WHO handed the row over and HOW
 * DEEP the chain is. A verb reporting success while writing none of that is
 * indistinguishable from the six-step pipeline it replaces.
 *
 * So every assertion here READS THE ROW BACK. None of them inspects a return
 * code, and each one fails on the pre-fix bytes.
 */

let db: Database;
let homeDir: string;
let prevHome: string | undefined;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  homeDir = mkdtempSync(join(tmpdir(), "todos-delegation-lineage-"));
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
  rmSync(homeDir, { recursive: true, force: true });
});

function seed(title = "a row filed earlier, dispatched later") {
  // The real shape delegate operates on: a task FILED by a seat and never
  // handed to anyone. Filing ran 13/14; dispatching ran 0/14.
  return createTask({ title, agent_id: "agent-ceo" }, db);
}

describe("updateTask writes the delegation lineage columns", () => {
  it("persists assigned_by — previously creation-only, so a handover could not be recorded", () => {
    const task = seed();
    // Creation stamps assigned_by from agent_id, so the pre-state is the FILER.
    expect(task.assigned_by).toBe("agent-ceo");

    updateTask(task.id, { assigned_by: "silvanus", version: task.version }, db);

    const stored = getTask(task.id, db);
    expect(stored?.assigned_by).toBe("silvanus");
  });

  it("persists delegated_from and delegation_depth", () => {
    const task = seed();
    expect(task.delegated_from).toBeNull();
    expect(task.delegation_depth).toBe(0);

    updateTask(
      task.id,
      { delegated_from: "agent-ceo", delegation_depth: 1, version: task.version },
      db,
    );

    const stored = getTask(task.id, db);
    expect(stored?.delegated_from).toBe("agent-ceo");
    expect(stored?.delegation_depth).toBe(1);
  });

  it("writes all three in ONE patch, which is the shape delegate actually sends", () => {
    const task = seed();
    updateTask(
      task.id,
      {
        assigned_to: "worker-alpha",
        assigned_by: "agent-ceo",
        delegated_from: "agent-ceo",
        delegation_depth: 2,
        version: task.version,
      },
      db,
    );

    const stored = getTask(task.id, db);
    expect(stored?.assigned_to).toBe("worker-alpha");
    expect(stored?.assigned_by).toBe("agent-ceo");
    expect(stored?.delegated_from).toBe("agent-ceo");
    expect(stored?.delegation_depth).toBe(2);
  });

  it("DOES NOT touch started_at — the property that keeps delegate's own failure rate countable", () => {
    // delegate writes assignment, not claim. If the worker never runs
    // `todos start`, started_at stays NULL and the row is visibly
    // dispatched-but-unclaimed past its deadline. A verb that stamped
    // started_at would launder its own failures into apparent progress.
    const task = seed();
    expect(task.started_at).toBeNull();

    updateTask(
      task.id,
      { assigned_to: "worker-alpha", assigned_by: "agent-ceo", delegation_depth: 1, version: task.version },
      db,
    );

    expect(getTask(task.id, db)?.started_at).toBeNull();
  });

  it("DOES NOT touch locked_by — claiming is the worker's act, not the dispatcher's", () => {
    const task = seed();
    updateTask(
      task.id,
      { assigned_to: "worker-alpha", delegated_from: "agent-ceo", version: task.version },
      db,
    );
    expect(getTask(task.id, db)?.locked_by).toBeNull();
  });

  it("leaves the columns alone when the patch omits them — an unconditional writer would pass the tests above", () => {
    const task = seed();
    updateTask(
      task.id,
      { assigned_by: "silvanus", delegated_from: "agent-ceo", delegation_depth: 3, version: task.version },
      db,
    );
    const afterFirst = getTask(task.id, db)!;

    // A patch about something else entirely must not reset the lineage.
    updateTask(afterFirst.id, { title: "retitled, nothing to do with lineage", version: afterFirst.version }, db);

    const stored = getTask(task.id, db);
    expect(stored?.title).toBe("retitled, nothing to do with lineage");
    expect(stored?.assigned_by).toBe("silvanus");
    expect(stored?.delegated_from).toBe("agent-ceo");
    expect(stored?.delegation_depth).toBe(3);
  });

  it("accepts depth 0 — a falsy value that an `if (value)` guard would silently drop", () => {
    const task = seed();
    updateTask(task.id, { delegation_depth: 5, version: task.version }, db);
    const raised = getTask(task.id, db)!;
    expect(raised.delegation_depth).toBe(5);

    updateTask(raised.id, { delegation_depth: 0, version: raised.version }, db);
    expect(getTask(task.id, db)?.delegation_depth).toBe(0);
  });

  it("accepts an explicit null delegated_from, so a mis-stamped chain can be detached", () => {
    const task = seed();
    updateTask(task.id, { delegated_from: "agent-ceo", version: task.version }, db);
    const stamped = getTask(task.id, db)!;
    expect(stamped.delegated_from).toBe("agent-ceo");

    updateTask(stamped.id, { delegated_from: null, version: stamped.version }, db);
    expect(getTask(task.id, db)?.delegated_from).toBeNull();
  });
});
