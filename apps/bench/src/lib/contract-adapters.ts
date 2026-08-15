import { readFileSync } from "node:fs";
import {
  parseContract,
  SCHEMA_IDS,
  type CostEstimate,
  type EvidenceRef,
  type ProofBundle,
  type ValidationPlan,
  type WorkRun
} from "@hasna/contracts";
import type { BenchmarkManifest } from "../contracts.js";
import type { SafetyGateResult } from "../safety.js";
import type {
  RecordProviderUsageInput,
  ResultSegmentRecord,
  RunStatus,
  StoredAttempt,
  StoredRun
} from "../storage.js";

export const BENCH_CONTRACT_SOURCE_PACKAGE = "@hasna/bench";

const BENCH_ACTOR = {
  kind: "service" as const,
  id: "open-bench",
  provider: BENCH_CONTRACT_SOURCE_PACKAGE
};

const BENCH_VERIFIER = {
  kind: "service" as const,
  id: "open-bench-safety-gate",
  provider: BENCH_CONTRACT_SOURCE_PACKAGE
};

const BENCH_STORAGE_VERIFIER = {
  kind: "service" as const,
  id: "open-bench-storage",
  provider: BENCH_CONTRACT_SOURCE_PACKAGE
};

const TERMINAL_CONTRACT_STATUSES = new Set(["succeeded", "failed", "cancelled", "blocked", "skipped"]);

export interface ProviderUsageContractInput extends RecordProviderUsageInput {
  id?: string;
  createdAt?: string;
  costUsd: number;
}

export interface EvidenceSegmentContractInput {
  id: string;
  runId: string;
  attemptId?: string;
  eventType: string;
  segmentPath?: string;
  byteLength?: number;
  recordSha256?: string;
  createdAt: string;
}

export interface WorkRunContractInput {
  run: StoredRun;
  attempts?: StoredAttempt[];
  finishedAt?: string;
  evidenceRefs?: EvidenceRef[];
  costEstimates?: CostEstimate[];
  validationPlanRefs?: Array<{ kind: "verification"; id: string; externalId: string; sourcePackage: string }>;
  proofBundleRefs?: Array<{ kind: "proof_bundle"; id: string; externalId: string; sourcePackage: string }>;
}

export interface EvidenceManifestContractInput {
  runId: string;
  attemptId: string;
  benchmarkId: string;
  manifestVersion: string;
  modelId: string;
  provider: string;
  metricHash: string;
  payloadHash?: string;
  manifestHash?: string;
  sourceHash?: string;
  adapterCommandHash?: string;
  packageVersion?: string;
  safety: SafetyGateResult;
  cleanup?: { required: boolean; status: "not-required" | "completed" | "failed"; error?: string };
  redaction?: { applied: boolean; findings: string[] };
}

export interface BenchRunContractBundle {
  workRun: WorkRun;
  costEstimates: CostEstimate[];
  evidenceRefs: EvidenceRef[];
  proofBundle: ProofBundle;
  mappingNotes: string[];
}

export interface BenchPlanContractBundle {
  validationPlan: ValidationPlan;
  mappingNotes: string[];
}

export interface ResultDetailForContracts {
  runId: string;
  benchmarkId: string;
  manifestVersion: string;
  modelId: string;
  provider: string;
  route?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  attempts: Array<{
    id: string;
    attemptIndex: number;
    status: string;
    startedAt: string;
    completedAt?: string;
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

export interface DryRunPlanForContracts {
  benchmark: Pick<BenchmarkManifest, "id" | "name" | "category" | "manifestVersion" | "metrics" | "runner" | "safety" | "adapter">;
  modelId: string;
  provider: string;
  route?: string;
  command: string[];
  capabilities: string[];
  requiresNetwork: boolean;
  requiresSandbox: boolean;
  warnings: string[];
}

type ValidationCheckDraft = {
  id: string;
  kind: "command" | "test" | "typecheck" | "lint" | "eval" | "security" | "review" | "deploy" | "smoke" | "manual" | "other";
  required: boolean;
  command?: string;
  expected?: string;
  resourceRefs: Array<ReturnType<typeof benchmarkResource>>;
};

export function providerUsageToCostEstimate(input: ProviderUsageContractInput): CostEstimate {
  const promptCount = input.inputTokens;
  const completionCount = input.outputTokens;
  const combinedCount =
    promptCount === undefined && completionCount === undefined
      ? undefined
      : (promptCount ?? 0) + (completionCount ?? 0);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const draft = {
    schema: SCHEMA_IDS.costEstimate,
    id: input.id ?? `cost_${input.runId}${input.attemptId ? `_${input.attemptId}` : ""}`,
    createdAt,
    currency: "USD",
    amountMicros: Math.round(input.costUsd * 1_000_000),
    provider: input.provider,
    model: input.modelId,
    promptTokens: promptCount,
    completionTokens: completionCount,
    totalTokens: combinedCount,
    basis: "actual" as const,
    resourceRefs: [runResource(input.runId)]
  };

  return parseContract(SCHEMA_IDS.costEstimate, draft);
}

export function maybeProviderUsageToCostEstimate(input: Omit<ProviderUsageContractInput, "costUsd"> & { costUsd?: number }): CostEstimate | undefined {
  if (input.costUsd === undefined) return undefined;
  return providerUsageToCostEstimate({ ...input, costUsd: input.costUsd });
}

export function resultSegmentToEvidenceRef(input: EvidenceSegmentContractInput): EvidenceRef {
  const draft = {
    schema: SCHEMA_IDS.evidenceRef,
    id: `ev_${input.id}`,
    createdAt: input.createdAt,
    kind: "artifact" as const,
    uri: `artifact://bench/runs/${input.runId}/segments/${input.id}`,
    sha256: input.recordSha256,
    summary: `bench result segment: ${input.eventType}`,
    contentType: "application/jsonl",
    sizeBytes: input.byteLength,
    redaction: "partial" as const,
    resourceRefs: [
      runResource(input.runId),
      ...(input.attemptId ? [attemptResource(input.attemptId)] : [])
    ],
    tags: ["bench.result-segment", input.eventType]
  };

  return parseContract(SCHEMA_IDS.evidenceRef, draft);
}

export function artifactToEvidenceRef(input: {
  id: string;
  runId: string;
  attemptId?: string;
  kind: string;
  sha256?: string;
  bytes?: number;
  mediaType?: string;
  createdAt: string;
}): EvidenceRef {
  const draft = {
    schema: SCHEMA_IDS.evidenceRef,
    id: `ev_${input.id}`,
    createdAt: input.createdAt,
    kind: "artifact" as const,
    uri: `artifact://bench/runs/${input.runId}/artifacts/${input.id}`,
    sha256: input.sha256,
    summary: `bench artifact: ${input.kind}`,
    contentType: input.mediaType,
    sizeBytes: input.bytes,
    redaction: "unknown" as const,
    resourceRefs: [
      runResource(input.runId),
      ...(input.attemptId ? [attemptResource(input.attemptId)] : [])
    ],
    tags: ["bench.artifact", input.kind]
  };

  return parseContract(SCHEMA_IDS.evidenceRef, draft);
}

export function evidenceManifestToEvidenceRefs(input: EvidenceManifestContractInput): EvidenceRef[] {
  const createdAt = new Date().toISOString();
  const refs: EvidenceRef[] = [
    parseContract(SCHEMA_IDS.evidenceRef, {
      schema: SCHEMA_IDS.evidenceRef,
      id: `ev_${input.runId}_metrics`,
      createdAt,
      kind: "metric",
      uri: `artifact://bench/runs/${input.runId}/metrics.json`,
      sha256: input.metricHash,
      summary: `metric digest for ${input.benchmarkId}`,
      redaction: "none",
      resourceRefs: [runResource(input.runId), attemptResource(input.attemptId)],
      tags: ["bench.evidence.v1", "metric"]
    })
  ];

  const hashRefs = [
    ["payload", input.payloadHash],
    ["manifest", input.manifestHash],
    ["source", input.sourceHash],
    ["adapter-command", input.adapterCommandHash]
  ] as const;

  for (const [kind, hash] of hashRefs) {
    if (!hash) continue;
    refs.push(parseContract(SCHEMA_IDS.evidenceRef, {
      schema: SCHEMA_IDS.evidenceRef,
      id: `ev_${input.runId}_${kind}`,
      createdAt,
      kind: kind === "payload" ? "artifact" : "file",
      uri: `artifact://bench/runs/${input.runId}/${kind}.json`,
      sha256: hash,
      summary: `${kind} digest for ${input.benchmarkId}`,
      redaction: kind === "payload" ? "partial" : "none",
      resourceRefs: [runResource(input.runId), attemptResource(input.attemptId)],
      tags: ["bench.evidence.v1", kind]
    }));
  }

  return refs;
}

export function evidenceManifestToProofBundle(input: EvidenceManifestContractInput, evidenceRefs?: EvidenceRef[]): ProofBundle {
  const refs = evidenceRefs ?? evidenceManifestToEvidenceRefs(input);
  const safetyStatus = input.safety.ok ? "succeeded" : "failed";
  const cleanupFailed = input.cleanup?.status === "failed";
  const cleanupStatus = cleanupFailed ? "failed" : "succeeded";
  const verdict = input.safety.ok && !cleanupFailed ? "passed" : "failed";
  const status = verdict === "passed" ? "succeeded" : "failed";
  const draft = {
    schema: SCHEMA_IDS.proofBundle,
    id: `proof_${input.runId}`,
    createdAt: new Date().toISOString(),
    subject: runResource(input.runId),
    status,
    verdict,
    checks: [
      {
        checkId: "safety-gate",
        status: safetyStatus,
        summary: input.safety.ok
          ? "bench safety policy passed"
          : input.safety.errors.join("; "),
        evidenceRefs: refs.map(evidencePointer)
      },
      {
        checkId: "redaction",
        status: "succeeded",
        summary: input.redaction?.findings.length
          ? input.redaction.findings.join("; ")
          : "evidence redaction state recorded",
        evidenceRefs: refs.map(evidencePointer)
      },
      {
        checkId: "cleanup",
        status: cleanupStatus,
        summary: input.cleanup?.error ?? `cleanup ${input.cleanup?.status ?? "not-required"}`,
        evidenceRefs: refs.map(evidencePointer)
      }
    ],
    verifier: BENCH_VERIFIER,
    evidenceRefs: refs.map(evidencePointer),
    residualRisks: ["bench.evidence.v1 remains a legacy local evidence envelope pending namespace convergence"],
    freshness: "fresh" as const
  };

  return parseContract(SCHEMA_IDS.proofBundle, draft);
}

export function storedRunToWorkRun(input: WorkRunContractInput): WorkRun {
  const status = benchRunStatusToContractStatus(input.run.status);
  const terminal = TERMINAL_CONTRACT_STATUSES.has(status);
  const evidencePointers = (input.evidenceRefs ?? []).map(evidencePointer);
  const draft = {
    schema: SCHEMA_IDS.workRun,
    id: input.run.id,
    createdAt: input.run.createdAt,
    objective: `Benchmark ${input.run.benchmarkId} on ${input.run.provider}/${input.run.modelId}`,
    status,
    actor: BENCH_ACTOR,
    startedAt: input.run.createdAt,
    finishedAt: terminal ? input.finishedAt ?? input.run.createdAt : undefined,
    constraints: [
      "Open-bench records orchestration, normalized evidence, and local run metadata; external benchmark execution is outside this adapter."
    ],
    resourceRefs: [
      runResource(input.run.id),
      benchmarkResource(input.run.benchmarkId),
      modelResource(input.run.modelId),
      ...(input.run.route ? [routeResource(input.run.route)] : [])
    ],
    costEstimates: input.costEstimates ?? [],
    evidenceRefs: evidencePointers,
    validationPlanRefs: input.validationPlanRefs ?? [],
    proofBundleRefs: input.proofBundleRefs ?? []
  };

  return parseContract(SCHEMA_IDS.workRun, draft);
}

export function benchmarkManifestToValidationPlan(input: BenchmarkManifest, options: {
  command?: string[];
  modelId?: string;
  provider?: string;
  route?: string;
  warnings?: string[];
} = {}): ValidationPlan {
  // Lossy mapping: bench.manifest.v1 contains source/license/safety/runner metadata,
  // while hasna.validation_plan.v1 captures checks and evidence requirements.
  const expectedArtifacts = input.runner.expectedArtifacts.length > 0
    ? `expected artifacts: ${input.runner.expectedArtifacts.join(", ")}`
    : "no required artifacts declared";
  const checks: ValidationCheckDraft[] = [
    {
      id: "manifest-valid",
      kind: "manual" as const,
      expected: `bench.manifest.v1 parses for ${input.id}@${input.manifestVersion}`,
      required: true,
      resourceRefs: [benchmarkResource(input.id)]
    },
    {
      id: "source-provenance",
      kind: "manual" as const,
      expected: `sources: ${input.sources.map((source) => source.repository ?? source.url).join(", ")}`,
      required: true,
      resourceRefs: [benchmarkResource(input.id)]
    },
    {
      id: "license-policy",
      kind: "manual" as const,
      expected: `license ${input.license.spdxId ?? input.license.name}; status: ${input.license.status}; attribution required: ${input.license.requiresAttribution}`,
      required: true,
      resourceRefs: [benchmarkResource(input.id)]
    },
    {
      id: "adapter-metadata",
      kind: "manual" as const,
      expected: `adapter status: ${input.adapter.status}${input.adapter.packageName ? ` package: ${input.adapter.packageName}` : ""}${input.adapter.entrypoint ? ` entrypoint: ${input.adapter.entrypoint}` : ""}`,
      required: true,
      resourceRefs: [benchmarkResource(input.id)]
    },
    {
      id: "safety-policy",
      kind: "manual" as const,
      expected: [
        `network required: ${input.runner.requiresNetwork || input.safety.allowsNetwork}`,
        `sandbox required: ${input.runner.requiresSandbox || input.safety.requiresSandbox}`,
        `secret refs required: ${input.safety.requiresSecrets}`,
        `cost risk: ${input.safety.costRisk}`
      ].join("; "),
      required: true,
      resourceRefs: [benchmarkResource(input.id)]
    },
    {
      id: "metric-projection",
      kind: "manual" as const,
      expected: `declared metrics: ${input.metrics.map((metric) => metric.id).join(", ")}`,
      required: true,
      resourceRefs: [benchmarkResource(input.id)]
    },
    {
      id: "artifact-evidence",
      kind: "manual" as const,
      expected: expectedArtifacts,
      required: false,
      resourceRefs: [benchmarkResource(input.id)]
    }
  ];

  if (options.command && options.command.length > 0) {
    checks.push({
      id: "dry-run-command",
      kind: "command",
      command: options.command.join(" "),
      expected: "dry-run command plan only; open-bench does not execute external benchmark code in this slice",
      required: false,
      resourceRefs: [benchmarkResource(input.id)]
    });
  }

  if (options.warnings && options.warnings.length > 0) {
    checks.push({
      id: "plan-warnings",
      kind: "manual",
      expected: options.warnings.join("; "),
      required: false,
      resourceRefs: [benchmarkResource(input.id)]
    });
  }

  const draft = {
    schema: SCHEMA_IDS.validationPlan,
    id: `validation_${input.id.replace(/[^a-zA-Z0-9_]+/g, "_")}_${input.manifestVersion.replace(/[^a-zA-Z0-9_]+/g, "_")}`,
    createdAt: new Date().toISOString(),
    objective: `Validate benchmark plan for ${input.name}`,
    subject: benchmarkResource(input.id),
    checks,
    verifier: BENCH_VERIFIER,
    requiredEvidenceKinds: ["command_output", "metric", "artifact"]
  };

  return parseContract(SCHEMA_IDS.validationPlan, draft);
}

export function dryRunPlanToContractBundle(plan: DryRunPlanForContracts): BenchPlanContractBundle {
  return {
    validationPlan: benchmarkManifestToValidationPlan(plan.benchmark as BenchmarkManifest, {
      command: plan.command,
      modelId: plan.modelId,
      provider: plan.provider,
      route: plan.route,
      warnings: plan.warnings
    }),
    mappingNotes: [
      "bench.manifest.v1 source, license, adapter, and safety metadata are summarized into validation checks; the canonical validation_plan schema does not preserve the full benchmark manifest.",
      "The dry-run command is represented as a planned validation check only; open-bench does not execute external benchmark harnesses in this slice."
    ]
  };
}

export function resultDetailToContractBundle(detail: ResultDetailForContracts): BenchRunContractBundle {
  const segmentEvidenceRefs = [
    ...detail.segments.map((segment) => resultSegmentToEvidenceRef({ ...segment, runId: detail.runId })),
    ...detail.artifacts.map((artifact) => artifactToEvidenceRef({ ...artifact, runId: detail.runId }))
  ];
  const legacyEvidence = readEvidenceManifestFromSegments(detail);
  const manifestEvidenceRefs = legacyEvidence ? evidenceManifestToEvidenceRefs(legacyEvidence) : [];
  const evidenceRefs = [...segmentEvidenceRefs, ...manifestEvidenceRefs];
  const costEstimates = detail.providerUsage.flatMap((usage) => {
    const estimate = maybeProviderUsageToCostEstimate({
      runId: detail.runId,
      attemptId: usage.attemptId,
      provider: usage.provider,
      modelId: usage.modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      latencyMs: usage.latencyMs,
      metadata: usage.metadata,
      id: `cost_${usage.id}`,
      createdAt: usage.createdAt
    });
    return estimate ? [estimate] : [];
  });
  const run: StoredRun = {
    id: detail.runId,
    benchmarkId: detail.benchmarkId,
    manifestVersion: detail.manifestVersion,
    modelId: detail.modelId,
    provider: detail.provider,
    route: detail.route,
    status: normalizeRunStatus(detail.status),
    createdAt: detail.createdAt
  };
  const proofBundle = legacyEvidence
    ? evidenceManifestToProofBundle(legacyEvidence, evidenceRefs)
    : evidenceRefs.length > 0
      ? genericProofBundleForRun(detail, evidenceRefs)
    : genericProofBundleForRun(detail, [
      parseContract(SCHEMA_IDS.evidenceRef, {
        schema: SCHEMA_IDS.evidenceRef,
        id: `ev_${detail.runId}_storage`,
        createdAt: detail.updatedAt,
        kind: "report",
        uri: `artifact://bench/runs/${detail.runId}/storage-summary.json`,
        summary: "bench storage summary evidence",
        redaction: "unknown",
        resourceRefs: [runResource(detail.runId)],
        tags: ["bench.storage"]
      })
    ]);
  const allEvidenceRefs = evidenceRefs.length > 0 ? evidenceRefs : [parseContract(SCHEMA_IDS.evidenceRef, {
    schema: SCHEMA_IDS.evidenceRef,
    id: `ev_${detail.runId}_storage`,
    createdAt: detail.updatedAt,
    kind: "report",
    uri: `artifact://bench/runs/${detail.runId}/storage-summary.json`,
    summary: "bench storage summary evidence",
    redaction: "unknown",
    resourceRefs: [runResource(detail.runId)],
    tags: ["bench.storage"]
  })];

  return {
    workRun: storedRunToWorkRun({
      run,
      attempts: detail.attempts.map((attempt) => ({
        id: attempt.id,
        runId: detail.runId,
        attemptIndex: attempt.attemptIndex,
        status: normalizeAttemptStatus(attempt.status),
        startedAt: attempt.startedAt
      })),
      finishedAt: detail.updatedAt,
      evidenceRefs: allEvidenceRefs,
      costEstimates,
      proofBundleRefs: [proofBundleResource(proofBundle.id)]
    }),
    costEstimates,
    evidenceRefs: allEvidenceRefs,
    proofBundle,
    mappingNotes: [
      "Result detail rows are projected into work_run, cost_estimate, evidence_ref, and proof_bundle without changing the stored bench.* rows.",
      "Local result segment paths are exposed as artifact:// URIs so contract output does not leak machine-specific absolute paths."
    ]
  };
}

export function runRecordResultToContractBundle(input: {
  run: StoredRun;
  attempt: StoredAttempt;
  segment: ResultSegmentRecord;
  usage?: Omit<ProviderUsageContractInput, "costUsd"> & { costUsd?: number };
}): BenchRunContractBundle {
  const evidenceRefs = [resultSegmentToEvidenceRef(input.segment)];
  const maybeCostEstimate = input.usage
    ? maybeProviderUsageToCostEstimate({
      ...input.usage,
      id: `cost_${input.run.id}_${input.attempt.id}`,
      createdAt: input.segment.createdAt
    })
    : undefined;
  const costEstimates = maybeCostEstimate
    ? [maybeCostEstimate]
    : [];
  const proofBundle = genericProofBundleForRun({
    runId: input.run.id,
    status: input.run.status,
    updatedAt: input.segment.createdAt
  }, evidenceRefs);

  return {
    workRun: storedRunToWorkRun({
      run: input.run,
      attempts: [input.attempt],
      finishedAt: input.segment.createdAt,
      evidenceRefs,
      costEstimates,
      proofBundleRefs: [proofBundleResource(proofBundle.id)]
    }),
    costEstimates,
    evidenceRefs,
    proofBundle,
    mappingNotes: [
      "Manual run recording maps the persisted result segment to canonical evidence_ref and proof_bundle output.",
      "Provider usage is emitted as cost_estimate only when the caller supplied costUsd; token-only usage is preserved in legacy output but omitted from cost_estimate because the canonical schema requires an amount."
    ]
  };
}

function genericProofBundleForRun(detail: Pick<ResultDetailForContracts, "runId" | "status" | "updatedAt">, evidenceRefs: EvidenceRef[]): ProofBundle {
  const status = benchRunStatusToContractStatus(detail.status);
  const failed = status === "failed";
  const checkStatus = failed ? "failed" : status === "succeeded" ? "succeeded" : "unknown";
  const draft = {
    schema: SCHEMA_IDS.proofBundle,
    id: `proof_${detail.runId}`,
    createdAt: detail.updatedAt,
    subject: runResource(detail.runId),
    status: failed ? "failed" : "unknown",
    verdict: failed ? "failed" : "inconclusive",
    checks: [
      {
        checkId: "bench-storage-record",
        status: checkStatus,
        summary: `bench run status: ${detail.status}`,
        evidenceRefs: evidenceRefs.map(evidencePointer)
      }
    ],
    verifier: BENCH_STORAGE_VERIFIER,
    evidenceRefs: evidenceRefs.map(evidencePointer),
    residualRisks: ["proof bundle reflects local open-bench storage state, not independent external benchmark execution"],
    freshness: "fresh" as const
  };

  return parseContract(SCHEMA_IDS.proofBundle, draft);
}

function readEvidenceManifestFromSegments(detail: ResultDetailForContracts): EvidenceManifestContractInput | undefined {
  for (const segment of detail.segments) {
    if (segment.eventType !== "evidence-manifest") continue;
    const payload = readSegmentPayload(segment);
    if (isEvidenceManifest(payload)) return payload;
  }
  return undefined;
}

function readSegmentPayload(segment: ResultDetailForContracts["segments"][number]): unknown {
  try {
    const raw = readFileSync(segment.segmentPath, "utf8");
    const line = raw.slice(segment.byteOffset, segment.byteOffset + segment.byteLength).trimEnd();
    const event = JSON.parse(line) as { payload?: unknown };
    return event.payload;
  } catch {
    return undefined;
  }
}

function isEvidenceManifest(value: unknown): value is EvidenceManifestContractInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === "bench.evidence.v1" &&
    typeof record.runId === "string" &&
    typeof record.attemptId === "string" &&
    typeof record.benchmarkId === "string" &&
    typeof record.manifestVersion === "string" &&
    typeof record.modelId === "string" &&
    typeof record.provider === "string" &&
    typeof record.metricHash === "string" &&
    Boolean(record.safety) &&
    typeof record.safety === "object" &&
    !Array.isArray(record.safety);
}

function benchRunStatusToContractStatus(status: string): "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown" {
  if (status === "created") return "pending";
  if (status === "running") return "running";
  if (status === "completed") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "succeeded") return "succeeded";
  return "unknown";
}

function normalizeRunStatus(status: string): RunStatus {
  if (status === "created" || status === "running" || status === "completed" || status === "failed" || status === "cancelled") {
    return status;
  }
  if (status === "succeeded") return "completed";
  return "failed";
}

function normalizeAttemptStatus(status: string): StoredAttempt["status"] {
  if (status === "created" || status === "running" || status === "completed" || status === "failed") return status;
  if (status === "succeeded") return "completed";
  return "failed";
}

function runResource(runId: string) {
  return {
    kind: "run" as const,
    id: runId,
    externalId: runId,
    sourcePackage: BENCH_CONTRACT_SOURCE_PACKAGE
  };
}

function attemptResource(attemptId: string) {
  return {
    kind: "event" as const,
    id: attemptId,
    externalId: attemptId,
    sourcePackage: BENCH_CONTRACT_SOURCE_PACKAGE
  };
}

function benchmarkResource(benchmarkId: string) {
  return {
    kind: "eval" as const,
    id: benchmarkId,
    externalId: benchmarkId,
    sourcePackage: BENCH_CONTRACT_SOURCE_PACKAGE
  };
}

function modelResource(modelId: string) {
  return {
    kind: "model" as const,
    id: modelId,
    externalId: modelId,
    sourcePackage: BENCH_CONTRACT_SOURCE_PACKAGE
  };
}

function routeResource(route: string) {
  return {
    kind: "integration" as const,
    id: `route_${route.replace(/[^a-zA-Z0-9_]+/g, "_")}`,
    externalId: route,
    sourcePackage: BENCH_CONTRACT_SOURCE_PACKAGE
  };
}

function proofBundleResource(id: string) {
  return {
    kind: "proof_bundle" as const,
    id,
    externalId: id,
    sourcePackage: BENCH_CONTRACT_SOURCE_PACKAGE
  };
}

function evidencePointer(ref: EvidenceRef) {
  return {
    id: ref.id,
    kind: ref.kind,
    uri: ref.uri,
    sha256: ref.sha256,
    summary: ref.summary
  };
}
