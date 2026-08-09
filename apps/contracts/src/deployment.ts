import type {
  ActorPointer,
  CostEstimate,
  DecisionEnvelope,
  EvidencePointer,
  ProviderCapabilityCard,
  ResourcePointer,
  ValidationPlan,
  WorkRun,
} from "./schemas";
import {
  canonicalizeTodosValue,
  sha256TodosText,
  sha256TodosValue,
  stableTodosJson,
} from "./todos/common";
import { z } from "zod";

export const DEPLOYMENT_CONTRACT_VERSION = "1.0.0" as const;

export const DEPLOYMENT_SCHEMA_IDS = {
  productProjection: "hasna.product_projection.v1",
  intentSnapshot: "hasna.intent_snapshot.v1",
  verifiedSourceCandidate: "hasna.verified_source_candidate.v1",
  buildArtifact: "hasna.build_artifact.v1",
  artifactAttestation: "hasna.artifact_attestation.v1",
  environmentBinding: "hasna.environment_binding.v1",
  deploymentRequest: "hasna.deployment_request.v1",
  deploymentPlan: "hasna.deployment_plan.v1",
  deploymentApprovalDecision: "hasna.deployment_approval_decision.v1",
  deploymentAttempt: "hasna.deployment_attempt.v1",
  providerReceipt: "hasna.provider_receipt.v1",
  deploymentReceipt: "hasna.deployment_receipt.v1",
  launchEvidence: "hasna.launch_evidence.v1",
} as const;

export type DeploymentSchemaId =
  (typeof DEPLOYMENT_SCHEMA_IDS)[keyof typeof DEPLOYMENT_SCHEMA_IDS];

export const DEPLOYMENT_GENERATED_ARTIFACT_ROOT =
  "generated/deployment/v1" as const;

const DEPLOYMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const DEPLOYMENT_NAME = /^[a-z][a-z0-9._-]{0,127}$/;
const OPERATION_ID = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const ENVIRONMENT_KEY = /^[A-Z][A-Z0-9_]*$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

const FORBIDDEN_FIELD =
  /(?:^|_)(?:command|commands|script|scripts|shell|argv|environment_map|env_map|provider_request_body|raw_provider_state|terraform_state|callback_body|hook|hooks|secret_value|token_value|password|passphrase|private_key|database_url|credential_value)(?:$|_)/i;

const SECRET_VALUE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}\b/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bhasna_[a-z0-9_]+\.[A-Za-z0-9._-]{12,}\b/,
  /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s]+@/i,
  /^(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\//i,
  /\b(?:password|passphrase|api[_-]?key|access[_-]?key|token|secret)\s*[:=]\s*\S{8,}/i,
  /(?:^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:$|[^A-Za-z0-9_-])/,
] as const;

const EXECUTABLE_VALUE_PATTERNS = [
  /^#!\//,
  /^(?:ba|z|k|c|fi)?sh\s+-c\b/i,
  /^(?:sudo|curl|wget|terraform|tofu|kubectl|helm|docker|podman|aws|gcloud|az|npm|bun|node|python|ruby|perl|make)\s+/i,
  /(?:&&|\|\||\$\(|`[^`]+`|\$\{[^}]+\})/,
] as const;

function addDeploymentSafetyIssues(
  value: unknown,
  ctx: z.RefinementCtx,
  path: Array<string | number> = [],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      addDeploymentSafetyIssues(item, ctx, [...path, index]));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/[^A-Za-z0-9]+/g, "_")
        .toLowerCase();
      if (FORBIDDEN_FIELD.test(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Deployment contracts cannot contain executable, raw provider, state, or secret-bearing fields",
          path: [...path, key],
        });
      }
      addDeploymentSafetyIssues(child, ctx, [...path, key]);
    }
    return;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Deployment contract numbers must be finite",
      path,
    });
    return;
  }
  if (typeof value !== "string") return;
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Deployment contracts cannot contain secret or credential values",
      path,
    });
  }
  if (EXECUTABLE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Deployment contracts cannot contain commands, scripts, or templated executable strings",
      path,
    });
  }
}

function assertCanonicalDeploymentValue(
  value: unknown,
  path = "<root>",
): void {
  if (value === undefined) {
    throw new TypeError(`Deployment canonical JSON rejects undefined at ${path}`);
  }
  if (
    typeof value === "bigint"
    || typeof value === "function"
    || typeof value === "symbol"
  ) {
    throw new TypeError(`Deployment canonical JSON rejects ${typeof value} at ${path}`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`Deployment canonical JSON rejects non-finite numbers at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertCanonicalDeploymentValue(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assertCanonicalDeploymentValue(child, `${path}.${key}`);
    }
  }
}

export function canonicalizeDeploymentValue(value: unknown): unknown {
  assertCanonicalDeploymentValue(value);
  return canonicalizeTodosValue(value);
}

export function stableDeploymentJson(value: unknown): string {
  assertCanonicalDeploymentValue(value);
  return stableTodosJson(value);
}

export function sha256DeploymentValue(value: unknown): string {
  assertCanonicalDeploymentValue(value);
  return sha256TodosValue(value);
}

export function sha256DeploymentText(value: string): string {
  return sha256TodosText(value);
}

export function computeDeploymentRecordDigest(
  value: Record<string, unknown>,
): string {
  const { digest: _digest, ...unsigned } = value;
  return sha256DeploymentValue(unsigned);
}

export function withDeploymentRecordDigest<T extends Record<string, unknown>>(
  value: T,
): T & { digest: string } {
  const { digest: _digest, ...unsigned } = value;
  return {
    ...unsigned,
    digest: sha256DeploymentValue(unsigned),
  } as T & { digest: string };
}

export function computeEnvironmentBindingEtag(
  id: string,
  revision: number,
): string {
  return sha256DeploymentText(`${id}\u0000${revision}`);
}

function uniqueBy<T>(
  values: readonly T[],
  key: (value: T) => string,
  ctx: z.RefinementCtx,
  path: Array<string | number>,
  label: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const semanticId = key(value);
    if (seen.has(semanticId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must be unique`,
        path: [...path, index],
      });
    }
    seen.add(semanticId);
  });
}

function validateDeploymentRecord(
  value: { digest: string } & Record<string, unknown>,
  ctx: z.RefinementCtx,
): void {
  addDeploymentSafetyIssues(value, ctx);
  let computedDigest: string;
  try {
    computedDigest = computeDeploymentRecordDigest(value);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error
        ? error.message
        : "Deployment record cannot be canonicalized",
      path: [],
    });
    return;
  }
  if (value.digest !== computedDigest) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Deployment record digest does not match canonical content",
      path: ["digest"],
    });
  }
}

function validateChronology(
  first: string,
  second: string | null | undefined,
  ctx: z.RefinementCtx,
  path: Array<string | number>,
): void {
  if (second && Date.parse(second) < Date.parse(first)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Timestamp must not precede the record start",
      path,
    });
  }
}

function isSorted(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || values[index - 1]!.localeCompare(value) <= 0,
  );
}

export interface DeploymentPrimitiveSchemas {
  actorPointer: z.ZodType<ActorPointer, z.ZodTypeDef, any>;
  costEstimate: z.ZodType<CostEstimate, z.ZodTypeDef, any>;
  decisionEnvelope: z.ZodType<DecisionEnvelope, z.ZodTypeDef, any>;
  evidencePointer: z.ZodType<EvidencePointer, z.ZodTypeDef, any>;
  providerCapabilityCard: z.ZodType<ProviderCapabilityCard, z.ZodTypeDef, any>;
  resourcePointer: z.ZodType<ResourcePointer, z.ZodTypeDef, any>;
  validationPlan: z.ZodType<ValidationPlan, z.ZodTypeDef, any>;
  workRun: z.ZodType<WorkRun, z.ZodTypeDef, any>;
  schemaId: z.ZodType<string, z.ZodTypeDef, any>;
  timestamp: z.ZodType<string, z.ZodTypeDef, any>;
  uri: z.ZodType<string, z.ZodTypeDef, any>;
  sha256Digest: z.ZodType<string, z.ZodTypeDef, any>;
  relativeProjectPath: z.ZodType<string, z.ZodTypeDef, any>;
  providerSideEffectClass: z.ZodType<string, z.ZodTypeDef, any>;
}

export function createDeploymentSchemas(primitives: DeploymentPrimitiveSchemas) {
  const DeploymentIdSchema = z.string().regex(DEPLOYMENT_ID);
  const DeploymentNameSchema = z.string().regex(DEPLOYMENT_NAME);
  const DeploymentOperationIdSchema = z.string().regex(OPERATION_ID);
  const DeploymentTimestampSchema = primitives.timestamp;
  const DeploymentDigestSchema = primitives.sha256Digest;
  const DeploymentEvidenceArraySchema =
    z.array(primitives.evidencePointer).default([]);
  const DeploymentActorArraySchema =
    z.array(primitives.actorPointer).min(1);

  const recordBase = <TSchema extends DeploymentSchemaId>(schema: TSchema) => ({
    schema: z.literal(schema),
    id: DeploymentIdSchema,
    createdAt: DeploymentTimestampSchema,
    producer: primitives.actorPointer,
    digest: DeploymentDigestSchema,
  });

  const refSchema = <TSchema extends DeploymentSchemaId>(
    schema: TSchema,
  ) => z.object({
    schema: z.literal(schema),
    id: DeploymentIdSchema,
    digest: DeploymentDigestSchema,
  }).strict();

  const revisionedRefSchema = <TSchema extends DeploymentSchemaId>(
    schema: TSchema,
  ) => z.object({
    schema: z.literal(schema),
    id: DeploymentIdSchema,
    revision: z.number().int().positive(),
    digest: DeploymentDigestSchema,
  }).strict();

  const ProductProjectionRefSchema = revisionedRefSchema(
    DEPLOYMENT_SCHEMA_IDS.productProjection,
  );
  const IntentSnapshotRefSchema = refSchema(
    DEPLOYMENT_SCHEMA_IDS.intentSnapshot,
  );
  const VerifiedSourceCandidateRefSchema = refSchema(
    DEPLOYMENT_SCHEMA_IDS.verifiedSourceCandidate,
  );
  const BuildArtifactRefSchema = refSchema(
    DEPLOYMENT_SCHEMA_IDS.buildArtifact,
  );
  const ArtifactAttestationRefSchema = refSchema(
    DEPLOYMENT_SCHEMA_IDS.artifactAttestation,
  );
  const EnvironmentBindingRefSchema = revisionedRefSchema(
    DEPLOYMENT_SCHEMA_IDS.environmentBinding,
  );
  const DeploymentRequestRefSchema = refSchema(
    DEPLOYMENT_SCHEMA_IDS.deploymentRequest,
  );
  const DeploymentPlanRefSchema = refSchema(
    DEPLOYMENT_SCHEMA_IDS.deploymentPlan,
  );
  const DeploymentApprovalDecisionRefSchema = refSchema(
    DEPLOYMENT_SCHEMA_IDS.deploymentApprovalDecision,
  );
  const DeploymentAttemptRefSchema = revisionedRefSchema(
    DEPLOYMENT_SCHEMA_IDS.deploymentAttempt,
  );
  const ProviderReceiptRefSchema = refSchema(
    DEPLOYMENT_SCHEMA_IDS.providerReceipt,
  );
  const DeploymentReceiptRefSchema = refSchema(
    DEPLOYMENT_SCHEMA_IDS.deploymentReceipt,
  );

  const ProductProjectionSchema = z.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.productProjection),
    revision: z.number().int().positive(),
    sourceProjectRef: primitives.resourcePointer,
    sourceRevision: z.number().int().positive(),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    displayName: z.string().trim().min(1).max(200),
    repositoryRef: primitives.resourcePointer,
    workspaceRef: primitives.resourcePointer,
    lifecycle: z.enum(["draft", "active", "paused", "archived"]),
    ownerRefs: z.array(primitives.actorPointer).min(1),
    projectedAt: DeploymentTimestampSchema,
    sourceEvidenceRefs: z.array(primitives.evidencePointer).min(1),
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.ownerRefs, (actor) => `${actor.kind}:${actor.id}`, ctx, ["ownerRefs"], "Product owner identities");
  });

  const EndpointRequirementSchema = z.object({
    path: z.string().regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/),
    protocol: z.enum(["http", "https"]),
    expectedStatuses: z.array(z.number().int().min(100).max(599)).min(1),
  }).strict().superRefine((value, ctx) => {
    uniqueBy(value.expectedStatuses, String, ctx, ["expectedStatuses"], "Endpoint statuses");
  });

  const RuntimeProcessSchema = z.object({
    id: DeploymentNameSchema,
    role: z.enum(["web", "worker", "cron", "migration", "scheduler"]),
    ports: z.array(z.number().int().min(1).max(65535)).default([]),
    liveness: EndpointRequirementSchema.optional(),
    readiness: EndpointRequirementSchema.optional(),
    version: EndpointRequirementSchema.optional(),
    resources: z.object({
      cpuMillicores: z.number().int().positive(),
      memoryMiB: z.number().int().positive(),
      minReplicas: z.number().int().nonnegative(),
      maxReplicas: z.number().int().positive(),
    }).strict(),
  }).strict().superRefine((value, ctx) => {
    uniqueBy(value.ports, String, ctx, ["ports"], "Process ports");
    if (value.resources.maxReplicas < value.resources.minReplicas) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "maxReplicas must be greater than or equal to minReplicas",
        path: ["resources", "maxReplicas"],
      });
    }
  });

  const ServiceRequirementSchema = z.object({
    id: DeploymentNameSchema,
    kind: z.enum(["database", "object_storage", "queue", "cron", "worker"]),
    required: z.boolean(),
    class: DeploymentNameSchema,
  }).strict();

  const ConfigurationRequirementSchema = z.object({
    name: z.string().regex(ENVIRONMENT_KEY),
    kind: z.enum(["configuration", "secret_reference"]),
    required: z.boolean(),
    referenceClass: DeploymentNameSchema.optional(),
  }).strict().superRefine((value, ctx) => {
    if (value.kind === "secret_reference" && !value.referenceClass) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Secret-reference requirements require an opaque reference class",
        path: ["referenceClass"],
      });
    }
  });

  const IntentSnapshotSchema = z.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.intentSnapshot),
    product: ProductProjectionRefSchema,
    repositoryRef: primitives.resourcePointer,
    commitSha: z.string().regex(GIT_SHA),
    treeSha: z.string().regex(GIT_SHA),
    intentDocument: z.object({
      path: primitives.relativeProjectPath,
      digest: DeploymentDigestSchema,
    }).strict(),
    processes: z.array(RuntimeProcessSchema).min(1),
    serviceRequirements: z.array(ServiceRequirementSchema).default([]),
    migration: z.object({
      compatibility: z.enum(["none", "backward_compatible", "forward_compatible", "breaking"]),
      order: z.enum(["before_workload", "after_workload", "independent"]),
      rollbackClass: DeploymentNameSchema,
    }).strict(),
    accessClass: DeploymentNameSchema,
    networkClass: DeploymentNameSchema,
    backupClass: DeploymentNameSchema,
    restoreClass: DeploymentNameSchema,
    alarmClass: DeploymentNameSchema,
    rollbackClass: DeploymentNameSchema,
    configurationRequirements: z.array(ConfigurationRequirementSchema).default([]),
    validationPlan: primitives.validationPlan,
    evidenceRefs: z.array(primitives.evidencePointer).min(1),
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.processes, (process) => process.id, ctx, ["processes"], "Process ids");
    uniqueBy(value.serviceRequirements, (requirement) => requirement.id, ctx, ["serviceRequirements"], "Service requirement ids");
    uniqueBy(value.configurationRequirements, (requirement) => requirement.name, ctx, ["configurationRequirements"], "Configuration requirement names");
  });

  const VerificationResultSchema = z.object({
    id: DeploymentNameSchema,
    kind: z.enum(["review", "test", "policy", "source_integrity"]),
    status: z.enum(["passed", "failed", "not_run"]),
    evidenceRefs: z.array(primitives.evidencePointer).min(1),
  }).strict();

  const VerifiedSourceCandidateSchema = z.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.verifiedSourceCandidate),
    status: z.enum(["candidate", "verified", "rejected", "superseded"]),
    repositoryRef: primitives.resourcePointer,
    commitSha: z.string().regex(GIT_SHA),
    treeSha: z.string().regex(GIT_SHA),
    branchRef: primitives.resourcePointer.optional(),
    pullRequestRef: primitives.resourcePointer.optional(),
    intent: IntentSnapshotRefSchema,
    validationPlan: primitives.validationPlan,
    verificationRun: primitives.workRun,
    results: z.array(VerificationResultSchema).min(1),
    verifiers: DeploymentActorArraySchema,
    verifiedAt: DeploymentTimestampSchema,
    evidenceRefs: z.array(primitives.evidencePointer).min(1),
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.results, (result) => result.id, ctx, ["results"], "Verification result ids");
    uniqueBy(value.verifiers, (actor) => `${actor.kind}:${actor.id}`, ctx, ["verifiers"], "Verifier identities");
    if (
      value.status === "verified"
      && value.results.some((result) => result.status !== "passed")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Verified source candidates require every declared result to pass",
        path: ["results"],
      });
    }
  });

  const BuildArtifactSchema = z.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.buildArtifact),
    kind: z.enum(["oci_image", "archive", "binary"]),
    mediaType: z.string().trim().min(1).max(160),
    uri: primitives.uri,
    artifactDigest: DeploymentDigestSchema,
    sourceCandidate: VerifiedSourceCandidateRefSchema,
    repositoryCommitSha: z.string().regex(GIT_SHA),
    repositoryTreeSha: z.string().regex(GIT_SHA),
    buildWorkflowRef: primitives.resourcePointer,
    buildRun: primitives.workRun,
    builder: primitives.actorPointer,
    sbomRefs: DeploymentEvidenceArraySchema,
    provenanceRefs: DeploymentEvidenceArraySchema,
    scanRefs: DeploymentEvidenceArraySchema,
    signatureRefs: DeploymentEvidenceArraySchema,
    status: z.enum(["active", "superseded", "revoked"]),
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    if (value.buildRun.status !== "succeeded") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Build artifacts require a succeeded build run",
        path: ["buildRun", "status"],
      });
    }
  });

  const ArtifactAttestationSchema = z.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.artifactAttestation),
    artifact: BuildArtifactRefSchema,
    artifactDigest: DeploymentDigestSchema,
    predicateKind: DeploymentNameSchema,
    predicateSchemaVersion: z.string().regex(/^v?[0-9]+(?:\.[0-9]+){0,2}$/),
    issuer: primitives.actorPointer,
    keyRef: primitives.resourcePointer,
    signatureRef: primitives.evidencePointer,
    policyResult: z.enum(["passed", "failed"]),
    policyRevision: z.number().int().positive(),
    expiresAt: DeploymentTimestampSchema.nullable().optional(),
    evidenceRefs: z.array(primitives.evidencePointer).min(1),
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    validateChronology(value.createdAt, value.expiresAt, ctx, ["expiresAt"]);
  });

  const ProviderIdentitySchema = z.object({
    accountId: DeploymentIdSchema,
    region: DeploymentNameSchema,
    projectId: DeploymentIdSchema.optional(),
    clusterId: DeploymentIdSchema.optional(),
    networkId: DeploymentIdSchema.optional(),
    storageId: DeploymentIdSchema.optional(),
    routingId: DeploymentIdSchema.optional(),
  }).strict().superRefine((value, ctx) => {
    for (const [key, identity] of Object.entries(value)) {
      if (identity && UUID.test(identity)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Provider identity must use provider-issued stable identifiers, not mutable local UUIDs",
          path: [key],
        });
      }
    }
  });

  const EnvironmentBindingSchema = z.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.environmentBinding),
    updatedAt: DeploymentTimestampSchema,
    revision: z.number().int().positive(),
    etag: DeploymentDigestSchema,
    product: ProductProjectionRefSchema,
    intent: IntentSnapshotRefSchema,
    environment: z.object({
      id: DeploymentNameSchema,
      classification: z.enum(["development", "staging", "production", "disaster_recovery"]),
    }).strict(),
    dataBackend: z.enum(["sqlite", "postgresql"]),
    providerConnectionRef: primitives.resourcePointer,
    providerCapabilityCard: primitives.providerCapabilityCard,
    providerCapabilityDigest: DeploymentDigestSchema,
    providerIdentity: ProviderIdentitySchema,
    policyProfile: DeploymentNameSchema,
    authorizationProfile: DeploymentNameSchema,
    dataClassification: z.enum(["public", "internal", "private", "sensitive"]),
    backupProfile: DeploymentNameSchema,
    rollbackProfile: DeploymentNameSchema,
    commercialBindingRef: primitives.resourcePointer.optional(),
    writer: primitives.actorPointer,
    changeEvidenceRefs: z.array(primitives.evidencePointer).min(1),
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    if (
      value.providerCapabilityDigest
      !== sha256DeploymentValue(value.providerCapabilityCard)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provider capability digest does not match the pinned capability card",
        path: ["providerCapabilityDigest"],
      });
    }
    if (value.etag !== computeEnvironmentBindingEtag(value.id, value.revision)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Environment ETag does not match id and revision",
        path: ["etag"],
      });
    }
    validateChronology(value.createdAt, value.updatedAt, ctx, ["updatedAt"]);
  });

  const DeploymentRequestKindSchema = z.enum([
    "deployment",
    "promotion",
    "rollback",
    "reconciliation",
  ]);

  const DeploymentRequestSchema = z.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.deploymentRequest),
    kind: DeploymentRequestKindSchema,
    requester: primitives.actorPointer,
    product: ProductProjectionRefSchema,
    environment: EnvironmentBindingRefSchema,
    intent: IntentSnapshotRefSchema,
    artifact: BuildArtifactRefSchema.optional(),
    attestations: z.array(ArtifactAttestationRefSchema).default([]),
    priorReceipt: DeploymentReceiptRefSchema.optional(),
    policyProfile: DeploymentNameSchema,
    idempotencyKeyFingerprint: DeploymentDigestSchema,
    requestAt: DeploymentTimestampSchema,
    expiresAt: DeploymentTimestampSchema.nullable().optional(),
    sourceRequestId: DeploymentIdSchema,
    auditCorrelationId: DeploymentIdSchema,
    costEstimate: primitives.costEstimate.optional(),
    evidenceRefs: z.array(primitives.evidencePointer).min(1),
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.attestations, (ref) => `${ref.id}:${ref.digest}`, ctx, ["attestations"], "Attestation references");
    validateChronology(value.requestAt, value.expiresAt, ctx, ["expiresAt"]);
    if (value.kind === "deployment" && !value.artifact) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Deployment requests require an immutable build artifact",
        path: ["artifact"],
      });
    }
    if (
      (value.kind === "promotion" || value.kind === "rollback")
      && !value.priorReceipt
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Promotion and rollback requests require an immutable prior receipt",
        path: ["priorReceipt"],
      });
    }
  });

  const DeploymentInputRefSchema = z.object({
    schema: primitives.schemaId,
    id: DeploymentIdSchema,
    revision: z.number().int().positive().optional(),
    digest: DeploymentDigestSchema,
  }).strict();

  const DeploymentActionSchema = z.object({
    id: DeploymentNameSchema,
    operationId: DeploymentOperationIdSchema,
    operationVersion: z.number().int().positive(),
    dependsOn: z.array(DeploymentNameSchema).default([]),
    inputs: z.array(DeploymentInputRefSchema).default([]),
    outputSchema: primitives.schemaId,
    preconditions: z.array(DeploymentNameSchema).default([]),
    postconditions: z.array(DeploymentNameSchema).default([]),
    lockClass: DeploymentNameSchema,
    fencingRequired: z.boolean(),
    sideEffectClass: primitives.providerSideEffectClass,
    riskClass: z.enum(["low", "medium", "high", "critical"]),
    approvalScope: z.enum(["none", "plan", "action", "phase"]),
    runtimeMaterialKind: DeploymentNameSchema.nullable(),
    providerOperation: DeploymentOperationIdSchema.nullable(),
    providerCapabilityDigest: DeploymentDigestSchema.nullable(),
    retryClass: z.enum(["none", "safe", "reconcile_first"]),
    maxAttempts: z.number().int().positive().max(20),
    timeoutClass: DeploymentNameSchema,
    compensationOperationId: DeploymentOperationIdSchema.nullable(),
    idempotencyRequired: z.boolean(),
    reconciliationRequired: z.boolean(),
    evidenceRequirements: z.array(DeploymentNameSchema).min(1),
  }).strict().superRefine((value, ctx) => {
    uniqueBy(value.dependsOn, String, ctx, ["dependsOn"], "Action dependency ids");
    uniqueBy(value.inputs, (input) => `${input.schema}:${input.id}`, ctx, ["inputs"], "Action input identities");
    if (Boolean(value.providerOperation) !== Boolean(value.providerCapabilityDigest)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provider actions require both operation and capability digest",
        path: value.providerOperation
          ? ["providerCapabilityDigest"]
          : ["providerOperation"],
      });
    }
    if (value.sideEffectClass !== "none" && value.sideEffectClass !== "read_only") {
      if (!value.idempotencyRequired) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Side-effecting actions require idempotency",
          path: ["idempotencyRequired"],
        });
      }
      if (!value.reconciliationRequired) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Side-effecting actions require reconciliation",
          path: ["reconciliationRequired"],
        });
      }
      if (!value.compensationOperationId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Side-effecting actions require compensation or rollback",
          path: ["compensationOperationId"],
        });
      }
    }
    if (value.runtimeMaterialKind && value.approvalScope !== "phase") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Runtime execution material requires phase-scoped approval",
        path: ["approvalScope"],
      });
    }
  });

  const DeploymentPlanSchema = z.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.deploymentPlan),
    kind: DeploymentRequestKindSchema,
    request: DeploymentRequestRefSchema,
    compiler: z.object({
      actor: primitives.actorPointer,
      version: z.string().trim().min(1),
      contractKitVersion: z.literal(DEPLOYMENT_CONTRACT_VERSION),
    }).strict(),
    inputs: z.array(DeploymentInputRefSchema).min(1),
    providerCapabilityDigests: z.array(DeploymentDigestSchema).default([]),
    actions: z.array(DeploymentActionSchema).min(1),
    authorizationRequirements: z.array(DeploymentNameSchema).default([]),
    policyRequirements: z.array(DeploymentNameSchema).default([]),
    riskClass: z.enum(["low", "medium", "high", "critical"]),
    evidenceRequirements: z.array(DeploymentNameSchema).min(1),
    expectedStateDigest: DeploymentDigestSchema,
    verificationCriteria: z.array(DeploymentNameSchema).min(1),
    rollbackTarget: DeploymentReceiptRefSchema.optional(),
    rollbackInputs: z.array(DeploymentInputRefSchema).default([]),
    estimatedCost: primitives.costEstimate.optional(),
    issuedAt: DeploymentTimestampSchema,
    expiresAt: DeploymentTimestampSchema.nullable().optional(),
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    validateChronology(value.issuedAt, value.expiresAt, ctx, ["expiresAt"]);
    uniqueBy(value.inputs, (input) => `${input.schema}:${input.id}`, ctx, ["inputs"], "Plan input identities");
    uniqueBy(value.actions, (action) => action.id, ctx, ["actions"], "Action ids");
    uniqueBy(value.providerCapabilityDigests, String, ctx, ["providerCapabilityDigests"], "Provider capability digests");
    if (!isSorted(value.actions.map((action) => action.id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Plan actions must use deterministic lexicographic order",
        path: ["actions"],
      });
    }
    const actionIds = new Set(value.actions.map((action) => action.id));
    const visited = new Set<string>();
    value.actions.forEach((action, index) => {
      for (const dependency of action.dependsOn) {
        if (!actionIds.has(dependency)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Action dependency must resolve inside the same plan",
            path: ["actions", index, "dependsOn"],
          });
        } else if (!visited.has(dependency)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Action dependencies must precede dependants in deterministic order",
            path: ["actions", index, "dependsOn"],
          });
        }
      }
      visited.add(action.id);
    });
  });

  const RuntimeMaterialBindingSchema = z.object({
    kind: DeploymentNameSchema,
    digest: DeploymentDigestSchema,
    stateLineage: DeploymentIdSchema,
    preActionStateSerial: z.number().int().nonnegative(),
  }).strict();

  const DeploymentApprovalDecisionSchema = z.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.deploymentApprovalDecision),
    decision: primitives.decisionEnvelope,
    plan: DeploymentPlanRefSchema,
    scope: z.enum(["plan", "action", "phase"]),
    actionId: DeploymentNameSchema.nullable(),
    phaseId: DeploymentNameSchema.nullable(),
    runtimeMaterial: RuntimeMaterialBindingSchema.nullable(),
    boundInputDigests: z.array(z.object({
      kind: DeploymentNameSchema,
      digest: DeploymentDigestSchema,
    }).strict()).min(1),
    environment: EnvironmentBindingRefSchema,
    actorRole: z.enum(["requester", "planner", "approver", "executor", "auditor", "administrator"]),
    attemptScope: z.object({
      minimum: z.number().int().positive(),
      maximum: z.number().int().positive(),
    }).strict(),
    unchangedRetryPolicy: z.enum(["allowed", "denied"]),
    issuedAt: DeploymentTimestampSchema,
    expiresAt: DeploymentTimestampSchema,
    separationOfDutiesPassed: z.boolean(),
    authorizationPolicyRevision: z.number().int().positive(),
    evidenceRefs: z.array(primitives.evidencePointer).min(1),
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    validateChronology(value.issuedAt, value.expiresAt, ctx, ["expiresAt"]);
    uniqueBy(value.boundInputDigests, (binding) => binding.kind, ctx, ["boundInputDigests"], "Bound input kinds");
    if (value.decision.decisionType !== "approval") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Deployment approval decisions must compose an approval DecisionEnvelope",
        path: ["decision", "decisionType"],
      });
    }
    if (value.attemptScope.maximum < value.attemptScope.minimum) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attempt scope maximum must be greater than or equal to minimum",
        path: ["attemptScope", "maximum"],
      });
    }
    if (value.scope === "plan" && (value.actionId || value.phaseId || value.runtimeMaterial)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Plan-scoped decisions cannot bind action, phase, or runtime material",
        path: ["scope"],
      });
    }
    if (value.scope === "action" && (!value.actionId || value.phaseId || value.runtimeMaterial)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Action-scoped decisions require only an action id",
        path: ["actionId"],
      });
    }
    if (value.scope === "phase" && (!value.actionId || !value.phaseId || !value.runtimeMaterial)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Phase-scoped decisions require action, phase, and runtime material bindings",
        path: ["runtimeMaterial"],
      });
    }
    if (value.decision.status === "allowed" && !value.separationOfDutiesPassed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Allowed deployment decisions require separation-of-duties evaluation to pass",
        path: ["separationOfDutiesPassed"],
      });
    }
  });

  const AttemptApprovalRefSchema = z.object({
    decision: DeploymentApprovalDecisionRefSchema,
    scope: z.enum(["plan", "action", "phase"]),
    actionId: DeploymentNameSchema.nullable(),
    phaseId: DeploymentNameSchema.nullable(),
    runtimeMaterialDigest: DeploymentDigestSchema.nullable(),
  }).strict();

  const AttemptActionStepSchema = z.object({
    sequence: z.number().int().positive(),
    actionId: DeploymentNameSchema,
    state: z.enum(["pending", "running", "succeeded", "failed", "cancelled", "unknown_outcome"]),
    providerCorrelationId: DeploymentIdSchema.nullable(),
    startedAt: DeploymentTimestampSchema.nullable(),
    finishedAt: DeploymentTimestampSchema.nullable(),
    evidenceRefs: DeploymentEvidenceArraySchema,
  }).strict().superRefine((value, ctx) => {
    if (value.finishedAt && !value.startedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Finished action steps require a start timestamp",
        path: ["startedAt"],
      });
    }
    if (value.startedAt) {
      validateChronology(value.startedAt, value.finishedAt, ctx, ["finishedAt"]);
    }
  });

  const DeploymentAttemptSchema = z.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.deploymentAttempt),
    updatedAt: DeploymentTimestampSchema,
    revision: z.number().int().positive(),
    plan: DeploymentPlanRefSchema,
    approvals: z.array(AttemptApprovalRefSchema).min(1),
    requester: primitives.actorPointer,
    decisionActors: DeploymentActorArraySchema,
    executorActors: DeploymentActorArraySchema,
    environmentLock: z.object({
      id: DeploymentIdSchema,
      fencingToken: z.number().int().positive(),
    }).strict(),
    attemptNumber: z.number().int().positive(),
    retryOf: DeploymentAttemptRefSchema.nullable(),
    state: z.enum(["queued", "running", "reconciling", "unknown_outcome", "succeeded", "failed", "cancelled"]),
    actionSteps: z.array(AttemptActionStepSchema).min(1),
    outboxCorrelationRef: primitives.resourcePointer,
    inboxCorrelationRef: primitives.resourcePointer,
    failureReason: z.string().trim().min(1).nullable(),
    evidenceRefs: DeploymentEvidenceArraySchema,
    providerReceipts: z.array(ProviderReceiptRefSchema).default([]),
    finalReceipt: DeploymentReceiptRefSchema.nullable(),
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    validateChronology(value.createdAt, value.updatedAt, ctx, ["updatedAt"]);
    uniqueBy(value.approvals, (approval) => approval.decision.id, ctx, ["approvals"], "Approval decision ids");
    uniqueBy(value.decisionActors, (actor) => `${actor.kind}:${actor.id}`, ctx, ["decisionActors"], "Decision actor identities");
    uniqueBy(value.executorActors, (actor) => `${actor.kind}:${actor.id}`, ctx, ["executorActors"], "Executor actor identities");
    uniqueBy(value.actionSteps, (step) => step.actionId, ctx, ["actionSteps"], "Attempt action ids");
    uniqueBy(value.actionSteps, (step) => String(step.sequence), ctx, ["actionSteps"], "Attempt action sequences");
    if (!isSorted(value.actionSteps.map((step) => String(step.sequence).padStart(10, "0")))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attempt action steps must be in ascending sequence order",
        path: ["actionSteps"],
      });
    }
    if ((value.state === "failed" || value.state === "cancelled" || value.state === "unknown_outcome") && !value.failureReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Failed, cancelled, and unknown-outcome attempts require a reason",
        path: ["failureReason"],
      });
    }
    if (value.state !== "succeeded" && value.finalReceipt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only succeeded attempts may bind a final deployment receipt",
        path: ["finalReceipt"],
      });
    }
  });

  const ProviderReceiptSchema = z.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.providerReceipt),
    attempt: DeploymentAttemptRefSchema,
    provider: DeploymentNameSchema,
    adapter: DeploymentNameSchema,
    connectionRef: primitives.resourcePointer,
    capabilityDigest: DeploymentDigestSchema,
    operationId: DeploymentOperationIdSchema,
    operationVersion: z.number().int().positive(),
    providerIdentity: z.object({
      projectId: DeploymentIdSchema.nullable(),
      operationId: DeploymentIdSchema,
      deploymentId: DeploymentIdSchema.nullable(),
      resourceIds: z.array(DeploymentIdSchema).default([]),
      eventId: DeploymentIdSchema.nullable(),
    }).strict(),
    requestFingerprint: DeploymentDigestSchema,
    providerStatus: DeploymentNameSchema,
    normalizedResult: z.enum(["accepted", "succeeded", "failed", "cancelled", "unknown"]),
    observedProviderRevision: DeploymentIdSchema.nullable(),
    observedAt: DeploymentTimestampSchema,
    retryClass: z.enum(["none", "safe", "reconcile_first"]),
    reconciliationState: z.enum(["not_required", "pending", "confirmed", "diverged"]),
    unknownOutcome: z.boolean(),
    redaction: z.enum(["none", "partial", "full"]),
    responseEvidenceRefs: z.array(primitives.evidencePointer).min(1),
    observationEvidenceRefs: DeploymentEvidenceArraySchema,
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    const providerIds = [
      value.providerIdentity.projectId,
      value.providerIdentity.operationId,
      value.providerIdentity.deploymentId,
      value.providerIdentity.eventId,
      ...value.providerIdentity.resourceIds,
    ].filter((identity): identity is string => Boolean(identity));
    providerIds.forEach((identity, index) => {
      if (UUID.test(identity)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Provider receipts require provider-issued identities, not mutable local UUIDs",
          path: ["providerIdentity", index],
        });
      }
    });
    uniqueBy(value.providerIdentity.resourceIds, String, ctx, ["providerIdentity", "resourceIds"], "Provider resource ids");
    if (value.normalizedResult === "succeeded" && value.observationEvidenceRefs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provider success requires later observation evidence",
        path: ["observationEvidenceRefs"],
      });
    }
    if (value.unknownOutcome !== (value.normalizedResult === "unknown")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "unknownOutcome must agree with normalizedResult",
        path: ["unknownOutcome"],
      });
    }
  });

  const VerificationCheckSchema = z.object({
    id: DeploymentNameSchema,
    kind: z.enum(["health", "readiness", "version", "migration", "alarm", "access", "restore", "rollback", "security", "contract"]),
    status: z.enum(["passed", "failed", "missing", "expired", "blocked"]),
    evidenceRefs: z.array(primitives.evidencePointer).min(1),
  }).strict();

  const DeploymentReceiptSchema = z.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.deploymentReceipt),
    request: DeploymentRequestRefSchema,
    plan: DeploymentPlanRefSchema,
    approvals: z.array(DeploymentApprovalDecisionRefSchema).min(1),
    attempt: DeploymentAttemptRefSchema,
    product: ProductProjectionRefSchema,
    intent: IntentSnapshotRefSchema,
    artifact: BuildArtifactRefSchema,
    attestations: z.array(ArtifactAttestationRefSchema).min(1),
    environment: EnvironmentBindingRefSchema,
    providerReceipts: z.array(ProviderReceiptRefSchema).min(1),
    desiredStateDigest: DeploymentDigestSchema,
    observedStateDigest: DeploymentDigestSchema,
    verification: z.array(VerificationCheckSchema).min(1),
    infrastructurePlanRef: primitives.evidencePointer.optional(),
    infrastructureStateLineageRef: primitives.resourcePointer.optional(),
    rollbackTarget: DeploymentReceiptRefSchema.optional(),
    verifiers: DeploymentActorArraySchema,
    evidenceRefs: z.array(primitives.evidencePointer).min(1),
    outcome: z.enum(["succeeded", "failed", "cancelled", "unknown_outcome"]),
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.approvals, (approval) => approval.id, ctx, ["approvals"], "Receipt approval ids");
    uniqueBy(value.attestations, (attestation) => attestation.id, ctx, ["attestations"], "Receipt attestation ids");
    uniqueBy(value.providerReceipts, (receipt) => receipt.id, ctx, ["providerReceipts"], "Provider receipt ids");
    uniqueBy(value.verification, (check) => check.id, ctx, ["verification"], "Verification check ids");
    uniqueBy(value.verifiers, (actor) => `${actor.kind}:${actor.id}`, ctx, ["verifiers"], "Receipt verifier identities");
    if (
      value.outcome === "succeeded"
      && value.verification.some((check) => check.status !== "passed")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Succeeded deployment receipts require every verification check to pass",
        path: ["verification"],
      });
    }
  });

  const LaunchFindingSchema = z.object({
    id: DeploymentNameSchema,
    severity: z.enum(["p0", "p1", "p2", "p3"]),
    status: z.enum(["open", "resolved", "accepted"]),
    evidenceRefs: z.array(primitives.evidencePointer).min(1),
  }).strict();

  const LaunchEvidenceSchema = z.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.launchEvidence),
    product: ProductProjectionRefSchema,
    environment: EnvironmentBindingRefSchema,
    deploymentReceipt: DeploymentReceiptRefSchema,
    requiredChecks: z.array(VerificationCheckSchema).min(1),
    proofBundleRefs: z.array(primitives.resourcePointer).min(1),
    findings: z.array(LaunchFindingSchema).default([]),
    verifiers: DeploymentActorArraySchema,
    independentReview: z.boolean(),
    status: z.enum(["candidate", "blocked", "ready", "launched", "rolled_back"]),
    compiledAt: DeploymentTimestampSchema,
    expiresAt: DeploymentTimestampSchema,
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.requiredChecks, (check) => check.id, ctx, ["requiredChecks"], "Launch check ids");
    uniqueBy(value.findings, (finding) => finding.id, ctx, ["findings"], "Launch finding ids");
    uniqueBy(value.verifiers, (actor) => `${actor.kind}:${actor.id}`, ctx, ["verifiers"], "Launch verifier identities");
    validateChronology(value.compiledAt, value.expiresAt, ctx, ["expiresAt"]);
    if (
      (value.status === "ready" || value.status === "launched")
      && (
        value.requiredChecks.some((check) => check.status !== "passed")
        || value.findings.some((finding) =>
          (finding.severity === "p0" || finding.severity === "p1")
          && finding.status === "open")
        || !value.independentReview
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Ready and launched evidence requires passing checks, no open P0/P1 findings, and independent review",
        path: ["status"],
      });
    }
  });

  const DeploymentSchemaRegistry = Object.freeze({
    [DEPLOYMENT_SCHEMA_IDS.productProjection]: ProductProjectionSchema,
    [DEPLOYMENT_SCHEMA_IDS.intentSnapshot]: IntentSnapshotSchema,
    [DEPLOYMENT_SCHEMA_IDS.verifiedSourceCandidate]: VerifiedSourceCandidateSchema,
    [DEPLOYMENT_SCHEMA_IDS.buildArtifact]: BuildArtifactSchema,
    [DEPLOYMENT_SCHEMA_IDS.artifactAttestation]: ArtifactAttestationSchema,
    [DEPLOYMENT_SCHEMA_IDS.environmentBinding]: EnvironmentBindingSchema,
    [DEPLOYMENT_SCHEMA_IDS.deploymentRequest]: DeploymentRequestSchema,
    [DEPLOYMENT_SCHEMA_IDS.deploymentPlan]: DeploymentPlanSchema,
    [DEPLOYMENT_SCHEMA_IDS.deploymentApprovalDecision]: DeploymentApprovalDecisionSchema,
    [DEPLOYMENT_SCHEMA_IDS.deploymentAttempt]: DeploymentAttemptSchema,
    [DEPLOYMENT_SCHEMA_IDS.providerReceipt]: ProviderReceiptSchema,
    [DEPLOYMENT_SCHEMA_IDS.deploymentReceipt]: DeploymentReceiptSchema,
    [DEPLOYMENT_SCHEMA_IDS.launchEvidence]: LaunchEvidenceSchema,
  });

  return {
    ProductProjectionRefSchema,
    IntentSnapshotRefSchema,
    VerifiedSourceCandidateRefSchema,
    BuildArtifactRefSchema,
    ArtifactAttestationRefSchema,
    EnvironmentBindingRefSchema,
    DeploymentRequestRefSchema,
    DeploymentPlanRefSchema,
    DeploymentApprovalDecisionRefSchema,
    DeploymentAttemptRefSchema,
    ProviderReceiptRefSchema,
    DeploymentReceiptRefSchema,
    ProductProjectionSchema,
    IntentSnapshotSchema,
    VerifiedSourceCandidateSchema,
    BuildArtifactSchema,
    ArtifactAttestationSchema,
    EnvironmentBindingSchema,
    DeploymentRequestSchema,
    DeploymentActionSchema,
    DeploymentPlanSchema,
    DeploymentApprovalDecisionSchema,
    DeploymentAttemptSchema,
    ProviderReceiptSchema,
    DeploymentReceiptSchema,
    LaunchEvidenceSchema,
    DeploymentSchemaRegistry,
  } as const;
}

export interface DeploymentContractSet {
  productProjections: unknown[];
  intentSnapshots: unknown[];
  verifiedSourceCandidates: unknown[];
  buildArtifacts: unknown[];
  artifactAttestations: unknown[];
  environmentBindings: unknown[];
  deploymentRequests: unknown[];
  deploymentPlans: unknown[];
  deploymentApprovalDecisions: unknown[];
  deploymentAttempts: unknown[];
  providerReceipts: unknown[];
  deploymentReceipts: unknown[];
  launchEvidence: unknown[];
}

export interface DeploymentContractSetValidation {
  success: boolean;
  issues: string[];
}

export interface DeploymentContractSchemas {
  ProductProjectionSchema: z.ZodTypeAny;
  IntentSnapshotSchema: z.ZodTypeAny;
  VerifiedSourceCandidateSchema: z.ZodTypeAny;
  BuildArtifactSchema: z.ZodTypeAny;
  ArtifactAttestationSchema: z.ZodTypeAny;
  EnvironmentBindingSchema: z.ZodTypeAny;
  DeploymentRequestSchema: z.ZodTypeAny;
  DeploymentPlanSchema: z.ZodTypeAny;
  DeploymentApprovalDecisionSchema: z.ZodTypeAny;
  DeploymentAttemptSchema: z.ZodTypeAny;
  ProviderReceiptSchema: z.ZodTypeAny;
  DeploymentReceiptSchema: z.ZodTypeAny;
  LaunchEvidenceSchema: z.ZodTypeAny;
}

interface LinkedRecord {
  id: string;
  digest: string;
  revision?: number;
}

function linkedRecordMap(
  records: readonly LinkedRecord[],
  label: string,
  issues: string[],
): Map<string, LinkedRecord> {
  const result = new Map<string, LinkedRecord>();
  for (const record of records) {
    if (result.has(record.id)) {
      issues.push(`${label}: duplicate semantic id ${record.id}`);
      continue;
    }
    result.set(record.id, record);
  }
  return result;
}

function requireLinkedRecord(
  reference: { id: string; digest: string; revision?: number },
  records: Map<string, LinkedRecord>,
  path: string,
  issues: string[],
): void {
  const target = records.get(reference.id);
  if (!target) {
    issues.push(`${path}: missing linked record ${reference.id}`);
    return;
  }
  if (target.digest !== reference.digest) {
    issues.push(`${path}: digest mismatch`);
  }
  if (
    reference.revision !== undefined
    && target.revision !== reference.revision
  ) {
    issues.push(`${path}: revision mismatch`);
  }
}

export function validateDeploymentContractSet(
  schemas: DeploymentContractSchemas,
  input: DeploymentContractSet,
): DeploymentContractSetValidation {
  const issues: string[] = [];
  const parseMany = <T>(
    name: keyof DeploymentContractSet,
    schema: z.ZodType<T, z.ZodTypeDef, any>,
  ): T[] => input[name].flatMap((value, index) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push(`${String(name)}.${index}.${issue.path.join(".")}: ${issue.message}`);
      }
      return [];
    }
    return [parsed.data];
  });

  const products = parseMany(
    "productProjections",
    schemas.ProductProjectionSchema,
  );
  const intents = parseMany("intentSnapshots", schemas.IntentSnapshotSchema);
  const candidates = parseMany(
    "verifiedSourceCandidates",
    schemas.VerifiedSourceCandidateSchema,
  );
  const artifacts = parseMany("buildArtifacts", schemas.BuildArtifactSchema);
  const attestations = parseMany(
    "artifactAttestations",
    schemas.ArtifactAttestationSchema,
  );
  const environments = parseMany(
    "environmentBindings",
    schemas.EnvironmentBindingSchema,
  );
  const requests = parseMany(
    "deploymentRequests",
    schemas.DeploymentRequestSchema,
  );
  const plans = parseMany("deploymentPlans", schemas.DeploymentPlanSchema);
  const approvals = parseMany(
    "deploymentApprovalDecisions",
    schemas.DeploymentApprovalDecisionSchema,
  );
  const attempts = parseMany(
    "deploymentAttempts",
    schemas.DeploymentAttemptSchema,
  );
  const providerReceipts = parseMany(
    "providerReceipts",
    schemas.ProviderReceiptSchema,
  );
  const receipts = parseMany(
    "deploymentReceipts",
    schemas.DeploymentReceiptSchema,
  );
  const launches = parseMany("launchEvidence", schemas.LaunchEvidenceSchema);

  const productMap = linkedRecordMap(products, "productProjections", issues);
  const intentMap = linkedRecordMap(intents, "intentSnapshots", issues);
  const candidateMap = linkedRecordMap(
    candidates,
    "verifiedSourceCandidates",
    issues,
  );
  const artifactMap = linkedRecordMap(artifacts, "buildArtifacts", issues);
  const attestationMap = linkedRecordMap(
    attestations,
    "artifactAttestations",
    issues,
  );
  const environmentMap = linkedRecordMap(
    environments,
    "environmentBindings",
    issues,
  );
  const requestMap = linkedRecordMap(requests, "deploymentRequests", issues);
  const planMap = linkedRecordMap(plans, "deploymentPlans", issues);
  const approvalMap = linkedRecordMap(
    approvals,
    "deploymentApprovalDecisions",
    issues,
  );
  const attemptMap = linkedRecordMap(attempts, "deploymentAttempts", issues);
  const providerReceiptMap = linkedRecordMap(
    providerReceipts,
    "providerReceipts",
    issues,
  );
  const receiptMap = linkedRecordMap(receipts, "deploymentReceipts", issues);
  linkedRecordMap(launches, "launchEvidence", issues);

  intents.forEach((intent) =>
    requireLinkedRecord(intent.product, productMap, `intentSnapshots.${intent.id}.product`, issues));
  candidates.forEach((candidate) =>
    requireLinkedRecord(candidate.intent, intentMap, `verifiedSourceCandidates.${candidate.id}.intent`, issues));
  artifacts.forEach((artifact) =>
    requireLinkedRecord(artifact.sourceCandidate, candidateMap, `buildArtifacts.${artifact.id}.sourceCandidate`, issues));
  attestations.forEach((attestation) => {
    requireLinkedRecord(attestation.artifact, artifactMap, `artifactAttestations.${attestation.id}.artifact`, issues);
    const artifact = artifactMap.get(attestation.artifact.id) as
      | (LinkedRecord & { artifactDigest?: string })
      | undefined;
    if (artifact && "artifactDigest" in artifact && artifact.artifactDigest !== attestation.artifactDigest) {
      issues.push(`artifactAttestations.${attestation.id}.artifactDigest: digest mismatch`);
    }
  });
  environments.forEach((environment) => {
    requireLinkedRecord(environment.product, productMap, `environmentBindings.${environment.id}.product`, issues);
    requireLinkedRecord(environment.intent, intentMap, `environmentBindings.${environment.id}.intent`, issues);
  });
  requests.forEach((request) => {
    requireLinkedRecord(request.product, productMap, `deploymentRequests.${request.id}.product`, issues);
    requireLinkedRecord(request.environment, environmentMap, `deploymentRequests.${request.id}.environment`, issues);
    requireLinkedRecord(request.intent, intentMap, `deploymentRequests.${request.id}.intent`, issues);
    if (request.artifact) {
      requireLinkedRecord(request.artifact, artifactMap, `deploymentRequests.${request.id}.artifact`, issues);
    }
    request.attestations.forEach((attestation: LinkedRecord, index: number) =>
      requireLinkedRecord(attestation, attestationMap, `deploymentRequests.${request.id}.attestations.${index}`, issues));
    if (request.priorReceipt) {
      requireLinkedRecord(request.priorReceipt, receiptMap, `deploymentRequests.${request.id}.priorReceipt`, issues);
    }
  });
  plans.forEach((plan) =>
    requireLinkedRecord(plan.request, requestMap, `deploymentPlans.${plan.id}.request`, issues));
  approvals.forEach((approval) =>
    requireLinkedRecord(approval.plan, planMap, `deploymentApprovalDecisions.${approval.id}.plan`, issues));
  attempts.forEach((attempt) => {
    requireLinkedRecord(attempt.plan, planMap, `deploymentAttempts.${attempt.id}.plan`, issues);
    attempt.approvals.forEach((
      approval: { decision: LinkedRecord },
      index: number,
    ) =>
      requireLinkedRecord(approval.decision, approvalMap, `deploymentAttempts.${attempt.id}.approvals.${index}`, issues));
  });
  providerReceipts.forEach((receipt) =>
    requireLinkedRecord(receipt.attempt, attemptMap, `providerReceipts.${receipt.id}.attempt`, issues));
  receipts.forEach((receipt) => {
    requireLinkedRecord(receipt.request, requestMap, `deploymentReceipts.${receipt.id}.request`, issues);
    requireLinkedRecord(receipt.plan, planMap, `deploymentReceipts.${receipt.id}.plan`, issues);
    requireLinkedRecord(receipt.attempt, attemptMap, `deploymentReceipts.${receipt.id}.attempt`, issues);
    receipt.approvals.forEach((approval: LinkedRecord, index: number) =>
      requireLinkedRecord(approval, approvalMap, `deploymentReceipts.${receipt.id}.approvals.${index}`, issues));
    receipt.providerReceipts.forEach((
      providerReceipt: LinkedRecord,
      index: number,
    ) =>
      requireLinkedRecord(providerReceipt, providerReceiptMap, `deploymentReceipts.${receipt.id}.providerReceipts.${index}`, issues));
  });
  launches.forEach((launch) => {
    requireLinkedRecord(launch.product, productMap, `launchEvidence.${launch.id}.product`, issues);
    requireLinkedRecord(launch.environment, environmentMap, `launchEvidence.${launch.id}.environment`, issues);
    requireLinkedRecord(launch.deploymentReceipt, receiptMap, `launchEvidence.${launch.id}.deploymentReceipt`, issues);
  });

  return {
    success: issues.length === 0,
    issues,
  };
}
