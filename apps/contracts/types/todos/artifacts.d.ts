export declare const TODOS_GENERATED_ARTIFACT_ROOT: "generated/todos/v1";
export declare function buildTodosOpenApi(): Record<string, unknown>;
export declare function buildTodosSurfaceMap(): Record<string, unknown>;
export declare function buildTodosConformanceProfile(): Record<string, unknown>;
export declare function buildTodosFixtures(): Record<string, unknown>;
export interface TodosRenderedArtifactVerification {
    valid: boolean;
    issues: string[];
}
export declare function verifyTodosRenderedArtifacts(rendered: Readonly<Record<string, string>>): TodosRenderedArtifactVerification;
export declare function renderTodosArtifacts(): Record<string, string>;
