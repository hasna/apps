import { execFileSync } from "node:child_process";
import { arch, hostname, platform, release, uptime, version as osVersion } from "node:os";
import { runDoctor } from "../commands/doctor.js";
import { getLocalMachineId, listHeartbeats, upsertHeartbeat, type HeartbeatUpsertMetadata } from "../db.js";
import { isPrivateMetadataEnabled as isPrivateMetadataEnvEnabled, redactErrorMessage } from "../redaction.js";
import { storagePush } from "../storage-sync.js";
import { getPackageVersion } from "../version.js";

const daemonVersion = getPackageVersion();

export interface AgentRuntimeStatus {
  machineId: string;
  pid: number;
  status: "online" | "offline";
  updatedAt: string;
  daemonVersion?: string | null;
  agentMode?: string | null;
  platform?: string | null;
  osVersion?: string | null;
  osBuild?: string | null;
  arch?: string | null;
  uptimeSeconds?: number | null;
  toolVersions?: Record<string, unknown> | null;
  tailscale?: Record<string, unknown> | null;
  storageSyncStatus?: string | null;
  storageSyncLastError?: string | null;
  doctorSummary?: Record<string, unknown> | null;
  privateMetadata?: boolean;
}

export interface AgentRuntimeOptions {
  mode?: string;
  privateMetadata?: boolean;
  doctorSummary?: boolean;
  storageSyncStatus?: string | null;
  storageSyncLastError?: string | null;
}

export interface AgentTickOptions extends AgentRuntimeOptions {
  storagePush?: boolean;
  storagePushRetries?: number;
  storagePushBackoffMs?: number;
}

export interface AgentStatusOptions {
  privateMetadata?: boolean;
}

function resolvePrivateMetadata(value?: boolean): boolean {
  return value ?? isPrivateMetadataEnvEnabled();
}

function readToolVersion(command: string, args: string[]): string | null {
  try {
    const output = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    });
    const firstLine = output.split(/\r?\n/).find((line) => line.trim());
    return firstLine ? sanitizePublicString(firstLine.trim()) : null;
  } catch {
    return null;
  }
}

function selectedToolVersions(): Record<string, string> {
  const versions: Record<string, string> = {};
  if (process.versions.bun) versions.bun = process.versions.bun;
  if (process.version) versions.node = process.version;

  const git = readToolVersion("git", ["--version"]);
  if (git) versions.git = git;

  const tailscale = readToolVersion("tailscale", ["version"]);
  if (tailscale) versions.tailscale = tailscale;

  return versions;
}

function summarizeTailscale(privateMetadata: boolean): Record<string, unknown> {
  let parsed: Record<string, unknown>;
  try {
    const output = execFileSync("tailscale", ["status", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    });
    parsed = JSON.parse(output) as Record<string, unknown>;
  } catch {
    return { available: false };
  }

  const peers = parsed["Peer"] && typeof parsed["Peer"] === "object"
    ? Object.values(parsed["Peer"] as Record<string, unknown>)
    : [];
  const self = parsed["Self"] && typeof parsed["Self"] === "object"
    ? parsed["Self"] as Record<string, unknown>
    : {};

  const summary: Record<string, unknown> = {
    available: true,
    backendState: typeof parsed["BackendState"] === "string" ? parsed["BackendState"] : undefined,
    selfOnline: typeof self["Online"] === "boolean" ? self["Online"] : undefined,
    peerCount: peers.length,
  };

  if (privateMetadata) {
    summary.selfDnsName = typeof self["DNSName"] === "string" ? self["DNSName"] : undefined;
    summary.selfTailscaleIps = Array.isArray(self["TailscaleIPs"]) ? self["TailscaleIPs"] : undefined;
  }

  return sanitizeRecord(summary, privateMetadata);
}

function envFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function shouldCollectDoctorSummary(value?: boolean): boolean {
  return value ?? envFlag("HASNA_MACHINES_AGENT_DOCTOR_SUMMARY");
}

function collectDoctorSummary(machineId: string, enabled: boolean): Record<string, unknown> | null {
  if (!enabled) return null;
  try {
    const report = runDoctor(machineId, { includeOptionalAdapters: false });
    const summary = report.checks.reduce((counts, check) => {
      counts[check.status] += 1;
      return counts;
    }, { ok: 0, warn: 0, fail: 0 } as Record<"ok" | "warn" | "fail", number>);
    return {
      generated_at: report.generatedAt,
      source: report.source,
      summary,
      blockers: report.checks
        .filter((check) => check.status !== "ok")
        .slice(0, 20)
        .map((check) => ({
          id: check.id,
          status: check.status,
          summary: check.summary,
          detail: check.detail,
          remediation: check.remediation ?? [],
        })),
    };
  } catch (error) {
    return {
      generated_at: new Date().toISOString(),
      source: "doctor",
      summary: { ok: 0, warn: 1, fail: 0 },
      blockers: [{
        id: "doctor-summary",
        status: "warn",
        summary: "Doctor summary unavailable",
        detail: redactErrorMessage(error instanceof Error ? error.message : String(error)),
        remediation: [],
      }],
    };
  }
}

function collectHeartbeatMetadata(machineId: string, options: AgentRuntimeOptions = {}): HeartbeatUpsertMetadata {
  const privateMetadata = resolvePrivateMetadata(options.privateMetadata);
  return {
    daemonVersion,
    agentMode: sanitizePublicString(options.mode?.trim() || "daemon", privateMetadata),
    platform: platform(),
    osVersion: sanitizePublicString(osVersion(), privateMetadata),
    osBuild: sanitizePublicString(release(), privateMetadata),
    arch: arch(),
    uptimeSeconds: uptime(),
    toolVersions: sanitizeRecord(selectedToolVersions(), privateMetadata),
    tailscale: summarizeTailscale(privateMetadata),
    storageSyncStatus: options.storageSyncStatus ?? null,
    storageSyncLastError: options.storageSyncLastError ? sanitizePublicString(options.storageSyncLastError, privateMetadata) : null,
    doctorSummary: collectDoctorSummary(machineId, shouldCollectDoctorSummary(options.doctorSummary)),
    privateMetadata,
  };
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function heartbeatToStatus(heartbeat: ReturnType<typeof listHeartbeats>[number], options: AgentStatusOptions = {}): AgentRuntimeStatus {
  const privateMetadata = options.privateMetadata === true;
  const tailscale = parseJsonObject(heartbeat.tailscale_json);
  const doctorSummary = parseJsonObject(heartbeat.doctor_summary_json);
  return {
    machineId: heartbeat.machine_id,
    pid: heartbeat.pid,
    status: heartbeat.status as "online" | "offline",
    updatedAt: heartbeat.updated_at,
    daemonVersion: heartbeat.daemon_version,
    agentMode: heartbeat.agent_mode,
    platform: heartbeat.platform,
    osVersion: heartbeat.os_version,
    osBuild: heartbeat.os_build,
    arch: heartbeat.arch,
    uptimeSeconds: heartbeat.uptime_seconds,
    toolVersions: sanitizeRecord(parseJsonObject(heartbeat.tool_versions_json) ?? {}, privateMetadata),
    tailscale: tailscale ? sanitizeRecord(tailscale, privateMetadata) : null,
    storageSyncStatus: heartbeat.storage_sync_status,
    storageSyncLastError: heartbeat.storage_sync_last_error
      ? sanitizeStorageError(heartbeat.storage_sync_last_error, privateMetadata)
      : null,
    doctorSummary: doctorSummary ? sanitizeRecord(doctorSummary, privateMetadata) : null,
    privateMetadata: Boolean(heartbeat.private_metadata),
  };
}

export function sanitizePublicString(value: string, privateMetadata = false): string {
  if (privateMetadata) return value;
  let redacted = value;
  const localHostname = hostname();
  const localUser = process.env["USER"] || process.env["LOGNAME"] || process.env["USERNAME"];
  if (localHostname) redacted = redacted.replaceAll(localHostname, "[redacted-host]");
  if (localUser) redacted = redacted.replaceAll(localUser, "[redacted-user]");

  return redactErrorMessage(redacted
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'")]+/gi, (match) => {
      const scheme = match.match(/^([a-z][a-z0-9+.-]*:\/\/)/i)?.[1] ?? "";
      return `${scheme}[redacted]`;
    })
    .replace(/\b10(?:\.\d{1,3}){3}\b/g, "[redacted-ip]")
    .replace(/\b172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}\b/g, "[redacted-ip]")
    .replace(/\b192\.168(?:\.\d{1,3}){2}\b/g, "[redacted-ip]")
    .replace(/\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}\b/g, "[redacted-ip]")
    .replace(/\b(password|passwd|token|secret|api[_-]?key)=([^&\s]+)/gi, "$1=[redacted]"));
}

function sanitizeValue(value: unknown, privateMetadata: boolean): unknown {
  if (typeof value === "string") return sanitizePublicString(value, privateMetadata);
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry, privateMetadata));
  if (value && typeof value === "object") return sanitizeRecord(value as Record<string, unknown>, privateMetadata);
  return value;
}

function sanitizeRecord(value: Record<string, unknown>, privateMetadata: boolean): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!privateMetadata && /(hostname|hostName|user|username|serial|dnsName|ip|ips|databaseUrl|url|token|secret|password|credential)/i.test(key)) {
      sanitized[key] = "[redacted]";
      continue;
    }
    sanitized[key] = sanitizeValue(entry, privateMetadata);
  }
  return sanitized;
}

export function writeHeartbeat(status: "online" | "offline" = "online", options: AgentRuntimeOptions = {}): AgentRuntimeStatus {
  const machineId = getLocalMachineId();
  upsertHeartbeat(machineId, process.pid, status, collectHeartbeatMetadata(machineId, options));
  return getAgentStatus(machineId, { privateMetadata: resolvePrivateMetadata(options.privateMetadata) }).find((heartbeat) => heartbeat.pid === process.pid) ?? {
    machineId,
    pid: process.pid,
    status,
    updatedAt: new Date().toISOString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeStorageError(message: string, privateMetadata: boolean): string {
  return privateMetadata ? message : redactErrorMessage(message);
}

async function pushHeartbeatRowsWithRetry(options: AgentTickOptions, privateMetadata: boolean): Promise<{ ok: boolean; error: string | null; attempts: number }> {
  const retries = Number.isInteger(options.storagePushRetries) && options.storagePushRetries! >= 0 ? options.storagePushRetries! : 2;
  const backoffMs = Number.isInteger(options.storagePushBackoffMs) && options.storagePushBackoffMs! >= 0 ? options.storagePushBackoffMs! : 250;
  const attempts = retries + 1;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const results = await storagePush({ tables: ["agent_heartbeats"] });
      const errors = results.flatMap((result) => result.errors);
      if (errors.length === 0) return { ok: true, error: null, attempts: attempt };
      lastError = errors.map((error) => sanitizeStorageError(error, privateMetadata)).join("; ");
    } catch (error) {
      lastError = sanitizeStorageError(error instanceof Error ? error.message : String(error), privateMetadata);
    }

    if (attempt < attempts && backoffMs > 0) {
      await sleep(backoffMs * attempt);
    }
  }

  return { ok: false, error: lastError, attempts };
}

export async function writeHeartbeatTick(status: "online" | "offline" = "online", options: AgentTickOptions = {}): Promise<AgentRuntimeStatus> {
  const privateMetadata = resolvePrivateMetadata(options.privateMetadata);
  if (!options.storagePush) return writeHeartbeat(status, { ...options, storageSyncStatus: options.storageSyncStatus ?? "disabled" });

  let heartbeat = writeHeartbeat(status, { ...options, doctorSummary: false, storageSyncStatus: "pending", storageSyncLastError: null });
  const pushed = await pushHeartbeatRowsWithRetry(options, privateMetadata);
  heartbeat = writeHeartbeat(status, {
    ...options,
    storageSyncStatus: pushed.ok ? "ok" : "error",
    storageSyncLastError: pushed.ok ? null : `${pushed.error ?? "storage push failed"} (attempts=${pushed.attempts})`,
  });
  if (pushed.ok) {
    const finalPush = await pushHeartbeatRowsWithRetry({ ...options, storagePushRetries: 0 }, privateMetadata);
    if (!finalPush.ok) {
      heartbeat = writeHeartbeat(status, {
        ...options,
        storageSyncStatus: "error",
        storageSyncLastError: `${finalPush.error ?? "final storage push failed"} (attempts=${finalPush.attempts})`,
      });
      await pushHeartbeatRowsWithRetry({ ...options, storagePushRetries: 0 }, privateMetadata);
    }
  }
  return heartbeat;
}

export function markOffline(options: AgentRuntimeOptions = {}): AgentRuntimeStatus {
  return writeHeartbeat("offline", options);
}

export function getAgentStatus(machineId?: string, options: AgentStatusOptions = {}): AgentRuntimeStatus[] {
  return listHeartbeats(machineId).map((heartbeat) => heartbeatToStatus(heartbeat, options));
}
