export type PrivateRefIssueSeverity = 'medium' | 'high';
export interface PrivateRefLintIssue {
    type: string;
    severity: PrivateRefIssueSeverity;
    path: string;
    preview: string;
}
export interface PrivateRefLintOptions {
    allowFileSourceRefs?: boolean;
    allowPrivateWorkspaceRefs?: boolean;
}
export declare function lintPrivateRefs(value: unknown, options?: PrivateRefLintOptions, path?: string): PrivateRefLintIssue[];
export declare function assertNoPrivateRefs(value: unknown, options?: PrivateRefLintOptions): void;
export declare function redactPrivateRefs<T>(value: T): T;
export declare function privateRefRedactionCount(before: unknown, after: unknown): number;
