import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logTaskChange } from "./db/audit.js";
import { addComment } from "./db/comments.js";
import { upsertCheckpoint } from "./db/checkpoints.js";
import { closeDatabase, getDatabase, resetDatabase } from "./db/database.js";
import { createDispatch } from "./db/dispatches.js";
import { registerAgent } from "./db/agents.js";
import { createProject } from "./db/projects.js";
import { buildTaskBoardSnapshot, createCalendarItem, createTaskBoard, exportCalendarIcs, getStatus, getTimeReport, listCalendarEvents, startFocusSession, stopFocusSession } from "./db/tasks.js";
import { createTaskList } from "./db/task-lists.js";
import { createTask } from "./db/task-crud.js";
import { createTemplate } from "./db/templates.js";
import { getLocalActivityTimeline } from "./lib/activity-timeline.js";
import { createAgentContextPack } from "./lib/context-packs.js";
import { captureEnvironmentSnapshot, compareEnvironmentSnapshots } from "./lib/environment-snapshots.js";
import { buildCodebaseIndex, extractTodos } from "./lib/extract.js";
import { resetConfig } from "./lib/config.js";
import { getTaskLocalFields, setTaskLocalFields } from "./lib/local-fields.js";
import { testExtensionCompatibility } from "./lib/local-extensions.js";
import { getLocalSnapshot, pollLocalSnapshots } from "./lib/local-snapshots.js";
import { listOnboardingFixtures } from "./lib/onboarding-fixtures.js";
import { listReviewQueue, upsertReviewRoutingRule, requestReviewQueue } from "./lib/review-queues.js";
import { createMilestone, createRoadmap, exportRoadmapBundle, summarizeRoadmap } from "./lib/roadmaps.js";
import { getPlanningForecast, upsertCapacityProfile } from "./lib/capacity-forecasts.js";
import { getLocalAuditLedger, sealLocalAuditLedger } from "./lib/audit-ledger.js";
import { createReleaseCompatibilityReport } from "./lib/release-compatibility.js";
import { createLocalUsageLedger } from "./lib/usage-ledger.js";
import { createTuiDashboardSnapshot } from "./lib/tui-dashboard.js";
import { createSdkIntegrationFixturePack } from "./lib/sdk-integration-fixtures.js";
import { generateReleaseNotes } from "./lib/release-notes.js";
import { previewRetentionCleanup } from "./lib/retention-cleanup.js";
import { resolveMentions } from "./lib/mention-resolver.js";
import { findDuplicateTasks, mergeDuplicateTask } from "./lib/task-dedupe.js";
import { importExternalIssues } from "./lib/external-issue-importers.js";
import { checkLocalNotifications } from "./lib/local-notifications.js";
import { runVerificationProvider, upsertVerificationProvider } from "./lib/verification-providers.js";
import { createHandoff } from "./db/handoffs.js";
import { createAgentReliabilityExport, getAgentReliabilityScorecard } from "./db/agent-metrics.js";
import { createKnowledgeExportReport, createKnowledgeRecord } from "./db/project-knowledge.js";
import { createRisk, createRiskRegisterExport, scoreProjectHealth } from "./db/project-risks.js";
import { createRetrospective, createRetrospectiveExport } from "./db/retrospectives.js";
import {
  TODOS_JSON_CONTRACTS,
  TODOS_JSON_CONTRACTS_MANIFEST,
  createJsonContractsManifest,
  validateJsonContract,
} from "./json-contracts.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  previousHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "todos-json-contracts-"));
  process.env["HOME"] = home;
  resetConfig();
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  resetConfig();
  rmSync(home, { recursive: true, force: true });
});

let home: string;
let previousHome: string | undefined;

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
      "local_review_queue_item",
      "review_routing_rule",
      "local_roadmap",
      "local_milestone",
      "roadmap_summary",
      "roadmap_bundle",
      "capacity_profile",
      "planning_forecast",
      "local_audit_ledger",
      "local_audit_ledger_checkpoint",
      "release_compatibility_report",
      "local_usage_ledger",
      "terminal_dashboard_snapshot",
      "mention_resolution_report",
      "project_knowledge_record",
      "project_knowledge_export",
      "project_risk_record",
      "risk_register_export",
      "project_health_report",
      "retrospective_record",
      "retrospective_report",
      "retrospective_export",
      "agent_reliability_scorecard",
      "agent_reliability_export",
      "local_task_fields",
      "retention_cleanup_report",
      "duplicate_task_candidate",
      "task_merge_result",
      "external_issue_import_report",
      "verification_provider",
      "verification_provider_result",
      "local_extension_compatibility",
      "agent",
      "handoff",
      "template",
      "task_list",
      "comment",
      "checkpoint",
      "dispatch",
      "audit_history",
      "local_activity_timeline_entry",
      "status_summary",
      "context_pack",
      "release_notes",
      "source_todo_comment",
      "source_code_index",
      "calendar_event",
      "ics_export_result",
      "task_board",
      "board_snapshot",
      "focus_session",
      "time_report_entry",
      "environment_snapshot",
      "environment_snapshot_comparison",
      "local_event_hook",
      "local_event_hook_delivery",
      "terminal_notification_rule",
      "terminal_notification_evaluation",
      "local_notification_check",
      "branch_work_plan",
      "natural_language_intake_preview",
      "local_encryption_profile",
      "local_encryption_envelope",
      "encrypted_local_bridge_bundle",
      "structured_error",
      "api_error",
      "onboarding_fixture",
      "local_snapshot",
      "local_snapshot_poll_result",
      "sdk_integration_fixture_pack",
      "local_bridge_bundle",
      "local_bridge_import_result",
      "cli_mcp_parity_manifest",
      "project_bootstrap_result",
      "saved_search_view",
      "saved_search_run_result",
    ]);
    expect(TODOS_JSON_CONTRACTS_MANIFEST.generatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  test("validates real database objects against their stable output contracts", async () => {
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
    const reviewRoutingRule = upsertReviewRoutingRule({
      name: "contracts-review",
      queue: "qa",
      reviewers: ["reviewer"],
      tags: ["contracts"],
      priorities: ["high"],
      project_id: project.id,
    });
    requestReviewQueue({
      task_id: task.id,
      requester: "jsoncontractagent",
      reason: "contract fixture review",
    }, db);
    const reviewQueueItem = listReviewQueue({ queue: "qa" }, db)[0]!;
    const roadmap = createRoadmap({
      name: "Contract Roadmap",
      description: "Contract roadmap fixture",
      project_id: project.id,
      owner: "jsoncontractagent",
      release: "v1.0",
    });
    const milestone = createMilestone({
      roadmap_id: roadmap.id,
      title: "Contract milestone",
      due_at: "2026-01-10",
      task_ids: [task.id],
      release: "v1.0",
      tags: ["contracts"],
    });
    const roadmapSummary = summarizeRoadmap(roadmap.id, db);
    const roadmapBundle = exportRoadmapBundle(roadmap.id);
    const capacityProfile = upsertCapacityProfile({
      agent_id: "jsoncontractagent",
      project_id: project.id,
      minutes_per_day: 180,
    });
    const planningForecast = getPlanningForecast({ project_id: project.id, agent_id: "jsoncontractagent", start_date: "2026-01-02" }, db);
    setTaskLocalFields(task.id, {
      labels: ["contracts"],
      severity: "s2",
      owner: "jsoncontractagent",
      area: "contracts",
      custom: { fixture: true },
    }, db);
    const localFields = getTaskLocalFields(task.id, db);
    const retentionCleanupReport = previewRetentionCleanup({
      older_than_days: 30,
      now: "2026-01-02T04:00:00.000Z",
    }, db);
    const duplicate = createTask({
      title: "Contract task",
      description: "Duplicate fixture",
      metadata: { source_url: "https://github.com/hasna/todos/issues/991" },
    }, db);
    const sourcePeer = createTask({
      title: "Contract duplicate",
      metadata: { source_url: "https://github.com/hasna/todos/issues/991" },
    }, db);
    const duplicateCandidate = findDuplicateTasks({ threshold: 0.8 }, db)
      .find((candidate) => {
        const ids = new Set([candidate.primary_task.id, candidate.duplicate_task.id]);
        return ids.has(duplicate.id) && ids.has(sourcePeer.id);
      })!;
    const mergeResult = mergeDuplicateTask({
      primary_task_id: duplicate.id,
      duplicate_task_id: sourcePeer.id,
      agent_id: "jsoncontractagent",
      reason: "contract fixture",
    }, db);
    const externalIssueImport = importExternalIssues({
      json: {
        number: 992,
        title: "External contract issue",
        body: "Contract fixture",
        labels: ["contracts"],
        state: "open",
        html_url: "https://github.com/hasna/todos/issues/992",
      },
      provider: "github",
      project_id: project.id,
      apply: true,
    }, db);
    const verificationProvider = upsertVerificationProvider({
      name: "contracts",
      kind: "command",
      command: "printf contracts-ok",
    });
    const verificationProviderResult = await runVerificationProvider({
      name: "contracts",
      task_id: task.id,
      agent_id: "jsoncontractagent",
    }, db);
    const extensionCompatibility = testExtensionCompatibility({
      name: "contract-extension",
      version: "1.0.0",
      compatibility: { todos: "*" },
      permissions: ["tasks:read"],
      mcp_tools: [{ name: "contract_extension_tool", permissions: ["tasks:read"] }],
    });
    const agent = registerAgent({
      name: "jsoncontractagent",
      description: "Contract fixture agent",
      session_id: "json-contract-session",
      working_dir: "/tmp/json-contracts",
    }, db);
    const handoff = createHandoff({
      agent_id: "jsoncontractagent",
      session_id: "json-contract-session",
      summary: "Continue JSON contract task",
      task_ids: [task.id],
      relevant_files: ["src/json-contracts.ts"],
      run_ids: [],
      next_steps: ["validate contract"],
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
    const timeline = getLocalActivityTimeline({ entity_type: "task", entity_id: task.id }, db);
    const status = getStatus({ project_id: project.id }, undefined, { explain_blocked: true }, db);
    const contextPack = createAgentContextPack({ task_id: task.id, profile: "codex" }, db);
    db.run("UPDATE tasks SET status = 'completed', completed_at = ?, metadata = ? WHERE id = ?", [
      "2026-01-02T03:30:00.000Z",
      JSON.stringify({ breaking_change: "Contract output changed", migration_note: "Refresh contract fixtures" }),
      task.id,
    ]);
    const releaseNotes = generateReleaseNotes({
      project_id: project.id,
      title: "Contracts Release",
      generated_at: "2026-01-02T04:00:00.000Z",
    }, db);
    const sourceRoot = mkdtempSync(join(tmpdir(), "todos-contract-source-"));
    writeFileSync(join(sourceRoot, "app.ts"), "function runPlan() {\n  // TODO: Verify source contracts\n}\n");
    const mentionReport = resolveMentions({
      workspace: sourceRoot,
      mentions: ["file:app.ts:1", "symbol:runPlan"],
      now: "2026-01-02T03:04:05.000Z",
    }, db);
    const knowledgeRecord = createKnowledgeRecord({
      record_type: "decision",
      title: "Use local knowledge records",
      decision: "Store decisions in local SQLite.",
      rationale: "Agents need offline context without hosted services.",
      task_id: task.id,
      project_id: project.id,
      agent_id: "jsoncontractagent",
      tags: ["contracts", "knowledge"],
    }, db);
    const knowledgeExport = createKnowledgeExportReport({ project_id: project.id }, db);
    const riskRecord = createRisk({
      title: "Contract release risk",
      severity: "high",
      probability: "medium",
      owner: "jsoncontractagent",
      mitigation: "Keep local evidence green.",
      project_id: project.id,
      task_id: task.id,
      tags: ["contracts", "risk"],
    }, db);
    const riskExport = createRiskRegisterExport({ project_id: project.id }, db);
    const healthReport = scoreProjectHealth(project.id, db);
    const retrospective = createRetrospective({ project_id: project.id, title: "Contract retrospective" }, db);
    const retrospectiveExport = createRetrospectiveExport({ project_id: project.id }, db);
    const reliabilityScorecard = getAgentReliabilityScorecard("jsoncontractagent", { project_id: project.id }, db)!;
    const reliabilityExport = createAgentReliabilityExport({ agent_id: "jsoncontractagent", project_id: project.id }, db);
    const sourceComment = extractTodos({ path: sourceRoot, dry_run: true }).comments[0]!;
    const sourceIndex = buildCodebaseIndex({ path: sourceRoot });
    createCalendarItem({
      title: "Contract calendar milestone",
      kind: "milestone",
      starts_at: "2026-01-02T04:00:00.000Z",
      task_id: task.id,
      project_id: project.id,
    }, db);
    const calendarEvent = listCalendarEvents({ kind: "milestone" }, db)[0]!;
    const icsExport = exportCalendarIcs({ generated_at: "2026-01-02T03:04:05.000Z" }, db);
    const taskBoard = createTaskBoard({ name: "contracts-board", project_id: project.id }, db);
    const boardSnapshot = buildTaskBoardSnapshot(taskBoard.id, db);
    const focusSession = startFocusSession({ task_id: task.id, agent_id: "jsoncontractagent", started_at: "2026-01-02T03:00:00.000Z" }, db);
    const stoppedFocusSession = stopFocusSession({ id: focusSession.id, ended_at: "2026-01-02T03:20:00.000Z" }, db);
    const timeReportEntry = getTimeReport({ include_open: true }, db).find((entry) => entry.task_id === task.id)!;
    const environmentSnapshot = captureEnvironmentSnapshot({ root: import.meta.dir, task_id: task.id, now: "2026-01-02T03:04:05.000Z" });
    const environmentComparison = compareEnvironmentSnapshots(environmentSnapshot, environmentSnapshot);

    expectValid("project", project);
    expectValid("local_review_queue_item", reviewQueueItem);
    expectValid("review_routing_rule", reviewRoutingRule);
    expectValid("local_roadmap", roadmap);
    expectValid("local_milestone", milestone);
    expectValid("roadmap_summary", roadmapSummary);
    expectValid("roadmap_bundle", roadmapBundle);
    expectValid("capacity_profile", capacityProfile);
    expectValid("planning_forecast", planningForecast);
    const auditLedger = getLocalAuditLedger({ task_id: task.id }, db);
    const auditCheckpoint = sealLocalAuditLedger({ name: "contracts", task_id: task.id, agent_id: "jsoncontractagent" }, db);
    const releaseCompatibility = createReleaseCompatibilityReport({
      root: join(import.meta.dir, ".."),
      generated_at: "2026-01-02T03:04:05.000Z",
      simulated_levels: [0],
    });
    const usageLedger = createLocalUsageLedger({
      project_id: project.id,
      generated_at: "2026-01-02T03:04:05.000Z",
      quotas: { max_tasks: 1000, max_projects: 10 },
    }, db);
    const terminalDashboard = createTuiDashboardSnapshot({
      project_id: project.id,
      active_view: "tasks",
      search: "Contract",
    }, db);
    expectValid("local_audit_ledger", auditLedger);
    expectValid("local_audit_ledger_checkpoint", auditCheckpoint);
    expectValid("release_compatibility_report", releaseCompatibility);
    expectValid("local_usage_ledger", usageLedger);
    expectValid("terminal_dashboard_snapshot", terminalDashboard);
    expectValid("task_list", taskList);
    expectValid("task", task);
    expectValid("mention_resolution_report", mentionReport);
    expectValid("project_knowledge_record", knowledgeRecord);
    expectValid("project_knowledge_export", knowledgeExport);
    expectValid("project_risk_record", riskRecord);
    expectValid("risk_register_export", riskExport);
    expectValid("project_health_report", healthReport);
    expectValid("retrospective_record", retrospective);
    expectValid("retrospective_report", retrospective.report);
    expectValid("retrospective_export", retrospectiveExport);
    expectValid("agent_reliability_scorecard", reliabilityScorecard);
    expectValid("agent_reliability_export", reliabilityExport);
    expectValid("local_task_fields", localFields);
    expectValid("retention_cleanup_report", retentionCleanupReport);
    expectValid("duplicate_task_candidate", duplicateCandidate);
    expectValid("task_merge_result", mergeResult);
    expectValid("external_issue_import_report", externalIssueImport);
    expectValid("verification_provider", verificationProvider);
    expectValid("verification_provider_result", verificationProviderResult);
    expectValid("local_extension_compatibility", extensionCompatibility);
    expectValid("agent", agent);
    expectValid("handoff", handoff);
    expectValid("template", template);
    expectValid("comment", comment);
    expectValid("checkpoint", checkpoint);
    expectValid("dispatch", dispatch);
    expectValid("audit_history", history);
    expectValid("local_activity_timeline_entry", timeline.entries[0]);
    expectValid("status_summary", status);
    expectValid("context_pack", contextPack);
    expectValid("release_notes", releaseNotes);
    expectValid("source_todo_comment", sourceComment);
    expectValid("source_code_index", sourceIndex);
    expectValid("calendar_event", calendarEvent);
    expectValid("ics_export_result", icsExport);
    expectValid("task_board", taskBoard);
    expectValid("board_snapshot", boardSnapshot);
    expectValid("focus_session", stoppedFocusSession);
    expectValid("time_report_entry", timeReportEntry);
    expectValid("environment_snapshot", environmentSnapshot);
    expectValid("environment_snapshot_comparison", environmentComparison);
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
    expectValid("terminal_notification_rule", {
      name: "blocked",
      enabled: true,
      events: ["task.blocked", "task.failed"],
      min_severity: "warning",
      format: "line",
      bell: true,
    });
    expectValid("terminal_notification_evaluation", {
      rule: "blocked",
      matched: true,
      skipped_reasons: [],
      notifications: [{
        rule: "blocked",
        event_type: "task.failed",
        severity: "critical",
        title: "Deploy failed",
        message: "task.failed: Deploy failed",
        timestamp: "2026-01-02T03:04:05.000Z",
        bell: true,
        payload: {},
      }],
    });
    const localNotificationCheck = await checkLocalNotifications({
      now: "2026-01-02T03:04:05.000Z",
      include_runs: false,
      include_calendar: false,
    }, db);
    expectValid("local_notification_check", localNotificationCheck);
    expectValid("branch_work_plan", {
      schema_version: 1,
      local_only: true,
      generated_at: "2026-01-02T03:04:05.000Z",
      branch: "task/demo",
      base_branch: "main",
      root: "/repo",
      task_id: "task-1",
      plan_id: null,
      task_ids: ["task-1"],
      files: ["src/demo.ts"],
      conflicts: [],
      git_status: { has_git: true, current_branch: "main", branch_exists: false, dirty_files: [] },
      safe_to_start: true,
      reasons: [],
      commands: ["git switch main", "git switch -c task/demo main"],
    });
    expectValid("natural_language_intake_preview", {
      schema_version: 1,
      local_only: true,
      dry_run: true,
      source_text: "Add task fix parser",
      project_id: null,
      task_list_id: null,
      detected_project_name: null,
      detected_plan_name: null,
      project: null,
      plan: null,
      tasks: [{ title: "fix parser", description: null, priority: "medium", tags: [], assigned_to: null, due_at: null, depends_on: [], acceptance_criteria: [] }],
      dependencies: [],
      acceptance_criteria: [],
      created_project: null,
      created_plan: null,
      created_tasks: [],
      warnings: [],
      commands: ["todos add \"fix parser\" --priority medium"],
    });
    expectValid("local_encryption_profile", {
      name: "default",
      algorithm: "aes-256-gcm",
      kdf: "scrypt",
      key_env: "TODOS_ENCRYPTION_KEY",
      salt: "c2FsdA==",
    });
    expectValid("local_encryption_envelope", {
      schemaVersion: 1,
      kind: "hasna.todos.encrypted-value",
      encryptedAt: "2026-01-02T03:04:05.000Z",
      profile: "default",
      key_env: "TODOS_ENCRYPTION_KEY",
      algorithm: "aes-256-gcm",
      kdf: "scrypt",
      salt: "c2FsdA==",
      iv: "aXY=",
      auth_tag: "dGFn",
      ciphertext: "Y2lwaGVydGV4dA==",
      plaintext_sha256: "abc",
    });
    expectValid("encrypted_local_bridge_bundle", {
      schemaVersion: 1,
      kind: "hasna.todos.encrypted-bridge",
      encryptedAt: "2026-01-02T03:04:05.000Z",
      package: { packageName: "@hasna/todos", repository: "hasna/todos", version: "1.2.3" },
      plaintext: { kind: "hasna.todos.local-bridge", schemaVersion: 1, sha256: "abc" },
      encryption: { profile: "default", key_env: "TODOS_ENCRYPTION_KEY", algorithm: "aes-256-gcm", kdf: "scrypt", salt: "c2FsdA==", iv: "aXY=", auth_tag: "dGFn", ciphertext: "Y2lwaGVydGV4dA==" },
      warnings: ["key material is not stored"],
    });
    expectValid("structured_error", {
      code: "TASK_NOT_FOUND",
      message: "Task not found",
      suggestion: "Use list_tasks.",
    });
    expectValid("api_error", { error: "Task not found" });
    expectValid("onboarding_fixture", listOnboardingFixtures()[0]);
    expectValid("local_snapshot", getLocalSnapshot({
      type: "tasks",
      generatedAt: "2026-01-02T03:04:05.000Z",
    }, db));
    expectValid("local_snapshot_poll_result", pollLocalSnapshots({
      types: ["tasks"],
      generatedAt: "2026-01-02T03:04:05.000Z",
    }, db));
    expectValid("sdk_integration_fixture_pack", createSdkIntegrationFixturePack({
      version: "1.2.3",
      generatedAt: "2026-01-02T03:04:05.000Z",
    }));
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
    expectValid("saved_search_view", {
      id: "view-1",
      name: "active-cli",
      description: null,
      scope: "tasks",
      filters: { query: "parser", tags: ["cli"] },
      created_at: "2026-01-02T03:04:05.000Z",
      updated_at: "2026-01-02T03:04:05.000Z",
    });
    expectValid("saved_search_run_result", {
      scope: "tasks",
      filters: { query: "parser" },
      count: 1,
      results: [{ entity_type: "tasks", entity: { id: "task-1", title: "Parser" } }],
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
