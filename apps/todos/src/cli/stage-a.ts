import { Command, Help } from "commander";
import {
  getTodosCloudClient,
  getTodosRemoteAuthorityConfigStatus,
  resolveTodosCliTransport,
  type TodosCliTransportResolution,
  type TodosRemoteCommandCapability,
} from "./cloud-router.js";

type Env = Record<string, string | undefined>;

export type TodosCliAuthorityInitialization =
  | { route: "local"; v1_base_url: null; selected_by?: "local-only-command" }
  | { route: "remote-diagnostic"; v1_base_url: string | null }
  | { route: "remote-http"; v1_base_url: string };

export type TodosCliCommandOwner = "diagnostic" | "remote-http" | "local-only";

/**
 * Stage A is intentionally pure: it decides the authority route without
 * mutating the caller's environment. The executable applies an admitted local
 * redaction decision before importing command modules so any later
 * `getTodosCloudClient()` call cannot reconstruct hosted routing from the
 * ambient API pair. The retired storage-mode variables are never written here —
 * they are banned (owner directive 2026-08-15), and the HTTP selector is
 * HASNA_TODOS_API_URL + HASNA_TODOS_API_KEY, which the redaction blanks.
 *
 * Because transport resolution now fails closed (hasna/apps#1613), blanking the
 * pair alone would make a later `resolveTodosCliTransport()` /
 * `getTodosCloudClient()` call THROW instead of reporting "no cloud client".
 * The local SQLite use here is a deliberate command-level decision (a
 * local-only command was admitted), never an implicit fallback, so the apply
 * stamps the explicit local opt-in alongside the blanking.
 */
export function applyTodosCliAuthorityEnvironment(
  authority: TodosCliAuthorityInitialization,
  env: Env = process.env as Env,
): void {
  if (authority.route !== "local" || authority.selected_by !== "local-only-command") return;
  env.HASNA_TODOS_API_URL = "";
  env.HASNA_TODOS_API_KEY = "";
  env.TODOS_API_URL = "";
  env.TODOS_API_KEY = "";
  // Explicit local decision: resolver now returns the sqlite transport under
  // the opt-in, and getTodosCloudClient() keeps returning null (no cloud
  // client) instead of throwing REMOTE_API_CONFIG_MISSING.
  env.HASNA_TODOS_LOCAL = "1";
  env.TODOS_LOCAL = "1";
}

const REGISTERED_CANONICAL_COMMANDS = [
  "active", "add", "agent", "agent-runs", "agent-update", "agents", "agents-normalize", "ai", "api-keys",
  "approvals", "approve", "assign", "audit-ledger", "backup", "blame", "blocked", "board",
  "branch-plan", "bridge-import", "bulk", "burndown", "calendar", "capacity", "claim", "comment",
  "completions", "config", "context", "context-pack", "contracts", "count", "dashboard", "dedupe",
  "delegate", "delete", "deps", "dispatch", "dispatches", "doctor", "done", "encryption", "env-snapshot",
  "event-hooks", "events", "export", "extensions", "extract", "extract-watch", "fail", "fields",
  "find-commit", "find-ref", "findings", "focus", "handoff", "health", "heartbeat", "history",
  "hook", "hooks", "import", "inbox", "init", "inspect", "interactive", "issues",
  "knowledge", "link-commit", "link-ref", "list", "lists", "lock", "log", "machines",
  "manual", "mcp", "mine", "move", "next", "notifications", "onboarding", "org", "overdue",
  "pin", "plans", "policies", "priorities", "project-bootstrap", "project-panel", "project-registration", "project-rename", "project-resources", "projects",
  "projects-path", "ready", "recap", "record-verification", "redaction", "redistribute", "references", "release",
  "release-compat", "release-notes", "reliability", "remove", "report", "report-failure", "reports", "retention",
  "retrospectives", "reviews", "risks", "roadmaps", "runs", "sandbox", "scale", "sdk-fixtures",
  "search", "serve", "show", "sla", "snapshots", "sprint", "stale", "standup",
  "stale-lock-handoff", "start", "status", "steal", "storage", "stream", "summary", "sync", "tag",
  "task", "task-manifest", "task-subtree-transfer", "template-export", "template-history", "template-import", "template-init", "template-library", "template-preview", "templates",
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
  // The MCP surface calls these operations `complete_task` and
  // `register_agent`, and the agent rule corpus instructs agents to use those
  // names, so the CLI accepts its own vocabulary instead of rejecting it.
  // `bulk complete` and the status normaliser already treat "complete" as a
  // synonym for "done"; this makes the top-level verb agree with them.
  done: ["complete"],
  init: ["register"],
  upgrade: ["self-update"],
  roadmaps: ["roadmap"],
  "env-snapshot": ["environment-snapshot"],
  reviews: ["review-queue"],
  snapshots: ["local-snapshots"],
  references: ["refs"],
  reliability: ["scorecards"],
  lists: ["task-lists", "tl"],
} as const satisfies Record<string, readonly string[]>;

/**
 * Verbs that render content BUNDLED INTO THE PACKAGE, mapped to the options on
 * each that instead reach the local store. An empty list means every form of
 * the verb is store-free.
 *
 * `manual` and `completions` already render bundled static content on the /v1
 * route; these four did not, and were refused as `local-only` even though the
 * shipped manual documents `todos workflows` in its own examples (task
 * 3e5e773f).
 *
 * The mapping is per-OPTION rather than per-VERB because two of these are
 * genuinely mixed, so reclassifying the verb wholesale would admit an
 * invocation that opens bun:sqlite on a route where the SQLite fallback is
 * disabled. Measured against an isolated `HASNA_TODOS_DB_PATH`, with `todos
 * list` as the positive control for "a database appears when one is needed":
 * `onboarding --import` reaches `importLocalBridgeBundle`, and `sdk-fixtures
 * --show/--write` reach `ensureFixtureImported`, which runs a NON-dry-run
 * bridge import — all three land in `getDatabase()`. Every other form of all
 * four verbs created no database.
 *
 * `--write` differs between the two: on `onboarding` it serialises the bundled
 * fixture to disk (store-free), while on `sdk-fixtures` it writes a pack whose
 * construction imports the fixture first. Same flag name, different reach,
 * which is why this is keyed per verb rather than by flag name globally.
 */
const BUNDLED_STATIC_COMMANDS = {
  workflows: [],
  "template-library": [],
  onboarding: ["--import"],
  "sdk-fixtures": ["--show", "--write"],
} as const satisfies Record<string, readonly string[]>;

/**
 * The same mapping widened to aliases, derived from the alias table so a new
 * alias cannot silently acquire a different capability from its canonical verb.
 */
const BUNDLED_STATIC_STORE_BACKED_OPTIONS = new Map<string, readonly string[]>();
for (const [canonical, storeBackedOptions] of Object.entries(BUNDLED_STATIC_COMMANDS)) {
  BUNDLED_STATIC_STORE_BACKED_OPTIONS.set(canonical, storeBackedOptions);
  const aliases = (TODOS_CLI_COMMAND_ALIASES as Record<string, readonly string[] | undefined>)[canonical] ?? [];
  for (const alias of aliases) BUNDLED_STATIC_STORE_BACKED_OPTIONS.set(alias, storeBackedOptions);
}

const DIAGNOSTIC_COMMANDS = new Set([
  "help", "manual", "completions", "completion", "config", "storage",
  ...Object.keys(BUNDLED_STATIC_COMMANDS),
]);
const REMOTE_COMMANDS = new Set([
  // `delegate` MUST be here as well as in the canonical list above. Membership
  // of the canonical list alone leaves a verb defaulted to `local-only`, which
  // on the /v1 route is refused outright — the state `dispatch` is in today.
  // Shipping the replacement for abandoned dispatch in that state would make it
  // dead on exactly the fleet it was built for. Covered by delegate-routing.test.ts.
  "active", "add", "agent", "agents", "ai", "approve", "assign", "bulk", "claim", "comment", "count", "delegate", "delete", "deps", "fail",
  "doctor", "done", "find-commit", "find-ref", "health", "heartbeat", "history", "init", "inspect", "link-commit",
  "link-ref", "list", "lists", "lock", "log-progress", "move", "next", "plans", "project-registration", "project-rename", "project-resources", "projects", "recap",
  "record-verification", "release", "remove", "show", "standup", "start", "status", "tag", "task", "task-lists",
  "stale-lock-handoff", "task-manifest", "task-subtree-transfer", "template-export", "template-import", "template-preview", "templates", "timeline", "tl", "unlock", "unassign", "untag", "update",
]);
const REMOTE_COMMAND_CAPABILITIES =
  new Map<string, TodosRemoteCommandCapability>([
    ["stale-lock-handoff", "stale-lock-handoff"],
  ]);
for (const [canonical, aliases] of Object.entries(TODOS_CLI_COMMAND_ALIASES)) {
  const requiredCapability = REMOTE_COMMAND_CAPABILITIES.get(canonical);
  if (!requiredCapability) continue;
  for (const alias of aliases) REMOTE_COMMAND_CAPABILITIES.set(alias, requiredCapability);
}

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

/**
 * Whether a top-level command should be advertised (help/manual/completions) for
 * a resolved authority route. Remote help describes the authority-served
 * surface, while explicitly admitted workstation redaction invocations can
 * select the local route before command modules load. Diagnostic and
 * remote-http owners stay visible. Commands with no capability owner (e.g. optional
 * dynamically-registered families) self-gate at runtime and remain visible.
 */
export function isTodosCliCommandVisibleForRoute(
  command: string,
  route: TodosCliAuthorityInitialization["route"],
  remoteCapabilities: ReadonlySet<TodosRemoteCommandCapability> = new Set(),
): boolean {
  if (route === "local") return true;
  const owner = COMMAND_CAPABILITY_MATRIX.get(command);
  if (!owner) return true;
  if (owner === "local-only") return false;
  const requiredCapability = REMOTE_COMMAND_CAPABILITIES.get(command);
  return requiredCapability ? remoteCapabilities.has(requiredCapability) : true;
}

/**
 * Filter commander help to the authority-served catalog. Explicitly named
 * admitted local redaction invocations select their own local route, but
 * local-only commands are omitted from remote metadata so help, manual, and
 * completions continue to describe the shared /v1 surface.
 */
export function applyTodosCliHelpVisibility(
  program: Command,
  route: TodosCliAuthorityInitialization["route"],
  remoteCapabilities: ReadonlySet<TodosRemoteCommandCapability> = new Set(),
): void {
  if (route === "local") return;
  program.configureHelp({
    visibleCommands(this: Help, command: Command): Command[] {
      return Help.prototype.visibleCommands
        .call(this, command)
        .filter((subcommand) =>
          isTodosCliCommandVisibleForRoute(subcommand.name(), route, remoteCapabilities));
    },
  });
}

/**
 * Return the explicitly requested remote metadata command when its deployed-
 * authority capability is absent. Commander help filtering controls only the
 * parent command list; a still-registered command remains resolvable through
 * both `<command> --help` and `help <command>`. This guard gives named help the
 * same generic capability decision already used by aggregate help, manuals,
 * and completions. Ordinary command execution stays registered so its action
 * can return the specific compatibility error.
 */
export function getUnavailableTodosCliRemoteMetadataCommand(
  route: TodosCliAuthorityInitialization["route"],
  remoteCapabilities: ReadonlySet<TodosRemoteCommandCapability> = new Set(),
  args: readonly string[] = [],
): string | null {
  if (route === "local") return null;
  const invocation = parseInvocation([...args]);
  if (!isMetadataInvocation([...args], invocation)) return null;
  const requestedCommand = invocation.command === "help"
    ? positionalArgs(invocation.commandArgs)[0]
    : invocation.command;
  if (!requestedCommand) return null;
  const requiredCapability = REMOTE_COMMAND_CAPABILITIES.get(requestedCommand);
  return requiredCapability && !remoteCapabilities.has(requiredCapability)
    ? requestedCommand
    : null;
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

/**
 * Human-readable label for a refused invocation. Skips positionals that are the
 * VALUE of a preceding `--option value` pair so a refusal never presents an
 * option argument (e.g. a tag name) as though it were a subcommand.
 */
function invocationLabel(invocation: ParsedInvocation): string {
  const args = invocation.commandArgs;
  let detail: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg.startsWith("-")) {
      // `--option value` consumes the next token; `--option=value` does not.
      if (!arg.includes("=")) index += 1;
      continue;
    }
    detail = arg;
    break;
  }
  return [invocation.command, detail].filter(Boolean).join(" ") || "this invocation";
}

function hasOption(args: readonly string[], option: string): boolean {
  return args.some((arg) => arg === option || arg.startsWith(`${option}=`));
}

function positionalArgs(args: readonly string[]): string[] {
  return args.filter((arg) => !arg.startsWith("-"));
}

/**
 * Local redaction configuration and scanning are workstation operations even
 * when the task authority is hosted. Keep this exception narrower than the
 * top-level `local-only` owner: `redaction evidence` reads or mutates task rows
 * and must not silently switch away from the configured authority.
 */
function isHostedLocalInvocation(invocation: ParsedInvocation): boolean {
  if (invocation.command !== "redaction") return false;
  const subcommand = positionalArgs(invocation.commandArgs)[0];
  return subcommand === "status" || subcommand === "add" || subcommand === "scan";
}

/**
 * Whether this invocation of a bundled-content verb stays inside the package's
 * own static assets. Mirrors `isReadOnlyConfigInvocation`: the verb is
 * diagnostic, and the ARGUMENTS decide whether this particular call is
 * serviceable without a store.
 */
function isBundledStaticInvocation(invocation: ParsedInvocation): boolean {
  const command = invocation.command;
  if (!command) return false;
  const storeBackedOptions = BUNDLED_STATIC_STORE_BACKED_OPTIONS.get(command);
  if (!storeBackedOptions) return false;
  return !storeBackedOptions.some((option) => hasOption(invocation.commandArgs, option));
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
  // Bundled workflow prompts, template library, onboarding fixtures and SDK
  // fixture examples are package assets, not stored records, so the store-free
  // forms must render offline on the /v1 route exactly as `manual` does.
  if (isBundledStaticInvocation(invocation)) return true;
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

/** First option in `candidates` present on `args`, for blaming the right token. */
function firstPresentOption(args: readonly string[], candidates: readonly string[]): Disqualification | null {
  const option = candidates.find((candidate) => hasOption(args, candidate));
  return option ? dropIt(option) : null;
}

/**
 * For a verb that IS remote-capable, the specific token that disqualifies this
 * invocation — or null when the invocation is serviceable. Naming the token
 * matters: "list is not supported" sends the reader to debug the wrong thing
 * when `list` works and only `--recurring` does not.
 */
interface Disqualification {
  /** The token to blame, rendered into the message. */
  blame: string;
  /** What the caller should actually do about it. */
  remedy: string;
}

const dropIt = (blame: string): Disqualification => ({ blame, remedy: "re-run without it" });

function disqualifyingArgument(invocation: ParsedInvocation): Disqualification | null {
  const command = invocation.command!;
  const args = invocation.commandArgs;
  // A bundled-content verb whose store-free forms DO work here. Blaming the
  // verb would send the reader to debug `sdk-fixtures`, which is fine on its
  // own; only the option that triggers a local bridge import is not.
  const storeBackedOptions = BUNDLED_STATIC_STORE_BACKED_OPTIONS.get(command);
  if (storeBackedOptions) {
    const option = storeBackedOptions.find((candidate) => hasOption(args, candidate));
    return option
      ? {
          blame: option,
          remedy: `it imports bundled fixtures into the local store, which this route disables; re-run \`${command}\` without it to read the bundled content`,
        }
      : null;
  }
  switch (command) {
    case "task":
      return positionalArgs(args)[0] === "upsert"
        ? null
        : { blame: "any subcommand other than `upsert`", remedy: "use `todos task upsert`" };
    case "doctor":
      if (positionalArgs(args)[0] === "routing") return dropIt("the `routing` subcommand");
      return firstPresentOption(args, ["--apply", "--fix"]);
    case "projects":
      if (hasOption(args, "--deregister")) return null;
      return firstPresentOption(args, ["--path-prefix", "--dry-run"]);
    case "plans":
      return firstPresentOption(args, ["--artifact", "--write-artifacts"]);
    // `list --tags/--tag` is serviced remotely: the /v1 list route filters by
    // tag server-side and the cloud router preflights the capability against
    // the authority's OpenAPI contract (task 90c0b178).
    case "list":
      return firstPresentOption(args, ["--recurring"]);
    case "claim":
      if (invocation.globalOptions.has("--project")) return dropIt("--project");
      return firstPresentOption(args, ["--project", "--stale-minutes", "--steal-stale"]);
    case "status":
      if (invocation.globalOptions.has("--agent")) return dropIt("--agent");
      return firstPresentOption(args, ["--agent"]);
    case "bulk": {
      const action = positionalArgs(args)[0];
      // `bulk plan|move-plan` reassigns tasks through the shared /v1 dataset
      // (plan ref resolved remotely, then PATCH /v1/tasks/<id>), so it is
      // serviced remotely. The other actions carry no plan semantics, so the
      // plan flags stay rejected there rather than being silently ignored.
      if (action === "plan" || action === "move-plan") return null;
      // `bulk tag|untag` reads each row, merges tags, and PATCHes /v1/tasks/<id>,
      // so it is serviced remotely. It exists so provenance backfill —
      // stamping `directive:<knowledge-id>` onto work created before the
      // convention — does not cost one process per task.
      if (action === "tag" || action === "untag") {
        // Fail closed on an empty request: a bulk run with nothing to apply
        // would report success across every id and look like a completed
        // backfill.
        if (!hasOption(args, "--tag") && !hasOption(args, "--tags")) {
          return {
            blame: `\`bulk ${action}\` without --tag`,
            remedy: `pass --tag <comma-separated>, e.g. bulk ${action} <ids...> --tag directive:k_msd4cz8t_ste6f4`,
          };
        }
        return firstPresentOption(args, ["--plan", "--clear-plan"]);
      }
      if (!action) {
        // "re-run without it" does not parse when nothing was given.
        return { blame: "a missing action", remedy: "pass one of done, complete, start, delete, plan, move-plan, tag, untag" };
      }
      if (!["done", "complete", "start", "delete"].includes(action)) {
        return {
          blame: `the \`${action}\` action`,
          remedy: "use one of done, complete, start, delete, plan, move-plan, tag, untag",
        };
      }
      return firstPresentOption(args, ["--plan", "--clear-plan"]);
    }
    // Everything else — `deps` included — is serviced remotely in full.
    // `deps <id>` (read edges), `--needs`/`--remove` (write edges), and the
    // presentation-only `--graph`/`--direction` flags all reach the cloud
    // handler, which renders the shared dependency/blocked-by edges and, since
    // the recursive graph is a local-only view, gracefully falls back to those
    // same flat edges for `--graph`/`--direction` instead of failing closed.
    default:
      return null;
  }
}

function commandSupportsRemote(invocation: ParsedInvocation): boolean {
  const command = invocation.command;
  if (!command || COMMAND_CAPABILITY_MATRIX.get(command) !== "remote-http") return false;
  return disqualifyingArgument(invocation) === null;
}

/** Restricted Damerau-Levenshtein distance, capped so long words exit early. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  // Transposition needs the row TWO back, not one; keeping only a single
  // previous row silently degrades this to plain Levenshtein and `dnoe` stops
  // matching `done`.
  let twoBack: number[] = new Array<number>(cols).fill(0);
  let previous = Array.from({ length: cols }, (_, index) => index);
  for (let row = 1; row < rows; row += 1) {
    const current = [row, ...new Array<number>(cols - 1).fill(0)];
    for (let col = 1; col < cols; col += 1) {
      const substitution = previous[col - 1]! + (a[row - 1] === b[col - 1] ? 0 : 1);
      current[col] = Math.min(current[col - 1]! + 1, previous[col]! + 1, substitution);
      if (row > 1 && col > 1 && a[row - 1] === b[col - 2] && a[row - 2] === b[col - 1]) {
        current[col] = Math.min(current[col]!, twoBack[col - 2]! + 1);
      }
    }
    twoBack = previous;
    previous = current;
  }
  return previous[cols - 1]!;
}

/**
 * Closest real verbs to an unrecognised one. The threshold scales with length
 * so short words do not match everything and long words tolerate a typo.
 */
function nearestCommands(command: string, limit = 3): string[] {
  const threshold = command.length <= 4 ? 1 : command.length <= 8 ? 2 : 3;
  // Keep suggestions on the selected remote authority surface. Workstation
  // redaction invocations are admitted explicitly, but local-only commands are
  // deliberately not advertised by remote help or typo recovery.
  return [...COMMAND_CAPABILITY_MATRIX.entries()]
    .filter(([, owner]) => owner !== "local-only")
    .map(([candidate]) => candidate)
    .map((candidate) => ({ candidate, distance: editDistance(command, candidate) }))
    .filter(({ distance }) => distance <= threshold)
    .sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

/**
 * Explain a Stage A refusal in terms of what the caller can actually change.
 *
 * Three unrelated conditions used to collapse into one string that asserted a
 * transport limitation ("not supported by the Todos /v1 CLI; local SQLite
 * fallback is disabled"). For a verb that does not exist, both of those
 * clauses are false — it is unsupported everywhere and no fallback would
 * accept it — so readers went and debugged their connection, storage mode and
 * credentials instead of their command. Every branch below names a remedy in
 * its own text.
 */
function assertInvocationRoutable(invocation: ParsedInvocation): TodosCliCommandOwner | undefined {
  if (invocation.invalidGlobalOption) {
    throw new Error(
      `REMOTE_COMMAND_UNSUPPORTED: the global option ${invocation.invalidGlobalOption} was given without a value; ` +
        `pass one as \`${invocation.invalidGlobalOption} <value>\``,
    );
  }
  if (invocation.unknownLeadingOption) {
    throw new Error(
      `REMOTE_COMMAND_UNSUPPORTED: unknown option ${invocation.unknownLeadingOption} before the command; ` +
        "run `todos --help` for the global options",
    );
  }

  const command = invocation.command;
  const owner = command ? COMMAND_CAPABILITY_MATRIX.get(command) : undefined;

  if (command && !owner) {
    // Stage A runs before any command module loads, so all it can know is that
    // this verb is absent from the static registry. That covers two cases: a
    // typo, and a command that an OPTIONAL package (e.g. `@hasna/events`,
    // which contributes `channels`) registers later in the boot. Neither is
    // reachable on the /v1 route, so the message is framed on the route rather
    // than asserting the verb does not exist — claiming that about a real
    // command would be a worse lie than the one this fix removes.
    const suggestions = nearestCommands(command);
    const didYouMean = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";
    throw new Error(
      `UNKNOWN_COMMAND: \`${command}\` is not a built-in todos command on the /v1 route.${didYouMean} ` +
        "Run `todos --help` for the commands available here; verbs contributed by optional packages are local-only. " +
        "(This is not a connectivity or credential problem.)",
    );
  }

  return owner;
}

function assertRemoteCommandSupported(
  invocation: ParsedInvocation,
  owner: TodosCliCommandOwner | undefined,
): void {
  const command = invocation.command;
  if (command && owner === "local-only") {
    throw new Error(
      `REMOTE_COMMAND_UNSUPPORTED: \`${command}\` is a local-only command and the Todos /v1 authority does not ` +
        "serve it; local SQLite fallback is disabled. Run `todos --help` to see the commands this route supports.",
    );
  }

  if (!command || !commandSupportsRemote(invocation)) {
    const blame = command ? disqualifyingArgument(invocation) : null;
    // A bundled-content verb is served from the package, NOT by the authority,
    // so the usual lead clause would point the reader at /v1 for a refusal that
    // has nothing to do with it.
    const servedBy = command && BUNDLED_STATIC_STORE_BACKED_OPTIONS.has(command)
      ? `\`${command}\` renders bundled content on this route`
      : `\`${command}\` is served by the Todos /v1 authority`;
    const detail = blame
      ? `${servedBy} but ${blame.blame} is not; ${blame.remedy}`
      : `${invocationLabel(invocation)} is not supported by the Todos /v1 CLI; local SQLite fallback is disabled`;
    throw new Error(`REMOTE_COMMAND_UNSUPPORTED: ${detail}`);
  }
}

/**
 * Stage A runs before importing any command module that can reach SQLite or
 * native Postgres adapters. It validates the complete mode state, routes only
 * admitted workstation redaction invocations to the local transport, gates
 * the remote command surface, then constructs only the authenticated HTTP
 * client for remote-supported commands.
 */
export function initializeTodosCliAuthority(
  args: string[] = process.argv.slice(2),
  env: Env = process.env as Env,
): TodosCliAuthorityInitialization {
  let resolution: TodosCliTransportResolution;
  try {
    resolution = resolveTodosCliTransport(env);
  } catch (error) {
    // A partial API pair (URL without KEY, or KEY without URL) — or a fully
    // absent pair without the explicit local opt-in (fail closed, hasna/apps#1613)
    // — is a hard error for real commands, but DIAGNOSTIC commands must still
    // boot so they can report the misconfiguration through their own status
    // surface.
    const invocation = parseInvocation(args);
    if (isMetadataInvocation(args, invocation)) {
      const status = getTodosRemoteAuthorityConfigStatus(env);
      return { route: "remote-diagnostic", v1_base_url: status.v1_base_url };
    }
    throw error;
  }
  // The sqlite transport is reachable ONLY under the explicit local opt-in
  // (HASNA_TODOS_LOCAL=1 / TODOS_LOCAL=1); a resolution with neither the pair
  // nor the opt-in would have thrown above, never landed here.
  if (!resolution.selected) return { route: "local", v1_base_url: null };

  const invocation = parseInvocation(args);
  if (isMetadataInvocation(args, invocation)) {
    const status = getTodosRemoteAuthorityConfigStatus(env);
    return { route: "remote-diagnostic", v1_base_url: status.v1_base_url };
  }

  const owner = assertInvocationRoutable(invocation);
  if (owner === "local-only" && isHostedLocalInvocation(invocation)) {
    return { route: "local", v1_base_url: null, selected_by: "local-only-command" };
  }

  assertRemoteCommandSupported(invocation, owner);
  const client = getTodosCloudClient(env);
  if (!client) {
    throw new Error("REMOTE_API_UNAVAILABLE: HTTP routing did not resolve an authenticated /v1 client; local SQLite fallback is disabled");
  }
  return { route: "remote-http", v1_base_url: client.baseUrl };
}
