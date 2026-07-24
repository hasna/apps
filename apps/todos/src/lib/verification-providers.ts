import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { addTaskVerification } from "../db/task-commits.js";
import { getDatabase, now } from "../db/database.js";
import { getTask } from "../db/tasks.js";
import {
  loadConfig,
  saveConfig,
  type VerificationProviderConfig,
  type VerificationProviderKind,
  type VerificationProviderRetryConfig,
} from "./config.js";
import { redactEvidenceText, redactValue } from "./redaction.js";

export type { VerificationProviderConfig, VerificationProviderKind, VerificationProviderRetryConfig };

export type VerificationProviderStatus = "passed" | "failed" | "unknown";

export interface UpsertVerificationProviderInput {
  name: string;
  kind: VerificationProviderKind;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  capabilities?: string[];
  retry?: VerificationProviderRetryConfig;
  timeout_ms?: number;
}

export interface VerificationProviderCapabilities {
  name: string;
  kind: VerificationProviderKind;
  configured: boolean;
  local_only: true;
  network_required: false;
  capabilities: string[];
  retry: Required<VerificationProviderRetryConfig>;
}

export interface RunVerificationProviderInput {
  name: string;
  task_id?: string;
  agent_id?: string;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  log_text?: string;
  log_path?: string;
  url?: string;
  artifact_path?: string;
  metadata?: Record<string, unknown>;
}

export interface VerificationProviderResult {
  provider: string;
  kind: VerificationProviderKind;
  status: VerificationProviderStatus;
  command: string;
  attempts: number;
  exit_code: number | null;
  output_summary: string | null;
  artifact_path: string | null;
  run_at: string;
  task_id: string | null;
  metadata: Record<string, unknown>;
}

const DEFAULT_RETRY: Required<VerificationProviderRetryConfig> = {
  attempts: 1,
  backoff_ms: 0,
};

const DEFAULT_CAPABILITIES: Record<VerificationProviderKind, string[]> = {
  command: ["command", "retry", "evidence"],
  testbox: ["testbox", "command", "retry", "evidence"],
  ci_log: ["ci_log", "log_import", "evidence"],
  browser: ["browser", "screenshot", "artifact", "evidence"],
  script: ["script", "command", "retry", "evidence"],
};

function normalizeName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error("verification provider name must use lowercase letters, numbers, dashes, or underscores");
  }
  return normalized;
}

function retryConfig(retry?: VerificationProviderRetryConfig): Required<VerificationProviderRetryConfig> {
  return {
    attempts: Math.max(1, Math.min(10, Math.floor(retry?.attempts ?? DEFAULT_RETRY.attempts))),
    backoff_ms: Math.max(0, Math.min(60_000, Math.floor(retry?.backoff_ms ?? DEFAULT_RETRY.backoff_ms))),
  };
}

function timeoutMs(value?: number): number | undefined {
  if (value === undefined) return undefined;
  return Math.max(1, Math.min(24 * 60 * 60_000, Math.floor(value)));
}

function getProvider(name: string): VerificationProviderConfig | null {
  return loadConfig().verification_providers?.[normalizeName(name)] || null;
}

export function upsertVerificationProvider(input: UpsertVerificationProviderInput): VerificationProviderConfig {
  const name = normalizeName(input.name);
  const config = loadConfig();
  const existing = config.verification_providers?.[name];
  const timestamp = new Date().toISOString();
  const provider: VerificationProviderConfig = {
    ...existing,
    name,
    kind: input.kind,
    command: input.command ?? existing?.command,
    cwd: input.cwd ?? existing?.cwd,
    env: input.env ? redactValue(input.env) : existing?.env,
    capabilities: input.capabilities ?? existing?.capabilities,
    retry: input.retry ? retryConfig(input.retry) : existing?.retry,
    timeout_ms: timeoutMs(input.timeout_ms ?? existing?.timeout_ms),
    created_at: existing?.created_at || timestamp,
    updated_at: timestamp,
  };
  saveConfig({
    ...config,
    verification_providers: {
      ...(config.verification_providers || {}),
      [name]: provider,
    },
  });
  return provider;
}

export function listVerificationProviders(): VerificationProviderConfig[] {
  return Object.values(loadConfig().verification_providers || {}).sort((a, b) => a.name.localeCompare(b.name));
}

export function removeVerificationProvider(name: string): boolean {
  const normalized = normalizeName(name);
  const config = loadConfig();
  if (!config.verification_providers?.[normalized]) return false;
  const next = { ...config.verification_providers };
  delete next[normalized];
  saveConfig({ ...config, verification_providers: next });
  return true;
}

export function discoverVerificationProviderCapabilities(name: string): VerificationProviderCapabilities {
  const provider = getProvider(name);
  if (!provider) throw new Error(`Verification provider not found: ${name}`);
  return {
    name: provider.name,
    kind: provider.kind,
    configured: provider.kind === "ci_log" || provider.kind === "browser" || Boolean(provider.command),
    local_only: true,
    network_required: false,
    capabilities: [...new Set(provider.capabilities || DEFAULT_CAPABILITIES[provider.kind])].sort(),
    retry: retryConfig(provider.retry),
  };
}

function renderCommand(command: string, input: RunVerificationProviderInput): string {
  return command
    .replaceAll("{task_id}", input.task_id || "")
    .replaceAll("{agent_id}", input.agent_id || "")
    .replaceAll("{artifact_path}", input.artifact_path || "")
    .replaceAll("{url}", input.url || "");
}

function summarize(stdout: string, stderr = ""): string | null {
  const redacted = redactEvidenceText([stdout.trim(), stderr.trim()].filter(Boolean).join("\n"));
  if (!redacted) return null;
  return redacted.length > 1200 ? `${redacted.slice(0, 1197)}...` : redacted;
}

function classifyLog(text: string): VerificationProviderStatus {
  const normalized = text.toLowerCase();
  if (/\b(failed|failure|error|exception|not ok|0 passed|[1-9]\d*\s+fail)\b/.test(normalized)) return "failed";
  if (/\b(passed|success|ok|green|all tests pass|0 fail)\b/.test(normalized)) return "passed";
  return "unknown";
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCommandProvider(
  provider: VerificationProviderConfig,
  input: RunVerificationProviderInput,
): Promise<Pick<VerificationProviderResult, "status" | "attempts" | "exit_code" | "output_summary">> {
  const commandTemplate = input.command || provider.command;
  if (!commandTemplate) {
    return {
      status: "unknown",
      attempts: 0,
      exit_code: null,
      output_summary: `${provider.kind} provider requires an explicit local command before it can run`,
    };
  }
  const retry = retryConfig(provider.retry);
  const command = renderCommand(commandTemplate, input);
  let lastExitCode: number | null = null;
  let lastSummary: string | null = null;

  for (let attempt = 1; attempt <= retry.attempts; attempt++) {
    let timedOut = false;
    const proc = Bun.spawn(["bash", "-lc", command], {
      cwd: input.cwd || provider.cwd || process.cwd(),
      env: { ...process.env, ...(provider.env || {}), ...(input.env || {}) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = provider.timeout_ms
      ? setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, provider.timeout_ms)
      : undefined;
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (timer) clearTimeout(timer);
    lastExitCode = exitCode;
    lastSummary = summarize(stdout, stderr);
    if (timedOut) {
      lastSummary = summarize(`${lastSummary || ""}\nTimed out after ${provider.timeout_ms}ms`);
    }
    if (exitCode === 0) {
      return { status: "passed", attempts: attempt, exit_code: exitCode, output_summary: lastSummary };
    }
    if (attempt < retry.attempts) await sleep(retry.backoff_ms);
  }

  return {
    status: "failed",
    attempts: retry.attempts,
    exit_code: lastExitCode,
    output_summary: lastSummary,
  };
}

function runCiLogProvider(input: RunVerificationProviderInput): Pick<VerificationProviderResult, "status" | "attempts" | "exit_code" | "output_summary"> {
  const text = input.log_text ?? (input.log_path && existsSync(input.log_path) ? readFileSync(input.log_path, "utf-8") : "");
  return {
    status: classifyLog(text),
    attempts: 1,
    exit_code: null,
    output_summary: summarize(text) || "no CI log text supplied",
  };
}

function runBrowserProvider(input: RunVerificationProviderInput): Pick<VerificationProviderResult, "status" | "attempts" | "exit_code" | "output_summary"> {
  if (!input.artifact_path) {
    return { status: "unknown", attempts: 1, exit_code: null, output_summary: "browser provider needs a screenshot or artifact path" };
  }
  if (!existsSync(input.artifact_path)) {
    return { status: "failed", attempts: 1, exit_code: null, output_summary: `artifact not found: ${input.artifact_path}` };
  }
  return {
    status: "passed",
    attempts: 1,
    exit_code: null,
    output_summary: summarize(`browser artifact verified${input.url ? ` for ${input.url}` : ""}: ${input.artifact_path}`),
  };
}

export async function runVerificationProvider(input: RunVerificationProviderInput, db?: Database): Promise<VerificationProviderResult> {
  const d = getDatabase(db);
  const provider = getProvider(input.name);
  if (!provider) throw new Error(`Verification provider not found: ${input.name}`);
  if (input.task_id && !getTask(input.task_id, d)) throw new Error(`Task not found: ${input.task_id}`);

  const command = input.command || provider.command || `provider:${provider.name}`;
  const partial = provider.kind === "ci_log"
    ? runCiLogProvider(input)
    : provider.kind === "browser" && !provider.command
      ? runBrowserProvider(input)
      : await runCommandProvider(provider, input);

  const result: VerificationProviderResult = {
    provider: provider.name,
    kind: provider.kind,
    command: `provider:${provider.name}`,
    status: partial.status,
    attempts: partial.attempts,
    exit_code: partial.exit_code,
    output_summary: partial.output_summary ? redactEvidenceText(partial.output_summary) : null,
    artifact_path: input.artifact_path || null,
    run_at: now(),
    task_id: input.task_id || null,
    metadata: redactValue({
      ...(input.metadata || {}),
      provider_kind: provider.kind,
      command_template: command,
      url: input.url,
      log_path: input.log_path,
    }),
  };

  if (input.task_id) {
    addTaskVerification({
      task_id: input.task_id,
      command: result.command,
      status: result.status,
      output_summary: result.output_summary || undefined,
      artifact_path: result.artifact_path || undefined,
      agent_id: input.agent_id,
      run_at: result.run_at,
    }, d);
  }

  return result;
}

// Verification records query layer (reads task_verifications written by
// db/task-commits.ts). Consumers: verification-evidence, import-export-bridge,
// resource-snapshots, the verification MCP tool.
export interface VerificationRecordResult {
  id: string;
  task_id: string | null;
  command: string;
  status: VerificationProviderStatus;
  output_summary: string | null;
  artifact_path: string | null;
  agent_id: string | null;
  run_at: string;
  created_at: string;
  evidence: Record<string, unknown>;
}

function taskVerificationRowToRecord(row: Record<string, unknown>): VerificationRecordResult {
  return {
    id: String(row["id"]),
    task_id: (row["task_id"] as string | null) ?? null,
    command: String(row["command"] ?? ""),
    status: (row["status"] as VerificationProviderStatus) ?? "unknown",
    output_summary: (row["output_summary"] as string | null) ?? null,
    artifact_path: (row["artifact_path"] as string | null) ?? null,
    agent_id: (row["agent_id"] as string | null) ?? null,
    run_at: String(row["run_at"] ?? ""),
    created_at: String(row["created_at"] ?? ""),
    evidence: {
      command: row["command"] ?? null,
      status: row["status"] ?? "unknown",
      output_summary: row["output_summary"] ?? null,
      artifact_path: row["artifact_path"] ?? null,
      agent_id: row["agent_id"] ?? null,
      run_record_id: null,
    },
  };
}

function portableVerificationRowToRecord(row: Record<string, unknown>): VerificationRecordResult {
  let evidence: Record<string, unknown> = {};
  try {
    evidence = row["evidence"] ? JSON.parse(String(row["evidence"])) as Record<string, unknown> : {};
  } catch {
    evidence = {};
  }

  return {
    id: String(row["id"]),
    task_id: (row["task_id"] as string | null) ?? null,
    command: String(row["provider_name"] ?? "manual"),
    status: (row["status"] as VerificationProviderStatus) ?? "unknown",
    output_summary: (row["summary"] as string | null) ?? null,
    artifact_path: (row["artifact_id"] as string | null) ?? null,
    agent_id: (evidence["agent_id"] as string | null) ?? null,
    run_at: String(row["completed_at"] ?? row["started_at"] ?? row["created_at"] ?? ""),
    created_at: String(row["created_at"] ?? ""),
    evidence: {
      ...evidence,
      provider_name: row["provider_name"] ?? evidence["provider_name"] ?? null,
      provider_type: row["provider_type"] ?? evidence["provider_type"] ?? "local",
      status: row["status"] ?? evidence["status"] ?? "unknown",
      summary: row["summary"] ?? evidence["summary"] ?? null,
      artifact_id: row["artifact_id"] ?? evidence["artifact_id"] ?? null,
    },
  };
}

export function getVerificationRecord(id: string, db?: Database): VerificationRecordResult | null {
  const d = getDatabase(db);
  try {
    const portable = d.query("SELECT * FROM verification_records WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (portable) return portableVerificationRowToRecord(portable);
  } catch {
    // Older databases may only have task_verifications.
  }

  const row = d.query("SELECT * FROM task_verifications WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? taskVerificationRowToRecord(row) : null;
}

export function listVerificationRecords(
  filter: { task_id?: string; agent_id?: string; status?: string; run_record_id?: string; provider?: string; limit?: number } = {},
  db?: Database,
): VerificationRecordResult[] {
  const d = getDatabase(db);
  const records: VerificationRecordResult[] = [];

  try {
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter.task_id) { conditions.push("task_id = ?"); params.push(filter.task_id); }
    if (filter.status) { conditions.push("status = ?"); params.push(filter.status); }
    if (filter.provider) { conditions.push("provider_name = ?"); params.push(filter.provider); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = d
      .query(`SELECT * FROM verification_records ${where} ORDER BY COALESCE(completed_at, started_at, created_at) DESC, created_at DESC`)
      .all(...params) as Record<string, unknown>[];
    records.push(...rows.map(portableVerificationRowToRecord));
  } catch {
    // Optional table in older databases; ensureSchema creates it for fresh DBs.
  }

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filter.task_id) { conditions.push("task_id = ?"); params.push(filter.task_id); }
  if (filter.agent_id) { conditions.push("agent_id = ?"); params.push(filter.agent_id); }
  if (filter.status) { conditions.push("status = ?"); params.push(filter.status); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = d
    .query(`SELECT * FROM task_verifications ${where} ORDER BY run_at DESC, created_at DESC`)
    .all(...params) as Record<string, unknown>[];
  records.push(...rows.map(taskVerificationRowToRecord));

  let filtered = records;
  if (filter.agent_id) {
    filtered = filtered.filter((record) => record.agent_id === filter.agent_id || record.evidence.agent_id === filter.agent_id);
  }
  if (filter.run_record_id) {
    filtered = filtered.filter((record) => record.evidence.run_record_id === filter.run_record_id);
  }

  filtered.sort((a, b) => {
    const at = Date.parse(a.run_at || a.created_at || "");
    const bt = Date.parse(b.run_at || b.created_at || "");
    return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
  });

  return filter.limit && filter.limit > 0 ? filtered.slice(0, Math.floor(filter.limit)) : filtered;
}
