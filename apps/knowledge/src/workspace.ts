import { homedir } from 'node:os';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import {
  AnchoredFilesystemError,
  ensureAnchoredDirectory,
  writeAnchoredRegularFile,
} from './anchored-fs';
import {
  assertKnowledgeLocalRuntime,
  assertValidKnowledgeConfig,
  configContainmentError,
  readValidatedKnowledgeConfig,
} from './runtime-role';

export const HASNA_KNOWLEDGE_APP_PATH = join('.hasna', 'knowledge');
export const LEGACY_HASNA_KNOWLEDGE_APP_PATH = join('.hasna', 'apps', 'knowledge');

const CANONICAL_KNOWLEDGE_SCOPES = new Set(['global', 'local', 'project']);
export type CanonicalKnowledgeScope = 'global' | 'local' | 'project';

/**
 * Validate the public scope domain without trimming, folding, normalizing, or
 * accepting aliases. `undefined` is the sole default-global representation.
 */
export function canonicalKnowledgeScope(
  scope: unknown,
  defaultScope: CanonicalKnowledgeScope = 'global',
): CanonicalKnowledgeScope {
  const candidate = scope === undefined ? defaultScope : scope;
  if (typeof candidate !== 'string' || !CANONICAL_KNOWLEDGE_SCOPES.has(candidate)) {
    throw new Error('Invalid knowledge scope. Use exactly global, local, or project.');
  }
  return candidate as CanonicalKnowledgeScope;
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

export interface TrustedKnowledgeWorkspaceIdentity {
  readonly scope: CanonicalKnowledgeScope | null;
  readonly projectRoot: string | null;
  readonly home: string;
  readonly key: string;
}

const WORKSPACE_FIELDS = [
  'home',
  'configPath',
  'jsonStorePath',
  'knowledgeDbPath',
  'artifactsDir',
  'cacheDir',
  'exportsDir',
  'indexesDir',
  'logsDir',
  'runsDir',
  'schemasDir',
  'wikiDir',
] as const satisfies readonly (keyof KnowledgeWorkspace)[];

interface TrustedDirectoryIdentity {
  readonly dev: number;
  readonly ino: number;
}

interface TrustedWorkspaceState {
  readonly identity: TrustedKnowledgeWorkspaceIdentity;
  readonly projectRootIdentity: TrustedDirectoryIdentity | undefined;
  readonly authorityParentPath: string;
  readonly authorityParentIdentity: TrustedDirectoryIdentity;
  homeIdentity: TrustedDirectoryIdentity | undefined;
  revoked: boolean;
}

const trustedWorkspaceIdentities = new WeakMap<object, TrustedWorkspaceState>();

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function assertCanonicalAuthorityPath(path: string, label: string): string {
  if (
    typeof path !== 'string'
    || path.includes('\0')
    || !isAbsolute(path)
    || normalize(path) !== path
    || resolve(path) !== path
  ) {
    throw new Error(`${label} must be an absolute normalized canonical path.`);
  }
  if (path.normalize('NFC') !== path || path.normalize('NFKC') !== path) {
    throw new Error(`${label} must use an exact canonical Unicode path.`);
  }

  let existing = path;
  let stat;
  for (;;) {
    try {
      stat = lstatSync(existing);
      break;
    } catch (error) {
      if (errno(error) !== 'ENOENT') throw error;
      const parent = dirname(existing);
      if (parent === existing) throw new Error(`${label} has no canonical filesystem ancestor.`);
      existing = parent;
    }
  }
  if (stat.isSymbolicLink() || realpathSync.native(existing) !== existing) {
    throw new Error(`${label} must not use a symlink, case, or path alias.`);
  }
  return path;
}

function nearestCanonicalDirectoryIdentity(
  path: string,
  label: string,
): { path: string; identity: TrustedDirectoryIdentity } {
  assertCanonicalAuthorityPath(path, label);
  let existing = path;
  for (;;) {
    try {
      const stat = lstatSync(existing);
      if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync.native(existing) !== existing) {
        throw new Error(`${label} must have one exact canonical directory authority parent.`);
      }
      return {
        path: existing,
        identity: Object.freeze({ dev: stat.dev, ino: stat.ino }),
      };
    } catch (error) {
      if (errno(error) !== 'ENOENT') throw error;
      const parent = dirname(existing);
      if (parent === existing) throw new Error(`${label} has no canonical directory authority parent.`);
      existing = parent;
    }
  }
}

function canonicalExistingDirectory(path: string, label: string): string {
  const canonical = assertCanonicalAuthorityPath(path, label);
  const stat = lstatSync(canonical);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync.native(canonical) !== canonical) {
    throw new Error(`${label} must identify one exact canonical directory.`);
  }
  return canonical;
}

function existingDirectoryIdentity(
  path: string,
  label: string,
): TrustedDirectoryIdentity | undefined {
  assertCanonicalAuthorityPath(path, label);
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (errno(error) === 'ENOENT') return undefined;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync.native(path) !== path) {
    throw new Error(`${label} must identify one exact canonical directory.`);
  }
  return Object.freeze({ dev: stat.dev, ino: stat.ino });
}

function sameDirectoryIdentity(
  left: TrustedDirectoryIdentity,
  right: TrustedDirectoryIdentity,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function workspaceShape(canonicalHome: string): KnowledgeWorkspace {
  return {
    home: canonicalHome,
    configPath: join(canonicalHome, 'config.json'),
    jsonStorePath: join(canonicalHome, 'db.json'),
    knowledgeDbPath: join(canonicalHome, 'knowledge.db'),
    artifactsDir: join(canonicalHome, 'artifacts'),
    cacheDir: join(canonicalHome, 'cache'),
    exportsDir: join(canonicalHome, 'exports'),
    indexesDir: join(canonicalHome, 'indexes'),
    logsDir: join(canonicalHome, 'logs'),
    runsDir: join(canonicalHome, 'runs'),
    schemasDir: join(canonicalHome, 'schemas'),
    wikiDir: join(canonicalHome, 'wiki'),
  };
}

function trustedWorkspace(
  home: string,
  scope: CanonicalKnowledgeScope | null,
  projectRoot: string | null,
): KnowledgeWorkspace {
  const canonicalHome = assertCanonicalAuthorityPath(home, 'Knowledge workspace home');
  const workspace = Object.freeze(workspaceShape(canonicalHome));
  const identity = Object.freeze({
    scope,
    projectRoot,
    home: canonicalHome,
    key: `${scope ?? 'custom'}\0${projectRoot ?? ''}\0${canonicalHome}`,
  });
  const projectRootIdentity = projectRoot
    ? existingDirectoryIdentity(projectRoot, 'Knowledge project root')
    : undefined;
  if (projectRoot && !projectRootIdentity) {
    throw new Error('Knowledge project root must remain an existing canonical directory.');
  }
  const authorityParent = nearestCanonicalDirectoryIdentity(
    canonicalHome,
    'Knowledge workspace home',
  );
  trustedWorkspaceIdentities.set(workspace, {
    identity,
    projectRootIdentity,
    authorityParentPath: authorityParent.path,
    authorityParentIdentity: authorityParent.identity,
    homeIdentity: existingDirectoryIdentity(canonicalHome, 'Knowledge workspace home'),
    revoked: false,
  });
  return workspace;
}

export function trustedKnowledgeWorkspaceIdentity(
  workspace: KnowledgeWorkspace,
): TrustedKnowledgeWorkspaceIdentity {
  if (!workspace || typeof workspace !== 'object') {
    throw new Error('A trusted workspace identity is required.');
  }
  const state = trustedWorkspaceIdentities.get(workspace);
  if (!state || !Object.isFrozen(workspace)) {
    throw new Error('A trusted workspace identity from the canonical constructor is required.');
  }
  if (state.revoked) {
    throw new Error('Knowledge workspace identity was permanently invalidated.');
  }
  const { identity } = state;
  try {
    const expected = workspaceShape(identity.home);
    for (const field of WORKSPACE_FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(workspace, field);
      if (
        !descriptor
        || !('value' in descriptor)
        || descriptor.value !== expected[field]
        || descriptor.writable !== false
        || descriptor.configurable !== false
      ) {
        throw new Error('Trusted workspace identity fields changed after construction.');
      }
    }
    const currentAuthorityParent = existingDirectoryIdentity(
      state.authorityParentPath,
      'Knowledge workspace authority parent',
    );
    if (
      !currentAuthorityParent
      || !sameDirectoryIdentity(state.authorityParentIdentity, currentAuthorityParent)
    ) {
      throw new Error('Knowledge workspace canonical parent identity changed after construction.');
    }
    const currentHomeIdentity = existingDirectoryIdentity(
      identity.home,
      'Knowledge workspace home',
    );
    if (state.homeIdentity) {
      if (!currentHomeIdentity || !sameDirectoryIdentity(state.homeIdentity, currentHomeIdentity)) {
        throw new Error('Knowledge workspace directory identity changed after construction.');
      }
    } else if (currentHomeIdentity) {
      state.homeIdentity = currentHomeIdentity;
    }
    if (identity.projectRoot) {
      const currentProjectRootIdentity = existingDirectoryIdentity(
        identity.projectRoot,
        'Knowledge project root',
      );
      if (
        !state.projectRootIdentity
        || !currentProjectRootIdentity
        || !sameDirectoryIdentity(state.projectRootIdentity, currentProjectRootIdentity)
      ) {
        throw new Error('Knowledge project root identity changed after construction.');
      }
    }
    return identity;
  } catch (error) {
    state.revoked = true;
    throw error;
  }
}

export function assertKnowledgeWorkspaceScope(
  workspace: KnowledgeWorkspace,
  scope: CanonicalKnowledgeScope,
): TrustedKnowledgeWorkspaceIdentity {
  const identity = trustedKnowledgeWorkspaceIdentity(workspace);
  if (identity.scope !== scope) {
    throw new Error('Knowledge workspace identity does not match the requested scope.');
  }
  return identity;
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
  return join(homedir(), '.hasna', 'knowledge');
}

export function projectKnowledgeHome(cwd = process.cwd()): string {
  return resolve(cwd, HASNA_KNOWLEDGE_APP_PATH);
}

export function legacyGlobalKnowledgeHome(): string {
  return join(homedir(), LEGACY_HASNA_KNOWLEDGE_APP_PATH);
}

export function legacyProjectKnowledgeHome(cwd = process.cwd()): string {
  return resolve(cwd, LEGACY_HASNA_KNOWLEDGE_APP_PATH);
}

export function resolveLegacyScopedWorkspace(scope: string | undefined, cwd = process.cwd()): KnowledgeWorkspace {
  const canonicalScope = canonicalKnowledgeScope(scope);
  if (canonicalScope === 'project' || canonicalScope === 'local') {
    return workspaceForHome(legacyProjectKnowledgeHome(cwd));
  }
  return workspaceForHome(legacyGlobalKnowledgeHome());
}

export function workspaceForHome(home: string): KnowledgeWorkspace {
  return trustedWorkspace(home, null, null);
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
  return ensureTrustedKnowledgeWorkspace(workspace);
}

export function ensureTrustedKnowledgeWorkspace(workspace: KnowledgeWorkspace): KnowledgeWorkspace {
  trustedKnowledgeWorkspaceIdentity(workspace);
  const persisted = readValidatedKnowledgeConfig(workspace.configPath);
  const config = persisted
    ? persisted as unknown as KnowledgeConfig
    : defaultKnowledgeConfig();
  assertKnowledgeLocalRuntime({
    surface: 'public-api',
    env: {},
    configMode: config.mode,
  });
  if (!persisted) writeKnowledgeConfig(workspace.configPath, config);
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
    try {
      ensureAnchoredDirectory(dir);
    } catch (error) {
      if (error instanceof AnchoredFilesystemError) {
        throw configContainmentError(`workspace directory containment failed: ${error.message}`);
      }
      throw error;
    }
  }
  trustedKnowledgeWorkspaceIdentity(workspace);
  return workspace;
}

export function resolveScopedWorkspace(scope: string | undefined, cwd = process.cwd()): KnowledgeWorkspace {
  const canonicalScope = canonicalKnowledgeScope(scope);
  if (canonicalScope === 'project' || canonicalScope === 'local') {
    const projectRoot = canonicalExistingDirectory(cwd, 'Knowledge project root');
    return trustedWorkspace(projectKnowledgeHome(projectRoot), canonicalScope, projectRoot);
  }
  return trustedWorkspace(join(homedir(), '.hasna', 'knowledge'), canonicalScope, null);
}

export function ensureParentDir(path: string): void {
  try {
    ensureAnchoredDirectory(dirname(path));
  } catch (error) {
    if (error instanceof AnchoredFilesystemError) {
      throw configContainmentError(`parent directory containment failed: ${error.message}`);
    }
    throw error;
  }
}

function trustedConfigPath(path: string): { path: string; home: string; hasnaDir: string; root: string } {
  if (!isAbsolute(path) || normalize(path) !== path || resolve(path) !== path) {
    throw configContainmentError('config path must be absolute and traversal-free');
  }
  if (basename(path) !== 'config.json') {
    throw configContainmentError('config filename must be config.json');
  }
  const home = dirname(path);
  if (basename(home) !== 'knowledge') {
    throw configContainmentError('config must be inside a Knowledge workspace');
  }
  const parent = dirname(home);
  const hasnaDir = basename(parent) === '.hasna'
    ? parent
    : basename(parent) === 'apps' && basename(dirname(parent)) === '.hasna'
      ? dirname(parent)
      : '';
  if (!hasnaDir) throw configContainmentError('config must be inside a trusted .hasna workspace');
  const root = dirname(hasnaDir);
  return { path, home, hasnaDir, root };
}

function ensureTrustedConfigHome(info: ReturnType<typeof trustedConfigPath>): void {
  try {
    ensureAnchoredDirectory(info.home);
  } catch (error) {
    if (error instanceof AnchoredFilesystemError) {
      throw configContainmentError(`config parent containment failed: ${error.message}`);
    }
    throw error;
  }
}

export function readKnowledgeConfig(path: string): KnowledgeConfig {
  trustedConfigPath(path);
  const config = readValidatedKnowledgeConfig(path);
  if (!config) throw configContainmentError('config does not exist');
  return config as unknown as KnowledgeConfig;
}

export function writeKnowledgeConfig(path: string, config: KnowledgeConfig): void {
  assertValidKnowledgeConfig(config);
  assertKnowledgeLocalRuntime({
    surface: 'public-api',
    env: {},
    configMode: config.mode,
    hostedRequested: config.storage.type === 's3',
  });
  const info = trustedConfigPath(path);
  const current = readValidatedKnowledgeConfig(path);
  if (current) {
    assertKnowledgeLocalRuntime({
      surface: 'public-api',
      env: {},
      configMode: current.mode as string,
      hostedRequested: (current.storage as { type?: string }).type === 's3',
    });
  }
  ensureTrustedConfigHome(info);
  try {
    writeAnchoredRegularFile(path, `${JSON.stringify(config, null, 2)}\n`);
  } catch (error) {
    if (error instanceof AnchoredFilesystemError) {
      throw configContainmentError(`atomic anchored config write failed: ${error.message}`);
    }
    throw error;
  }
}
