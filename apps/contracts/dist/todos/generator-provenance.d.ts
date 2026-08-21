export declare const TODOS_GENERATOR_VERSION: "1.0.0";
export declare const TODOS_GENERATOR_PROVENANCE_SCHEMA_ID: "hasna.todos.generator_provenance.v1";
export declare const TODOS_GENERATOR_IDENTITY: Readonly<{
    schema: "hasna.todos.generator_provenance.v1";
    generatorVersion: "1.0.0";
    sourceFreeze: {
        contracts: {
            repository: string;
            commitSha: string;
            role: "contract_base" | "open_todos_evidence" | "platform_todos_evidence" | "e_00115_projection_evidence";
        };
        openTodos: {
            repository: string;
            commitSha: string;
            role: "contract_base" | "open_todos_evidence" | "platform_todos_evidence" | "e_00115_projection_evidence";
        };
        platformTodos: {
            repository: string;
            commitSha: string;
            role: "contract_base" | "open_todos_evidence" | "platform_todos_evidence" | "e_00115_projection_evidence";
        };
        e00115: {
            repository: string;
            commitSha: string;
            role: "contract_base" | "open_todos_evidence" | "platform_todos_evidence" | "e_00115_projection_evidence";
        };
    };
    sourceModules: readonly {
        module: string;
        contentDigest: string;
    }[];
    manifestVersion: "1";
}>;
export declare const TODOS_GENERATOR_IDENTITY_DIGEST: string;
export declare function buildTodosGeneratorProvenance(contractDigest: string): Record<string, unknown>;
