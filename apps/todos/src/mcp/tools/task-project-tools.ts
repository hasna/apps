// @ts-nocheck
/**
 * Task project tools for the MCP server.
 * Auto-extracted from src/mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Task } from "../../types/index.js";
import {
  getTask, updateTask, createTask, listTasks,
  startTask, completeTask, setTaskStatus, setTaskPriority,
  addDependency, removeDependency, getTaskGraph,
  lockTask, unlockTask, getTaskLockStatus,
} from "../../db/tasks.js";
import type { TaskGraph } from "../../db/tasks.js";
import {
  createProject, listProjects, getProject, updateProject, deleteProject,
} from "../../db/projects.js";
import {
  createTaskList, listTaskLists, getTaskList, updateTaskList, deleteTaskList,
} from "../../db/task-lists.js";
import {
  createPlan, listPlans, getPlan, updatePlan, deletePlan,
} from "../../db/plans.js";
import { getTodosCloudClient, cloudTaskAction, cloudUpdateTask, cloudAddComment } from "../../cli/cloud-router.js";
import {
  addComment, listComments, updateComment, deleteComment,
} from "../../db/comments.js";
import { resolveTaskRunId } from "../../db/task-runs.js";
import { bootstrapProject } from "../../lib/project-bootstrap.js";
import { getDatabase } from "../../db/database.js";
import {
  assignLabelToTask,
  createLabel,
  deleteLabel,
  getLabel,
  listLabels,
  updateLabel,
} from "../../db/labels.js";
import {
  createTag,
  deleteTag,
  getTag,
  listTags,
  updateTag,
} from "../../db/tags.js";
import {
  getSecretSafetyConfig,
  listSecretFindings,
  upsertSecretSafetyConfig,
} from "../../lib/redaction.js";
import {
  RETENTION_CLEANUP_CONFIRMATION,
  applyRetentionCleanup,
  previewRetentionCleanup,
} from "../../lib/retention-cleanup.js";
import { resolveMentions } from "../../lib/mention-resolver.js";
import {
  checkWorkspacePermission,
  getWorkspaceTrustStatus,
  listWorkspaceTrustProfiles,
  removeWorkspaceTrustProfile,
  upsertWorkspaceTrustProfile,
} from "../../lib/workspace-trust.js";
import {
  checkRunnerSandbox,
  explainRunnerSandbox,
  listRunnerSandboxProfiles,
  removeRunnerSandboxProfile,
  upsertRunnerSandboxProfile,
} from "../../lib/runner-sandbox.js";
import {
  explainPolicyPack,
  listPolicyPacks,
  removePolicyPack,
  upsertPolicyPack,
  validatePolicyPack,
} from "../../lib/policy-packs.js";
import {
  approveApprovalGate,
  checkApprovalGate,
  expireApprovalGate,
  listApprovalGates,
  rejectApprovalGate,
  requestApprovalGate,
} from "../../lib/approval-gates.js";
import {
  listLocalEventHooks,
  removeLocalEventHook,
  testLocalEventHook,
  upsertLocalEventHook,
} from "../../lib/event-hooks.js";
import {
  describeTerminalNotificationRule,
  evaluateTerminalWatchRules,
  listTerminalNotificationRules,
  removeTerminalNotificationRule,
  testTerminalNotificationRule,
  upsertTerminalNotificationRule,
} from "../../lib/terminal-notifications.js";
import { checkLocalNotifications } from "../../lib/local-notifications.js";
import {
  decryptValue,
  encryptValue,
  encryptionProfileStatus,
  listEncryptionProfiles,
  removeEncryptionProfile,
  upsertEncryptionProfile,
} from "../../lib/local-encryption.js";
import { getLocalActivityTimeline } from "../../lib/activity-timeline.js";
import { createBranchWorkPlan } from "../../lib/branch-work-plans.js";
import { getTaskLocalFields, queryTasksByLocalFields, setTaskLocalFields } from "../../lib/local-fields.js";
import {
  listWorkflowStates,
  migrateWorkflowStates,
  queryTasksByWorkflowState,
  setTaskWorkflowState,
} from "../../lib/workflow-states.js";
import { previewNaturalLanguageIntake } from "../../lib/natural-language-intake.js";
import { findDuplicateTasks, mergeDuplicateTask } from "../../lib/task-dedupe.js";
import {
  createMilestone,
  createRoadmap,
  deleteMilestone,
  deleteRoadmap,
  exportRoadmapBundle,
  importRoadmapBundle,
  listRoadmaps,
  renderRoadmapMarkdown,
  summarizeRoadmap,
  updateMilestone,
  updateRoadmap,
  upsertReleaseGroup,
} from "../../lib/roadmaps.js";
import {
  getPlanningForecast,
  listCapacityProfiles,
  removeCapacityProfile,
  renderPlanningForecastMarkdown,
  upsertCapacityProfile,
} from "../../lib/capacity-forecasts.js";
import {
  getLocalAuditLedger,
  listLocalAuditLedgerCheckpoints,
  renderLocalAuditLedgerMarkdown,
  sealLocalAuditLedger,
  verifyLocalAuditLedger,
} from "../../lib/audit-ledger.js";
import {
  createReleaseCompatibilityReport,
  renderReleaseCompatibilityMarkdown,
} from "../../lib/release-compatibility.js";
import { TaskNotFoundError, VersionConflictError } from "../../types/index.js";

interface TaskProjectContext {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table?: string) => string;
  formatError: (error: unknown) => string;
  formatTask: (task: Task) => string;
  formatTaskDetail: (task: Task, maxDescriptionChars?: number) => string;
  getAgentFocus: (agentId: string) => { agent_id: string; project_id?: string } | undefined;
}

export function registerTaskProjectTools(server: McpServer, ctx: TaskProjectContext) {
  const { shouldRegisterTool, resolveId, formatError, formatTask } = ctx;

  if (shouldRegisterTool("get_secret_safety")) {
    server.tool("get_secret_safety", "Show local secret redaction configuration.", {}, async () => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(getSecretSafetyConfig(), null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    });
  }

  if (shouldRegisterTool("set_secret_safety")) {
    server.tool(
      "set_secret_safety",
      "Add local secret redaction regex patterns or object key names.",
      {
        redaction_patterns: z.array(z.string()).optional(),
        redaction_keys: z.array(z.string()).optional(),
      },
      async ({ redaction_patterns, redaction_keys }) => {
        try {
          const config = upsertSecretSafetyConfig({ redaction_patterns, redaction_keys });
          return { content: [{ type: "text" as const, text: JSON.stringify(config, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("scan_secret_text")) {
    server.tool(
      "scan_secret_text",
      "Scan text for secret-like values and return counts without exposing values.",
      { text: z.string() },
      async ({ text }) => {
        try {
          const findings = listSecretFindings(text);
          return { content: [{ type: "text" as const, text: JSON.stringify({ ok: findings.length === 0, findings }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("resolve_mentions")) {
    server.tool(
      "resolve_mentions",
      "Resolve local file, line, symbol, git ref, plan, run, task, and agent mentions without hosted lookups.",
      {
        mentions: z.array(z.string()).min(1),
        workspace: z.string().optional().describe("Workspace root for local file, symbol, and git resolution."),
        max_symbol_matches: z.number().int().positive().max(100).optional(),
      },
      async ({ mentions, workspace, max_symbol_matches }) => {
        try {
          const report = resolveMentions({ mentions, workspace, max_symbol_matches });
          return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  const retentionCleanupSchema = {
    older_than_days: z.number().int().positive().describe("Prune records older than this many days"),
    project_id: z.string().optional().describe("Project ID or prefix to scope cleanup"),
    task_statuses: z.array(z.enum(["pending", "in_progress", "completed", "failed", "cancelled"])).optional(),
    run_statuses: z.array(z.enum(["running", "completed", "failed", "cancelled"])).optional(),
    include: z.array(z.enum(["comments", "runs", "verifications", "expired_artifacts"])).optional(),
    now: z.string().optional().describe("ISO timestamp for deterministic previews"),
  };

  if (shouldRegisterTool("preview_retention_cleanup")) {
    server.tool(
      "preview_retention_cleanup",
      "Preview local retention cleanup candidates for comments, runs, verification evidence, and expired artifact files. Never returns raw evidence content.",
      retentionCleanupSchema,
      async (input) => {
        try {
          const report = previewRetentionCleanup({
            ...input,
            project_id: input.project_id ? resolveId(input.project_id, "projects") : undefined,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("apply_retention_cleanup")) {
    server.tool(
      "apply_retention_cleanup",
      `Apply local retention cleanup after a dry run. Requires confirm="${RETENTION_CLEANUP_CONFIRMATION}" and never uploads data.`,
      {
        ...retentionCleanupSchema,
        confirm: z.string().describe(`Exact confirmation string: ${RETENTION_CLEANUP_CONFIRMATION}`),
      },
      async (input) => {
        try {
          const report = applyRetentionCleanup({
            ...input,
            project_id: input.project_id ? resolveId(input.project_id, "projects") : undefined,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  function versionFor(taskId: string, version?: number): number {
    const current = getTask(taskId);
    if (!current) throw new TaskNotFoundError(taskId);
    if (version !== undefined && current.version !== version) {
      throw new VersionConflictError(taskId, version, current.version);
    }
    return current.version;
  }

  function updateWithOptionalVersion(taskId: string, updates: Record<string, unknown>, version?: number): Task {
    return updateTask(taskId, { ...updates, version: versionFor(taskId, version) } as Parameters<typeof updateTask>[1]);
  }

  function formatDependencyGraph(graph: TaskGraph): string {
    const lines: string[] = [];
    const visit = (node: TaskGraph, depth: number, edge: "root" | "depends on" | "blocks") => {
      const prefix = "  ".repeat(depth);
      const edgeLabel = edge === "root" ? "" : `${edge}: `;
      const blocked = node.task.is_blocked ? " blocked" : "";
      lines.push(`${prefix}${edgeLabel}${node.task.short_id || node.task.id.slice(0, 8)} [${node.task.status}] ${node.task.title}${blocked}`);
      for (const dependency of node.depends_on) visit(dependency, depth + 1, "depends on");
      for (const dependent of node.blocks) visit(dependent, depth + 1, "blocks");
    };
    visit(graph, 0, "root");
    return lines.join("\n");
  }

  const roadmapStatusSchema = z.enum(["planned", "active", "completed", "archived"]);
  const milestoneStatusSchema = z.enum(["planned", "active", "completed", "blocked", "archived"]);

  function resolveProjectIdInput(projectId?: string): string | undefined {
    return projectId ? resolveId(projectId, "projects") : undefined;
  }

  function resolveTaskIdsInput(taskIds?: string[]): string[] | undefined {
    return taskIds?.map((taskId) => resolveId(taskId, "tasks"));
  }

  function resolvePlanIdsInput(planIds?: string[]): string[] | undefined {
    return planIds?.map((planId) => resolveId(planId, "plans"));
  }

  function resolveRunIdsInput(runIds?: string[]): string[] | undefined {
    return runIds?.map((runId) => resolveTaskRunId(runId));
  }

  // === WORKSPACE TRUST ===

  if (shouldRegisterTool("list_workspace_trust_profiles")) {
    server.tool("list_workspace_trust_profiles", "List local workspace trust and permission profiles.", {}, async () => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(listWorkspaceTrustProfiles(), null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    });
  }

  if (shouldRegisterTool("get_workspace_trust")) {
    server.tool(
      "get_workspace_trust",
      "Show local trust status for a workspace path.",
      { path: z.string().optional().describe("Workspace path. Defaults to current working directory.") },
      async ({ path }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify(getWorkspaceTrustStatus(path), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("set_workspace_trust")) {
    server.tool(
      "set_workspace_trust",
      "Create or update a local workspace trust and permission profile.",
      {
        root: z.string().describe("Workspace root path"),
        preset: z.enum(["restricted", "readonly", "standard", "trusted"]).optional(),
        trusted: z.boolean().optional(),
        command_allowlist: z.array(z.string()).optional(),
        command_denylist: z.array(z.string()).optional(),
        tool_permissions: z.array(z.string()).optional(),
        write_scopes: z.array(z.string()).optional(),
        env_redactions: z.array(z.string()).optional(),
        require_prompt_for_unsafe: z.boolean().optional(),
      },
      async (input) => {
        try {
          const profile = upsertWorkspaceTrustProfile(input);
          return { content: [{ type: "text" as const, text: JSON.stringify(profile, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("remove_workspace_trust")) {
    server.tool(
      "remove_workspace_trust",
      "Remove a local workspace trust profile.",
      { root: z.string().describe("Workspace root path") },
      async ({ root }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify({ removed: removeWorkspaceTrustProfile(root) }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("check_workspace_permission")) {
    server.tool(
      "check_workspace_permission",
      "Check whether a local command, MCP tool, write path, or env exposure is allowed by the workspace trust profile.",
      {
        path: z.string().optional(),
        command: z.string().optional(),
        tool: z.string().optional(),
        write_path: z.string().optional(),
        env: z.record(z.string()).optional(),
      },
      async (input) => {
        try {
          const result = checkWorkspacePermission(input);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: !result.allowed };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === RUNNER SANDBOXES ===

  if (shouldRegisterTool("list_runner_sandbox_profiles")) {
    server.tool("list_runner_sandbox_profiles", "List local runner sandbox profiles.", {}, async () => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(listRunnerSandboxProfiles(), null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    });
  }

  if (shouldRegisterTool("set_runner_sandbox_profile")) {
    server.tool(
      "set_runner_sandbox_profile",
      "Create or update a local runner sandbox profile.",
      {
        name: z.string(),
        root: z.string().optional(),
        command_allowlist: z.array(z.string()).optional(),
        command_denylist: z.array(z.string()).optional(),
        cwd_boundary: z.string().optional(),
        write_scopes: z.array(z.string()).optional(),
        env_allowlist: z.array(z.string()).optional(),
        env_redactions: z.array(z.string()).optional(),
        network_policy: z.enum(["none", "local", "full"]).optional(),
        require_approval: z.boolean().optional(),
        audit_evidence: z.boolean().optional(),
      },
      async (input) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify(upsertRunnerSandboxProfile(input), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("remove_runner_sandbox_profile")) {
    server.tool(
      "remove_runner_sandbox_profile",
      "Remove a local runner sandbox profile.",
      { name: z.string() },
      async ({ name }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify({ removed: removeRunnerSandboxProfile(name) }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  const runnerSandboxSchema = {
    name: z.string().optional(),
    path: z.string().optional(),
    cwd: z.string().optional(),
    command: z.string().optional(),
    write_paths: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    network: z.boolean().optional(),
  };

  if (shouldRegisterTool("check_runner_sandbox")) {
    server.tool(
      "check_runner_sandbox",
      "Check whether a local runner action is allowed by sandbox and workspace trust policy.",
      runnerSandboxSchema,
      async (input) => {
        try {
          const result = checkRunnerSandbox(input);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: !result.allowed };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("explain_runner_sandbox")) {
    server.tool(
      "explain_runner_sandbox",
      "Return dry-run explain output for a local runner sandbox check.",
      runnerSandboxSchema,
      async (input) => {
        try {
          const result = explainRunnerSandbox(input);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === POLICY PACKS ===

  if (shouldRegisterTool("list_policy_packs")) {
    server.tool("list_policy_packs", "List local policy packs for task done gates.", {}, async () => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(listPolicyPacks(), null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    });
  }

  const policyPackSchema = {
    name: z.string(),
    root: z.string().optional(),
    version: z.number().optional(),
    required_commands: z.array(z.string()).optional(),
    prohibited_commands: z.array(z.string()).optional(),
    prohibited_paths: z.array(z.string()).optional(),
    required_statuses: z.array(z.string()).optional(),
    require_passed_verification: z.boolean().optional(),
    require_commit: z.boolean().optional(),
    require_pull_request: z.boolean().optional(),
    require_approval: z.boolean().optional(),
    require_run: z.boolean().optional(),
    require_artifact: z.boolean().optional(),
    evidence_min_count: z.number().optional(),
    branch_pattern: z.string().optional(),
  };

  if (shouldRegisterTool("set_policy_pack")) {
    server.tool(
      "set_policy_pack",
      "Create or update a local policy pack for task done gates.",
      policyPackSchema,
      async (input) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify(upsertPolicyPack(input), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("remove_policy_pack")) {
    server.tool(
      "remove_policy_pack",
      "Remove a local policy pack.",
      { name: z.string() },
      async ({ name }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify({ removed: removePolicyPack(name) }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  const policyValidationSchema = {
    name: z.string(),
    task_id: z.string(),
    root: z.string().optional(),
  };

  if (shouldRegisterTool("validate_policy_pack")) {
    server.tool(
      "validate_policy_pack",
      "Validate a task against a local policy pack using only local evidence.",
      policyValidationSchema,
      async ({ name, task_id, root }) => {
        try {
          const result = validatePolicyPack({ name, task_id: resolveId(task_id), root });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: !result.passed };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("explain_policy_pack")) {
    server.tool(
      "explain_policy_pack",
      "Return dry-run explain output for a local policy-pack validation.",
      policyValidationSchema,
      async ({ name, task_id, root }) => {
        try {
          const result = explainPolicyPack({ name, task_id: resolveId(task_id), root });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === APPROVAL GATES ===

  const approvalGateSchema = {
    task_id: z.string(),
    gate: z.string(),
    reviewer: z.string().optional(),
    requester: z.string().optional(),
    reason: z.string().optional(),
    note: z.string().optional(),
    plan_id: z.string().optional(),
    run_id: z.string().optional(),
    expires_at: z.string().optional(),
  };

  if (shouldRegisterTool("require_approval_gate")) {
    server.tool(
      "require_approval_gate",
      "Create a local manual approval checkpoint before risky task or run work.",
      approvalGateSchema,
      async ({ task_id, gate, reviewer, requester, reason, plan_id, run_id, expires_at }) => {
        try {
          const result = requestApprovalGate({ task_id: resolveId(task_id), gate, reviewer, requester, reason, plan_id, run_id, expires_at });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("approve_approval_gate")) {
    server.tool(
      "approve_approval_gate",
      "Approve a local manual approval checkpoint.",
      { task_id: z.string(), gate: z.string(), reviewer: z.string().optional(), note: z.string().optional() },
      async ({ task_id, gate, reviewer, note }) => {
        try {
          const result = approveApprovalGate({ task_id: resolveId(task_id), gate, reviewer, note });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("reject_approval_gate")) {
    server.tool(
      "reject_approval_gate",
      "Reject a local manual approval checkpoint.",
      { task_id: z.string(), gate: z.string(), reviewer: z.string().optional(), reason: z.string().optional() },
      async ({ task_id, gate, reviewer, reason }) => {
        try {
          const result = rejectApprovalGate({ task_id: resolveId(task_id), gate, reviewer, reason });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("expire_approval_gate")) {
    server.tool(
      "expire_approval_gate",
      "Expire a pending local manual approval checkpoint.",
      { task_id: z.string(), gate: z.string(), reviewer: z.string().optional(), reason: z.string().optional() },
      async ({ task_id, gate, reviewer, reason }) => {
        try {
          const result = expireApprovalGate({ task_id: resolveId(task_id), gate, reviewer, reason });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("check_approval_gate")) {
    server.tool(
      "check_approval_gate",
      "Check whether a local approval gate allows task or run work to proceed.",
      { task_id: z.string(), gate: z.string() },
      async ({ task_id, gate }) => {
        try {
          const result = checkApprovalGate(resolveId(task_id), gate);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: !result.allowed };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_approval_gates")) {
    server.tool(
      "list_approval_gates",
      "List local approval gates for a task.",
      { task_id: z.string() },
      async ({ task_id }) => {
        try {
          const result = listApprovalGates(resolveId(task_id));
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === LOCAL EVENT HOOKS ===

  if (shouldRegisterTool("list_local_event_hooks")) {
    server.tool("list_local_event_hooks", "List configured local event hooks and automation triggers.", {}, async () => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(listLocalEventHooks(), null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    });
  }

  if (shouldRegisterTool("set_local_event_hook")) {
    server.tool(
      "set_local_event_hook",
      "Create or update a local event hook for task, plan, run, approval, import, or export events.",
      {
        name: z.string().describe("Hook name"),
        events: z.array(z.string()).describe("Event names, or *"),
        target: z.enum(["stdout", "file", "socket", "script"]).describe("Local delivery target"),
        enabled: z.boolean().optional(),
        file_path: z.string().optional(),
        socket_path: z.string().optional(),
        command: z.string().optional(),
        cwd: z.string().optional(),
        sandbox: z.string().optional(),
        env: z.record(z.string()).optional(),
        retry: z.object({ attempts: z.number().optional(), backoff_ms: z.number().optional() }).optional(),
      },
      async (input) => {
        try {
          const hook = upsertLocalEventHook(input as Parameters<typeof upsertLocalEventHook>[0]);
          return { content: [{ type: "text" as const, text: JSON.stringify(hook, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("remove_local_event_hook")) {
    server.tool(
      "remove_local_event_hook",
      "Remove a configured local event hook.",
      { name: z.string().describe("Hook name") },
      async ({ name }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify({ removed: removeLocalEventHook(name) }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("test_local_event_hook")) {
    server.tool(
      "test_local_event_hook",
      "Deliver a test event to one configured local event hook.",
      {
        name: z.string().describe("Hook name"),
        event: z.string().optional().describe("Event type. Defaults to task.completed."),
        payload: z.record(z.unknown()).optional(),
        task_id: z.string().optional().describe("Optional task ID or prefix to include as payload.id"),
      },
      async ({ name, event, payload, task_id }) => {
        try {
          const resolvedPayload = { ...(payload || {}) } as Record<string, unknown>;
          if (task_id) resolvedPayload.id = resolveId(task_id);
          const results = await testLocalEventHook(name, { type: event || "task.completed", payload: resolvedPayload });
          return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === TERMINAL NOTIFICATION WATCH RULES ===

  if (shouldRegisterTool("list_terminal_notification_rules")) {
    server.tool("list_terminal_notification_rules", "List configured local terminal notification watch rules.", {}, async () => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(listTerminalNotificationRules(), null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    });
  }

  if (shouldRegisterTool("set_terminal_notification_rule")) {
    server.tool(
      "set_terminal_notification_rule",
      "Create or update a local terminal notification watch rule for task, plan, run, approval, import, or export events.",
      {
        name: z.string().describe("Rule name"),
        events: z.array(z.string()).describe("Event names, or *"),
        enabled: z.boolean().optional(),
        min_severity: z.enum(["info", "warning", "critical"]).optional(),
        format: z.enum(["line", "json"]).optional(),
        bell: z.boolean().optional(),
        task_statuses: z.array(z.string()).optional(),
        priorities: z.array(z.string()).optional(),
        agent_ids: z.array(z.string()).optional(),
        project_ids: z.array(z.string()).optional(),
        contains: z.array(z.string()).optional(),
        quiet_hours: z.object({
          start: z.string(),
          end: z.string(),
          timezone: z.enum(["utc", "local"]).optional(),
        }).optional(),
      },
      async (input) => {
        try {
          const rule = upsertTerminalNotificationRule(input as Parameters<typeof upsertTerminalNotificationRule>[0]);
          return { content: [{ type: "text" as const, text: JSON.stringify(describeTerminalNotificationRule(rule), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("remove_terminal_notification_rule")) {
    server.tool(
      "remove_terminal_notification_rule",
      "Remove a configured local terminal notification watch rule.",
      { name: z.string().describe("Rule name") },
      async ({ name }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify({ removed: removeTerminalNotificationRule(name) }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("test_terminal_notification_rule")) {
    server.tool(
      "test_terminal_notification_rule",
      "Evaluate one local terminal notification watch rule against a sample event.",
      {
        name: z.string().describe("Rule name"),
        event: z.string().optional().describe("Event type. Defaults to task.failed."),
        payload: z.record(z.unknown()).optional(),
        task_id: z.string().optional().describe("Optional task ID or prefix to include as payload.id"),
      },
      async ({ name, event, payload, task_id }) => {
        try {
          const resolvedPayload = { ...(payload || {}) } as Record<string, unknown>;
          if (task_id) resolvedPayload.id = resolveId(task_id);
          const result = testTerminalNotificationRule(name, { type: event || "task.failed", payload: resolvedPayload });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("evaluate_terminal_watch_rules")) {
    server.tool(
      "evaluate_terminal_watch_rules",
      "Evaluate all local terminal notification watch rules against a sample event.",
      {
        event: z.string().describe("Event type."),
        payload: z.record(z.unknown()).optional(),
      },
      async ({ event, payload }) => {
        try {
          const result = evaluateTerminalWatchRules({ type: event, payload: payload || {} });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("check_local_notifications")) {
    server.tool(
      "check_local_notifications",
      "Check local due-date, SLA, stale-task, completed-run, and calendar reminder alerts; optionally emit local hooks and terminal watch evaluations.",
      {
        project_id: z.string().optional(),
        agent_id: z.string().optional(),
        now: z.string().optional(),
        due_within_minutes: z.number().optional(),
        stale_minutes: z.number().optional(),
        run_since: z.string().optional(),
        include_runs: z.boolean().optional(),
        include_calendar: z.boolean().optional(),
        emit_hooks: z.boolean().optional(),
        evaluate_terminal: z.boolean().optional(),
        quiet_hours: z.object({
          start: z.string(),
          end: z.string(),
          timezone: z.enum(["utc", "local"]).optional(),
        }).optional(),
        limit: z.number().optional(),
      },
      async (input) => {
        try {
          const result = await checkLocalNotifications({
            ...input,
            project_id: input.project_id ? resolveId(input.project_id, "projects") : undefined,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("create_branch_work_plan")) {
    server.tool(
      "create_branch_work_plan",
      "Create a local branch-safe work plan from task or plan files, local file conflicts, and git status.",
      {
        task_id: z.string().optional(),
        plan_id: z.string().optional(),
        branch: z.string().describe("Branch name to plan"),
        base_branch: z.string().optional().describe("Base branch. Defaults to main."),
        paths: z.array(z.string()).optional().describe("Extra planned paths for the branch."),
        root: z.string().optional().describe("Git root to inspect."),
        include_git_status: z.boolean().optional().describe("Whether to inspect local git status. Defaults to true."),
      },
      async ({ task_id, plan_id, branch, base_branch, paths, root, include_git_status }) => {
        try {
          const result = createBranchWorkPlan({
            task_id: task_id ? resolveId(task_id) : undefined,
            plan_id,
            branch,
            base_branch,
            paths,
            root,
            include_git_status,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("preview_natural_language_intake")) {
    server.tool(
      "preview_natural_language_intake",
      "Preview or apply deterministic local natural-language task intake without hosted model calls.",
      {
        text: z.string().describe("Natural-language task intake text."),
        project_id: z.string().optional(),
        task_list_id: z.string().optional(),
        default_priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        reference_date: z.string().optional(),
        apply: z.boolean().optional().describe("Create parsed tasks. Defaults to dry-run preview."),
      },
      async (input) => {
        try {
          const result = previewNaturalLanguageIntake(input);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === LOCAL ENCRYPTION ===

  if (shouldRegisterTool("list_encryption_profiles")) {
    server.tool("list_encryption_profiles", "List local encryption profiles for secure fields and exports.", {}, async () => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(listEncryptionProfiles(), null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    });
  }

  if (shouldRegisterTool("set_encryption_profile")) {
    server.tool(
      "set_encryption_profile",
      "Create or update a local encryption profile. Key material is referenced by environment variable and is never stored.",
      {
        name: z.string(),
        key_env: z.string().optional(),
        description: z.string().optional(),
      },
      async (input) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify(upsertEncryptionProfile(input), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("remove_encryption_profile")) {
    server.tool(
      "remove_encryption_profile",
      "Remove a local encryption profile.",
      { name: z.string() },
      async ({ name }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify({ removed: removeEncryptionProfile(name) }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_encryption_status")) {
    server.tool(
      "get_encryption_status",
      "Show whether a local encryption profile is locked or unlocked.",
      { name: z.string().optional() },
      async ({ name }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify(encryptionProfileStatus(name), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("encrypt_local_value")) {
    server.tool(
      "encrypt_local_value",
      "Encrypt a local JSON value with a configured profile.",
      {
        value: z.unknown(),
        profile: z.string().optional(),
      },
      async ({ value, profile }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify(encryptValue(value, { profile }), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("decrypt_local_value")) {
    server.tool(
      "decrypt_local_value",
      "Decrypt a local encrypted JSON value with the configured profile key.",
      { envelope: z.unknown() },
      async ({ envelope }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify(decryptValue(envelope), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === TASK STATE ===

  if (shouldRegisterTool("start_task")) {
    server.tool(
      "start_task",
      "Mark a task as in_progress. Uses optimistic locking via version if provided.",
      {
        task_id: z.string().describe("Task ID"),
        version: z.number().optional().describe("Expected version for optimistic locking"),
      },
      async ({ task_id, version }) => {
        try {
          const cloud = getTodosCloudClient();
          if (cloud) {
            const task = await cloudTaskAction(cloud, task_id, "start", version !== undefined ? { version } : {});
            return { content: [{ type: "text" as const, text: formatTask(task) }] };
          }
          const resolvedId = resolveId(task_id);
          if (version !== undefined) versionFor(resolvedId, version);
          const current = getTask(resolvedId);
          if (!current) throw new TaskNotFoundError(resolvedId);
          const task = startTask(resolvedId, current.assigned_to || current.agent_id || "mcp");
          return { content: [{ type: "text" as const, text: formatTask(task) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("lock_task")) {
    server.tool(
      "lock_task",
      "Acquire or renew a local task lock lease for an agent.",
      {
        task_id: z.string().describe("Task ID"),
        agent_id: z.string().describe("Agent ID or name acquiring the lock"),
      },
      async ({ task_id, agent_id }) => {
        try {
          const resolvedId = resolveId(task_id);
          const result = lockTask(resolvedId, agent_id);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: !result.success };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("unlock_task")) {
    server.tool(
      "unlock_task",
      "Release a local task lock. The agent must own the active lock unless omitted for force release.",
      {
        task_id: z.string().describe("Task ID"),
        agent_id: z.string().optional().describe("Agent ID or name releasing the lock"),
      },
      async ({ task_id, agent_id }) => {
        try {
          const resolvedId = resolveId(task_id);
          const success = unlockTask(resolvedId, agent_id);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("check_task_lock")) {
    server.tool(
      "check_task_lock",
      "Check local task lock lease status.",
      {
        task_id: z.string().describe("Task ID"),
      },
      async ({ task_id }) => {
        try {
          const resolvedId = resolveId(task_id);
          const status = getTaskLockStatus(resolvedId);
          return { content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("complete_task")) {
    server.tool(
      "complete_task",
      "Mark a task completed. Optionally set confidence, score, and completion timestamp.",
      {
        task_id: z.string().describe("Task ID"),
        confidence: z.number().min(0).max(1).optional().describe("Confidence score 0.0-1.0"),
        completed_at: z.string().optional().describe("ISO timestamp for backdating"),
        version: z.number().optional().describe("Expected version for optimistic locking"),
      },
      async ({ task_id, confidence, completed_at, version }) => {
        try {
          const cloud = getTodosCloudClient();
          if (cloud) {
            const body: Record<string, unknown> = {};
            if (confidence !== undefined) body.confidence = confidence;
            if (completed_at !== undefined) body.completed_at = completed_at;
            if (version !== undefined) body.version = version;
            const task = await cloudTaskAction(cloud, task_id, "complete", body);
            return { content: [{ type: "text" as const, text: formatTask(task) }] };
          }
          const resolvedId = resolveId(task_id);
          if (version !== undefined) versionFor(resolvedId, version);
          const current = getTask(resolvedId);
          if (!current) throw new TaskNotFoundError(resolvedId);
          const task = completeTask(resolvedId, current.assigned_to || current.agent_id || undefined, undefined, { confidence, completed_at });
          return { content: [{ type: "text" as const, text: formatTask(task) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("cancel_task")) {
    server.tool(
      "cancel_task",
      "Mark a task as cancelled.",
      {
        task_id: z.string().describe("Task ID"),
        version: z.number().optional().describe("Expected version for optimistic locking"),
      },
      async ({ task_id, version }) => {
        try {
          const cloud = getTodosCloudClient();
          if (cloud) {
            const patch: Record<string, unknown> = { status: "cancelled" };
            if (version !== undefined) patch.version = version;
            const task = await cloudUpdateTask(cloud, task_id, patch);
            return { content: [{ type: "text" as const, text: formatTask(task) }] };
          }
          const resolvedId = resolveId(task_id);
          const task = version === undefined
            ? setTaskStatus(resolvedId, "cancelled")
            : updateWithOptionalVersion(resolvedId, { status: "cancelled" }, version);
          return { content: [{ type: "text" as const, text: formatTask(task) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("reassign_task")) {
    server.tool(
      "reassign_task",
      "Reassign a task to a different agent.",
      {
        task_id: z.string().describe("Task ID"),
        new_assignee: z.string().describe("New agent ID or name"),
        version: z.number().optional().describe("Expected version for optimistic locking"),
      },
      async ({ task_id, new_assignee, version }) => {
        try {
          const cloud = getTodosCloudClient();
          if (cloud) {
            const patch: Record<string, unknown> = { assigned_to: new_assignee };
            if (version !== undefined) patch.version = version;
            const task = await cloudUpdateTask(cloud, task_id, patch);
            return { content: [{ type: "text" as const, text: formatTask(task) }] };
          }
          const resolvedId = resolveId(task_id);
          const resolvedAssignee = resolveId(new_assignee, "agents");
          const task = updateWithOptionalVersion(resolvedId, { assigned_to: resolvedAssignee }, version);
          return { content: [{ type: "text" as const, text: formatTask(task) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("reschedule_task")) {
    server.tool(
      "reschedule_task",
      "Update a task's deadline.",
      {
        task_id: z.string().describe("Task ID"),
        deadline: z.string().describe("New ISO deadline"),
        version: z.number().optional().describe("Expected version for optimistic locking"),
      },
      async ({ task_id, deadline, version }) => {
        try {
          const resolvedId = resolveId(task_id);
          const task = updateWithOptionalVersion(resolvedId, { due_at: deadline }, version);
          return { content: [{ type: "text" as const, text: formatTask(task) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("prioritize_task")) {
    server.tool(
      "prioritize_task",
      "Set a task's priority.",
      {
        task_id: z.string().describe("Task ID"),
        priority: z.enum(["low", "medium", "high", "critical"]).describe("New priority"),
        version: z.number().optional().describe("Expected version for optimistic locking"),
      },
      async ({ task_id, priority, version }) => {
        try {
          const resolvedId = resolveId(task_id);
          const task = version === undefined
            ? setTaskPriority(resolvedId, priority)
            : updateWithOptionalVersion(resolvedId, { priority }, version);
          return { content: [{ type: "text" as const, text: formatTask(task) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === DEPENDENCIES ===

  if (shouldRegisterTool("add_task_dependency")) {
    server.tool(
      "add_task_dependency",
      "Add a dependency (this task won't start until the dependency completes).",
      {
        task_id: z.string().describe("Task ID that has the dependency"),
        depends_on: z.string().describe("Task ID this task depends on"),
      },
      async ({ task_id, depends_on }) => {
        try {
          const resolvedId = resolveId(task_id);
          const resolvedDep = resolveId(depends_on);
          addDependency(resolvedId, resolvedDep);
          return { content: [{ type: "text" as const, text: `${resolvedId.slice(0,8)} now depends on ${resolvedDep.slice(0,8)}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("remove_task_dependency")) {
    server.tool(
      "remove_task_dependency",
      "Remove a dependency between two tasks.",
      {
        task_id: z.string().describe("Task ID"),
        depends_on: z.string().describe("Task ID to remove dependency on"),
      },
      async ({ task_id, depends_on }) => {
        try {
          removeDependency(resolveId(task_id), resolveId(depends_on));
          return { content: [{ type: "text" as const, text: "Dependency removed." }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_task_dependencies")) {
    server.tool(
      "get_task_dependencies",
      "Get full dependency tree for a task.",
      {
        task_id: z.string().describe("Task ID"),
        direction: z.enum(["upstream", "downstream", "both"]).optional().describe("Upstream = tasks this task depends on; downstream = tasks depending on this"),
      },
      async ({ task_id, direction }) => {
        try {
          const resolvedId = resolveId(task_id);
          const graphDirection = direction === "upstream"
            ? "up"
            : direction === "downstream"
              ? "down"
              : "both";
          const graph = getTaskGraph(resolvedId, graphDirection);
          if (graph.depends_on.length === 0 && graph.blocks.length === 0) {
            return { content: [{ type: "text" as const, text: "No dependencies." }] };
          }
          return { content: [{ type: "text" as const, text: formatDependencyGraph(graph) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === BULK OPERATIONS ===

  if (shouldRegisterTool("bulk_update_tasks")) {
    server.tool(
      "bulk_update_tasks",
      "Update multiple tasks at once. All tasks must pass the dependency check.",
      {
        task_ids: z.array(z.string()).describe("Array of task IDs to update"),
        status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
        priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        assigned_to: z.string().nullable().optional().describe("Agent ID or name, null to unassign"),
      },
      async ({ task_ids, status, priority, assigned_to }) => {
        try {
          const { bulkUpdateTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolved = task_ids.map(resolveId);
          let resolvedAssignee: string | null | undefined = assigned_to;
          if (resolvedAssignee && typeof resolvedAssignee === "string") resolvedAssignee = resolveId(resolvedAssignee, "agents");
          const result = bulkUpdateTasks(resolved, { status, priority, assigned_to: resolvedAssignee });
          return { content: [{ type: "text" as const, text: `${result.updated} task(s) updated, ${result.failed.length} failed.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("bulk_create_tasks")) {
    server.tool(
      "bulk_create_tasks",
      "Create multiple tasks at once from an array of task objects.",
      {
        tasks: z.array(z.object({
          title: z.string(),
          description: z.string().optional(),
          status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
          priority: z.enum(["low", "medium", "high", "critical"]).optional(),
          project_id: z.string().optional(),
          task_list_id: z.string().optional(),
          assigned_to: z.string().optional(),
          depends_on: z.array(z.string()).optional(),
          short_id: z.string().nullable().optional(),
          tags: z.array(z.string()).optional(),
          estimate: z.number().optional(),
        })).describe("Array of task objects"),
      },
      async ({ tasks }) => {
        try {
          const { bulkCreateTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolved = tasks.map(t => {
            const r: Record<string, unknown> = { ...t };
            if (r.project_id) r.project_id = resolveId(r.project_id as string, "projects");
            if (r.task_list_id) r.task_list_id = resolveId(r.task_list_id as string, "task_lists");
            if (r.assigned_to) r.assigned_to = resolveId(r.assigned_to as string, "agents");
            if (r.depends_on) r.depends_on = (r.depends_on as string[]).map((id: string) => resolveId(id));
            return r as Parameters<typeof bulkCreateTasks>[0][number];
          });
          const result = bulkCreateTasks(resolved);
          return { content: [{ type: "text" as const, text: `${result.created.length} task(s) created.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("bulk_delete_tasks")) {
    server.tool(
      "bulk_delete_tasks",
      "Delete multiple tasks at once. Tasks with active children are skipped.",
      {
        task_ids: z.array(z.string()).describe("Array of task IDs"),
        force: z.boolean().optional().describe("Skip child check for all tasks (dangerous)"),
      },
      async ({ task_ids, force }) => {
        try {
          const { bulkDeleteTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolved = task_ids.map(resolveId);
          const result = bulkDeleteTasks(resolved, force);
          return { content: [{ type: "text" as const, text: `${result.deleted} task(s) deleted, ${result.skipped} skipped (has children).` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === PROJECT LIFECYCLE ===

  if (shouldRegisterTool("bootstrap_project")) {
    server.tool(
      "bootstrap_project",
      "Discover a local workspace and initialize project identity, default task list, and local source metadata.",
      {
        path: z.string().optional().describe("Workspace path. Defaults to current working directory."),
        name: z.string().optional().describe("Project display name override."),
        task_list_slug: z.string().optional().describe("Default task list slug override."),
        dry_run: z.boolean().optional().describe("Only report discovery; do not write local state."),
      },
      async ({ path, name, task_list_slug, dry_run }) => {
        try {
          const result = bootstrapProject({ path, name, taskListSlug: task_list_slug, dryRun: dry_run });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("create_project")) {
    server.tool(
      "create_project",
      "Create a new project.",
      {
        name: z.string().describe("Project name"),
        path: z.string().describe("Unique filesystem path for the project"),
        description: z.string().optional(),
        status: z.enum(["active", "completed", "on_hold", "archived"]).optional(),
        short_id: z.string().nullable().optional().describe("Short ID (auto-generated if omitted)"),
        metadata: z.record(z.unknown()).optional(),
      },
      async (params) => {
        try {
          const project = createProject(params as Parameters<typeof createProject>[0]);
          return { content: [{ type: "text" as const, text: `Project created: ${project.id.slice(0,8)} ${project.name}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_projects")) {
    server.tool(
      "list_projects",
      "List all projects.",
      {
        status: z.enum(["active", "completed", "on_hold", "archived"]).optional(),
        limit: z.number().optional(),
      },
      async ({ status, limit }) => {
        try {
          let projects = listProjects();
          if (status) projects = projects.filter((p) => p.status === status);
          if (limit) projects = projects.slice(0, limit);
          if (projects.length === 0) return { content: [{ type: "text" as const, text: "No projects found." }] };
          const lines = projects.map(p => `[${p.status}] ${p.short_id || p.id.slice(0,8)} ${p.name}`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_project")) {
    server.tool(
      "get_project",
      "Get full details for a project.",
      {
        project_id: z.string().describe("Project ID (full or short)"),
      },
      async ({ project_id }) => {
        try {
          const resolvedId = resolveId(project_id, "projects");
          const project = getProject(resolvedId);
          if (!project) throw new TaskNotFoundError(`Project not found: ${project_id}`);
          const { listTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const tasks = listTasks({ project_id: resolvedId, limit: 100 }, undefined) as Task[];
          const lines = [
            `ID:          ${project.id}`,
            `Short ID:    ${project.short_id || "(none)"}`,
            `Name:        ${project.name}`,
            `Status:      ${project.status}`,
            project.description ? `Description: ${project.description}` : null,
            `Tasks:       ${tasks.length}`,
            project.metadata && Object.keys(project.metadata).length > 0 ? `Metadata:    ${JSON.stringify(project.metadata)}` : null,
            project.created_at ? `Created:     ${project.created_at}` : null,
            project.updated_at ? `Updated:     ${project.updated_at}` : null,
          ].filter(Boolean);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_project")) {
    server.tool(
      "update_project",
      "Update a project's fields.",
      {
        project_id: z.string().describe("Project ID"),
        name: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(["active", "completed", "on_hold", "archived"]).optional(),
        metadata: z.record(z.unknown()).optional(),
      },
      async (params) => {
        try {
          const { project_id, ...updates } = params;
          const resolvedId = resolveId(project_id, "projects");
          const project = updateProject(resolvedId, updates as Parameters<typeof updateProject>[1]);
          return { content: [{ type: "text" as const, text: `Project ${project.short_id || project.id.slice(0,8)} updated.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_project")) {
    server.tool(
      "delete_project",
      "Permanently delete a project and all its tasks.",
      {
        project_id: z.string().describe("Project ID"),
        force: z.boolean().optional().describe("Skip confirmation (dangerous)"),
      },
      async ({ project_id, force }) => {
        try {
          deleteProject(resolveId(project_id, "projects"), force);
          return { content: [{ type: "text" as const, text: `Project ${project_id.slice(0, 8)} deleted.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === TASK LISTS ===

  if (shouldRegisterTool("create_task_list")) {
    server.tool(
      "create_task_list",
      "Create a new task list.",
      {
        name: z.string().describe("Task list name"),
        project_id: z.string().optional().describe("Project ID"),
        description: z.string().optional(),
        status: z.enum(["active", "completed", "archived"]).optional(),
      },
      async (params) => {
        try {
          const resolved: Record<string, unknown> = { ...params };
          if (params.project_id) resolved.project_id = resolveId(params.project_id, "projects");
          const list = createTaskList(resolved as Parameters<typeof createTaskList>[0]);
          return { content: [{ type: "text" as const, text: `Task list created: ${list.id.slice(0,8)} ${list.name}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_task_lists")) {
    server.tool(
      "list_task_lists",
      "List all task lists.",
      {
        project_id: z.string().optional().describe("Filter by project"),
        status: z.enum(["active", "completed", "archived"]).optional(),
      },
      async ({ project_id, status }) => {
        try {
          const resolved: Record<string, unknown> = { status };
          if (project_id) resolved.project_id = resolveId(project_id, "projects");
          const lists = listTaskLists(resolved as Parameters<typeof listTaskLists>[0]);
          if (lists.length === 0) return { content: [{ type: "text" as const, text: "No task lists found." }] };
          const lines = lists.map(l => `[${l.status}] ${l.name} (${l.id.slice(0,8)})`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_task_list")) {
    server.tool(
      "get_task_list",
      "Get a task list with its tasks.",
      {
        task_list_id: z.string().describe("Task list ID"),
        include_tasks: z.boolean().optional().describe("Include tasks (default: true)"),
      },
      async ({ task_list_id, include_tasks = true }) => {
        try {
          const resolvedId = resolveId(task_list_id, "task_lists");
          const list = getTaskList(resolvedId);
          if (!list) throw new TaskNotFoundError(`Task list not found: ${task_list_id}`);
          let tasks: Task[] = [];
          if (include_tasks) {
            const { listTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
            tasks = listTasks({ task_list_id: resolvedId, limit: 200 }, undefined) as Task[];
          }
          const lines = [
            `ID:    ${list.id}`,
            `Name:  ${list.name}`,
            list.project_id ? `Project: ${list.project_id}` : null,
            `Tasks: ${tasks.length}`,
            tasks.length > 0 ? "\nTasks:" : null,
            ...tasks.map(t => `  ${t.status} [${t.priority}] ${t.title} (${t.id.slice(0,8)})`),
          ].filter(Boolean);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_task_list")) {
    server.tool(
      "update_task_list",
      "Update a task list's fields.",
      {
        task_list_id: z.string().describe("Task list ID"),
        name: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(["active", "completed", "archived"]).optional(),
      },
      async ({ task_list_id, ...updates }) => {
        try {
          const resolvedId = resolveId(task_list_id, "task_lists");
          const list = updateTaskList(resolvedId, updates as Parameters<typeof updateTaskList>[1]);
          return { content: [{ type: "text" as const, text: `Task list ${list.id.slice(0,8)} updated.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_task_list")) {
    server.tool(
      "delete_task_list",
      "Permanently delete a task list and all its tasks.",
      {
        task_list_id: z.string().describe("Task list ID"),
        force: z.boolean().optional().describe("Skip confirmation (dangerous)"),
      },
      async ({ task_list_id, force }) => {
        try {
          deleteTaskList(resolveId(task_list_id, "task_lists"), force);
          return { content: [{ type: "text" as const, text: `Task list ${task_list_id.slice(0, 8)} deleted.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === PLANS ===

  if (shouldRegisterTool("create_plan")) {
    server.tool(
      "create_plan",
      "Create a new plan (sprint/milestone).",
      {
        name: z.string().describe("Plan name"),
        slug: z.string().optional().describe("Readable plan slug"),
        project_id: z.string().optional().describe("Project ID"),
        description: z.string().optional(),
        start_date: z.string().optional().describe("ISO date"),
        end_date: z.string().optional().describe("ISO date"),
        status: z.enum(["planning", "active", "completed", "cancelled"]).optional(),
      },
      async (params) => {
        try {
          const resolved: Record<string, unknown> = { ...params };
          if (params.project_id) resolved.project_id = resolveId(params.project_id, "projects");
          const plan = createPlan(resolved as Parameters<typeof createPlan>[0]);
          return { content: [{ type: "text" as const, text: `Plan created: ${plan.id.slice(0,8)} ${plan.name}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_plans")) {
    server.tool(
      "list_plans",
      "List plans.",
      {
        project_id: z.string().optional().describe("Filter by project"),
        status: z.enum(["planning", "active", "completed", "cancelled"]).optional(),
      },
      async ({ project_id, status }) => {
        try {
          const resolved: Record<string, unknown> = { status };
          if (project_id) resolved.project_id = resolveId(project_id, "projects");
          const plans = listPlans(resolved as Parameters<typeof listPlans>[0]);
          if (plans.length === 0) return { content: [{ type: "text" as const, text: "No plans found." }] };
          const lines = plans.map(p => `[${p.status}] ${p.name} (${p.id.slice(0,8)})`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_plan")) {
    server.tool(
      "get_plan",
      "Get a plan with its tasks.",
      {
        plan_id: z.string().describe("Plan ID"),
        include_tasks: z.boolean().optional().describe("Include tasks (default: true)"),
      },
      async ({ plan_id, include_tasks = true }) => {
        try {
          const resolvedId = resolveId(plan_id, "plans");
          const plan = getPlan(resolvedId);
          if (!plan) throw new TaskNotFoundError(`Plan not found: ${plan_id}`);
          let tasks: Task[] = [];
          if (include_tasks) {
            const { listTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
            tasks = listTasks({ plan_id: resolvedId, limit: 200 }, undefined) as Task[];
          }
          const lines = [
            `ID:    ${plan.id}`,
            `Name:  ${plan.name}`,
            `Status: ${plan.status}`,
            plan.project_id ? `Project: ${plan.project_id}` : null,
            plan.start_date ? `Start:   ${plan.start_date}` : null,
            plan.end_date ? `End:     ${plan.end_date}` : null,
            `Tasks: ${tasks.length}`,
            tasks.length > 0 ? "\nTasks:" : null,
            ...tasks.map(t => `  ${t.status} [${t.priority}] ${t.title} (${t.id.slice(0,8)})`),
          ].filter(Boolean);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_plan")) {
    server.tool(
      "update_plan",
      "Update a plan's fields.",
      {
        plan_id: z.string().describe("Plan ID"),
        name: z.string().optional(),
        description: z.string().optional(),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        status: z.enum(["planning", "active", "completed", "cancelled"]).optional(),
      },
      async ({ plan_id, ...updates }) => {
        try {
          const resolvedId = resolveId(plan_id, "plans");
          const plan = updatePlan(resolvedId, updates as Parameters<typeof updatePlan>[1]);
          return { content: [{ type: "text" as const, text: `Plan ${plan.id.slice(0,8)} updated.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_plan")) {
    server.tool(
      "delete_plan",
      "Permanently delete a plan and all its tasks.",
      {
        plan_id: z.string().describe("Plan ID"),
        force: z.boolean().optional().describe("Skip confirmation (dangerous)"),
      },
      async ({ plan_id, force }) => {
        try {
          deletePlan(resolveId(plan_id, "plans"), force);
          return { content: [{ type: "text" as const, text: `Plan ${plan_id.slice(0, 8)} deleted.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === ROADMAPS ===

  if (shouldRegisterTool("create_roadmap")) {
    server.tool(
      "create_roadmap",
      "Create a local roadmap for grouping milestones, plans, tasks, runs, and release labels.",
      {
        name: z.string(),
        description: z.string().optional(),
        project_id: z.string().optional(),
        status: roadmapStatusSchema.optional(),
        owner: z.string().optional(),
        agent_id: z.string().optional(),
        release: z.string().optional(),
      },
      async (input) => {
        try {
          const roadmap = createRoadmap({ ...input, project_id: resolveProjectIdInput(input.project_id) });
          return { content: [{ type: "text" as const, text: JSON.stringify(roadmap, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_roadmaps")) {
    server.tool(
      "list_roadmaps",
      "List local roadmaps.",
      {
        project_id: z.string().optional(),
        status: roadmapStatusSchema.optional(),
      },
      async ({ project_id, status }) => {
        try {
          const roadmaps = listRoadmaps({ project_id: resolveProjectIdInput(project_id), status });
          return { content: [{ type: "text" as const, text: JSON.stringify(roadmaps, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_roadmap_summary")) {
    server.tool(
      "get_roadmap_summary",
      "Get computed local roadmap progress, milestone, release, and blocker summary.",
      {
        roadmap_id: z.string(),
        format: z.enum(["json", "markdown"]).optional(),
      },
      async ({ roadmap_id, format }) => {
        try {
          const text = format === "markdown"
            ? renderRoadmapMarkdown(roadmap_id)
            : JSON.stringify(summarizeRoadmap(roadmap_id), null, 2);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_roadmap")) {
    server.tool(
      "update_roadmap",
      "Update a local roadmap.",
      {
        roadmap_id: z.string(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        project_id: z.string().nullable().optional(),
        status: roadmapStatusSchema.optional(),
        owner: z.string().nullable().optional(),
        agent_id: z.string().nullable().optional(),
        release: z.string().nullable().optional(),
      },
      async ({ roadmap_id, project_id, ...updates }) => {
        try {
          const resolvedProject = project_id === undefined || project_id === null ? project_id : resolveId(project_id, "projects");
          const roadmap = updateRoadmap(roadmap_id, { ...updates, project_id: resolvedProject });
          return { content: [{ type: "text" as const, text: JSON.stringify(roadmap, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_roadmap")) {
    server.tool(
      "delete_roadmap",
      "Delete a local roadmap and its milestone/release config.",
      {
        roadmap_id: z.string(),
      },
      async ({ roadmap_id }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: deleteRoadmap(roadmap_id) }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("create_milestone")) {
    server.tool(
      "create_milestone",
      "Add a local milestone to a roadmap.",
      {
        roadmap_id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        due_at: z.string().optional(),
        status: milestoneStatusSchema.optional(),
        owner: z.string().optional(),
        agent_id: z.string().optional(),
        task_ids: z.array(z.string()).optional(),
        plan_ids: z.array(z.string()).optional(),
        run_ids: z.array(z.string()).optional(),
        release: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
      async ({ task_ids, plan_ids, run_ids, ...input }) => {
        try {
          const milestone = createMilestone({
            ...input,
            task_ids: resolveTaskIdsInput(task_ids),
            plan_ids: resolvePlanIdsInput(plan_ids),
            run_ids: resolveRunIdsInput(run_ids),
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(milestone, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_milestone")) {
    server.tool(
      "update_milestone",
      "Update a local roadmap milestone.",
      {
        milestone_id: z.string(),
        title: z.string().optional(),
        description: z.string().nullable().optional(),
        due_at: z.string().nullable().optional(),
        status: milestoneStatusSchema.optional(),
        owner: z.string().nullable().optional(),
        agent_id: z.string().nullable().optional(),
        task_ids: z.array(z.string()).optional(),
        plan_ids: z.array(z.string()).optional(),
        run_ids: z.array(z.string()).optional(),
        release: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
      },
      async ({ milestone_id, task_ids, plan_ids, run_ids, ...updates }) => {
        try {
          const milestone = updateMilestone(milestone_id, {
            ...updates,
            task_ids: resolveTaskIdsInput(task_ids),
            plan_ids: resolvePlanIdsInput(plan_ids),
            run_ids: resolveRunIdsInput(run_ids),
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(milestone, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_milestone")) {
    server.tool(
      "delete_milestone",
      "Delete a local roadmap milestone.",
      {
        milestone_id: z.string(),
      },
      async ({ milestone_id }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: deleteMilestone(milestone_id) }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("set_release_group")) {
    server.tool(
      "set_release_group",
      "Create or update a local roadmap release grouping.",
      {
        roadmap_id: z.string(),
        name: z.string(),
        version: z.string().optional(),
        status: milestoneStatusSchema.optional(),
        milestone_ids: z.array(z.string()).optional(),
        task_ids: z.array(z.string()).optional(),
        plan_ids: z.array(z.string()).optional(),
        run_ids: z.array(z.string()).optional(),
        notes: z.string().optional(),
      },
      async ({ task_ids, plan_ids, run_ids, ...input }) => {
        try {
          const release = upsertReleaseGroup({
            ...input,
            task_ids: resolveTaskIdsInput(task_ids),
            plan_ids: resolvePlanIdsInput(plan_ids),
            run_ids: resolveRunIdsInput(run_ids),
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(release, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("export_roadmap")) {
    server.tool(
      "export_roadmap",
      "Export a local roadmap as JSON bundle or Markdown.",
      {
        roadmap_id: z.string(),
        format: z.enum(["json", "markdown"]).optional(),
      },
      async ({ roadmap_id, format }) => {
        try {
          const text = format === "markdown"
            ? renderRoadmapMarkdown(roadmap_id)
            : JSON.stringify(exportRoadmapBundle(roadmap_id), null, 2);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("import_roadmap")) {
    server.tool(
      "import_roadmap",
      "Preview or apply a local roadmap JSON bundle.",
      {
        bundle: z.record(z.unknown()),
        apply: z.boolean().optional(),
      },
      async ({ bundle, apply }) => {
        try {
          const result = importRoadmapBundle(bundle as Parameters<typeof importRoadmapBundle>[0], { apply });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === CAPACITY AND FORECASTS ===

  if (shouldRegisterTool("set_capacity_profile")) {
    server.tool(
      "set_capacity_profile",
      "Create or update a local agent capacity profile.",
      {
        agent_id: z.string(),
        project_id: z.string().optional(),
        minutes_per_day: z.number().int().positive(),
        working_days: z.array(z.number().int().min(0).max(6)).optional(),
        effective_from: z.string().nullable().optional(),
      },
      async (input) => {
        try {
          const profile = upsertCapacityProfile({ ...input, project_id: resolveProjectIdInput(input.project_id) });
          return { content: [{ type: "text" as const, text: JSON.stringify(profile, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_capacity_profiles")) {
    server.tool(
      "list_capacity_profiles",
      "List local planning capacity profiles.",
      {
        agent_id: z.string().optional(),
        project_id: z.string().optional(),
      },
      async ({ agent_id, project_id }) => {
        try {
          const profiles = listCapacityProfiles({ agent_id, project_id: resolveProjectIdInput(project_id) });
          return { content: [{ type: "text" as const, text: JSON.stringify(profiles, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("remove_capacity_profile")) {
    server.tool(
      "remove_capacity_profile",
      "Remove a local planning capacity profile.",
      {
        agent_id_or_id: z.string(),
        project_id: z.string().nullable().optional(),
      },
      async ({ agent_id_or_id, project_id }) => {
        try {
          const resolvedProject = project_id === undefined || project_id === null ? project_id : resolveId(project_id, "projects");
          return { content: [{ type: "text" as const, text: JSON.stringify({ removed: removeCapacityProfile(agent_id_or_id, resolvedProject) }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_planning_forecast")) {
    server.tool(
      "get_planning_forecast",
      "Forecast local plan or project completion from estimates, actuals, capacity, and due dates.",
      {
        project_id: z.string().optional(),
        plan_id: z.string().optional(),
        agent_id: z.string().optional(),
        start_date: z.string().optional(),
        format: z.enum(["json", "markdown"]).optional(),
      },
      async ({ project_id, plan_id, agent_id, start_date, format }) => {
        try {
          const forecast = getPlanningForecast({
            project_id: resolveProjectIdInput(project_id),
            plan_id: plan_id ? resolveId(plan_id, "plans") : undefined,
            agent_id,
            start_date,
          });
          const text = format === "markdown" ? renderPlanningForecastMarkdown(forecast) : JSON.stringify(forecast, null, 2);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === LOCAL AUDIT LEDGER ===

  if (shouldRegisterTool("get_audit_ledger")) {
    server.tool(
      "get_audit_ledger",
      "Build a tamper-evident local audit hash chain from task, run, verification, approval, and handoff evidence.",
      {
        project_id: z.string().optional(),
        task_id: z.string().optional(),
        run_id: z.string().optional(),
        include_entries: z.boolean().optional(),
        format: z.enum(["json", "markdown"]).optional(),
      },
      async ({ project_id, task_id, run_id, include_entries, format }) => {
        try {
          const ledger = getLocalAuditLedger({
            project_id: resolveProjectIdInput(project_id),
            task_id: task_id ? resolveId(task_id, "tasks") : undefined,
            run_id: run_id ? resolveTaskRunId(run_id) : undefined,
            include_entries,
          });
          const text = format === "markdown" ? renderLocalAuditLedgerMarkdown(ledger) : JSON.stringify(ledger, null, 2);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("seal_audit_ledger")) {
    server.tool(
      "seal_audit_ledger",
      "Store a local audit ledger checkpoint for later integrity verification.",
      {
        name: z.string(),
        project_id: z.string().optional(),
        task_id: z.string().optional(),
        run_id: z.string().optional(),
        agent_id: z.string().optional(),
        note: z.string().optional(),
      },
      async ({ name, project_id, task_id, run_id, agent_id, note }) => {
        try {
          const checkpoint = sealLocalAuditLedger({
            name,
            project_id: resolveProjectIdInput(project_id),
            task_id: task_id ? resolveId(task_id, "tasks") : undefined,
            run_id: run_id ? resolveTaskRunId(run_id) : undefined,
            agent_id,
            note,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(checkpoint, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_audit_ledger_checkpoints")) {
    server.tool("list_audit_ledger_checkpoints", "List sealed local audit ledger checkpoints.", {}, async () => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(listLocalAuditLedgerCheckpoints(), null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    });
  }

  if (shouldRegisterTool("verify_audit_ledger")) {
    server.tool(
      "verify_audit_ledger",
      "Verify current local evidence against a sealed audit ledger checkpoint.",
      {
        checkpoint: z.string(),
        format: z.enum(["json", "markdown"]).optional(),
      },
      async ({ checkpoint, format }) => {
        try {
          const result = verifyLocalAuditLedger(checkpoint);
          const text = format === "markdown" ? renderLocalAuditLedgerMarkdown(result) : JSON.stringify(result, null, 2);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === RELEASE COMPATIBILITY ===

  if (shouldRegisterTool("check_release_compatibility")) {
    server.tool(
      "check_release_compatibility",
      "Check local release compatibility for package metadata, migrations, exports, Bun global install guidance, changelog readiness, and rollback steps.",
      {
        root: z.string().optional(),
        simulated_levels: z.array(z.number().int().min(0)).optional(),
        format: z.enum(["json", "markdown"]).optional(),
      },
      async ({ root, simulated_levels, format }) => {
        try {
          const report = createReleaseCompatibilityReport({ root, simulated_levels });
          const text = format === "markdown" ? renderReleaseCompatibilityMarkdown(report) : JSON.stringify(report, null, 2);
          return { content: [{ type: "text" as const, text }], isError: !report.ok };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === TAGS ===

  if (shouldRegisterTool("create_tag")) {
    server.tool(
      "create_tag",
      "Create a new tag.",
      {
        name: z.string().describe("Tag name"),
        color: z.string().optional().describe("Hex color code"),
        description: z.string().optional(),
      },
      async (params) => {
        try {
          const tag = createTag(params as Parameters<typeof createTag>[0]);
          return { content: [{ type: "text" as const, text: `Tag created: ${tag.name}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_tags")) {
    server.tool(
      "list_tags",
      "List all distinct task tags in use, with task counts.",
      async () => {
        try {
          const rows = listTags();
          if (rows.length === 0) return { content: [{ type: "text" as const, text: "No tags found." }] };
          const lines = rows.map((r) => `${r.color ? "[" + r.color + "] " : ""}${r.name} (${r.task_count})`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_tag")) {
    server.tool(
      "get_tag",
      "Get a tag and list of tasks using it.",
      {
        tag_id: z.string().describe("Tag ID or name"),
      },
      async ({ tag_id }) => {
        try {
          const tag = getTag(tag_id);
          if (!tag) throw new TaskNotFoundError(`Tag not found: ${tag_id}`);
          const { listTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const tasks = listTasks({ tags: [tag.name], limit: 100 }, undefined) as Task[];
          const lines = [
            `Tag: ${tag.name}${tag.color ? ` (${tag.color})` : ""}`,
            tag.description ? `Description: ${tag.description}` : null,
            `Tasks: ${tasks.length}`,
            ...tasks.slice(0, 20).map(t => `  ${t.status} ${t.title} (${t.id.slice(0,8)})`),
            tasks.length > 20 ? `  ... and ${tasks.length - 20} more` : null,
          ].filter(Boolean);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_tag")) {
    server.tool(
      "update_tag",
      "Update a tag's fields.",
      {
        tag_id: z.string().describe("Tag ID or name"),
        name: z.string().optional(),
        color: z.string().optional(),
        description: z.string().optional(),
      },
      async ({ tag_id, ...updates }) => {
        try {
          const tag = updateTag(tag_id, updates as Parameters<typeof updateTag>[1]);
          return { content: [{ type: "text" as const, text: `Tag ${tag.name} updated.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_tag")) {
    server.tool(
      "delete_tag",
      "Permanently delete a tag. Removes it from all tasks.",
      {
        tag_id: z.string().describe("Tag ID or name"),
      },
      async ({ tag_id }) => {
        try {
          deleteTag(tag_id);
          return { content: [{ type: "text" as const, text: `Tag deleted: ${tag_id}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === LABELS ===

  if (shouldRegisterTool("create_label")) {
    server.tool(
      "create_label",
      "Create a new label.",
      {
        name: z.string().describe("Label name"),
        color: z.string().optional().describe("Hex color code"),
        description: z.string().optional(),
      },
      async (params) => {
        try {
          const label = createLabel(params as Parameters<typeof createLabel>[0]);
          return { content: [{ type: "text" as const, text: `Label created: ${label.name}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_labels")) {
    server.tool(
      "list_labels",
      "List all labels.",
      async () => {
        try {
          const labels = listLabels();
          if (labels.length === 0) return { content: [{ type: "text" as const, text: "No labels found." }] };
          const lines = labels.map(l => `${l.color ? "[" + l.color + "] " : ""}${l.name}`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_label")) {
    server.tool(
      "get_label",
      "Get a label and list of tasks using it.",
      {
        label_id: z.string().describe("Label ID or name"),
      },
      async ({ label_id }) => {
        try {
          const label = getLabel(label_id);
          if (!label) throw new TaskNotFoundError(`Label not found: ${label_id}`);
          const { listTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const tasks = listTasks({ tags: [label.name], limit: 100 }, undefined) as Task[];
          const lines = [
            `Label: ${label.name}${label.color ? ` (${label.color})` : ""}`,
            label.description ? `Description: ${label.description}` : null,
            `Tasks: ${tasks.length}`,
            ...tasks.slice(0, 20).map(t => `  ${t.status} ${t.title} (${t.id.slice(0,8)})`),
          ].filter(Boolean);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_label")) {
    server.tool(
      "update_label",
      "Update a label's fields.",
      {
        label_id: z.string().describe("Label ID or name"),
        name: z.string().optional(),
        color: z.string().optional(),
        description: z.string().optional(),
      },
      async ({ label_id, ...updates }) => {
        try {
          const label = updateLabel(label_id, updates as Parameters<typeof updateLabel>[1]);
          return { content: [{ type: "text" as const, text: `Label ${label.name} updated.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_label")) {
    server.tool(
      "delete_label",
      "Permanently delete a label.",
      {
        label_id: z.string().describe("Label ID or name"),
      },
      async ({ label_id }) => {
        try {
          deleteLabel(label_id);
          return { content: [{ type: "text" as const, text: `Label deleted: ${label_id}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("assign_label_to_task")) {
    server.tool(
      "assign_label_to_task",
      "Assign a label to a task (syncs to tags for search compatibility).",
      {
        task_id: z.string(),
        label_id: z.string().describe("Label ID or name"),
      },
      async ({ task_id, label_id }) => {
        try {
          const label = assignLabelToTask(resolveId(task_id), label_id);
          return { content: [{ type: "text" as const, text: `Assigned label '${label.name}' to task.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("create_custom_field")) {
    server.tool(
      "create_custom_field",
      "Define a user custom field for tasks.",
      {
        name: z.string(),
        field_type: z.enum(["text", "number", "boolean", "date", "enum"]),
        project_id: z.string().optional(),
        options: z.array(z.string()).optional(),
        required: z.boolean().optional(),
        default_value: z.string().optional(),
      },
      async (params) => {
        try {
          const field = createCustomFieldDefinition(params as Parameters<typeof createCustomFieldDefinition>[0]);
          return { content: [{ type: "text" as const, text: JSON.stringify(field, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("set_task_custom_field")) {
    server.tool(
      "set_task_custom_field",
      "Set a custom field value on a task.",
      {
        task_id: z.string(),
        field_id: z.string().describe("Field ID or slug"),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      },
      async ({ task_id, field_id, value }) => {
        try {
          const result = setTaskCustomField(resolveId(task_id), field_id, value);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_task_fields")) {
    server.tool(
      "get_task_fields",
      "Export labels, custom fields, and priority metadata for a task.",
      { task_id: z.string() },
      async ({ task_id }) => {
        try {
          const data = exportTaskFields(resolveId(task_id));
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("set_task_priority_meta")) {
    server.tool(
      "set_task_priority_meta",
      "Set numeric priority score (0-100) and/or priority reason on a task.",
      {
        task_id: z.string(),
        priority_score: z.number().optional(),
        priority_reason: z.string().optional(),
      },
      async ({ task_id, priority_score, priority_reason }) => {
        try {
          setTaskPriorityMeta(resolveId(task_id), { priority_score, priority_reason });
          return { content: [{ type: "text" as const, text: "Priority metadata updated." }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === COMMENTS ===

  if (shouldRegisterTool("create_comment")) {
    server.tool(
      "create_comment",
      "Add a comment to a task.",
      {
        task_id: z.string().describe("Task ID"),
        body: z.string().describe("Comment body"),
        author: z.string().optional().describe("Author agent ID or name"),
      },
      async ({ task_id, body, author }) => {
        try {
          // self_hosted cloud routing: comment straight against <app>.hasna.xyz/v1
          // (skip local id-resolution which 404s cloud-only tasks). Server 404s a
          // genuinely missing task, surfaced as isError below.
          const cloud = getTodosCloudClient();
          if (cloud) {
            await cloudAddComment(cloud, task_id, { content: body, agent_id: author });
            return { content: [{ type: "text" as const, text: `Comment added to ${task_id.slice(0,8)}: ${body.slice(0, 50)}${body.length > 50 ? "..." : ""}` }] };
          }
          const resolvedId = resolveId(task_id);
          const resolvedAuthor = author ? resolveId(author, "agents") : undefined;
          const comment = addComment({ task_id: resolvedId, content: body, agent_id: resolvedAuthor });
          return { content: [{ type: "text" as const, text: `Comment added to ${task_id.slice(0,8)}: ${body.slice(0, 50)}${body.length > 50 ? "..." : ""}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_comments")) {
    server.tool(
      "list_comments",
      "List all comments on a task.",
      {
        task_id: z.string().describe("Task ID"),
      },
      async ({ task_id }) => {
        try {
          const resolvedId = resolveId(task_id);
          const comments = listComments(resolvedId);
          if (comments.length === 0) return { content: [{ type: "text" as const, text: "No comments." }] };
          const lines = comments.map(c => `[${c.agent_id || "unknown"}] ${c.created_at?.slice(0, 16)}:\n  ${c.content}`);
          return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_activity_timeline")) {
    server.tool(
      "get_activity_timeline",
      "Get a unified local activity timeline across comments, task history, and run evidence.",
      {
        entity_type: z.enum(["all", "task", "project", "plan", "run"]).optional().describe("Scope type. Defaults to all."),
        entity_id: z.string().optional().describe("ID for task/project/plan/run scope."),
        limit: z.number().optional().describe("Max entries, default 50."),
        offset: z.number().optional().describe("Entries to skip for pagination."),
        order: z.enum(["asc", "desc"]).optional().describe("Sort order, default desc."),
        since: z.string().optional().describe("Only entries at or after this ISO timestamp."),
        until: z.string().optional().describe("Only entries at or before this ISO timestamp."),
      },
      async (input) => {
        try {
          let entityId = input.entity_id;
          if (input.entity_type === "task" && entityId) entityId = resolveId(entityId);
          if (input.entity_type === "project" && entityId) entityId = resolveId(entityId, "projects");
          if (input.entity_type === "plan" && entityId) entityId = resolveId(entityId, "plans");
          if (input.entity_type === "run" && entityId) entityId = resolveTaskRunId(entityId);
          const timeline = getLocalActivityTimeline({
            entity_type: input.entity_type,
            entity_id: entityId,
            limit: input.limit,
            offset: input.offset,
            order: input.order,
            since: input.since,
            until: input.until,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(timeline, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_task_fields")) {
    server.tool(
      "get_task_fields",
      "Get local labels, priority, severity, owner, area, and custom fields for a task.",
      {
        task_id: z.string().describe("Task ID"),
      },
      async ({ task_id }) => {
        try {
          const fields = getTaskLocalFields(resolveId(task_id));
          return { content: [{ type: "text" as const, text: JSON.stringify(fields, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("set_task_fields")) {
    server.tool(
      "set_task_fields",
      "Set local labels, priority, severity, owner, area, and custom fields for a task.",
      {
        task_id: z.string().describe("Task ID"),
        labels: z.array(z.string()).optional().describe("Local labels to set."),
        priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        severity: z.string().nullable().optional(),
        owner: z.string().nullable().optional(),
        area: z.string().nullable().optional(),
        custom: z.record(z.unknown()).optional(),
        merge_custom: z.boolean().optional().describe("Merge custom fields by default; set false to replace."),
      },
      async (input) => {
        try {
          const task = setTaskLocalFields(resolveId(input.task_id), {
            labels: input.labels,
            priority: input.priority,
            severity: input.severity,
            owner: input.owner,
            area: input.area,
            custom: input.custom,
            merge_custom: input.merge_custom,
          });
          const payload = { task, fields: getTaskLocalFields(task.id) };
          return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("query_tasks_by_fields")) {
    server.tool(
      "query_tasks_by_fields",
      "Query tasks by local labels, priority, severity, owner, area, and custom fields.",
      {
        labels: z.array(z.string()).optional(),
        priority: z.union([z.enum(["low", "medium", "high", "critical"]), z.array(z.enum(["low", "medium", "high", "critical"]))]).optional(),
        severity: z.string().optional(),
        owner: z.string().optional(),
        area: z.string().optional(),
        custom: z.record(z.unknown()).optional(),
        limit: z.number().optional(),
      },
      async (input) => {
        try {
          const tasks = queryTasksByLocalFields(input);
          return { content: [{ type: "text" as const, text: JSON.stringify({ tasks, count: tasks.length }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_workflow_states")) {
    server.tool(
      "list_workflow_states",
      "List local project workflow states mapped onto canonical task statuses.",
      {
        project_path: z.string().optional(),
      },
      async ({ project_path }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify({ states: listWorkflowStates(project_path), local_only: true }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("set_task_workflow_state")) {
    server.tool(
      "set_task_workflow_state",
      "Set a task's local workflow state with configured transition guards.",
      {
        task_id: z.string().describe("Task ID"),
        state: z.string().describe("Workflow state name or alias"),
        actor: z.string().optional().describe("Agent or user changing the state"),
        project_path: z.string().optional(),
        force: z.boolean().optional().describe("Bypass configured transition guards"),
      },
      async ({ task_id, state, actor, project_path, force }) => {
        try {
          const result = setTaskWorkflowState(resolveId(task_id), state, { actor, project_path, force });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("query_tasks_by_workflow_state")) {
    server.tool(
      "query_tasks_by_workflow_state",
      "Query tasks by local workflow state while preserving canonical task statuses.",
      {
        state: z.string().describe("Workflow state name or alias"),
        project_id: z.string().optional(),
        task_list_id: z.string().optional(),
        project_path: z.string().optional(),
        limit: z.number().optional(),
      },
      async ({ state, project_id, task_list_id, project_path, limit }) => {
        try {
          const result = queryTasksByWorkflowState({
            state,
            project_id: project_id ? resolveId(project_id, "projects") : undefined,
            task_list_id: task_list_id ? resolveId(task_list_id, "task_lists") : undefined,
            project_path,
            limit,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("migrate_workflow_states")) {
    server.tool(
      "migrate_workflow_states",
      "Backfill local workflow state metadata from canonical task statuses.",
      {
        apply: z.boolean().optional(),
        project_id: z.string().optional(),
        task_list_id: z.string().optional(),
        project_path: z.string().optional(),
        limit: z.number().optional(),
      },
      async ({ apply, project_id, task_list_id, project_path, limit }) => {
        try {
          const report = migrateWorkflowStates({
            apply,
            project_id: project_id ? resolveId(project_id, "projects") : undefined,
            task_list_id: task_list_id ? resolveId(task_list_id, "task_lists") : undefined,
            project_path,
            limit,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("find_duplicate_tasks")) {
    server.tool(
      "find_duplicate_tasks",
      "Find likely duplicate local tasks from source URLs, imported issues, stack traces, and task text.",
      {
        threshold: z.number().min(0).max(1).optional().describe("Minimum duplicate score from 0 to 1."),
        limit: z.number().optional().describe("Maximum local tasks to compare."),
        include_archived: z.boolean().optional().describe("Include archived tasks in the scan."),
      },
      async (input) => {
        try {
          const candidates = findDuplicateTasks(input);
          return { content: [{ type: "text" as const, text: JSON.stringify({ candidates, count: candidates.length }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("merge_duplicate_task")) {
    server.tool(
      "merge_duplicate_task",
      "Merge a duplicate local task into a primary task while preserving comments, dependencies, runs, files, inbox items, and verification evidence.",
      {
        primary_task_id: z.string().describe("Task ID to keep."),
        duplicate_task_id: z.string().describe("Task ID to archive as duplicate."),
        agent_id: z.string().optional().describe("Agent recording the merge."),
        reason: z.string().optional().describe("Human-readable merge reason."),
      },
      async (input) => {
        try {
          const result = mergeDuplicateTask({
            primary_task_id: resolveId(input.primary_task_id),
            duplicate_task_id: resolveId(input.duplicate_task_id),
            agent_id: input.agent_id,
            reason: input.reason,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_comment")) {
    server.tool(
      "update_comment",
      "Edit a comment.",
      {
        comment_id: z.string().describe("Comment ID"),
        body: z.string().describe("New comment body"),
      },
      async ({ comment_id, body }) => {
        try {
          const comment = updateComment(comment_id, { content: body });
          return { content: [{ type: "text" as const, text: `Comment ${comment_id.slice(0,8)} updated.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_comment")) {
    server.tool(
      "delete_comment",
      "Delete a comment.",
      {
        comment_id: z.string().describe("Comment ID"),
      },
      async ({ comment_id }) => {
        try {
          deleteComment(comment_id);
          return { content: [{ type: "text" as const, text: `Comment ${comment_id.slice(0,8)} deleted.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === SEARCH ===

  if (shouldRegisterTool("search_tasks")) {
    server.tool(
      "search_tasks",
      "Full-text search across task titles and descriptions.",
      {
        query: z.string().describe("Search query"),
        project_id: z.string().optional().describe("Filter by project"),
        status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
        limit: z.number().optional().describe("Max results (default: 20)"),
      },
      async ({ query, project_id, status, limit }) => {
        try {
          const { searchTasks } = require("../../lib/search.js") as typeof import("../../lib/search.js");
          const resolved: Record<string, unknown> = { query, limit };
          if (project_id) resolved.project_id = resolveId(project_id, "projects");
          if (status) resolved.status = status;
          const results = searchTasks(resolved as Parameters<typeof searchTasks>[0]);
          if (results.length === 0) return { content: [{ type: "text" as const, text: `No results for: ${query}` }] };
          const lines = results.map((t: any) => `${(t.short_id || t.id.slice(0,8))} [${t.status}] ${t.title}`);
          return { content: [{ type: "text" as const, text: `${results.length} result(s) for "${query}":\n${lines.join("\n")}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("save_search_view")) {
    server.tool(
      "save_search_view",
      "Save a local search view for tasks, projects, plans, runs, comments, or all records.",
      {
        name: z.string().describe("Saved view name"),
        query: z.string().optional().describe("Search query"),
        scope: z.enum(["all", "tasks", "projects", "plans", "runs", "comments"]).optional(),
        description: z.string().optional(),
        project_id: z.string().optional(),
        status: z.union([z.string(), z.array(z.string())]).optional(),
        priority: z.union([z.string(), z.array(z.string())]).optional(),
        assigned_to: z.string().optional(),
        agent_id: z.string().optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().optional(),
      },
      async ({ name, scope, description, ...filters }) => {
        try {
          const { saveSearchView } = require("../../lib/saved-search-views.js") as typeof import("../../lib/saved-search-views.js");
          const view = saveSearchView({
            name,
            description,
            scope,
            filters: {
              ...filters,
              project_id: filters.project_id ? resolveId(filters.project_id, "projects") : undefined,
            },
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(view, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_search_views")) {
    server.tool(
      "list_search_views",
      "List local saved search views.",
      {
        scope: z.enum(["all", "tasks", "projects", "plans", "runs", "comments"]).optional(),
      },
      async ({ scope }) => {
        try {
          const { listSearchViews } = require("../../lib/saved-search-views.js") as typeof import("../../lib/saved-search-views.js");
          const views = listSearchViews(scope);
          return { content: [{ type: "text" as const, text: JSON.stringify(views, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("run_search_view")) {
    server.tool(
      "run_search_view",
      "Run a local saved search view and return stable JSON results.",
      {
        name: z.string().describe("Saved view name or id"),
      },
      async ({ name }) => {
        try {
          const { runSearchView } = require("../../lib/saved-search-views.js") as typeof import("../../lib/saved-search-views.js");
          const result = runSearchView(name);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_search_view")) {
    server.tool(
      "delete_search_view",
      "Delete a local saved search view.",
      {
        name: z.string().describe("Saved view name or id"),
      },
      async ({ name }) => {
        try {
          const { deleteSearchView } = require("../../lib/saved-search-views.js") as typeof import("../../lib/saved-search-views.js");
          const deleted = deleteSearchView(name);
          return { content: [{ type: "text" as const, text: JSON.stringify({ deleted }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

}
