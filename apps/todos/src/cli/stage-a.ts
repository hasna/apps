import {
  resolveTodosStorageRole,
  TodosHostedStorageUnavailableError,
  type TodosStorageEnv,
} from "../storage/config.js";
import { TODOS_CLI_HELP_COMMAND_PATHS } from "./metadata-command-paths.js";

const HELP_FLAGS = new Set(["-h", "--help"]);
const VERSION_FLAGS = new Set(["-V", "--version"]);
const MUTATION_FLAGS = new Set(["--apply"]);
const GLOBAL_OPTIONS_WITH_VALUES = new Set(["--project", "--agent", "--session"]);
const JSON_FLAGS = new Set(["-j", "--json"]);
const COMPLETION_COMMANDS = new Set(["completion", "completions"]);
const COMPLETION_SHELLS = new Set(["bash", "zsh", "fish"]);
const MANUAL_FORMATS = new Set(["markdown", "json"]);

type TodosCliInvocationClass = "pure_metadata" | "invalid_metadata" | "runtime";

function withoutJsonFlags(args: readonly string[]): string[] {
  return args.filter((arg) => !JSON_FLAGS.has(arg));
}

function isExactTopLevelMetadata(args: readonly string[]): boolean {
  return args.length === 1 && (HELP_FLAGS.has(args[0]!) || VERSION_FLAGS.has(args[0]!) || args[0] === "help");
}

function isExactManualInvocation(args: readonly string[]): boolean {
  if (args[0] !== "manual") return false;
  if (args.length === 1) return true;
  if (args.length === 2 && HELP_FLAGS.has(args[1]!)) return true;
  if (args.length === 2 && args[1]!.startsWith("--format=")) {
    return MANUAL_FORMATS.has(args[1]!.slice("--format=".length));
  }
  return args.length === 3 && args[1] === "--format" && MANUAL_FORMATS.has(args[2]!);
}

function isExactCompletionInvocation(args: readonly string[]): boolean {
  if (!COMPLETION_COMMANDS.has(args[0]!)) return false;
  if (args.length === 2 && HELP_FLAGS.has(args[1]!)) return true;
  return args.length === 2 && COMPLETION_SHELLS.has(args[1]!);
}

function isExactStorageMetadataInvocation(args: readonly string[]): boolean {
  if (args[0] !== "storage") return false;
  if (args.length === 2 && HELP_FLAGS.has(args[1]!)) return true;
  if (args[1] === "status") {
    return args.length === 2 || (args.length === 3 && HELP_FLAGS.has(args[2]!));
  }
  if (args[1] !== "sync-plan") return false;
  if (args.length === 2) return true;
  if (args.length === 3) return args[2] === "--schema-sql" || HELP_FLAGS.has(args[2]!);
  return false;
}

function commandTokensWithoutGlobalOptions(args: readonly string[]): string[] | null {
  const tokens: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (JSON_FLAGS.has(arg)) continue;
    if (GLOBAL_OPTIONS_WITH_VALUES.has(arg)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) return null;
      index += 1;
      continue;
    }
    const assignment = [...GLOBAL_OPTIONS_WITH_VALUES].find((option) => arg.startsWith(`${option}=`));
    if (assignment) {
      if (arg.length === assignment.length + 1) return null;
      continue;
    }
    tokens.push(arg);
  }
  return tokens;
}

function isExactKnownCommandHelpInvocation(args: readonly string[]): boolean {
  const tokens = commandTokensWithoutGlobalOptions(args);
  if (!tokens || tokens.length < 2 || !HELP_FLAGS.has(tokens[tokens.length - 1]!)) return false;
  if (tokens.slice(0, -1).some((token) => token.startsWith("-"))) return false;
  return TODOS_CLI_HELP_COMMAND_PATHS.has(tokens.slice(0, -1).join(" "));
}

function isExactHelpCommandInvocation(args: readonly string[]): boolean {
  const tokens = commandTokensWithoutGlobalOptions(args);
  if (!tokens || tokens.length < 2 || tokens[0] !== "help") return false;
  if (tokens.slice(1).some((token) => token.startsWith("-"))) return false;
  return TODOS_CLI_HELP_COMMAND_PATHS.has(tokens.slice(1).join(" "));
}

function firstCommandToken(args: readonly string[]): { command?: string; malformedGlobalOption: boolean } {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (JSON_FLAGS.has(arg)) continue;
    if (GLOBAL_OPTIONS_WITH_VALUES.has(arg)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) return { malformedGlobalOption: true };
      index += 1;
      continue;
    }
    const globalAssignment = [...GLOBAL_OPTIONS_WITH_VALUES].find((option) => arg.startsWith(`${option}=`));
    if (globalAssignment) {
      if (arg.length === globalAssignment.length + 1) return { malformedGlobalOption: true };
      continue;
    }
    if (!arg.startsWith("-")) return { command: arg, malformedGlobalOption: false };
  }
  return { malformedGlobalOption: false };
}

function classifyTodosCliInvocation(args: readonly string[]): TodosCliInvocationClass {
  if (args.length === 0) return "pure_metadata";
  const normalized = withoutJsonFlags(args);
  if (isExactTopLevelMetadata(normalized)
    || isExactManualInvocation(normalized)
    || isExactCompletionInvocation(normalized)
    || isExactStorageMetadataInvocation(normalized)
    || isExactKnownCommandHelpInvocation(args)
    || isExactHelpCommandInvocation(args)) {
    return "pure_metadata";
  }

  const first = firstCommandToken(args);
  if (first.malformedGlobalOption || first.command === undefined) return "invalid_metadata";
  if (args.some((arg) => HELP_FLAGS.has(arg) || VERSION_FLAGS.has(arg))) return "invalid_metadata";
  if (first.command === "help" || first.command === "manual" || COMPLETION_COMMANDS.has(first.command)) {
    return "invalid_metadata";
  }
  if (first.command === "storage") {
    const path = commandPath(args);
    if (path[1] === "status" || path[1] === "sync-plan") return "invalid_metadata";
  }
  return "runtime";
}

function commandPath(args: readonly string[]): string[] {
  const path: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (GLOBAL_OPTIONS_WITH_VALUES.has(arg)) {
      index += 1;
      continue;
    }
    if ([...GLOBAL_OPTIONS_WITH_VALUES].some((option) => arg.startsWith(`${option}=`))) continue;
    if (arg === "-j" || arg === "--json") continue;
    if (arg.startsWith("-")) continue;
    path.push(arg);
  }
  return path;
}

function isStageADeferredStorageAction(args: readonly string[]): boolean {
  const path = commandPath(args);
  if (path[0] !== "storage") return false;
  if (path[1] === "shadow-drain") return true;
  if (!args.some((arg) => MUTATION_FLAGS.has(arg))) return false;
  if (path[1] === "sync-plan") return true;
  return path[1] === "artifacts" && (path[2] === "upload" || path[2] === "download");
}

export function isTodosCliPureMetadataInvocation(args: readonly string[]): boolean {
  return classifyTodosCliInvocation(args) === "pure_metadata";
}

export function assertTodosCliStageAContainment(
  args: readonly string[] = process.argv.slice(2),
  env: TodosStorageEnv = process.env,
): void {
  const invocationClass = classifyTodosCliInvocation(args);
  if (invocationClass === "pure_metadata") return;
  if (invocationClass === "invalid_metadata") {
    throw new TodosHostedStorageUnavailableError("authority_resolver_unavailable");
  }
  const role = resolveTodosStorageRole(env);
  if (role.role !== "local") throw new TodosHostedStorageUnavailableError(role.reason);
  // These Stage-A actions cannot become operational even in a local process.
  // Stop in the dependency-light bootstrap before the command graph can import
  // SQLite, shadow configuration, or provider modules.
  if (isStageADeferredStorageAction(args)) {
    throw new TodosHostedStorageUnavailableError("authority_resolver_unavailable");
  }
}

export function isTodosCliJsonInvocation(args: readonly string[] = process.argv.slice(2)): boolean {
  return args.includes("-j") || args.includes("--json");
}

export interface TodosCliStageAErrorPayload {
  error: "hosted_authority_unavailable";
  code: "HOSTED_AUTHORITY_UNAVAILABLE";
  reason: string;
}

export interface TodosCliErrorPayload {
  error: string;
}

export function todosCliStageAErrorPayload(error: unknown): TodosCliStageAErrorPayload | null {
  if (!error || typeof error !== "object") return null;
  let code: unknown;
  let reason: unknown;
  try {
    code = Reflect.get(error, "code");
    reason = Reflect.get(error, "reason");
    if (code !== "HOSTED_AUTHORITY_UNAVAILABLE") {
      const body = Reflect.get(error, "body");
      if (body && typeof body === "object") {
        code = Reflect.get(body, "code");
        reason = Reflect.get(body, "reason");
      }
    }
  } catch {
    return null;
  }
  if (code !== "HOSTED_AUTHORITY_UNAVAILABLE") return null;
  return {
    error: "hosted_authority_unavailable",
    code,
    reason: typeof reason === "string" && reason ? reason : "authority_resolver_unavailable",
  };
}

function todosCliErrorMessage(error: unknown): string {
  let message: string;
  try {
    message = error instanceof Error ? error.message : String(error);
  } catch {
    message = "Unknown error";
  }
  return message
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/^error:\s*/i, "")
    .trim() || "Unknown error";
}

function exitWithTodosCliSerializedError(
  error: unknown,
  args: readonly string[],
  fallbackToStageA: boolean,
): never {
  const stageAPayload = todosCliStageAErrorPayload(error);
  const payload: TodosCliStageAErrorPayload | TodosCliErrorPayload = stageAPayload
    ?? (fallbackToStageA
      ? {
          error: "hosted_authority_unavailable",
          code: "HOSTED_AUTHORITY_UNAVAILABLE",
          reason: "authority_resolver_unavailable",
        }
      : { error: todosCliErrorMessage(error) });
  if (isTodosCliJsonInvocation(args)) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    process.stderr.write(`${stageAPayload ? todosCliErrorMessage(error) : payload.error}\n`);
  }
  process.exit(1);
}

export function exitWithTodosCliError(
  error: unknown,
  args: readonly string[] = process.argv.slice(2),
): never {
  return exitWithTodosCliSerializedError(error, args, false);
}

export function exitWithTodosCliStageAError(
  error: unknown,
  args: readonly string[] = process.argv.slice(2),
): never {
  return exitWithTodosCliSerializedError(error, args, true);
}
