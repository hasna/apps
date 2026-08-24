/**
 * Fixtures for hasna.deployment_envelope.v1 (todos c57e89eb).
 *
 * Envelope fixtures compose the existing deployment ledger fixtures
 * (createDeploymentFixtureSet) by reference, so every binding, plan, artifact
 * and receipt reference resolves to a digest-bearing record that itself
 * validates. Four positive topologies cover the measured fleet:
 * - ecs                  (hasna/apps OSS fleet: ECS + OIDC, aws_plan kinds)
 * - ec2-ssm-compose      (internal-apps shared host: Docker Compose + SSM,
 *                         deployment_db kinds)
 * - cloudflare-worker    (sites: wrangler deploys, app_cloud kinds)
 * - imported-target      (existing-target reconciliation, aws_plan kinds)
 */
import {
  DEPLOYMENT_ENVELOPE_RATIFICATION_GATE,
  DEPLOYMENT_ENVELOPE_SCHEMA_ID,
  type DeploymentEnvelope,
} from "./deployment-envelope";
import { createDeploymentFixtureSet } from "./deployment-fixtures";

const CREATED_AT = "2026-08-24T09:00:00.000Z";

function ref(record: {
  schema: string;
  id: string;
  digest: string;
  revision?: number;
}) {
  return record.revision === undefined
    ? { schema: record.schema, id: record.id, digest: record.digest }
    : {
        schema: record.schema,
        id: record.id,
        revision: record.revision,
        digest: record.digest,
      };
}

const projectsRef = {
  kind: "project" as const,
  id: "project-example-app",
  uri: "project://example-app",
};

const repositoryRef = {
  kind: "repo" as const,
  id: "repo-example-app",
  uri: "repo://github.com/hasna/example-app",
};

const ratification = {
  gate: DEPLOYMENT_ENVELOPE_RATIFICATION_GATE,
  satisfied: false,
  evidenceRefs: [],
};

export function createDeploymentEnvelopeFixtureSet() {
  const deployment = createDeploymentFixtureSet();

  const environmentProduction = {
    id: "production",
    classification: "production" as const,
    legacyAlias: "prod" as const,
    binding: ref(deployment.environmentBinding),
  };

  const baseEnvelope = (
    id: string,
    audience: "internal" | "products",
    overrides: Partial<Record<string, unknown>> = {},
  ): Record<string, unknown> => ({
    schema: DEPLOYMENT_ENVELOPE_SCHEMA_ID,
    id,
    createdAt: CREATED_AT,
    status: "draft",
    ratification,
    contractKitVersion: "1.0.0",
    identity: {
      appId: "example-app",
      packageName: "@hasna/example-app",
      projectsRef,
      repositoryRef,
    },
    audience,
    accountMapping: [
      {
        audience,
        accountId: "789877399345",
        region: "eu-central-1",
        purpose: audience === "internal" ? "control plane" : "customer products",
      },
    ],
    environments: [environmentProduction],
    resourceGraph: {
      resources: [
        {
          id: "app-compute",
          provider: "aws",
          kind: "compute",
          sourceVocabulary: "aws_plan",
          sourceKind: "ecs-service",
          ownerPackage: "@hasna/example-app",
          region: "eu-central-1",
          accountId: "789877399345",
          dependsOn: ["app-network"],
        },
        {
          id: "app-network",
          provider: "aws",
          kind: "network",
          sourceVocabulary: "aws_plan",
          sourceKind: "vpc-networking",
          ownerPackage: "@hasna/example-app",
          region: "eu-central-1",
          accountId: "789877399345",
        },
      ],
    },
    artifacts: [ref(deployment.buildArtifact)],
    deployProcedure: {
      requestKind: "deployment",
      plan: ref(deployment.deploymentPlan),
      phases: [
        {
          id: "apply",
          approvalScope: "phase",
          actions: [
            {
              id: "apply-infra",
              operationId: "aws.ecs.apply",
              sideEffectClass: "compute_or_infra_mutation",
              compensationOperationId: "aws.ecs.rollback",
              approvalScope: "phase",
              evidenceRequirement: "provider-receipt",
            },
          ],
        },
      ],
    },
    monitorWiring: {
      source: "uptime",
      importMode: "link_only",
      checks: [
        {
          id: "availability",
          kind: "availability",
          expectedStatuses: [200],
          alarmClass: "fleet-default-alarms",
        },
      ],
    },
    rollback: {
      profile: "fleet-default-rollback",
      targetReceipt: ref(deployment.deploymentReceipt),
    },
    ...overrides,
  });

  const ecsEnvelope = {
    ...baseEnvelope("envelope-example-app-ecs", "internal"),
    resourceGraph: {
      resources: [
        {
          id: "app-service",
          provider: "aws",
          kind: "compute",
          sourceVocabulary: "aws_plan",
          sourceKind: "ecs-service",
          ownerPackage: "@hasna/example-app",
          region: "eu-central-1",
          accountId: "789877399345",
          dependsOn: ["app-cluster", "app-network", "app-database", "app-files", "app-logs"],
        },
        {
          id: "app-cluster",
          provider: "aws",
          kind: "compute",
          sourceVocabulary: "aws_plan",
          sourceKind: "ecs-cluster",
          ownerPackage: "@hasna/example-app",
          region: "eu-central-1",
          accountId: "789877399345",
          dependsOn: ["app-network"],
        },
        {
          id: "app-network",
          provider: "aws",
          kind: "network",
          sourceVocabulary: "aws_plan",
          sourceKind: "vpc-networking",
          ownerPackage: "@hasna/example-app",
          region: "eu-central-1",
          accountId: "789877399345",
        },
        {
          id: "app-database",
          provider: "aws",
          kind: "database",
          sourceVocabulary: "aws_plan",
          sourceKind: "rds-postgres",
          ownerPackage: "@hasna/example-app",
          region: "eu-central-1",
          accountId: "789877399345",
          dependsOn: ["app-network"],
        },
        {
          id: "app-files",
          provider: "aws",
          kind: "object_storage",
          sourceVocabulary: "aws_plan",
          sourceKind: "s3-bucket",
          ownerPackage: "@hasna/example-app",
          region: "eu-central-1",
          accountId: "789877399345",
        },
        {
          id: "app-logs",
          provider: "aws",
          kind: "observability",
          sourceVocabulary: "aws_plan",
          sourceKind: "cloudwatch-log-group",
          ownerPackage: "@hasna/example-app",
          region: "eu-central-1",
          accountId: "789877399345",
        },
        {
          id: "app-exec-role",
          provider: "aws",
          kind: "identity",
          sourceVocabulary: "aws_plan",
          sourceKind: "iam-execution-role",
          ownerPackage: "@hasna/example-app",
          region: "eu-central-1",
          accountId: "789877399345",
        },
      ],
    },
  } as unknown as DeploymentEnvelope;

  const ec2SsmComposeEnvelope = {
    ...baseEnvelope("envelope-example-app-ec2-ssm-compose", "internal"),
    resourceGraph: {
      resources: [
        {
          id: "compose-host",
          provider: "aws",
          kind: "compute",
          sourceVocabulary: "deployment_db",
          sourceKind: "compute",
          ownerPackage: "@hasna/example-app",
          region: "eu-central-1",
          accountId: "789877399345",
          dependsOn: ["compose-network"],
        },
        {
          id: "compose-db",
          provider: "aws",
          kind: "database",
          sourceVocabulary: "deployment_db",
          sourceKind: "database",
          ownerPackage: "@hasna/example-app",
          region: "eu-central-1",
          accountId: "789877399345",
        },
        {
          id: "compose-files",
          provider: "aws",
          kind: "object_storage",
          sourceVocabulary: "deployment_db",
          sourceKind: "storage",
          ownerPackage: "@hasna/example-app",
          region: "eu-central-1",
          accountId: "789877399345",
        },
        {
          id: "compose-domain",
          provider: "cloudflare",
          kind: "domain",
          sourceVocabulary: "deployment_db",
          sourceKind: "domain",
          ownerPackage: "@hasna/example-app",
          uri: "repo://github.com/hasna/example-app",
        },
        {
          id: "compose-dns",
          provider: "cloudflare",
          kind: "dns",
          sourceVocabulary: "deployment_db",
          sourceKind: "dns",
          ownerPackage: "@hasna/example-app",
          uri: "repo://github.com/hasna/example-app",
          dependsOn: ["compose-domain"],
        },
        {
          id: "compose-network",
          provider: "aws",
          kind: "network",
          sourceVocabulary: "aws_plan",
          sourceKind: "security-group",
          ownerPackage: "@hasna/example-app",
          region: "eu-central-1",
          accountId: "789877399345",
        },
      ],
    },
    monitorWiring: {
      source: "monitor",
      importMode: "link_only",
      checks: [
        {
          id: "host-health",
          kind: "host",
          expectedStatuses: [],
          alarmClass: "fleet-default-alarms",
        },
      ],
    },
  } as unknown as DeploymentEnvelope;

  const cloudflareWorkerEnvelope = {
    ...baseEnvelope("envelope-example-app-cloudflare-worker", "products"),
    accountMapping: [
      {
        audience: "products",
        accountId: "cloudflare-account-example",
        purpose: "customer products",
      },
    ],
    resourceGraph: {
      resources: [
        {
          id: "worker-entry",
          provider: "cloudflare",
          kind: "function",
          sourceVocabulary: "app_cloud",
          sourceKind: "function",
          ownerPackage: "@hasna/example-app",
          uri: "repo://github.com/hasna/example-app",
          dependsOn: ["worker-queue"],
        },
        {
          id: "worker-queue",
          provider: "cloudflare",
          kind: "queue",
          sourceVocabulary: "app_cloud",
          sourceKind: "queue",
          ownerPackage: "@hasna/example-app",
          uri: "repo://github.com/hasna/example-app",
        },
        {
          id: "worker-domain",
          provider: "cloudflare",
          kind: "domain",
          sourceVocabulary: "deployment_db",
          sourceKind: "domain",
          ownerPackage: "@hasna/example-app",
          uri: "repo://github.com/hasna/example-app",
        },
        {
          id: "worker-dns",
          provider: "cloudflare",
          kind: "dns",
          sourceVocabulary: "deployment_db",
          sourceKind: "dns",
          ownerPackage: "@hasna/example-app",
          uri: "repo://github.com/hasna/example-app",
          dependsOn: ["worker-domain"],
        },
      ],
    },
    deployProcedure: {
      requestKind: "deployment",
      plan: ref(deployment.deploymentPlan),
      phases: [
        {
          id: "publish",
          approvalScope: "phase",
          actions: [
            {
              id: "activate-worker",
              operationId: "cloudflare.worker.activate",
              sideEffectClass: "compute_or_infra_mutation",
              compensationOperationId: "cloudflare.worker.deactivate",
              approvalScope: "phase",
              evidenceRequirement: "launch-evidence",
            },
          ],
        },
      ],
    },
    monitorWiring: {
      source: "uptime",
      importMode: "link_only",
      checks: [
        {
          id: "availability",
          kind: "availability",
          expectedStatuses: [200],
          alarmClass: "fleet-default-alarms",
        },
        {
          id: "tls",
          kind: "tls",
          expectedStatuses: [],
          alarmClass: "fleet-default-alarms",
        },
      ],
    },
  } as unknown as DeploymentEnvelope;

  const importedExistingTargetEnvelope = {
    ...baseEnvelope("envelope-example-app-imported", "internal"),
    deployProcedure: {
      requestKind: "reconciliation",
      plan: ref(deployment.deploymentPlan),
      phases: [
        {
          id: "reconcile",
          approvalScope: "plan",
          actions: [
            {
              id: "import-target",
              operationId: "deployment.import.ecs",
              sideEffectClass: "external_notification",
              compensationOperationId: "deployment.import.rollback",
              approvalScope: "action",
              evidenceRequirement: "existing-target-receipt",
            },
            {
              id: "cutover-dns",
              operationId: "aws.dns.cutover",
              sideEffectClass: "dns_or_domain_change",
              nonReversible: true,
              approvalScope: "phase",
              evidenceRequirement: "dns-cutover-receipt",
            },
          ],
        },
      ],
    },
    resourceGraph: {
      resources: [
        {
          id: "imported-service",
          provider: "aws",
          kind: "compute",
          sourceVocabulary: "aws_plan",
          sourceKind: "ecs-service",
          ownerPackage: "@hasna/example-app",
          region: "eu-central-1",
          accountId: "789877399345",
          dependsOn: ["imported-db"],
        },
        {
          id: "imported-db",
          provider: "aws",
          kind: "database",
          sourceVocabulary: "aws_plan",
          sourceKind: "rds-postgres",
          ownerPackage: "@hasna/example-app",
          region: "eu-central-1",
          accountId: "789877399345",
        },
        {
          id: "imported-files",
          provider: "aws",
          kind: "object_storage",
          sourceVocabulary: "aws_plan",
          sourceKind: "s3-bucket",
          ownerPackage: "@hasna/example-app",
          region: "eu-central-1",
          accountId: "789877399345",
        },
      ],
    },
  } as unknown as DeploymentEnvelope;

  return {
    deployment,
    ref,
    baseEnvelope,
    ecsEnvelope,
    ec2SsmComposeEnvelope,
    cloudflareWorkerEnvelope,
    importedExistingTargetEnvelope,
  };
}

export type DeploymentEnvelopeFixtureSet = ReturnType<
  typeof createDeploymentEnvelopeFixtureSet
>;
