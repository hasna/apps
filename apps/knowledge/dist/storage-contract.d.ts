import type { Database } from 'bun:sqlite';
import { REMOTE_KNOWLEDGE_CONTRACT_VERSION } from './remote-client';
import type { KnowledgeConfig, KnowledgeWorkspace } from './workspace';
import { EXAMPLE_KNOWLEDGE_CANONICAL } from './workspace';
export interface StorageArtifactClass {
    kind: string;
    prefix: string;
    description: string;
}
export interface StorageContract {
    scope: string;
    mode: KnowledgeConfig['mode'];
    storage_type: KnowledgeConfig['storage']['type'];
    workspace_home: string;
    local_layout: {
        app_path: string;
        config_path: string;
        json_store_path: string;
        knowledge_db_path: string;
        directories: Record<string, string>;
    };
    artifact_store: {
        type: KnowledgeConfig['storage']['type'];
        artifacts_root: string;
        uri_prefix: string;
        s3: {
            bucket: string;
            prefix: string;
            region: string | null;
            profile: string | null;
            server_side_encryption: string | null;
            kms_key_configured: boolean;
        } | null;
    };
    canonical_example: {
        division: typeof EXAMPLE_KNOWLEDGE_CANONICAL.division;
        app_type: typeof EXAMPLE_KNOWLEDGE_CANONICAL.app_type;
        app: typeof EXAMPLE_KNOWLEDGE_CANONICAL.app;
        env: typeof EXAMPLE_KNOWLEDGE_CANONICAL.env;
        active: boolean;
        local_path: string;
        s3: {
            bucket: string;
            region: string;
            profile: string;
            prefix: string;
            uri_prefix: string;
            server_side_encryption: string;
        };
        secrets: {
            env: string;
            aws: string;
            s3: string;
            rds: null;
            future_rds: string;
        };
        evidence_doc: string;
    };
    hosted: {
        enabled: boolean;
        api_url: string;
        api_url_env: 'KNOWLEDGE_API_URL';
        api_key_env: 'KNOWLEDGE_API_KEY';
        auth_storage: '~/.hasna/knowledge/auth.json';
        remote_contract_version: typeof REMOTE_KNOWLEDGE_CONTRACT_VERSION;
        requires_hosted_account_for_local_use: false;
    };
    source_ownership: {
        owner: 'open-files';
        preferred_ref: string;
        allowed_schemes: string[];
        raw_source_bytes_stored_in_open_knowledge: false;
        stores: string[];
        does_not_store: string[];
    };
    private_fleet_boundary: {
        manifest_authority: 'open-machines';
        source_ref_authority: 'open-files';
        secret_ref_authority: 'open-secrets';
        raw_private_manifest_bytes_stored_in_open_knowledge: false;
        accepted_source_ref_schemes: string[];
        stores: string[];
        does_not_store: string[];
        example_manifest_ref: string;
    };
    generated_artifacts: StorageArtifactClass[];
    scalability: {
        catalog: string;
        indexes: string;
        logs: string;
        markdown: string;
    };
    warnings: string[];
}
export interface StorageValidationResult {
    ok: boolean;
    errors: string[];
    warnings: string[];
}
export interface GeneratedStorageObject {
    uri: string;
    key: string;
    kind: string;
    content_type?: string;
    hash?: string;
    size_bytes?: number;
    modified_at?: string;
    metadata?: Record<string, unknown>;
}
export declare function hashArtifactBody(body: string | Uint8Array): {
    hash: string;
    size_bytes: number;
};
export declare function artifactKindForKey(key: string): string;
export declare function resolveStorageContract(config: KnowledgeConfig, workspace: KnowledgeWorkspace, scope?: string): StorageContract;
export declare function validateStorageConfig(config: KnowledgeConfig, workspace: KnowledgeWorkspace): StorageValidationResult;
export declare function recordStorageObjects(db: Database, objects: GeneratedStorageObject[], now?: Date): void;
