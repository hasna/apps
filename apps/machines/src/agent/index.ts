#!/usr/bin/env bun
import { Command } from "commander";
import { getAdapter } from "../db.js";
import { assertMutationApproved } from "../commands/mutation-approval.js";
import { getRosterConfigPath } from "../paths.js";
import { getPackageVersion } from "../version.js";
import {
  ROSTER_RECONCILE_OPERATION,
  readRosterConfig,
  resetRosterCrashloop,
  rosterConfigApprovalArgs,
  rosterConfigResourceId,
  runRosterDaemon,
  runRosterReconcile,
} from "./roster.js";
import { getAgentStatus, markOffline, writeHeartbeatTick } from "./runtime.js";

const program = new Command();

function envFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

program
  .name("machines-agent")
  .description("Machine heartbeat agent and station roster controller")
  .version(getPackageVersion())
  .option("--once", "Write one heartbeat and exit", false)
  .option("--status", "Print current agent heartbeat rows and exit", false)
  .option("--offline", "Mark the current process offline and exit", false)
  .option("--mode <mode>", "Agent mode recorded with heartbeat metadata", process.env["HASNA_MACHINES_AGENT_MODE"] || "daemon")
  .option("--storage-push", "Push heartbeat rows to configured remote storage after writing", false)
  .option("--storage-push-retries <count>", "Storage push retry count", process.env["HASNA_MACHINES_AGENT_STORAGE_PUSH_RETRIES"] || "2")
  .option("--storage-push-backoff-ms <ms>", "Storage push retry backoff in milliseconds", process.env["HASNA_MACHINES_AGENT_STORAGE_PUSH_BACKOFF_MS"] || "250")
  .option("--doctor-summary", "Include a lightweight doctor summary in heartbeat metadata", false)
  .option("--private-metadata", "Allow private host/network metadata in heartbeat facts", false)
  .option("--interval <seconds>", "Heartbeat interval in seconds")
  .option("--interval-ms <ms>", "Heartbeat interval in milliseconds", "30000")
  .option("-j, --json", "Print JSON output", false);

interface HeartbeatOptions {
  once: boolean;
  status: boolean;
  offline: boolean;
  mode: string;
  storagePush: boolean;
  storagePushRetries: string;
  storagePushBackoffMs: string;
  doctorSummary: boolean;
  privateMetadata: boolean;
  interval?: string;
  intervalMs: string;
  json: boolean;
}

program.action(async (options: HeartbeatOptions) => {
  const parsedIntervalSeconds = options.interval ? Number.parseFloat(options.interval) : NaN;
  const parsedIntervalMs = Number.parseInt(options.intervalMs, 10);
  const intervalMs = Number.isFinite(parsedIntervalSeconds)
    ? Math.max(1, Math.floor(parsedIntervalSeconds * 1000))
    : Number.isFinite(parsedIntervalMs)
      ? Math.max(1, parsedIntervalMs)
      : 30000;
  const storagePushEnabled = options.storagePush || envFlag("HASNA_MACHINES_AGENT_STORAGE_PUSH");
  const privateMetadataEnabled = options.privateMetadata || envFlag("HASNA_MACHINES_PRIVATE_METADATA") || envFlag("MACHINES_PRIVATE_METADATA");
  const doctorSummaryEnabled = options.doctorSummary || envFlag("HASNA_MACHINES_AGENT_DOCTOR_SUMMARY");
  const storagePushRetries = Math.max(0, Number.parseInt(options.storagePushRetries, 10) || 0);
  const storagePushBackoffMs = Math.max(0, Number.parseInt(options.storagePushBackoffMs, 10) || 0);

  if (options.status) {
    console.log(JSON.stringify(getAgentStatus(undefined, { privateMetadata: privateMetadataEnabled }), null, options.json ? 2 : 0));
    return;
  }
  if (options.offline) {
    console.log(JSON.stringify(markOffline({ mode: options.mode, privateMetadata: privateMetadataEnabled }), null, options.json ? 2 : 0));
    return;
  }

  const tick = async (): Promise<void> => {
    getAdapter();
    const payload = await writeHeartbeatTick("online", {
      mode: options.mode,
      storagePush: storagePushEnabled,
      storagePushRetries,
      storagePushBackoffMs,
      doctorSummary: doctorSummaryEnabled,
      privateMetadata: privateMetadataEnabled,
    });
    console.log(JSON.stringify(payload));
  };
  await tick();
  if (options.once) return;
  const timer = setInterval(() => void tick(), intervalMs);
  const stop = () => {
    clearInterval(timer);
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
});

const roster = program.command("roster").description("Observe and reconcile station agent seats (never dispatches work)");

function approveRosterApply(configPath: string, approvalToken?: string): void {
  const config = readRosterConfig(configPath);
  assertMutationApproved({
    surface: "cli",
    operation: ROSTER_RECONCILE_OPERATION,
    machineId: config.machineId,
    resourceId: rosterConfigResourceId(configPath),
    transport: "cli",
    args: rosterConfigApprovalArgs(configPath),
    approvalToken,
  });
}

roster
  .command("reconcile")
  .description("Run one OBSERVE → DIFF → CLASSIFY → PLAN → GATE → APPLY pass")
  .option("--config <path>", "Roster configuration path", getRosterConfigPath())
  .option("--apply", "Apply the approved plan; manual is the default", false)
  .option("--drill-level <level>", "Stamp a drill level such as tmux-kill into the run record")
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action(async (options: { config: string; apply?: boolean; drillLevel?: string; approvalToken?: string }) => {
    const config = readRosterConfig(options.config);
    const apply = options.apply === true || config.applyMode === "auto";
    if (apply) approveRosterApply(options.config, options.approvalToken);
    const result = await runRosterReconcile(config, { apply, drillLevel: options.drillLevel });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "blocked" || result.status === "failed" || result.status === "lease-held") process.exitCode = 1;
  });

roster
  .command("daemon")
  .description("Run the roster controller at the config-driven tick interval")
  .option("--config <path>", "Roster configuration path", getRosterConfigPath())
  .option("--once", "Run one daemon tick and exit", false)
  .option("--approval-token <token>", "Scoped mutation approval token")
  .action(async (options: { config: string; once?: boolean; approvalToken?: string }) => {
    await runRosterDaemon(options.config, {
      once: options.once,
      authorizeApply: () => approveRosterApply(options.config, options.approvalToken),
      onResult: (result) => console.log(JSON.stringify(result)),
    });
  });

roster
  .command("reset <entry>")
  .description("Clear a crashloop latch after an operator repairs an entry")
  .option("--config <path>", "Roster configuration path", getRosterConfigPath())
  .option("--approval-token <token>", "Scoped mutation approval token")
  .action((entry: string, options: { config: string; approvalToken?: string }) => {
    const config = readRosterConfig(options.config);
    assertMutationApproved({
      surface: "cli",
      operation: "roster_crashloop_reset",
      machineId: config.machineId,
      resourceId: rosterConfigResourceId(options.config),
      transport: "cli",
      args: rosterConfigApprovalArgs(options.config, entry),
      approvalToken: options.approvalToken,
    });
    console.log(JSON.stringify({ entry, reset: resetRosterCrashloop(config, entry) }, null, 2));
  });

await program.parseAsync(process.argv);
