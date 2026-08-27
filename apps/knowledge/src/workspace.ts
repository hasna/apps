import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { getDataHome } from './paths';

export const HASNA_KNOWLEDGE_APP_PATH = join('.hasna', 'knowledge');
export const LEGACY_HASNA_KNOWLEDGE_APP_PATH = join('.hasna', 'apps', 'knowledge');

/**
 * Stable, unique key for a project-scoped knowledge workspace derived from the
 * project's resolved cwd. The full absolute path is slugified so two repos with
 * the same basename never collide, and the key is deterministic for the same
 * checkout path across runs and machines.
 */
export function projectKey(cwd = process.cwd()): string {
  const slugified = resolve(cwd)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slugified || 'project';
}

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

export const EXAMPLE_KNOWLEDGE_CANONICAL = {
  division: 'xyz',
  app_type: 'opensource',
  app: 'knowledge',
  env: 'prod',
  local_path: HASNA_KNOWLEDGE_APP_PATH,
  s3: {
    bucket: 'example-knowledge-prod',
    region: 'us-east-1',
    profile: 'example-infra',
    prefix: '.hasna/knowledge',
    server_side_encryption: 'AES256',
  },
  secrets: {
    env: 'example/knowledge/prod/env',
    aws: 'example/knowledge/prod/aws',
    s3: 'example/knowledge/prod/s3',
    rds: null,
    future_rds: 'example/knowledge/prod/rds',
  },
  source_owner: 'open-files',
  evidence_doc: 'docs/canonical-secrets-bootstrap-2026-06-08.md',
} as const;

export function canonicalExampleKnowledgeStorage(): KnowledgeConfig['storage'] {
  return {
    type: 's3',
    artifacts_root: 'artifacts',
    s3: {
      bucket: EXAMPLE_KNOWLEDGE_CANONICAL.s3.bucket,
      prefix: EXAMPLE_KNOWLEDGE_CANONICAL.s3.prefix,
      region: EXAMPLE_KNOWLEDGE_CANONICAL.s3.region,
      profile: EXAMPLE_KNOWLEDGE_CANONICAL.s3.profile,
      server_side_encryption: EXAMPLE_KNOWLEDGE_CANONICAL.s3.server_side_encryption,
    },
  };
}

export function legacyGlobalStorePath(): string {
  return join(homedir(), '.open-knowledge', 'db.json');
}

export function globalKnowledgeHome(): string {
  return getDataHome();
}

/**
 * The canonical project-scoped knowledge home: <knowledge-home>/projects/<key>.
 * Project-scoped stores live in a per-project sub-root of the knowledge app's
 * own home (the effective data home resolved through @hasna/paths — legacy
 * `~/.hasna/knowledge` until the XDG data home is adopted) rather than inside
 * the checked-out repository. An explicit `home` base (used by tests to inject
 * an isolated home) keeps the legacy `~/.hasna/knowledge/projects/<key>`
 * construction; production callers use the resolver-resolved knowledge home.
 */
export function projectKnowledgeHome(cwd = process.cwd(), home: string | undefined = undefined): string {
  const knowledgeRoot = home === undefined ? globalKnowledgeHome() : join(home, '.hasna', 'knowledge');
  return join(knowledgeRoot, 'projects', projectKey(cwd));
}

/**
 * The previous project-scoped knowledge home: <cwd>/.hasna/knowledge. This is
 * the pre-canonical default that a one-time migration moves into
 * ~/.hasna/knowledge/projects/<key>.
 */
export function previousProjectKnowledgeHome(cwd = process.cwd()): string {
  return resolve(cwd, HASNA_KNOWLEDGE_APP_PATH);
}

export function legacyGlobalKnowledgeHome(): string {
  return join(homedir(), LEGACY_HASNA_KNOWLEDGE_APP_PATH);
}

export function legacyProjectKnowledgeHome(cwd = process.cwd()): string {
  return resolve(cwd, LEGACY_HASNA_KNOWLEDGE_APP_PATH);
}

export function resolveLegacyScopedWorkspace(scope: string | undefined, cwd = process.cwd()): KnowledgeWorkspace {
  if (scope === 'project' || scope === 'local') {
    return workspaceForHome(legacyProjectKnowledgeHome(cwd));
  }
  return workspaceForHome(legacyGlobalKnowledgeHome());
}

export function workspaceForHome(home: string): KnowledgeWorkspace {
  return {
    home,
    configPath: join(home, 'config.json'),
    jsonStorePath: join(home, 'db.json'),
    knowledgeDbPath: join(home, 'knowledge.db'),
    artifactsDir: join(home, 'artifacts'),
    cacheDir: join(home, 'cache'),
    exportsDir: join(home, 'exports'),
    indexesDir: join(home, 'indexes'),
    logsDir: join(home, 'logs'),
    runsDir: join(home, 'runs'),
    schemasDir: join(home, 'schemas'),
    wikiDir: join(home, 'wiki'),
  };
}

export function defaultKnowledgeConfig(): KnowledgeConfig {
  return {
    version: 1,
    storage: {
      type: 'local',
      artifacts_root: 'artifacts',
    },
    sources: {
      preferred_ref: 'open-files',
      allowed_schemes: ['open-files', 's3', 'file', 'https', 'http'],
    },
    providers: {
      default_model: 'openai:gpt-5.2',
      aliases: {
        fast: 'openai:gpt-5-mini',
        reasoning: 'anthropic:claude-opus-4-6',
        sonnet: 'anthropic:claude-sonnet-4-6',
        deepseek: 'deepseek:deepseek-chat',
        'deepseek-reasoning': 'deepseek:deepseek-reasoner',
      },
      openai: {
        api_key_env: 'OPENAI_API_KEY',
        default_model: 'gpt-5.2',
      },
      anthropic: {
        api_key_env: 'ANTHROPIC_API_KEY',
        default_model: 'claude-sonnet-4-6',
      },
      deepseek: {
        api_key_env: 'DEEPSEEK_API_KEY',
        default_model: 'deepseek-chat',
      },
    },
    embeddings: {
      default_model: 'openai:text-embedding-3-small',
      dimensions: 1536,
      batch_size: 64,
      max_parallel_calls: 4,
    },
    safety: {
      network: {
        web_search_enabled: false,
        s3_reads_enabled: false,
        allowed_s3_buckets: [],
      },
      redaction: {
        enabled: true,
      },
      approvals: {
        generated_writes_require_approval: true,
      },
    },
  };
}

export function ensureKnowledgeWorkspace(home: string): KnowledgeWorkspace {
  const workspace = workspaceForHome(home);
  mkdirSync(workspace.home, { recursive: true, mode: 0o700 });
  for (const dir of [
    workspace.artifactsDir,
    workspace.cacheDir,
    workspace.exportsDir,
    workspace.indexesDir,
    workspace.logsDir,
    workspace.runsDir,
    workspace.schemasDir,
    workspace.wikiDir,
  ]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  if (!existsSync(workspace.configPath)) {
    writeFileSync(workspace.configPath, `${JSON.stringify(defaultKnowledgeConfig(), null, 2)}\n`, { mode: 0o600 });
    chmodSync(workspace.configPath, 0o600);
  }
  return workspace;
}

export function resolveScopedWorkspace(scope: string | undefined, cwd = process.cwd()): KnowledgeWorkspace {
  if (scope === 'project' || scope === 'local') {
    return workspaceForHome(projectKnowledgeHome(cwd));
  }
  return workspaceForHome(globalKnowledgeHome());
}

export function ensureParentDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export function readKnowledgeConfig(path: string): KnowledgeConfig {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as KnowledgeConfig & {
    mode?: unknown;
    hosted?: unknown;
  };
  const { mode: _retiredMode, hosted: _retiredHostedConfig, ...config } = parsed;
  return config;
}

export function writeKnowledgeConfig(path: string, config: KnowledgeConfig): void {
  ensureParentDir(path);
  const { mode: _retiredMode, hosted: _retiredHostedConfig, ...sanitized } = config as KnowledgeConfig & {
    mode?: unknown;
    hosted?: unknown;
  };
  writeFileSync(path, `${JSON.stringify(sanitized, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}
