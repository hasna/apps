import { getNativeStorageStatus, getNativeStorageSyncPlan } from "../lib/native-storage-status.js";
import { getPackageVersion } from "../lib/package-version.js";
import { renderCliManualMarkdown, type CliManual } from "../lib/cli-help.js";
import {
  TODOS_CLI_COMMAND_HELP,
  TODOS_CLI_COMPLETIONS,
  TODOS_CLI_MANUAL,
  TODOS_CLI_ROOT_HELP,
} from "./metadata-static.js";

const JSON_FLAGS = new Set(["-j", "--json"]);
const HELP_FLAGS = new Set(["-h", "--help"]);

function withoutJson(args: readonly string[]): string[] {
  return args.filter((arg) => !JSON_FLAGS.has(arg));
}

function jsonRequested(args: readonly string[]): boolean {
  return args.some((arg) => JSON_FLAGS.has(arg));
}

function commandPath(args: readonly string[]): string[] {
  const values = new Set(["--project", "--agent", "--session"]);
  const path: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (JSON_FLAGS.has(arg)) continue;
    if (values.has(arg)) {
      index += 1;
      continue;
    }
    if ([...values].some((option) => arg.startsWith(`${option}=`))) continue;
    if (!arg.startsWith("-")) path.push(arg);
  }
  return path;
}

function createDependencyLightManual(): CliManual {
  return TODOS_CLI_MANUAL;
}

function printRootHelp(): void {
  process.stdout.write(TODOS_CLI_ROOT_HELP);
}

function printCommandHelp(path: readonly string[]): void {
  const help = TODOS_CLI_COMMAND_HELP[path.join(" ")];
  if (!help) throw new Error(`No dependency-light help metadata for: ${path.join(" ")}`);
  process.stdout.write(help);
}

function completionScript(shell: "bash" | "zsh" | "fish"): string {
  return TODOS_CLI_COMPLETIONS[shell];
}

function printStorageStatus(asJson: boolean): void {
  const status = getNativeStorageStatus(process.env);
  if (asJson) {
    process.stdout.write(`${JSON.stringify(status)}\n`);
    return;
  }
  process.stdout.write([
    "todos storage",
    `Mode: ${status.mode}`,
    `Remote: ${status.remote_enabled ? "enabled" : "disabled"}`,
    `Configured remote intent: ${status.remote_configured ? "yes" : "no"}`,
    `Runtime enabled: ${status.runtime_enabled ? "yes" : "no"}`,
    `Database: ${status.database.configured ? status.database.redacted_url : "not configured"}`,
    "Network: not used",
    "",
  ].join("\n"));
  if (status.diagnostics.truncated) {
    process.stderr.write(`Diagnostics: truncated (${status.diagnostics.truncations.length} reported, ${status.diagnostics.omitted_truncations} omitted)\n`);
  }
}

function printStorageSyncPlan(args: readonly string[], asJson: boolean): void {
  const plan = getNativeStorageSyncPlan(process.env, {
    includeSchemaSql: args.includes("--schema-sql"),
  });
  if (asJson) {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return;
  }
  process.stdout.write([
    "todos storage sync-plan",
    `Mode: ${plan.status.mode}`,
    "Dry run: yes",
    "Network: not used",
    "Steps:",
    ...plan.steps.map((step) => `  - ${step}`),
    ...(plan.postgres.schema_sql.length > 0
      ? ["Postgres schema:", ...plan.postgres.schema_sql]
      : []),
    "",
  ].join("\n"));
  if (plan.diagnostics.truncated) {
    process.stderr.write(`Diagnostics: truncated (${plan.diagnostics.truncations.length} reported, ${plan.diagnostics.omitted_truncations} omitted)\n`);
  }
}

/** Render one invocation already proven to be exact dependency-light metadata. */
export function renderTodosCliMetadata(args: readonly string[]): boolean {
  const normalized = withoutJson(args);
  const asJson = jsonRequested(args);
  if (normalized.length === 0 || HELP_FLAGS.has(normalized[0]!)) {
    printRootHelp();
    return true;
  }
  if (normalized[0] === "help") {
    const path = commandPath(args).slice(1);
    if (path.length === 0) printRootHelp();
    else printCommandHelp(path);
    return true;
  }
  if (normalized.length === 1 && (normalized[0] === "-V" || normalized[0] === "--version")) {
    process.stdout.write(`${getPackageVersion(import.meta.url)}\n`);
    return true;
  }
  if (normalized[0] === "manual") {
    if (normalized.some((arg) => HELP_FLAGS.has(arg))) {
      printCommandHelp(["manual"]);
      return true;
    }
    const manual = createDependencyLightManual();
    const format = normalized.find((arg) => arg.startsWith("--format="))?.slice("--format=".length)
      ?? (normalized[1] === "--format" ? normalized[2] : undefined);
    if (asJson || format === "json") process.stdout.write(`${JSON.stringify(manual)}\n`);
    else process.stdout.write(`${renderCliManualMarkdown(manual)}\n`);
    return true;
  }
  if (normalized[0] === "completion" || normalized[0] === "completions") {
    if (HELP_FLAGS.has(normalized[1]!)) {
      printCommandHelp([normalized[0]]);
      return true;
    }
    process.stdout.write(completionScript(normalized[1] as "bash" | "zsh" | "fish"));
    return true;
  }
  if (normalized[0] === "storage") {
    if (HELP_FLAGS.has(normalized[1]!)) {
      printCommandHelp(["storage"]);
      return true;
    }
    if (normalized[1] === "status") {
      if (HELP_FLAGS.has(normalized[2]!)) printCommandHelp(["storage", "status"]);
      else printStorageStatus(asJson);
      return true;
    }
    if (normalized[1] === "sync-plan") {
      if (HELP_FLAGS.has(normalized[2]!)) printCommandHelp(["storage", "sync-plan"]);
      else printStorageSyncPlan(normalized, asJson);
      return true;
    }
  }
  if (HELP_FLAGS.has(normalized[normalized.length - 1]!)) {
    printCommandHelp(commandPath(args));
    return true;
  }
  return false;
}
