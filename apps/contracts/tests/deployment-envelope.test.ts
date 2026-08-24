import { describe, expect, test } from "bun:test";
import {
  CANONICAL_RESOURCE_KINDS,
  DEPLOYMENT_ENVELOPE_RATIFICATION_GATE,
  DEPLOYMENT_ENVELOPE_SCHEMA_ID,
  ENVIRONMENT_ALIAS_MAP,
  RESOURCE_KIND_MAPPINGS,
} from "../src/deployment-envelope";
import { createDeploymentEnvelopeFixtureSet } from "../src/deployment-envelope-fixtures";
import {
  ContractSchemaRegistry,
  DeploymentEnvelopeSchema,
  SCHEMA_IDS,
} from "../src/schemas";

type Fixtures = ReturnType<typeof createDeploymentEnvelopeFixtureSet>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function issuesFor(value: unknown): string[] {
  const result = DeploymentEnvelopeSchema.safeParse(value);
  if (result.success) {
    return [];
  }
  return result.error.issues.map((issue) => issue.message);
}

function expectRejected(value: unknown, messagePart: string): void {
  const result = DeploymentEnvelopeSchema.safeParse(value);
  expect(result.success).toBe(false);
  const messages = result.success
    ? []
    : result.error.issues.map((issue) => issue.message);
  expect(messages.some((message) => message.includes(messagePart))).toBe(true);
}

const fourTopologies: Array<{
  name: string;
  envelope: (fixtures: Fixtures) => unknown;
}> = [
  {
    name: "ECS (aws_plan kinds)",
    envelope: (fixtures) => fixtures.ecsEnvelope,
  },
  {
    name: "ec2-ssm-compose (deployment_db kinds)",
    envelope: (fixtures) => fixtures.ec2SsmComposeEnvelope,
  },
  {
    name: "cloudflare-worker (app_cloud kinds)",
    envelope: (fixtures) => fixtures.cloudflareWorkerEnvelope,
  },
  {
    name: "imported existing target (reconciliation)",
    envelope: (fixtures) => fixtures.importedExistingTargetEnvelope,
  },
];

describe("hasna.deployment_envelope.v1 — registration", () => {
  test("is registered in ContractSchemaRegistry under its schema id", () => {
    expect(SCHEMA_IDS.deploymentEnvelope).toBe(DEPLOYMENT_ENVELOPE_SCHEMA_ID);
    expect(ContractSchemaRegistry[DEPLOYMENT_ENVELOPE_SCHEMA_ID]).toBe(
      DeploymentEnvelopeSchema,
    );
  });

  test("ratification gate text is the written gate", () => {
    expect(DEPLOYMENT_ENVELOPE_RATIFICATION_GATE).toBe(
      "one production deployment executed through this envelope with receipts and a passed live test",
    );
  });
});

describe("hasna.deployment_envelope.v1 — positive topologies", () => {
  const fixtures = createDeploymentEnvelopeFixtureSet();

  for (const topology of fourTopologies) {
    test(`${topology.name} validates`, () => {
      const result = DeploymentEnvelopeSchema.safeParse(
        topology.envelope(fixtures),
      );
      expect(result.success).toBe(true);
    });
  }

  test("default status is draft", () => {
    const parsed = DeploymentEnvelopeSchema.parse(fixtures.ecsEnvelope);
    expect(parsed.status).toBe("draft");
    expect(parsed.ratification.satisfied).toBe(false);
  });

  test("an active envelope passes when the ratification gate is satisfied with evidence", () => {
    const envelope = clone(fixtures.ecsEnvelope) as Record<string, unknown>;
    envelope.status = "active";
    (envelope as { ratification: Record<string, unknown> }).ratification = {
      gate: DEPLOYMENT_ENVELOPE_RATIFICATION_GATE,
      satisfied: true,
      evidenceRefs: [
        {
          id: "pilot-deploy-receipt",
          kind: "report",
          uri: "artifact://deployment-fixture/pilot-receipt",
        },
      ],
    };
    const result = DeploymentEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });

  test("legacy environment alias converts when it maps to the canonical classification", () => {
    const envelope = clone(fixtures.ecsEnvelope) as Record<string, unknown>;
    const environments = (envelope as { environments: unknown[] }).environments;
    environments[0] = {
      ...(environments[0] as Record<string, unknown>),
      id: "development",
      classification: "development",
      legacyAlias: "dev",
    };
    const result = DeploymentEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
    expect(ENVIRONMENT_ALIAS_MAP.dev).toBe("development");
    expect(ENVIRONMENT_ALIAS_MAP.prod).toBe("production");
    expect(ENVIRONMENT_ALIAS_MAP.staging).toBe("staging");
  });
});

describe("hasna.deployment_envelope.v1 — rejection gates", () => {
  const fixtures = createDeploymentEnvelopeFixtureSet();

  test("rejects a missing audience", () => {
    const envelope = clone(fixtures.ecsEnvelope) as Record<string, unknown>;
    delete envelope.audience;
    const result = DeploymentEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(false);
    expect(
      result.success
        ? []
        : result.error.issues.some((issue) => issue.path.includes("audience")),
    ).toBe(true);
  });

  test("rejects an invalid audience", () => {
    const envelope = clone(fixtures.ecsEnvelope) as Record<string, unknown>;
    envelope.audience = "public";
    const result = DeploymentEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(false);
  });

  test("rejects raw secret values", () => {
    const envelope = clone(fixtures.ecsEnvelope) as {
      resourceGraph: { resources: Array<Record<string, unknown>> };
    };
    envelope.resourceGraph.resources[0]!.desiredConfig = {
      apiToken: "token=fixture-only-value-0123456789abcdef",
    };
    expectRejected(
      envelope,
      "Deployment contracts cannot contain secret or credential values",
    );
  });

  test("rejects secret-bearing field names", () => {
    const envelope = clone(fixtures.ecsEnvelope) as {
      resourceGraph: { resources: Array<Record<string, unknown>> };
    };
    envelope.resourceGraph.resources[0]!.desiredConfig = {
      secret_value: "opaque",
    };
    expectRejected(
      envelope,
      "Deployment contracts cannot contain executable, raw provider, state, or secret-bearing fields",
    );
  });

  test("rejects an unresolved Projects identity", () => {
    const envelope = clone(fixtures.ecsEnvelope) as {
      identity: Record<string, unknown>;
    };
    envelope.identity.projectsRef = {
      kind: "repo",
      id: "repo-example-app",
      uri: "repo://github.com/hasna/example-app",
    };
    expectRejected(
      envelope,
      "requires a resolved Hasna Projects identity",
    );
  });

  test("rejects an unmapped canonical resource kind", () => {
    const envelope = clone(fixtures.ecsEnvelope) as {
      resourceGraph: { resources: Array<Record<string, unknown>> };
    };
    envelope.resourceGraph.resources[0]!.kind = "firehose";
    const result = DeploymentEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(false);
    expect(CANONICAL_RESOURCE_KINDS.includes("firehose" as never)).toBe(false);
  });

  test("rejects an unmapped source kind in a known vocabulary", () => {
    const envelope = clone(fixtures.ecsEnvelope) as {
      resourceGraph: { resources: Array<Record<string, unknown>> };
    };
    envelope.resourceGraph.resources[0]!.sourceKind = "lambda-function";
    expectRejected(
      envelope,
      "Unmapped resource kind lambda-function in vocabulary aws_plan",
    );
    expect(
      "lambda-function" in RESOURCE_KIND_MAPPINGS.aws_plan,
    ).toBe(false);
  });

  test("rejects a source kind that maps to a different canonical kind", () => {
    const envelope = clone(fixtures.ecsEnvelope) as {
      resourceGraph: { resources: Array<Record<string, unknown>> };
    };
    envelope.resourceGraph.resources[0]!.sourceKind = "s3-bucket";
    expectRejected(
      envelope,
      "maps to canonical kind object_storage, not compute",
    );
  });

  test("rejects sourceVocabulary declared without sourceKind", () => {
    const envelope = clone(fixtures.ecsEnvelope) as {
      resourceGraph: { resources: Array<Record<string, unknown>> };
    };
    envelope.resourceGraph.resources[0]!.sourceKind = undefined;
    expectRejected(
      envelope,
      "sourceVocabulary and sourceKind must be declared together",
    );
  });

  test("rejects a missing provider/account binding on an account-bound provider", () => {
    const envelope = clone(fixtures.ecsEnvelope) as {
      resourceGraph: { resources: Array<Record<string, unknown>> };
    };
    delete envelope.resourceGraph.resources[0]!.accountId;
    expectRejected(
      envelope,
      "Provider aws is account-bound and requires an accountId",
    );
  });

  test("rejects an accountless provider with no locator at all", () => {
    const envelope = clone(fixtures.cloudflareWorkerEnvelope) as {
      resourceGraph: { resources: Array<Record<string, unknown>> };
    };
    const resource = envelope.resourceGraph.resources[0]!;
    delete resource.accountId;
    delete resource.uri;
    delete resource.region;
    expectRejected(
      envelope,
      "requires at least one of accountId, uri, or region",
    );
  });

  test("rejects a procedure action without compensation or explicit non-reversible classification", () => {
    const envelope = clone(fixtures.ecsEnvelope) as {
      deployProcedure: {
        phases: Array<{
          actions: Array<Record<string, unknown>>;
        }>;
      };
    };
    const action = envelope.deployProcedure.phases[0]!.actions[0]!;
    action.compensationOperationId = null;
    action.nonReversible = false;
    expectRejected(
      envelope,
      "require a compensation operation or an explicit non-reversible classification",
    );
  });

  test("accepts an explicit non-reversible classification without compensation", () => {
    const envelope = clone(fixtures.importedExistingTargetEnvelope) as {
      deployProcedure: {
        phases: Array<{
          actions: Array<Record<string, unknown>>;
        }>;
      };
    };
    const cutover = envelope.deployProcedure.phases[0]!.actions[1]!;
    expect(cutover.nonReversible).toBe(true);
    expect(cutover.compensationOperationId).toBeUndefined();
    const result = DeploymentEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });

  test("rejects a legacy environment classification", () => {
    const envelope = clone(fixtures.ecsEnvelope) as {
      environments: Array<Record<string, unknown>>;
    };
    envelope.environments[0]!.classification = "prod";
    const result = DeploymentEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(false);
  });

  test("rejects a legacy alias that does not map to its classification", () => {
    const envelope = clone(fixtures.ecsEnvelope) as {
      environments: Array<Record<string, unknown>>;
    };
    envelope.environments[0]!.legacyAlias = "dev";
    expectRejected(
      envelope,
      "Legacy alias dev maps to canonical classification development, not production",
    );
  });

  test("rejects the retired alumia storage.mode legacy shape", () => {
    const envelope = clone(fixtures.ecsEnvelope) as Record<string, unknown>;
    (envelope as Record<string, unknown>).storageMode = "local";
    const result = DeploymentEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(false);
  });

  test("rejects the retired deploymentMode legacy shape", () => {
    const envelope = clone(fixtures.ecsEnvelope) as Record<string, unknown>;
    (envelope as Record<string, unknown>).deploymentMode = "self-hosted";
    const result = DeploymentEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(false);
  });

  test("rejects an active envelope without the ratification gate satisfied", () => {
    const envelope = clone(fixtures.ecsEnvelope) as Record<string, unknown>;
    envelope.status = "active";
    expectRejected(
      envelope,
      "Active envelopes require the ratification gate to be satisfied",
    );
  });

  test("rejects an unresolved resource dependency", () => {
    const envelope = clone(fixtures.ecsEnvelope) as {
      resourceGraph: { resources: Array<Record<string, unknown>> };
    };
    envelope.resourceGraph.resources[0]!.dependsOn = ["missing-resource"];
    expectRejected(
      envelope,
      "Resource dependency must resolve inside the graph",
    );
  });

  test("rejects duplicate account-mapping audiences", () => {
    const envelope = clone(fixtures.ecsEnvelope) as {
      accountMapping: Array<Record<string, unknown>>;
    };
    envelope.accountMapping.push(clone(envelope.accountMapping[0]!));
    expectRejected(envelope, "Account mapping audiences must be unique");
  });
});

describe("hasna.deployment_envelope.v1 — resource-kind registry coverage", () => {
  test("every legacy vocabulary kind maps to a canonical kind", () => {
    const canonical = new Set<string>(CANONICAL_RESOURCE_KINDS);
    for (const vocabulary of Object.keys(RESOURCE_KIND_MAPPINGS)) {
      const mapping =
        RESOURCE_KIND_MAPPINGS[vocabulary as keyof typeof RESOURCE_KIND_MAPPINGS];
      for (const [sourceKind, canonicalKind] of Object.entries(mapping)) {
        expect(
          canonical.has(canonicalKind),
          `${vocabulary}:${sourceKind} -> ${canonicalKind}`,
        ).toBe(true);
      }
    }
  });

  test("the four vocabularies carry their measured kind counts", () => {
    expect(Object.keys(RESOURCE_KIND_MAPPINGS.deployment_db)).toHaveLength(8);
    expect(Object.keys(RESOURCE_KIND_MAPPINGS.app_cloud)).toHaveLength(11);
    expect(Object.keys(RESOURCE_KIND_MAPPINGS.intent)).toHaveLength(5);
    expect(Object.keys(RESOURCE_KIND_MAPPINGS.aws_plan)).toHaveLength(10);
  });
});
