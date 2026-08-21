import * as z from "zod/v4";
export declare const TODOS_PROVENANCE_SCHEMA_ID: "hasna.todos.contract_provenance.v1";
export declare const TodosSourceFreezeSchema: z.ZodObject<{
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
export type TodosSourceFreeze = z.infer<typeof TodosSourceFreezeSchema>;
export declare const TODOS_SOURCE_FREEZE: TodosSourceFreeze;
export declare const TodosContractProvenanceSchema: z.ZodObject<{
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
export type TodosContractProvenance = z.infer<typeof TodosContractProvenanceSchema>;
export declare const TODOS_CONTRACT_PROVENANCE: TodosContractProvenance;
export declare const TODOS_PROVENANCE_DIGEST: string;
export declare const TODOS_PROVENANCE_SCHEMAS: Readonly<{
    "hasna.todos.contract_provenance.v1": z.ZodObject<{
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
}>;
