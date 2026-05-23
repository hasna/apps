/**
 * Reproducible local environment snapshots — command versions, env shape, git refs.
 * Secrets redacted; offline by default.
 */

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { platform, arch, release, hostname } from "node:os";
import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "../db/database.js";
import { redactExportRecord } from "./secret-redaction.js";

export const ENV_SNAPSHOT_SCHEMA = "todos.env_snapshot.v1";

const REDACTED_ENV_KEYS = /secret|token|password|key|credential|auth/i;

export interface EnvCommandVersion {
  name: string;
  version: string | null;
  available: boolean;
}

export interface EnvSnapshotPayload {
  schema_version: typeof ENV_SNAPSHOT_SCHEMA;
  captured_at: string;
  os: { platform: string; arch: string; release: string; hostname: string };
  cwd: string;
  git_ref: string | null;
  git_dirty: boolean | null;
  package_manager: string | null;
  commands: EnvCommandVersion[];
  env_shape: Record<string, string>;
  machine_id: string | null;
}

export interface EnvSnapshotRecord {
  schema_version: typeof ENV_SNAPSHOT_SCHEMA;
  id: string;
  run_record_id: string | null;
  agent_run_id: string | null;
  cwd: string | null;
  git_ref: string | null;
  content_hash: string;
  snapshot: EnvSnapshotPayload;
  created_at: string;
}

export interface CaptureEnvSnapshotInput {
  cwd?: string;
  run_record_id?: string;
  agent_run_id?: string;
  commands?: string[];
}

export interface EnvSnapshotCheckResult {
  schema_version: typeof ENV_SNAPSHOT_SCHEMA;
  snapshot_id: string;
  current_hash: string;
  stored_hash: string;
  matches: boolean;
  drift: string[];
}

function safeExec(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function detectPackageManager(cwd: string): string | null {
  if (safeExec("test -f bun.lock && echo bun", cwd)) return "bun";
  if (safeExec("test -f pnpm-lock.yaml && echo pnpm", cwd)) return "pnpm";
  if (safeExec("test -f package-lock.json && echo npm", cwd)) return "npm";
  return null;
}

function captureCommandVersions(cwd: string, names: string[]): EnvCommandVersion[] {
  return names.map((name) => {
    const version = safeExec(`${name} --version 2>/dev/null || ${name} -v 2>/dev/null`, cwd);
    return { name, version, available: version !== null };
  });
}

function captureEnvShape(): Record<string, string> {
  const allow = ["PATH", "HOME", "SHELL", "TERM", "LANG", "TODOS_DB_PATH", "TODOS_PROFILE", "TODOS_MACHINE_NAME"];
  const shape: Record<string, string> = {};
  for (const key of allow) {
    const val = process.env[key];
    if (val !== undefined) {
      shape[key] = REDACTED_ENV_KEYS.test(key) ? "[REDACTED]" : val;
    }
  }
  return redactExportRecord(shape) as Record<string, string>;
}

function hashablePayload(payload: EnvSnapshotPayload): Omit<EnvSnapshotPayload, "captured_at"> & { captured_at?: never } {
  const { captured_at: _capturedAt, ...rest } = payload;
  return {
    ...rest,
    os: { platform: rest.os.platform, arch: rest.os.arch, release: rest.os.release, hostname: "[stable]" },
  };
}

function stableHash(payload: EnvSnapshotPayload): string {
  const sorted = JSON.stringify(hashablePayload(payload), Object.keys(hashablePayload(payload)).sort());
  return createHash("sha256").update(sorted).digest("hex");
}

export function buildEnvSnapshotPayload(input: CaptureEnvSnapshotInput = {}): EnvSnapshotPayload {
  const cwd = input.cwd ?? process.cwd();
  const commands = input.commands ?? ["bun", "node", "git", "todos"];
  const gitRef = safeExec("git rev-parse HEAD 2>/dev/null", cwd);
  const gitDirty = safeExec("git status --porcelain 2>/dev/null", cwd);
  return {
    schema_version: ENV_SNAPSHOT_SCHEMA,
    captured_at: new Date().toISOString(),
    os: { platform: platform(), arch: arch(), release: release(), hostname: hostname() },
    cwd,
    git_ref: gitRef,
    git_dirty: gitDirty === null ? null : gitDirty.length > 0,
    package_manager: detectPackageManager(cwd),
    commands: captureCommandVersions(cwd, commands),
    env_shape: captureEnvShape(),
    machine_id: process.env["TODOS_MACHINE_ID"] ?? null,
  };
}

export function captureEnvSnapshot(input: CaptureEnvSnapshotInput = {}, db?: Database): EnvSnapshotRecord {
  const d = db || getDatabase();
  const payload = buildEnvSnapshotPayload(input);
  const cwd = payload.cwd;
  const contentHash = stableHash(payload);
  const id = uuid();
  const ts = now();

  d.run(
    `INSERT INTO env_snapshots (id, run_record_id, agent_run_id, cwd, git_ref, content_hash, snapshot, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.run_record_id ?? null, input.agent_run_id ?? null, cwd, payload.git_ref, contentHash, JSON.stringify(payload), ts],
  );

  return {
    schema_version: ENV_SNAPSHOT_SCHEMA,
    id,
    run_record_id: input.run_record_id ?? null,
    agent_run_id: input.agent_run_id ?? null,
    cwd,
    git_ref: payload.git_ref,
    content_hash: contentHash,
    snapshot: payload,
    created_at: ts,
  };
}

export function getEnvSnapshot(id: string, db?: Database): EnvSnapshotRecord | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM env_snapshots WHERE id = ?").get(id) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    schema_version: ENV_SNAPSHOT_SCHEMA,
    id: row.id as string,
    run_record_id: (row.run_record_id as string) ?? null,
    agent_run_id: (row.agent_run_id as string) ?? null,
    cwd: (row.cwd as string) ?? null,
    git_ref: (row.git_ref as string) ?? null,
    content_hash: row.content_hash as string,
    snapshot: JSON.parse(row.snapshot as string) as EnvSnapshotPayload,
    created_at: row.created_at as string,
  };
}

export function listEnvSnapshots(filter: { run_record_id?: string; limit?: number } = {}, db?: Database): EnvSnapshotRecord[] {
  const d = db || getDatabase();
  let query = "SELECT * FROM env_snapshots WHERE 1=1";
  const params: unknown[] = [];
  if (filter.run_record_id) {
    query += " AND run_record_id = ?";
    params.push(filter.run_record_id);
  }
  query += " ORDER BY created_at DESC";
  if (filter.limit) {
    query += " LIMIT ?";
    params.push(filter.limit);
  }
  return (d.query(query).all(...params) as Record<string, unknown>[]).map((row) => getEnvSnapshot(row.id as string, d)!);
}

export function checkEnvSnapshot(id: string, cwd?: string, db?: Database): EnvSnapshotCheckResult {
  const stored = getEnvSnapshot(id, db);
  if (!stored) throw new Error(`Snapshot not found: ${id}`);

  const currentPayload = buildEnvSnapshotPayload({ cwd: cwd ?? stored.cwd ?? process.cwd() });
  const currentHash = stableHash(currentPayload);
  const drift: string[] = [];

  if (stored.snapshot.git_ref !== currentPayload.git_ref) {
    drift.push(`git_ref: ${stored.snapshot.git_ref} -> ${currentPayload.git_ref}`);
  }
  if (stored.snapshot.package_manager !== currentPayload.package_manager) {
    drift.push(`package_manager: ${stored.snapshot.package_manager} -> ${currentPayload.package_manager}`);
  }
  for (const cmd of stored.snapshot.commands) {
    const cur = currentPayload.commands.find((c) => c.name === cmd.name);
    if (cur?.version !== cmd.version) drift.push(`${cmd.name}: ${cmd.version} -> ${cur?.version}`);
  }

  return {
    schema_version: ENV_SNAPSHOT_SCHEMA,
    snapshot_id: id,
    current_hash: currentHash,
    stored_hash: stored.content_hash,
    matches: drift.length === 0 && currentHash === stored.content_hash,
    drift,
  };
}

export function computeSnapshotHash(payload: EnvSnapshotPayload): string {
  return stableHash(payload);
}
