export interface TodosRuntimeValidatorBinding {
    id: string;
    sourceFile: string;
    symbol: string;
    kind: "refinement" | "validator" | "schema";
    invariantIds: readonly string[];
    schemaIds: readonly string[];
}
/**
 * Independent mechanical inventory for every custom refinement and exported
 * semantic validator. Invariant declarations do not derive from this list.
 */
export declare const TODOS_RUNTIME_VALIDATOR_BINDINGS: readonly TodosRuntimeValidatorBinding[];
