import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BuildArtifactSchema,
  VerifiedSourceCandidateSchema,
  withDeploymentRecordDigest,
} from "hasna-deployment-contracts/deployment";
import {
  CandidateManifestSchema,
  createArtifactAttestation,
  createBuildArtifact,
  createSourceRecords,
  verifyCandidateChain,
  type CandidateManifest,
} from "./attested-container-candidate";

const root = join(import.meta.dir, "..");

const digest = (value: string) => Bun.CryptoHasher.hash("sha256", value, "hex");

function fixtureManifest(): CandidateManifest {
  return CandidateManifestSchema.parse({
    schema: "hasna.todos.attested_container_candidate.v1",
    candidateKind: "comparison_only",
    source: {
      repository: "hasna/todos",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      treeSha: "89abcdef0123456789abcdef0123456789abcdef",
    },
    dependencyLock: {
      path: "bun.lock",
      sha256: digest("lock"),
    },
    artifact: {
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      ociLayoutPath: "todos-candidate.oci-layout",
      ociArchivePath: "todos-candidate.oci.tar",
      ociManifestDigest: digest("oci-manifest"),
      ociArchiveSha256: digest("oci-archive"),
      platform: "linux/arm64",
      pushed: false,
      deployed: false,
    },
    run: {
      repository: "hasna/todos",
      workflow: ".github/workflows/attested-container-candidate.yml",
      runId: "123456789",
      runAttempt: "1",
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
      reportSha256: digest("scan"),
      critical: 0,
      high: 0,
    },
    createdAt: "2026-08-10T15:00:00.000Z",
    expiresAt: "2026-08-17T15:00:00.000Z",
  });
}

function fixtureChain() {
  const manifest = fixtureManifest();
  const bundleSha256 = digest("sigstore-bundle");
  const machineManifestSha256 = digest(JSON.stringify(manifest));
  const verificationSha256 = digest("verification");
  const finishedAt = "2026-08-10T15:05:00.000Z";
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
    attestationId: "artifact-attestation-123",
    attestationUrl: "https://github.com/hasna/todos/attestations/123",
    createdAt: finishedAt,
  });
  return {
    manifest,
    machineManifestSha256,
    bundleSha256,
    sourceRecords,
    buildArtifact,
    attestation,
  };
}

describe("attested no-push container candidate", () => {
  test("accepts a target-bound ArtifactAttestation for the exact OCI digest", () => {
    const {
      manifest,
      machineManifestSha256,
      bundleSha256,
      sourceRecords,
      buildArtifact,
      attestation,
    } = fixtureChain();

    expect(
      verifyCandidateChain({
        manifest,
        productProjection: sourceRecords.productProjection,
        intentSnapshot: sourceRecords.intentSnapshot,
        sourceCandidate: sourceRecords.sourceCandidate,
        buildArtifact,
        attestation,
        machineManifestSha256,
        bundleSha256,
      }).artifactDigest,
    ).toBe(manifest.artifact.ociManifestDigest);
  });

  test("rejects a tampered OCI digest and a tampered signature bundle", () => {
    const {
      manifest,
      machineManifestSha256,
      bundleSha256,
      sourceRecords,
      buildArtifact,
      attestation,
    } = fixtureChain();

    expect(() =>
      verifyCandidateChain({
        manifest: {
          ...manifest,
          artifact: {
            ...manifest.artifact,
            ociManifestDigest: digest("tampered-oci-manifest"),
          },
        },
        productProjection: sourceRecords.productProjection,
        intentSnapshot: sourceRecords.intentSnapshot,
        sourceCandidate: sourceRecords.sourceCandidate,
        buildArtifact,
        attestation,
        machineManifestSha256,
        bundleSha256,
      }),
    ).toThrow("artifact digest");

    expect(() =>
      verifyCandidateChain({
        manifest,
        productProjection: sourceRecords.productProjection,
        intentSnapshot: sourceRecords.intentSnapshot,
        sourceCandidate: sourceRecords.sourceCandidate,
        buildArtifact,
        attestation,
        machineManifestSha256,
        bundleSha256: digest("tampered-bundle"),
      }),
    ).toThrow("signature bundle");
  });

  test("rejects a missing or digest-mismatched VerifiedSourceCandidate link", () => {
    const {
      manifest,
      machineManifestSha256,
      bundleSha256,
      sourceRecords,
      buildArtifact,
      attestation,
    } = fixtureChain();
    const { digest: _sourceDigest, ...sourceCandidateWithoutDigest } =
      sourceRecords.sourceCandidate;
    const alternativeSourceCandidate = VerifiedSourceCandidateSchema.parse(
      withDeploymentRecordDigest({
        ...sourceCandidateWithoutDigest,
        id: "todos-source-other",
      }),
    );

    expect(() =>
      verifyCandidateChain({
        manifest,
        productProjection: sourceRecords.productProjection,
        intentSnapshot: sourceRecords.intentSnapshot,
        sourceCandidate: alternativeSourceCandidate,
        buildArtifact,
        attestation,
        machineManifestSha256,
        bundleSha256,
      }),
    ).toThrow(`buildArtifacts.${buildArtifact.id}.sourceCandidate: missing linked record`);

    const { digest: _artifactDigest, ...buildArtifactWithoutDigest } = buildArtifact;
    const mismatchedBuildArtifact = BuildArtifactSchema.parse(
      withDeploymentRecordDigest({
        ...buildArtifactWithoutDigest,
        sourceCandidate: {
          ...buildArtifact.sourceCandidate,
          digest: digest("different-source-candidate"),
        },
      }),
    );

    expect(() =>
      verifyCandidateChain({
        manifest,
        productProjection: sourceRecords.productProjection,
        intentSnapshot: sourceRecords.intentSnapshot,
        sourceCandidate: sourceRecords.sourceCandidate,
        buildArtifact: mismatchedBuildArtifact,
        attestation,
        machineManifestSha256,
        bundleSha256,
      }),
    ).toThrow(`buildArtifacts.${buildArtifact.id}.sourceCandidate: digest mismatch`);
  });

  test("defines an exact-main, immutable-pinned, finite, no-push hosted workflow", () => {
    const workflow = readFileSync(
      join(root, ".github/workflows/attested-container-candidate.yml"),
      "utf8",
    );

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("attestations: write");
    expect(workflow).not.toContain("packages: write");
    expect(workflow).toContain(
      "actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a",
    );
    expect(workflow).toContain("push-to-registry: false");
    expect(workflow).toContain("--output type=oci");
    expect(workflow).toContain("input: ${{ env.OCI_LAYOUT }}");
    expect(workflow).not.toContain("input: ${{ env.OCI_ARCHIVE }}");
    const scanReportConsumers = [
      "SCAN_REPORT: todos-candidate.trivy.json",
      "output: ${{ env.SCAN_REPORT }}",
      '--trivy-report "${SCAN_REPORT}"',
      "report_sha=\"$(sha256sum \"${SCAN_REPORT}\" | cut -d ' ' -f 1)\"",
      "printf '%s  %s\\n' \"${report_sha}\" \"${SCAN_REPORT}\"",
    ];
    for (const consumer of scanReportConsumers) {
      expect(workflow).toContain(consumer);
    }
    expect([...workflow.matchAll(/\bSCAN_REPORT\b/g)]).toHaveLength(
      scanReportConsumers.length,
    );
    expect(workflow).not.toContain("TRIVY_REPORT:");
    expect(workflow).toContain('test "$(git rev-parse refs/remotes/origin/main)" = "${SOURCE_SHA}"');
    expect(workflow).toContain("gh attestation verify");
    expect(workflow).toContain("tampered");
    expect(workflow).toContain("todos-candidate.verified-source-candidate.json");
    expect(workflow).toContain('--source "${SOURCE_CANDIDATE_RECORD}"');
    expect(workflow).toContain("retention-days: 7");
    expect(workflow).not.toMatch(/\baws\b/i);
    expect(workflow).not.toMatch(/\becr\b/i);
    expect(workflow).not.toContain("docker push");
    expect(workflow).not.toContain("npm publish");
    const actionRefs = [...workflow.matchAll(/^\s+uses:\s+([^\s#]+)(?:\s+#.*)?$/gm)].map(
      (match) => match[1]!,
    );
    expect(actionRefs.length).toBe(6);
    for (const actionRef of actionRefs) {
      expect(actionRef).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/);
    }
  });
});
