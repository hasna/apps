import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { getTaskCheckpoints } from "../db/checkpoints.js";
import { createTask, getTask } from "../db/tasks.js";
import { TaskRunner, runTask } from "./task-runner.js";

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

describe("TaskRunner initialization", () => {
  it("records ordered checkpoints and retry limits", () => {
    const task = createTask({ title: "Run a multi-step task" }, db);
    const runner = new TaskRunner({
      agent_id: "codex",
      retry_strategy: { type: "fixed", delay_ms: 0, max_attempts: 3 },
    }, db);

    const initialized = runner.init(task.id, [
      { name: "inspect" },
      { name: "verify", max_attempts: 2 },
    ]);

    expect(initialized).toMatchObject({
      runner_id: "codex",
      current_step: "inspect",
      total_steps: 2,
    });
    expect(getTaskCheckpoints(task.id, db).map((checkpoint) => ({
      step: checkpoint.step,
      status: checkpoint.status,
      max_attempts: checkpoint.max_attempts,
    }))).toEqual([
      { step: "inspect", status: "pending", max_attempts: 3 },
      { step: "verify", status: "pending", max_attempts: 2 },
    ]);
  });

  it("supports an empty step list and rejects a missing task", () => {
    const task = createTask({ title: "No-op task" }, db);
    const runner = new TaskRunner({ agent_id: "codex" }, db);

    expect(runner.init(task.id, [])).toMatchObject({
      current_step: null,
      total_steps: 0,
    });
    expect(getTaskCheckpoints(task.id, db)).toEqual([]);
    expect(() => runner.init("missing-task", [])).toThrow("Task missing-task not found");
  });
});

describe("TaskRunner execution", () => {
  it("runs completed and skipped steps with observable progress and heartbeats", async () => {
    const task = createTask({ title: "Execute steps" }, db);
    const runner = new TaskRunner({ agent_id: "codex" }, db);
    runner.init(task.id, [{ name: "build" }, { name: "optional" }]);

    const result = await runner.run(task.id, new Map([
      ["build", (context) => {
        expect(context).toMatchObject({
          agent_id: "codex",
          step_name: "build",
          attempt: 1,
        });
        context.emitHeartbeat({ message: "building", progress: 0.5 });
        return { status: "completed" as const, data: { output: "dist" } };
      }],
      ["optional", () => ({ status: "skipped" as const })],
    ]));

    expect(result).toEqual({
      success: true,
      steps: [
        { status: "completed", data: { output: "dist" } },
        { status: "skipped" },
      ],
    });
    expect(runner.progress(task.id)).toMatchObject({
      total_steps: 2,
      completed_steps: 1,
      failed_steps: 0,
      pending_steps: 0,
    });
    expect(runner.lastHeartbeat(task.id)).toMatchObject({
      agent_id: "codex",
      step: "build",
      message: "building",
      progress: 0.5,
    });
  });

  it("records missing and throwing step handlers as failures", async () => {
    const missingHandlerTask = createTask({ title: "Missing handler" }, db);
    const missingHandlerRunner = new TaskRunner({ agent_id: "codex" }, db);
    missingHandlerRunner.init(missingHandlerTask.id, [{ name: "unhandled" }]);

    expect(await missingHandlerRunner.run(missingHandlerTask.id, new Map())).toEqual({
      success: false,
      steps: [{ status: "failed", error: "No handler for step: unhandled" }],
    });
    expect(getTaskCheckpoints(missingHandlerTask.id, db)[0]).toMatchObject({
      status: "failed",
      error: "No handler for step: unhandled",
    });

    const throwingTask = createTask({ title: "Throwing handler" }, db);
    const throwingRunner = new TaskRunner({ agent_id: "codex" }, db);
    throwingRunner.init(throwingTask.id, [{ name: "explode" }]);
    const thrown = await throwingRunner.run(throwingTask.id, new Map([
      ["explode", () => { throw new Error("step exploded"); }],
    ]));

    expect(thrown).toEqual({
      success: false,
      steps: [{ status: "failed", error: "step exploded" }],
    });
    expect(getTaskCheckpoints(throwingTask.id, db)[0]).toMatchObject({
      status: "failed",
      error: "step exploded",
      attempt: 2,
    });
  });

  it("skips remaining work after abort and rejects an unknown task", async () => {
    const task = createTask({ title: "Abort before execution" }, db);
    const runner = new TaskRunner({ agent_id: "codex" }, db);
    runner.init(task.id, [{ name: "first" }, { name: "second" }]);
    runner.abort();

    expect(runner.aborted).toBe(true);
    expect(await runner.run(task.id, new Map())).toEqual({ success: true, steps: [] });
    expect(getTaskCheckpoints(task.id, db).map((checkpoint) => checkpoint.status)).toEqual([
      "skipped",
      "skipped",
    ]);
    await expect(runner.run("missing-task", new Map())).rejects.toThrow("Task missing-task not found");
  });

  it("starts and stops periodic heartbeats", async () => {
    const task = createTask({ title: "Heartbeat task" }, db);
    const runner = new TaskRunner({ agent_id: "codex", heartbeat_interval_ms: 5 }, db);

    runner.startHeartbeat(task.id);
    await Bun.sleep(30);
    runner.stopHeartbeat();

    expect(runner.lastHeartbeat(task.id)).toMatchObject({
      agent_id: "codex",
      message: "alive",
      meta: { step_index: 0, aborted: false },
    });
    const countAfterStop = (db.query(
      "SELECT COUNT(*) AS count FROM task_heartbeats WHERE task_id = ?",
    ).get(task.id) as { count: number }).count;
    await Bun.sleep(15);
    const finalCount = (db.query(
      "SELECT COUNT(*) AS count FROM task_heartbeats WHERE task_id = ?",
    ).get(task.id) as { count: number }).count;
    expect(finalCount).toBe(countAfterStop);
  });
});

describe("TaskRunner lifecycle helpers", () => {
  it("completes and fails runs with durable task state", () => {
    const completedTask = createTask({ title: "Complete runner task" }, db);
    const completeRunner = new TaskRunner({ agent_id: "codex" }, db);
    completeRunner.init(completedTask.id, [{ name: "done" }]);

    expect(completeRunner.complete(completedTask.id).status).toBe("completed");
    expect(getTask(completedTask.id, db)).toMatchObject({
      status: "completed",
      current_step: null,
    });
    expect(completeRunner.lastHeartbeat(completedTask.id)).toMatchObject({
      message: "run completed",
      progress: 1,
    });

    const failedTask = createTask({ title: "Fail runner task" }, db);
    const failRunner = new TaskRunner({ agent_id: "codex" }, db);
    failRunner.init(failedTask.id, [{ name: "broken" }]);

    expect(failRunner.fail(failedTask.id, "verification failed").task).toMatchObject({
      status: "failed",
      metadata: {
        _failure: expect.objectContaining({
          reason: "verification failed",
          failed_by: "codex",
          retry_requested: false,
        }),
      },
    });
    expect(getTask(failedTask.id, db)?.runner_completed_at).toBeTruthy();
  });

  it("runTask claims an existing task and rejects a missing task", () => {
    const task = createTask({ title: "Claim through runTask" }, db);

    const result = runTask(task.id, { agent_id: "codex" });

    expect(result.runner).toBeInstanceOf(TaskRunner);
    expect(result.task).toMatchObject({
      status: "in_progress",
      assigned_to: "codex",
      locked_by: "codex",
    });
    expect(() => runTask("missing-task", { agent_id: "codex" })).toThrow();
  });
});
