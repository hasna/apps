import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbPath } from "../paths.js";
import { Store } from "../store.js";
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

// A PR-subject task with a concrete owner/repo#number reference but no
// approve/merge/review intent: fingerprintable, yet the PR-review gate is not
// required, so routing creates a worker without touching `gh` (hermetic).
function prTaskEvent(taskId: string) {
  return {
    id: `evt-${taskId}`,
    type: "task.created",
    source: "todos",
    subject: `task:${taskId}`,
    data: {
      id: taskId,
      title: "Investigate dependency bump",
      status: "pending",
      tags: ["auto:route"],
      description: "tracking https://github.com/hasna/example/pull/7 for the rollout",
      project_path: process.cwd(),
    },
  } as never;
}

function plainTaskEvent(taskId: string) {
  return {
    id: `evt-${taskId}`,
    type: "task.created",
    source: "todos",
    subject: `task:${taskId}`,
    data: {
      id: taskId,
      title: "Fix the flaky unit test",
      status: "pending",
      tags: ["auto:route"],
      description: "the retry helper races on slow CI",
      project_path: process.cwd(),
    },
  } as never;
}

describe("routeTodosTaskEvent PR fingerprint dedupe", () => {
  let env: RouteEnv;
  beforeEach(() => {
    env = withRouteEnv();
  });
  afterEach(() => {
    env.restore();
  });

  test("PR-subject tasks from different checkouts dedupe by owner/repo#number", () => {
    // Two distinct todos tasks (distinct ids + distinct source checkout paths)
    // for the same GitHub PR — exactly what the repos registry mints per checkout.
    const first = routeTodosTaskEvent(prTaskEvent("task-checkout-a"), {
      ...ROUTE_OPTS,
      sourceTodosProjectPath: "/repos/example-checkout-a",
    });
    expect(first.kind).toBe("created");
    expect(first.value.idempotencyKey).toBe("todos-task:pr:hasna/example#7");

    const second = routeTodosTaskEvent(prTaskEvent("task-checkout-b"), {
      ...ROUTE_OPTS,
      sourceTodosProjectPath: "/repos/example-checkout-b",
    });
    // Regression: the old (source-path, task-id) key kept these distinct and
    // spawned a full worker per checkout; the fingerprint collapses them to one.
    expect(second.kind).toBe("deduped");
    expect(second.value.idempotencyKey).toBe("todos-task:pr:hasna/example#7");
  });

  test("case differences in the owner/repo do not defeat PR dedupe", () => {
    const first = routeTodosTaskEvent(
      {
        id: "evt-mixed-case",
        type: "task.created",
        source: "todos",
        subject: "task:mixed-case",
        data: {
          id: "task-mixed-case",
          title: "Investigate dependency bump",
          status: "pending",
          tags: ["auto:route"],
          description: "tracking https://github.com/Hasna/Example/pull/7 rollout",
          project_path: process.cwd(),
        },
      } as never,
      { ...ROUTE_OPTS, sourceTodosProjectPath: "/repos/a" },
    );
    expect(first.kind).toBe("created");
    expect(first.value.idempotencyKey).toBe("todos-task:pr:hasna/example#7");
  });

  test("non-PR tasks from different checkouts keep independent keys (no false dedupe)", () => {
    const first = routeTodosTaskEvent(plainTaskEvent("task-x"), { ...ROUTE_OPTS, sourceTodosProjectPath: "/repos/a" });
    const second = routeTodosTaskEvent(plainTaskEvent("task-y"), { ...ROUTE_OPTS, sourceTodosProjectPath: "/repos/b" });
    expect(first.kind).toBe("created");
    // Two genuinely different tasks with no PR reference must NOT collapse.
    expect(second.kind).toBe("created");
    expect(first.value.idempotencyKey).not.toBe(second.value.idempotencyKey);
  });
});

describe("routeTodosTaskEvent freshness skip marker", () => {
  let env: RouteEnv;
  beforeEach(() => {
    env = withRouteEnv();
  });
  afterEach(() => {
    env.restore();
  });

  test("a definitively merged PR route is skipped with a freshnessSkip marker for the drain to close", () => {
    const event = {
      id: "evt-merged-pr",
      type: "task.created",
      source: "todos",
      subject: "task:merged-pr",
      data: {
        id: "task-merged-pr",
        title: "Merge the release PR",
        status: "pending",
        tags: ["auto:route"],
        // Merge intent + baked-in MERGED state => freshness gate fires from
        // evidence with no gh probe (hermetic).
        description: "please merge https://github.com/hasna/example/pull/7 pr_state=MERGED",
        project_path: process.cwd(),
      },
    } as never;
    const result = routeTodosTaskEvent(event, { ...ROUTE_OPTS, githubReviewer: "reviewer-bob" });
    expect(result.kind).toBe("skipped");
    expect(result.value.freshnessSkip).toBe(true);
    expect(result.value.prState).toBe("MERGED");
  });
});

describe("routeTodosTaskEvent per-route --max-active scope", () => {
  let env: RouteEnv;
  beforeEach(() => {
    env = withRouteEnv();
  });
  afterEach(() => {
    env.restore();
  });

  test("--max-active counts only the routing loop's own active items", () => {
    const optsA: TodosTaskRouteOptions = { ...ROUTE_OPTS, maxActive: "1", maxActiveScope: "loopA" };
    const optsB: TodosTaskRouteOptions = { ...ROUTE_OPTS, maxActive: "1", maxActiveScope: "loopB" };
    // loopA admits its first task (0 active < 1).
    expect(routeTodosTaskEvent(plainTaskEvent("scope-a1"), optsA).kind).toBe("created");
    // loopB is a DIFFERENT route: it is not blocked by loopA's active item.
    // Neutralization: the pre-fix store-wide count saw 1 active >= 1 and would
    // have throttled this — asserting "created" fails against the old counting.
    expect(routeTodosTaskEvent(plainTaskEvent("scope-b1"), optsB).kind).toBe("created");
    // A second loopA task IS blocked because loopA already holds one active item.
    expect(routeTodosTaskEvent(plainTaskEvent("scope-a2"), optsA).kind).toBe("throttled");
  });
});

describe("routeTodosTaskEvent least-loaded auth-profile pool", () => {
  let env: RouteEnv;
  beforeEach(() => {
    env = withRouteEnv();
  });
  afterEach(() => {
    env.restore();
  });

  // Seed a running codewith step on `profile` in the same store the route reads,
  // so countRunningWorkflowStepsByAuthProfile() reports live per-account load.
  function seedRunningStep(profile: string, tag: string): void {
    const store = new Store(dbPath());
    try {
      const workflow = store.createWorkflow({
        name: `seed-${tag}`,
        steps: [{ id: "worker", target: { type: "agent", provider: "codewith", prompt: "seeded", sandbox: "workspace-write", authProfile: profile } }],
      });
      const run = store.createWorkflowRun({ workflow });
      store.startWorkflowStepRun(run.id, "worker");
    } finally {
      store.close();
    }
  }

  test("spreads the worker to the least-loaded pool account", () => {
    // acctA has 2 running, acctC has 1, acctB is idle -> least loaded is acctB.
    seedRunningStep("acctA", "s1");
    seedRunningStep("acctA", "s2");
    seedRunningStep("acctC", "s3");
    const opts: TodosTaskRouteOptions = { ...ROUTE_OPTS, authProfilePool: "acctA,acctB,acctC", maxPerProfile: "0" };
    const result = routeTodosTaskEvent(plainTaskEvent("spread-1"), opts);
    expect(result.kind).toBe("created");
    const profiles = result.value.accountProfiles as Record<string, string> | undefined;
    // Neutralization: removing the route-event pool wiring leaves accountProfiles
    // undefined and the worker on its deterministic hash pick (often a loaded
    // account); least-loaded must place the worker on the idle acctB.
    expect(profiles?.worker).toBe("acctB");
    expect(result.value.routeScope).toBeDefined();
  });

  test("defers the route when every pool account is at --max-per-profile", () => {
    seedRunningStep("acctA", "d1");
    seedRunningStep("acctB", "d2");
    const opts: TodosTaskRouteOptions = { ...ROUTE_OPTS, authProfilePool: "acctA,acctB", maxPerProfile: "1" };
    const result = routeTodosTaskEvent(plainTaskEvent("defer-1"), opts);
    // Neutralization: without the guard this is "created" and stacks a 3rd run.
    expect(result.kind).toBe("throttled");
    expect(String(result.value.reason)).toContain("per-profile active limit reached");
  });
});
