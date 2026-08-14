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
  SCHEMA_IDS,
  VerifiedSourceCandidateSchema,
  type ArtifactAttestation,
  type BuildArtifact,
  type DeploymentApprovalDecision,
  type DeploymentAttempt,
  type DeploymentPlan,
  type DeploymentReceipt,
  type DeploymentRequest,
  type EnvironmentBinding,
  type IntentSnapshot,
  type LaunchEvidence,
  type ProductProjection,
  type ProviderReceipt,
  type VerifiedSourceCandidate,
} from "./schemas";
import {
  DEPLOYMENT_SCHEMA_IDS,
  computeEnvironmentBindingEtag,
  sha256DeploymentText,
  sha256DeploymentValue,
  withDeploymentRecordDigest,
  type DeploymentContractSet,
  type DeploymentSchemaId,
} from "./deployment";

const CREATED_AT = "2026-08-09T09:00:00.000Z";
const UPDATED_AT = "2026-08-09T09:05:00.000Z";
const VERIFIED_AT = "2026-08-09T09:10:00.000Z";
const EXPIRES_AT = "2026-08-10T09:00:00.000Z";
const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
const TREE_SHA = "89abcdef0123456789abcdef0123456789abcdef";

const builder = {
  kind: "agent" as const,
  id: "agent-builder",
  name: "Deployment Builder",
};

const approver = {
  kind: "human" as const,
  id: "owner-approver",
  name: "Deployment Approver",
};

const verifier = {
  kind: "agent" as const,
  id: "agent-verifier",
  name: "Independent Verifier",
};

const executor = {
  kind: "service" as const,
  id: "deployment-executor",
  name: "Deployment Executor",
};

const repositoryRef = {
  kind: "repo" as const,
  id: "repo-contract-fixture",
  uri: "repo://hasna/example-app",
  tags: ["deployment-fixture"],
};

const workspaceRef = {
  kind: "project" as const,
  id: "project-contract-fixture",
  uri: "project://example-app",
  tags: ["deployment-fixture"],
};

const evidence = (id: string, kind: "test_result" | "artifact" | "report" = "test_result") => ({
  id,
  kind,
  uri: `artifact://deployment-fixture/${id}`,
  sha256: sha256DeploymentText(id),
  summary: `Bounded evidence for ${id}`,
});

const resource = (
  id: string,
  kind: "workflow" | "integration" | "artifact" | "proof_bundle",
  uri: string,
) => ({
  kind,
  id,
  uri,
  tags: ["deployment-fixture"],
});

const validationPlan = (id: string) => ({
  schema: SCHEMA_IDS.validationPlan,
  id,
  createdAt: CREATED_AT,
  objective: "Verify immutable deployment inputs and observable outcomes",
  checks: [
    {
      id: "evidence-review",
      kind: "manual" as const,
      required: true,
      expected: "Immutable evidence reviewed",
      resourceRefs: [],
    },
  ],
  verifier,
  requiredEvidenceKinds: ["test_result" as const],
});

const workRun = (id: string, actor = builder) => ({
  schema: SCHEMA_IDS.workRun,
  id,
  createdAt: CREATED_AT,
  objective: "Produce verified deployment evidence",
  status: "succeeded" as const,
  actor,
  startedAt: CREATED_AT,
  finishedAt: UPDATED_AT,
  constraints: ["credential-zero execution"],
  resourceRefs: [],
  decisions: [],
  costEstimates: [],
  evidenceRefs: [evidence(`${id}-evidence`)],
  validationPlanRefs: [],
  proofBundleRefs: [],
});

const costEstimate = {
  schema: SCHEMA_IDS.costEstimate,
  id: "cost-deployment-fixture",
  createdAt: CREATED_AT,
  currency: "USD",
  amountMicros: 125_000,
  provider: "fixture-provider",
  basis: "estimated" as const,
  resourceRefs: [],
};

const providerCapabilityCard = {
  providerId: "fixture-provider",
  appId: "example-app",
  adapterId: "fixture-adapter",
  ownerPackage: "@hasna/contracts",
  modes: ["sandbox", "live_mutating"] as const,
  defaultMode: "sandbox" as const,
  credentialRequirements: [
    {
      refName: "deployment-credential-reference",
      requiredForModes: ["live_mutating"] as const,
      allowedSecretInputs: ["credential_ref"] as const,
      failClosedDiagnostic: "Provider credential reference is unavailable",
      revocationCheck: true,
    },
  ],
  operations: [
    {
      operation: "provider.deploy",
      supportedModes: ["sandbox", "live_mutating"] as const,
      sideEffectClass: "compute_or_infra_mutation" as const,
      requiresApproval: true,
      requiresIdempotencyKey: true,
      requiresSandboxEvidence: true,
      requiresRollbackOrRevocation: true,
      rollbackOrRevocation: "provider.rollback",
      noSideEffectSmoke: "provider.observe",
      reconciliation: "provider.reconcile",
    },
  ],
  rateLimitPosture: "bounded",
  costPosture: "pre-authorized estimate required",
  auditEvents: ["deployment.requested", "deployment.observed"],
  redactionRules: ["opaque references only"],
  evidenceRefs: [evidence("provider-capability-evidence", "report")],
};

function ref<T extends {
  schema: DeploymentSchemaId;
  id: string;
  digest: string;
  revision?: number;
}>(record: T): {
  schema: T["schema"];
  id: string;
  digest: string;
  revision?: number;
} {
  return {
    schema: record.schema,
    id: record.id,
    ...(record.revision === undefined ? {} : { revision: record.revision }),
    digest: record.digest,
  };
}

export interface DeploymentFixtureSet {
  productProjection: ProductProjection;
  intentSnapshot: IntentSnapshot;
  verifiedSourceCandidate: VerifiedSourceCandidate;
  buildArtifact: BuildArtifact;
  artifactAttestation: ArtifactAttestation;
  environmentBinding: EnvironmentBinding;
  deploymentRequest: DeploymentRequest;
  deploymentPlan: DeploymentPlan;
  deploymentApprovalDecision: DeploymentApprovalDecision;
  deploymentAttempt: DeploymentAttempt;
  providerReceipt: ProviderReceipt;
  deploymentReceipt: DeploymentReceipt;
  launchEvidence: LaunchEvidence;
}

export function createDeploymentFixtureSet(): DeploymentFixtureSet {
  const productProjection = ProductProjectionSchema.parse(withDeploymentRecordDigest({
    schema: DEPLOYMENT_SCHEMA_IDS.productProjection,
    id: "product-example-app",
    createdAt: CREATED_AT,
    producer: builder,
    revision: 1,
    sourceProjectRef: workspaceRef,
    sourceRevision: 7,
    slug: "example-app",
    displayName: "Example App",
    repositoryRef,
    workspaceRef,
    lifecycle: "active",
    ownerRefs: [approver],
    projectedAt: CREATED_AT,
    sourceEvidenceRefs: [evidence("product-projection-source", "report")],
  }));

  const intentSnapshot = IntentSnapshotSchema.parse(withDeploymentRecordDigest({
    schema: DEPLOYMENT_SCHEMA_IDS.intentSnapshot,
    id: "intent-example-app",
    createdAt: CREATED_AT,
    producer: builder,
    product: ref(productProjection),
    repositoryRef,
    commitSha: COMMIT_SHA,
    treeSha: TREE_SHA,
    intentDocument: {
      path: "deploy/intent.json",
      digest: sha256DeploymentText("intent-document"),
    },
    processes: [
      {
        id: "web",
        role: "web",
        ports: [8080],
        liveness: {
          path: "/health",
          protocol: "https",
          expectedStatuses: [200],
        },
        readiness: {
          path: "/ready",
          protocol: "https",
          expectedStatuses: [200],
        },
        version: {
          path: "/version",
          protocol: "https",
          expectedStatuses: [200],
        },
        resources: {
          cpuMillicores: 250,
          memoryMiB: 512,
          minReplicas: 1,
          maxReplicas: 3,
        },
      },
    ],
    serviceRequirements: [
      {
        id: "primary-database",
        kind: "database",
        required: true,
        class: "postgresql",
      },
    ],
    migration: {
      compatibility: "backward_compatible",
      order: "before_workload",
      rollbackClass: "restore-snapshot",
    },
    accessClass: "private-service",
    networkClass: "private-egress-fenced",
    backupClass: "daily-snapshot",
    restoreClass: "point-in-time",
    alarmClass: "service-slo",
    rollbackClass: "prior-artifact",
    configurationRequirements: [
      {
        name: "APP_DATABASE_REF",
        kind: "secret_reference",
        required: true,
        referenceClass: "vault-reference",
      },
    ],
    validationPlan: validationPlan("validation-intent"),
    evidenceRefs: [evidence("intent-evidence", "report")],
  }));

  const verifiedSourceCandidate = VerifiedSourceCandidateSchema.parse(
    withDeploymentRecordDigest({
      schema: DEPLOYMENT_SCHEMA_IDS.verifiedSourceCandidate,
      id: "source-candidate-example-app",
      createdAt: CREATED_AT,
      producer: builder,
      status: "verified",
      repositoryRef,
      commitSha: COMMIT_SHA,
      treeSha: TREE_SHA,
      branchRef: resource(
        "branch-release",
        "artifact",
        "artifact://deployment-fixture/branch-release",
      ),
      pullRequestRef: resource(
        "pull-request-42",
        "artifact",
        "artifact://deployment-fixture/pull-request-42",
      ),
      intent: ref(intentSnapshot),
      validationPlan: validationPlan("validation-source"),
      verificationRun: workRun("verification-run", verifier),
      results: [
        {
          id: "source-integrity",
          kind: "source_integrity",
          status: "passed",
          evidenceRefs: [evidence("source-integrity-result")],
        },
        {
          id: "independent-review",
          kind: "review",
          status: "passed",
          evidenceRefs: [evidence("source-review-result")],
        },
      ],
      verifiers: [verifier],
      verifiedAt: VERIFIED_AT,
      evidenceRefs: [evidence("verified-source-evidence")],
    }),
  );

  const artifactDigest = sha256DeploymentText("immutable-build-artifact");
  const buildArtifact = BuildArtifactSchema.parse(withDeploymentRecordDigest({
    schema: DEPLOYMENT_SCHEMA_IDS.buildArtifact,
    id: "artifact-example-app",
    createdAt: VERIFIED_AT,
    producer: builder,
    kind: "oci_image",
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    uri: "artifact://deployment-fixture/example-app-image",
    artifactDigest,
    sourceCandidate: ref(verifiedSourceCandidate),
    repositoryCommitSha: COMMIT_SHA,
    repositoryTreeSha: TREE_SHA,
    buildWorkflowRef: resource(
      "build-workflow",
      "workflow",
      "artifact://deployment-fixture/build-workflow",
    ),
    buildRun: workRun("build-run"),
    builder,
    sbomRefs: [evidence("artifact-sbom", "artifact")],
    provenanceRefs: [evidence("artifact-provenance", "artifact")],
    scanRefs: [evidence("artifact-scan")],
    signatureRefs: [evidence("artifact-signature", "artifact")],
    status: "active",
  }));

  const artifactAttestation = ArtifactAttestationSchema.parse(
    withDeploymentRecordDigest({
      schema: DEPLOYMENT_SCHEMA_IDS.artifactAttestation,
      id: "attestation-example-app",
      createdAt: VERIFIED_AT,
      producer: verifier,
      artifact: ref(buildArtifact),
      artifactDigest,
      predicateKind: "slsa-provenance",
      predicateSchemaVersion: "v1.0",
      issuer: verifier,
      keyRef: resource(
        "signing-key-reference",
        "integration",
        "integration://deployment-fixture/signing-key-reference",
      ),
      signatureRef: evidence("attestation-signature", "artifact"),
      policyResult: "passed",
      policyRevision: 3,
      expiresAt: EXPIRES_AT,
      evidenceRefs: [evidence("attestation-policy-result")],
    }),
  );

  const providerCapabilityDigest = sha256DeploymentValue(providerCapabilityCard);
  const environmentBinding = EnvironmentBindingSchema.parse(
    withDeploymentRecordDigest({
      schema: DEPLOYMENT_SCHEMA_IDS.environmentBinding,
      id: "environment-production",
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      producer: builder,
      revision: 2,
      etag: computeEnvironmentBindingEtag("environment-production", 2),
      product: ref(productProjection),
      intent: ref(intentSnapshot),
      environment: {
        id: "production",
        classification: "production",
      },
      dataBackend: "postgresql",
      providerConnectionRef: resource(
        "provider-connection",
        "integration",
        "integration://deployment-fixture/provider-connection",
      ),
      providerCapabilityCard,
      providerCapabilityDigest,
      providerIdentity: {
        accountId: "account-production",
        region: "eu-central-1",
        projectId: "provider-project-example-app",
        clusterId: "provider-cluster-production",
        networkId: "provider-network-production",
        storageId: "provider-storage-production",
        routingId: "provider-routing-production",
      },
      policyProfile: "production-policy",
      authorizationProfile: "production-authorization",
      dataClassification: "private",
      backupProfile: "daily-snapshot",
      rollbackProfile: "prior-artifact",
      commercialBindingRef: resource(
        "commercial-binding",
        "integration",
        "integration://deployment-fixture/commercial-binding",
      ),
      writer: builder,
      changeEvidenceRefs: [evidence("environment-change-evidence", "report")],
    }),
  );

  const deploymentRequest = DeploymentRequestSchema.parse(
    withDeploymentRecordDigest({
      schema: DEPLOYMENT_SCHEMA_IDS.deploymentRequest,
      id: "deployment-request-example-app",
      createdAt: VERIFIED_AT,
      producer: builder,
      kind: "deployment",
      requester: builder,
      product: ref(productProjection),
      environment: ref(environmentBinding),
      intent: ref(intentSnapshot),
      artifact: ref(buildArtifact),
      attestations: [ref(artifactAttestation)],
      policyProfile: "production-policy",
      idempotencyKeyFingerprint: sha256DeploymentText("deployment-request-idempotency"),
      requestAt: VERIFIED_AT,
      expiresAt: EXPIRES_AT,
      sourceRequestId: "source-request-example-app",
      auditCorrelationId: "audit-correlation-example-app",
      costEstimate,
      evidenceRefs: [evidence("deployment-request-evidence", "report")],
    }),
  );

  const desiredStateDigest = sha256DeploymentText("desired-production-state");
  const deploymentPlan = DeploymentPlanSchema.parse(withDeploymentRecordDigest({
    schema: DEPLOYMENT_SCHEMA_IDS.deploymentPlan,
    id: "deployment-plan-example-app",
    createdAt: VERIFIED_AT,
    producer: builder,
    kind: "deployment",
    request: ref(deploymentRequest),
    compiler: {
      actor: builder,
      version: "1.0.0",
      contractKitVersion: "1.0.0",
    },
    inputs: [
      ref(productProjection),
      ref(intentSnapshot),
      ref(buildArtifact),
      ref(environmentBinding),
    ],
    providerCapabilityDigests: [providerCapabilityDigest],
    actions: [
      {
        id: "apply-workload",
        operationId: "provider.deploy",
        operationVersion: 1,
        dependsOn: [],
        inputs: [ref(buildArtifact), ref(environmentBinding)],
        outputSchema: DEPLOYMENT_SCHEMA_IDS.providerReceipt,
        preconditions: ["immutable-inputs", "approval-valid"],
        postconditions: ["provider-observed", "health-verified"],
        lockClass: "environment-exclusive",
        fencingRequired: true,
        sideEffectClass: "compute_or_infra_mutation",
        riskClass: "high",
        approvalScope: "plan",
        runtimeMaterialKind: null,
        providerOperation: "provider.deploy",
        providerCapabilityDigest,
        retryClass: "reconcile_first",
        maxAttempts: 2,
        timeoutClass: "deployment-standard",
        compensationOperationId: "provider.rollback",
        idempotencyRequired: true,
        reconciliationRequired: true,
        evidenceRequirements: ["provider-receipt", "health-check"],
      },
    ],
    authorizationRequirements: ["production-deployer"],
    policyRequirements: ["production-policy"],
    riskClass: "high",
    evidenceRequirements: ["provider-receipt", "live-verification"],
    expectedStateDigest: desiredStateDigest,
    verificationCriteria: ["health", "readiness", "version"],
    rollbackInputs: [],
    estimatedCost: costEstimate,
    issuedAt: VERIFIED_AT,
    expiresAt: EXPIRES_AT,
  }));

  const approvalEnvelope = {
    schema: SCHEMA_IDS.decisionEnvelope,
    id: "approval-envelope-example-app",
    createdAt: VERIFIED_AT,
    decisionType: "approval" as const,
    status: "allowed" as const,
    actor: approver,
    selected: [],
    skipped: [],
    reason: "Approved after policy and evidence review",
    obligations: ["retain immutable receipts", "verify live outcome"],
    redactions: [],
    evidenceRefs: [evidence("approval-envelope-evidence", "report")],
  };

  const deploymentApprovalDecision = DeploymentApprovalDecisionSchema.parse(
    withDeploymentRecordDigest({
      schema: DEPLOYMENT_SCHEMA_IDS.deploymentApprovalDecision,
      id: "deployment-approval-example-app",
      createdAt: VERIFIED_AT,
      producer: approver,
      decision: approvalEnvelope,
      plan: ref(deploymentPlan),
      scope: "plan",
      actionId: null,
      phaseId: null,
      runtimeMaterial: null,
      boundInputDigests: [
        { kind: "request", digest: deploymentRequest.digest },
        { kind: "plan", digest: deploymentPlan.digest },
        { kind: "intent", digest: intentSnapshot.digest },
      ],
      environment: ref(environmentBinding),
      actorRole: "approver",
      attemptScope: {
        minimum: 1,
        maximum: 2,
      },
      unchangedRetryPolicy: "allowed",
      issuedAt: VERIFIED_AT,
      expiresAt: EXPIRES_AT,
      separationOfDutiesPassed: true,
      authorizationPolicyRevision: 4,
      evidenceRefs: [evidence("deployment-approval-evidence", "report")],
    }),
  );

  const deploymentAttempt = DeploymentAttemptSchema.parse(
    withDeploymentRecordDigest({
      schema: DEPLOYMENT_SCHEMA_IDS.deploymentAttempt,
      id: "deployment-attempt-example-app",
      createdAt: VERIFIED_AT,
      updatedAt: "2026-08-09T09:20:00.000Z",
      producer: executor,
      revision: 1,
      plan: ref(deploymentPlan),
      approvals: [
        {
          decision: ref(deploymentApprovalDecision),
          scope: "plan",
          actionId: null,
          phaseId: null,
          runtimeMaterialDigest: null,
        },
      ],
      requester: builder,
      decisionActors: [approver],
      executorActors: [executor],
      environmentLock: {
        id: "environment-production-lock",
        fencingToken: 19,
      },
      attemptNumber: 1,
      retryOf: null,
      state: "succeeded",
      actionSteps: [
        {
          sequence: 1,
          actionId: "apply-workload",
          state: "succeeded",
          providerCorrelationId: "provider-operation-example-app",
          startedAt: "2026-08-09T09:11:00.000Z",
          finishedAt: "2026-08-09T09:18:00.000Z",
          evidenceRefs: [evidence("attempt-action-evidence")],
        },
      ],
      outboxCorrelationRef: resource(
        "outbox-correlation",
        "integration",
        "integration://deployment-fixture/outbox-correlation",
      ),
      inboxCorrelationRef: resource(
        "inbox-correlation",
        "integration",
        "integration://deployment-fixture/inbox-correlation",
      ),
      failureReason: null,
      evidenceRefs: [evidence("attempt-evidence", "report")],
      providerReceipts: [],
      finalReceipt: null,
    }),
  );

  const providerReceipt = ProviderReceiptSchema.parse(withDeploymentRecordDigest({
    schema: DEPLOYMENT_SCHEMA_IDS.providerReceipt,
    id: "provider-receipt-example-app",
    createdAt: "2026-08-09T09:18:00.000Z",
    producer: executor,
    attempt: ref(deploymentAttempt),
    provider: "fixture-provider",
    adapter: "fixture-adapter",
    connectionRef: resource(
      "provider-connection",
      "integration",
      "integration://deployment-fixture/provider-connection",
    ),
    capabilityDigest: providerCapabilityDigest,
    operationId: "provider.deploy",
    operationVersion: 1,
    providerIdentity: {
      projectId: "provider-project-example-app",
      operationId: "provider-operation-example-app",
      deploymentId: "provider-deployment-example-app",
      resourceIds: ["provider-service-example-app"],
      eventId: "provider-event-example-app",
    },
    requestFingerprint: deploymentRequest.idempotencyKeyFingerprint,
    providerStatus: "ready",
    normalizedResult: "succeeded",
    observedProviderRevision: "provider-revision-19",
    observedAt: "2026-08-09T09:19:00.000Z",
    retryClass: "reconcile_first",
    reconciliationState: "confirmed",
    unknownOutcome: false,
    redaction: "full",
    responseEvidenceRefs: [evidence("provider-response-evidence", "report")],
    observationEvidenceRefs: [evidence("provider-observation-evidence")],
  }));

  const verification = [
    {
      id: "health",
      kind: "health" as const,
      status: "passed" as const,
      evidenceRefs: [evidence("health-evidence")],
    },
    {
      id: "readiness",
      kind: "readiness" as const,
      status: "passed" as const,
      evidenceRefs: [evidence("readiness-evidence")],
    },
    {
      id: "version",
      kind: "version" as const,
      status: "passed" as const,
      evidenceRefs: [evidence("version-evidence")],
    },
  ];

  const deploymentReceipt = DeploymentReceiptSchema.parse(
    withDeploymentRecordDigest({
      schema: DEPLOYMENT_SCHEMA_IDS.deploymentReceipt,
      id: "deployment-receipt-example-app",
      createdAt: "2026-08-09T09:20:00.000Z",
      producer: verifier,
      request: ref(deploymentRequest),
      plan: ref(deploymentPlan),
      approvals: [ref(deploymentApprovalDecision)],
      attempt: ref(deploymentAttempt),
      product: ref(productProjection),
      intent: ref(intentSnapshot),
      artifact: ref(buildArtifact),
      attestations: [ref(artifactAttestation)],
      environment: ref(environmentBinding),
      providerReceipts: [ref(providerReceipt)],
      desiredStateDigest,
      observedStateDigest: desiredStateDigest,
      verification,
      infrastructurePlanRef: evidence("infrastructure-plan", "artifact"),
      infrastructureStateLineageRef: resource(
        "infrastructure-state-lineage",
        "artifact",
        "artifact://deployment-fixture/infrastructure-state-lineage",
      ),
      verifiers: [verifier],
      evidenceRefs: [evidence("deployment-receipt-evidence", "report")],
      outcome: "succeeded",
    }),
  );

  const launchEvidence = LaunchEvidenceSchema.parse(withDeploymentRecordDigest({
    schema: DEPLOYMENT_SCHEMA_IDS.launchEvidence,
    id: "launch-evidence-example-app",
    createdAt: "2026-08-09T09:25:00.000Z",
    producer: verifier,
    product: ref(productProjection),
    environment: ref(environmentBinding),
    deploymentReceipt: ref(deploymentReceipt),
    requiredChecks: verification,
    proofBundleRefs: [
      resource(
        "launch-proof-bundle",
        "proof_bundle",
        "artifact://deployment-fixture/launch-proof-bundle",
      ),
    ],
    findings: [
      {
        id: "documentation-follow-up",
        severity: "p3",
        status: "accepted",
        evidenceRefs: [evidence("launch-follow-up-evidence", "report")],
      },
    ],
    verifiers: [verifier],
    independentReview: true,
    status: "launched",
    compiledAt: "2026-08-09T09:25:00.000Z",
    expiresAt: EXPIRES_AT,
  }));

  return {
    productProjection,
    intentSnapshot,
    verifiedSourceCandidate,
    buildArtifact,
    artifactAttestation,
    environmentBinding,
    deploymentRequest,
    deploymentPlan,
    deploymentApprovalDecision,
    deploymentAttempt,
    providerReceipt,
    deploymentReceipt,
    launchEvidence,
  };
}

export function deploymentFixtureSetToContractSet(
  fixtures: DeploymentFixtureSet,
): DeploymentContractSet {
  return {
    productProjections: [fixtures.productProjection],
    intentSnapshots: [fixtures.intentSnapshot],
    verifiedSourceCandidates: [fixtures.verifiedSourceCandidate],
    buildArtifacts: [fixtures.buildArtifact],
    artifactAttestations: [fixtures.artifactAttestation],
    environmentBindings: [fixtures.environmentBinding],
    deploymentRequests: [fixtures.deploymentRequest],
    deploymentPlans: [fixtures.deploymentPlan],
    deploymentApprovalDecisions: [fixtures.deploymentApprovalDecision],
    deploymentAttempts: [fixtures.deploymentAttempt],
    providerReceipts: [fixtures.providerReceipt],
    deploymentReceipts: [fixtures.deploymentReceipt],
    launchEvidence: [fixtures.launchEvidence],
  };
}

export function deploymentFixturesBySchemaId(
  fixtures: DeploymentFixtureSet,
): Readonly<Record<DeploymentSchemaId, unknown>> {
  return Object.freeze({
    [DEPLOYMENT_SCHEMA_IDS.productProjection]: fixtures.productProjection,
    [DEPLOYMENT_SCHEMA_IDS.intentSnapshot]: fixtures.intentSnapshot,
    [DEPLOYMENT_SCHEMA_IDS.verifiedSourceCandidate]: fixtures.verifiedSourceCandidate,
    [DEPLOYMENT_SCHEMA_IDS.buildArtifact]: fixtures.buildArtifact,
    [DEPLOYMENT_SCHEMA_IDS.artifactAttestation]: fixtures.artifactAttestation,
    [DEPLOYMENT_SCHEMA_IDS.environmentBinding]: fixtures.environmentBinding,
    [DEPLOYMENT_SCHEMA_IDS.deploymentRequest]: fixtures.deploymentRequest,
    [DEPLOYMENT_SCHEMA_IDS.deploymentPlan]: fixtures.deploymentPlan,
    [DEPLOYMENT_SCHEMA_IDS.deploymentApprovalDecision]:
      fixtures.deploymentApprovalDecision,
    [DEPLOYMENT_SCHEMA_IDS.deploymentAttempt]: fixtures.deploymentAttempt,
    [DEPLOYMENT_SCHEMA_IDS.providerReceipt]: fixtures.providerReceipt,
    [DEPLOYMENT_SCHEMA_IDS.deploymentReceipt]: fixtures.deploymentReceipt,
    [DEPLOYMENT_SCHEMA_IDS.launchEvidence]: fixtures.launchEvidence,
  });
}
