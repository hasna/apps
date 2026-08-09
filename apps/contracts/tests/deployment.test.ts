import { describe, expect, test } from "bun:test";
import {
  ArtifactAttestationSchema,
  BuildArtifactSchema,
  ContractSchemaRegistry,
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
} from "../src/schemas";
import {
  DEPLOYMENT_SCHEMA_IDS,
  canonicalizeDeploymentValue,
  computeDeploymentRecordDigest,
  sha256DeploymentText,
  stableDeploymentJson,
  validateDeploymentContractSet,
  withDeploymentRecordDigest,
} from "../src/deployment";
import {
  createDeploymentFixtureSet,
  deploymentFixtureSetToContractSet,
  deploymentFixturesBySchemaId,
} from "../src/deployment-fixtures";

const runtimeSchemas = {
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

function clone<T>(value: T): T {
  return structuredClone(value);
}

function redigest<T extends Record<string, unknown>>(value: T): T {
  return withDeploymentRecordDigest(value) as T;
}

describe("deployment contract records", () => {
  test("all thirteen registered fixtures parse and retain canonical digests", () => {
    const fixtures = createDeploymentFixtureSet();
    const fixturesBySchemaId = deploymentFixturesBySchemaId(fixtures);
    const schemaIds = Object.values(DEPLOYMENT_SCHEMA_IDS);

    expect(schemaIds).toHaveLength(13);
    for (const schemaId of schemaIds) {
      const schema = ContractSchemaRegistry[schemaId];
      const fixture = fixturesBySchemaId[schemaId] as Record<string, unknown>;
      const parsed = schema.parse(fixture) as Record<string, unknown>;
      expect(parsed.digest).toBe(computeDeploymentRecordDigest(parsed));
    }
  });

  test("canonicalization is deterministic across object key order", () => {
    const left = {
      zeta: [3, { beta: true, alpha: "value" }],
      alpha: { second: 2, first: 1 },
    };
    const right = {
      alpha: { first: 1, second: 2 },
      zeta: [3, { alpha: "value", beta: true }],
    };

    expect(canonicalizeDeploymentValue(left)).toEqual(
      canonicalizeDeploymentValue(right),
    );
    expect(stableDeploymentJson(left)).toBe(stableDeploymentJson(right));
  });

  test("the complete linked fixture set passes cross-record validation", () => {
    const fixtures = createDeploymentFixtureSet();
    const result = validateDeploymentContractSet(
      runtimeSchemas,
      deploymentFixtureSetToContractSet(fixtures),
    );
    expect(result).toEqual({ success: true, issues: [] });
  });

  test("missing fields, unknown fields, and wrong schema versions are rejected", () => {
    const fixtures = createDeploymentFixtureSet();
    const missing = clone(fixtures.productProjection) as Record<string, unknown>;
    delete missing.id;
    expect(ProductProjectionSchema.safeParse(missing).success).toBe(false);

    const unknown = redigest({
      ...clone(fixtures.productProjection),
      unexpectedField: "not-registered",
    });
    expect(ProductProjectionSchema.safeParse(unknown).success).toBe(false);

    const wrongSchema = redigest({
      ...clone(fixtures.productProjection),
      schema: "hasna.product_projection.v2",
    });
    expect(ProductProjectionSchema.safeParse(wrongSchema).success).toBe(false);
  });

  test("duplicate semantic ids and non-finite numbers are rejected", () => {
    const fixtures = createDeploymentFixtureSet();
    const duplicateProcess = clone(fixtures.intentSnapshot);
    duplicateProcess.processes.push(clone(duplicateProcess.processes[0]!));
    expect(
      IntentSnapshotSchema.safeParse(redigest(duplicateProcess)).success,
    ).toBe(false);

    const nonFinite = clone(fixtures.intentSnapshot);
    nonFinite.processes[0]!.resources.cpuMillicores = Number.POSITIVE_INFINITY;
    expect(IntentSnapshotSchema.safeParse(nonFinite).success).toBe(false);
    expect(() => stableDeploymentJson(nonFinite)).toThrow(
      "rejects non-finite numbers",
    );
  });

  test("ambiguous timestamps are rejected", () => {
    const fixtures = createDeploymentFixtureSet();
    const ambiguous = clone(fixtures.productProjection);
    ambiguous.projectedAt = "2026-08-09T09:00:00";
    expect(
      ProductProjectionSchema.safeParse(redigest(ambiguous)).success,
    ).toBe(false);
  });

  test("secret-bearing values and executable strings are rejected recursively", () => {
    const fixtures = createDeploymentFixtureSet();
    const secretBearing = clone(fixtures.deploymentApprovalDecision);
    secretBearing.decision.reason =
      "api_key=abcdefghijklmnopqrstuvwxyz012345";
    expect(
      DeploymentApprovalDecisionSchema.safeParse(
        redigest(secretBearing),
      ).success,
    ).toBe(false);

    const executable = clone(fixtures.deploymentApprovalDecision);
    executable.decision.reason = "bash -c whoami";
    expect(
      DeploymentApprovalDecisionSchema.safeParse(redigest(executable)).success,
    ).toBe(false);
  });

  test("provider identity rejects mutable local UUIDs", () => {
    const fixtures = createDeploymentFixtureSet();
    const environment = clone(fixtures.environmentBinding);
    environment.providerIdentity.accountId =
      "123e4567-e89b-42d3-a456-426614174000";
    expect(
      EnvironmentBindingSchema.safeParse(redigest(environment)).success,
    ).toBe(false);

    const receipt = clone(fixtures.providerReceipt);
    receipt.providerIdentity.operationId =
      "123e4567-e89b-42d3-a456-426614174000";
    expect(ProviderReceiptSchema.safeParse(redigest(receipt)).success).toBe(
      false,
    );
  });

  test("duplicate cross-record semantic ids are rejected", () => {
    const fixtures = createDeploymentFixtureSet();
    const contractSet = deploymentFixtureSetToContractSet(fixtures);
    contractSet.productProjections.push(clone(fixtures.productProjection));
    const result = validateDeploymentContractSet(runtimeSchemas, contractSet);
    expect(result.success).toBe(false);
    expect(result.issues).toContain(
      `productProjections: duplicate semantic id ${fixtures.productProjection.id}`,
    );
  });

  test.each([
    "intent",
    "plan",
    "approval",
    "receipt",
  ] as const)("mismatched %s digests fail the linked-set gate", (kind) => {
    const fixtures = createDeploymentFixtureSet();
    const contractSet = deploymentFixtureSetToContractSet(fixtures);
    const wrongDigest = sha256DeploymentText(`wrong-${kind}-digest`);

    if (kind === "intent") {
      const request = clone(fixtures.deploymentRequest);
      request.intent.digest = wrongDigest;
      contractSet.deploymentRequests = [redigest(request)];
    } else if (kind === "plan") {
      const approval = clone(fixtures.deploymentApprovalDecision);
      approval.plan.digest = wrongDigest;
      contractSet.deploymentApprovalDecisions = [redigest(approval)];
    } else if (kind === "approval") {
      const attempt = clone(fixtures.deploymentAttempt);
      attempt.approvals[0]!.decision.digest = wrongDigest;
      contractSet.deploymentAttempts = [redigest(attempt)];
    } else {
      const launch = clone(fixtures.launchEvidence);
      launch.deploymentReceipt.digest = wrongDigest;
      contractSet.launchEvidence = [redigest(launch)];
    }

    const result = validateDeploymentContractSet(runtimeSchemas, contractSet);
    expect(result.success).toBe(false);
    expect(result.issues.some((issue) => issue.endsWith("digest mismatch"))).toBe(
      true,
    );
  });
});
