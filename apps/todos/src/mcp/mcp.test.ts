import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase, resolvePartialId } from "../db/database.js";
import { addDependency, createTask, getTask, listTasks, completeTask, startTask } from "../db/tasks.js";
import { createProject } from "../db/projects.js";
import { createPlan } from "../db/plans.js";
import { addComment, listComments } from "../db/comments.js";
import { addTaskRunEvent, startTaskRun } from "../db/task-runs.js";
import { addTaskFile } from "../db/task-files.js";
import { resetConfig } from "../lib/config.js";
import { searchTasks } from "../lib/search.js";
import type { Task } from "../types/index.js";
import { registerTaskCrudTools } from "./tools/task-crud.js";
import { registerTaskProjectTools } from "./tools/task-project-tools.js";
import { registerTaskWorkflowTools } from "./tools/task-workflow-tools.js";
import { registerTaskRelTools } from "./tools/task-rel-tools.js";
import { registerTaskAdvTools } from "./tools/task-adv-tools.js";
import { registerTaskAutoTools } from "./tools/task-auto-tools.js";
import { registerAgentTools } from "./tools/agents.js";
import { registerTaskResources } from "./tools/task-resources.js";
import { registerTemplateTools } from "./tools/templates.js";
import { registerEnvironmentSnapshotTools } from "./tools/environment-snapshots.js";
import { registerMachineTools } from "./tools/machines.js";
import { registerWorkflowPrompts } from "./tools/workflow-prompts.js";
import { registerCodeTools } from "./tools/code-tools.js";

// These tests verify the core operations that the MCP server wraps.
// The MCP server itself uses stdio transport which is harder to test in unit tests.
// These validate the underlying data operations are correct.

let db: ReturnType<typeof getDatabase>;

type CapturedTool = {
  description: string;
  schema: Record<string, any>;
  handler: (params: Record<string, any>) => unknown | Promise<unknown>;
};

function captureTools(register: (server: any, ctx: any) => void): Map<string, CapturedTool> {
  const tools = new Map<string, CapturedTool>();
  const server = {
    resource() {
      // Resource handlers are not needed for these tool-wrapper tests.
    },
    tool(name: string, description: string, schemaOrHandler: Record<string, any> | CapturedTool["handler"], maybeHandler?: CapturedTool["handler"]) {
      const schema = typeof schemaOrHandler === "function" ? {} : schemaOrHandler;
      const handler = typeof schemaOrHandler === "function" ? schemaOrHandler : maybeHandler!;
      tools.set(name, { description, schema, handler });
    },
  };
  const ctx = {
    shouldRegisterTool: () => true,
    resolveId: (partialId: string, table = "tasks") => {
      const id = resolvePartialId(getDatabase(), table, partialId);
      if (!id) throw new Error(`Could not resolve ID: ${partialId}`);
      return id;
    },
    formatError: (error: unknown) => {
      if (error instanceof Error) return JSON.stringify({ code: "TEST_ERROR", message: error.message });
      return JSON.stringify({ code: "TEST_ERROR", message: String(error) });
    },
    formatTask: (task: Task) => `${task.id.slice(0, 8)} ${task.status} ${task.priority} ${task.title}`,
    formatTaskDetail: (task: Task) => `${task.id} ${task.title}`,
    getAgentFocus: () => undefined,
    agentFocusMap: new Map(),
  };
  register(server, ctx);
  return tools;
}

async function callCapturedTool(tools: Map<string, CapturedTool>, name: string, params: Record<string, any>) {
  const tool = tools.get(name);
  expect(tool).toBeDefined();
  const result = await tool!.handler(params) as { isError?: boolean; content: { text: string }[] };
  expect(result.isError).not.toBe(true);
  return result;
}

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("MCP tool operations", () => {
  it("create_task equivalent", () => {
    const task = createTask(
      {
        title: "MCP task",
        description: "Created via MCP",
        priority: "high",
        tags: ["mcp"],
      },
      db,
    );
    expect(task.title).toBe("MCP task");
    expect(task.priority).toBe("high");
    expect(task.tags).toEqual(["mcp"]);
  });

  it("list_tasks with filters", () => {
    createTask({ title: "Pending", status: "pending" }, db);
    createTask({ title: "In progress", status: "in_progress" }, db);
    createTask({ title: "Completed", status: "completed" }, db);

    const { listTasks } = require("./../../src/db/tasks.js");
    const active = listTasks({ status: ["pending", "in_progress"] }, db);
    expect(active).toHaveLength(2);
  });

  it("search_tasks", () => {
    createTask({ title: "Fix authentication bug" }, db);
    createTask({ title: "Add dark mode" }, db);

    const results = searchTasks("auth", undefined, undefined, db);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Fix authentication bug");
  });

  it("add_comment", () => {
    const task = createTask({ title: "Commentable" }, db);
    const comment = addComment(
      { task_id: task.id, content: "Test comment", agent_id: "claude" },
      db,
    );
    expect(comment.content).toBe("Test comment");
    expect(comment.agent_id).toBe("claude");
  });

  it("create_project", () => {
    const project = createProject(
      { name: "MCP Project", path: "/tmp/mcp-test" },
      db,
    );
    expect(project.name).toBe("MCP Project");
  });

  it("bootstrap_project wrapper creates project state", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "todos-mcp-bootstrap-"));
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "@hasna/mcp-bootstrap" }, null, 2)}\n`);

    try {
      const tools = captureTools(registerTaskProjectTools);
      const result = await callCapturedTool(tools, "bootstrap_project", { path: root });
      const payload = JSON.parse(result.content[0]!.text);
      expect(payload.discovery.projectName).toBe("mcp-bootstrap");
      expect(payload.project.name).toBe("mcp-bootstrap");
      expect(payload.taskList.slug).toBe("todos-mcp-bootstrap");
      expect(payload.created.project).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("code tools expose source TODO index and finite watcher scans", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "todos-mcp-source-"));
    writeFileSync(join(root, ".gitignore"), "ignored.ts\n");
    writeFileSync(join(root, "ignored.ts"), "// TODO: Ignored\n");
    writeFileSync(join(root, "app.ts"), "function createProject() {\n  // TODO: Add tasks\n}\n");

    try {
      const tools = captureTools(registerCodeTools);
      const extractResult = await callCapturedTool(tools, "extract_todos", {
        path: root,
        dry_run: true,
        include_index: true,
      });
      const extractPayload = JSON.parse(extractResult.content[0]!.text);
      expect(extractPayload.comments).toHaveLength(1);
      expect(extractPayload.comments[0].symbol).toBe("createProject");
      expect(extractPayload.index.total_comments).toBe(1);

      const watchResult = await callCapturedTool(tools, "watch_source_todos", {
        path: root,
        dry_run: true,
        max_runs: 1,
      });
      const watchPayload = JSON.parse(watchResult.content[0]!.text);
      expect(watchPayload.runs).toHaveLength(1);
      expect(watchPayload.runs[0].changed_files).toEqual(["app.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("workspace trust tools manage local permission profiles", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const previousHome = process.env["HOME"];
    const home = mkdtempSync(join(tmpdir(), "todos-mcp-trust-home-"));
    process.env["HOME"] = home;
    resetConfig();
    const tools = captureTools(registerTaskProjectTools);
    const root = join(home, "project");

    const savedResult = await callCapturedTool(tools, "set_workspace_trust", {
      root,
      preset: "standard",
      command_allowlist: ["bun", "git"],
      write_scopes: ["src"],
      env_redactions: ["CUSTOM_SECRET"],
    });
    const saved = JSON.parse(savedResult.content[0]!.text);
    expect(saved.write_scopes).toEqual(["src"]);

    const checkResult = await callCapturedTool(tools, "check_workspace_permission", {
      path: root,
      command: "bun test",
      write_path: join(root, "src/index.ts"),
      env: { CUSTOM_SECRET: "set", PATH: "/bin" },
    });
    const check = JSON.parse(checkResult.content[0]!.text);
    expect(check.allowed).toBe(true);
    expect(check.redacted_env_keys).toEqual(["CUSTOM_SECRET"]);

    const statusResult = await callCapturedTool(tools, "get_workspace_trust", { path: join(root, "src/index.ts") });
    expect(JSON.parse(statusResult.content[0]!.text).matched_root).toBe(root);

    await callCapturedTool(tools, "remove_workspace_trust", { root });
    if (previousHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = previousHome;
    resetConfig();
    rmSync(home, { recursive: true, force: true });
  });

  it("secret safety tools manage local redaction and scan without exposing values", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const previousHome = process.env["HOME"];
    const home = mkdtempSync(join(tmpdir(), "todos-mcp-redaction-home-"));
    process.env["HOME"] = home;
    resetConfig();
    const tools = captureTools(registerTaskProjectTools);

    const savedResult = await callCapturedTool(tools, "set_secret_safety", {
      redaction_patterns: ["INTERNAL-[0-9]{4}"],
      redaction_keys: ["license"],
    });
    expect(JSON.parse(savedResult.content[0]!.text).redaction_keys).toEqual(["license"]);

    const statusResult = await callCapturedTool(tools, "get_secret_safety", {});
    expect(JSON.parse(statusResult.content[0]!.text).redaction_patterns).toEqual(["INTERNAL-[0-9]{4}"]);

    const scanResult = await callCapturedTool(tools, "scan_secret_text", { text: "INTERNAL-1234 TOKEN=secretsecret" });
    const scan = JSON.parse(scanResult.content[0]!.text);
    expect(scan.ok).toBe(false);
    expect(scan.findings.map((finding: { pattern: string }) => finding.pattern)).toEqual(expect.arrayContaining([
      "custom:INTERNAL-[0-9]{4}",
      "env-secret-assignment",
    ]));
    expect(scanResult.content[0]!.text).not.toContain("INTERNAL-1234");
    expect(scanResult.content[0]!.text).not.toContain("secretsecret");

    if (previousHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = previousHome;
    resetConfig();
    rmSync(home, { recursive: true, force: true });
  });

  it("resolve_mentions exposes local reference backlinks through MCP", async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "todos-mcp-mentions-"));
    writeFileSync(join(root, "app.ts"), "export function createProject() { return true; }\n");

    try {
      const tools = captureTools(registerTaskProjectTools);
      const result = await callCapturedTool(tools, "resolve_mentions", {
        workspace: root,
        mentions: ["file:app.ts:1", "symbol:createProject", "pr:123"],
      });
      const payload = JSON.parse(result.content[0]!.text);
      expect(payload.local_only).toBe(true);
      expect(payload.no_network).toBe(true);
      expect(payload.references.map((reference: { resolved: boolean }) => reference.resolved)).toEqual([true, true, false]);
      expect(payload.backlinks.map((item: { key: string }) => item.key)).toEqual(expect.arrayContaining([
        "file:app.ts:1",
        "symbol:createProject@app.ts:1",
      ]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("knowledge tools expose local decision records and context snapshots through MCP", async () => {
    const tools = captureTools(registerTaskResources);
    const project = createProject({ name: "MCP Knowledge", path: "/tmp/mcp-knowledge" }, db);
    const task = createTask({ title: "Capture MCP decision", project_id: project.id }, db);

    const createdResult = await callCapturedTool(tools, "create_knowledge_record", {
      record_type: "decision",
      title: "Keep MCP knowledge local",
      decision: "Store records in SQLite.",
      rationale: "Agent clients need offline context.",
      task_id: task.id,
      project_id: project.id,
      tags: ["mcp", "knowledge"],
    });
    const created = JSON.parse(createdResult.content[0]!.text);
    expect(created.record_type).toBe("decision");
    expect(created.task_id).toBe(task.id);

    const snapshotResult = await callCapturedTool(tools, "create_knowledge_snapshot", {
      summary: "MCP implementation is ready for verification.",
      task_id: task.id,
      project_id: project.id,
      agent_id: "codex",
      files_open: ["src/mcp/tools/task-resources.ts"],
    });
    const snapshot = JSON.parse(snapshotResult.content[0]!.text);
    expect(snapshot.snapshot_id).toBeTruthy();
    expect(snapshot.record.record_type).toBe("context_snapshot");

    const searchResult = await callCapturedTool(tools, "search_knowledge_records", { query: "offline" });
    const search = JSON.parse(searchResult.content[0]!.text);
    expect(search.map((record: { id: string }) => record.id)).toContain(created.id);

    const exportResult = await callCapturedTool(tools, "export_knowledge_records", { project_id: project.id });
    const exported = JSON.parse(exportResult.content[0]!.text);
    expect(exported.local_only).toBe(true);
    expect(exported.no_network).toBe(true);
    expect(exported.records).toHaveLength(2);
  });

  it("risk tools expose local risk registers and health scoring through MCP", async () => {
    const tools = captureTools(registerTaskResources);
    const project = createProject({ name: "MCP Risks", path: "/tmp/mcp-risks" }, db);
    const plan = createPlan({ name: "MCP risk plan", project_id: project.id }, db);
    const task = createTask({ title: "MCP risk task", project_id: project.id, plan_id: plan.id }, db);

    const createdResult = await callCapturedTool(tools, "create_risk", {
      title: "Keep risk scoring local",
      severity: "high",
      probability: "medium",
      owner: "codex",
      mitigation: "Use SQLite evidence only.",
      project_id: project.id,
      plan_id: plan.id,
      task_id: task.id,
      tags: ["mcp", "risk"],
    });
    const created = JSON.parse(createdResult.content[0]!.text);
    expect(created.plan_id).toBe(plan.id);
    expect(created.task_id).toBe(task.id);

    const listResult = await callCapturedTool(tools, "list_risks", { plan_id: plan.id });
    const listed = JSON.parse(listResult.content[0]!.text);
    expect(listed.map((risk: { id: string }) => risk.id)).toContain(created.id);

    const healthResult = await callCapturedTool(tools, "score_plan_health", { plan_id: plan.id });
    const health = JSON.parse(healthResult.content[0]!.text);
    expect(health.local_only).toBe(true);
    expect(health.no_network).toBe(true);
    expect(health.components.open_risks).toBe(1);

    const projectHealthResult = await callCapturedTool(tools, "score_project_health", { project_id: project.id });
    expect(JSON.parse(projectHealthResult.content[0]!.text).scope).toBe("project");

    const exportResult = await callCapturedTool(tools, "export_risk_register", { project_id: project.id });
    const exported = JSON.parse(exportResult.content[0]!.text);
    expect(exported.risks).toHaveLength(1);

    const closedResult = await callCapturedTool(tools, "close_risk", { id: created.id, status: "accepted" });
    expect(JSON.parse(closedResult.content[0]!.text).status).toBe("accepted");
  });

  it("retrospective tools expose local lessons learned through MCP", async () => {
    const tools = captureTools(registerTaskResources);
    const project = createProject({ name: "MCP Retro", path: "/tmp/mcp-retro" }, db);
    const plan = createPlan({ name: "MCP retro plan", project_id: project.id }, db);
    const task = createTask({ title: "MCP retro task", project_id: project.id, plan_id: plan.id, estimated_minutes: 10 }, db);
    db.run("UPDATE tasks SET status = 'completed', actual_minutes = 30 WHERE id = ?", [task.id]);

    const createdResult = await callCapturedTool(tools, "create_retrospective", {
      title: "MCP retrospective",
      plan_id: plan.id,
      agent_id: "codex",
    });
    const created = JSON.parse(createdResult.content[0]!.text);
    expect(created.report.local_only).toBe(true);
    expect(created.report.no_network).toBe(true);
    expect(created.report.summary.missed_estimates).toBe(1);

    const listResult = await callCapturedTool(tools, "list_retrospectives", { plan_id: plan.id });
    const listed = JSON.parse(listResult.content[0]!.text);
    expect(listed.map((record: { id: string }) => record.id)).toContain(created.id);

    const exportResult = await callCapturedTool(tools, "export_retrospectives", { plan_id: plan.id });
    const exported = JSON.parse(exportResult.content[0]!.text);
    expect(exported.retrospectives).toHaveLength(1);
  });

  it("retention cleanup tools preview and apply local evidence cleanup without leaking content", async () => {
    const tools = captureTools(registerTaskProjectTools);
    const project = createProject({ name: "MCP retention", path: "/tmp/mcp-retention" }, db);
    const task = createTask({ title: "old mcp evidence", project_id: project.id }, db);
    const token = ["sk", "abcdefghijklmnop"].join("-");
    db.run("INSERT INTO task_comments (id, task_id, content, type, created_at) VALUES (?, ?, ?, ?, ?)", [
      "mcp-old-comment",
      task.id,
      `legacy ${token} evidence`,
      "comment",
      "2026-01-01T00:00:00.000Z",
    ]);

    const previewResult = await callCapturedTool(tools, "preview_retention_cleanup", {
      older_than_days: 30,
      project_id: project.id,
      now: "2026-05-22T00:00:00.000Z",
    });
    const preview = JSON.parse(previewResult.content[0]!.text);
    expect(preview.dry_run).toBe(true);
    expect(preview.candidate_counts.comments).toBe(1);
    expect(previewResult.content[0]!.text).not.toContain(token);
    expect(listComments(task.id, db)).toHaveLength(1);

    const applyResult = await callCapturedTool(tools, "apply_retention_cleanup", {
      older_than_days: 30,
      project_id: project.id,
      now: "2026-05-22T00:00:00.000Z",
      confirm: "delete-local-retention-data",
    });
    expect(JSON.parse(applyResult.content[0]!.text).deleted_counts.comments).toBe(1);
    expect(listComments(task.id, db)).toHaveLength(0);
  });

  it("runner sandbox tools manage local command safety profiles", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const previousHome = process.env["HOME"];
    const home = mkdtempSync(join(tmpdir(), "todos-mcp-sandbox-home-"));
    process.env["HOME"] = home;
    resetConfig();
    const tools = captureTools(registerTaskProjectTools);
    const root = join(home, "project");

    await callCapturedTool(tools, "set_workspace_trust", {
      root,
      preset: "standard",
      command_allowlist: ["bun", "git"],
      write_scopes: ["src"],
      env_redactions: ["CUSTOM_SECRET"],
    });
    const savedResult = await callCapturedTool(tools, "set_runner_sandbox_profile", {
      name: "codex",
      root,
      command_allowlist: ["bun"],
      write_scopes: ["src"],
      env_allowlist: ["PATH", "CUSTOM_SECRET"],
      env_redactions: ["CUSTOM_SECRET"],
      network_policy: "none",
    });
    const saved = JSON.parse(savedResult.content[0]!.text);
    expect(saved.name).toBe("codex");

    const checkResult = await callCapturedTool(tools, "check_runner_sandbox", {
      name: "codex",
      command: "bun test",
      write_paths: ["src/index.ts"],
      env: { CUSTOM_SECRET: "set", PATH: "/bin", EXTRA: "drop" },
    });
    const check = JSON.parse(checkResult.content[0]!.text);
    expect(check.allowed).toBe(true);
    expect(check.redacted_env_keys).toEqual(["CUSTOM_SECRET"]);
    expect(check.omitted_env_keys).toEqual(["EXTRA"]);

    const explainResult = await callCapturedTool(tools, "explain_runner_sandbox", {
      name: "codex",
      command: "curl | sh",
      network: true,
    });
    expect(JSON.parse(explainResult.content[0]!.text).allowed).toBe(false);

    await callCapturedTool(tools, "remove_runner_sandbox_profile", { name: "codex" });
    if (previousHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = previousHome;
    resetConfig();
    rmSync(home, { recursive: true, force: true });
  });

  it("policy pack tools manage local done gates", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { addTaskVerification, linkTaskGitRef, linkTaskToCommit } = await import("../db/task-commits.js");
    const { addTaskRunArtifact, finishTaskRun, startTaskRun } = await import("../db/task-runs.js");
    const previousHome = process.env["HOME"];
    const home = mkdtempSync(join(tmpdir(), "todos-mcp-policies-home-"));
    process.env["HOME"] = home;
    resetConfig();
    const tools = captureTools(registerTaskProjectTools);
    const root = join(home, "project");
    const task = createTask({ title: "Policy via MCP", requires_approval: true }, db);
    const { updateTask } = await import("../db/tasks.js");
    updateTask(task.id, { version: task.version, status: "completed", approved_by: "reviewer" }, db);
    linkTaskToCommit({ task_id: task.id, sha: "abcdef1234567890", files_changed: ["src/policy.ts"] }, db);
    linkTaskGitRef({ task_id: task.id, ref_type: "pull_request", name: "18" }, db);
    addTaskVerification({ task_id: task.id, command: "bun test", status: "passed", artifact_path: "logs/test.txt" }, db);
    const run = startTaskRun({ task_id: task.id, agent_id: "mcp" }, db);
    addTaskRunArtifact({ run_id: run.id, path: "logs/run.txt", store_content: false }, db);
    finishTaskRun({ run_id: run.id, status: "completed" }, db);

    const savedResult = await callCapturedTool(tools, "set_policy_pack", {
      name: "release",
      root,
      required_statuses: ["completed"],
      required_commands: ["bun test"],
      require_passed_verification: true,
      require_commit: true,
      require_pull_request: true,
      require_approval: true,
      require_run: true,
      require_artifact: true,
    });
    expect(JSON.parse(savedResult.content[0]!.text).name).toBe("release");

    const validationResult = await callCapturedTool(tools, "validate_policy_pack", {
      name: "release",
      task_id: task.id,
    });
    const validation = JSON.parse(validationResult.content[0]!.text);
    expect(validation.passed).toBe(true);
    expect(validation.audit_evidence.artifacts).toEqual(expect.arrayContaining(["logs/test.txt", "logs/run.txt"]));

    const explainResult = await callCapturedTool(tools, "explain_policy_pack", {
      name: "release",
      task_id: task.id,
    });
    expect(JSON.parse(explainResult.content[0]!.text).mode).toBe("explain");

    const listResult = await callCapturedTool(tools, "list_policy_packs", {});
    expect(JSON.parse(listResult.content[0]!.text)[0].name).toBe("release");
    await callCapturedTool(tools, "remove_policy_pack", { name: "release" });

    if (previousHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = previousHome;
    resetConfig();
    rmSync(home, { recursive: true, force: true });
  });

  it("approval gate tools manage manual checkpoints", async () => {
    const { getTaskRunLedger, startTaskRun } = await import("../db/task-runs.js");
    const tools = captureTools(registerTaskProjectTools);
    const task = createTask({ title: "Approval via MCP" }, db);
    const run = startTaskRun({ task_id: task.id, agent_id: "mcp" }, db);

    const missingTool = tools.get("check_approval_gate")!;
    const missing = await missingTool.handler({ task_id: task.id, gate: "deploy" }) as { isError?: boolean; content: { text: string }[] };
    expect(missing.isError).toBe(true);
    expect(JSON.parse(missing.content[0]!.text).allowed).toBe(false);

    const requestedResult = await callCapturedTool(tools, "require_approval_gate", {
      task_id: task.id.slice(0, 8),
      gate: "deploy",
      requester: "codex",
      reviewer: "reviewer",
      reason: "production-affecting action",
      run_id: run.id.slice(0, 8),
    });
    const requested = JSON.parse(requestedResult.content[0]!.text);
    expect(requested.status).toBe("pending");
    expect(requested.run_id).toBe(run.id);

    await callCapturedTool(tools, "approve_approval_gate", {
      task_id: task.id,
      gate: "deploy",
      reviewer: "reviewer",
      note: "approved",
    });

    const checkResult = await callCapturedTool(tools, "check_approval_gate", {
      task_id: task.id,
      gate: "deploy",
    });
    expect(JSON.parse(checkResult.content[0]!.text).allowed).toBe(true);

    const listResult = await callCapturedTool(tools, "list_approval_gates", { task_id: task.id });
    expect(JSON.parse(listResult.content[0]!.text)).toHaveLength(1);
    expect(getTaskRunLedger(run.id, db).events.map((event) => event.message)).toEqual(expect.arrayContaining([
      "approval gate requested: deploy",
      "approval gate approved: deploy",
    ]));
  });

  it("local event hook tools manage local automation triggers", async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const previousHome = process.env["HOME"];
    const home = mkdtempSync(join(tmpdir(), "todos-mcp-event-hooks-"));
    process.env["HOME"] = home;
    resetConfig();
    const tools = captureTools(registerTaskProjectTools);
    const eventPath = join(home, "events.jsonl");

    try {
      const savedResult = await callCapturedTool(tools, "set_local_event_hook", {
        name: "audit",
        events: ["task.completed"],
        target: "file",
        file_path: eventPath,
      });
      expect(JSON.parse(savedResult.content[0]!.text).name).toBe("audit");

      const testResult = await callCapturedTool(tools, "test_local_event_hook", {
        name: "audit",
        event: "task.completed",
        payload: { id: "task-1" },
      });
      expect(JSON.parse(testResult.content[0]!.text)[0].status).toBe("delivered");
      expect(JSON.parse(readFileSync(eventPath, "utf-8").trim()).type).toBe("task.completed");

      const listResult = await callCapturedTool(tools, "list_local_event_hooks", {});
      expect(JSON.parse(listResult.content[0]!.text)).toHaveLength(1);

      const removeResult = await callCapturedTool(tools, "remove_local_event_hook", { name: "audit" });
      expect(JSON.parse(removeResult.content[0]!.text).removed).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
      resetConfig();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("terminal notification tools manage local watch rules", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const previousHome = process.env["HOME"];
    const home = mkdtempSync(join(tmpdir(), "todos-mcp-terminal-notifications-"));
    process.env["HOME"] = home;
    resetConfig();
    const tools = captureTools(registerTaskProjectTools);

    try {
      const savedResult = await callCapturedTool(tools, "set_terminal_notification_rule", {
        name: "blocked",
        events: ["task.blocked", "task.failed"],
        min_severity: "warning",
        bell: true,
        agent_ids: ["codex"],
        priorities: ["high"],
        contains: ["deploy"],
      });
      expect(JSON.parse(savedResult.content[0]!.text).rule.name).toBe("blocked");

      const testResult = await callCapturedTool(tools, "test_terminal_notification_rule", {
        name: "blocked",
        event: "task.failed",
        payload: { id: "task-1", title: "Deploy failed", agent_id: "codex", priority: "high" },
      });
      const testPayload = JSON.parse(testResult.content[0]!.text);
      expect(testPayload.matched).toBe(true);
      expect(testPayload.notifications[0].severity).toBe("critical");

      const evaluated = await callCapturedTool(tools, "evaluate_terminal_watch_rules", {
        event: "task.completed",
        payload: { title: "Done" },
      });
      expect(JSON.parse(evaluated.content[0]!.text)[0].matched).toBe(false);

      const listResult = await callCapturedTool(tools, "list_terminal_notification_rules", {});
      expect(JSON.parse(listResult.content[0]!.text)).toHaveLength(1);

      const removeResult = await callCapturedTool(tools, "remove_terminal_notification_rule", { name: "blocked" });
      expect(JSON.parse(removeResult.content[0]!.text).removed).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
      resetConfig();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("branch work plan tool creates local safe branch plans", async () => {
    const tools = captureTools(registerTaskProjectTools);
    const task = createTask({ title: "MCP branch plan" }, db);

    const result = await callCapturedTool(tools, "create_branch_work_plan", {
      task_id: task.id,
      branch: "task/mcp-branch-plan",
      base_branch: "main",
      paths: ["src/mcp-branch-plan.ts"],
      root: "/tmp/not-a-git-repo",
      include_git_status: false,
    });

    const workPlan = JSON.parse(result.content[0]!.text);
    expect(workPlan.safe_to_start).toBe(true);
    expect(workPlan.files).toEqual(["src/mcp-branch-plan.ts"]);
    expect(workPlan.commands).toContain(`todos link-ref ${task.id.slice(0, 8)} task/mcp-branch-plan --type branch --provider git`);
  });

  it("natural-language intake tool previews local task creation", async () => {
    const tools = captureTools(registerTaskProjectTools);
    const result = await callCapturedTool(tools, "preview_natural_language_intake", {
      text: "Add task fix parser priority high @codex #cli due tomorrow",
      reference_date: "2026-01-02T12:00:00.000Z",
    });

    const preview = JSON.parse(result.content[0]!.text);
    expect(preview.dry_run).toBe(true);
    expect(preview.tasks[0]).toMatchObject({
      title: "fix parser",
      priority: "high",
      assigned_to: "codex",
    });
    expect(preview.tasks[0].due_at).toBe("2026-01-03T12:00:00.000Z");
  });

  it("local encryption tools manage profiles and JSON values", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const previousHome = process.env["HOME"];
    const previousKey = process.env["TODOS_TEST_ENCRYPTION_KEY"];
    const home = mkdtempSync(join(tmpdir(), "todos-mcp-encryption-"));
    process.env["HOME"] = home;
    process.env["TODOS_TEST_ENCRYPTION_KEY"] = "local mcp encryption key material";
    resetConfig();
    const tools = captureTools(registerTaskProjectTools);

    try {
      const savedResult = await callCapturedTool(tools, "set_encryption_profile", {
        name: "secure",
        key_env: "TODOS_TEST_ENCRYPTION_KEY",
      });
      expect(JSON.parse(savedResult.content[0]!.text).key_env).toBe("TODOS_TEST_ENCRYPTION_KEY");

      const statusResult = await callCapturedTool(tools, "get_encryption_status", { name: "secure" });
      expect(JSON.parse(statusResult.content[0]!.text).locked).toBe(false);

      const encryptedResult = await callCapturedTool(tools, "encrypt_local_value", {
        profile: "secure",
        value: { note: "private evidence" },
      });
      const envelope = JSON.parse(encryptedResult.content[0]!.text);
      expect(JSON.stringify(envelope)).not.toContain("private evidence");

      const decryptedResult = await callCapturedTool(tools, "decrypt_local_value", { envelope });
      expect(JSON.parse(decryptedResult.content[0]!.text)).toEqual({ note: "private evidence" });

      const listResult = await callCapturedTool(tools, "list_encryption_profiles", {});
      expect(JSON.parse(listResult.content[0]!.text)).toHaveLength(1);
      const removeResult = await callCapturedTool(tools, "remove_encryption_profile", { name: "secure" });
      expect(JSON.parse(removeResult.content[0]!.text).removed).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
      if (previousKey === undefined) delete process.env["TODOS_TEST_ENCRYPTION_KEY"];
      else process.env["TODOS_TEST_ENCRYPTION_KEY"] = previousKey;
      resetConfig();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("agent context pack tool returns local JSON and Markdown bundles", async () => {
    const tools = captureTools(registerTaskAdvTools);
    const task = createTask({
      title: "MCP context pack",
      description: "Context for a local agent",
      metadata: { acceptance_criteria: ["has JSON", "has Markdown"] },
    }, db);
    addComment({ task_id: task.id, agent_id: "mcp", content: `Use ${["sk", "abcdefghijklmnop"].join("-")} only in redaction tests` }, db);

    const jsonResult = await callCapturedTool(tools, "build_agent_context_pack", {
      task_id: task.id.slice(0, 8),
      profile: "codex",
      format: "json",
      agent_id: "mcp",
    });
    const pack = JSON.parse(jsonResult.content[0]!.text);
    expect(pack.profile).toBe("codex");
    expect(pack.acceptance_criteria).toEqual(["has JSON", "has Markdown"]);
    expect(pack.comments.recent[0].content).toContain("[REDACTED_TOKEN]");

    const markdownResult = await callCapturedTool(tools, "build_agent_context_pack", {
      task_id: task.id,
      profile: "claude",
      format: "markdown",
    });
    expect(markdownResult.content[0]!.text).toContain("# Agent Context Pack: MCP context pack");
    expect(markdownResult.content[0]!.text).toContain("For Claude Code");

    const compactResult = await callCapturedTool(tools, "build_agent_context_pack", {
      task_id: task.id,
      profile: "codex",
      format: "json",
      token_budget: 180,
      exclude_sections: ["comments", "runs"],
      compact: true,
    });
    const compactPack = JSON.parse(compactResult.content[0]!.text);
    expect(compactPack.context_budget.token_budget).toBe(180);
    expect(compactPack.context_budget.omitted_sections).toEqual(expect.arrayContaining(["comments"]));
    expect(compactResult.content[0]!.text).not.toContain("\n  ");
  });

  it("environment snapshot tools capture and compare local run evidence", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tools = captureTools(registerEnvironmentSnapshotTools);
    const root = mkdtempSync(join(tmpdir(), "todos-mcp-env-snapshot-"));
    writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "env-snapshot-fixture", version: "1.0.0" }, null, 2)}\n`);
    writeFileSync(join(root, "bun.lock"), "# lock\n");
    const outputPath = join(root, "snapshot.json");
    const task = createTask({ title: "Snapshot target" }, db);
    const run = startTaskRun({ task_id: task.id, agent_id: "mcp" }, db);

    try {
      const captureResult = await callCapturedTool(tools, "capture_environment_snapshot", {
        root,
        run_id: run.id.slice(0, 8),
        command: "bun test",
        output_path: outputPath,
        agent_id: "mcp",
      });
      const recorded = JSON.parse(captureResult.content[0]!.text);
      expect(recorded.snapshot.package_manager.manager).toBe("bun");
      expect(recorded.snapshot.target.run_id).toBe(run.id);
      expect(recorded.run_artifact_id).toBeTruthy();

      const compareResult = await callCapturedTool(tools, "compare_environment_snapshots", {
        left_path: outputPath,
        right_path: outputPath,
      });
      const comparison = JSON.parse(compareResult.content[0]!.text);
      expect(comparison.same_runtime).toBe(true);
      expect(comparison.changed_lockfiles).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("version-based optimistic locking via update_task", () => {
    const task = createTask({ title: "Lockable" }, db);
    const { updateTask } = require("./../../src/db/tasks.js");

    // First update succeeds
    const updated = updateTask(task.id, { version: 1, title: "Updated" }, db);
    expect(updated.version).toBe(2);

    // Second update with stale version fails
    expect(() => updateTask(task.id, { version: 1, title: "Stale" }, db)).toThrow();
  });
});

describe("MCP tool wrappers", () => {
  it("accepts the same status and priority values as the database", () => {
    const tools = captureTools(registerTaskCrudTools);
    const createTaskTool = tools.get("create_task")!;
    createTaskTool.schema.priority.parse("critical");
    createTaskTool.schema.status.parse("failed");

    const listTasksTool = tools.get("list_tasks")!;
    listTasksTool.schema.priority.parse("critical");
    listTasksTool.schema.status.parse("failed");
  });

  it("create_task maps MCP aliases to persisted task fields", async () => {
    const tools = captureTools(registerTaskCrudTools);
    await callCapturedTool(tools, "create_task", {
      title: "Wrapper create",
      priority: "critical",
      deadline: "2026-05-07T00:00:00.000Z",
      estimate: 45,
      sla_minutes: 120,
      confidence: 0.8,
      retry_count: 5,
      tags: ["mcp"],
    });

    const task = listTasks({ tags: ["mcp"] }, db)[0]!;
    expect(task.priority).toBe("critical");
    expect(task.due_at).toBe("2026-05-07T00:00:00.000Z");
    expect(task.estimated_minutes).toBe(45);
    expect(task.sla_minutes).toBe(120);
    expect(task.confidence).toBe(0.8);
    expect(task.max_retries).toBe(5);
  });

  it("start_task works without forcing callers to pass the current version", async () => {
    const tools = captureTools(registerTaskProjectTools);
    const task = createTask({ title: "Start via MCP" }, db);

    await callCapturedTool(tools, "start_task", { task_id: task.id });

    const updated = getTask(task.id, db)!;
    expect(updated.status).toBe("in_progress");
    expect(updated.locked_by).toBe("mcp");
  });

  it("task lock tools acquire renew check and release local leases", async () => {
    const tools = captureTools(registerTaskProjectTools);
    const task = createTask({ title: "Lock via MCP" }, db);

    const locked = await callCapturedTool(tools, "lock_task", { task_id: task.id, agent_id: "mcp-agent" });
    const lockJson = JSON.parse(locked.content[0]!.text);
    expect(lockJson.success).toBe(true);
    expect(lockJson.expires_at).toBeTruthy();

    const checked = await callCapturedTool(tools, "check_task_lock", { task_id: task.id });
    expect(JSON.parse(checked.content[0]!.text).locked_by).toBe("mcp-agent");

    const released = await callCapturedTool(tools, "unlock_task", { task_id: task.id, agent_id: "mcp-agent" });
    expect(JSON.parse(released.content[0]!.text).success).toBe(true);
    expect(getTask(task.id, db)!.locked_by).toBeNull();
  });

  it("get_task_dependencies returns the transitive dependency tree for agent planning", async () => {
    const tools = captureTools(registerTaskProjectTools);
    const taskA = createTask({ title: "Task A" }, db);
    const taskB = createTask({ title: "Task B" }, db);
    const taskC = createTask({ title: "Task C" }, db);
    addDependency(taskA.id, taskB.id, db);
    addDependency(taskB.id, taskC.id, db);

    const result = await callCapturedTool(tools, "get_task_dependencies", {
      task_id: taskA.id,
      direction: "upstream",
    });

    expect(result.content[0]!.text).toContain("Task B");
    expect(result.content[0]!.text).toContain("Task C");
  });

  it("update_task fetches the current version and maps deadline/estimate aliases", async () => {
    const tools = captureTools(registerTaskCrudTools);
    const task = createTask({ title: "Update via MCP" }, db);

    await callCapturedTool(tools, "update_task", {
      task_id: task.id,
      title: "Updated via MCP",
      deadline: "2026-05-08T00:00:00.000Z",
      estimate: 60,
      sla_minutes: 180,
      actual_minutes: 70,
      confidence: 0.7,
    });

    const updated = getTask(task.id, db)!;
    expect(updated.title).toBe("Updated via MCP");
    expect(updated.due_at).toBe("2026-05-08T00:00:00.000Z");
    expect(updated.estimated_minutes).toBe(60);
    expect(updated.sla_minutes).toBe(180);
    expect(updated.actual_minutes).toBe(70);
    expect(updated.confidence).toBe(0.7);
  });

  it("complete_task uses task lifecycle behavior and supports confidence/backdating", async () => {
    const tools = captureTools(registerTaskProjectTools);
    const task = createTask({ title: "Complete via MCP" }, db);

    await callCapturedTool(tools, "complete_task", {
      task_id: task.id,
      confidence: 0.9,
      completed_at: "2026-05-06T10:00:00.000Z",
    });

    const completed = getTask(task.id, db)!;
    expect(completed.status).toBe("completed");
    expect(completed.confidence).toBe(0.9);
    expect(completed.completed_at).toBe("2026-05-06T10:00:00.000Z");
  });

  it("fail_task delegates to the lifecycle failure path", async () => {
    const tools = captureTools(registerTaskWorkflowTools);
    const task = createTask({ title: "Fail via MCP" }, db);

    await callCapturedTool(tools, "fail_task", {
      task_id: task.id,
      agent_id: "mcp",
      reason: "regression test",
    });

    const failed = getTask(task.id, db)!;
    expect(failed.status).toBe("failed");
    expect((failed.metadata._failure as { reason: string }).reason).toBe("regression test");
  });

  it("relationship tools resolve their database imports from the tools directory", async () => {
    const tools = captureTools(registerTaskRelTools);
    const task = createTask({ title: "MCP handoff task", assigned_to: "mcp", agent_id: "mcp", session_id: "mcp-session" }, db);
    startTask(task.id, "mcp", db);
    addTaskFile({ task_id: task.id, path: "src/mcp/tools/task-rel-tools.ts", agent_id: "mcp" }, db);
    const run = startTaskRun({ task_id: task.id, agent_id: "mcp", title: "MCP handoff run" }, db);

    const createdResult = await callCapturedTool(tools, "create_handoff", {
      agent_id: "mcp",
      summary: "Wrapper handoff",
      completed: ["one"],
      next_steps: ["two"],
      session_id: "mcp-session",
      task_ids: [task.id],
      relevant_files: ["src/mcp/tools/task-rel-tools.ts"],
      run_ids: [run.id],
    });
    const created = JSON.parse(createdResult.content[0].text);
    expect(created.task_ids).toEqual([task.id]);
    expect(created.relevant_files).toEqual(["src/mcp/tools/task-rel-tools.ts"]);

    const listResult = await callCapturedTool(tools, "list_handoffs", { unread_for: "reviewer" });
    expect(JSON.parse(listResult.content[0].text)).toHaveLength(1);

    const readResult = await callCapturedTool(tools, "read_handoff", { handoff_id: created.id.slice(0, 8) });
    expect(JSON.parse(readResult.content[0].text).id).toBe(created.id);

    const ackResult = await callCapturedTool(tools, "acknowledge_handoff", { handoff_id: created.id, agent_id: "reviewer" });
    expect(JSON.parse(ackResult.content[0].text).acknowledged_by).toEqual(["reviewer"]);

    const recoveryResult = await callCapturedTool(tools, "recover_stale_session_handoff", {
      agent_id: "mcp",
      session_id: "mcp-session",
      recovered_by: "reviewer",
      reason: "wrapper recovery",
    });
    const recovery = JSON.parse(recoveryResult.content[0].text);
    expect(recovery.task_ids).toEqual([task.id]);
    expect(recovery.run_ids).toEqual([run.id]);

    const exportResult = await callCapturedTool(tools, "export_handoff", { handoff_id: created.id });
    const bundle = JSON.parse(exportResult.content[0]!.text);
    expect(bundle.handoff.id).toBe(created.id);

    const importPreview = await callCapturedTool(tools, "import_handoff", { bundle, apply: false });
    expect(JSON.parse(importPreview.content[0]!.text).applied).toBe(false);
  });

  it("time tracking tools manage local focus sessions and reports", async () => {
    const tools = captureTools(registerTaskRelTools);
    const task = createTask({ title: "MCP time task", estimated_minutes: 75 }, db);

    const logResult = await callCapturedTool(tools, "log_time", {
      task_id: task.id,
      minutes: 10,
      agent_id: "mcp",
    });
    expect(JSON.parse(logResult.content[0].text).minutes).toBe(10);

    const startResult = await callCapturedTool(tools, "start_focus_session", {
      task_id: task.id,
      agent_id: "mcp",
      title: "focus",
      started_at: "2026-01-01T10:00:00.000Z",
      idle_after_minutes: 20,
    });
    const session = JSON.parse(startResult.content[0].text);
    expect(session.status).toBe("active");

    const idleResult = await callCapturedTool(tools, "get_idle_focus_prompts", {
      agent_id: "mcp",
      now: "2026-01-01T10:25:00.000Z",
    });
    expect(JSON.parse(idleResult.content[0].text)[0].idle_minutes).toBe(25);

    const stopResult = await callCapturedTool(tools, "stop_focus_session", {
      session_id: session.id,
      ended_at: "2026-01-01T10:30:00.000Z",
    });
    expect(JSON.parse(stopResult.content[0].text).actual_minutes).toBe(30);

    const reportResult = await callCapturedTool(tools, "get_time_report", { include_open: true, format: "json" });
    const report = JSON.parse(reportResult.content[0].text).find((entry: { task_id: string }) => entry.task_id === task.id);
    expect(report.actual_minutes).toBe(40);
    expect(getTask(task.id, db)!.actual_minutes).toBe(40);

    const listResult = await callCapturedTool(tools, "list_focus_sessions", { include_completed: true });
    expect(JSON.parse(listResult.content[0].text).map((item: { id: string }) => item.id)).toContain(session.id);
  });

  it("kanban board tools create render and move local task boards", async () => {
    const tools = captureTools(registerTaskRelTools);
    const task = createTask({ title: "MCP board task", status: "pending" }, db);

    const createdResult = await callCapturedTool(tools, "create_board", {
      name: "mcp-board",
      lanes: [
        { id: "ready", name: "Ready", statuses: ["pending"], wip_limit: null, position: 0 },
        { id: "doing", name: "Doing", statuses: ["in_progress"], wip_limit: 1, position: 1 },
      ],
    });
    const board = JSON.parse(createdResult.content[0].text);
    expect(board.name).toBe("mcp-board");

    const snapshotResult = await callCapturedTool(tools, "get_board_snapshot", { board_id: "mcp-board" });
    const snapshot = JSON.parse(snapshotResult.content[0].text);
    expect(snapshot.totals.ready).toBe(1);
    expect(snapshot.keyboard.quit).toBe("q");

    const movedResult = await callCapturedTool(tools, "move_board_card", {
      board_id: board.id,
      card_id: task.id,
      lane_id: "doing",
    });
    expect(JSON.parse(movedResult.content[0].text).status).toBe("in_progress");

    const listResult = await callCapturedTool(tools, "list_boards", { scope: "tasks" });
    expect(JSON.parse(listResult.content[0].text).map((item: { name: string }) => item.name)).toContain("mcp-board");
  });

  it("calendar tools create list export and import local ICS events", async () => {
    const tools = captureTools(registerTaskRelTools);
    const task = createTask({ title: "MCP calendar task", due_at: "2026-06-01T09:00:00.000Z" }, db);

    const createdResult = await callCapturedTool(tools, "create_calendar_item", {
      title: "MCP milestone",
      kind: "milestone",
      starts_at: "2026-06-02T10:00:00.000Z",
      task_id: task.id,
    });
    expect(JSON.parse(createdResult.content[0].text).kind).toBe("milestone");

    const listResult = await callCapturedTool(tools, "list_calendar_events", {});
    expect(JSON.parse(listResult.content[0].text).map((event: { kind: string }) => event.kind)).toEqual(expect.arrayContaining(["task_due", "milestone"]));

    const exportResult = await callCapturedTool(tools, "export_calendar_ics", { redact: true });
    const exported = JSON.parse(exportResult.content[0].text);
    expect(exported.content).toContain("BEGIN:VCALENDAR");
    expect(exported.content).not.toContain("MCP calendar task");

    const importResult = await callCapturedTool(tools, "import_calendar_ics", {
      content: "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:mcp@example.com\nDTSTART:20260603T120000Z\nSUMMARY:MCP imported\nEND:VEVENT\nEND:VCALENDAR",
    });
    expect(JSON.parse(importResult.content[0].text).imported).toBe(1);
  });

  it("git traceability tools link refs, commits, and verification evidence", async () => {
    const tools = captureTools(registerTaskResources);
    const task = createTask({ title: "Traceable via MCP" }, db);

    await callCapturedTool(tools, "link_task_to_commit", {
      task_id: task.id,
      sha: "abcdef1234567890",
      message: "Implement trace tools",
      files_changed: ["src/db/task-commits.ts"],
    });
    await callCapturedTool(tools, "link_task_git_ref", {
      task_id: task.id,
      ref_type: "pull_request",
      name: "42",
      url: "https://github.com/hasna/todos/pull/42",
      provider: "github",
    });
    await callCapturedTool(tools, "add_task_verification", {
      task_id: task.id,
      command: "bun test src/db/task-commits.test.ts",
      status: "passed",
      output_summary: "traceability tests passed",
    });

    const traceResult = await callCapturedTool(tools, "get_task_traceability", { task_id: task.id });
    const trace = JSON.parse(traceResult.content[0]!.text);
    expect(trace.commits[0].sha).toBe("abcdef1234567890");
    expect(trace.git_refs[0].name).toBe("42");
    expect(trace.verifications[0].status).toBe("passed");

    const refResult = await callCapturedTool(tools, "find_tasks_by_git_ref", { ref: "pull/42" });
    const refs = JSON.parse(refResult.content[0]!.text);
    expect(refs[0].task_id).toBe(task.id);
  });

  it("release notes tool renders local changelog evidence", async () => {
    const tools = captureTools(registerTaskResources);
    const project = createProject({ name: "MCP Release", path: "/tmp/mcp-release" }, db);
    const task = createTask({
      title: "Publish MCP release notes",
      project_id: project.id,
      tags: ["release"],
      metadata: { migration_note: "Consumers should read release_notes JSON." },
    }, db);
    db.run("UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ?", [
      "2026-01-02T03:04:05.000Z",
      task.id,
    ]);

    await callCapturedTool(tools, "link_task_to_commit", {
      task_id: task.id,
      sha: "1111111222222223333333444444445555555566",
      message: "Publish release notes",
    });
    await callCapturedTool(tools, "add_task_verification", {
      task_id: task.id,
      command: "bun test src/lib/release-notes.test.ts",
      status: "passed",
    });

    const jsonResult = await callCapturedTool(tools, "generate_release_notes", {
      project_id: project.id,
      tag: "release",
      title: "MCP Release Notes",
    });
    const payload = JSON.parse(jsonResult.content[0]!.text);
    expect(payload.summary.tasks).toBe(1);
    expect(payload.commits[0].sha).toBe("1111111222222223333333444444445555555566");

    const markdownResult = await callCapturedTool(tools, "generate_release_notes", {
      project_id: project.id,
      format: "markdown",
    });
    expect(markdownResult.content[0]!.text).toContain("# Release Notes");
    expect(markdownResult.content[0]!.text).toContain("Publish MCP release notes");
  });

  it("verification provider tools manage local adapters and record evidence", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const previousHome = process.env["HOME"];
    const home = mkdtempSync(join(tmpdir(), "todos-mcp-verification-providers-"));
    process.env["HOME"] = home;
    resetConfig();
    try {
      const tools = captureTools(registerTaskResources);
      const task = createTask({ title: "MCP provider task" }, db);

      const setResult = await callCapturedTool(tools, "set_verification_provider", {
        name: "local",
        kind: "command",
        command: "printf mcp-provider-ok",
        capabilities: ["command", "evidence"],
      });
      expect(JSON.parse(setResult.content[0]!.text).name).toBe("local");

      const capsResult = await callCapturedTool(tools, "get_verification_provider_capabilities", { name: "local" });
      expect(JSON.parse(capsResult.content[0]!.text).capabilities).toEqual(expect.arrayContaining(["command", "evidence"]));

      const runResult = await callCapturedTool(tools, "run_verification_provider", {
        name: "local",
        task_id: task.id,
        agent_id: "codex",
      });
      const result = JSON.parse(runResult.content[0]!.text);
      expect(result.status).toBe("passed");
      expect(result.output_summary).toContain("mcp-provider-ok");

      const listResult = await callCapturedTool(tools, "list_verification_providers", {});
      expect(JSON.parse(listResult.content[0]!.text)).toHaveLength(1);
      const removeResult = await callCapturedTool(tools, "remove_verification_provider", { name: "local" });
      expect(JSON.parse(removeResult.content[0]!.text).removed).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
      resetConfig();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("run ledger tools capture local run evidence without hosted calls", async () => {
    const tools = captureTools(registerTaskResources);
    const task = createTask({ title: "Run via MCP" }, db);

    const startResult = await callCapturedTool(tools, "start_task_run", {
      task_id: task.id,
      agent_id: "mcp",
      title: "MCP local run",
      claim: true,
      metadata: { source: "local" },
    });
    const run = JSON.parse(startResult.content[0]!.text);
    expect(run.status).toBe("running");

    await callCapturedTool(tools, "add_task_run_event", {
      run_id: run.id,
      event_type: "comment",
      message: "progress update",
      agent_id: "mcp",
    });
    await callCapturedTool(tools, "add_task_run_command", {
      run_id: run.id,
      command: "bun test src/db/task-runs.test.ts",
      status: "passed",
      exit_code: 0,
      output_summary: "passed",
      artifact_path: "logs/mcp-run.txt",
    });
    await callCapturedTool(tools, "add_task_run_file", {
      run_id: run.id,
      path: "src/db/task-runs.ts",
      status: "modified",
    });
    await callCapturedTool(tools, "add_task_run_artifact", {
      run_id: run.id,
      path: "logs/mcp-run.txt",
      artifact_type: "log",
      description: "local log",
      store_content: false,
    });
    const artifactReportResult = await callCapturedTool(tools, "verify_task_run_artifacts", { run_id: run.id });
    const artifactReports = JSON.parse(artifactReportResult.content[0]!.text);
    expect(artifactReports[0].status).toBe("metadata_only");
    await callCapturedTool(tools, "finish_task_run", {
      run_id: run.id,
      status: "completed",
      summary: "done",
    });

    const ledgerResult = await callCapturedTool(tools, "get_task_run_ledger", { run_id: run.id });
    const ledger = JSON.parse(ledgerResult.content[0]!.text);
    expect(ledger.run.status).toBe("completed");
    expect(ledger.events.map((event: { event_type: string }) => event.event_type)).toContain("comment");
    expect(ledger.commands[0].status).toBe("passed");
    expect(ledger.files[0].path).toBe("src/db/task-runs.ts");
    expect(ledger.artifacts[0].path).toBe("logs/mcp-run.txt");

    const listResult = await callCapturedTool(tools, "list_task_runs", { task_id: task.id });
    const runs = JSON.parse(listResult.content[0]!.text);
    expect(runs[0].id).toBe(run.id);
  });

  it("simulates local agent replay fixtures through MCP without mutating tasks", async () => {
    const tools = captureTools(registerTaskResources);
    const task = createTask({ title: "Replay via MCP" }, db);

    const before = getTask(task.id, db)!.status;
    const result = await callCapturedTool(tools, "simulate_agent_replay", {
      agent_id: "mcp",
      fixture: {
        task: { id: task.id, title: task.title, status: "pending" },
        runs: {
          items: [{
            status: "failed",
            events: [{ event_type: "started", message: "start" }, { event_type: "failed", message: "failure" }],
            commands: [{ command: "bun test", status: "failed", output_summary: "1 fail" }],
          }],
        },
        approvals: [{ gate: "release", status: "pending" }],
      },
    });

    const simulation = JSON.parse(result.content[0]!.text);
    expect(simulation.mutates_database).toBe(false);
    expect(simulation.task.final_status).toBe("failed");
    expect(simulation.commands.failed).toBe(1);
    expect(simulation.approvals.pending).toBe(1);
    expect(getTask(task.id, db)!.status).toBe(before);
  });

  it("manages local extension registry through MCP without hosted calls", async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const previousHome = process.env["HOME"];
    const home = mkdtempSync(join(tmpdir(), "todos-mcp-extensions-home-"));
    const source = mkdtempSync(join(tmpdir(), "todos-mcp-extensions-source-"));
    process.env["HOME"] = home;
    resetConfig();
    try {
      writeFileSync(join(source, "todos.extension.json"), JSON.stringify({
        name: "mcp-extension",
        version: "1.0.0",
        compatibility: { todos: "*" },
        permissions: ["tasks:read"],
        mcp_tools: [{ name: "mcp_extension_tool" }],
      }, null, 2));
      const tools = captureTools(registerTaskResources);

      const inspected = JSON.parse((await callCapturedTool(tools, "inspect_local_extension", { source })).content[0]!.text);
      expect(inspected.validation.ok).toBe(true);
      expect(inspected.checksum).toMatch(/^sha256:/);

      const compatibility = JSON.parse((await callCapturedTool(tools, "test_local_extension_compatibility", { source })).content[0]!.text);
      expect(compatibility.ok).toBe(true);
      expect(compatibility.summary.mcp_tools).toBe(1);

      const installed = JSON.parse((await callCapturedTool(tools, "install_local_extension", {
        source,
        checksum: inspected.checksum,
        trust: true,
      })).content[0]!.text);
      expect(installed.status).toBe("trusted");
      expect(installed.trusted).toBe(true);

      const listed = JSON.parse((await callCapturedTool(tools, "list_local_extensions", {})).content[0]!.text);
      expect(listed.map((extension: { name: string }) => extension.name)).toEqual(["mcp-extension"]);

      const removed = JSON.parse((await callCapturedTool(tools, "remove_local_extension", { name: "mcp-extension" })).content[0]!.text);
      expect(removed.removed).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
      resetConfig();
      rmSync(home, { recursive: true, force: true });
      rmSync(source, { recursive: true, force: true });
    }
  });

  it("registers guided local workflow prompts and catalog resource", async () => {
    const resources = new Map<string, () => unknown>();
    const prompts = new Map<string, { description: string; handler: (args: Record<string, string>) => unknown }>();
    const server = {
      resource(_name: string, uri: string, _metadata: unknown, handler: () => unknown) {
        resources.set(uri, handler);
      },
      prompt(name: string, description: string, _schema: unknown, handler: (args: Record<string, string>) => unknown) {
        prompts.set(name, { description, handler });
      },
    };

    registerWorkflowPrompts(server as any);
    expect(prompts.has("goal_planning")).toBe(true);
    expect(prompts.has("incident_response")).toBe(true);
    expect(resources.has("todos://workflow-prompts")).toBe(true);

    const rendered = prompts.get("goal_planning")!.handler({ objective: "Ship release", task_id: "abcd1234" }) as any;
    expect(rendered.description).toContain("goal");
    expect(rendered.messages[0].content.text).toContain("Ship release");

    const catalog = await resources.get("todos://workflow-prompts")!() as any;
    const promptsJson = JSON.parse(catalog.contents[0].text);
    expect(promptsJson.map((prompt: { id: string }) => prompt.id)).toContain("verification");
  });

  it("agent run dispatcher tools queue and dry-run local adapters", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const previousHome = process.env["HOME"];
    const home = mkdtempSync(join(tmpdir(), "todos-mcp-agent-runs-home-"));
    process.env["HOME"] = home;
    resetConfig();

    const tools = captureTools(registerTaskResources);
    const task = createTask({ title: "Queued from MCP" }, db);
    const adapterResult = await callCapturedTool(tools, "set_agent_run_adapter", { name: "codex", command: "printf ok" });
    expect(JSON.parse(adapterResult.content[0]!.text).name).toBe("codex");

    const queuedResult = await callCapturedTool(tools, "queue_agent_run", { task_id: task.id, adapter: "codex", agent_id: "codex" });
    const queued = JSON.parse(queuedResult.content[0]!.text);
    expect(queued.dispatcher.state).toBe("queued");

    const dryRunResult = await callCapturedTool(tools, "run_next_agent_dispatch", { dry_run: true });
    expect(JSON.parse(dryRunResult.content[0]!.text).dry_run).toBe(true);

    const listResult = await callCapturedTool(tools, "list_agent_run_queue", {});
    expect(JSON.parse(listResult.content[0]!.text)[0].run.id).toBe(queued.run.id);

    await callCapturedTool(tools, "cancel_agent_run_dispatch", { run_id: queued.run.id });
    await callCapturedTool(tools, "retry_agent_run_dispatch", { run_id: queued.run.id });
    await callCapturedTool(tools, "remove_agent_run_adapter", { name: "codex" });

    if (previousHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = previousHome;
    resetConfig();
    rmSync(home, { recursive: true, force: true });
  });

  it("inbox tools capture and dedupe local failure intake", async () => {
    const tools = captureTools(registerTaskResources);

    const createdResult = await callCapturedTool(tools, "create_inbox_item", {
      body: `GitHub Actions failed\n${["bearer", "abcdefghijklmnopqrstuvwxyz"].join(" ")}`,
      source_type: "ci_log",
      metadata: { secret: "hidden" },
    });
    const created = JSON.parse(createdResult.content[0]!.text);
    expect(created.item.source_type).toBe("ci_log");
    expect(created.item.body).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(created.item.metadata.secret).toBe("[REDACTED]");
    expect(created.task.tags).toContain("ci_log");

    const duplicateResult = await callCapturedTool(tools, "create_inbox_item", {
      body: `GitHub Actions failed\n${["bearer", "abcdefghijklmnopqrstuvwxyz"].join(" ")}`,
      source_type: "ci_log",
    });
    const duplicate = JSON.parse(duplicateResult.content[0]!.text);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.item.id).toBe(created.item.id);

    const listResult = await callCapturedTool(tools, "list_inbox_items", { source_type: "ci_log" });
    const items = JSON.parse(listResult.content[0]!.text);
    expect(items).toHaveLength(1);

    const itemResult = await callCapturedTool(tools, "get_inbox_item", { id: created.item.id.slice(0, 8) });
    const item = JSON.parse(itemResult.content[0]!.text);
    expect(item.id).toBe(created.item.id);
  });

  it("comment wrappers persist and read the real comment fields", async () => {
    const projectTools = captureTools(registerTaskProjectTools);
    const advTools = captureTools(registerTaskAdvTools);
    const task = createTask({ title: "Comment via MCP" }, db);

    await callCapturedTool(projectTools, "create_comment", {
      task_id: task.id,
      body: "Project comment body",
    });
    await callCapturedTool(advTools, "add_comment", {
      task_id: task.id,
      body: "Alias comment body",
    });

    const comments = listComments(task.id, db);
    expect(comments.map(comment => comment.content)).toEqual([
      "Project comment body",
      "Alias comment body",
    ]);

    const result = await callCapturedTool(advTools, "get_comments", { task_id: task.id });
    expect(result.content[0]!.text).toContain("Alias comment body");
  });

  it("activity timeline wrapper returns redacted local task and run events", async () => {
    const tools = captureTools(registerTaskProjectTools);
    const task = createTask({ title: "Timeline via MCP" }, db);
    addComment({ task_id: task.id, content: `${["Bearer", "abcdefghijklmnop"].join(" ")} should redact` }, db);
    const run = startTaskRun({ task_id: task.id, agent_id: "codex" }, db);
    addTaskRunEvent({ run_id: run.id, event_type: "progress", message: ["Bearer", "bcdefghijklmnopq"].join(" ") }, db);

    const result = await callCapturedTool(tools, "get_activity_timeline", {
      entity_type: "task",
      entity_id: task.id,
      order: "asc",
    });
    const timeline = JSON.parse(result.content[0]!.text);
    expect(timeline.entries.map((entry: { source: string }) => entry.source)).toEqual(expect.arrayContaining(["comment", "run_event"]));
    expect(JSON.stringify(timeline.entries)).toContain("[REDACTED]");
    expect(JSON.stringify(timeline.entries)).not.toContain("abcdefghijklmnop");
  });

  it("local field wrappers set, get, and query task metadata", async () => {
    const tools = captureTools(registerTaskProjectTools);
    const task = createTask({ title: "MCP fielded" }, db);

    const setResult = await callCapturedTool(tools, "set_task_fields", {
      task_id: task.id,
      labels: ["mcp", "bug"],
      priority: "critical",
      severity: "s0",
      owner: "codex",
      area: "metadata",
      custom: { component: "fields" },
    });
    const setPayload = JSON.parse(setResult.content[0]!.text);
    expect(setPayload.task.priority).toBe("critical");
    expect(setPayload.fields.labels).toEqual(["bug", "mcp"]);

    const getResult = await callCapturedTool(tools, "get_task_fields", { task_id: task.id });
    const fields = JSON.parse(getResult.content[0]!.text);
    expect(fields.owner).toBe("codex");
    expect(fields.custom.component).toBe("fields");

    const queryResult = await callCapturedTool(tools, "query_tasks_by_fields", {
      labels: ["mcp"],
      severity: "s0",
      custom: { component: "fields" },
    });
    const query = JSON.parse(queryResult.content[0]!.text);
    expect(query.count).toBe(1);
    expect(query.tasks[0].id).toBe(task.id);
  });

  it("duplicate wrappers scan and merge without dropping task records", async () => {
    const tools = captureTools(registerTaskProjectTools);
    const primary = createTask({ title: "MCP duplicate parser crash" }, db);
    const duplicate = createTask({ title: "MCP duplicate parser crash" }, db);

    const scanResult = await callCapturedTool(tools, "find_duplicate_tasks", { threshold: 0.8 });
    const scan = JSON.parse(scanResult.content[0]!.text);
    expect(scan.count).toBeGreaterThanOrEqual(1);
    expect(scan.candidates.some((candidate: { primary_task: Task; duplicate_task: Task }) => {
      const pair = new Set([candidate.primary_task.id, candidate.duplicate_task.id]);
      return pair.has(primary.id) && pair.has(duplicate.id);
    })).toBe(true);

    const mergeResult = await callCapturedTool(tools, "merge_duplicate_task", {
      primary_task_id: primary.id,
      duplicate_task_id: duplicate.id,
      agent_id: "codex",
      reason: "same MCP task",
    });
    const merge = JSON.parse(mergeResult.content[0]!.text);
    expect(merge.primary_task.id).toBe(primary.id);
    expect(merge.archived_duplicate.status).toBe("cancelled");
    expect(merge.archived_duplicate.metadata.merged_into).toBe(primary.id);
    expect(getTask(duplicate.id)?.status).toBe("cancelled");
  });

  it("search_tasks wrapper calls the search library", async () => {
    const tools = captureTools(registerTaskProjectTools);
    createTask({ title: "Needle wrapper task" }, db);

    const result = await callCapturedTool(tools, "search_tasks", {
      query: "Needle",
    });

    expect(result.content[0]!.text).toContain("Needle wrapper task");
  });

  it("saved search view wrappers manage local views", async () => {
    const tools = captureTools(registerTaskProjectTools);
    const task = createTask({ title: "Needle saved view task", tags: ["views"] }, db);

    const savedResult = await callCapturedTool(tools, "save_search_view", {
      name: "mcp-needle",
      query: "Needle",
      scope: "tasks",
      tags: ["views"],
    });
    expect(JSON.parse(savedResult.content[0]!.text).name).toBe("mcp-needle");

    const listResult = await callCapturedTool(tools, "list_search_views", {});
    expect(JSON.parse(listResult.content[0]!.text).map((view: { name: string }) => view.name)).toContain("mcp-needle");

    const runResult = await callCapturedTool(tools, "run_search_view", { name: "mcp-needle" });
    const run = JSON.parse(runResult.content[0]!.text);
    expect(run.count).toBe(1);
    expect(run.results[0].entity.id).toBe(task.id);

    const deletedResult = await callCapturedTool(tools, "delete_search_view", { name: "mcp-needle" });
    expect(JSON.parse(deletedResult.content[0]!.text).deleted).toBe(true);
  });

  it("task contract wrappers expose acceptance criteria and review gates", async () => {
    const tools = captureTools(registerTaskAdvTools);
    const task = createTask({ title: "Contract via MCP" }, db);

    const contractResult = await callCapturedTool(tools, "set_task_contract", {
      task_id: task.id,
      acceptance_criteria: ["MCP stores criteria"],
      verification_commands: ["bun test src/mcp/mcp.test.ts"],
      expected_artifacts: ["logs/mcp.txt"],
      risk_level: "high",
      done_definition: ["review approved"],
    });
    expect(contractResult.content[0]!.text).toContain("MCP stores criteria");

    const reviewResult = await callCapturedTool(tools, "request_task_review", {
      task_id: task.id,
      requester: "codex",
      reviewer: "reviewer",
    });
    expect(reviewResult.content[0]!.text).toContain("\"state\": \"requested\"");

    const checkResult = await callCapturedTool(tools, "check_task_done_contract", { task_id: task.id });
    const check = JSON.parse(checkResult.content[0]!.text);
    expect(check.ok).toBe(false);
    expect(check.missing).toEqual(expect.arrayContaining(["task_status_completed", "review_approved"]));

    const showResult = await callCapturedTool(tools, "get_task_contract", { task_id: task.id });
    expect(showResult.content[0]!.text).toContain("\"reviewer\": \"reviewer\"");

    const reopenedResult = await callCapturedTool(tools, "record_task_review", {
      task_id: task.id,
      state: "reopened",
      reviewer: "reviewer",
      notes: "Needs another pass",
    });
    expect(reopenedResult.content[0]!.text).toContain("\"state\": \"reopened\"");
  });

  it("auto tools report deadlines and health without dead imports", async () => {
    const tools = captureTools(registerTaskAutoTools);
    createTask({
      title: "Due soon via MCP",
      due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }, db);

    const deadlines = await callCapturedTool(tools, "notify_upcoming_deadlines", { hours: 2 });
    expect(deadlines.content[0]!.text).toContain("Due soon via MCP");

    const health = await callCapturedTool(tools, "get_health", {});
    expect(health.content[0]!.text).toContain("Tasks:");

    const doctor = await callCapturedTool(tools, "run_doctor", { apply: false });
    expect(doctor.content[0]!.text).toContain("\"dry_run\": true");
    expect(doctor.content[0]!.text).toContain("migration_level");
  });

  it("machine tools expose heartbeat and topology diagnostics", async () => {
    const tools = captureTools(registerMachineTools);
    await callCapturedTool(tools, "machines_register", {
      name: "spark02",
      hostname: "spark02",
      tailscale_name: "spark02.tailnet",
      tailscale_ip: "100.64.0.11",
      lan_address: "192.168.8.11",
      workspace_path: "/home/hasna/workspace",
    });

    const heartbeat = await callCapturedTool(tools, "machines_heartbeat", {
      name: "spark02",
      workspace_path: "/home/hasna/workspace",
    });
    expect(heartbeat.content[0]!.text).toContain("spark02");

    const topology = await callCapturedTool(tools, "machines_topology", { stale_minutes: 30 });
    expect(topology.content[0]!.text).toContain("spark02");
    expect(topology.content[0]!.text).toContain("100.64.0.11");
  });

  it("auto get_stale_tasks accepts MCP hour and minute parameters", async () => {
    const tools = captureTools(registerTaskAutoTools);
    const task = createTask({ title: "Stale wrapper task", status: "in_progress" }, db);
    const staleTime = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    db.run("UPDATE tasks SET updated_at = ?, locked_at = ? WHERE id = ?", [staleTime, staleTime, task.id]);

    const result = await callCapturedTool(tools, "get_stale_tasks", { minutes: 30 });
    expect(result.content[0]!.text).toContain("Stale wrapper task");
  });

  it("workflow queue tools expose next, claim, changed, status, and context", async () => {
    const workflowTools = captureTools(registerTaskWorkflowTools);
    const advTools = captureTools(registerTaskAdvTools);
    const task = createTask({ title: "Queue via MCP", priority: "high" }, db);

    const status = await callCapturedTool(advTools, "get_status", {});
    expect(JSON.parse(status.content[0]!.text).pending).toBeGreaterThanOrEqual(1);

    const next = await callCapturedTool(workflowTools, "get_next_task", { agent_id: "mcp" });
    expect(next.content[0]!.text).toContain("Queue via MCP");

    const changed = await callCapturedTool(workflowTools, "get_tasks_changed_since", {
      since: "2000-01-01T00:00:00.000Z",
    });
    expect(changed.content[0]!.text).toContain("Queue via MCP");

    const context = await callCapturedTool(workflowTools, "get_context", { agent_id: "mcp" });
    expect(JSON.parse(context.content[0]!.text).next_task.title).toBe("Queue via MCP");

    await callCapturedTool(workflowTools, "claim_next_task", { agent_id: "mcp" });
    expect(getTask(task.id, db)!.status).toBe("in_progress");
  });

  it("workflow claim_next_task can steal stale local work when requested", async () => {
    const workflowTools = captureTools(registerTaskWorkflowTools);
    const task = createTask({ title: "Steal via MCP" }, db);
    startTask(task.id, "old-agent", db);
    const staleTime = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    db.run("UPDATE tasks SET updated_at = ?, locked_at = ? WHERE id = ?", [staleTime, staleTime, task.id]);

    const result = await callCapturedTool(workflowTools, "claim_next_task", {
      agent_id: "new-agent",
      steal_stale: true,
      stale_minutes: 30,
    });

    expect(result.content[0]!.text).toContain("Stolen");
    expect(getTask(task.id, db)!.locked_by).toBe("new-agent");
  });

  it("task detail tools are compact by default and expand on request", async () => {
    const crudTools = captureTools(registerTaskCrudTools);
    const advTools = captureTools(registerTaskAdvTools);
    const task = createTask({
      title: "Compact task via MCP",
      description: "Long context ".repeat(40),
    }, db);
    addComment({ task_id: task.id, content: "Progress note ".repeat(30), type: "progress" }, db);

    const compact = await callCapturedTool(crudTools, "get_task", { task_id: task.id, max_description_chars: 40 });
    const compactPayload = JSON.parse(compact.content[0]!.text);
    expect(compactPayload.title).toBe("Compact task via MCP");
    expect(compactPayload.description.length).toBeLessThanOrEqual(40);

    const full = await callCapturedTool(crudTools, "get_task", { task_id: task.id, detail: "full" });
    expect(full.content[0]!.text).toContain("Long context");

    const context = await callCapturedTool(advTools, "task_context", { task_id: task.id });
    const contextPayload = JSON.parse(context.content[0]!.text);
    expect(contextPayload.comments.count).toBe(1);
    expect(contextPayload.comments.recent[0].content.length).toBeLessThan(180);
  });

  it("agent tools register heartbeat and release agents", async () => {
    const tools = captureTools(registerAgentTools);

    const registered = await callCapturedTool(tools, "register_agent", {
      name: "McpAgent",
      role: "agent",
      capabilities: ["testing"],
    });
    expect(registered.content[0]!.text).toContain("Agent registered");

    const heartbeat = await callCapturedTool(tools, "heartbeat", { agent_id: "mcpagent" });
    expect(heartbeat.content[0]!.text).toContain("Heartbeat");

    const released = await callCapturedTool(tools, "release_agent", { agent_id: "mcpagent" });
    expect(released.content[0]!.text).toContain("Agent released");
  });

  it("agent tools reject generated generic names", async () => {
    const tools = captureTools(registerAgentTools);
    const tool = tools.get("register_agent");
    expect(tool).toBeDefined();

    const result = await tool!.handler({
      name: "agent-1",
    }) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Invalid agent name");
  });

  it("template tools expose the bundled local library and database templates", async () => {
    const tools = captureTools(registerTemplateTools);

    const library = await callCapturedTool(tools, "list_template_library", {});
    const templates = JSON.parse(library.content[0]!.text) as Array<{ name: string; task_count: number }>;
    expect(templates.map((template) => template.name)).toEqual(expect.arrayContaining([
      "bug-fix",
      "feature-implementation",
      "security-review",
      "release",
      "migration",
      "incident",
      "docs-refresh",
      "qa",
    ]));
    expect(templates.find((template) => template.name === "qa")!.task_count).toBeGreaterThan(0);

    const initialized = await callCapturedTool(tools, "init_templates", {});
    expect(initialized.content[0]!.text).toContain("Created");

    const listed = await callCapturedTool(tools, "list_templates", {});
    expect(listed.content[0]!.text).toContain("feature-implementation");
  });
});

describe("Recurring task operations", () => {
  it("create_task with recurrence_rule", () => {
    const task = createTask(
      { title: "Daily standup", recurrence_rule: "every weekday" },
      db,
    );
    expect(task.title).toBe("Daily standup");
    expect(task.recurrence_rule).toBe("every weekday");
  });

  it("complete recurring task spawns next instance", () => {
    const task = createTask(
      { title: "Weekly review", recurrence_rule: "every week" },
      db,
    );
    const completed = completeTask(task.id, undefined, db);
    expect(completed.status).toBe("completed");
    expect(completed.metadata._next_recurrence).toBeDefined();

    const next = completed.metadata._next_recurrence as { id: string; due_at: string };
    const spawned = getTask(next.id, db);
    expect(spawned).not.toBeNull();
    expect(spawned!.recurrence_rule).toBe("every week");
    expect(spawned!.recurrence_parent_id).toBe(task.id);
    expect(spawned!.due_at).toBeTruthy();
  });

  it("complete with skip_recurrence prevents next instance", () => {
    const task = createTask(
      { title: "Skippable", recurrence_rule: "every day" },
      db,
    );
    const completed = completeTask(task.id, undefined, db, { skip_recurrence: true });
    expect(completed.status).toBe("completed");
    expect(completed.metadata._next_recurrence).toBeUndefined();

    // Only the original task should exist (now completed)
    const all = listTasks({}, db);
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(task.id);
  });

  it("list with has_recurrence filter", () => {
    createTask({ title: "Recurring", recurrence_rule: "every day" }, db);
    createTask({ title: "One-off" }, db);

    const recurring = listTasks({ has_recurrence: true }, db);
    expect(recurring).toHaveLength(1);
    expect(recurring[0]!.title).toBe("Recurring");

    const nonRecurring = listTasks({ has_recurrence: false }, db);
    expect(nonRecurring).toHaveLength(1);
    expect(nonRecurring[0]!.title).toBe("One-off");
  });

  it("create_handoff equivalent", () => {
    const { createHandoff } = require("../db/handoffs.js") as any;
    const h = createHandoff({ agent_id: "brutus", summary: "MCP handoff test", completed: ["task1"], next_steps: ["task2"] }, db);
    expect(h.agent_id).toBe("brutus");
    expect(h.summary).toBe("MCP handoff test");
    expect(h.completed).toEqual(["task1"]);
    expect(h.next_steps).toEqual(["task2"]);
  });

  it("get_latest_handoff equivalent", () => {
    const { createHandoff, getLatestHandoff } = require("../db/handoffs.js") as any;
    createHandoff({ agent_id: "brutus", summary: "First" }, db);
    createHandoff({ agent_id: "brutus", summary: "Second" }, db);
    createHandoff({ agent_id: "maximus", summary: "Other agent" }, db);
    const latest = getLatestHandoff("brutus", undefined, db);
    expect(latest).not.toBeNull();
    expect(latest.summary).toBe("Second");
  });
});
