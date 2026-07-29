import { Command, Help } from "commander";
import {
  getTodosCloudClient,
  getTodosRemoteAuthorityConfigStatus,
  resolveTodosCliStorageMode,
} from "./cloud-router.js";
import {
  CLI_OPERATIONS,
  CLI_REMOTE_INVOCATION_RULES,
  REMOTE_DIAGNOSTIC_COMMANDS,
  getCliOperation,
  listCliTopLevelCommands,
} from "../operation-manifest.js";

type Env = Record<string, string | undefined>;

export type TodosCliAuthorityInitialization =
  | { route: "local"; v1_base_url: null }
  | { route: "remote-diagnostic"; v1_base_url: string | null }
  | { route: "remote-http"; v1_base_url: string };

export type TodosCliCommandOwner = "diagnostic" | "remote-http" | "local-only";

const COMMAND_CAPABILITY_MATRIX = new Map<string, TodosCliCommandOwner>();
for (const command of listCliTopLevelCommands()) COMMAND_CAPABILITY_MATRIX.set(command, "local-only");
COMMAND_CAPABILITY_MATRIX.set("help", "diagnostic");
for (const command of REMOTE_DIAGNOSTIC_COMMANDS) COMMAND_CAPABILITY_MATRIX.set(command, "diagnostic");
for (const operation of CLI_OPERATIONS) {
  if (operation.topology === "shared-customer-domain") {
    COMMAND_CAPABILITY_MATRIX.set(operation.path.split(" ")[0]!, "remote-http");
  }
}

export function getTodosCliCommandCapabilityMatrix(): ReadonlyMap<string, TodosCliCommandOwner> {
  return COMMAND_CAPABILITY_MATRIX;
}

/**
 * Whether a top-level command should be advertised (help/manual/completions) for
 * a resolved authority route. In a remote route the CLI fails closed on
 * `local-only` commands (Stage A throws REMOTE_COMMAND_UNSUPPORTED), so the help
 * surface must not advertise commands it will reject. Diagnostic and remote-http
 * owners stay visible. Commands with no capability owner (e.g. optional
 * dynamically-registered families) self-gate at runtime and remain visible.
 */
export function isTodosCliCommandVisibleForRoute(
  command: string,
  route: TodosCliAuthorityInitialization["route"],
): boolean {
  if (route === "local") return true;
  const owner = COMMAND_CAPABILITY_MATRIX.get(command);
  if (!owner) return true;
  return owner !== "local-only";
}

/**
 * Filter the commander help output so it only lists top-level commands the given
 * authority route can execute. This keeps `todos --help` honest without
 * unregistering commands, so Stage A remains the single source of truth for
 * execution gating and error messaging.
 */
export function applyTodosCliHelpVisibility(program: Command, route: TodosCliAuthorityInitialization["route"]): void {
  if (route === "local") return;
  program.configureHelp({
    visibleCommands(this: Help, command: Command): Command[] {
      return Help.prototype.visibleCommands
        .call(this, command)
        .filter((subcommand) => isTodosCliCommandVisibleForRoute(subcommand.name(), route));
    },
  });
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
  if (invocation.command === "completions") return true;
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
  const positionals = positionalArgs(args);
  let operation = getCliOperation(command);
  for (let length = Math.min(positionals.length, 3); length > 0; length -= 1) {
    const candidate = getCliOperation([command, ...positionals.slice(0, length)].join(" "));
    if (candidate) {
      operation = candidate;
      break;
    }
  }
  if (!operation || operation.topology !== "shared-customer-domain") return false;

  const rule = CLI_REMOTE_INVOCATION_RULES[operation.path] ?? CLI_REMOTE_INVOCATION_RULES[command];
  if (!rule) return true;
  if (rule.deniedGlobalOptions?.some((option) => invocation.globalOptions.has(option))) return false;
  if (rule.allowedActions) {
    const action = positionals[0];
    if (!action || !rule.allowedActions.includes(action)) return false;
    if (rule.unrestrictedActions?.includes(action)) return true;
  }
  return !rule.deniedOptions?.some((option) => hasOption(args, option));
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
