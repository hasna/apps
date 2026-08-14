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
import { withNoNetwork } from "../test/no-network.js";
import { createAgentContextPack, renderAgentContextPackCompactMarkdown, renderAgentContextPackMarkdown } from "./context-packs.js";

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

  test("caps plan task context at the latest 24 with exact omitted counts and load-more guidance", () => {
    const db = getDatabase();
    const plan = createPlan({ name: "Large plan" }, db);
    const task = createTask({ title: "Context target", plan_id: plan.id }, db);
    db.run("UPDATE tasks SET created_at = ?, updated_at = ? WHERE id = ?", ["2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z", task.id]);

    const siblings = Array.from({ length: 30 }, (_, index) => {
      const sibling = createTask({
        title: `Plan sibling ${String(index).padStart(2, "0")}`,
        plan_id: plan.id,
        priority: index === 0 ? "critical" : "low",
      }, db);
      const timestamp = index >= 28
        ? "2025-01-01T00:00:59.000Z"
        : `2025-01-01T00:00:${String(index).padStart(2, "0")}.000Z`;
      db.run("UPDATE tasks SET created_at = ?, updated_at = ? WHERE id = ?", [timestamp, timestamp, sibling.id]);
      return sibling;
    });

    const pack = createAgentContextPack({ task_id: task.id }, db);
    const markdown = renderAgentContextPackMarkdown(pack);
    const tiedLatestIds = siblings.slice(28).map((item) => item.id).sort();

    expect(pack.limits.plan_task_limit).toBe(24);
    expect(pack.plan?.tasks).toHaveLength(24);
    expect(pack.plan?.total_tasks).toBe(31);
    expect(pack.plan?.omitted_tasks).toBe(7);
    expect(pack.plan?.tasks.slice(0, 2).map((item) => item.id)).toEqual(tiedLatestIds);
    expect(pack.plan?.tasks.map((item) => item.title)).toContain("Plan sibling 27");
    expect(pack.plan?.tasks.map((item) => item.title)).not.toContain("Plan sibling 00");
    expect(markdown).toContain("24 shown of 31 total (7 omitted)");
    expect(markdown).toContain("todos plans --show");
    expect(markdown).toContain("todos context-pack <task-id>");

    const oversizedRequest = createAgentContextPack({ task_id: task.id, plan_task_limit: 100 }, db);
    expect(oversizedRequest.limits.plan_task_limit).toBe(24);
    expect(oversizedRequest.plan?.tasks).toHaveLength(24);
    expect(oversizedRequest.plan?.omitted_tasks).toBe(7);
  });

  test("budgets context locally with include exclude rules and deterministic summaries", async () => {
    const db = getDatabase();
    const project = createProject({ name: "Budget Project", path: "/tmp/budget" }, db);
    const plan = createPlan({ name: "Budget Plan", project_id: project.id }, db);
    const task = createTask({
      title: "Budget context",
      description: "A long local description ".repeat(80),
      project_id: project.id,
      plan_id: plan.id,
      metadata: { acceptance_criteria: ["keep the task useful", "summarize omitted local evidence"] },
    }, db);
    const blocker = createTask({ title: "Budget dependency", project_id: project.id }, db);
    addDependency(task.id, blocker.id, db);
    for (let i = 0; i < 8; i += 1) addComment({ task_id: task.id, agent_id: "codex", content: `comment ${i} ${"detail ".repeat(30)}` }, db);
    addTaskFile({ task_id: task.id, path: "src/large-context.ts", status: "planned" }, db);
    addTaskVerification({ task_id: task.id, command: "bun test", status: "passed", output_summary: "ok ".repeat(80) }, db);
    const run = startTaskRun({ task_id: task.id, agent_id: "codex", title: "budget run" }, db);
    addTaskRunCommand({ run_id: run.id, command: "bun test src/lib/context-packs.test.ts", status: "passed", output_summary: "large output ".repeat(40) }, db);

    const { result, calls } = await withNoNetwork(() => createAgentContextPack({
      task_id: task.id,
      profile: "codex",
      token_budget: 220,
      include_sections: ["acceptance_criteria", "comments", "traceability", "runs"],
      exclude_sections: ["runs"],
      summary_char_limit: 120,
      compact: true,
    }, db));

    expect(calls).toEqual([]);
    expect(result.context_budget.token_budget).toBe(220);
    expect(result.context_budget.omitted_sections).toEqual(expect.arrayContaining(["project", "plan", "dependencies", "relevant_files", "runs"]));
    expect(result.context_budget.summaries.some((summary) => summary.section === "runs" && summary.reason.includes("exclude_sections"))).toBe(true);
    expect(result.context_budget.summaries.every((summary) => summary.text.length <= 135)).toBe(true);
    expect(result.context_budget.estimated_tokens).toBeLessThan(result.context_budget.original_estimated_tokens);
    const compact = renderAgentContextPackCompactMarkdown(result);
    expect(compact).toContain("# Context: Budget context");
    expect(compact).toContain("Estimated tokens:");
  });
});
