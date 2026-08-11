import { KNOWLEDGE_GUARDED_WRITE_CONTRACT, type KnowledgePrivateInputDescriptor, type KnowledgePrivateQueryDescriptor, type KnowledgePrivateResultProof } from './guarded-write-contract.js';
export declare const KNOWLEDGE_GUARDED_CLI_REQUEST_SCHEMA: 'knowledge.guarded-cli-request.v1';
export declare const KNOWLEDGE_GUARDED_CLI_RESULT_SCHEMA: 'knowledge.guarded-cli-result.v1';
type KnowledgeGuardedCliAction = 'write' | 'query' | 'readback';
type KnowledgeGuardedCliTransport = 'process_ipc' | 'anonymous_fd';
export interface KnowledgeGuardedCliPrivateResult {
    schema: typeof KNOWLEDGE_GUARDED_CLI_RESULT_SCHEMA;
    ok: true;
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    action: KnowledgeGuardedCliAction;
    transport: KnowledgeGuardedCliTransport;
    request_digest: string;
    result_digest: string;
    proof: KnowledgePrivateResultProof;
}
export interface KnowledgeGuardedCliDescriptorOptions {
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
}
export declare class KnowledgeGuardedCliDescriptorError extends Error {
    readonly code: string;
    constructor(code: string);
}
export declare function runKnowledgeGuardedCliDescriptorWorker(requestFd: number, resultFd: number, env?: NodeJS.ProcessEnv): Promise<Omit<KnowledgeGuardedCliPrivateResult, 'proof'>>;
export declare function runKnowledgeGuardedCliIpcWorker(env?: NodeJS.ProcessEnv): Promise<Omit<KnowledgeGuardedCliPrivateResult, 'proof'>>;
export declare function executeKnowledgeGuardedCliWrite(descriptor: KnowledgePrivateInputDescriptor, options?: KnowledgeGuardedCliDescriptorOptions): Promise<KnowledgeGuardedCliPrivateResult>;
export declare function executeKnowledgeGuardedCliQuery(descriptor: KnowledgePrivateQueryDescriptor, options?: KnowledgeGuardedCliDescriptorOptions): Promise<KnowledgeGuardedCliPrivateResult>;
export declare function executeKnowledgeGuardedCliReadback(descriptor: KnowledgePrivateQueryDescriptor, options?: KnowledgeGuardedCliDescriptorOptions): Promise<KnowledgeGuardedCliPrivateResult>;
export {};
