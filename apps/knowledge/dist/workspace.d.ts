export declare const HASNA_KNOWLEDGE_APP_PATH: string;
export interface KnowledgeWorkspace {
    home: string;
    configPath: string;
    jsonStorePath: string;
    knowledgeDbPath: string;
    artifactsDir: string;
    cacheDir: string;
    exportsDir: string;
    indexesDir: string;
    logsDir: string;
    runsDir: string;
    schemasDir: string;
    wikiDir: string;
}
export interface KnowledgeConfig {
    version: 1;
    mode: 'local' | 'hosted';
    hosted?: {
        api_url?: string;
    };
    storage: {
        type: 'local' | 's3';
        artifacts_root: string;
        s3?: {
            bucket: string;
            prefix?: string;
            region?: string;
            profile?: string;
            max_attempts?: number;
            server_side_encryption?: 'AES256' | 'aws:kms';
            kms_key_id?: string;
        };
    };
    sources: {
        preferred_ref: 'open-files';
        allowed_schemes: string[];
    };
    embeddings?: {
        default_model?: string;
        dimensions?: number;
        batch_size?: number;
        max_parallel_calls?: number;
    };
    providers?: {
        default_model?: string;
        aliases?: Record<string, string>;
        openai?: {
            api_key_env?: string;
            base_url?: string;
            default_model?: string;
        };
        anthropic?: {
            api_key_env?: string;
            base_url?: string;
            default_model?: string;
        };
        deepseek?: {
            api_key_env?: string;
            base_url?: string;
            default_model?: string;
        };
    };
    safety?: {
        network?: {
            web_search_enabled?: boolean;
            s3_reads_enabled?: boolean;
            allowed_s3_buckets?: string[];
        };
        redaction?: {
            enabled?: boolean;
        };
        approvals?: {
            generated_writes_require_approval?: boolean;
        };
    };
}
export declare const EXAMPLE_KNOWLEDGE_CANONICAL: {
    readonly division: "xyz";
    readonly app_type: "opensource";
    readonly app: "knowledge";
    readonly env: "prod";
    readonly local_path: string;
    readonly s3: {
        readonly bucket: "example-knowledge-prod";
        readonly region: "us-east-1";
        readonly profile: "example-infra";
        readonly prefix: ".hasna/apps/knowledge";
        readonly server_side_encryption: "AES256";
    };
    readonly secrets: {
        readonly env: "example/knowledge/prod/env";
        readonly aws: "example/knowledge/prod/aws";
        readonly s3: "example/knowledge/prod/s3";
        readonly rds: any;
        readonly future_rds: "example/knowledge/prod/rds";
    };
    readonly source_owner: "open-files";
    readonly evidence_doc: "docs/canonical-secrets-bootstrap-2026-06-08.md";
};
export declare function canonicalExampleKnowledgeStorage(): KnowledgeConfig['storage'];
export declare function legacyGlobalStorePath(): string;
export declare function globalKnowledgeHome(): string;
export declare function projectKnowledgeHome(cwd?: string): string;
export declare function workspaceForHome(home: string): KnowledgeWorkspace;
export declare function defaultKnowledgeConfig(): KnowledgeConfig;
export declare function ensureKnowledgeWorkspace(home: string): KnowledgeWorkspace;
export declare function resolveScopedWorkspace(scope: string | undefined, cwd?: string): KnowledgeWorkspace;
export declare function ensureParentDir(path: string): void;
export declare function readKnowledgeConfig(path: string): KnowledgeConfig;
export declare function writeKnowledgeConfig(path: string, config: KnowledgeConfig): void;
