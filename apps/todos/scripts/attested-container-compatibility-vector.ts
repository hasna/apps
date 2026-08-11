import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ArtifactAttestationSchema,
  BuildArtifactSchema,
  DeploymentApprovalDecisionSchema,
  DeploymentAttemptSchema,
  DeploymentPlanSchema,
  DeploymentReceiptSchema,
  DeploymentRequestSchema,
  EnvironmentBindingSchema,
  IntentSnapshotSchema,
  LaunchEvidenceSchema,
  ProductProjectionSchema,
  ProviderReceiptSchema,
  VerifiedSourceCandidateSchema,
  validateDeploymentContractSet,
  withDeploymentRecordDigest,
  type DeploymentContractSet,
} from "hasna-deployment-contracts/deployment";
import { z } from "zod";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const GitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const PROJECT_ID = "wks_wdq8kp9rd8bq";
const PROJECT_SLUG = "hasna-todos";
const PROJECT_NAME = "@hasna/todos";
const REPOSITORY = "hasna/todos";
const CONSUMER_COMMIT_SHA = "905d57bb845cf2f172b319cdd722656675c13630";
const FIXTURE_INPUT_PATH = "fixture-input.json";
const CHECKSUMS_PATH = "subject-checksums.txt";
const CREATED_AT = "2026-08-11T00:00:00.000Z";
const FINISHED_AT = "2026-08-11T00:05:00.000Z";
const EXPIRES_AT = "2026-08-18T00:00:00.000Z";
const FIXTURE_TAGS = [
  "comparison-only",
  "synthetic-fixture",
  "not-adoption-evidence",
];
const FIXTURE_ACTOR = {
  kind: "system" as const,
  id: "todos-iapp-deployment-compatibility-fixture",
  name: "Synthetic deployment contract compatibility fixture",
  provider: "test-fixture",
};
const DeploymentContractSchemas = {
  ProductProjectionSchema,
  IntentSnapshotSchema,
  VerifiedSourceCandidateSchema,
  BuildArtifactSchema,
  ArtifactAttestationSchema,
  EnvironmentBindingSchema,
  DeploymentRequestSchema,
  DeploymentPlanSchema,
  DeploymentApprovalDecisionSchema,
  DeploymentAttemptSchema,
  ProviderReceiptSchema,
  DeploymentReceiptSchema,
  LaunchEvidenceSchema,
};

const SourceRecordDescriptorSchema = z
  .object({
    collection: z.enum([
      "productProjections",
      "intentSnapshots",
      "verifiedSourceCandidates",
      "buildArtifacts",
      "artifactAttestations",
    ]),
    path: z.enum([
      "product-projection.json",
      "intent-snapshot.json",
      "verified-source-candidate.json",
      "build-artifact.json",
      "artifact-attestation.json",
    ]),
    bytes: z.number().int().positive(),
    sha256: Sha256Schema,
    recordDigest: Sha256Schema,
  })
  .strict();

const CompatibilityVectorInputSchema = z
  .object({
    schema: z.literal("hasna.todos.iapp_deployment_compatibility_fixture_input.v1"),
    producerRepository: z.literal(REPOSITORY),
    producerCommitSha: GitShaSchema,
    producerTreeSha: GitShaSchema,
    consumerRepository: z.literal("hasnaxyz/iapp-deployment"),
    consumerCommitSha: z.literal(CONSUMER_COMMIT_SHA),
    candidateKind: z.literal("comparison_only"),
    evidenceClass: z.literal("comparison_only_synthetic_fixture"),
    permittedUse: z.literal("contract_compatibility"),
    prohibitedUses: z.tuple([
      z.literal("adoption_evidence"),
      z.literal("deployment_evidence"),
      z.literal("release_evidence"),
    ]),
    project: z
      .object({
        id: z.literal(PROJECT_ID),
        slug: z.literal(PROJECT_SLUG),
        displayName: z.literal(PROJECT_NAME),
        repository: z.literal(REPOSITORY),
      })
      .strict(),
  })
  .strict();

const CompatibilityVectorManifestSchema = z
  .object({
    schema: z.literal("hasna.todos.iapp_deployment_compatibility_vector.v1"),
    artifactName: z.string().regex(/^iapp-deployment-compatibility-[a-f0-9]{40}$/),
    producerRepository: z.literal(REPOSITORY),
    producerCommitSha: GitShaSchema,
    producerTreeSha: GitShaSchema,
    consumerRepository: z.literal("hasnaxyz/iapp-deployment"),
    consumerCommitSha: z.literal(CONSUMER_COMMIT_SHA),
    candidateManifestSchema: z.literal("hasna.todos.attested_container_candidate.v2"),
    candidateKind: z.literal("comparison_only"),
    evidenceClass: z.literal("comparison_only_synthetic_fixture"),
    sourceCandidateStatus: z.literal("candidate"),
    producerProvider: z.literal("test-fixture"),
    operationalEvidenceStatus: z.literal("not_run"),
    buildArtifactStatus: z.literal("revoked"),
    artifactAttestationPredicateKind: z.literal("fixture-classification"),
    providerMutation: z.literal(false),
    launchEvidenceCount: z.literal(0),
    permittedUse: z.literal("contract_compatibility"),
    prohibitedUses: z.tuple([
      z.literal("adoption_evidence"),
      z.literal("deployment_evidence"),
      z.literal("release_evidence"),
    ]),
    operationalAcceptanceSource: z.literal(
      ".github/workflows/attested-container-candidate.yml",
    ),
    project: z
      .object({
        id: z.literal(PROJECT_ID),
        slug: z.literal(PROJECT_SLUG),
        displayName: z.literal(PROJECT_NAME),
        repository: z.literal(REPOSITORY),
      })
      .strict(),
    fixtureInput: z
      .object({
        path: z.literal(FIXTURE_INPUT_PATH),
        bytes: z.number().int().positive(),
        sha256: Sha256Schema,
      })
      .strict(),
    checksumBundle: z
      .object({
        path: z.literal(CHECKSUMS_PATH),
        algorithm: z.literal("sha256"),
        format: z.literal("sha256sum"),
        scope: z.literal("source_records_only"),
      })
      .strict(),
    recordCount: z.literal(5),
    sourceRecords: z.array(SourceRecordDescriptorSchema).length(5),
  })
  .strict();

type CompatibilityVectorManifest = z.infer<
  typeof CompatibilityVectorManifestSchema
>;

const digest = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid flag sequence near ${name ?? "<end>"}`);
    }
    flags.set(name.slice(2), value);
  }
  return flags;
}

function requiredFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (!value) throw new Error(`Missing required flag --${name}`);
  return value;
}

function fixtureEvidence(
  id: string,
  path: string,
  sha256: string,
  summary: string,
) {
  return {
    kind: "test_result" as const,
    id,
    uri: `artifact://iapp-deployment-compatibility-vector/${path}`,
    sha256,
    summary,
  };
}

function recordRef(
  record: { schema: string; id: string; digest: string; revision?: number },
  includeRevision = false,
) {
  return {
    schema: record.schema,
    id: record.id,
    ...(includeRevision ? { revision: record.revision } : {}),
    digest: record.digest,
  };
}

function createVectorRecords(
  producerCommitSha: string,
  producerTreeSha: string,
  fixtureInputSha256: string,
) {
  const commitSha = GitShaSchema.parse(producerCommitSha);
  const treeSha = GitShaSchema.parse(producerTreeSha);
  const fixtureSha256 = Sha256Schema.parse(fixtureInputSha256);
  const manifestEvidence = fixtureEvidence(
    "comparison-only-fixture-input",
    FIXTURE_INPUT_PATH,
    fixtureSha256,
    "Immutable synthetic fixture input; prohibited as adoption, deployment, or release evidence",
  );
  const validationEvidence = fixtureEvidence(
    "comparison-only-fixture-classification",
    FIXTURE_INPUT_PATH,
    fixtureSha256,
    "Immutable comparison-only classification input; no operational candidate gates were run",
  );
  const repositoryRef = {
    kind: "repo" as const,
    id: "repo-hasna-todos",
    uri: `repo://${REPOSITORY}`,
    tags: FIXTURE_TAGS,
  };
  const validationPlan = {
    schema: "hasna.validation_plan.v1" as const,
    id: `validate-synthetic-todos-fixture-${commitSha}`,
    createdAt: CREATED_AT,
    objective: "Validate a synthetic cross-repository contract compatibility fixture",
    checks: [
      {
        id: "canonical-project-identity",
        kind: "test" as const,
        required: true,
        expected: "Fixture carries the canonical Projects identity and repository locator",
        resourceRefs: [],
      },
      {
        id: "contract-shape-only",
        kind: "test" as const,
        required: true,
        expected: "Fixture parses and links without being accepted as operational evidence",
        resourceRefs: [],
      },
    ],
    verifier: FIXTURE_ACTOR,
    requiredEvidenceKinds: ["test_result" as const],
  };
  const productProjection = ProductProjectionSchema.parse(
    withDeploymentRecordDigest({
      schema: "hasna.product_projection.v1",
      id: "product-todos",
      createdAt: CREATED_AT,
      producer: FIXTURE_ACTOR,
      revision: 1,
      sourceProjectRef: {
        kind: "project",
        id: PROJECT_ID,
        uri: `project://${PROJECT_SLUG}`,
        tags: FIXTURE_TAGS,
      },
      sourceRevision: 1,
      slug: PROJECT_SLUG,
      displayName: PROJECT_NAME,
      repositoryRef,
      workspaceRef: {
        kind: "project",
        id: PROJECT_ID,
        uri: `project://${PROJECT_SLUG}`,
        tags: FIXTURE_TAGS,
      },
      lifecycle: "active",
      ownerRefs: [FIXTURE_ACTOR],
      projectedAt: CREATED_AT,
      sourceEvidenceRefs: [manifestEvidence],
    }),
  );
  const intentSnapshot = IntentSnapshotSchema.parse(
    withDeploymentRecordDigest({
      schema: "hasna.intent_snapshot.v1",
      id: `intent-todos-${commitSha}`,
      createdAt: CREATED_AT,
      producer: FIXTURE_ACTOR,
      product: recordRef(productProjection, true),
      repositoryRef,
      commitSha,
      treeSha,
      intentDocument: {
        path: FIXTURE_INPUT_PATH,
        digest: fixtureSha256,
      },
      processes: [
        {
          id: "todos-api",
          role: "web",
          ports: [19427],
          liveness: { path: "/health", protocol: "https", expectedStatuses: [200] },
          readiness: { path: "/ready", protocol: "https", expectedStatuses: [200] },
          version: { path: "/version", protocol: "https", expectedStatuses: [200] },
          resources: {
            cpuMillicores: 1,
            memoryMiB: 1,
            minReplicas: 0,
            maxReplicas: 1,
          },
        },
      ],
      serviceRequirements: [],
      migration: {
        compatibility: "none",
        order: "independent",
        rollbackClass: "comparison-only",
      },
      accessClass: "comparison-only",
      networkClass: "comparison-only",
      backupClass: "comparison-only",
      restoreClass: "comparison-only",
      alarmClass: "comparison-only",
      rollbackClass: "comparison-only",
      configurationRequirements: [],
      validationPlan,
      evidenceRefs: [manifestEvidence],
    }),
  );
  const sourceCandidate = VerifiedSourceCandidateSchema.parse(
    withDeploymentRecordDigest({
      schema: "hasna.verified_source_candidate.v1",
      id: `todos-source-${commitSha}`,
      createdAt: CREATED_AT,
      producer: FIXTURE_ACTOR,
      status: "candidate",
      repositoryRef,
      commitSha,
      treeSha,
      intent: recordRef(intentSnapshot),
      validationPlan,
      verificationRun: {
        schema: "hasna.work_run.v1",
        id: `synthetic-fixture-generation-${commitSha}`,
        objective: "Generate a synthetic contract compatibility fixture",
        status: "succeeded",
        actor: FIXTURE_ACTOR,
        createdAt: CREATED_AT,
        startedAt: CREATED_AT,
        finishedAt: FINISHED_AT,
        decisions: [],
        constraints: FIXTURE_TAGS,
        costEstimates: [],
        validationPlanRefs: [],
        proofBundleRefs: [],
        resourceRefs: [repositoryRef],
        evidenceRefs: [manifestEvidence, validationEvidence],
      },
      results: [
        {
          id: "operational-adoption-evidence",
          kind: "policy",
          status: "not_run",
          evidenceRefs: [manifestEvidence],
        },
      ],
      verifiers: [FIXTURE_ACTOR],
      verifiedAt: FINISHED_AT,
      evidenceRefs: [manifestEvidence, validationEvidence],
    }),
  );
  const syntheticArtifactDigest = digest(
    `synthetic-contract-fixture:${commitSha}:${treeSha}`,
  );
  const buildArtifact = BuildArtifactSchema.parse(
    withDeploymentRecordDigest({
      schema: "hasna.build_artifact.v1",
      id: `todos-contract-fixture-${commitSha}`,
      createdAt: CREATED_AT,
      producer: FIXTURE_ACTOR,
      kind: "archive",
      mediaType: "application/vnd.hasna.deployment-contract-fixture+json",
      uri: "artifact://iapp-deployment-compatibility-vector/records",
      artifactDigest: syntheticArtifactDigest,
      sourceCandidate: recordRef(sourceCandidate),
      repositoryCommitSha: commitSha,
      repositoryTreeSha: treeSha,
      buildWorkflowRef: {
        kind: "workflow",
        id: "iapp-deployment-compatibility-vector",
        uri: "artifact://iapp-deployment-compatibility-vector/workflow",
        tags: FIXTURE_TAGS,
      },
      buildRun: {
        schema: "hasna.work_run.v1",
        id: `synthetic-fixture-packaging-${commitSha}`,
        objective: "Package the synthetic contract compatibility records",
        status: "succeeded",
        actor: FIXTURE_ACTOR,
        createdAt: CREATED_AT,
        startedAt: CREATED_AT,
        finishedAt: FINISHED_AT,
        decisions: [],
        constraints: FIXTURE_TAGS,
        costEstimates: [],
        validationPlanRefs: [],
        proofBundleRefs: [],
        resourceRefs: [],
        evidenceRefs: [manifestEvidence, validationEvidence],
      },
      builder: FIXTURE_ACTOR,
      sbomRefs: [],
      provenanceRefs: [],
      scanRefs: [],
      signatureRefs: [],
      status: "revoked",
    }),
  );
  const artifactAttestation = ArtifactAttestationSchema.parse(
    withDeploymentRecordDigest({
      schema: "hasna.artifact_attestation.v1",
      id: `classification-todos-contract-fixture-${commitSha}`,
      createdAt: FINISHED_AT,
      producer: FIXTURE_ACTOR,
      artifact: recordRef(buildArtifact),
      artifactDigest: syntheticArtifactDigest,
      predicateKind: "fixture-classification",
      predicateSchemaVersion: "v1",
      issuer: FIXTURE_ACTOR,
      keyRef: {
        kind: "artifact",
        id: "comparison-only-fixture-input",
        uri: `artifact://iapp-deployment-compatibility-vector/${FIXTURE_INPUT_PATH}`,
        tags: FIXTURE_TAGS,
      },
      signatureRef: {
        kind: "artifact",
        id: "synthetic-fixture-classification",
        uri: `artifact://iapp-deployment-compatibility-vector/${FIXTURE_INPUT_PATH}`,
        sha256: fixtureSha256,
        summary: "Unsigned fixture classification input; not cryptographic or adoption provenance",
      },
      policyResult: "passed",
      policyRevision: 1,
      expiresAt: EXPIRES_AT,
      evidenceRefs: [manifestEvidence, validationEvidence],
    }),
  );
  return {
    records: {
      productProjections: productProjection,
      intentSnapshots: intentSnapshot,
      verifiedSourceCandidates: sourceCandidate,
      buildArtifacts: buildArtifact,
      artifactAttestations: artifactAttestation,
    },
  };
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function emitVector(
  outputDir: string,
  producerCommitSha: string,
  producerTreeSha: string,
  consumerCommitSha: string,
): CompatibilityVectorManifest {
  const consumerSha = GitShaSchema.parse(consumerCommitSha);
  if (consumerSha !== CONSUMER_COMMIT_SHA) {
    throw new Error(
      `compatibility vector consumer commit must equal frozen consumer ${CONSUMER_COMMIT_SHA}`,
    );
  }
  mkdirSync(outputDir, { recursive: true });
  if (readdirSync(outputDir).length !== 0) {
    throw new Error("compatibility vector output directory must be empty");
  }
  const fixtureInput = CompatibilityVectorInputSchema.parse({
    schema: "hasna.todos.iapp_deployment_compatibility_fixture_input.v1",
    producerRepository: REPOSITORY,
    producerCommitSha,
    producerTreeSha,
    consumerRepository: "hasnaxyz/iapp-deployment",
    consumerCommitSha: consumerSha,
    candidateKind: "comparison_only",
    evidenceClass: "comparison_only_synthetic_fixture",
    permittedUse: "contract_compatibility",
    prohibitedUses: [
      "adoption_evidence",
      "deployment_evidence",
      "release_evidence",
    ],
    project: {
      id: PROJECT_ID,
      slug: PROJECT_SLUG,
      displayName: PROJECT_NAME,
      repository: REPOSITORY,
    },
  });
  const fixtureInputBytes = jsonBytes(fixtureInput);
  const fixtureInputSha256 = digest(fixtureInputBytes);
  writeFileSync(join(outputDir, FIXTURE_INPUT_PATH), fixtureInputBytes);
  const vector = createVectorRecords(
    producerCommitSha,
    producerTreeSha,
    fixtureInputSha256,
  );
  const definitions = [
    {
      collection: "productProjections" as const,
      path: "product-projection.json" as const,
      record: vector.records.productProjections,
    },
    {
      collection: "intentSnapshots" as const,
      path: "intent-snapshot.json" as const,
      record: vector.records.intentSnapshots,
    },
    {
      collection: "verifiedSourceCandidates" as const,
      path: "verified-source-candidate.json" as const,
      record: vector.records.verifiedSourceCandidates,
    },
    {
      collection: "buildArtifacts" as const,
      path: "build-artifact.json" as const,
      record: vector.records.buildArtifacts,
    },
    {
      collection: "artifactAttestations" as const,
      path: "artifact-attestation.json" as const,
      record: vector.records.artifactAttestations,
    },
  ];
  const sourceRecords = definitions.map((definition) => {
    const bytes = jsonBytes(definition.record);
    writeFileSync(join(outputDir, definition.path), bytes);
    return {
      collection: definition.collection,
      path: definition.path,
      bytes: bytes.byteLength,
      sha256: digest(bytes),
      recordDigest: definition.record.digest,
    };
  });
  const manifest = CompatibilityVectorManifestSchema.parse({
    schema: "hasna.todos.iapp_deployment_compatibility_vector.v1",
    artifactName: `iapp-deployment-compatibility-${producerCommitSha}`,
    producerRepository: REPOSITORY,
    producerCommitSha,
    producerTreeSha,
    consumerRepository: "hasnaxyz/iapp-deployment",
    consumerCommitSha: consumerSha,
    candidateManifestSchema: "hasna.todos.attested_container_candidate.v2",
    candidateKind: "comparison_only",
    evidenceClass: "comparison_only_synthetic_fixture",
    sourceCandidateStatus: "candidate",
    producerProvider: "test-fixture",
    operationalEvidenceStatus: "not_run",
    buildArtifactStatus: "revoked",
    artifactAttestationPredicateKind: "fixture-classification",
    providerMutation: false,
    launchEvidenceCount: 0,
    permittedUse: "contract_compatibility",
    prohibitedUses: [
      "adoption_evidence",
      "deployment_evidence",
      "release_evidence",
    ],
    operationalAcceptanceSource:
      ".github/workflows/attested-container-candidate.yml",
    project: {
      id: PROJECT_ID,
      slug: PROJECT_SLUG,
      displayName: PROJECT_NAME,
      repository: REPOSITORY,
    },
    fixtureInput: {
      path: FIXTURE_INPUT_PATH,
      bytes: fixtureInputBytes.byteLength,
      sha256: fixtureInputSha256,
    },
    checksumBundle: {
      path: CHECKSUMS_PATH,
      algorithm: "sha256",
      format: "sha256sum",
      scope: "source_records_only",
    },
    recordCount: 5,
    sourceRecords,
  });
  writeFileSync(join(outputDir, "vector-manifest.json"), jsonBytes(manifest));
  writeFileSync(
    join(outputDir, CHECKSUMS_PATH),
    sourceRecords
      .map((record) => `${record.sha256}  ${record.path}`)
      .join("\n")
      .concat("\n"),
  );
  return manifest;
}

export function assertComparisonOnlySourceCandidate(value: unknown): void {
  const candidateShape = z
    .object({ results: z.array(z.unknown()) })
    .passthrough()
    .parse(value);
  if (candidateShape.results.length !== 1) {
    throw new Error(
      "compatibility vector must contain exactly one operational-adoption-evidence policy result with not_run status",
    );
  }
  const sourceCandidate = VerifiedSourceCandidateSchema.parse(value);
  const [operationalEvidenceResult] = sourceCandidate.results;
  if (
    sourceCandidate.status !== "candidate" ||
    sourceCandidate.producer.kind !== "system" ||
    sourceCandidate.producer.provider !== "test-fixture" ||
    operationalEvidenceResult?.id !== "operational-adoption-evidence" ||
    operationalEvidenceResult.kind !== "policy" ||
    operationalEvidenceResult.status !== "not_run"
  ) {
    throw new Error(
      "compatibility vector must contain exactly one operational-adoption-evidence policy result with not_run status",
    );
  }
}

function verifyVector(
  root: string,
  expectedProducerCommitSha: string,
  expectedProducerTreeSha: string,
  expectedConsumerCommitSha: string,
): CompatibilityVectorManifest {
  const expectedConsumerSha = GitShaSchema.parse(expectedConsumerCommitSha);
  if (expectedConsumerSha !== CONSUMER_COMMIT_SHA) {
    throw new Error(
      `trusted consumer input must equal frozen consumer ${CONSUMER_COMMIT_SHA}`,
    );
  }
  const manifest = CompatibilityVectorManifestSchema.parse(
    JSON.parse(readFileSync(join(root, "vector-manifest.json"), "utf8")),
  );
  if (manifest.producerCommitSha !== GitShaSchema.parse(expectedProducerCommitSha)) {
    throw new Error("compatibility vector producer commit does not match expected head");
  }
  if (manifest.producerTreeSha !== GitShaSchema.parse(expectedProducerTreeSha)) {
    throw new Error("compatibility vector producer tree does not match expected tree");
  }
  if (manifest.consumerCommitSha !== expectedConsumerSha) {
    throw new Error(
      "compatibility vector consumer commit does not match the trusted consumer input",
    );
  }
  const parsedRecords: Partial<Record<
    CompatibilityVectorManifest["sourceRecords"][number]["collection"],
    unknown
  >> = {};
  const expectedDescriptors = [
    ["productProjections", "product-projection.json"],
    ["intentSnapshots", "intent-snapshot.json"],
    ["verifiedSourceCandidates", "verified-source-candidate.json"],
    ["buildArtifacts", "build-artifact.json"],
    ["artifactAttestations", "artifact-attestation.json"],
  ];
  const actualDescriptors = manifest.sourceRecords.map((descriptor) => [
    descriptor.collection,
    descriptor.path,
  ]);
  if (JSON.stringify(actualDescriptors) !== JSON.stringify(expectedDescriptors)) {
    throw new Error("compatibility vector source-record order or membership is invalid");
  }
  const expectedFiles = [
    ...manifest.sourceRecords.map((descriptor) => descriptor.path),
    manifest.fixtureInput.path,
    "vector-manifest.json",
    CHECKSUMS_PATH,
  ].sort();
  const actualFiles = readdirSync(root).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("compatibility vector contains missing or extra files");
  }
  const expectedChecksums = manifest.sourceRecords
    .map((record) => `${record.sha256}  ${record.path}`)
    .join("\n")
    .concat("\n");
  if (readFileSync(join(root, CHECKSUMS_PATH), "utf8") !== expectedChecksums) {
    throw new Error("compatibility vector checksum bundle mismatch");
  }
  const fixtureInputBytes = readFileSync(join(root, manifest.fixtureInput.path));
  if (fixtureInputBytes.byteLength !== manifest.fixtureInput.bytes) {
    throw new Error("compatibility vector fixture input byte count mismatch");
  }
  if (digest(fixtureInputBytes) !== manifest.fixtureInput.sha256) {
    throw new Error("compatibility vector fixture input sha256 mismatch");
  }
  const fixtureInput = CompatibilityVectorInputSchema.parse(
    JSON.parse(fixtureInputBytes.toString("utf8")),
  );
  if (
    fixtureInput.producerCommitSha !== manifest.producerCommitSha ||
    fixtureInput.producerTreeSha !== manifest.producerTreeSha ||
    fixtureInput.consumerCommitSha !== manifest.consumerCommitSha
  ) {
    throw new Error("compatibility vector fixture input is not bound to the manifest");
  }
  for (const descriptor of manifest.sourceRecords) {
    const bytes = readFileSync(join(root, descriptor.path));
    if (bytes.byteLength !== descriptor.bytes) {
      throw new Error(`${descriptor.path}: byte count mismatch`);
    }
    if (digest(bytes) !== descriptor.sha256) {
      throw new Error(`${descriptor.path}: file sha256 mismatch`);
    }
    const value = JSON.parse(bytes.toString("utf8"));
    const parsed = {
      productProjections: ProductProjectionSchema,
      intentSnapshots: IntentSnapshotSchema,
      verifiedSourceCandidates: VerifiedSourceCandidateSchema,
      buildArtifacts: BuildArtifactSchema,
      artifactAttestations: ArtifactAttestationSchema,
    }[descriptor.collection].parse(value);
    if (parsed.digest !== descriptor.recordDigest) {
      throw new Error(`${descriptor.path}: record digest mismatch`);
    }
    parsedRecords[descriptor.collection] = parsed;
  }
  const contractSet: DeploymentContractSet = {
    productProjections: [parsedRecords.productProjections! as never],
    intentSnapshots: [parsedRecords.intentSnapshots! as never],
    verifiedSourceCandidates: [parsedRecords.verifiedSourceCandidates! as never],
    buildArtifacts: [parsedRecords.buildArtifacts! as never],
    artifactAttestations: [parsedRecords.artifactAttestations! as never],
    environmentBindings: [],
    deploymentRequests: [],
    deploymentPlans: [],
    deploymentApprovalDecisions: [],
    deploymentAttempts: [],
    providerReceipts: [],
    deploymentReceipts: [],
    launchEvidence: [],
  };
  const validation = validateDeploymentContractSet(
    DeploymentContractSchemas,
    contractSet,
  );
  if (!validation.success) {
    throw new Error(
      `compatibility vector contract set is invalid: ${validation.issues.join("; ")}`,
    );
  }
  const product = contractSet.productProjections[0]!;
  if (
    product.sourceProjectRef.id !== PROJECT_ID ||
    product.sourceProjectRef.uri !== `project://${PROJECT_SLUG}` ||
    product.workspaceRef.id !== PROJECT_ID ||
    product.workspaceRef.uri !== `project://${PROJECT_SLUG}` ||
    product.slug !== PROJECT_SLUG ||
    product.displayName !== PROJECT_NAME ||
    product.repositoryRef.uri !== `repo://${REPOSITORY}`
  ) {
    throw new Error("compatibility vector does not contain the canonical Projects identity");
  }
  const intent = contractSet.intentSnapshots[0]!;
  if (
    intent.commitSha !== manifest.producerCommitSha ||
    intent.treeSha !== manifest.producerTreeSha
  ) {
    throw new Error("compatibility vector source record is not bound to producer head/tree");
  }
  const sourceCandidate = contractSet.verifiedSourceCandidates[0]!;
  assertComparisonOnlySourceCandidate(sourceCandidate);
  const buildArtifact = contractSet.buildArtifacts[0]!;
  if (
    buildArtifact.status !== "revoked" ||
    buildArtifact.provenanceRefs.length !== 0 ||
    buildArtifact.scanRefs.length !== 0 ||
    buildArtifact.signatureRefs.length !== 0
  ) {
    throw new Error(
      "compatibility vector must not serialize synthetic provenance, scan, or signature claims",
    );
  }
  const attestation = contractSet.artifactAttestations[0]!;
  if (
    attestation.predicateKind !== "fixture-classification" ||
    attestation.issuer.provider !== "test-fixture"
  ) {
    throw new Error(
      "compatibility vector attestation must classify the fixture rather than claim operational provenance",
    );
  }
  return manifest;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  if (command === "emit") {
    const manifest = emitVector(
      requiredFlag(flags, "output-dir"),
      requiredFlag(flags, "producer-sha"),
      requiredFlag(flags, "producer-tree"),
      requiredFlag(flags, "consumer-sha"),
    );
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
    return;
  }
  if (command === "verify") {
    const manifest = verifyVector(
      requiredFlag(flags, "root"),
      requiredFlag(flags, "producer-sha"),
      requiredFlag(flags, "producer-tree"),
      requiredFlag(flags, "consumer-sha"),
    );
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
    return;
  }
  throw new Error("Usage: attested-container-compatibility-vector.ts <emit|verify> [flags]");
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
