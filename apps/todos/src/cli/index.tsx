#!/usr/bin/env bun
import { Command } from "commander";
import { getPackageVersion } from "../lib/package-version.js";

const program = new Command();

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
registerHelpCommands(program);

program.parse();
