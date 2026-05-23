/**
 * Local access profiles for CLI, MCP, SDK, and optional HTTP server.
 */

export const ACCESS_PROFILE_SCHEMA = "todos.access_profile.v1";

export const ACCESS_PROFILES = ["read_only", "agent_safe", "minimal", "standard", "full", "admin"] as const;
export type AccessProfile = (typeof ACCESS_PROFILES)[number];

export interface AccessProfileMeta {
  name: AccessProfile;
  description: string;
  surfaces: Array<"cli" | "mcp" | "sdk" | "http">;
  allows_mutations: boolean;
  allows_admin: boolean;
}

const PROFILE_META: Record<AccessProfile, AccessProfileMeta> = {
  read_only: {
    name: "read_only",
    description: "Read tasks, projects, search — no mutations",
    surfaces: ["cli", "mcp", "sdk", "http"],
    allows_mutations: false,
    allows_admin: false,
  },
  agent_safe: {
    name: "agent_safe",
    description: "Agent workflow: claim, start, complete, comment — no destructive ops",
    surfaces: ["cli", "mcp", "sdk"],
    allows_mutations: true,
    allows_admin: false,
  },
  minimal: {
    name: "minimal",
    description: "Low-token MCP session bootstrap and task workflow",
    surfaces: ["mcp"],
    allows_mutations: true,
    allows_admin: false,
  },
  standard: {
    name: "standard",
    description: "Default MCP/CLI minus admin/webhook/template tools",
    surfaces: ["cli", "mcp", "sdk"],
    allows_mutations: true,
    allows_admin: false,
  },
  full: {
    name: "full",
    description: "All local tools including templates and webhooks",
    surfaces: ["cli", "mcp", "sdk", "http"],
    allows_mutations: true,
    allows_admin: false,
  },
  admin: {
    name: "admin",
    description: "Full access including migrations and cloud bridge tools",
    surfaces: ["cli", "mcp", "sdk", "http"],
    allows_mutations: true,
    allows_admin: true,
  },
};

export const READ_ONLY_TOOLS = new Set([
  "get_task", "list_tasks", "get_status", "get_context", "search_tasks",
  "list_projects", "get_project", "list_plans", "get_plan", "list_agents", "get_agent",
  "list_task_lists", "get_task_list", "get_task_commits", "get_task_traceability",
  "list_pending_approvals", "get_task_gate_status", "list_active_leases",
  "list_agent_runs", "list_agent_adapters", "discover_workspace", "get_bootstrap_status",
  "get_agent_workflow_demo_docs",
  "get_cli_mcp_parity", "list_secret_patterns", "list_sandbox_profiles",
  "list_workspace_trust_profiles", "list_verification_providers", "list_verification_records",
  "get_tasks_changed_since", "get_stale_tasks", "get_active_work", "get_next_task",
  "find_duplicate_tasks", "describe_tools", "search_tools", "inspect_git_commit",
  "scan_text_for_secrets", "check_workspace_permission", "check_sandbox_command",
]);

export const MINIMAL_TOOLS = new Set([
  "claim_next_task", "complete_task", "fail_task", "get_status", "get_context",
  "get_task", "start_task", "add_comment", "get_next_task", "bootstrap",
  "get_tasks_changed_since", "heartbeat", "release_agent",
]);

export const AGENT_SAFE_TOOLS = new Set([
  ...READ_ONLY_TOOLS,
  ...MINIMAL_TOOLS,
  "create_task", "update_task", "lock_task", "unlock_task",
  "enqueue_agent_run", "claim_next_agent_run", "complete_agent_run", "fail_agent_run",
  "acquire_task_lease", "renew_task_lease", "release_task_lease",
  "request_approval", "run_verification", "link_task_git_trace",
  "assign_label_to_task", "set_task_custom_field", "log_progress",
]);

export const STANDARD_EXCLUDED = new Set([
  "rename_agent", "delete_agent", "unarchive_agent",
  "create_webhook", "list_webhooks", "delete_webhook",
  "create_template", "list_templates", "create_task_from_template", "delete_template", "update_template",
  "init_templates", "preview_template", "export_template", "import_template", "template_history",
  "approve_task", "migrate_pg",
]);

export const ADMIN_ONLY_TOOLS = new Set([
  "migrate_pg", "delete_task", "delete_project", "delete_agent", "delete_plan",
  "delete_task_list", "delete_webhook", "delete_template",
  "steal_task_lease", "recover_stale_leases",
]);

export const DANGEROUS_TOOLS = new Set([
  ...ADMIN_ONLY_TOOLS,
  "bulk_update_tasks", "merge_tasks", "cancel_agent_run",
]);

export function resolveAccessProfile(envValue?: string): AccessProfile {
  const raw = (envValue ?? process.env["TODOS_PROFILE"] ?? "full").toLowerCase();
  if (ACCESS_PROFILES.includes(raw as AccessProfile)) return raw as AccessProfile;
  // backward compat aliases
  if (raw === "readonly") return "read_only";
  if (raw === "agent-safe") return "agent_safe";
  return "full";
}

export function getAccessProfileMeta(profile?: AccessProfile): AccessProfileMeta {
  return PROFILE_META[profile ?? resolveAccessProfile()];
}

export function listAccessProfiles(): AccessProfileMeta[] {
  return ACCESS_PROFILES.map((p) => PROFILE_META[p]);
}

export function shouldRegisterToolForProfile(toolName: string, profile?: AccessProfile): boolean {
  const p = profile ?? resolveAccessProfile();

  if (ADMIN_ONLY_TOOLS.has(toolName) && p !== "admin") return false;

  switch (p) {
    case "read_only":
      return READ_ONLY_TOOLS.has(toolName);
    case "agent_safe":
      return AGENT_SAFE_TOOLS.has(toolName);
    case "minimal":
      return MINIMAL_TOOLS.has(toolName);
    case "standard":
      return !STANDARD_EXCLUDED.has(toolName);
    case "admin":
    case "full":
    default:
      return true;
  }
}

export function assertToolAllowed(toolName: string, profile?: AccessProfile): void {
  if (!shouldRegisterToolForProfile(toolName, profile)) {
    const p = profile ?? resolveAccessProfile();
    throw new Error(
      `Tool '${toolName}' is not available in profile '${p}'. Set TODOS_PROFILE=full or admin for destructive operations.`,
    );
  }
}

export function getProfileToolCount(profile: AccessProfile, allTools: string[]): number {
  return allTools.filter((t) => shouldRegisterToolForProfile(t, profile)).length;
}

export function getHeadlessUsageNotes(profile?: AccessProfile): string[] {
  const p = profile ?? resolveAccessProfile();
  const meta = getAccessProfileMeta(p);
  return [
    `Active profile: ${p} — ${meta.description}`,
    "Headless agents should prefer MCP with TODOS_PROFILE=minimal or agent_safe.",
    "Local HTTP dashboard mutations require localhost API only (see headless-boundaries).",
    "Dangerous tools require TODOS_PROFILE=admin and explicit invocation.",
  ];
}
