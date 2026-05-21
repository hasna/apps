import { getPackageVersion } from "./lib/package-version.js";
import { getMcpToolNames } from "./mcp.js";

export type TodosCliMcpParityDomain =
  | "tasks"
  | "local-fields"
  | "dedupe"
  | "verification-providers"
  | "projects"
  | "plans"
  | "templates"
  | "workspace-trust"
  | "secret-safety"
  | "runner-sandbox"
  | "extensions"
  | "workflow-prompts"
  | "policy-packs"
  | "approval-gates"
  | "local-event-hooks"
  | "encryption"
  | "agent-runs"
  | "calendar"
  | "kanban-boards"
  | "time-tracking"
  | "handoffs"
  | "runs"
  | "comments"
  | "search"
  | "context-packs"
  | "environment-snapshots"
  | "imports"
  | "exports";

export type TodosCliMcpParityStatus = "matched" | "intentional-gap";

export interface CreateCliMcpParityManifestOptions {
  version?: string;
  generatedAt?: string;
}

export interface TodosCliMcpParityPackageSource {
  packageName: "@hasna/todos";
  repository: "hasna/todos";
  version: string;
}

export interface TodosCliMcpParityEntry {
  domain: TodosCliMcpParityDomain;
  cliCommands: string[];
  mcpTools: string[];
  jsonContracts: string[];
  errorContracts: string[];
  status: TodosCliMcpParityStatus;
  intentionalGaps?: TodosCliMcpParityGap[];
  gapReason?: string;
  example: {
    cli: string;
    mcpTool?: string;
  };
}

export interface TodosCliMcpParityGap {
  cliCommand: string;
  reason: string;
}

export interface TodosCliMcpParityManifest {
  schemaVersion: 1;
  generatedAt: string;
  package: TodosCliMcpParityPackageSource;
  localOnly: true;
  noNetworkRequired: true;
  parity: TodosCliMcpParityEntry[];
}

function source(version: string): TodosCliMcpParityPackageSource {
  return {
    packageName: "@hasna/todos",
    repository: "hasna/todos",
    version,
  };
}

export const TODOS_CLI_MCP_PARITY: TodosCliMcpParityEntry[] = [
  {
    domain: "tasks",
    cliCommands: [
      "todos add",
      "todos list",
      "todos show",
      "todos update",
      "todos start",
      "todos done",
      "todos fail",
      "todos approve",
      "todos lock",
      "todos unlock",
      "todos delete",
      "todos bulk",
      "todos next",
      "todos claim",
      "todos active",
      "todos stale",
      "todos mine",
      "todos blocked",
      "todos ready",
    ],
    mcpTools: [
      "create_task",
      "list_tasks",
      "get_task",
      "update_task",
      "start_task",
      "complete_task",
      "fail_task",
      "approve_task",
      "lock_task",
      "unlock_task",
      "check_task_lock",
      "delete_task",
      "bulk_update_tasks",
      "bulk_create_tasks",
      "get_next_task",
      "claim_next_task",
      "get_active_work",
      "get_stale_tasks",
      "get_my_tasks",
      "get_blocked_tasks",
      "get_review_queue",
    ],
    jsonContracts: ["task", "status_summary", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    intentionalGaps: [],
    example: {
      cli: "todos add \"Fix flaky parser\" --priority high --json",
      mcpTool: "create_task",
    },
  },
  {
    domain: "local-fields",
    cliCommands: [
      "todos fields show",
      "todos fields set",
      "todos fields query",
    ],
    mcpTools: [
      "get_task_fields",
      "set_task_fields",
      "query_tasks_by_fields",
    ],
    jsonContracts: ["local_task_fields", "task", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    intentionalGaps: [],
    example: {
      cli: "todos fields set 1234abcd --labels bug,cli --severity s1 --field component=parser --json",
      mcpTool: "set_task_fields",
    },
  },
  {
    domain: "dedupe",
    cliCommands: [
      "todos dedupe scan",
      "todos dedupe merge",
    ],
    mcpTools: [
      "find_duplicate_tasks",
      "merge_duplicate_task",
    ],
    jsonContracts: ["duplicate_task_candidate", "task_merge_result", "task", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    intentionalGaps: [],
    example: {
      cli: "todos dedupe scan --threshold 0.8 --json",
      mcpTool: "find_duplicate_tasks",
    },
  },
  {
    domain: "verification-providers",
    cliCommands: [
      "todos verify-providers set",
      "todos verify-providers list",
      "todos verify-providers capabilities",
      "todos verify-providers run",
      "todos verify-providers remove",
    ],
    mcpTools: [
      "set_verification_provider",
      "list_verification_providers",
      "get_verification_provider_capabilities",
      "run_verification_provider",
      "remove_verification_provider",
    ],
    jsonContracts: ["verification_provider", "verification_provider_result", "task", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    intentionalGaps: [],
    example: {
      cli: "todos verify-providers run local --task 1234abcd --json",
      mcpTool: "run_verification_provider",
    },
  },
  {
    domain: "projects",
    cliCommands: [
      "todos projects",
      "todos project-bootstrap",
      "todos project-rename",
      "todos projects-path set",
      "todos projects-path list",
      "todos projects-path remove",
    ],
    mcpTools: [
      "create_project",
      "list_projects",
      "get_project",
      "update_project",
      "delete_project",
      "create_task_list",
      "list_task_lists",
      "get_task_list",
      "update_task_list",
      "delete_task_list",
      "get_focus",
      "set_focus",
      "unfocus",
      "bootstrap_project",
    ],
    jsonContracts: ["project", "task_list", "project_bootstrap_result", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos projects --add . --name todos --json",
      mcpTool: "create_project",
    },
  },
  {
    domain: "plans",
    cliCommands: [
      "todos plans",
      "todos plans --add",
      "todos plans --show",
      "todos plans --complete",
      "todos plans --delete",
    ],
    mcpTools: [
      "create_plan",
      "list_plans",
      "get_plan",
      "update_plan",
      "delete_plan",
    ],
    jsonContracts: ["task", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos plans --add \"Release 1.0\" --json",
      mcpTool: "create_plan",
    },
  },
  {
    domain: "templates",
    cliCommands: [
      "todos template-library",
      "todos template-init",
      "todos template-preview",
      "todos templates --use",
      "todos template-export",
      "todos template-import",
      "todos template-history",
    ],
    mcpTools: [
      "list_template_library",
      "write_template_library",
      "init_templates",
      "preview_template",
      "create_task_from_template",
      "create_template",
      "list_templates",
      "update_template",
      "delete_template",
      "export_template",
      "import_template",
      "template_history",
    ],
    jsonContracts: ["template", "task", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos template-library --json",
      mcpTool: "list_template_library",
    },
  },
  {
    domain: "workspace-trust",
    cliCommands: [
      "todos trust list",
      "todos trust status",
      "todos trust add",
      "todos trust remove",
      "todos trust check",
    ],
    mcpTools: [
      "list_workspace_trust_profiles",
      "get_workspace_trust",
      "set_workspace_trust",
      "remove_workspace_trust",
      "check_workspace_permission",
    ],
    jsonContracts: ["structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos trust check . --command \"bun test\" --write src/index.ts --json",
      mcpTool: "check_workspace_permission",
    },
  },
  {
    domain: "secret-safety",
    cliCommands: [
      "todos redaction status",
      "todos redaction add",
      "todos redaction scan",
    ],
    mcpTools: [
      "get_secret_safety",
      "set_secret_safety",
      "scan_secret_text",
    ],
    jsonContracts: ["structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos redaction scan \"TOKEN=value\" --json",
      mcpTool: "scan_secret_text",
    },
  },
  {
    domain: "runner-sandbox",
    cliCommands: [
      "todos sandbox list",
      "todos sandbox set",
      "todos sandbox remove",
      "todos sandbox check",
      "todos sandbox explain",
      "todos runs command --sandbox",
    ],
    mcpTools: [
      "list_runner_sandbox_profiles",
      "set_runner_sandbox_profile",
      "remove_runner_sandbox_profile",
      "check_runner_sandbox",
      "explain_runner_sandbox",
    ],
    jsonContracts: ["structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos sandbox check default --command \"bun test\" --write src/index.ts --json",
      mcpTool: "check_runner_sandbox",
    },
  },
  {
    domain: "extensions",
    cliCommands: [
      "todos extensions list",
      "todos extensions inspect",
      "todos extensions install",
      "todos extensions verify",
      "todos extensions remove",
    ],
    mcpTools: [
      "list_local_extensions",
      "inspect_local_extension",
      "install_local_extension",
      "remove_local_extension",
    ],
    jsonContracts: ["structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos extensions install ./todos.extension.json --trust --json",
      mcpTool: "install_local_extension",
    },
  },
  {
    domain: "workflow-prompts",
    cliCommands: [
      "todos workflows list",
      "todos workflows show",
      "todos workflows export",
    ],
    mcpTools: [],
    jsonContracts: ["structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "intentional-gap",
    intentionalGaps: [{
      cliCommand: "todos workflows list",
      reason: "Workflow prompts are exposed through native MCP prompt/resource registrations, not MCP tools, so CLI parity is documented as prompt/resource parity instead of a tool mapping.",
    }],
    gapReason: "Workflow prompts are first-class MCP prompts and resources rather than callable tools, so the parity manifest records the CLI surface and documents the intentional tool gap.",
    example: {
      cli: "todos workflows show goal_planning --objective \"Ship release\" --json",
    },
  },
  {
    domain: "policy-packs",
    cliCommands: [
      "todos policies list",
      "todos policies set",
      "todos policies remove",
      "todos policies validate",
      "todos policies explain",
    ],
    mcpTools: [
      "list_policy_packs",
      "set_policy_pack",
      "remove_policy_pack",
      "validate_policy_pack",
      "explain_policy_pack",
    ],
    jsonContracts: ["structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos policies validate release 1234abcd --json",
      mcpTool: "validate_policy_pack",
    },
  },
  {
    domain: "approval-gates",
    cliCommands: [
      "todos approvals require",
      "todos approvals approve",
      "todos approvals reject",
      "todos approvals expire",
      "todos approvals check",
      "todos approvals list",
    ],
    mcpTools: [
      "require_approval_gate",
      "approve_approval_gate",
      "reject_approval_gate",
      "expire_approval_gate",
      "check_approval_gate",
      "list_approval_gates",
    ],
    jsonContracts: ["checkpoint", "audit_history", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos approvals check 1234abcd deploy --json",
      mcpTool: "check_approval_gate",
    },
  },
  {
    domain: "runs",
    cliCommands: [
      "todos runs start",
      "todos runs list",
      "todos runs show",
      "todos runs event",
      "todos runs command",
      "todos runs file",
      "todos runs artifact",
      "todos runs artifact-verify",
      "todos runs finish",
      "todos runs simulate",
    ],
    mcpTools: [
      "start_task_run",
      "list_task_runs",
      "get_task_run_ledger",
      "add_task_run_event",
      "add_task_run_command",
      "add_task_run_file",
      "add_task_run_artifact",
      "verify_task_run_artifacts",
      "finish_task_run",
      "simulate_agent_replay",
    ],
    jsonContracts: ["checkpoint", "local_bridge_bundle", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos runs simulate replay.json --json",
      mcpTool: "simulate_agent_replay",
    },
  },
  {
    domain: "agent-runs",
    cliCommands: [
      "todos agent-runs adapter-set",
      "todos agent-runs adapters",
      "todos agent-runs adapter-remove",
      "todos agent-runs queue",
      "todos agent-runs list",
      "todos agent-runs run-next",
      "todos agent-runs cancel",
      "todos agent-runs retry",
    ],
    mcpTools: [
      "set_agent_run_adapter",
      "list_agent_run_adapters",
      "remove_agent_run_adapter",
      "queue_agent_run",
      "list_agent_run_queue",
      "run_next_agent_dispatch",
      "cancel_agent_run_dispatch",
      "retry_agent_run_dispatch",
    ],
    jsonContracts: ["checkpoint", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos agent-runs queue 1234abcd --adapter codex --json",
      mcpTool: "queue_agent_run",
    },
  },
  {
    domain: "calendar",
    cliCommands: [
      "todos calendar list",
      "todos calendar add",
      "todos calendar export",
      "todos calendar import",
    ],
    mcpTools: [
      "create_calendar_item",
      "list_calendar_events",
      "export_calendar_ics",
      "import_calendar_ics",
    ],
    jsonContracts: ["calendar_event", "ics_export_result", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos calendar export --redact --json",
      mcpTool: "export_calendar_ics",
    },
  },
  {
    domain: "kanban-boards",
    cliCommands: [
      "todos board create",
      "todos board list",
      "todos board show",
      "todos board tui",
      "todos board move",
      "todos board export",
      "todos board import",
      "todos board delete",
    ],
    mcpTools: [
      "create_board",
      "list_boards",
      "get_board_snapshot",
      "move_board_card",
    ],
    jsonContracts: ["task_board", "board_snapshot", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos board show local-flow --json",
      mcpTool: "get_board_snapshot",
    },
  },
  {
    domain: "time-tracking",
    cliCommands: [
      "todos time log",
      "todos time start",
      "todos time pause",
      "todos time resume",
      "todos time stop",
      "todos time list",
      "todos time idle",
      "todos time report",
    ],
    mcpTools: [
      "log_time",
      "start_focus_session",
      "pause_focus_session",
      "resume_focus_session",
      "stop_focus_session",
      "list_focus_sessions",
      "get_idle_focus_prompts",
      "get_time_report",
    ],
    jsonContracts: ["focus_session", "time_report_entry", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos time start 1234abcd --agent codex --idle-after 30 --json",
      mcpTool: "start_focus_session",
    },
  },
  {
    domain: "handoffs",
    cliCommands: [
      "todos handoff",
      "todos handoff --create",
      "todos handoff --read",
      "todos handoff --ack",
      "todos handoff --recover",
    ],
    mcpTools: [
      "create_handoff",
      "list_handoffs",
      "read_handoff",
      "acknowledge_handoff",
      "recover_stale_session_handoff",
      "get_latest_handoff",
    ],
    jsonContracts: ["handoff", "task", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    intentionalGaps: [],
    example: {
      cli: "todos handoff --create --agent codex --summary \"Parser work ready for review\" --tasks 1234abcd --files src/parser.ts --runs run123 --json",
      mcpTool: "create_handoff",
    },
  },
  {
    domain: "local-event-hooks",
    cliCommands: [
      "todos event-hooks list",
      "todos event-hooks set",
      "todos event-hooks remove",
      "todos event-hooks test",
    ],
    mcpTools: [
      "list_local_event_hooks",
      "set_local_event_hook",
      "remove_local_event_hook",
      "test_local_event_hook",
    ],
    jsonContracts: ["local_event_hook", "local_event_hook_delivery", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos event-hooks set audit --event task.completed --target file --file .todos/events.jsonl --json",
      mcpTool: "set_local_event_hook",
    },
  },
  {
    domain: "encryption",
    cliCommands: [
      "todos encryption list",
      "todos encryption set",
      "todos encryption status",
      "todos encryption remove",
      "todos encryption test",
      "todos export --format bridge --encrypt",
      "todos bridge-import --decrypt",
    ],
    mcpTools: [
      "list_encryption_profiles",
      "set_encryption_profile",
      "remove_encryption_profile",
      "get_encryption_status",
      "encrypt_local_value",
      "decrypt_local_value",
    ],
    jsonContracts: ["local_encryption_profile", "local_encryption_envelope", "encrypted_local_bridge_bundle"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos export --format bridge --encrypt --output todos-bridge.enc.json",
      mcpTool: "set_encryption_profile",
    },
  },
  {
    domain: "comments",
    cliCommands: ["todos comment", "todos log", "todos timeline"],
    mcpTools: ["add_comment", "create_comment", "list_comments", "get_comments", "get_activity_timeline", "update_comment", "delete_comment"],
    jsonContracts: ["comment", "audit_history", "local_activity_timeline_entry", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos comment 1234abcd \"Verified locally\" --json",
      mcpTool: "add_comment",
    },
  },
  {
    domain: "search",
    cliCommands: [
      "todos search",
      "todos views save",
      "todos views list",
      "todos views run",
      "todos views delete",
      "todos status",
      "todos recap",
      "todos standup",
      "todos report",
      "todos today",
      "todos week",
      "todos priorities",
      "todos context",
    ],
    mcpTools: [
      "search_tasks",
      "save_search_view",
      "list_search_views",
      "run_search_view",
      "delete_search_view",
      "get_status",
      "standup",
      "get_task_stats",
      "get_context",
      "task_context",
      "get_task_graph",
      "get_recent_activity",
    ],
    jsonContracts: ["task", "saved_search_view", "saved_search_run_result", "status_summary", "audit_history", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos search parser --status pending --json",
      mcpTool: "search_tasks",
    },
  },
  {
    domain: "context-packs",
    cliCommands: ["todos context-pack"],
    mcpTools: ["build_agent_context_pack"],
    jsonContracts: ["context_pack", "task", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos context-pack 1234abcd --profile codex --format markdown",
      mcpTool: "build_agent_context_pack",
    },
  },
  {
    domain: "environment-snapshots",
    cliCommands: ["todos env-snapshot"],
    mcpTools: ["capture_environment_snapshot", "compare_environment_snapshots"],
    jsonContracts: ["environment_snapshot", "environment_snapshot_comparison", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos env-snapshot capture --task 1234abcd --json",
      mcpTool: "capture_environment_snapshot",
    },
  },
  {
    domain: "imports",
    cliCommands: [
      "todos import",
      "todos template-import",
      "todos inbox add",
      "todos inbox git",
      "todos bridge-import",
    ],
    mcpTools: [
      "import_template",
      "create_inbox_item",
      "list_inbox_items",
      "get_inbox_item",
    ],
    jsonContracts: [
      "template",
      "task",
      "local_bridge_bundle",
      "local_bridge_import_result",
      "structured_error",
      "api_error",
    ],
    errorContracts: ["structured_error", "api_error"],
    status: "intentional-gap",
    gapReason: "Local bridge import can mutate many local records, so the CLI keeps it explicit with dry-run by default. MCP callers can still create inbox items and templates through smaller scoped tools.",
    example: {
      cli: "todos bridge-import todos-bridge.json --apply --json",
    },
  },
  {
    domain: "exports",
    cliCommands: [
      "todos export",
      "todos template-export",
      "todos trace",
      "todos record-verification",
    ],
    mcpTools: [
      "export_template",
      "get_task_traceability",
      "get_task_commits",
      "get_task_git_refs",
      "get_task_run_ledger",
      "add_task_verification",
    ],
    jsonContracts: ["template", "local_bridge_bundle", "audit_history", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "intentional-gap",
    gapReason: "Whole-database bridge export is CLI-only because it writes local files and is intended for explicit operator use. MCP tools expose scoped traceability and template exports without file writes.",
    example: {
      cli: "todos export --format bridge --output todos-bridge.json --json",
      mcpTool: "get_task_traceability",
    },
  },
];

function assertKnownMcpTools(entries: TodosCliMcpParityEntry[]): void {
  const knownTools = new Set(getMcpToolNames({ profile: "full" }));
  const missing = entries.flatMap((entry) => (
    entry.mcpTools.filter((tool) => !knownTools.has(tool)).map((tool) => `${entry.domain}:${tool}`)
  ));
  if (missing.length > 0) {
    throw new Error(`Unknown MCP tools in CLI/MCP parity manifest: ${missing.join(", ")}`);
  }
}

export function createCliMcpParityManifest(
  options: CreateCliMcpParityManifestOptions = {},
): TodosCliMcpParityManifest {
  assertKnownMcpTools(TODOS_CLI_MCP_PARITY);
  const version = options.version ?? getPackageVersion(import.meta.url);
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    package: source(version),
    localOnly: true,
    noNetworkRequired: true,
    parity: TODOS_CLI_MCP_PARITY,
  };
}

export const TODOS_CLI_MCP_PARITY_MANIFEST = createCliMcpParityManifest({
  generatedAt: "1970-01-01T00:00:00.000Z",
});
