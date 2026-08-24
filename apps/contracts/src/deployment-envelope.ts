/**
 * hasna.deployment_envelope.v1 — DRAFT composition contract (todos c57e89eb).
 *
 * The envelope composes the existing 13-schema `hasna.*deployment*.v1` family
 * (product projection, intent snapshot, verified source candidate, build
 * artifact, artifact attestation, environment binding, deployment request,
 * deployment plan, deployment approval decision, deployment attempt, provider
 * receipt, deployment receipt, launch evidence) plus `hasna.app_cloud_manifest.v1`
 * and `hasna.app.v1` identity into one declarative deployment declaration:
 * app identity, audience, environments, provider bindings, resource graph,
 * artifacts, deploy procedure, monitor wiring, rollback, account mapping.
 *
 * STATUS: DRAFT by default. The schema enforces the written ratification gate:
 * an envelope may only be marked `active` when `ratification.satisfied` is
 * true and carries evidence refs. The gate text is
 * `DEPLOYMENT_ENVELOPE_RATIFICATION_GATE`:
 *
 *   "one production deployment executed through this envelope with receipts
 *    and a passed live test"
 *
 * VERSION POLICY (deliverable 4 of the task):
 * - Envelopes pin `contractKitVersion` to the current deployment kit
 *   (`DEPLOYMENT_CONTRACT_VERSION`). Consumers that adopt the envelope must
 *   pin their `@hasna/contracts` dependency to a version carrying this schema;
 *   the deployment app's own contracts pin (0.10.5) is bumped in its own
 *   repository lane, not here.
 * - Legacy environment vocabulary (deployment app DB `dev|staging|prod`) is
 *   reconciled to the canonical `development|staging|production|
 *   disaster_recovery` classification through `ENVIRONMENT_ALIAS_MAP`; a
 *   legacy alias may only be declared when it maps to exactly the canonical
 *   classification it is attached to. Any other legacy value is REJECTED.
 * - Legacy shapes that cannot be converted (alumia `storage.mode`, retired
 *   `deployment_mode`/`hosting` fields) are REJECTED by the strict schema and
 *   by the safety scan; compatibility fixtures prove both directions.
 * - Resource kinds are canonical. Four legacy vocabularies
 *   (`deployment_db`, `app_cloud`, `intent`, `aws_plan`) map explicitly to
 *   the canonical registry via `RESOURCE_KIND_MAPPINGS`; a kind that is not
 *   in the mapping is REJECTED, never guessed.
 */
import { z } from "zod";
import {
  addDeploymentSafetyIssues,
  DEPLOYMENT_CONTRACT_VERSION,
} from "./deployment";

export const DEPLOYMENT_ENVELOPE_SCHEMA_ID =
  "hasna.deployment_envelope.v1" as const;

/** Written ratification gate: the envelope stays DRAFT until this is met. */
export const DEPLOYMENT_ENVELOPE_RATIFICATION_GATE =
  "one production deployment executed through this envelope with receipts and a passed live test" as const;

/**
 * Canonical resource-kind registry. One vocabulary for every deployment
 * resource, provider-neutral.
 */
export const CANONICAL_RESOURCE_KINDS = [
  "compute",
  "database",
  "object_storage",
  "cache",
  "queue",
  "topic",
  "worker",
  "cron",
  "function",
  "secret",
  "domain",
  "dns",
  "cdn",
  "network",
  "identity",
  "observability",
  "other",
] as const;

/** The four legacy resource vocabularies this registry reconciles. */
export const RESOURCE_KIND_SOURCE_VOCABULARIES = [
  "deployment_db",
  "app_cloud",
  "intent",
  "aws_plan",
] as const;

/**
 * Explicit mapping from each legacy vocabulary to the canonical registry.
 * Measured from the four live surfaces on 2026-08-23/24:
 * - deployment_db: deployment app `ResourceType` (8 kinds)
 * - app_cloud:     `hasna.app_cloud_manifest.v1` `cloudResources[].kind` (11 kinds)
 * - intent:        `hasna.intent_snapshot.v1` `serviceRequirements[].kind` (5 kinds)
 * - aws_plan:      deployment app `aws-plan.ts` `AwsPlannedResource.kind` (10 kinds)
 * A kind absent from its vocabulary's mapping is REJECTED by the envelope.
 */
export const RESOURCE_KIND_MAPPINGS = {
  deployment_db: {
    database: "database",
    cache: "cache",
    storage: "object_storage",
    domain: "domain",
    compute: "compute",
    queue: "queue",
    cdn: "cdn",
    dns: "dns",
  },
  app_cloud: {
    database: "database",
    bucket: "object_storage",
    object_store: "object_storage",
    queue: "queue",
    secret: "secret",
    function: "function",
    worker: "worker",
    cache: "cache",
    topic: "topic",
    scheduler: "cron",
    other: "other",
  },
  intent: {
    database: "database",
    object_storage: "object_storage",
    queue: "queue",
    cron: "cron",
    worker: "worker",
  },
  aws_plan: {
    "ecs-cluster": "compute",
    "ecs-task-definition": "compute",
    "ecs-service": "compute",
    "rds-postgres": "database",
    "s3-bucket": "object_storage",
    "iam-task-role": "identity",
    "iam-execution-role": "identity",
    "cloudwatch-log-group": "observability",
    "vpc-networking": "network",
    "security-group": "network",
  },
} as const;

/**
 * Environment vocabulary reconciliation: deployment app DB `dev|staging|prod`
 * maps onto the canonical classification used by
 * `hasna.environment_binding.v1` (`development|staging|production|
 * disaster_recovery`). `disaster_recovery` has no legacy alias.
 */
export const ENVIRONMENT_ALIAS_MAP = {
  dev: "development",
  staging: "staging",
  prod: "production",
} as const;

/** Providers whose resources carry an AWS-style account id. */
export const ENVELOPE_PROVIDERS = [
  "aws",
  "gcp",
  "azure",
  "cloudflare",
  "vercel",
  "railway",
  "flyio",
  "digitalocean",
  "other",
] as const;

export const ACCOUNT_BOUND_PROVIDERS = new Set<string>([
  "aws",
  "gcp",
  "azure",
]);

export interface DeploymentEnvelopePrimitives {
  timestamp: z.ZodTypeAny;
  metadata: z.ZodTypeAny;
  appId: z.ZodTypeAny;
  npmPackageName: z.ZodTypeAny;
  uri: z.ZodTypeAny;
  resourcePointer: z.ZodTypeAny;
  evidencePointer: z.ZodTypeAny;
  providerSideEffectClass: z.ZodTypeAny;
  productProjectionRef: z.ZodTypeAny;
  environmentBindingRef: z.ZodTypeAny;
  buildArtifactRef: z.ZodTypeAny;
  deploymentPlanRef: z.ZodTypeAny;
  deploymentReceiptRef: z.ZodTypeAny;
}

const ENVELOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const ENVELOPE_NAME = /^[a-z][a-z0-9._-]{0,127}$/;
const ENVELOPE_OPERATION_ID = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

function uniqueEnvelopeBy<T>(
  values: readonly T[],
  key: (value: T) => string,
  ctx: z.RefinementCtx,
  path: Array<string | number>,
  label: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const semanticId = key(value);
    if (seen.has(semanticId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must be unique`,
        path: [...path, index],
      });
    }
    seen.add(semanticId);
  });
}

export function createDeploymentEnvelopeSchema(
  primitives: DeploymentEnvelopePrimitives,
) {
  const EnvelopeIdSchema = z.string().regex(ENVELOPE_ID);
  const EnvelopeNameSchema = z.string().regex(ENVELOPE_NAME);
  const EnvelopeOperationIdSchema = z.string().regex(ENVELOPE_OPERATION_ID);
  const EnvelopeTimestampSchema = primitives.timestamp;
  const EnvelopeMetadataSchema = primitives.metadata;
  const EnvelopeUriSchema = primitives.uri;
  const EnvelopeResourcePointerSchema = primitives.resourcePointer;
  const EnvelopeEvidencePointerSchema = primitives.evidencePointer;

  const envelopeBase = <TSchema extends string>(schema: TSchema) => ({
    schema: z.literal(schema),
    id: EnvelopeIdSchema,
    createdAt: EnvelopeTimestampSchema,
    updatedAt: EnvelopeTimestampSchema.nullable().optional(),
    metadata: EnvelopeMetadataSchema.optional(),
  });

  const EnvelopeResourceSchema = z
    .object({
      id: EnvelopeNameSchema,
      provider: z.enum(ENVELOPE_PROVIDERS),
      /** Canonical kind; must be a member of CANONICAL_RESOURCE_KINDS. */
      kind: z.enum(CANONICAL_RESOURCE_KINDS),
      /** Source vocabulary of this resource's kind (provenance). */
      sourceVocabulary: z.enum(RESOURCE_KIND_SOURCE_VOCABULARIES).optional(),
      /** Kind as declared in the source vocabulary. */
      sourceKind: z.string().trim().min(1).optional(),
      ownerPackage: primitives.npmPackageName,
      region: z.string().trim().min(1).optional(),
      accountId: z.string().trim().min(1).optional(),
      uri: EnvelopeUriSchema.optional(),
      dependsOn: z.array(EnvelopeNameSchema).default([]),
      desiredConfig: z.record(z.unknown()).default({}),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (Boolean(value.sourceVocabulary) !== Boolean(value.sourceKind)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "sourceVocabulary and sourceKind must be declared together",
          path: ["sourceKind"],
        });
      }
      if (value.sourceVocabulary && value.sourceKind) {
        const mapping =
          RESOURCE_KIND_MAPPINGS[
            value.sourceVocabulary as keyof typeof RESOURCE_KIND_MAPPINGS
          ];
        if (!mapping) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Unknown resource-kind source vocabulary",
            path: ["sourceVocabulary"],
          });
        } else if (!(value.sourceKind in mapping)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unmapped resource kind ${value.sourceKind} in vocabulary ${value.sourceVocabulary}; unmapped kinds are rejected, never guessed`,
            path: ["sourceKind"],
          });
        } else {
          const mapped = mapping[
            value.sourceKind as keyof typeof mapping
          ] as string;
          if (mapped !== value.kind) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Resource kind ${value.sourceKind} in vocabulary ${value.sourceVocabulary} maps to canonical kind ${mapped}, not ${value.kind}`,
              path: ["kind"],
            });
          }
        }
      }
      if (ACCOUNT_BOUND_PROVIDERS.has(value.provider) && !value.accountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Provider ${value.provider} is account-bound and requires an accountId`,
          path: ["accountId"],
        });
      }
      if (!ACCOUNT_BOUND_PROVIDERS.has(value.provider)) {
        if (!value.accountId && !value.uri && !value.region) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Provider ${value.provider} requires at least one of accountId, uri, or region`,
            path: ["provider"],
          });
        }
      }
    });

  const EnvelopeEnvironmentSchema = z
    .object({
      id: EnvelopeNameSchema,
      classification: z.enum([
        "development",
        "staging",
        "production",
        "disaster_recovery",
      ]),
      /** Legacy deployment-app-DB alias, only when it maps to the classification. */
      legacyAlias: z.enum(["dev", "staging", "prod"]).optional(),
      /** Provider binding: reference to a hasna.environment_binding.v1 record. */
      binding: primitives.environmentBindingRef,
      desiredConfig: z.record(z.unknown()).default({}),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.legacyAlias) {
        const mapped = ENVIRONMENT_ALIAS_MAP[value.legacyAlias];
        if (mapped !== value.classification) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Legacy alias ${value.legacyAlias} maps to canonical classification ${mapped}, not ${value.classification}`,
            path: ["legacyAlias"],
          });
        }
      }
    });

  const EnvelopeActionSchema = z
    .object({
      id: EnvelopeNameSchema,
      operationId: EnvelopeOperationIdSchema,
      sideEffectClass: primitives.providerSideEffectClass,
      /** Required for every side-effecting action unless nonReversible is true. */
      compensationOperationId: EnvelopeOperationIdSchema.nullable().optional(),
      /** Explicit non-reversible classification; the only alternative to compensation. */
      nonReversible: z.boolean().default(false),
      approvalScope: z.enum(["none", "action", "phase"]).default("action"),
      evidenceRequirement: z.string().trim().min(1).optional(),
    })
    .strict();

  const EnvelopePhaseSchema = z
    .object({
      id: EnvelopeNameSchema,
      approvalScope: z.enum(["none", "plan", "action", "phase"]),
      actions: z.array(EnvelopeActionSchema).min(1),
    })
    .strict();

  const EnvelopeMonitorCheckSchema = z
    .object({
      id: EnvelopeNameSchema,
      kind: z.enum([
        "availability",
        "deployment",
        "host",
        "process",
        "tls",
        "domain_expiry",
        "health",
        "readiness",
      ]),
      endpoint: EnvelopeUriSchema.optional(),
      expectedStatuses: z.array(z.number().int().min(100).max(599)).default([]),
      alarmClass: EnvelopeNameSchema.optional(),
    })
    .strict();

  const DeploymentEnvelopeSchema = z
    .object({
      ...envelopeBase(DEPLOYMENT_ENVELOPE_SCHEMA_ID),
      /** DRAFT until the written ratification gate is satisfied. */
      status: z.enum(["draft", "active"]).default("draft"),
      ratification: z
        .object({
          gate: z.literal(DEPLOYMENT_ENVELOPE_RATIFICATION_GATE),
          satisfied: z.boolean().default(false),
          evidenceRefs: z.array(EnvelopeEvidencePointerSchema).default([]),
        })
        .strict(),
      /** Pinned deployment kit version the envelope is compiled against. */
      contractKitVersion: z.literal(DEPLOYMENT_CONTRACT_VERSION),
      identity: z
        .object({
          appId: primitives.appId,
          packageName: primitives.npmPackageName,
          /** Resolved Hasna Projects identity (kind must be project). */
          projectsRef: EnvelopeResourcePointerSchema,
          repositoryRef: EnvelopeResourcePointerSchema,
        })
        .strict(),
      /** Deployment audience: internal control plane vs customer products. */
      audience: z.enum(["internal", "products"]),
      accountMapping: z
        .array(
          z
            .object({
              audience: z.enum(["internal", "products"]),
              accountId: z.string().trim().min(1),
              region: z.string().trim().min(1).optional(),
              purpose: z.string().trim().min(1).optional(),
            })
            .strict(),
        )
        .min(1),
      environments: z.array(EnvelopeEnvironmentSchema).min(1),
      resourceGraph: z
        .object({
          resources: z.array(EnvelopeResourceSchema).min(1),
        })
        .strict(),
      artifacts: z.array(primitives.buildArtifactRef).default([]),
      deployProcedure: z
        .object({
          requestKind: z.enum([
            "deployment",
            "promotion",
            "rollback",
            "reconciliation",
          ]),
          /** Executable form: reference to a hasna.deployment_plan.v1 record. */
          plan: primitives.deploymentPlanRef,
          phases: z.array(EnvelopePhaseSchema).min(1),
        })
        .strict(),
      monitorWiring: z
        .object({
          /** Owning monitoring surface (uptime, monitor, fleet, or none). */
          source: z.enum(["uptime", "monitor", "fleet", "none"]),
          /** link_only until the deployment contract surface is live. */
          importMode: z.enum(["link_only", "active"]).default("link_only"),
          checks: z.array(EnvelopeMonitorCheckSchema).default([]),
        })
        .strict(),
      rollback: z
        .object({
          profile: EnvelopeNameSchema,
          targetReceipt: primitives.deploymentReceiptRef.optional(),
        })
        .strict(),
    })
    .strict()
    .superRefine((value, ctx) => {
      addDeploymentSafetyIssues(value, ctx);

      if (value.status === "active") {
        if (!value.ratification.satisfied) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Active envelopes require the ratification gate to be satisfied",
            path: ["ratification", "satisfied"],
          });
        }
        if (value.ratification.evidenceRefs.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Active envelopes require ratification evidence refs",
            path: ["ratification", "evidenceRefs"],
          });
        }
      }

      if (value.identity.projectsRef.kind !== "project") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "The envelope requires a resolved Hasna Projects identity (projectsRef.kind must be project)",
          path: ["identity", "projectsRef", "kind"],
        });
      }

      uniqueEnvelopeBy(
        value.environments,
        (environment) => environment.id,
        ctx,
        ["environments"],
        "Environment ids",
      );
      uniqueEnvelopeBy(
        value.accountMapping,
        (mapping) => mapping.audience,
        ctx,
        ["accountMapping"],
        "Account mapping audiences",
      );

      uniqueEnvelopeBy(
        value.resourceGraph.resources,
        (resource) => resource.id,
        ctx,
        ["resourceGraph", "resources"],
        "Resource ids",
      );
      const resourceIds = new Set(
        value.resourceGraph.resources.map((resource) => resource.id),
      );
      value.resourceGraph.resources.forEach((resource, index) => {
        for (const dependency of resource.dependsOn) {
          if (!resourceIds.has(dependency)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Resource dependency must resolve inside the graph",
              path: ["resourceGraph", "resources", index, "dependsOn"],
            });
          }
        }
      });

      uniqueEnvelopeBy(
        value.deployProcedure.phases,
        (phase) => phase.id,
        ctx,
        ["deployProcedure", "phases"],
        "Procedure phase ids",
      );
      value.deployProcedure.phases.forEach((phase, phaseIndex) => {
        uniqueEnvelopeBy(
          phase.actions,
          (action) => action.id,
          ctx,
          ["deployProcedure", "phases", phaseIndex, "actions"],
          "Procedure action ids",
        );
        phase.actions.forEach((action, actionIndex) => {
          const actionPath = [
            "deployProcedure",
            "phases",
            phaseIndex,
            "actions",
            actionIndex,
          ];
          const sideEffectClass = String(action.sideEffectClass);
          if (
            sideEffectClass !== "none"
            && sideEffectClass !== "read_only"
            && !action.compensationOperationId
            && action.nonReversible !== true
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                "Side-effecting procedure actions require a compensation operation or an explicit non-reversible classification",
              path: [...actionPath, "compensationOperationId"],
            });
          }
        });
      });
    });

  return {
    DeploymentEnvelopeSchema,
    EnvelopeResourceSchema,
    EnvelopeEnvironmentSchema,
    EnvelopePhaseSchema,
    EnvelopeActionSchema,
  } as const;
}

export type DeploymentEnvelope = z.infer<
  ReturnType<typeof createDeploymentEnvelopeSchema>["DeploymentEnvelopeSchema"]
>;
