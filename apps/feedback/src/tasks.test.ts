import { describe, expect, test } from "bun:test";
import {
  buildTaskDraft,
  createTaskSink,
  describeTaskSinkRuntime,
  resolveTaskSinkConfig,
} from "./tasks.js";
import type { CommandResult, CommandRunner } from "./tasks.js";
import type { FeedbackItem } from "./types.js";

function item(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: "feedback-id-1",
    appId: "platform-alumia",
    message: "Export button throws 500 on large orgs",
    createdAt: "2026-07-29T10:00:00.000Z",
    updatedAt: "2026-07-29T10:00:00.000Z",
    status: "new",
    source: "cli",
    kind: "bug",
    tags: ["export"],
    ...overrides,
  };
}

function runner(result: Partial<CommandResult> = {}): { run: CommandRunner; calls: { command: string; args: string[] }[] } {
  const calls: { command: string; args: string[] }[] = [];
  const run: CommandRunner = async (command, args) => {
    calls.push({ command, args });
    return { code: 0, stdout: JSON.stringify({ id: "task-uuid-1", short_id: "ALU-00042" }), stderr: "", ...result };
  };
  return { run, calls };
}

describe("resolveTaskSinkConfig", () => {
  test("auto resolves to todos when the todos binary is discoverable", () => {
    const config = resolveTaskSinkConfig({ env: {}, findBinary: () => "/usr/bin/todos" });
    expect(config.requested).toBe("auto");
    expect(config.kind).toBe("todos");
    expect(config.binary).toBe("/usr/bin/todos");
  });

  test("auto degrades to none when no todos binary exists, without blocking", () => {
    const config = resolveTaskSinkConfig({ env: {}, findBinary: () => null });
    expect(config.kind).toBe("none");
    expect(config.blockers).toEqual([]);
  });

  test("explicit todos with no binary is a blocker, not a silent downgrade", () => {
    const config = resolveTaskSinkConfig({ env: { FEEDBACK_TASK_SINK: "todos" }, findBinary: () => null });
    expect(config.kind).toBe("todos");
    expect(config.blockers.length).toBeGreaterThan(0);
  });

  test("none disables task creation even when todos is present", () => {
    const config = resolveTaskSinkConfig({ env: { FEEDBACK_TASK_SINK: "none" }, findBinary: () => "/usr/bin/todos" });
    expect(config.kind).toBe("none");
  });

  test("an unsupported sink value is reported, never silently ignored", () => {
    const config = resolveTaskSinkConfig({ env: { FEEDBACK_TASK_SINK: "jira" }, findBinary: () => "/usr/bin/todos" });
    expect(config.kind).toBe("invalid");
    expect(config.blockers.join(" ")).toContain("FEEDBACK_TASK_SINK");
  });

  test("the blocker never echoes the configured value back — doctor output gets pasted around", () => {
    const config = resolveTaskSinkConfig({
      env: { FEEDBACK_TASK_SINK: "https://user:hunter2@example.test/hook" },
      findBinary: () => null,
    });
    expect(config.kind).toBe("invalid");
    expect(JSON.stringify(config.blockers)).not.toContain("hunter2");
  });

  test("project map routes per appId and beats the flat default", () => {
    const config = resolveTaskSinkConfig({
      env: {
        FEEDBACK_TASK_PROJECT: "fallback-project",
        FEEDBACK_TASK_PROJECT_MAP: JSON.stringify({ "platform-alumia": "alumia" }),
      },
      findBinary: () => "/usr/bin/todos",
    });
    expect(config.projectFor("platform-alumia")).toBe("alumia");
    expect(config.projectFor("platform-todos")).toBe("fallback-project");
  });

  test("malformed project map is a blocker rather than a crash", () => {
    const config = resolveTaskSinkConfig({
      env: { FEEDBACK_TASK_PROJECT_MAP: "{not json" },
      findBinary: () => "/usr/bin/todos",
    });
    expect(config.blockers.join(" ")).toContain("FEEDBACK_TASK_PROJECT_MAP");
  });
});

describe("buildTaskDraft", () => {
  test("carries the feedback id so the task is traceable back to its report", () => {
    const draft = buildTaskDraft(item(), resolveTaskSinkConfig({ env: {}, findBinary: () => "/usr/bin/todos" }));
    expect(draft.description).toContain("feedback-id-1");
    expect(draft.description).toContain("feedback show feedback-id-1");
  });

  test("title is prefixed with the reporting app and summarises the message", () => {
    const draft = buildTaskDraft(item(), resolveTaskSinkConfig({ env: {}, findBinary: () => "/usr/bin/todos" }));
    expect(draft.title).toBe("[feedback:platform-alumia] Export button throws 500 on large orgs");
  });

  test("a multi-line message collapses to its first line in the title but survives in full in the body", () => {
    const draft = buildTaskDraft(
      item({ message: "First line\nsecond line with detail" }),
      resolveTaskSinkConfig({ env: {}, findBinary: () => "/usr/bin/todos" }),
    );
    expect(draft.title).toBe("[feedback:platform-alumia] First line");
    expect(draft.description).toContain("second line with detail");
  });

  test("severity drives priority, and a bug without severity is not filed as trivial", () => {
    const config = resolveTaskSinkConfig({ env: {}, findBinary: () => "/usr/bin/todos" });
    expect(buildTaskDraft(item({ severity: "critical" }), config).priority).toBe("critical");
    expect(buildTaskDraft(item({ severity: "low" }), config).priority).toBe("low");
    expect(buildTaskDraft(item({ kind: "bug", severity: undefined }), config).priority).toBe("medium");
    expect(buildTaskDraft(item({ kind: "praise", severity: undefined }), config).priority).toBe("low");
  });

  test("priority map is overridable without touching code", () => {
    const config = resolveTaskSinkConfig({
      env: { FEEDBACK_TASK_PRIORITY_MAP: JSON.stringify({ low: "high" }) },
      findBinary: () => "/usr/bin/todos",
    });
    expect(buildTaskDraft(item({ severity: "low" }), config).priority).toBe("high");
  });

  test("tags include a stable feedback marker plus the app, and configured extras", () => {
    const config = resolveTaskSinkConfig({
      env: { FEEDBACK_TASK_TAGS: "from-feedback,auto" },
      findBinary: () => "/usr/bin/todos",
    });
    const draft = buildTaskDraft(item(), config);
    expect(draft.tags).toContain("feedback");
    expect(draft.tags).toContain("app:platform-alumia");
    expect(draft.tags).toContain("from-feedback");
    expect(draft.tags).toContain("auto");
  });
});

describe("todos task sink", () => {
  test("creates a task and returns the id the todos CLI reported", async () => {
    const { run, calls } = runner();
    const sink = createTaskSink({
      config: resolveTaskSinkConfig({ env: {}, findBinary: () => "/usr/bin/todos" }),
      run,
    });
    const ref = await sink!.createTask(item());
    expect(ref.taskId).toBe("task-uuid-1");
    expect(ref.shortId).toBe("ALU-00042");
    expect(ref.provider).toBe("todos");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("/usr/bin/todos");
    // -j must precede the subcommand: it is a global flag on the todos CLI.
    expect(calls[0]!.args.indexOf("-j")).toBeLessThan(calls[0]!.args.indexOf("add"));
  });

  test("passes the resolved project through to todos", async () => {
    const { run, calls } = runner();
    const sink = createTaskSink({
      config: resolveTaskSinkConfig({
        env: { FEEDBACK_TASK_PROJECT_MAP: JSON.stringify({ "platform-alumia": "alumia" }) },
        findBinary: () => "/usr/bin/todos",
      }),
      run,
    });
    await sink!.createTask(item());
    const args = calls[0]!.args;
    expect(args[args.indexOf("--project") + 1]).toBe("alumia");
  });

  test("omits --project entirely when none is configured", async () => {
    const { run, calls } = runner();
    const sink = createTaskSink({
      config: resolveTaskSinkConfig({ env: {}, findBinary: () => "/usr/bin/todos" }),
      run,
    });
    await sink!.createTask(item());
    expect(calls[0]!.args).not.toContain("--project");
  });

  test("a non-zero todos exit surfaces as an error carrying stderr", async () => {
    const { run } = runner({ code: 1, stdout: "", stderr: "Project not found: nope" });
    const sink = createTaskSink({
      config: resolveTaskSinkConfig({ env: {}, findBinary: () => "/usr/bin/todos" }),
      run,
    });
    await expect(sink!.createTask(item())).rejects.toThrow(/Project not found: nope/);
  });

  test("todos exiting 0 with unparseable output is an error, not a phantom success", async () => {
    const { run } = runner({ code: 0, stdout: "Task created: ALU-1\n", stderr: "" });
    const sink = createTaskSink({
      config: resolveTaskSinkConfig({ env: {}, findBinary: () => "/usr/bin/todos" }),
      run,
    });
    await expect(sink!.createTask(item())).rejects.toThrow();
  });

  test("todos exiting 0 with JSON that has no id is an error", async () => {
    const { run } = runner({ code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" });
    const sink = createTaskSink({
      config: resolveTaskSinkConfig({ env: {}, findBinary: () => "/usr/bin/todos" }),
      run,
    });
    await expect(sink!.createTask(item())).rejects.toThrow();
  });

  test("sink is null when disabled, so callers can skip work entirely", () => {
    const sink = createTaskSink({
      config: resolveTaskSinkConfig({ env: { FEEDBACK_TASK_SINK: "none" }, findBinary: () => null }),
      run: runner().run,
    });
    expect(sink).toBeNull();
  });
});

describe("custom command sink", () => {
  test("runs an operator-supplied command and reads its json id", async () => {
    const { run, calls } = runner({ stdout: JSON.stringify({ id: "EXT-9" }) });
    const sink = createTaskSink({
      config: resolveTaskSinkConfig({
        env: { FEEDBACK_TASK_SINK: "command", FEEDBACK_TASK_COMMAND: JSON.stringify(["file-issue", "--from-stdin"]) },
        findBinary: () => null,
      }),
      run,
    });
    const ref = await sink!.createTask(item());
    expect(calls[0]!.command).toBe("file-issue");
    expect(calls[0]!.args).toEqual(["--from-stdin"]);
    expect(ref.taskId).toBe("EXT-9");
  });

  test("command sink without a command configured is a blocker", () => {
    const config = resolveTaskSinkConfig({ env: { FEEDBACK_TASK_SINK: "command" }, findBinary: () => null });
    expect(config.blockers.join(" ")).toContain("FEEDBACK_TASK_COMMAND");
  });
});

describe("describeTaskSinkRuntime", () => {
  test("reports the active provider so doctor can show it", () => {
    const runtime = describeTaskSinkRuntime({ env: {}, findBinary: () => "/usr/bin/todos" });
    expect(runtime.kind).toBe("todos");
    expect(runtime.enabled).toBe(true);
    expect(runtime.ok).toBe(true);
  });

  test("reports not-ok when an explicitly requested sink cannot run", () => {
    const runtime = describeTaskSinkRuntime({ env: { FEEDBACK_TASK_SINK: "todos" }, findBinary: () => null });
    expect(runtime.ok).toBe(false);
    expect(runtime.blockers.length).toBeGreaterThan(0);
  });
});
