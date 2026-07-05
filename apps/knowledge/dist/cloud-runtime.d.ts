import type { KnowledgeConfig, KnowledgeWorkspace } from './workspace';
export declare const KNOWLEDGE_DATABASE_URL_ENVS: readonly ["HASNA_KNOWLEDGE_DATABASE_URL", "KNOWLEDGE_DATABASE_URL"];
export declare const KNOWLEDGE_CATALOG_MODE_ENVS: readonly ["HASNA_KNOWLEDGE_STORAGE_MODE", "KNOWLEDGE_STORAGE_MODE"];
export type KnowledgeCatalogRuntimeMode = 'local' | 'hybrid' | 'remote';
export interface KnowledgeCloudRuntimePlan {
    catalog: {
        default_mode: 'local';
        mode_source: 'environment';
        database_url_env: typeof KNOWLEDGE_DATABASE_URL_ENVS;
        mode_env: typeof KNOWLEDGE_CATALOG_MODE_ENVS;
        status_command: string;
        local_sqlite: {
            path: string;
            role: string;
            active_without_remote_env: true;
            remains_present_for_hybrid_sync: true;
        };
        remote_postgres: {
            supported_modes: ['hybrid', 'remote'];
            configured_by_env: typeof KNOWLEDGE_DATABASE_URL_ENVS;
            status_connects_to_remote: false;
            migration_commands: string[];
        };
    };
    artifacts: {
        selected_type: KnowledgeConfig['storage']['type'];
        generated_only: true;
        local_files: {
            active: boolean;
            path: string;
            uri_prefix: string;
        };
        s3: {
            active: boolean;
            bucket: string | null;
            prefix: string | null;
            uri_prefix: string | null;
            region: string | null;
            profile: string | null;
            server_side_encryption: string | null;
            kms_key_configured: boolean;
            credential_values_exposed: false;
        };
    };
    hosted_api: {
        mode_enabled: boolean;
        api_url: string | null;
        api_url_env: 'KNOWLEDGE_API_URL';
        api_key_env: 'KNOWLEDGE_API_KEY';
        requires_hosted_account_for_local_use: false;
    };
    privacy_gates: {
        source_owner: 'open-files';
        raw_source_bytes_stored_in_open_knowledge: false;
        secret_values_stored_in_open_knowledge: false;
        bulk_private_upload_requires_approval: true;
    };
    migration_gates: {
        status_commands_mutate_cloud: false;
        provisioning_requires_external_approval: true;
        live_data_migration_requires_external_approval: true;
        prohibited_without_approval: string[];
    };
}
export interface KnowledgeDatabaseRuntimeStatus {
    selected_mode: KnowledgeCatalogRuntimeMode;
    configured: boolean;
    active_database_env: string | null;
    database_url_env: typeof KNOWLEDGE_DATABASE_URL_ENVS;
    mode_env: typeof KNOWLEDGE_CATALOG_MODE_ENVS;
    local_sqlite: {
        active: true;
        path: string;
        role: string;
    };
    remote_postgres: {
        configured: boolean;
        active_env: string | null;
        connects_during_status: false;
        migration_commands: string[];
    };
    artifacts: {
        selected_type: KnowledgeConfig['storage']['type'];
        generated_only: true;
        status_command: string;
        uri_prefix: string;
    };
    privacy_gates: KnowledgeCloudRuntimePlan['privacy_gates'];
    migration_gates: KnowledgeCloudRuntimePlan['migration_gates'];
    warnings: string[];
}
export declare function buildKnowledgeCloudRuntimePlan(input: {
    config: KnowledgeConfig;
    workspace: KnowledgeWorkspace;
    scope: string;
    hostedApiUrl: string | null;
}): KnowledgeCloudRuntimePlan;
export declare function buildKnowledgeDatabaseRuntimeStatus(input: {
    config: KnowledgeConfig;
    workspace: KnowledgeWorkspace;
    scope: string;
    selectedMode: KnowledgeCatalogRuntimeMode;
    activeDatabaseEnv: string | null;
}): KnowledgeDatabaseRuntimeStatus;
