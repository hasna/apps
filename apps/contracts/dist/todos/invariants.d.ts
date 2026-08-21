export declare const TODOS_INVARIANT_REGISTRY_SCHEMA_ID: "hasna.todos.invariant_registry.v1";
export interface TodosRuntimeInvariant {
    id: string;
    category: "common" | "identity" | "authority" | "domain" | "response" | "operation" | "invocation" | "contract" | "transfer" | "projection" | "artifacts";
    schemaIds: readonly string[];
    description: string;
    jsonSchemaExpressible: boolean;
    runtimeValidatorIds: readonly string[];
}
export declare const TODOS_RUNTIME_INVARIANTS: readonly TodosRuntimeInvariant[];
export declare const TODOS_INVARIANT_REGISTRY: Readonly<{
    schema: "hasna.todos.invariant_registry.v1";
    version: "1";
    runtimeValidationRequired: true;
    invariants: readonly TodosRuntimeInvariant[];
}>;
export declare const TODOS_INVARIANT_REGISTRY_DIGEST: string;
export declare function todosInvariantIdsForSchema(schemaId: string): string[];
