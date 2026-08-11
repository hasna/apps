import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
  type ArtifactAttestation,
  type BuildArtifact,
  type IntentSnapshot,
  type ProductProjection,
  type VerifiedSourceCandidate,
} from "hasna-deployment-contracts/deployment";
import { z } from "zod";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const GitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const PassedSchema = z.literal("passed");

export const CandidateManifestSchema = z
  .object({
    schema: z.literal("hasna.todos.attested_container_candidate.v2"),
    candidateKind: z.literal("comparison_only"),
    project: z
      .object({
        id: z.string().regex(/^wks_[A-Za-z0-9_-]{8,}$/),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        displayName: z.string().min(1),
        repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
      })
      .strict(),
    source: z
      .object({
        repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
        commitSha: GitShaSchema,
        treeSha: GitShaSchema,
      })
      .strict(),
    dependencyLock: z
      .object({
        path: z.literal("bun.lock"),
        sha256: Sha256Schema,
      })
      .strict(),
    artifact: z
      .object({
        mediaType: z.literal("application/vnd.oci.image.manifest.v1+json"),
        ociLayoutPath: z.literal("todos-candidate.oci-layout"),
        ociArchivePath: z.literal("todos-candidate.oci.tar"),
        ociManifestDigest: Sha256Schema,
        ociArchiveSha256: Sha256Schema,
        platform: z.literal("linux/arm64"),
        pushed: z.literal(false),
        deployed: z.literal(false),
      })
      .strict(),
    run: z
      .object({
        repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
        workflow: z.literal(".github/workflows/attested-container-candidate.yml"),
        runId: z.string().regex(/^[0-9]+$/),
        runAttempt: z.string().regex(/^[0-9]+$/),
        runnerImage: z.literal("ubuntu-24.04-arm"),
      })
      .strict(),
    gates: z
      .object({
        frozenInstall: PassedSchema,
        typecheck: PassedSchema,
        tests: PassedSchema,
        build: PassedSchema,
        noCloud: PassedSchema,
        scan: PassedSchema,
      })
      .strict(),
    scan: z
      .object({
        engine: z.literal("trivy"),
        reportPath: z.literal("todos-candidate.trivy.json"),
        reportSha256: Sha256Schema,
        critical: z.number().int().nonnegative(),
        high: z.number().int().nonnegative(),
      })
      .strict(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const createdAt = Date.parse(manifest.createdAt);
    const expiresAt = Date.parse(manifest.expiresAt);
    if (expiresAt <= createdAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "candidate expiry must be later than creation",
      });
    }
    if (expiresAt - createdAt > 7 * 24 * 60 * 60 * 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "candidate expiry must not exceed the seven-day artifact retention",
      });
    }
    if (manifest.run.repository !== manifest.source.repository) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["run", "repository"],
        message: "run repository must match the exact source repository",
      });
    }
    if (manifest.project.repository !== manifest.source.repository) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["project", "repository"],
        message: "Projects repository locator must match the exact source repository",
      });
    }
    if (manifest.scan.critical !== 0 || manifest.scan.high !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scan"],
        message: "candidate scan must contain zero HIGH and CRITICAL findings",
      });
    }
  });

export type CandidateManifest = z.infer<typeof CandidateManifestSchema>;

type CreateArtifactAttestationInput = {
  manifest: CandidateManifest;
  buildArtifact: BuildArtifact;
  machineManifestSha256: string;
  bundleSha256: string;
  verificationSha256?: string;
  attestationId: string;
  attestationUrl: string;
  createdAt: string;
};

type CreateBuildArtifactInput = {
  manifest: CandidateManifest;
  sourceCandidate: VerifiedSourceCandidate;
  machineManifestSha256: string;
  bundleSha256: string;
  verificationSha256: string;
  finishedAt: string;
};

type CreateSourceRecordsInput = {
  manifest: CandidateManifest;
  machineManifestSha256: string;
  verificationSha256: string;
  finishedAt: string;
};

type SourceRecords = {
  productProjection: ProductProjection;
  intentSnapshot: IntentSnapshot;
  sourceCandidate: VerifiedSourceCandidate;
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

function workflowProducer(manifest: CandidateManifest) {
  return {
    kind: "workflow" as const,
    id: `github-actions:${manifest.run.repository}:${manifest.run.workflow}`,
    name: "GitHub Actions attested container candidate",
    provider: "github",
  };
}

function repositoryReference(manifest: CandidateManifest) {
  return {
    kind: "repo" as const,
    id: `repo-${manifest.source.repository.replace("/", "-")}`,
    uri: `repo://${manifest.source.repository}`,
    tags: ["comparison-only", "exact-main"],
  };
}

function machineManifestEvidence(machineManifestSha256: string) {
  return {
    kind: "artifact" as const,
    id: "todos-candidate-machine-manifest",
    uri: "artifact://attested-container-candidate/todos-candidate.manifest.json",
    sha256: machineManifestSha256,
    summary: "Exact-main no-push candidate manifest",
  };
}

function sourceValidationPlan(manifest: CandidateManifest) {
  return {
    schema: "hasna.validation_plan.v1" as const,
    id: `validate-todos-source-${manifest.source.commitSha}`,
    createdAt: manifest.createdAt,
    objective: "Verify the exact-main source, required gates, and signed no-push candidate",
    checks: [
      {
        id: "exact-source-integrity",
        kind: "test" as const,
        required: true,
        expected: "Repository commit and tree match the immutable workflow input",
        resourceRefs: [],
      },
      {
        id: "candidate-gates",
        kind: "test" as const,
        required: true,
        expected: "Install, typecheck, tests, build, no-cloud, and scan gates pass",
        resourceRefs: [],
      },
    ],
    verifier: workflowProducer(manifest),
    requiredEvidenceKinds: ["test_result" as const],
  };
}

export function createSourceRecords(input: CreateSourceRecordsInput): SourceRecords {
  const manifest = CandidateManifestSchema.parse(input.manifest);
  const machineManifestSha256 = Sha256Schema.parse(input.machineManifestSha256);
  const verificationSha256 = Sha256Schema.parse(input.verificationSha256);
  const producer = workflowProducer(manifest);
  const repositoryRef = repositoryReference(manifest);
  const manifestEvidence = machineManifestEvidence(machineManifestSha256);
  const verificationEvidence = {
    kind: "test_result" as const,
    id: "github-attestation-verification",
    uri: "artifact://attested-container-candidate/todos-candidate.signature-verification.json",
    sha256: verificationSha256,
    summary: "Positive and tampered-negative GitHub attestation verification",
  };
  const productProjection = ProductProjectionSchema.parse(
    withDeploymentRecordDigest({
      schema: "hasna.product_projection.v1",
      id: "product-todos",
      createdAt: manifest.createdAt,
      producer,
      revision: 1,
      sourceProjectRef: {
        kind: "project",
        id: manifest.project.id,
        uri: `project://${manifest.project.slug}`,
        tags: ["comparison-only"],
      },
      sourceRevision: 1,
      slug: manifest.project.slug,
      displayName: manifest.project.displayName,
      repositoryRef,
      workspaceRef: {
        kind: "project",
        id: manifest.project.id,
        uri: `project://${manifest.project.slug}`,
        tags: ["comparison-only"],
      },
      lifecycle: "active",
      ownerRefs: [producer],
      projectedAt: manifest.createdAt,
      sourceEvidenceRefs: [manifestEvidence],
    }),
  );
  const intentSnapshot = IntentSnapshotSchema.parse(
    withDeploymentRecordDigest({
      schema: "hasna.intent_snapshot.v1",
      id: `intent-todos-${manifest.source.commitSha}`,
      createdAt: manifest.createdAt,
      producer,
      product: {
        schema: "hasna.product_projection.v1",
        id: productProjection.id,
        revision: productProjection.revision,
        digest: productProjection.digest,
      },
      repositoryRef,
      commitSha: manifest.source.commitSha,
      treeSha: manifest.source.treeSha,
      intentDocument: {
        path: "todos-candidate.manifest.json",
        digest: machineManifestSha256,
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
      accessClass: "api-key",
      networkClass: "comparison-only",
      backupClass: "comparison-only",
      restoreClass: "comparison-only",
      alarmClass: "comparison-only",
      rollbackClass: "comparison-only",
      configurationRequirements: [],
      validationPlan: sourceValidationPlan(manifest),
      evidenceRefs: [manifestEvidence],
    }),
  );
  const sourceCandidate = VerifiedSourceCandidateSchema.parse(
    withDeploymentRecordDigest({
      schema: "hasna.verified_source_candidate.v1",
      id: `todos-source-${manifest.source.commitSha}`,
      createdAt: manifest.createdAt,
      producer,
      status: "verified",
      repositoryRef,
      commitSha: manifest.source.commitSha,
      treeSha: manifest.source.treeSha,
      branchRef: {
        kind: "branch",
        id: "main",
        uri: `repo://${manifest.source.repository}/refs/heads/main`,
        tags: ["exact-main"],
      },
      intent: {
        schema: "hasna.intent_snapshot.v1",
        id: intentSnapshot.id,
        digest: intentSnapshot.digest,
      },
      validationPlan: sourceValidationPlan(manifest),
      verificationRun: {
        schema: "hasna.work_run.v1",
        id: `verify-todos-source-${manifest.run.runId}-${manifest.run.runAttempt}`,
        objective: "Verify the exact-main source and signed no-push candidate evidence",
        status: "succeeded",
        actor: producer,
        createdAt: manifest.createdAt,
        startedAt: manifest.createdAt,
        finishedAt: input.finishedAt,
        decisions: [],
        constraints: ["comparison-only", "no registry push", "no deployment"],
        costEstimates: [],
        validationPlanRefs: [],
        proofBundleRefs: [],
        resourceRefs: [repositoryRef],
        evidenceRefs: [manifestEvidence, verificationEvidence],
      },
      results: [
        {
          id: "source-integrity",
          kind: "source_integrity",
          status: "passed",
          evidenceRefs: [manifestEvidence],
        },
        {
          id: "candidate-gates",
          kind: "test",
          status: "passed",
          evidenceRefs: [verificationEvidence],
        },
      ],
      verifiers: [producer],
      verifiedAt: input.finishedAt,
      evidenceRefs: [manifestEvidence, verificationEvidence],
    }),
  );
  return { productProjection, intentSnapshot, sourceCandidate };
}

export function createBuildArtifact(input: CreateBuildArtifactInput): BuildArtifact {
  const manifest = CandidateManifestSchema.parse(input.manifest);
  const sourceCandidate = VerifiedSourceCandidateSchema.parse(input.sourceCandidate);
  const machineManifestSha256 = Sha256Schema.parse(input.machineManifestSha256);
  const bundleSha256 = Sha256Schema.parse(input.bundleSha256);
  const verificationSha256 = Sha256Schema.parse(input.verificationSha256);
  const producer = workflowProducer(manifest);
  if (
    sourceCandidate.status !== "verified" ||
    sourceCandidate.commitSha !== manifest.source.commitSha ||
    sourceCandidate.treeSha !== manifest.source.treeSha
  ) {
    throw new Error("source candidate is not verified for the exact candidate source");
  }
  const manifestEvidence = machineManifestEvidence(machineManifestSha256);
  const bundleEvidence = {
    kind: "artifact" as const,
    id: "github-oidc-slsa-bundle",
    uri: "artifact://attested-container-candidate/todos-candidate.slsa-bundle.jsonl",
    sha256: bundleSha256,
    summary: "GitHub OIDC keyless SLSA provenance bundle",
  };
  const verificationEvidence = {
    kind: "test_result" as const,
    id: "github-attestation-verification",
    uri: "artifact://attested-container-candidate/todos-candidate.signature-verification.json",
    sha256: verificationSha256,
    summary: "Positive and tampered-negative GitHub attestation verification",
  };

  return BuildArtifactSchema.parse(
    withDeploymentRecordDigest({
      schema: "hasna.build_artifact.v1",
      id: `todos-oci-${manifest.source.commitSha}`,
      createdAt: manifest.createdAt,
      producer,
      kind: "oci_image",
      mediaType: manifest.artifact.mediaType,
      uri: "artifact://attested-container-candidate/todos-candidate.oci.tar",
      artifactDigest: manifest.artifact.ociManifestDigest,
      sourceCandidate: {
        schema: "hasna.verified_source_candidate.v1",
        id: sourceCandidate.id,
        digest: sourceCandidate.digest,
      },
      repositoryCommitSha: manifest.source.commitSha,
      repositoryTreeSha: manifest.source.treeSha,
      buildWorkflowRef: {
        kind: "workflow",
        id: "attested-container-candidate",
        uri: `https://github.com/${manifest.run.repository}/actions/workflows/attested-container-candidate.yml`,
        tags: ["comparison-only", "no-push"],
      },
      buildRun: {
        schema: "hasna.work_run.v1",
        id: `github-actions-run-${manifest.run.runId}-${manifest.run.runAttempt}`,
        objective: "Build and attest an exact-main, no-push comparison OCI candidate",
        status: "succeeded",
        actor: producer,
        createdAt: manifest.createdAt,
        startedAt: manifest.createdAt,
        finishedAt: input.finishedAt,
        decisions: [],
        constraints: ["comparison-only", "no registry push", "no deployment"],
        costEstimates: [],
        validationPlanRefs: [],
        proofBundleRefs: [],
        resourceRefs: [],
        evidenceRefs: [manifestEvidence, verificationEvidence],
      },
      builder: producer,
      sbomRefs: [],
      provenanceRefs: [bundleEvidence],
      scanRefs: [
        {
          kind: "report",
          id: "trivy-candidate-scan",
          uri: "artifact://attested-container-candidate/todos-candidate.trivy.json",
          sha256: manifest.scan.reportSha256,
          summary: "Zero HIGH and CRITICAL findings on the OCI archive",
        },
      ],
      signatureRefs: [bundleEvidence],
      status: "active",
    }),
  );
}

export function createArtifactAttestation(
  input: CreateArtifactAttestationInput,
): ArtifactAttestation {
  const manifest = CandidateManifestSchema.parse(input.manifest);
  const buildArtifact = BuildArtifactSchema.parse(input.buildArtifact);
  const machineManifestSha256 = Sha256Schema.parse(input.machineManifestSha256);
  const bundleSha256 = Sha256Schema.parse(input.bundleSha256);
  const verificationSha256 = Sha256Schema.parse(
    input.verificationSha256 ?? bundleSha256,
  );
  const producer = workflowProducer(manifest);
  if (
    buildArtifact.artifactDigest !== manifest.artifact.ociManifestDigest ||
    buildArtifact.repositoryCommitSha !== manifest.source.commitSha ||
    buildArtifact.repositoryTreeSha !== manifest.source.treeSha
  ) {
    throw new Error("build artifact is not bound to the candidate source and OCI digest");
  }

  return ArtifactAttestationSchema.parse(
    withDeploymentRecordDigest({
      schema: "hasna.artifact_attestation.v1",
      id: `attestation-todos-oci-${manifest.source.commitSha}`,
      createdAt: input.createdAt,
      producer,
      artifact: {
        schema: "hasna.build_artifact.v1",
        id: buildArtifact.id,
        digest: buildArtifact.digest,
      },
      artifactDigest: manifest.artifact.ociManifestDigest,
      predicateKind: "slsa-provenance",
      predicateSchemaVersion: "v1",
      issuer: producer,
      keyRef: {
        kind: "integration",
        id: "github-actions-keyless-sigstore",
        uri: "https://token.actions.githubusercontent.com",
        tags: ["oidc", "keyless", "sigstore"],
      },
      signatureRef: {
        kind: "artifact",
        id: input.attestationId,
        uri: input.attestationUrl,
        sha256: bundleSha256,
        summary: "GitHub OIDC keyless SLSA provenance bundle",
      },
      policyResult: "passed",
      policyRevision: 1,
      expiresAt: manifest.expiresAt,
      evidenceRefs: [
        {
          kind: "artifact",
          id: "todos-candidate-machine-manifest",
          uri: "artifact://attested-container-candidate/todos-candidate.manifest.json",
          sha256: machineManifestSha256,
          summary: "Exact-main no-push candidate manifest",
        },
        {
          kind: "test_result",
          id: "github-attestation-verification",
          uri: "artifact://attested-container-candidate/todos-candidate.signature-verification.json",
          sha256: verificationSha256,
          summary: "Positive and tampered-negative GitHub attestation verification",
        },
      ],
    }),
  );
}

type VerifyCandidateChainInput = {
  manifest: CandidateManifest;
  productProjection: unknown;
  intentSnapshot: unknown;
  sourceCandidate: unknown;
  buildArtifact: unknown;
  attestation: unknown;
  machineManifestSha256: string;
  bundleSha256: string;
};

export function verifyCandidateChain(input: VerifyCandidateChainInput): ArtifactAttestation {
  const manifest = CandidateManifestSchema.parse(input.manifest);
  const productProjection = ProductProjectionSchema.parse(input.productProjection);
  const intentSnapshot = IntentSnapshotSchema.parse(input.intentSnapshot);
  const sourceCandidate = VerifiedSourceCandidateSchema.parse(input.sourceCandidate);
  const buildArtifact = BuildArtifactSchema.parse(input.buildArtifact);
  const attestation = ArtifactAttestationSchema.parse(input.attestation);
  const machineManifestSha256 = Sha256Schema.parse(input.machineManifestSha256);
  const bundleSha256 = Sha256Schema.parse(input.bundleSha256);
  const contractValidation = validateDeploymentContractSet(DeploymentContractSchemas, {
    productProjections: [productProjection],
    intentSnapshots: [intentSnapshot],
    verifiedSourceCandidates: [sourceCandidate],
    buildArtifacts: [buildArtifact],
    artifactAttestations: [attestation],
    environmentBindings: [],
    deploymentRequests: [],
    deploymentPlans: [],
    deploymentApprovalDecisions: [],
    deploymentAttempts: [],
    providerReceipts: [],
    deploymentReceipts: [],
    launchEvidence: [],
  });
  if (!contractValidation.success) {
    throw new Error(`deployment contract set is invalid: ${contractValidation.issues.join("; ")}`);
  }

  if (attestation.artifactDigest !== manifest.artifact.ociManifestDigest) {
    throw new Error("artifact digest does not match the exact OCI manifest digest");
  }
  if (
    attestation.artifact.digest !== buildArtifact.digest ||
    attestation.artifact.id !== buildArtifact.id
  ) {
    throw new Error("build artifact reference does not match the emitted build artifact");
  }
  if (
    buildArtifact.artifactDigest !== manifest.artifact.ociManifestDigest ||
    buildArtifact.repositoryCommitSha !== manifest.source.commitSha ||
    buildArtifact.repositoryTreeSha !== manifest.source.treeSha
  ) {
    throw new Error("build artifact is not bound to the candidate source and artifact digest");
  }
  if (
    buildArtifact.sourceCandidate.digest !== sourceCandidate.digest ||
    buildArtifact.sourceCandidate.id !== sourceCandidate.id
  ) {
    throw new Error("build artifact source reference does not match the verified source candidate");
  }
  if (
    sourceCandidate.commitSha !== manifest.source.commitSha ||
    sourceCandidate.treeSha !== manifest.source.treeSha ||
    sourceCandidate.status !== "verified"
  ) {
    throw new Error("source candidate is not verified for the exact candidate source");
  }
  if (
    !buildArtifact.buildRun.evidenceRefs.some(
      (reference) => reference.sha256 === machineManifestSha256,
    )
  ) {
    throw new Error("build run does not reference the exact machine manifest");
  }
  if (
    !buildArtifact.signatureRefs.some((reference) => reference.sha256 === bundleSha256)
  ) {
    throw new Error("build artifact does not reference the verified signature bundle");
  }
  if (
    !buildArtifact.scanRefs.some(
      (reference) => reference.sha256 === manifest.scan.reportSha256,
    )
  ) {
    throw new Error("build artifact does not reference the exact scan report");
  }
  if (attestation.signatureRef.sha256 !== bundleSha256) {
    throw new Error("signature bundle digest does not match the verified bundle");
  }
  if (attestation.expiresAt !== manifest.expiresAt) {
    throw new Error("attestation expiry does not match the candidate expiry");
  }
  if (attestation.policyResult !== "passed") {
    throw new Error("attestation policy did not pass");
  }
  return attestation;
}

async function sha256File(path: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function requiredFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (!value) throw new Error(`missing required flag --${name}`);
  return value;
}

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`expected --name value pair, received ${flag ?? "<end>"}`);
    }
    flags.set(flag.slice(2), value);
  }
  return flags;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function generateManifest(flags: Map<string, string>): Promise<void> {
  const ociLayout = requiredFlag(flags, "oci-layout");
  const ociArchive = requiredFlag(flags, "oci-archive");
  const trivyReport = requiredFlag(flags, "trivy-report");
  const output = requiredFlag(flags, "output");
  const index = z
    .object({
      manifests: z
        .array(
          z.object({
            mediaType: z.string(),
            digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          }),
        )
        .min(1),
    })
    .parse(readJson(join(ociLayout, "index.json")));
  const descriptor = index.manifests.find(
    (entry) => entry.mediaType === "application/vnd.oci.image.manifest.v1+json",
  );
  if (!descriptor) throw new Error("OCI layout does not contain an image manifest descriptor");
  const ociManifestDigest = descriptor.digest.slice("sha256:".length);
  const blobPath = join(ociLayout, "blobs", "sha256", ociManifestDigest);
  if ((await sha256File(blobPath)) !== ociManifestDigest) {
    throw new Error("OCI manifest blob digest does not match index descriptor");
  }

  const trivy = z
    .object({
      Results: z
        .array(
          z.object({
            Vulnerabilities: z
              .array(z.object({ Severity: z.string() }).passthrough())
              .optional(),
          }).passthrough(),
        )
        .optional(),
    })
    .passthrough()
    .parse(readJson(trivyReport));
  const vulnerabilities = trivy.Results?.flatMap((result) => result.Vulnerabilities ?? []) ?? [];
  const critical = vulnerabilities.filter((finding) => finding.Severity === "CRITICAL").length;
  const high = vulnerabilities.filter((finding) => finding.Severity === "HIGH").length;

  const manifest = CandidateManifestSchema.parse({
    schema: "hasna.todos.attested_container_candidate.v2",
    candidateKind: "comparison_only",
    project: {
      id: requiredFlag(flags, "project-id"),
      slug: requiredFlag(flags, "project-slug"),
      displayName: requiredFlag(flags, "project-name"),
      repository: requiredFlag(flags, "project-repository"),
    },
    source: {
      repository: requiredFlag(flags, "repository"),
      commitSha: requiredFlag(flags, "source-sha"),
      treeSha: requiredFlag(flags, "tree-sha"),
    },
    dependencyLock: {
      path: "bun.lock",
      sha256: await sha256File("bun.lock"),
    },
    artifact: {
      mediaType: descriptor.mediaType,
      ociLayoutPath: "todos-candidate.oci-layout",
      ociArchivePath: "todos-candidate.oci.tar",
      ociManifestDigest,
      ociArchiveSha256: await sha256File(ociArchive),
      platform: "linux/arm64",
      pushed: false,
      deployed: false,
    },
    run: {
      repository: requiredFlag(flags, "repository"),
      workflow: ".github/workflows/attested-container-candidate.yml",
      runId: requiredFlag(flags, "run-id"),
      runAttempt: requiredFlag(flags, "run-attempt"),
      runnerImage: "ubuntu-24.04-arm",
    },
    gates: {
      frozenInstall: "passed",
      typecheck: "passed",
      tests: "passed",
      build: "passed",
      noCloud: "passed",
      scan: "passed",
    },
    scan: {
      engine: "trivy",
      reportPath: "todos-candidate.trivy.json",
      reportSha256: await sha256File(trivyReport),
      critical,
      high,
    },
    createdAt: requiredFlag(flags, "created-at"),
    expiresAt: requiredFlag(flags, "expires-at"),
  });

  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function finalizeAttestation(flags: Map<string, string>): Promise<void> {
  const manifestPath = requiredFlag(flags, "manifest");
  const bundlePath = requiredFlag(flags, "bundle");
  const verificationPath = requiredFlag(flags, "verification");
  const productOutput = requiredFlag(flags, "product-output");
  const intentOutput = requiredFlag(flags, "intent-output");
  const sourceOutput = requiredFlag(flags, "source-output");
  const artifactOutput = requiredFlag(flags, "artifact-output");
  const output = requiredFlag(flags, "output");
  const manifest = CandidateManifestSchema.parse(readJson(manifestPath));
  const machineManifestSha256 = await sha256File(manifestPath);
  const bundleSha256 = await sha256File(bundlePath);
  const finishedAt = requiredFlag(flags, "created-at");
  const verificationSha256 = await sha256File(verificationPath);
  const sourceRecords = createSourceRecords({
    manifest,
    machineManifestSha256,
    verificationSha256,
    finishedAt,
  });
  const buildArtifact = createBuildArtifact({
    manifest,
    sourceCandidate: sourceRecords.sourceCandidate,
    machineManifestSha256,
    bundleSha256,
    verificationSha256,
    finishedAt,
  });
  const attestation = createArtifactAttestation({
    manifest,
    buildArtifact,
    machineManifestSha256,
    bundleSha256,
    verificationSha256,
    attestationId: requiredFlag(flags, "attestation-id"),
    attestationUrl: requiredFlag(flags, "attestation-url"),
    createdAt: finishedAt,
  });
  writeFileSync(productOutput, `${JSON.stringify(sourceRecords.productProjection, null, 2)}\n`);
  writeFileSync(intentOutput, `${JSON.stringify(sourceRecords.intentSnapshot, null, 2)}\n`);
  writeFileSync(sourceOutput, `${JSON.stringify(sourceRecords.sourceCandidate, null, 2)}\n`);
  writeFileSync(artifactOutput, `${JSON.stringify(buildArtifact, null, 2)}\n`);
  writeFileSync(output, `${JSON.stringify(attestation, null, 2)}\n`);
}

async function verifyFiles(flags: Map<string, string>): Promise<void> {
  const manifestPath = requiredFlag(flags, "manifest");
  const productPath = requiredFlag(flags, "product");
  const intentPath = requiredFlag(flags, "intent");
  const sourcePath = requiredFlag(flags, "source");
  const attestationPath = requiredFlag(flags, "attestation");
  const artifactPath = requiredFlag(flags, "artifact");
  const bundlePath = requiredFlag(flags, "bundle");
  const manifest = CandidateManifestSchema.parse(readJson(manifestPath));
  const attestation = verifyCandidateChain({
    manifest,
    productProjection: readJson(productPath),
    intentSnapshot: readJson(intentPath),
    sourceCandidate: readJson(sourcePath),
    buildArtifact: readJson(artifactPath),
    attestation: readJson(attestationPath),
    machineManifestSha256: await sha256File(manifestPath),
    bundleSha256: await sha256File(bundlePath),
  });
  process.stdout.write(
    `VERIFIED artifact_digest=${attestation.artifactDigest} policy=${attestation.policyResult}\n`,
  );
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const flags = parseFlags(args);
  if (command === "manifest") return generateManifest(flags);
  if (command === "finalize") return finalizeAttestation(flags);
  if (command === "verify") return verifyFiles(flags);
  throw new Error(`unknown command ${command ?? "<missing>"}`);
}

if (import.meta.main) {
  await main();
}
