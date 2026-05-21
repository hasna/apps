import { getPackageVersion } from "./lib/package-version.js";
import { getMcpToolNames } from "./mcp.js";

export type TodosCliMcpParityDomain =
  | "tasks"
  | "projects"
  | "plans"
  | "workspace-trust"
  | "runner-sandbox"
  | "policy-packs"
  | "approval-gates"
  | "local-event-hooks"
  | "agent-runs"
  | "runs"
  | "comments"
  | "search"
  | "context-packs"
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
    ],
    jsonContracts: ["checkpoint", "local_bridge_bundle", "structured_error", "api_error"],
    errorContracts: ["structured_error", "api_error"],
    status: "matched",
    example: {
      cli: "todos runs start 1234abcd --agent codex --json",
      mcpTool: "start_task_run",
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
    domain: "comments",
    cliCommands: ["todos comment", "todos log"],
    mcpTools: ["add_comment", "create_comment", "list_comments", "get_comments", "update_comment", "delete_comment"],
    jsonContracts: ["comment", "audit_history", "structured_error", "api_error"],
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
      "get_status",
      "standup",
      "get_task_stats",
      "get_context",
      "task_context",
      "get_task_graph",
      "get_recent_activity",
    ],
    jsonContracts: ["task", "status_summary", "audit_history", "structured_error", "api_error"],
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
