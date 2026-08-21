import * as z from "zod/v4";
export declare const TODOS_CONTRACT_SCHEMA_ID: "hasna.todos.contract.v1";
export declare const TodosContractDescriptorSchema: z.ZodObject<{
    schema: z.ZodLiteral<"hasna.todos.contract.v1">;
    namespace: z.ZodLiteral<"hasna.todos">;
    contractVersion: z.ZodLiteral<"1.0.0">;
    manifestVersion: z.ZodLiteral<"1">;
    manifestDigest: z.ZodString;
    capabilityManifestDigest: z.ZodString;
    schemaBundleDigest: z.ZodString;
    invariantRegistryDigest: z.ZodString;
    provenanceDigest: z.ZodString;
    generatorIdentityDigest: z.ZodString;
    publicSubpath: z.ZodLiteral<"@hasna/contracts/todos">;
    rootExported: z.ZodLiteral<false>;
    authorityInvariant: z.ZodObject<{
        count: z.ZodLiteral<1>;
    }, z.core.$strict>;
    provenance: z.ZodObject<{
        schema: z.ZodLiteral<"hasna.todos.contract_provenance.v1">;
        sourceFreeze: z.ZodObject<{
            contracts: z.ZodObject<{
                repository: z.ZodString;
                commitSha: z.ZodString;
                role: z.ZodEnum<{
                    contract_base: "contract_base";
                    open_todos_evidence: "open_todos_evidence";
                    platform_todos_evidence: "platform_todos_evidence";
                    e_00115_projection_evidence: "e_00115_projection_evidence";
                }>;
            }, z.core.$strict>;
            openTodos: z.ZodObject<{
                repository: z.ZodString;
                commitSha: z.ZodString;
                role: z.ZodEnum<{
                    contract_base: "contract_base";
                    open_todos_evidence: "open_todos_evidence";
                    platform_todos_evidence: "platform_todos_evidence";
                    e_00115_projection_evidence: "e_00115_projection_evidence";
                }>;
            }, z.core.$strict>;
            platformTodos: z.ZodObject<{
                repository: z.ZodString;
                commitSha: z.ZodString;
                role: z.ZodEnum<{
                    contract_base: "contract_base";
                    open_todos_evidence: "open_todos_evidence";
                    platform_todos_evidence: "platform_todos_evidence";
                    e_00115_projection_evidence: "e_00115_projection_evidence";
                }>;
            }, z.core.$strict>;
            e00115: z.ZodObject<{
                repository: z.ZodString;
                commitSha: z.ZodString;
                role: z.ZodEnum<{
                    contract_base: "contract_base";
                    open_todos_evidence: "open_todos_evidence";
                    platform_todos_evidence: "platform_todos_evidence";
                    e_00115_projection_evidence: "e_00115_projection_evidence";
                }>;
            }, z.core.$strict>;
        }, z.core.$strict>;
        surfaceMappings: z.ZodObject<{
            status: z.ZodLiteral<"required_target">;
            producerImplementationStatus: z.ZodLiteral<"not_attested">;
            evidenceUse: z.ZodLiteral<"design_input_only">;
            sharedHttpPrefix: z.ZodLiteral<"/v1">;
            localTopologyHttpSurface: z.ZodNull;
            operatorAudienceIncluded: z.ZodLiteral<false>;
        }, z.core.$strict>;
    }, z.core.$strict>;
}, z.core.$strict>;
export type TodosContractDescriptor = z.infer<typeof TodosContractDescriptorSchema>;
export declare const TODOS_CONTRACT_SCHEMAS: Readonly<{
    "hasna.todos.contract.v1": z.ZodObject<{
        schema: z.ZodLiteral<"hasna.todos.contract.v1">;
        namespace: z.ZodLiteral<"hasna.todos">;
        contractVersion: z.ZodLiteral<"1.0.0">;
        manifestVersion: z.ZodLiteral<"1">;
        manifestDigest: z.ZodString;
        capabilityManifestDigest: z.ZodString;
        schemaBundleDigest: z.ZodString;
        invariantRegistryDigest: z.ZodString;
        provenanceDigest: z.ZodString;
        generatorIdentityDigest: z.ZodString;
        publicSubpath: z.ZodLiteral<"@hasna/contracts/todos">;
        rootExported: z.ZodLiteral<false>;
        authorityInvariant: z.ZodObject<{
            count: z.ZodLiteral<1>;
        }, z.core.$strict>;
        provenance: z.ZodObject<{
            schema: z.ZodLiteral<"hasna.todos.contract_provenance.v1">;
            sourceFreeze: z.ZodObject<{
                contracts: z.ZodObject<{
                    repository: z.ZodString;
                    commitSha: z.ZodString;
                    role: z.ZodEnum<{
                        contract_base: "contract_base";
                        open_todos_evidence: "open_todos_evidence";
                        platform_todos_evidence: "platform_todos_evidence";
                        e_00115_projection_evidence: "e_00115_projection_evidence";
                    }>;
                }, z.core.$strict>;
                openTodos: z.ZodObject<{
                    repository: z.ZodString;
                    commitSha: z.ZodString;
                    role: z.ZodEnum<{
                        contract_base: "contract_base";
                        open_todos_evidence: "open_todos_evidence";
                        platform_todos_evidence: "platform_todos_evidence";
                        e_00115_projection_evidence: "e_00115_projection_evidence";
                    }>;
                }, z.core.$strict>;
                platformTodos: z.ZodObject<{
                    repository: z.ZodString;
                    commitSha: z.ZodString;
                    role: z.ZodEnum<{
                        contract_base: "contract_base";
                        open_todos_evidence: "open_todos_evidence";
                        platform_todos_evidence: "platform_todos_evidence";
                        e_00115_projection_evidence: "e_00115_projection_evidence";
                    }>;
                }, z.core.$strict>;
                e00115: z.ZodObject<{
                    repository: z.ZodString;
                    commitSha: z.ZodString;
                    role: z.ZodEnum<{
                        contract_base: "contract_base";
                        open_todos_evidence: "open_todos_evidence";
                        platform_todos_evidence: "platform_todos_evidence";
                        e_00115_projection_evidence: "e_00115_projection_evidence";
                    }>;
                }, z.core.$strict>;
            }, z.core.$strict>;
            surfaceMappings: z.ZodObject<{
                status: z.ZodLiteral<"required_target">;
                producerImplementationStatus: z.ZodLiteral<"not_attested">;
                evidenceUse: z.ZodLiteral<"design_input_only">;
                sharedHttpPrefix: z.ZodLiteral<"/v1">;
                localTopologyHttpSurface: z.ZodNull;
                operatorAudienceIncluded: z.ZodLiteral<false>;
            }, z.core.$strict>;
        }, z.core.$strict>;
    }, z.core.$strict>;
}>;
