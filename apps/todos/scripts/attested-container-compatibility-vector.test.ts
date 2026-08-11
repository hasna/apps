import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { assertComparisonOnlySourceCandidate } from "./attested-container-compatibility-vector";

const root = join(import.meta.dir, "..");
const consumerCommitSha = "905d57bb845cf2f172b319cdd722656675c13630";
const temporaryRoots: string[] = [];

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function runVector(...args: string[]): string {
  return execFileSync(
    "bun",
    ["run", "scripts/attested-container-compatibility-vector.ts", ...args],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
}

function packagedEvidencePointers(value: unknown): Array<{
  uri: string;
  sha256: string;
}> {
  const pointers: Array<{ uri: string; sha256: string }> = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.uri === "string" &&
      record.uri.startsWith(
        "artifact://iapp-deployment-compatibility-vector/",
      ) &&
      typeof record.sha256 === "string"
    ) {
      pointers.push({
        uri: record.uri,
        sha256: record.sha256,
      });
    }
    for (const entry of Object.values(record)) visit(entry);
  };
  visit(value);
  return pointers;
}

afterEach(() => {
  for (const path of temporaryRoots.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

describe("public iapp-deployment compatibility vector", () => {
  test("emits and verifies five byte-described source records for the exact head and tree", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "todos-compatibility-vector-"));
    temporaryRoots.push(outputDir);
    const producerSha = git("rev-parse", "HEAD");
    const producerTree = git("rev-parse", "HEAD^{tree}");

    runVector(
      "emit",
      "--output-dir",
      outputDir,
      "--producer-sha",
      producerSha,
      "--producer-tree",
      producerTree,
      "--consumer-sha",
      consumerCommitSha,
    );
    const manifest = JSON.parse(
      readFileSync(join(outputDir, "vector-manifest.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      schema: "hasna.todos.iapp_deployment_compatibility_vector.v1",
      artifactName: `iapp-deployment-compatibility-${producerSha}`,
      producerRepository: "hasna/todos",
      producerCommitSha: producerSha,
      producerTreeSha: producerTree,
      consumerRepository: "hasnaxyz/iapp-deployment",
      consumerCommitSha,
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
        id: "wks_wdq8kp9rd8bq",
        slug: "hasna-todos",
        displayName: "@hasna/todos",
        repository: "hasna/todos",
      },
      fixtureInput: {
        path: "fixture-input.json",
      },
      checksumBundle: {
        path: "subject-checksums.txt",
        algorithm: "sha256",
        format: "sha256sum",
        scope: "source_records_only",
      },
      recordCount: 5,
    });
    expect(manifest.sourceRecords.map(
      (entry: Record<string, unknown>) => [entry.collection, entry.path],
    )).toEqual([
      ["productProjections", "product-projection.json"],
      ["intentSnapshots", "intent-snapshot.json"],
      ["verifiedSourceCandidates", "verified-source-candidate.json"],
      ["buildArtifacts", "build-artifact.json"],
      ["artifactAttestations", "artifact-attestation.json"],
    ]);
    for (const descriptor of manifest.sourceRecords) {
      const bytes = readFileSync(join(outputDir, descriptor.path));
      expect(bytes.byteLength).toBe(descriptor.bytes);
      expect(
        Bun.CryptoHasher.hash("sha256", bytes, "hex"),
      ).toBe(descriptor.sha256);
      expect(JSON.parse(bytes.toString("utf8")).digest)
        .toBe(descriptor.recordDigest);
      const serialized = bytes.toString("utf8");
      expect(serialized).not.toContain('"provider": "github"');
      expect(serialized).not.toContain("ubuntu-24.04-arm");
      expect(serialized).not.toContain("trivy");
      expect(serialized).not.toContain("slsa-provenance");
      expect(serialized).not.toContain(
        ".github/workflows/attested-container-candidate.yml",
      );
    }
    expect(readFileSync(join(outputDir, "subject-checksums.txt"), "utf8"))
      .toBe(
        manifest.sourceRecords
          .map(
            (descriptor: Record<string, unknown>) =>
              `${descriptor.sha256}  ${descriptor.path}`,
          )
          .join("\n")
          .concat("\n"),
      );
    expect(readdirSync(outputDir).sort()).toEqual([
      "artifact-attestation.json",
      "build-artifact.json",
      "fixture-input.json",
      "intent-snapshot.json",
      "product-projection.json",
      "subject-checksums.txt",
      "vector-manifest.json",
      "verified-source-candidate.json",
    ]);
    const candidate = JSON.parse(
      readFileSync(join(outputDir, "verified-source-candidate.json"), "utf8"),
    );
    expect(candidate.status).toBe("candidate");
    expect(candidate.results).toHaveLength(1);
    expect(candidate.results).toEqual([
      expect.objectContaining({
        id: "operational-adoption-evidence",
        kind: "policy",
        status: "not_run",
      }),
    ]);
    expect(() => assertComparisonOnlySourceCandidate(candidate)).not.toThrow();
    const buildArtifact = JSON.parse(
      readFileSync(join(outputDir, "build-artifact.json"), "utf8"),
    );
    expect(buildArtifact.status).toBe("revoked");
    expect(buildArtifact.provenanceRefs).toEqual([]);
    expect(buildArtifact.scanRefs).toEqual([]);
    expect(buildArtifact.signatureRefs).toEqual([]);
    const attestation = JSON.parse(
      readFileSync(join(outputDir, "artifact-attestation.json"), "utf8"),
    );
    expect(attestation.predicateKind).toBe("fixture-classification");
    expect(attestation.issuer.provider).toBe("test-fixture");
    expect(() =>
      runVector(
        "verify",
        "--root",
        outputDir,
        "--producer-sha",
        producerSha,
        "--producer-tree",
        producerTree,
        "--consumer-sha",
        consumerCommitSha,
      ),
    ).not.toThrow();
  });

  test("emits byte-identical bundles for the same producer and consumer inputs", () => {
    const firstDir = mkdtempSync(join(tmpdir(), "todos-compatibility-vector-"));
    const secondDir = mkdtempSync(join(tmpdir(), "todos-compatibility-vector-"));
    temporaryRoots.push(firstDir, secondDir);
    const producerSha = git("rev-parse", "HEAD");
    const producerTree = git("rev-parse", "HEAD^{tree}");

    for (const outputDir of [firstDir, secondDir]) {
      runVector(
        "emit",
        "--output-dir",
        outputDir,
        "--producer-sha",
        producerSha,
        "--producer-tree",
        producerTree,
        "--consumer-sha",
        consumerCommitSha,
      );
    }

    for (const path of readdirSync(firstDir).sort()) {
      expect(readFileSync(join(firstDir, path)))
        .toEqual(readFileSync(join(secondDir, path)));
    }
  });

  test("binds named packaged evidence to the exact file bytes", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "todos-compatibility-vector-"));
    temporaryRoots.push(outputDir);
    const producerSha = git("rev-parse", "HEAD");
    const producerTree = git("rev-parse", "HEAD^{tree}");

    runVector(
      "emit",
      "--output-dir",
      outputDir,
      "--producer-sha",
      producerSha,
      "--producer-tree",
      producerTree,
      "--consumer-sha",
      consumerCommitSha,
    );

    const pointers = [
      "product-projection.json",
      "intent-snapshot.json",
      "verified-source-candidate.json",
      "build-artifact.json",
      "artifact-attestation.json",
    ].flatMap((path) =>
      packagedEvidencePointers(
        JSON.parse(readFileSync(join(outputDir, path), "utf8")),
      ),
    );
    expect(pointers.length).toBeGreaterThan(0);
    for (const pointer of pointers) {
      const path = pointer.uri.split("/").at(-1)!;
      expect(pointer.sha256).toBe(
        Bun.CryptoHasher.hash(
          "sha256",
          readFileSync(join(outputDir, path)),
          "hex",
        ),
      );
    }
    const intent = JSON.parse(
      readFileSync(join(outputDir, "intent-snapshot.json"), "utf8"),
    );
    expect(intent.intentDocument.digest).toBe(
      Bun.CryptoHasher.hash(
        "sha256",
        readFileSync(join(outputDir, intent.intentDocument.path)),
        "hex",
      ),
    );
  });

  test("rejects byte tampering before the vector can be consumed", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "todos-compatibility-vector-"));
    temporaryRoots.push(outputDir);
    const producerSha = git("rev-parse", "HEAD");
    const producerTree = git("rev-parse", "HEAD^{tree}");
    runVector(
      "emit",
      "--output-dir",
      outputDir,
      "--producer-sha",
      producerSha,
      "--producer-tree",
      producerTree,
      "--consumer-sha",
      consumerCommitSha,
    );
    appendFileSync(join(outputDir, "product-projection.json"), "\n");

    expect(() =>
      runVector(
        "verify",
        "--root",
        outputDir,
        "--producer-sha",
        producerSha,
        "--producer-tree",
        producerTree,
        "--consumer-sha",
        consumerCommitSha,
      ),
    ).toThrow();
  });

  test("rejects additional VerifiedSourceCandidate results", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "todos-compatibility-vector-"));
    temporaryRoots.push(outputDir);
    const producerSha = git("rev-parse", "HEAD");
    const producerTree = git("rev-parse", "HEAD^{tree}");
    runVector(
      "emit",
      "--output-dir",
      outputDir,
      "--producer-sha",
      producerSha,
      "--producer-tree",
      producerTree,
      "--consumer-sha",
      consumerCommitSha,
    );
    const candidate = JSON.parse(
      readFileSync(join(outputDir, "verified-source-candidate.json"), "utf8"),
    );
    candidate.results.push({
      ...candidate.results[0],
      id: "contract-shape",
      kind: "test",
      status: "passed",
    });

    expect(() => assertComparisonOnlySourceCandidate(candidate)).toThrow(
      "exactly one operational-adoption-evidence policy result",
    );
  });

  test("rejects a consumer SHA other than the frozen consumer", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "todos-compatibility-vector-"));
    temporaryRoots.push(outputDir);
    const producerSha = git("rev-parse", "HEAD");
    const producerTree = git("rev-parse", "HEAD^{tree}");

    expect(() =>
      runVector(
        "emit",
        "--output-dir",
        outputDir,
        "--producer-sha",
        producerSha,
        "--producer-tree",
        producerTree,
        "--consumer-sha",
        "75d931c065c7564cbf55137d6cc32e9f35bd6a88",
      ),
    ).toThrow();
  });

  test("defines a public exact-head workflow without private consumer access", () => {
    const workflow = readFileSync(
      join(root, ".github/workflows/iapp-deployment-compatibility-vector.yml"),
      "utf8",
    );
    expect(workflow).toContain(
      "PRODUCER_SHA: ${{ github.event.pull_request.head.sha }}",
    );
    expect(workflow).toContain(`CONSUMER_SHA: ${consumerCommitSha}`);
    expect(workflow).toContain('--consumer-sha "${CONSUMER_SHA}"');
    expect(workflow).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("subject-checksums.txt");
    expect(workflow).toContain("artifact-digest");
    expect(workflow).toContain("GITHUB_RUN_ID");
    expect(workflow).not.toContain("id-token: write");
    expect(workflow).not.toContain("attestations: write");
    expect(workflow).not.toContain("attest-build-provenance");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("hasnaxyz/iapp-deployment.git");
    expect(workflow).not.toMatch(/\baws\b/i);
    const actionRefs = [
      ...workflow.matchAll(/^\s+uses:\s+([^\s#]+)(?:\s+#.*)?$/gm),
    ].map((match) => match[1]!);
    expect(actionRefs).toHaveLength(3);
    for (const actionRef of actionRefs) {
      expect(actionRef).toMatch(
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/,
      );
    }
  });
});
