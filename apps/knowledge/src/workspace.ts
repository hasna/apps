import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const HASNA_KNOWLEDGE_APP_PATH = join('.hasna', 'knowledge');
export const LEGACY_HASNA_KNOWLEDGE_APP_PATH = join('.hasna', 'apps', 'knowledge');

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

export const HASNA_XYZ_KNOWLEDGE_CANONICAL = {
  division: 'xyz',
  app_type: 'opensource',
  app: 'knowledge',
  env: 'prod',
  local_path: HASNA_KNOWLEDGE_APP_PATH,
  s3: {
    bucket: 'hasna-xyz-opensource-knowledge-prod',
    region: 'us-east-1',
    profile: 'hasna-xyz-infra',
    prefix: '.hasna/knowledge',
    server_side_encryption: 'AES256',
  },
  secrets: {
    env: 'hasna/xyz/opensource/knowledge/prod/env',
    aws: 'hasna/xyz/opensource/knowledge/prod/aws',
    s3: 'hasna/xyz/opensource/knowledge/prod/s3',
    rds: null,
    future_rds: 'hasna/xyz/opensource/knowledge/prod/rds',
  },
  source_owner: 'open-files',
  evidence_doc: 'docs/canonical-secrets-bootstrap-2026-06-08.md',
} as const;

export function canonicalHasnaXyzKnowledgeStorage(): KnowledgeConfig['storage'] {
  return {
    type: 's3',
    artifacts_root: 'artifacts',
    s3: {
      bucket: HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.bucket,
      prefix: HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.prefix,
      region: HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.region,
      profile: HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.profile,
      server_side_encryption: HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.server_side_encryption,
    },
  };
}

export function legacyGlobalStorePath(): string {
  return join(homedir(), '.open-knowledge', 'db.json');
}

export function globalKnowledgeHome(): string {
  return join(homedir(), '.hasna', 'knowledge');
}

export function legacyGlobalKnowledgeHome(): string {
  return join(homedir(), '.hasna', 'apps', 'knowledge');
}

export function projectKnowledgeHome(cwd = process.cwd()): string {
  return resolve(cwd, HASNA_KNOWLEDGE_APP_PATH);
}

export function legacyProjectKnowledgeHome(cwd = process.cwd()): string {
  return resolve(cwd, LEGACY_HASNA_KNOWLEDGE_APP_PATH);
}

export function legacyKnowledgeHomeForScope(scope: string | undefined, cwd = process.cwd()): string {
  if (scope === 'project' || scope === 'local') return legacyProjectKnowledgeHome(cwd);
  return legacyGlobalKnowledgeHome();
}

export function workspaceForHome(home: string): KnowledgeWorkspace {
  const normalizedHome = normalizeWorkspaceHome(home);
  return {
    home: normalizedHome,
    configPath: join(normalizedHome, 'config.json'),
    jsonStorePath: join(normalizedHome, 'db.json'),
    knowledgeDbPath: join(normalizedHome, 'knowledge.db'),
    artifactsDir: join(normalizedHome, 'artifacts'),
    cacheDir: join(normalizedHome, 'cache'),
    exportsDir: join(normalizedHome, 'exports'),
    indexesDir: join(normalizedHome, 'indexes'),
    logsDir: join(normalizedHome, 'logs'),
    runsDir: join(normalizedHome, 'runs'),
    schemasDir: join(normalizedHome, 'schemas'),
    wikiDir: join(normalizedHome, 'wiki'),
  };
}

function normalizeWorkspaceHome(home: string): string {
  const resolved = resolve(home);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function pathIsInside(parent: string, target: string): boolean {
  const rel = relative(resolve(parent), resolve(target));
  return rel === '' || (!rel.startsWith('..') && rel !== '..' && !rel.startsWith(`..${sep}`));
}

function pathHasKnowledgeAppSegment(target: string): boolean {
  const normalized = resolve(target).split(sep).join('/');
  return normalized.endsWith('/.hasna/knowledge')
    || normalized.includes('/.hasna/knowledge/')
    || normalized.endsWith('/.hasna/apps/knowledge')
    || normalized.includes('/.hasna/apps/knowledge/');
}

export function assertKnowledgeWritePathAllowed(
  targetPath: string,
  workspace: KnowledgeWorkspace,
  options: { allowJsonStore?: boolean; operation?: string } = {},
): void {
  const resolvedTarget = resolve(targetPath);
  const allowedJsonStore = options.allowJsonStore === true && resolvedTarget === resolve(workspace.jsonStorePath);
  if (allowedJsonStore) return;
  if (pathIsInside(workspace.home, resolvedTarget) || pathHasKnowledgeAppSegment(resolvedTarget)) {
    const operation = options.operation ?? 'write';
    throw new Error(
      `Refusing ${operation} inside protected knowledge workspace: ${targetPath}. ` +
      'Use the knowledge CLI/MCP/SDK storage and wiki commands instead of direct file writes.',
    );
  }
}

export function defaultKnowledgeConfig(): KnowledgeConfig {
  return {
    version: 1,
    mode: 'local',
    hosted: {
      api_url: 'https://knowledge.hasna.xyz',
    },
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
  mkdirSync(workspace.home, { recursive: true });
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
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(workspace.configPath)) {
    writeFileSync(workspace.configPath, `${JSON.stringify(defaultKnowledgeConfig(), null, 2)}\n`);
  }
  return workspace;
}

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

export function migrateLegacyKnowledgeWorkspace(
  options: { scope?: string; cwd?: string; dryRun?: boolean } = {},
): LegacyKnowledgeWorkspaceMigrationResult {
  const source = legacyKnowledgeHomeForScope(options.scope, options.cwd);
  const target = resolveScopedWorkspace(options.scope, options.cwd).home;
  const sourceExists = existsSync(source);
  const targetExists = existsSync(target);
  const dryRun = options.dryRun === true;

  if (!sourceExists) {
    return {
      ok: true,
      migrated: false,
      dry_run: dryRun,
      source,
      target,
      source_exists: false,
      target_exists: targetExists,
      message: `No legacy knowledge workspace found at ${source}`,
    };
  }
  if (targetExists) {
    return {
      ok: true,
      migrated: false,
      dry_run: dryRun,
      source,
      target,
      source_exists: true,
      target_exists: true,
      message: `Canonical knowledge workspace already exists at ${target}`,
    };
  }
  if (!dryRun) {
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true, errorOnExist: true });
  }
  return {
    ok: true,
    migrated: !dryRun,
    dry_run: dryRun,
    source,
    target,
    source_exists: true,
    target_exists: !dryRun ? true : false,
    message: dryRun
      ? `Would copy legacy knowledge workspace from ${source} to ${target}`
      : `Copied legacy knowledge workspace from ${source} to ${target}`,
  };
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
  return JSON.parse(raw) as KnowledgeConfig;
}

export function writeKnowledgeConfig(path: string, config: KnowledgeConfig): void {
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}
