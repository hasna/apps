import { createHash } from "node:crypto";

export const APPROVED_FLEET_ARTIFACT_NAMESPACES = ["smoke", "reports", "screenshots", "traces"] as const;
export const FLEET_ARTIFACT_SOURCE_SCOPES = ["run_artifact", "fleet_evidence"] as const;
export const FLEET_ARTIFACT_DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const FLEET_ARTIFACT_HARD_MAX_BYTES = 50 * 1024 * 1024;

export type FleetArtifactNamespace = typeof APPROVED_FLEET_ARTIFACT_NAMESPACES[number];
export type FleetArtifactSourceScope = typeof FLEET_ARTIFACT_SOURCE_SCOPES[number];
export type FleetArtifactPullMode = "hash_only" | "materialize";
export type FleetArtifactPullDecisionStatus = "allowed" | "requires_confirmation" | "blocked";

export interface FleetArtifactPullInput {
  machineId: string;
  action: "pull_artifact";
  artifactId: string;
  sourceScope?: FleetArtifactSourceScope | string;
  mode?: FleetArtifactPullMode | string;
  expectedSha256?: string;
  maxBytes?: number;
}

export interface FleetArtifactMaterializeApproval {
  approved: boolean;
  machineId: string;
  artifactId: string;
  sourceScope: FleetArtifactSourceScope;
  expectedSha256: string;
  maxBytes: number;
}

export interface FleetArtifactPullDecision {
  status: FleetArtifactPullDecisionStatus;
  allowed: boolean;
  reason?: string;
  metadata: Record<string, unknown>;
}

export interface FleetArtifactTokenClaims {
  artifactIdHash: string;
  namespace: FleetArtifactNamespace;
  sourceScope: FleetArtifactSourceScope;
  mode: FleetArtifactPullMode;
  maxBytes: number;
  expectedSha256?: string;
}

export interface FleetArtifactAdapterResult {
  machineId: string;
  artifactId: string;
  sourceScope: FleetArtifactSourceScope;
  sha256: string;
  bytes: number;
  mediaType?: string;
  localPath?: string;
  redaction?: { state: "hash_only" | "redacted"; redactor?: string };
}

export interface FleetArtifactPullExecutor {
  pullArtifact(input: RequiredFleetArtifactPullInput): Promise<FleetArtifactAdapterResult>;
}

export interface FleetArtifactPullExecutionResult {
  contractVersion: "open-computer.fleet.pull_artifact.result.v1";
  status: "hash_recorded" | "materialized";
  artifactIdHash: string;
  namespace: FleetArtifactNamespace;
  sourceScope: FleetArtifactSourceScope;
  sha256: string;
  bytes: number;
  mediaType: string;
  materialization: { mode: "hash_only" } | { mode: "materialize_redacted"; localPath: string };
  redaction: { state: "hash_only" | "redacted"; redactor?: string };
}

export type RequiredFleetArtifactPullInput = FleetArtifactPullInput & {
  sourceScope: FleetArtifactSourceScope;
  mode: FleetArtifactPullMode;
  maxBytes: number;
};

const SHA256_RE = /^[a-f0-9]{64}$/i;
const FLEET_ARTIFACT_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SENSITIVE_SEGMENTS = new Set([
  ".aws",
  ".config",
  ".env",
  ".git-credentials",
  ".gnupg",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".ssh",
  "authorized_keys",
  "credentials",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "known_hosts",
  "passwd",
  "shadow",
]);
const SENSITIVE_NAME_RE = /(^|[._-])(api[_-]?key|cookie|credential|password|private[_-]?key|secret|session|token)([._-]|$)/i;

export function fleetArtifactNamespace(artifactId: string): FleetArtifactNamespace | undefined {
  const namespace = artifactId.split("/", 1)[0];
  return (APPROVED_FLEET_ARTIFACT_NAMESPACES as readonly string[]).includes(namespace)
    ? namespace as FleetArtifactNamespace
    : undefined;
}

export function artifactIdHash(artifactId: string): string {
  return createHash("sha256").update(artifactId).digest("hex");
}

export function isCanonicalFleetArtifactId(artifactId: string): boolean {
  if (artifactId.includes("\\") || artifactId.includes("://") || artifactId.includes("@") || artifactId.includes(":")) {
    return false;
  }
  const namespace = fleetArtifactNamespace(artifactId);
  if (!namespace) return false;
  const segments = artifactId.split("/");
  if (segments.length < 2) return false;
  return segments.every((segment) => {
    if (!segment || segment === "." || segment === "..") return false;
    return FLEET_ARTIFACT_SEGMENT_RE.test(segment);
  });
}

export function isSensitiveFleetArtifactId(artifactId: string): boolean {
  const segments = artifactId.split("/").filter(Boolean);
  return segments.some((segment) => {
    const lower = segment.toLowerCase();
    return SENSITIVE_SEGMENTS.has(lower)
      || lower.startsWith(".")
      || SENSITIVE_NAME_RE.test(lower);
  });
}

export function isSha256(value: string | undefined): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}

export function evaluateFleetArtifactPullContract(
  input: FleetArtifactPullInput,
  options: { materializeApproval?: FleetArtifactMaterializeApproval } = {},
): FleetArtifactPullDecision {
  const namespace = fleetArtifactNamespace(input.artifactId);
  const sourceScope = input.sourceScope ?? "run_artifact";
  const mode = input.mode ?? "hash_only";
  const maxBytes = input.maxBytes ?? FLEET_ARTIFACT_DEFAULT_MAX_BYTES;
  const metadata = artifactAuditMetadata(input, options.materializeApproval);

  if (!namespace) {
    return blocked("Fleet artifact pulls must use an approved evidence namespace.", metadata);
  }
  if (!isCanonicalFleetArtifactId(input.artifactId)) {
    return blocked("Fleet artifact IDs must be normalized approved-namespace POSIX paths without empty, URL, user-host, or traversal segments.", metadata);
  }
  if (isSensitiveFleetArtifactId(input.artifactId)) {
    return blocked("Fleet artifact IDs cannot target private or credential-like filenames.", metadata);
  }
  if (!(FLEET_ARTIFACT_SOURCE_SCOPES as readonly string[]).includes(sourceScope)) {
    return blocked("Fleet artifact source scope must be run_artifact or fleet_evidence.", metadata);
  }
  if (mode !== "hash_only" && mode !== "materialize") {
    return blocked("Fleet artifact pull mode must be hash_only or materialize.", metadata);
  }
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > FLEET_ARTIFACT_HARD_MAX_BYTES) {
    return blocked(`Fleet artifact maxBytes must be between 1 and ${FLEET_ARTIFACT_HARD_MAX_BYTES}.`, metadata);
  }

  if (mode === "hash_only") {
    return { status: "allowed", allowed: true, metadata };
  }

  if (!isSha256(input.expectedSha256)) {
    return blocked("Materialized fleet artifact pulls require an expected sha256 digest.", metadata);
  }
  const expectedSha256 = input.expectedSha256;

  const approval = options.materializeApproval;
  if (!approval?.approved) {
    return {
      status: "requires_confirmation",
      allowed: false,
      reason: "Materialized fleet artifact pulls require a matching artifact approval.",
      metadata,
    };
  }

  const approvalMatches = approval.machineId === input.machineId
    && approval.artifactId === input.artifactId
    && approval.sourceScope === sourceScope
    && approval.expectedSha256.toLowerCase() === expectedSha256.toLowerCase()
    && approval.maxBytes >= maxBytes;
  if (!approvalMatches) {
    return blocked("Materialized fleet artifact approval does not match the requested artifact pull.", metadata);
  }

  return { status: "allowed", allowed: true, metadata: artifactAuditMetadata(input, approval) };
}

export function normalizeFleetArtifactPullInput(input: FleetArtifactPullInput): RequiredFleetArtifactPullInput {
  return {
    ...input,
    sourceScope: (input.sourceScope ?? "run_artifact") as FleetArtifactSourceScope,
    mode: (input.mode ?? "hash_only") as FleetArtifactPullMode,
    maxBytes: input.maxBytes ?? FLEET_ARTIFACT_DEFAULT_MAX_BYTES,
  };
}

export function fleetArtifactTokenClaims(input: FleetArtifactPullInput): FleetArtifactTokenClaims | undefined {
  const normalized = normalizeFleetArtifactPullInput(input);
  const namespace = fleetArtifactNamespace(normalized.artifactId);
  if (!namespace || !isCanonicalFleetArtifactId(normalized.artifactId)) return undefined;
  return {
    artifactIdHash: artifactIdHash(normalized.artifactId),
    namespace,
    sourceScope: normalized.sourceScope,
    mode: normalized.mode,
    maxBytes: normalized.maxBytes,
    expectedSha256: normalized.expectedSha256,
  };
}

export async function authorizeAndPullFleetArtifact(
  input: FleetArtifactPullInput,
  options: {
    executor: FleetArtifactPullExecutor;
    materializeApproval?: FleetArtifactMaterializeApproval;
  },
): Promise<FleetArtifactPullExecutionResult> {
  const decision = evaluateFleetArtifactPullContract(input, { materializeApproval: options.materializeApproval });
  if (!decision.allowed) {
    throw new Error(decision.reason ?? "Fleet artifact pull is not allowed.");
  }
  const request = normalizeFleetArtifactPullInput(input);
  const result = await options.executor.pullArtifact(request);
  return validateFleetArtifactPullResult(request, result);
}

export function validateFleetArtifactPullResult(
  request: RequiredFleetArtifactPullInput,
  result: FleetArtifactAdapterResult,
): FleetArtifactPullExecutionResult {
  const namespace = fleetArtifactNamespace(request.artifactId);
  if (!namespace) throw new Error("Fleet artifact result is missing an approved namespace.");
  if (result.machineId !== request.machineId) {
    throw new Error("Fleet artifact result machine binding does not match the request.");
  }
  if (result.artifactId !== request.artifactId) {
    throw new Error("Fleet artifact result artifact binding does not match the request.");
  }
  if (result.sourceScope !== request.sourceScope) {
    throw new Error("Fleet artifact result source scope does not match the request.");
  }
  if (!isSha256(result.sha256)) {
    throw new Error("Fleet artifact result must include a sha256 digest.");
  }
  if (!Number.isInteger(result.bytes) || result.bytes < 0 || result.bytes > request.maxBytes) {
    throw new Error("Fleet artifact result exceeds the approved maxBytes limit.");
  }
  if (request.expectedSha256 && result.sha256.toLowerCase() !== request.expectedSha256.toLowerCase()) {
    throw new Error("Fleet artifact result digest does not match expectedSha256.");
  }
  if (request.mode === "hash_only") {
    if (result.localPath) throw new Error("Hash-only fleet artifact pulls cannot materialize local paths.");
    return {
      contractVersion: "open-computer.fleet.pull_artifact.result.v1",
      status: "hash_recorded",
      artifactIdHash: artifactIdHash(request.artifactId),
      namespace,
      sourceScope: request.sourceScope,
      sha256: result.sha256.toLowerCase(),
      bytes: result.bytes,
      mediaType: result.mediaType ?? "application/octet-stream",
      materialization: { mode: "hash_only" },
      redaction: { state: "hash_only" },
    };
  }

  if (!result.localPath || result.localPath.includes("..") || result.localPath.includes("\0")) {
    throw new Error("Materialized fleet artifact result must use a managed local artifact path.");
  }
  if (result.redaction?.state !== "redacted") {
    throw new Error("Materialized fleet artifact result must declare redacted output.");
  }
  return {
    contractVersion: "open-computer.fleet.pull_artifact.result.v1",
    status: "materialized",
    artifactIdHash: artifactIdHash(request.artifactId),
    namespace,
    sourceScope: request.sourceScope,
    sha256: result.sha256.toLowerCase(),
    bytes: result.bytes,
    mediaType: result.mediaType ?? "application/octet-stream",
    materialization: { mode: "materialize_redacted", localPath: result.localPath },
    redaction: result.redaction,
  };
}

export function artifactAuditMetadata(
  input: FleetArtifactPullInput,
  materializeApproval?: FleetArtifactMaterializeApproval,
): Record<string, unknown> {
  const namespace = fleetArtifactNamespace(input.artifactId) ?? "unapproved";
  const mode = input.mode ?? "hash_only";
  return {
    artifact_namespace: namespace,
    source_scope: input.sourceScope ?? "run_artifact",
    pull_mode: mode,
    hash_only: mode === "hash_only",
    materializes_bytes: mode === "materialize",
    max_bytes: input.maxBytes ?? FLEET_ARTIFACT_DEFAULT_MAX_BYTES,
    expected_sha256_present: isSha256(input.expectedSha256),
    materialize_approval_present: Boolean(materializeApproval?.approved),
    materialize_approval_bound: Boolean(materializeApproval?.approved
      && materializeApproval.machineId === input.machineId
      && materializeApproval.artifactId === input.artifactId),
  };
}

function blocked(reason: string, metadata: Record<string, unknown>): FleetArtifactPullDecision {
  return {
    status: "blocked",
    allowed: false,
    reason,
    metadata,
  };
}
