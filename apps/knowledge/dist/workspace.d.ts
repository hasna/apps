export declare const HASNA_KNOWLEDGE_APP_PATH: string;
export declare const LEGACY_HASNA_KNOWLEDGE_APP_PATH: string;
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
export declare const HASNA_XYZ_KNOWLEDGE_CANONICAL: {
    readonly division: "xyz";
    readonly app_type: "opensource";
    readonly app: "knowledge";
    readonly env: "prod";
    readonly local_path: string;
    readonly s3: {
        readonly bucket: "hasna-xyz-opensource-knowledge-prod";
        readonly region: "us-east-1";
        readonly profile: "hasna-xyz-infra";
        readonly prefix: ".hasna/knowledge";
        readonly server_side_encryption: "AES256";
    };
    readonly secrets: {
        readonly env: "hasna/xyz/opensource/knowledge/prod/env";
        readonly aws: "hasna/xyz/opensource/knowledge/prod/aws";
        readonly s3: "hasna/xyz/opensource/knowledge/prod/s3";
        readonly rds: any;
        readonly future_rds: "hasna/xyz/opensource/knowledge/prod/rds";
    };
    readonly source_owner: "open-files";
    readonly evidence_doc: "docs/canonical-secrets-bootstrap-2026-06-08.md";
};
export declare function canonicalHasnaXyzKnowledgeStorage(): KnowledgeConfig['storage'];
export declare function legacyGlobalStorePath(): string;
export declare function globalKnowledgeHome(): string;
export declare function legacyGlobalKnowledgeHome(): string;
export declare function projectKnowledgeHome(cwd?: string): string;
export declare function legacyProjectKnowledgeHome(cwd?: string): string;
export declare function legacyKnowledgeHomeForScope(scope: string | undefined, cwd?: string): string;
export declare function workspaceForHome(home: string): KnowledgeWorkspace;
export declare function pathIsInside(parent: string, target: string): boolean;
export declare function assertKnowledgeWritePathAllowed(targetPath: string, workspace: KnowledgeWorkspace, options?: {
    allowJsonStore?: boolean;
    operation?: string;
}): void;
export declare function defaultKnowledgeConfig(): KnowledgeConfig;
export declare function ensureKnowledgeWorkspace(home: string): KnowledgeWorkspace;
export interface LegacyKnowledgeWorkspaceMigrationResult {
    ok: boolean;
    migrated: boolean;
    dry_run: boolean;
    source: string;
    target: string;
    source_exists: boolean;
    target_exists: boolean;
    message: string;
}
export declare function migrateLegacyKnowledgeWorkspace(options?: {
    scope?: string;
    cwd?: string;
    dryRun?: boolean;
}): LegacyKnowledgeWorkspaceMigrationResult;
export declare function resolveScopedWorkspace(scope: string | undefined, cwd?: string): KnowledgeWorkspace;
export declare function ensureParentDir(path: string): void;
export declare function readKnowledgeConfig(path: string): KnowledgeConfig;
export declare function writeKnowledgeConfig(path: string, config: KnowledgeConfig): void;
