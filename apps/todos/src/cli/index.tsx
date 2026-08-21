#!/usr/bin/env bun
import { Command } from "commander";
import { getPackageVersion } from "../lib/package-version.js";
import {
  applyTodosCliAuthorityEnvironment,
  applyTodosCliHelpVisibility,
  getUnavailableTodosCliRemoteMetadataCommand,
  initializeTodosCliAuthority,
  type TodosCliAuthorityInitialization,
} from "./stage-a.js";
import {
  getTodosCloudClient,
  getTodosRemoteCommandCapabilities,
  type TodosRemoteCommandCapability,
} from "./cloud-router.js";

const program = new Command();

type RegisterEventsCommands = (
  program: Command,
  options: {
    source: string;
    channelsCommandName?: string;
  },
) => void;

function fallbackJsonRequested(): boolean {
  return program.opts().json === true || process.argv.includes("--json");
}

function registerUnavailableEventsCommands(program: Command): void {
  const events = program
    .command("events")
    .description("Emit, list, and replay Hasna events");

  events
    .command("list")
    .description("List recorded events")
    .option("--json", "Output as JSON")
    .action(() => {
      if (fallbackJsonRequested()) {
        console.log(JSON.stringify([]));
        return;
      }
      console.log("No events available. Optional @hasna/events commands are not installed.");
    });

  events
    .command("emit <type>")
    .description("Emit an event from this app")
    .option("--json", "Output as JSON")
    .action((type: string) => {
      if (fallbackJsonRequested()) {
        console.log(JSON.stringify({ emitted: false, type, reason: "events_unavailable" }));
        return;
      }
      console.error("Optional @hasna/events commands are not installed.");
      process.exitCode = 1;
    });

  events
    .command("replay")
    .description("Replay recorded events")
    .option("--json", "Output as JSON")
    .action(() => {
      if (fallbackJsonRequested()) {
        console.log(JSON.stringify({ replayed: 0, reason: "events_unavailable" }));
        return;
      }
      console.error("Optional @hasna/events commands are not installed.");
      process.exitCode = 1;
    });

  const webhooks = program
    .command("webhooks")
    .description("Manage Hasna event webhook subscriptions");

  webhooks
    .command("list")
    .description("List configured event webhooks")
    .option("--json", "Output as JSON")
    .action(() => {
      if (fallbackJsonRequested()) {
        console.log(JSON.stringify([]));
        return;
      }
      console.log("No webhooks available. Optional @hasna/events commands are not installed.");
    });
}

async function registerOptionalEventsCommands(program: Command): Promise<void> {
  const specifier = "@hasna/events/commander";
  try {
    const module = (await import(specifier)) as {
      registerEventsCommands?: RegisterEventsCommands;
    };
    if (module.registerEventsCommands) {
      module.registerEventsCommands(program, {
        source: "todos",
        channelsCommandName: "webhooks",
      });
      return;
    }
  } catch (error) {
    if (process.env["TODOS_DEBUG_EVENTS_IMPORT"] === "1") {
      console.warn(
        `Skipping optional @hasna/events CLI commands: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  registerUnavailableEventsCommands(program);
}

function commandForArgs(root: Command, args: readonly string[]): Command {
  let command = root;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg.startsWith("-")) {
      const option = command.options.find((candidate) =>
        candidate.long === arg || candidate.short === arg ||
        (candidate.long !== undefined && arg.startsWith(`${candidate.long}=`)) ||
        (candidate.short !== undefined && arg.startsWith(`${candidate.short}=`)),
      );
      if (option?.required || option?.optional) index += 1;
      continue;
    }
    const child = command.commands.find((candidate) =>
      candidate.name() === arg || candidate.aliases().includes(arg),
    );
    if (!child) break;
    command = child;
  }
  return command;
}

function unsupportedActiveFormatOption(command: Command, args: readonly string[]): string | null {
  if (command.name() !== "active") return null;
  const activeIndex = args.indexOf("active");
  if (activeIndex < 0) return null;
  return args
    .slice(activeIndex + 1)
    .find((arg) => arg === "--format" || arg.startsWith("--format=")) ?? null;
}

// Global options
program
  .name("todos")
  .description("Universal task management for AI coding agents")
  .version(getPackageVersion())
  .option("--project <path>", "Project path")
  .option("-j, --json", "Output as JSON")
  // NOT canonicalised here, deliberately, and the reason is worth keeping: a
  // parse-time fold on this flag was tried and reverted. It fixed the
  // claim/release round trip for `--agent`, but the flag is the wrong layer —
  // `claim <agent>` and `steal <agent>` take the agent POSITIONALLY, and the
  // MCP, TUI and dashboard writers never see this option at all, so the same
  // unreleasable-lock defect simply reappeared one verb over. It also broke a
  // legitimate consumer: `inspect` with no id looks up the caller's active task
  // by `assigned_to`, and folding the query made it miss rows stored with a
  // capitalised name. Lock-holder identity is now compared at the STORE
  // boundary instead (see `sameHolder` in src/db/task-lifecycle.ts), which
  // covers every writer and leaves this flag's value untouched for queries.
  .option("--agent <name>", "Agent name")
  .option("--session <id>", "Session ID");

// Validate and select remote HTTP authority before importing command modules.
// Those modules expose local helpers, so loading them before this boundary made
// packaged remote invocations hit the native adapter containment first.
let authority: TodosCliAuthorityInitialization;
try {
  authority = initializeTodosCliAuthority();
  applyTodosCliAuthorityEnvironment(authority);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

let remoteCommandCapabilities: ReadonlySet<TodosRemoteCommandCapability> = new Set();
const metadataRequested = authority.route === "remote-diagnostic";
if (authority.route !== "local" && metadataRequested) {
  try {
    const client = getTodosCloudClient();
    if (client) {
      remoteCommandCapabilities = await getTodosRemoteCommandCapabilities(client);
    }
  } catch {
    // Remote metadata fails closed: an unreachable or older authority cannot
    // make a version-gated mutation appear executable in help or completions.
    remoteCommandCapabilities = new Set();
  }
}

const [
  { handleError },
  { registerTaskCommands },
  { registerPlanTemplateCommands },
  { registerProjectCommands },
  { registerProjectRegistrationCommands },
  { registerAgentCommands },
  { registerAiCommands },
  { registerConfigServeCommands },
  { registerQueryCommands },
  { registerMcpHooksCommands },
  { registerDispatchCommands },
  { registerDelegateCommands },
  { registerMachineCommands },
  { registerApiKeyCommands },
  { registerEnvironmentSnapshotCommands },
  { registerKnowledgeCommands },
  { registerRiskCommands },
  { registerRetrospectiveCommands },
  { registerAgentReliabilityCommands },
  { registerOnboardingCommands },
  { registerLocalSnapshotCommands },
  { registerSdkFixtureCommands },
  { registerReviewQueueCommands },
  { registerRoadmapCommands },
  { registerCapacityCommands },
  { registerAuditLedgerCommands },
  { registerReleaseCompatibilityCommands },
  { registerUsageLedgerCommands },
  { registerLocalBackupCommands },
  { registerStorageCommands },
  { registerScaleHardeningCommands },
  { registerPrGroupCommands },
  { registerTaskManifestCommands },
  { registerTaskSubtreeTransferCommands },
  { registerHelpCommands },
] = await Promise.all([
  import("./helpers.js"),
  import("./commands/task-commands.js"),
  import("./commands/plan-template-commands.js"),
  import("./commands/project-commands.js"),
  import("./commands/project-registration-commands.js"),
  import("./commands/agent-commands.js"),
  import("./commands/ai-commands.js"),
  import("./commands/config-serve-commands.js"),
  import("./commands/query-commands.js"),
  import("./commands/mcp-hooks-commands.js"),
  import("./commands/dispatch.js"),
  // Inserted at the SAME ordinal as `registerDelegateCommands` in the
  // destructure above. The two arrays are positionally matched, so a
  // misaligned insert binds the wrong module and still typechecks.
  import("./commands/delegate.js"),
  import("./commands/machines.js"),
  import("./commands/api-key-commands.js"),
  import("./commands/environment-snapshots.js"),
  import("./commands/knowledge-commands.js"),
  import("./commands/risk-commands.js"),
  import("./commands/retrospective-commands.js"),
  import("./commands/agent-reliability-commands.js"),
  import("./commands/onboarding-commands.js"),
  import("./commands/local-snapshot-commands.js"),
  import("./commands/sdk-fixture-commands.js"),
  import("./commands/review-queue-commands.js"),
  import("./commands/roadmap-commands.js"),
  import("./commands/capacity-commands.js"),
  import("./commands/audit-ledger-commands.js"),
  import("./commands/release-compatibility-commands.js"),
  import("./commands/usage-ledger-commands.js"),
  import("./commands/local-backup-commands.js"),
  import("./commands/storage-commands.js"),
  import("./commands/scale-hardening-commands.js"),
  import("./commands/pr-group-commands.js"),
  import("./commands/task-manifest-commands.js"),
  import("./commands/task-subtree-transfer-commands.js"),
  import("./commands/help-commands.js"),
]);

registerTaskCommands(program);
registerPlanTemplateCommands(program);
registerProjectCommands(program);
registerProjectRegistrationCommands(program);
registerAgentCommands(program);
registerAiCommands(program);
registerConfigServeCommands(program);
registerQueryCommands(program);
registerMcpHooksCommands(program);
registerDispatchCommands(program);
registerDelegateCommands(program);
registerMachineCommands(program);
registerApiKeyCommands(program);
registerEnvironmentSnapshotCommands(program);
registerKnowledgeCommands(program);
registerRiskCommands(program);
registerRetrospectiveCommands(program);
registerAgentReliabilityCommands(program);
registerOnboardingCommands(program);
registerLocalSnapshotCommands(program);
registerSdkFixtureCommands(program);
registerReviewQueueCommands(program);
registerRoadmapCommands(program);
registerCapacityCommands(program);
registerAuditLedgerCommands(program);
registerReleaseCompatibilityCommands(program);
registerUsageLedgerCommands(program);
registerLocalBackupCommands(program);
registerStorageCommands(program);
registerScaleHardeningCommands(program);
registerPrGroupCommands(program);
registerTaskManifestCommands(program);
registerTaskSubtreeTransferCommands(program);
await registerOptionalEventsCommands(program);
registerHelpCommands(program, authority.route, remoteCommandCapabilities);

// Remote metadata describes the authority-served catalog. An admitted local
// redaction invocation is a separate Stage-A route that pins the process to
// local storage before the command modules above are imported.
applyTodosCliHelpVisibility(program, authority.route, remoteCommandCapabilities);

// Single top-level guard: any error thrown from an async action handler (e.g. a
// TaskNotFoundError when a full UUID references a task absent from the local
// mirror) surfaces as a clean red message + exit(1) instead of an unhandled
// promise-rejection stack trace.
try {
  const activeFormat = unsupportedActiveFormatOption(
    commandForArgs(program, process.argv.slice(2)),
    process.argv.slice(2),
  );
  if (activeFormat) {
    throw new Error(
      `ACTIVE_FORMAT_UNSUPPORTED: ${activeFormat} is not supported by todos active; ` +
        "use --json for machine-readable output",
    );
  }
  if (metadataRequested) {
    const unavailableCommand = getUnavailableTodosCliRemoteMetadataCommand(
      authority.route,
      remoteCommandCapabilities,
      process.argv.slice(2),
    );
    if (unavailableCommand) {
      throw new Error(
        `REMOTE_COMMAND_UNAVAILABLE: configured Todos authority does not advertise ${unavailableCommand}; ` +
          "help is unavailable for this command",
      );
    }
  }
  await program.parseAsync();
} catch (err) {
  handleError(err);
}
