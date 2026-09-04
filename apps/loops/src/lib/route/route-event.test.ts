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
  const oldMachineId = process.env.LOOPS_MACHINE_ID;
  const oldPath = process.env.PATH;
  const dataDir = mkdtempSync(join(tmpdir(), "loops-route-dedupe-"));
  const binDir = join(dataDir, "default-bin");
  mkdirSync(binDir, { recursive: true });
  const todosBin = join(binDir, "todos");
  writeFileSync(
    todosBin,
    [
      "#!/usr/bin/env bash",
      "for arg in \"$@\"; do",
      "  if [[ \"$arg\" == \"inspect\" ]]; then",
      "    task_id=\"${@: -1}\"",
      "    printf '{\"id\":\"%s\",\"status\":\"pending\",\"tags\":[\"auto:route\"]}' \"$task_id\"",
      "    exit 0",
      "  fi",
      "done",
      "printf 'unexpected todos command: %s\\n' \"$*\" >&2",
      "exit 2",
      "",
    ].join("\n"),
  );
  chmodSync(todosBin, 0o755);
  process.env.LOOPS_DATA_DIR = dataDir;
  process.env.LOOPS_MACHINE_ID = "route-event-test-machine";
  process.env.PATH = `${binDir}:${oldPath ?? ""}`;
  return {
    dataDir,
    restore: () => {
      if (oldDataDir === undefined) delete process.env.LOOPS_DATA_DIR;
      else process.env.LOOPS_DATA_DIR = oldDataDir;
      restoreEnv("LOOPS_MACHINE_ID", oldMachineId);
      restoreEnv("PATH", oldPath);
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

const TASK_ID = "task-dedupe-regression-1";

function pendingTaskEvent(dataOverrides: Record<string, unknown> = {}) {
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
      ...dataOverrides,
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
function forceTerminal(
  status: "succeeded" | "failed" | "dead_letter" | "cancelled",
  opts: { attempts?: number; ageMs?: number; gateDeaths?: number } = {},
): void {
  const db = new Database(dbPath());
  try {
    const backdated = new Date(Date.now() - (opts.ageMs ?? 60 * 60_000)).toISOString();
    db.query(
      `UPDATE workflow_work_items
       SET status = ?, updated_at = ?,
        attempts = COALESCE(?, attempts),
        gate_deaths = COALESCE(?, gate_deaths)
       WHERE route_key = 'todos-task'`,
    ).run(status, backdated, opts.attempts ?? null, opts.gateDeaths ?? null);
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

function withFakeTodosInspect(dataDir: string, task: unknown, opts: { status?: number; stderr?: string } = {}): { calls: string; restore: () => void } {
  const binDir = join(dataDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const calls = join(dataDir, "todos-calls.log");
  const todos = join(binDir, "todos");
  writeFileSync(
    todos,
    [
      "#!/usr/bin/env bash",
      "printf '%s\\n' \"$*\" >> \"$OPENLOOPS_TEST_TODOS_CALLS\"",
      "for arg in \"$@\"; do",
      "  if [[ \"$arg\" == \"inspect\" ]]; then",
      "    if [[ \"${OPENLOOPS_TEST_TODOS_STATUS:-0}\" != \"0\" ]]; then",
      "      printf '%s\\n' \"$OPENLOOPS_TEST_TODOS_STDERR\" >&2",
      "      exit \"$OPENLOOPS_TEST_TODOS_STATUS\"",
      "    fi",
      "    printf '%s' \"$OPENLOOPS_TEST_TODOS_TASK_JSON\"",
      "    exit 0",
      "  fi",
      "done",
      "printf 'unexpected todos command: %s\\n' \"$*\" >&2",
      "exit 2",
      "",
    ].join("\n"),
  );
  chmodSync(todos, 0o755);
  const oldPath = process.env.PATH;
  const oldCalls = process.env.OPENLOOPS_TEST_TODOS_CALLS;
  const oldTaskJson = process.env.OPENLOOPS_TEST_TODOS_TASK_JSON;
  const oldStatus = process.env.OPENLOOPS_TEST_TODOS_STATUS;
  const oldStderr = process.env.OPENLOOPS_TEST_TODOS_STDERR;
  process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
  process.env.OPENLOOPS_TEST_TODOS_CALLS = calls;
  process.env.OPENLOOPS_TEST_TODOS_TASK_JSON = typeof task === "string" ? task : JSON.stringify(task);
  process.env.OPENLOOPS_TEST_TODOS_STATUS = String(opts.status ?? 0);
  process.env.OPENLOOPS_TEST_TODOS_STDERR = opts.stderr ?? "task not found";
  return {
    calls,
    restore: () => {
      restoreEnv("PATH", oldPath);
      restoreEnv("OPENLOOPS_TEST_TODOS_CALLS", oldCalls);
      restoreEnv("OPENLOOPS_TEST_TODOS_TASK_JSON", oldTaskJson);
      restoreEnv("OPENLOOPS_TEST_TODOS_STATUS", oldStatus);
      restoreEnv("OPENLOOPS_TEST_TODOS_STDERR", oldStderr);
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

  test("inspects the source task without --project when no todos project is configured", () => {
    const fakeTodos = withFakeTodosInspect(env.dataDir, { id: TASK_ID, status: "pending", title: "default source" });
    try {
      const result = routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS);
      expect(result.kind).toBe("created");
      expect(result.value.sourceTaskResolution).toMatchObject({
        checked: true,
        resolved: true,
        taskId: TASK_ID,
      });
      expect((result.value.sourceTaskResolution as { todosProjectPath?: string }).todosProjectPath).toBeUndefined();
      expect(readFileSync(fakeTodos.calls, "utf8").trim()).toBe(`--json inspect ${TASK_ID}`);
    } finally {
      fakeTodos.restore();
    }
  });

  test("skips a task-created event when the source todos task is missing", () => {
    const fakeTodos = withFakeTodosInspect(env.dataDir, {}, { status: 1, stderr: "task not found" });
    try {
      const result = routeTodosTaskEvent(pendingTaskEvent(), {
        ...ROUTE_OPTS,
        todosProject: "/tmp/source-todos",
      });

      expect(result.kind).toBe("skipped");
      expect(result.value.blocked).toBe(true);
      expect(result.value.reason).toContain("source todos task is not resolvable");
      expect(result.value.sourceTaskResolution).toMatchObject({
        checked: true,
        resolved: false,
        taskId: TASK_ID,
        todosProjectPath: "/tmp/source-todos",
        // Trimmed: the reason is trimmed so whitespace-only stderr cannot mask the
        // exit status. Asserting the untrimmed "task not found\n" baked in the
        // behaviour that hid it.
        error: "task not found",
      });
      expect(loopCount()).toBe(0);
      expect(workItemRow()).toBeUndefined();
      expect(readFileSync(fakeTodos.calls, "utf8")).toContain(`--project /tmp/source-todos --json inspect ${TASK_ID}`);
    } finally {
      fakeTodos.restore();
    }
  });

  test("a definitive 'task not found' from the source is NOT flagged as an unavailable source", () => {
    // Negative control for the two tests below: the source answered, so the skip is
    // benign and must stay exit-0. If this ever starts reporting sourceUnavailable,
    // every legitimately-absent task would fail its route run.
    const fakeTodos = withFakeTodosInspect(env.dataDir, {}, { status: 1, stderr: "task not found" });
    try {
      const result = routeTodosTaskEvent(pendingTaskEvent(), { ...ROUTE_OPTS, todosProject: "/tmp/source-todos" });
      expect(result.kind).toBe("skipped");
      expect(result.value.sourceUnavailable).toBeUndefined();
      expect(result.value.sourceTaskResolution).toMatchObject({ resolved: false });
      expect((result.value.sourceTaskResolution as { sourceUnavailable?: boolean }).sourceUnavailable).toBeUndefined();
      expect(loopCount()).toBe(0);
    } finally {
      fakeTodos.restore();
    }
  });

  test("an abbreviated task id that todos canonicalizes still routes (existing task, not a mismatch)", () => {
    // Regression: todos inspect resolves an 8-char prefix and echoes the FULL
    // lowercase uuid, so a byte comparison called a found task a mismatch and the
    // route then reported an unreachable source and failed the run.
    const shortId = TASK_ID.slice(0, 8);
    const fakeTodos = withFakeTodosInspect(env.dataDir, { id: TASK_ID, status: "pending", title: "canonicalized" });
    try {
      const result = routeTodosTaskEvent(pendingTaskEvent({ id: shortId }), {
        ...ROUTE_OPTS,
        sourceTodosProjectPath: "/tmp/source-todos",
      });
      expect(result.value.sourceUnavailable).toBeUndefined();
      expect(result.value.sourceTaskResolution).toMatchObject({
        checked: true,
        resolved: true,
        taskId: TASK_ID,
        status: "pending",
      });
      expect(result.kind).toBe("created");
      expect(result.value.idempotencyKey).toBe(`todos-task:/tmp/source-todos:${TASK_ID}`);
      expect((result.value.workItem as { subjectRef?: string }).subjectRef).toBeUndefined();
      expect((result.value.invocation as { subjectRef?: { id?: string } }).subjectRef?.id).toBe(TASK_ID);
      expect((result.value.loop as { description?: string }).description).toContain(`task ${TASK_ID}`);
      const store = new Store(dbPath());
      try {
        expect(store.getWorkflowWorkItem((result.value.workItem as { id: string }).id)?.subjectRef).toBe(TASK_ID);
      } finally {
        store.close();
      }
    } finally {
      fakeTodos.restore();
    }
  });

  test("short then full and case-variant events for one source task create one loop", () => {
    const shortId = TASK_ID.slice(0, 8);
    const fakeTodos = withFakeTodosInspect(env.dataDir, { id: TASK_ID, status: "pending", title: "canonicalized" });
    const opts = { ...ROUTE_OPTS, sourceTodosProjectPath: "/tmp/source-todos" };
    try {
      const first = routeTodosTaskEvent(pendingTaskEvent({ id: shortId, title: undefined }), opts);
      const second = routeTodosTaskEvent(pendingTaskEvent({ id: TASK_ID.toUpperCase(), title: undefined }), opts);

      expect(first.kind).toBe("created");
      expect(second.kind).toBe("deduped");
      expect(first.value.idempotencyKey).toBe(`todos-task:/tmp/source-todos:${TASK_ID}`);
      expect(second.value.idempotencyKey).toBe(first.value.idempotencyKey);
      expect(loopCount()).toBe(1);

      const firstWorkflow = first.value.workflow as { name?: string; description?: string; steps?: unknown[] };
      const firstLoop = first.value.loop as { name?: string; description?: string };
      expect(firstWorkflow.name).toStartWith(`event:todos-task:${TASK_ID.slice(0, 8)}:`);
      expect(firstLoop.name).toStartWith(`event:todos-task:${TASK_ID.slice(0, 8)}:`);
      expect(firstWorkflow.description).toContain(`workflow for ${TASK_ID}`);
      expect(firstWorkflow.description).toContain(`idempotency=todos-task:/tmp/source-todos:${TASK_ID}`);
      expect(firstLoop.description).toContain(`task ${TASK_ID}`);
      expect(JSON.stringify(firstWorkflow.steps)).not.toContain(TASK_ID);
      const store = new Store(dbPath());
      try {
        expect(JSON.stringify(store.getWorkflow((firstWorkflow as { id: string }).id)?.steps)).toContain(TASK_ID);
      } finally {
        store.close();
      }
    } finally {
      fakeTodos.restore();
    }
  });

  test("canonical routes dedupe a legacy work item stored under the raw short id", () => {
    const shortId = TASK_ID.slice(0, 8);
    const opts = { ...ROUTE_OPTS, sourceTodosProjectPath: "/tmp/source-todos" };
    const legacy = routeTodosTaskEvent(pendingTaskEvent({ id: shortId }), {
      ...opts,
      sourceTaskResolvedId: shortId,
    });
    expect(legacy.kind).toBe("created");
    expect(legacy.value.idempotencyKey).toBe(`todos-task:/tmp/source-todos:${shortId}`);

    const fakeTodos = withFakeTodosInspect(env.dataDir, { id: TASK_ID, status: "pending" });
    try {
      const canonical = routeTodosTaskEvent(pendingTaskEvent({ id: shortId }), opts);
      expect(canonical.kind).toBe("deduped");
      expect(canonical.value.idempotencyKey).toBe(`todos-task:/tmp/source-todos:${TASK_ID}`);
      expect(loopCount()).toBe(1);
    } finally {
      fakeTodos.restore();
    }
  });

  test("the drain bypass carries an explicit authoritative task id", () => {
    const shortId = TASK_ID.slice(0, 8);
    const result = routeTodosTaskEvent(pendingTaskEvent({ id: shortId, title: undefined }), {
      ...ROUTE_OPTS,
      sourceTodosProjectPath: "/tmp/source-todos",
      sourceTaskResolvedId: TASK_ID,
      dryRun: true,
    });

    expect(result.kind).toBe("created");
    expect(result.value.sourceTaskResolution).toMatchObject({ checked: false, resolved: true, taskId: TASK_ID });
    expect(result.value.idempotencyKey).toBe(`todos-task:/tmp/source-todos:${TASK_ID}`);
    expect((result.value.workItem as { subjectRef?: string }).subjectRef).toBe(TASK_ID);
    expect((result.value.invocation as { subjectRef?: { id?: string } }).subjectRef?.id).toBe(TASK_ID);
  });

  test("an uppercase task id that todos canonicalizes still routes", () => {
    const fakeTodos = withFakeTodosInspect(env.dataDir, { id: TASK_ID, status: "pending", title: "canonicalized" });
    try {
      const result = routeTodosTaskEvent(pendingTaskEvent({ id: TASK_ID.toUpperCase() }), { ...ROUTE_OPTS, todosProject: "/tmp/source-todos" });
      expect(result.value.sourceUnavailable).toBeUndefined();
      expect(result.value.sourceTaskResolution).toMatchObject({ resolved: true });
      expect(result.kind).toBe("created");
    } finally {
      fakeTodos.restore();
    }
  });

  test("a genuinely DIFFERENT task id from the source is a definitive answer, not an unreachable source", () => {
    // The source answered intelligibly; it just answered about another task. That
    // must stay a benign exit-0 skip, never "could not reach the task source".
    const fakeTodos = withFakeTodosInspect(env.dataDir, { id: "99999999-9999-4999-8999-999999999999", status: "pending" });
    try {
      const result = routeTodosTaskEvent(pendingTaskEvent(), { ...ROUTE_OPTS, todosProject: "/tmp/source-todos" });
      expect(result.kind).toBe("skipped");
      expect(result.value.sourceUnavailable).toBeUndefined();
      expect(String(result.value.reason)).toContain("todos inspect returned task 99999999");
      expect(loopCount()).toBe(0);
    } finally {
      fakeTodos.restore();
    }
  });

  test("a numeric non-zero exit keeps its status number in the reason", () => {
    // Regression: the fallback message said "produced no exit status" for a process
    // that produced status 4, which is self-contradictory and misdirects diagnosis.
    const fakeTodos = withFakeTodosInspect(env.dataDir, {}, { status: 4, stderr: "" });
    try {
      const result = routeTodosTaskEvent(pendingTaskEvent(), { ...ROUTE_OPTS, todosProject: "/tmp/source-todos" });
      expect(result.value.sourceUnavailable).toBeUndefined();
      expect(String(result.value.reason)).toContain("status 4");
      expect(String(result.value.reason)).not.toContain("produced no exit status");
    } finally {
      fakeTodos.restore();
    }
  });

  test("flags sourceUnavailable when todos is not on PATH, so the caller can fail instead of silently dropping the event", () => {
    // Regression for the silent-event-loss hole: a router launched without `todos`
    // on PATH skipped every event and exited 0, and the events transport marked each
    // silent drop a successful delivery, so nothing was ever retried.
    const emptyBin = join(env.dataDir, "empty-bin");
    mkdirSync(emptyBin, { recursive: true });
    const oldPath = process.env.PATH;
    process.env.PATH = emptyBin;
    try {
      const result = routeTodosTaskEvent(pendingTaskEvent(), { ...ROUTE_OPTS, todosProject: "/tmp/source-todos" });
      expect(result.kind).toBe("skipped");
      expect(result.value.sourceUnavailable).toBe(true);
      expect(result.value.reason).toContain("could not ask the active todos source");
      expect(result.value.sourceTaskResolution).toMatchObject({ checked: true, resolved: false, sourceUnavailable: true });
      // Still refuses to route: unknown existence is not proven existence.
      expect(loopCount()).toBe(0);
    } finally {
      restoreEnv("PATH", oldPath);
    }
  });

  test("flags sourceUnavailable when the source exits 0 with output we cannot parse", () => {
    const fakeTodos = withFakeTodosInspect(env.dataDir, "not-json-at-all", { status: 0 });
    try {
      const result = routeTodosTaskEvent(pendingTaskEvent(), { ...ROUTE_OPTS, todosProject: "/tmp/source-todos" });
      expect(result.kind).toBe("skipped");
      expect(result.value.sourceUnavailable).toBe(true);
      expect(result.value.sourceTaskResolution).toMatchObject({ resolved: false, sourceUnavailable: true });
      expect(loopCount()).toBe(0);
    } finally {
      fakeTodos.restore();
    }
  });

  test("flags sourceUnavailable when the source exits 0 with no output at all", () => {
    // Regression for #152: `JSON.parse(stdout || "{}")` manufactured a well-formed
    // empty record out of SILENCE, and the no-id branch then treated it as the
    // source answering — a benign exit-0 skip that @hasna/events filed as a
    // successful delivery. Strictly less information (nothing at all vs one space)
    // must never be classified as MORE definitive than whitespace.
    for (const stdout of ["", " ", "\n"]) {
      const fakeTodos = withFakeTodosInspect(env.dataDir, stdout, { status: 0 });
      try {
        const result = routeTodosTaskEvent(pendingTaskEvent(), { ...ROUTE_OPTS, todosProject: "/tmp/source-todos" });
        expect(result.kind).toBe("skipped");
        expect(result.value.sourceUnavailable).toBe(true);
        expect(String(result.value.reason)).toContain("could not ask the active todos source");
        expect(result.value.sourceTaskResolution).toMatchObject({ checked: true, resolved: false, sourceUnavailable: true });
        expect(loopCount()).toBe(0);
      } finally {
        fakeTodos.restore();
      }
    }
  });

  test("flags sourceUnavailable when the source exits 0 with a record that has no readable id", () => {
    // Regression for #152 (second branch): `{}`, `{"ok":true}`, and a data-wrapped
    // task all parse to a record with no id we can read — the source has told us
    // nothing about the requested task. The data-wrapped row is the alarming one:
    // an ordinary upstream envelope change (todosTaskRecord unwraps only `.task`)
    // would otherwise turn EVERY task event into an exit-0 silent drop. Definitive
    // outcomes are reserved for a readable id (see the mismatch test above).
    for (const stdout of [{}, { ok: true }, { data: { id: TASK_ID, status: "pending" } }]) {
      const fakeTodos = withFakeTodosInspect(env.dataDir, stdout, { status: 0 });
      try {
        const result = routeTodosTaskEvent(pendingTaskEvent(), { ...ROUTE_OPTS, todosProject: "/tmp/source-todos" });
        expect(result.kind).toBe("skipped");
        expect(result.value.sourceUnavailable).toBe(true);
        expect(result.value.sourceTaskResolution).toMatchObject({ checked: true, resolved: false, sourceUnavailable: true });
        expect(String((result.value.sourceTaskResolution as { error?: string }).error)).toContain("no readable task id");
        expect(loopCount()).toBe(0);
      } finally {
        fakeTodos.restore();
      }
    }
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

  test("a gate-death-ceiling dead-letter is NOT re-admitted even with refunded attempts", () => {
    routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS);
    // Ceiling'd item: attempts were refunded (0 — far under the redispatch
    // cap) and it aged past every backoff window. Without the guard the
    // bounded re-admission would requeue it straight back into the same
    // deterministic infrastructure fault.
    forceTerminal("dead_letter", { attempts: 0, gateDeaths: 20, ageMs: 24 * 60 * 60_000 });
    const result = routeTodosTaskEvent(pendingTaskEvent(), ROUTE_OPTS);
    expect(result.kind).toBe("deduped");
    expect(result.value.deadLettered).toBe(true);
    expect(workItemRow()?.status).toBe("dead_letter"); // parked until an operator requeues
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
      sourceTaskResolvedId: "task-checkout-a",
    });
    expect(first.kind).toBe("created");
    expect(first.value.idempotencyKey).toBe("todos-task:pr:hasna/example#7");

    const second = routeTodosTaskEvent(prTaskEvent("task-checkout-b"), {
      ...ROUTE_OPTS,
      sourceTodosProjectPath: "/repos/example-checkout-b",
      sourceTaskResolvedId: "task-checkout-b",
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
      { ...ROUTE_OPTS, sourceTodosProjectPath: "/repos/a", sourceTaskResolvedId: "task-mixed-case" },
    );
    expect(first.kind).toBe("created");
    expect(first.value.idempotencyKey).toBe("todos-task:pr:hasna/example#7");
  });

  test("non-PR tasks from different checkouts keep independent keys (no false dedupe)", () => {
    const first = routeTodosTaskEvent(plainTaskEvent("task-x"), { ...ROUTE_OPTS, sourceTodosProjectPath: "/repos/a", sourceTaskResolvedId: "task-x" });
    const second = routeTodosTaskEvent(plainTaskEvent("task-y"), { ...ROUTE_OPTS, sourceTodosProjectPath: "/repos/b", sourceTaskResolvedId: "task-y" });
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

describe("routeTodosTaskEvent operator-authoritative project-group admission", () => {
  let env: RouteEnv;
  beforeEach(() => {
    env = withRouteEnv();
  });
  afterEach(() => {
    env.restore();
  });

  function groupTaskEvent(taskId: string, fields: Record<string, unknown> = {}) {
    return {
      id: `evt-${taskId}`,
      type: "task.created",
      source: "todos",
      subject: `task:${taskId}`,
      data: {
        id: taskId,
        title: `Project-group task ${taskId}`,
        status: "pending",
        tags: ["auto:route"],
        project_path: process.cwd(),
        ...fields,
      },
    } as never;
  }

  test("metadata can only tighten a configured ceiling and accepts numeric or string integers", () => {
    const numeric = routeTodosTaskEvent(
      groupTaskEvent("metadata-numeric", { max_active_per_project_group: 2 }),
      { ...ROUTE_OPTS, dryRun: true, projectGroup: "operator-group", maxActivePerProjectGroup: "4" },
    );
    const numericValue = numeric.value as Record<string, any>;
    expect(numericValue.throttle.limits.maxActivePerProjectGroup).toBe(2);
    expect(numericValue.invocation.scope.routeThrottle.limits.maxActivePerProjectGroup).toBe(2);

    const string = routeTodosTaskEvent(
      groupTaskEvent("metadata-string", { max_active_per_project_group: "3" }),
      { ...ROUTE_OPTS, dryRun: true, projectGroup: "operator-group", maxActivePerProjectGroup: "4" },
    );
    const stringValue = string.value as Record<string, any>;
    expect(stringValue.throttle.limits.maxActivePerProjectGroup).toBe(3);

    const raised = routeTodosTaskEvent(
      groupTaskEvent("metadata-raised", { max_active_per_project_group: 40 }),
      { ...ROUTE_OPTS, dryRun: true, projectGroup: "operator-group", maxActivePerProjectGroup: "4" },
    );
    const raisedValue = raised.value as Record<string, any>;
    expect(raisedValue.throttle.limits.maxActivePerProjectGroup).toBe(4);

    const unconfigured = routeTodosTaskEvent(
      groupTaskEvent("metadata-unconfigured", { max_active_per_project_group: 1 }),
      { ...ROUTE_OPTS, dryRun: true, projectGroup: "operator-group" },
    );
    const unconfiguredValue = unconfigured.value as Record<string, any>;
    expect(unconfiguredValue.throttle).toBeUndefined();
    expect(unconfiguredValue.invocation.scope.routeThrottle.limits).toBeUndefined();
  });

  test("mixed siblings cannot omit or raise the configured cap or redirect its group", () => {
    const opts: TodosTaskRouteOptions = {
      ...ROUTE_OPTS,
      projectGroup: "operator-group",
      maxActivePerProjectGroup: "1",
    };

    const first = routeTodosTaskEvent(
      groupTaskEvent("mixed-first", {
        project_group: "metadata-group",
        max_active_per_project_group: 1,
      }),
      opts,
    );
    const firstValue = first.value as Record<string, any>;
    expect(first.kind).toBe("created");
    expect(firstValue.workItem.projectGroup).toBe("operator-group");
    expect(firstValue.invocation.scope.routeThrottle).toBeUndefined();
    const store = new Store(dbPath());
    try {
      expect(store.getWorkflowInvocation(firstValue.invocation.id)?.scope?.routeThrottle).toMatchObject({
        projectGroup: "operator-group",
        limits: { maxActivePerProjectGroup: 1 },
      });
    } finally {
      store.close();
    }

    const omitted = routeTodosTaskEvent(
      groupTaskEvent("mixed-omitted", { project_group: "different-metadata-group" }),
      opts,
    );
    const raisedString = routeTodosTaskEvent(
      groupTaskEvent("mixed-raised-string", {
        project_group: "different-metadata-group",
        max_active_per_project_group: "50",
      }),
      opts,
    );
    const raisedNumeric = routeTodosTaskEvent(
      groupTaskEvent("mixed-raised-numeric", {
        project_group: "different-metadata-group",
        max_active_per_project_group: 50,
      }),
      opts,
    );

    for (const result of [omitted, raisedString, raisedNumeric]) {
      const value = result.value as Record<string, any>;
      expect(result.kind).toBe("throttled");
      expect(value.reason).toContain("project-group active workflow limit reached (1/1)");
      expect(value.workItem.projectGroup).toBe("operator-group");
      expect(value.throttle).toMatchObject({
        projectGroup: "operator-group",
        limits: { maxActivePerProjectGroup: 1 },
        counts: { projectGroup: 1 },
      });
    }
  });

  test("concurrent admissions against one local store serialize under the group cap", async () => {
    const store = new Store(dbPath());
    store.close();
    const binDir = join(env.dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"inspect\" ]]; then",
        "    task_id=\"${@: -1}\"",
        "    printf '{\"id\":\"%s\",\"status\":\"pending\",\"tags\":[\"auto:route\"]}' \"$task_id\"",
        "    exit 0",
        "  fi",
        "done",
        "printf 'unexpected todos command: %s\\n' \"$*\" >&2",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const cliPath = join(import.meta.dir, "../../cli/index.ts");
    const argsFor = (taskId: string) => [
      process.execPath,
      cliPath,
      "--json",
      "routes",
      "create",
      "todos-task",
      "--event-json",
      JSON.stringify(groupTaskEvent(taskId)),
      "--project-group",
      "operator-group",
      "--max-active-per-project-group",
      "1",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ];
    const run = async (taskId: string) => {
      const child = Bun.spawn(argsFor(taskId), {
        cwd: process.cwd(),
        env: {
          ...process.env,
          LOOPS_DATA_DIR: env.dataDir,
          HASNA_LOOPS_API_URL: "",
          HASNA_LOOPS_API_KEY: "",
          // Local file store requires the explicit opt-in (fail-closed policy).
          HASNA_LOOPS_CONNECTION: "file",
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { stdout, stderr, exitCode };
    };

    const attempts = await Promise.all([run("concurrent-a"), run("concurrent-b")]);
    for (const attempt of attempts) {
      expect(attempt.exitCode, attempt.stderr).toBe(0);
    }
    const values = attempts.map((attempt) => JSON.parse(attempt.stdout));
    expect(values.filter((value) => value.deduped === false)).toHaveLength(1);
    expect(values.filter((value) => value.skipped === true)).toHaveLength(1);
    expect(values.find((value) => value.skipped === true)?.reason).toContain(
      "project-group active workflow limit reached (1/1)",
    );
    expect(loopCount()).toBe(1);
  }, 15_000);
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

  function seedRunningAccount(profile: string, tag: string): void {
    const store = new Store(dbPath());
    try {
      const workflow = store.createWorkflow({
        name: `seed-account-${tag}`,
        steps: [{
          id: "worker",
          target: {
            type: "agent",
            provider: "codewith",
            prompt: "seeded",
            sandbox: "workspace-write",
            account: { profile, tool: "codewith" },
          },
        }],
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

  test("dry-run reports load-aware worker and verifier accounts without dispatching", () => {
    seedRunningAccount("acctB", "a1");
    seedRunningAccount("acctB", "a2");
    seedRunningAccount("acctC", "a3");
    const result = routeTodosTaskEvent(plainTaskEvent("account-dry-run"), {
      ...ROUTE_OPTS,
      accountPool: "acctA,acctB,acctC",
      workerAccount: "acctA",
      accountTool: "codewith",
      dryRun: true,
    });

    expect(result.kind).toBe("created");
    expect(result.value.accountSelection).toEqual({
      worker: { profile: "acctA", tool: "codewith" },
      verifier: { profile: "acctC", tool: "codewith" },
      loads: { acctA: 0, acctB: 2, acctC: 1 },
    });
    expect(loopCount()).toBe(0);
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
