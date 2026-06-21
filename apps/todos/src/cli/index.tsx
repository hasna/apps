#!/usr/bin/env bun
import { Command } from "commander";
import { getPackageVersion } from "../lib/package-version.js";

const program = new Command();

type RegisterEventsCommands = (
  program: Command,
  options: { source: string },
) => void;

async function registerOptionalEventsCommands(program: Command): Promise<void> {
  const specifier = "@hasna/events/commander";
  try {
    const module = (await import(specifier)) as {
      registerEventsCommands?: RegisterEventsCommands;
    };
    module.registerEventsCommands?.(program, { source: "todos" });
  } catch (error) {
    if (process.env["TODOS_DEBUG_EVENTS_IMPORT"] === "1") {
      console.warn(
        `Skipping optional @hasna/events CLI commands: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

// Global options
program
  .name("todos")
  .description("Universal task management for AI coding agents")
  .version(getPackageVersion())
  .option("--project <path>", "Project path")
  .option("-j, --json", "Output as JSON")
  .option("--agent <name>", "Agent name")
  .option("--session <id>", "Session ID");

const [
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

program.parse();
