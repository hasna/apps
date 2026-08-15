import { randomUUID, createHash } from "node:crypto";
import { mkdir, stat, appendFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Database } from "bun:sqlite";
import { ensureBenchDirs, resolveBenchPaths, type BenchPaths } from "./lib/paths.js";
import { seedBenchmarks, type BenchmarkManifest } from "./contracts.js";
import { assertNoRawSecrets, redactEvidence } from "./redaction.js";

export type { BenchPaths };
export { ensureBenchDirs, resolveBenchHome, resolveBenchPaths } from "./lib/paths.js";

export const DEFAULT_RESULT_SEGMENT_BYTE_LIMIT = 1024 * 1024;

export type RunStatus = "created" | "running" | "completed" | "failed" | "cancelled";
export type AttemptStatus = "created" | "running" | "completed" | "failed";

export interface BenchStorage {
  paths: BenchPaths;
  db: Database;
  close(): void;
}

export interface StoredRun {
  id: string;
  benchmarkId: string;
  manifestVersion: string;
  modelId: string;
  provider: string;
  route?: string;
  status: RunStatus;
  createdAt: string;
}

export interface CreateRunInput {
  benchmarkId: string;
  manifestVersion?: string;
  modelId: string;
  provider: string;
  route?: string;
  status?: RunStatus;
  labels?: Record<string, unknown>;
}

export interface StoredAttempt {
  id: string;
  runId: string;
  attemptIndex: number;
  status: AttemptStatus;
  startedAt: string;
}

export interface AppendResultSegmentInput {
  runId: string;
  attemptId?: string;
  eventType: string;
  payload: unknown;
  createdAt?: string;
  maxBytes?: number;
}

export interface ResultSegmentRecord {
  id: string;
  runId: string;
  attemptId?: string;
  eventType: string;
  segmentPath: string;
  byteOffset: number;
  byteLength: number;
  recordSha256: string;
  createdAt: string;
}

export interface RecordMetricInput {
  runId: string;
  attemptId?: string;
  metricId: string;
  value: number;
  unit?: string;
  direction?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordArtifactInput {
  runId: string;
  attemptId?: string;
  kind: string;
  path: string;
  sha256?: string;
  bytes?: number;
  mediaType?: string;
}

export interface RecordProviderUsageInput {
  runId: string;
  attemptId?: string;
  provider: string;
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
}

const appendLocks = new Map<string, Promise<void>>();

export async function initializeStorage(env: NodeJS.ProcessEnv = process.env): Promise<BenchPaths> {
  const storage = await openBenchStorage(env);
  storage.close();
  return storage.paths;
}

export async function openBenchStorage(env: NodeJS.ProcessEnv = process.env): Promise<BenchStorage> {
  const paths = await ensureBenchDirs(resolveBenchPaths(env));
  await mkdir(dirname(paths.dbPath), { recursive: true });

  const db = new Database(paths.dbPath, { create: true });
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  migrate(db);

  const storage: BenchStorage = {
    paths,
    db,
    close() {
      db.close();
    }
  };

  syncBenchmarkRegistry(storage);
  return storage;
}

function migrate(db: Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS registries (
  id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  benchmark_count INTEGER NOT NULL,
  registry_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS benchmarks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  current_manifest_version TEXT NOT NULL,
  adapter_status TEXT NOT NULL,
  safety_class TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS benchmark_versions (
  benchmark_id TEXT NOT NULL,
  manifest_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (benchmark_id, manifest_version),
  FOREIGN KEY (benchmark_id) REFERENCES benchmarks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  benchmark_id TEXT NOT NULL,
  manifest_version TEXT NOT NULL,
  model_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  route TEXT,
  status TEXT NOT NULL,
  labels_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (benchmark_id, manifest_version) REFERENCES benchmark_versions(benchmark_id, manifest_version)
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  attempt_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (run_id, attempt_index),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS result_segments (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  attempt_id TEXT,
  event_type TEXT NOT NULL,
  segment_path TEXT NOT NULL,
  byte_offset INTEGER NOT NULL,
  byte_length INTEGER NOT NULL,
  record_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  attempt_id TEXT,
  metric_id TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT,
  direction TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  attempt_id TEXT,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT,
  bytes INTEGER,
  media_type TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS provider_usage (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  attempt_id TEXT,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  latency_ms INTEGER,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_benchmark ON runs(benchmark_id, manifest_version);
CREATE INDEX IF NOT EXISTS idx_attempts_run ON attempts(run_id);
CREATE INDEX IF NOT EXISTS idx_segments_run ON result_segments(run_id, byte_offset);
CREATE INDEX IF NOT EXISTS idx_metrics_run ON metrics(run_id, metric_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_usage_run ON provider_usage(run_id);

INSERT OR IGNORE INTO schema_migrations (id) VALUES ('001_initial_storage');
INSERT OR IGNORE INTO schema_migrations (id) VALUES ('002_storage_hardening');
`);
}

export function syncBenchmarkRegistry(storage: BenchStorage, benchmarks: BenchmarkManifest[] = seedBenchmarks): void {
  const createdAt = nowIso();
  const registryHash = sha256Hex(stableJson(benchmarks));

  storage.db
    .query("INSERT OR IGNORE INTO registries (id, schema_version, benchmark_count, registry_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(registryHash, "bench.manifest.v1", benchmarks.length, registryHash, createdAt);

  const upsertBenchmark = storage.db.query(`
INSERT INTO benchmarks (id, name, category, current_manifest_version, adapter_status, safety_class, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  category=excluded.category,
  current_manifest_version=excluded.current_manifest_version,
  adapter_status=excluded.adapter_status,
  safety_class=excluded.safety_class,
  updated_at=excluded.updated_at
`);

  const insertVersion = storage.db.query(`
INSERT INTO benchmark_versions (
  benchmark_id,
  manifest_version,
  schema_version,
  manifest_json,
  manifest_hash,
  source_hash,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
`);

  const transaction = storage.db.transaction((items: BenchmarkManifest[]) => {
    for (const benchmark of items) {
      const manifestJson = stableJson(benchmark);
      const manifestHash = sha256Hex(manifestJson);
      const sourceHash = sha256Hex(stableJson(benchmark.sources));
      const existingVersion = storage.db
        .query<{ manifest_hash: string }, [string, string]>(
          "SELECT manifest_hash FROM benchmark_versions WHERE benchmark_id = ? AND manifest_version = ?"
        )
        .get(benchmark.id, benchmark.manifestVersion);

      if (existingVersion && existingVersion.manifest_hash !== manifestHash) {
        throw new Error(
          `Manifest version drift for ${benchmark.id}@${benchmark.manifestVersion}; bump manifestVersion before changing immutable metadata`
        );
      }

      upsertBenchmark.run(
        benchmark.id,
        benchmark.name,
        benchmark.category,
        benchmark.manifestVersion,
        benchmark.adapter.status,
        benchmark.safety.class,
        createdAt
      );
      if (existingVersion) continue;
      insertVersion.run(
        benchmark.id,
        benchmark.manifestVersion,
        benchmark.schemaVersion,
        manifestJson,
        manifestHash,
        sourceHash,
        createdAt
      );
    }
  });

  transaction(benchmarks);
}

export function createRunRecord(storage: BenchStorage, input: CreateRunInput): StoredRun {
  assertNoRawSecrets({
    modelId: input.modelId,
    provider: input.provider,
    route: input.route,
    labels: input.labels
  }, "run metadata");

  const createdAt = nowIso();
  const manifestVersion = input.manifestVersion ?? currentManifestVersion(storage, input.benchmarkId);
  const run: StoredRun = {
    id: `run_${randomUUID()}`,
    benchmarkId: input.benchmarkId,
    manifestVersion,
    modelId: input.modelId,
    provider: input.provider,
    route: input.route,
    status: input.status ?? "created",
    createdAt
  };

  storage.db.query(`
INSERT INTO runs (id, benchmark_id, manifest_version, model_id, provider, route, status, labels_json, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
    run.id,
    run.benchmarkId,
    run.manifestVersion,
    run.modelId,
    run.provider,
    run.route ?? null,
    run.status,
    stableJson(input.labels ?? {}),
    createdAt,
    createdAt
  );

  return run;
}

export function createAttemptRecord(storage: BenchStorage, runId: string, status: AttemptStatus = "created"): StoredAttempt {
  const startedAt = nowIso();
  const row = storage.db
    .query<{ nextIndex: number }, [string]>("SELECT COALESCE(MAX(attempt_index) + 1, 1) as nextIndex FROM attempts WHERE run_id = ?")
    .get(runId);
  const attempt: StoredAttempt = {
    id: `attempt_${randomUUID()}`,
    runId,
    attemptIndex: row?.nextIndex ?? 1,
    status,
    startedAt
  };

  storage.db.query(`
INSERT INTO attempts (id, run_id, attempt_index, status, started_at)
VALUES (?, ?, ?, ?, ?)
`).run(attempt.id, attempt.runId, attempt.attemptIndex, attempt.status, attempt.startedAt);

  return attempt;
}

export async function appendResultSegment(
  storage: BenchStorage,
  input: AppendResultSegmentInput
): Promise<ResultSegmentRecord> {
  assertRunExists(storage, input.runId);
  if (input.attemptId) assertAttemptBelongsToRun(storage, input.runId, input.attemptId);
  if (!input.eventType.trim()) throw new Error("Result segment eventType cannot be empty");
  const redactedPayload = redactEvidence(input.payload);

  const createdAt = input.createdAt ?? nowIso();
  const runDir = join(storage.paths.runsDir, input.runId);
  await mkdir(runDir, { recursive: true });

  const segmentPath = join(runDir, "results.jsonl");
  const event = {
    schemaVersion: "bench.result-segment.v1",
    id: `segment_${randomUUID()}`,
    runId: input.runId,
    attemptId: input.attemptId,
    eventType: input.eventType,
    payload: redactedPayload,
    createdAt
  };
  const line = `${stableJson(event)}\n`;
  const byteLength = Buffer.byteLength(line);
  const maxBytes = input.maxBytes ?? DEFAULT_RESULT_SEGMENT_BYTE_LIMIT;
  if (byteLength > maxBytes) {
    throw new Error(
      `Result segment is ${byteLength} bytes, above the ${maxBytes} byte limit; store large raw output as an artifact`
    );
  }
  const recordSha256 = sha256Hex(line);

  return withAppendLock(segmentPath, async () => {
    const byteOffset = await fileSize(segmentPath);
    await appendFile(segmentPath, line, "utf8");

    const record: ResultSegmentRecord = {
      id: event.id,
      runId: input.runId,
      attemptId: input.attemptId,
      eventType: input.eventType,
      segmentPath,
      byteOffset,
      byteLength,
      recordSha256,
      createdAt
    };

    storage.db.query(`
INSERT INTO result_segments (
  id,
  run_id,
  attempt_id,
  event_type,
  segment_path,
  byte_offset,
  byte_length,
  record_sha256,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
      record.id,
      record.runId,
      record.attemptId ?? null,
      record.eventType,
      record.segmentPath,
      record.byteOffset,
      record.byteLength,
      record.recordSha256,
      record.createdAt
    );

    return record;
  });
}

export function recordMetric(storage: BenchStorage, input: RecordMetricInput): string {
  assertRunExists(storage, input.runId);
  if (input.attemptId) assertAttemptBelongsToRun(storage, input.runId, input.attemptId);
  if (!Number.isFinite(input.value)) throw new Error("Metric value must be finite");
  assertNoRawSecrets({
    metricId: input.metricId,
    unit: input.unit,
    direction: input.direction,
    metadata: input.metadata
  }, "metric metadata");

  const id = `metric_${randomUUID()}`;
  storage.db.query(`
INSERT INTO metrics (id, run_id, attempt_id, metric_id, value, unit, direction, metadata_json, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
    id,
    input.runId,
    input.attemptId ?? null,
    input.metricId,
    input.value,
    input.unit ?? null,
    input.direction ?? null,
    stableJson(input.metadata ?? {}),
    nowIso()
  );
  return id;
}

export function recordArtifact(storage: BenchStorage, input: RecordArtifactInput): string {
  assertRunExists(storage, input.runId);
  if (input.attemptId) assertAttemptBelongsToRun(storage, input.runId, input.attemptId);
  assertNoRawSecrets({
    kind: input.kind,
    path: input.path,
    sha256: input.sha256,
    mediaType: input.mediaType
  }, "artifact metadata");

  const id = `artifact_${randomUUID()}`;
  const artifactPath = resolveArtifactPath(storage, input.path);
  storage.db.query(`
INSERT INTO artifacts (id, run_id, attempt_id, kind, path, sha256, bytes, media_type, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
    id,
    input.runId,
    input.attemptId ?? null,
    input.kind,
    artifactPath,
    input.sha256 ?? null,
    input.bytes ?? null,
    input.mediaType ?? null,
    nowIso()
  );
  return id;
}

export function recordProviderUsage(storage: BenchStorage, input: RecordProviderUsageInput): string {
  assertRunExists(storage, input.runId);
  if (input.attemptId) assertAttemptBelongsToRun(storage, input.runId, input.attemptId);
  assertNoRawSecrets({
    provider: input.provider,
    modelId: input.modelId,
    metadata: input.metadata
  }, "provider usage metadata");
  assertOptionalNonNegativeInteger(input.inputTokens, "inputTokens");
  assertOptionalNonNegativeInteger(input.outputTokens, "outputTokens");
  assertOptionalNonNegativeNumber(input.costUsd, "costUsd");
  assertOptionalNonNegativeInteger(input.latencyMs, "latencyMs");

  const id = `usage_${randomUUID()}`;
  storage.db.query(`
INSERT INTO provider_usage (
  id,
  run_id,
  attempt_id,
  provider,
  model_id,
  input_tokens,
  output_tokens,
  cost_usd,
  latency_ms,
  metadata_json,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
    id,
    input.runId,
    input.attemptId ?? null,
    input.provider,
    input.modelId,
    input.inputTokens ?? null,
    input.outputTokens ?? null,
    input.costUsd ?? null,
    input.latencyMs ?? null,
    stableJson(input.metadata ?? {}),
    nowIso()
  );
  return id;
}

export function stableJson(input: unknown): string {
  return JSON.stringify(sortJson(input));
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

function currentManifestVersion(storage: BenchStorage, benchmarkId: string): string {
  const row = storage.db
    .query<{ current_manifest_version: string }, [string]>("SELECT current_manifest_version FROM benchmarks WHERE id = ?")
    .get(benchmarkId);

  if (!row) {
    throw new Error(`Unknown benchmark id: ${benchmarkId}`);
  }

  return row.current_manifest_version;
}

function assertRunExists(storage: BenchStorage, runId: string): void {
  const row = storage.db.query<{ id: string }, [string]>("SELECT id FROM runs WHERE id = ?").get(runId);
  if (!row) throw new Error(`Unknown run id: ${runId}`);
}

function assertAttemptBelongsToRun(storage: BenchStorage, runId: string, attemptId: string): void {
  const row = storage.db
    .query<{ id: string }, [string, string]>("SELECT id FROM attempts WHERE id = ? AND run_id = ?")
    .get(attemptId, runId);

  if (!row) throw new Error(`Attempt ${attemptId} does not belong to run ${runId}`);
}

function assertOptionalFiniteNumber(value: number | undefined, field: string): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
}

function assertOptionalInteger(value: number | undefined, field: string): void {
  assertOptionalFiniteNumber(value, field);
  if (value !== undefined && !Number.isInteger(value)) throw new Error(`${field} must be an integer`);
}

function assertOptionalNonNegativeNumber(value: number | undefined, field: string): void {
  assertOptionalFiniteNumber(value, field);
  if (value !== undefined && value < 0) throw new Error(`${field} must be non-negative`);
}

function assertOptionalNonNegativeInteger(value: number | undefined, field: string): void {
  assertOptionalInteger(value, field);
  if (value !== undefined && value < 0) throw new Error(`${field} must be non-negative`);
}

function resolveArtifactPath(storage: BenchStorage, inputPath: string): string {
  const homeRoot = resolve(storage.paths.home);
  const artifactsRoot = resolve(storage.paths.artifactsDir);
  const resolvedPath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(artifactsRoot, inputPath);

  if (isAbsolute(inputPath)) {
    assertPathInside(homeRoot, resolvedPath, "Artifact paths must stay inside HASNA_BENCH_HOME");
    return resolvedPath;
  }

  assertPathInside(artifactsRoot, resolvedPath, "Relative artifact paths must stay inside the artifacts directory");
  return resolvedPath;
}

function assertPathInside(root: string, target: string, message: string): void {
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`) && !isAbsolute(rel))) return;
  throw new Error(message);
}

async function withAppendLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = appendLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent;
  });
  const chain = previous.catch(() => undefined).then(() => current);
  appendLocks.set(key, chain);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (appendLocks.get(key) === chain) appendLocks.delete(key);
  }
}

function sortJson(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sortJson);
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, sortJson(value)])
    );
  }
  return input;
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}
