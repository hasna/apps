import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, addDependency } from "../db/tasks.js";
import { createProject } from "../db/projects.js";
import { createPlan } from "../db/plans.js";
import { addComment } from "../db/comments.js";
import { buildContextPack, formatContextPackMarkdown, CONTEXT_PACK_VERSION } from "./context-packs.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("buildContextPack", () => {
  it("builds task context with dependencies and comments", () => {
    const project = createProject({ name: "Ctx", path: "/tmp/ctx" });
    const plan = createPlan({ name: "Launch", project_id: project.id });
    const dep = createTask({ title: "Setup env", project_id: project.id, plan_id: plan.id });
    const task = createTask({
      title: "Implement feature",
      project_id: project.id,
      plan_id: plan.id,
      metadata: { acceptance_criteria: ["Tests pass", "Docs updated"] },
    });
    addDependency(task.id, dep.id);
    addComment({ task_id: task.id, content: "Started implementation", agent_id: "agent-1" });

    const pack = buildContextPack({ task_id: task.id });
    expect(pack.schema_version).toBe(CONTEXT_PACK_VERSION);
    expect(pack.task?.title).toBe("Implement feature");
    expect(pack.project?.name).toBe("Ctx");
    expect(pack.plan?.name).toBe("Launch");
    expect(pack.dependencies.length).toBe(1);
    expect(pack.acceptance_criteria).toEqual(["Tests pass", "Docs updated"]);
    expect(pack.comments.length).toBe(1);
    expect(pack.prompt_bundle).toContain("Implement feature");
  });

  it("redacts sensitive metadata by default", () => {
    const task = createTask({
      title: "Secret task",
      metadata: { api_key: "sk-secret" },
    });
    const pack = buildContextPack({ task_id: task.id });
    const meta = pack.task?.metadata as Record<string, unknown>;
    expect(meta.api_key).toBe("[REDACTED]");
  });

  it("formats markdown prompt bundle", () => {
    const task = createTask({ title: "Markdown test" });
    const pack = buildContextPack({ task_id: task.id });
    const md = formatContextPackMarkdown(pack);
    expect(md).toContain("# Agent Context Pack");
    expect(md).toContain("Markdown test");
  });
});

describe("local-only", () => {
  it("context pack module has no hosted API calls", () => {
    const src = require("node:fs").readFileSync(require("node:path").join(import.meta.dir, "context-packs.ts"), "utf8");
    expect(src).not.toMatch(/fetch\s*\(|todos\.md|platform-todos/i);
  });
});
