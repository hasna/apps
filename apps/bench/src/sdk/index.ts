import { seedBenchmarks, type BenchmarkManifest, parseBenchmarkManifest } from "../contracts.js";
import { buildAdapterPlan, listAdapters, type AdapterCommandPlan, type BenchmarkAdapter } from "../adapters.js";
import { evaluateSafetyPolicy, redactEvidenceWithFindings, type SafetyGateResult } from "../safety.js";
import {
  appendResultSegment,
  createAttemptRecord,
  createRunRecord,
  initializeStorage,
  openBenchStorage,
  recordMetric,
  recordProviderUsage,
  type BenchStorage,
  type RecordMetricInput,
  type RecordProviderUsageInput,
  type ResultSegmentRecord,
  type StoredAttempt,
  type StoredRun
} from "../storage.js";
import { VERSION } from "../lib/version.js";
import type { BenchDoctorResult } from "../contracts.js";

export interface CreateBenchOptions {
  env?: NodeJS.ProcessEnv;
}

export interface DryRunPlanInput {
  benchmarkId: string;
  modelId: string;
  provider: string;
  route?: string;
}

export interface DryRunPlan {
  ok: true;
  benchmark: Pick<BenchmarkManifest, "id" | "name" | "category" | "manifestVersion">;
  adapter: Pick<BenchmarkAdapter, "id" | "executionModes" | "install" | "parse">;
  modelId: string;
  provider: string;
  route?: string;
  adapterStatus: string;
  command: string[];
  commandPlan: AdapterCommandPlan;
  capabilities: string[];
  safety: BenchmarkManifest["safety"];
  requiresNetwork: boolean;
  requiresSandbox: boolean;
  warnings: string[];
  gate: SafetyGateResult;
}

export interface RunRecordMetric {
  metricId: string;
  value: number;
  unit?: string;
  direction?: string;
  metadata?: Record<string, unknown>;
}

export interface RunRecordInput {
  benchmarkId: string;
  modelId: string;
  provider: string;
  route?: string;
  metrics?: RunRecordMetric[];
  eventType?: string;
  payload?: unknown;
  usage?: Omit<RecordProviderUsageInput, "runId" | "attemptId" | "provider" | "modelId">;
  labels?: Record<string, unknown>;
}

export interface RunRecordResult {
  ok: true;
  run: StoredRun;
  attempt: StoredAttempt;
  segment: ResultSegmentRecord;
  metricIds: string[];
  usageIds: string[];
}

export interface ResultSummary {
  runId: string;
  benchmarkId: string;
  manifestVersion: string;
  modelId: string;
  provider: string;
  route?: string;
  status: string;
  metricCount: number;
  segmentCount: number;
  artifactCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResultDetail extends ResultSummary {
  attempts: Array<{
    id: string;
    attemptIndex: number;
    status: string;
    startedAt: string;
    completedAt?: string;
  }>;
  metrics: Array<{
    id: string;
    attemptId?: string;
    metricId: string;
    value: number;
    unit?: string;
    direction?: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
  segments: Array<{
    id: string;
    attemptId?: string;
    eventType: string;
    segmentPath: string;
    byteOffset: number;
    byteLength: number;
    recordSha256: string;
    createdAt: string;
  }>;
  artifacts: Array<{
    id: string;
    attemptId?: string;
    kind: string;
    path: string;
    sha256?: string;
    bytes?: number;
    mediaType?: string;
    createdAt: string;
  }>;
  providerUsage: Array<{
    id: string;
    attemptId?: string;
    provider: string;
    modelId: string;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    latencyMs?: number;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
}

export interface ComparisonMetric {
  metricId: string;
  leftValue: number;
  rightValue: number;
  delta: number;
  direction?: string;
}

export interface ComparisonResult {
  ok: true;
  leftRunId: string;
  rightRunId: string;
  metrics: ComparisonMetric[];
}

export interface BenchReport {
  ok: true;
  benchmarkCount: number;
  runCount: number;
  attemptCount: number;
  metricCount: number;
  segmentCount: number;
  artifactCount: number;
  providerUsageCount: number;
  latestRun?: ResultSummary;
}

export interface BenchSDK {
  version: string;
  listSuites(): BenchmarkManifest[];
  listAdapters(): BenchmarkAdapter[];
  showSuite(id: string): BenchmarkManifest;
  validateManifest(input: unknown): BenchmarkManifest;
  doctor(): Promise<BenchDoctorResult>;
  plan(input: DryRunPlanInput): DryRunPlan;
  recordRun(input: RunRecordInput): Promise<RunRecordResult>;
  listResults(): Promise<ResultSummary[]>;
  showResult(runId: string): Promise<ResultDetail>;
  compareResults(leftRunId: string, rightRunId: string, metricId?: string): Promise<ComparisonResult>;
  report(): Promise<BenchReport>;
}

export function createBenchSDK(options: CreateBenchOptions = {}): BenchSDK {
  const env = options.env ?? process.env;

  return {
    version: VERSION,
    listSuites() {
      return seedBenchmarks;
    },
    listAdapters() {
      return listAdapters();
    },
    showSuite(id: string) {
      return findSuite(id);
    },
    validateManifest(input: unknown) {
      return parseBenchmarkManifest(input);
    },
    async doctor() {
      const paths = await initializeStorage(env);
      return {
        ok: true,
        home: paths.home,
        dbPath: paths.dbPath,
        runsDir: paths.runsDir,
        artifactsDir: paths.artifactsDir,
        warnings: []
      };
    },
    plan(input: DryRunPlanInput) {
      const suite = findSuite(input.benchmarkId);
      const adapter = buildAdapterPlan({
        benchmarkId: input.benchmarkId,
        modelId: input.modelId,
        provider: input.provider,
        route: input.route
      });
      const warnings: string[] = [];
      if (!suite.runner.supportsDryRun) warnings.push("Runner does not advertise dry-run support.");
      if (suite.runner.requiresNetwork || suite.safety.allowsNetwork) warnings.push("Real execution may use network access.");
      if (suite.safety.requiresSecrets) warnings.push("Real execution may require secretRef configuration.");
      if (suite.safety.requiresSandbox) warnings.push("Real execution requires an isolated sandbox.");
      if (suite.safety.costRisk === "high") warnings.push("Real execution has high cost risk and requires an explicit budget.");
      const gate = evaluateSafetyPolicy({
        benchmark: suite,
        commandPlan: adapter.plan,
        network: false,
        sandbox: false
      });

      return {
        ok: true,
        benchmark: {
          id: suite.id,
          name: suite.name,
          category: suite.category,
          manifestVersion: suite.manifestVersion
        },
        adapter: {
          id: adapter.id,
          executionModes: adapter.executionModes,
          install: adapter.install,
          parse: adapter.parse
        },
        modelId: input.modelId,
        provider: input.provider,
        route: input.route,
        adapterStatus: suite.adapter.status,
        command: adapter.plan.command,
        commandPlan: adapter.plan,
        capabilities: suite.runner.capabilities,
        safety: suite.safety,
        requiresNetwork: suite.runner.requiresNetwork,
        requiresSandbox: suite.runner.requiresSandbox,
        warnings: [...warnings, ...gate.warnings],
        gate
      };
    },
    async recordRun(input: RunRecordInput) {
      return withStorage(env, async (storage) => {
        const suite = findSuite(input.benchmarkId);
        const declaredMetricIds = new Set(suite.metrics.map((metric) => metric.id));
        for (const metric of input.metrics ?? []) {
          if (!declaredMetricIds.has(metric.metricId)) {
            throw new Error(`Metric ${metric.metricId} is not declared by ${suite.id}`);
          }
        }
        const run = createRunRecord(storage, {
          benchmarkId: suite.id,
          manifestVersion: suite.manifestVersion,
          modelId: input.modelId,
          provider: input.provider,
          route: input.route,
          status: "running",
          labels: input.labels
        });
        const attempt = createAttemptRecord(storage, run.id, "running");
        const metricIds = (input.metrics ?? []).map((metric) => recordMetric(storage, {
          runId: run.id,
          attemptId: attempt.id,
          metricId: metric.metricId,
          value: metric.value,
          unit: metric.unit,
          direction: metric.direction,
          metadata: metric.metadata
        }));
        const usageIds = input.usage
          ? [recordProviderUsage(storage, {
            runId: run.id,
            attemptId: attempt.id,
            provider: input.provider,
            modelId: input.modelId,
            ...input.usage
          })]
          : [];
        const defaultPayload = {
          benchmarkId: suite.id,
          modelId: input.modelId,
          provider: input.provider,
          metrics: input.metrics ?? []
        };
        const redactedPayload = redactEvidenceWithFindings(input.payload ?? defaultPayload);
        const segment = await appendResultSegment(storage, {
          runId: run.id,
          attemptId: attempt.id,
          eventType: input.eventType ?? "manual-record",
          payload: redactedPayload.value
        });

        const completedAt = new Date().toISOString();
        storage.db.query("UPDATE attempts SET status = 'completed', completed_at = ? WHERE id = ?").run(completedAt, attempt.id);
        storage.db.query("UPDATE runs SET status = 'completed', updated_at = ? WHERE id = ?").run(completedAt, run.id);

        return {
          ok: true,
          run: { ...run, status: "completed" },
          attempt: { ...attempt, status: "completed" },
          segment,
          metricIds,
          usageIds
        };
      });
    },
    async listResults() {
      return withStorage(env, async (storage) => listResultSummaries(storage));
    },
    async showResult(runId: string) {
      return withStorage(env, async (storage) => showResultDetail(storage, runId));
    },
    async compareResults(leftRunId: string, rightRunId: string, metricId?: string) {
      return withStorage(env, async (storage) => compareResultMetrics(storage, leftRunId, rightRunId, metricId));
    },
    async report() {
      return withStorage(env, async (storage) => {
        const latestRun = listResultSummaries(storage)[0];
        return {
          ok: true,
          benchmarkCount: countRows(storage, "benchmarks"),
          runCount: countRows(storage, "runs"),
          attemptCount: countRows(storage, "attempts"),
          metricCount: countRows(storage, "metrics"),
          segmentCount: countRows(storage, "result_segments"),
          artifactCount: countRows(storage, "artifacts"),
          providerUsageCount: countRows(storage, "provider_usage"),
          latestRun
        };
      });
    }
  };
}

async function withStorage<T>(env: NodeJS.ProcessEnv, action: (storage: BenchStorage) => Promise<T> | T): Promise<T> {
  const storage = await openBenchStorage(env);
  try {
    return await action(storage);
  } finally {
    storage.close();
  }
}

function findSuite(id: string): BenchmarkManifest {
  const suite = seedBenchmarks.find((benchmark) => benchmark.id === id);
  if (!suite) throw new Error(`Unknown benchmark suite: ${id}`);
  return suite;
}

function listResultSummaries(storage: BenchStorage): ResultSummary[] {
  return storage.db.query<{
    run_id: string;
    benchmark_id: string;
    manifest_version: string;
    model_id: string;
    provider: string;
    route: string | null;
    status: string;
    metric_count: number;
    segment_count: number;
    artifact_count: number;
    created_at: string;
    updated_at: string;
  }, []>(`
SELECT
  runs.id as run_id,
  runs.benchmark_id,
  runs.manifest_version,
  runs.model_id,
  runs.provider,
  runs.route,
  runs.status,
  COUNT(DISTINCT metrics.id) as metric_count,
  COUNT(DISTINCT result_segments.id) as segment_count,
  COUNT(DISTINCT artifacts.id) as artifact_count,
  runs.created_at,
  runs.updated_at
FROM runs
LEFT JOIN metrics ON metrics.run_id = runs.id
LEFT JOIN result_segments ON result_segments.run_id = runs.id
LEFT JOIN artifacts ON artifacts.run_id = runs.id
GROUP BY runs.id
ORDER BY runs.created_at DESC
`).all().map((row) => ({
    runId: row.run_id,
    benchmarkId: row.benchmark_id,
    manifestVersion: row.manifest_version,
    modelId: row.model_id,
    provider: row.provider,
    route: row.route ?? undefined,
    status: row.status,
    metricCount: row.metric_count,
    segmentCount: row.segment_count,
    artifactCount: row.artifact_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function showResultDetail(storage: BenchStorage, runId: string): ResultDetail {
  const summary = listResultSummaries(storage).find((result) => result.runId === runId);
  if (!summary) throw new Error(`Unknown run id: ${runId}`);

  return {
    ...summary,
    attempts: storage.db.query<{
      id: string;
      attempt_index: number;
      status: string;
      started_at: string;
      completed_at: string | null;
    }, [string]>("SELECT id, attempt_index, status, started_at, completed_at FROM attempts WHERE run_id = ? ORDER BY attempt_index").all(runId).map((row) => ({
      id: row.id,
      attemptIndex: row.attempt_index,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined
    })),
    metrics: storage.db.query<{
      id: string;
      attempt_id: string | null;
      metric_id: string;
      value: number;
      unit: string | null;
      direction: string | null;
      metadata_json: string;
      created_at: string;
    }, [string]>("SELECT id, attempt_id, metric_id, value, unit, direction, metadata_json, created_at FROM metrics WHERE run_id = ? ORDER BY created_at, id").all(runId).map((row) => ({
      id: row.id,
      attemptId: row.attempt_id ?? undefined,
      metricId: row.metric_id,
      value: row.value,
      unit: row.unit ?? undefined,
      direction: row.direction ?? undefined,
      metadata: parseStoredJson(row.metadata_json),
      createdAt: row.created_at
    })),
    segments: storage.db.query<{
      id: string;
      attempt_id: string | null;
      event_type: string;
      segment_path: string;
      byte_offset: number;
      byte_length: number;
      record_sha256: string;
      created_at: string;
    }, [string]>("SELECT id, attempt_id, event_type, segment_path, byte_offset, byte_length, record_sha256, created_at FROM result_segments WHERE run_id = ? ORDER BY byte_offset").all(runId).map((row) => ({
      id: row.id,
      attemptId: row.attempt_id ?? undefined,
      eventType: row.event_type,
      segmentPath: row.segment_path,
      byteOffset: row.byte_offset,
      byteLength: row.byte_length,
      recordSha256: row.record_sha256,
      createdAt: row.created_at
    })),
    artifacts: storage.db.query<{
      id: string;
      attempt_id: string | null;
      kind: string;
      path: string;
      sha256: string | null;
      bytes: number | null;
      media_type: string | null;
      created_at: string;
    }, [string]>("SELECT id, attempt_id, kind, path, sha256, bytes, media_type, created_at FROM artifacts WHERE run_id = ? ORDER BY created_at, id").all(runId).map((row) => ({
      id: row.id,
      attemptId: row.attempt_id ?? undefined,
      kind: row.kind,
      path: row.path,
      sha256: row.sha256 ?? undefined,
      bytes: row.bytes ?? undefined,
      mediaType: row.media_type ?? undefined,
      createdAt: row.created_at
    })),
    providerUsage: storage.db.query<{
      id: string;
      attempt_id: string | null;
      provider: string;
      model_id: string;
      input_tokens: number | null;
      output_tokens: number | null;
      cost_usd: number | null;
      latency_ms: number | null;
      metadata_json: string;
      created_at: string;
    }, [string]>(`
SELECT id, attempt_id, provider, model_id, input_tokens, output_tokens, cost_usd, latency_ms, metadata_json, created_at
FROM provider_usage
WHERE run_id = ?
ORDER BY created_at, id
`).all(runId).map((row) => ({
      id: row.id,
      attemptId: row.attempt_id ?? undefined,
      provider: row.provider,
      modelId: row.model_id,
      inputTokens: row.input_tokens ?? undefined,
      outputTokens: row.output_tokens ?? undefined,
      costUsd: row.cost_usd ?? undefined,
      latencyMs: row.latency_ms ?? undefined,
      metadata: parseStoredJson(row.metadata_json),
      createdAt: row.created_at
    }))
  };
}

function compareResultMetrics(
  storage: BenchStorage,
  leftRunId: string,
  rightRunId: string,
  metricId?: string
): ComparisonResult {
  const left = latestMetricValues(storage, leftRunId);
  const right = latestMetricValues(storage, rightRunId);
  const ids = metricId ? [metricId] : [...left.keys()].filter((id) => right.has(id)).sort();
  const metrics = ids.map((id) => {
    const leftMetric = left.get(id);
    const rightMetric = right.get(id);
    if (!leftMetric || !rightMetric) throw new Error(`Metric ${id} is not present in both runs`);
    return {
      metricId: id,
      leftValue: leftMetric.value,
      rightValue: rightMetric.value,
      delta: rightMetric.value - leftMetric.value,
      direction: rightMetric.direction ?? leftMetric.direction
    };
  });

  return { ok: true, leftRunId, rightRunId, metrics };
}

function latestMetricValues(storage: BenchStorage, runId: string): Map<string, { value: number; direction?: string }> {
  showResultDetail(storage, runId);
  const rows = storage.db.query<{
    metric_id: string;
    value: number;
    direction: string | null;
  }, [string]>(`
SELECT metric_id, value, direction
FROM metrics
WHERE run_id = ?
ORDER BY created_at ASC, id ASC
`).all(runId);
  const values = new Map<string, { value: number; direction?: string }>();
  for (const row of rows) values.set(row.metric_id, { value: row.value, direction: row.direction ?? undefined });
  return values;
}

function countRows(storage: BenchStorage, table: string): number {
  const safeTables = new Set([
    "benchmarks",
    "runs",
    "attempts",
    "metrics",
    "result_segments",
    "artifacts",
    "provider_usage"
  ]);
  if (!safeTables.has(table)) throw new Error(`Unsafe table name: ${table}`);
  return storage.db.query<{ count: number }, []>(`SELECT COUNT(*) as count FROM ${table}`).get()?.count ?? 0;
}

function parseStoredJson(input: string): Record<string, unknown> {
  const parsed = JSON.parse(input);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

export type { BenchmarkManifest, BenchDoctorResult };
