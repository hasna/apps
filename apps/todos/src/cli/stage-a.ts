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

const GLOBAL_OPTIONS_WITH_VALUES = new Set(["--project", "--agent", "--session"]);
const METADATA_COMMANDS = new Set(["help", "manual", "completions", "completion", "config"]);
const REMOTE_COMMANDS = new Set([
  "status",
  "health",
  "doctor",
  "projects",
  "project-rename",
  "lists",
  "task-lists",
  "tl",
  "plans",
  "add",
  "list",
  "count",
  "show",
  "update",
  "start",
  "done",
  "delete",
  "remove",
  "comment",
  "log-progress",
  "next",
  "claim",
  "task",
]);

interface ParsedInvocation {
  command: string | undefined;
  commandArgs: string[];
}

function parseInvocation(args: string[]): ParsedInvocation {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (GLOBAL_OPTIONS_WITH_VALUES.has(arg)) {
      index += 1;
      continue;
    }
    if (arg === "-j" || arg === "--json") continue;
    if (arg.startsWith("-")) continue;
    return { command: arg, commandArgs: args.slice(index + 1) };
  }
  return { command: undefined, commandArgs: [] };
}

function invocationLabel(invocation: ParsedInvocation): string {
  const detail = invocation.commandArgs.find((arg) => !arg.startsWith("-"));
  return [invocation.command, detail].filter(Boolean).join(" ") || "this invocation";
}

function hasOption(args: string[], option: string): boolean {
  return args.some((arg) => arg === option || arg.startsWith(`${option}=`));
}

function isMetadataInvocation(args: string[], invocation: ParsedInvocation): boolean {
  if (args.length === 0 || args.some((arg) => arg === "-h" || arg === "--help")) return true;
  if (args.some((arg) => arg === "-V" || arg === "--version")) return true;
  if (invocation.command && METADATA_COMMANDS.has(invocation.command)) return true;
  return invocation.command === "storage" && invocation.commandArgs.includes("status");
}

function assertRemoteCommandSupported(invocation: ParsedInvocation, args: string[]): void {
  const command = invocation.command;
  let supported = Boolean(command && REMOTE_COMMANDS.has(command));
  if (command === "task") supported = parseInvocation(invocation.commandArgs).command === "upsert";
  if (command === "doctor") {
    supported = !args.some((arg) => arg === "routing") && !hasOption(args, "--apply") && !hasOption(args, "--fix");
  }
  if (command === "projects") supported = !hasOption(invocation.commandArgs, "--deregister");
  if (command === "plans") {
    supported =
      !hasOption(invocation.commandArgs, "--artifact") &&
      !hasOption(invocation.commandArgs, "--write-artifacts");
  }
  if (command === "claim") {
    supported = !hasOption(args, "--steal-stale") && !hasOption(args, "--project");
  }

  if (!supported) {
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

  assertRemoteCommandSupported(invocation, args);
  const client = getTodosCloudClient(env);
  if (!client) {
    throw new Error("REMOTE_API_UNAVAILABLE: remote mode did not resolve an HTTP client; local SQLite fallback is disabled");
  }
  return { route: "remote-http", v1_base_url: client.baseUrl };
}
