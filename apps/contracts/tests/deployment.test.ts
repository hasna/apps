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
  computeEnvironmentBindingEtag,
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

function recomputeAttemptDownstream(
  fixtures: DeploymentFixtures,
  deploymentAttemptDraft: DeploymentFixtures["deploymentAttempt"],
  options: {
    deploymentApprovalDecision?: DeploymentFixtures["deploymentApprovalDecision"];
    deploymentPlan?: DeploymentFixtures["deploymentPlan"];
    deploymentRequest?: DeploymentFixtures["deploymentRequest"];
    buildArtifact?: DeploymentFixtures["buildArtifact"];
    artifactAttestation?: DeploymentFixtures["artifactAttestation"];
    environmentBinding?: DeploymentFixtures["environmentBinding"];
    deploymentReceiptDraft?: DeploymentFixtures["deploymentReceipt"];
  } = {},
) {
  const deploymentApprovalDecision =
    options.deploymentApprovalDecision ?? fixtures.deploymentApprovalDecision;
  const deploymentPlan = options.deploymentPlan ?? fixtures.deploymentPlan;
  const deploymentRequest =
    options.deploymentRequest ?? fixtures.deploymentRequest;
  const buildArtifact = options.buildArtifact ?? fixtures.buildArtifact;
  const artifactAttestation =
    options.artifactAttestation ?? fixtures.artifactAttestation;
  const environmentBinding =
    options.environmentBinding ?? fixtures.environmentBinding;

  deploymentAttemptDraft.plan = {
    schema: deploymentPlan.schema,
    id: deploymentPlan.id,
    digest: deploymentPlan.digest,
  };
  deploymentAttemptDraft.approvals[0]!.decision = {
    schema: deploymentApprovalDecision.schema,
    id: deploymentApprovalDecision.id,
    digest: deploymentApprovalDecision.digest,
  };
  const deploymentAttempt = DeploymentAttemptSchema.parse(
    redigest(deploymentAttemptDraft),
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

  const receiptDraft = clone(
    options.deploymentReceiptDraft ?? fixtures.deploymentReceipt,
  );
  receiptDraft.request = {
    schema: deploymentRequest.schema,
    id: deploymentRequest.id,
    digest: deploymentRequest.digest,
  };
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
  receiptDraft.artifact = {
    schema: buildArtifact.schema,
    id: buildArtifact.id,
    digest: buildArtifact.digest,
  };
  receiptDraft.attestations = [{
    schema: artifactAttestation.schema,
    id: artifactAttestation.id,
    digest: artifactAttestation.digest,
  }];
  receiptDraft.environment = {
    schema: environmentBinding.schema,
    id: environmentBinding.id,
    revision: environmentBinding.revision,
    digest: environmentBinding.digest,
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
    deploymentAttempt,
    providerReceipt,
    deploymentReceipt,
    launchEvidence,
  };
}

function recomputePlanDownstream(
  fixtures: DeploymentFixtures,
  deploymentPlan: DeploymentFixtures["deploymentPlan"],
  approvalDraft = clone(fixtures.deploymentApprovalDecision),
  attemptDraft = clone(fixtures.deploymentAttempt),
  options: {
    deploymentRequest?: DeploymentFixtures["deploymentRequest"];
    buildArtifact?: DeploymentFixtures["buildArtifact"];
    artifactAttestation?: DeploymentFixtures["artifactAttestation"];
    environmentBinding?: DeploymentFixtures["environmentBinding"];
    deploymentReceiptDraft?: DeploymentFixtures["deploymentReceipt"];
  } = {},
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

  const downstream = recomputeAttemptDownstream(fixtures, attemptDraft, {
    deploymentApprovalDecision,
    deploymentPlan,
    ...options,
  });

  return {
    deploymentApprovalDecision,
    ...downstream,
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

  test.each([
    {
      name: "denied",
      mutate: (fixtures: DeploymentFixtures) => {
        const approval = clone(fixtures.deploymentApprovalDecision);
        approval.decision.status = "denied";
        return { approval };
      },
      expected: (fixtures: DeploymentFixtures) =>
        `deploymentAttempts.${fixtures.deploymentAttempt.id}.approvals.0.decision: linked approval decision is not allowed`,
    },
    {
      name: "expired before the attempt",
      mutate: (fixtures: DeploymentFixtures) => {
        const approval = clone(fixtures.deploymentApprovalDecision);
        approval.issuedAt = "2026-08-09T09:00:00.000Z";
        approval.expiresAt = "2026-08-09T09:05:00.000Z";
        return { approval };
      },
      expected: (fixtures: DeploymentFixtures) =>
        `deploymentAttempts.${fixtures.deploymentAttempt.id}.approvals.0.decision: linked approval expired before the attempt`,
    },
    {
      name: "bound to another environment",
      mutate: (fixtures: DeploymentFixtures) => {
        const environmentDraft = clone(fixtures.environmentBinding);
        environmentDraft.id = "environment-staging";
        environmentDraft.environment = {
          id: "staging",
          classification: "staging",
        };
        environmentDraft.etag = computeEnvironmentBindingEtag(
          environmentDraft.id,
          environmentDraft.revision,
        );
        const environment = EnvironmentBindingSchema.parse(
          redigest(environmentDraft),
        );
        const approval = clone(fixtures.deploymentApprovalDecision);
        approval.environment = {
          schema: environment.schema,
          id: environment.id,
          revision: environment.revision,
          digest: environment.digest,
        };
        return { approval, environment };
      },
      expected: (fixtures: DeploymentFixtures) =>
        `deploymentAttempts.${fixtures.deploymentAttempt.id}.approvals.0.decision: linked approval environment does not match plan request environment`,
    },
    {
      name: "outside its attempt range",
      mutate: (fixtures: DeploymentFixtures) => {
        const approval = clone(fixtures.deploymentApprovalDecision);
        const attempt = clone(fixtures.deploymentAttempt);
        attempt.attemptNumber = approval.attemptScope.maximum + 1;
        return { approval, attempt };
      },
      expected: (fixtures: DeploymentFixtures) =>
        `deploymentAttempts.${fixtures.deploymentAttempt.id}.approvals.0.decision: attempt number is outside linked approval scope`,
    },
    {
      name: "scope-mismatched",
      mutate: (fixtures: DeploymentFixtures) => {
        const approval = clone(fixtures.deploymentApprovalDecision);
        const attempt = clone(fixtures.deploymentAttempt);
        attempt.approvals[0] = {
          ...attempt.approvals[0]!,
          scope: "action",
          actionId: "apply-workload",
        };
        return { approval, attempt };
      },
      expected: (fixtures: DeploymentFixtures) =>
        `deploymentAttempts.${fixtures.deploymentAttempt.id}.approvals.0: approval scope does not match linked decision`,
    },
    {
      name: "missing a required lineage binding",
      mutate: (fixtures: DeploymentFixtures) => {
        const approval = clone(fixtures.deploymentApprovalDecision);
        approval.boundInputDigests = approval.boundInputDigests.filter(
          (binding) => binding.kind !== "intent",
        );
        return { approval };
      },
      expected: (fixtures: DeploymentFixtures) =>
        `deploymentApprovalDecisions.${fixtures.deploymentApprovalDecision.id}.boundInputDigests: missing required intent binding`,
    },
  ])("linked-set validation rejects a $name approval", ({ mutate, expected }) => {
    const fixtures = createDeploymentFixtureSet();
    const contractSet = deploymentFixtureSetToContractSet(fixtures);
    const mutation = mutate(fixtures) as {
      approval: DeploymentFixtures["deploymentApprovalDecision"];
      attempt?: DeploymentFixtures["deploymentAttempt"];
      environment?: DeploymentFixtures["environmentBinding"];
    };
    const downstream = recomputePlanDownstream(
      fixtures,
      fixtures.deploymentPlan,
      mutation.approval,
      mutation.attempt,
    );

    if (mutation.environment) {
      contractSet.environmentBindings.push(mutation.environment);
    }
    contractSet.deploymentApprovalDecisions = [
      downstream.deploymentApprovalDecision,
    ];
    contractSet.deploymentAttempts = [downstream.deploymentAttempt];
    contractSet.providerReceipts = [downstream.providerReceipt];
    contractSet.deploymentReceipts = [downstream.deploymentReceipt];
    contractSet.launchEvidence = [downstream.launchEvidence];

    const result = validateDeploymentContractSet(runtimeSchemas, contractSet);
    expect(result.issues).toContain(expected(fixtures));
  });

  test("attempt decision actors must match the linked approval actors", () => {
    const fixtures = createDeploymentFixtureSet();
    const contractSet = deploymentFixtureSetToContractSet(fixtures);
    const attemptDraft = clone(fixtures.deploymentAttempt);
    attemptDraft.decisionActors = [{
      kind: "agent",
      id: "unrelated-decision-actor",
      name: "Unrelated Decision Actor",
    }];
    const downstream = recomputeAttemptDownstream(fixtures, attemptDraft);

    contractSet.deploymentAttempts = [downstream.deploymentAttempt];
    contractSet.providerReceipts = [downstream.providerReceipt];
    contractSet.deploymentReceipts = [downstream.deploymentReceipt];
    contractSet.launchEvidence = [downstream.launchEvidence];

    const result = validateDeploymentContractSet(runtimeSchemas, contractSet);
    expect(result).toEqual({
      success: false,
      issues: [
        `deploymentAttempts.${downstream.deploymentAttempt.id}.decisionActors: decision actors do not match linked approval actors`,
      ],
    });
  });

  test("linked approval decisions without actors fail closed", () => {
    const fixtures = createDeploymentFixtureSet();
    const contractSet = deploymentFixtureSetToContractSet(fixtures);
    const approvalDraft = clone(fixtures.deploymentApprovalDecision);
    delete approvalDraft.decision.actor;
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
    expect(result).toEqual({
      success: false,
      issues: [
        `deploymentAttempts.${downstream.deploymentAttempt.id}.approvals.0.decision: linked approval decision is missing an actor`,
      ],
    });
  });

  test("action inputs must resolve to a linked deployment record", () => {
    const fixtures = createDeploymentFixtureSet();
    const contractSet = deploymentFixtureSetToContractSet(fixtures);
    const planDraft = clone(fixtures.deploymentPlan);
    planDraft.actions[0]!.inputs[0] = {
      schema: DEPLOYMENT_SCHEMA_IDS.buildArtifact,
      id: "artifact-missing-action-input",
      digest: sha256DeploymentText("artifact-missing-action-input"),
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
      `deploymentPlans.${deploymentPlan.id}.actions.0.inputs.0: missing linked record artifact-missing-action-input`,
    );
  });

  test("attempt action steps must exist in the linked deployment plan", () => {
    const fixtures = createDeploymentFixtureSet();
    const contractSet = deploymentFixtureSetToContractSet(fixtures);
    const attemptDraft = clone(fixtures.deploymentAttempt);
    attemptDraft.actionSteps[0]!.actionId = "unapproved-action";
    const downstream = recomputeAttemptDownstream(fixtures, attemptDraft);

    contractSet.deploymentAttempts = [downstream.deploymentAttempt];
    contractSet.providerReceipts = [downstream.providerReceipt];
    contractSet.deploymentReceipts = [downstream.deploymentReceipt];
    contractSet.launchEvidence = [downstream.launchEvidence];

    const result = validateDeploymentContractSet(runtimeSchemas, contractSet);
    expect(result).toEqual({
      success: false,
      issues: [
        `deploymentAttempts.${downstream.deploymentAttempt.id}.actionSteps.0.actionId: action is not present in linked deployment plan ${fixtures.deploymentPlan.id}`,
      ],
    });
  });

  test("a succeeded attempt must contain every linked deployment plan action", () => {
    const fixtures = createDeploymentFixtureSet();
    const contractSet = deploymentFixtureSetToContractSet(fixtures);
    const planDraft = clone(fixtures.deploymentPlan);
    const secondAction = clone(planDraft.actions[0]!);
    secondAction.id = "verify-workload";
    secondAction.dependsOn = ["apply-workload"];
    planDraft.actions.push(secondAction);
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
    expect(result).toEqual({
      success: false,
      issues: [
        `deploymentAttempts.${downstream.deploymentAttempt.id}.actionSteps: succeeded attempt is missing linked deployment plan actions`,
      ],
    });
  });

  test("a succeeded attempt cannot contain a failed action step", () => {
    const fixtures = createDeploymentFixtureSet();
    const contractSet = deploymentFixtureSetToContractSet(fixtures);
    const attemptDraft = clone(fixtures.deploymentAttempt);
    attemptDraft.actionSteps[0]!.state = "failed";
    const downstream = recomputeAttemptDownstream(fixtures, attemptDraft);

    contractSet.deploymentAttempts = [downstream.deploymentAttempt];
    contractSet.providerReceipts = [downstream.providerReceipt];
    contractSet.deploymentReceipts = [downstream.deploymentReceipt];
    contractSet.launchEvidence = [downstream.launchEvidence];

    const result = validateDeploymentContractSet(runtimeSchemas, contractSet);
    expect(result.issues).toContain(
      `deploymentAttempts.${downstream.deploymentAttempt.id}.state: succeeded attempt requires every action step to succeed`,
    );
  });

  test("launched evidence cannot point to a failed deployment receipt", () => {
    const fixtures = createDeploymentFixtureSet();
    const contractSet = deploymentFixtureSetToContractSet(fixtures);
    const receiptDraft = clone(fixtures.deploymentReceipt);
    receiptDraft.outcome = "failed";
    const downstream = recomputeAttemptDownstream(
      fixtures,
      clone(fixtures.deploymentAttempt),
      { deploymentReceiptDraft: receiptDraft },
    );

    contractSet.deploymentAttempts = [downstream.deploymentAttempt];
    contractSet.providerReceipts = [downstream.providerReceipt];
    contractSet.deploymentReceipts = [downstream.deploymentReceipt];
    contractSet.launchEvidence = [downstream.launchEvidence];

    const result = validateDeploymentContractSet(runtimeSchemas, contractSet);
    expect(result.issues).toContain(
      `launchEvidence.${downstream.launchEvidence.id}.deploymentReceipt: launched evidence requires a succeeded deployment receipt`,
    );
  });

  test("an active artifact cannot descend from a rejected source candidate", () => {
    const fixtures = createDeploymentFixtureSet();
    const contractSet = deploymentFixtureSetToContractSet(fixtures);

    const candidateDraft = clone(fixtures.verifiedSourceCandidate);
    candidateDraft.status = "rejected";
    const verifiedSourceCandidate = VerifiedSourceCandidateSchema.parse(
      redigest(candidateDraft),
    );

    const artifactDraft = clone(fixtures.buildArtifact);
    artifactDraft.sourceCandidate = {
      schema: verifiedSourceCandidate.schema,
      id: verifiedSourceCandidate.id,
      digest: verifiedSourceCandidate.digest,
    };
    const buildArtifact = BuildArtifactSchema.parse(redigest(artifactDraft));

    const attestationDraft = clone(fixtures.artifactAttestation);
    attestationDraft.artifact = {
      schema: buildArtifact.schema,
      id: buildArtifact.id,
      digest: buildArtifact.digest,
    };
    const artifactAttestation = ArtifactAttestationSchema.parse(
      redigest(attestationDraft),
    );

    const requestDraft = clone(fixtures.deploymentRequest);
    requestDraft.artifact = {
      schema: buildArtifact.schema,
      id: buildArtifact.id,
      digest: buildArtifact.digest,
    };
    requestDraft.attestations = [{
      schema: artifactAttestation.schema,
      id: artifactAttestation.id,
      digest: artifactAttestation.digest,
    }];
    const deploymentRequest = DeploymentRequestSchema.parse(
      redigest(requestDraft),
    );

    const planDraft = clone(fixtures.deploymentPlan);
    planDraft.request = {
      schema: deploymentRequest.schema,
      id: deploymentRequest.id,
      digest: deploymentRequest.digest,
    };
    planDraft.inputs = planDraft.inputs.map((input) =>
      input.schema === buildArtifact.schema
        ? {
          schema: buildArtifact.schema,
          id: buildArtifact.id,
          digest: buildArtifact.digest,
        }
        : input);
    planDraft.actions[0]!.inputs = planDraft.actions[0]!.inputs.map((input) =>
      input.schema === buildArtifact.schema
        ? {
          schema: buildArtifact.schema,
          id: buildArtifact.id,
          digest: buildArtifact.digest,
        }
        : input);
    const deploymentPlan = DeploymentPlanSchema.parse(redigest(planDraft));

    const approvalDraft = clone(fixtures.deploymentApprovalDecision);
    const requestBinding = approvalDraft.boundInputDigests.find(
      (binding) => binding.kind === "request",
    );
    expect(requestBinding).toBeDefined();
    requestBinding!.digest = deploymentRequest.digest;
    const downstream = recomputePlanDownstream(
      fixtures,
      deploymentPlan,
      approvalDraft,
      clone(fixtures.deploymentAttempt),
      {
        deploymentRequest,
        buildArtifact,
        artifactAttestation,
      },
    );

    contractSet.verifiedSourceCandidates = [verifiedSourceCandidate];
    contractSet.buildArtifacts = [buildArtifact];
    contractSet.artifactAttestations = [artifactAttestation];
    contractSet.deploymentRequests = [deploymentRequest];
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
      `buildArtifacts.${buildArtifact.id}.sourceCandidate: active artifacts require a verified source candidate`,
    );
  });
});
