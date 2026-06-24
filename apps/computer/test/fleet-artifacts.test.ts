import { describe, expect, test } from "bun:test";
import {
  FLEET_ARTIFACT_DEFAULT_MAX_BYTES,
  FLEET_ARTIFACT_HARD_MAX_BYTES,
  artifactIdHash,
  authorizeAndPullFleetArtifact,
  evaluateFleetArtifactPullContract,
  fleetArtifactTokenClaims,
  isSensitiveFleetArtifactId,
  normalizeFleetArtifactPullInput,
  validateFleetArtifactPullResult,
} from "../src/agent/fleet-artifacts.js";

const BASE_PULL = {
  machineId: "machine-sensitive-001",
  action: "pull_artifact" as const,
  artifactId: "reports/result.json",
};

describe("fleet artifact pull contract", () => {
  test("allows hash-only approved-namespace metadata pulls by default", () => {
    const result = evaluateFleetArtifactPullContract(BASE_PULL);

    expect(result.status).toBe("allowed");
    expect(result.metadata).toEqual(expect.objectContaining({
      artifact_namespace: "reports",
      hash_only: true,
      materializes_bytes: false,
      max_bytes: FLEET_ARTIFACT_DEFAULT_MAX_BYTES,
    }));
    expect(JSON.stringify(result.metadata)).not.toContain(BASE_PULL.artifactId);
    expect(JSON.stringify(result.metadata)).not.toContain(BASE_PULL.machineId);
  });

  test("blocks unapproved namespaces, traversal, private names, source scopes, and oversized pulls", () => {
    expect(evaluateFleetArtifactPullContract({ ...BASE_PULL, artifactId: "ssh/id_rsa" }).reason)
      .toContain("approved evidence namespace");
    expect(evaluateFleetArtifactPullContract({ ...BASE_PULL, artifactId: "reports/../secret.txt" }).reason)
      .toContain("normalized");
    expect(evaluateFleetArtifactPullContract({ ...BASE_PULL, artifactId: "reports/" }).reason)
      .toContain("normalized");
    expect(evaluateFleetArtifactPullContract({ ...BASE_PULL, artifactId: "reports//x" }).reason)
      .toContain("normalized");
    expect(evaluateFleetArtifactPullContract({ ...BASE_PULL, artifactId: "reports/a:b" }).reason)
      .toContain("normalized");
    expect(evaluateFleetArtifactPullContract({ ...BASE_PULL, artifactId: "reports/a@b" }).reason)
      .toContain("normalized");
    expect(evaluateFleetArtifactPullContract({ ...BASE_PULL, artifactId: "screenshots/.ssh/id_rsa" }).reason)
      .toContain("normalized");
    expect(evaluateFleetArtifactPullContract({ ...BASE_PULL, sourceScope: "filesystem" }).reason)
      .toContain("source scope");
    expect(evaluateFleetArtifactPullContract({ ...BASE_PULL, maxBytes: FLEET_ARTIFACT_HARD_MAX_BYTES + 1 }).reason)
      .toContain("maxBytes");

    expect(isSensitiveFleetArtifactId("reports/private-token.txt")).toBe(true);
    expect(isSensitiveFleetArtifactId("smoke/report.json")).toBe(false);
  });

  test("builds artifact-scoped token claims without raw audit metadata", () => {
    const claims = fleetArtifactTokenClaims({
      ...BASE_PULL,
      mode: "materialize",
      sourceScope: "fleet_evidence",
      maxBytes: 4096,
      expectedSha256: "d".repeat(64),
    });

    expect(claims).toEqual({
      artifactIdHash: artifactIdHash(BASE_PULL.artifactId),
      namespace: "reports",
      sourceScope: "fleet_evidence",
      mode: "materialize",
      maxBytes: 4096,
      expectedSha256: "d".repeat(64),
    });
    expect(fleetArtifactTokenClaims({ ...BASE_PULL, artifactId: "reports/" })).toBeUndefined();
  });

  test("requires matching materialized-pull approval and expected digest", () => {
    const expectedSha256 = "b".repeat(64);
    const materialize = {
      ...BASE_PULL,
      mode: "materialize" as const,
      expectedSha256,
      sourceScope: "run_artifact" as const,
      maxBytes: 1024,
    };

    expect(evaluateFleetArtifactPullContract({ ...BASE_PULL, mode: "materialize" }).reason)
      .toContain("expected sha256");
    expect(evaluateFleetArtifactPullContract(materialize).status).toBe("requires_confirmation");

    const mismatchedApproval = evaluateFleetArtifactPullContract(materialize, {
      materializeApproval: {
        approved: true,
        machineId: materialize.machineId,
        artifactId: materialize.artifactId,
        sourceScope: materialize.sourceScope,
        expectedSha256: "c".repeat(64),
        maxBytes: materialize.maxBytes,
      },
    });
    expect(mismatchedApproval.status).toBe("blocked");
    expect(mismatchedApproval.reason).toContain("does not match");

    const approved = evaluateFleetArtifactPullContract(materialize, {
      materializeApproval: {
        approved: true,
        machineId: materialize.machineId,
        artifactId: materialize.artifactId,
        sourceScope: materialize.sourceScope,
        expectedSha256,
        maxBytes: materialize.maxBytes,
      },
    });
    expect(approved.status).toBe("allowed");
    expect(approved.metadata).toEqual(expect.objectContaining({
      hash_only: false,
      materializes_bytes: true,
      materialize_approval_present: true,
      materialize_approval_bound: true,
    }));
  });

  test("executor wrapper refuses unsafe pulls before adapter and validates hash-only results", async () => {
    let calls = 0;
    const executor = {
      pullArtifact: async (input: ReturnType<typeof normalizeFleetArtifactPullInput>) => {
        calls++;
        return {
          machineId: input.machineId,
          artifactId: input.artifactId,
          sourceScope: input.sourceScope,
          sha256: "e".repeat(64),
          bytes: 128,
          mediaType: "application/json",
        };
      },
    };

    await expect(authorizeAndPullFleetArtifact({ ...BASE_PULL, artifactId: "reports/.env" }, { executor }))
      .rejects.toThrow("normalized approved-namespace");
    expect(calls).toBe(0);

    const result = await authorizeAndPullFleetArtifact({ ...BASE_PULL, maxBytes: 1024 }, { executor });
    expect(calls).toBe(1);
    expect(result).toEqual(expect.objectContaining({
      contractVersion: "open-computer.fleet.pull_artifact.result.v1",
      status: "hash_recorded",
      artifactIdHash: artifactIdHash(BASE_PULL.artifactId),
      namespace: "reports",
      sha256: "e".repeat(64),
      bytes: 128,
      materialization: { mode: "hash_only" },
    }));
  });

  test("executor result validation rejects oversized, mismatched digest, and unredacted materialization", () => {
    const request = normalizeFleetArtifactPullInput({
      ...BASE_PULL,
      mode: "materialize",
      expectedSha256: "f".repeat(64),
      maxBytes: 10,
    });

    expect(() => validateFleetArtifactPullResult(request, {
      machineId: request.machineId,
      artifactId: request.artifactId,
      sourceScope: request.sourceScope,
      sha256: "f".repeat(64),
      bytes: 11,
      localPath: "/managed/artifact.json",
      redaction: { state: "redacted" },
    })).toThrow("maxBytes");

    expect(() => validateFleetArtifactPullResult(request, {
      machineId: request.machineId,
      artifactId: request.artifactId,
      sourceScope: request.sourceScope,
      sha256: "0".repeat(64),
      bytes: 10,
      localPath: "/managed/artifact.json",
      redaction: { state: "redacted" },
    })).toThrow("digest");

    expect(() => validateFleetArtifactPullResult(request, {
      machineId: request.machineId,
      artifactId: request.artifactId,
      sourceScope: request.sourceScope,
      sha256: "f".repeat(64),
      bytes: 10,
      localPath: "/managed/artifact.json",
      redaction: { state: "hash_only" },
    })).toThrow("redacted");
  });
});
