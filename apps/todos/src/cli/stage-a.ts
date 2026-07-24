import {
  getTodosCloudClient,
  getTodosRemoteAuthorityConfigStatus,
  resolveTodosCliStorageMode,
} from "./cloud-router.js";

type Env = Record<string, string | undefined>;

export type TodosCliAuthorityInitialization =
  | { route: "local"; v1_base_url: null }
  | { route: "remote-diagnostic"; v1_base_url: string | null }
  | { route: "remote-http"; v1_base_url: string };

export type TodosCliCommandOwner = "diagnostic" | "remote-http" | "local-only";

const REGISTERED_CANONICAL_COMMANDS = [
  "active", "add", "agent", "agent-runs", "agent-update", "agents", "agents-normalize", "api-keys",
  "approvals", "approve", "assign", "audit-ledger", "backup", "blame", "blocked", "board",
  "branch-plan", "bridge-import", "bulk", "burndown", "calendar", "capacity", "claim", "comment",
  "completions", "config", "context", "context-pack", "contracts", "count", "dashboard", "dedupe",
  "delete", "deps", "dispatch", "dispatches", "doctor", "done", "encryption", "env-snapshot",
  "event-hooks", "events", "export", "extensions", "extract", "extract-watch", "fail", "fields",
  "find-commit", "find-ref", "findings", "focus", "handoff", "health", "heartbeat", "history",
  "hook", "hooks", "import", "inbox", "init", "inspect", "interactive", "issues",
  "knowledge", "link-commit", "link-ref", "list", "lists", "lock", "log", "machines",
  "manual", "mcp", "mine", "move", "next", "notifications", "onboarding", "org", "overdue",
  "pin", "plans", "policies", "priorities", "project-bootstrap", "project-panel", "project-rename", "projects",
  "projects-path", "ready", "recap", "record-verification", "redaction", "redistribute", "references", "release",
  "release-compat", "release-notes", "reliability", "remove", "report", "report-failure", "reports", "retention",
  "retrospectives", "reviews", "risks", "roadmaps", "runs", "sandbox", "scale", "sdk-fixtures",
  "search", "serve", "show", "sla", "snapshots", "sprint", "stale", "standup",
  "start", "status", "steal", "storage", "stream", "summary", "sync", "tag",
  "task", "template-export", "template-history", "template-import", "template-init", "template-library", "template-preview", "templates",
  "terminal-notifications", "time", "timeline", "today", "todos-md-import", "trace", "trust", "unassign",
  "unlock", "untag", "update", "upgrade", "usage", "verify-providers", "views", "watch",
  "webhooks", "week", "workflow", "workflows", "yesterday",
] as const;

export const TODOS_CLI_COMMAND_ALIASES = {
  onboarding: ["demo-fixtures"],
  retrospectives: ["retro"],
  completions: ["completion"],
  comment: ["log-progress"],
  "todos-md-import": ["import-md", "markdown-import"],
  "api-keys": ["api-key"],
  "template-init": ["templates-init"],
  "template-library": ["templates-library"],
  "template-preview": ["templates-preview"],
  "template-export": ["templates-export"],
  "template-import": ["templates-import"],
  "template-history": ["templates-history"],
  "agents-normalize": ["normalize-agents"],
  "agent-update": ["agents-update"],
  upgrade: ["self-update"],
  roadmaps: ["roadmap"],
  "env-snapshot": ["environment-snapshot"],
  reviews: ["review-queue"],
  snapshots: ["local-snapshots"],
  references: ["refs"],
  reliability: ["scorecards"],
  lists: ["task-lists", "tl"],
} as const satisfies Record<string, readonly string[]>;

const DIAGNOSTIC_COMMANDS = new Set(["help", "manual", "completions", "completion", "config", "storage"]);
const REMOTE_COMMANDS = new Set([
  "active", "add", "agent", "agents", "approve", "bulk", "claim", "comment", "count", "delete", "deps",
  "doctor", "done", "find-commit", "find-ref", "health", "heartbeat", "history", "init", "inspect", "link-commit",
  "link-ref", "list", "lists", "lock", "log-progress", "move", "next", "plans", "project-rename", "projects", "recap",
  "record-verification", "release", "remove", "show", "standup", "start", "status", "task", "task-lists", "timeline",
  "template-export", "template-import", "template-preview", "templates", "tl", "unlock", "update",
]);

const COMMAND_CAPABILITY_MATRIX = new Map<string, TodosCliCommandOwner>();
for (const command of REGISTERED_CANONICAL_COMMANDS) COMMAND_CAPABILITY_MATRIX.set(command, "local-only");
COMMAND_CAPABILITY_MATRIX.set("help", "diagnostic");
for (const command of DIAGNOSTIC_COMMANDS) COMMAND_CAPABILITY_MATRIX.set(command, "diagnostic");
for (const command of REMOTE_COMMANDS) COMMAND_CAPABILITY_MATRIX.set(command, "remote-http");
for (const [canonical, aliases] of Object.entries(TODOS_CLI_COMMAND_ALIASES)) {
  const owner = COMMAND_CAPABILITY_MATRIX.get(canonical);
  if (!owner) throw new Error(`Missing capability owner for ${canonical}`);
  for (const alias of aliases) COMMAND_CAPABILITY_MATRIX.set(alias, owner);
}

export function getTodosCliCommandCapabilityMatrix(): ReadonlyMap<string, TodosCliCommandOwner> {
  return COMMAND_CAPABILITY_MATRIX;
}

const GLOBAL_OPTIONS_WITH_VALUES = new Set(["--project", "--agent", "--session"]);
const GLOBAL_FLAGS = new Set(["-j", "--json"]);
const HELP_FLAGS = new Set(["-h", "--help"]);
const VERSION_FLAGS = new Set(["-V", "--version"]);

interface ParsedInvocation {
  command: string | undefined;
  commandArgs: string[];
  globalOptions: ReadonlySet<string>;
  metadataFlags: ReadonlySet<string>;
  invalidGlobalOption: string | null;
  unknownLeadingOption: string | null;
}

function parseInvocation(args: string[]): ParsedInvocation {
  const localTokens: string[] = [];
  const globalOptions = new Set<string>();
  let invalidGlobalOption: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (GLOBAL_FLAGS.has(arg)) {
      globalOptions.add(arg);
      continue;
    }
    const equalsGlobal = [...GLOBAL_OPTIONS_WITH_VALUES].find((option) => arg.startsWith(`${option}=`));
    if (equalsGlobal) {
      globalOptions.add(equalsGlobal);
      if (arg.length === equalsGlobal.length + 1) invalidGlobalOption ??= equalsGlobal;
      continue;
    }
    if (GLOBAL_OPTIONS_WITH_VALUES.has(arg)) {
      globalOptions.add(arg);
      if (index + 1 >= args.length) {
        invalidGlobalOption ??= arg;
      } else {
        // Required global option values are consumed by arity even when the
        // value text is --help/--version. Values can never grant metadata mode.
        index += 1;
      }
      continue;
    }
    localTokens.push(arg);
  }

  const commandIndex = localTokens.findIndex((arg) => !arg.startsWith("-"));
  const command = commandIndex >= 0 ? localTokens[commandIndex] : undefined;
  const commandArgs = commandIndex >= 0 ? localTokens.slice(commandIndex + 1) : [];
  const unknownLeadingOption = localTokens
    .slice(0, commandIndex >= 0 ? commandIndex : localTokens.length)
    .find((arg) => arg.startsWith("-") && !HELP_FLAGS.has(arg) && !VERSION_FLAGS.has(arg)) ?? null;
  const metadataFlags = new Set(localTokens.filter((arg) => HELP_FLAGS.has(arg) || VERSION_FLAGS.has(arg)));
  return { command, commandArgs, globalOptions, metadataFlags, invalidGlobalOption, unknownLeadingOption };
}

function invocationLabel(invocation: ParsedInvocation): string {
  const detail = invocation.commandArgs.find((arg) => !arg.startsWith("-"));
  return [invocation.command, detail].filter(Boolean).join(" ") || "this invocation";
}

function hasOption(args: readonly string[], option: string): boolean {
  return args.some((arg) => arg === option || arg.startsWith(`${option}=`));
}

function positionalArgs(args: readonly string[]): string[] {
  return args.filter((arg) => !arg.startsWith("-"));
}

function isReadOnlyConfigInvocation(invocation: ParsedInvocation): boolean {
  if (invocation.command !== "config") return false;
  const args = invocation.commandArgs;
  if (args.length === 0) return true;
  if (args.length === 1 && args[0]!.startsWith("--get=") && args[0]!.length > "--get=".length) return true;
  return args.length === 2 && args[0] === "--get" && Boolean(args[1]) && !args[1]!.startsWith("-");
}

function isMetadataInvocation(args: string[], invocation: ParsedInvocation): boolean {
  if (invocation.invalidGlobalOption || invocation.unknownLeadingOption) return false;
  if (!invocation.command) {
    return args.length === 0 || invocation.metadataFlags.size > 0;
  }
  // Shell-completion generation (`completions <shell>` / `completion <shell>`) is
  // pure static output that never touches the DB or network, so every form of it
  // — with or without a shell argument — is a diagnostic invocation that must
  // succeed offline in remote mode.
  if (invocation.command === "completions" || invocation.command === "completion") return true;
  if (invocation.command === "manual" && invocation.commandArgs.length === 0) return true;
  if (invocation.command === "help" && invocation.commandArgs.every((arg) => !arg.startsWith("-"))) return true;
  if (invocation.command === "config") {
    return isReadOnlyConfigInvocation(invocation) ||
      (invocation.commandArgs.length === 1 && HELP_FLAGS.has(invocation.commandArgs[0]!));
  }
  if (invocation.command === "storage") {
    return invocation.commandArgs.length === 1 &&
      (invocation.commandArgs[0] === "status" || HELP_FLAGS.has(invocation.commandArgs[0]!));
  }
  return invocation.commandArgs.length === 1 &&
    (HELP_FLAGS.has(invocation.commandArgs[0]!) || VERSION_FLAGS.has(invocation.commandArgs[0]!));
}

function commandSupportsRemote(invocation: ParsedInvocation): boolean {
  const command = invocation.command;
  if (!command || COMMAND_CAPABILITY_MATRIX.get(command) !== "remote-http") return false;
  const args = invocation.commandArgs;
  switch (command) {
    case "task":
      return positionalArgs(args)[0] === "upsert";
    case "doctor":
      return positionalArgs(args)[0] !== "routing" && !hasOption(args, "--apply") && !hasOption(args, "--fix");
    case "projects":
      return !hasOption(args, "--deregister") && !hasOption(args, "--path-prefix") && !hasOption(args, "--dry-run");
    case "plans":
      return !hasOption(args, "--artifact") && !hasOption(args, "--write-artifacts");
    case "list":
      return !hasOption(args, "--tags") && !hasOption(args, "--tag") && !hasOption(args, "--recurring");
    case "claim":
      return !invocation.globalOptions.has("--project") && !hasOption(args, "--project") &&
        !hasOption(args, "--stale-minutes") && !hasOption(args, "--steal-stale");
    case "status":
      return !invocation.globalOptions.has("--agent") && !hasOption(args, "--agent");
    // `deps <id>` (read edges), `--needs`/`--remove` (write edges), and the
    // presentation-only `--graph`/`--direction` flags are all serviced remotely:
    // the cloud handler renders the shared dependency/blocked-by edges and, since
    // the recursive graph is a local-only view, gracefully falls back to those
    // same flat edges for `--graph`/`--direction` instead of failing closed.
    case "deps":
      return true;
    case "bulk": {
      const action = positionalArgs(args)[0];
      return Boolean(action && ["done", "complete", "start", "delete"].includes(action)) &&
        !hasOption(args, "--plan") && !hasOption(args, "--clear-plan");
    }
    default:
      return true;
  }
}

function assertRemoteCommandSupported(invocation: ParsedInvocation): void {
  if (invocation.invalidGlobalOption || invocation.unknownLeadingOption || !commandSupportsRemote(invocation)) {
    throw new Error(
      `REMOTE_COMMAND_UNSUPPORTED: ${invocationLabel(invocation)} is not supported by the Todos /v1 CLI; ` +
        "local SQLite fallback is disabled",
    );
  }
}

/**
 * Stage A runs before importing any command module that can reach SQLite or
 * native Postgres adapters. It validates the complete mode state, gates the
 * remote command surface, then constructs only the authenticated HTTP client.
 */
export function initializeTodosCliAuthority(
  args: string[] = process.argv.slice(2),
  env: Env = process.env as Env,
): TodosCliAuthorityInitialization {
  const mode = resolveTodosCliStorageMode(env);
  if (!mode.selected) return { route: "local", v1_base_url: null };

  const invocation = parseInvocation(args);
  if (isMetadataInvocation(args, invocation)) {
    const status = getTodosRemoteAuthorityConfigStatus(env);
    return { route: "remote-diagnostic", v1_base_url: status.v1_base_url };
  }

  assertRemoteCommandSupported(invocation);
  const client = getTodosCloudClient(env);
  if (!client) {
    throw new Error("REMOTE_API_UNAVAILABLE: remote mode did not resolve an HTTP client; local SQLite fallback is disabled");
  }
  return { route: "remote-http", v1_base_url: client.baseUrl };
}
