/**
 * Local feature/capability manifest — CLI commands, MCP tools, profiles, env vars.
 * Fully local; no network required for discovery.
 */

import {
  CLI_COMMAND_GROUPS,
  ENV_VARS,
  NESTED_SUBCOMMANDS,
  listTopLevelCommands,
  type CliCommandGroup,
  type EnvVarRef,
} from "./cli-reference.js";
import {
  ACCESS_PROFILES,
  getAccessProfileMeta,
  getProfileToolCount,
  listAccessProfiles,
  resolveAccessProfile,
  shouldRegisterToolForProfile,
  type AccessProfile,
  type AccessProfileMeta,
} from "./access-profiles.js";

export const FEATURE_MANIFEST_SCHEMA = "todos.feature_manifest.v1";

export interface FeatureArea {
  id: string;
  name: string;
  description: string;
  surfaces: Array<"cli" | "mcp" | "sdk">;
  cli_commands: string[];
  mcp_tools: string[];
}

export interface McpToolGroup {
  id: string;
  name: string;
  description: string;
  tools: string[];
}

export interface FeatureManifest {
  schema_version: typeof FEATURE_MANIFEST_SCHEMA;
  generated_at: string;
  local_only: true;
  active_profile: AccessProfile;
  cli: {
    command_groups: CliCommandGroup[];
    top_level_commands: string[];
    nested_subcommands: Record<string, string[]>;
    command_count: number;
  };
  mcp: {
    tool_groups: McpToolGroup[];
    total_tools: number;
    tools_for_profile: string[];
    tools_for_profile_count: number;
  };
  profiles: AccessProfileMeta[];
  env_vars: EnvVarRef[];
  feature_areas: FeatureArea[];
  summary: {
    feature_area_count: number;
    cli_command_count: number;
    mcp_tool_count: number;
    profile_count: number;
    env_var_count: number;
  };
}

export type CapabilityKind = "feature_area" | "cli_command" | "mcp_tool" | "profile" | "env_var";

export interface CapabilityMatch {
  kind: CapabilityKind;
  id: string;
  name: string;
  description: string;
  surface: "cli" | "mcp" | "config" | "meta";
  group?: string;
}

export interface CapabilityDiscovery {
  schema_version: typeof FEATURE_MANIFEST_SCHEMA;
  generated_at: string;
  query: string | null;
  surface: "all" | "cli" | "mcp";
  matches: CapabilityMatch[];
  feature_areas: FeatureArea[];
  totals: {
    cli: number;
    mcp: number;
    areas: number;
    profiles: number;
    env_vars: number;
    matched: number;
  };
}

export interface BuildFeatureManifestOptions {
  profile?: AccessProfile;
  generated_at?: string;
}

export interface GetCapabilityDiscoveryOptions {
  query?: string;
  surface?: "all" | "cli" | "mcp";
  profile?: AccessProfile;
  generated_at?: string;
  limit?: number;
}

/** Canonical sorted MCP tool names registered in src/mcp/tools. */
export const ALL_MCP_TOOLS = [
  "acquire_task_lease",
  "add_artifact",
  "add_comment",
  "add_task_dependency",
  "add_task_file",
  "add_task_relationship",
  "analyze_branch_work",
  "analyze_dependency_graph",
  "append_run_command",
  "apply_export_profile",
  "apply_failure_triage",
  "apply_user_scaffold",
  "approve_gate",
  "approve_task",
  "archive_completed",
  "assign_label_to_task",
  "attach_plan_to_project",
  "auto_assign_task",
  "backup_database",
  "bootstrap_workspace",
  "build_context_pack",
  "build_handoff_packet",
  "build_report_export",
  "bulk_create_tasks",
  "bulk_delete_tasks",
  "bulk_find_tasks_by_files",
  "bulk_update_tasks",
  "cancel_agent_run",
  "cancel_dispatch",
  "cancel_task",
  "capture_env_snapshot",
  "capture_knowledge_snapshot",
  "check_database_integrity",
  "check_env_snapshot",
  "check_file_lock",
  "check_sandbox_command",
  "check_schema_compatibility",
  "check_workspace_permission",
  "claim_goal_step",
  "claim_next_agent_run",
  "claim_plan_step",
  "claim_task",
  "cleanup_artifacts",
  "complete_agent_run",
  "complete_task",
  "create_comment",
  "create_custom_field",
  "create_decision_record",
  "create_goal_workflow",
  "create_handoff",
  "create_handoff_packet",
  "create_inbox_intake",
  "create_label",
  "create_manual_checkpoint",
  "create_plan",
  "create_project",
  "create_run_record",
  "create_saved_view",
  "create_tag",
  "create_task",
  "create_task_from_template",
  "create_task_list",
  "create_template",
  "create_verification_evidence",
  "create_watch_rule",
  "create_webhook",
  "crypto_status",
  "decrypt_metadata_fields",
  "delete_agent",
  "delete_artifact",
  "delete_comment",
  "delete_label",
  "delete_plan",
  "delete_project",
  "delete_tag",
  "delete_task",
  "delete_task_list",
  "delete_template",
  "delete_watch_rule",
  "delete_webhook",
  "describe_tools",
  "detect_file_relationships",
  "discover_workspace",
  "dispatch_task_list",
  "dispatch_tasks",
  "dispatch_to_multiple",
  "encrypt_metadata_fields",
  "enqueue_agent_run",
  "export_activity_log",
  "export_artifacts",
  "export_decision_record",
  "export_knowledge_snapshot",
  "export_local_bundle",
  "export_plan_execution_contract",
  "export_report_file",
  "export_run_replay",
  "export_template",
  "export_todos_md",
  "export_verification_evidence",
  "extend_task",
  "extract_todos",
  "fail_agent_run",
  "fail_task",
  "find_duplicate_tasks",
  "find_path",
  "find_task_by_commit",
  "find_tasks_by_file",
  "format_failure_triage_markdown",
  "format_goal_handoff",
  "format_handoff_packet",
  "format_release_notes_markdown",
  "generate_branch_work_plan",
  "generate_release_notes",
  "get_activity_timeline",
  "get_agent",
  "get_agent_adapter_doc",
  "get_agent_metrics",
  "get_agent_safe_queue",
  "get_agent_workflow_demo_docs",
  "get_archived_tasks",
  "get_blocked_task_reports",
  "get_blocked_tasks",
  "get_blocking_tasks",
  "get_bootstrap_status",
  "get_branch_work_plan_docs",
  "get_capability_discovery",
  "get_capable_agents",
  "get_cli_mcp_parity",
  "get_cli_reference",
  "get_comments",
  "get_critical_path",
  "get_decision_record",
  "get_dependency_critical_path",
  "get_env_snapshot",
  "get_failure_triage_report",
  "get_feature_manifest",
  "get_feature_manifest_docs",
  "get_file_heat_map",
  "get_focus",
  "get_goal_status",
  "get_health",
  "get_impact_analysis",
  "get_json_schema",
  "get_knowledge_snapshot",
  "get_label",
  "get_latest_handoff",
  "get_leaderboard",
  "get_machine_topology",
  "get_my_tasks",
  "get_my_workload",
  "get_org_chart",
  "get_plan",
  "get_plan_execution_state",
  "get_project",
  "get_project_org_chart",
  "get_ready_tasks",
  "get_related_entities",
  "get_resource_changes",
  "get_resource_snapshot",
  "get_review_queue",
  "get_run_record",
  "get_scheduling_summary",
  "get_shell_completion",
  "get_stale_task_report",
  "get_stale_tasks",
  "get_status",
  "get_tag",
  "get_task",
  "get_task_commits",
  "get_task_dependencies",
  "get_task_fields",
  "get_task_gate_status",
  "get_task_list",
  "get_task_relationships",
  "get_task_traceability",
  "get_task_watchers",
  "get_time_report",
  "get_unlock_impact",
  "heartbeat",
  "import_issues",
  "import_local_bundle",
  "import_template",
  "import_todos_md",
  "init_templates",
  "inspect_git_commit",
  "install_template_library",
  "link_task_git_trace",
  "link_task_to_commit",
  "list_access_profiles",
  "list_active_files",
  "list_active_leases",
  "list_activity",
  "list_agent_adapter_docs",
  "list_agent_adapters",
  "list_agent_runs",
  "list_agents",
  "list_artifacts",
  "list_command_aliases",
  "list_comments",
  "list_decision_records",
  "list_dispatches",
  "list_env_snapshots",
  "list_file_locks",
  "list_json_schemas",
  "list_knowledge_snapshots",
  "list_labels",
  "list_my_tasks",
  "list_pending_approvals",
  "list_plans",
  "list_policy_packs",
  "list_project_agent_roles",
  "list_projects",
  "list_run_records",
  "list_sandbox_profiles",
  "list_saved_views",
  "list_secret_patterns",
  "list_tags",
  "list_task_files",
  "list_task_lists",
  "list_tasks",
  "list_template_library",
  "list_templates",
  "list_user_scaffolds",
  "list_verification_providers",
  "list_verification_records",
  "list_webhooks",
  "list_workspace_trust_profiles",
  "lock_file",
  "log_time",
  "materialize_plan_steps",
  "merge_tasks",
  "migrate_pg",
  "migration_dry_run",
  "notify_upcoming_deadlines",
  "patrol_tasks",
  "poll_watch_notifications",
  "preview_bundle_sync",
  "preview_inbox_intake",
  "preview_issue_import",
  "preview_nl_intake",
  "preview_template",
  "preview_template_library",
  "preview_user_scaffold",
  "prioritize_task",
  "reassign_task",
  "rebalance_workload",
  "recover_stale_leases",
  "register_agent",
  "register_local_machine",
  "reject_gate",
  "release_agent",
  "release_task",
  "release_task_lease",
  "remove_task_dependency",
  "remove_task_relationship",
  "rename_agent",
  "renew_task_lease",
  "request_approval",
  "reschedule_task",
  "resolve_command_query",
  "resource_diagnostics",
  "restore_database",
  "retry_agent_run",
  "run_agent_workflow_demo",
  "run_due_dispatches",
  "run_release_checks",
  "run_saved_view",
  "run_verification",
  "save_command_alias",
  "scan_file_for_secrets",
  "scan_text_for_secrets",
  "schedule_task",
  "score_task",
  "search_tasks",
  "search_tools",
  "set_decision_status",
  "set_focus",
  "set_project_agent_role",
  "set_reports_to",
  "set_task_custom_field",
  "set_task_priority_meta",
  "set_watch_preferences",
  "standup",
  "start_task",
  "steal_task_lease",
  "subscribe_resource",
  "suggest_agent_name",
  "supersede_decision_record",
  "sync",
  "sync_all",
  "sync_kg",
  "sync_todos_md",
  "task_context",
  "template_history",
  "todos_inbox",
  "todos_retro",
  "todos_storage_conflicts",
  "todos_storage_feedback",
  "todos_storage_pull",
  "todos_storage_push",
  "todos_storage_status",
  "trust_workspace",
  "unarchive_agent",
  "unarchive_task",
  "unfocus",
  "unified_search",
  "unlock_file",
  "unsubscribe_resource",
  "unwatch_task",
  "update_agent",
  "update_changelog",
  "update_comment",
  "update_decision_record",
  "update_label",
  "update_plan",
  "update_project",
  "update_tag",
  "update_task",
  "update_task_list",
  "update_template",
  "update_watch_rule",
  "validate_bundle",
  "validate_policy_pack",
  "validate_schema_payload",
  "watch_task",
];

export const FEATURE_AREAS: FeatureArea[] = [
  {
    id: "task_workflow",
    name: "Task workflow",
    description: "Create, claim, start, complete, and fail tasks with agent coordination.",
    surfaces: ["cli", "mcp", "sdk"],
    cli_commands: ["add", "list", "show", "start", "done", "claim", "next", "fail", "search"],
    mcp_tools: ["create_task", "list_tasks", "get_task", "start_task", "complete_task", "fail_task", "claim_task"],
  },
  {
    id: "agent_coordination",
    name: "Agent coordination",
    description: "Multi-agent leases, runs, heartbeats, and focus mode.",
    surfaces: ["cli", "mcp"],
    cli_commands: ["init", "status", "active", "stale", "runs"],
    mcp_tools: ["register_agent", "heartbeat", "acquire_task_lease", "enqueue_agent_run", "claim_next_agent_run"],
  },
  {
    id: "projects_plans",
    name: "Projects and plans",
    description: "Projects, task lists, plans, and bootstrap/discovery.",
    surfaces: ["cli", "mcp", "sdk"],
    cli_commands: ["projects", "plans", "bootstrap", "discover"],
    mcp_tools: ["create_project", "list_projects", "create_plan", "bootstrap_workspace", "discover_workspace"],
  },
  {
    id: "import_export",
    name: "Import and export",
    description: "Local bundles, todos.md sync, database backup, and artifacts.",
    surfaces: ["cli", "mcp"],
    cli_commands: ["bridge", "md", "db", "artifact"],
    mcp_tools: ["export_local_bundle", "import_local_bundle", "export_todos_md", "backup_database"],
  },
  {
    id: "verification_security",
    name: "Verification and security",
    description: "Evidence, sandbox checks, secret scanning, and workspace trust.",
    surfaces: ["cli", "mcp"],
    cli_commands: ["verify", "sandbox", "trust", "redact", "policy"],
    mcp_tools: ["run_verification", "check_sandbox_command", "scan_text_for_secrets", "check_workspace_permission"],
  },
  {
    id: "meta_discovery",
    name: "Meta and discovery",
    description: "CLI reference, parity reports, profiles, and capability manifests.",
    surfaces: ["cli", "mcp"],
    cli_commands: ["docs", "completion", "parity", "features", "demo"],
    mcp_tools: ["get_cli_reference", "get_cli_mcp_parity", "get_feature_manifest", "get_capability_discovery"],
  },
];

const MCP_GROUP_DEFS: Array<{ id: string; name: string; description: string; match: (tool: string) => boolean }> = [
  {
    id: "meta",
    name: "Meta",
    description: "Docs, schemas, parity, profiles, and discovery tools.",
    match: (t) =>
      /describe_tools|search_tools|cli_reference|cli_mcp_parity|access_profile|feature_manifest|capability_discovery|json_schema|command_alias|adapter_doc|shell_completion|bootstrap|discover_workspace/.test(t)
      || ["get_health", "list_access_profiles", "resolve_command_query"].includes(t),
  },
  {
    id: "tasks",
    name: "Tasks",
    description: "Task CRUD, workflow, dependencies, and search.",
    match: (t) =>
      /^(create|list|get|update|delete|start|complete|fail|cancel|claim|release|extend|bulk_|search_tasks|merge_tasks|find_duplicate)/.test(t)
      || ["add_comment", "get_comments", "task_context", "standup", "schedule_task"].includes(t),
  },
  {
    id: "projects",
    name: "Projects and plans",
    description: "Projects, task lists, plans, tags, and labels.",
    match: (t) => /^(create|list|get|update|delete)_(project|plan|task_list|tag|label)/.test(t) || t === "assign_label_to_task",
  },
  {
    id: "agents",
    name: "Agents",
    description: "Agent registration, focus, org chart, and metrics.",
    match: (t) =>
      /agent/.test(t)
      && !/agent_run|adapter_doc|safe_queue|workflow_demo/.test(t),
  },
  {
    id: "agent_runs",
    name: "Agent runs",
    description: "Queue, claim, and complete adapter-backed agent runs.",
    match: (t) => /agent_run|enqueue_agent_run|claim_next_agent_run|list_agent_adapters/.test(t),
  },
  {
    id: "coordination",
    name: "Coordination",
    description: "Leases, approvals, dispatch, and handoffs.",
    match: (t) =>
      /lease|approval|dispatch|handoff|gate|checkpoint/.test(t)
      || ["request_approval", "approve_gate", "reject_gate"].includes(t),
  },
  {
    id: "graph",
    name: "Graph and dependencies",
    description: "Dependency graphs, relationships, and knowledge graph tools.",
    match: (t) =>
      /dependenc|relationship|graph|critical_path|blocked|ready_tasks|sync_kg|find_path|impact|branch_work/.test(t),
  },
  {
    id: "import_export",
    name: "Import and export",
    description: "Bundles, todos.md, templates, artifacts, and reports.",
    match: (t) =>
      /export_|import_|bundle|todos_md|template|artifact|report_export|scaffold/.test(t),
  },
  {
    id: "ops",
    name: "Operations",
    description: "Database backup, activity audit, scheduling, and release checks.",
    match: (t) =>
      /backup|restore|migration|activity|schedule|release_check|env_snapshot|topology|run_record|decision_record|knowledge_snapshot/.test(t),
  },
  {
    id: "security",
    name: "Security",
    description: "Sandbox, trust, secrets, crypto, and verification.",
    match: (t) =>
      /sandbox|trust|secret|crypto|verification|policy_pack|redact|scan_/.test(t),
  },
  {
    id: "storage",
    name: "Storage bridge",
    description: "Optional storage sync tools (admin profile).",
    match: (t) => t.startsWith("todos_storage_") || t === "sync_all" || t === "migrate_pg",
  },
  {
    id: "workflow",
    name: "Workflow utilities",
    description: "Goals, scheduling, views, subscriptions, webhooks, and misc helpers.",
    match: () => true,
  },
];

function countCliCommands(): number {
  let count = CLI_COMMAND_GROUPS.reduce((sum, g) => sum + g.commands.length, 0);
  for (const subs of Object.values(NESTED_SUBCOMMANDS)) count += subs.length;
  return count;
}

export function listMcpToolNames(): string[] {
  return [...ALL_MCP_TOOLS];
}

export function categorizeMcpTool(tool: string): string {
  for (const def of MCP_GROUP_DEFS) {
    if (def.match(tool)) return def.id;
  }
  return "workflow";
}

export function buildMcpToolGroups(tools: string[] = listMcpToolNames()): McpToolGroup[] {
  const buckets = new Map<string, string[]>();
  for (const def of MCP_GROUP_DEFS) buckets.set(def.id, []);

  for (const tool of [...tools].sort()) {
    let assigned = false;
    for (const def of MCP_GROUP_DEFS) {
      if (def.match(tool)) {
        buckets.get(def.id)!.push(tool);
        assigned = true;
        break;
      }
    }
    if (!assigned) buckets.get("workflow")!.push(tool);
  }

  return MCP_GROUP_DEFS
    .map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      tools: buckets.get(def.id) ?? [],
    }))
    .filter((g) => g.tools.length > 0);
}

function toolsForProfile(profile: AccessProfile): string[] {
  return listMcpToolNames().filter((t) => shouldRegisterToolForProfile(t, profile));
}

function flattenCliCommands(): Array<{ group: string; command: string; summary: string }> {
  const rows: Array<{ group: string; command: string; summary: string }> = [];
  for (const group of CLI_COMMAND_GROUPS) {
    for (const cmd of group.commands) {
      rows.push({ group: group.name, command: cmd.name, summary: cmd.summary });
      const nested = NESTED_SUBCOMMANDS[cmd.name];
      if (nested) {
        for (const sub of nested) {
          rows.push({
            group: group.name,
            command: `${cmd.name} ${sub}`,
            summary: `${cmd.name} ${sub}`,
          });
        }
      }
    }
  }
  return rows;
}

export function buildFeatureManifest(options: BuildFeatureManifestOptions = {}): FeatureManifest {
  const profile = options.profile ?? resolveAccessProfile();
  const generatedAt = options.generated_at ?? new Date(0).toISOString();
  const profileTools = toolsForProfile(profile);
  const topLevel = listTopLevelCommands();

  return {
    schema_version: FEATURE_MANIFEST_SCHEMA,
    generated_at: generatedAt,
    local_only: true,
    active_profile: profile,
    cli: {
      command_groups: CLI_COMMAND_GROUPS,
      top_level_commands: topLevel,
      nested_subcommands: NESTED_SUBCOMMANDS,
      command_count: countCliCommands(),
    },
    mcp: {
      tool_groups: buildMcpToolGroups(),
      total_tools: listMcpToolNames().length,
      tools_for_profile: profileTools,
      tools_for_profile_count: profileTools.length,
    },
    profiles: listAccessProfiles(),
    env_vars: ENV_VARS,
    feature_areas: FEATURE_AREAS,
    summary: {
      feature_area_count: FEATURE_AREAS.length,
      cli_command_count: countCliCommands(),
      mcp_tool_count: listMcpToolNames().length,
      profile_count: ACCESS_PROFILES.length,
      env_var_count: ENV_VARS.length,
    },
  };
}

function matchesQuery(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.trim().toLowerCase());
}

export function getCapabilityDiscovery(options: GetCapabilityDiscoveryOptions = {}): CapabilityDiscovery {
  const query = options.query?.trim() ?? "";
  const surface = options.surface ?? "all";
  const profile = options.profile ?? resolveAccessProfile();
  const generatedAt = options.generated_at ?? new Date(0).toISOString();
  const limit = options.limit ?? 50;
  const profileTools = new Set(toolsForProfile(profile));

  const matches: CapabilityMatch[] = [];

  if (!query || surface === "all" || surface === "cli") {
    for (const row of flattenCliCommands()) {
      const haystack = `${row.command} ${row.summary} ${row.group}`;
      if (query && !matchesQuery(haystack, query)) continue;
      matches.push({
        kind: "cli_command",
        id: `cli:${row.command}`,
        name: row.command,
        description: row.summary,
        surface: "cli",
        group: row.group,
      });
    }
  }

  if (!query || surface === "all" || surface === "mcp") {
    for (const tool of listMcpToolNames()) {
      if (!profileTools.has(tool)) continue;
      const group = categorizeMcpTool(tool);
      const haystack = `${tool} ${group}`;
      if (query && !matchesQuery(haystack, query)) continue;
      matches.push({
        kind: "mcp_tool",
        id: `mcp:${tool}`,
        name: tool,
        description: `MCP tool (${group})`,
        surface: "mcp",
        group,
      });
    }
  }

  for (const area of FEATURE_AREAS) {
    const haystack = `${area.id} ${area.name} ${area.description} ${area.cli_commands.join(" ")} ${area.mcp_tools.join(" ")}`;
    if (query && !matchesQuery(haystack, query)) continue;
    if (surface === "cli" && !area.surfaces.includes("cli")) continue;
    if (surface === "mcp" && !area.surfaces.includes("mcp")) continue;
    matches.unshift({
      kind: "feature_area",
      id: `area:${area.id}`,
      name: area.name,
      description: area.description,
      surface: "meta",
      group: area.id,
    });
  }

  if (!query || surface === "all") {
    for (const profileMeta of listAccessProfiles()) {
      const haystack = `${profileMeta.name} ${profileMeta.description}`;
      if (query && !matchesQuery(haystack, query)) continue;
      matches.push({
        kind: "profile",
        id: `profile:${profileMeta.name}`,
        name: profileMeta.name,
        description: profileMeta.description,
        surface: "config",
      });
    }

    for (const env of ENV_VARS) {
      const haystack = `${env.name} ${env.description}`;
      if (query && !matchesQuery(haystack, query)) continue;
      matches.push({
        kind: "env_var",
        id: `env:${env.name}`,
        name: env.name,
        description: env.description,
        surface: "config",
      });
    }
  }

  const deduped = matches.filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i);
  const limited = deduped.slice(0, limit);

  return {
    schema_version: FEATURE_MANIFEST_SCHEMA,
    generated_at: generatedAt,
    query: query || null,
    surface,
    matches: limited,
    feature_areas: FEATURE_AREAS,
    totals: {
      cli: flattenCliCommands().length,
      mcp: profileTools.size,
      areas: FEATURE_AREAS.length,
      profiles: ACCESS_PROFILES.length,
      env_vars: ENV_VARS.length,
      matched: deduped.length,
    },
  };
}

export function normalizeFeatureManifest(
  manifest: FeatureManifest,
  generatedAt = "2026-01-01T00:00:00.000Z",
): Record<string, unknown> {
  return {
    schema_version: manifest.schema_version,
    generated_at: generatedAt,
    local_only: manifest.local_only,
    active_profile: manifest.active_profile,
    cli: {
      command_count: manifest.cli.command_count,
      top_level_commands: manifest.cli.top_level_commands,
      group_names: manifest.cli.command_groups.map((g) => g.name),
      nested_subcommand_keys: Object.keys(manifest.cli.nested_subcommands).sort(),
    },
    mcp: {
      total_tools: manifest.mcp.total_tools,
      tools_for_profile_count: manifest.mcp.tools_for_profile_count,
      tool_group_counts: Object.fromEntries(
        manifest.mcp.tool_groups.map((g) => [g.id, g.tools.length] as const).sort(([a], [b]) => String(a).localeCompare(String(b))),
      ),
    },
    profiles: manifest.profiles.map((p) => p.name),
    env_vars: manifest.env_vars.map((e) => e.name),
    feature_areas: manifest.feature_areas.map((a) => a.id),
    summary: manifest.summary,
  };
}

export function formatFeatureManifestReport(
  manifest: FeatureManifest,
  options?: { deterministic?: boolean },
): string {
  const generatedAt = options?.deterministic ? "2026-01-01T00:00:00.000Z" : manifest.generated_at;
  const profileMeta = getAccessProfileMeta(manifest.active_profile);

  const lines = [
    "=== Todos Feature Manifest (local-only) ===",
    `Schema: ${manifest.schema_version}`,
    `Generated: ${generatedAt}`,
    `Active profile: ${manifest.active_profile} — ${profileMeta.description}`,
    "",
    "Summary:",
    `  Feature areas: ${manifest.summary.feature_area_count}`,
    `  CLI commands:  ${manifest.summary.cli_command_count}`,
    `  MCP tools:     ${manifest.summary.mcp_tool_count} (${manifest.mcp.tools_for_profile_count} in active profile)`,
    `  Profiles:      ${manifest.summary.profile_count}`,
    `  Env vars:      ${manifest.summary.env_var_count}`,
    "",
    "Feature areas:",
    ...manifest.feature_areas.map((a) => `  - ${a.name}: ${a.description}`),
    "",
    "MCP tool groups:",
    ...manifest.mcp.tool_groups.map((g) => `  - ${g.name}: ${g.tools.length} tools`),
    "",
    "Profiles:",
    ...manifest.profiles.map((p) => `  - ${p.name}: ${p.description}`),
    "",
    "Try:",
    "  todos features list              # capability discovery summary",
    "  todos features manifest --json   # full manifest",
    "  TODOS_PROFILE=minimal todos-mcp  # low-token MCP session",
  ];
  return lines.join("\n");
}

export function getFeatureManifestDocs(): string {
  return `# Feature manifest and capability discovery (local-only)

Discover CLI commands, MCP tools, access profiles, and environment variables without network access.

## CLI

\`\`\`bash
todos features list                 # searchable capability summary
todos features list --query claim   # filter by keyword
todos features manifest             # human-readable manifest
todos features manifest --json      # JSON manifest
todos features docs                 # this guide
\`\`\`

## MCP

- \`get_feature_manifest\` — full local feature manifest (CLI + MCP + profiles + env)
- \`get_capability_discovery\` — search/filter capabilities by keyword and surface
- \`get_feature_manifest_docs\` — quickstart documentation

## Profiles

Set \`TODOS_PROFILE\` to control which MCP tools load:

| Profile | Use case |
|---------|----------|
| minimal | Low-token agent sessions |
| agent_safe | Claim/complete workflow without destructive ops |
| standard | Default minus admin/template/webhook tools |
| full | All local tools |
| admin | Includes migrations and storage bridge |

Schema: \`${FEATURE_MANIFEST_SCHEMA}\`
`;
}

export function validateFeatureManifest(manifest: FeatureManifest): string[] {
  const issues: string[] = [];
  const tools = new Set(listMcpToolNames());

  if (tools.size !== ALL_MCP_TOOLS.length) {
    issues.push("ALL_MCP_TOOLS contains duplicate entries");
  }

  const grouped = new Set(manifest.mcp.tool_groups.flatMap((g) => g.tools));
  for (const tool of listMcpToolNames()) {
    if (!grouped.has(tool)) issues.push(`Tool '${tool}' missing from MCP tool groups`);
  }

  if (manifest.summary.mcp_tool_count !== listMcpToolNames().length) {
    issues.push("MCP tool count mismatch in summary");
  }

  const profileCount = getProfileToolCount("minimal", listMcpToolNames());
  if (profileCount <= 0) issues.push("minimal profile exposes no MCP tools");

  return issues;
}
