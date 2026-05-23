/**
 * Local verification provider adapters — shell, testbox, CI snapshots, manual evidence.
 * Produces normalized evidence records; no hosted API requirements.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "../db/database.js";
import { addArtifact } from "../db/artifacts.js";

export const VERIFICATION_SCHEMA_VERSION = "todos.verification.v1";

export const VERIFICATION_PROVIDER_TYPES = ["shell", "testbox", "ci_snapshot", "manual"] as const;
export type VerificationProviderType = (typeof VERIFICATION_PROVIDER_TYPES)[number];

export const VERIFICATION_STATUSES = ["passed", "failed", "skipped", "pending"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export interface VerificationProviderConfig {
  name: string;
  type: VerificationProviderType;
  /** Shell/testbox command or script */
  command?: string;
  cwd?: string;
  timeout_ms?: number;
  /** testbox: test file glob or path */
  test_pattern?: string;
  /** ci_snapshot: path to snapshot JSON */
  snapshot_path?: string;
}

export interface VerificationEvidenceRecord {
  schema_version: typeof VERIFICATION_SCHEMA_VERSION;
  id: string;
  task_id: string | null;
  provider_name: string;
  provider_type: VerificationProviderType;
  status: VerificationStatus;
  summary: string;
  evidence: Record<string, unknown>;
  artifact_id: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface RunVerificationInput {
  provider: string;
  task_id?: string;
  /** manual provider note */
  note?: string;
  /** manual: attach file path */
  evidence_path?: string;
  /** ci_snapshot override path */
  snapshot_path?: string;
  cwd?: string;
}

export interface VerificationProvidersFile {
  providers: VerificationProviderConfig[];
}

function getProvidersPath(): string {
  const cwd = process.cwd();
  const local = join(cwd, ".todos", "verification-providers.json");
  if (existsSync(local)) return local;
  const home = process.env["HOME"] || "~";
  return join(home, ".hasna", "todos", "verification-providers.json");
}

let cachedProviders: VerificationProviderConfig[] | null = null;

export function resetVerificationProviderCache(): void {
  cachedProviders = null;
}

export function getDefaultProviders(): VerificationProviderConfig[] {
  return [
    { name: "test", type: "testbox", command: "bun test", test_pattern: "**/*.test.ts" },
    { name: "typecheck", type: "shell", command: "bun run typecheck", timeout_ms: 120_000 },
    { name: "lint", type: "shell", command: "bun test --bail", timeout_ms: 300_000 },
  ];
}

export function loadVerificationProviders(): VerificationProviderConfig[] {
  if (cachedProviders) return cachedProviders;
  const path = getProvidersPath();
  if (!existsSync(path)) {
    cachedProviders = getDefaultProviders();
    return cachedProviders;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as VerificationProvidersFile;
  cachedProviders = parsed.providers?.length ? parsed.providers : getDefaultProviders();
  return cachedProviders;
}

export function saveVerificationProviders(providers: VerificationProviderConfig[]): void {
  const path = getProvidersPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ providers }, null, 2));
  cachedProviders = providers;
}

export function getVerificationProvider(name: string): VerificationProviderConfig | null {
  return loadVerificationProviders().find((p) => p.name === name) ?? null;
}

function rowToRecord(row: Record<string, unknown>): VerificationEvidenceRecord {
  return {
    schema_version: VERIFICATION_SCHEMA_VERSION,
    id: row.id as string,
    task_id: (row.task_id as string) ?? null,
    provider_name: row.provider_name as string,
    provider_type: row.provider_type as VerificationProviderType,
    status: row.status as VerificationStatus,
    summary: row.summary as string,
    evidence: row.evidence ? JSON.parse(row.evidence as string) : {},
    artifact_id: (row.artifact_id as string) ?? null,
    started_at: row.started_at as string,
    completed_at: (row.completed_at as string) ?? null,
    created_at: row.created_at as string,
  };
}

function persistRecord(
  record: Omit<VerificationEvidenceRecord, "schema_version">,
  db?: Database,
): VerificationEvidenceRecord {
  const d = db || getDatabase();
  d.run(
    `INSERT INTO verification_records (
      id, task_id, provider_name, provider_type, status, summary, evidence,
      artifact_id, started_at, completed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.task_id,
      record.provider_name,
      record.provider_type,
      record.status,
      record.summary,
      JSON.stringify(record.evidence),
      record.artifact_id,
      record.started_at,
      record.completed_at,
      record.created_at,
    ],
  );
  return { schema_version: VERIFICATION_SCHEMA_VERSION, ...record };
}

function runShellProvider(
  config: VerificationProviderConfig,
  cwd?: string,
): { status: VerificationStatus; summary: string; evidence: Record<string, unknown> } {
  const command = config.command ?? "true";
  const workDir = cwd || config.cwd || process.cwd();
  const timeout = config.timeout_ms ?? 300_000;
  const started = Date.now();
  const result = spawnSync(command, {
    shell: true,
    cwd: workDir,
    encoding: "utf8",
    timeout,
  });
  const elapsed = Date.now() - started;
  const passed = result.status === 0;
  return {
    status: passed ? "passed" : "failed",
    summary: passed ? `Shell check passed (${elapsed}ms)` : `Shell check failed (exit ${result.status})`,
    evidence: {
      command,
      cwd: workDir,
      exit_code: result.status,
      stdout: (result.stdout || "").slice(-4000),
      stderr: (result.stderr || "").slice(-4000),
      elapsed_ms: elapsed,
    },
  };
}

function runTestboxProvider(
  config: VerificationProviderConfig,
  cwd?: string,
): { status: VerificationStatus; summary: string; evidence: Record<string, unknown> } {
  const workDir = cwd || config.cwd || process.cwd();
  const pattern = config.test_pattern;
  const cmd = pattern ? `bun test ${pattern}` : (config.command ?? "bun test");
  return runShellProvider({ ...config, command: cmd, cwd: workDir }, workDir);
}

function runCiSnapshotProvider(
  config: VerificationProviderConfig,
  snapshotPath?: string,
): { status: VerificationStatus; summary: string; evidence: Record<string, unknown> } {
  const path = resolve(snapshotPath || config.snapshot_path || "");
  if (!path || !existsSync(path)) {
    return {
      status: "failed",
      summary: "CI snapshot file not found",
      evidence: { snapshot_path: path },
    };
  }
  const raw = readFileSync(path, "utf8");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { status: "failed", summary: "CI snapshot is not valid JSON", evidence: { snapshot_path: path } };
  }
  const statusRaw = String(parsed.status ?? parsed.result ?? "unknown").toLowerCase();
  const passed = statusRaw === "passed" || statusRaw === "success" || statusRaw === "ok";
  return {
    status: passed ? "passed" : "failed",
    summary: passed ? "CI snapshot passed" : `CI snapshot ${statusRaw}`,
    evidence: { snapshot_path: path, snapshot: parsed },
  };
}

function runManualProvider(
  note?: string,
  evidencePath?: string,
  taskId?: string,
  db?: Database,
): { status: VerificationStatus; summary: string; evidence: Record<string, unknown>; artifact_id: string | null } {
  if (!note && !evidencePath) {
    return {
      status: "skipped",
      summary: "Manual verification skipped — no note or evidence",
      evidence: {},
      artifact_id: null,
    };
  }
  let artifactId: string | null = null;
  if (evidencePath && taskId) {
    const artifact = addArtifact({
      entity_type: "verification",
      entity_id: taskId,
      source_path: evidencePath,
      storage_mode: "copy",
    }, db);
    artifactId = artifact.id;
  }
  return {
    status: "passed",
    summary: note || "Manual evidence attached",
    evidence: { note, evidence_path: evidencePath ?? null },
    artifact_id: artifactId,
  };
}

export function runVerification(
  input: RunVerificationInput,
  db?: Database,
): VerificationEvidenceRecord {
  const config = getVerificationProvider(input.provider);
  if (!config) {
    throw new Error(`Unknown verification provider: ${input.provider}`);
  }

  const id = uuid();
  const startedAt = now();
  let result: { status: VerificationStatus; summary: string; evidence: Record<string, unknown>; artifact_id?: string | null };

  switch (config.type) {
    case "shell":
      result = runShellProvider(config, input.cwd);
      break;
    case "testbox":
      result = runTestboxProvider(config, input.cwd);
      break;
    case "ci_snapshot":
      result = runCiSnapshotProvider(config, input.snapshot_path);
      break;
    case "manual":
      result = runManualProvider(input.note, input.evidence_path, input.task_id, db);
      break;
    default:
      throw new Error(`Unsupported provider type: ${config.type}`);
  }

  return persistRecord({
    id,
    task_id: input.task_id ?? null,
    provider_name: config.name,
    provider_type: config.type,
    status: result.status,
    summary: result.summary,
    evidence: result.evidence,
    artifact_id: result.artifact_id ?? null,
    started_at: startedAt,
    completed_at: now(),
    created_at: startedAt,
  }, db);
}

export function listVerificationRecords(filter: { task_id?: string; provider?: string; limit?: number } = {}, db?: Database): VerificationEvidenceRecord[] {
  const d = db || getDatabase();
  let query = "SELECT * FROM verification_records WHERE 1=1";
  const params: unknown[] = [];
  if (filter.task_id) {
    query += " AND task_id = ?";
    params.push(filter.task_id);
  }
  if (filter.provider) {
    query += " AND provider_name = ?";
    params.push(filter.provider);
  }
  query += " ORDER BY created_at DESC";
  if (filter.limit) {
    query += " LIMIT ?";
    params.push(filter.limit);
  }
  return (d.query(query).all(...params) as Record<string, unknown>[]).map(rowToRecord);
}

export function getVerificationRecord(id: string, db?: Database): VerificationEvidenceRecord | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM verification_records WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? rowToRecord(row) : null;
}
