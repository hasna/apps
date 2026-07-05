import { pathToFileURL } from 'node:url';
import type { KnowledgeConfig, KnowledgeWorkspace } from './workspace';

export const KNOWLEDGE_DATABASE_URL_ENVS = ['HASNA_KNOWLEDGE_DATABASE_URL', 'KNOWLEDGE_DATABASE_URL'] as const;
export const KNOWLEDGE_CATALOG_MODE_ENVS = ['HASNA_KNOWLEDGE_STORAGE_MODE', 'KNOWLEDGE_STORAGE_MODE'] as const;

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

function normalizedS3Prefix(storage: KnowledgeConfig['storage']): string | null {
  return storage.s3?.prefix?.replace(/^\/+|\/+$/g, '') ?? null;
}

function artifactUriPrefix(storage: KnowledgeConfig['storage'], workspace: KnowledgeWorkspace): string {
  if (storage.type === 's3' && storage.s3?.bucket) {
    const prefix = normalizedS3Prefix(storage);
    return `s3://${storage.s3.bucket}/${prefix ? `${prefix}/` : ''}`;
  }
  return pathToFileURL(`${workspace.artifactsDir}/`).href;
}

function privacyGates(): KnowledgeCloudRuntimePlan['privacy_gates'] {
  return {
    source_owner: 'open-files',
    raw_source_bytes_stored_in_open_knowledge: false,
    secret_values_stored_in_open_knowledge: false,
    bulk_private_upload_requires_approval: true,
  };
}

function migrationGates(): KnowledgeCloudRuntimePlan['migration_gates'] {
  return {
    status_commands_mutate_cloud: false,
    provisioning_requires_external_approval: true,
    live_data_migration_requires_external_approval: true,
    prohibited_without_approval: [
      'production AWS mutation',
      'RDS or S3 provisioning',
      'secret creation or rotation',
      'terraform apply',
      'bulk private source upload',
    ],
  };
}

export function buildKnowledgeCloudRuntimePlan(input: {
  config: KnowledgeConfig;
  workspace: KnowledgeWorkspace;
  scope: string;
  hostedApiUrl: string | null;
}): KnowledgeCloudRuntimePlan {
  const { config, workspace, scope, hostedApiUrl } = input;
  const prefix = normalizedS3Prefix(config.storage);
  const uriPrefix = artifactUriPrefix(config.storage, workspace);
  return {
    catalog: {
      default_mode: 'local',
      mode_source: 'environment',
      database_url_env: KNOWLEDGE_DATABASE_URL_ENVS,
      mode_env: KNOWLEDGE_CATALOG_MODE_ENVS,
      status_command: `knowledge db storage status --scope ${scope} --json`,
      local_sqlite: {
        path: workspace.knowledgeDbPath,
        role: 'Local working catalog for sources, chunks, citations, indexes, runs, and sync metadata.',
        active_without_remote_env: true,
        remains_present_for_hybrid_sync: true,
      },
      remote_postgres: {
        supported_modes: ['hybrid', 'remote'],
        configured_by_env: KNOWLEDGE_DATABASE_URL_ENVS,
        status_connects_to_remote: false,
        migration_commands: [
          `knowledge db storage push --scope ${scope} --json`,
          `knowledge db storage pull --scope ${scope} --json`,
          `knowledge db storage sync --scope ${scope} --json`,
        ],
      },
    },
    artifacts: {
      selected_type: config.storage.type,
      generated_only: true,
      local_files: {
        active: config.storage.type === 'local',
        path: workspace.artifactsDir,
        uri_prefix: pathToFileURL(`${workspace.artifactsDir}/`).href,
      },
      s3: {
        active: config.storage.type === 's3',
        bucket: config.storage.s3?.bucket ?? null,
        prefix,
        uri_prefix: config.storage.type === 's3' ? uriPrefix : null,
        region: config.storage.s3?.region ?? null,
        profile: config.storage.s3?.profile ?? null,
        server_side_encryption: config.storage.s3?.server_side_encryption ?? null,
        kms_key_configured: Boolean(config.storage.s3?.kms_key_id),
        credential_values_exposed: false,
      },
    },
    hosted_api: {
      mode_enabled: config.mode === 'hosted',
      api_url: hostedApiUrl,
      api_url_env: 'KNOWLEDGE_API_URL',
      api_key_env: 'KNOWLEDGE_API_KEY',
      requires_hosted_account_for_local_use: false,
    },
    privacy_gates: privacyGates(),
    migration_gates: migrationGates(),
  };
}

export function buildKnowledgeDatabaseRuntimeStatus(input: {
  config: KnowledgeConfig;
  workspace: KnowledgeWorkspace;
  scope: string;
  selectedMode: KnowledgeCatalogRuntimeMode;
  activeDatabaseEnv: string | null;
}): KnowledgeDatabaseRuntimeStatus {
  const { config, workspace, scope, selectedMode, activeDatabaseEnv } = input;
  const configured = Boolean(activeDatabaseEnv);
  const warnings: string[] = [];
  if (selectedMode === 'remote' && !configured) {
    warnings.push('Remote catalog mode is selected, but no knowledge database URL env var is configured.');
  }
  if (selectedMode === 'local' && configured) {
    warnings.push('A knowledge database URL env var is configured, but catalog mode is local; push/pull/sync commands will remain opt-in.');
  }

  return {
    selected_mode: selectedMode,
    configured,
    active_database_env: activeDatabaseEnv,
    database_url_env: KNOWLEDGE_DATABASE_URL_ENVS,
    mode_env: KNOWLEDGE_CATALOG_MODE_ENVS,
    local_sqlite: {
      active: true,
      path: workspace.knowledgeDbPath,
      role: selectedMode === 'local'
        ? 'Authoritative local catalog; no remote PostgreSQL sync is selected.'
        : 'Local working catalog and sync metadata cache used by explicit PostgreSQL push/pull/sync commands.',
    },
    remote_postgres: {
      configured,
      active_env: activeDatabaseEnv,
      connects_during_status: false,
      migration_commands: [
        `knowledge db storage push --scope ${scope} --json`,
        `knowledge db storage pull --scope ${scope} --json`,
        `knowledge db storage sync --scope ${scope} --json`,
      ],
    },
    artifacts: {
      selected_type: config.storage.type,
      generated_only: true,
      status_command: `knowledge storage status --scope ${scope} --json`,
      uri_prefix: artifactUriPrefix(config.storage, workspace),
    },
    privacy_gates: privacyGates(),
    migration_gates: migrationGates(),
    warnings,
  };
}
