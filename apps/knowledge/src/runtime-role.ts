import { existsSync, readFileSync } from 'node:fs';
import { isProxy } from 'node:util/types';
import {
  AnchoredFilesystemError,
  readAnchoredRegularFileSnapshot,
} from './anchored-fs';
import { cloneBoundedDataGraph } from './input-limits';

export type KnowledgeRuntimeSurface =
  | 'cli'
  | 'sdk'
  | 'mcp-stdio'
  | 'mcp-http'
  | 'server'
  | 'operator-migration'
  | 'public-api';

export type KnowledgeRuntimeRole =
  | 'local'
  | 'hosted-client'
  | 'hosted-server'
  | 'operator-migration'
  | 'invalid';

export type KnowledgeContainmentCode =
  | 'KNOWLEDGE_RUNTIME_INTENT_INVALID'
  | 'KNOWLEDGE_CONFIG_INVALID'
  | 'KNOWLEDGE_HOSTED_CONTAINED'
  | 'KNOWLEDGE_AUTHORITY_UNAVAILABLE'
  | 'KNOWLEDGE_PROJECT_FORBIDDEN'
  | 'KNOWLEDGE_POSITIVE_AUTHORITY_DISABLED'
  | 'KNOWLEDGE_OPERATOR_REQUIRED';

export type KnowledgeRuntimeEnv = Record<string, string | undefined>;

export interface KnowledgeRoleFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf8'): string;
}

const roleFs: KnowledgeRoleFs = {
  existsSync,
  readFileSync,
};

const INVALID_CONFIG_MODE = '__invalid_config__';

type ConfigRecord = Record<string, unknown>;

const MAX_CONFIG_ARRAY_ITEMS = 4_096;
const MAX_CONFIG_PROPERTIES = 4_096;
const MAX_CONFIG_NODES = 2_048;
const MAX_CONFIG_BYTES = 1_048_576;

function configGraphIssue(root: unknown): string | null {
  const seen = new WeakSet<object>();
  const pending: unknown[] = [root];
  let nodes = 0;
  let properties = 0;
  let bytes = 0;
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === 'string') {
      bytes += Buffer.byteLength(value);
      if (bytes > MAX_CONFIG_BYTES) return 'config exceeds the aggregate byte limit';
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    if (isProxy(value)) return 'config proxy inputs are unsupported';
    if (seen.has(value)) continue;
    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      return 'config prototype could not be inspected safely';
    }
    if (
      (Array.isArray(value) && prototype !== Array.prototype)
      || (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
    ) {
      return 'config custom prototypes are unsupported';
    }
    if (++nodes > MAX_CONFIG_NODES) return 'config exceeds the aggregate node limit';
    seen.add(value);
    if (Array.isArray(value) && value.length > MAX_CONFIG_ARRAY_ITEMS) {
      return 'config array exceeds the aggregate item limit';
    }
    let keys: (string | symbol)[];
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      return 'config properties could not be enumerated safely';
    }
    properties += keys.length;
    if (properties > MAX_CONFIG_PROPERTIES) return 'config exceeds the aggregate property limit';
    for (const key of keys) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        return 'config property descriptors could not be inspected safely';
      }
      if (!descriptor || !('value' in descriptor)) return 'config accessor properties are unsupported';
      pending.push(descriptor.value);
    }
  }
  return null;
}

function configRecord(value: unknown): ConfigRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ConfigRecord
    : undefined;
}

function safeRelativePath(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value.includes('\0')
    || value.startsWith('/')
    || value.startsWith('\\')
    || /^[A-Za-z]:[\\/]/.test(value)
  ) {
    return false;
  }
  const segments = value.replace(/\\/g, '/').split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function optionalStringIssue(
  record: ConfigRecord,
  key: string,
  label: string,
  allowEmpty = false,
): string | null {
  const value = record[key];
  if (value === undefined) return null;
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    return `${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'} when present`;
  }
  return null;
}

function optionalBooleanIssue(record: ConfigRecord, key: string, label: string): string | null {
  const value = record[key];
  return value === undefined || typeof value === 'boolean'
    ? null
    : `${label} must be a boolean when present`;
}

function optionalPositiveIntegerIssue(record: ConfigRecord, key: string, label: string): string | null {
  const value = record[key];
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value > 0)
    ? null
    : `${label} must be a positive integer when present`;
}

/** Validate every required persisted-config field before any workspace side effect. */
export function knowledgeConfigValidationIssue(value: unknown): string | null {
  let cloned: unknown;
  try {
    cloned = cloneBoundedDataGraph(value, {
      label: 'config',
      maxBytes: MAX_CONFIG_BYTES,
    });
  } catch (error) {
    return error instanceof Error ? error.message : 'config could not be cloned safely';
  }
  const graphIssue = configGraphIssue(cloned);
  if (graphIssue) return graphIssue;
  const config = configRecord(cloned);
  if (!config) return 'config root must be an object';
  if (config.version !== 1) return 'config version must be 1';
  if (config.mode !== 'local' && config.mode !== 'hosted') {
    return 'config mode must be exactly local or hosted';
  }

  const storage = configRecord(config.storage);
  if (!storage) return 'config storage must be an object';
  if (storage.type !== 'local' && storage.type !== 's3') {
    return 'config storage.type must be local or s3';
  }
  if (config.mode === 'local' && storage.type === 's3') {
    return 'config mode local must not select S3 storage';
  }
  if (!safeRelativePath(storage.artifacts_root)) {
    return 'config storage.artifacts_root must be a safe relative path';
  }
  if (storage.type === 's3') {
    const s3 = configRecord(storage.s3);
    if (!s3 || typeof s3.bucket !== 'string' || !s3.bucket.trim()) {
      return 'config S3 storage requires a non-empty bucket';
    }
  }
  if (storage.type === 'local' && storage.s3 !== undefined) {
    return 'config local storage must not include storage.s3';
  }
  if (storage.s3 !== undefined) {
    const s3 = configRecord(storage.s3);
    if (!s3) return 'config storage.s3 must be an object when present';
    for (const [key, label, allowEmpty] of [
      ['bucket', 'config storage.s3.bucket', false],
      ['prefix', 'config storage.s3.prefix', true],
      ['region', 'config storage.s3.region', false],
      ['profile', 'config storage.s3.profile', false],
      ['kms_key_id', 'config storage.s3.kms_key_id', false],
    ] as const) {
      const issue = optionalStringIssue(s3, key, label, allowEmpty);
      if (issue) return issue;
    }
    const attemptsIssue = optionalPositiveIntegerIssue(
      s3,
      'max_attempts',
      'config storage.s3.max_attempts',
    );
    if (attemptsIssue) return attemptsIssue;
    if (
      s3.server_side_encryption !== undefined
      && s3.server_side_encryption !== 'AES256'
      && s3.server_side_encryption !== 'aws:kms'
    ) {
      return 'config storage.s3.server_side_encryption must be AES256 or aws:kms when present';
    }
  }

  const sources = configRecord(config.sources);
  if (!sources || sources.preferred_ref !== 'open-files') {
    return 'config sources.preferred_ref must be open-files';
  }
  if (
    !Array.isArray(sources.allowed_schemes)
    || sources.allowed_schemes.some((entry) => typeof entry !== 'string' || !entry.trim())
  ) {
    return 'config sources.allowed_schemes must be an array of non-empty strings';
  }

  for (const key of ['hosted', 'embeddings', 'providers', 'safety'] as const) {
    if (config[key] !== undefined && !configRecord(config[key])) {
      return `config ${key} must be an object when present`;
    }
  }
  const hosted = configRecord(config.hosted);
  if (hosted?.api_url !== undefined && (typeof hosted.api_url !== 'string' || !hosted.api_url.trim())) {
    return 'config hosted.api_url must be a non-empty string when present';
  }

  const embeddings = configRecord(config.embeddings);
  if (embeddings) {
    const modelIssue = optionalStringIssue(
      embeddings,
      'default_model',
      'config embeddings.default_model',
    );
    if (modelIssue) return modelIssue;
    for (const key of ['dimensions', 'batch_size', 'max_parallel_calls'] as const) {
      const issue = optionalPositiveIntegerIssue(embeddings, key, `config embeddings.${key}`);
      if (issue) return issue;
    }
  }

  const providers = configRecord(config.providers);
  if (providers) {
    const modelIssue = optionalStringIssue(providers, 'default_model', 'config providers.default_model');
    if (modelIssue) return modelIssue;
    if (providers.aliases !== undefined) {
      const aliases = configRecord(providers.aliases);
      if (
        !aliases
        || Object.entries(aliases).some(([key, value]) => !key.trim() || typeof value !== 'string' || !value.trim())
      ) {
        return 'config providers.aliases must map non-empty names to non-empty strings';
      }
    }
    for (const providerName of ['openai', 'anthropic', 'deepseek'] as const) {
      if (providers[providerName] === undefined) continue;
      const provider = configRecord(providers[providerName]);
      if (!provider) return `config providers.${providerName} must be an object when present`;
      for (const key of ['api_key_env', 'base_url', 'default_model'] as const) {
        const issue = optionalStringIssue(
          provider,
          key,
          `config providers.${providerName}.${key}`,
        );
        if (issue) return issue;
      }
    }
  }

  const safety = configRecord(config.safety);
  if (safety) {
    if (safety.network !== undefined) {
      const network = configRecord(safety.network);
      if (!network) return 'config safety.network must be an object when present';
      for (const key of ['web_search_enabled', 's3_reads_enabled'] as const) {
        const issue = optionalBooleanIssue(network, key, `config safety.network.${key}`);
        if (issue) return issue;
      }
      if (
        network.allowed_s3_buckets !== undefined
        && (
          !Array.isArray(network.allowed_s3_buckets)
          || network.allowed_s3_buckets.some((entry) => typeof entry !== 'string' || !entry.trim())
        )
      ) {
        return 'config safety.network.allowed_s3_buckets must be an array of non-empty strings';
      }
    }
    if (safety.redaction !== undefined) {
      const redaction = configRecord(safety.redaction);
      if (!redaction) return 'config safety.redaction must be an object when present';
      const issue = optionalBooleanIssue(redaction, 'enabled', 'config safety.redaction.enabled');
      if (issue) return issue;
    }
    if (safety.approvals !== undefined) {
      const approvals = configRecord(safety.approvals);
      if (!approvals) return 'config safety.approvals must be an object when present';
      const issue = optionalBooleanIssue(
        approvals,
        'generated_writes_require_approval',
        'config safety.approvals.generated_writes_require_approval',
      );
      if (issue) return issue;
    }
  }
  return null;
}

export function configContainmentError(
  detail: string,
  surface: KnowledgeRuntimeSurface = 'public-api',
): KnowledgeContainmentError {
  return new KnowledgeContainmentError(
    'KNOWLEDGE_CONFIG_INVALID',
    503,
    'invalid',
    surface,
    `${detail}; no Knowledge write or data-plane I/O was attempted`,
  );
}

export function assertValidKnowledgeConfig(
  value: unknown,
  surface: KnowledgeRuntimeSurface = 'public-api',
): asserts value is ConfigRecord {
  const issue = knowledgeConfigValidationIssue(value);
  if (issue) throw configContainmentError(issue, surface);
}

function readRegularConfigTextNoFollow(path: string): string | undefined {
  try {
    return readAnchoredRegularFileSnapshot(path, MAX_CONFIG_BYTES)?.content;
  } catch (error) {
    if (error instanceof AnchoredFilesystemError) {
      throw configContainmentError(error.message);
    }
    throw configContainmentError('config could not be opened through its anchored directory');
  }
}

export function readValidatedKnowledgeConfig(
  configPath: string,
  fs: KnowledgeRoleFs = roleFs,
): ConfigRecord | undefined {
  let raw: string | undefined;
  if (fs === roleFs) {
    raw = readRegularConfigTextNoFollow(configPath);
  } else {
    if (!fs.existsSync(configPath)) return undefined;
    raw = fs.readFileSync(configPath, 'utf8');
  }
  if (raw === undefined) return undefined;
  if (Buffer.byteLength(raw) > MAX_CONFIG_BYTES) {
    throw configContainmentError(`config exceeds the ${MAX_CONFIG_BYTES} byte hard limit`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw configContainmentError('config JSON is malformed');
  }
  assertValidKnowledgeConfig(parsed);
  return parsed;
}

const MODE_KEYS = [
  'HASNA_KNOWLEDGE_STORAGE_MODE',
  'KNOWLEDGE_STORAGE_MODE',
  'HASNA_KNOWLEDGE_MODE',
  'KNOWLEDGE_MODE',
] as const;

const ROLE_KEYS = [
  'CODEWITH_RUNTIME_ROLE',
  'CODEWITH_EXECUTION_ROLE',
  'CODEWITH_AGENT_ROLE',
  'CODEWITH_ROLE',
  'KNOWLEDGE_RUNTIME_ROLE',
  'KNOWLEDGE_EXECUTION_ROLE',
  'KNOWLEDGE_AGENT_ROLE',
  'KNOWLEDGE_ROLE',
] as const;

const HOSTED_BOOLEAN_KEYS = [
  'CODEWITH_HOSTED',
  'KNOWLEDGE_HOSTED',
] as const;

const API_URL_KEYS = [
  'HASNA_KNOWLEDGE_API_URL',
  'HASNA_KNOWLEDGE_API_BASE_URL',
  'KNOWLEDGE_API_URL',
  'KNOWLEDGE_API_BASE_URL',
  'OPEN_KNOWLEDGE_API_URL',
] as const;

const API_KEY_KEYS = [
  'HASNA_KNOWLEDGE_API_KEY',
  'KNOWLEDGE_API_KEY',
  'OPEN_KNOWLEDGE_API_KEY',
] as const;

const DATABASE_URL_KEYS = [
  'HASNA_KNOWLEDGE_DATABASE_URL',
  'KNOWLEDGE_DATABASE_URL',
  'HASNA_KNOWLEDGE_DATABASE_URL_OWNER',
] as const;

type NormalizedMode = 'local' | 'hosted';

interface EnvironmentLayer {
  readonly name: 'ambient' | 'supplied';
  readonly env: KnowledgeRuntimeEnv;
}

interface EnvironmentSignal {
  readonly source: string;
  readonly value: string;
}

export interface KnowledgeRuntimeIntent {
  surface?: KnowledgeRuntimeSurface;
  env?: KnowledgeRuntimeEnv;
  configMode?: string | null;
  explicitMode?: string | null;
  hostedRequested?: boolean;
  localStoreOverride?: boolean;
}

export interface KnowledgeRuntimeResolution {
  role: KnowledgeRuntimeRole;
  surface: KnowledgeRuntimeSurface;
  source: string;
  signals: readonly string[];
  issues: readonly string[];
}

export interface KnowledgeContainmentPayload {
  ok: false;
  code: KnowledgeContainmentCode;
  status: 403 | 503;
  role: KnowledgeRuntimeRole;
  surface: KnowledgeRuntimeSurface;
  message: string;
}

export const MAX_KNOWLEDGE_DIAGNOSTIC_BYTES = 384;

const CONTAINMENT_MESSAGES: Record<KnowledgeContainmentCode, string> = {
  KNOWLEDGE_RUNTIME_INTENT_INVALID: 'runtime intent was rejected before Knowledge I/O',
  KNOWLEDGE_CONFIG_INVALID: 'configuration was rejected before Knowledge I/O',
  KNOWLEDGE_HOSTED_CONTAINED: 'hosted capability is unavailable during Stage A',
  KNOWLEDGE_AUTHORITY_UNAVAILABLE: 'trusted authority is unavailable during Stage A',
  KNOWLEDGE_PROJECT_FORBIDDEN: 'project authority denied Knowledge access',
  KNOWLEDGE_POSITIVE_AUTHORITY_DISABLED: 'positive hosted authority is disabled during Stage A',
  KNOWLEDGE_OPERATOR_REQUIRED: 'operator capability is required for this operation',
};

export class KnowledgeContainmentError extends Error {
  readonly name = 'KnowledgeContainmentError';

  constructor(
    readonly code: KnowledgeContainmentCode,
    readonly status: 403 | 503,
    readonly role: KnowledgeRuntimeRole,
    readonly surface: KnowledgeRuntimeSurface,
    _detail: string,
  ) {
    const message = `${code}: ${CONTAINMENT_MESSAGES[code]}`;
    super(Buffer.byteLength(message) <= MAX_KNOWLEDGE_DIAGNOSTIC_BYTES
      ? message
      : `${code}: contained`);
  }

  toJSON(): KnowledgeContainmentPayload {
    const payload: KnowledgeContainmentPayload = {
      ok: false,
      code: this.code,
      status: this.status,
      role: this.role,
      surface: this.surface,
      message: this.message,
    };
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_KNOWLEDGE_DIAGNOSTIC_BYTES) {
      return { ...payload, message: `${this.code}: contained` };
    }
    return payload;
  }
}

function normalizeMode(value: string): NormalizedMode | null {
  const normalized = value.trim().toLowerCase().replace(/-/g, '_');
  if (
    normalized === 'local'
    || normalized === 'offline'
    || normalized === 'standalone'
    || normalized === 'desktop'
  ) return 'local';
  if (
    normalized === 'cloud'
    || normalized === 'hosted'
    || normalized === 'hosted_client'
    || normalized === 'hosted_server'
    || normalized === 'self_hosted'
    || normalized === 'remote'
    || normalized === 'hybrid'
  ) return 'hosted';
  return null;
}

function normalizeBooleanMode(value: string): NormalizedMode | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return 'hosted';
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return 'local';
  return null;
}

function environmentLayers(supplied: KnowledgeRuntimeEnv | undefined): EnvironmentLayer[] {
  const ambient = process.env as KnowledgeRuntimeEnv;
  if (!supplied || supplied === ambient) return [{ name: 'ambient', env: ambient }];
  return [
    { name: 'ambient', env: ambient },
    { name: 'supplied', env: supplied },
  ];
}

function safeEnvironmentValue(
  layer: EnvironmentLayer,
  key: string,
  addIssue: (issue: string) => void,
): string | undefined {
  try {
    let owner: object | null = layer.env;
    let raw: unknown;
    while (owner) {
      if (isProxy(owner)) {
        addIssue(`unreadable-env:${layer.name}:${key}`);
        return undefined;
      }
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      if (descriptor) {
        if (!('value' in descriptor)) {
          addIssue(`unreadable-env:${layer.name}:${key}`);
          return undefined;
        }
        raw = descriptor.value;
        break;
      }
      owner = Object.getPrototypeOf(owner);
    }
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw !== 'string') {
      addIssue(`non-string-env:${layer.name}:${key}`);
      return undefined;
    }
    return raw.trim() || undefined;
  } catch {
    addIssue(`unreadable-env:${layer.name}:${key}`);
    return undefined;
  }
}

function environmentSignals(
  layers: readonly EnvironmentLayer[],
  keys: readonly string[],
  addIssue: (issue: string) => void,
): EnvironmentSignal[] {
  const entries: EnvironmentSignal[] = [];
  for (const layer of layers) {
    for (const key of keys) {
      const value = safeEnvironmentValue(layer, key, addIssue);
      if (value) entries.push({ source: `${layer.name}:${key}`, value });
    }
  }
  return entries;
}

function distinctSignalValues(entries: readonly EnvironmentSignal[]): number {
  return new Set(entries.map(({ value }) => value)).size;
}

export function resolveKnowledgeRuntimeRole(intent: KnowledgeRuntimeIntent = {}): KnowledgeRuntimeResolution {
  const layers = environmentLayers(intent.env);
  const surface = intent.surface ?? 'public-api';
  const signals: string[] = [];
  const issues: string[] = [];
  const modeSignals: Array<{ source: string; mode: NormalizedMode }> = [];

  const addIssue = (issue: string) => {
    if (!issues.includes(issue)) issues.push(issue);
  };

  const collectMode = (
    source: string,
    value: string | null | undefined,
    normalize: (input: string) => NormalizedMode | null = normalizeMode,
  ) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    signals.push(source);
    const mode = normalize(trimmed);
    if (!mode) addIssue(`unknown-mode:${source}`);
    else modeSignals.push({ source, mode });
  };

  collectMode('explicit-mode', intent.explicitMode);
  collectMode('config-mode', intent.configMode);
  for (const layer of layers) {
    for (const key of MODE_KEYS) {
      collectMode(`${layer.name}:${key}`, safeEnvironmentValue(layer, key, addIssue));
    }
    for (const key of ROLE_KEYS) {
      collectMode(`${layer.name}:${key}`, safeEnvironmentValue(layer, key, addIssue));
    }
    for (const key of HOSTED_BOOLEAN_KEYS) {
      collectMode(
        `${layer.name}:${key}`,
        safeEnvironmentValue(layer, key, addIssue),
        normalizeBooleanMode,
      );
    }
  }

  const apiUrls = environmentSignals(layers, API_URL_KEYS, addIssue);
  const apiKeys = environmentSignals(layers, API_KEY_KEYS, addIssue);
  const databaseUrls = environmentSignals(layers, DATABASE_URL_KEYS, addIssue);
  signals.push(
    ...apiUrls.map(({ source }) => source),
    ...apiKeys.map(({ source }) => source),
    ...databaseUrls.map(({ source }) => source),
  );

  if (distinctSignalValues(apiUrls) > 1) addIssue('conflicting-api-url-aliases');
  if (distinctSignalValues(apiKeys) > 1) addIssue('conflicting-api-key-aliases');
  if (distinctSignalValues(databaseUrls) > 1) addIssue('conflicting-database-url-aliases');

  // Ambient and supplied maps have equal authority. A malformed layer remains
  // invalid even when the other layer happens to complete or contradict it.
  for (const layer of layers) {
    const layerUrls = environmentSignals([layer], API_URL_KEYS, addIssue);
    const layerKeys = environmentSignals([layer], API_KEY_KEYS, addIssue);
    if ((layerUrls.length > 0) !== (layerKeys.length > 0)) addIssue(`partial-http-intent:${layer.name}`);
  }

  const distinctModes = new Set(modeSignals.map(({ mode }) => mode));
  if (distinctModes.size > 1) addIssue('conflicting-modes');

  const explicitLocal = modeSignals.some(({ mode }) => mode === 'local');
  const explicitHosted = modeSignals.some(({ mode }) => mode === 'hosted');
  const activeHostedSignal = apiUrls.length > 0 || apiKeys.length > 0 || databaseUrls.length > 0 || Boolean(intent.hostedRequested);

  const hasApiUrl = apiUrls.length > 0;
  const hasApiKey = apiKeys.length > 0;
  if (hasApiUrl !== hasApiKey) addIssue('partial-http-intent');
  if (!explicitHosted && databaseUrls.length > 0) addIssue('database-url-without-hosted-mode');
  if (explicitLocal && activeHostedSignal) addIssue('local-hosted-conflict');

  // Loopback MCP HTTP is a local transport. Only the hosted application
  // server surface implies hosted authority by itself.
  const surfaceIsServer = surface === 'server';
  const surfaceIsOperator = surface === 'operator-migration';
  if (surfaceIsServer && explicitLocal) addIssue('server-local-conflict');
  if (surfaceIsOperator) addIssue('operator-capability-required');

  const hosted = explicitHosted || Boolean(intent.hostedRequested) || (hasApiUrl && hasApiKey) || surfaceIsServer;
  if (hosted && intent.localStoreOverride) addIssue('hosted-local-store-conflict');

  if (issues.length > 0) {
    return { role: 'invalid', surface, source: 'invalid', signals, issues };
  }
  if (hosted) {
    return {
      role: surfaceIsServer ? 'hosted-server' : 'hosted-client',
      surface,
      source: explicitHosted ? 'mode' : intent.hostedRequested ? 'operation' : surfaceIsServer ? 'surface' : 'http-config',
      signals,
      issues,
    };
  }
  return {
    role: 'local',
    surface,
    source: explicitLocal ? 'mode' : 'legacy-default',
    signals,
    issues,
  };
}

/**
 * Canonical two-phase gate. Hosted/invalid env or invocation intent throws
 * before `readConfigMode` is called. Only a preliminarily local role may read
 * the role-config file, after which the second resolution is also gated.
 */
export function assertKnowledgeLocalRuntimeWithConfig(
  intent: KnowledgeRuntimeIntent,
  readConfigMode: () => string | undefined,
): KnowledgeRuntimeResolution {
  return assertKnowledgeLocalRuntime(resolveKnowledgeRuntimeRoleWithConfig(intent, readConfigMode));
}

export function resolveKnowledgeRuntimeRoleWithConfig(
  intent: KnowledgeRuntimeIntent,
  readConfigMode: () => string | undefined,
): KnowledgeRuntimeResolution {
  // Invocation mode is an equal-authority signal and must survive the first
  // gate. In particular, a supplied hosted mode must fail before the persisted
  // config reader (and therefore before any filesystem access) is invoked.
  const preliminary = resolveKnowledgeRuntimeRole(intent);
  if (preliminary.role !== 'local') return preliminary;
  // Only invocation intent already proven local reaches persisted config. The
  // second gate intersects that local result with the stored mode: local or
  // absent remains local, while hosted/invalid persisted state fails closed.
  return resolveKnowledgeRuntimeRole({ ...intent, configMode: readConfigMode() });
}

export function assertKnowledgeLocalRuntimeForConfigPath(
  intent: KnowledgeRuntimeIntent,
  configPath: string,
  fs: KnowledgeRoleFs = roleFs,
  required = false,
): KnowledgeRuntimeResolution {
  return assertKnowledgeLocalRuntimeWithConfig(
    intent,
    () => readKnowledgeConfiguredMode(configPath, fs, required),
  );
}

export function containmentErrorFor(resolution: KnowledgeRuntimeResolution): KnowledgeContainmentError {
  if (resolution.role === 'invalid') {
    if (resolution.issues.includes('unknown-mode:config-mode')) {
      return configContainmentError('persisted or supplied config is structurally invalid', resolution.surface);
    }
    return new KnowledgeContainmentError(
      'KNOWLEDGE_RUNTIME_INTENT_INVALID',
      503,
      resolution.role,
      resolution.surface,
      'runtime intent is incomplete, unknown, or conflicting; no Knowledge I/O was attempted',
    );
  }
  if (resolution.role === 'operator-migration') {
    return new KnowledgeContainmentError(
      'KNOWLEDGE_OPERATOR_REQUIRED',
      503,
      resolution.role,
      resolution.surface,
      'operator-only operation is unavailable through this public boundary',
    );
  }
  return new KnowledgeContainmentError(
    'KNOWLEDGE_HOSTED_CONTAINED',
    503,
    resolution.role,
    resolution.surface,
    'hosted Knowledge access is disabled until trusted project authority is available',
  );
}

export function assertKnowledgeLocalRuntime(
  intentOrResolution: KnowledgeRuntimeIntent | KnowledgeRuntimeResolution = {},
): KnowledgeRuntimeResolution {
  const resolution = 'role' in intentOrResolution
    ? intentOrResolution
    : resolveKnowledgeRuntimeRole(intentOrResolution);
  if (resolution.role !== 'local') throw containmentErrorFor(resolution);
  return resolution;
}

export function readKnowledgeConfiguredMode(
  configPath: string,
  fs: KnowledgeRoleFs = roleFs,
  required = false,
): string | undefined {
  try {
    const parsed = readValidatedKnowledgeConfig(configPath, fs);
    if (!parsed) return required ? INVALID_CONFIG_MODE : undefined;
    return configuredModeFromValidatedConfig(parsed);
  } catch {
    return INVALID_CONFIG_MODE;
  }
}

function configuredModeFromValidatedConfig(parsed: ConfigRecord): string {
  const storage = parsed.storage as ConfigRecord;
  return parsed.mode === 'hosted' || storage.type === 's3' ? 'hosted' : 'local';
}

export type KnowledgeAuthorityState =
  | { trust: 'missing' }
  | { trust: 'untrusted' }
  | { trust: 'trusted'; projectGrants: readonly string[] };

export function authorityContainmentError(
  authority: KnowledgeAuthorityState | undefined,
  surface: KnowledgeRuntimeSurface = 'server',
): KnowledgeContainmentError {
  if (!authority || authority.trust === 'missing' || authority.trust === 'untrusted') {
    return new KnowledgeContainmentError(
      'KNOWLEDGE_AUTHORITY_UNAVAILABLE',
      503,
      'hosted-server',
      surface,
      'trusted tenant and project authority is unavailable',
    );
  }
  if (authority.projectGrants.length === 0) {
    return new KnowledgeContainmentError(
      'KNOWLEDGE_PROJECT_FORBIDDEN',
      403,
      'hosted-server',
      surface,
      'the trusted principal has no Knowledge project grant',
    );
  }
  return new KnowledgeContainmentError(
    'KNOWLEDGE_POSITIVE_AUTHORITY_DISABLED',
    503,
    'hosted-server',
    surface,
    'positive hosted access is intentionally disabled during Stage A',
  );
}

export function isKnowledgeContainmentError(error: unknown): error is KnowledgeContainmentError {
  return error instanceof KnowledgeContainmentError;
}
