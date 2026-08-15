import { createRunRecord, createAttemptRecord, appendResultSegment, recordMetric, recordProviderUsage, type BenchStorage } from "./storage.js";
import { buildAdapterPlan, getAdapter } from "./adapters.js";
import { seedBenchmarks } from "./contracts.js";
import { assertSafetyPolicy, createEvidenceManifest, redactEvidenceWithFindings, type SafetyLimits } from "./safety.js";
import { VERSION } from "./lib/version.js";

export type RunnableMode = "fixture-json";

export interface FixtureRunInput {
  benchmarkId: string;
  modelId: string;
  provider: string;
  payload: unknown;
  mode?: RunnableMode;
  secretRefs?: string[];
  sandbox?: boolean;
  network?: boolean;
  limits?: SafetyLimits;
}

export interface NormalizedMetric {
  metricId: string;
  value: number;
  unit?: string;
  direction?: string;
}

export interface FixtureRunResult {
  ok: true;
  runId: string;
  attemptId: string;
  metrics: NormalizedMetric[];
}

const runnableFixtureBenchmarks = new Set([
  "lm-evaluation-harness",
  "promptfoo",
  "ragas",
  "llmperf"
]);

export async function runFixtureAdapter(storage: BenchStorage, input: FixtureRunInput): Promise<FixtureRunResult> {
  const adapter = getAdapter(input.benchmarkId);
  const manifest = seedBenchmarks.find((benchmark) => benchmark.id === input.benchmarkId);
  if (!manifest) throw new Error(`Unknown benchmark id: ${input.benchmarkId}`);
  if (!runnableFixtureBenchmarks.has(input.benchmarkId)) {
    throw new Error(`Fixture recording is not enabled for ${input.benchmarkId}`);
  }
  if (adapter.run.requiresSandbox) {
    throw new Error(`Refusing to record sandbox-required adapter ${input.benchmarkId} in fixture mode`);
  }

  const redactedPayload = redactEvidenceWithFindings(input.payload);
  const metrics = normalizeMetricPayload(input.payload, manifest.metrics.map((metric) => metric.id));
  const safety = assertSafetyPolicy({
    benchmark: manifest,
    secretRefs: input.secretRefs,
    sandbox: input.sandbox,
    network: input.network,
    limits: input.limits
  });
  const run = createRunRecord(storage, {
    benchmarkId: input.benchmarkId,
    manifestVersion: manifest.manifestVersion,
    modelId: input.modelId,
    provider: input.provider,
    status: "running",
    labels: { runner: "fixture-json" }
  });
  const attempt = createAttemptRecord(storage, run.id, "running");
  for (const metric of metrics) {
    recordMetric(storage, {
      runId: run.id,
      attemptId: attempt.id,
      metricId: metric.metricId,
      value: metric.value,
      unit: metric.unit,
      direction: metric.direction
    });
  }
  recordProviderUsage(storage, {
    runId: run.id,
    attemptId: attempt.id,
    provider: input.provider,
    modelId: input.modelId,
    metadata: { mode: "fixture-json" }
  });
  await appendResultSegment(storage, {
    runId: run.id,
    attemptId: attempt.id,
    eventType: "fixture-result",
    payload: {
      input: redactedPayload.value,
      metrics
    }
  });
  const commandPlan = buildAdapterPlan({
    benchmarkId: manifest.id,
    modelId: input.modelId,
    provider: input.provider
  }).plan;
  const evidence = createEvidenceManifest({
    runId: run.id,
    attemptId: attempt.id,
    benchmarkId: manifest.id,
    manifestVersion: manifest.manifestVersion,
    modelId: input.modelId,
    provider: input.provider,
    metrics,
    payload: redactedPayload.value,
    manifest,
    commandPlan,
    packageVersion: VERSION,
    policy: {
      secretRefs: input.secretRefs ?? [],
      network: input.network === true,
      sandbox: input.sandbox === true,
      limits: input.limits ?? {}
    },
    safety,
    artifacts: [],
    cleanup: { required: false, status: "not-required" },
    redaction: {
      applied: true,
      findings: redactedPayload.findings.length > 0
        ? redactedPayload.findings
        : ["fixture payload inspected before evidence storage"]
    }
  });
  await appendResultSegment(storage, {
    runId: run.id,
    attemptId: attempt.id,
    eventType: "evidence-manifest",
    payload: evidence
  });

  const completedAt = new Date().toISOString();
  storage.db.query("UPDATE attempts SET status = 'completed', completed_at = ? WHERE id = ?").run(completedAt, attempt.id);
  storage.db.query("UPDATE runs SET status = 'completed', updated_at = ? WHERE id = ?").run(completedAt, run.id);

  return {
    ok: true,
    runId: run.id,
    attemptId: attempt.id,
    metrics
  };
}

export function normalizeMetricPayload(input: unknown, allowedMetricIds?: string[]): NormalizedMetric[] {
  const metrics = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as { metrics?: unknown }).metrics)
      ? (input as { metrics: unknown[] }).metrics
      : Object.entries(input && typeof input === "object" ? input as Record<string, unknown> : {}).map(([metricId, value]) => ({
        metricId,
        value
      }));

  const allowed = allowedMetricIds ? new Set(allowedMetricIds) : undefined;
  return metrics.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Metric entries must be objects");
    const record = entry as Record<string, unknown>;
    const metricId = typeof record.metricId === "string" ? record.metricId : record.id;
    if (typeof metricId !== "string" || !metricId) throw new Error("Metric entries require metricId or id");
    if (allowed && !allowed.has(metricId)) throw new Error(`Metric ${metricId} is not declared by this benchmark`);
    const value = Number(record.value);
    if (!Number.isFinite(value)) throw new Error(`Metric ${metricId} value must be numeric`);
    return {
      metricId,
      value,
      unit: typeof record.unit === "string" ? record.unit : undefined,
      direction: typeof record.direction === "string" ? record.direction : undefined
    };
  });
}
