import { sha256Hex, stableJson } from "./storage.js";
import type { BenchmarkManifest } from "./contracts.js";
import type { AdapterCommandPlan } from "./adapters.js";
import { containsRawSecret } from "./redaction.js";
export {
  assertNoRawSecrets,
  collectSecretFindings,
  containsRawSecret,
  redactEvidence,
  redactEvidenceWithFindings
} from "./redaction.js";

export interface SafetyLimits {
  maxCostUsd?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxRuntimeMs?: number;
}

export interface SafetyPolicyInput {
  benchmark: BenchmarkManifest;
  commandPlan?: AdapterCommandPlan;
  secretRefs?: string[];
  sandbox?: boolean;
  network?: boolean;
  limits?: SafetyLimits;
}

export interface SafetyGateResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface EvidenceManifestInput {
  runId: string;
  attemptId: string;
  benchmarkId: string;
  manifestVersion: string;
  modelId: string;
  provider: string;
  metrics: unknown;
  safety: SafetyGateResult;
  payload?: unknown;
  manifest?: BenchmarkManifest;
  commandPlan?: AdapterCommandPlan;
  packageVersion?: string;
  policy?: EvidencePolicy;
  artifacts?: ArtifactManifestEntry[];
  cleanup?: CleanupEvidence;
  redaction?: RedactionEvidence;
}

export interface EvidencePolicy {
  secretRefs: string[];
  network: boolean;
  sandbox: boolean;
  limits: SafetyLimits;
}

export interface ArtifactManifestEntry {
  kind: string;
  path: string;
  sha256?: string;
  bytes?: number;
  mediaType?: string;
}

export interface CleanupEvidence {
  required: boolean;
  status: "not-required" | "completed" | "failed";
  error?: string;
}

export interface RedactionEvidence {
  applied: boolean;
  findings: string[];
}

export interface EvidenceManifest {
  // Legacy local evidence envelope. Canonical contract output is emitted as
  // hasna.evidence_ref.v1 and hasna.proof_bundle.v1 via src/lib/contract-adapters.ts.
  schemaVersion: "bench.evidence.v1";
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
  policy?: EvidencePolicy;
  safety: SafetyGateResult;
  artifacts: ArtifactManifestEntry[];
  cleanup: CleanupEvidence;
  redaction: RedactionEvidence;
}

const envNamePattern = /^[A-Z][A-Z0-9_]{2,}$/;

export function evaluateSafetyPolicy(input: SafetyPolicyInput): SafetyGateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const benchmark = input.benchmark;

  if (!benchmark.license.name || benchmark.license.status === "unknown") {
    errors.push(`Benchmark ${benchmark.id} requires explicit license metadata before runnable use`);
  }

  if (benchmark.safety.requiresSecrets) {
    if (!input.secretRefs || input.secretRefs.length === 0) {
      errors.push(`Benchmark ${benchmark.id} requires secretRef names; raw credentials are not accepted`);
    }
  }

  for (const secretRef of input.secretRefs ?? []) {
    if (!envNamePattern.test(secretRef)) errors.push(`secretRef ${secretRef} must be an environment variable name`);
    if (containsRawSecret(secretRef)) errors.push(`secretRef ${secretRef} looks like a raw secret`);
  }

  if ((benchmark.runner.requiresSandbox || benchmark.safety.requiresSandbox) && !input.sandbox) {
    errors.push(`Benchmark ${benchmark.id} requires sandbox=true`);
  }

  if (benchmark.runner.requiresNetwork && !input.network) {
    errors.push(`Benchmark ${benchmark.id} requires network=true`);
  } else if (benchmark.safety.allowsNetwork && !input.network) {
    warnings.push(`Benchmark ${benchmark.id} may require network access; execution remains disabled unless network=true`);
  }

  if (benchmark.safety.costRisk === "high" && input.limits?.maxCostUsd === undefined) {
    errors.push(`Benchmark ${benchmark.id} has high cost risk and requires limits.maxCostUsd`);
  }

  if (input.limits?.maxCostUsd !== undefined && input.limits.maxCostUsd < 0) errors.push("limits.maxCostUsd must be non-negative");
  if (input.limits?.maxRuntimeMs !== undefined && input.limits.maxRuntimeMs <= 0) errors.push("limits.maxRuntimeMs must be positive");
  if (input.limits?.maxInputTokens !== undefined && input.limits.maxInputTokens < 0) errors.push("limits.maxInputTokens must be non-negative");
  if (input.limits?.maxOutputTokens !== undefined && input.limits.maxOutputTokens < 0) errors.push("limits.maxOutputTokens must be non-negative");

  return { ok: errors.length === 0, errors, warnings };
}

export function assertSafetyPolicy(input: SafetyPolicyInput): SafetyGateResult {
  const result = evaluateSafetyPolicy(input);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

export function createEvidenceManifest(input: EvidenceManifestInput): EvidenceManifest {
  return {
    schemaVersion: "bench.evidence.v1",
    runId: input.runId,
    attemptId: input.attemptId,
    benchmarkId: input.benchmarkId,
    manifestVersion: input.manifestVersion,
    modelId: input.modelId,
    provider: input.provider,
    metricHash: sha256Hex(stableJson(input.metrics)),
    payloadHash: input.payload === undefined ? undefined : sha256Hex(stableJson(input.payload)),
    manifestHash: input.manifest === undefined ? undefined : sha256Hex(stableJson(input.manifest)),
    sourceHash: input.manifest === undefined ? undefined : sha256Hex(stableJson(input.manifest.sources)),
    adapterCommandHash: input.commandPlan === undefined ? undefined : sha256Hex(stableJson(input.commandPlan)),
    packageVersion: input.packageVersion,
    policy: input.policy,
    safety: input.safety,
    artifacts: input.artifacts ?? [],
    cleanup: input.cleanup ?? { required: false, status: "not-required" },
    redaction: input.redaction ?? { applied: false, findings: [] }
  };
}
