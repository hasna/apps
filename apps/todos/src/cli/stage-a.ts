import {
  getTodosCloudClient,
  getTodosRemoteAuthorityConfigStatus,
  resolveTodosCliTransport,
  type TodosCliTransportResolution,
} from "./cloud-router.js";

type Env = Record<string, string | undefined>;

export type TodosCliAuthorityInitialization =
  | { route: "local"; v1_base_url: null; local_store: "opt-in" | "configured-authority" }
  | { route: "remote-diagnostic"; v1_base_url: string | null }
  | { route: "remote-http"; v1_base_url: string };

/**
 * Stage A is intentionally pure: it decides the authority route without
 * mutating the caller's environment. The executable applies an admitted local
 * redaction decision before importing command modules so any later
 * `getTodosCloudClient()` call cannot reconstruct hosted routing.
 *
 * The load-bearing line is the OPT-IN, not the redaction. Since the credential
 * chain moved into @hasna/contracts (hasna/apps#1720) a key can arrive from the
 * macOS Keychain or from `~/.hasna/todos/config/credentials`, neither of which
 * an environment dictionary can redact — so clearing the API variables alone
 * would leave a later `getTodosCloudClient()` resolving a real hosted client
 * for a command that was admitted precisely because it must stay local.
 * `HASNA_TODOS_LOCAL=1` is answered BEFORE the resolver runs, so it is what
 * actually holds the decision; the variables are cleared alongside it so a
 * child process inherits an environment that says the same thing.
 *
 * DELETED, not blanked: the resolver refuses a declared-but-blank
 * `HASNA_TODOS_API_URL` / `HASNA_TODOS_API_KEY` loudly instead of reading it as
 * absent, so blanking would convert "no cloud client" into a hard error.
 */
/**
 * The one line an on-box run prints, and the reason it prints at all.
 *
 * A CLI that touches the on-box SQLite store without saying so looks exactly
 * like a hosted one whose store happens to be empty — that is the false green
 * the 2026-09-04 ruling (hasna/apps#1720) closes, and it is why the notice is
 * unconditional rather than behind a verbosity flag. It goes to STDERR so
 * `--json` output stays a clean parseable document on stdout, and it names the
 * credential the run did NOT find, so the fix is in the message rather than in
 * the docs.
 *
 * There are exactly two reasons an on-box run happens:
 *   - `opt-in`: the operator set HASNA_TODOS_LOCAL=1 and no authority or
 *     credential is configured, so the run serves the on-box SQLite store.
 *   - `configured-authority`: the command's data plane is the workstation
 *     store (machine registry, backups, redaction patterns, bridge fixtures),
 *     and it reads or writes that store even though a hosted authority IS
 *     configured. The run says so instead of pretending it reached the fleet.
 */
export function todosLocalStoreNotice(
  kind: "opt-in" | "configured-authority" = "opt-in",
  command?: string,
): string {
  if (kind === "configured-authority") {
    return (
      `todos: ${command ?? "this command"} reads the on-box SQLite store, not the hosted fleet; ` +
      "the configured Todos authority is not consulted for this run."
    );
  }
  return (
    "todos: this run is unhosted — using the on-box SQLite store, not the hosted fleet " +
    "(HASNA_TODOS_LOCAL is set). Unset it, and provide a credential via the Keychain item " +
    "hasna.credentials.todos.api-key, ~/.hasna/todos/config/credentials, or HASNA_TODOS_API_KEY, " +
    "to work against https://api.hasna.com/todos."
  );
}

/**
 * Print {@link todosLocalStoreNotice} once for a run that resolved to the
 * on-box store. A no-op for every hosted route, so a hosted run's stderr stays
 * empty.
 */
export function announceTodosCliStore(
  authority: TodosCliAuthorityInitialization,
  write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): boolean {
  if (authority.route !== "local") return false;
  const command = invocationCommand(process.argv.slice(2));
  write(todosLocalStoreNotice(authority.local_store, command ?? undefined));
  return true;
}

/**
 * The environment of an on-box run: hosted authority and credential variables
 * are REMOVED (not blanked) and the on-box opt-in is stamped, so a child
 * process (ssh, scp, fixture imports) inherits an environment that says the
 * same thing and cannot reconstruct hosted routing.
 */
export function applyTodosCliAuthorityEnvironment(
  authority: TodosCliAuthorityInitialization,
  env: Env = process.env as Env,
): void {
  if (authority.route !== "local") return;
  delete env.HASNA_TODOS_API_URL;
  delete env.HASNA_TODOS_API_KEY;
  env.TODOS_API_URL = "";
  delete env.TODOS_API_KEY;
  delete env.HASNA_TODOS_API_KEY_OVERRIDE;
  delete env.HASNA_TODOS_API_KEY_REF;
  delete env.HASNA_PROFILE;
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
 * each that instead reach the on-box store. An empty list means every form of
 * the verb is store-free.
 *
 * `manual` and `completions` already render bundled static content on the /v1
 * route; these four did not, and were refused as if they depended on the
 * transport even though the shipped manual documents `todos workflows` in its
 * own examples (task 3e5e773f).
 *
 * The mapping is per-OPTION rather than per-VERB because two of these are
 * genuinely mixed. Measured against an isolated `HASNA_TODOS_DB_PATH`, with
 * `todos list` as the positive control for "a database appears when one is
 * needed": `onboarding --import` reaches `importLocalBridgeBundle`, and
 * `sdk-fixtures --show/--write` reach `ensureFixtureImported`, which runs a
 * NON-dry-run bridge import — all three land in `getDatabase()`. Every other
 * form of all four verbs created no database.
 *
 * `--write` differs between the two: on `onboarding` it serialises the bundled
 * fixture to disk (store-free), while on `sdk-fixtures` it writes a pack whose
 * construction imports the fixture first. Same flag name, different reach,
 * which is why this is keyed per verb rather than by flag name globally.
 */
const STORE_BACKED_BUNDLED_OPTIONS = {
  workflows: [],
  "template-library": [],
  onboarding: ["--import"],
  "sdk-fixtures": ["--show", "--write"],
} as const satisfies Record<string, readonly string[]>;

/**
 * The same mapping widened to aliases, derived from the alias table so a new
 * alias cannot silently acquire a different store from its canonical verb.
 */
const STORE_BACKED_BUNDLED_OPTION_LOOKUP = new Map<string, readonly string[]>();
for (const [canonical, storeBackedOptions] of Object.entries(STORE_BACKED_BUNDLED_OPTIONS)) {
  STORE_BACKED_BUNDLED_OPTION_LOOKUP.set(canonical, storeBackedOptions);
  const aliases = (TODOS_CLI_COMMAND_ALIASES as Record<string, readonly string[] | undefined>)[canonical] ?? [];
  for (const alias of aliases) STORE_BACKED_BUNDLED_OPTION_LOOKUP.set(alias, storeBackedOptions);
}

/**
 * Top-level verbs whose data plane is the WORKSTATION STORE: they read and
 * write the on-box SQLite store (or local files) in every transport. They are
 * served by the on-box store, not by the hosted /v1 authority, and a run that
 * touches them while a hosted authority is configured says so on stderr.
 *
 * This is a STORE classification, not a capability gate: every command is
 * registered, advertised in help/manual/completions and executed in both
 * transports. The classification only decides which store the run serves and
 * what the one-line notice says.
 */
const STORE_FREE_COMMANDS = new Set([
  "help", "manual", "completions", "completion", "config", "storage",
  ...Object.keys(STORE_BACKED_BUNDLED_OPTIONS),
]);
const HOSTED_COMMANDS = new Set([
  // `delegate` MUST be here as well as in the canonical list above. Membership
  // of the canonical list alone would leave a verb defaulted to the on-box
  // store, which is not where delegate's brief, depth, lineage and assignment
  // live on the fleet it was built for. Covered by delegate-routing.test.ts.
  "active", "add", "agent", "agents", "ai", "approve", "assign", "bulk", "claim", "comment", "count", "delegate", "delete", "deps", "fail",
  "doctor", "done", "find-commit", "find-ref", "health", "heartbeat", "history", "init", "inspect", "link-commit",
  "link-ref", "list", "lists", "lock", "log-progress", "move", "next", "plans", "project-registration", "project-rename", "project-resources", "projects", "recap",
  "record-verification", "release", "remove", "show", "standup", "start", "status", "tag", "task", "task-lists",
  "stale-lock-handoff", "task-manifest", "task-subtree-transfer", "template-export", "template-import", "template-preview", "templates", "timeline", "tl", "unlock", "unassign", "untag", "update",
]);

// Aliases inherit their canonical verb's store: the classification is keyed on
// the verb's data plane, and an alias is the same verb.
for (const [canonical, aliases] of Object.entries(TODOS_CLI_COMMAND_ALIASES)) {
  for (const alias of aliases) {
    if (STORE_FREE_COMMANDS.has(canonical)) STORE_FREE_COMMANDS.add(alias);
    if (HOSTED_COMMANDS.has(canonical)) HOSTED_COMMANDS.add(alias);
  }
}

/** Every registered canonical verb, with its aliases folded in. */
const ALL_REGISTERED_COMMANDS = new Set<string>(REGISTERED_CANONICAL_COMMANDS);
for (const [canonical, aliases] of Object.entries(TODOS_CLI_COMMAND_ALIASES)) {
  ALL_REGISTERED_COMMANDS.add(canonical);
  for (const alias of aliases) ALL_REGISTERED_COMMANDS.add(alias);
}
const ALL_REGISTERED_COMMANDS_READONLY = ALL_REGISTERED_COMMANDS;

/** Top-level verbs served by the on-box workstation store (see above). */
const ON_BOX_STORE_COMMANDS = new Set<string>();
for (const command of ALL_REGISTERED_COMMANDS_READONLY) {
  if (STORE_FREE_COMMANDS.has(command)) continue;
  if (HOSTED_COMMANDS.has(command)) continue;
  ON_BOX_STORE_COMMANDS.add(command);
}

/**
 * The on-box store verb set, canonical names and aliases, for tests and
 * diagnostics. This describes WHERE a verb's data plane lives; it does not
 * gate the command surface — every verb is advertised and executed in every
 * transport.
 */
export function getTodosCliOnBoxStoreCommands(): ReadonlySet<string> {
  return ON_BOX_STORE_COMMANDS;
}

/**
 * Whether an invocation serves the on-box workstation store even when a hosted
 * authority is configured. The command surface itself is transport-neutral —
 * this only decides which STORE the run reads and writes, and the one-line
 * notice that says so.
 */
export function isTodosCliOnBoxStoreInvocation(
  invocation: ParsedInvocation,
): boolean {
  const command = invocation.command;
  if (!command) return false;
  if (ON_BOX_STORE_COMMANDS.has(command)) return true;

  // Bundled-content verbs whose store-free forms render from the package: the
  // forms that reach the on-box store (fixture imports) serve the workstation
  // store even when a hosted authority is configured.
  const storeBackedOptions = STORE_BACKED_BUNDLED_OPTION_LOOKUP.get(command);
  if (storeBackedOptions && storeBackedOptions.some((option) => hasOption(invocation.commandArgs, option))) {
    return true;
  }

  const positional = positionalArgs(invocation.commandArgs);
  const first = positional[0];
  switch (command) {
    case "task":
      // `task upsert` is served by /v1 for the shared dataset; every other
      // `task` subcommand reads deterministic routing state off the on-box
      // store.
      return first !== "upsert";
    case "doctor":
      // `doctor routing` and the repair flags operate on the on-box store:
      // routing eligibility is a workstation concept, and --apply repairs
      // local schema. The plain diagnostic run is served by /v1.
      return first === "routing" || hasOption(invocation.commandArgs, "--apply") || hasOption(invocation.commandArgs, "--fix");
    case "plans":
      // Plan artifacts are local Markdown files: `--artifact` inspects them,
      // `--write-artifacts` writes them. The plan data comes from whichever
      // store the run serves, but the artifact surface is the workstation.
      return hasOption(invocation.commandArgs, "--artifact") || hasOption(invocation.commandArgs, "--write-artifacts");
    case "storage":
      // `storage status` is a store-free diagnostic; artifact upload/download
      // and the native storage configuration surface are on-box.
      return first !== undefined && first !== "status";
    default:
      return false;
  }
}

/**
 * Whether an invocation of a bundled-content verb stays inside the package's
 * own static assets. Mirrors `isReadOnlyConfigInvocation`: the verb is
 * store-free, and the ARGUMENTS decide whether this particular call is
 * serviceable without a store.
 */
function isBundledStaticInvocation(invocation: ParsedInvocation): boolean {
  const command = invocation.command;
  if (!command) return false;
  const storeBackedOptions = STORE_BACKED_BUNDLED_OPTION_LOOKUP.get(command);
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
  // — with or without a shell argument — is a store-free invocation that must
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

function invocationCommand(args: readonly string[]): string | undefined {
  return parseInvocation([...args]).command;
}

function hasOption(args: readonly string[], option: string): boolean {
  return args.some((arg) => arg === option || arg.startsWith(`${option}=`));
}

function positionalArgs(args: readonly string[]): string[] {
  return args.filter((arg) => !arg.startsWith("-"));
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
 * Suggestions come from the FULL registered surface — the command catalog is
 * the same in every transport.
 */
function nearestCommands(command: string, limit = 3): string[] {
  const threshold = command.length <= 4 ? 1 : command.length <= 8 ? 2 : 3;
  return [...ALL_REGISTERED_COMMANDS_READONLY]
    .map((candidate) => ({ candidate, distance: editDistance(command, candidate) }))
    .filter(({ distance }) => distance <= threshold)
    .sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

/**
 * Validate a Stage A invocation that is NOT store-free and is NOT served by
 * the on-box store: the command must exist, and the global options must be
 * usable. There is no transport gate here — if the invocation names a known
 * verb, the route is decided and the command runs its own action.
 */
function assertInvocationKnown(invocation: ParsedInvocation): void {
  if (invocation.invalidGlobalOption) {
    throw new Error(
      `INVALID_GLOBAL_OPTION: the global option ${invocation.invalidGlobalOption} was given without a value; ` +
        `pass one as \`${invocation.invalidGlobalOption} <value>\``,
    );
  }
  if (invocation.unknownLeadingOption) {
    throw new Error(
      `UNKNOWN_GLOBAL_OPTION: unknown option ${invocation.unknownLeadingOption} before the command; ` +
        "run `todos --help` for the global options",
    );
  }

  const command = invocation.command;
  if (command && !ALL_REGISTERED_COMMANDS_READONLY.has(command)) {
    // Stage A runs before any command module loads, so all it can know is that
    // this verb is absent from the static registry. That covers two cases: a
    // typo, and a command that an OPTIONAL package (e.g. `@hasna/events`,
    // which contributes `channels`) registers later in the boot. Either way
    // the remedy is the same: the catalog is the authority.
    const suggestions = nearestCommands(command);
    const didYouMean = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";
    throw new Error(
      `UNKNOWN_COMMAND: \`${command}\` is not a built-in todos command.${didYouMean} ` +
        "Run `todos --help` for the commands available here.",
    );
  }
}

/**
 * Stage A runs before importing any command module that can reach SQLite or
 * native Postgres adapters. It validates the complete mode state, decides the
 * store for the invocation, then constructs only the authenticated HTTP client
 * for hosted-served invocations.
 *
 * The command SURFACE is identical in every transport: nothing is refused for
 * being on-box or hosted, help advertises everything, and the store a run
 * serves is decided by (1) the operator's own selection — a configured
 * authority, else the HASNA_TODOS_LOCAL opt-in, else fail closed — and (2)
 * the command's data plane (workstation-store verbs serve the on-box store
 * even when an authority is configured, and say so on stderr).
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
    // — is a hard error for real commands, but STORE-FREE commands must still
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
  if (!resolution.selected) {
    return { route: "local", v1_base_url: null, local_store: "opt-in" };
  }

  const invocation = parseInvocation(args);
  if (isMetadataInvocation(args, invocation)) {
    const status = getTodosRemoteAuthorityConfigStatus(env);
    return { route: "remote-diagnostic", v1_base_url: status.v1_base_url };
  }

  assertInvocationKnown(invocation);

  // Workstation-store verbs serve the on-box store even when a hosted
  // authority is configured. The run is announced on stderr, so it is never
  // mistaken for a hosted read.
  if (isTodosCliOnBoxStoreInvocation(invocation)) {
    return { route: "local", v1_base_url: null, local_store: "configured-authority" };
  }

  const client = getTodosCloudClient(env);
  if (!client) {
    throw new Error("REMOTE_API_UNAVAILABLE: HTTP routing did not resolve an authenticated /v1 client");
  }
  return { route: "remote-http", v1_base_url: client.baseUrl };
}