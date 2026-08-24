import type { ActorPointer, CostEstimate, DecisionEnvelope, EvidencePointer, ProviderCapabilityCard, ResourcePointer, ValidationPlan, WorkRun } from "./schemas";
import { z } from "zod";
export declare const DEPLOYMENT_CONTRACT_VERSION: "1.0.0";
export declare const DEPLOYMENT_SCHEMA_IDS: {
    readonly productProjection: "hasna.product_projection.v1";
    readonly intentSnapshot: "hasna.intent_snapshot.v1";
    readonly verifiedSourceCandidate: "hasna.verified_source_candidate.v1";
    readonly buildArtifact: "hasna.build_artifact.v1";
    readonly artifactAttestation: "hasna.artifact_attestation.v1";
    readonly environmentBinding: "hasna.environment_binding.v1";
    readonly deploymentRequest: "hasna.deployment_request.v1";
    readonly deploymentPlan: "hasna.deployment_plan.v1";
    readonly deploymentApprovalDecision: "hasna.deployment_approval_decision.v1";
    readonly deploymentAttempt: "hasna.deployment_attempt.v1";
    readonly providerReceipt: "hasna.provider_receipt.v1";
    readonly deploymentReceipt: "hasna.deployment_receipt.v1";
    readonly launchEvidence: "hasna.launch_evidence.v1";
};
export type DeploymentSchemaId = (typeof DEPLOYMENT_SCHEMA_IDS)[keyof typeof DEPLOYMENT_SCHEMA_IDS];
export declare const DEPLOYMENT_GENERATED_ARTIFACT_ROOT: "generated/deployment/v1";
export declare function addDeploymentSafetyIssues(value: unknown, ctx: z.RefinementCtx, path?: Array<string | number>): void;
export declare function canonicalizeDeploymentValue(value: unknown): unknown;
export declare function stableDeploymentJson(value: unknown): string;
export declare function sha256DeploymentValue(value: unknown): string;
export declare function sha256DeploymentText(value: string): string;
export declare function computeDeploymentRecordDigest(value: Record<string, unknown>): string;
export declare function withDeploymentRecordDigest<T extends Record<string, unknown>>(value: T): T & {
    digest: string;
};
export declare function computeEnvironmentBindingEtag(id: string, revision: number): string;
export interface DeploymentPrimitiveSchemas {
    actorPointer: z.ZodType<ActorPointer, z.ZodTypeDef, any>;
    costEstimate: z.ZodType<CostEstimate, z.ZodTypeDef, any>;
    decisionEnvelope: z.ZodType<DecisionEnvelope, z.ZodTypeDef, any>;
    evidencePointer: z.ZodType<EvidencePointer, z.ZodTypeDef, any>;
    providerCapabilityCard: z.ZodType<ProviderCapabilityCard, z.ZodTypeDef, any>;
    resourcePointer: z.ZodType<ResourcePointer, z.ZodTypeDef, any>;
    validationPlan: z.ZodType<ValidationPlan, z.ZodTypeDef, any>;
    workRun: z.ZodType<WorkRun, z.ZodTypeDef, any>;
    schemaId: z.ZodType<string, z.ZodTypeDef, any>;
    timestamp: z.ZodType<string, z.ZodTypeDef, any>;
    uri: z.ZodType<string, z.ZodTypeDef, any>;
    sha256Digest: z.ZodType<string, z.ZodTypeDef, any>;
    relativeProjectPath: z.ZodType<string, z.ZodTypeDef, any>;
    providerSideEffectClass: z.ZodType<string, z.ZodTypeDef, any>;
}
export declare function createDeploymentSchemas(primitives: DeploymentPrimitiveSchemas): {
    readonly ProductProjectionRefSchema: z.ZodObject<{
        schema: z.ZodLiteral<"hasna.product_projection.v1">;
        id: z.ZodString;
        revision: z.ZodNumber;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.product_projection.v1";
        revision: number;
    }, {
        id: string;
        schema: "hasna.product_projection.v1";
        revision: number;
        digest?: any;
    }>;
    readonly IntentSnapshotRefSchema: z.ZodObject<{
        schema: z.ZodLiteral<"hasna.intent_snapshot.v1">;
        id: z.ZodString;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.intent_snapshot.v1";
    }, {
        id: string;
        schema: "hasna.intent_snapshot.v1";
        digest?: any;
    }>;
    readonly VerifiedSourceCandidateRefSchema: z.ZodObject<{
        schema: z.ZodLiteral<"hasna.verified_source_candidate.v1">;
        id: z.ZodString;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.verified_source_candidate.v1";
    }, {
        id: string;
        schema: "hasna.verified_source_candidate.v1";
        digest?: any;
    }>;
    readonly BuildArtifactRefSchema: z.ZodObject<{
        schema: z.ZodLiteral<"hasna.build_artifact.v1">;
        id: z.ZodString;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.build_artifact.v1";
    }, {
        id: string;
        schema: "hasna.build_artifact.v1";
        digest?: any;
    }>;
    readonly ArtifactAttestationRefSchema: z.ZodObject<{
        schema: z.ZodLiteral<"hasna.artifact_attestation.v1">;
        id: z.ZodString;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.artifact_attestation.v1";
    }, {
        id: string;
        schema: "hasna.artifact_attestation.v1";
        digest?: any;
    }>;
    readonly EnvironmentBindingRefSchema: z.ZodObject<{
        schema: z.ZodLiteral<"hasna.environment_binding.v1">;
        id: z.ZodString;
        revision: z.ZodNumber;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.environment_binding.v1";
        revision: number;
    }, {
        id: string;
        schema: "hasna.environment_binding.v1";
        revision: number;
        digest?: any;
    }>;
    readonly DeploymentRequestRefSchema: z.ZodObject<{
        schema: z.ZodLiteral<"hasna.deployment_request.v1">;
        id: z.ZodString;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.deployment_request.v1";
    }, {
        id: string;
        schema: "hasna.deployment_request.v1";
        digest?: any;
    }>;
    readonly DeploymentPlanRefSchema: z.ZodObject<{
        schema: z.ZodLiteral<"hasna.deployment_plan.v1">;
        id: z.ZodString;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.deployment_plan.v1";
    }, {
        id: string;
        schema: "hasna.deployment_plan.v1";
        digest?: any;
    }>;
    readonly DeploymentApprovalDecisionRefSchema: z.ZodObject<{
        schema: z.ZodLiteral<"hasna.deployment_approval_decision.v1">;
        id: z.ZodString;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.deployment_approval_decision.v1";
    }, {
        id: string;
        schema: "hasna.deployment_approval_decision.v1";
        digest?: any;
    }>;
    readonly DeploymentAttemptRefSchema: z.ZodObject<{
        schema: z.ZodLiteral<"hasna.deployment_attempt.v1">;
        id: z.ZodString;
        revision: z.ZodNumber;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.deployment_attempt.v1";
        revision: number;
    }, {
        id: string;
        schema: "hasna.deployment_attempt.v1";
        revision: number;
        digest?: any;
    }>;
    readonly ProviderReceiptRefSchema: z.ZodObject<{
        schema: z.ZodLiteral<"hasna.provider_receipt.v1">;
        id: z.ZodString;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.provider_receipt.v1";
    }, {
        id: string;
        schema: "hasna.provider_receipt.v1";
        digest?: any;
    }>;
    readonly DeploymentReceiptRefSchema: z.ZodObject<{
        schema: z.ZodLiteral<"hasna.deployment_receipt.v1">;
        id: z.ZodString;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.deployment_receipt.v1";
    }, {
        id: string;
        schema: "hasna.deployment_receipt.v1";
        digest?: any;
    }>;
    readonly ProductProjectionSchema: z.ZodEffects<z.ZodObject<{
        revision: z.ZodNumber;
        sourceProjectRef: z.ZodType<{
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }, z.ZodTypeDef, any>;
        sourceRevision: z.ZodNumber;
        slug: z.ZodString;
        displayName: z.ZodString;
        repositoryRef: z.ZodType<{
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }, z.ZodTypeDef, any>;
        workspaceRef: z.ZodType<{
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }, z.ZodTypeDef, any>;
        lifecycle: z.ZodEnum<["draft", "active", "paused", "archived"]>;
        ownerRefs: z.ZodArray<z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>, "many">;
        projectedAt: z.ZodType<string, z.ZodTypeDef, any>;
        sourceEvidenceRefs: z.ZodArray<z.ZodType<{
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }, z.ZodTypeDef, any>, "many">;
        schema: z.ZodLiteral<"hasna.product_projection.v1">;
        id: z.ZodString;
        createdAt: z.ZodType<string, z.ZodTypeDef, any>;
        producer: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.product_projection.v1";
        createdAt: string;
        revision: number;
        sourceProjectRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        sourceRevision: number;
        slug: string;
        displayName: string;
        repositoryRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        workspaceRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        lifecycle: "draft" | "active" | "paused" | "archived";
        ownerRefs: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }[];
        projectedAt: string;
        sourceEvidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
    }, {
        id: string;
        schema: "hasna.product_projection.v1";
        revision: number;
        sourceRevision: number;
        slug: string;
        displayName: string;
        lifecycle: "draft" | "active" | "paused" | "archived";
        ownerRefs: any[];
        sourceEvidenceRefs: any[];
        digest?: any;
        createdAt?: any;
        sourceProjectRef?: any;
        repositoryRef?: any;
        workspaceRef?: any;
        projectedAt?: any;
        producer?: any;
    }>, {
        id: string;
        digest: string;
        schema: "hasna.product_projection.v1";
        createdAt: string;
        revision: number;
        sourceProjectRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        sourceRevision: number;
        slug: string;
        displayName: string;
        repositoryRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        workspaceRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        lifecycle: "draft" | "active" | "paused" | "archived";
        ownerRefs: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }[];
        projectedAt: string;
        sourceEvidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
    }, {
        id: string;
        schema: "hasna.product_projection.v1";
        revision: number;
        sourceRevision: number;
        slug: string;
        displayName: string;
        lifecycle: "draft" | "active" | "paused" | "archived";
        ownerRefs: any[];
        sourceEvidenceRefs: any[];
        digest?: any;
        createdAt?: any;
        sourceProjectRef?: any;
        repositoryRef?: any;
        workspaceRef?: any;
        projectedAt?: any;
        producer?: any;
    }>;
    readonly IntentSnapshotSchema: z.ZodEffects<z.ZodObject<{
        product: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.product_projection.v1">;
            id: z.ZodString;
            revision: z.ZodNumber;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.product_projection.v1";
            revision: number;
        }, {
            id: string;
            schema: "hasna.product_projection.v1";
            revision: number;
            digest?: any;
        }>;
        repositoryRef: z.ZodType<{
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }, z.ZodTypeDef, any>;
        commitSha: z.ZodString;
        treeSha: z.ZodString;
        intentDocument: z.ZodObject<{
            path: z.ZodType<string, z.ZodTypeDef, any>;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            digest: string;
            path: string;
        }, {
            digest?: any;
            path?: any;
        }>;
        processes: z.ZodArray<z.ZodEffects<z.ZodObject<{
            id: z.ZodString;
            role: z.ZodEnum<["web", "worker", "cron", "migration", "scheduler"]>;
            ports: z.ZodDefault<z.ZodArray<z.ZodNumber, "many">>;
            liveness: z.ZodOptional<z.ZodEffects<z.ZodObject<{
                path: z.ZodString;
                protocol: z.ZodEnum<["http", "https"]>;
                expectedStatuses: z.ZodArray<z.ZodNumber, "many">;
            }, "strict", z.ZodTypeAny, {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            }, {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            }>, {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            }, {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            }>>;
            readiness: z.ZodOptional<z.ZodEffects<z.ZodObject<{
                path: z.ZodString;
                protocol: z.ZodEnum<["http", "https"]>;
                expectedStatuses: z.ZodArray<z.ZodNumber, "many">;
            }, "strict", z.ZodTypeAny, {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            }, {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            }>, {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            }, {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            }>>;
            version: z.ZodOptional<z.ZodEffects<z.ZodObject<{
                path: z.ZodString;
                protocol: z.ZodEnum<["http", "https"]>;
                expectedStatuses: z.ZodArray<z.ZodNumber, "many">;
            }, "strict", z.ZodTypeAny, {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            }, {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            }>, {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            }, {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            }>>;
            resources: z.ZodObject<{
                cpuMillicores: z.ZodNumber;
                memoryMiB: z.ZodNumber;
                minReplicas: z.ZodNumber;
                maxReplicas: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                cpuMillicores: number;
                memoryMiB: number;
                minReplicas: number;
                maxReplicas: number;
            }, {
                cpuMillicores: number;
                memoryMiB: number;
                minReplicas: number;
                maxReplicas: number;
            }>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            role: "web" | "worker" | "cron" | "migration" | "scheduler";
            ports: number[];
            resources: {
                cpuMillicores: number;
                memoryMiB: number;
                minReplicas: number;
                maxReplicas: number;
            };
            version?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
            liveness?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
            readiness?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
        }, {
            id: string;
            role: "web" | "worker" | "cron" | "migration" | "scheduler";
            resources: {
                cpuMillicores: number;
                memoryMiB: number;
                minReplicas: number;
                maxReplicas: number;
            };
            version?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
            ports?: number[] | undefined;
            liveness?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
            readiness?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
        }>, {
            id: string;
            role: "web" | "worker" | "cron" | "migration" | "scheduler";
            ports: number[];
            resources: {
                cpuMillicores: number;
                memoryMiB: number;
                minReplicas: number;
                maxReplicas: number;
            };
            version?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
            liveness?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
            readiness?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
        }, {
            id: string;
            role: "web" | "worker" | "cron" | "migration" | "scheduler";
            resources: {
                cpuMillicores: number;
                memoryMiB: number;
                minReplicas: number;
                maxReplicas: number;
            };
            version?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
            ports?: number[] | undefined;
            liveness?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
            readiness?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
        }>, "many">;
        serviceRequirements: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<["database", "object_storage", "queue", "cron", "worker"]>;
            required: z.ZodBoolean;
            class: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            id: string;
            kind: "worker" | "cron" | "database" | "object_storage" | "queue";
            required: boolean;
            class: string;
        }, {
            id: string;
            kind: "worker" | "cron" | "database" | "object_storage" | "queue";
            required: boolean;
            class: string;
        }>, "many">>;
        migration: z.ZodObject<{
            compatibility: z.ZodEnum<["none", "backward_compatible", "forward_compatible", "breaking"]>;
            order: z.ZodEnum<["before_workload", "after_workload", "independent"]>;
            rollbackClass: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            compatibility: "none" | "backward_compatible" | "forward_compatible" | "breaking";
            order: "before_workload" | "after_workload" | "independent";
            rollbackClass: string;
        }, {
            compatibility: "none" | "backward_compatible" | "forward_compatible" | "breaking";
            order: "before_workload" | "after_workload" | "independent";
            rollbackClass: string;
        }>;
        accessClass: z.ZodString;
        networkClass: z.ZodString;
        backupClass: z.ZodString;
        restoreClass: z.ZodString;
        alarmClass: z.ZodString;
        rollbackClass: z.ZodString;
        configurationRequirements: z.ZodDefault<z.ZodArray<z.ZodEffects<z.ZodObject<{
            name: z.ZodString;
            kind: z.ZodEnum<["configuration", "secret_reference"]>;
            required: z.ZodBoolean;
            referenceClass: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            name: string;
            kind: "configuration" | "secret_reference";
            required: boolean;
            referenceClass?: string | undefined;
        }, {
            name: string;
            kind: "configuration" | "secret_reference";
            required: boolean;
            referenceClass?: string | undefined;
        }>, {
            name: string;
            kind: "configuration" | "secret_reference";
            required: boolean;
            referenceClass?: string | undefined;
        }, {
            name: string;
            kind: "configuration" | "secret_reference";
            required: boolean;
            referenceClass?: string | undefined;
        }>, "many">>;
        validationPlan: z.ZodType<{
            id: string;
            checks: {
                id: string;
                kind: "review" | "security" | "eval" | "other" | "command" | "test" | "typecheck" | "lint" | "deploy" | "smoke" | "manual";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                required: boolean;
                expected?: string | undefined;
                command?: string | undefined;
                timeoutMs?: number | undefined;
            }[];
            schema: "hasna.validation_plan.v1";
            createdAt: string;
            objective: string;
            requiredEvidenceKinds: ("report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace")[];
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            subject?: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            } | undefined;
            verifier?: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            } | undefined;
        }, z.ZodTypeDef, any>;
        evidenceRefs: z.ZodArray<z.ZodType<{
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }, z.ZodTypeDef, any>, "many">;
        schema: z.ZodLiteral<"hasna.intent_snapshot.v1">;
        id: z.ZodString;
        createdAt: z.ZodType<string, z.ZodTypeDef, any>;
        producer: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.intent_snapshot.v1";
        createdAt: string;
        evidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        repositoryRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        migration: {
            compatibility: "none" | "backward_compatible" | "forward_compatible" | "breaking";
            order: "before_workload" | "after_workload" | "independent";
            rollbackClass: string;
        };
        product: {
            id: string;
            digest: string;
            schema: "hasna.product_projection.v1";
            revision: number;
        };
        commitSha: string;
        treeSha: string;
        intentDocument: {
            digest: string;
            path: string;
        };
        processes: {
            id: string;
            role: "web" | "worker" | "cron" | "migration" | "scheduler";
            ports: number[];
            resources: {
                cpuMillicores: number;
                memoryMiB: number;
                minReplicas: number;
                maxReplicas: number;
            };
            version?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
            liveness?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
            readiness?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
        }[];
        serviceRequirements: {
            id: string;
            kind: "worker" | "cron" | "database" | "object_storage" | "queue";
            required: boolean;
            class: string;
        }[];
        rollbackClass: string;
        accessClass: string;
        networkClass: string;
        backupClass: string;
        restoreClass: string;
        alarmClass: string;
        configurationRequirements: {
            name: string;
            kind: "configuration" | "secret_reference";
            required: boolean;
            referenceClass?: string | undefined;
        }[];
        validationPlan: {
            id: string;
            checks: {
                id: string;
                kind: "review" | "security" | "eval" | "other" | "command" | "test" | "typecheck" | "lint" | "deploy" | "smoke" | "manual";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                required: boolean;
                expected?: string | undefined;
                command?: string | undefined;
                timeoutMs?: number | undefined;
            }[];
            schema: "hasna.validation_plan.v1";
            createdAt: string;
            objective: string;
            requiredEvidenceKinds: ("report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace")[];
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            subject?: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            } | undefined;
            verifier?: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            } | undefined;
        };
    }, {
        id: string;
        schema: "hasna.intent_snapshot.v1";
        evidenceRefs: any[];
        migration: {
            compatibility: "none" | "backward_compatible" | "forward_compatible" | "breaking";
            order: "before_workload" | "after_workload" | "independent";
            rollbackClass: string;
        };
        product: {
            id: string;
            schema: "hasna.product_projection.v1";
            revision: number;
            digest?: any;
        };
        commitSha: string;
        treeSha: string;
        intentDocument: {
            digest?: any;
            path?: any;
        };
        processes: {
            id: string;
            role: "web" | "worker" | "cron" | "migration" | "scheduler";
            resources: {
                cpuMillicores: number;
                memoryMiB: number;
                minReplicas: number;
                maxReplicas: number;
            };
            version?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
            ports?: number[] | undefined;
            liveness?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
            readiness?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
        }[];
        rollbackClass: string;
        accessClass: string;
        networkClass: string;
        backupClass: string;
        restoreClass: string;
        alarmClass: string;
        digest?: any;
        createdAt?: any;
        repositoryRef?: any;
        producer?: any;
        serviceRequirements?: {
            id: string;
            kind: "worker" | "cron" | "database" | "object_storage" | "queue";
            required: boolean;
            class: string;
        }[] | undefined;
        configurationRequirements?: {
            name: string;
            kind: "configuration" | "secret_reference";
            required: boolean;
            referenceClass?: string | undefined;
        }[] | undefined;
        validationPlan?: any;
    }>, {
        id: string;
        digest: string;
        schema: "hasna.intent_snapshot.v1";
        createdAt: string;
        evidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        repositoryRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        migration: {
            compatibility: "none" | "backward_compatible" | "forward_compatible" | "breaking";
            order: "before_workload" | "after_workload" | "independent";
            rollbackClass: string;
        };
        product: {
            id: string;
            digest: string;
            schema: "hasna.product_projection.v1";
            revision: number;
        };
        commitSha: string;
        treeSha: string;
        intentDocument: {
            digest: string;
            path: string;
        };
        processes: {
            id: string;
            role: "web" | "worker" | "cron" | "migration" | "scheduler";
            ports: number[];
            resources: {
                cpuMillicores: number;
                memoryMiB: number;
                minReplicas: number;
                maxReplicas: number;
            };
            version?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
            liveness?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
            readiness?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
        }[];
        serviceRequirements: {
            id: string;
            kind: "worker" | "cron" | "database" | "object_storage" | "queue";
            required: boolean;
            class: string;
        }[];
        rollbackClass: string;
        accessClass: string;
        networkClass: string;
        backupClass: string;
        restoreClass: string;
        alarmClass: string;
        configurationRequirements: {
            name: string;
            kind: "configuration" | "secret_reference";
            required: boolean;
            referenceClass?: string | undefined;
        }[];
        validationPlan: {
            id: string;
            checks: {
                id: string;
                kind: "review" | "security" | "eval" | "other" | "command" | "test" | "typecheck" | "lint" | "deploy" | "smoke" | "manual";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                required: boolean;
                expected?: string | undefined;
                command?: string | undefined;
                timeoutMs?: number | undefined;
            }[];
            schema: "hasna.validation_plan.v1";
            createdAt: string;
            objective: string;
            requiredEvidenceKinds: ("report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace")[];
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            subject?: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            } | undefined;
            verifier?: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            } | undefined;
        };
    }, {
        id: string;
        schema: "hasna.intent_snapshot.v1";
        evidenceRefs: any[];
        migration: {
            compatibility: "none" | "backward_compatible" | "forward_compatible" | "breaking";
            order: "before_workload" | "after_workload" | "independent";
            rollbackClass: string;
        };
        product: {
            id: string;
            schema: "hasna.product_projection.v1";
            revision: number;
            digest?: any;
        };
        commitSha: string;
        treeSha: string;
        intentDocument: {
            digest?: any;
            path?: any;
        };
        processes: {
            id: string;
            role: "web" | "worker" | "cron" | "migration" | "scheduler";
            resources: {
                cpuMillicores: number;
                memoryMiB: number;
                minReplicas: number;
                maxReplicas: number;
            };
            version?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
            ports?: number[] | undefined;
            liveness?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
            readiness?: {
                path: string;
                protocol: "http" | "https";
                expectedStatuses: number[];
            } | undefined;
        }[];
        rollbackClass: string;
        accessClass: string;
        networkClass: string;
        backupClass: string;
        restoreClass: string;
        alarmClass: string;
        digest?: any;
        createdAt?: any;
        repositoryRef?: any;
        producer?: any;
        serviceRequirements?: {
            id: string;
            kind: "worker" | "cron" | "database" | "object_storage" | "queue";
            required: boolean;
            class: string;
        }[] | undefined;
        configurationRequirements?: {
            name: string;
            kind: "configuration" | "secret_reference";
            required: boolean;
            referenceClass?: string | undefined;
        }[] | undefined;
        validationPlan?: any;
    }>;
    readonly VerifiedSourceCandidateSchema: z.ZodEffects<z.ZodObject<{
        status: z.ZodEnum<["candidate", "verified", "rejected", "superseded"]>;
        repositoryRef: z.ZodType<{
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }, z.ZodTypeDef, any>;
        commitSha: z.ZodString;
        treeSha: z.ZodString;
        branchRef: z.ZodOptional<z.ZodType<{
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }, z.ZodTypeDef, any>>;
        pullRequestRef: z.ZodOptional<z.ZodType<{
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }, z.ZodTypeDef, any>>;
        intent: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.intent_snapshot.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.intent_snapshot.v1";
        }, {
            id: string;
            schema: "hasna.intent_snapshot.v1";
            digest?: any;
        }>;
        validationPlan: z.ZodType<{
            id: string;
            checks: {
                id: string;
                kind: "review" | "security" | "eval" | "other" | "command" | "test" | "typecheck" | "lint" | "deploy" | "smoke" | "manual";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                required: boolean;
                expected?: string | undefined;
                command?: string | undefined;
                timeoutMs?: number | undefined;
            }[];
            schema: "hasna.validation_plan.v1";
            createdAt: string;
            objective: string;
            requiredEvidenceKinds: ("report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace")[];
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            subject?: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            } | undefined;
            verifier?: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            } | undefined;
        }, z.ZodTypeDef, any>;
        verificationRun: z.ZodType<{
            actor: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            id: string;
            status: "unknown" | "skipped" | "pending" | "running" | "succeeded" | "failed" | "cancelled" | "blocked";
            schema: "hasna.work_run.v1";
            createdAt: string;
            resourceRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            objective: string;
            constraints: string[];
            decisions: {
                id: string;
                status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
                schema: "hasna.decision_envelope.v1";
                createdAt: string;
                decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
                selected: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                skipped: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                reason: string;
                obligations: string[];
                redactions: string[];
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                actor?: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                } | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                traceId?: string | undefined;
                inputHash?: string | undefined;
                policyBundleId?: string | undefined;
                costEstimate?: {
                    id: string;
                    schema: "hasna.cost_estimate.v1";
                    createdAt: string;
                    currency: string;
                    amountMicros: number;
                    basis: "limit" | "actual" | "estimated" | "budget";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    model?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    promptTokens?: number | undefined;
                    completionTokens?: number | undefined;
                    totalTokens?: number | undefined;
                } | undefined;
            }[];
            costEstimates: {
                id: string;
                schema: "hasna.cost_estimate.v1";
                createdAt: string;
                currency: string;
                amountMicros: number;
                basis: "limit" | "actual" | "estimated" | "budget";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                model?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                promptTokens?: number | undefined;
                completionTokens?: number | undefined;
                totalTokens?: number | undefined;
            }[];
            validationPlanRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            proofBundleRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            traceId?: string | undefined;
            startedAt?: string | null | undefined;
            finishedAt?: string | null | undefined;
        }, z.ZodTypeDef, any>;
        results: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<["review", "test", "policy", "source_integrity"]>;
            status: z.ZodEnum<["passed", "failed", "not_run"]>;
            evidenceRefs: z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
        }, "strict", z.ZodTypeAny, {
            id: string;
            kind: "review" | "policy" | "test" | "source_integrity";
            status: "failed" | "passed" | "not_run";
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
        }, {
            id: string;
            kind: "review" | "policy" | "test" | "source_integrity";
            status: "failed" | "passed" | "not_run";
            evidenceRefs: any[];
        }>, "many">;
        verifiers: z.ZodArray<z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>, "many">;
        verifiedAt: z.ZodType<string, z.ZodTypeDef, any>;
        evidenceRefs: z.ZodArray<z.ZodType<{
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }, z.ZodTypeDef, any>, "many">;
        schema: z.ZodLiteral<"hasna.verified_source_candidate.v1">;
        id: z.ZodString;
        createdAt: z.ZodType<string, z.ZodTypeDef, any>;
        producer: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        status: "candidate" | "verified" | "rejected" | "superseded";
        schema: "hasna.verified_source_candidate.v1";
        createdAt: string;
        evidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        repositoryRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        commitSha: string;
        treeSha: string;
        validationPlan: {
            id: string;
            checks: {
                id: string;
                kind: "review" | "security" | "eval" | "other" | "command" | "test" | "typecheck" | "lint" | "deploy" | "smoke" | "manual";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                required: boolean;
                expected?: string | undefined;
                command?: string | undefined;
                timeoutMs?: number | undefined;
            }[];
            schema: "hasna.validation_plan.v1";
            createdAt: string;
            objective: string;
            requiredEvidenceKinds: ("report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace")[];
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            subject?: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            } | undefined;
            verifier?: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            } | undefined;
        };
        intent: {
            id: string;
            digest: string;
            schema: "hasna.intent_snapshot.v1";
        };
        verificationRun: {
            actor: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            id: string;
            status: "unknown" | "skipped" | "pending" | "running" | "succeeded" | "failed" | "cancelled" | "blocked";
            schema: "hasna.work_run.v1";
            createdAt: string;
            resourceRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            objective: string;
            constraints: string[];
            decisions: {
                id: string;
                status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
                schema: "hasna.decision_envelope.v1";
                createdAt: string;
                decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
                selected: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                skipped: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                reason: string;
                obligations: string[];
                redactions: string[];
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                actor?: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                } | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                traceId?: string | undefined;
                inputHash?: string | undefined;
                policyBundleId?: string | undefined;
                costEstimate?: {
                    id: string;
                    schema: "hasna.cost_estimate.v1";
                    createdAt: string;
                    currency: string;
                    amountMicros: number;
                    basis: "limit" | "actual" | "estimated" | "budget";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    model?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    promptTokens?: number | undefined;
                    completionTokens?: number | undefined;
                    totalTokens?: number | undefined;
                } | undefined;
            }[];
            costEstimates: {
                id: string;
                schema: "hasna.cost_estimate.v1";
                createdAt: string;
                currency: string;
                amountMicros: number;
                basis: "limit" | "actual" | "estimated" | "budget";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                model?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                promptTokens?: number | undefined;
                completionTokens?: number | undefined;
                totalTokens?: number | undefined;
            }[];
            validationPlanRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            proofBundleRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            traceId?: string | undefined;
            startedAt?: string | null | undefined;
            finishedAt?: string | null | undefined;
        };
        results: {
            id: string;
            kind: "review" | "policy" | "test" | "source_integrity";
            status: "failed" | "passed" | "not_run";
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
        }[];
        verifiers: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }[];
        verifiedAt: string;
        branchRef?: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        } | undefined;
        pullRequestRef?: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        } | undefined;
    }, {
        id: string;
        status: "candidate" | "verified" | "rejected" | "superseded";
        schema: "hasna.verified_source_candidate.v1";
        evidenceRefs: any[];
        commitSha: string;
        treeSha: string;
        intent: {
            id: string;
            schema: "hasna.intent_snapshot.v1";
            digest?: any;
        };
        results: {
            id: string;
            kind: "review" | "policy" | "test" | "source_integrity";
            status: "failed" | "passed" | "not_run";
            evidenceRefs: any[];
        }[];
        verifiers: any[];
        digest?: any;
        createdAt?: any;
        repositoryRef?: any;
        producer?: any;
        validationPlan?: any;
        branchRef?: any;
        pullRequestRef?: any;
        verificationRun?: any;
        verifiedAt?: any;
    }>, {
        id: string;
        digest: string;
        status: "candidate" | "verified" | "rejected" | "superseded";
        schema: "hasna.verified_source_candidate.v1";
        createdAt: string;
        evidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        repositoryRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        commitSha: string;
        treeSha: string;
        validationPlan: {
            id: string;
            checks: {
                id: string;
                kind: "review" | "security" | "eval" | "other" | "command" | "test" | "typecheck" | "lint" | "deploy" | "smoke" | "manual";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                required: boolean;
                expected?: string | undefined;
                command?: string | undefined;
                timeoutMs?: number | undefined;
            }[];
            schema: "hasna.validation_plan.v1";
            createdAt: string;
            objective: string;
            requiredEvidenceKinds: ("report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace")[];
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            subject?: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            } | undefined;
            verifier?: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            } | undefined;
        };
        intent: {
            id: string;
            digest: string;
            schema: "hasna.intent_snapshot.v1";
        };
        verificationRun: {
            actor: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            id: string;
            status: "unknown" | "skipped" | "pending" | "running" | "succeeded" | "failed" | "cancelled" | "blocked";
            schema: "hasna.work_run.v1";
            createdAt: string;
            resourceRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            objective: string;
            constraints: string[];
            decisions: {
                id: string;
                status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
                schema: "hasna.decision_envelope.v1";
                createdAt: string;
                decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
                selected: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                skipped: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                reason: string;
                obligations: string[];
                redactions: string[];
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                actor?: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                } | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                traceId?: string | undefined;
                inputHash?: string | undefined;
                policyBundleId?: string | undefined;
                costEstimate?: {
                    id: string;
                    schema: "hasna.cost_estimate.v1";
                    createdAt: string;
                    currency: string;
                    amountMicros: number;
                    basis: "limit" | "actual" | "estimated" | "budget";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    model?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    promptTokens?: number | undefined;
                    completionTokens?: number | undefined;
                    totalTokens?: number | undefined;
                } | undefined;
            }[];
            costEstimates: {
                id: string;
                schema: "hasna.cost_estimate.v1";
                createdAt: string;
                currency: string;
                amountMicros: number;
                basis: "limit" | "actual" | "estimated" | "budget";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                model?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                promptTokens?: number | undefined;
                completionTokens?: number | undefined;
                totalTokens?: number | undefined;
            }[];
            validationPlanRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            proofBundleRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            traceId?: string | undefined;
            startedAt?: string | null | undefined;
            finishedAt?: string | null | undefined;
        };
        results: {
            id: string;
            kind: "review" | "policy" | "test" | "source_integrity";
            status: "failed" | "passed" | "not_run";
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
        }[];
        verifiers: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }[];
        verifiedAt: string;
        branchRef?: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        } | undefined;
        pullRequestRef?: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        } | undefined;
    }, {
        id: string;
        status: "candidate" | "verified" | "rejected" | "superseded";
        schema: "hasna.verified_source_candidate.v1";
        evidenceRefs: any[];
        commitSha: string;
        treeSha: string;
        intent: {
            id: string;
            schema: "hasna.intent_snapshot.v1";
            digest?: any;
        };
        results: {
            id: string;
            kind: "review" | "policy" | "test" | "source_integrity";
            status: "failed" | "passed" | "not_run";
            evidenceRefs: any[];
        }[];
        verifiers: any[];
        digest?: any;
        createdAt?: any;
        repositoryRef?: any;
        producer?: any;
        validationPlan?: any;
        branchRef?: any;
        pullRequestRef?: any;
        verificationRun?: any;
        verifiedAt?: any;
    }>;
    readonly BuildArtifactSchema: z.ZodEffects<z.ZodObject<{
        kind: z.ZodEnum<["oci_image", "archive", "binary"]>;
        mediaType: z.ZodString;
        uri: z.ZodType<string, z.ZodTypeDef, any>;
        artifactDigest: z.ZodType<string, z.ZodTypeDef, any>;
        sourceCandidate: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.verified_source_candidate.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.verified_source_candidate.v1";
        }, {
            id: string;
            schema: "hasna.verified_source_candidate.v1";
            digest?: any;
        }>;
        repositoryCommitSha: z.ZodString;
        repositoryTreeSha: z.ZodString;
        buildWorkflowRef: z.ZodType<{
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }, z.ZodTypeDef, any>;
        buildRun: z.ZodType<{
            actor: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            id: string;
            status: "unknown" | "skipped" | "pending" | "running" | "succeeded" | "failed" | "cancelled" | "blocked";
            schema: "hasna.work_run.v1";
            createdAt: string;
            resourceRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            objective: string;
            constraints: string[];
            decisions: {
                id: string;
                status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
                schema: "hasna.decision_envelope.v1";
                createdAt: string;
                decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
                selected: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                skipped: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                reason: string;
                obligations: string[];
                redactions: string[];
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                actor?: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                } | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                traceId?: string | undefined;
                inputHash?: string | undefined;
                policyBundleId?: string | undefined;
                costEstimate?: {
                    id: string;
                    schema: "hasna.cost_estimate.v1";
                    createdAt: string;
                    currency: string;
                    amountMicros: number;
                    basis: "limit" | "actual" | "estimated" | "budget";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    model?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    promptTokens?: number | undefined;
                    completionTokens?: number | undefined;
                    totalTokens?: number | undefined;
                } | undefined;
            }[];
            costEstimates: {
                id: string;
                schema: "hasna.cost_estimate.v1";
                createdAt: string;
                currency: string;
                amountMicros: number;
                basis: "limit" | "actual" | "estimated" | "budget";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                model?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                promptTokens?: number | undefined;
                completionTokens?: number | undefined;
                totalTokens?: number | undefined;
            }[];
            validationPlanRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            proofBundleRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            traceId?: string | undefined;
            startedAt?: string | null | undefined;
            finishedAt?: string | null | undefined;
        }, z.ZodTypeDef, any>;
        builder: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        sbomRefs: z.ZodDefault<z.ZodArray<z.ZodType<{
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }, z.ZodTypeDef, any>, "many">>;
        provenanceRefs: z.ZodDefault<z.ZodArray<z.ZodType<{
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }, z.ZodTypeDef, any>, "many">>;
        scanRefs: z.ZodDefault<z.ZodArray<z.ZodType<{
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }, z.ZodTypeDef, any>, "many">>;
        signatureRefs: z.ZodDefault<z.ZodArray<z.ZodType<{
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }, z.ZodTypeDef, any>, "many">>;
        status: z.ZodEnum<["active", "superseded", "revoked"]>;
        schema: z.ZodLiteral<"hasna.build_artifact.v1">;
        id: z.ZodString;
        createdAt: z.ZodType<string, z.ZodTypeDef, any>;
        producer: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        kind: "binary" | "oci_image" | "archive";
        digest: string;
        mediaType: string;
        status: "active" | "superseded" | "revoked";
        schema: "hasna.build_artifact.v1";
        createdAt: string;
        uri: string;
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        artifactDigest: string;
        sourceCandidate: {
            id: string;
            digest: string;
            schema: "hasna.verified_source_candidate.v1";
        };
        repositoryCommitSha: string;
        repositoryTreeSha: string;
        buildWorkflowRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        buildRun: {
            actor: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            id: string;
            status: "unknown" | "skipped" | "pending" | "running" | "succeeded" | "failed" | "cancelled" | "blocked";
            schema: "hasna.work_run.v1";
            createdAt: string;
            resourceRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            objective: string;
            constraints: string[];
            decisions: {
                id: string;
                status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
                schema: "hasna.decision_envelope.v1";
                createdAt: string;
                decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
                selected: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                skipped: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                reason: string;
                obligations: string[];
                redactions: string[];
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                actor?: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                } | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                traceId?: string | undefined;
                inputHash?: string | undefined;
                policyBundleId?: string | undefined;
                costEstimate?: {
                    id: string;
                    schema: "hasna.cost_estimate.v1";
                    createdAt: string;
                    currency: string;
                    amountMicros: number;
                    basis: "limit" | "actual" | "estimated" | "budget";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    model?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    promptTokens?: number | undefined;
                    completionTokens?: number | undefined;
                    totalTokens?: number | undefined;
                } | undefined;
            }[];
            costEstimates: {
                id: string;
                schema: "hasna.cost_estimate.v1";
                createdAt: string;
                currency: string;
                amountMicros: number;
                basis: "limit" | "actual" | "estimated" | "budget";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                model?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                promptTokens?: number | undefined;
                completionTokens?: number | undefined;
                totalTokens?: number | undefined;
            }[];
            validationPlanRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            proofBundleRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            traceId?: string | undefined;
            startedAt?: string | null | undefined;
            finishedAt?: string | null | undefined;
        };
        builder: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        sbomRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        provenanceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        scanRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        signatureRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
    }, {
        id: string;
        kind: "binary" | "oci_image" | "archive";
        mediaType: string;
        status: "active" | "superseded" | "revoked";
        schema: "hasna.build_artifact.v1";
        sourceCandidate: {
            id: string;
            schema: "hasna.verified_source_candidate.v1";
            digest?: any;
        };
        repositoryCommitSha: string;
        repositoryTreeSha: string;
        digest?: any;
        createdAt?: any;
        uri?: any;
        producer?: any;
        artifactDigest?: any;
        buildWorkflowRef?: any;
        buildRun?: any;
        builder?: any;
        sbomRefs?: any[] | undefined;
        provenanceRefs?: any[] | undefined;
        scanRefs?: any[] | undefined;
        signatureRefs?: any[] | undefined;
    }>, {
        id: string;
        kind: "binary" | "oci_image" | "archive";
        digest: string;
        mediaType: string;
        status: "active" | "superseded" | "revoked";
        schema: "hasna.build_artifact.v1";
        createdAt: string;
        uri: string;
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        artifactDigest: string;
        sourceCandidate: {
            id: string;
            digest: string;
            schema: "hasna.verified_source_candidate.v1";
        };
        repositoryCommitSha: string;
        repositoryTreeSha: string;
        buildWorkflowRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        buildRun: {
            actor: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            id: string;
            status: "unknown" | "skipped" | "pending" | "running" | "succeeded" | "failed" | "cancelled" | "blocked";
            schema: "hasna.work_run.v1";
            createdAt: string;
            resourceRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            objective: string;
            constraints: string[];
            decisions: {
                id: string;
                status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
                schema: "hasna.decision_envelope.v1";
                createdAt: string;
                decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
                selected: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                skipped: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                reason: string;
                obligations: string[];
                redactions: string[];
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                actor?: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                } | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                traceId?: string | undefined;
                inputHash?: string | undefined;
                policyBundleId?: string | undefined;
                costEstimate?: {
                    id: string;
                    schema: "hasna.cost_estimate.v1";
                    createdAt: string;
                    currency: string;
                    amountMicros: number;
                    basis: "limit" | "actual" | "estimated" | "budget";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    model?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    promptTokens?: number | undefined;
                    completionTokens?: number | undefined;
                    totalTokens?: number | undefined;
                } | undefined;
            }[];
            costEstimates: {
                id: string;
                schema: "hasna.cost_estimate.v1";
                createdAt: string;
                currency: string;
                amountMicros: number;
                basis: "limit" | "actual" | "estimated" | "budget";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                model?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                promptTokens?: number | undefined;
                completionTokens?: number | undefined;
                totalTokens?: number | undefined;
            }[];
            validationPlanRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            proofBundleRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            traceId?: string | undefined;
            startedAt?: string | null | undefined;
            finishedAt?: string | null | undefined;
        };
        builder: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        sbomRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        provenanceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        scanRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        signatureRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
    }, {
        id: string;
        kind: "binary" | "oci_image" | "archive";
        mediaType: string;
        status: "active" | "superseded" | "revoked";
        schema: "hasna.build_artifact.v1";
        sourceCandidate: {
            id: string;
            schema: "hasna.verified_source_candidate.v1";
            digest?: any;
        };
        repositoryCommitSha: string;
        repositoryTreeSha: string;
        digest?: any;
        createdAt?: any;
        uri?: any;
        producer?: any;
        artifactDigest?: any;
        buildWorkflowRef?: any;
        buildRun?: any;
        builder?: any;
        sbomRefs?: any[] | undefined;
        provenanceRefs?: any[] | undefined;
        scanRefs?: any[] | undefined;
        signatureRefs?: any[] | undefined;
    }>;
    readonly ArtifactAttestationSchema: z.ZodEffects<z.ZodObject<{
        artifact: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.build_artifact.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.build_artifact.v1";
        }, {
            id: string;
            schema: "hasna.build_artifact.v1";
            digest?: any;
        }>;
        artifactDigest: z.ZodType<string, z.ZodTypeDef, any>;
        predicateKind: z.ZodString;
        predicateSchemaVersion: z.ZodString;
        issuer: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        keyRef: z.ZodType<{
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }, z.ZodTypeDef, any>;
        signatureRef: z.ZodType<{
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }, z.ZodTypeDef, any>;
        policyResult: z.ZodEnum<["passed", "failed"]>;
        policyRevision: z.ZodNumber;
        expiresAt: z.ZodOptional<z.ZodNullable<z.ZodType<string, z.ZodTypeDef, any>>>;
        evidenceRefs: z.ZodArray<z.ZodType<{
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }, z.ZodTypeDef, any>, "many">;
        schema: z.ZodLiteral<"hasna.artifact_attestation.v1">;
        id: z.ZodString;
        createdAt: z.ZodType<string, z.ZodTypeDef, any>;
        producer: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.artifact_attestation.v1";
        createdAt: string;
        artifact: {
            id: string;
            digest: string;
            schema: "hasna.build_artifact.v1";
        };
        evidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        artifactDigest: string;
        predicateKind: string;
        predicateSchemaVersion: string;
        issuer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        keyRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        signatureRef: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        };
        policyResult: "failed" | "passed";
        policyRevision: number;
        expiresAt?: string | null | undefined;
    }, {
        id: string;
        schema: "hasna.artifact_attestation.v1";
        artifact: {
            id: string;
            schema: "hasna.build_artifact.v1";
            digest?: any;
        };
        evidenceRefs: any[];
        predicateKind: string;
        predicateSchemaVersion: string;
        policyResult: "failed" | "passed";
        policyRevision: number;
        digest?: any;
        createdAt?: any;
        producer?: any;
        artifactDigest?: any;
        issuer?: any;
        keyRef?: any;
        signatureRef?: any;
        expiresAt?: any;
    }>, {
        id: string;
        digest: string;
        schema: "hasna.artifact_attestation.v1";
        createdAt: string;
        artifact: {
            id: string;
            digest: string;
            schema: "hasna.build_artifact.v1";
        };
        evidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        artifactDigest: string;
        predicateKind: string;
        predicateSchemaVersion: string;
        issuer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        keyRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        signatureRef: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        };
        policyResult: "failed" | "passed";
        policyRevision: number;
        expiresAt?: string | null | undefined;
    }, {
        id: string;
        schema: "hasna.artifact_attestation.v1";
        artifact: {
            id: string;
            schema: "hasna.build_artifact.v1";
            digest?: any;
        };
        evidenceRefs: any[];
        predicateKind: string;
        predicateSchemaVersion: string;
        policyResult: "failed" | "passed";
        policyRevision: number;
        digest?: any;
        createdAt?: any;
        producer?: any;
        artifactDigest?: any;
        issuer?: any;
        keyRef?: any;
        signatureRef?: any;
        expiresAt?: any;
    }>;
    readonly EnvironmentBindingSchema: z.ZodEffects<z.ZodObject<{
        updatedAt: z.ZodType<string, z.ZodTypeDef, any>;
        revision: z.ZodNumber;
        etag: z.ZodType<string, z.ZodTypeDef, any>;
        product: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.product_projection.v1">;
            id: z.ZodString;
            revision: z.ZodNumber;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.product_projection.v1";
            revision: number;
        }, {
            id: string;
            schema: "hasna.product_projection.v1";
            revision: number;
            digest?: any;
        }>;
        intent: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.intent_snapshot.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.intent_snapshot.v1";
        }, {
            id: string;
            schema: "hasna.intent_snapshot.v1";
            digest?: any;
        }>;
        environment: z.ZodObject<{
            id: z.ZodString;
            classification: z.ZodEnum<["development", "staging", "production", "disaster_recovery"]>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            classification: "development" | "staging" | "production" | "disaster_recovery";
        }, {
            id: string;
            classification: "development" | "staging" | "production" | "disaster_recovery";
        }>;
        dataBackend: z.ZodEnum<["sqlite", "postgresql"]>;
        providerConnectionRef: z.ZodType<{
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }, z.ZodTypeDef, any>;
        providerCapabilityCard: z.ZodType<{
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            providerId: string;
            appId: string;
            adapterId: string;
            ownerPackage: string;
            modes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
            defaultMode: "mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating";
            credentialRequirements: {
                refName: string;
                requiredForModes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
                allowedSecretInputs: ("credential_ref" | "lease_ref")[];
                failClosedDiagnostic: string;
                revocationCheck: boolean;
            }[];
            operations: {
                operation: string;
                supportedModes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
                sideEffectClass: "none" | "read_only" | "external_notification" | "external_mutation" | "money_movement" | "dns_or_domain_change" | "bulk_message_or_call" | "legal_or_filing" | "compute_or_infra_mutation" | "irreversible";
                requiresApproval: boolean;
                requiresIdempotencyKey: boolean;
                requiresSandboxEvidence: boolean;
                requiresRollbackOrRevocation: boolean;
                rollbackOrRevocation?: string | undefined;
                noSideEffectSmoke?: string | undefined;
                reconciliation?: string | undefined;
            }[];
            rateLimitPosture: string;
            auditEvents: string[];
            redactionRules: string[];
            costPosture?: string | undefined;
        }, z.ZodTypeDef, any>;
        providerCapabilityDigest: z.ZodType<string, z.ZodTypeDef, any>;
        providerIdentity: z.ZodEffects<z.ZodObject<{
            accountId: z.ZodString;
            region: z.ZodString;
            projectId: z.ZodOptional<z.ZodString>;
            clusterId: z.ZodOptional<z.ZodString>;
            networkId: z.ZodOptional<z.ZodString>;
            storageId: z.ZodOptional<z.ZodString>;
            routingId: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            accountId: string;
            region: string;
            projectId?: string | undefined;
            clusterId?: string | undefined;
            networkId?: string | undefined;
            storageId?: string | undefined;
            routingId?: string | undefined;
        }, {
            accountId: string;
            region: string;
            projectId?: string | undefined;
            clusterId?: string | undefined;
            networkId?: string | undefined;
            storageId?: string | undefined;
            routingId?: string | undefined;
        }>, {
            accountId: string;
            region: string;
            projectId?: string | undefined;
            clusterId?: string | undefined;
            networkId?: string | undefined;
            storageId?: string | undefined;
            routingId?: string | undefined;
        }, {
            accountId: string;
            region: string;
            projectId?: string | undefined;
            clusterId?: string | undefined;
            networkId?: string | undefined;
            storageId?: string | undefined;
            routingId?: string | undefined;
        }>;
        policyProfile: z.ZodString;
        authorizationProfile: z.ZodString;
        dataClassification: z.ZodEnum<["public", "internal", "private", "sensitive"]>;
        backupProfile: z.ZodString;
        rollbackProfile: z.ZodString;
        commercialBindingRef: z.ZodOptional<z.ZodType<{
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }, z.ZodTypeDef, any>>;
        writer: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        changeEvidenceRefs: z.ZodArray<z.ZodType<{
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }, z.ZodTypeDef, any>, "many">;
        schema: z.ZodLiteral<"hasna.environment_binding.v1">;
        id: z.ZodString;
        createdAt: z.ZodType<string, z.ZodTypeDef, any>;
        producer: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.environment_binding.v1";
        createdAt: string;
        updatedAt: string;
        revision: number;
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        product: {
            id: string;
            digest: string;
            schema: "hasna.product_projection.v1";
            revision: number;
        };
        intent: {
            id: string;
            digest: string;
            schema: "hasna.intent_snapshot.v1";
        };
        etag: string;
        environment: {
            id: string;
            classification: "development" | "staging" | "production" | "disaster_recovery";
        };
        dataBackend: "sqlite" | "postgresql";
        providerConnectionRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        providerCapabilityCard: {
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            providerId: string;
            appId: string;
            adapterId: string;
            ownerPackage: string;
            modes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
            defaultMode: "mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating";
            credentialRequirements: {
                refName: string;
                requiredForModes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
                allowedSecretInputs: ("credential_ref" | "lease_ref")[];
                failClosedDiagnostic: string;
                revocationCheck: boolean;
            }[];
            operations: {
                operation: string;
                supportedModes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
                sideEffectClass: "none" | "read_only" | "external_notification" | "external_mutation" | "money_movement" | "dns_or_domain_change" | "bulk_message_or_call" | "legal_or_filing" | "compute_or_infra_mutation" | "irreversible";
                requiresApproval: boolean;
                requiresIdempotencyKey: boolean;
                requiresSandboxEvidence: boolean;
                requiresRollbackOrRevocation: boolean;
                rollbackOrRevocation?: string | undefined;
                noSideEffectSmoke?: string | undefined;
                reconciliation?: string | undefined;
            }[];
            rateLimitPosture: string;
            auditEvents: string[];
            redactionRules: string[];
            costPosture?: string | undefined;
        };
        providerCapabilityDigest: string;
        providerIdentity: {
            accountId: string;
            region: string;
            projectId?: string | undefined;
            clusterId?: string | undefined;
            networkId?: string | undefined;
            storageId?: string | undefined;
            routingId?: string | undefined;
        };
        policyProfile: string;
        authorizationProfile: string;
        dataClassification: "public" | "internal" | "private" | "sensitive";
        backupProfile: string;
        rollbackProfile: string;
        writer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        changeEvidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        commercialBindingRef?: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        } | undefined;
    }, {
        id: string;
        schema: "hasna.environment_binding.v1";
        revision: number;
        product: {
            id: string;
            schema: "hasna.product_projection.v1";
            revision: number;
            digest?: any;
        };
        intent: {
            id: string;
            schema: "hasna.intent_snapshot.v1";
            digest?: any;
        };
        environment: {
            id: string;
            classification: "development" | "staging" | "production" | "disaster_recovery";
        };
        dataBackend: "sqlite" | "postgresql";
        providerIdentity: {
            accountId: string;
            region: string;
            projectId?: string | undefined;
            clusterId?: string | undefined;
            networkId?: string | undefined;
            storageId?: string | undefined;
            routingId?: string | undefined;
        };
        policyProfile: string;
        authorizationProfile: string;
        dataClassification: "public" | "internal" | "private" | "sensitive";
        backupProfile: string;
        rollbackProfile: string;
        changeEvidenceRefs: any[];
        digest?: any;
        createdAt?: any;
        updatedAt?: any;
        producer?: any;
        etag?: any;
        providerConnectionRef?: any;
        providerCapabilityCard?: any;
        providerCapabilityDigest?: any;
        commercialBindingRef?: any;
        writer?: any;
    }>, {
        id: string;
        digest: string;
        schema: "hasna.environment_binding.v1";
        createdAt: string;
        updatedAt: string;
        revision: number;
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        product: {
            id: string;
            digest: string;
            schema: "hasna.product_projection.v1";
            revision: number;
        };
        intent: {
            id: string;
            digest: string;
            schema: "hasna.intent_snapshot.v1";
        };
        etag: string;
        environment: {
            id: string;
            classification: "development" | "staging" | "production" | "disaster_recovery";
        };
        dataBackend: "sqlite" | "postgresql";
        providerConnectionRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        providerCapabilityCard: {
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            providerId: string;
            appId: string;
            adapterId: string;
            ownerPackage: string;
            modes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
            defaultMode: "mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating";
            credentialRequirements: {
                refName: string;
                requiredForModes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
                allowedSecretInputs: ("credential_ref" | "lease_ref")[];
                failClosedDiagnostic: string;
                revocationCheck: boolean;
            }[];
            operations: {
                operation: string;
                supportedModes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
                sideEffectClass: "none" | "read_only" | "external_notification" | "external_mutation" | "money_movement" | "dns_or_domain_change" | "bulk_message_or_call" | "legal_or_filing" | "compute_or_infra_mutation" | "irreversible";
                requiresApproval: boolean;
                requiresIdempotencyKey: boolean;
                requiresSandboxEvidence: boolean;
                requiresRollbackOrRevocation: boolean;
                rollbackOrRevocation?: string | undefined;
                noSideEffectSmoke?: string | undefined;
                reconciliation?: string | undefined;
            }[];
            rateLimitPosture: string;
            auditEvents: string[];
            redactionRules: string[];
            costPosture?: string | undefined;
        };
        providerCapabilityDigest: string;
        providerIdentity: {
            accountId: string;
            region: string;
            projectId?: string | undefined;
            clusterId?: string | undefined;
            networkId?: string | undefined;
            storageId?: string | undefined;
            routingId?: string | undefined;
        };
        policyProfile: string;
        authorizationProfile: string;
        dataClassification: "public" | "internal" | "private" | "sensitive";
        backupProfile: string;
        rollbackProfile: string;
        writer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        changeEvidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        commercialBindingRef?: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        } | undefined;
    }, {
        id: string;
        schema: "hasna.environment_binding.v1";
        revision: number;
        product: {
            id: string;
            schema: "hasna.product_projection.v1";
            revision: number;
            digest?: any;
        };
        intent: {
            id: string;
            schema: "hasna.intent_snapshot.v1";
            digest?: any;
        };
        environment: {
            id: string;
            classification: "development" | "staging" | "production" | "disaster_recovery";
        };
        dataBackend: "sqlite" | "postgresql";
        providerIdentity: {
            accountId: string;
            region: string;
            projectId?: string | undefined;
            clusterId?: string | undefined;
            networkId?: string | undefined;
            storageId?: string | undefined;
            routingId?: string | undefined;
        };
        policyProfile: string;
        authorizationProfile: string;
        dataClassification: "public" | "internal" | "private" | "sensitive";
        backupProfile: string;
        rollbackProfile: string;
        changeEvidenceRefs: any[];
        digest?: any;
        createdAt?: any;
        updatedAt?: any;
        producer?: any;
        etag?: any;
        providerConnectionRef?: any;
        providerCapabilityCard?: any;
        providerCapabilityDigest?: any;
        commercialBindingRef?: any;
        writer?: any;
    }>;
    readonly DeploymentRequestSchema: z.ZodEffects<z.ZodObject<{
        kind: z.ZodEnum<["deployment", "promotion", "rollback", "reconciliation"]>;
        requester: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        product: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.product_projection.v1">;
            id: z.ZodString;
            revision: z.ZodNumber;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.product_projection.v1";
            revision: number;
        }, {
            id: string;
            schema: "hasna.product_projection.v1";
            revision: number;
            digest?: any;
        }>;
        environment: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.environment_binding.v1">;
            id: z.ZodString;
            revision: z.ZodNumber;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
        }, {
            id: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
            digest?: any;
        }>;
        intent: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.intent_snapshot.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.intent_snapshot.v1";
        }, {
            id: string;
            schema: "hasna.intent_snapshot.v1";
            digest?: any;
        }>;
        artifact: z.ZodOptional<z.ZodObject<{
            schema: z.ZodLiteral<"hasna.build_artifact.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.build_artifact.v1";
        }, {
            id: string;
            schema: "hasna.build_artifact.v1";
            digest?: any;
        }>>;
        attestations: z.ZodDefault<z.ZodArray<z.ZodObject<{
            schema: z.ZodLiteral<"hasna.artifact_attestation.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.artifact_attestation.v1";
        }, {
            id: string;
            schema: "hasna.artifact_attestation.v1";
            digest?: any;
        }>, "many">>;
        priorReceipt: z.ZodOptional<z.ZodObject<{
            schema: z.ZodLiteral<"hasna.deployment_receipt.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.deployment_receipt.v1";
        }, {
            id: string;
            schema: "hasna.deployment_receipt.v1";
            digest?: any;
        }>>;
        policyProfile: z.ZodString;
        idempotencyKeyFingerprint: z.ZodType<string, z.ZodTypeDef, any>;
        requestAt: z.ZodType<string, z.ZodTypeDef, any>;
        expiresAt: z.ZodOptional<z.ZodNullable<z.ZodType<string, z.ZodTypeDef, any>>>;
        sourceRequestId: z.ZodString;
        auditCorrelationId: z.ZodString;
        costEstimate: z.ZodOptional<z.ZodType<{
            id: string;
            schema: "hasna.cost_estimate.v1";
            createdAt: string;
            currency: string;
            amountMicros: number;
            basis: "limit" | "actual" | "estimated" | "budget";
            resourceRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            model?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            promptTokens?: number | undefined;
            completionTokens?: number | undefined;
            totalTokens?: number | undefined;
        }, z.ZodTypeDef, any>>;
        evidenceRefs: z.ZodArray<z.ZodType<{
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }, z.ZodTypeDef, any>, "many">;
        schema: z.ZodLiteral<"hasna.deployment_request.v1">;
        id: z.ZodString;
        createdAt: z.ZodType<string, z.ZodTypeDef, any>;
        producer: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        kind: "reconciliation" | "deployment" | "promotion" | "rollback";
        digest: string;
        schema: "hasna.deployment_request.v1";
        createdAt: string;
        evidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        product: {
            id: string;
            digest: string;
            schema: "hasna.product_projection.v1";
            revision: number;
        };
        intent: {
            id: string;
            digest: string;
            schema: "hasna.intent_snapshot.v1";
        };
        environment: {
            id: string;
            digest: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
        };
        policyProfile: string;
        requester: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        attestations: {
            id: string;
            digest: string;
            schema: "hasna.artifact_attestation.v1";
        }[];
        idempotencyKeyFingerprint: string;
        requestAt: string;
        sourceRequestId: string;
        auditCorrelationId: string;
        artifact?: {
            id: string;
            digest: string;
            schema: "hasna.build_artifact.v1";
        } | undefined;
        costEstimate?: {
            id: string;
            schema: "hasna.cost_estimate.v1";
            createdAt: string;
            currency: string;
            amountMicros: number;
            basis: "limit" | "actual" | "estimated" | "budget";
            resourceRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            model?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            promptTokens?: number | undefined;
            completionTokens?: number | undefined;
            totalTokens?: number | undefined;
        } | undefined;
        expiresAt?: string | null | undefined;
        priorReceipt?: {
            id: string;
            digest: string;
            schema: "hasna.deployment_receipt.v1";
        } | undefined;
    }, {
        id: string;
        kind: "reconciliation" | "deployment" | "promotion" | "rollback";
        schema: "hasna.deployment_request.v1";
        evidenceRefs: any[];
        product: {
            id: string;
            schema: "hasna.product_projection.v1";
            revision: number;
            digest?: any;
        };
        intent: {
            id: string;
            schema: "hasna.intent_snapshot.v1";
            digest?: any;
        };
        environment: {
            id: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
            digest?: any;
        };
        policyProfile: string;
        sourceRequestId: string;
        auditCorrelationId: string;
        digest?: any;
        createdAt?: any;
        artifact?: {
            id: string;
            schema: "hasna.build_artifact.v1";
            digest?: any;
        } | undefined;
        costEstimate?: any;
        producer?: any;
        expiresAt?: any;
        requester?: any;
        attestations?: {
            id: string;
            schema: "hasna.artifact_attestation.v1";
            digest?: any;
        }[] | undefined;
        priorReceipt?: {
            id: string;
            schema: "hasna.deployment_receipt.v1";
            digest?: any;
        } | undefined;
        idempotencyKeyFingerprint?: any;
        requestAt?: any;
    }>, {
        id: string;
        kind: "reconciliation" | "deployment" | "promotion" | "rollback";
        digest: string;
        schema: "hasna.deployment_request.v1";
        createdAt: string;
        evidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        product: {
            id: string;
            digest: string;
            schema: "hasna.product_projection.v1";
            revision: number;
        };
        intent: {
            id: string;
            digest: string;
            schema: "hasna.intent_snapshot.v1";
        };
        environment: {
            id: string;
            digest: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
        };
        policyProfile: string;
        requester: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        attestations: {
            id: string;
            digest: string;
            schema: "hasna.artifact_attestation.v1";
        }[];
        idempotencyKeyFingerprint: string;
        requestAt: string;
        sourceRequestId: string;
        auditCorrelationId: string;
        artifact?: {
            id: string;
            digest: string;
            schema: "hasna.build_artifact.v1";
        } | undefined;
        costEstimate?: {
            id: string;
            schema: "hasna.cost_estimate.v1";
            createdAt: string;
            currency: string;
            amountMicros: number;
            basis: "limit" | "actual" | "estimated" | "budget";
            resourceRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            model?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            promptTokens?: number | undefined;
            completionTokens?: number | undefined;
            totalTokens?: number | undefined;
        } | undefined;
        expiresAt?: string | null | undefined;
        priorReceipt?: {
            id: string;
            digest: string;
            schema: "hasna.deployment_receipt.v1";
        } | undefined;
    }, {
        id: string;
        kind: "reconciliation" | "deployment" | "promotion" | "rollback";
        schema: "hasna.deployment_request.v1";
        evidenceRefs: any[];
        product: {
            id: string;
            schema: "hasna.product_projection.v1";
            revision: number;
            digest?: any;
        };
        intent: {
            id: string;
            schema: "hasna.intent_snapshot.v1";
            digest?: any;
        };
        environment: {
            id: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
            digest?: any;
        };
        policyProfile: string;
        sourceRequestId: string;
        auditCorrelationId: string;
        digest?: any;
        createdAt?: any;
        artifact?: {
            id: string;
            schema: "hasna.build_artifact.v1";
            digest?: any;
        } | undefined;
        costEstimate?: any;
        producer?: any;
        expiresAt?: any;
        requester?: any;
        attestations?: {
            id: string;
            schema: "hasna.artifact_attestation.v1";
            digest?: any;
        }[] | undefined;
        priorReceipt?: {
            id: string;
            schema: "hasna.deployment_receipt.v1";
            digest?: any;
        } | undefined;
        idempotencyKeyFingerprint?: any;
        requestAt?: any;
    }>;
    readonly DeploymentActionSchema: z.ZodEffects<z.ZodObject<{
        id: z.ZodString;
        operationId: z.ZodString;
        operationVersion: z.ZodNumber;
        dependsOn: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        inputs: z.ZodDefault<z.ZodArray<z.ZodObject<{
            schema: z.ZodType<string, z.ZodTypeDef, any>;
            id: z.ZodString;
            revision: z.ZodOptional<z.ZodNumber>;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: string;
            revision?: number | undefined;
        }, {
            id: string;
            digest?: any;
            schema?: any;
            revision?: number | undefined;
        }>, "many">>;
        outputSchema: z.ZodType<string, z.ZodTypeDef, any>;
        preconditions: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        postconditions: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        lockClass: z.ZodString;
        fencingRequired: z.ZodBoolean;
        sideEffectClass: z.ZodType<string, z.ZodTypeDef, any>;
        riskClass: z.ZodEnum<["low", "medium", "high", "critical"]>;
        approvalScope: z.ZodEnum<["none", "plan", "action", "phase"]>;
        runtimeMaterialKind: z.ZodNullable<z.ZodString>;
        providerOperation: z.ZodNullable<z.ZodString>;
        providerCapabilityDigest: z.ZodNullable<z.ZodType<string, z.ZodTypeDef, any>>;
        retryClass: z.ZodEnum<["none", "safe", "reconcile_first"]>;
        maxAttempts: z.ZodNumber;
        timeoutClass: z.ZodString;
        compensationOperationId: z.ZodNullable<z.ZodString>;
        idempotencyRequired: z.ZodBoolean;
        reconciliationRequired: z.ZodBoolean;
        evidenceRequirements: z.ZodArray<z.ZodString, "many">;
    }, "strict", z.ZodTypeAny, {
        id: string;
        sideEffectClass: string;
        providerCapabilityDigest: string | null;
        operationId: string;
        operationVersion: number;
        dependsOn: string[];
        inputs: {
            id: string;
            digest: string;
            schema: string;
            revision?: number | undefined;
        }[];
        outputSchema: string;
        preconditions: string[];
        postconditions: string[];
        lockClass: string;
        fencingRequired: boolean;
        riskClass: "low" | "medium" | "high" | "critical";
        approvalScope: "action" | "none" | "plan" | "phase";
        runtimeMaterialKind: string | null;
        providerOperation: string | null;
        retryClass: "safe" | "none" | "reconcile_first";
        maxAttempts: number;
        timeoutClass: string;
        compensationOperationId: string | null;
        idempotencyRequired: boolean;
        reconciliationRequired: boolean;
        evidenceRequirements: string[];
    }, {
        id: string;
        operationId: string;
        operationVersion: number;
        lockClass: string;
        fencingRequired: boolean;
        riskClass: "low" | "medium" | "high" | "critical";
        approvalScope: "action" | "none" | "plan" | "phase";
        runtimeMaterialKind: string | null;
        providerOperation: string | null;
        retryClass: "safe" | "none" | "reconcile_first";
        maxAttempts: number;
        timeoutClass: string;
        compensationOperationId: string | null;
        idempotencyRequired: boolean;
        reconciliationRequired: boolean;
        evidenceRequirements: string[];
        sideEffectClass?: any;
        providerCapabilityDigest?: any;
        dependsOn?: string[] | undefined;
        inputs?: {
            id: string;
            digest?: any;
            schema?: any;
            revision?: number | undefined;
        }[] | undefined;
        outputSchema?: any;
        preconditions?: string[] | undefined;
        postconditions?: string[] | undefined;
    }>, {
        id: string;
        sideEffectClass: string;
        providerCapabilityDigest: string | null;
        operationId: string;
        operationVersion: number;
        dependsOn: string[];
        inputs: {
            id: string;
            digest: string;
            schema: string;
            revision?: number | undefined;
        }[];
        outputSchema: string;
        preconditions: string[];
        postconditions: string[];
        lockClass: string;
        fencingRequired: boolean;
        riskClass: "low" | "medium" | "high" | "critical";
        approvalScope: "action" | "none" | "plan" | "phase";
        runtimeMaterialKind: string | null;
        providerOperation: string | null;
        retryClass: "safe" | "none" | "reconcile_first";
        maxAttempts: number;
        timeoutClass: string;
        compensationOperationId: string | null;
        idempotencyRequired: boolean;
        reconciliationRequired: boolean;
        evidenceRequirements: string[];
    }, {
        id: string;
        operationId: string;
        operationVersion: number;
        lockClass: string;
        fencingRequired: boolean;
        riskClass: "low" | "medium" | "high" | "critical";
        approvalScope: "action" | "none" | "plan" | "phase";
        runtimeMaterialKind: string | null;
        providerOperation: string | null;
        retryClass: "safe" | "none" | "reconcile_first";
        maxAttempts: number;
        timeoutClass: string;
        compensationOperationId: string | null;
        idempotencyRequired: boolean;
        reconciliationRequired: boolean;
        evidenceRequirements: string[];
        sideEffectClass?: any;
        providerCapabilityDigest?: any;
        dependsOn?: string[] | undefined;
        inputs?: {
            id: string;
            digest?: any;
            schema?: any;
            revision?: number | undefined;
        }[] | undefined;
        outputSchema?: any;
        preconditions?: string[] | undefined;
        postconditions?: string[] | undefined;
    }>;
    readonly DeploymentPlanSchema: z.ZodEffects<z.ZodObject<{
        kind: z.ZodEnum<["deployment", "promotion", "rollback", "reconciliation"]>;
        request: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.deployment_request.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.deployment_request.v1";
        }, {
            id: string;
            schema: "hasna.deployment_request.v1";
            digest?: any;
        }>;
        compiler: z.ZodObject<{
            actor: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            version: z.ZodString;
            contractKitVersion: z.ZodLiteral<"1.0.0">;
        }, "strict", z.ZodTypeAny, {
            actor: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            version: string;
            contractKitVersion: "1.0.0";
        }, {
            version: string;
            contractKitVersion: "1.0.0";
            actor?: any;
        }>;
        inputs: z.ZodArray<z.ZodObject<{
            schema: z.ZodType<string, z.ZodTypeDef, any>;
            id: z.ZodString;
            revision: z.ZodOptional<z.ZodNumber>;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: string;
            revision?: number | undefined;
        }, {
            id: string;
            digest?: any;
            schema?: any;
            revision?: number | undefined;
        }>, "many">;
        providerCapabilityDigests: z.ZodDefault<z.ZodArray<z.ZodType<string, z.ZodTypeDef, any>, "many">>;
        actions: z.ZodArray<z.ZodEffects<z.ZodObject<{
            id: z.ZodString;
            operationId: z.ZodString;
            operationVersion: z.ZodNumber;
            dependsOn: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            inputs: z.ZodDefault<z.ZodArray<z.ZodObject<{
                schema: z.ZodType<string, z.ZodTypeDef, any>;
                id: z.ZodString;
                revision: z.ZodOptional<z.ZodNumber>;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: string;
                revision?: number | undefined;
            }, {
                id: string;
                digest?: any;
                schema?: any;
                revision?: number | undefined;
            }>, "many">>;
            outputSchema: z.ZodType<string, z.ZodTypeDef, any>;
            preconditions: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            postconditions: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            lockClass: z.ZodString;
            fencingRequired: z.ZodBoolean;
            sideEffectClass: z.ZodType<string, z.ZodTypeDef, any>;
            riskClass: z.ZodEnum<["low", "medium", "high", "critical"]>;
            approvalScope: z.ZodEnum<["none", "plan", "action", "phase"]>;
            runtimeMaterialKind: z.ZodNullable<z.ZodString>;
            providerOperation: z.ZodNullable<z.ZodString>;
            providerCapabilityDigest: z.ZodNullable<z.ZodType<string, z.ZodTypeDef, any>>;
            retryClass: z.ZodEnum<["none", "safe", "reconcile_first"]>;
            maxAttempts: z.ZodNumber;
            timeoutClass: z.ZodString;
            compensationOperationId: z.ZodNullable<z.ZodString>;
            idempotencyRequired: z.ZodBoolean;
            reconciliationRequired: z.ZodBoolean;
            evidenceRequirements: z.ZodArray<z.ZodString, "many">;
        }, "strict", z.ZodTypeAny, {
            id: string;
            sideEffectClass: string;
            providerCapabilityDigest: string | null;
            operationId: string;
            operationVersion: number;
            dependsOn: string[];
            inputs: {
                id: string;
                digest: string;
                schema: string;
                revision?: number | undefined;
            }[];
            outputSchema: string;
            preconditions: string[];
            postconditions: string[];
            lockClass: string;
            fencingRequired: boolean;
            riskClass: "low" | "medium" | "high" | "critical";
            approvalScope: "action" | "none" | "plan" | "phase";
            runtimeMaterialKind: string | null;
            providerOperation: string | null;
            retryClass: "safe" | "none" | "reconcile_first";
            maxAttempts: number;
            timeoutClass: string;
            compensationOperationId: string | null;
            idempotencyRequired: boolean;
            reconciliationRequired: boolean;
            evidenceRequirements: string[];
        }, {
            id: string;
            operationId: string;
            operationVersion: number;
            lockClass: string;
            fencingRequired: boolean;
            riskClass: "low" | "medium" | "high" | "critical";
            approvalScope: "action" | "none" | "plan" | "phase";
            runtimeMaterialKind: string | null;
            providerOperation: string | null;
            retryClass: "safe" | "none" | "reconcile_first";
            maxAttempts: number;
            timeoutClass: string;
            compensationOperationId: string | null;
            idempotencyRequired: boolean;
            reconciliationRequired: boolean;
            evidenceRequirements: string[];
            sideEffectClass?: any;
            providerCapabilityDigest?: any;
            dependsOn?: string[] | undefined;
            inputs?: {
                id: string;
                digest?: any;
                schema?: any;
                revision?: number | undefined;
            }[] | undefined;
            outputSchema?: any;
            preconditions?: string[] | undefined;
            postconditions?: string[] | undefined;
        }>, {
            id: string;
            sideEffectClass: string;
            providerCapabilityDigest: string | null;
            operationId: string;
            operationVersion: number;
            dependsOn: string[];
            inputs: {
                id: string;
                digest: string;
                schema: string;
                revision?: number | undefined;
            }[];
            outputSchema: string;
            preconditions: string[];
            postconditions: string[];
            lockClass: string;
            fencingRequired: boolean;
            riskClass: "low" | "medium" | "high" | "critical";
            approvalScope: "action" | "none" | "plan" | "phase";
            runtimeMaterialKind: string | null;
            providerOperation: string | null;
            retryClass: "safe" | "none" | "reconcile_first";
            maxAttempts: number;
            timeoutClass: string;
            compensationOperationId: string | null;
            idempotencyRequired: boolean;
            reconciliationRequired: boolean;
            evidenceRequirements: string[];
        }, {
            id: string;
            operationId: string;
            operationVersion: number;
            lockClass: string;
            fencingRequired: boolean;
            riskClass: "low" | "medium" | "high" | "critical";
            approvalScope: "action" | "none" | "plan" | "phase";
            runtimeMaterialKind: string | null;
            providerOperation: string | null;
            retryClass: "safe" | "none" | "reconcile_first";
            maxAttempts: number;
            timeoutClass: string;
            compensationOperationId: string | null;
            idempotencyRequired: boolean;
            reconciliationRequired: boolean;
            evidenceRequirements: string[];
            sideEffectClass?: any;
            providerCapabilityDigest?: any;
            dependsOn?: string[] | undefined;
            inputs?: {
                id: string;
                digest?: any;
                schema?: any;
                revision?: number | undefined;
            }[] | undefined;
            outputSchema?: any;
            preconditions?: string[] | undefined;
            postconditions?: string[] | undefined;
        }>, "many">;
        authorizationRequirements: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        policyRequirements: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        riskClass: z.ZodEnum<["low", "medium", "high", "critical"]>;
        evidenceRequirements: z.ZodArray<z.ZodString, "many">;
        expectedStateDigest: z.ZodType<string, z.ZodTypeDef, any>;
        verificationCriteria: z.ZodArray<z.ZodString, "many">;
        rollbackTarget: z.ZodOptional<z.ZodObject<{
            schema: z.ZodLiteral<"hasna.deployment_receipt.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.deployment_receipt.v1";
        }, {
            id: string;
            schema: "hasna.deployment_receipt.v1";
            digest?: any;
        }>>;
        rollbackInputs: z.ZodDefault<z.ZodArray<z.ZodObject<{
            schema: z.ZodType<string, z.ZodTypeDef, any>;
            id: z.ZodString;
            revision: z.ZodOptional<z.ZodNumber>;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: string;
            revision?: number | undefined;
        }, {
            id: string;
            digest?: any;
            schema?: any;
            revision?: number | undefined;
        }>, "many">>;
        estimatedCost: z.ZodOptional<z.ZodType<{
            id: string;
            schema: "hasna.cost_estimate.v1";
            createdAt: string;
            currency: string;
            amountMicros: number;
            basis: "limit" | "actual" | "estimated" | "budget";
            resourceRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            model?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            promptTokens?: number | undefined;
            completionTokens?: number | undefined;
            totalTokens?: number | undefined;
        }, z.ZodTypeDef, any>>;
        issuedAt: z.ZodType<string, z.ZodTypeDef, any>;
        expiresAt: z.ZodOptional<z.ZodNullable<z.ZodType<string, z.ZodTypeDef, any>>>;
        schema: z.ZodLiteral<"hasna.deployment_plan.v1">;
        id: z.ZodString;
        createdAt: z.ZodType<string, z.ZodTypeDef, any>;
        producer: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        kind: "reconciliation" | "deployment" | "promotion" | "rollback";
        digest: string;
        schema: "hasna.deployment_plan.v1";
        createdAt: string;
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        inputs: {
            id: string;
            digest: string;
            schema: string;
            revision?: number | undefined;
        }[];
        riskClass: "low" | "medium" | "high" | "critical";
        evidenceRequirements: string[];
        request: {
            id: string;
            digest: string;
            schema: "hasna.deployment_request.v1";
        };
        compiler: {
            actor: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            version: string;
            contractKitVersion: "1.0.0";
        };
        providerCapabilityDigests: string[];
        actions: {
            id: string;
            sideEffectClass: string;
            providerCapabilityDigest: string | null;
            operationId: string;
            operationVersion: number;
            dependsOn: string[];
            inputs: {
                id: string;
                digest: string;
                schema: string;
                revision?: number | undefined;
            }[];
            outputSchema: string;
            preconditions: string[];
            postconditions: string[];
            lockClass: string;
            fencingRequired: boolean;
            riskClass: "low" | "medium" | "high" | "critical";
            approvalScope: "action" | "none" | "plan" | "phase";
            runtimeMaterialKind: string | null;
            providerOperation: string | null;
            retryClass: "safe" | "none" | "reconcile_first";
            maxAttempts: number;
            timeoutClass: string;
            compensationOperationId: string | null;
            idempotencyRequired: boolean;
            reconciliationRequired: boolean;
            evidenceRequirements: string[];
        }[];
        authorizationRequirements: string[];
        policyRequirements: string[];
        expectedStateDigest: string;
        verificationCriteria: string[];
        rollbackInputs: {
            id: string;
            digest: string;
            schema: string;
            revision?: number | undefined;
        }[];
        issuedAt: string;
        expiresAt?: string | null | undefined;
        rollbackTarget?: {
            id: string;
            digest: string;
            schema: "hasna.deployment_receipt.v1";
        } | undefined;
        estimatedCost?: {
            id: string;
            schema: "hasna.cost_estimate.v1";
            createdAt: string;
            currency: string;
            amountMicros: number;
            basis: "limit" | "actual" | "estimated" | "budget";
            resourceRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            model?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            promptTokens?: number | undefined;
            completionTokens?: number | undefined;
            totalTokens?: number | undefined;
        } | undefined;
    }, {
        id: string;
        kind: "reconciliation" | "deployment" | "promotion" | "rollback";
        schema: "hasna.deployment_plan.v1";
        inputs: {
            id: string;
            digest?: any;
            schema?: any;
            revision?: number | undefined;
        }[];
        riskClass: "low" | "medium" | "high" | "critical";
        evidenceRequirements: string[];
        request: {
            id: string;
            schema: "hasna.deployment_request.v1";
            digest?: any;
        };
        compiler: {
            version: string;
            contractKitVersion: "1.0.0";
            actor?: any;
        };
        actions: {
            id: string;
            operationId: string;
            operationVersion: number;
            lockClass: string;
            fencingRequired: boolean;
            riskClass: "low" | "medium" | "high" | "critical";
            approvalScope: "action" | "none" | "plan" | "phase";
            runtimeMaterialKind: string | null;
            providerOperation: string | null;
            retryClass: "safe" | "none" | "reconcile_first";
            maxAttempts: number;
            timeoutClass: string;
            compensationOperationId: string | null;
            idempotencyRequired: boolean;
            reconciliationRequired: boolean;
            evidenceRequirements: string[];
            sideEffectClass?: any;
            providerCapabilityDigest?: any;
            dependsOn?: string[] | undefined;
            inputs?: {
                id: string;
                digest?: any;
                schema?: any;
                revision?: number | undefined;
            }[] | undefined;
            outputSchema?: any;
            preconditions?: string[] | undefined;
            postconditions?: string[] | undefined;
        }[];
        verificationCriteria: string[];
        digest?: any;
        createdAt?: any;
        producer?: any;
        expiresAt?: any;
        providerCapabilityDigests?: any[] | undefined;
        authorizationRequirements?: string[] | undefined;
        policyRequirements?: string[] | undefined;
        expectedStateDigest?: any;
        rollbackTarget?: {
            id: string;
            schema: "hasna.deployment_receipt.v1";
            digest?: any;
        } | undefined;
        rollbackInputs?: {
            id: string;
            digest?: any;
            schema?: any;
            revision?: number | undefined;
        }[] | undefined;
        estimatedCost?: any;
        issuedAt?: any;
    }>, {
        id: string;
        kind: "reconciliation" | "deployment" | "promotion" | "rollback";
        digest: string;
        schema: "hasna.deployment_plan.v1";
        createdAt: string;
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        inputs: {
            id: string;
            digest: string;
            schema: string;
            revision?: number | undefined;
        }[];
        riskClass: "low" | "medium" | "high" | "critical";
        evidenceRequirements: string[];
        request: {
            id: string;
            digest: string;
            schema: "hasna.deployment_request.v1";
        };
        compiler: {
            actor: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            version: string;
            contractKitVersion: "1.0.0";
        };
        providerCapabilityDigests: string[];
        actions: {
            id: string;
            sideEffectClass: string;
            providerCapabilityDigest: string | null;
            operationId: string;
            operationVersion: number;
            dependsOn: string[];
            inputs: {
                id: string;
                digest: string;
                schema: string;
                revision?: number | undefined;
            }[];
            outputSchema: string;
            preconditions: string[];
            postconditions: string[];
            lockClass: string;
            fencingRequired: boolean;
            riskClass: "low" | "medium" | "high" | "critical";
            approvalScope: "action" | "none" | "plan" | "phase";
            runtimeMaterialKind: string | null;
            providerOperation: string | null;
            retryClass: "safe" | "none" | "reconcile_first";
            maxAttempts: number;
            timeoutClass: string;
            compensationOperationId: string | null;
            idempotencyRequired: boolean;
            reconciliationRequired: boolean;
            evidenceRequirements: string[];
        }[];
        authorizationRequirements: string[];
        policyRequirements: string[];
        expectedStateDigest: string;
        verificationCriteria: string[];
        rollbackInputs: {
            id: string;
            digest: string;
            schema: string;
            revision?: number | undefined;
        }[];
        issuedAt: string;
        expiresAt?: string | null | undefined;
        rollbackTarget?: {
            id: string;
            digest: string;
            schema: "hasna.deployment_receipt.v1";
        } | undefined;
        estimatedCost?: {
            id: string;
            schema: "hasna.cost_estimate.v1";
            createdAt: string;
            currency: string;
            amountMicros: number;
            basis: "limit" | "actual" | "estimated" | "budget";
            resourceRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            model?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            promptTokens?: number | undefined;
            completionTokens?: number | undefined;
            totalTokens?: number | undefined;
        } | undefined;
    }, {
        id: string;
        kind: "reconciliation" | "deployment" | "promotion" | "rollback";
        schema: "hasna.deployment_plan.v1";
        inputs: {
            id: string;
            digest?: any;
            schema?: any;
            revision?: number | undefined;
        }[];
        riskClass: "low" | "medium" | "high" | "critical";
        evidenceRequirements: string[];
        request: {
            id: string;
            schema: "hasna.deployment_request.v1";
            digest?: any;
        };
        compiler: {
            version: string;
            contractKitVersion: "1.0.0";
            actor?: any;
        };
        actions: {
            id: string;
            operationId: string;
            operationVersion: number;
            lockClass: string;
            fencingRequired: boolean;
            riskClass: "low" | "medium" | "high" | "critical";
            approvalScope: "action" | "none" | "plan" | "phase";
            runtimeMaterialKind: string | null;
            providerOperation: string | null;
            retryClass: "safe" | "none" | "reconcile_first";
            maxAttempts: number;
            timeoutClass: string;
            compensationOperationId: string | null;
            idempotencyRequired: boolean;
            reconciliationRequired: boolean;
            evidenceRequirements: string[];
            sideEffectClass?: any;
            providerCapabilityDigest?: any;
            dependsOn?: string[] | undefined;
            inputs?: {
                id: string;
                digest?: any;
                schema?: any;
                revision?: number | undefined;
            }[] | undefined;
            outputSchema?: any;
            preconditions?: string[] | undefined;
            postconditions?: string[] | undefined;
        }[];
        verificationCriteria: string[];
        digest?: any;
        createdAt?: any;
        producer?: any;
        expiresAt?: any;
        providerCapabilityDigests?: any[] | undefined;
        authorizationRequirements?: string[] | undefined;
        policyRequirements?: string[] | undefined;
        expectedStateDigest?: any;
        rollbackTarget?: {
            id: string;
            schema: "hasna.deployment_receipt.v1";
            digest?: any;
        } | undefined;
        rollbackInputs?: {
            id: string;
            digest?: any;
            schema?: any;
            revision?: number | undefined;
        }[] | undefined;
        estimatedCost?: any;
        issuedAt?: any;
    }>;
    readonly DeploymentApprovalDecisionSchema: z.ZodEffects<z.ZodObject<{
        decision: z.ZodType<{
            id: string;
            status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
            schema: "hasna.decision_envelope.v1";
            createdAt: string;
            decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
            selected: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            skipped: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            reason: string;
            obligations: string[];
            redactions: string[];
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            actor?: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            } | undefined;
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            traceId?: string | undefined;
            inputHash?: string | undefined;
            policyBundleId?: string | undefined;
            costEstimate?: {
                id: string;
                schema: "hasna.cost_estimate.v1";
                createdAt: string;
                currency: string;
                amountMicros: number;
                basis: "limit" | "actual" | "estimated" | "budget";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                model?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                promptTokens?: number | undefined;
                completionTokens?: number | undefined;
                totalTokens?: number | undefined;
            } | undefined;
        }, z.ZodTypeDef, any>;
        plan: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.deployment_plan.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.deployment_plan.v1";
        }, {
            id: string;
            schema: "hasna.deployment_plan.v1";
            digest?: any;
        }>;
        scope: z.ZodEnum<["plan", "action", "phase"]>;
        actionId: z.ZodNullable<z.ZodString>;
        phaseId: z.ZodNullable<z.ZodString>;
        runtimeMaterial: z.ZodNullable<z.ZodObject<{
            kind: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
            stateLineage: z.ZodString;
            preActionStateSerial: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            kind: string;
            digest: string;
            stateLineage: string;
            preActionStateSerial: number;
        }, {
            kind: string;
            stateLineage: string;
            preActionStateSerial: number;
            digest?: any;
        }>>;
        boundInputDigests: z.ZodArray<z.ZodObject<{
            kind: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            kind: string;
            digest: string;
        }, {
            kind: string;
            digest?: any;
        }>, "many">;
        environment: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.environment_binding.v1">;
            id: z.ZodString;
            revision: z.ZodNumber;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
        }, {
            id: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
            digest?: any;
        }>;
        actorRole: z.ZodEnum<["requester", "planner", "approver", "executor", "auditor", "administrator"]>;
        attemptScope: z.ZodObject<{
            minimum: z.ZodNumber;
            maximum: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            minimum: number;
            maximum: number;
        }, {
            minimum: number;
            maximum: number;
        }>;
        unchangedRetryPolicy: z.ZodEnum<["allowed", "denied"]>;
        issuedAt: z.ZodType<string, z.ZodTypeDef, any>;
        expiresAt: z.ZodType<string, z.ZodTypeDef, any>;
        separationOfDutiesPassed: z.ZodBoolean;
        authorizationPolicyRevision: z.ZodNumber;
        evidenceRefs: z.ZodArray<z.ZodType<{
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }, z.ZodTypeDef, any>, "many">;
        schema: z.ZodLiteral<"hasna.deployment_approval_decision.v1">;
        id: z.ZodString;
        createdAt: z.ZodType<string, z.ZodTypeDef, any>;
        producer: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.deployment_approval_decision.v1";
        createdAt: string;
        evidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        expiresAt: string;
        environment: {
            id: string;
            digest: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
        };
        plan: {
            id: string;
            digest: string;
            schema: "hasna.deployment_plan.v1";
        };
        issuedAt: string;
        decision: {
            id: string;
            status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
            schema: "hasna.decision_envelope.v1";
            createdAt: string;
            decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
            selected: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            skipped: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            reason: string;
            obligations: string[];
            redactions: string[];
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            actor?: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            } | undefined;
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            traceId?: string | undefined;
            inputHash?: string | undefined;
            policyBundleId?: string | undefined;
            costEstimate?: {
                id: string;
                schema: "hasna.cost_estimate.v1";
                createdAt: string;
                currency: string;
                amountMicros: number;
                basis: "limit" | "actual" | "estimated" | "budget";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                model?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                promptTokens?: number | undefined;
                completionTokens?: number | undefined;
                totalTokens?: number | undefined;
            } | undefined;
        };
        scope: "action" | "plan" | "phase";
        actionId: string | null;
        phaseId: string | null;
        runtimeMaterial: {
            kind: string;
            digest: string;
            stateLineage: string;
            preActionStateSerial: number;
        } | null;
        boundInputDigests: {
            kind: string;
            digest: string;
        }[];
        actorRole: "requester" | "planner" | "approver" | "executor" | "auditor" | "administrator";
        attemptScope: {
            minimum: number;
            maximum: number;
        };
        unchangedRetryPolicy: "allowed" | "denied";
        separationOfDutiesPassed: boolean;
        authorizationPolicyRevision: number;
    }, {
        id: string;
        schema: "hasna.deployment_approval_decision.v1";
        evidenceRefs: any[];
        environment: {
            id: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
            digest?: any;
        };
        plan: {
            id: string;
            schema: "hasna.deployment_plan.v1";
            digest?: any;
        };
        scope: "action" | "plan" | "phase";
        actionId: string | null;
        phaseId: string | null;
        runtimeMaterial: {
            kind: string;
            stateLineage: string;
            preActionStateSerial: number;
            digest?: any;
        } | null;
        boundInputDigests: {
            kind: string;
            digest?: any;
        }[];
        actorRole: "requester" | "planner" | "approver" | "executor" | "auditor" | "administrator";
        attemptScope: {
            minimum: number;
            maximum: number;
        };
        unchangedRetryPolicy: "allowed" | "denied";
        separationOfDutiesPassed: boolean;
        authorizationPolicyRevision: number;
        digest?: any;
        createdAt?: any;
        producer?: any;
        expiresAt?: any;
        issuedAt?: any;
        decision?: any;
    }>, {
        id: string;
        digest: string;
        schema: "hasna.deployment_approval_decision.v1";
        createdAt: string;
        evidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        expiresAt: string;
        environment: {
            id: string;
            digest: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
        };
        plan: {
            id: string;
            digest: string;
            schema: "hasna.deployment_plan.v1";
        };
        issuedAt: string;
        decision: {
            id: string;
            status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
            schema: "hasna.decision_envelope.v1";
            createdAt: string;
            decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
            selected: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            skipped: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            reason: string;
            obligations: string[];
            redactions: string[];
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            actor?: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            } | undefined;
            updatedAt?: string | null | undefined;
            metadata?: Record<string, unknown> | undefined;
            traceId?: string | undefined;
            inputHash?: string | undefined;
            policyBundleId?: string | undefined;
            costEstimate?: {
                id: string;
                schema: "hasna.cost_estimate.v1";
                createdAt: string;
                currency: string;
                amountMicros: number;
                basis: "limit" | "actual" | "estimated" | "budget";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                model?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                promptTokens?: number | undefined;
                completionTokens?: number | undefined;
                totalTokens?: number | undefined;
            } | undefined;
        };
        scope: "action" | "plan" | "phase";
        actionId: string | null;
        phaseId: string | null;
        runtimeMaterial: {
            kind: string;
            digest: string;
            stateLineage: string;
            preActionStateSerial: number;
        } | null;
        boundInputDigests: {
            kind: string;
            digest: string;
        }[];
        actorRole: "requester" | "planner" | "approver" | "executor" | "auditor" | "administrator";
        attemptScope: {
            minimum: number;
            maximum: number;
        };
        unchangedRetryPolicy: "allowed" | "denied";
        separationOfDutiesPassed: boolean;
        authorizationPolicyRevision: number;
    }, {
        id: string;
        schema: "hasna.deployment_approval_decision.v1";
        evidenceRefs: any[];
        environment: {
            id: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
            digest?: any;
        };
        plan: {
            id: string;
            schema: "hasna.deployment_plan.v1";
            digest?: any;
        };
        scope: "action" | "plan" | "phase";
        actionId: string | null;
        phaseId: string | null;
        runtimeMaterial: {
            kind: string;
            stateLineage: string;
            preActionStateSerial: number;
            digest?: any;
        } | null;
        boundInputDigests: {
            kind: string;
            digest?: any;
        }[];
        actorRole: "requester" | "planner" | "approver" | "executor" | "auditor" | "administrator";
        attemptScope: {
            minimum: number;
            maximum: number;
        };
        unchangedRetryPolicy: "allowed" | "denied";
        separationOfDutiesPassed: boolean;
        authorizationPolicyRevision: number;
        digest?: any;
        createdAt?: any;
        producer?: any;
        expiresAt?: any;
        issuedAt?: any;
        decision?: any;
    }>;
    readonly DeploymentAttemptSchema: z.ZodEffects<z.ZodObject<{
        updatedAt: z.ZodType<string, z.ZodTypeDef, any>;
        revision: z.ZodNumber;
        plan: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.deployment_plan.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.deployment_plan.v1";
        }, {
            id: string;
            schema: "hasna.deployment_plan.v1";
            digest?: any;
        }>;
        approvals: z.ZodArray<z.ZodObject<{
            decision: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.deployment_approval_decision.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.deployment_approval_decision.v1";
            }, {
                id: string;
                schema: "hasna.deployment_approval_decision.v1";
                digest?: any;
            }>;
            scope: z.ZodEnum<["plan", "action", "phase"]>;
            actionId: z.ZodNullable<z.ZodString>;
            phaseId: z.ZodNullable<z.ZodString>;
            runtimeMaterialDigest: z.ZodNullable<z.ZodType<string, z.ZodTypeDef, any>>;
        }, "strict", z.ZodTypeAny, {
            decision: {
                id: string;
                digest: string;
                schema: "hasna.deployment_approval_decision.v1";
            };
            scope: "action" | "plan" | "phase";
            actionId: string | null;
            phaseId: string | null;
            runtimeMaterialDigest: string | null;
        }, {
            decision: {
                id: string;
                schema: "hasna.deployment_approval_decision.v1";
                digest?: any;
            };
            scope: "action" | "plan" | "phase";
            actionId: string | null;
            phaseId: string | null;
            runtimeMaterialDigest?: any;
        }>, "many">;
        requester: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        decisionActors: z.ZodArray<z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>, "many">;
        executorActors: z.ZodArray<z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>, "many">;
        environmentLock: z.ZodObject<{
            id: z.ZodString;
            fencingToken: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            id: string;
            fencingToken: number;
        }, {
            id: string;
            fencingToken: number;
        }>;
        attemptNumber: z.ZodNumber;
        retryOf: z.ZodNullable<z.ZodObject<{
            schema: z.ZodLiteral<"hasna.deployment_attempt.v1">;
            id: z.ZodString;
            revision: z.ZodNumber;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
        }, {
            id: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
            digest?: any;
        }>>;
        state: z.ZodEnum<["queued", "running", "reconciling", "unknown_outcome", "succeeded", "failed", "cancelled"]>;
        actionSteps: z.ZodArray<z.ZodEffects<z.ZodObject<{
            sequence: z.ZodNumber;
            actionId: z.ZodString;
            state: z.ZodEnum<["pending", "running", "succeeded", "failed", "cancelled", "unknown_outcome"]>;
            providerCorrelationId: z.ZodNullable<z.ZodString>;
            startedAt: z.ZodNullable<z.ZodType<string, z.ZodTypeDef, any>>;
            finishedAt: z.ZodNullable<z.ZodType<string, z.ZodTypeDef, any>>;
            evidenceRefs: z.ZodDefault<z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">>;
        }, "strict", z.ZodTypeAny, {
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            startedAt: string | null;
            finishedAt: string | null;
            actionId: string;
            sequence: number;
            state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome";
            providerCorrelationId: string | null;
        }, {
            actionId: string;
            sequence: number;
            state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome";
            providerCorrelationId: string | null;
            evidenceRefs?: any[] | undefined;
            startedAt?: any;
            finishedAt?: any;
        }>, {
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            startedAt: string | null;
            finishedAt: string | null;
            actionId: string;
            sequence: number;
            state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome";
            providerCorrelationId: string | null;
        }, {
            actionId: string;
            sequence: number;
            state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome";
            providerCorrelationId: string | null;
            evidenceRefs?: any[] | undefined;
            startedAt?: any;
            finishedAt?: any;
        }>, "many">;
        outboxCorrelationRef: z.ZodType<{
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }, z.ZodTypeDef, any>;
        inboxCorrelationRef: z.ZodType<{
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }, z.ZodTypeDef, any>;
        failureReason: z.ZodNullable<z.ZodString>;
        evidenceRefs: z.ZodDefault<z.ZodArray<z.ZodType<{
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }, z.ZodTypeDef, any>, "many">>;
        providerReceipts: z.ZodDefault<z.ZodArray<z.ZodObject<{
            schema: z.ZodLiteral<"hasna.provider_receipt.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.provider_receipt.v1";
        }, {
            id: string;
            schema: "hasna.provider_receipt.v1";
            digest?: any;
        }>, "many">>;
        finalReceipt: z.ZodNullable<z.ZodObject<{
            schema: z.ZodLiteral<"hasna.deployment_receipt.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.deployment_receipt.v1";
        }, {
            id: string;
            schema: "hasna.deployment_receipt.v1";
            digest?: any;
        }>>;
        schema: z.ZodLiteral<"hasna.deployment_attempt.v1">;
        id: z.ZodString;
        createdAt: z.ZodType<string, z.ZodTypeDef, any>;
        producer: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.deployment_attempt.v1";
        createdAt: string;
        updatedAt: string;
        evidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        revision: number;
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        requester: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        plan: {
            id: string;
            digest: string;
            schema: "hasna.deployment_plan.v1";
        };
        state: "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome" | "queued" | "reconciling";
        approvals: {
            decision: {
                id: string;
                digest: string;
                schema: "hasna.deployment_approval_decision.v1";
            };
            scope: "action" | "plan" | "phase";
            actionId: string | null;
            phaseId: string | null;
            runtimeMaterialDigest: string | null;
        }[];
        decisionActors: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }[];
        executorActors: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }[];
        environmentLock: {
            id: string;
            fencingToken: number;
        };
        attemptNumber: number;
        retryOf: {
            id: string;
            digest: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
        } | null;
        actionSteps: {
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            startedAt: string | null;
            finishedAt: string | null;
            actionId: string;
            sequence: number;
            state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome";
            providerCorrelationId: string | null;
        }[];
        outboxCorrelationRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        inboxCorrelationRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        failureReason: string | null;
        providerReceipts: {
            id: string;
            digest: string;
            schema: "hasna.provider_receipt.v1";
        }[];
        finalReceipt: {
            id: string;
            digest: string;
            schema: "hasna.deployment_receipt.v1";
        } | null;
    }, {
        id: string;
        schema: "hasna.deployment_attempt.v1";
        revision: number;
        plan: {
            id: string;
            schema: "hasna.deployment_plan.v1";
            digest?: any;
        };
        state: "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome" | "queued" | "reconciling";
        approvals: {
            decision: {
                id: string;
                schema: "hasna.deployment_approval_decision.v1";
                digest?: any;
            };
            scope: "action" | "plan" | "phase";
            actionId: string | null;
            phaseId: string | null;
            runtimeMaterialDigest?: any;
        }[];
        decisionActors: any[];
        executorActors: any[];
        environmentLock: {
            id: string;
            fencingToken: number;
        };
        attemptNumber: number;
        retryOf: {
            id: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
            digest?: any;
        } | null;
        actionSteps: {
            actionId: string;
            sequence: number;
            state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome";
            providerCorrelationId: string | null;
            evidenceRefs?: any[] | undefined;
            startedAt?: any;
            finishedAt?: any;
        }[];
        failureReason: string | null;
        finalReceipt: {
            id: string;
            schema: "hasna.deployment_receipt.v1";
            digest?: any;
        } | null;
        digest?: any;
        createdAt?: any;
        updatedAt?: any;
        evidenceRefs?: any[] | undefined;
        producer?: any;
        requester?: any;
        outboxCorrelationRef?: any;
        inboxCorrelationRef?: any;
        providerReceipts?: {
            id: string;
            schema: "hasna.provider_receipt.v1";
            digest?: any;
        }[] | undefined;
    }>, {
        id: string;
        digest: string;
        schema: "hasna.deployment_attempt.v1";
        createdAt: string;
        updatedAt: string;
        evidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        revision: number;
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        requester: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        plan: {
            id: string;
            digest: string;
            schema: "hasna.deployment_plan.v1";
        };
        state: "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome" | "queued" | "reconciling";
        approvals: {
            decision: {
                id: string;
                digest: string;
                schema: "hasna.deployment_approval_decision.v1";
            };
            scope: "action" | "plan" | "phase";
            actionId: string | null;
            phaseId: string | null;
            runtimeMaterialDigest: string | null;
        }[];
        decisionActors: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }[];
        executorActors: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }[];
        environmentLock: {
            id: string;
            fencingToken: number;
        };
        attemptNumber: number;
        retryOf: {
            id: string;
            digest: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
        } | null;
        actionSteps: {
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            startedAt: string | null;
            finishedAt: string | null;
            actionId: string;
            sequence: number;
            state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome";
            providerCorrelationId: string | null;
        }[];
        outboxCorrelationRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        inboxCorrelationRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        failureReason: string | null;
        providerReceipts: {
            id: string;
            digest: string;
            schema: "hasna.provider_receipt.v1";
        }[];
        finalReceipt: {
            id: string;
            digest: string;
            schema: "hasna.deployment_receipt.v1";
        } | null;
    }, {
        id: string;
        schema: "hasna.deployment_attempt.v1";
        revision: number;
        plan: {
            id: string;
            schema: "hasna.deployment_plan.v1";
            digest?: any;
        };
        state: "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome" | "queued" | "reconciling";
        approvals: {
            decision: {
                id: string;
                schema: "hasna.deployment_approval_decision.v1";
                digest?: any;
            };
            scope: "action" | "plan" | "phase";
            actionId: string | null;
            phaseId: string | null;
            runtimeMaterialDigest?: any;
        }[];
        decisionActors: any[];
        executorActors: any[];
        environmentLock: {
            id: string;
            fencingToken: number;
        };
        attemptNumber: number;
        retryOf: {
            id: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
            digest?: any;
        } | null;
        actionSteps: {
            actionId: string;
            sequence: number;
            state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome";
            providerCorrelationId: string | null;
            evidenceRefs?: any[] | undefined;
            startedAt?: any;
            finishedAt?: any;
        }[];
        failureReason: string | null;
        finalReceipt: {
            id: string;
            schema: "hasna.deployment_receipt.v1";
            digest?: any;
        } | null;
        digest?: any;
        createdAt?: any;
        updatedAt?: any;
        evidenceRefs?: any[] | undefined;
        producer?: any;
        requester?: any;
        outboxCorrelationRef?: any;
        inboxCorrelationRef?: any;
        providerReceipts?: {
            id: string;
            schema: "hasna.provider_receipt.v1";
            digest?: any;
        }[] | undefined;
    }>;
    readonly ProviderReceiptSchema: z.ZodEffects<z.ZodObject<{
        attempt: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.deployment_attempt.v1">;
            id: z.ZodString;
            revision: z.ZodNumber;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
        }, {
            id: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
            digest?: any;
        }>;
        provider: z.ZodString;
        adapter: z.ZodString;
        connectionRef: z.ZodType<{
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }, z.ZodTypeDef, any>;
        capabilityDigest: z.ZodType<string, z.ZodTypeDef, any>;
        operationId: z.ZodString;
        operationVersion: z.ZodNumber;
        providerIdentity: z.ZodObject<{
            projectId: z.ZodNullable<z.ZodString>;
            operationId: z.ZodString;
            deploymentId: z.ZodNullable<z.ZodString>;
            resourceIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            eventId: z.ZodNullable<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            projectId: string | null;
            operationId: string;
            deploymentId: string | null;
            resourceIds: string[];
            eventId: string | null;
        }, {
            projectId: string | null;
            operationId: string;
            deploymentId: string | null;
            eventId: string | null;
            resourceIds?: string[] | undefined;
        }>;
        requestFingerprint: z.ZodType<string, z.ZodTypeDef, any>;
        providerStatus: z.ZodString;
        normalizedResult: z.ZodEnum<["accepted", "succeeded", "failed", "cancelled", "unknown"]>;
        observedProviderRevision: z.ZodNullable<z.ZodString>;
        observedAt: z.ZodType<string, z.ZodTypeDef, any>;
        retryClass: z.ZodEnum<["none", "safe", "reconcile_first"]>;
        reconciliationState: z.ZodEnum<["not_required", "pending", "confirmed", "diverged"]>;
        unknownOutcome: z.ZodBoolean;
        redaction: z.ZodEnum<["none", "partial", "full"]>;
        responseEvidenceRefs: z.ZodArray<z.ZodType<{
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }, z.ZodTypeDef, any>, "many">;
        observationEvidenceRefs: z.ZodDefault<z.ZodArray<z.ZodType<{
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }, z.ZodTypeDef, any>, "many">>;
        schema: z.ZodLiteral<"hasna.provider_receipt.v1">;
        id: z.ZodString;
        createdAt: z.ZodType<string, z.ZodTypeDef, any>;
        producer: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        provider: string;
        schema: "hasna.provider_receipt.v1";
        createdAt: string;
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        providerIdentity: {
            projectId: string | null;
            operationId: string;
            deploymentId: string | null;
            resourceIds: string[];
            eventId: string | null;
        };
        operationId: string;
        operationVersion: number;
        retryClass: "safe" | "none" | "reconcile_first";
        attempt: {
            id: string;
            digest: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
        };
        adapter: string;
        connectionRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        capabilityDigest: string;
        requestFingerprint: string;
        providerStatus: string;
        normalizedResult: "unknown" | "succeeded" | "failed" | "cancelled" | "accepted";
        observedProviderRevision: string | null;
        observedAt: string;
        reconciliationState: "pending" | "not_required" | "confirmed" | "diverged";
        unknownOutcome: boolean;
        redaction: "none" | "partial" | "full";
        responseEvidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        observationEvidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
    }, {
        id: string;
        provider: string;
        schema: "hasna.provider_receipt.v1";
        providerIdentity: {
            projectId: string | null;
            operationId: string;
            deploymentId: string | null;
            eventId: string | null;
            resourceIds?: string[] | undefined;
        };
        operationId: string;
        operationVersion: number;
        retryClass: "safe" | "none" | "reconcile_first";
        attempt: {
            id: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
            digest?: any;
        };
        adapter: string;
        providerStatus: string;
        normalizedResult: "unknown" | "succeeded" | "failed" | "cancelled" | "accepted";
        observedProviderRevision: string | null;
        reconciliationState: "pending" | "not_required" | "confirmed" | "diverged";
        unknownOutcome: boolean;
        redaction: "none" | "partial" | "full";
        responseEvidenceRefs: any[];
        digest?: any;
        createdAt?: any;
        producer?: any;
        connectionRef?: any;
        capabilityDigest?: any;
        requestFingerprint?: any;
        observedAt?: any;
        observationEvidenceRefs?: any[] | undefined;
    }>, {
        id: string;
        digest: string;
        provider: string;
        schema: "hasna.provider_receipt.v1";
        createdAt: string;
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        providerIdentity: {
            projectId: string | null;
            operationId: string;
            deploymentId: string | null;
            resourceIds: string[];
            eventId: string | null;
        };
        operationId: string;
        operationVersion: number;
        retryClass: "safe" | "none" | "reconcile_first";
        attempt: {
            id: string;
            digest: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
        };
        adapter: string;
        connectionRef: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        };
        capabilityDigest: string;
        requestFingerprint: string;
        providerStatus: string;
        normalizedResult: "unknown" | "succeeded" | "failed" | "cancelled" | "accepted";
        observedProviderRevision: string | null;
        observedAt: string;
        reconciliationState: "pending" | "not_required" | "confirmed" | "diverged";
        unknownOutcome: boolean;
        redaction: "none" | "partial" | "full";
        responseEvidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        observationEvidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
    }, {
        id: string;
        provider: string;
        schema: "hasna.provider_receipt.v1";
        providerIdentity: {
            projectId: string | null;
            operationId: string;
            deploymentId: string | null;
            eventId: string | null;
            resourceIds?: string[] | undefined;
        };
        operationId: string;
        operationVersion: number;
        retryClass: "safe" | "none" | "reconcile_first";
        attempt: {
            id: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
            digest?: any;
        };
        adapter: string;
        providerStatus: string;
        normalizedResult: "unknown" | "succeeded" | "failed" | "cancelled" | "accepted";
        observedProviderRevision: string | null;
        reconciliationState: "pending" | "not_required" | "confirmed" | "diverged";
        unknownOutcome: boolean;
        redaction: "none" | "partial" | "full";
        responseEvidenceRefs: any[];
        digest?: any;
        createdAt?: any;
        producer?: any;
        connectionRef?: any;
        capabilityDigest?: any;
        requestFingerprint?: any;
        observedAt?: any;
        observationEvidenceRefs?: any[] | undefined;
    }>;
    readonly DeploymentReceiptSchema: z.ZodEffects<z.ZodObject<{
        request: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.deployment_request.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.deployment_request.v1";
        }, {
            id: string;
            schema: "hasna.deployment_request.v1";
            digest?: any;
        }>;
        plan: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.deployment_plan.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.deployment_plan.v1";
        }, {
            id: string;
            schema: "hasna.deployment_plan.v1";
            digest?: any;
        }>;
        approvals: z.ZodArray<z.ZodObject<{
            schema: z.ZodLiteral<"hasna.deployment_approval_decision.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.deployment_approval_decision.v1";
        }, {
            id: string;
            schema: "hasna.deployment_approval_decision.v1";
            digest?: any;
        }>, "many">;
        attempt: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.deployment_attempt.v1">;
            id: z.ZodString;
            revision: z.ZodNumber;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
        }, {
            id: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
            digest?: any;
        }>;
        product: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.product_projection.v1">;
            id: z.ZodString;
            revision: z.ZodNumber;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.product_projection.v1";
            revision: number;
        }, {
            id: string;
            schema: "hasna.product_projection.v1";
            revision: number;
            digest?: any;
        }>;
        intent: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.intent_snapshot.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.intent_snapshot.v1";
        }, {
            id: string;
            schema: "hasna.intent_snapshot.v1";
            digest?: any;
        }>;
        artifact: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.build_artifact.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.build_artifact.v1";
        }, {
            id: string;
            schema: "hasna.build_artifact.v1";
            digest?: any;
        }>;
        attestations: z.ZodArray<z.ZodObject<{
            schema: z.ZodLiteral<"hasna.artifact_attestation.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.artifact_attestation.v1";
        }, {
            id: string;
            schema: "hasna.artifact_attestation.v1";
            digest?: any;
        }>, "many">;
        environment: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.environment_binding.v1">;
            id: z.ZodString;
            revision: z.ZodNumber;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
        }, {
            id: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
            digest?: any;
        }>;
        providerReceipts: z.ZodArray<z.ZodObject<{
            schema: z.ZodLiteral<"hasna.provider_receipt.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.provider_receipt.v1";
        }, {
            id: string;
            schema: "hasna.provider_receipt.v1";
            digest?: any;
        }>, "many">;
        desiredStateDigest: z.ZodType<string, z.ZodTypeDef, any>;
        observedStateDigest: z.ZodType<string, z.ZodTypeDef, any>;
        verification: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<["health", "readiness", "version", "migration", "alarm", "access", "restore", "rollback", "security", "contract"]>;
            status: z.ZodEnum<["passed", "failed", "missing", "expired", "blocked"]>;
            evidenceRefs: z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
        }, "strict", z.ZodTypeAny, {
            id: string;
            kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
            status: "failed" | "blocked" | "passed" | "missing" | "expired";
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
        }, {
            id: string;
            kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
            status: "failed" | "blocked" | "passed" | "missing" | "expired";
            evidenceRefs: any[];
        }>, "many">;
        infrastructurePlanRef: z.ZodOptional<z.ZodType<{
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }, z.ZodTypeDef, any>>;
        infrastructureStateLineageRef: z.ZodOptional<z.ZodType<{
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }, z.ZodTypeDef, any>>;
        rollbackTarget: z.ZodOptional<z.ZodObject<{
            schema: z.ZodLiteral<"hasna.deployment_receipt.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.deployment_receipt.v1";
        }, {
            id: string;
            schema: "hasna.deployment_receipt.v1";
            digest?: any;
        }>>;
        verifiers: z.ZodArray<z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>, "many">;
        evidenceRefs: z.ZodArray<z.ZodType<{
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }, z.ZodTypeDef, any>, "many">;
        outcome: z.ZodEnum<["succeeded", "failed", "cancelled", "unknown_outcome"]>;
        schema: z.ZodLiteral<"hasna.deployment_receipt.v1">;
        id: z.ZodString;
        createdAt: z.ZodType<string, z.ZodTypeDef, any>;
        producer: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        schema: "hasna.deployment_receipt.v1";
        createdAt: string;
        artifact: {
            id: string;
            digest: string;
            schema: "hasna.build_artifact.v1";
        };
        verification: {
            id: string;
            kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
            status: "failed" | "blocked" | "passed" | "missing" | "expired";
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
        }[];
        evidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        product: {
            id: string;
            digest: string;
            schema: "hasna.product_projection.v1";
            revision: number;
        };
        intent: {
            id: string;
            digest: string;
            schema: "hasna.intent_snapshot.v1";
        };
        verifiers: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }[];
        environment: {
            id: string;
            digest: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
        };
        attestations: {
            id: string;
            digest: string;
            schema: "hasna.artifact_attestation.v1";
        }[];
        plan: {
            id: string;
            digest: string;
            schema: "hasna.deployment_plan.v1";
        };
        request: {
            id: string;
            digest: string;
            schema: "hasna.deployment_request.v1";
        };
        approvals: {
            id: string;
            digest: string;
            schema: "hasna.deployment_approval_decision.v1";
        }[];
        providerReceipts: {
            id: string;
            digest: string;
            schema: "hasna.provider_receipt.v1";
        }[];
        attempt: {
            id: string;
            digest: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
        };
        desiredStateDigest: string;
        observedStateDigest: string;
        outcome: "succeeded" | "failed" | "cancelled" | "unknown_outcome";
        rollbackTarget?: {
            id: string;
            digest: string;
            schema: "hasna.deployment_receipt.v1";
        } | undefined;
        infrastructurePlanRef?: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        } | undefined;
        infrastructureStateLineageRef?: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        } | undefined;
    }, {
        id: string;
        schema: "hasna.deployment_receipt.v1";
        artifact: {
            id: string;
            schema: "hasna.build_artifact.v1";
            digest?: any;
        };
        verification: {
            id: string;
            kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
            status: "failed" | "blocked" | "passed" | "missing" | "expired";
            evidenceRefs: any[];
        }[];
        evidenceRefs: any[];
        product: {
            id: string;
            schema: "hasna.product_projection.v1";
            revision: number;
            digest?: any;
        };
        intent: {
            id: string;
            schema: "hasna.intent_snapshot.v1";
            digest?: any;
        };
        verifiers: any[];
        environment: {
            id: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
            digest?: any;
        };
        attestations: {
            id: string;
            schema: "hasna.artifact_attestation.v1";
            digest?: any;
        }[];
        plan: {
            id: string;
            schema: "hasna.deployment_plan.v1";
            digest?: any;
        };
        request: {
            id: string;
            schema: "hasna.deployment_request.v1";
            digest?: any;
        };
        approvals: {
            id: string;
            schema: "hasna.deployment_approval_decision.v1";
            digest?: any;
        }[];
        providerReceipts: {
            id: string;
            schema: "hasna.provider_receipt.v1";
            digest?: any;
        }[];
        attempt: {
            id: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
            digest?: any;
        };
        outcome: "succeeded" | "failed" | "cancelled" | "unknown_outcome";
        digest?: any;
        createdAt?: any;
        producer?: any;
        rollbackTarget?: {
            id: string;
            schema: "hasna.deployment_receipt.v1";
            digest?: any;
        } | undefined;
        desiredStateDigest?: any;
        observedStateDigest?: any;
        infrastructurePlanRef?: any;
        infrastructureStateLineageRef?: any;
    }>, {
        id: string;
        digest: string;
        schema: "hasna.deployment_receipt.v1";
        createdAt: string;
        artifact: {
            id: string;
            digest: string;
            schema: "hasna.build_artifact.v1";
        };
        verification: {
            id: string;
            kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
            status: "failed" | "blocked" | "passed" | "missing" | "expired";
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
        }[];
        evidenceRefs: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        }[];
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        product: {
            id: string;
            digest: string;
            schema: "hasna.product_projection.v1";
            revision: number;
        };
        intent: {
            id: string;
            digest: string;
            schema: "hasna.intent_snapshot.v1";
        };
        verifiers: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }[];
        environment: {
            id: string;
            digest: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
        };
        attestations: {
            id: string;
            digest: string;
            schema: "hasna.artifact_attestation.v1";
        }[];
        plan: {
            id: string;
            digest: string;
            schema: "hasna.deployment_plan.v1";
        };
        request: {
            id: string;
            digest: string;
            schema: "hasna.deployment_request.v1";
        };
        approvals: {
            id: string;
            digest: string;
            schema: "hasna.deployment_approval_decision.v1";
        }[];
        providerReceipts: {
            id: string;
            digest: string;
            schema: "hasna.provider_receipt.v1";
        }[];
        attempt: {
            id: string;
            digest: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
        };
        desiredStateDigest: string;
        observedStateDigest: string;
        outcome: "succeeded" | "failed" | "cancelled" | "unknown_outcome";
        rollbackTarget?: {
            id: string;
            digest: string;
            schema: "hasna.deployment_receipt.v1";
        } | undefined;
        infrastructurePlanRef?: {
            id: string;
            kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
            sha256?: string | undefined;
            uri?: string | undefined;
            summary?: string | undefined;
        } | undefined;
        infrastructureStateLineageRef?: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        } | undefined;
    }, {
        id: string;
        schema: "hasna.deployment_receipt.v1";
        artifact: {
            id: string;
            schema: "hasna.build_artifact.v1";
            digest?: any;
        };
        verification: {
            id: string;
            kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
            status: "failed" | "blocked" | "passed" | "missing" | "expired";
            evidenceRefs: any[];
        }[];
        evidenceRefs: any[];
        product: {
            id: string;
            schema: "hasna.product_projection.v1";
            revision: number;
            digest?: any;
        };
        intent: {
            id: string;
            schema: "hasna.intent_snapshot.v1";
            digest?: any;
        };
        verifiers: any[];
        environment: {
            id: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
            digest?: any;
        };
        attestations: {
            id: string;
            schema: "hasna.artifact_attestation.v1";
            digest?: any;
        }[];
        plan: {
            id: string;
            schema: "hasna.deployment_plan.v1";
            digest?: any;
        };
        request: {
            id: string;
            schema: "hasna.deployment_request.v1";
            digest?: any;
        };
        approvals: {
            id: string;
            schema: "hasna.deployment_approval_decision.v1";
            digest?: any;
        }[];
        providerReceipts: {
            id: string;
            schema: "hasna.provider_receipt.v1";
            digest?: any;
        }[];
        attempt: {
            id: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
            digest?: any;
        };
        outcome: "succeeded" | "failed" | "cancelled" | "unknown_outcome";
        digest?: any;
        createdAt?: any;
        producer?: any;
        rollbackTarget?: {
            id: string;
            schema: "hasna.deployment_receipt.v1";
            digest?: any;
        } | undefined;
        desiredStateDigest?: any;
        observedStateDigest?: any;
        infrastructurePlanRef?: any;
        infrastructureStateLineageRef?: any;
    }>;
    readonly LaunchEvidenceSchema: z.ZodEffects<z.ZodObject<{
        product: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.product_projection.v1">;
            id: z.ZodString;
            revision: z.ZodNumber;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.product_projection.v1";
            revision: number;
        }, {
            id: string;
            schema: "hasna.product_projection.v1";
            revision: number;
            digest?: any;
        }>;
        environment: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.environment_binding.v1">;
            id: z.ZodString;
            revision: z.ZodNumber;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
        }, {
            id: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
            digest?: any;
        }>;
        deploymentReceipt: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.deployment_receipt.v1">;
            id: z.ZodString;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.deployment_receipt.v1";
        }, {
            id: string;
            schema: "hasna.deployment_receipt.v1";
            digest?: any;
        }>;
        requiredChecks: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<["health", "readiness", "version", "migration", "alarm", "access", "restore", "rollback", "security", "contract"]>;
            status: z.ZodEnum<["passed", "failed", "missing", "expired", "blocked"]>;
            evidenceRefs: z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
        }, "strict", z.ZodTypeAny, {
            id: string;
            kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
            status: "failed" | "blocked" | "passed" | "missing" | "expired";
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
        }, {
            id: string;
            kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
            status: "failed" | "blocked" | "passed" | "missing" | "expired";
            evidenceRefs: any[];
        }>, "many">;
        proofBundleRefs: z.ZodArray<z.ZodType<{
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }, z.ZodTypeDef, any>, "many">;
        findings: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            severity: z.ZodEnum<["p0", "p1", "p2", "p3"]>;
            status: z.ZodEnum<["open", "resolved", "accepted"]>;
            evidenceRefs: z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
        }, "strict", z.ZodTypeAny, {
            id: string;
            status: "open" | "accepted" | "resolved";
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            severity: "p0" | "p1" | "p2" | "p3";
        }, {
            id: string;
            status: "open" | "accepted" | "resolved";
            evidenceRefs: any[];
            severity: "p0" | "p1" | "p2" | "p3";
        }>, "many">>;
        verifiers: z.ZodArray<z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>, "many">;
        independentReview: z.ZodBoolean;
        status: z.ZodEnum<["candidate", "blocked", "ready", "launched", "rolled_back"]>;
        compiledAt: z.ZodType<string, z.ZodTypeDef, any>;
        expiresAt: z.ZodType<string, z.ZodTypeDef, any>;
        schema: z.ZodLiteral<"hasna.launch_evidence.v1">;
        id: z.ZodString;
        createdAt: z.ZodType<string, z.ZodTypeDef, any>;
        producer: z.ZodType<{
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }, z.ZodTypeDef, any>;
        digest: z.ZodType<string, z.ZodTypeDef, any>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        digest: string;
        deploymentReceipt: {
            id: string;
            digest: string;
            schema: "hasna.deployment_receipt.v1";
        };
        status: "blocked" | "candidate" | "ready" | "launched" | "rolled_back";
        schema: "hasna.launch_evidence.v1";
        createdAt: string;
        proofBundleRefs: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }[];
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        product: {
            id: string;
            digest: string;
            schema: "hasna.product_projection.v1";
            revision: number;
        };
        verifiers: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }[];
        expiresAt: string;
        environment: {
            id: string;
            digest: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
        };
        requiredChecks: {
            id: string;
            kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
            status: "failed" | "blocked" | "passed" | "missing" | "expired";
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
        }[];
        findings: {
            id: string;
            status: "open" | "accepted" | "resolved";
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            severity: "p0" | "p1" | "p2" | "p3";
        }[];
        independentReview: boolean;
        compiledAt: string;
    }, {
        id: string;
        deploymentReceipt: {
            id: string;
            schema: "hasna.deployment_receipt.v1";
            digest?: any;
        };
        status: "blocked" | "candidate" | "ready" | "launched" | "rolled_back";
        schema: "hasna.launch_evidence.v1";
        proofBundleRefs: any[];
        product: {
            id: string;
            schema: "hasna.product_projection.v1";
            revision: number;
            digest?: any;
        };
        verifiers: any[];
        environment: {
            id: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
            digest?: any;
        };
        requiredChecks: {
            id: string;
            kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
            status: "failed" | "blocked" | "passed" | "missing" | "expired";
            evidenceRefs: any[];
        }[];
        independentReview: boolean;
        digest?: any;
        createdAt?: any;
        producer?: any;
        expiresAt?: any;
        findings?: {
            id: string;
            status: "open" | "accepted" | "resolved";
            evidenceRefs: any[];
            severity: "p0" | "p1" | "p2" | "p3";
        }[] | undefined;
        compiledAt?: any;
    }>, {
        id: string;
        digest: string;
        deploymentReceipt: {
            id: string;
            digest: string;
            schema: "hasna.deployment_receipt.v1";
        };
        status: "blocked" | "candidate" | "ready" | "launched" | "rolled_back";
        schema: "hasna.launch_evidence.v1";
        createdAt: string;
        proofBundleRefs: {
            id: string;
            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
            tags: string[];
            name?: string | undefined;
            uri?: string | undefined;
            externalId?: string | undefined;
            sourcePackage?: string | undefined;
        }[];
        producer: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        };
        product: {
            id: string;
            digest: string;
            schema: "hasna.product_projection.v1";
            revision: number;
        };
        verifiers: {
            id: string;
            kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
            name?: string | undefined;
            provider?: string | undefined;
            accountId?: string | undefined;
            machineId?: string | undefined;
        }[];
        expiresAt: string;
        environment: {
            id: string;
            digest: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
        };
        requiredChecks: {
            id: string;
            kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
            status: "failed" | "blocked" | "passed" | "missing" | "expired";
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
        }[];
        findings: {
            id: string;
            status: "open" | "accepted" | "resolved";
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            severity: "p0" | "p1" | "p2" | "p3";
        }[];
        independentReview: boolean;
        compiledAt: string;
    }, {
        id: string;
        deploymentReceipt: {
            id: string;
            schema: "hasna.deployment_receipt.v1";
            digest?: any;
        };
        status: "blocked" | "candidate" | "ready" | "launched" | "rolled_back";
        schema: "hasna.launch_evidence.v1";
        proofBundleRefs: any[];
        product: {
            id: string;
            schema: "hasna.product_projection.v1";
            revision: number;
            digest?: any;
        };
        verifiers: any[];
        environment: {
            id: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
            digest?: any;
        };
        requiredChecks: {
            id: string;
            kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
            status: "failed" | "blocked" | "passed" | "missing" | "expired";
            evidenceRefs: any[];
        }[];
        independentReview: boolean;
        digest?: any;
        createdAt?: any;
        producer?: any;
        expiresAt?: any;
        findings?: {
            id: string;
            status: "open" | "accepted" | "resolved";
            evidenceRefs: any[];
            severity: "p0" | "p1" | "p2" | "p3";
        }[] | undefined;
        compiledAt?: any;
    }>;
    readonly DeploymentSchemaRegistry: Readonly<{
        "hasna.product_projection.v1": z.ZodEffects<z.ZodObject<{
            revision: z.ZodNumber;
            sourceProjectRef: z.ZodType<{
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }, z.ZodTypeDef, any>;
            sourceRevision: z.ZodNumber;
            slug: z.ZodString;
            displayName: z.ZodString;
            repositoryRef: z.ZodType<{
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }, z.ZodTypeDef, any>;
            workspaceRef: z.ZodType<{
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }, z.ZodTypeDef, any>;
            lifecycle: z.ZodEnum<["draft", "active", "paused", "archived"]>;
            ownerRefs: z.ZodArray<z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
            projectedAt: z.ZodType<string, z.ZodTypeDef, any>;
            sourceEvidenceRefs: z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
            schema: z.ZodLiteral<"hasna.product_projection.v1">;
            id: z.ZodString;
            createdAt: z.ZodType<string, z.ZodTypeDef, any>;
            producer: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.product_projection.v1";
            createdAt: string;
            revision: number;
            sourceProjectRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            sourceRevision: number;
            slug: string;
            displayName: string;
            repositoryRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            workspaceRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            lifecycle: "draft" | "active" | "paused" | "archived";
            ownerRefs: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }[];
            projectedAt: string;
            sourceEvidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
        }, {
            id: string;
            schema: "hasna.product_projection.v1";
            revision: number;
            sourceRevision: number;
            slug: string;
            displayName: string;
            lifecycle: "draft" | "active" | "paused" | "archived";
            ownerRefs: any[];
            sourceEvidenceRefs: any[];
            digest?: any;
            createdAt?: any;
            sourceProjectRef?: any;
            repositoryRef?: any;
            workspaceRef?: any;
            projectedAt?: any;
            producer?: any;
        }>, {
            id: string;
            digest: string;
            schema: "hasna.product_projection.v1";
            createdAt: string;
            revision: number;
            sourceProjectRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            sourceRevision: number;
            slug: string;
            displayName: string;
            repositoryRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            workspaceRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            lifecycle: "draft" | "active" | "paused" | "archived";
            ownerRefs: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }[];
            projectedAt: string;
            sourceEvidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
        }, {
            id: string;
            schema: "hasna.product_projection.v1";
            revision: number;
            sourceRevision: number;
            slug: string;
            displayName: string;
            lifecycle: "draft" | "active" | "paused" | "archived";
            ownerRefs: any[];
            sourceEvidenceRefs: any[];
            digest?: any;
            createdAt?: any;
            sourceProjectRef?: any;
            repositoryRef?: any;
            workspaceRef?: any;
            projectedAt?: any;
            producer?: any;
        }>;
        "hasna.intent_snapshot.v1": z.ZodEffects<z.ZodObject<{
            product: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.product_projection.v1">;
                id: z.ZodString;
                revision: z.ZodNumber;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.product_projection.v1";
                revision: number;
            }, {
                id: string;
                schema: "hasna.product_projection.v1";
                revision: number;
                digest?: any;
            }>;
            repositoryRef: z.ZodType<{
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }, z.ZodTypeDef, any>;
            commitSha: z.ZodString;
            treeSha: z.ZodString;
            intentDocument: z.ZodObject<{
                path: z.ZodType<string, z.ZodTypeDef, any>;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                digest: string;
                path: string;
            }, {
                digest?: any;
                path?: any;
            }>;
            processes: z.ZodArray<z.ZodEffects<z.ZodObject<{
                id: z.ZodString;
                role: z.ZodEnum<["web", "worker", "cron", "migration", "scheduler"]>;
                ports: z.ZodDefault<z.ZodArray<z.ZodNumber, "many">>;
                liveness: z.ZodOptional<z.ZodEffects<z.ZodObject<{
                    path: z.ZodString;
                    protocol: z.ZodEnum<["http", "https"]>;
                    expectedStatuses: z.ZodArray<z.ZodNumber, "many">;
                }, "strict", z.ZodTypeAny, {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                }, {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                }>, {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                }, {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                }>>;
                readiness: z.ZodOptional<z.ZodEffects<z.ZodObject<{
                    path: z.ZodString;
                    protocol: z.ZodEnum<["http", "https"]>;
                    expectedStatuses: z.ZodArray<z.ZodNumber, "many">;
                }, "strict", z.ZodTypeAny, {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                }, {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                }>, {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                }, {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                }>>;
                version: z.ZodOptional<z.ZodEffects<z.ZodObject<{
                    path: z.ZodString;
                    protocol: z.ZodEnum<["http", "https"]>;
                    expectedStatuses: z.ZodArray<z.ZodNumber, "many">;
                }, "strict", z.ZodTypeAny, {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                }, {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                }>, {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                }, {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                }>>;
                resources: z.ZodObject<{
                    cpuMillicores: z.ZodNumber;
                    memoryMiB: z.ZodNumber;
                    minReplicas: z.ZodNumber;
                    maxReplicas: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    cpuMillicores: number;
                    memoryMiB: number;
                    minReplicas: number;
                    maxReplicas: number;
                }, {
                    cpuMillicores: number;
                    memoryMiB: number;
                    minReplicas: number;
                    maxReplicas: number;
                }>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                role: "web" | "worker" | "cron" | "migration" | "scheduler";
                ports: number[];
                resources: {
                    cpuMillicores: number;
                    memoryMiB: number;
                    minReplicas: number;
                    maxReplicas: number;
                };
                version?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
                liveness?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
                readiness?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
            }, {
                id: string;
                role: "web" | "worker" | "cron" | "migration" | "scheduler";
                resources: {
                    cpuMillicores: number;
                    memoryMiB: number;
                    minReplicas: number;
                    maxReplicas: number;
                };
                version?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
                ports?: number[] | undefined;
                liveness?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
                readiness?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
            }>, {
                id: string;
                role: "web" | "worker" | "cron" | "migration" | "scheduler";
                ports: number[];
                resources: {
                    cpuMillicores: number;
                    memoryMiB: number;
                    minReplicas: number;
                    maxReplicas: number;
                };
                version?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
                liveness?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
                readiness?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
            }, {
                id: string;
                role: "web" | "worker" | "cron" | "migration" | "scheduler";
                resources: {
                    cpuMillicores: number;
                    memoryMiB: number;
                    minReplicas: number;
                    maxReplicas: number;
                };
                version?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
                ports?: number[] | undefined;
                liveness?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
                readiness?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
            }>, "many">;
            serviceRequirements: z.ZodDefault<z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                kind: z.ZodEnum<["database", "object_storage", "queue", "cron", "worker"]>;
                required: z.ZodBoolean;
                class: z.ZodString;
            }, "strict", z.ZodTypeAny, {
                id: string;
                kind: "worker" | "cron" | "database" | "object_storage" | "queue";
                required: boolean;
                class: string;
            }, {
                id: string;
                kind: "worker" | "cron" | "database" | "object_storage" | "queue";
                required: boolean;
                class: string;
            }>, "many">>;
            migration: z.ZodObject<{
                compatibility: z.ZodEnum<["none", "backward_compatible", "forward_compatible", "breaking"]>;
                order: z.ZodEnum<["before_workload", "after_workload", "independent"]>;
                rollbackClass: z.ZodString;
            }, "strict", z.ZodTypeAny, {
                compatibility: "none" | "backward_compatible" | "forward_compatible" | "breaking";
                order: "before_workload" | "after_workload" | "independent";
                rollbackClass: string;
            }, {
                compatibility: "none" | "backward_compatible" | "forward_compatible" | "breaking";
                order: "before_workload" | "after_workload" | "independent";
                rollbackClass: string;
            }>;
            accessClass: z.ZodString;
            networkClass: z.ZodString;
            backupClass: z.ZodString;
            restoreClass: z.ZodString;
            alarmClass: z.ZodString;
            rollbackClass: z.ZodString;
            configurationRequirements: z.ZodDefault<z.ZodArray<z.ZodEffects<z.ZodObject<{
                name: z.ZodString;
                kind: z.ZodEnum<["configuration", "secret_reference"]>;
                required: z.ZodBoolean;
                referenceClass: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                name: string;
                kind: "configuration" | "secret_reference";
                required: boolean;
                referenceClass?: string | undefined;
            }, {
                name: string;
                kind: "configuration" | "secret_reference";
                required: boolean;
                referenceClass?: string | undefined;
            }>, {
                name: string;
                kind: "configuration" | "secret_reference";
                required: boolean;
                referenceClass?: string | undefined;
            }, {
                name: string;
                kind: "configuration" | "secret_reference";
                required: boolean;
                referenceClass?: string | undefined;
            }>, "many">>;
            validationPlan: z.ZodType<{
                id: string;
                checks: {
                    id: string;
                    kind: "review" | "security" | "eval" | "other" | "command" | "test" | "typecheck" | "lint" | "deploy" | "smoke" | "manual";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    required: boolean;
                    expected?: string | undefined;
                    command?: string | undefined;
                    timeoutMs?: number | undefined;
                }[];
                schema: "hasna.validation_plan.v1";
                createdAt: string;
                objective: string;
                requiredEvidenceKinds: ("report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace")[];
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                subject?: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                } | undefined;
                verifier?: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                } | undefined;
            }, z.ZodTypeDef, any>;
            evidenceRefs: z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
            schema: z.ZodLiteral<"hasna.intent_snapshot.v1">;
            id: z.ZodString;
            createdAt: z.ZodType<string, z.ZodTypeDef, any>;
            producer: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.intent_snapshot.v1";
            createdAt: string;
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            repositoryRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            migration: {
                compatibility: "none" | "backward_compatible" | "forward_compatible" | "breaking";
                order: "before_workload" | "after_workload" | "independent";
                rollbackClass: string;
            };
            product: {
                id: string;
                digest: string;
                schema: "hasna.product_projection.v1";
                revision: number;
            };
            commitSha: string;
            treeSha: string;
            intentDocument: {
                digest: string;
                path: string;
            };
            processes: {
                id: string;
                role: "web" | "worker" | "cron" | "migration" | "scheduler";
                ports: number[];
                resources: {
                    cpuMillicores: number;
                    memoryMiB: number;
                    minReplicas: number;
                    maxReplicas: number;
                };
                version?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
                liveness?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
                readiness?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
            }[];
            serviceRequirements: {
                id: string;
                kind: "worker" | "cron" | "database" | "object_storage" | "queue";
                required: boolean;
                class: string;
            }[];
            rollbackClass: string;
            accessClass: string;
            networkClass: string;
            backupClass: string;
            restoreClass: string;
            alarmClass: string;
            configurationRequirements: {
                name: string;
                kind: "configuration" | "secret_reference";
                required: boolean;
                referenceClass?: string | undefined;
            }[];
            validationPlan: {
                id: string;
                checks: {
                    id: string;
                    kind: "review" | "security" | "eval" | "other" | "command" | "test" | "typecheck" | "lint" | "deploy" | "smoke" | "manual";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    required: boolean;
                    expected?: string | undefined;
                    command?: string | undefined;
                    timeoutMs?: number | undefined;
                }[];
                schema: "hasna.validation_plan.v1";
                createdAt: string;
                objective: string;
                requiredEvidenceKinds: ("report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace")[];
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                subject?: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                } | undefined;
                verifier?: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                } | undefined;
            };
        }, {
            id: string;
            schema: "hasna.intent_snapshot.v1";
            evidenceRefs: any[];
            migration: {
                compatibility: "none" | "backward_compatible" | "forward_compatible" | "breaking";
                order: "before_workload" | "after_workload" | "independent";
                rollbackClass: string;
            };
            product: {
                id: string;
                schema: "hasna.product_projection.v1";
                revision: number;
                digest?: any;
            };
            commitSha: string;
            treeSha: string;
            intentDocument: {
                digest?: any;
                path?: any;
            };
            processes: {
                id: string;
                role: "web" | "worker" | "cron" | "migration" | "scheduler";
                resources: {
                    cpuMillicores: number;
                    memoryMiB: number;
                    minReplicas: number;
                    maxReplicas: number;
                };
                version?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
                ports?: number[] | undefined;
                liveness?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
                readiness?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
            }[];
            rollbackClass: string;
            accessClass: string;
            networkClass: string;
            backupClass: string;
            restoreClass: string;
            alarmClass: string;
            digest?: any;
            createdAt?: any;
            repositoryRef?: any;
            producer?: any;
            serviceRequirements?: {
                id: string;
                kind: "worker" | "cron" | "database" | "object_storage" | "queue";
                required: boolean;
                class: string;
            }[] | undefined;
            configurationRequirements?: {
                name: string;
                kind: "configuration" | "secret_reference";
                required: boolean;
                referenceClass?: string | undefined;
            }[] | undefined;
            validationPlan?: any;
        }>, {
            id: string;
            digest: string;
            schema: "hasna.intent_snapshot.v1";
            createdAt: string;
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            repositoryRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            migration: {
                compatibility: "none" | "backward_compatible" | "forward_compatible" | "breaking";
                order: "before_workload" | "after_workload" | "independent";
                rollbackClass: string;
            };
            product: {
                id: string;
                digest: string;
                schema: "hasna.product_projection.v1";
                revision: number;
            };
            commitSha: string;
            treeSha: string;
            intentDocument: {
                digest: string;
                path: string;
            };
            processes: {
                id: string;
                role: "web" | "worker" | "cron" | "migration" | "scheduler";
                ports: number[];
                resources: {
                    cpuMillicores: number;
                    memoryMiB: number;
                    minReplicas: number;
                    maxReplicas: number;
                };
                version?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
                liveness?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
                readiness?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
            }[];
            serviceRequirements: {
                id: string;
                kind: "worker" | "cron" | "database" | "object_storage" | "queue";
                required: boolean;
                class: string;
            }[];
            rollbackClass: string;
            accessClass: string;
            networkClass: string;
            backupClass: string;
            restoreClass: string;
            alarmClass: string;
            configurationRequirements: {
                name: string;
                kind: "configuration" | "secret_reference";
                required: boolean;
                referenceClass?: string | undefined;
            }[];
            validationPlan: {
                id: string;
                checks: {
                    id: string;
                    kind: "review" | "security" | "eval" | "other" | "command" | "test" | "typecheck" | "lint" | "deploy" | "smoke" | "manual";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    required: boolean;
                    expected?: string | undefined;
                    command?: string | undefined;
                    timeoutMs?: number | undefined;
                }[];
                schema: "hasna.validation_plan.v1";
                createdAt: string;
                objective: string;
                requiredEvidenceKinds: ("report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace")[];
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                subject?: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                } | undefined;
                verifier?: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                } | undefined;
            };
        }, {
            id: string;
            schema: "hasna.intent_snapshot.v1";
            evidenceRefs: any[];
            migration: {
                compatibility: "none" | "backward_compatible" | "forward_compatible" | "breaking";
                order: "before_workload" | "after_workload" | "independent";
                rollbackClass: string;
            };
            product: {
                id: string;
                schema: "hasna.product_projection.v1";
                revision: number;
                digest?: any;
            };
            commitSha: string;
            treeSha: string;
            intentDocument: {
                digest?: any;
                path?: any;
            };
            processes: {
                id: string;
                role: "web" | "worker" | "cron" | "migration" | "scheduler";
                resources: {
                    cpuMillicores: number;
                    memoryMiB: number;
                    minReplicas: number;
                    maxReplicas: number;
                };
                version?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
                ports?: number[] | undefined;
                liveness?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
                readiness?: {
                    path: string;
                    protocol: "http" | "https";
                    expectedStatuses: number[];
                } | undefined;
            }[];
            rollbackClass: string;
            accessClass: string;
            networkClass: string;
            backupClass: string;
            restoreClass: string;
            alarmClass: string;
            digest?: any;
            createdAt?: any;
            repositoryRef?: any;
            producer?: any;
            serviceRequirements?: {
                id: string;
                kind: "worker" | "cron" | "database" | "object_storage" | "queue";
                required: boolean;
                class: string;
            }[] | undefined;
            configurationRequirements?: {
                name: string;
                kind: "configuration" | "secret_reference";
                required: boolean;
                referenceClass?: string | undefined;
            }[] | undefined;
            validationPlan?: any;
        }>;
        "hasna.verified_source_candidate.v1": z.ZodEffects<z.ZodObject<{
            status: z.ZodEnum<["candidate", "verified", "rejected", "superseded"]>;
            repositoryRef: z.ZodType<{
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }, z.ZodTypeDef, any>;
            commitSha: z.ZodString;
            treeSha: z.ZodString;
            branchRef: z.ZodOptional<z.ZodType<{
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }, z.ZodTypeDef, any>>;
            pullRequestRef: z.ZodOptional<z.ZodType<{
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }, z.ZodTypeDef, any>>;
            intent: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.intent_snapshot.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.intent_snapshot.v1";
            }, {
                id: string;
                schema: "hasna.intent_snapshot.v1";
                digest?: any;
            }>;
            validationPlan: z.ZodType<{
                id: string;
                checks: {
                    id: string;
                    kind: "review" | "security" | "eval" | "other" | "command" | "test" | "typecheck" | "lint" | "deploy" | "smoke" | "manual";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    required: boolean;
                    expected?: string | undefined;
                    command?: string | undefined;
                    timeoutMs?: number | undefined;
                }[];
                schema: "hasna.validation_plan.v1";
                createdAt: string;
                objective: string;
                requiredEvidenceKinds: ("report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace")[];
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                subject?: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                } | undefined;
                verifier?: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                } | undefined;
            }, z.ZodTypeDef, any>;
            verificationRun: z.ZodType<{
                actor: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                };
                id: string;
                status: "unknown" | "skipped" | "pending" | "running" | "succeeded" | "failed" | "cancelled" | "blocked";
                schema: "hasna.work_run.v1";
                createdAt: string;
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                objective: string;
                constraints: string[];
                decisions: {
                    id: string;
                    status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
                    schema: "hasna.decision_envelope.v1";
                    createdAt: string;
                    decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
                    selected: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    skipped: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    reason: string;
                    obligations: string[];
                    redactions: string[];
                    evidenceRefs: {
                        id: string;
                        kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                        sha256?: string | undefined;
                        uri?: string | undefined;
                        summary?: string | undefined;
                    }[];
                    actor?: {
                        id: string;
                        kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                        name?: string | undefined;
                        provider?: string | undefined;
                        accountId?: string | undefined;
                        machineId?: string | undefined;
                    } | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    traceId?: string | undefined;
                    inputHash?: string | undefined;
                    policyBundleId?: string | undefined;
                    costEstimate?: {
                        id: string;
                        schema: "hasna.cost_estimate.v1";
                        createdAt: string;
                        currency: string;
                        amountMicros: number;
                        basis: "limit" | "actual" | "estimated" | "budget";
                        resourceRefs: {
                            id: string;
                            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                            tags: string[];
                            name?: string | undefined;
                            uri?: string | undefined;
                            externalId?: string | undefined;
                            sourcePackage?: string | undefined;
                        }[];
                        model?: string | undefined;
                        provider?: string | undefined;
                        accountId?: string | undefined;
                        updatedAt?: string | null | undefined;
                        metadata?: Record<string, unknown> | undefined;
                        promptTokens?: number | undefined;
                        completionTokens?: number | undefined;
                        totalTokens?: number | undefined;
                    } | undefined;
                }[];
                costEstimates: {
                    id: string;
                    schema: "hasna.cost_estimate.v1";
                    createdAt: string;
                    currency: string;
                    amountMicros: number;
                    basis: "limit" | "actual" | "estimated" | "budget";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    model?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    promptTokens?: number | undefined;
                    completionTokens?: number | undefined;
                    totalTokens?: number | undefined;
                }[];
                validationPlanRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                proofBundleRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                traceId?: string | undefined;
                startedAt?: string | null | undefined;
                finishedAt?: string | null | undefined;
            }, z.ZodTypeDef, any>;
            results: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                kind: z.ZodEnum<["review", "test", "policy", "source_integrity"]>;
                status: z.ZodEnum<["passed", "failed", "not_run"]>;
                evidenceRefs: z.ZodArray<z.ZodType<{
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }, z.ZodTypeDef, any>, "many">;
            }, "strict", z.ZodTypeAny, {
                id: string;
                kind: "review" | "policy" | "test" | "source_integrity";
                status: "failed" | "passed" | "not_run";
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
            }, {
                id: string;
                kind: "review" | "policy" | "test" | "source_integrity";
                status: "failed" | "passed" | "not_run";
                evidenceRefs: any[];
            }>, "many">;
            verifiers: z.ZodArray<z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
            verifiedAt: z.ZodType<string, z.ZodTypeDef, any>;
            evidenceRefs: z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
            schema: z.ZodLiteral<"hasna.verified_source_candidate.v1">;
            id: z.ZodString;
            createdAt: z.ZodType<string, z.ZodTypeDef, any>;
            producer: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            status: "candidate" | "verified" | "rejected" | "superseded";
            schema: "hasna.verified_source_candidate.v1";
            createdAt: string;
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            repositoryRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            commitSha: string;
            treeSha: string;
            validationPlan: {
                id: string;
                checks: {
                    id: string;
                    kind: "review" | "security" | "eval" | "other" | "command" | "test" | "typecheck" | "lint" | "deploy" | "smoke" | "manual";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    required: boolean;
                    expected?: string | undefined;
                    command?: string | undefined;
                    timeoutMs?: number | undefined;
                }[];
                schema: "hasna.validation_plan.v1";
                createdAt: string;
                objective: string;
                requiredEvidenceKinds: ("report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace")[];
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                subject?: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                } | undefined;
                verifier?: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                } | undefined;
            };
            intent: {
                id: string;
                digest: string;
                schema: "hasna.intent_snapshot.v1";
            };
            verificationRun: {
                actor: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                };
                id: string;
                status: "unknown" | "skipped" | "pending" | "running" | "succeeded" | "failed" | "cancelled" | "blocked";
                schema: "hasna.work_run.v1";
                createdAt: string;
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                objective: string;
                constraints: string[];
                decisions: {
                    id: string;
                    status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
                    schema: "hasna.decision_envelope.v1";
                    createdAt: string;
                    decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
                    selected: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    skipped: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    reason: string;
                    obligations: string[];
                    redactions: string[];
                    evidenceRefs: {
                        id: string;
                        kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                        sha256?: string | undefined;
                        uri?: string | undefined;
                        summary?: string | undefined;
                    }[];
                    actor?: {
                        id: string;
                        kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                        name?: string | undefined;
                        provider?: string | undefined;
                        accountId?: string | undefined;
                        machineId?: string | undefined;
                    } | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    traceId?: string | undefined;
                    inputHash?: string | undefined;
                    policyBundleId?: string | undefined;
                    costEstimate?: {
                        id: string;
                        schema: "hasna.cost_estimate.v1";
                        createdAt: string;
                        currency: string;
                        amountMicros: number;
                        basis: "limit" | "actual" | "estimated" | "budget";
                        resourceRefs: {
                            id: string;
                            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                            tags: string[];
                            name?: string | undefined;
                            uri?: string | undefined;
                            externalId?: string | undefined;
                            sourcePackage?: string | undefined;
                        }[];
                        model?: string | undefined;
                        provider?: string | undefined;
                        accountId?: string | undefined;
                        updatedAt?: string | null | undefined;
                        metadata?: Record<string, unknown> | undefined;
                        promptTokens?: number | undefined;
                        completionTokens?: number | undefined;
                        totalTokens?: number | undefined;
                    } | undefined;
                }[];
                costEstimates: {
                    id: string;
                    schema: "hasna.cost_estimate.v1";
                    createdAt: string;
                    currency: string;
                    amountMicros: number;
                    basis: "limit" | "actual" | "estimated" | "budget";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    model?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    promptTokens?: number | undefined;
                    completionTokens?: number | undefined;
                    totalTokens?: number | undefined;
                }[];
                validationPlanRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                proofBundleRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                traceId?: string | undefined;
                startedAt?: string | null | undefined;
                finishedAt?: string | null | undefined;
            };
            results: {
                id: string;
                kind: "review" | "policy" | "test" | "source_integrity";
                status: "failed" | "passed" | "not_run";
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
            }[];
            verifiers: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }[];
            verifiedAt: string;
            branchRef?: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            } | undefined;
            pullRequestRef?: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            } | undefined;
        }, {
            id: string;
            status: "candidate" | "verified" | "rejected" | "superseded";
            schema: "hasna.verified_source_candidate.v1";
            evidenceRefs: any[];
            commitSha: string;
            treeSha: string;
            intent: {
                id: string;
                schema: "hasna.intent_snapshot.v1";
                digest?: any;
            };
            results: {
                id: string;
                kind: "review" | "policy" | "test" | "source_integrity";
                status: "failed" | "passed" | "not_run";
                evidenceRefs: any[];
            }[];
            verifiers: any[];
            digest?: any;
            createdAt?: any;
            repositoryRef?: any;
            producer?: any;
            validationPlan?: any;
            branchRef?: any;
            pullRequestRef?: any;
            verificationRun?: any;
            verifiedAt?: any;
        }>, {
            id: string;
            digest: string;
            status: "candidate" | "verified" | "rejected" | "superseded";
            schema: "hasna.verified_source_candidate.v1";
            createdAt: string;
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            repositoryRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            commitSha: string;
            treeSha: string;
            validationPlan: {
                id: string;
                checks: {
                    id: string;
                    kind: "review" | "security" | "eval" | "other" | "command" | "test" | "typecheck" | "lint" | "deploy" | "smoke" | "manual";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    required: boolean;
                    expected?: string | undefined;
                    command?: string | undefined;
                    timeoutMs?: number | undefined;
                }[];
                schema: "hasna.validation_plan.v1";
                createdAt: string;
                objective: string;
                requiredEvidenceKinds: ("report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace")[];
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                subject?: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                } | undefined;
                verifier?: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                } | undefined;
            };
            intent: {
                id: string;
                digest: string;
                schema: "hasna.intent_snapshot.v1";
            };
            verificationRun: {
                actor: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                };
                id: string;
                status: "unknown" | "skipped" | "pending" | "running" | "succeeded" | "failed" | "cancelled" | "blocked";
                schema: "hasna.work_run.v1";
                createdAt: string;
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                objective: string;
                constraints: string[];
                decisions: {
                    id: string;
                    status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
                    schema: "hasna.decision_envelope.v1";
                    createdAt: string;
                    decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
                    selected: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    skipped: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    reason: string;
                    obligations: string[];
                    redactions: string[];
                    evidenceRefs: {
                        id: string;
                        kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                        sha256?: string | undefined;
                        uri?: string | undefined;
                        summary?: string | undefined;
                    }[];
                    actor?: {
                        id: string;
                        kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                        name?: string | undefined;
                        provider?: string | undefined;
                        accountId?: string | undefined;
                        machineId?: string | undefined;
                    } | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    traceId?: string | undefined;
                    inputHash?: string | undefined;
                    policyBundleId?: string | undefined;
                    costEstimate?: {
                        id: string;
                        schema: "hasna.cost_estimate.v1";
                        createdAt: string;
                        currency: string;
                        amountMicros: number;
                        basis: "limit" | "actual" | "estimated" | "budget";
                        resourceRefs: {
                            id: string;
                            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                            tags: string[];
                            name?: string | undefined;
                            uri?: string | undefined;
                            externalId?: string | undefined;
                            sourcePackage?: string | undefined;
                        }[];
                        model?: string | undefined;
                        provider?: string | undefined;
                        accountId?: string | undefined;
                        updatedAt?: string | null | undefined;
                        metadata?: Record<string, unknown> | undefined;
                        promptTokens?: number | undefined;
                        completionTokens?: number | undefined;
                        totalTokens?: number | undefined;
                    } | undefined;
                }[];
                costEstimates: {
                    id: string;
                    schema: "hasna.cost_estimate.v1";
                    createdAt: string;
                    currency: string;
                    amountMicros: number;
                    basis: "limit" | "actual" | "estimated" | "budget";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    model?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    promptTokens?: number | undefined;
                    completionTokens?: number | undefined;
                    totalTokens?: number | undefined;
                }[];
                validationPlanRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                proofBundleRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                traceId?: string | undefined;
                startedAt?: string | null | undefined;
                finishedAt?: string | null | undefined;
            };
            results: {
                id: string;
                kind: "review" | "policy" | "test" | "source_integrity";
                status: "failed" | "passed" | "not_run";
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
            }[];
            verifiers: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }[];
            verifiedAt: string;
            branchRef?: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            } | undefined;
            pullRequestRef?: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            } | undefined;
        }, {
            id: string;
            status: "candidate" | "verified" | "rejected" | "superseded";
            schema: "hasna.verified_source_candidate.v1";
            evidenceRefs: any[];
            commitSha: string;
            treeSha: string;
            intent: {
                id: string;
                schema: "hasna.intent_snapshot.v1";
                digest?: any;
            };
            results: {
                id: string;
                kind: "review" | "policy" | "test" | "source_integrity";
                status: "failed" | "passed" | "not_run";
                evidenceRefs: any[];
            }[];
            verifiers: any[];
            digest?: any;
            createdAt?: any;
            repositoryRef?: any;
            producer?: any;
            validationPlan?: any;
            branchRef?: any;
            pullRequestRef?: any;
            verificationRun?: any;
            verifiedAt?: any;
        }>;
        "hasna.build_artifact.v1": z.ZodEffects<z.ZodObject<{
            kind: z.ZodEnum<["oci_image", "archive", "binary"]>;
            mediaType: z.ZodString;
            uri: z.ZodType<string, z.ZodTypeDef, any>;
            artifactDigest: z.ZodType<string, z.ZodTypeDef, any>;
            sourceCandidate: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.verified_source_candidate.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.verified_source_candidate.v1";
            }, {
                id: string;
                schema: "hasna.verified_source_candidate.v1";
                digest?: any;
            }>;
            repositoryCommitSha: z.ZodString;
            repositoryTreeSha: z.ZodString;
            buildWorkflowRef: z.ZodType<{
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }, z.ZodTypeDef, any>;
            buildRun: z.ZodType<{
                actor: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                };
                id: string;
                status: "unknown" | "skipped" | "pending" | "running" | "succeeded" | "failed" | "cancelled" | "blocked";
                schema: "hasna.work_run.v1";
                createdAt: string;
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                objective: string;
                constraints: string[];
                decisions: {
                    id: string;
                    status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
                    schema: "hasna.decision_envelope.v1";
                    createdAt: string;
                    decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
                    selected: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    skipped: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    reason: string;
                    obligations: string[];
                    redactions: string[];
                    evidenceRefs: {
                        id: string;
                        kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                        sha256?: string | undefined;
                        uri?: string | undefined;
                        summary?: string | undefined;
                    }[];
                    actor?: {
                        id: string;
                        kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                        name?: string | undefined;
                        provider?: string | undefined;
                        accountId?: string | undefined;
                        machineId?: string | undefined;
                    } | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    traceId?: string | undefined;
                    inputHash?: string | undefined;
                    policyBundleId?: string | undefined;
                    costEstimate?: {
                        id: string;
                        schema: "hasna.cost_estimate.v1";
                        createdAt: string;
                        currency: string;
                        amountMicros: number;
                        basis: "limit" | "actual" | "estimated" | "budget";
                        resourceRefs: {
                            id: string;
                            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                            tags: string[];
                            name?: string | undefined;
                            uri?: string | undefined;
                            externalId?: string | undefined;
                            sourcePackage?: string | undefined;
                        }[];
                        model?: string | undefined;
                        provider?: string | undefined;
                        accountId?: string | undefined;
                        updatedAt?: string | null | undefined;
                        metadata?: Record<string, unknown> | undefined;
                        promptTokens?: number | undefined;
                        completionTokens?: number | undefined;
                        totalTokens?: number | undefined;
                    } | undefined;
                }[];
                costEstimates: {
                    id: string;
                    schema: "hasna.cost_estimate.v1";
                    createdAt: string;
                    currency: string;
                    amountMicros: number;
                    basis: "limit" | "actual" | "estimated" | "budget";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    model?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    promptTokens?: number | undefined;
                    completionTokens?: number | undefined;
                    totalTokens?: number | undefined;
                }[];
                validationPlanRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                proofBundleRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                traceId?: string | undefined;
                startedAt?: string | null | undefined;
                finishedAt?: string | null | undefined;
            }, z.ZodTypeDef, any>;
            builder: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            sbomRefs: z.ZodDefault<z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">>;
            provenanceRefs: z.ZodDefault<z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">>;
            scanRefs: z.ZodDefault<z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">>;
            signatureRefs: z.ZodDefault<z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">>;
            status: z.ZodEnum<["active", "superseded", "revoked"]>;
            schema: z.ZodLiteral<"hasna.build_artifact.v1">;
            id: z.ZodString;
            createdAt: z.ZodType<string, z.ZodTypeDef, any>;
            producer: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            kind: "binary" | "oci_image" | "archive";
            digest: string;
            mediaType: string;
            status: "active" | "superseded" | "revoked";
            schema: "hasna.build_artifact.v1";
            createdAt: string;
            uri: string;
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            artifactDigest: string;
            sourceCandidate: {
                id: string;
                digest: string;
                schema: "hasna.verified_source_candidate.v1";
            };
            repositoryCommitSha: string;
            repositoryTreeSha: string;
            buildWorkflowRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            buildRun: {
                actor: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                };
                id: string;
                status: "unknown" | "skipped" | "pending" | "running" | "succeeded" | "failed" | "cancelled" | "blocked";
                schema: "hasna.work_run.v1";
                createdAt: string;
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                objective: string;
                constraints: string[];
                decisions: {
                    id: string;
                    status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
                    schema: "hasna.decision_envelope.v1";
                    createdAt: string;
                    decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
                    selected: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    skipped: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    reason: string;
                    obligations: string[];
                    redactions: string[];
                    evidenceRefs: {
                        id: string;
                        kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                        sha256?: string | undefined;
                        uri?: string | undefined;
                        summary?: string | undefined;
                    }[];
                    actor?: {
                        id: string;
                        kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                        name?: string | undefined;
                        provider?: string | undefined;
                        accountId?: string | undefined;
                        machineId?: string | undefined;
                    } | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    traceId?: string | undefined;
                    inputHash?: string | undefined;
                    policyBundleId?: string | undefined;
                    costEstimate?: {
                        id: string;
                        schema: "hasna.cost_estimate.v1";
                        createdAt: string;
                        currency: string;
                        amountMicros: number;
                        basis: "limit" | "actual" | "estimated" | "budget";
                        resourceRefs: {
                            id: string;
                            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                            tags: string[];
                            name?: string | undefined;
                            uri?: string | undefined;
                            externalId?: string | undefined;
                            sourcePackage?: string | undefined;
                        }[];
                        model?: string | undefined;
                        provider?: string | undefined;
                        accountId?: string | undefined;
                        updatedAt?: string | null | undefined;
                        metadata?: Record<string, unknown> | undefined;
                        promptTokens?: number | undefined;
                        completionTokens?: number | undefined;
                        totalTokens?: number | undefined;
                    } | undefined;
                }[];
                costEstimates: {
                    id: string;
                    schema: "hasna.cost_estimate.v1";
                    createdAt: string;
                    currency: string;
                    amountMicros: number;
                    basis: "limit" | "actual" | "estimated" | "budget";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    model?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    promptTokens?: number | undefined;
                    completionTokens?: number | undefined;
                    totalTokens?: number | undefined;
                }[];
                validationPlanRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                proofBundleRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                traceId?: string | undefined;
                startedAt?: string | null | undefined;
                finishedAt?: string | null | undefined;
            };
            builder: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            sbomRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            provenanceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            scanRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            signatureRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
        }, {
            id: string;
            kind: "binary" | "oci_image" | "archive";
            mediaType: string;
            status: "active" | "superseded" | "revoked";
            schema: "hasna.build_artifact.v1";
            sourceCandidate: {
                id: string;
                schema: "hasna.verified_source_candidate.v1";
                digest?: any;
            };
            repositoryCommitSha: string;
            repositoryTreeSha: string;
            digest?: any;
            createdAt?: any;
            uri?: any;
            producer?: any;
            artifactDigest?: any;
            buildWorkflowRef?: any;
            buildRun?: any;
            builder?: any;
            sbomRefs?: any[] | undefined;
            provenanceRefs?: any[] | undefined;
            scanRefs?: any[] | undefined;
            signatureRefs?: any[] | undefined;
        }>, {
            id: string;
            kind: "binary" | "oci_image" | "archive";
            digest: string;
            mediaType: string;
            status: "active" | "superseded" | "revoked";
            schema: "hasna.build_artifact.v1";
            createdAt: string;
            uri: string;
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            artifactDigest: string;
            sourceCandidate: {
                id: string;
                digest: string;
                schema: "hasna.verified_source_candidate.v1";
            };
            repositoryCommitSha: string;
            repositoryTreeSha: string;
            buildWorkflowRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            buildRun: {
                actor: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                };
                id: string;
                status: "unknown" | "skipped" | "pending" | "running" | "succeeded" | "failed" | "cancelled" | "blocked";
                schema: "hasna.work_run.v1";
                createdAt: string;
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                objective: string;
                constraints: string[];
                decisions: {
                    id: string;
                    status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
                    schema: "hasna.decision_envelope.v1";
                    createdAt: string;
                    decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
                    selected: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    skipped: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    reason: string;
                    obligations: string[];
                    redactions: string[];
                    evidenceRefs: {
                        id: string;
                        kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                        sha256?: string | undefined;
                        uri?: string | undefined;
                        summary?: string | undefined;
                    }[];
                    actor?: {
                        id: string;
                        kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                        name?: string | undefined;
                        provider?: string | undefined;
                        accountId?: string | undefined;
                        machineId?: string | undefined;
                    } | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    traceId?: string | undefined;
                    inputHash?: string | undefined;
                    policyBundleId?: string | undefined;
                    costEstimate?: {
                        id: string;
                        schema: "hasna.cost_estimate.v1";
                        createdAt: string;
                        currency: string;
                        amountMicros: number;
                        basis: "limit" | "actual" | "estimated" | "budget";
                        resourceRefs: {
                            id: string;
                            kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                            tags: string[];
                            name?: string | undefined;
                            uri?: string | undefined;
                            externalId?: string | undefined;
                            sourcePackage?: string | undefined;
                        }[];
                        model?: string | undefined;
                        provider?: string | undefined;
                        accountId?: string | undefined;
                        updatedAt?: string | null | undefined;
                        metadata?: Record<string, unknown> | undefined;
                        promptTokens?: number | undefined;
                        completionTokens?: number | undefined;
                        totalTokens?: number | undefined;
                    } | undefined;
                }[];
                costEstimates: {
                    id: string;
                    schema: "hasna.cost_estimate.v1";
                    createdAt: string;
                    currency: string;
                    amountMicros: number;
                    basis: "limit" | "actual" | "estimated" | "budget";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    model?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    promptTokens?: number | undefined;
                    completionTokens?: number | undefined;
                    totalTokens?: number | undefined;
                }[];
                validationPlanRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                proofBundleRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                traceId?: string | undefined;
                startedAt?: string | null | undefined;
                finishedAt?: string | null | undefined;
            };
            builder: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            sbomRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            provenanceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            scanRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            signatureRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
        }, {
            id: string;
            kind: "binary" | "oci_image" | "archive";
            mediaType: string;
            status: "active" | "superseded" | "revoked";
            schema: "hasna.build_artifact.v1";
            sourceCandidate: {
                id: string;
                schema: "hasna.verified_source_candidate.v1";
                digest?: any;
            };
            repositoryCommitSha: string;
            repositoryTreeSha: string;
            digest?: any;
            createdAt?: any;
            uri?: any;
            producer?: any;
            artifactDigest?: any;
            buildWorkflowRef?: any;
            buildRun?: any;
            builder?: any;
            sbomRefs?: any[] | undefined;
            provenanceRefs?: any[] | undefined;
            scanRefs?: any[] | undefined;
            signatureRefs?: any[] | undefined;
        }>;
        "hasna.artifact_attestation.v1": z.ZodEffects<z.ZodObject<{
            artifact: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.build_artifact.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.build_artifact.v1";
            }, {
                id: string;
                schema: "hasna.build_artifact.v1";
                digest?: any;
            }>;
            artifactDigest: z.ZodType<string, z.ZodTypeDef, any>;
            predicateKind: z.ZodString;
            predicateSchemaVersion: z.ZodString;
            issuer: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            keyRef: z.ZodType<{
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }, z.ZodTypeDef, any>;
            signatureRef: z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>;
            policyResult: z.ZodEnum<["passed", "failed"]>;
            policyRevision: z.ZodNumber;
            expiresAt: z.ZodOptional<z.ZodNullable<z.ZodType<string, z.ZodTypeDef, any>>>;
            evidenceRefs: z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
            schema: z.ZodLiteral<"hasna.artifact_attestation.v1">;
            id: z.ZodString;
            createdAt: z.ZodType<string, z.ZodTypeDef, any>;
            producer: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.artifact_attestation.v1";
            createdAt: string;
            artifact: {
                id: string;
                digest: string;
                schema: "hasna.build_artifact.v1";
            };
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            artifactDigest: string;
            predicateKind: string;
            predicateSchemaVersion: string;
            issuer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            keyRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            signatureRef: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            };
            policyResult: "failed" | "passed";
            policyRevision: number;
            expiresAt?: string | null | undefined;
        }, {
            id: string;
            schema: "hasna.artifact_attestation.v1";
            artifact: {
                id: string;
                schema: "hasna.build_artifact.v1";
                digest?: any;
            };
            evidenceRefs: any[];
            predicateKind: string;
            predicateSchemaVersion: string;
            policyResult: "failed" | "passed";
            policyRevision: number;
            digest?: any;
            createdAt?: any;
            producer?: any;
            artifactDigest?: any;
            issuer?: any;
            keyRef?: any;
            signatureRef?: any;
            expiresAt?: any;
        }>, {
            id: string;
            digest: string;
            schema: "hasna.artifact_attestation.v1";
            createdAt: string;
            artifact: {
                id: string;
                digest: string;
                schema: "hasna.build_artifact.v1";
            };
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            artifactDigest: string;
            predicateKind: string;
            predicateSchemaVersion: string;
            issuer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            keyRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            signatureRef: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            };
            policyResult: "failed" | "passed";
            policyRevision: number;
            expiresAt?: string | null | undefined;
        }, {
            id: string;
            schema: "hasna.artifact_attestation.v1";
            artifact: {
                id: string;
                schema: "hasna.build_artifact.v1";
                digest?: any;
            };
            evidenceRefs: any[];
            predicateKind: string;
            predicateSchemaVersion: string;
            policyResult: "failed" | "passed";
            policyRevision: number;
            digest?: any;
            createdAt?: any;
            producer?: any;
            artifactDigest?: any;
            issuer?: any;
            keyRef?: any;
            signatureRef?: any;
            expiresAt?: any;
        }>;
        "hasna.environment_binding.v1": z.ZodEffects<z.ZodObject<{
            updatedAt: z.ZodType<string, z.ZodTypeDef, any>;
            revision: z.ZodNumber;
            etag: z.ZodType<string, z.ZodTypeDef, any>;
            product: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.product_projection.v1">;
                id: z.ZodString;
                revision: z.ZodNumber;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.product_projection.v1";
                revision: number;
            }, {
                id: string;
                schema: "hasna.product_projection.v1";
                revision: number;
                digest?: any;
            }>;
            intent: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.intent_snapshot.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.intent_snapshot.v1";
            }, {
                id: string;
                schema: "hasna.intent_snapshot.v1";
                digest?: any;
            }>;
            environment: z.ZodObject<{
                id: z.ZodString;
                classification: z.ZodEnum<["development", "staging", "production", "disaster_recovery"]>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                classification: "development" | "staging" | "production" | "disaster_recovery";
            }, {
                id: string;
                classification: "development" | "staging" | "production" | "disaster_recovery";
            }>;
            dataBackend: z.ZodEnum<["sqlite", "postgresql"]>;
            providerConnectionRef: z.ZodType<{
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }, z.ZodTypeDef, any>;
            providerCapabilityCard: z.ZodType<{
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                providerId: string;
                appId: string;
                adapterId: string;
                ownerPackage: string;
                modes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
                defaultMode: "mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating";
                credentialRequirements: {
                    refName: string;
                    requiredForModes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
                    allowedSecretInputs: ("credential_ref" | "lease_ref")[];
                    failClosedDiagnostic: string;
                    revocationCheck: boolean;
                }[];
                operations: {
                    operation: string;
                    supportedModes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
                    sideEffectClass: "none" | "read_only" | "external_notification" | "external_mutation" | "money_movement" | "dns_or_domain_change" | "bulk_message_or_call" | "legal_or_filing" | "compute_or_infra_mutation" | "irreversible";
                    requiresApproval: boolean;
                    requiresIdempotencyKey: boolean;
                    requiresSandboxEvidence: boolean;
                    requiresRollbackOrRevocation: boolean;
                    rollbackOrRevocation?: string | undefined;
                    noSideEffectSmoke?: string | undefined;
                    reconciliation?: string | undefined;
                }[];
                rateLimitPosture: string;
                auditEvents: string[];
                redactionRules: string[];
                costPosture?: string | undefined;
            }, z.ZodTypeDef, any>;
            providerCapabilityDigest: z.ZodType<string, z.ZodTypeDef, any>;
            providerIdentity: z.ZodEffects<z.ZodObject<{
                accountId: z.ZodString;
                region: z.ZodString;
                projectId: z.ZodOptional<z.ZodString>;
                clusterId: z.ZodOptional<z.ZodString>;
                networkId: z.ZodOptional<z.ZodString>;
                storageId: z.ZodOptional<z.ZodString>;
                routingId: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                accountId: string;
                region: string;
                projectId?: string | undefined;
                clusterId?: string | undefined;
                networkId?: string | undefined;
                storageId?: string | undefined;
                routingId?: string | undefined;
            }, {
                accountId: string;
                region: string;
                projectId?: string | undefined;
                clusterId?: string | undefined;
                networkId?: string | undefined;
                storageId?: string | undefined;
                routingId?: string | undefined;
            }>, {
                accountId: string;
                region: string;
                projectId?: string | undefined;
                clusterId?: string | undefined;
                networkId?: string | undefined;
                storageId?: string | undefined;
                routingId?: string | undefined;
            }, {
                accountId: string;
                region: string;
                projectId?: string | undefined;
                clusterId?: string | undefined;
                networkId?: string | undefined;
                storageId?: string | undefined;
                routingId?: string | undefined;
            }>;
            policyProfile: z.ZodString;
            authorizationProfile: z.ZodString;
            dataClassification: z.ZodEnum<["public", "internal", "private", "sensitive"]>;
            backupProfile: z.ZodString;
            rollbackProfile: z.ZodString;
            commercialBindingRef: z.ZodOptional<z.ZodType<{
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }, z.ZodTypeDef, any>>;
            writer: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            changeEvidenceRefs: z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
            schema: z.ZodLiteral<"hasna.environment_binding.v1">;
            id: z.ZodString;
            createdAt: z.ZodType<string, z.ZodTypeDef, any>;
            producer: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.environment_binding.v1";
            createdAt: string;
            updatedAt: string;
            revision: number;
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            product: {
                id: string;
                digest: string;
                schema: "hasna.product_projection.v1";
                revision: number;
            };
            intent: {
                id: string;
                digest: string;
                schema: "hasna.intent_snapshot.v1";
            };
            etag: string;
            environment: {
                id: string;
                classification: "development" | "staging" | "production" | "disaster_recovery";
            };
            dataBackend: "sqlite" | "postgresql";
            providerConnectionRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            providerCapabilityCard: {
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                providerId: string;
                appId: string;
                adapterId: string;
                ownerPackage: string;
                modes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
                defaultMode: "mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating";
                credentialRequirements: {
                    refName: string;
                    requiredForModes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
                    allowedSecretInputs: ("credential_ref" | "lease_ref")[];
                    failClosedDiagnostic: string;
                    revocationCheck: boolean;
                }[];
                operations: {
                    operation: string;
                    supportedModes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
                    sideEffectClass: "none" | "read_only" | "external_notification" | "external_mutation" | "money_movement" | "dns_or_domain_change" | "bulk_message_or_call" | "legal_or_filing" | "compute_or_infra_mutation" | "irreversible";
                    requiresApproval: boolean;
                    requiresIdempotencyKey: boolean;
                    requiresSandboxEvidence: boolean;
                    requiresRollbackOrRevocation: boolean;
                    rollbackOrRevocation?: string | undefined;
                    noSideEffectSmoke?: string | undefined;
                    reconciliation?: string | undefined;
                }[];
                rateLimitPosture: string;
                auditEvents: string[];
                redactionRules: string[];
                costPosture?: string | undefined;
            };
            providerCapabilityDigest: string;
            providerIdentity: {
                accountId: string;
                region: string;
                projectId?: string | undefined;
                clusterId?: string | undefined;
                networkId?: string | undefined;
                storageId?: string | undefined;
                routingId?: string | undefined;
            };
            policyProfile: string;
            authorizationProfile: string;
            dataClassification: "public" | "internal" | "private" | "sensitive";
            backupProfile: string;
            rollbackProfile: string;
            writer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            changeEvidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            commercialBindingRef?: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            } | undefined;
        }, {
            id: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
            product: {
                id: string;
                schema: "hasna.product_projection.v1";
                revision: number;
                digest?: any;
            };
            intent: {
                id: string;
                schema: "hasna.intent_snapshot.v1";
                digest?: any;
            };
            environment: {
                id: string;
                classification: "development" | "staging" | "production" | "disaster_recovery";
            };
            dataBackend: "sqlite" | "postgresql";
            providerIdentity: {
                accountId: string;
                region: string;
                projectId?: string | undefined;
                clusterId?: string | undefined;
                networkId?: string | undefined;
                storageId?: string | undefined;
                routingId?: string | undefined;
            };
            policyProfile: string;
            authorizationProfile: string;
            dataClassification: "public" | "internal" | "private" | "sensitive";
            backupProfile: string;
            rollbackProfile: string;
            changeEvidenceRefs: any[];
            digest?: any;
            createdAt?: any;
            updatedAt?: any;
            producer?: any;
            etag?: any;
            providerConnectionRef?: any;
            providerCapabilityCard?: any;
            providerCapabilityDigest?: any;
            commercialBindingRef?: any;
            writer?: any;
        }>, {
            id: string;
            digest: string;
            schema: "hasna.environment_binding.v1";
            createdAt: string;
            updatedAt: string;
            revision: number;
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            product: {
                id: string;
                digest: string;
                schema: "hasna.product_projection.v1";
                revision: number;
            };
            intent: {
                id: string;
                digest: string;
                schema: "hasna.intent_snapshot.v1";
            };
            etag: string;
            environment: {
                id: string;
                classification: "development" | "staging" | "production" | "disaster_recovery";
            };
            dataBackend: "sqlite" | "postgresql";
            providerConnectionRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            providerCapabilityCard: {
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                providerId: string;
                appId: string;
                adapterId: string;
                ownerPackage: string;
                modes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
                defaultMode: "mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating";
                credentialRequirements: {
                    refName: string;
                    requiredForModes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
                    allowedSecretInputs: ("credential_ref" | "lease_ref")[];
                    failClosedDiagnostic: string;
                    revocationCheck: boolean;
                }[];
                operations: {
                    operation: string;
                    supportedModes: ("mock" | "fixture" | "sandbox" | "read_only_live" | "live_mutating")[];
                    sideEffectClass: "none" | "read_only" | "external_notification" | "external_mutation" | "money_movement" | "dns_or_domain_change" | "bulk_message_or_call" | "legal_or_filing" | "compute_or_infra_mutation" | "irreversible";
                    requiresApproval: boolean;
                    requiresIdempotencyKey: boolean;
                    requiresSandboxEvidence: boolean;
                    requiresRollbackOrRevocation: boolean;
                    rollbackOrRevocation?: string | undefined;
                    noSideEffectSmoke?: string | undefined;
                    reconciliation?: string | undefined;
                }[];
                rateLimitPosture: string;
                auditEvents: string[];
                redactionRules: string[];
                costPosture?: string | undefined;
            };
            providerCapabilityDigest: string;
            providerIdentity: {
                accountId: string;
                region: string;
                projectId?: string | undefined;
                clusterId?: string | undefined;
                networkId?: string | undefined;
                storageId?: string | undefined;
                routingId?: string | undefined;
            };
            policyProfile: string;
            authorizationProfile: string;
            dataClassification: "public" | "internal" | "private" | "sensitive";
            backupProfile: string;
            rollbackProfile: string;
            writer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            changeEvidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            commercialBindingRef?: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            } | undefined;
        }, {
            id: string;
            schema: "hasna.environment_binding.v1";
            revision: number;
            product: {
                id: string;
                schema: "hasna.product_projection.v1";
                revision: number;
                digest?: any;
            };
            intent: {
                id: string;
                schema: "hasna.intent_snapshot.v1";
                digest?: any;
            };
            environment: {
                id: string;
                classification: "development" | "staging" | "production" | "disaster_recovery";
            };
            dataBackend: "sqlite" | "postgresql";
            providerIdentity: {
                accountId: string;
                region: string;
                projectId?: string | undefined;
                clusterId?: string | undefined;
                networkId?: string | undefined;
                storageId?: string | undefined;
                routingId?: string | undefined;
            };
            policyProfile: string;
            authorizationProfile: string;
            dataClassification: "public" | "internal" | "private" | "sensitive";
            backupProfile: string;
            rollbackProfile: string;
            changeEvidenceRefs: any[];
            digest?: any;
            createdAt?: any;
            updatedAt?: any;
            producer?: any;
            etag?: any;
            providerConnectionRef?: any;
            providerCapabilityCard?: any;
            providerCapabilityDigest?: any;
            commercialBindingRef?: any;
            writer?: any;
        }>;
        "hasna.deployment_request.v1": z.ZodEffects<z.ZodObject<{
            kind: z.ZodEnum<["deployment", "promotion", "rollback", "reconciliation"]>;
            requester: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            product: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.product_projection.v1">;
                id: z.ZodString;
                revision: z.ZodNumber;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.product_projection.v1";
                revision: number;
            }, {
                id: string;
                schema: "hasna.product_projection.v1";
                revision: number;
                digest?: any;
            }>;
            environment: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.environment_binding.v1">;
                id: z.ZodString;
                revision: z.ZodNumber;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
            }, {
                id: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
                digest?: any;
            }>;
            intent: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.intent_snapshot.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.intent_snapshot.v1";
            }, {
                id: string;
                schema: "hasna.intent_snapshot.v1";
                digest?: any;
            }>;
            artifact: z.ZodOptional<z.ZodObject<{
                schema: z.ZodLiteral<"hasna.build_artifact.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.build_artifact.v1";
            }, {
                id: string;
                schema: "hasna.build_artifact.v1";
                digest?: any;
            }>>;
            attestations: z.ZodDefault<z.ZodArray<z.ZodObject<{
                schema: z.ZodLiteral<"hasna.artifact_attestation.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.artifact_attestation.v1";
            }, {
                id: string;
                schema: "hasna.artifact_attestation.v1";
                digest?: any;
            }>, "many">>;
            priorReceipt: z.ZodOptional<z.ZodObject<{
                schema: z.ZodLiteral<"hasna.deployment_receipt.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.deployment_receipt.v1";
            }, {
                id: string;
                schema: "hasna.deployment_receipt.v1";
                digest?: any;
            }>>;
            policyProfile: z.ZodString;
            idempotencyKeyFingerprint: z.ZodType<string, z.ZodTypeDef, any>;
            requestAt: z.ZodType<string, z.ZodTypeDef, any>;
            expiresAt: z.ZodOptional<z.ZodNullable<z.ZodType<string, z.ZodTypeDef, any>>>;
            sourceRequestId: z.ZodString;
            auditCorrelationId: z.ZodString;
            costEstimate: z.ZodOptional<z.ZodType<{
                id: string;
                schema: "hasna.cost_estimate.v1";
                createdAt: string;
                currency: string;
                amountMicros: number;
                basis: "limit" | "actual" | "estimated" | "budget";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                model?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                promptTokens?: number | undefined;
                completionTokens?: number | undefined;
                totalTokens?: number | undefined;
            }, z.ZodTypeDef, any>>;
            evidenceRefs: z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
            schema: z.ZodLiteral<"hasna.deployment_request.v1">;
            id: z.ZodString;
            createdAt: z.ZodType<string, z.ZodTypeDef, any>;
            producer: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            kind: "reconciliation" | "deployment" | "promotion" | "rollback";
            digest: string;
            schema: "hasna.deployment_request.v1";
            createdAt: string;
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            product: {
                id: string;
                digest: string;
                schema: "hasna.product_projection.v1";
                revision: number;
            };
            intent: {
                id: string;
                digest: string;
                schema: "hasna.intent_snapshot.v1";
            };
            environment: {
                id: string;
                digest: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
            };
            policyProfile: string;
            requester: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            attestations: {
                id: string;
                digest: string;
                schema: "hasna.artifact_attestation.v1";
            }[];
            idempotencyKeyFingerprint: string;
            requestAt: string;
            sourceRequestId: string;
            auditCorrelationId: string;
            artifact?: {
                id: string;
                digest: string;
                schema: "hasna.build_artifact.v1";
            } | undefined;
            costEstimate?: {
                id: string;
                schema: "hasna.cost_estimate.v1";
                createdAt: string;
                currency: string;
                amountMicros: number;
                basis: "limit" | "actual" | "estimated" | "budget";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                model?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                promptTokens?: number | undefined;
                completionTokens?: number | undefined;
                totalTokens?: number | undefined;
            } | undefined;
            expiresAt?: string | null | undefined;
            priorReceipt?: {
                id: string;
                digest: string;
                schema: "hasna.deployment_receipt.v1";
            } | undefined;
        }, {
            id: string;
            kind: "reconciliation" | "deployment" | "promotion" | "rollback";
            schema: "hasna.deployment_request.v1";
            evidenceRefs: any[];
            product: {
                id: string;
                schema: "hasna.product_projection.v1";
                revision: number;
                digest?: any;
            };
            intent: {
                id: string;
                schema: "hasna.intent_snapshot.v1";
                digest?: any;
            };
            environment: {
                id: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
                digest?: any;
            };
            policyProfile: string;
            sourceRequestId: string;
            auditCorrelationId: string;
            digest?: any;
            createdAt?: any;
            artifact?: {
                id: string;
                schema: "hasna.build_artifact.v1";
                digest?: any;
            } | undefined;
            costEstimate?: any;
            producer?: any;
            expiresAt?: any;
            requester?: any;
            attestations?: {
                id: string;
                schema: "hasna.artifact_attestation.v1";
                digest?: any;
            }[] | undefined;
            priorReceipt?: {
                id: string;
                schema: "hasna.deployment_receipt.v1";
                digest?: any;
            } | undefined;
            idempotencyKeyFingerprint?: any;
            requestAt?: any;
        }>, {
            id: string;
            kind: "reconciliation" | "deployment" | "promotion" | "rollback";
            digest: string;
            schema: "hasna.deployment_request.v1";
            createdAt: string;
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            product: {
                id: string;
                digest: string;
                schema: "hasna.product_projection.v1";
                revision: number;
            };
            intent: {
                id: string;
                digest: string;
                schema: "hasna.intent_snapshot.v1";
            };
            environment: {
                id: string;
                digest: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
            };
            policyProfile: string;
            requester: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            attestations: {
                id: string;
                digest: string;
                schema: "hasna.artifact_attestation.v1";
            }[];
            idempotencyKeyFingerprint: string;
            requestAt: string;
            sourceRequestId: string;
            auditCorrelationId: string;
            artifact?: {
                id: string;
                digest: string;
                schema: "hasna.build_artifact.v1";
            } | undefined;
            costEstimate?: {
                id: string;
                schema: "hasna.cost_estimate.v1";
                createdAt: string;
                currency: string;
                amountMicros: number;
                basis: "limit" | "actual" | "estimated" | "budget";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                model?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                promptTokens?: number | undefined;
                completionTokens?: number | undefined;
                totalTokens?: number | undefined;
            } | undefined;
            expiresAt?: string | null | undefined;
            priorReceipt?: {
                id: string;
                digest: string;
                schema: "hasna.deployment_receipt.v1";
            } | undefined;
        }, {
            id: string;
            kind: "reconciliation" | "deployment" | "promotion" | "rollback";
            schema: "hasna.deployment_request.v1";
            evidenceRefs: any[];
            product: {
                id: string;
                schema: "hasna.product_projection.v1";
                revision: number;
                digest?: any;
            };
            intent: {
                id: string;
                schema: "hasna.intent_snapshot.v1";
                digest?: any;
            };
            environment: {
                id: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
                digest?: any;
            };
            policyProfile: string;
            sourceRequestId: string;
            auditCorrelationId: string;
            digest?: any;
            createdAt?: any;
            artifact?: {
                id: string;
                schema: "hasna.build_artifact.v1";
                digest?: any;
            } | undefined;
            costEstimate?: any;
            producer?: any;
            expiresAt?: any;
            requester?: any;
            attestations?: {
                id: string;
                schema: "hasna.artifact_attestation.v1";
                digest?: any;
            }[] | undefined;
            priorReceipt?: {
                id: string;
                schema: "hasna.deployment_receipt.v1";
                digest?: any;
            } | undefined;
            idempotencyKeyFingerprint?: any;
            requestAt?: any;
        }>;
        "hasna.deployment_plan.v1": z.ZodEffects<z.ZodObject<{
            kind: z.ZodEnum<["deployment", "promotion", "rollback", "reconciliation"]>;
            request: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.deployment_request.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.deployment_request.v1";
            }, {
                id: string;
                schema: "hasna.deployment_request.v1";
                digest?: any;
            }>;
            compiler: z.ZodObject<{
                actor: z.ZodType<{
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                }, z.ZodTypeDef, any>;
                version: z.ZodString;
                contractKitVersion: z.ZodLiteral<"1.0.0">;
            }, "strict", z.ZodTypeAny, {
                actor: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                };
                version: string;
                contractKitVersion: "1.0.0";
            }, {
                version: string;
                contractKitVersion: "1.0.0";
                actor?: any;
            }>;
            inputs: z.ZodArray<z.ZodObject<{
                schema: z.ZodType<string, z.ZodTypeDef, any>;
                id: z.ZodString;
                revision: z.ZodOptional<z.ZodNumber>;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: string;
                revision?: number | undefined;
            }, {
                id: string;
                digest?: any;
                schema?: any;
                revision?: number | undefined;
            }>, "many">;
            providerCapabilityDigests: z.ZodDefault<z.ZodArray<z.ZodType<string, z.ZodTypeDef, any>, "many">>;
            actions: z.ZodArray<z.ZodEffects<z.ZodObject<{
                id: z.ZodString;
                operationId: z.ZodString;
                operationVersion: z.ZodNumber;
                dependsOn: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
                inputs: z.ZodDefault<z.ZodArray<z.ZodObject<{
                    schema: z.ZodType<string, z.ZodTypeDef, any>;
                    id: z.ZodString;
                    revision: z.ZodOptional<z.ZodNumber>;
                    digest: z.ZodType<string, z.ZodTypeDef, any>;
                }, "strict", z.ZodTypeAny, {
                    id: string;
                    digest: string;
                    schema: string;
                    revision?: number | undefined;
                }, {
                    id: string;
                    digest?: any;
                    schema?: any;
                    revision?: number | undefined;
                }>, "many">>;
                outputSchema: z.ZodType<string, z.ZodTypeDef, any>;
                preconditions: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
                postconditions: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
                lockClass: z.ZodString;
                fencingRequired: z.ZodBoolean;
                sideEffectClass: z.ZodType<string, z.ZodTypeDef, any>;
                riskClass: z.ZodEnum<["low", "medium", "high", "critical"]>;
                approvalScope: z.ZodEnum<["none", "plan", "action", "phase"]>;
                runtimeMaterialKind: z.ZodNullable<z.ZodString>;
                providerOperation: z.ZodNullable<z.ZodString>;
                providerCapabilityDigest: z.ZodNullable<z.ZodType<string, z.ZodTypeDef, any>>;
                retryClass: z.ZodEnum<["none", "safe", "reconcile_first"]>;
                maxAttempts: z.ZodNumber;
                timeoutClass: z.ZodString;
                compensationOperationId: z.ZodNullable<z.ZodString>;
                idempotencyRequired: z.ZodBoolean;
                reconciliationRequired: z.ZodBoolean;
                evidenceRequirements: z.ZodArray<z.ZodString, "many">;
            }, "strict", z.ZodTypeAny, {
                id: string;
                sideEffectClass: string;
                providerCapabilityDigest: string | null;
                operationId: string;
                operationVersion: number;
                dependsOn: string[];
                inputs: {
                    id: string;
                    digest: string;
                    schema: string;
                    revision?: number | undefined;
                }[];
                outputSchema: string;
                preconditions: string[];
                postconditions: string[];
                lockClass: string;
                fencingRequired: boolean;
                riskClass: "low" | "medium" | "high" | "critical";
                approvalScope: "action" | "none" | "plan" | "phase";
                runtimeMaterialKind: string | null;
                providerOperation: string | null;
                retryClass: "safe" | "none" | "reconcile_first";
                maxAttempts: number;
                timeoutClass: string;
                compensationOperationId: string | null;
                idempotencyRequired: boolean;
                reconciliationRequired: boolean;
                evidenceRequirements: string[];
            }, {
                id: string;
                operationId: string;
                operationVersion: number;
                lockClass: string;
                fencingRequired: boolean;
                riskClass: "low" | "medium" | "high" | "critical";
                approvalScope: "action" | "none" | "plan" | "phase";
                runtimeMaterialKind: string | null;
                providerOperation: string | null;
                retryClass: "safe" | "none" | "reconcile_first";
                maxAttempts: number;
                timeoutClass: string;
                compensationOperationId: string | null;
                idempotencyRequired: boolean;
                reconciliationRequired: boolean;
                evidenceRequirements: string[];
                sideEffectClass?: any;
                providerCapabilityDigest?: any;
                dependsOn?: string[] | undefined;
                inputs?: {
                    id: string;
                    digest?: any;
                    schema?: any;
                    revision?: number | undefined;
                }[] | undefined;
                outputSchema?: any;
                preconditions?: string[] | undefined;
                postconditions?: string[] | undefined;
            }>, {
                id: string;
                sideEffectClass: string;
                providerCapabilityDigest: string | null;
                operationId: string;
                operationVersion: number;
                dependsOn: string[];
                inputs: {
                    id: string;
                    digest: string;
                    schema: string;
                    revision?: number | undefined;
                }[];
                outputSchema: string;
                preconditions: string[];
                postconditions: string[];
                lockClass: string;
                fencingRequired: boolean;
                riskClass: "low" | "medium" | "high" | "critical";
                approvalScope: "action" | "none" | "plan" | "phase";
                runtimeMaterialKind: string | null;
                providerOperation: string | null;
                retryClass: "safe" | "none" | "reconcile_first";
                maxAttempts: number;
                timeoutClass: string;
                compensationOperationId: string | null;
                idempotencyRequired: boolean;
                reconciliationRequired: boolean;
                evidenceRequirements: string[];
            }, {
                id: string;
                operationId: string;
                operationVersion: number;
                lockClass: string;
                fencingRequired: boolean;
                riskClass: "low" | "medium" | "high" | "critical";
                approvalScope: "action" | "none" | "plan" | "phase";
                runtimeMaterialKind: string | null;
                providerOperation: string | null;
                retryClass: "safe" | "none" | "reconcile_first";
                maxAttempts: number;
                timeoutClass: string;
                compensationOperationId: string | null;
                idempotencyRequired: boolean;
                reconciliationRequired: boolean;
                evidenceRequirements: string[];
                sideEffectClass?: any;
                providerCapabilityDigest?: any;
                dependsOn?: string[] | undefined;
                inputs?: {
                    id: string;
                    digest?: any;
                    schema?: any;
                    revision?: number | undefined;
                }[] | undefined;
                outputSchema?: any;
                preconditions?: string[] | undefined;
                postconditions?: string[] | undefined;
            }>, "many">;
            authorizationRequirements: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            policyRequirements: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            riskClass: z.ZodEnum<["low", "medium", "high", "critical"]>;
            evidenceRequirements: z.ZodArray<z.ZodString, "many">;
            expectedStateDigest: z.ZodType<string, z.ZodTypeDef, any>;
            verificationCriteria: z.ZodArray<z.ZodString, "many">;
            rollbackTarget: z.ZodOptional<z.ZodObject<{
                schema: z.ZodLiteral<"hasna.deployment_receipt.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.deployment_receipt.v1";
            }, {
                id: string;
                schema: "hasna.deployment_receipt.v1";
                digest?: any;
            }>>;
            rollbackInputs: z.ZodDefault<z.ZodArray<z.ZodObject<{
                schema: z.ZodType<string, z.ZodTypeDef, any>;
                id: z.ZodString;
                revision: z.ZodOptional<z.ZodNumber>;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: string;
                revision?: number | undefined;
            }, {
                id: string;
                digest?: any;
                schema?: any;
                revision?: number | undefined;
            }>, "many">>;
            estimatedCost: z.ZodOptional<z.ZodType<{
                id: string;
                schema: "hasna.cost_estimate.v1";
                createdAt: string;
                currency: string;
                amountMicros: number;
                basis: "limit" | "actual" | "estimated" | "budget";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                model?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                promptTokens?: number | undefined;
                completionTokens?: number | undefined;
                totalTokens?: number | undefined;
            }, z.ZodTypeDef, any>>;
            issuedAt: z.ZodType<string, z.ZodTypeDef, any>;
            expiresAt: z.ZodOptional<z.ZodNullable<z.ZodType<string, z.ZodTypeDef, any>>>;
            schema: z.ZodLiteral<"hasna.deployment_plan.v1">;
            id: z.ZodString;
            createdAt: z.ZodType<string, z.ZodTypeDef, any>;
            producer: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            kind: "reconciliation" | "deployment" | "promotion" | "rollback";
            digest: string;
            schema: "hasna.deployment_plan.v1";
            createdAt: string;
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            inputs: {
                id: string;
                digest: string;
                schema: string;
                revision?: number | undefined;
            }[];
            riskClass: "low" | "medium" | "high" | "critical";
            evidenceRequirements: string[];
            request: {
                id: string;
                digest: string;
                schema: "hasna.deployment_request.v1";
            };
            compiler: {
                actor: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                };
                version: string;
                contractKitVersion: "1.0.0";
            };
            providerCapabilityDigests: string[];
            actions: {
                id: string;
                sideEffectClass: string;
                providerCapabilityDigest: string | null;
                operationId: string;
                operationVersion: number;
                dependsOn: string[];
                inputs: {
                    id: string;
                    digest: string;
                    schema: string;
                    revision?: number | undefined;
                }[];
                outputSchema: string;
                preconditions: string[];
                postconditions: string[];
                lockClass: string;
                fencingRequired: boolean;
                riskClass: "low" | "medium" | "high" | "critical";
                approvalScope: "action" | "none" | "plan" | "phase";
                runtimeMaterialKind: string | null;
                providerOperation: string | null;
                retryClass: "safe" | "none" | "reconcile_first";
                maxAttempts: number;
                timeoutClass: string;
                compensationOperationId: string | null;
                idempotencyRequired: boolean;
                reconciliationRequired: boolean;
                evidenceRequirements: string[];
            }[];
            authorizationRequirements: string[];
            policyRequirements: string[];
            expectedStateDigest: string;
            verificationCriteria: string[];
            rollbackInputs: {
                id: string;
                digest: string;
                schema: string;
                revision?: number | undefined;
            }[];
            issuedAt: string;
            expiresAt?: string | null | undefined;
            rollbackTarget?: {
                id: string;
                digest: string;
                schema: "hasna.deployment_receipt.v1";
            } | undefined;
            estimatedCost?: {
                id: string;
                schema: "hasna.cost_estimate.v1";
                createdAt: string;
                currency: string;
                amountMicros: number;
                basis: "limit" | "actual" | "estimated" | "budget";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                model?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                promptTokens?: number | undefined;
                completionTokens?: number | undefined;
                totalTokens?: number | undefined;
            } | undefined;
        }, {
            id: string;
            kind: "reconciliation" | "deployment" | "promotion" | "rollback";
            schema: "hasna.deployment_plan.v1";
            inputs: {
                id: string;
                digest?: any;
                schema?: any;
                revision?: number | undefined;
            }[];
            riskClass: "low" | "medium" | "high" | "critical";
            evidenceRequirements: string[];
            request: {
                id: string;
                schema: "hasna.deployment_request.v1";
                digest?: any;
            };
            compiler: {
                version: string;
                contractKitVersion: "1.0.0";
                actor?: any;
            };
            actions: {
                id: string;
                operationId: string;
                operationVersion: number;
                lockClass: string;
                fencingRequired: boolean;
                riskClass: "low" | "medium" | "high" | "critical";
                approvalScope: "action" | "none" | "plan" | "phase";
                runtimeMaterialKind: string | null;
                providerOperation: string | null;
                retryClass: "safe" | "none" | "reconcile_first";
                maxAttempts: number;
                timeoutClass: string;
                compensationOperationId: string | null;
                idempotencyRequired: boolean;
                reconciliationRequired: boolean;
                evidenceRequirements: string[];
                sideEffectClass?: any;
                providerCapabilityDigest?: any;
                dependsOn?: string[] | undefined;
                inputs?: {
                    id: string;
                    digest?: any;
                    schema?: any;
                    revision?: number | undefined;
                }[] | undefined;
                outputSchema?: any;
                preconditions?: string[] | undefined;
                postconditions?: string[] | undefined;
            }[];
            verificationCriteria: string[];
            digest?: any;
            createdAt?: any;
            producer?: any;
            expiresAt?: any;
            providerCapabilityDigests?: any[] | undefined;
            authorizationRequirements?: string[] | undefined;
            policyRequirements?: string[] | undefined;
            expectedStateDigest?: any;
            rollbackTarget?: {
                id: string;
                schema: "hasna.deployment_receipt.v1";
                digest?: any;
            } | undefined;
            rollbackInputs?: {
                id: string;
                digest?: any;
                schema?: any;
                revision?: number | undefined;
            }[] | undefined;
            estimatedCost?: any;
            issuedAt?: any;
        }>, {
            id: string;
            kind: "reconciliation" | "deployment" | "promotion" | "rollback";
            digest: string;
            schema: "hasna.deployment_plan.v1";
            createdAt: string;
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            inputs: {
                id: string;
                digest: string;
                schema: string;
                revision?: number | undefined;
            }[];
            riskClass: "low" | "medium" | "high" | "critical";
            evidenceRequirements: string[];
            request: {
                id: string;
                digest: string;
                schema: "hasna.deployment_request.v1";
            };
            compiler: {
                actor: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                };
                version: string;
                contractKitVersion: "1.0.0";
            };
            providerCapabilityDigests: string[];
            actions: {
                id: string;
                sideEffectClass: string;
                providerCapabilityDigest: string | null;
                operationId: string;
                operationVersion: number;
                dependsOn: string[];
                inputs: {
                    id: string;
                    digest: string;
                    schema: string;
                    revision?: number | undefined;
                }[];
                outputSchema: string;
                preconditions: string[];
                postconditions: string[];
                lockClass: string;
                fencingRequired: boolean;
                riskClass: "low" | "medium" | "high" | "critical";
                approvalScope: "action" | "none" | "plan" | "phase";
                runtimeMaterialKind: string | null;
                providerOperation: string | null;
                retryClass: "safe" | "none" | "reconcile_first";
                maxAttempts: number;
                timeoutClass: string;
                compensationOperationId: string | null;
                idempotencyRequired: boolean;
                reconciliationRequired: boolean;
                evidenceRequirements: string[];
            }[];
            authorizationRequirements: string[];
            policyRequirements: string[];
            expectedStateDigest: string;
            verificationCriteria: string[];
            rollbackInputs: {
                id: string;
                digest: string;
                schema: string;
                revision?: number | undefined;
            }[];
            issuedAt: string;
            expiresAt?: string | null | undefined;
            rollbackTarget?: {
                id: string;
                digest: string;
                schema: "hasna.deployment_receipt.v1";
            } | undefined;
            estimatedCost?: {
                id: string;
                schema: "hasna.cost_estimate.v1";
                createdAt: string;
                currency: string;
                amountMicros: number;
                basis: "limit" | "actual" | "estimated" | "budget";
                resourceRefs: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                model?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                promptTokens?: number | undefined;
                completionTokens?: number | undefined;
                totalTokens?: number | undefined;
            } | undefined;
        }, {
            id: string;
            kind: "reconciliation" | "deployment" | "promotion" | "rollback";
            schema: "hasna.deployment_plan.v1";
            inputs: {
                id: string;
                digest?: any;
                schema?: any;
                revision?: number | undefined;
            }[];
            riskClass: "low" | "medium" | "high" | "critical";
            evidenceRequirements: string[];
            request: {
                id: string;
                schema: "hasna.deployment_request.v1";
                digest?: any;
            };
            compiler: {
                version: string;
                contractKitVersion: "1.0.0";
                actor?: any;
            };
            actions: {
                id: string;
                operationId: string;
                operationVersion: number;
                lockClass: string;
                fencingRequired: boolean;
                riskClass: "low" | "medium" | "high" | "critical";
                approvalScope: "action" | "none" | "plan" | "phase";
                runtimeMaterialKind: string | null;
                providerOperation: string | null;
                retryClass: "safe" | "none" | "reconcile_first";
                maxAttempts: number;
                timeoutClass: string;
                compensationOperationId: string | null;
                idempotencyRequired: boolean;
                reconciliationRequired: boolean;
                evidenceRequirements: string[];
                sideEffectClass?: any;
                providerCapabilityDigest?: any;
                dependsOn?: string[] | undefined;
                inputs?: {
                    id: string;
                    digest?: any;
                    schema?: any;
                    revision?: number | undefined;
                }[] | undefined;
                outputSchema?: any;
                preconditions?: string[] | undefined;
                postconditions?: string[] | undefined;
            }[];
            verificationCriteria: string[];
            digest?: any;
            createdAt?: any;
            producer?: any;
            expiresAt?: any;
            providerCapabilityDigests?: any[] | undefined;
            authorizationRequirements?: string[] | undefined;
            policyRequirements?: string[] | undefined;
            expectedStateDigest?: any;
            rollbackTarget?: {
                id: string;
                schema: "hasna.deployment_receipt.v1";
                digest?: any;
            } | undefined;
            rollbackInputs?: {
                id: string;
                digest?: any;
                schema?: any;
                revision?: number | undefined;
            }[] | undefined;
            estimatedCost?: any;
            issuedAt?: any;
        }>;
        "hasna.deployment_approval_decision.v1": z.ZodEffects<z.ZodObject<{
            decision: z.ZodType<{
                id: string;
                status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
                schema: "hasna.decision_envelope.v1";
                createdAt: string;
                decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
                selected: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                skipped: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                reason: string;
                obligations: string[];
                redactions: string[];
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                actor?: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                } | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                traceId?: string | undefined;
                inputHash?: string | undefined;
                policyBundleId?: string | undefined;
                costEstimate?: {
                    id: string;
                    schema: "hasna.cost_estimate.v1";
                    createdAt: string;
                    currency: string;
                    amountMicros: number;
                    basis: "limit" | "actual" | "estimated" | "budget";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    model?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    promptTokens?: number | undefined;
                    completionTokens?: number | undefined;
                    totalTokens?: number | undefined;
                } | undefined;
            }, z.ZodTypeDef, any>;
            plan: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.deployment_plan.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.deployment_plan.v1";
            }, {
                id: string;
                schema: "hasna.deployment_plan.v1";
                digest?: any;
            }>;
            scope: z.ZodEnum<["plan", "action", "phase"]>;
            actionId: z.ZodNullable<z.ZodString>;
            phaseId: z.ZodNullable<z.ZodString>;
            runtimeMaterial: z.ZodNullable<z.ZodObject<{
                kind: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
                stateLineage: z.ZodString;
                preActionStateSerial: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                kind: string;
                digest: string;
                stateLineage: string;
                preActionStateSerial: number;
            }, {
                kind: string;
                stateLineage: string;
                preActionStateSerial: number;
                digest?: any;
            }>>;
            boundInputDigests: z.ZodArray<z.ZodObject<{
                kind: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                kind: string;
                digest: string;
            }, {
                kind: string;
                digest?: any;
            }>, "many">;
            environment: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.environment_binding.v1">;
                id: z.ZodString;
                revision: z.ZodNumber;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
            }, {
                id: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
                digest?: any;
            }>;
            actorRole: z.ZodEnum<["requester", "planner", "approver", "executor", "auditor", "administrator"]>;
            attemptScope: z.ZodObject<{
                minimum: z.ZodNumber;
                maximum: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                minimum: number;
                maximum: number;
            }, {
                minimum: number;
                maximum: number;
            }>;
            unchangedRetryPolicy: z.ZodEnum<["allowed", "denied"]>;
            issuedAt: z.ZodType<string, z.ZodTypeDef, any>;
            expiresAt: z.ZodType<string, z.ZodTypeDef, any>;
            separationOfDutiesPassed: z.ZodBoolean;
            authorizationPolicyRevision: z.ZodNumber;
            evidenceRefs: z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
            schema: z.ZodLiteral<"hasna.deployment_approval_decision.v1">;
            id: z.ZodString;
            createdAt: z.ZodType<string, z.ZodTypeDef, any>;
            producer: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.deployment_approval_decision.v1";
            createdAt: string;
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            expiresAt: string;
            environment: {
                id: string;
                digest: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
            };
            plan: {
                id: string;
                digest: string;
                schema: "hasna.deployment_plan.v1";
            };
            issuedAt: string;
            decision: {
                id: string;
                status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
                schema: "hasna.decision_envelope.v1";
                createdAt: string;
                decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
                selected: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                skipped: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                reason: string;
                obligations: string[];
                redactions: string[];
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                actor?: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                } | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                traceId?: string | undefined;
                inputHash?: string | undefined;
                policyBundleId?: string | undefined;
                costEstimate?: {
                    id: string;
                    schema: "hasna.cost_estimate.v1";
                    createdAt: string;
                    currency: string;
                    amountMicros: number;
                    basis: "limit" | "actual" | "estimated" | "budget";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    model?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    promptTokens?: number | undefined;
                    completionTokens?: number | undefined;
                    totalTokens?: number | undefined;
                } | undefined;
            };
            scope: "action" | "plan" | "phase";
            actionId: string | null;
            phaseId: string | null;
            runtimeMaterial: {
                kind: string;
                digest: string;
                stateLineage: string;
                preActionStateSerial: number;
            } | null;
            boundInputDigests: {
                kind: string;
                digest: string;
            }[];
            actorRole: "requester" | "planner" | "approver" | "executor" | "auditor" | "administrator";
            attemptScope: {
                minimum: number;
                maximum: number;
            };
            unchangedRetryPolicy: "allowed" | "denied";
            separationOfDutiesPassed: boolean;
            authorizationPolicyRevision: number;
        }, {
            id: string;
            schema: "hasna.deployment_approval_decision.v1";
            evidenceRefs: any[];
            environment: {
                id: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
                digest?: any;
            };
            plan: {
                id: string;
                schema: "hasna.deployment_plan.v1";
                digest?: any;
            };
            scope: "action" | "plan" | "phase";
            actionId: string | null;
            phaseId: string | null;
            runtimeMaterial: {
                kind: string;
                stateLineage: string;
                preActionStateSerial: number;
                digest?: any;
            } | null;
            boundInputDigests: {
                kind: string;
                digest?: any;
            }[];
            actorRole: "requester" | "planner" | "approver" | "executor" | "auditor" | "administrator";
            attemptScope: {
                minimum: number;
                maximum: number;
            };
            unchangedRetryPolicy: "allowed" | "denied";
            separationOfDutiesPassed: boolean;
            authorizationPolicyRevision: number;
            digest?: any;
            createdAt?: any;
            producer?: any;
            expiresAt?: any;
            issuedAt?: any;
            decision?: any;
        }>, {
            id: string;
            digest: string;
            schema: "hasna.deployment_approval_decision.v1";
            createdAt: string;
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            expiresAt: string;
            environment: {
                id: string;
                digest: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
            };
            plan: {
                id: string;
                digest: string;
                schema: "hasna.deployment_plan.v1";
            };
            issuedAt: string;
            decision: {
                id: string;
                status: "unknown" | "allowed" | "denied" | "warned" | "approval_required" | "selected" | "skipped";
                schema: "hasna.decision_envelope.v1";
                createdAt: string;
                decisionType: "budget" | "guardrail" | "model_route" | "tool_select" | "secret_access" | "approval" | "policy" | "other";
                selected: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                skipped: {
                    id: string;
                    kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                    tags: string[];
                    name?: string | undefined;
                    uri?: string | undefined;
                    externalId?: string | undefined;
                    sourcePackage?: string | undefined;
                }[];
                reason: string;
                obligations: string[];
                redactions: string[];
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                actor?: {
                    id: string;
                    kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                    name?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    machineId?: string | undefined;
                } | undefined;
                updatedAt?: string | null | undefined;
                metadata?: Record<string, unknown> | undefined;
                traceId?: string | undefined;
                inputHash?: string | undefined;
                policyBundleId?: string | undefined;
                costEstimate?: {
                    id: string;
                    schema: "hasna.cost_estimate.v1";
                    createdAt: string;
                    currency: string;
                    amountMicros: number;
                    basis: "limit" | "actual" | "estimated" | "budget";
                    resourceRefs: {
                        id: string;
                        kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                        tags: string[];
                        name?: string | undefined;
                        uri?: string | undefined;
                        externalId?: string | undefined;
                        sourcePackage?: string | undefined;
                    }[];
                    model?: string | undefined;
                    provider?: string | undefined;
                    accountId?: string | undefined;
                    updatedAt?: string | null | undefined;
                    metadata?: Record<string, unknown> | undefined;
                    promptTokens?: number | undefined;
                    completionTokens?: number | undefined;
                    totalTokens?: number | undefined;
                } | undefined;
            };
            scope: "action" | "plan" | "phase";
            actionId: string | null;
            phaseId: string | null;
            runtimeMaterial: {
                kind: string;
                digest: string;
                stateLineage: string;
                preActionStateSerial: number;
            } | null;
            boundInputDigests: {
                kind: string;
                digest: string;
            }[];
            actorRole: "requester" | "planner" | "approver" | "executor" | "auditor" | "administrator";
            attemptScope: {
                minimum: number;
                maximum: number;
            };
            unchangedRetryPolicy: "allowed" | "denied";
            separationOfDutiesPassed: boolean;
            authorizationPolicyRevision: number;
        }, {
            id: string;
            schema: "hasna.deployment_approval_decision.v1";
            evidenceRefs: any[];
            environment: {
                id: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
                digest?: any;
            };
            plan: {
                id: string;
                schema: "hasna.deployment_plan.v1";
                digest?: any;
            };
            scope: "action" | "plan" | "phase";
            actionId: string | null;
            phaseId: string | null;
            runtimeMaterial: {
                kind: string;
                stateLineage: string;
                preActionStateSerial: number;
                digest?: any;
            } | null;
            boundInputDigests: {
                kind: string;
                digest?: any;
            }[];
            actorRole: "requester" | "planner" | "approver" | "executor" | "auditor" | "administrator";
            attemptScope: {
                minimum: number;
                maximum: number;
            };
            unchangedRetryPolicy: "allowed" | "denied";
            separationOfDutiesPassed: boolean;
            authorizationPolicyRevision: number;
            digest?: any;
            createdAt?: any;
            producer?: any;
            expiresAt?: any;
            issuedAt?: any;
            decision?: any;
        }>;
        "hasna.deployment_attempt.v1": z.ZodEffects<z.ZodObject<{
            updatedAt: z.ZodType<string, z.ZodTypeDef, any>;
            revision: z.ZodNumber;
            plan: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.deployment_plan.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.deployment_plan.v1";
            }, {
                id: string;
                schema: "hasna.deployment_plan.v1";
                digest?: any;
            }>;
            approvals: z.ZodArray<z.ZodObject<{
                decision: z.ZodObject<{
                    schema: z.ZodLiteral<"hasna.deployment_approval_decision.v1">;
                    id: z.ZodString;
                    digest: z.ZodType<string, z.ZodTypeDef, any>;
                }, "strict", z.ZodTypeAny, {
                    id: string;
                    digest: string;
                    schema: "hasna.deployment_approval_decision.v1";
                }, {
                    id: string;
                    schema: "hasna.deployment_approval_decision.v1";
                    digest?: any;
                }>;
                scope: z.ZodEnum<["plan", "action", "phase"]>;
                actionId: z.ZodNullable<z.ZodString>;
                phaseId: z.ZodNullable<z.ZodString>;
                runtimeMaterialDigest: z.ZodNullable<z.ZodType<string, z.ZodTypeDef, any>>;
            }, "strict", z.ZodTypeAny, {
                decision: {
                    id: string;
                    digest: string;
                    schema: "hasna.deployment_approval_decision.v1";
                };
                scope: "action" | "plan" | "phase";
                actionId: string | null;
                phaseId: string | null;
                runtimeMaterialDigest: string | null;
            }, {
                decision: {
                    id: string;
                    schema: "hasna.deployment_approval_decision.v1";
                    digest?: any;
                };
                scope: "action" | "plan" | "phase";
                actionId: string | null;
                phaseId: string | null;
                runtimeMaterialDigest?: any;
            }>, "many">;
            requester: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            decisionActors: z.ZodArray<z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
            executorActors: z.ZodArray<z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
            environmentLock: z.ZodObject<{
                id: z.ZodString;
                fencingToken: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                id: string;
                fencingToken: number;
            }, {
                id: string;
                fencingToken: number;
            }>;
            attemptNumber: z.ZodNumber;
            retryOf: z.ZodNullable<z.ZodObject<{
                schema: z.ZodLiteral<"hasna.deployment_attempt.v1">;
                id: z.ZodString;
                revision: z.ZodNumber;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
            }, {
                id: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
                digest?: any;
            }>>;
            state: z.ZodEnum<["queued", "running", "reconciling", "unknown_outcome", "succeeded", "failed", "cancelled"]>;
            actionSteps: z.ZodArray<z.ZodEffects<z.ZodObject<{
                sequence: z.ZodNumber;
                actionId: z.ZodString;
                state: z.ZodEnum<["pending", "running", "succeeded", "failed", "cancelled", "unknown_outcome"]>;
                providerCorrelationId: z.ZodNullable<z.ZodString>;
                startedAt: z.ZodNullable<z.ZodType<string, z.ZodTypeDef, any>>;
                finishedAt: z.ZodNullable<z.ZodType<string, z.ZodTypeDef, any>>;
                evidenceRefs: z.ZodDefault<z.ZodArray<z.ZodType<{
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }, z.ZodTypeDef, any>, "many">>;
            }, "strict", z.ZodTypeAny, {
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                startedAt: string | null;
                finishedAt: string | null;
                actionId: string;
                sequence: number;
                state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome";
                providerCorrelationId: string | null;
            }, {
                actionId: string;
                sequence: number;
                state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome";
                providerCorrelationId: string | null;
                evidenceRefs?: any[] | undefined;
                startedAt?: any;
                finishedAt?: any;
            }>, {
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                startedAt: string | null;
                finishedAt: string | null;
                actionId: string;
                sequence: number;
                state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome";
                providerCorrelationId: string | null;
            }, {
                actionId: string;
                sequence: number;
                state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome";
                providerCorrelationId: string | null;
                evidenceRefs?: any[] | undefined;
                startedAt?: any;
                finishedAt?: any;
            }>, "many">;
            outboxCorrelationRef: z.ZodType<{
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }, z.ZodTypeDef, any>;
            inboxCorrelationRef: z.ZodType<{
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }, z.ZodTypeDef, any>;
            failureReason: z.ZodNullable<z.ZodString>;
            evidenceRefs: z.ZodDefault<z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">>;
            providerReceipts: z.ZodDefault<z.ZodArray<z.ZodObject<{
                schema: z.ZodLiteral<"hasna.provider_receipt.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.provider_receipt.v1";
            }, {
                id: string;
                schema: "hasna.provider_receipt.v1";
                digest?: any;
            }>, "many">>;
            finalReceipt: z.ZodNullable<z.ZodObject<{
                schema: z.ZodLiteral<"hasna.deployment_receipt.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.deployment_receipt.v1";
            }, {
                id: string;
                schema: "hasna.deployment_receipt.v1";
                digest?: any;
            }>>;
            schema: z.ZodLiteral<"hasna.deployment_attempt.v1">;
            id: z.ZodString;
            createdAt: z.ZodType<string, z.ZodTypeDef, any>;
            producer: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.deployment_attempt.v1";
            createdAt: string;
            updatedAt: string;
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            revision: number;
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            requester: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            plan: {
                id: string;
                digest: string;
                schema: "hasna.deployment_plan.v1";
            };
            state: "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome" | "queued" | "reconciling";
            approvals: {
                decision: {
                    id: string;
                    digest: string;
                    schema: "hasna.deployment_approval_decision.v1";
                };
                scope: "action" | "plan" | "phase";
                actionId: string | null;
                phaseId: string | null;
                runtimeMaterialDigest: string | null;
            }[];
            decisionActors: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }[];
            executorActors: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }[];
            environmentLock: {
                id: string;
                fencingToken: number;
            };
            attemptNumber: number;
            retryOf: {
                id: string;
                digest: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
            } | null;
            actionSteps: {
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                startedAt: string | null;
                finishedAt: string | null;
                actionId: string;
                sequence: number;
                state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome";
                providerCorrelationId: string | null;
            }[];
            outboxCorrelationRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            inboxCorrelationRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            failureReason: string | null;
            providerReceipts: {
                id: string;
                digest: string;
                schema: "hasna.provider_receipt.v1";
            }[];
            finalReceipt: {
                id: string;
                digest: string;
                schema: "hasna.deployment_receipt.v1";
            } | null;
        }, {
            id: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
            plan: {
                id: string;
                schema: "hasna.deployment_plan.v1";
                digest?: any;
            };
            state: "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome" | "queued" | "reconciling";
            approvals: {
                decision: {
                    id: string;
                    schema: "hasna.deployment_approval_decision.v1";
                    digest?: any;
                };
                scope: "action" | "plan" | "phase";
                actionId: string | null;
                phaseId: string | null;
                runtimeMaterialDigest?: any;
            }[];
            decisionActors: any[];
            executorActors: any[];
            environmentLock: {
                id: string;
                fencingToken: number;
            };
            attemptNumber: number;
            retryOf: {
                id: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
                digest?: any;
            } | null;
            actionSteps: {
                actionId: string;
                sequence: number;
                state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome";
                providerCorrelationId: string | null;
                evidenceRefs?: any[] | undefined;
                startedAt?: any;
                finishedAt?: any;
            }[];
            failureReason: string | null;
            finalReceipt: {
                id: string;
                schema: "hasna.deployment_receipt.v1";
                digest?: any;
            } | null;
            digest?: any;
            createdAt?: any;
            updatedAt?: any;
            evidenceRefs?: any[] | undefined;
            producer?: any;
            requester?: any;
            outboxCorrelationRef?: any;
            inboxCorrelationRef?: any;
            providerReceipts?: {
                id: string;
                schema: "hasna.provider_receipt.v1";
                digest?: any;
            }[] | undefined;
        }>, {
            id: string;
            digest: string;
            schema: "hasna.deployment_attempt.v1";
            createdAt: string;
            updatedAt: string;
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            revision: number;
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            requester: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            plan: {
                id: string;
                digest: string;
                schema: "hasna.deployment_plan.v1";
            };
            state: "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome" | "queued" | "reconciling";
            approvals: {
                decision: {
                    id: string;
                    digest: string;
                    schema: "hasna.deployment_approval_decision.v1";
                };
                scope: "action" | "plan" | "phase";
                actionId: string | null;
                phaseId: string | null;
                runtimeMaterialDigest: string | null;
            }[];
            decisionActors: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }[];
            executorActors: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }[];
            environmentLock: {
                id: string;
                fencingToken: number;
            };
            attemptNumber: number;
            retryOf: {
                id: string;
                digest: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
            } | null;
            actionSteps: {
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                startedAt: string | null;
                finishedAt: string | null;
                actionId: string;
                sequence: number;
                state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome";
                providerCorrelationId: string | null;
            }[];
            outboxCorrelationRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            inboxCorrelationRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            failureReason: string | null;
            providerReceipts: {
                id: string;
                digest: string;
                schema: "hasna.provider_receipt.v1";
            }[];
            finalReceipt: {
                id: string;
                digest: string;
                schema: "hasna.deployment_receipt.v1";
            } | null;
        }, {
            id: string;
            schema: "hasna.deployment_attempt.v1";
            revision: number;
            plan: {
                id: string;
                schema: "hasna.deployment_plan.v1";
                digest?: any;
            };
            state: "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome" | "queued" | "reconciling";
            approvals: {
                decision: {
                    id: string;
                    schema: "hasna.deployment_approval_decision.v1";
                    digest?: any;
                };
                scope: "action" | "plan" | "phase";
                actionId: string | null;
                phaseId: string | null;
                runtimeMaterialDigest?: any;
            }[];
            decisionActors: any[];
            executorActors: any[];
            environmentLock: {
                id: string;
                fencingToken: number;
            };
            attemptNumber: number;
            retryOf: {
                id: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
                digest?: any;
            } | null;
            actionSteps: {
                actionId: string;
                sequence: number;
                state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown_outcome";
                providerCorrelationId: string | null;
                evidenceRefs?: any[] | undefined;
                startedAt?: any;
                finishedAt?: any;
            }[];
            failureReason: string | null;
            finalReceipt: {
                id: string;
                schema: "hasna.deployment_receipt.v1";
                digest?: any;
            } | null;
            digest?: any;
            createdAt?: any;
            updatedAt?: any;
            evidenceRefs?: any[] | undefined;
            producer?: any;
            requester?: any;
            outboxCorrelationRef?: any;
            inboxCorrelationRef?: any;
            providerReceipts?: {
                id: string;
                schema: "hasna.provider_receipt.v1";
                digest?: any;
            }[] | undefined;
        }>;
        "hasna.provider_receipt.v1": z.ZodEffects<z.ZodObject<{
            attempt: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.deployment_attempt.v1">;
                id: z.ZodString;
                revision: z.ZodNumber;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
            }, {
                id: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
                digest?: any;
            }>;
            provider: z.ZodString;
            adapter: z.ZodString;
            connectionRef: z.ZodType<{
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }, z.ZodTypeDef, any>;
            capabilityDigest: z.ZodType<string, z.ZodTypeDef, any>;
            operationId: z.ZodString;
            operationVersion: z.ZodNumber;
            providerIdentity: z.ZodObject<{
                projectId: z.ZodNullable<z.ZodString>;
                operationId: z.ZodString;
                deploymentId: z.ZodNullable<z.ZodString>;
                resourceIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
                eventId: z.ZodNullable<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                projectId: string | null;
                operationId: string;
                deploymentId: string | null;
                resourceIds: string[];
                eventId: string | null;
            }, {
                projectId: string | null;
                operationId: string;
                deploymentId: string | null;
                eventId: string | null;
                resourceIds?: string[] | undefined;
            }>;
            requestFingerprint: z.ZodType<string, z.ZodTypeDef, any>;
            providerStatus: z.ZodString;
            normalizedResult: z.ZodEnum<["accepted", "succeeded", "failed", "cancelled", "unknown"]>;
            observedProviderRevision: z.ZodNullable<z.ZodString>;
            observedAt: z.ZodType<string, z.ZodTypeDef, any>;
            retryClass: z.ZodEnum<["none", "safe", "reconcile_first"]>;
            reconciliationState: z.ZodEnum<["not_required", "pending", "confirmed", "diverged"]>;
            unknownOutcome: z.ZodBoolean;
            redaction: z.ZodEnum<["none", "partial", "full"]>;
            responseEvidenceRefs: z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
            observationEvidenceRefs: z.ZodDefault<z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">>;
            schema: z.ZodLiteral<"hasna.provider_receipt.v1">;
            id: z.ZodString;
            createdAt: z.ZodType<string, z.ZodTypeDef, any>;
            producer: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            provider: string;
            schema: "hasna.provider_receipt.v1";
            createdAt: string;
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            providerIdentity: {
                projectId: string | null;
                operationId: string;
                deploymentId: string | null;
                resourceIds: string[];
                eventId: string | null;
            };
            operationId: string;
            operationVersion: number;
            retryClass: "safe" | "none" | "reconcile_first";
            attempt: {
                id: string;
                digest: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
            };
            adapter: string;
            connectionRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            capabilityDigest: string;
            requestFingerprint: string;
            providerStatus: string;
            normalizedResult: "unknown" | "succeeded" | "failed" | "cancelled" | "accepted";
            observedProviderRevision: string | null;
            observedAt: string;
            reconciliationState: "pending" | "not_required" | "confirmed" | "diverged";
            unknownOutcome: boolean;
            redaction: "none" | "partial" | "full";
            responseEvidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            observationEvidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
        }, {
            id: string;
            provider: string;
            schema: "hasna.provider_receipt.v1";
            providerIdentity: {
                projectId: string | null;
                operationId: string;
                deploymentId: string | null;
                eventId: string | null;
                resourceIds?: string[] | undefined;
            };
            operationId: string;
            operationVersion: number;
            retryClass: "safe" | "none" | "reconcile_first";
            attempt: {
                id: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
                digest?: any;
            };
            adapter: string;
            providerStatus: string;
            normalizedResult: "unknown" | "succeeded" | "failed" | "cancelled" | "accepted";
            observedProviderRevision: string | null;
            reconciliationState: "pending" | "not_required" | "confirmed" | "diverged";
            unknownOutcome: boolean;
            redaction: "none" | "partial" | "full";
            responseEvidenceRefs: any[];
            digest?: any;
            createdAt?: any;
            producer?: any;
            connectionRef?: any;
            capabilityDigest?: any;
            requestFingerprint?: any;
            observedAt?: any;
            observationEvidenceRefs?: any[] | undefined;
        }>, {
            id: string;
            digest: string;
            provider: string;
            schema: "hasna.provider_receipt.v1";
            createdAt: string;
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            providerIdentity: {
                projectId: string | null;
                operationId: string;
                deploymentId: string | null;
                resourceIds: string[];
                eventId: string | null;
            };
            operationId: string;
            operationVersion: number;
            retryClass: "safe" | "none" | "reconcile_first";
            attempt: {
                id: string;
                digest: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
            };
            adapter: string;
            connectionRef: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            };
            capabilityDigest: string;
            requestFingerprint: string;
            providerStatus: string;
            normalizedResult: "unknown" | "succeeded" | "failed" | "cancelled" | "accepted";
            observedProviderRevision: string | null;
            observedAt: string;
            reconciliationState: "pending" | "not_required" | "confirmed" | "diverged";
            unknownOutcome: boolean;
            redaction: "none" | "partial" | "full";
            responseEvidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            observationEvidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
        }, {
            id: string;
            provider: string;
            schema: "hasna.provider_receipt.v1";
            providerIdentity: {
                projectId: string | null;
                operationId: string;
                deploymentId: string | null;
                eventId: string | null;
                resourceIds?: string[] | undefined;
            };
            operationId: string;
            operationVersion: number;
            retryClass: "safe" | "none" | "reconcile_first";
            attempt: {
                id: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
                digest?: any;
            };
            adapter: string;
            providerStatus: string;
            normalizedResult: "unknown" | "succeeded" | "failed" | "cancelled" | "accepted";
            observedProviderRevision: string | null;
            reconciliationState: "pending" | "not_required" | "confirmed" | "diverged";
            unknownOutcome: boolean;
            redaction: "none" | "partial" | "full";
            responseEvidenceRefs: any[];
            digest?: any;
            createdAt?: any;
            producer?: any;
            connectionRef?: any;
            capabilityDigest?: any;
            requestFingerprint?: any;
            observedAt?: any;
            observationEvidenceRefs?: any[] | undefined;
        }>;
        "hasna.deployment_receipt.v1": z.ZodEffects<z.ZodObject<{
            request: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.deployment_request.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.deployment_request.v1";
            }, {
                id: string;
                schema: "hasna.deployment_request.v1";
                digest?: any;
            }>;
            plan: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.deployment_plan.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.deployment_plan.v1";
            }, {
                id: string;
                schema: "hasna.deployment_plan.v1";
                digest?: any;
            }>;
            approvals: z.ZodArray<z.ZodObject<{
                schema: z.ZodLiteral<"hasna.deployment_approval_decision.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.deployment_approval_decision.v1";
            }, {
                id: string;
                schema: "hasna.deployment_approval_decision.v1";
                digest?: any;
            }>, "many">;
            attempt: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.deployment_attempt.v1">;
                id: z.ZodString;
                revision: z.ZodNumber;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
            }, {
                id: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
                digest?: any;
            }>;
            product: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.product_projection.v1">;
                id: z.ZodString;
                revision: z.ZodNumber;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.product_projection.v1";
                revision: number;
            }, {
                id: string;
                schema: "hasna.product_projection.v1";
                revision: number;
                digest?: any;
            }>;
            intent: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.intent_snapshot.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.intent_snapshot.v1";
            }, {
                id: string;
                schema: "hasna.intent_snapshot.v1";
                digest?: any;
            }>;
            artifact: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.build_artifact.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.build_artifact.v1";
            }, {
                id: string;
                schema: "hasna.build_artifact.v1";
                digest?: any;
            }>;
            attestations: z.ZodArray<z.ZodObject<{
                schema: z.ZodLiteral<"hasna.artifact_attestation.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.artifact_attestation.v1";
            }, {
                id: string;
                schema: "hasna.artifact_attestation.v1";
                digest?: any;
            }>, "many">;
            environment: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.environment_binding.v1">;
                id: z.ZodString;
                revision: z.ZodNumber;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
            }, {
                id: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
                digest?: any;
            }>;
            providerReceipts: z.ZodArray<z.ZodObject<{
                schema: z.ZodLiteral<"hasna.provider_receipt.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.provider_receipt.v1";
            }, {
                id: string;
                schema: "hasna.provider_receipt.v1";
                digest?: any;
            }>, "many">;
            desiredStateDigest: z.ZodType<string, z.ZodTypeDef, any>;
            observedStateDigest: z.ZodType<string, z.ZodTypeDef, any>;
            verification: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                kind: z.ZodEnum<["health", "readiness", "version", "migration", "alarm", "access", "restore", "rollback", "security", "contract"]>;
                status: z.ZodEnum<["passed", "failed", "missing", "expired", "blocked"]>;
                evidenceRefs: z.ZodArray<z.ZodType<{
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }, z.ZodTypeDef, any>, "many">;
            }, "strict", z.ZodTypeAny, {
                id: string;
                kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
                status: "failed" | "blocked" | "passed" | "missing" | "expired";
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
            }, {
                id: string;
                kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
                status: "failed" | "blocked" | "passed" | "missing" | "expired";
                evidenceRefs: any[];
            }>, "many">;
            infrastructurePlanRef: z.ZodOptional<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>>;
            infrastructureStateLineageRef: z.ZodOptional<z.ZodType<{
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }, z.ZodTypeDef, any>>;
            rollbackTarget: z.ZodOptional<z.ZodObject<{
                schema: z.ZodLiteral<"hasna.deployment_receipt.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.deployment_receipt.v1";
            }, {
                id: string;
                schema: "hasna.deployment_receipt.v1";
                digest?: any;
            }>>;
            verifiers: z.ZodArray<z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
            evidenceRefs: z.ZodArray<z.ZodType<{
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
            outcome: z.ZodEnum<["succeeded", "failed", "cancelled", "unknown_outcome"]>;
            schema: z.ZodLiteral<"hasna.deployment_receipt.v1">;
            id: z.ZodString;
            createdAt: z.ZodType<string, z.ZodTypeDef, any>;
            producer: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            schema: "hasna.deployment_receipt.v1";
            createdAt: string;
            artifact: {
                id: string;
                digest: string;
                schema: "hasna.build_artifact.v1";
            };
            verification: {
                id: string;
                kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
                status: "failed" | "blocked" | "passed" | "missing" | "expired";
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
            }[];
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            product: {
                id: string;
                digest: string;
                schema: "hasna.product_projection.v1";
                revision: number;
            };
            intent: {
                id: string;
                digest: string;
                schema: "hasna.intent_snapshot.v1";
            };
            verifiers: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }[];
            environment: {
                id: string;
                digest: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
            };
            attestations: {
                id: string;
                digest: string;
                schema: "hasna.artifact_attestation.v1";
            }[];
            plan: {
                id: string;
                digest: string;
                schema: "hasna.deployment_plan.v1";
            };
            request: {
                id: string;
                digest: string;
                schema: "hasna.deployment_request.v1";
            };
            approvals: {
                id: string;
                digest: string;
                schema: "hasna.deployment_approval_decision.v1";
            }[];
            providerReceipts: {
                id: string;
                digest: string;
                schema: "hasna.provider_receipt.v1";
            }[];
            attempt: {
                id: string;
                digest: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
            };
            desiredStateDigest: string;
            observedStateDigest: string;
            outcome: "succeeded" | "failed" | "cancelled" | "unknown_outcome";
            rollbackTarget?: {
                id: string;
                digest: string;
                schema: "hasna.deployment_receipt.v1";
            } | undefined;
            infrastructurePlanRef?: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            } | undefined;
            infrastructureStateLineageRef?: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            } | undefined;
        }, {
            id: string;
            schema: "hasna.deployment_receipt.v1";
            artifact: {
                id: string;
                schema: "hasna.build_artifact.v1";
                digest?: any;
            };
            verification: {
                id: string;
                kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
                status: "failed" | "blocked" | "passed" | "missing" | "expired";
                evidenceRefs: any[];
            }[];
            evidenceRefs: any[];
            product: {
                id: string;
                schema: "hasna.product_projection.v1";
                revision: number;
                digest?: any;
            };
            intent: {
                id: string;
                schema: "hasna.intent_snapshot.v1";
                digest?: any;
            };
            verifiers: any[];
            environment: {
                id: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
                digest?: any;
            };
            attestations: {
                id: string;
                schema: "hasna.artifact_attestation.v1";
                digest?: any;
            }[];
            plan: {
                id: string;
                schema: "hasna.deployment_plan.v1";
                digest?: any;
            };
            request: {
                id: string;
                schema: "hasna.deployment_request.v1";
                digest?: any;
            };
            approvals: {
                id: string;
                schema: "hasna.deployment_approval_decision.v1";
                digest?: any;
            }[];
            providerReceipts: {
                id: string;
                schema: "hasna.provider_receipt.v1";
                digest?: any;
            }[];
            attempt: {
                id: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
                digest?: any;
            };
            outcome: "succeeded" | "failed" | "cancelled" | "unknown_outcome";
            digest?: any;
            createdAt?: any;
            producer?: any;
            rollbackTarget?: {
                id: string;
                schema: "hasna.deployment_receipt.v1";
                digest?: any;
            } | undefined;
            desiredStateDigest?: any;
            observedStateDigest?: any;
            infrastructurePlanRef?: any;
            infrastructureStateLineageRef?: any;
        }>, {
            id: string;
            digest: string;
            schema: "hasna.deployment_receipt.v1";
            createdAt: string;
            artifact: {
                id: string;
                digest: string;
                schema: "hasna.build_artifact.v1";
            };
            verification: {
                id: string;
                kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
                status: "failed" | "blocked" | "passed" | "missing" | "expired";
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
            }[];
            evidenceRefs: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            }[];
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            product: {
                id: string;
                digest: string;
                schema: "hasna.product_projection.v1";
                revision: number;
            };
            intent: {
                id: string;
                digest: string;
                schema: "hasna.intent_snapshot.v1";
            };
            verifiers: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }[];
            environment: {
                id: string;
                digest: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
            };
            attestations: {
                id: string;
                digest: string;
                schema: "hasna.artifact_attestation.v1";
            }[];
            plan: {
                id: string;
                digest: string;
                schema: "hasna.deployment_plan.v1";
            };
            request: {
                id: string;
                digest: string;
                schema: "hasna.deployment_request.v1";
            };
            approvals: {
                id: string;
                digest: string;
                schema: "hasna.deployment_approval_decision.v1";
            }[];
            providerReceipts: {
                id: string;
                digest: string;
                schema: "hasna.provider_receipt.v1";
            }[];
            attempt: {
                id: string;
                digest: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
            };
            desiredStateDigest: string;
            observedStateDigest: string;
            outcome: "succeeded" | "failed" | "cancelled" | "unknown_outcome";
            rollbackTarget?: {
                id: string;
                digest: string;
                schema: "hasna.deployment_receipt.v1";
            } | undefined;
            infrastructurePlanRef?: {
                id: string;
                kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                sha256?: string | undefined;
                uri?: string | undefined;
                summary?: string | undefined;
            } | undefined;
            infrastructureStateLineageRef?: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            } | undefined;
        }, {
            id: string;
            schema: "hasna.deployment_receipt.v1";
            artifact: {
                id: string;
                schema: "hasna.build_artifact.v1";
                digest?: any;
            };
            verification: {
                id: string;
                kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
                status: "failed" | "blocked" | "passed" | "missing" | "expired";
                evidenceRefs: any[];
            }[];
            evidenceRefs: any[];
            product: {
                id: string;
                schema: "hasna.product_projection.v1";
                revision: number;
                digest?: any;
            };
            intent: {
                id: string;
                schema: "hasna.intent_snapshot.v1";
                digest?: any;
            };
            verifiers: any[];
            environment: {
                id: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
                digest?: any;
            };
            attestations: {
                id: string;
                schema: "hasna.artifact_attestation.v1";
                digest?: any;
            }[];
            plan: {
                id: string;
                schema: "hasna.deployment_plan.v1";
                digest?: any;
            };
            request: {
                id: string;
                schema: "hasna.deployment_request.v1";
                digest?: any;
            };
            approvals: {
                id: string;
                schema: "hasna.deployment_approval_decision.v1";
                digest?: any;
            }[];
            providerReceipts: {
                id: string;
                schema: "hasna.provider_receipt.v1";
                digest?: any;
            }[];
            attempt: {
                id: string;
                schema: "hasna.deployment_attempt.v1";
                revision: number;
                digest?: any;
            };
            outcome: "succeeded" | "failed" | "cancelled" | "unknown_outcome";
            digest?: any;
            createdAt?: any;
            producer?: any;
            rollbackTarget?: {
                id: string;
                schema: "hasna.deployment_receipt.v1";
                digest?: any;
            } | undefined;
            desiredStateDigest?: any;
            observedStateDigest?: any;
            infrastructurePlanRef?: any;
            infrastructureStateLineageRef?: any;
        }>;
        "hasna.launch_evidence.v1": z.ZodEffects<z.ZodObject<{
            product: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.product_projection.v1">;
                id: z.ZodString;
                revision: z.ZodNumber;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.product_projection.v1";
                revision: number;
            }, {
                id: string;
                schema: "hasna.product_projection.v1";
                revision: number;
                digest?: any;
            }>;
            environment: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.environment_binding.v1">;
                id: z.ZodString;
                revision: z.ZodNumber;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
            }, {
                id: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
                digest?: any;
            }>;
            deploymentReceipt: z.ZodObject<{
                schema: z.ZodLiteral<"hasna.deployment_receipt.v1">;
                id: z.ZodString;
                digest: z.ZodType<string, z.ZodTypeDef, any>;
            }, "strict", z.ZodTypeAny, {
                id: string;
                digest: string;
                schema: "hasna.deployment_receipt.v1";
            }, {
                id: string;
                schema: "hasna.deployment_receipt.v1";
                digest?: any;
            }>;
            requiredChecks: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                kind: z.ZodEnum<["health", "readiness", "version", "migration", "alarm", "access", "restore", "rollback", "security", "contract"]>;
                status: z.ZodEnum<["passed", "failed", "missing", "expired", "blocked"]>;
                evidenceRefs: z.ZodArray<z.ZodType<{
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }, z.ZodTypeDef, any>, "many">;
            }, "strict", z.ZodTypeAny, {
                id: string;
                kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
                status: "failed" | "blocked" | "passed" | "missing" | "expired";
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
            }, {
                id: string;
                kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
                status: "failed" | "blocked" | "passed" | "missing" | "expired";
                evidenceRefs: any[];
            }>, "many">;
            proofBundleRefs: z.ZodArray<z.ZodType<{
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
            findings: z.ZodDefault<z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                severity: z.ZodEnum<["p0", "p1", "p2", "p3"]>;
                status: z.ZodEnum<["open", "resolved", "accepted"]>;
                evidenceRefs: z.ZodArray<z.ZodType<{
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }, z.ZodTypeDef, any>, "many">;
            }, "strict", z.ZodTypeAny, {
                id: string;
                status: "open" | "accepted" | "resolved";
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                severity: "p0" | "p1" | "p2" | "p3";
            }, {
                id: string;
                status: "open" | "accepted" | "resolved";
                evidenceRefs: any[];
                severity: "p0" | "p1" | "p2" | "p3";
            }>, "many">>;
            verifiers: z.ZodArray<z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>, "many">;
            independentReview: z.ZodBoolean;
            status: z.ZodEnum<["candidate", "blocked", "ready", "launched", "rolled_back"]>;
            compiledAt: z.ZodType<string, z.ZodTypeDef, any>;
            expiresAt: z.ZodType<string, z.ZodTypeDef, any>;
            schema: z.ZodLiteral<"hasna.launch_evidence.v1">;
            id: z.ZodString;
            createdAt: z.ZodType<string, z.ZodTypeDef, any>;
            producer: z.ZodType<{
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }, z.ZodTypeDef, any>;
            digest: z.ZodType<string, z.ZodTypeDef, any>;
        }, "strict", z.ZodTypeAny, {
            id: string;
            digest: string;
            deploymentReceipt: {
                id: string;
                digest: string;
                schema: "hasna.deployment_receipt.v1";
            };
            status: "blocked" | "candidate" | "ready" | "launched" | "rolled_back";
            schema: "hasna.launch_evidence.v1";
            createdAt: string;
            proofBundleRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            product: {
                id: string;
                digest: string;
                schema: "hasna.product_projection.v1";
                revision: number;
            };
            verifiers: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }[];
            expiresAt: string;
            environment: {
                id: string;
                digest: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
            };
            requiredChecks: {
                id: string;
                kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
                status: "failed" | "blocked" | "passed" | "missing" | "expired";
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
            }[];
            findings: {
                id: string;
                status: "open" | "accepted" | "resolved";
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                severity: "p0" | "p1" | "p2" | "p3";
            }[];
            independentReview: boolean;
            compiledAt: string;
        }, {
            id: string;
            deploymentReceipt: {
                id: string;
                schema: "hasna.deployment_receipt.v1";
                digest?: any;
            };
            status: "blocked" | "candidate" | "ready" | "launched" | "rolled_back";
            schema: "hasna.launch_evidence.v1";
            proofBundleRefs: any[];
            product: {
                id: string;
                schema: "hasna.product_projection.v1";
                revision: number;
                digest?: any;
            };
            verifiers: any[];
            environment: {
                id: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
                digest?: any;
            };
            requiredChecks: {
                id: string;
                kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
                status: "failed" | "blocked" | "passed" | "missing" | "expired";
                evidenceRefs: any[];
            }[];
            independentReview: boolean;
            digest?: any;
            createdAt?: any;
            producer?: any;
            expiresAt?: any;
            findings?: {
                id: string;
                status: "open" | "accepted" | "resolved";
                evidenceRefs: any[];
                severity: "p0" | "p1" | "p2" | "p3";
            }[] | undefined;
            compiledAt?: any;
        }>, {
            id: string;
            digest: string;
            deploymentReceipt: {
                id: string;
                digest: string;
                schema: "hasna.deployment_receipt.v1";
            };
            status: "blocked" | "candidate" | "ready" | "launched" | "rolled_back";
            schema: "hasna.launch_evidence.v1";
            createdAt: string;
            proofBundleRefs: {
                id: string;
                kind: "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "knowledge" | "conversation" | "dashboard" | "render" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
                tags: string[];
                name?: string | undefined;
                uri?: string | undefined;
                externalId?: string | undefined;
                sourcePackage?: string | undefined;
            }[];
            producer: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            };
            product: {
                id: string;
                digest: string;
                schema: "hasna.product_projection.v1";
                revision: number;
            };
            verifiers: {
                id: string;
                kind: "agent" | "human" | "service" | "model" | "workflow" | "system";
                name?: string | undefined;
                provider?: string | undefined;
                accountId?: string | undefined;
                machineId?: string | undefined;
            }[];
            expiresAt: string;
            environment: {
                id: string;
                digest: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
            };
            requiredChecks: {
                id: string;
                kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
                status: "failed" | "blocked" | "passed" | "missing" | "expired";
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
            }[];
            findings: {
                id: string;
                status: "open" | "accepted" | "resolved";
                evidenceRefs: {
                    id: string;
                    kind?: "report" | "video" | "file" | "url" | "artifact" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace" | undefined;
                    sha256?: string | undefined;
                    uri?: string | undefined;
                    summary?: string | undefined;
                }[];
                severity: "p0" | "p1" | "p2" | "p3";
            }[];
            independentReview: boolean;
            compiledAt: string;
        }, {
            id: string;
            deploymentReceipt: {
                id: string;
                schema: "hasna.deployment_receipt.v1";
                digest?: any;
            };
            status: "blocked" | "candidate" | "ready" | "launched" | "rolled_back";
            schema: "hasna.launch_evidence.v1";
            proofBundleRefs: any[];
            product: {
                id: string;
                schema: "hasna.product_projection.v1";
                revision: number;
                digest?: any;
            };
            verifiers: any[];
            environment: {
                id: string;
                schema: "hasna.environment_binding.v1";
                revision: number;
                digest?: any;
            };
            requiredChecks: {
                id: string;
                kind: "health" | "security" | "version" | "migration" | "readiness" | "rollback" | "alarm" | "access" | "restore" | "contract";
                status: "failed" | "blocked" | "passed" | "missing" | "expired";
                evidenceRefs: any[];
            }[];
            independentReview: boolean;
            digest?: any;
            createdAt?: any;
            producer?: any;
            expiresAt?: any;
            findings?: {
                id: string;
                status: "open" | "accepted" | "resolved";
                evidenceRefs: any[];
                severity: "p0" | "p1" | "p2" | "p3";
            }[] | undefined;
            compiledAt?: any;
        }>;
    }>;
};
export interface DeploymentContractSet {
    productProjections: unknown[];
    intentSnapshots: unknown[];
    verifiedSourceCandidates: unknown[];
    buildArtifacts: unknown[];
    artifactAttestations: unknown[];
    environmentBindings: unknown[];
    deploymentRequests: unknown[];
    deploymentPlans: unknown[];
    deploymentApprovalDecisions: unknown[];
    deploymentAttempts: unknown[];
    providerReceipts: unknown[];
    deploymentReceipts: unknown[];
    launchEvidence: unknown[];
}
export interface DeploymentContractSetValidation {
    success: boolean;
    issues: string[];
}
export interface DeploymentContractSchemas {
    ProductProjectionSchema: z.ZodTypeAny;
    IntentSnapshotSchema: z.ZodTypeAny;
    VerifiedSourceCandidateSchema: z.ZodTypeAny;
    BuildArtifactSchema: z.ZodTypeAny;
    ArtifactAttestationSchema: z.ZodTypeAny;
    EnvironmentBindingSchema: z.ZodTypeAny;
    DeploymentRequestSchema: z.ZodTypeAny;
    DeploymentPlanSchema: z.ZodTypeAny;
    DeploymentApprovalDecisionSchema: z.ZodTypeAny;
    DeploymentAttemptSchema: z.ZodTypeAny;
    ProviderReceiptSchema: z.ZodTypeAny;
    DeploymentReceiptSchema: z.ZodTypeAny;
    LaunchEvidenceSchema: z.ZodTypeAny;
}
export declare function validateDeploymentContractSet(schemas: DeploymentContractSchemas, input: DeploymentContractSet): DeploymentContractSetValidation;
