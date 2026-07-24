import {
  TODOS_STORAGE_ENV,
  TODOS_STORAGE_FALLBACK_ENV,
  getCanonicalTodosRdsConfig,
  getTodosStorageEnvName,
  inspectTodosStorageConfig,
} from "../storage/config.js";
import { postgresTodosSyncSchemaSql } from "../storage/postgres-contracts.js";
import type { CanonicalTodosRdsConfig, TodosStorageEnv, TodosStorageMode } from "../storage/config.js";

export interface NativeStorageEnvStatus {
  name: string;
  active_name: string;
  configured: boolean;
}

export interface DiagnosticTruncation {
  path: string;
  kind: "string" | "array" | "object" | "depth" | "node_budget" | "character_budget" | "circular" | "unreadable";
  original: number;
  retained: number;
}

export interface NativeDiagnosticMetadata {
  sanitizer: "bounded-recursive-v1";
  truncated: boolean;
  truncations: DiagnosticTruncation[];
  omitted_truncations: number;
  redactions: number;
  controls_removed: number;
}

export interface NativeStorageStatus {
  ok: boolean;
  service: "todos";
  mode: TodosStorageMode;
  local_default: boolean;
  /** Configured hosted intent; never an executable Stage-A capability. */
  remote_configured: boolean;
  /** Backward-compatible runtime flag. Always false until authority-enabled Stage B. */
  remote_enabled: boolean;
  /** Explicit runtime capability flag. Always false in Stage A. */
  runtime_enabled: false;
  database: {
    configured: boolean;
    provider: "postgres" | null;
    redacted_url: string | null;
    ssl: boolean | null;
    schema: string | null;
  };
  object_storage: {
    configured: boolean;
    provider: "s3" | null;
    bucket: string | null;
    prefix: string | null;
    region: string | null;
    endpoint_configured: boolean;
    force_path_style: boolean;
  };
  sync: {
    batch_size: number;
    dry_run: boolean;
  };
  env: Record<keyof typeof TODOS_STORAGE_ENV, NativeStorageEnvStatus>;
  canonical: CanonicalTodosRdsConfig;
  issues: string[];
  warnings: string[];
  no_network: true;
  diagnostics: NativeDiagnosticMetadata;
}

export interface NativeStorageSyncPlan {
  ok: boolean;
  service: "todos";
  dry_run: true;
  no_network: true;
  status: NativeStorageStatus;
  postgres: {
    required: boolean;
    configured_intent: boolean;
    configured: boolean;
    schema_sql: string[];
  };
  object_storage: {
    required: boolean;
    configured_intent: boolean;
    configured: boolean;
    bucket: string | null;
    prefix: string | null;
  };
  steps: string[];
  diagnostics: NativeDiagnosticMetadata;
}

export interface NativeStorageSyncPlanOptions {
  includeSchemaSql?: boolean;
}

export function getNativeStorageStatus(env: TodosStorageEnv = process.env): NativeStorageStatus {
  const snapshot = snapshotStorageEnvironment(env);
  const issues: string[] = [...snapshot.issues];
  const warnings: string[] = [];
  const inspected = inspectTodosStorageConfig(snapshot.env);
  const config = inspected.config;
  issues.push(...inspected.issues.map((error) => error.message));

  const remoteConfigured = config.mode === "remote" || config.mode === "hybrid";
  if (remoteConfigured && !config.database?.url) {
    issues.push(`${TODOS_STORAGE_ENV.databaseUrl} is required when ${TODOS_STORAGE_ENV.mode}=${config.mode}`);
  }
  const remoteFieldsConfigured = Boolean(config.database || config.objectStorage);
  if (!remoteConfigured && remoteFieldsConfigured) {
    warnings.push(`${TODOS_STORAGE_ENV.mode}=local ignores configured remote storage fields`);
  }
  if (remoteConfigured && !config.objectStorage) {
    warnings.push(`${TODOS_STORAGE_ENV.s3Bucket} is not configured; Stage A remote intent remains disabled`);
  }

  const raw: Omit<NativeStorageStatus, "diagnostics"> = {
    ok: issues.length === 0,
    service: "todos",
    mode: config.mode,
    local_default: config.mode === "local",
    remote_configured: remoteConfigured,
    remote_enabled: false,
    runtime_enabled: false,
    database: {
      configured: Boolean(config.database),
      provider: config.database?.provider ?? null,
      redacted_url: redactDatabaseUrl(config.database?.url),
      ssl: config.database?.ssl ?? null,
      schema: config.database?.schema ?? null,
    },
    object_storage: {
      configured: Boolean(config.objectStorage),
      provider: config.objectStorage?.provider ?? null,
      bucket: config.objectStorage?.bucket ?? null,
      prefix: config.objectStorage?.prefix ?? null,
      region: config.objectStorage?.region ?? null,
      endpoint_configured: Boolean(config.objectStorage?.endpoint),
      force_path_style: config.objectStorage?.forcePathStyle ?? false,
    },
    sync: {
      batch_size: config.sync.batchSize,
      dry_run: config.sync.dryRun,
    },
    env: storageEnvStatus(snapshot.env),
    canonical: getCanonicalTodosRdsConfig(),
    issues,
    warnings,
    no_network: true,
  };
  return sanitizeDiagnosticPayload(raw) as NativeStorageStatus;
}

export function getNativeStorageSyncPlan(
  env: TodosStorageEnv = process.env,
  options: NativeStorageSyncPlanOptions = {},
): NativeStorageSyncPlan {
  const status = getNativeStorageStatus(env);
  const steps = [
    "Inspect configured storage intent without opening SQLite or network connections",
    "Defer Postgres, S3, shadow, migration, and backfill execution to authority-enabled Stage B",
    "Report bounded redacted metadata only",
  ];

  const raw: Omit<NativeStorageSyncPlan, "diagnostics"> = {
    ok: status.ok,
    service: "todos",
    dry_run: true,
    no_network: true,
    status,
    postgres: {
      required: false,
      configured_intent: status.remote_configured,
      configured: status.database.configured,
      schema_sql: options.includeSchemaSql ? postgresTodosSyncSchemaSql() : [],
    },
    object_storage: {
      required: false,
      configured_intent: status.remote_configured && status.object_storage.configured,
      configured: status.object_storage.configured,
      bucket: status.object_storage.bucket,
      prefix: status.object_storage.prefix,
    },
    steps,
  };
  const plan = sanitizeDiagnosticPayload(raw) as NativeStorageSyncPlan;
  if (status.diagnostics.truncated) {
    const inherited = status.diagnostics.truncations.map((entry) => ({
      ...entry,
      path: `$.status${entry.path.slice(1)}`,
    }));
    const combined = [...inherited, ...plan.diagnostics.truncations];
    plan.diagnostics = {
      ...plan.diagnostics,
      truncated: true,
      truncations: combined.slice(0, DIAGNOSTIC_MAX_TRUNCATION_ENTRIES),
      omitted_truncations: plan.diagnostics.omitted_truncations
        + status.diagnostics.omitted_truncations
        + Math.max(0, combined.length - DIAGNOSTIC_MAX_TRUNCATION_ENTRIES),
      redactions: plan.diagnostics.redactions + status.diagnostics.redactions,
      controls_removed: plan.diagnostics.controls_removed + status.diagnostics.controls_removed,
    };
  }
  return plan;
}

export function redactDatabaseUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    // WHATWG URL accepts opaque schemes such as `jdbc:postgresql:...` while
    // leaving their embedded DSN in pathname. Only recognized hierarchical
    // Postgres URLs are safe to render structurally; every other shape gets a
    // constant sentinel so no userinfo/path/query/fragment can escape.
    if (!/^postgres(?:ql)?:\/\//i.test(value)) return "(redacted)";
    const url = new URL(value);
    if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:") || !url.hostname) {
      return "(redacted)";
    }
    const userinfo = url.username || url.password ? "***:***@" : "";
    // A database name/path can itself contain percent-encoded passwords,
    // tenant identifiers, socket paths, or other credential-like material.
    // Status needs only scheme and host provenance, never pathname bytes.
    return `${url.protocol}//${userinfo}${url.host}/[REDACTED_PATH]`
      + (url.search ? "?redacted=***" : "")
      + (url.hash ? "#redacted" : "");
  } catch {
    return "(redacted)";
  }
}

const DIAGNOSTIC_MAX_DEPTH = 7;
const DIAGNOSTIC_MAX_COLLECTION_ITEMS = 32;
const DIAGNOSTIC_MAX_OBJECT_ENTRIES = 32;
const DIAGNOSTIC_MAX_NODES = 512;
const DIAGNOSTIC_MAX_CHARACTERS = 32_768;
const DIAGNOSTIC_MAX_TRUNCATION_ENTRIES = 32;
const DIAGNOSTIC_MAX_TRUNCATION_PATH_CHARACTERS = 128;
const DIAGNOSTIC_SECRET_KEY_TOKENS = new Set([
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "dsn",
  "key",
  "passwd",
  "password",
  "pwd",
  "secret",
  "token",
]);
const DIAGNOSTIC_SECRET_KEY_SUFFIXES = [
  "authorization",
  "credential",
  "credentials",
  "databaseurl",
  "dburl",
  "dsn",
  "passwd",
  "password",
  "pwd",
  "secret",
  "token",
] as const;

interface DiagnosticSanitizerState {
  nodes: number;
  characters: number;
  redactions: number;
  controlsRemoved: number;
  truncations: DiagnosticTruncation[];
  omittedTruncations: number;
  seen: WeakSet<object>;
}

/**
 * One output-bounded recursive sanitizer for storage status and sync plans.
 * It preserves object insertion order and field names while bounding every
 * attacker-controlled string/collection/depth and reporting every truncation.
 */
export function sanitizeDiagnosticPayload<T extends object>(payload: T): T & { diagnostics: NativeDiagnosticMetadata } {
  const state: DiagnosticSanitizerState = {
    nodes: 0,
    characters: 0,
    redactions: 0,
    controlsRemoved: 0,
    truncations: [],
    omittedTruncations: 0,
    seen: new WeakSet(),
  };
  const sanitized = sanitizeDiagnosticValue(payload, "$", 0, state);
  const sanitizedRecord = sanitized !== null && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? sanitized as T
    : Object.assign(Object.create(null), { value: sanitized }) as unknown as T;
  const result = Object.assign(Object.create(null), sanitizedRecord) as T & { diagnostics: NativeDiagnosticMetadata };
  result.diagnostics = Object.assign(Object.create(null), {
      sanitizer: "bounded-recursive-v1",
      truncated: state.truncations.length > 0 || state.omittedTruncations > 0,
      truncations: state.truncations,
      omitted_truncations: state.omittedTruncations,
      redactions: state.redactions,
      controls_removed: state.controlsRemoved,
    });
  return result;
}

function sanitizeDiagnosticValue(
  value: unknown,
  path: string,
  depth: number,
  state: DiagnosticSanitizerState,
): unknown {
  state.nodes += 1;
  if (state.nodes > DIAGNOSTIC_MAX_NODES) {
    noteDiagnosticTruncation(state, path, "node_budget", state.nodes, DIAGNOSTIC_MAX_NODES);
    return "[TRUNCATED]";
  }
  if (depth > DIAGNOSTIC_MAX_DEPTH) {
    noteDiagnosticTruncation(state, path, "depth", depth, DIAGNOSTIC_MAX_DEPTH);
    return "[TRUNCATED]";
  }
  if (typeof value === "string") return sanitizeDiagnosticString(value, path, state);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return sanitizeDiagnosticString(value.toString(), path, state);
  if (typeof value === "undefined") return null;
  if (typeof value !== "object" && typeof value !== "function") {
    try {
      return sanitizeDiagnosticString(String(value), path, state);
    } catch {
      return unreadableDiagnosticValue(state, path);
    }
  }

  let isDate = false;
  try {
    isDate = value instanceof Date;
  } catch {
    return unreadableDiagnosticValue(state, path);
  }
  if (isDate) {
    try {
      const timestamp = Date.prototype.getTime.call(value);
      if (!Number.isFinite(timestamp)) return unreadableDiagnosticValue(state, path, "[INVALID_DATE]");
      return sanitizeDiagnosticString(new Date(timestamp).toISOString(), path, state);
    } catch {
      return unreadableDiagnosticValue(state, path, "[INVALID_DATE]");
    }
  }

  if (typeof value === "function") {
    try {
      return sanitizeDiagnosticString(String(value), path, state);
    } catch {
      return unreadableDiagnosticValue(state, path);
    }
  }

  if (state.seen.has(value)) {
    noteDiagnosticTruncation(state, path, "circular", 1, 0);
    return "[CIRCULAR]";
  }
  state.seen.add(value);

  let isError = false;
  try {
    isError = value instanceof Error;
  } catch {
    return unreadableDiagnosticValue(state, path);
  }
  if (isError) {
    const normalized = normalizeDiagnosticError(value as Error, path, state);
    if (normalized === null) return unreadableDiagnosticValue(state, path);
    return sanitizeDiagnosticValue(normalized, path, depth, state);
  }

  let isArray = false;
  try {
    isArray = Array.isArray(value);
  } catch {
    return unreadableDiagnosticValue(state, path);
  }
  if (isArray) {
    let length = 0;
    try {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, "length");
      if (!descriptor || !("value" in descriptor) || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) {
        return unreadableDiagnosticValue(state, path);
      }
      length = descriptor.value as number;
    } catch {
      return unreadableDiagnosticValue(state, path);
    }
    const retainedLength = Math.min(length, DIAGNOSTIC_MAX_COLLECTION_ITEMS);
    if (retainedLength !== length) {
      noteDiagnosticTruncation(state, path, "array", length, retainedLength);
    }
    const output: unknown[] = [];
    for (let index = 0; index < retainedLength; index += 1) {
      const childPath = `${path}[${index}]`;
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      } catch {
        output.push(unreadableDiagnosticValue(state, childPath));
        continue;
      }
      if (!descriptor) {
        output.push(null);
      } else if (!("value" in descriptor)) {
        output.push(unreadableDiagnosticValue(state, childPath));
      } else {
        output.push(sanitizeDiagnosticValue(descriptor.value, childPath, depth + 1, state));
      }
    }
    return output;
  }

  let ownKeys: PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch {
    return unreadableDiagnosticValue(state, path);
  }
  const stringKeys = ownKeys.filter((key): key is string => typeof key === "string");
  const retained = stringKeys.slice(0, DIAGNOSTIC_MAX_OBJECT_ENTRIES);
  if (retained.length !== stringKeys.length) {
    noteDiagnosticTruncation(state, path, "object", stringKeys.length, retained.length);
  }
  const output: Record<string, unknown> = Object.create(null);
  for (const rawKey of retained) {
    // Classify the original bounded key and its bounded decoded forms before
    // output sanitization can replace an encoded credential name with a
    // generic sentinel. Values behind hostile keys are never inspected.
    const secretField = rawKey.length > 2_048 || isDiagnosticSecretField(rawKey, path);
    const sanitizedKey = sanitizeDiagnosticKey(rawKey, `${path}.[key]`, state);
    const key = allocateDiagnosticOutputKey(sanitizedKey, output);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, rawKey);
    } catch {
      output[key] = unreadableDiagnosticValue(state, `${path}.${key}`);
      continue;
    }
    if (descriptor && descriptor.enumerable === false) continue;
    if (secretField) {
      output[key] = "[REDACTED]";
      state.redactions += 1;
    } else if (!descriptor || !("value" in descriptor)) {
      output[key] = unreadableDiagnosticValue(state, `${path}.${key}`);
    } else {
      output[key] = sanitizeDiagnosticValue(descriptor.value, `${path}.${key}`, depth + 1, state);
    }
  }
  return output;
}

function normalizeDiagnosticError(
  error: Error,
  path: string,
  state: DiagnosticSanitizerState,
): Record<string, unknown> | null {
  let ownKeys: PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(error);
  } catch {
    return null;
  }

  const normalized: Record<string, unknown> = Object.create(null);
  const fixedFields = ["name", "message", "cause"] as const;
  for (const field of fixedFields) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(error, field);
    } catch {
      normalized[field] = unreadableDiagnosticValue(state, `${path}.${field}`);
      continue;
    }
    if (!descriptor) {
      if (field === "name") normalized.name = "Error";
      continue;
    }
    normalized[field] = "value" in descriptor
      ? descriptor.value
      : unreadableDiagnosticValue(state, `${path}.${field}`);
  }

  const extraKeys = ownKeys.filter(
    (key): key is string => typeof key === "string" && !fixedFields.includes(key as typeof fixedFields[number]),
  );
  for (const key of extraKeys.slice(0, DIAGNOSTIC_MAX_OBJECT_ENTRIES)) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(error, key);
    } catch {
      normalized[key] = unreadableDiagnosticValue(state, `${path}.${key}`);
      continue;
    }
    if (!descriptor?.enumerable) continue;
    normalized[key] = "value" in descriptor
      ? descriptor.value
      : unreadableDiagnosticValue(state, `${path}.${key}`);
  }
  return normalized;
}

function unreadableDiagnosticValue(
  state: DiagnosticSanitizerState,
  path: string,
  sentinel = "[UNREADABLE]",
): string {
  noteDiagnosticTruncation(state, path, "unreadable", 1, 0);
  return sentinel;
}

function sanitizeDiagnosticString(value: string, path: string, state: DiagnosticSanitizerState): string {
  const withoutControls = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  state.controlsRemoved += value.length - withoutControls.length;
  const pathLimit = diagnosticStringLimit(path);
  // Sanitization output is bounded, so inspecting an unbounded discarded tail
  // only creates a regex/URL-parser denial-of-service surface. Keep enough
  // prefix for structural detection while never returning decoded bytes.
  const inspectionLimit = Math.max(pathLimit, 4_096);
  let redacted = sanitizeEncodedDiagnosticTokens(
    withoutControls.slice(0, inspectionLimit),
    state,
  );
  redacted = redacted.replace(
    /\b[a-z][a-z0-9+.-]{1,31}:(?:\/\/|[^\s'"`<>])[^\s'"`<>]*/gi,
    (candidate) => sanitizeDiagnosticUrlCandidate(candidate, state),
  );
  const replacements: Array<[RegExp, string]> = [
    [/-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
    [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]"],
    [/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_TOKEN]"],
    [/\b((?:proxy-)?authorization)\s*[:=]\s*(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1: [REDACTED]"],
    [/\b(bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 [REDACTED]"],
    [/\b([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password|passwd)[A-Za-z0-9_-]*)\s*[:=]\s*['\"]?[^'\"\s,;]{4,}/gi, "$1=[REDACTED]"],
    [/([a-z][a-z0-9+.-]*:\/\/)[^/@\s:]+:[^/@\s]+@/gi, "$1***:***@"],
  ];
  for (const [pattern, replacement] of replacements) {
    const next = redacted.replace(pattern, replacement);
    if (next !== redacted) state.redactions += 1;
    redacted = next;
  }

  const remaining = Math.max(0, DIAGNOSTIC_MAX_CHARACTERS - state.characters);
  const retainedLength = Math.min(redacted.length, pathLimit, remaining);
  if (value.length > pathLimit || redacted.length > retainedLength) {
    noteDiagnosticTruncation(state, path, remaining === 0 ? "character_budget" : "string", value.length, retainedLength);
  }
  const result = redacted.slice(0, retainedLength);
  state.characters += result.length;
  return result;
}

function sanitizeDiagnosticUrlCandidate(candidate: string, state: DiagnosticSanitizerState): string {
  const suffix = candidate.match(/[),.;]+$/)?.[0] ?? "";
  const raw = suffix ? candidate.slice(0, -suffix.length) : candidate;
  state.redactions += 1;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return `[REDACTED_URL]${suffix}`;
  try {
    const url = new URL(raw);
    if (!url.hostname) return `[REDACTED_URL]${suffix}`;
    const userinfo = url.username || url.password ? "***:***@" : "";
    return `${url.protocol}//${userinfo}${url.host}/[REDACTED_PATH]`
      + (url.search ? "?[REDACTED_QUERY]" : "")
      + (url.hash ? "#[REDACTED_FRAGMENT]" : "")
      + suffix;
  } catch {
    return `[REDACTED_URL]${suffix}`;
  }
}

function sanitizeEncodedDiagnosticTokens(value: string, state: DiagnosticSanitizerState): string {
  return value.replace(/[^\s'"`<>]*%[0-9a-f]{2}[^\s'"`<>]*/gi, (candidate) => {
    // Decoding is detection-only and strictly bounded; decoded bytes are never
    // returned. Two passes catch nested percent encoding without amplification.
    let detected = candidate.slice(0, 2_048);
    for (let pass = 0; pass < 2; pass += 1) {
      try {
        detected = decodeURIComponent(detected);
      } catch {
        break;
      }
    }
    if (/[a-z][a-z0-9+.-]*:(?:\/\/|[^\s])/i.test(detected)
      || /(?:authorization|password|passwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key)/i.test(detected)) {
      state.redactions += 1;
      return "[REDACTED_ENCODED]";
    }
    return candidate;
  });
}

function diagnosticStringLimit(path: string): number {
  if (/\.schema_sql\[\d+\]$/.test(path)) return 4_096;
  if (/\.(?:schema|bucket)$/.test(path)) return 256;
  if (/\.region$/.test(path)) return 128;
  if (/\.prefix$/.test(path)) return 512;
  if (/\.(?:name|active_name|source)$/.test(path)) return 160;
  return 512;
}

function sanitizeDiagnosticKey(value: string, path: string, state: DiagnosticSanitizerState): string {
  const sanitized = sanitizeDiagnosticString(value, path, state);
  return sanitized || "[empty]";
}

function allocateDiagnosticOutputKey(
  candidate: string,
  output: Record<string, unknown>,
): string {
  if (!Object.prototype.hasOwnProperty.call(output, candidate)) return candidate;
  let ordinal = 2;
  while (Object.prototype.hasOwnProperty.call(output, `${candidate}#${ordinal}`)) ordinal += 1;
  return `${candidate}#${ordinal}`;
}

function diagnosticKeyCandidates(rawKey: string): string[] {
  // Overlength keys are handled conservatively by the caller without ever
  // consulting a discarded suffix. Decoding remains detection-only here.
  const candidates = [rawKey];
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      const decoded = decodeURIComponent(candidates[candidates.length - 1]!);
      if (decoded === candidates[candidates.length - 1]) break;
      candidates.push(decoded.slice(0, 2_048));
    } catch {
      break;
    }
  }
  return candidates;
}

function diagnosticKeyIsCredentialLike(candidate: string): boolean {
  const separated = candidate
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toLowerCase();
  if (!separated) return false;
  const tokens = separated.split(/\s+/);
  if (tokens.some((token) => DIAGNOSTIC_SECRET_KEY_TOKENS.has(token))) return true;
  const compact = tokens.join("");
  if (DIAGNOSTIC_SECRET_KEY_SUFFIXES.some((suffix) => compact.endsWith(suffix))) return true;
  return compact.endsWith("apikey")
    || compact.endsWith("accesskey")
    || compact.endsWith("privatekey")
    || compact.endsWith("signingkey")
    || compact.endsWith("encryptionkey")
    || compact.endsWith("setcookie");
}

function isDiagnosticSecretField(rawKey: string, parentPath: string): boolean {
  // The canonical field is a fixed-shape identifier, not a credential value.
  // No generic `$.env` subtree exemption exists: arbitrary nested payloads
  // must still redact password/token/secret keys.
  if (parentPath === "$.canonical" && rawKey === "runtimeSecretPath") return false;
  return diagnosticKeyCandidates(rawKey).some(diagnosticKeyIsCredentialLike);
}

function noteDiagnosticTruncation(
  state: DiagnosticSanitizerState,
  path: string,
  kind: DiagnosticTruncation["kind"],
  original: number,
  retained: number,
): void {
  if (state.truncations.length < DIAGNOSTIC_MAX_TRUNCATION_ENTRIES) {
    state.truncations.push({
      path: boundDiagnosticTruncationPath(path),
      kind,
      original,
      retained,
    });
  } else {
    state.omittedTruncations += 1;
  }
}

/**
 * Truncation metadata is output too. Keep enough root and leaf context to find
 * the affected field without allowing attacker-controlled nested keys to turn
 * a bounded payload into an unbounded diagnostics side channel.
 */
function boundDiagnosticTruncationPath(path: string): string {
  if (path.length <= DIAGNOSTIC_MAX_TRUNCATION_PATH_CHARACTERS) return path;
  const marker = `...[path:${path.length}]...`;
  const remaining = DIAGNOSTIC_MAX_TRUNCATION_PATH_CHARACTERS - marker.length;
  const head = Math.ceil(remaining / 2);
  const tail = Math.floor(remaining / 2);
  return `${path.slice(0, head)}${marker}${path.slice(-tail)}`;
}

function snapshotStorageEnvironment(env: TodosStorageEnv): { env: TodosStorageEnv; issues: string[] } {
  const snapshot: TodosStorageEnv = {};
  const issues: string[] = [];
  const names = new Set([
    ...Object.values(TODOS_STORAGE_ENV),
    ...Object.values(TODOS_STORAGE_FALLBACK_ENV),
  ]);
  for (const name of names) {
    try {
      snapshot[name] = env[name];
    } catch {
      issues.push(`${name}: HOSTED_AUTHORITY_UNAVAILABLE: unreadable_environment`);
      break;
    }
  }
  return { env: snapshot, issues };
}

function storageEnvStatus(env: TodosStorageEnv): Record<keyof typeof TODOS_STORAGE_ENV, NativeStorageEnvStatus> {
  return Object.fromEntries(
    Object.entries(TODOS_STORAGE_ENV).map(([key, name]) => [
      key,
      {
        name,
        active_name: getTodosStorageEnvName(env, key as keyof typeof TODOS_STORAGE_ENV),
        configured: Boolean(clean(env[getTodosStorageEnvName(env, key as keyof typeof TODOS_STORAGE_ENV)])),
      },
    ]),
  ) as Record<keyof typeof TODOS_STORAGE_ENV, NativeStorageEnvStatus>;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
