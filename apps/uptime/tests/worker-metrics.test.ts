import { expect, test } from "bun:test";
import {
  buildWorkerRuntimeMetricEnvelope,
  publicProbeWorkerRuntimeMetrics,
  reporterWorkerRuntimeMetrics,
  schedulerWorkerRuntimeMetrics,
  workerRuntimeMetricOptionsFromEnv,
  WORKER_RUNTIME_METRIC_DIMENSIONS,
  WORKER_RUNTIME_METRIC_NAMESPACE,
} from "../src/worker-metrics.js";

test("worker runtime metric envelope matches Terraform alarm dimensions", () => {
  const envelope = buildWorkerRuntimeMetricEnvelope({
    role: "scheduler",
    service: "open-uptime-prod",
    stage: "prod",
    timestamp: "2026-06-30T00:00:00.000Z",
    metrics: [
      { name: "SchedulerBacklog", value: 2, unit: "Count" },
      { name: "SchedulerStaleLeases", value: 1, unit: "Count" },
      { name: "WorkerHeartbeatAgeSeconds", value: 0, unit: "Seconds" },
    ],
  });

  expect(envelope._aws.Timestamp).toBe(Date.parse("2026-06-30T00:00:00.000Z"));
  expect(envelope._aws.CloudWatchMetrics[0]).toEqual({
    Namespace: WORKER_RUNTIME_METRIC_NAMESPACE,
    Dimensions: [WORKER_RUNTIME_METRIC_DIMENSIONS],
    Metrics: [
      { Name: "SchedulerBacklog", Unit: "Count" },
      { Name: "SchedulerStaleLeases", Unit: "Count" },
      { Name: "WorkerHeartbeatAgeSeconds", Unit: "Seconds" },
    ],
  });
  expect(envelope).toMatchObject({
    Service: "open-uptime-prod",
    Stage: "prod",
    Role: "scheduler",
    SchedulerBacklog: 2,
    SchedulerStaleLeases: 1,
    WorkerHeartbeatAgeSeconds: 0,
  });
  expect(JSON.stringify(envelope)).not.toContain("Workspace");
  expect(JSON.stringify(envelope)).not.toContain("workspace");
});

test("worker runtime metric env options normalize service, stage, and namespace", () => {
  expect(workerRuntimeMetricOptionsFromEnv({
    HASNA_UPTIME_STAGE: "staging",
    HASNA_UPTIME_SERVICE_NAME: "open-uptime",
    HASNA_UPTIME_WORKER_METRIC_NAMESPACE: "OpenUptime/WorkerReview",
  })).toEqual({
    namespace: "OpenUptime/WorkerReview",
    service: "open-uptime-staging",
    stage: "staging",
  });
  expect(workerRuntimeMetricOptionsFromEnv({
    HASNA_UPTIME_WORKER_METRIC_SERVICE: "uptime-prod",
  })).toMatchObject({
    service: "uptime-prod",
    stage: "prod",
  });
});

test("scheduler metric summary produces backlog and heartbeat metrics", () => {
  expect(schedulerWorkerRuntimeMetrics({
    discovered: 3,
    scheduled: 1,
    skipped: 1,
    failed: 0,
    backlog: 1,
    staleLeases: 2,
    results: [{}, {}],
  })).toEqual([
    { name: "SchedulerBacklog", value: 1, unit: "Count" },
    { name: "SchedulerStaleLeases", value: 2, unit: "Count" },
    { name: "WorkerHeartbeatAgeSeconds", value: 0, unit: "Seconds" },
  ]);
});

test("public probe metric summary counts unprocessed jobs and submission failures", () => {
  expect(publicProbeWorkerRuntimeMetrics({
    discovered: 5,
    claimed: 4,
    submitted: 2,
    skipped: 1,
    failed: 2,
    backlog: 2,
    submissionFailures: 1,
  })).toEqual([
    { name: "ProbeJobBacklog", value: 2, unit: "Count" },
    { name: "ProbeSubmissionFailures", value: 1, unit: "Count" },
    { name: "WorkerHeartbeatAgeSeconds", value: 0, unit: "Seconds" },
  ]);
});

test("public probe metric fallback excludes already claimed jobs", () => {
  expect(publicProbeWorkerRuntimeMetrics({
    discovered: 1,
    claimed: 1,
    submitted: 0,
    skipped: 0,
    failed: 1,
    submissionFailures: 1,
  })).toEqual([
    { name: "ProbeJobBacklog", value: 0, unit: "Count" },
    { name: "ProbeSubmissionFailures", value: 1, unit: "Count" },
    { name: "WorkerHeartbeatAgeSeconds", value: 0, unit: "Seconds" },
  ]);
});

test("reporter metric summary uses exact Terraform reporter metric names", () => {
  expect(reporterWorkerRuntimeMetrics({
    lagSeconds: 901,
    failedDeliveries: 2,
    retryExhaustedDeliveries: 1,
  })).toEqual([
    { name: "ReporterLagSeconds", value: 901, unit: "Seconds" },
    { name: "ReportDeliveryFailures", value: 2, unit: "Count" },
    { name: "ReportDeliveryRetryExhausted", value: 1, unit: "Count" },
    { name: "WorkerHeartbeatAgeSeconds", value: 0, unit: "Seconds" },
  ]);
});

test("worker metric envelopes reject unknown metrics and negative values", () => {
  expect(() => buildWorkerRuntimeMetricEnvelope({
    role: "reporter",
    metrics: [{ name: "BadMetric" as never, value: 1 }],
  })).toThrow("unknown worker runtime metric");
  expect(() => buildWorkerRuntimeMetricEnvelope({
    role: "reporter",
    metrics: [{ name: "ReporterLagSeconds", value: -1 }],
  })).toThrow("non-negative finite number");
});
