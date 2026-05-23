/**
 * Manpage-grade CLI reference — command groups, env vars, exit codes, JSON contracts.
 * Single source of truth for completions and help snapshots.
 */

export const CLI_REFERENCE_SCHEMA = "todos.cli_reference.v1";

export interface CliCommandRef {
  name: string;
  summary: string;
  usage?: string;
  flags?: string[];
  example?: string;
  json?: boolean;
}

export interface CliCommandGroup {
  name: string;
  description: string;
  commands: CliCommandRef[];
}

export interface ExitCodeRef {
  code: number;
  meaning: string;
}

export interface EnvVarRef {
  name: string;
  description: string;
  default?: string;
}

export const EXIT_CODES: ExitCodeRef[] = [
  { code: 0, meaning: "Success" },
  { code: 1, meaning: "General error (not found, validation, integrity failure)" },
  { code: 2, meaning: "Misuse of shell command / invalid arguments (commander)" },
];

export const ENV_VARS: EnvVarRef[] = [
  { name: "TODOS_DB_PATH", description: "SQLite database path (:memory: for tests)", default: ".todos/todos.db or ~/.todos/todos.db" },
  { name: "TODOS_AUTO_PROJECT", description: "Auto-detect git root project", default: "true" },
  { name: "TODOS_PROFILE", description: "MCP tool profile (minimal|standard|full)", default: "standard" },
  { name: "TODOS_URL", description: "REST API base URL for SDK client", default: "http://localhost:19427" },
  { name: "TODOS_MACHINE_ID", description: "Machine identifier for activity/audit", default: "hostname" },
  { name: "TODOS_ENCRYPTION_KEY", description: "Key for encrypted export profile" },
  { name: "JSON_OUTPUT", description: "When set, many commands emit JSON (also --json global flag)" },
];

export const JSON_OUTPUT_CONTRACT = {
  schema_version: CLI_REFERENCE_SCHEMA,
  description: "Pass --json (global) or set JSON_OUTPUT=1 for machine-readable output on supported commands.",
  shape: {
    success: "Command-specific object or array",
    error: "{ message: string, code?: string }",
  },
  stable_fields: ["id", "short_id", "status", "title", "schema_version"],
};

export const CLI_COMMAND_GROUPS: CliCommandGroup[] = [
  {
    name: "tasks",
    description: "Task CRUD and workflow",
    commands: [
      { name: "add", summary: "Create a task", usage: "todos add <title>", flags: ["--priority", "--project", "--json"], example: "todos add \"Fix auth bug\" --priority high", json: true },
      { name: "list", summary: "List tasks", flags: ["-s, --status", "--project", "--json"], json: true },
      { name: "show", summary: "Show task details", usage: "todos show <id>", json: true },
      { name: "start", summary: "Start a task", usage: "todos start <id>", json: true },
      { name: "done", summary: "Complete a task", usage: "todos done <id>", flags: ["--notes", "--commit-hash"], json: true },
      { name: "claim", summary: "Atomically claim next task", usage: "todos claim <agent>", json: true },
      { name: "next", summary: "Show next claimable task", json: true },
      { name: "fail", summary: "Mark task failed", flags: ["--reason", "--retry"], json: true },
      { name: "search", summary: "Full-text search", usage: "todos search <query>", json: true },
    ],
  },
  {
    name: "agents",
    description: "Agent coordination",
    commands: [
      { name: "init", summary: "Register agent identity", json: true },
      { name: "status", summary: "Project health snapshot", flags: ["--explain-blocked"], json: true },
      { name: "active", summary: "In-progress tasks", json: true },
      { name: "stale", summary: "Stale in-progress tasks", flags: ["--minutes"], json: true },
      { name: "ready", summary: "Ready unblocked pending tasks", json: true },
      { name: "blocked", summary: "Blocked tasks", json: true },
    ],
  },
  {
    name: "projects",
    description: "Project management",
    commands: [
      { name: "projects", summary: "List/create projects", flags: ["--add"], json: true },
      { name: "plans", summary: "List/create plans", flags: ["--add", "--show"], json: true },
    ],
  },
  {
    name: "dashboard",
    description: "Terminal and web dashboards",
    commands: [
      { name: "dashboard", summary: "Live TUI dashboard", flags: ["--readonly", "--agent", "--refresh"], example: "todos dashboard --readonly" },
      { name: "serve", summary: "Web dashboard + REST API", flags: ["--port"] },
    ],
  },
  {
    name: "workflow",
    description: "Goals, plans, handoffs, scheduling",
    commands: [
      { name: "goal", summary: "/goal-style workflows", example: "todos goal create \"Ship v1\" --step \"Tests\"" },
      { name: "plan-exec", summary: "Plan execution mode", example: "todos plan-exec status <planId>" },
      { name: "schedule", summary: "Due dates and stale reports", example: "todos schedule summary" },
      { name: "handoff-packet", summary: "Rich offline handoff", example: "todos handoff-packet build --agent me" },
      { name: "deps", summary: "Dependency graph", example: "todos deps ready --json" },
    ],
  },
  {
    name: "bridge",
    description: "Import/export and sync",
    commands: [
      { name: "bridge", summary: "Local bundle export/import", example: "todos bridge export ./bundle.json" },
      { name: "md", summary: "todos.md import/export", example: "todos md sync" },
      { name: "db", summary: "Database backup/restore", example: "todos db backup ./backup.db" },
    ],
  },
  {
    name: "verification",
    description: "Evidence and verification",
    commands: [
      { name: "verify", summary: "Run verification providers", example: "todos verify run test --task <id>" },
      { name: "artifact", summary: "Local artifact store", example: "todos artifact add --entity-type task" },
    ],
  },
  {
    name: "meta",
    description: "Completions, docs, MCP",
    commands: [
      { name: "completion", summary: "Shell completions", usage: "todos completion <bash|zsh|fish>", example: "todos completion bash >> ~/.bashrc" },
      { name: "docs", summary: "CLI reference and adapter docs", example: "todos docs cli" },
      { name: "mcp", summary: "Register MCP server", flags: ["--claude", "--codex"] },
    ],
  },
];

/** Flat list of top-level command names for completions */
export function listTopLevelCommands(): string[] {
  const names = new Set<string>();
  for (const group of CLI_COMMAND_GROUPS) {
    for (const cmd of group.commands) names.add(cmd.name);
  }
  // Additional top-level commands not in groups
  for (const extra of [
    "count", "inspect", "update", "lock", "unlock", "delete", "bulk", "templates",
    "comment", "sync", "config", "stream", "recap", "standup", "analytics",
    "views", "bridge", "activity", "crypto", "policy", "runs", "trace", "labels",
    "intake", "package", "schema", "bootstrap", "context", "release", "hook", "hooks",
  ]) {
    names.add(extra);
  }
  return [...names].sort();
}

/** Subcommands for command groups that use nested subcommands */
export const NESTED_SUBCOMMANDS: Record<string, string[]> = {
  goal: ["create", "execute", "status", "handoff", "docs"],
  bridge: ["export", "import", "sync", "validate", "docs"],
  db: ["backup", "restore", "check", "compact", "migrate-dry-run"],
  verify: ["providers", "run", "records", "create", "export"],
  deps: ["ready", "blocked", "critical-path", "unlock", "analyze"],
  "plan-exec": ["attach", "materialize", "status", "claim", "export"],
  "handoff-packet": ["build", "create", "export"],
  shortcuts: ["list", "add", "remove", "explain", "run", "export", "import", "docs"],
  triage: ["report", "apply", "docs"],
  report: ["export", "docs"],
  env: ["capture", "list", "get", "check"],
  views: ["search", "save", "list", "run"],
  schedule: ["set", "summary", "queue", "stale-report", "docs"],
  docs: ["cli", "adapters", "env"],
  completion: ["bash", "zsh", "fish", "install"],
  md: ["import", "export", "sync"],
  runs: ["record", "list", "show"],
  activity: ["list", "export"],
  schema: ["list", "validate", "compat"],
};

export function getCommandHelp(name: string): CliCommandRef | undefined {
  for (const group of CLI_COMMAND_GROUPS) {
    const cmd = group.commands.find((c) => c.name === name);
    if (cmd) return cmd;
  }
  return undefined;
}

export function getInstallInstructions(shell: "bash" | "zsh" | "fish"): string[] {
  switch (shell) {
    case "bash":
      return [
        "eval \"$(todos completion bash)\"",
        "# Or persist:",
        "todos completion bash >> ~/.bashrc",
      ];
    case "zsh":
      return [
        "eval \"$(todos completion zsh)\"",
        "# Or persist:",
        "todos completion zsh >> \"${ZDOTDIR:-$HOME}/.zshrc\"",
      ];
    case "fish":
      return [
        "todos completion fish | source",
        "# Or persist:",
        "mkdir -p ~/.config/fish/completions",
        "todos completion fish > ~/.config/fish/completions/todos.fish",
      ];
  }
}
