import * as z from "zod/v4";
export declare const TODOS_OPERATION_MANIFEST_SCHEMA_ID: "hasna.todos.operation_manifest.v1";
export declare const TODOS_CAPABILITY_IDS: readonly ["authority", "tasks", "projects", "task-lists", "plans", "agents", "comments", "dependencies", "activity", "search", "saved-views", "verification-evidence", "task-files", "runs", "git-traceability", "task-to-pr-projection", "transfer", "deletion-history", "cursor-pagination", "idempotency", "optimistic-concurrency", "typed-errors", "approvals", "task-templates", "reports"];
export declare const TodosCapabilityIdSchema: z.ZodEnum<{
    search: "search";
    approvals: "approvals";
    reports: "reports";
    authority: "authority";
    tasks: "tasks";
    dependencies: "dependencies";
    projects: "projects";
    comments: "comments";
    plans: "plans";
    runs: "runs";
    activity: "activity";
    "task-lists": "task-lists";
    agents: "agents";
    "saved-views": "saved-views";
    "verification-evidence": "verification-evidence";
    "task-files": "task-files";
    "git-traceability": "git-traceability";
    "task-to-pr-projection": "task-to-pr-projection";
    transfer: "transfer";
    "deletion-history": "deletion-history";
    "cursor-pagination": "cursor-pagination";
    idempotency: "idempotency";
    "optimistic-concurrency": "optimistic-concurrency";
    "typed-errors": "typed-errors";
    "task-templates": "task-templates";
}>;
export type TodosCapabilityId = z.infer<typeof TodosCapabilityIdSchema>;
export declare const TodosHttpSurfaceSchema: z.ZodObject<{
    status: z.ZodLiteral<"required_target">;
    producerImplementationStatus: z.ZodLiteral<"not_attested">;
    method: z.ZodEnum<{
        GET: "GET";
        POST: "POST";
        PUT: "PUT";
        PATCH: "PATCH";
        DELETE: "DELETE";
    }>;
    path: z.ZodString;
}, z.core.$strict>;
export declare const TodosOperationSchema: z.ZodObject<{
    id: z.ZodString;
    resource: z.ZodString;
    action: z.ZodString;
    classification: z.ZodEnum<{
        shared_customer: "shared_customer";
        local_topology_only: "local_topology_only";
    }>;
    audience: z.ZodEnum<{
        customer: "customer";
        tenant_admin: "tenant_admin";
    }>;
    capabilityId: z.ZodEnum<{
        search: "search";
        approvals: "approvals";
        reports: "reports";
        authority: "authority";
        tasks: "tasks";
        dependencies: "dependencies";
        projects: "projects";
        comments: "comments";
        plans: "plans";
        runs: "runs";
        activity: "activity";
        "task-lists": "task-lists";
        agents: "agents";
        "saved-views": "saved-views";
        "verification-evidence": "verification-evidence";
        "task-files": "task-files";
        "git-traceability": "git-traceability";
        "task-to-pr-projection": "task-to-pr-projection";
        transfer: "transfer";
        "deletion-history": "deletion-history";
        "cursor-pagination": "cursor-pagination";
        idempotency: "idempotency";
        "optimistic-concurrency": "optimistic-concurrency";
        "typed-errors": "typed-errors";
        "task-templates": "task-templates";
    }>;
    availability: z.ZodEnum<{
        core: "core";
        gated: "gated";
    }>;
    mutability: z.ZodEnum<{
        read: "read";
        write: "write";
        delete: "delete";
        topology: "topology";
    }>;
    idempotency: z.ZodEnum<{
        optional: "optional";
        none: "none";
        required: "required";
    }>;
    concurrency: z.ZodEnum<{
        version: "version";
        none: "none";
        lock: "lock";
        precondition: "precondition";
    }>;
    concurrencyFields: z.ZodArray<z.ZodString>;
    transition: z.ZodNullable<z.ZodObject<{
        machine: z.ZodLiteral<"task_status">;
        targetStatus: z.ZodEnum<{
            failed: "failed";
            in_progress: "in_progress";
            completed: "completed";
        }>;
    }, z.core.$strict>>;
    pagination: z.ZodEnum<{
        cursor: "cursor";
        none: "none";
    }>;
    requestSchemaId: z.ZodString;
    responseSchemaId: z.ZodString;
    errorSchemaId: z.ZodLiteral<"hasna.todos.error.v1">;
    requiredScopes: z.ZodArray<z.ZodString>;
    surfaces: z.ZodObject<{
        cli: z.ZodObject<{
            status: z.ZodLiteral<"required_target">;
            producerImplementationStatus: z.ZodLiteral<"not_attested">;
            command: z.ZodString;
        }, z.core.$strict>;
        mcp: z.ZodObject<{
            status: z.ZodLiteral<"required_target">;
            producerImplementationStatus: z.ZodLiteral<"not_attested">;
            tool: z.ZodString;
        }, z.core.$strict>;
        sdk: z.ZodObject<{
            status: z.ZodLiteral<"required_target">;
            producerImplementationStatus: z.ZodLiteral<"not_attested">;
            method: z.ZodString;
        }, z.core.$strict>;
        http: z.ZodNullable<z.ZodObject<{
            status: z.ZodLiteral<"required_target">;
            producerImplementationStatus: z.ZodLiteral<"not_attested">;
            method: z.ZodEnum<{
                GET: "GET";
                POST: "POST";
                PUT: "PUT";
                PATCH: "PATCH";
                DELETE: "DELETE";
            }>;
            path: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
}, z.core.$strict>;
export type TodosOperation = z.infer<typeof TodosOperationSchema>;
export declare const TodosOperationManifestSchema: z.ZodObject<{
    schema: z.ZodLiteral<"hasna.todos.operation_manifest.v1">;
    version: z.ZodLiteral<"1">;
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
    operations: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        resource: z.ZodString;
        action: z.ZodString;
        classification: z.ZodEnum<{
            shared_customer: "shared_customer";
            local_topology_only: "local_topology_only";
        }>;
        audience: z.ZodEnum<{
            customer: "customer";
            tenant_admin: "tenant_admin";
        }>;
        capabilityId: z.ZodEnum<{
            search: "search";
            approvals: "approvals";
            reports: "reports";
            authority: "authority";
            tasks: "tasks";
            dependencies: "dependencies";
            projects: "projects";
            comments: "comments";
            plans: "plans";
            runs: "runs";
            activity: "activity";
            "task-lists": "task-lists";
            agents: "agents";
            "saved-views": "saved-views";
            "verification-evidence": "verification-evidence";
            "task-files": "task-files";
            "git-traceability": "git-traceability";
            "task-to-pr-projection": "task-to-pr-projection";
            transfer: "transfer";
            "deletion-history": "deletion-history";
            "cursor-pagination": "cursor-pagination";
            idempotency: "idempotency";
            "optimistic-concurrency": "optimistic-concurrency";
            "typed-errors": "typed-errors";
            "task-templates": "task-templates";
        }>;
        availability: z.ZodEnum<{
            core: "core";
            gated: "gated";
        }>;
        mutability: z.ZodEnum<{
            read: "read";
            write: "write";
            delete: "delete";
            topology: "topology";
        }>;
        idempotency: z.ZodEnum<{
            optional: "optional";
            none: "none";
            required: "required";
        }>;
        concurrency: z.ZodEnum<{
            version: "version";
            none: "none";
            lock: "lock";
            precondition: "precondition";
        }>;
        concurrencyFields: z.ZodArray<z.ZodString>;
        transition: z.ZodNullable<z.ZodObject<{
            machine: z.ZodLiteral<"task_status">;
            targetStatus: z.ZodEnum<{
                failed: "failed";
                in_progress: "in_progress";
                completed: "completed";
            }>;
        }, z.core.$strict>>;
        pagination: z.ZodEnum<{
            cursor: "cursor";
            none: "none";
        }>;
        requestSchemaId: z.ZodString;
        responseSchemaId: z.ZodString;
        errorSchemaId: z.ZodLiteral<"hasna.todos.error.v1">;
        requiredScopes: z.ZodArray<z.ZodString>;
        surfaces: z.ZodObject<{
            cli: z.ZodObject<{
                status: z.ZodLiteral<"required_target">;
                producerImplementationStatus: z.ZodLiteral<"not_attested">;
                command: z.ZodString;
            }, z.core.$strict>;
            mcp: z.ZodObject<{
                status: z.ZodLiteral<"required_target">;
                producerImplementationStatus: z.ZodLiteral<"not_attested">;
                tool: z.ZodString;
            }, z.core.$strict>;
            sdk: z.ZodObject<{
                status: z.ZodLiteral<"required_target">;
                producerImplementationStatus: z.ZodLiteral<"not_attested">;
                method: z.ZodString;
            }, z.core.$strict>;
            http: z.ZodNullable<z.ZodObject<{
                status: z.ZodLiteral<"required_target">;
                producerImplementationStatus: z.ZodLiteral<"not_attested">;
                method: z.ZodEnum<{
                    GET: "GET";
                    POST: "POST";
                    PUT: "PUT";
                    PATCH: "PATCH";
                    DELETE: "DELETE";
                }>;
                path: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type TodosOperationManifest = z.infer<typeof TodosOperationManifestSchema>;
export declare const TODOS_OPERATION_MANIFEST: TodosOperationManifest;
export declare const TODOS_OPERATION_MANIFEST_DIGEST: string;
export declare function getTodosOperation(operationId: string): TodosOperation | undefined;
export declare const TODOS_OPERATION_SCHEMAS: Readonly<{
    "hasna.todos.operation_manifest.v1": z.ZodObject<{
        schema: z.ZodLiteral<"hasna.todos.operation_manifest.v1">;
        version: z.ZodLiteral<"1">;
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
        operations: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            resource: z.ZodString;
            action: z.ZodString;
            classification: z.ZodEnum<{
                shared_customer: "shared_customer";
                local_topology_only: "local_topology_only";
            }>;
            audience: z.ZodEnum<{
                customer: "customer";
                tenant_admin: "tenant_admin";
            }>;
            capabilityId: z.ZodEnum<{
                search: "search";
                approvals: "approvals";
                reports: "reports";
                authority: "authority";
                tasks: "tasks";
                dependencies: "dependencies";
                projects: "projects";
                comments: "comments";
                plans: "plans";
                runs: "runs";
                activity: "activity";
                "task-lists": "task-lists";
                agents: "agents";
                "saved-views": "saved-views";
                "verification-evidence": "verification-evidence";
                "task-files": "task-files";
                "git-traceability": "git-traceability";
                "task-to-pr-projection": "task-to-pr-projection";
                transfer: "transfer";
                "deletion-history": "deletion-history";
                "cursor-pagination": "cursor-pagination";
                idempotency: "idempotency";
                "optimistic-concurrency": "optimistic-concurrency";
                "typed-errors": "typed-errors";
                "task-templates": "task-templates";
            }>;
            availability: z.ZodEnum<{
                core: "core";
                gated: "gated";
            }>;
            mutability: z.ZodEnum<{
                read: "read";
                write: "write";
                delete: "delete";
                topology: "topology";
            }>;
            idempotency: z.ZodEnum<{
                optional: "optional";
                none: "none";
                required: "required";
            }>;
            concurrency: z.ZodEnum<{
                version: "version";
                none: "none";
                lock: "lock";
                precondition: "precondition";
            }>;
            concurrencyFields: z.ZodArray<z.ZodString>;
            transition: z.ZodNullable<z.ZodObject<{
                machine: z.ZodLiteral<"task_status">;
                targetStatus: z.ZodEnum<{
                    failed: "failed";
                    in_progress: "in_progress";
                    completed: "completed";
                }>;
            }, z.core.$strict>>;
            pagination: z.ZodEnum<{
                cursor: "cursor";
                none: "none";
            }>;
            requestSchemaId: z.ZodString;
            responseSchemaId: z.ZodString;
            errorSchemaId: z.ZodLiteral<"hasna.todos.error.v1">;
            requiredScopes: z.ZodArray<z.ZodString>;
            surfaces: z.ZodObject<{
                cli: z.ZodObject<{
                    status: z.ZodLiteral<"required_target">;
                    producerImplementationStatus: z.ZodLiteral<"not_attested">;
                    command: z.ZodString;
                }, z.core.$strict>;
                mcp: z.ZodObject<{
                    status: z.ZodLiteral<"required_target">;
                    producerImplementationStatus: z.ZodLiteral<"not_attested">;
                    tool: z.ZodString;
                }, z.core.$strict>;
                sdk: z.ZodObject<{
                    status: z.ZodLiteral<"required_target">;
                    producerImplementationStatus: z.ZodLiteral<"not_attested">;
                    method: z.ZodString;
                }, z.core.$strict>;
                http: z.ZodNullable<z.ZodObject<{
                    status: z.ZodLiteral<"required_target">;
                    producerImplementationStatus: z.ZodLiteral<"not_attested">;
                    method: z.ZodEnum<{
                        GET: "GET";
                        POST: "POST";
                        PUT: "PUT";
                        PATCH: "PATCH";
                        DELETE: "DELETE";
                    }>;
                    path: z.ZodString;
                }, z.core.$strict>>;
            }, z.core.$strict>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
}>;
