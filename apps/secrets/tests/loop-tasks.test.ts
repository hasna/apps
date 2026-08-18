import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  upsertSecurityTaskSuggestions,
  writeSecureLoopReport,
  type TodosRunner,
} from "../src/loop-tasks.js";
import type { SecurityTaskSuggestion } from "../src/security.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("loop task helpers", () => {
  it("upserts security task suggestions through the todos CLI contract", () => {
    const calls: string[][] = [];
    const tasks: Array<{ id: string; status: string; description: string }> = [];
    const runner: TodosRunner = (args) => {
      calls.push(args);
      if (args.includes("task-lists") && !args.includes("--add")) return { status: 0, stdout: "", stderr: "" };
      if (args.includes("task-lists") && args.includes("--add")) return { status: 0, stdout: "created", stderr: "" };
      if (args.includes("search")) {
        const fingerprint = args[args.indexOf("search") + 1]!;
        return {
          status: 0,
          stdout: JSON.stringify(tasks.filter((task) => task.description.includes(fingerprint))),
          stderr: "",
        };
      }
      if (args.includes("add")) {
        const description = args[args.indexOf("-d") + 1]!;
        const task = { id: `task-${tasks.length + 1}`, status: "pending", description };
        tasks.push(task);
        return { status: 0, stdout: JSON.stringify(task), stderr: "" };
      }
      return { status: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
    };
    const suggestion = makeSuggestion("secret-permission:one");

    const result = upsertSecurityTaskSuggestions([suggestion, suggestion], {
      project: "/home/hasna/.hasna/loops",
      taskList: "secret-file-permissions",
      taskListName: "Secret File Permissions",
      taskListDescription: "permission work",
      maxActions: 5,
      runner,
    });

    expect(result.summary.created).toBe(1);
    expect(result.summary.skipped).toBe(1);
    expect(result.summary.errors).toBe(0);
    expect(tasks[0]!.description).toContain("Fingerprint: secret-permission:one");
    expect(calls.some((args) => args.includes("task-lists") && args.includes("--add"))).toBe(true);
  });

  it("does not recreate active existing tasks and does not starve new tasks behind them", () => {
    const added: string[] = [];
    const runner: TodosRunner = (args) => {
      if (args.includes("task-lists")) return { status: 0, stdout: "secret-file-permissions", stderr: "" };
      if (args.includes("search")) {
        const fingerprint = args[args.indexOf("search") + 1]!;
        if (fingerprint === "secret-permission:existing") {
          return {
            status: 0,
            stdout: JSON.stringify([
              { id: "done-task", status: "done" },
              { id: "active-task", status: "in_progress" },
            ]),
            stderr: "",
          };
        }
        return { status: 0, stdout: "[]", stderr: "" };
      }
      if (args.includes("add")) {
        const title = args[args.indexOf("add") + 1]!;
        added.push(title);
        return { status: 0, stdout: JSON.stringify({ id: "created-task", status: "pending" }), stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "unexpected" };
    };

    const result = upsertSecurityTaskSuggestions([
      makeSuggestion("secret-permission:existing"),
      makeSuggestion("secret-permission:new"),
      makeSuggestion("secret-permission:skipped"),
    ], {
      project: "/home/hasna/.hasna/loops",
      taskList: "secret-file-permissions",
      taskListName: "Secret File Permissions",
      taskListDescription: "permission work",
      maxActions: 1,
      runner,
    });

    expect(result.summary.existing).toBe(1);
    expect(result.summary.created).toBe(1);
    expect(result.summary.skipped).toBe(1);
    expect(result.actions.map((action) => action.action)).toEqual(["exists", "created", "skipped"]);
    expect(result.actions[0]).toMatchObject({ task_id: "active-task" });
    expect(added).toHaveLength(1);
  });

  it("writes private loop report JSON and can annotate its report path", () => {
    const dir = mkdtempSync(join(tmpdir(), "secrets-loop-report-"));
    tempDirs.push(dir);

    const path = writeSecureLoopReport({ ok: true, loop: {} }, {
      reportDir: dir,
      prefix: "permissions",
      annotatePath: true,
    });
    const parsed = JSON.parse(readFileSync(path!, "utf8")) as { loop: { report_path: string } };

    expect(parsed.loop.report_path).toBe(path);
    expect(statSync(path!).mode & 0o777).toBe(0o600);
  });
});

function makeSuggestion(fingerprint: string): SecurityTaskSuggestion {
  return {
    fingerprint,
    title: `Fix ${fingerprint}`,
    body: "Sensitive file has unsafe permissions.\nPath: /tmp/.env",
    priority: "high",
    tags: ["auto:route", "area:security", "secret-permissions"],
    metadata: { source: "test" },
  };
}
