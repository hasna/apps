import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { logTaskChange } from "./db/audit.js";
import { addComment } from "./db/comments.js";
import { upsertCheckpoint } from "./db/checkpoints.js";
import { closeDatabase, getDatabase, resetDatabase } from "./db/database.js";
import { createDispatch } from "./db/dispatches.js";
import { registerAgent } from "./db/agents.js";
import { createProject } from "./db/projects.js";
import { getStatus } from "./db/tasks.js";
import { createTaskList } from "./db/task-lists.js";
import { createTask } from "./db/task-crud.js";
import { createTemplate } from "./db/templates.js";
import { createAgentContextPack } from "./lib/context-packs.js";
import {
  TODOS_JSON_CONTRACTS,
  TODOS_JSON_CONTRACTS_MANIFEST,
  createJsonContractsManifest,
  validateJsonContract,
} from "./json-contracts.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

function expectValid(contractId: string, value: unknown): void {
  const result = validateJsonContract(contractId, value);
  expect(result).toEqual({
    ok: true,
    contractId,
    missingRequired: [],
    typeMismatches: [],
  });
}

describe("stable JSON contracts", () => {
  test("publishes every JSON shape needed by platform integrations", () => {
    const manifest = createJsonContractsManifest({
      version: "1.2.3",
      generatedAt: "2026-01-02T03:04:05.000Z",
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-01-02T03:04:05.000Z",
      package: {
        packageName: "@hasna/todos",
        repository: "hasna/todos",
        version: "1.2.3",
      },
    });
    expect(manifest.contracts.map((contract) => contract.id)).toEqual([
      "task",
      "project",
      "agent",
      "template",
      "task_list",
      "comment",
      "checkpoint",
      "dispatch",
      "audit_history",
      "status_summary",
      "context_pack",
      "local_event_hook",
      "local_event_hook_delivery",
      "structured_error",
      "api_error",
      "local_bridge_bundle",
      "local_bridge_import_result",
      "cli_mcp_parity_manifest",
      "project_bootstrap_result",
    ]);
    expect(TODOS_JSON_CONTRACTS_MANIFEST.generatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  test("validates real database objects against their stable output contracts", () => {
    const db = getDatabase();
    const project = createProject({
      name: "JSON Contracts",
      path: "/tmp/json-contracts",
      description: "Contract fixture",
    }, db);
    const taskList = createTaskList({
      name: "Contract List",
      slug: "contract-list",
      project_id: project.id,
      metadata: { fixture: true },
    }, db);
    const task = createTask({
      title: "Contract task",
      description: "Verify JSON contracts",
      priority: "high",
      project_id: project.id,
      task_list_id: taskList.id,
      tags: ["contracts"],
      metadata: { fixture: true },
    }, db);
    const agent = registerAgent({
      name: "jsoncontractagent",
      description: "Contract fixture agent",
      session_id: "json-contract-session",
      working_dir: "/tmp/json-contracts",
    }, db);
    const template = createTemplate({
      name: "Contract Template",
      title_pattern: "Build {thing}",
      description: "Template fixture",
      priority: "medium",
      tags: ["template"],
      variables: [{ name: "thing", required: true }],
      project_id: project.id,
      metadata: { fixture: true },
    }, db);
    const comment = addComment({
      task_id: task.id,
      agent_id: typeof agent === "object" && "id" in agent ? agent.id : undefined,
      content: "Progress entry",
      type: "progress",
      progress_pct: 50,
    }, db);
    const checkpoint = upsertCheckpoint(task.id, "contract-step", {
      agent_id: typeof agent === "object" && "id" in agent ? agent.id : undefined,
      status: "running",
      data: { phase: "test" },
      attempt: 1,
      max_attempts: 2,
    }, db);
    const dispatch = createDispatch({
      title: "Contract dispatch",
      target_window: "main:1",
      task_ids: [task.id],
      delay_ms: 40,
    }, db);
    const history = logTaskChange(task.id, "update", "status", "pending", "in_progress", "agent-1", db);
    const status = getStatus({ project_id: project.id }, undefined, { explain_blocked: true }, db);
    const contextPack = createAgentContextPack({ task_id: task.id, profile: "codex" }, db);

    expectValid("project", project);
    expectValid("task_list", taskList);
    expectValid("task", task);
    expectValid("agent", agent);
    expectValid("template", template);
    expectValid("comment", comment);
    expectValid("checkpoint", checkpoint);
    expectValid("dispatch", dispatch);
    expectValid("audit_history", history);
    expectValid("status_summary", status);
    expectValid("context_pack", contextPack);
    expectValid("local_event_hook", {
      name: "audit",
      enabled: true,
      events: ["task.completed"],
      target: "file",
      file_path: ".todos/events.jsonl",
    });
    expectValid("local_event_hook_delivery", {
      hook: "audit",
      event_id: "evt-1",
      event_type: "task.completed",
      target: "file",
      status: "delivered",
      attempts: 1,
      integrity: { algorithm: "sha256", digest: "abc" },
    });
    expectValid("structured_error", {
      code: "TASK_NOT_FOUND",
      message: "Task not found",
      suggestion: "Use list_tasks.",
    });
    expectValid("api_error", { error: "Task not found" });
    expectValid("cli_mcp_parity_manifest", {
      schemaVersion: 1,
      generatedAt: "2026-01-02T03:04:05.000Z",
      package: { packageName: "@hasna/todos", repository: "hasna/todos", version: "1.2.3" },
      localOnly: true,
      noNetworkRequired: true,
      parity: [],
    });
    expectValid("project_bootstrap_result", {
      dryRun: true,
      discovery: { projectPath: "/tmp/project", projectName: "project" },
      project: null,
      taskList: null,
      sources: [],
      created: { project: false, taskList: false, sources: [] },
    });
  });

  test("reports missing required fields and incompatible required field types", () => {
    const missing = validateJsonContract("task", { id: "task-1" });
    expect(missing.ok).toBe(false);
    expect(missing.missingRequired).toContain("title");
    expect(missing.missingRequired).toContain("status");

    const typeMismatch = validateJsonContract("status_summary", {
      pending: "1",
      in_progress: 0,
      completed: 0,
      total: 1,
      active_work: [],
      next_task: null,
      stale_count: 0,
      overdue_recurring: 0,
    });
    expect(typeMismatch.ok).toBe(false);
    expect(typeMismatch.typeMismatches).toEqual([
      { field: "pending", expected: ["integer"], actual: "string" },
    ]);
  });

  test("documents backwards-compatible evolution rules", () => {
    const docs = readFileSync(join(import.meta.dir, "..", "docs", "json-contracts.md"), "utf-8");

    for (const contractItem of TODOS_JSON_CONTRACTS) {
      expect(docs).toContain(`\`${contractItem.id}\``);
      expect(contractItem.additionalProperties).toBe(true);
      expect(contractItem.evolution).toEqual({
        additionalFields: "allowed",
        removingRequiredFields: "breaking",
        changingRequiredFieldTypes: "breaking",
        nullableToNonNullable: "breaking",
      });
    }
    expect(docs).toContain("Adding a new field is allowed");
    expect(docs).toContain("Removing a required field is breaking");
  });

  test("keeps JSON contract metadata neutral and free of private deployment concerns", () => {
    const serialized = JSON.stringify(TODOS_JSON_CONTRACTS).toLowerCase();
    for (const forbidden of ["stripe", "billing", "tenant", "aws", "s3", "platform-todos", "saas"]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });
});
