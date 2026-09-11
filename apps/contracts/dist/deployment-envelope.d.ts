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
export declare const DEPLOYMENT_ENVELOPE_SCHEMA_ID: "hasna.deployment_envelope.v1";
/** Written ratification gate: the envelope stays DRAFT until this is met. */
export declare const DEPLOYMENT_ENVELOPE_RATIFICATION_GATE: "one production deployment executed through this envelope with receipts and a passed live test";
/**
 * Canonical resource-kind registry. One vocabulary for every deployment
 * resource, provider-neutral.
 */
export declare const CANONICAL_RESOURCE_KINDS: readonly ["compute", "database", "object_storage", "cache", "queue", "topic", "worker", "cron", "function", "secret", "domain", "dns", "cdn", "network", "identity", "observability", "other"];
/** The four legacy resource vocabularies this registry reconciles. */
export declare const RESOURCE_KIND_SOURCE_VOCABULARIES: readonly ["deployment_db", "app_cloud", "intent", "aws_plan"];
/**
 * Explicit mapping from each legacy vocabulary to the canonical registry.
 * Measured from the four live surfaces on 2026-08-23/24:
 * - deployment_db: deployment app `ResourceType` (8 kinds)
 * - app_cloud:     `hasna.app_cloud_manifest.v1` `cloudResources[].kind` (11 kinds)
 * - intent:        `hasna.intent_snapshot.v1` `serviceRequirements[].kind` (5 kinds)
 * - aws_plan:      deployment app `aws-plan.ts` `AwsPlannedResource.kind` (10 kinds)
 * A kind absent from its vocabulary's mapping is REJECTED by the envelope.
 */
export declare const RESOURCE_KIND_MAPPINGS: {
    readonly deployment_db: {
        readonly database: "database";
        readonly cache: "cache";
        readonly storage: "object_storage";
        readonly domain: "domain";
        readonly compute: "compute";
        readonly queue: "queue";
        readonly cdn: "cdn";
        readonly dns: "dns";
    };
    readonly app_cloud: {
        readonly database: "database";
        readonly bucket: "object_storage";
        readonly object_store: "object_storage";
        readonly queue: "queue";
        readonly secret: "secret";
        readonly function: "function";
        readonly worker: "worker";
        readonly cache: "cache";
        readonly topic: "topic";
        readonly scheduler: "cron";
        readonly other: "other";
    };
    readonly intent: {
        readonly database: "database";
        readonly object_storage: "object_storage";
        readonly queue: "queue";
        readonly cron: "cron";
        readonly worker: "worker";
    };
    readonly aws_plan: {
        readonly "ecs-cluster": "compute";
        readonly "ecs-task-definition": "compute";
        readonly "ecs-service": "compute";
        readonly "rds-postgres": "database";
        readonly "s3-bucket": "object_storage";
        readonly "iam-task-role": "identity";
        readonly "iam-execution-role": "identity";
        readonly "cloudwatch-log-group": "observability";
        readonly "vpc-networking": "network";
        readonly "security-group": "network";
    };
};
/**
 * Environment vocabulary reconciliation: deployment app DB `dev|staging|prod`
 * maps onto the canonical classification used by
 * `hasna.environment_binding.v1` (`development|staging|production|
 * disaster_recovery`). `disaster_recovery` has no legacy alias.
 */
export declare const ENVIRONMENT_ALIAS_MAP: {
    readonly dev: "development";
    readonly staging: "staging";
    readonly prod: "production";
};
/** Providers whose resources carry an AWS-style account id. */
export declare const ENVELOPE_PROVIDERS: readonly ["aws", "gcp", "azure", "cloudflare", "vercel", "railway", "flyio", "digitalocean", "other"];
export declare const ACCOUNT_BOUND_PROVIDERS: Set<string>;
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
export declare function createDeploymentEnvelopeSchema(primitives: DeploymentEnvelopePrimitives): {
    readonly DeploymentEnvelopeSchema: z.ZodEffects<z.ZodObject<{
        /** DRAFT until the written ratification gate is satisfied. */
        status: z.ZodDefault<z.ZodEnum<["draft", "active"]>>;
        ratification: z.ZodObject<{
            gate: z.ZodLiteral<"one production deployment executed through this envelope with receipts and a passed live test">;
            satisfied: z.ZodDefault<z.ZodBoolean>;
            evidenceRefs: z.ZodDefault<z.ZodArray<z.ZodTypeAny, "many">>;
        }, "strict", z.ZodTypeAny, {
            evidenceRefs: any[];
            gate: "one production deployment executed through this envelope with receipts and a passed live test";
            satisfied: boolean;
        }, {
            gate: "one production deployment executed through this envelope with receipts and a passed live test";
            evidenceRefs?: any[] | undefined;
            satisfied?: boolean | undefined;
        }>;
        /** Pinned deployment kit version the envelope is compiled against. */
        contractKitVersion: z.ZodLiteral<"1.0.0">;
        identity: z.ZodObject<{
            appId: z.ZodTypeAny;
            packageName: z.ZodTypeAny;
            /** Resolved Hasna Projects identity (kind must be project). */
            projectsRef: z.ZodTypeAny;
            repositoryRef: z.ZodTypeAny;
        }, "strict", z.ZodTypeAny, {
            appId?: any;
            repositoryRef?: any;
            packageName?: any;
            projectsRef?: any;
        }, {
            appId?: any;
            repositoryRef?: any;
            packageName?: any;
            projectsRef?: any;
        }>;
        /** Deployment audience: internal control plane vs customer products. */
        audience: z.ZodEnum<["internal", "products"]>;
        accountMapping: z.ZodArray<z.ZodObject<{
            audience: z.ZodEnum<["internal", "products"]>;
            accountId: z.ZodString;
            region: z.ZodOptional<z.ZodString>;
            purpose: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            accountId: string;
            audience: "internal" | "products";
            region?: string | undefined;
            purpose?: string | undefined;
        }, {
            accountId: string;
            audience: "internal" | "products";
            region?: string | undefined;
            purpose?: string | undefined;
        }>, "many">;
        environments: z.ZodArray<z.ZodEffects<z.ZodObject<{
            id: z.ZodString;
            classification: z.ZodEnum<["development", "staging", "production", "disaster_recovery"]>;
            /** Legacy deployment-app-DB alias, only when it maps to the classification. */
            legacyAlias: z.ZodOptional<z.ZodEnum<["dev", "staging", "prod"]>>;
            /** Provider binding: reference to a hasna.environment_binding.v1 record. */
            binding: z.ZodTypeAny;
            desiredConfig: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            classification: "development" | "staging" | "production" | "disaster_recovery";
            desiredConfig: Record<string, unknown>;
            legacyAlias?: "dev" | "prod" | "staging" | undefined;
            binding?: any;
        }, {
            id: string;
            classification: "development" | "staging" | "production" | "disaster_recovery";
            desiredConfig?: Record<string, unknown> | undefined;
            legacyAlias?: "dev" | "prod" | "staging" | undefined;
            binding?: any;
        }>, {
            id: string;
            classification: "development" | "staging" | "production" | "disaster_recovery";
            desiredConfig: Record<string, unknown>;
            legacyAlias?: "dev" | "prod" | "staging" | undefined;
            binding?: any;
        }, {
            id: string;
            classification: "development" | "staging" | "production" | "disaster_recovery";
            desiredConfig?: Record<string, unknown> | undefined;
            legacyAlias?: "dev" | "prod" | "staging" | undefined;
            binding?: any;
        }>, "many">;
        resourceGraph: z.ZodObject<{
            resources: z.ZodArray<z.ZodEffects<z.ZodObject<{
                id: z.ZodString;
                provider: z.ZodEnum<["aws", "gcp", "azure", "cloudflare", "vercel", "railway", "flyio", "digitalocean", "other"]>;
                /** Canonical kind; must be a member of CANONICAL_RESOURCE_KINDS. */
                kind: z.ZodEnum<["compute", "database", "object_storage", "cache", "queue", "topic", "worker", "cron", "function", "secret", "domain", "dns", "cdn", "network", "identity", "observability", "other"]>;
                /** Source vocabulary of this resource's kind (provenance). */
                sourceVocabulary: z.ZodOptional<z.ZodEnum<["deployment_db", "app_cloud", "intent", "aws_plan"]>>;
                /** Kind as declared in the source vocabulary. */
                sourceKind: z.ZodOptional<z.ZodString>;
                ownerPackage: z.ZodTypeAny;
                region: z.ZodOptional<z.ZodString>;
                accountId: z.ZodOptional<z.ZodString>;
                uri: z.ZodOptional<z.ZodTypeAny>;
                dependsOn: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
                desiredConfig: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                kind: "function" | "network" | "other" | "worker" | "cron" | "database" | "object_storage" | "queue" | "identity" | "compute" | "cache" | "topic" | "secret" | "domain" | "dns" | "cdn" | "observability";
                provider: "aws" | "azure" | "other" | "gcp" | "cloudflare" | "vercel" | "railway" | "flyio" | "digitalocean";
                dependsOn: string[];
                desiredConfig: Record<string, unknown>;
                accountId?: string | undefined;
                uri?: any;
                ownerPackage?: any;
                region?: string | undefined;
                sourceVocabulary?: "intent" | "deployment_db" | "app_cloud" | "aws_plan" | undefined;
                sourceKind?: string | undefined;
            }, {
                id: string;
                kind: "function" | "network" | "other" | "worker" | "cron" | "database" | "object_storage" | "queue" | "identity" | "compute" | "cache" | "topic" | "secret" | "domain" | "dns" | "cdn" | "observability";
                provider: "aws" | "azure" | "other" | "gcp" | "cloudflare" | "vercel" | "railway" | "flyio" | "digitalocean";
                accountId?: string | undefined;
                uri?: any;
                ownerPackage?: any;
                region?: string | undefined;
                dependsOn?: string[] | undefined;
                sourceVocabulary?: "intent" | "deployment_db" | "app_cloud" | "aws_plan" | undefined;
                sourceKind?: string | undefined;
                desiredConfig?: Record<string, unknown> | undefined;
            }>, {
                id: string;
                kind: "function" | "network" | "other" | "worker" | "cron" | "database" | "object_storage" | "queue" | "identity" | "compute" | "cache" | "topic" | "secret" | "domain" | "dns" | "cdn" | "observability";
                provider: "aws" | "azure" | "other" | "gcp" | "cloudflare" | "vercel" | "railway" | "flyio" | "digitalocean";
                dependsOn: string[];
                desiredConfig: Record<string, unknown>;
                accountId?: string | undefined;
                uri?: any;
                ownerPackage?: any;
                region?: string | undefined;
                sourceVocabulary?: "intent" | "deployment_db" | "app_cloud" | "aws_plan" | undefined;
                sourceKind?: string | undefined;
            }, {
                id: string;
                kind: "function" | "network" | "other" | "worker" | "cron" | "database" | "object_storage" | "queue" | "identity" | "compute" | "cache" | "topic" | "secret" | "domain" | "dns" | "cdn" | "observability";
                provider: "aws" | "azure" | "other" | "gcp" | "cloudflare" | "vercel" | "railway" | "flyio" | "digitalocean";
                accountId?: string | undefined;
                uri?: any;
                ownerPackage?: any;
                region?: string | undefined;
                dependsOn?: string[] | undefined;
                sourceVocabulary?: "intent" | "deployment_db" | "app_cloud" | "aws_plan" | undefined;
                sourceKind?: string | undefined;
                desiredConfig?: Record<string, unknown> | undefined;
            }>, "many">;
        }, "strict", z.ZodTypeAny, {
            resources: {
                id: string;
                kind: "function" | "network" | "other" | "worker" | "cron" | "database" | "object_storage" | "queue" | "identity" | "compute" | "cache" | "topic" | "secret" | "domain" | "dns" | "cdn" | "observability";
                provider: "aws" | "azure" | "other" | "gcp" | "cloudflare" | "vercel" | "railway" | "flyio" | "digitalocean";
                dependsOn: string[];
                desiredConfig: Record<string, unknown>;
                accountId?: string | undefined;
                uri?: any;
                ownerPackage?: any;
                region?: string | undefined;
                sourceVocabulary?: "intent" | "deployment_db" | "app_cloud" | "aws_plan" | undefined;
                sourceKind?: string | undefined;
            }[];
        }, {
            resources: {
                id: string;
                kind: "function" | "network" | "other" | "worker" | "cron" | "database" | "object_storage" | "queue" | "identity" | "compute" | "cache" | "topic" | "secret" | "domain" | "dns" | "cdn" | "observability";
                provider: "aws" | "azure" | "other" | "gcp" | "cloudflare" | "vercel" | "railway" | "flyio" | "digitalocean";
                accountId?: string | undefined;
                uri?: any;
                ownerPackage?: any;
                region?: string | undefined;
                dependsOn?: string[] | undefined;
                sourceVocabulary?: "intent" | "deployment_db" | "app_cloud" | "aws_plan" | undefined;
                sourceKind?: string | undefined;
                desiredConfig?: Record<string, unknown> | undefined;
            }[];
        }>;
        artifacts: z.ZodDefault<z.ZodArray<z.ZodTypeAny, "many">>;
        deployProcedure: z.ZodObject<{
            requestKind: z.ZodEnum<["deployment", "promotion", "rollback", "reconciliation"]>;
            /** Executable form: reference to a hasna.deployment_plan.v1 record. */
            plan: z.ZodTypeAny;
            phases: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                approvalScope: z.ZodEnum<["none", "plan", "action", "phase"]>;
                actions: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    operationId: z.ZodString;
                    sideEffectClass: z.ZodTypeAny;
                    /** Required for every side-effecting action unless nonReversible is true. */
                    compensationOperationId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    /** Explicit non-reversible classification; the only alternative to compensation. */
                    nonReversible: z.ZodDefault<z.ZodBoolean>;
                    approvalScope: z.ZodDefault<z.ZodEnum<["none", "action", "phase"]>>;
                    evidenceRequirement: z.ZodOptional<z.ZodString>;
                }, "strict", z.ZodTypeAny, {
                    id: string;
                    operationId: string;
                    approvalScope: "action" | "none" | "phase";
                    nonReversible: boolean;
                    sideEffectClass?: any;
                    compensationOperationId?: string | null | undefined;
                    evidenceRequirement?: string | undefined;
                }, {
                    id: string;
                    operationId: string;
                    sideEffectClass?: any;
                    approvalScope?: "action" | "none" | "phase" | undefined;
                    compensationOperationId?: string | null | undefined;
                    nonReversible?: boolean | undefined;
                    evidenceRequirement?: string | undefined;
                }>, "many">;
            }, "strict", z.ZodTypeAny, {
                id: string;
                approvalScope: "action" | "none" | "plan" | "phase";
                actions: {
                    id: string;
                    operationId: string;
                    approvalScope: "action" | "none" | "phase";
                    nonReversible: boolean;
                    sideEffectClass?: any;
                    compensationOperationId?: string | null | undefined;
                    evidenceRequirement?: string | undefined;
                }[];
            }, {
                id: string;
                approvalScope: "action" | "none" | "plan" | "phase";
                actions: {
                    id: string;
                    operationId: string;
                    sideEffectClass?: any;
                    approvalScope?: "action" | "none" | "phase" | undefined;
                    compensationOperationId?: string | null | undefined;
                    nonReversible?: boolean | undefined;
                    evidenceRequirement?: string | undefined;
                }[];
            }>, "many">;
        }, "strict", z.ZodTypeAny, {
            requestKind: "reconciliation" | "deployment" | "promotion" | "rollback";
            phases: {
                id: string;
                approvalScope: "action" | "none" | "plan" | "phase";
                actions: {
                    id: string;
                    operationId: string;
                    approvalScope: "action" | "none" | "phase";
                    nonReversible: boolean;
                    sideEffectClass?: any;
                    compensationOperationId?: string | null | undefined;
                    evidenceRequirement?: string | undefined;
                }[];
            }[];
            plan?: any;
        }, {
            requestKind: "reconciliation" | "deployment" | "promotion" | "rollback";
            phases: {
                id: string;
                approvalScope: "action" | "none" | "plan" | "phase";
                actions: {
                    id: string;
                    operationId: string;
                    sideEffectClass?: any;
                    approvalScope?: "action" | "none" | "phase" | undefined;
                    compensationOperationId?: string | null | undefined;
                    nonReversible?: boolean | undefined;
                    evidenceRequirement?: string | undefined;
                }[];
            }[];
            plan?: any;
        }>;
        monitorWiring: z.ZodObject<{
            /** Owning monitoring surface (uptime, monitor, fleet, or none). */
            source: z.ZodEnum<["uptime", "monitor", "fleet", "none"]>;
            /** link_only until the deployment contract surface is live. */
            importMode: z.ZodDefault<z.ZodEnum<["link_only", "active"]>>;
            checks: z.ZodDefault<z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                kind: z.ZodEnum<["availability", "deployment", "host", "process", "tls", "domain_expiry", "health", "readiness"]>;
                endpoint: z.ZodOptional<z.ZodTypeAny>;
                expectedStatuses: z.ZodDefault<z.ZodArray<z.ZodNumber, "many">>;
                alarmClass: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                kind: "health" | "host" | "readiness" | "deployment" | "availability" | "process" | "tls" | "domain_expiry";
                expectedStatuses: number[];
                alarmClass?: string | undefined;
                endpoint?: any;
            }, {
                id: string;
                kind: "health" | "host" | "readiness" | "deployment" | "availability" | "process" | "tls" | "domain_expiry";
                expectedStatuses?: number[] | undefined;
                alarmClass?: string | undefined;
                endpoint?: any;
            }>, "many">>;
        }, "strict", z.ZodTypeAny, {
            checks: {
                id: string;
                kind: "health" | "host" | "readiness" | "deployment" | "availability" | "process" | "tls" | "domain_expiry";
                expectedStatuses: number[];
                alarmClass?: string | undefined;
                endpoint?: any;
            }[];
            source: "none" | "uptime" | "monitor" | "fleet";
            importMode: "active" | "link_only";
        }, {
            source: "none" | "uptime" | "monitor" | "fleet";
            checks?: {
                id: string;
                kind: "health" | "host" | "readiness" | "deployment" | "availability" | "process" | "tls" | "domain_expiry";
                expectedStatuses?: number[] | undefined;
                alarmClass?: string | undefined;
                endpoint?: any;
            }[] | undefined;
            importMode?: "active" | "link_only" | undefined;
        }>;
        rollback: z.ZodObject<{
            profile: z.ZodString;
            targetReceipt: z.ZodOptional<z.ZodTypeAny>;
        }, "strict", z.ZodTypeAny, {
            profile: string;
            targetReceipt?: any;
        }, {
            profile: string;
            targetReceipt?: any;
        }>;
        schema: z.ZodLiteral<"hasna.deployment_envelope.v1">;
        id: z.ZodString;
        createdAt: z.ZodTypeAny;
        updatedAt: z.ZodOptional<z.ZodNullable<z.ZodTypeAny>>;
        metadata: z.ZodOptional<z.ZodTypeAny>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        status: "draft" | "active";
        schema: "hasna.deployment_envelope.v1";
        audience: "internal" | "products";
        rollback: {
            profile: string;
            targetReceipt?: any;
        };
        contractKitVersion: "1.0.0";
        identity: {
            appId?: any;
            repositoryRef?: any;
            packageName?: any;
            projectsRef?: any;
        };
        ratification: {
            evidenceRefs: any[];
            gate: "one production deployment executed through this envelope with receipts and a passed live test";
            satisfied: boolean;
        };
        accountMapping: {
            accountId: string;
            audience: "internal" | "products";
            region?: string | undefined;
            purpose?: string | undefined;
        }[];
        environments: {
            id: string;
            classification: "development" | "staging" | "production" | "disaster_recovery";
            desiredConfig: Record<string, unknown>;
            legacyAlias?: "dev" | "prod" | "staging" | undefined;
            binding?: any;
        }[];
        resourceGraph: {
            resources: {
                id: string;
                kind: "function" | "network" | "other" | "worker" | "cron" | "database" | "object_storage" | "queue" | "identity" | "compute" | "cache" | "topic" | "secret" | "domain" | "dns" | "cdn" | "observability";
                provider: "aws" | "azure" | "other" | "gcp" | "cloudflare" | "vercel" | "railway" | "flyio" | "digitalocean";
                dependsOn: string[];
                desiredConfig: Record<string, unknown>;
                accountId?: string | undefined;
                uri?: any;
                ownerPackage?: any;
                region?: string | undefined;
                sourceVocabulary?: "intent" | "deployment_db" | "app_cloud" | "aws_plan" | undefined;
                sourceKind?: string | undefined;
            }[];
        };
        artifacts: any[];
        deployProcedure: {
            requestKind: "reconciliation" | "deployment" | "promotion" | "rollback";
            phases: {
                id: string;
                approvalScope: "action" | "none" | "plan" | "phase";
                actions: {
                    id: string;
                    operationId: string;
                    approvalScope: "action" | "none" | "phase";
                    nonReversible: boolean;
                    sideEffectClass?: any;
                    compensationOperationId?: string | null | undefined;
                    evidenceRequirement?: string | undefined;
                }[];
            }[];
            plan?: any;
        };
        monitorWiring: {
            checks: {
                id: string;
                kind: "health" | "host" | "readiness" | "deployment" | "availability" | "process" | "tls" | "domain_expiry";
                expectedStatuses: number[];
                alarmClass?: string | undefined;
                endpoint?: any;
            }[];
            source: "none" | "uptime" | "monitor" | "fleet";
            importMode: "active" | "link_only";
        };
        createdAt?: any;
        updatedAt?: any;
        metadata?: any;
    }, {
        id: string;
        schema: "hasna.deployment_envelope.v1";
        audience: "internal" | "products";
        rollback: {
            profile: string;
            targetReceipt?: any;
        };
        contractKitVersion: "1.0.0";
        identity: {
            appId?: any;
            repositoryRef?: any;
            packageName?: any;
            projectsRef?: any;
        };
        ratification: {
            gate: "one production deployment executed through this envelope with receipts and a passed live test";
            evidenceRefs?: any[] | undefined;
            satisfied?: boolean | undefined;
        };
        accountMapping: {
            accountId: string;
            audience: "internal" | "products";
            region?: string | undefined;
            purpose?: string | undefined;
        }[];
        environments: {
            id: string;
            classification: "development" | "staging" | "production" | "disaster_recovery";
            desiredConfig?: Record<string, unknown> | undefined;
            legacyAlias?: "dev" | "prod" | "staging" | undefined;
            binding?: any;
        }[];
        resourceGraph: {
            resources: {
                id: string;
                kind: "function" | "network" | "other" | "worker" | "cron" | "database" | "object_storage" | "queue" | "identity" | "compute" | "cache" | "topic" | "secret" | "domain" | "dns" | "cdn" | "observability";
                provider: "aws" | "azure" | "other" | "gcp" | "cloudflare" | "vercel" | "railway" | "flyio" | "digitalocean";
                accountId?: string | undefined;
                uri?: any;
                ownerPackage?: any;
                region?: string | undefined;
                dependsOn?: string[] | undefined;
                sourceVocabulary?: "intent" | "deployment_db" | "app_cloud" | "aws_plan" | undefined;
                sourceKind?: string | undefined;
                desiredConfig?: Record<string, unknown> | undefined;
            }[];
        };
        deployProcedure: {
            requestKind: "reconciliation" | "deployment" | "promotion" | "rollback";
            phases: {
                id: string;
                approvalScope: "action" | "none" | "plan" | "phase";
                actions: {
                    id: string;
                    operationId: string;
                    sideEffectClass?: any;
                    approvalScope?: "action" | "none" | "phase" | undefined;
                    compensationOperationId?: string | null | undefined;
                    nonReversible?: boolean | undefined;
                    evidenceRequirement?: string | undefined;
                }[];
            }[];
            plan?: any;
        };
        monitorWiring: {
            source: "none" | "uptime" | "monitor" | "fleet";
            checks?: {
                id: string;
                kind: "health" | "host" | "readiness" | "deployment" | "availability" | "process" | "tls" | "domain_expiry";
                expectedStatuses?: number[] | undefined;
                alarmClass?: string | undefined;
                endpoint?: any;
            }[] | undefined;
            importMode?: "active" | "link_only" | undefined;
        };
        status?: "draft" | "active" | undefined;
        createdAt?: any;
        updatedAt?: any;
        metadata?: any;
        artifacts?: any[] | undefined;
    }>, {
        id: string;
        status: "draft" | "active";
        schema: "hasna.deployment_envelope.v1";
        audience: "internal" | "products";
        rollback: {
            profile: string;
            targetReceipt?: any;
        };
        contractKitVersion: "1.0.0";
        identity: {
            appId?: any;
            repositoryRef?: any;
            packageName?: any;
            projectsRef?: any;
        };
        ratification: {
            evidenceRefs: any[];
            gate: "one production deployment executed through this envelope with receipts and a passed live test";
            satisfied: boolean;
        };
        accountMapping: {
            accountId: string;
            audience: "internal" | "products";
            region?: string | undefined;
            purpose?: string | undefined;
        }[];
        environments: {
            id: string;
            classification: "development" | "staging" | "production" | "disaster_recovery";
            desiredConfig: Record<string, unknown>;
            legacyAlias?: "dev" | "prod" | "staging" | undefined;
            binding?: any;
        }[];
        resourceGraph: {
            resources: {
                id: string;
                kind: "function" | "network" | "other" | "worker" | "cron" | "database" | "object_storage" | "queue" | "identity" | "compute" | "cache" | "topic" | "secret" | "domain" | "dns" | "cdn" | "observability";
                provider: "aws" | "azure" | "other" | "gcp" | "cloudflare" | "vercel" | "railway" | "flyio" | "digitalocean";
                dependsOn: string[];
                desiredConfig: Record<string, unknown>;
                accountId?: string | undefined;
                uri?: any;
                ownerPackage?: any;
                region?: string | undefined;
                sourceVocabulary?: "intent" | "deployment_db" | "app_cloud" | "aws_plan" | undefined;
                sourceKind?: string | undefined;
            }[];
        };
        artifacts: any[];
        deployProcedure: {
            requestKind: "reconciliation" | "deployment" | "promotion" | "rollback";
            phases: {
                id: string;
                approvalScope: "action" | "none" | "plan" | "phase";
                actions: {
                    id: string;
                    operationId: string;
                    approvalScope: "action" | "none" | "phase";
                    nonReversible: boolean;
                    sideEffectClass?: any;
                    compensationOperationId?: string | null | undefined;
                    evidenceRequirement?: string | undefined;
                }[];
            }[];
            plan?: any;
        };
        monitorWiring: {
            checks: {
                id: string;
                kind: "health" | "host" | "readiness" | "deployment" | "availability" | "process" | "tls" | "domain_expiry";
                expectedStatuses: number[];
                alarmClass?: string | undefined;
                endpoint?: any;
            }[];
            source: "none" | "uptime" | "monitor" | "fleet";
            importMode: "active" | "link_only";
        };
        createdAt?: any;
        updatedAt?: any;
        metadata?: any;
    }, {
        id: string;
        schema: "hasna.deployment_envelope.v1";
        audience: "internal" | "products";
        rollback: {
            profile: string;
            targetReceipt?: any;
        };
        contractKitVersion: "1.0.0";
        identity: {
            appId?: any;
            repositoryRef?: any;
            packageName?: any;
            projectsRef?: any;
        };
        ratification: {
            gate: "one production deployment executed through this envelope with receipts and a passed live test";
            evidenceRefs?: any[] | undefined;
            satisfied?: boolean | undefined;
        };
        accountMapping: {
            accountId: string;
            audience: "internal" | "products";
            region?: string | undefined;
            purpose?: string | undefined;
        }[];
        environments: {
            id: string;
            classification: "development" | "staging" | "production" | "disaster_recovery";
            desiredConfig?: Record<string, unknown> | undefined;
            legacyAlias?: "dev" | "prod" | "staging" | undefined;
            binding?: any;
        }[];
        resourceGraph: {
            resources: {
                id: string;
                kind: "function" | "network" | "other" | "worker" | "cron" | "database" | "object_storage" | "queue" | "identity" | "compute" | "cache" | "topic" | "secret" | "domain" | "dns" | "cdn" | "observability";
                provider: "aws" | "azure" | "other" | "gcp" | "cloudflare" | "vercel" | "railway" | "flyio" | "digitalocean";
                accountId?: string | undefined;
                uri?: any;
                ownerPackage?: any;
                region?: string | undefined;
                dependsOn?: string[] | undefined;
                sourceVocabulary?: "intent" | "deployment_db" | "app_cloud" | "aws_plan" | undefined;
                sourceKind?: string | undefined;
                desiredConfig?: Record<string, unknown> | undefined;
            }[];
        };
        deployProcedure: {
            requestKind: "reconciliation" | "deployment" | "promotion" | "rollback";
            phases: {
                id: string;
                approvalScope: "action" | "none" | "plan" | "phase";
                actions: {
                    id: string;
                    operationId: string;
                    sideEffectClass?: any;
                    approvalScope?: "action" | "none" | "phase" | undefined;
                    compensationOperationId?: string | null | undefined;
                    nonReversible?: boolean | undefined;
                    evidenceRequirement?: string | undefined;
                }[];
            }[];
            plan?: any;
        };
        monitorWiring: {
            source: "none" | "uptime" | "monitor" | "fleet";
            checks?: {
                id: string;
                kind: "health" | "host" | "readiness" | "deployment" | "availability" | "process" | "tls" | "domain_expiry";
                expectedStatuses?: number[] | undefined;
                alarmClass?: string | undefined;
                endpoint?: any;
            }[] | undefined;
            importMode?: "active" | "link_only" | undefined;
        };
        status?: "draft" | "active" | undefined;
        createdAt?: any;
        updatedAt?: any;
        metadata?: any;
        artifacts?: any[] | undefined;
    }>;
    readonly EnvelopeResourceSchema: z.ZodEffects<z.ZodObject<{
        id: z.ZodString;
        provider: z.ZodEnum<["aws", "gcp", "azure", "cloudflare", "vercel", "railway", "flyio", "digitalocean", "other"]>;
        /** Canonical kind; must be a member of CANONICAL_RESOURCE_KINDS. */
        kind: z.ZodEnum<["compute", "database", "object_storage", "cache", "queue", "topic", "worker", "cron", "function", "secret", "domain", "dns", "cdn", "network", "identity", "observability", "other"]>;
        /** Source vocabulary of this resource's kind (provenance). */
        sourceVocabulary: z.ZodOptional<z.ZodEnum<["deployment_db", "app_cloud", "intent", "aws_plan"]>>;
        /** Kind as declared in the source vocabulary. */
        sourceKind: z.ZodOptional<z.ZodString>;
        ownerPackage: z.ZodTypeAny;
        region: z.ZodOptional<z.ZodString>;
        accountId: z.ZodOptional<z.ZodString>;
        uri: z.ZodOptional<z.ZodTypeAny>;
        dependsOn: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        desiredConfig: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        kind: "function" | "network" | "other" | "worker" | "cron" | "database" | "object_storage" | "queue" | "identity" | "compute" | "cache" | "topic" | "secret" | "domain" | "dns" | "cdn" | "observability";
        provider: "aws" | "azure" | "other" | "gcp" | "cloudflare" | "vercel" | "railway" | "flyio" | "digitalocean";
        dependsOn: string[];
        desiredConfig: Record<string, unknown>;
        accountId?: string | undefined;
        uri?: any;
        ownerPackage?: any;
        region?: string | undefined;
        sourceVocabulary?: "intent" | "deployment_db" | "app_cloud" | "aws_plan" | undefined;
        sourceKind?: string | undefined;
    }, {
        id: string;
        kind: "function" | "network" | "other" | "worker" | "cron" | "database" | "object_storage" | "queue" | "identity" | "compute" | "cache" | "topic" | "secret" | "domain" | "dns" | "cdn" | "observability";
        provider: "aws" | "azure" | "other" | "gcp" | "cloudflare" | "vercel" | "railway" | "flyio" | "digitalocean";
        accountId?: string | undefined;
        uri?: any;
        ownerPackage?: any;
        region?: string | undefined;
        dependsOn?: string[] | undefined;
        sourceVocabulary?: "intent" | "deployment_db" | "app_cloud" | "aws_plan" | undefined;
        sourceKind?: string | undefined;
        desiredConfig?: Record<string, unknown> | undefined;
    }>, {
        id: string;
        kind: "function" | "network" | "other" | "worker" | "cron" | "database" | "object_storage" | "queue" | "identity" | "compute" | "cache" | "topic" | "secret" | "domain" | "dns" | "cdn" | "observability";
        provider: "aws" | "azure" | "other" | "gcp" | "cloudflare" | "vercel" | "railway" | "flyio" | "digitalocean";
        dependsOn: string[];
        desiredConfig: Record<string, unknown>;
        accountId?: string | undefined;
        uri?: any;
        ownerPackage?: any;
        region?: string | undefined;
        sourceVocabulary?: "intent" | "deployment_db" | "app_cloud" | "aws_plan" | undefined;
        sourceKind?: string | undefined;
    }, {
        id: string;
        kind: "function" | "network" | "other" | "worker" | "cron" | "database" | "object_storage" | "queue" | "identity" | "compute" | "cache" | "topic" | "secret" | "domain" | "dns" | "cdn" | "observability";
        provider: "aws" | "azure" | "other" | "gcp" | "cloudflare" | "vercel" | "railway" | "flyio" | "digitalocean";
        accountId?: string | undefined;
        uri?: any;
        ownerPackage?: any;
        region?: string | undefined;
        dependsOn?: string[] | undefined;
        sourceVocabulary?: "intent" | "deployment_db" | "app_cloud" | "aws_plan" | undefined;
        sourceKind?: string | undefined;
        desiredConfig?: Record<string, unknown> | undefined;
    }>;
    readonly EnvelopeEnvironmentSchema: z.ZodEffects<z.ZodObject<{
        id: z.ZodString;
        classification: z.ZodEnum<["development", "staging", "production", "disaster_recovery"]>;
        /** Legacy deployment-app-DB alias, only when it maps to the classification. */
        legacyAlias: z.ZodOptional<z.ZodEnum<["dev", "staging", "prod"]>>;
        /** Provider binding: reference to a hasna.environment_binding.v1 record. */
        binding: z.ZodTypeAny;
        desiredConfig: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        classification: "development" | "staging" | "production" | "disaster_recovery";
        desiredConfig: Record<string, unknown>;
        legacyAlias?: "dev" | "prod" | "staging" | undefined;
        binding?: any;
    }, {
        id: string;
        classification: "development" | "staging" | "production" | "disaster_recovery";
        desiredConfig?: Record<string, unknown> | undefined;
        legacyAlias?: "dev" | "prod" | "staging" | undefined;
        binding?: any;
    }>, {
        id: string;
        classification: "development" | "staging" | "production" | "disaster_recovery";
        desiredConfig: Record<string, unknown>;
        legacyAlias?: "dev" | "prod" | "staging" | undefined;
        binding?: any;
    }, {
        id: string;
        classification: "development" | "staging" | "production" | "disaster_recovery";
        desiredConfig?: Record<string, unknown> | undefined;
        legacyAlias?: "dev" | "prod" | "staging" | undefined;
        binding?: any;
    }>;
    readonly EnvelopePhaseSchema: z.ZodObject<{
        id: z.ZodString;
        approvalScope: z.ZodEnum<["none", "plan", "action", "phase"]>;
        actions: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            operationId: z.ZodString;
            sideEffectClass: z.ZodTypeAny;
            /** Required for every side-effecting action unless nonReversible is true. */
            compensationOperationId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            /** Explicit non-reversible classification; the only alternative to compensation. */
            nonReversible: z.ZodDefault<z.ZodBoolean>;
            approvalScope: z.ZodDefault<z.ZodEnum<["none", "action", "phase"]>>;
            evidenceRequirement: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            operationId: string;
            approvalScope: "action" | "none" | "phase";
            nonReversible: boolean;
            sideEffectClass?: any;
            compensationOperationId?: string | null | undefined;
            evidenceRequirement?: string | undefined;
        }, {
            id: string;
            operationId: string;
            sideEffectClass?: any;
            approvalScope?: "action" | "none" | "phase" | undefined;
            compensationOperationId?: string | null | undefined;
            nonReversible?: boolean | undefined;
            evidenceRequirement?: string | undefined;
        }>, "many">;
    }, "strict", z.ZodTypeAny, {
        id: string;
        approvalScope: "action" | "none" | "plan" | "phase";
        actions: {
            id: string;
            operationId: string;
            approvalScope: "action" | "none" | "phase";
            nonReversible: boolean;
            sideEffectClass?: any;
            compensationOperationId?: string | null | undefined;
            evidenceRequirement?: string | undefined;
        }[];
    }, {
        id: string;
        approvalScope: "action" | "none" | "plan" | "phase";
        actions: {
            id: string;
            operationId: string;
            sideEffectClass?: any;
            approvalScope?: "action" | "none" | "phase" | undefined;
            compensationOperationId?: string | null | undefined;
            nonReversible?: boolean | undefined;
            evidenceRequirement?: string | undefined;
        }[];
    }>;
    readonly EnvelopeActionSchema: z.ZodObject<{
        id: z.ZodString;
        operationId: z.ZodString;
        sideEffectClass: z.ZodTypeAny;
        /** Required for every side-effecting action unless nonReversible is true. */
        compensationOperationId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        /** Explicit non-reversible classification; the only alternative to compensation. */
        nonReversible: z.ZodDefault<z.ZodBoolean>;
        approvalScope: z.ZodDefault<z.ZodEnum<["none", "action", "phase"]>>;
        evidenceRequirement: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        operationId: string;
        approvalScope: "action" | "none" | "phase";
        nonReversible: boolean;
        sideEffectClass?: any;
        compensationOperationId?: string | null | undefined;
        evidenceRequirement?: string | undefined;
    }, {
        id: string;
        operationId: string;
        sideEffectClass?: any;
        approvalScope?: "action" | "none" | "phase" | undefined;
        compensationOperationId?: string | null | undefined;
        nonReversible?: boolean | undefined;
        evidenceRequirement?: string | undefined;
    }>;
};
export type DeploymentEnvelope = z.infer<ReturnType<typeof createDeploymentEnvelopeSchema>["DeploymentEnvelopeSchema"]>;
