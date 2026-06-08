import type { KnowledgeConfig } from './workspace';
export declare const REMOTE_KNOWLEDGE_CONTRACT_VERSION: 1;
export type RemoteKnowledgeRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
export interface RemoteKnowledgeSourceContract {
    owner: 'open-files';
    preferred_ref: 'open-files';
    allowed_schemes: string[];
    raw_source_bytes_stored_in_open_knowledge: false;
}
export interface RemoteKnowledgeArtifactContract {
    storage_type: 'local' | 's3' | 'managed';
    uri_prefix: string | null;
    generated_only: true;
}
export interface RemoteKnowledgeRegistryContract {
    contract_version: typeof REMOTE_KNOWLEDGE_CONTRACT_VERSION;
    service: 'open-knowledge';
    mode: 'local' | 'hosted';
    capabilities: string[];
    endpoints: {
        registry: string;
        search: string;
        ask: string;
        build: string;
        sync: string;
        run_status: string;
        run_logs: string;
        run_artifacts: string;
    };
    source_contract: RemoteKnowledgeSourceContract;
    artifact_contract: RemoteKnowledgeArtifactContract;
}
export interface RemoteKnowledgeRunContract {
    contract_version: typeof REMOTE_KNOWLEDGE_CONTRACT_VERSION;
    id?: string;
    type?: 'search' | 'ask' | 'build' | 'sync' | 'artifact' | 'status';
    status?: RemoteKnowledgeRunStatus | string;
    query?: string;
    prompt?: string;
    output_preview?: unknown;
    citations?: unknown[];
    artifacts?: unknown[];
    usage?: Record<string, unknown>;
    created_at?: string;
    started_at?: string;
    completed_at?: string;
    duration_ms?: number;
    error_code?: string;
    error_message?: string;
    error?: string;
    details?: unknown;
}
export interface RemoteKnowledgeSearchRequest {
    query: string;
    limit?: number;
    semantic?: boolean;
    source_refs?: string[];
}
export interface RemoteKnowledgePromptRequest extends RemoteKnowledgeSearchRequest {
    prompt: string;
    generate?: boolean;
    approve_write?: boolean;
}
export interface RemoteKnowledgeSyncRequest {
    source_refs?: string[];
    artifact_prefix?: string;
    mode?: 'pull' | 'push' | 'both';
}
export interface RemoteKnowledgeLogEntry {
    id?: string;
    run_id?: string;
    level?: string;
    event?: string;
    metadata?: Record<string, unknown>;
    created_at?: string;
}
export interface RemoteKnowledgeArtifact {
    id?: string;
    uri?: string;
    key?: string;
    kind?: string;
    content_type?: string;
    hash?: string;
    size_bytes?: number;
    metadata?: Record<string, unknown>;
}
export declare function normalizeRemoteKnowledgeRunContract(payload: unknown, fallback?: Partial<RemoteKnowledgeRunContract>): RemoteKnowledgeRunContract;
export declare function knowledgeRegistryContract(input: {
    mode: 'local' | 'hosted';
    sourceSchemes: string[];
    storageType: 'local' | 's3' | 'managed';
    artifactUriPrefix: string | null;
}): RemoteKnowledgeRegistryContract;
export declare class RemoteKnowledgeClient {
    private readonly apiKey;
    private readonly apiUrl;
    constructor(apiKey: string, apiUrl: string);
    static fromConfig(config?: KnowledgeConfig, env?: Record<string, string | undefined>): RemoteKnowledgeClient | null;
    private request;
    registry(): Promise<RemoteKnowledgeRegistryContract>;
    search(request: RemoteKnowledgeSearchRequest): Promise<RemoteKnowledgeRunContract>;
    ask(request: RemoteKnowledgePromptRequest): Promise<RemoteKnowledgeRunContract>;
    build(request: RemoteKnowledgePromptRequest): Promise<RemoteKnowledgeRunContract>;
    sync(request?: RemoteKnowledgeSyncRequest): Promise<RemoteKnowledgeRunContract>;
    runStatus(runId: string): Promise<RemoteKnowledgeRunContract | null>;
    runLogs(runId: string): Promise<RemoteKnowledgeLogEntry[]>;
    runArtifacts(runId: string): Promise<RemoteKnowledgeArtifact[]>;
}
