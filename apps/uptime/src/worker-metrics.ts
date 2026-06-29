export const WORKER_RUNTIME_METRIC_NAMESPACE = "OpenUptime/Worker";
export const WORKER_RUNTIME_METRIC_DIMENSIONS = ["Service", "Stage", "Role"] as const;

export type WorkerRuntimeRole = "scheduler" | "public-probe" | "reporter";
export type WorkerRuntimeMetricUnit = "Count" | "Seconds" | "Milliseconds" | "None";
export type WorkerRuntimeMetricName =
  | "SchedulerBacklog"
  | "SchedulerStaleLeases"
  | "ProbeJobBacklog"
  | "ProbeSubmissionFailures"
  | "ReporterLagSeconds"
  | "ReportDeliveryFailures"
  | "ReportDeliveryRetryExhausted"
  | "WorkerHeartbeatAgeSeconds";

export interface WorkerRuntimeMetric {
  name: WorkerRuntimeMetricName;
  value: number;
  unit?: WorkerRuntimeMetricUnit;
}

export interface WorkerRuntimeMetricEnvelope {
  _aws: {
    Timestamp: number;
    CloudWatchMetrics: [{
      Namespace: string;
      Dimensions: [typeof WORKER_RUNTIME_METRIC_DIMENSIONS];
      Metrics: Array<{ Name: WorkerRuntimeMetricName; Unit?: WorkerRuntimeMetricUnit }>;
    }];
  };
  Service: string;
  Stage: string;
  Role: WorkerRuntimeRole;
  [metricName: string]: unknown;
}

export interface WorkerRuntimeMetricEnvelopeOptions {
  role: WorkerRuntimeRole;
  metrics: WorkerRuntimeMetric[];
  namespace?: string;
  service?: string;
  stage?: string;
  timestamp?: Date | number | string;
}

export interface WorkerRuntimeMetricEmitterOptions extends WorkerRuntimeMetricEnvelopeOptions {
  write?: (line: string) => void;
}

export interface WorkerRuntimeMetricEnvironmentOptions {
  namespace: string;
  service: string;
  stage: string;
}

export interface SchedulerWorkerMetricSummary {
  discovered: number;
  scheduled: number;
  skipped: number;
  failed: number;
  backlog?: number;
  staleLeases?: number;
  results?: unknown[];
}

export interface PublicProbeWorkerMetricSummary {
  discovered: number;
  claimed: number;
  submitted: number;
  skipped: number;
  failed: number;
  backlog?: number;
  submissionFailures?: number;
}

export interface ReporterWorkerMetricSummary {
  lagSeconds: number;
  failedDeliveries: number;
  retryExhaustedDeliveries: number;
  heartbeatAgeSeconds?: number;
}

export function workerRuntimeMetricOptionsFromEnv(env: Record<string, string | undefined> = process.env): WorkerRuntimeMetricEnvironmentOptions {
  const stage = normalizeDimension(env.HASNA_UPTIME_STAGE ?? env.STAGE ?? "prod", "stage");
  const service = normalizeDimension(
    env.HASNA_UPTIME_WORKER_METRIC_SERVICE
      ?? env.HASNA_UPTIME_SERVICE
      ?? `${env.HASNA_UPTIME_SERVICE_NAME ?? "open-uptime"}-${stage}`,
    "service",
  );
  return {
    namespace: normalizeNamespace(env.HASNA_UPTIME_WORKER_METRIC_NAMESPACE ?? WORKER_RUNTIME_METRIC_NAMESPACE),
    service,
    stage,
  };
}

export function buildWorkerRuntimeMetricEnvelope(options: WorkerRuntimeMetricEnvelopeOptions): WorkerRuntimeMetricEnvelope {
  const namespace = normalizeNamespace(options.namespace ?? WORKER_RUNTIME_METRIC_NAMESPACE);
  const service = normalizeDimension(options.service ?? "open-uptime-prod", "service");
  const stage = normalizeDimension(options.stage ?? "prod", "stage");
  const timestamp = normalizeTimestamp(options.timestamp);
  const metrics = normalizeMetrics(options.metrics);

  const envelope: WorkerRuntimeMetricEnvelope = {
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [{
        Namespace: namespace,
        Dimensions: [WORKER_RUNTIME_METRIC_DIMENSIONS],
        Metrics: metrics.map((metric) => ({
          Name: metric.name,
          ...(metric.unit ? { Unit: metric.unit } : {}),
        })),
      }],
    },
    Service: service,
    Stage: stage,
    Role: options.role,
  };

  for (const metric of metrics) {
    envelope[metric.name] = metric.value;
  }

  return envelope;
}

export function emitWorkerRuntimeMetricEnvelope(options: WorkerRuntimeMetricEmitterOptions): WorkerRuntimeMetricEnvelope {
  const envelope = buildWorkerRuntimeMetricEnvelope(options);
  const write = options.write ?? ((line: string) => console.error(line));
  write(JSON.stringify(envelope));
  return envelope;
}

export function schedulerWorkerRuntimeMetrics(summary: SchedulerWorkerMetricSummary): WorkerRuntimeMetric[] {
  const processed = Math.max(0, summary.results?.length ?? summary.scheduled + summary.skipped + summary.failed);
  const backlog = summary.backlog ?? Math.max(0, summary.discovered - processed);
  const staleLeases = summary.staleLeases ?? 0;
  return [
    { name: "SchedulerBacklog", value: backlog, unit: "Count" },
    { name: "SchedulerStaleLeases", value: staleLeases, unit: "Count" },
    { name: "WorkerHeartbeatAgeSeconds", value: 0, unit: "Seconds" },
  ];
}

export function publicProbeWorkerRuntimeMetrics(summary: PublicProbeWorkerMetricSummary): WorkerRuntimeMetric[] {
  return [
    { name: "ProbeJobBacklog", value: summary.backlog ?? Math.max(0, summary.discovered - summary.claimed), unit: "Count" },
    { name: "ProbeSubmissionFailures", value: summary.submissionFailures ?? 0, unit: "Count" },
    { name: "WorkerHeartbeatAgeSeconds", value: 0, unit: "Seconds" },
  ];
}

export function reporterWorkerRuntimeMetrics(summary: ReporterWorkerMetricSummary): WorkerRuntimeMetric[] {
  return [
    { name: "ReporterLagSeconds", value: summary.lagSeconds, unit: "Seconds" },
    { name: "ReportDeliveryFailures", value: summary.failedDeliveries, unit: "Count" },
    { name: "ReportDeliveryRetryExhausted", value: summary.retryExhaustedDeliveries, unit: "Count" },
    { name: "WorkerHeartbeatAgeSeconds", value: summary.heartbeatAgeSeconds ?? 0, unit: "Seconds" },
  ];
}

function normalizeMetrics(metrics: WorkerRuntimeMetric[]): WorkerRuntimeMetric[] {
  if (metrics.length === 0) throw new Error("worker runtime metrics require at least one metric");
  return metrics.map((metric) => ({
    name: normalizeMetricName(metric.name),
    value: normalizeMetricValue(metric.value, metric.name),
    ...(metric.unit ? { unit: normalizeMetricUnit(metric.unit) } : {}),
  }));
}

function normalizeMetricName(value: string): WorkerRuntimeMetricName {
  const allowed = new Set<WorkerRuntimeMetricName>([
    "SchedulerBacklog",
    "SchedulerStaleLeases",
    "ProbeJobBacklog",
    "ProbeSubmissionFailures",
    "ReporterLagSeconds",
    "ReportDeliveryFailures",
    "ReportDeliveryRetryExhausted",
    "WorkerHeartbeatAgeSeconds",
  ]);
  if (!allowed.has(value as WorkerRuntimeMetricName)) throw new Error(`unknown worker runtime metric: ${value}`);
  return value as WorkerRuntimeMetricName;
}

function normalizeMetricUnit(value: string): WorkerRuntimeMetricUnit {
  if (value === "Count" || value === "Seconds" || value === "Milliseconds" || value === "None") return value;
  throw new Error(`unknown worker runtime metric unit: ${value}`);
}

function normalizeMetricValue(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} metric value must be a non-negative finite number`);
  return value;
}

function normalizeNamespace(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 255 || /[\x00-\x1f\x7f-\x9f]/.test(normalized)) {
    throw new Error("worker metric namespace must be 1-255 visible characters");
  }
  return normalized;
}

function normalizeDimension(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 255 || /[\x00-\x1f\x7f-\x9f]/.test(normalized)) {
    throw new Error(`worker metric ${label} dimension must be 1-255 visible characters`);
  }
  return normalized;
}

function normalizeTimestamp(value: WorkerRuntimeMetricEnvelopeOptions["timestamp"]): number {
  if (value === undefined) return Date.now();
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error("worker metric timestamp must be a non-negative finite number");
    return value;
  }
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error("worker metric timestamp must be a valid date");
  return timestamp;
}
