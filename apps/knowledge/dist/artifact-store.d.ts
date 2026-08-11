import type { KnowledgeConfig, KnowledgeWorkspace } from './workspace';
interface S3ClientLike {
    send(command: unknown): Promise<any>;
}
export interface ArtifactWrite {
    key: string;
    body: string | Uint8Array;
    content_type?: string;
    metadata?: Record<string, unknown>;
}
export interface ArtifactWriteResult {
    key: string;
    uri: string;
    modified_at?: string;
}
export interface ArtifactStore {
    readonly type: 'local' | 's3';
    readonly canRead: boolean;
    readonly canWrite: boolean;
    put(entry: ArtifactWrite): Promise<ArtifactWriteResult>;
    getText(key: string): Promise<string>;
    exists(key: string): Promise<boolean>;
}
export declare function normalizeArtifactKey(key: string): string;
export declare class LocalArtifactStore implements ArtifactStore {
    private readonly root;
    readonly type: "local";
    readonly canRead = true;
    readonly canWrite = true;
    constructor(root: string);
    put(entry: ArtifactWrite): Promise<ArtifactWriteResult>;
    getText(key: string): Promise<string>;
    exists(key: string): Promise<boolean>;
}
export interface S3ArtifactStoreOptions {
    bucket: string;
    prefix?: string;
    region?: string;
    profile?: string;
    max_attempts?: number;
    server_side_encryption?: 'AES256' | 'aws:kms';
    kms_key_id?: string;
    client?: S3ClientLike;
}
export declare class S3ArtifactStore implements ArtifactStore {
    private readonly options;
    readonly type: "s3";
    readonly canRead = true;
    readonly canWrite = true;
    private client?;
    constructor(options: S3ArtifactStoreOptions);
    private getClient;
    private objectKey;
    put(entry: ArtifactWrite): Promise<ArtifactWriteResult>;
    getText(key: string): Promise<string>;
    exists(key: string): Promise<boolean>;
}
export declare function createArtifactStore(config: KnowledgeConfig, workspace: KnowledgeWorkspace): ArtifactStore;
export {};
