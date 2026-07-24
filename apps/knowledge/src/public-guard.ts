import { dirname, join } from 'node:path';
import { isProxy } from 'node:util/types';
import {
  KnowledgeContainmentError,
  assertKnowledgeLocalRuntime,
  assertKnowledgeLocalRuntimeForConfigPath,
  configContainmentError,
  type KnowledgeRuntimeEnv,
  type KnowledgeRuntimeSurface,
} from './runtime-role';

export interface PublicInvocationGuardOptions {
  readonly surface?: KnowledgeRuntimeSurface;
  readonly explicitConfigPath?: string;
  readonly requireConfig?: boolean;
}

interface PublicClassification {
  readonly envs: KnowledgeRuntimeEnv[];
  readonly configModes: string[];
  readonly configPaths: string[];
  hostedRequested: boolean;
}

const MAX_CLASSIFIER_DEPTH = 12;
export const MAX_PUBLIC_ARRAY_ITEMS = 4_096;
export const MAX_PUBLIC_OBJECT_PROPERTIES = 256;
export const MAX_PUBLIC_TOTAL_PROPERTIES = 8_192;
export const MAX_PUBLIC_NODES = 4_096;
export const MAX_PUBLIC_BYTES = 8_388_608;
const OPAQUE_KEYS = new Set([
  'body',
  'client',
  'executor',
  'pool',
  'remote',
  'service',
]);

function invalidPublicInput(detail: string, surface: KnowledgeRuntimeSurface): never {
  throw new KnowledgeContainmentError(
    'KNOWLEDGE_RUNTIME_INTENT_INVALID',
    503,
    'invalid',
    surface,
    `${detail}; supplied values were contained before Knowledge I/O`,
  );
}

function safeKeys(value: object, surface: KnowledgeRuntimeSurface): (string | symbol)[] {
  if (isProxy(value)) {
    return invalidPublicInput('public proxy inputs are unsupported', surface);
  }
  try {
    const keys = Reflect.ownKeys(value);
    if (!Array.isArray(value) && keys.length > MAX_PUBLIC_OBJECT_PROPERTIES) {
      return invalidPublicInput('public object exceeds the per-object property limit', surface);
    }
    return keys;
  } catch {
    return invalidPublicInput('public options could not be enumerated safely', surface);
  }
}

export function safePublicProperty(
  value: object,
  key: string | symbol,
  surface: KnowledgeRuntimeSurface = 'public-api',
): unknown {
  try {
    if (isProxy(value)) {
      return invalidPublicInput('public proxy inputs are unsupported', surface);
    }
    let owner: object | null = value;
    while (owner) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      if (descriptor) {
        if (!('value' in descriptor)) {
          return invalidPublicInput('public option uses an unsupported accessor', surface);
        }
        return descriptor.value;
      }
      owner = Object.getPrototypeOf(owner);
    }
    return undefined;
  } catch {
    return invalidPublicInput('public option could not be read safely', surface);
  }
}

function assertDensePublicArray(
  value: unknown[],
  surface: KnowledgeRuntimeSurface,
): void {
  for (let index = 0; index < value.length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      return invalidPublicInput('public array descriptors could not be inspected safely', surface);
    }
    if (!descriptor) return invalidPublicInput('public sparse arrays are unsupported', surface);
    if (!('value' in descriptor)) {
      return invalidPublicInput('public array accessors are unsupported', surface);
    }
  }
}

function asObject(value: unknown): object | undefined {
  return value !== null && typeof value === 'object' ? value : undefined;
}

function stringValue(value: unknown, label: string, surface: KnowledgeRuntimeSurface): string {
  if (typeof value !== 'string' || !value.trim()) {
    return invalidPublicInput(`${label} must be a non-empty string`, surface);
  }
  return value;
}

function classifyStorage(
  value: unknown,
  classification: PublicClassification,
  surface: KnowledgeRuntimeSurface,
): void {
  const storage = asObject(value);
  if (!storage || Array.isArray(storage)) {
    throw configContainmentError('present storage must be an object', surface);
  }
  const type = safePublicProperty(storage, 'type', surface);
  const artifactsRoot = safePublicProperty(storage, 'artifacts_root', surface);
  const s3 = safePublicProperty(storage, 's3', surface);
  if (type !== 'local' && type !== 's3') {
    throw configContainmentError('present storage.type must be local or s3', surface);
  }
  if (typeof artifactsRoot !== 'string' || !artifactsRoot.trim()) {
    throw configContainmentError('present storage.artifacts_root must be a non-empty string', surface);
  }
  if (type === 'local' && s3 !== undefined) {
    throw configContainmentError('local storage must not include storage.s3', surface);
  }
  if (type === 's3') {
    classification.hostedRequested = true;
    const s3Object = asObject(s3);
    if (!s3Object || Array.isArray(s3Object)) {
      throw configContainmentError('S3 storage requires a storage.s3 object', surface);
    }
    stringValue(safePublicProperty(s3Object, 'bucket', surface), 'storage.s3.bucket', surface);
  }
}

function classifyStore(
  value: unknown,
  classification: PublicClassification,
  surface: KnowledgeRuntimeSurface,
): void {
  const store = asObject(value);
  if (!store) return;
  const type = safePublicProperty(store, 'type', surface);
  if (type === 's3') classification.hostedRequested = true;
  else if (type !== undefined && type !== 'local') {
    return invalidPublicInput('present store.type is unknown', surface);
  }
}

function addPath(classification: PublicClassification, value: unknown): void {
  if (typeof value === 'string' && value.length > 0 && !classification.configPaths.includes(value)) {
    classification.configPaths.push(value);
  }
}

function classifyValues(
  values: readonly unknown[],
  surface: KnowledgeRuntimeSurface,
): PublicClassification {
  const result: PublicClassification = {
    envs: [],
    configModes: [],
    configPaths: [],
    hostedRequested: false,
  };
  const seen = new WeakSet<object>();
  let visited = 0;
  let properties = 0;
  let bytes = 0;

  const accountValue = (value: unknown): void => {
    if (typeof value === 'string') bytes += Buffer.byteLength(value);
    else if (ArrayBuffer.isView(value)) bytes += value.byteLength;
    if (bytes > MAX_PUBLIC_BYTES) {
      return invalidPublicInput('public options exceed the aggregate byte limit', surface);
    }
  };

  const visit = (value: unknown, depth: number, parentKey?: string): void => {
    accountValue(value);
    if (ArrayBuffer.isView(value)) return;
    const object = asObject(value);
    if (!object || seen.has(object)) return;
    if (isProxy(object)) return invalidPublicInput('public proxy inputs are unsupported', surface);
    if (Array.isArray(object)) {
      if (object.length > MAX_PUBLIC_ARRAY_ITEMS) {
        return invalidPublicInput('public array exceeds the aggregate item limit', surface);
      }
      assertDensePublicArray(object, surface);
    }
    if (depth > MAX_CLASSIFIER_DEPTH || ++visited > MAX_PUBLIC_NODES) {
      return invalidPublicInput('public options exceed the bounded classifier limit', surface);
    }
    seen.add(object);

    const normalizedParentKey = parentKey?.toLowerCase();
    if (normalizedParentKey === 'storage') classifyStorage(object, result, surface);
    if (normalizedParentKey?.endsWith('store')) classifyStore(object, result, surface);

    const keys = safeKeys(object, surface);
    properties += keys.length;
    if (properties > MAX_PUBLIC_TOTAL_PROPERTIES) {
      return invalidPublicInput('public options exceed the aggregate property limit', surface);
    }
    for (const key of keys) {
      if (typeof key !== 'string') continue;
      const child = safePublicProperty(object, key, surface);
      if (key === 'env') {
        const env = asObject(child);
        if (!env || Array.isArray(env)) {
          return invalidPublicInput('public env must be an object when present', surface);
        }
        result.envs.push(env as KnowledgeRuntimeEnv);
        // Environment values may include sensitive or runtime-owned entries.
        // The runtime-role resolver inspects only its fixed allowlist through
        // data descriptors, so do not enumerate or traverse the whole map.
        continue;
      }
      if (key === 'configPath') addPath(result, child);
      if (key === 'dbPath' || key === 'targetDbPath') {
        if (typeof child === 'string' && child) addPath(result, join(dirname(child), 'config.json'));
      }
      if (key === 'workspaceHome' || key === 'targetWorkspaceHome') {
        if (typeof child === 'string' && child) addPath(result, join(child, 'config.json'));
      }
      if (key === 'mode' && (depth === 0 || parentKey === 'config')) {
        if (typeof child !== 'string') {
          return invalidPublicInput('public mode must be a string when present', surface);
        }
        result.configModes.push(child);
      }
      if (key === 'hostedRequested' && child === true) result.hostedRequested = true;
      if (key === 'storage_type' && child === 's3') result.hostedRequested = true;
      if (OPAQUE_KEYS.has(key)) accountValue(child);
      else visit(child, depth + 1, key);
    }
  };

  for (const value of values) visit(value, 0);
  return result;
}

function remoteSourceContained(
  detail: string,
  surface: KnowledgeRuntimeSurface,
): never {
  throw new KnowledgeContainmentError(
    'KNOWLEDGE_HOSTED_CONTAINED',
    503,
    'hosted-client',
    surface,
    `${detail}; source access was denied before implementation loading or body reads`,
  );
}

export function assertClassifiedSourceReference(
  sourceRef: unknown,
  options: { allowStored?: boolean; surface?: KnowledgeRuntimeSurface } = {},
): asserts sourceRef is string {
  const surface = options.surface ?? 'public-api';
  if (typeof sourceRef !== 'string' || !sourceRef.trim()) {
    return invalidPublicInput('source reference must be a non-empty string', surface);
  }
  if (Buffer.byteLength(sourceRef) > 16_384) {
    return invalidPublicInput('source reference exceeds the byte limit', surface);
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(sourceRef)?.[1]?.toLowerCase();
  if (!scheme) return invalidPublicInput('source reference must use an explicit local file URI', surface);
  if (scheme === 'file') {
    let parsed: URL;
    try {
      parsed = new URL(sourceRef);
      if (parsed.protocol !== 'file:') throw new Error('not file');
    } catch {
      return invalidPublicInput('source file URI is malformed', surface);
    }
    if (parsed.hostname && parsed.hostname !== 'localhost') {
      return remoteSourceContained('remote-host file URIs are unavailable during Stage A', surface);
    }
    return;
  }
  if (scheme === 'open-files' && options.allowStored) return;
  return remoteSourceContained('remote source scheme is unavailable during Stage A', surface);
}

const SOURCE_REFERENCE_KEYS = new Set([
  'source_ref', 'source_uri', 'source_url', 'uri', 'url', 'ref',
  'extracted_text_ref', 'extracted_text_uri', 'text_ref',
]);
const SOURCE_GRAPH_RUNTIME_OPAQUE_KEYS = new Set([
  'client',
  'config',
  'env',
  'executor',
  'pool',
  'remote',
  'safety_policy',
  'service',
  'store',
  'workspace',
]);
function decodeSourceKey(key: string, surface: KnowledgeRuntimeSurface): string {
  if (Buffer.byteLength(key) > 256) {
    return invalidPublicInput('source field label exceeds the byte limit', surface);
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(key);
  } catch {
    return invalidPublicInput('source field label encoding is invalid', surface);
  }
  if (/%[0-9a-f]{2}/i.test(decoded)) {
    return invalidPublicInput('repeated source field label encoding is unsupported', surface);
  }
  return decoded;
}

function sourceKeyCategory(
  key: string,
  surface: KnowledgeRuntimeSurface,
): 'reference' | 'references' | 'remote' | 'path' | 'other' {
  const normalized = normalizeSourceKey(decodeSourceKey(key, surface));
  const compact = normalized.replace(/_/g, '');
  if (
    SOURCE_REFERENCE_KEYS.has(normalized)
    || /(?:url|uri|ref)$/.test(compact)
  ) return 'reference';
  if (/(?:urls|uris|refs)$/.test(compact)) return 'references';
  if (/(?:dsn|host|domain)$/.test(compact)) return 'remote';
  if (/(?:path|pathname)$/.test(compact)) return 'path';
  return 'other';
}

function assertContainedSourceGraphInternal(
  value: unknown,
  surface: KnowledgeRuntimeSurface,
  opaqueKeys: ReadonlySet<string> | undefined,
): void {
  const seen = new WeakSet<object>();
  let nodes = 0;
  let properties = 0;
  let bytes = 0;
  const visit = (entry: unknown, depth: number): void => {
    if (typeof entry === 'string') {
      bytes += Buffer.byteLength(entry);
      if (bytes > MAX_PUBLIC_BYTES) {
        return invalidPublicInput('source graph exceeds the aggregate byte limit', surface);
      }
      return;
    }
    if (ArrayBuffer.isView(entry)) {
      bytes += entry.byteLength;
      if (bytes > MAX_PUBLIC_BYTES) {
        return invalidPublicInput('source graph exceeds the aggregate byte limit', surface);
      }
      return;
    }
    const object = asObject(entry);
    if (!object || seen.has(object)) return;
    if (isProxy(object)) return invalidPublicInput('source graph proxy inputs are unsupported', surface);
    if (Array.isArray(object)) {
      if (object.length > MAX_PUBLIC_ARRAY_ITEMS) {
        return invalidPublicInput('source graph array exceeds the aggregate item limit', surface);
      }
      assertDensePublicArray(object, surface);
    }
    if (depth > MAX_CLASSIFIER_DEPTH || ++nodes > MAX_PUBLIC_NODES) {
      return invalidPublicInput('source graph exceeds the aggregate node or depth limit', surface);
    }
    seen.add(object);
    const keys = safeKeys(object, surface);
    properties += keys.length;
    if (properties > MAX_PUBLIC_TOTAL_PROPERTIES) {
      return invalidPublicInput('source graph exceeds the aggregate property limit', surface);
    }
    for (const key of keys) {
      if (typeof key !== 'string') continue;
      const child = safePublicProperty(object, key, surface);
      const normalizedKey = normalizeSourceKey(decodeSourceKey(key, surface));
      const category = sourceKeyCategory(key, surface);
      if (category === 'reference' && child !== undefined && child !== null) {
        assertClassifiedSourceReference(child, { allowStored: true, surface });
      }
      if (category === 'references' && child !== undefined && child !== null) {
        if (!Array.isArray(child)) {
          return invalidPublicInput('source reference collection must be an array', surface);
        }
        assertDensePublicArray(child, surface);
        for (let index = 0; index < child.length; index += 1) {
          assertClassifiedSourceReference(
            safePublicProperty(child, String(index), surface),
            { allowStored: true, surface },
          );
        }
      }
      if (category === 'remote' && child !== undefined && child !== null) {
        return remoteSourceContained('remote source field is unavailable during Stage A', surface);
      }
      if (
        category === 'path'
        && typeof child === 'string'
        && /^[a-z][a-z0-9+.-]*:/i.test(child)
      ) {
        assertClassifiedSourceReference(child, { allowStored: true, surface });
      }
      if (opaqueKeys?.has(normalizedKey)) continue;
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  // URI classification must run before generic runtime-intent validation.
  // Strict source data traverses every field; runtime options retain only the
  // explicitly bounded opaque fields selected by the caller above.
  assertPublicInvocation([value], { surface });
}

/** Validate URI-bearing runtime options while preserving bounded opaque state. */
export function assertContainedSourceGraph(
  value: unknown,
  surface: KnowledgeRuntimeSurface = 'public-api',
): void {
  assertContainedSourceGraphInternal(value, surface, SOURCE_GRAPH_RUNTIME_OPAQUE_KEYS);
}

/** Strictly traverse manifest/outbox source data before any local mutation. */
export function assertContainedSourceDataGraph(
  value: unknown,
  surface: KnowledgeRuntimeSurface = 'public-api',
): void {
  assertContainedSourceGraphInternal(value, surface, undefined);
}

function normalizeSourceKey(key: string): string {
  return key
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

/**
 * Canonical public pre-gate. Ambient hosted intent is checked before any
 * caller value is touched. The bounded classifier then centralizes nested S3,
 * config, path, and supplied-env handling for every preserved public wrapper.
 */
export function assertPublicInvocation(
  values: readonly unknown[] = [],
  options: PublicInvocationGuardOptions = {},
): void {
  const surface = options.surface ?? 'public-api';
  assertKnowledgeLocalRuntime({ surface, env: process.env });
  const classification = classifyValues(values, surface);

  const distinctModes = [...new Set(classification.configModes)];
  if (distinctModes.length > 1) {
    return invalidPublicInput('public options contain conflicting config modes', surface);
  }
  const intent = {
    surface,
    configMode: distinctModes[0],
    hostedRequested: classification.hostedRequested,
  } as const;
  assertKnowledgeLocalRuntime(intent);
  for (const env of classification.envs) {
    assertKnowledgeLocalRuntime({ ...intent, env });
  }

  const configPaths = [...classification.configPaths];
  if (options.explicitConfigPath && !configPaths.includes(options.explicitConfigPath)) {
    configPaths.push(options.explicitConfigPath);
  }
  for (const configPath of configPaths) {
    assertKnowledgeLocalRuntimeForConfigPath(
      { ...intent, env: classification.envs[0] ?? process.env },
      configPath,
      undefined,
      options.requireConfig,
    );
  }
}

/** Public root auth compatibility is intentionally a zero-read Stage-A stub. */
export function denyPublicAuth(): never {
  throw new KnowledgeContainmentError(
    'KNOWLEDGE_HOSTED_CONTAINED',
    503,
    'hosted-client',
    'public-api',
    'public root authentication is disabled during Stage A before auth options or paths are inspected',
  );
}
