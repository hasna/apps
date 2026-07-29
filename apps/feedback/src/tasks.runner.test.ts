import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultCommandRunner, createTaskSink, resolveTaskSinkConfig } from "./tasks.js";
import { LocalFeedbackStore } from "./storage.js";

async function script(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "open-feedback-runner-"));
  const path = join(dir, "fake-todos");
  await writeFile(path, `#!/usr/bin/env bash\n${body}\n`, "utf8");
  await chmod(path, 0o755);
  return path;
}

const savedEnv = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

/**
 * The real subprocess path had no coverage at all: every sink test injected a
 * fake runner, so spawn, timeout, stdin, and buffering were never exercised.
 */
describe("defaultCommandRunner (the real spawn)", () => {
  test("captures stdout, stderr, and the exit code", async () => {
    const path = await script('echo "out"; echo "err" >&2; exit 3');
    const result = await defaultCommandRunner(path, []);
    expect(result.code).toBe(3);
    expect(result.stdout).toContain("out");
    expect(result.stderr).toContain("err");
  });

  test("passes stdin through", async () => {
    const path = await script("cat");
    const result = await defaultCommandRunner(path, [], { input: "hello-stdin" });
    expect(result.stdout).toContain("hello-stdin");
  });

  test("a child that reads stdin gets EOF rather than blocking forever", async () => {
    const path = await script('read -r line || true; echo "done"');
    const result = await defaultCommandRunner(path, [], { timeoutMs: 5_000 });
    expect(result.stdout).toContain("done");
  });

  test("a hung child is killed at the timeout instead of hanging capture forever", async () => {
    const path = await script("sleep 30");
    const started = Date.now();
    await expect(defaultCommandRunner(path, [], { timeoutMs: 300 })).rejects.toThrow(/timed out after 300ms/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test("a missing binary rejects rather than resolving with a phantom success", async () => {
    await expect(defaultCommandRunner("/nonexistent/definitely-not-here", [])).rejects.toThrow();
  });

  /**
   * Rejecting the promise is not enough: a killed shell can orphan a
   * grandchild that still holds the inherited stdio pipes, which keeps OUR
   * event loop open. Measured before the process-group kill: the timeout fired
   * at 1s and the process still exited at 61s. Only a real process exit
   * measures this, so this test spawns one.
   */
  test("the whole process exits promptly after a timeout, not when the grandchild finally dies", async () => {
    const hang = await script("sleep 60");
    const dir = await mkdtemp(join(tmpdir(), "open-feedback-exit-"));
    const runnerPath = join(dir, "run.ts");
    await writeFile(
      runnerPath,
      `import { defaultCommandRunner } from ${JSON.stringify(join(import.meta.dir, "tasks.ts"))};\n` +
        `await defaultCommandRunner(${JSON.stringify(hang)}, [], { timeoutMs: 500 }).catch(() => {});\n`,
      "utf8",
    );

    const started = Date.now();
    const proc = Bun.spawn(["bun", "run", runnerPath], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    const elapsed = Date.now() - started;

    // Generous bound: the point is "seconds, not a minute".
    expect(elapsed).toBeLessThan(15_000);
  }, 70_000);

  test("handles output larger than a single pipe buffer", async () => {
    const path = await script('printf "%0.sX" $(seq 1 200000); echo');
    const result = await defaultCommandRunner(path, []);
    expect(result.stdout.length).toBeGreaterThan(190_000);
  });
});

/**
 * The wire from environment config through to a store was never built in any
 * test — every store was handed an explicit sink. That is the actual
 * production path.
 */
describe("environment-resolved sink, end to end through a real store", () => {
  test("a store with no injected sink resolves one from the env and files a task", async () => {
    const fake = await script(`echo '{"id":"env-resolved-1","short_id":"ENV-1"}'`);
    process.env["FEEDBACK_TASK_SINK"] = "todos";
    process.env["FEEDBACK_TASK_BIN"] = fake;

    const dataDir = await mkdtemp(join(tmpdir(), "open-feedback-envwire-"));
    // No taskSink passed: it must come from resolveTaskSinkConfig().
    const store = new LocalFeedbackStore({ dataDir, eventSink: null });
    const item = await store.createFeedback({ appId: "app-a", message: "env wired" });

    expect(item.taskRef?.taskId).toBe("env-resolved-1");
    expect(item.taskRef?.shortId).toBe("ENV-1");

    const reread = await new LocalFeedbackStore({ dataDir, eventSink: null, taskSink: null }).getFeedback(item.id);
    expect(reread?.taskRef?.taskId).toBe("env-resolved-1");
  });

  test("a real subprocess failure with a huge stderr does not brick the store", async () => {
    // This is the exact shape of the store-bricking defect: a verbose crash.
    const fake = await script('printf "%0.sE" $(seq 1 20000) >&2; exit 1');
    process.env["FEEDBACK_TASK_SINK"] = "todos";
    process.env["FEEDBACK_TASK_BIN"] = fake;

    const dataDir = await mkdtemp(join(tmpdir(), "open-feedback-envfail-"));
    const store = new LocalFeedbackStore({ dataDir, eventSink: null });
    const item = await store.createFeedback({ appId: "app-a", message: "verbose crash" });

    expect(item.taskError).toBeTruthy();
    expect(item.taskError!.length).toBeLessThanOrEqual(4096);
    // The store must remain fully usable.
    expect(await store.listFeedback()).toHaveLength(1);
    await expect(store.createFeedback({ appId: "app-a", message: "after" })).resolves.toBeTruthy();
    expect(await store.listFeedback()).toHaveLength(2);
  });

  test("auto stays silent when no task CLI exists, rather than failing the write", async () => {
    process.env["FEEDBACK_TASK_SINK"] = "auto";
    process.env["FEEDBACK_TASK_BIN"] = "definitely-not-a-real-binary-xyz";

    const dataDir = await mkdtemp(join(tmpdir(), "open-feedback-autonone-"));
    const store = new LocalFeedbackStore({ dataDir, eventSink: null });
    const item = await store.createFeedback({ appId: "app-a", message: "no tracker here" });

    expect(item.taskRef).toBeUndefined();
    expect(item.taskError).toBeUndefined();
    expect(await store.listFeedback()).toHaveLength(1);
  });

  test("a timeout is recorded as a task error, not left as a hang or a lost report", async () => {
    const fake = await script("sleep 30");
    process.env["FEEDBACK_TASK_SINK"] = "todos";
    process.env["FEEDBACK_TASK_BIN"] = fake;
    process.env["FEEDBACK_TASK_TIMEOUT_MS"] = "300";

    const dataDir = await mkdtemp(join(tmpdir(), "open-feedback-timeout-"));
    const store = new LocalFeedbackStore({ dataDir, eventSink: null });
    const item = await store.createFeedback({ appId: "app-a", message: "tracker hung" });

    expect(item.taskError).toMatch(/timed out/);
    expect(await store.listFeedback()).toHaveLength(1);
  }, 15_000);
});

describe("timeout is configurable and validated", () => {
  test("FEEDBACK_TASK_TIMEOUT_MS is honoured", () => {
    const config = resolveTaskSinkConfig({ env: { FEEDBACK_TASK_TIMEOUT_MS: "2500" }, findBinary: () => "/usr/bin/todos" });
    expect(config.timeoutMs).toBe(2500);
    expect(config.blockers).toEqual([]);
  });

  test("a nonsense timeout is a blocker, not a silent zero", () => {
    const config = resolveTaskSinkConfig({ env: { FEEDBACK_TASK_TIMEOUT_MS: "0" }, findBinary: () => "/usr/bin/todos" });
    expect(config.blockers.join(" ")).toContain("FEEDBACK_TASK_TIMEOUT_MS");
    expect(config.timeoutMs).toBeGreaterThan(0);
  });

  test("the configured timeout actually reaches the runner", async () => {
    let seen: number | undefined;
    const sink = createTaskSink({
      config: resolveTaskSinkConfig({
        env: { FEEDBACK_TASK_TIMEOUT_MS: "1234" },
        findBinary: () => "/usr/bin/todos",
      }),
      run: async (_command, _args, options) => {
        seen = options?.timeoutMs;
        return { code: 0, stdout: JSON.stringify({ id: "x" }), stderr: "" };
      },
    });
    await sink!.createTask({
      id: "f1",
      appId: "a",
      message: "m",
      createdAt: "2026-07-29T10:00:00.000Z",
      updatedAt: "2026-07-29T10:00:00.000Z",
      status: "new",
      source: "cli",
      kind: "other",
      tags: [],
    });
    expect(seen).toBe(1234);
  });
});
