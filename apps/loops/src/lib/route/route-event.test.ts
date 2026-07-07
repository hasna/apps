import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function loopCount(): number {
  const store = new Store(dbPath());
  try {
    return store.listLoops().length;
  } finally {
    store.close();
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function withFakeCodewith(dataDir: string, diagnostics: unknown, opts: { status?: number } = {}): { calls: string; restore: () => void } {
  const binDir = join(dataDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const calls = join(dataDir, "codewith-calls.log");
  const codewith = join(binDir, "codewith");
  writeFileSync(
    codewith,
    [
      "#!/usr/bin/env bash",
      "printf '%s\\n' \"$*\" >> \"$OPENLOOPS_TEST_CODEWITH_CALLS\"",
      "if [[ \"${OPENLOOPS_TEST_CODEWITH_STATUS:-0}\" != \"0\" ]]; then",
      "  printf 'diagnostics unavailable\\n' >&2",
      "  exit \"$OPENLOOPS_TEST_CODEWITH_STATUS\"",
      "fi",
      "printf '%s' \"$OPENLOOPS_TEST_CODEWITH_DIAGNOSTICS\"",
      "",
    ].join("\n"),
  );
  chmodSync(codewith, 0o755);
  const oldPath = process.env.PATH;
  const oldDiagnostics = process.env.OPENLOOPS_TEST_CODEWITH_DIAGNOSTICS;
  const oldCalls = process.env.OPENLOOPS_TEST_CODEWITH_CALLS;
  const oldStatus = process.env.OPENLOOPS_TEST_CODEWITH_STATUS;
  process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
  process.env.OPENLOOPS_TEST_CODEWITH_DIAGNOSTICS = typeof diagnostics === "string" ? diagnostics : JSON.stringify(diagnostics);
  process.env.OPENLOOPS_TEST_CODEWITH_CALLS = calls;
  process.env.OPENLOOPS_TEST_CODEWITH_STATUS = String(opts.status ?? 0);
  return {
    calls,
    restore: () => {
      restoreEnv("PATH", oldPath);
      restoreEnv("OPENLOOPS_TEST_CODEWITH_DIAGNOSTICS", oldDiagnostics);
      restoreEnv("OPENLOOPS_TEST_CODEWITH_CALLS", oldCalls);
      restoreEnv("OPENLOOPS_TEST_CODEWITH_STATUS", oldStatus);
    },
  };
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

  test("at the redispatch cap it dead-letters (visible) instead of silently deduping forever", () => {
    routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS);
    forceTerminal("failed", { attempts: 8, ageMs: 24 * 60 * 60_000 });
    const first = routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS);
    // Still no new dispatch (deduped) — but now VISIBLE, not a silent black hole.
    expect(first.kind).toBe("deduped");
    expect(first.value.deadLettered).toBe(true);
    expect(first.value.dedupedBy).toBe("work-item");
    expect(workItemRow()).toEqual({ status: "dead_letter", attempts: 8 });
    // A subsequent drain keeps deduping the dead-lettered item without churn or
    // re-escalation; it stays dead_letter until an operator requeues it.
    const second = routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS);
    expect(second.kind).toBe("deduped");
    expect(second.value.deadLettered).toBe(true);
    expect(workItemRow()?.status).toBe("dead_letter");
  });
});

// A PR-backlog task with a concrete owner/repo#number reference: fingerprintable,
// yet the PR-review gate is not required, so routing creates a worker without
// touching `gh` (hermetic).
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
      pr_fingerprint: "hasna/example#7",
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
          pr_fingerprint: "Hasna/Example#7",
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

describe("routeTodosTaskEvent provider-native admission", () => {
  let env: RouteEnv;
  let restoreCodewith: (() => void) | undefined;
  beforeEach(() => {
    env = withRouteEnv();
  });
  afterEach(() => {
    restoreCodewith?.();
    restoreCodewith = undefined;
    env.restore();
  });

  test("--provider-active-cap throttles before creating a workflow loop when Codewith is saturated", () => {
    const fake = withFakeCodewith(env.dataDir, {
      activeRunCount: 8,
      maxActiveRunsPerUser: 8,
      availableActiveRunSlots: 0,
    });
    restoreCodewith = fake.restore;

    const result = routeTodosTaskEvent(plainTaskEvent("provider-cap-hit"), {
      ...ROUTE_OPTS,
      authProfile: "account006",
      providerActiveCap: "6",
    });

    expect(result.kind).toBe("throttled");
    expect(result.value.queuedAtSource).toBe(true);
    expect(String(result.value.reason)).toContain("codewith active-run cap reached (8/6)");
    expect((result.value.providerAdmission as { activeCap?: number; diagnostics?: { activeRunCount?: number } }).activeCap).toBe(6);
    expect((result.value.providerAdmission as { diagnostics?: { activeRunCount?: number } }).diagnostics?.activeRunCount).toBe(8);
    expect((result.value.workItem as { status?: string }).status).toBe("deferred");
    expect(loopCount()).toBe(0);
    expect(readFileSync(fake.calls, "utf8")).toContain("--auth-profile account006 agent diagnostics --json");
  });

  test("below-cap Codewith diagnostics allow workflow loop creation", () => {
    restoreCodewith = withFakeCodewith(env.dataDir, {
      activeRunCount: 4,
      maxActiveRunsPerUser: 8,
      availableActiveRunSlots: 4,
    }).restore;

    const result = routeTodosTaskEvent(plainTaskEvent("provider-cap-open"), { ...ROUTE_OPTS, providerActiveCap: "6" });

    expect(result.kind).toBe("created");
    expect((result.value.providerAdmission as { allowed?: boolean; diagnostics?: { activeRunCount?: number } }).allowed).toBe(true);
    expect((result.value.providerAdmission as { diagnostics?: { activeRunCount?: number } }).diagnostics?.activeRunCount).toBe(4);
    expect(loopCount()).toBe(1);
  });

  test("--provider-admission-check fails closed when Codewith diagnostics fail", () => {
    restoreCodewith = withFakeCodewith(env.dataDir, {}, { status: 17 }).restore;

    const result = routeTodosTaskEvent(plainTaskEvent("provider-diagnostics-failure"), {
      ...ROUTE_OPTS,
      providerAdmissionCheck: true,
    });

    expect(result.kind).toBe("throttled");
    expect(String(result.value.reason)).toContain("codewith diagnostics failed");
    expect((result.value.providerAdmission as { allowed?: boolean }).allowed).toBe(false);
    expect(result.value.fatal).toBe(true);
    expect(loopCount()).toBe(0);
  });

  test("--codewith-active-cap is a Codewith-specific alias for the provider active cap", () => {
    restoreCodewith = withFakeCodewith(env.dataDir, {
      activeRunCount: 6,
      maxActiveRunsPerUser: 8,
      availableActiveRunSlots: 2,
    }).restore;

    const result = routeTodosTaskEvent(plainTaskEvent("provider-codewith-alias"), {
      ...ROUTE_OPTS,
      codewithActiveCap: "6",
    });

    expect(result.kind).toBe("throttled");
    expect(String(result.value.reason)).toContain("codewith active-run cap reached (6/6)");
    expect((result.value.providerAdmission as { activeCap?: number }).activeCap).toBe(6);
    expect(loopCount()).toBe(0);
  });

  test("auth-profile pools run diagnostics against selected pool profiles, not the default profile", () => {
    const fake = withFakeCodewith(env.dataDir, {
      activeRunCount: 3,
      maxActiveRunsPerUser: 8,
      availableActiveRunSlots: 5,
    });
    restoreCodewith = fake.restore;
    const store = new Store(dbPath());
    try {
      const workflow = store.createWorkflow({
        name: "seed-pool-load",
        steps: [{ id: "worker", target: { type: "agent", provider: "codewith", prompt: "seeded", sandbox: "workspace-write", authProfile: "acctA" } }],
      });
      const run = store.createWorkflowRun({ workflow });
      store.startWorkflowStepRun(run.id, "worker");
    } finally {
      store.close();
    }

    const result = routeTodosTaskEvent(plainTaskEvent("provider-pool-profile"), {
      ...ROUTE_OPTS,
      authProfilePool: "acctA,acctB",
      maxPerProfile: "0",
      providerActiveCap: "6",
    });

    expect(result.kind).toBe("created");
    const calls = readFileSync(fake.calls, "utf8").trim().split(/\r?\n/);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((line) => line.includes("--auth-profile"))).toBe(true);
    expect(calls.join("\n")).toContain("--auth-profile acctB agent diagnostics --json");
  });

  test("mixed role pins and base auth profile check every rendered Codewith profile", () => {
    const fake = withFakeCodewith(env.dataDir, {
      activeRunCount: 3,
      maxActiveRunsPerUser: 8,
      availableActiveRunSlots: 5,
    });
    restoreCodewith = fake.restore;

    const result = routeTodosTaskEvent(plainTaskEvent("provider-mixed-profiles"), {
      ...ROUTE_OPTS,
      authProfile: "acctB",
      workerAuthProfile: "acctA",
      providerActiveCap: "6",
    });

    expect(result.kind).toBe("created");
    const calls = readFileSync(fake.calls, "utf8");
    expect(calls).toContain("--auth-profile acctA agent diagnostics --json");
    expect(calls).toContain("--auth-profile acctB agent diagnostics --json");
  });

  test("multi-profile admission marks fatal diagnostics failures even when another profile is capacity-throttled", () => {
    const binDir = join(env.dataDir, "bin-fatal");
    mkdirSync(binDir, { recursive: true });
    const calls = join(env.dataDir, "codewith-fatal-calls.log");
    const codewith = join(binDir, "codewith");
    writeFileSync(
      codewith,
      [
        "#!/usr/bin/env bash",
        "printf '%s\\n' \"$*\" >> \"$OPENLOOPS_TEST_CODEWITH_CALLS\"",
        "if [[ \"$*\" == *\"--auth-profile acctA\"* ]]; then",
        "  printf '%s' '{\"activeRunCount\":6,\"maxActiveRunsPerUser\":8,\"availableActiveRunSlots\":2}'",
        "  exit 0",
        "fi",
        "if [[ \"$*\" == *\"--auth-profile acctB\"* ]]; then",
        "  printf 'diagnostics unavailable\\n' >&2",
        "  exit 17",
        "fi",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(codewith, 0o755);
    const oldPath = process.env.PATH;
    const oldCalls = process.env.OPENLOOPS_TEST_CODEWITH_CALLS;
    process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
    process.env.OPENLOOPS_TEST_CODEWITH_CALLS = calls;
    restoreCodewith = () => {
      restoreEnv("PATH", oldPath);
      restoreEnv("OPENLOOPS_TEST_CODEWITH_CALLS", oldCalls);
    };

    const result = routeTodosTaskEvent(plainTaskEvent("provider-multi-fatal"), {
      ...ROUTE_OPTS,
      authProfile: "acctA",
      workerAuthProfile: "acctB",
      providerActiveCap: "6",
    });

    expect(result.kind).toBe("throttled");
    expect(String(result.value.reason)).toContain("codewith provider admission denied for acctB");
    expect(result.value.fatal).toBe(true);
    expect((result.value.providerAdmission as { fatal?: boolean }).fatal).toBe(true);
  });
});
