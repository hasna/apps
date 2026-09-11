declare function ref(record: {
    schema: string;
    id: string;
    digest: string;
    revision?: number;
}): {
    schema: string;
    id: string;
    digest: string;
    revision?: never;
} | {
    schema: string;
    id: string;
    revision: number;
    digest: string;
};
export declare function createDeploymentEnvelopeFixtureSet(): {
    deployment: import("./deployment-fixtures").DeploymentFixtureSet;
    ref: typeof ref;
    baseEnvelope: (id: string, audience: "internal" | "products", overrides?: Partial<Record<string, unknown>>) => Record<string, unknown>;
    ecsEnvelope: {
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
    };
    ec2SsmComposeEnvelope: {
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
    };
    cloudflareWorkerEnvelope: {
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
    };
    importedExistingTargetEnvelope: {
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
    };
};
export type DeploymentEnvelopeFixtureSet = ReturnType<typeof createDeploymentEnvelopeFixtureSet>;
export {};
