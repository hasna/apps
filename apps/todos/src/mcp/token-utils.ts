import type { Task } from "../types/index.js";

export type McpDetail = "compact" | "full";

export const CORE_MCP_TOOLS = new Set([
  "add_comment",
  "bootstrap",
  "claim_next_task",
  "complete_task",
  "create_task",
  "fail_task",
  "get_context",
  "get_health",
  "get_next_task",
  "get_status",
  "get_task",
  "get_tasks_changed_since",
  "heartbeat",
  "list_agents",
  "list_tasks",
  "register_agent",
  "release_agent",
  "start_task",
  "suggest_agent_name",
]);

export const MCP_TOOL_GROUPS: Record<string, readonly string[]> = {
  core: [...CORE_MCP_TOOLS],
  tasks: [
    "archive_completed",
    "approve_task",
    "build_agent_context_pack",
    "bulk_create_tasks",
    "bulk_delete_tasks",
    "bulk_update_tasks",
    "cancel_task",
    "check_task_done_contract",
    "claim_task",
    "clone_task",
    "delete_task",
    "extend_task",
    "get_active_work",
    "get_archived_tasks",
    "get_blocked_tasks",
    "get_blocking_tasks",
    "get_my_tasks",
    "get_review_queue",
    "get_sla_breaches",
    "get_stale_tasks",
    "get_task_contract",
    "check_task_lock",
    "list_my_tasks",
    "lock_task",
    "move_task",
    "patrol_tasks",
    "prioritize_task",
    "reassign_task",
    "record_task_review",
    "release_task",
    "request_task_review",
    "reschedule_task",
    "search_tasks",
    "save_search_view",
    "list_search_views",
    "run_search_view",
    "delete_search_view",
    "standup",
    "set_task_contract",
    "task_context",
    "unlock_task",
    "unarchive_task",
    "update_task",
  ],
  projects: [
    "bootstrap_project",
    "approve_approval_gate",
    "create_plan",
    "create_project",
    "create_task_list",
    "delete_plan",
    "delete_project",
    "delete_task_list",
    "check_approval_gate",
    "check_runner_sandbox",
    "check_workspace_permission",
    "explain_policy_pack",
    "explain_runner_sandbox",
    "expire_approval_gate",
    "get_focus",
    "get_plan",
    "validate_policy_pack",
    "get_project",
    "get_task_list",
    "get_workspace_trust",
    "list_approval_gates",
    "list_local_event_hooks",
    "list_encryption_profiles",
    "list_policy_packs",
    "list_runner_sandbox_profiles",
    "list_workspace_trust_profiles",
    "list_plans",
    "list_projects",
    "list_task_lists",
    "remove_policy_pack",
    "remove_encryption_profile",
    "remove_local_event_hook",
    "remove_runner_sandbox_profile",
    "remove_workspace_trust",
    "reject_approval_gate",
    "require_approval_gate",
    "set_focus",
    "set_encryption_profile",
    "set_local_event_hook",
    "set_policy_pack",
    "set_runner_sandbox_profile",
    "set_workspace_trust",
    "unfocus",
    "update_plan",
    "update_project",
    "update_task_list",
    "test_local_event_hook",
    "get_encryption_status",
    "encrypt_local_value",
    "decrypt_local_value",
  ],
  resources: [
    "add_task_dependency",
    "add_task_file",
    "add_task_relationship",
    "bulk_find_tasks_by_files",
    "check_file_lock",
    "create_comment",
    "create_handoff",
    "capture_environment_snapshot",
    "compare_environment_snapshots",
    "create_inbox_item",
    "delete_comment",
    "detect_file_relationships",
    "find_path",
    "find_task_by_commit",
    "find_tasks_by_file",
    "find_tasks_by_git_ref",
    "add_task_verification",
    "add_task_run_artifact",
    "add_task_run_command",
    "add_task_run_event",
    "add_task_run_file",
    "acknowledge_handoff",
    "cancel_agent_run_dispatch",
    "finish_task_run",
    "find_duplicate_tasks",
    "get_verification_provider_capabilities",
    "get_comments",
    "get_critical_path",
    "get_file_heat_map",
    "get_impact_analysis",
    "get_inbox_item",
    "get_latest_handoff",
    "get_related_entities",
    "read_handoff",
    "recover_stale_session_handoff",
    "get_task_git_refs",
    "get_task_run_ledger",
    "list_agent_run_adapters",
    "list_agent_run_queue",
    "verify_task_run_artifacts",
    "get_task_traceability",
    "get_task_commits",
    "get_task_dependencies",
    "get_task_relationships",
    "get_task_watchers",
    "link_task_git_ref",
    "link_task_to_commit",
    "list_active_files",
    "list_comments",
    "list_file_locks",
    "list_handoffs",
    "list_inbox_items",
    "list_task_runs",
    "list_verification_providers",
    "merge_duplicate_task",
    "queue_agent_run",
    "remove_agent_run_adapter",
    "retry_agent_run_dispatch",
    "run_next_agent_dispatch",
    "set_agent_run_adapter",
    "set_verification_provider",
    "list_task_files",
    "lock_file",
    "log_time",
    "remove_task_dependency",
    "remove_task_relationship",
    "remove_verification_provider",
    "run_verification_provider",
    "start_task_run",
    "sync_kg",
    "unlock_file",
    "unwatch_task",
    "update_comment",
    "watch_task",
  ],
  agents: [
    "auto_assign_task",
    "delete_agent",
    "get_agent",
    "get_agent_metrics",
    "get_capable_agents",
    "get_leaderboard",
    "get_my_workload",
    "get_org_chart",
    "get_project_org_chart",
    "get_time_report",
    "list_project_agent_roles",
    "rebalance_workload",
    "rename_agent",
    "set_project_agent_role",
    "set_reports_to",
    "unarchive_agent",
    "update_agent",
  ],
  metadata: [
    "create_label",
    "create_tag",
    "delete_label",
    "delete_tag",
    "get_label",
    "get_activity_timeline",
    "get_recent_activity",
    "get_tag",
    "get_task_fields",
    "get_task_graph",
    "get_task_history",
    "get_task_stats",
    "list_labels",
    "list_tags",
    "query_tasks_by_fields",
    "search_tools",
    "describe_tools",
    "set_task_fields",
    "update_label",
    "update_tag",
  ],
  dispatch: [
    "cancel_dispatch",
    "dispatch_task_list",
    "dispatch_tasks",
    "dispatch_to_multiple",
    "list_dispatches",
    "run_due_dispatches",
  ],
  templates: [
    "create_task_from_template",
    "create_template",
    "delete_template",
    "export_template",
    "import_template",
    "init_templates",
    "list_template_library",
    "list_templates",
    "preview_template",
    "template_history",
    "update_template",
    "write_template_library",
  ],
  webhooks: ["create_webhook", "delete_webhook", "list_webhooks"],
  machines: [
    "machines_archive",
    "machines_delete",
    "machines_heartbeat",
    "machines_list",
    "machines_register",
    "machines_set_primary",
    "machines_topology",
    "machines_unarchive",
  ],
  maintenance: ["extract_todos", "get_sla_breaches", "notify_upcoming_deadlines", "run_doctor", "score_task"],
};

export const MCP_PROFILE_GROUPS: Record<string, readonly string[]> = {
  minimal: ["core"],
  core: ["core"],
  standard: ["core", "tasks", "projects", "resources", "agents", "metadata"],
  agent: ["core", "tasks", "projects", "resources"],
  maintainer: ["core", "tasks", "projects", "resources", "agents", "metadata", "dispatch", "maintenance"],
};

function splitTokens(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function addGroupTools(toolNames: Set<string>, groupName: string): boolean {
  const tools = MCP_TOOL_GROUPS[groupName];
  if (!tools) return false;
  for (const tool of tools) toolNames.add(tool);
  return true;
}

export function shouldRegisterToolForProfile(
  name: string,
  profileValue = process.env["TODOS_PROFILE"],
  groupValue = process.env["TODOS_TOOL_GROUPS"],
): boolean {
  const profileTokens = splitTokens(profileValue || "minimal");
  const groupTokens = splitTokens(groupValue);
  if (profileTokens.includes("full") || profileTokens.includes("all")) return true;

  const tools = new Set<string>();
  let matchedProfile = false;

  for (const token of profileTokens) {
    const profileGroups = MCP_PROFILE_GROUPS[token];
    if (profileGroups) {
      matchedProfile = true;
      for (const group of profileGroups) addGroupTools(tools, group);
      continue;
    }
    if (addGroupTools(tools, token)) {
      matchedProfile = true;
      continue;
    }
    if (token.startsWith("tool:")) {
      matchedProfile = true;
      tools.add(token.slice("tool:".length));
    }
  }

  if (!matchedProfile) {
    addGroupTools(tools, "core");
  }

  for (const token of groupTokens) {
    if (token === "full" || token === "all") return true;
    if (!addGroupTools(tools, token) && token.startsWith("tool:")) {
      tools.add(token.slice("tool:".length));
    }
  }

  return tools.has(name);
}

export function truncateText(value: string | null | undefined, maxChars = 240): string | null {
  if (!value) return null;
  if (maxChars <= 0) return "";
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function compactTask(task: Task, maxDescriptionChars = 180): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    id: task.id,
    short_id: task.short_id || task.id.slice(0, 8),
    title: task.title,
    status: task.status,
    priority: task.priority,
    assigned_to: task.assigned_to,
    project_id: task.project_id,
    due_at: task.due_at,
    updated_at: task.updated_at,
  };
  if (task.tags?.length) summary["tags"] = task.tags.slice(0, 8);
  const description = truncateText(task.description, maxDescriptionChars);
  if (description) summary["description"] = description;
  return summary;
}

export function compactStatus(status: Record<string, unknown>): Record<string, unknown> {
  const compact: Record<string, unknown> = {};
  for (const key of [
    "total",
    "pending",
    "in_progress",
    "completed",
    "failed",
    "cancelled",
    "stale_count",
    "overdue_recurring",
    "blocked_count",
  ]) {
    if (status[key] !== undefined) compact[key] = status[key];
  }
  const activeWork = status["active_work"];
  if (Array.isArray(activeWork)) {
    compact["active_work"] = activeWork.slice(0, 5).map((task) => {
      if (!task || typeof task !== "object") return task;
      const record = task as Record<string, unknown>;
      return {
        id: record["id"],
        short_id: record["short_id"],
        title: record["title"],
        priority: record["priority"],
        assigned_to: record["assigned_to"],
        updated_at: record["updated_at"],
      };
    });
    if (activeWork.length > 5) compact["active_work_omitted"] = activeWork.length - 5;
  }
  const blocked = status["blocked"];
  if (Array.isArray(blocked)) {
    compact["blocked"] = blocked.slice(0, 5);
    if (blocked.length > 5) compact["blocked_omitted"] = blocked.length - 5;
  }
  return compact;
}

export function compactHandoff(handoff: unknown): unknown {
  if (!handoff || typeof handoff !== "object") return handoff ?? null;
  const record = handoff as Record<string, unknown>;
  return {
    id: record["id"],
    agent_id: record["agent_id"],
    project_id: record["project_id"],
    session_id: record["session_id"],
    summary: truncateText(typeof record["summary"] === "string" ? record["summary"] : null, 240),
    task_count: Array.isArray(record["task_ids"]) ? record["task_ids"].length : 0,
    file_count: Array.isArray(record["relevant_files"]) ? record["relevant_files"].length : 0,
    run_count: Array.isArray(record["run_ids"]) ? record["run_ids"].length : 0,
    acknowledged_by: record["acknowledged_by"],
    created_at: record["created_at"],
  };
}

export function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

export function estimateMcpTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function tokenDiagnosticsEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env["TODOS_MCP_TOKEN_DIAGNOSTICS"] || "");
}

export function withMcpTokenDiagnostics(result: unknown, toolName: string, enabled = tokenDiagnosticsEnabled()): unknown {
  if (!enabled || !result || typeof result !== "object") return result;
  const response = result as { content?: unknown };
  if (!Array.isArray(response.content)) return result;

  const content = response.content as Array<Record<string, unknown>>;
  const textChars = content.reduce((sum, item) => (
    item["type"] === "text" && typeof item["text"] === "string" ? sum + item["text"].length : sum
  ), 0);
  const diagnostics = `[mcp-token-diagnostics tool=${toolName} chars=${textChars} approx_tokens=${Math.max(1, Math.ceil(textChars / 4))}]`;
  const nextContent = [...content];
  let lastTextIndex = -1;
  for (let index = nextContent.length - 1; index >= 0; index -= 1) {
    const item = nextContent[index]!;
    if (item["type"] === "text" && typeof item["text"] === "string") {
      lastTextIndex = index;
      break;
    }
  }
  if (lastTextIndex >= 0) {
    const item = nextContent[lastTextIndex]!;
    nextContent[lastTextIndex] = { ...item, text: `${item["text"]}\n\n${diagnostics}` };
  } else {
    nextContent.push({ type: "text", text: diagnostics });
  }
  return { ...response, content: nextContent };
}

export function installMcpTokenDiagnostics(server: any): void {
  const originalTool = server.tool.bind(server);
  server.tool = (...args: unknown[]) => {
    const name = String(args[0]);
    const last = args[args.length - 1];
    if (typeof last !== "function") return originalTool(...args);
    const wrapped = async (...handlerArgs: unknown[]) => {
      const result = await last(...handlerArgs);
      return withMcpTokenDiagnostics(result, name);
    };
    return originalTool(...args.slice(0, -1), wrapped);
  };
}
