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

type DeploymentFixtures = ReturnType<typeof createDeploymentFixtureSet>;

function recomputePlanDownstream(
  fixtures: DeploymentFixtures,
  deploymentPlan: DeploymentFixtures["deploymentPlan"],
  approvalDraft = clone(fixtures.deploymentApprovalDecision),
) {
  approvalDraft.plan = {
    schema: deploymentPlan.schema,
    id: deploymentPlan.id,
    digest: deploymentPlan.digest,
  };
  const planBinding = approvalDraft.boundInputDigests.find(
    (binding) => binding.kind === "plan",
  );
  if (!planBinding) {
    throw new Error("fixture approval is missing the plan digest binding");
  }
  planBinding.digest = deploymentPlan.digest;
  const deploymentApprovalDecision = DeploymentApprovalDecisionSchema.parse(
    redigest(approvalDraft),
  );

  const attemptDraft = clone(fixtures.deploymentAttempt);
  attemptDraft.plan = {
    schema: deploymentPlan.schema,
    id: deploymentPlan.id,
    digest: deploymentPlan.digest,
  };
  attemptDraft.approvals[0]!.decision = {
    schema: deploymentApprovalDecision.schema,
    id: deploymentApprovalDecision.id,
    digest: deploymentApprovalDecision.digest,
  };
  const deploymentAttempt = DeploymentAttemptSchema.parse(
    redigest(attemptDraft),
  );

  const providerReceiptDraft = clone(fixtures.providerReceipt);
  providerReceiptDraft.attempt = {
    schema: deploymentAttempt.schema,
    id: deploymentAttempt.id,
    revision: deploymentAttempt.revision,
    digest: deploymentAttempt.digest,
  };
  const providerReceipt = ProviderReceiptSchema.parse(
    redigest(providerReceiptDraft),
  );

  const receiptDraft = clone(fixtures.deploymentReceipt);
  receiptDraft.plan = {
    schema: deploymentPlan.schema,
    id: deploymentPlan.id,
    digest: deploymentPlan.digest,
  };
  receiptDraft.approvals = [{
    schema: deploymentApprovalDecision.schema,
    id: deploymentApprovalDecision.id,
    digest: deploymentApprovalDecision.digest,
  }];
  receiptDraft.attempt = {
    schema: deploymentAttempt.schema,
    id: deploymentAttempt.id,
    revision: deploymentAttempt.revision,
    digest: deploymentAttempt.digest,
  };
  receiptDraft.providerReceipts = [{
    schema: providerReceipt.schema,
    id: providerReceipt.id,
    digest: providerReceipt.digest,
  }];
  const deploymentReceipt = DeploymentReceiptSchema.parse(
    redigest(receiptDraft),
  );

  const launchDraft = clone(fixtures.launchEvidence);
  launchDraft.deploymentReceipt = {
    schema: deploymentReceipt.schema,
    id: deploymentReceipt.id,
    digest: deploymentReceipt.digest,
  };
  const launchEvidence = LaunchEvidenceSchema.parse(redigest(launchDraft));

  return {
    deploymentApprovalDecision,
    deploymentAttempt,
    providerReceipt,
    deploymentReceipt,
    launchEvidence,
  };
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

  test("recomputed downstream records cannot swap a required plan input for another request reference", () => {
    const fixtures = createDeploymentFixtureSet();
    const contractSet = deploymentFixtureSetToContractSet(fixtures);

    const planDraft = clone(fixtures.deploymentPlan);
    const inputIndex = planDraft.inputs.findIndex(
      (input) => input.schema === DEPLOYMENT_SCHEMA_IDS.intentSnapshot,
    );
    expect(inputIndex).toBeGreaterThanOrEqual(0);
    planDraft.inputs[inputIndex] = {
      schema: fixtures.artifactAttestation.schema,
      id: fixtures.artifactAttestation.id,
      digest: fixtures.artifactAttestation.digest,
    };
    const deploymentPlan = DeploymentPlanSchema.parse(redigest(planDraft));
    const downstream = recomputePlanDownstream(fixtures, deploymentPlan);

    contractSet.deploymentPlans = [deploymentPlan];
    contractSet.deploymentApprovalDecisions = [
      downstream.deploymentApprovalDecision,
    ];
    contractSet.deploymentAttempts = [downstream.deploymentAttempt];
    contractSet.providerReceipts = [downstream.providerReceipt];
    contractSet.deploymentReceipts = [downstream.deploymentReceipt];
    contractSet.launchEvidence = [downstream.launchEvidence];

    const result = validateDeploymentContractSet(runtimeSchemas, contractSet);
    expect(result.issues).toContain(
      `deploymentPlans.${deploymentPlan.id}.inputs: input set does not exactly match linked request ${fixtures.deploymentRequest.id}`,
    );
  });

  test("recomputed downstream records cannot bind an approval kind to another lineage digest", () => {
    const fixtures = createDeploymentFixtureSet();
    const contractSet = deploymentFixtureSetToContractSet(fixtures);

    const approvalDraft = clone(fixtures.deploymentApprovalDecision);
    const bindingIndex = approvalDraft.boundInputDigests.findIndex(
      (binding) => binding.kind === "intent",
    );
    expect(bindingIndex).toBeGreaterThanOrEqual(0);
    approvalDraft.boundInputDigests[bindingIndex]!.digest =
      fixtures.deploymentPlan.digest;
    const downstream = recomputePlanDownstream(
      fixtures,
      fixtures.deploymentPlan,
      approvalDraft,
    );

    contractSet.deploymentApprovalDecisions = [
      downstream.deploymentApprovalDecision,
    ];
    contractSet.deploymentAttempts = [downstream.deploymentAttempt];
    contractSet.providerReceipts = [downstream.providerReceipt];
    contractSet.deploymentReceipts = [downstream.deploymentReceipt];
    contractSet.launchEvidence = [downstream.launchEvidence];

    const result = validateDeploymentContractSet(runtimeSchemas, contractSet);
    expect(result.issues).toContain(
      `deploymentApprovalDecisions.${downstream.deploymentApprovalDecision.id}.boundInputDigests.${bindingIndex}: intent digest does not match linked plan lineage`,
    );
  });

  test("recomputed downstream records cannot substitute a receipt intent", () => {
    const fixtures = createDeploymentFixtureSet();
    const contractSet = deploymentFixtureSetToContractSet(fixtures);
    const alternateIntent = IntentSnapshotSchema.parse(redigest({
      ...clone(fixtures.intentSnapshot),
      id: "intent-snapshot-receipt-substitute",
    }));
    contractSet.intentSnapshots.push(alternateIntent);

    const receiptDraft = clone(fixtures.deploymentReceipt);
    receiptDraft.intent = {
      schema: alternateIntent.schema,
      id: alternateIntent.id,
      digest: alternateIntent.digest,
    };
    const deploymentReceipt = DeploymentReceiptSchema.parse(
      redigest(receiptDraft),
    );
    const launchDraft = clone(fixtures.launchEvidence);
    launchDraft.deploymentReceipt = {
      schema: deploymentReceipt.schema,
      id: deploymentReceipt.id,
      digest: deploymentReceipt.digest,
    };
    const launchEvidence = LaunchEvidenceSchema.parse(redigest(launchDraft));

    contractSet.deploymentReceipts = [deploymentReceipt];
    contractSet.launchEvidence = [launchEvidence];

    const result = validateDeploymentContractSet(runtimeSchemas, contractSet);
    expect(result.issues).toContain(
      `deploymentReceipts.${deploymentReceipt.id}.intent: reference does not match linked request intent`,
    );
  });
});
