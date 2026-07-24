// Full CLI command graph. The shipped bootstrap imports this module only after
// the dependency-light Stage-A pre-dispatch gate succeeds.
import { Command, CommanderError } from "commander";
import { getPackageVersion } from "../lib/package-version.js";
import { assertTodosCliStageAContainment, exitWithTodosCliStageAError } from "./stage-a.js";

const program = new Command();
program.exitOverride();
program.configureOutput({
  // Parser failures are rendered once by the same serializer used by action
  // failures. Help and version continue to use Commander's stdout writer.
  writeErr: () => {},
});

type RegisterEventsCommands = (
  program: Command,
  options: { source: string },
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
      module.registerEventsCommands(program, { source: "todos" });
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

// Global options
program
  .name("todos")
  .description("Universal task management for AI coding agents")
  .option("--project <path>", "Project path")
  .option("-j, --json", "Output as JSON")
  .option("--agent <name>", "Agent name")
  .option("--session <id>", "Session ID");

try {
  assertTodosCliStageAContainment();
} catch (error) {
  exitWithTodosCliStageAError(error);
}

program.version(getPackageVersion());

const [
  { handleError },
  { registerTaskCommands },
  { registerPlanTemplateCommands },
  { registerProjectCommands },
  { registerAgentCommands },
  { registerConfigServeCommands },
  { registerQueryCommands },
  { registerMcpHooksCommands },
  { registerDispatchCommands },
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
  { registerHelpCommands },
] = await Promise.all([
  import("./helpers.js"),
  import("./commands/task-commands.js"),
  import("./commands/plan-template-commands.js"),
  import("./commands/project-commands.js"),
  import("./commands/agent-commands.js"),
  import("./commands/config-serve-commands.js"),
  import("./commands/query-commands.js"),
  import("./commands/mcp-hooks-commands.js"),
  import("./commands/dispatch.js"),
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
  import("./commands/help-commands.js"),
]);

registerTaskCommands(program);
registerPlanTemplateCommands(program);
registerProjectCommands(program);
registerAgentCommands(program);
registerConfigServeCommands(program);
registerQueryCommands(program);
registerMcpHooksCommands(program);
registerDispatchCommands(program);
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
await registerOptionalEventsCommands(program);
registerHelpCommands(program);

// Single top-level guard: any error thrown from an async action handler (e.g. a
// TaskNotFoundError when a full UUID references a task absent from the local
// mirror) surfaces as a clean red message + exit(1) instead of an unhandled
// promise-rejection stack trace.
try {
  await program.parseAsync();
} catch (err) {
  if (!(err instanceof CommanderError && err.exitCode === 0)) handleError(err);
}
