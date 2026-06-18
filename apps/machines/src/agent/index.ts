#!/usr/bin/env bun
import { Command } from "commander";
import { getPackageVersion } from "../version.js";
import { getAdapter } from "../db.js";
import { getAgentStatus, markOffline, writeHeartbeatTick } from "./runtime.js";

const program = new Command();

function envFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

program
  .name("machines-agent")
  .description("Lightweight machine agent reporting local heartbeat and registry status")
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

const options = program.parse(process.argv).opts<{
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
}>();
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

async function tick(): Promise<void> {
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
}

if (options.status) {
  console.log(JSON.stringify(getAgentStatus(undefined, { privateMetadata: privateMetadataEnabled }), null, options.json ? 2 : 0));
  process.exit(0);
}

if (options.offline) {
  console.log(JSON.stringify(markOffline({ mode: options.mode, privateMetadata: privateMetadataEnabled }), null, options.json ? 2 : 0));
  process.exit(0);
}

await tick();

if (!options.once) {
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  process.on("SIGINT", () => {
    clearInterval(timer);
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    clearInterval(timer);
    process.exit(0);
  });
}
