import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { Database } from 'bun:sqlite';
import { DEFAULT_KNOWLEDGE_API_URL, normalizeKnowledgeApiOrigin } from './auth';
import { REMOTE_KNOWLEDGE_CONTRACT_VERSION } from './remote-client';
import type { KnowledgeConfig, KnowledgeWorkspace } from './workspace';
import { HASNA_KNOWLEDGE_APP_PATH, EXAMPLE_KNOWLEDGE_CANONICAL } from './workspace';

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

const GENERATED_ARTIFACTS: StorageArtifactClass[] = [
  {
    kind: 'schema',
    prefix: 'schemas/',
    description: 'Machine-readable agent schemas and source rules.',
  },
  {
    kind: 'index',
    prefix: 'indexes/',
    description: 'Small orientation indexes and future shard manifests.',
  },
  {
    kind: 'log',
    prefix: 'logs/',
    description: 'Append-only JSONL run and wiki-maintenance log partitions.',
  },
  {
    kind: 'run',
    prefix: 'runs/',
    description: 'Prompt/tool/cost ledgers and generated output records.',
  },
  {
    kind: 'wiki_page',
    prefix: 'wiki/',
    description: 'Generated cited Markdown pages, not raw source files.',
  },
  {
    kind: 'export',
    prefix: 'exports/',
    description: 'Portable exports and snapshots of derived knowledge state.',
  },
];

export function hashArtifactBody(body: string | Uint8Array): { hash: string; size_bytes: number } {
  const bytes = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body);
  return {
    hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    size_bytes: bytes.byteLength,
  };
}

export function artifactKindForKey(key: string): string {
  const match = GENERATED_ARTIFACTS.find((entry) => key.startsWith(entry.prefix));
  return match?.kind ?? 'artifact';
}

export function resolveStorageContract(
  config: KnowledgeConfig,
  workspace: KnowledgeWorkspace,
  scope = 'global',
): StorageContract {
  const validation = validateStorageConfig(config, workspace);
  const s3 = config.storage.s3 ?? null;
  const prefix = s3?.prefix?.replace(/^\/+|\/+$/g, '') ?? '';
  const s3UriPrefix = s3 ? `s3://${s3.bucket}/${prefix ? `${prefix}/` : ''}` : '';
  const canonicalPrefix = EXAMPLE_KNOWLEDGE_CANONICAL.s3.prefix.replace(/^\/+|\/+$/g, '');
  const canonicalS3UriPrefix = `s3://${EXAMPLE_KNOWLEDGE_CANONICAL.s3.bucket}/${canonicalPrefix}/`;
  const canonicalActive = config.storage.type === 's3'
    && s3?.bucket === EXAMPLE_KNOWLEDGE_CANONICAL.s3.bucket
    && (s3.region ?? null) === EXAMPLE_KNOWLEDGE_CANONICAL.s3.region;

  return {
    scope,
    mode: config.mode,
    storage_type: config.storage.type,
    workspace_home: workspace.home,
    local_layout: {
      app_path: HASNA_KNOWLEDGE_APP_PATH,
      config_path: workspace.configPath,
      json_store_path: workspace.jsonStorePath,
      knowledge_db_path: workspace.knowledgeDbPath,
      directories: {
        artifacts: workspace.artifactsDir,
        cache: workspace.cacheDir,
        exports: workspace.exportsDir,
        indexes: workspace.indexesDir,
        logs: workspace.logsDir,
        runs: workspace.runsDir,
        schemas: workspace.schemasDir,
        wiki: workspace.wikiDir,
      },
    },
    artifact_store: {
      type: config.storage.type,
      artifacts_root: config.storage.artifacts_root,
      uri_prefix: config.storage.type === 's3' ? s3UriPrefix : pathToFileURL(`${workspace.artifactsDir}/`).href,
      s3: s3
        ? {
            bucket: s3.bucket,
            prefix,
            region: s3.region ?? null,
            profile: s3.profile ?? null,
            server_side_encryption: s3.server_side_encryption ?? null,
            kms_key_configured: Boolean(s3.kms_key_id),
          }
        : null,
    },
    canonical_example: {
      division: EXAMPLE_KNOWLEDGE_CANONICAL.division,
      app_type: EXAMPLE_KNOWLEDGE_CANONICAL.app_type,
      app: EXAMPLE_KNOWLEDGE_CANONICAL.app,
      env: EXAMPLE_KNOWLEDGE_CANONICAL.env,
      active: canonicalActive,
      local_path: EXAMPLE_KNOWLEDGE_CANONICAL.local_path,
      s3: {
        bucket: EXAMPLE_KNOWLEDGE_CANONICAL.s3.bucket,
        region: EXAMPLE_KNOWLEDGE_CANONICAL.s3.region,
        profile: EXAMPLE_KNOWLEDGE_CANONICAL.s3.profile,
        prefix: canonicalPrefix,
        uri_prefix: canonicalS3UriPrefix,
        server_side_encryption: EXAMPLE_KNOWLEDGE_CANONICAL.s3.server_side_encryption,
      },
      secrets: {
        env: EXAMPLE_KNOWLEDGE_CANONICAL.secrets.env,
        aws: EXAMPLE_KNOWLEDGE_CANONICAL.secrets.aws,
        s3: EXAMPLE_KNOWLEDGE_CANONICAL.secrets.s3,
        rds: EXAMPLE_KNOWLEDGE_CANONICAL.secrets.rds,
        future_rds: EXAMPLE_KNOWLEDGE_CANONICAL.secrets.future_rds,
      },
      evidence_doc: EXAMPLE_KNOWLEDGE_CANONICAL.evidence_doc,
    },
    hosted: {
      enabled: config.mode === 'hosted',
      api_url: normalizeKnowledgeApiOrigin(config.hosted?.api_url ?? DEFAULT_KNOWLEDGE_API_URL),
      api_url_env: 'KNOWLEDGE_API_URL',
      api_key_env: 'KNOWLEDGE_API_KEY',
      auth_storage: '~/.hasna/knowledge/auth.json',
      remote_contract_version: REMOTE_KNOWLEDGE_CONTRACT_VERSION,
      requires_hosted_account_for_local_use: false,
    },
    source_ownership: {
      owner: 'open-files',
      preferred_ref: config.sources.preferred_ref,
      allowed_schemes: config.sources.allowed_schemes,
      raw_source_bytes_stored_in_open_knowledge: false,
      stores: [
        'source refs',
        'source revisions and hashes',
        'citation spans',
        'redacted extracted chunks',
        'embeddings',
        'generated wiki artifacts',
        'indexes',
        'run ledgers',
      ],
      does_not_store: [
        'raw open-files bytes',
        'S3 object credentials',
        'connector secrets',
        'hosted tenant ownership state',
      ],
    },
    private_fleet_boundary: {
      manifest_authority: 'open-machines',
      source_ref_authority: 'open-files',
      secret_ref_authority: 'open-secrets',
      raw_private_manifest_bytes_stored_in_open_knowledge: false,
      accepted_source_ref_schemes: config.sources.allowed_schemes.filter((scheme) => ['open-files', 's3', 'file'].includes(scheme)),
      stores: [
        'source refs for private manifests',
        'redacted setup decisions',
        'runbook summaries',
        'citation spans into approved knowledge sources',
        'machine setup evidence hashes',
      ],
      does_not_store: [
        'private fleet manifests',
        'machine hostnames',
        'machine serial numbers',
        'sudo passwords',
        'VNC passwords',
        'SSH private keys',
        'GitHub App private keys',
        'secret values',
      ],
      example_manifest_ref: 'open-files://source/private-fleet-manifest/path/machines.json',
    },
    generated_artifacts: GENERATED_ARTIFACTS,
    scalability: {
      catalog: 'knowledge.db tracks sources, revisions, chunks, citations, indexes, runs, and storage_objects.',
      indexes: 'Indexes are cataloged DB rows plus sharded artifacts, not one giant index.md.',
      logs: 'Logs use dated JSONL partitions under logs/yyyy/mm/dd.jsonl.',
      markdown: 'Markdown pages are the readable wiki layer over DB/object-store state.',
    },
    warnings: validation.warnings,
  };
}

export function validateStorageConfig(config: KnowledgeConfig, workspace: KnowledgeWorkspace): StorageValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!workspace.home.endsWith(HASNA_KNOWLEDGE_APP_PATH)) {
    warnings.push(`Workspace home does not end with ${HASNA_KNOWLEDGE_APP_PATH}: ${workspace.home}`);
  }

  if (config.storage.type === 's3') {
    if (!config.storage.s3?.bucket) errors.push('storage.s3.bucket is required when storage.type is s3.');
    if (!config.storage.s3?.prefix) warnings.push('storage.s3.prefix is empty; generated knowledge artifacts will be written at the bucket root.');
    if (config.mode === 'local') warnings.push('storage.type is s3 while mode is local; this is valid for BYO S3, but hosted wrappers should set mode to hosted.');
  }

  if (config.storage.type === 'local' && config.storage.s3) {
    warnings.push('storage.s3 is configured but ignored while storage.type is local.');
  }

  if (config.sources.preferred_ref !== 'open-files') {
    warnings.push('sources.preferred_ref should stay open-files for durable company knowledge.');
  }

  if (!config.sources.allowed_schemes.includes('open-files')) {
    errors.push('sources.allowed_schemes must include open-files.');
  }

  if (config.mode === 'hosted' && config.hosted?.api_url) {
    try {
      normalizeKnowledgeApiOrigin(config.hosted.api_url);
    } catch {
      errors.push('hosted.api_url must be an http(s) URL when mode is hosted.');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function recordStorageObjects(db: Database, objects: GeneratedStorageObject[], now = new Date()): void {
  const timestamp = now.toISOString();
  const statement = db.prepare(`
    INSERT INTO storage_objects (
      id, artifact_uri, kind, content_type, hash, size_bytes, metadata_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(artifact_uri) DO UPDATE SET
      kind = excluded.kind,
      content_type = excluded.content_type,
      hash = excluded.hash,
      size_bytes = excluded.size_bytes,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);

  const insert = db.transaction((entries: GeneratedStorageObject[]) => {
    for (const entry of entries) {
      const metadata = {
        key: entry.key,
        ...(entry.modified_at ? { artifact_modified_at: entry.modified_at } : {}),
        ...(entry.metadata ?? {}),
      };
      statement.run(
        randomUUID(),
        entry.uri,
        entry.kind,
        entry.content_type ?? null,
        entry.hash ?? null,
        entry.size_bytes ?? null,
        JSON.stringify(metadata),
        timestamp,
        timestamp,
      );
    }
  });

  insert(objects);
}
