/**
 * CLI ↔ MCP parity manifest — documents matching operations and intentional gaps.
 * Local-only; no network required to validate.
 */

export const PARITY_SCHEMA_VERSION = "todos.cli_mcp_parity.v1";

export type ParityDomain =
  | "task"
  | "project"
  | "plan"
  | "agent"
  | "run"
  | "comment"
  | "search"
  | "import_export"
  | "security"
  | "workflow"
  | "meta";

export interface ParityEntry {
  domain: ParityDomain;
  operation: string;
  cli: string | null;
  mcp: string | null;
  gap?: string;
  notes?: string;
}

/** Stable error contract shape for CLI/MCP surfaces. */
export interface ErrorContract {
  message: string;
  code?: string;
  is_error?: boolean;
}

export function normalizeErrorContract(error: unknown): ErrorContract {
  if (error instanceof Error) {
    return { message: error.message, code: error.name };
  }
  return { message: String(error) };
}

export const CLI_MCP_PARITY_MANIFEST: ParityEntry[] = [
  // Tasks
  { domain: "task", operation: "create", cli: "add", mcp: "create_task" },
  { domain: "task", operation: "list", cli: "list", mcp: "list_tasks" },
  { domain: "task", operation: "show", cli: "show", mcp: "get_task" },
  { domain: "task", operation: "update", cli: "edit", mcp: "update_task" },
  { domain: "task", operation: "delete", cli: "delete", mcp: "delete_task" },
  { domain: "task", operation: "start", cli: "start", mcp: "start_task" },
  { domain: "task", operation: "complete", cli: "done", mcp: "complete_task" },
  { domain: "task", operation: "fail", cli: "fail", mcp: "fail_task" },
  { domain: "task", operation: "claim", cli: "claim", mcp: "claim_next_task" },
  { domain: "task", operation: "next", cli: "next", mcp: "get_next_task" },
  { domain: "task", operation: "lock", cli: null, mcp: "lock_task", gap: "CLI uses start/claim implicit locking" },
  { domain: "task", operation: "approve", cli: "approve", mcp: "approve_task" },
  { domain: "task", operation: "link_commit", cli: "link-commit", mcp: "link_task_to_commit" },
  { domain: "task", operation: "git_trace", cli: "trace link", mcp: "link_task_git_trace" },
  { domain: "task", operation: "traceability", cli: "trace show", mcp: "get_task_traceability" },
  { domain: "task", operation: "dedupe_find", cli: "dedupe find", mcp: "find_duplicate_tasks" },
  { domain: "task", operation: "dedupe_merge", cli: "dedupe merge", mcp: "merge_tasks" },
  { domain: "task", operation: "labels", cli: "labels assign", mcp: "assign_label_to_task" },
  { domain: "task", operation: "custom_fields", cli: "fields set", mcp: "set_task_custom_field" },
  { domain: "task", operation: "fields_export", cli: "fields show", mcp: "get_task_fields" },

  // Projects & bootstrap
  { domain: "project", operation: "bootstrap", cli: "bootstrap", mcp: "bootstrap_workspace" },
  { domain: "project", operation: "discover", cli: "discover", mcp: "discover_workspace" },
  { domain: "project", operation: "create", cli: "project add", mcp: "create_project" },
  { domain: "project", operation: "list", cli: "project list", mcp: "list_projects" },

  // Plans
  { domain: "plan", operation: "create", cli: "plan add", mcp: "create_plan" },
  { domain: "plan", operation: "list", cli: "plan list", mcp: "list_plans" },
  { domain: "plan", operation: "approval_gates", cli: "approvals plan", mcp: "request_approval", notes: "plan_step gate type" },

  // Agent runs
  { domain: "run", operation: "queue", cli: "runs queue", mcp: "enqueue_agent_run" },
  { domain: "run", operation: "claim", cli: "runs claim", mcp: "claim_next_agent_run" },
  { domain: "workflow", operation: "agent_demo", cli: "demo run", mcp: "run_agent_workflow_demo" },
  { domain: "workflow", operation: "agent_demo_docs", cli: "demo docs", mcp: "get_agent_workflow_demo_docs" },
  { domain: "run", operation: "list", cli: "runs list", mcp: "list_agent_runs" },
  { domain: "run", operation: "complete", cli: "runs complete", mcp: "complete_agent_run" },
  { domain: "run", operation: "fail", cli: "runs fail", mcp: "fail_agent_run" },
  { domain: "run", operation: "cancel", cli: "runs cancel", mcp: "cancel_agent_run" },

  // Comments
  { domain: "comment", operation: "add", cli: "comment", mcp: "add_comment" },
  { domain: "comment", operation: "progress", cli: "log-progress", mcp: "add_comment", notes: "progress via type=progress" },

  // Search & status
  { domain: "search", operation: "search", cli: "search", mcp: "search_tasks" },
  { domain: "search", operation: "status", cli: "status", mcp: "get_status" },
  { domain: "search", operation: "active", cli: "active", mcp: "get_active_work" },
  { domain: "search", operation: "stale", cli: "stale", mcp: "get_stale_tasks" },

  // Import / export
  { domain: "import_export", operation: "export_md", cli: "md export", mcp: "export_todos_md" },
  { domain: "import_export", operation: "import_md", cli: "md import", mcp: "import_todos_md" },
  { domain: "import_export", operation: "sync_md", cli: "md sync", mcp: "sync_todos_md" },
  { domain: "import_export", operation: "artifacts", cli: "artifact add", mcp: "add_artifact" },

  // Security & coordination
  { domain: "security", operation: "sandbox", cli: "sandbox check", mcp: "check_sandbox_command" },
  { domain: "security", operation: "trust", cli: "trust check", mcp: "check_workspace_permission" },
  { domain: "security", operation: "verify", cli: "verify run", mcp: "run_verification" },
  { domain: "security", operation: "policy", cli: "policy check", mcp: "validate_task_policy_pack" },
  { domain: "workflow", operation: "lease_acquire", cli: "lease acquire", mcp: "acquire_task_lease" },
  { domain: "workflow", operation: "lease_steal", cli: "lease steal", mcp: "steal_task_lease" },
  { domain: "workflow", operation: "approval_request", cli: "approvals request", mcp: "request_approval" },
  { domain: "workflow", operation: "approval_pending", cli: "approvals pending", mcp: "list_pending_approvals" },
  { domain: "workflow", operation: "goal", cli: "goal create", mcp: "create_goal_workflow" },

  // Intentional CLI-only gaps
  { domain: "meta", operation: "tui", cli: "tui", mcp: null, gap: "Interactive TUI has no MCP equivalent" },
  { domain: "meta", operation: "serve", cli: "serve", mcp: null, gap: "Local HTTP server is CLI-only" },
  { domain: "meta", operation: "stream", cli: "stream", mcp: null, gap: "SSE stream is CLI/HTTP-only; use get_tasks_changed_since in MCP" },
  { domain: "meta", operation: "hook", cli: "hook install", mcp: null, gap: "Git hook installation is CLI-only" },
  { domain: "meta", operation: "parity_report", cli: "parity", mcp: "get_cli_mcp_parity" },
];

export interface ParityReport {
  schema_version: typeof PARITY_SCHEMA_VERSION;
  total: number;
  matched: number;
  cli_only: number;
  mcp_only: number;
  documented_gaps: number;
  by_domain: Record<string, { matched: number; gaps: number }>;
  entries: ParityEntry[];
}

export function getParityReport(): ParityReport {
  const byDomain: ParityReport["by_domain"] = {};
  let matched = 0;
  let cliOnly = 0;
  let mcpOnly = 0;
  let documentedGaps = 0;

  for (const entry of CLI_MCP_PARITY_MANIFEST) {
    byDomain[entry.domain] = byDomain[entry.domain] ?? { matched: 0, gaps: 0 };
    if (entry.cli && entry.mcp) {
      matched++;
      byDomain[entry.domain]!.matched++;
    } else if (entry.cli && !entry.mcp) {
      cliOnly++;
      documentedGaps++;
      byDomain[entry.domain]!.gaps++;
    } else if (!entry.cli && entry.mcp) {
      mcpOnly++;
    }
    if (entry.gap) documentedGaps++;
  }

  return {
    schema_version: PARITY_SCHEMA_VERSION,
    total: CLI_MCP_PARITY_MANIFEST.length,
    matched,
    cli_only: cliOnly,
    mcp_only: mcpOnly,
    documented_gaps: documentedGaps,
    by_domain: byDomain,
    entries: CLI_MCP_PARITY_MANIFEST,
  };
}

export function validateParityManifest(): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();

  for (const entry of CLI_MCP_PARITY_MANIFEST) {
    const key = `${entry.domain}:${entry.operation}`;
    if (seen.has(key)) issues.push(`Duplicate parity entry: ${key}`);
    seen.add(key);

    if (!entry.cli && !entry.mcp && !entry.gap) {
      issues.push(`Entry ${key} has no cli, mcp, or gap documentation`);
    }
    if ((entry.cli && !entry.mcp && !entry.gap) || (!entry.cli && entry.mcp && !entry.gap)) {
      // one-sided without gap is ok if notes explain - only flag if neither gap nor notes
      if (!entry.notes) {
        issues.push(`Entry ${key} is one-sided without gap or notes`);
      }
    }
  }

  return issues;
}

export function findParityForMcpTool(toolName: string): ParityEntry | undefined {
  return CLI_MCP_PARITY_MANIFEST.find((e) => e.mcp === toolName);
}

export function findParityForCliCommand(command: string): ParityEntry | undefined {
  return CLI_MCP_PARITY_MANIFEST.find((e) => e.cli === command);
}
