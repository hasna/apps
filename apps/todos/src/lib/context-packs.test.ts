import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { addComment } from "../db/comments.js";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { addTaskVerification, linkTaskToCommit } from "../db/task-commits.js";
import { addTaskFile } from "../db/task-files.js";
import { addDependency } from "../db/task-graph.js";
import { addTaskRunCommand, addTaskRunFile, finishTaskRun, startTaskRun } from "../db/task-runs.js";
import { createTask } from "../db/tasks.js";
import { createAgentContextPack, renderAgentContextPackMarkdown } from "./context-packs.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("local agent context packs", () => {
  test("builds a redacted deterministic JSON pack from local task evidence", () => {
    const db = getDatabase();
    const project = createProject({ name: "Context Project", path: "/tmp/context" }, db);
    const plan = createPlan({ name: "Release plan", project_id: project.id, agent_id: "codex" }, db);
    const blocker = createTask({ title: "Finish dependency", status: "completed", project_id: project.id }, db);
    const task = createTask({
      title: "Ship context packs",
      description: "Use password=abc123456789 only in tests",
      project_id: project.id,
      plan_id: plan.id,
      tags: ["agent", "context"],
      metadata: { acceptance_criteria: ["Markdown output", "JSON output"] },
    }, db);
    addDependency(task.id, blocker.id, db);
    addComment({ task_id: task.id, agent_id: "codex", content: "Token bearer secret123456789 should redact" }, db);
    addTaskFile({ task_id: task.id, path: "src/lib/context-packs.ts", status: "planned", agent_id: "codex" }, db);
    linkTaskToCommit({ task_id: task.id, sha: "abcdef1234567890", message: "context work", files_changed: ["README.md"] }, db);
    addTaskVerification({ task_id: task.id, command: "bun test", status: "passed", output_summary: "all good" }, db);
    const run = startTaskRun({ task_id: task.id, agent_id: "codex", title: "context run" }, db);
    addTaskRunCommand({ run_id: run.id, command: "bun test src/lib/context-packs.test.ts", status: "passed", output_summary: "1 pass" }, db);
    addTaskRunFile({ run_id: run.id, path: "src/lib/context-packs.test.ts", status: "modified" }, db);
    finishTaskRun({ run_id: run.id, status: "completed", summary: "done" }, db);

    const pack = createAgentContextPack({
      task_id: task.id,
      profile: "codex",
      agent_id: "codex",
      now: "2100-01-01T00:00:00.000Z",
      stale_after_hours: 1,
    }, db);

    expect(pack.task.title).toBe("Ship context packs");
    expect(pack.project?.name).toBe("Context Project");
    expect(pack.plan?.tasks.map((item) => item.id)).toContain(task.id);
    expect(pack.acceptance_criteria).toEqual(["Markdown output", "JSON output"]);
    expect(pack.dependencies.upstream[0]!.id).toBe(blocker.id);
    expect(pack.comments.recent[0]!.content).toContain("[REDACTED]");
    expect(pack.relevant_files.map((file) => file.path)).toEqual(expect.arrayContaining([
      "README.md",
      "src/lib/context-packs.ts",
      "src/lib/context-packs.test.ts",
    ]));
    expect(pack.traceability.verifications[0]!.status).toBe("passed");
    expect(pack.runs.items[0]!.commands[0]!.command).toContain("context-packs.test.ts");
    expect(pack.prompt_bundle.suggested_prompt).toContain("Ship context packs");
    expect(pack.warnings).toContain("task state is older than 1 hours");
  });

  test("renders markdown with limits and omitted warnings", () => {
    const db = getDatabase();
    const task = createTask({ title: "Render pack" }, db);
    addComment({ task_id: task.id, content: "first" }, db);
    addComment({ task_id: task.id, content: "second" }, db);

    const pack = createAgentContextPack({ task_id: task.id, profile: "claude", comment_limit: 1 }, db);
    const markdown = renderAgentContextPackMarkdown(pack);

    expect(markdown).toContain("# Agent Context Pack: Render pack");
    expect(markdown).toContain("For Claude Code");
    expect(markdown).toContain("second");
    expect(markdown).not.toContain("first");
    expect(pack.comments.omitted).toBe(1);
    expect(pack.warnings).toContain("1 older comments omitted");
  });
});
