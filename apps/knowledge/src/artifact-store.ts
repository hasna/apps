import { basename, dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  AnchoredArtifactDirectory,
  AnchoredFilesystemError,
  readAnchoredRegularFileSnapshot,
  type AnchoredIdentity,
} from './anchored-fs';
import {
  trustedKnowledgeWorkspaceIdentity,
  type KnowledgeConfig,
  type KnowledgeWorkspace,
  type TrustedKnowledgeWorkspaceIdentity,
} from './workspace';
import {
  assertKnowledgeLocalRuntime,
  assertKnowledgeLocalRuntimeWithConfig,
  assertValidKnowledgeConfig,
  configContainmentError,
  readKnowledgeConfiguredMode,
  type KnowledgeRuntimeEnv,
  type KnowledgeRuntimeSurface,
} from './runtime-role';

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

interface ArtifactStoreRuntimeBoundary {
  env?: KnowledgeRuntimeEnv;
  surface?: KnowledgeRuntimeSurface;
  readConfigMode?: () => string | undefined;
  requireConfig?: boolean;
  /** Explicit normalized absolute path whose inode is the local authority. */
  configPath?: string;
}

interface LocalArtifactState {
  readonly boundary: ArtifactStoreRuntimeBoundary;
  readonly readConfigMode: (() => string | undefined) | undefined;
  readonly configPath: string | undefined;
  readonly configBaseline: ConfigFingerprint | undefined;
  readonly artifacts: AnchoredArtifactDirectory;
}

const localArtifactStates = new WeakMap<object, LocalArtifactState>();
const artifactStoreWorkspaceIdentities = new WeakMap<object, TrustedKnowledgeWorkspaceIdentity>();

function localArtifactState(store: object): LocalArtifactState {
  const state = localArtifactStates.get(store);
  if (!state) throw configContainmentError('local artifact authority is unavailable');
  return state;
}

export function assertArtifactStoreMatchesWorkspace(
  store: ArtifactStore,
  workspace: KnowledgeWorkspace,
): void {
  if (!store || typeof store !== 'object') {
    throw new Error('A trusted artifact store from the owning workspace is required.');
  }
  const storeIdentity = artifactStoreWorkspaceIdentities.get(store);
  const workspaceIdentity = trustedKnowledgeWorkspaceIdentity(workspace);
  if (
    !storeIdentity
    || !Object.isFrozen(store)
    || storeIdentity.key !== workspaceIdentity.key
    || storeIdentity.home !== workspaceIdentity.home
    || storeIdentity.scope !== workspaceIdentity.scope
    || storeIdentity.projectRoot !== workspaceIdentity.projectRoot
  ) {
    throw new Error('Trusted artifact store identity does not match the workspace identity.');
  }
}

export function normalizeArtifactKey(key: string): string {
  const raw = key.replace(/\\/g, '/').trim();
  if (!raw || raw.startsWith('/')) {
    throw new Error('Invalid artifact key.');
  }
  const segments = raw.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Invalid artifact key.');
  }
  return segments.join('/');
}

interface ConfigFingerprint {
  readonly identity: AnchoredIdentity;
  readonly hash: string;
  readonly mode: string;
}

function readConfigFingerprint(
  configPath: string,
  surface: KnowledgeRuntimeSurface,
): ConfigFingerprint | undefined {
  try {
    const snapshot = readAnchoredRegularFileSnapshot(configPath);
    if (!snapshot) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(snapshot.content);
    } catch {
      throw configContainmentError('config JSON is malformed', surface);
    }
    assertValidKnowledgeConfig(parsed, surface);
    const config = parsed as { mode: string; storage: { type: string } };
    return {
      identity: snapshot.identity,
      hash: createHash('sha256').update(snapshot.content).digest('hex'),
      mode: config.storage.type === 's3' ? 'hosted' : config.mode,
    };
  } catch (error) {
    if (error instanceof AnchoredFilesystemError) {
      throw configContainmentError(`config anchoring failed: ${error.message}`, surface);
    }
    throw error;
  }
}

function sameConfigFingerprint(
  expected: ConfigFingerprint,
  current: ConfigFingerprint | undefined,
): boolean {
  return Boolean(
    current
    && current.identity.dev === expected.identity.dev
    && current.identity.ino === expected.identity.ino
    && current.identity.mode === expected.identity.mode
    && current.hash === expected.hash,
  );
}

export class LocalArtifactStore implements ArtifactStore {
  private readonly root: string;
  readonly type = 'local' as const;
  readonly canRead = true;
  readonly canWrite = true;

  constructor(root: string) {
    assertKnowledgeLocalRuntime({ surface: 'public-api', env: process.env });
    const boundary = (arguments as unknown as {
      1?: ArtifactStoreRuntimeBoundary;
    })[1] ?? {};
    if (boundary.requireConfig === true && boundary.configPath === undefined) {
      throw configContainmentError(
        'local artifact authority requires an explicit trusted config path',
        boundary.surface ?? 'public-api',
      );
    }
    if (boundary.configPath !== undefined && (
      !isAbsolute(boundary.configPath)
      || normalize(boundary.configPath) !== boundary.configPath
      || resolve(boundary.configPath) !== boundary.configPath
      || basename(boundary.configPath) !== 'config.json'
    )) {
      throw configContainmentError(
        'local artifact authority config path must be an absolute normalized config.json path',
        boundary.surface ?? 'public-api',
      );
    }
    this.root = root;
    const configPath = boundary.configPath ?? (
      basename(root) === 'artifacts' ? join(dirname(root), 'config.json') : undefined
    );
    const intent = {
      surface: boundary.surface ?? 'public-api',
      env: boundary.env ?? process.env,
    } as const;
    assertKnowledgeLocalRuntime(intent);
    const configBaseline = configPath
      ? readConfigFingerprint(configPath, boundary.surface ?? 'public-api')
      : undefined;
    if (boundary.requireConfig === true && !configBaseline) {
      throw configContainmentError(
        'local artifact authority requires a current trusted config',
        boundary.surface ?? 'public-api',
      );
    }
    const readConfigMode = boundary.readConfigMode;
    assertLocalArtifactRuntime({
      boundary,
      readConfigMode,
      configPath,
      configBaseline,
      artifacts: undefined as never,
    });
    let artifacts: AnchoredArtifactDirectory;
    try {
      artifacts = new AnchoredArtifactDirectory(root);
    } catch (error) {
      localArtifactFilesystemError(error, boundary);
    }
    localArtifactStates.set(this, {
      boundary,
      readConfigMode,
      configPath,
      configBaseline,
      artifacts,
    });
  }

  async put(entry: ArtifactWrite): Promise<ArtifactWriteResult> {
    const state = localArtifactState(this);
    assertLocalArtifactRuntime(state);
    const key = normalizeArtifactKey(entry.key);
    const result = withLocalArtifactAnchor(state, () => state.artifacts.put(key, entry.body));
    return {
      key,
      uri: pathToFileURL(join(this.root, key)).href,
      modified_at: result.modifiedAt.toISOString(),
    };
  }

  async getText(key: string): Promise<string> {
    const state = localArtifactState(this);
    assertLocalArtifactRuntime(state);
    const normalizedKey = normalizeArtifactKey(key);
    return withLocalArtifactAnchor(state, () => state.artifacts.read(normalizedKey));
  }

  async exists(key: string): Promise<boolean> {
    const state = localArtifactState(this);
    assertLocalArtifactRuntime(state);
    const normalizedKey = normalizeArtifactKey(key);
    return withLocalArtifactAnchor(state, () => state.artifacts.exists(normalizedKey));
  }
}

function localArtifactFilesystemError(
  error: unknown,
  boundary: ArtifactStoreRuntimeBoundary,
): never {
  if (error instanceof AnchoredFilesystemError) {
    throw configContainmentError(
      'local artifact filesystem containment failed',
      boundary.surface ?? 'public-api',
    );
  }
  throw error;
}

function withLocalArtifactAnchor<T>(state: LocalArtifactState, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    return localArtifactFilesystemError(error, state.boundary);
  }
}

function assertLocalArtifactRuntime(state: LocalArtifactState): void {
  const intent = {
    surface: state.boundary.surface ?? 'public-api',
    env: state.boundary.env ?? process.env,
  } as const;
  assertKnowledgeLocalRuntime(intent);
  if (state.configPath) {
    const current = readConfigFingerprint(state.configPath, intent.surface);
    if (state.configBaseline && !sameConfigFingerprint(state.configBaseline, current)) {
      throw configContainmentError(
        'local artifact authority was revoked because its trusted config was deleted or replaced',
        intent.surface,
      );
    }
    if (current) {
      assertKnowledgeLocalRuntime({ ...intent, configMode: current.mode });
    } else if (state.boundary.requireConfig) {
      throw configContainmentError('local artifact authority requires a current trusted config', intent.surface);
    }
  }
  if (state.readConfigMode) {
    assertKnowledgeLocalRuntimeWithConfig(intent, state.readConfigMode);
  }
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

export class S3ArtifactStore implements ArtifactStore {
  declare private readonly options: S3ArtifactStoreOptions;
  readonly type = 's3' as const;
  readonly canRead = true;
  readonly canWrite = true;
  declare private client?: S3ClientLike;
  constructor(options: S3ArtifactStoreOptions) {
    containedS3ArtifactStore();
  }

  private async getClient(): Promise<S3ClientLike> { return containedS3ArtifactStore(); }
  private objectKey(key: string): string { return containedS3ArtifactStore(); }

  async put(entry: ArtifactWrite): Promise<ArtifactWriteResult> { return containedS3ArtifactStore(); }
  async getText(key: string): Promise<string> { return containedS3ArtifactStore(); }
  async exists(key: string): Promise<boolean> { return containedS3ArtifactStore(); }
}

function containedS3ArtifactStore(): never {
  return assertKnowledgeLocalRuntime({
    surface: 'public-api',
    env: {},
    hostedRequested: true,
  }) as never;
}

Object.freeze(LocalArtifactStore.prototype);
Object.freeze(S3ArtifactStore.prototype);

export function createArtifactStore(
  config: KnowledgeConfig,
  workspace: KnowledgeWorkspace,
): ArtifactStore {
  const boundary = (arguments as unknown as { 2?: ArtifactStoreRuntimeBoundary })[2] ?? {};
  const surface = boundary.surface ?? 'public-api';
  const env = boundary.env ?? process.env;
  // Reject hosted runtime intent before inspecting caller-supplied config.
  assertKnowledgeLocalRuntime({ surface, env });
  assertValidKnowledgeConfig(config, surface);
  const workspaceIdentity = trustedKnowledgeWorkspaceIdentity(workspace);
  const readConfigMode = boundary.readConfigMode
    ?? (() => readKnowledgeConfiguredMode(
      workspace.configPath,
      undefined,
      boundary.requireConfig ?? false,
    ));
  assertKnowledgeLocalRuntimeWithConfig({
    surface,
    env,
    configMode: config.mode,
    hostedRequested: config.storage.type === 's3',
  }, readConfigMode);
  if (config.storage.type === 's3') {
    return new S3ArtifactStore(config.storage.s3 as S3ArtifactStoreOptions);
  }
  const store = new (LocalArtifactStore as unknown as {
    new(root: string, boundary: ArtifactStoreRuntimeBoundary): LocalArtifactStore;
  })(workspace.artifactsDir, {
    ...boundary,
    configPath: boundary.configPath ?? workspace.configPath,
    readConfigMode,
  });
  artifactStoreWorkspaceIdentities.set(store, workspaceIdentity);
  Object.freeze(store);
  return store;
}
