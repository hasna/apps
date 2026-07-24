export type KnowledgeRuntimeSurface = 'cli' | 'sdk' | 'mcp-stdio' | 'mcp-http' | 'server' | 'operator-migration' | 'public-api';
export type KnowledgeRuntimeRole = 'local' | 'hosted-client' | 'hosted-server' | 'operator-migration' | 'invalid';
export type KnowledgeContainmentCode = 'KNOWLEDGE_RUNTIME_INTENT_INVALID' | 'KNOWLEDGE_CONFIG_INVALID' | 'KNOWLEDGE_HOSTED_CONTAINED' | 'KNOWLEDGE_AUTHORITY_UNAVAILABLE' | 'KNOWLEDGE_PROJECT_FORBIDDEN' | 'KNOWLEDGE_POSITIVE_AUTHORITY_DISABLED' | 'KNOWLEDGE_OPERATOR_REQUIRED';
export type KnowledgeRuntimeEnv = Record<string, string | undefined>;
export interface KnowledgeRoleFs {
    existsSync(path: string): boolean;
    readFileSync(path: string, encoding: 'utf8'): string;
}
type ConfigRecord = Record<string, unknown>;
/** Validate every required persisted-config field before any workspace side effect. */
export declare function knowledgeConfigValidationIssue(value: unknown): string | null;
export declare function configContainmentError(detail: string, surface?: KnowledgeRuntimeSurface): KnowledgeContainmentError;
export declare function assertValidKnowledgeConfig(value: unknown, surface?: KnowledgeRuntimeSurface): asserts value is ConfigRecord;
export declare function readValidatedKnowledgeConfig(configPath: string, fs?: KnowledgeRoleFs): ConfigRecord | undefined;
export interface KnowledgeRuntimeIntent {
    surface?: KnowledgeRuntimeSurface;
    env?: KnowledgeRuntimeEnv;
    configMode?: string | null;
    explicitMode?: string | null;
    hostedRequested?: boolean;
    localStoreOverride?: boolean;
}
export interface KnowledgeRuntimeResolution {
    role: KnowledgeRuntimeRole;
    surface: KnowledgeRuntimeSurface;
    source: string;
    signals: readonly string[];
    issues: readonly string[];
}
export interface KnowledgeContainmentPayload {
    ok: false;
    code: KnowledgeContainmentCode;
    status: 403 | 503;
    role: KnowledgeRuntimeRole;
    surface: KnowledgeRuntimeSurface;
    message: string;
}
export declare const MAX_KNOWLEDGE_DIAGNOSTIC_BYTES = 384;
export declare class KnowledgeContainmentError extends Error {
    readonly code: KnowledgeContainmentCode;
    readonly status: 403 | 503;
    readonly role: KnowledgeRuntimeRole;
    readonly surface: KnowledgeRuntimeSurface;
    readonly name = "KnowledgeContainmentError";
    constructor(code: KnowledgeContainmentCode, status: 403 | 503, role: KnowledgeRuntimeRole, surface: KnowledgeRuntimeSurface, _detail: string);
    toJSON(): KnowledgeContainmentPayload;
}
export declare function resolveKnowledgeRuntimeRole(intent?: KnowledgeRuntimeIntent): KnowledgeRuntimeResolution;
/**
 * Canonical two-phase gate. Hosted/invalid env or invocation intent throws
 * before `readConfigMode` is called. Only a preliminarily local role may read
 * the role-config file, after which the second resolution is also gated.
 */
export declare function assertKnowledgeLocalRuntimeWithConfig(intent: KnowledgeRuntimeIntent, readConfigMode: () => string | undefined): KnowledgeRuntimeResolution;
export declare function resolveKnowledgeRuntimeRoleWithConfig(intent: KnowledgeRuntimeIntent, readConfigMode: () => string | undefined): KnowledgeRuntimeResolution;
export declare function assertKnowledgeLocalRuntimeForConfigPath(intent: KnowledgeRuntimeIntent, configPath: string, fs?: KnowledgeRoleFs, required?: boolean): KnowledgeRuntimeResolution;
export declare function containmentErrorFor(resolution: KnowledgeRuntimeResolution): KnowledgeContainmentError;
export declare function assertKnowledgeLocalRuntime(intentOrResolution?: KnowledgeRuntimeIntent | KnowledgeRuntimeResolution): KnowledgeRuntimeResolution;
export declare function readKnowledgeConfiguredMode(configPath: string, fs?: KnowledgeRoleFs, required?: boolean): string | undefined;
export type KnowledgeAuthorityState = {
    trust: 'missing';
} | {
    trust: 'untrusted';
} | {
    trust: 'trusted';
    projectGrants: readonly string[];
};
export declare function authorityContainmentError(authority: KnowledgeAuthorityState | undefined, surface?: KnowledgeRuntimeSurface): KnowledgeContainmentError;
export declare function isKnowledgeContainmentError(error: unknown): error is KnowledgeContainmentError;
export {};
