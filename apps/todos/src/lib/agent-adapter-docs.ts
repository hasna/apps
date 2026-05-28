/**
 * First-party local adapter docs for Codex, Claude Code, and Takumi.
 * Local-only reference — no hosted API required.
 */

import { GOAL_COMMAND_RECIPES } from "./goal-workflow.js";

export const ADAPTER_DOCS_SCHEMA_VERSION = "todos.agent_adapter_docs.v1";

export const AGENT_ADAPTER_HOSTS = ["codex", "claude-code", "takumi"] as const;
export type AgentAdapterHost = (typeof AGENT_ADAPTER_HOSTS)[number];

export interface AdapterWorkflowStep {
  step: number;
  title: string;
  cli?: string;
  mcp?: string;
  notes?: string;
}

export interface AdapterFailureMode {
  symptom: string;
  cause: string;
  recovery: string;
}

export interface AgentAdapterDoc {
  schema_version: typeof ADAPTER_DOCS_SCHEMA_VERSION;
  host: AgentAdapterHost;
  display_name: string;
  install: {
    bun: string;
    npm?: string;
    verify: string;
  };
  mcp: {
    register_cli: string;
    unregister_cli: string;
    config_path: string;
    recommended_profile: string;
    env: string[];
  };
  goal_commands: typeof GOAL_COMMAND_RECIPES;
  workflow: AdapterWorkflowStep[];
  task_contract: {
    claim: string;
    progress: string;
    complete: string;
    fail: string;
    evidence_fields: string[];
  };
  verification: {
    run: string;
    attach: string;
    mcp: string;
  };
  handoff: {
    goal: string;
    session: string;
    mcp: string;
  };
  failure_modes: AdapterFailureMode[];
  examples: Array<{ title: string; command: string }>;
}

const SHARED_TASK_CONTRACT = {
  claim: "todos claim <agent-name>  # atomic: find + lock + start best pending task",
  progress: 'todos log-progress <task-id> "Investigating..." [--pct 50]',
  complete: "todos done <task-id> --commit-hash <hash> --notes \"All tests pass\"",
  fail: 'todos fail <task-id> --reason "..." [--retry]',
  evidence_fields: ["commit_hash", "notes", "attach_ids", "verification_record_id"],
} as const;

const SHARED_VERIFICATION = {
  run: "todos verify run --provider shell --task <id>",
  attach: "todos verify attach --task <id> --path ./test-output.log",
  mcp: "run_verification",
} as const;

const SHARED_HANDOFF = {
  goal: "todos goal handoff <plan-name> --format md",
  session: "todos handoff --create --agent <name> --summary \"...\"",
  mcp: "format_goal_handoff",
} as const;

const SHARED_WORKFLOW: AdapterWorkflowStep[] = [
  { step: 1, title: "Install @hasna/todos", cli: "bun install -g @hasna/todos", notes: "Use bun, not npm, for @hasna packages" },
  { step: 2, title: "Register MCP server", cli: "todos mcp --register <host>", mcp: "bootstrap" },
  { step: 3, title: "Register agent identity", cli: "todos init <agent-name>", mcp: "register_agent" },
  { step: 4, title: "Claim work", cli: "todos claim <agent-name>", mcp: "claim_next_task" },
  { step: 5, title: "Log progress", cli: "todos log-progress <id> \"...\"", mcp: "add_comment" },
  { step: 6, title: "Attach verification evidence", cli: "todos verify run --task <id>", mcp: "run_verification" },
  { step: 7, title: "Complete with evidence", cli: "todos done <id> --commit-hash HEAD", mcp: "complete_task" },
];

export const AGENT_ADAPTER_DOCS: Record<AgentAdapterHost, AgentAdapterDoc> = {
  codex: {
    schema_version: ADAPTER_DOCS_SCHEMA_VERSION,
    host: "codex",
    display_name: "OpenAI Codex CLI",
    install: {
      bun: "bun install -g @hasna/todos",
      npm: "npm install -g @hasna/todos",
      verify: "todos --version && which todos-mcp",
    },
    mcp: {
      register_cli: "todos mcp --register codex",
      unregister_cli: "todos mcp --unregister codex",
      config_path: "~/.codex/config.toml",
      recommended_profile: "minimal",
      env: ["TODOS_PROFILE=minimal", "TODOS_DB_PATH=.todos/todos.db"],
    },
    goal_commands: GOAL_COMMAND_RECIPES,
    workflow: SHARED_WORKFLOW.map((s) =>
      s.step === 2 ? { ...s, cli: "todos mcp --register codex" } : s,
    ),
    task_contract: { ...SHARED_TASK_CONTRACT },
    verification: { ...SHARED_VERIFICATION },
    handoff: { ...SHARED_HANDOFF },
    failure_modes: [
      {
        symptom: "MCP tools not visible in Codex",
        cause: "Missing [mcp_servers.todos] block in ~/.codex/config.toml",
        recovery: "Run `todos mcp --register codex` and restart Codex",
      },
      {
        symptom: "VersionConflictError on complete_task",
        cause: "Passed stale version to update_task instead of complete_task",
        recovery: "Use `complete_task` or CLI `todos done` — do not pass version manually",
      },
      {
        symptom: "No claimable tasks",
        cause: "Queue empty, dependencies blocking, or task locked by another agent",
        recovery: "Run `todos status --explain-blocked` or MCP get_status with explain_blocked",
      },
    ],
    examples: [
      { title: "Session start", command: "todos claim codex-agent && todos status" },
      { title: "Goal plan", command: 'todos goal create "Ship feature" --step "Implement" --step "Test"' },
      { title: "Queue agent run", command: "todos runs queue --adapter codex --task <id>" },
    ],
  },

  "claude-code": {
    schema_version: ADAPTER_DOCS_SCHEMA_VERSION,
    host: "claude-code",
    display_name: "Claude Code",
    install: {
      bun: "bun install -g @hasna/todos",
      verify: "todos --version && claude mcp list | grep todos",
    },
    mcp: {
      register_cli: "todos mcp --register claude",
      unregister_cli: "todos mcp --unregister claude",
      config_path: "Managed via `claude mcp` (project or user scope)",
      recommended_profile: "minimal",
      env: ["TODOS_PROFILE=minimal", "TODOS_AUTO_PROJECT=true"],
    },
    goal_commands: GOAL_COMMAND_RECIPES,
    workflow: SHARED_WORKFLOW.map((s) =>
      s.step === 2 ? { ...s, cli: "todos mcp --register claude" } : s,
    ),
    task_contract: { ...SHARED_TASK_CONTRACT },
    verification: { ...SHARED_VERIFICATION },
    handoff: { ...SHARED_HANDOFF },
    failure_modes: [
      {
        symptom: "claude mcp add fails",
        cause: "Claude Code CLI not installed or not on PATH",
        recovery: "Install Claude Code, then run the printed `claude mcp add` command manually",
      },
      {
        symptom: "LockError on start",
        cause: "Task locked by another agent within 30-minute window",
        recovery: "Use `todos stale` to find abandoned locks or wait for lock expiry",
      },
      {
        symptom: "CompletionGuardError",
        cause: "Required checklist or approval gate not satisfied",
        recovery: "Run `todos approvals list --task <id>` and complete gates first",
      },
    ],
    examples: [
      { title: "Global MCP registration", command: "todos mcp --register claude --global" },
      { title: "Execute goal step", command: "todos goal execute my-plan --agent claude-agent" },
      { title: "Link git traceability", command: "todos trace link <task-id> --branch feature/x --commit abc123" },
    ],
  },

  takumi: {
    schema_version: ADAPTER_DOCS_SCHEMA_VERSION,
    host: "takumi",
    display_name: "Takumi",
    install: {
      bun: "bun install -g @hasna/todos",
      verify: "todos --version && takumi mcp list 2>/dev/null | grep todos || true",
    },
    mcp: {
      register_cli: "todos mcp --register takumi",
      unregister_cli: "todos mcp --unregister takumi",
      config_path: "~/.takumi.json (project-scoped mcpServers) or local Takumi MCP config",
      recommended_profile: "minimal",
      env: ["TODOS_PROFILE=minimal", "TODOS_DB_PATH=.todos/todos.db"],
    },
    goal_commands: GOAL_COMMAND_RECIPES,
    workflow: SHARED_WORKFLOW.map((s) =>
      s.step === 2 ? { ...s, cli: "todos mcp --register takumi" } : s,
    ),
    task_contract: { ...SHARED_TASK_CONTRACT },
    verification: { ...SHARED_VERIFICATION },
    handoff: { ...SHARED_HANDOFF },
    failure_modes: [
      {
        symptom: "todos MCP missing in Takumi",
        cause: "MCP server not added to project or user scope",
        recovery: "Run `takumi mcp add --scope project todos -- todos-mcp` or `todos mcp --register takumi`",
      },
      {
        symptom: "Wrong database / empty task list",
        cause: "TODOS_DB_PATH not set; cwd differs from git project root",
        recovery: "Set TODOS_DB_PATH=.todos/todos.db or run `todos bootstrap` in project root",
      },
      {
        symptom: "Agent run queue stuck",
        cause: "Run claimed but never completed/failed",
        recovery: "Run `todos runs list --status running` then complete or fail the run",
      },
    ],
    examples: [
      { title: "Manual Takumi MCP add", command: "takumi mcp add --scope project todos -- todos-mcp" },
      { title: "Dispatch to tmux pane", command: "todos dispatch agents:0 --tasks <id>" },
      { title: "Handoff on session end", command: "todos goal handoff release-v2 --format md --agent takumi-agent" },
    ],
  },
};

export function normalizeAdapterHost(input: string): AgentAdapterHost | null {
  const n = input.toLowerCase().replace(/_/g, "-");
  if (n === "claude" || n === "claude-code" || n === "claude_code") return "claude-code";
  if (n === "codex") return "codex";
  if (n === "takumi") return "takumi";
  return null;
}

export function getAgentAdapterDoc(host: string): AgentAdapterDoc | null {
  const normalized = normalizeAdapterHost(host);
  return normalized ? AGENT_ADAPTER_DOCS[normalized] : null;
}

export function listAgentAdapterDocs(): AgentAdapterDoc[] {
  return AGENT_ADAPTER_HOSTS.map((h) => AGENT_ADAPTER_DOCS[h]);
}

export function validateAdapterDocs(): string[] {
  const issues: string[] = [];

  for (const host of AGENT_ADAPTER_HOSTS) {
    const doc = AGENT_ADAPTER_DOCS[host];
    if (doc.schema_version !== ADAPTER_DOCS_SCHEMA_VERSION) {
      issues.push(`${host}: schema_version mismatch`);
    }
    if (!doc.install.bun.includes("bun install")) {
      issues.push(`${host}: install.bun must include bun install command`);
    }
    if (!doc.mcp.register_cli.startsWith("todos mcp")) {
      issues.push(`${host}: mcp.register_cli must use todos mcp`);
    }
    if (doc.goal_commands.length < 4) {
      issues.push(`${host}: expected at least 4 goal command recipes`);
    }
    if (doc.workflow.length < 5) {
      issues.push(`${host}: expected at least 5 workflow steps`);
    }
    if (doc.failure_modes.length < 2) {
      issues.push(`${host}: expected at least 2 failure modes`);
    }
    for (const ex of doc.examples) {
      if (!ex.command.trim()) issues.push(`${host}: empty example command`);
    }
  }

  return issues;
}

export function renderAdapterDocMarkdown(host: string): string | null {
  const doc = getAgentAdapterDoc(host);
  if (!doc) return null;

  const lines: string[] = [
    `# ${doc.display_name} — @hasna/todos Local Adapter`,
    "",
    `Schema: \`${doc.schema_version}\` · Host: \`${doc.host}\``,
    "",
    "## Install",
    "",
    "```bash",
    doc.install.bun,
    doc.install.verify,
    "```",
    "",
    "## MCP Setup",
    "",
    `- **Register:** \`${doc.mcp.register_cli}\``,
    `- **Unregister:** \`${doc.mcp.unregister_cli}\``,
    `- **Config:** ${doc.mcp.config_path}`,
    `- **Profile:** \`TODOS_PROFILE=${doc.mcp.recommended_profile}\``,
    "",
    "Environment:",
    ...doc.mcp.env.map((e) => `- \`${e}\``),
    "",
    "## /goal Commands",
    "",
    "| Command | Description | CLI equivalent |",
    "|---------|-------------|----------------|",
    ...doc.goal_commands.map(
      (r) => `| \`${r.command}\` | ${r.description} | \`${r.equivalent_cli}\` |`,
    ),
    "",
    "## Workflow",
    "",
    ...doc.workflow.flatMap((w) => [
      `${w.step}. **${w.title}**`,
      w.cli ? `   - CLI: \`${w.cli}\`` : "",
      w.mcp ? `   - MCP: \`${w.mcp}\`` : "",
      w.notes ? `   - ${w.notes}` : "",
      "",
    ].filter(Boolean)),
    "## Task Contract",
    "",
    `- Claim: \`${doc.task_contract.claim}\``,
    `- Progress: \`${doc.task_contract.progress}\``,
    `- Complete: \`${doc.task_contract.complete}\``,
    `- Fail: \`${doc.task_contract.fail}\``,
    `- Evidence: ${doc.task_contract.evidence_fields.map((f) => `\`${f}\``).join(", ")}`,
    "",
    "## Verification Evidence",
    "",
    `- Run: \`${doc.verification.run}\``,
    `- Attach: \`${doc.verification.attach}\``,
    `- MCP: \`${doc.verification.mcp}\``,
    "",
    "## Handoff Packets",
    "",
    `- Goal handoff: \`${doc.handoff.goal}\``,
    `- Session handoff: \`${doc.handoff.session}\``,
    `- MCP: \`${doc.handoff.mcp}\``,
    "",
    "## Failure Modes",
    "",
    ...doc.failure_modes.flatMap((f) => [
      `### ${f.symptom}`,
      `- **Cause:** ${f.cause}`,
      `- **Recovery:** ${f.recovery}`,
      "",
    ]),
    "## Examples",
    "",
    ...doc.examples.flatMap((e) => [`### ${e.title}`, "", "```bash", e.command, "```", ""]),
  ];

  return lines.join("\n").trimEnd() + "\n";
}

export function renderAllAdapterDocsMarkdown(): string {
  return AGENT_ADAPTER_HOSTS.map((h) => renderAdapterDocMarkdown(h)!)
    .join("\n---\n\n")
    .trimEnd() + "\n";
}

/** Stable fingerprint for snapshot tests — changes when doc content changes. */
export function getAdapterDocsFingerprint(): string {
  const payload = JSON.stringify(
    AGENT_ADAPTER_HOSTS.map((h) => {
      const d = AGENT_ADAPTER_DOCS[h];
      return {
        host: d.host,
        install: d.install,
        mcp: d.mcp,
        workflow_steps: d.workflow.length,
        failure_modes: d.failure_modes.length,
        examples: d.examples.length,
        goal_commands: d.goal_commands.length,
      };
    }),
  );
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash * 31 + payload.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
