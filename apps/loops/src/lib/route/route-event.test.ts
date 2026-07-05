import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbPath } from "../paths.js";
import type { TodosTaskRouteOptions } from "./types.js";
import { routeTodosTaskEvent } from "./route-event.js";

// Regression coverage for the drain wedge: a task-lifecycle work item whose todos
// task is still pending must be re-admitted by the next drain (created > 0), not
// deduped forever. Before the fix a run that finished (succeeded/failed/dead_letter)
// without closing its task permanently ejected the work item via
// UNCLEARED_ROUTE_WORK_ITEM_STATUSES, so real fleet task work never dispatched.

interface RouteEnv {
  dataDir: string;
  restore: () => void;
}

function withRouteEnv(): RouteEnv {
  const oldDataDir = process.env.LOOPS_DATA_DIR;
  const dataDir = mkdtempSync(join(tmpdir(), "loops-route-dedupe-"));
  process.env.LOOPS_DATA_DIR = dataDir;
  return {
    dataDir,
    restore: () => {
      if (oldDataDir === undefined) delete process.env.LOOPS_DATA_DIR;
      else process.env.LOOPS_DATA_DIR = oldDataDir;
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

const TASK_ID = "task-dedupe-regression-1";

function pendingTaskEvent() {
  return {
    id: "evt-dedupe-regression-1",
    type: "task.created",
    source: "todos",
    subject: `task:${TASK_ID}`,
    data: {
      id: TASK_ID,
      title: "Regression: re-admit stale terminal work item",
      status: "pending",
      tags: ["auto:route"],
      project_path: process.cwd(),
    },
  } as never;
}

const ROUTE_OPTS: TodosTaskRouteOptions = {
  template: "task-lifecycle",
  provider: "codewith",
  // codewith + workspace-write satisfies the sandbox preflight without a worktree.
  sandbox: "workspace-write",
  worktreeMode: "auto",
};

/** Simulate a run finishing without closing the todos task by forcing the item terminal + backdating it past the redispatch backoff window. */
function forceTerminal(status: "succeeded" | "failed" | "dead_letter" | "cancelled", opts: { attempts?: number; ageMs?: number } = {}): void {
  const db = new Database(dbPath());
  try {
    const backdated = new Date(Date.now() - (opts.ageMs ?? 60 * 60_000)).toISOString();
    if (opts.attempts === undefined) {
      db.query("UPDATE workflow_work_items SET status = ?, updated_at = ? WHERE route_key = 'todos-task'").run(status, backdated);
    } else {
      db.query("UPDATE workflow_work_items SET status = ?, attempts = ?, updated_at = ? WHERE route_key = 'todos-task'").run(
        status,
        opts.attempts,
        backdated,
      );
    }
  } finally {
    db.close();
  }
}

function workItemRow(): { status: string; attempts: number } | undefined {
  const db = new Database(dbPath());
  try {
    return db
      .query<{ status: string; attempts: number }, []>("SELECT status, attempts FROM workflow_work_items WHERE route_key = 'todos-task' LIMIT 1")
      .get() ?? undefined;
  } finally {
    db.close();
  }
}

describe("routeTodosTaskEvent dedupe re-admission", () => {
  let env: RouteEnv;
  beforeEach(() => {
    env = withRouteEnv();
  });
  afterEach(() => {
    env.restore();
  });

  test("first route creates and admits the work item", () => {
    const result = routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS);
    expect(result.kind).toBe("created");
    expect(result.value.deduped).toBeFalsy();
    expect(workItemRow()).toEqual({ status: "admitted", attempts: 1 });
  });

  test("an in-flight (admitted) work item still dedupes", () => {
    routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS);
    const result = routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS);
    expect(result.kind).toBe("deduped");
  });

  test("re-admits a succeeded work item whose todos task is still pending", () => {
    routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS);
    forceTerminal("succeeded");
    const result = routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS);
    // Regression: before the fix this returned "deduped" (the wedge).
    expect(result.kind).toBe("created");
    expect(result.value.deduped).toBeFalsy();
    expect(workItemRow()).toEqual({ status: "admitted", attempts: 2 });
  });

  test("re-admits a failed work item on the next drain", () => {
    routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS);
    forceTerminal("failed");
    expect(routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS).kind).toBe("created");
  });

  test("re-admits a cancelled work item whose task is still pending", () => {
    routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS);
    forceTerminal("cancelled");
    expect(routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS).kind).toBe("created");
  });

  test("holds off re-admitting within the backoff window", () => {
    routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS);
    // Terminal only ~1s ago: still inside the (2m base) backoff → keep deduping.
    forceTerminal("succeeded", { ageMs: 1_000 });
    expect(routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS).kind).toBe("deduped");
  });

  test("stops re-admitting once the redispatch cap is reached", () => {
    routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS);
    forceTerminal("failed", { attempts: 8, ageMs: 24 * 60 * 60_000 });
    expect(routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS).kind).toBe("deduped");
  });
});
