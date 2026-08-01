/**
 * Redaction helpers for data that is about to cross a persistence boundary.
 *
 * Callers should register every secret value resolved for a run. Key-based and
 * token-shaped redaction is defense in depth for values the caller did not
 * register. The returned values are copies; input records are never mutated.
 */

export const REDACTED_SECRET_VALUE = "***REDACTED***";

export interface PersistenceRedactionOptions {
  /** Raw values resolved for the current run. Every non-empty value is removed. */
  secretValues?: Iterable<string | null | undefined>;
  /** Additional field names whose values must always be replaced. */
  sensitiveKeys?: Iterable<string>;
  /** Marker stored in place of a secret. */
  replacement?: string;
}

export interface PersistenceRedactionHooks {
  run<T>(record: T): T;
  stdout(value: string): string;
  stderr(value: string): string;
  error<T>(record: T): T;
  audit<T>(record: T): T;
  event<T>(record: T): T;
}

export interface PersistenceRedactor {
  redactText(value: string): string;
  redact<T>(value: T): T;
  /**
   * Boundary-specific aliases intended to be placed immediately before the
   * corresponding store/append/publish call.
   */
  hooks: PersistenceRedactionHooks;
}

const DEFAULT_SENSITIVE_KEYS = [
  "accessToken",
  "apiKey",
  "authorization",
  "authorizationHeader",
  "authToken",
  "clientSecret",
  "cookie",
  "credential",
  "credentials",
  "databaseUrl",
  "password",
  "passwd",
  "passphrase",
  "privateKey",
  "refreshToken",
  "secret",
  "secretAccessKey",
  "secretKey",
  "secretRef",
  "secretValue",
  "secrets",
  "sessionToken",
  "setCookie",
  "signingSecret",
  "token",
  "totp",
  "webhookSecret",
].map(normalizeKey);

const SENSITIVE_KEY_SUFFIX = /(?:accesskey|accesstoken|apikey|authtoken|clientsecret|password|passwd|passphrase|privatekey|refreshtoken|secretaccesskey|secretkey|secretvalue|sessiontoken|signingsecret|token|webhooksecret)$/;

const TEXT_SENSITIVE_KEY = [
  "access[_-]?token",
  "api[_-]?key",
  "authorization",
  "auth[_-]?token",
  "client[_-]?secret",
  "cookie",
  "credentials?",
  "database[_-]?url",
  "pass(?:word|wd|phrase)",
  "private[_-]?key",
  "refresh[_-]?token",
  "secret(?:[_-]?(?:access[_-]?key|key|ref|value))?",
  "session[_-]?token",
  "signing[_-]?secret",
  "token",
  "totp",
  "webhook[_-]?secret",
].join("|");

const PEM_PRIVATE_KEY_PATTERN = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g;
const PRIVATE_KEY_MARKER_PATTERN = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*$/g;
const TOKEN_SHAPE_PATTERN = /(?:sk-(?:proj-)?[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|[sr]k_(?:live|test)_[0-9A-Za-z]{10,}|gh[opusr]_[A-Za-z0-9_]{8,}|npm_[A-Za-z0-9_]{8,}|AIza[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{8,}|xai-[A-Za-z0-9_-]{8,}|ctx7sk-[A-Za-z0-9_-]{8,}|secret-token:[^\s'"]{1,})/gi;
const AUTHORIZATION_PATTERN = /(\b(?:proxy-)?authorization\s*[:=]\s*)(?:(?:bearer|basic)\s+)?([^\s,'"}]+)/gi;
const URL_USERINFO_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi;
const QUERY_SECRET_PATTERN = new RegExp(`([?&](?:${TEXT_SENSITIVE_KEY})=)([^&#\\s]*)`, "gi");
const QUOTED_SECRET_PATTERN = new RegExp(
  `((?:["'])?(?:[A-Za-z0-9_.-]*(?:${TEXT_SENSITIVE_KEY}))(?:["'])?\\s*[:=]\\s*)(["'])(.*?)\\2`,
  "gi",
);
const UNQUOTED_SECRET_PATTERN = new RegExp(
  `(\\b[A-Za-z0-9_.-]*(?:${TEXT_SENSITIVE_KEY})\\b\\s*[:=]\\s*)(?!["'])([^\\s,;}\\]]+)`,
  "gi",
);

/** Create one redactor per run and use its hooks immediately before writes. */
export function createPersistenceRedactor(
  options: PersistenceRedactionOptions = {},
): PersistenceRedactor {
  const replacement = options.replacement ?? REDACTED_SECRET_VALUE;
  const secretValues = [...new Set(
    [...(options.secretValues ?? [])]
      .filter((value): value is string => typeof value === "string" && value.length > 0 && value !== replacement),
  )].sort((left, right) => right.length - left.length);
  const sensitiveKeys = new Set([
    ...DEFAULT_SENSITIVE_KEYS,
    ...[...(options.sensitiveKeys ?? [])].map(normalizeKey),
  ]);

  const redactText = (value: string): string => {
    let redacted = value;
    for (const secret of secretValues) redacted = redacted.split(secret).join(replacement);
    redacted = redacted.replace(PEM_PRIVATE_KEY_PATTERN, replacement);
    redacted = redacted.replace(PRIVATE_KEY_MARKER_PATTERN, replacement);
    redacted = redacted.replace(TOKEN_SHAPE_PATTERN, replacement);
    redacted = redacted.replace(AUTHORIZATION_PATTERN, (_match, prefix: string) => `${prefix}${replacement}`);
    redacted = redacted.replace(URL_USERINFO_PATTERN, (_match, prefix: string, _password: string, suffix: string) => (
      `${prefix}${replacement}${suffix}`
    ));
    redacted = redacted.replace(QUERY_SECRET_PATTERN, (_match, prefix: string) => `${prefix}${replacement}`);
    redacted = redacted.replace(
      QUOTED_SECRET_PATTERN,
      (_match, prefix: string, quote: string) => `${prefix}${quote}${replacement}${quote}`,
    );
    redacted = redacted.replace(UNQUOTED_SECRET_PATTERN, (_match, prefix: string) => `${prefix}${replacement}`);
    return redacted;
  };

  const isSensitiveKey = (key: string): boolean => {
    const normalized = normalizeKey(key);
    return sensitiveKeys.has(normalized) || SENSITIVE_KEY_SUFFIX.test(normalized);
  };

  const redact = <T>(value: T): T => redactValue(
    value,
    redactText,
    isSensitiveKey,
    replacement,
    new WeakMap<object, unknown>(),
  );
  const hooks: PersistenceRedactionHooks = Object.freeze({
    run: redact,
    stdout: redactText,
    stderr: redactText,
    error: redact,
    audit: redact,
    event: redact,
  });

  return Object.freeze({ redactText, redact, hooks });
}

/** Redact a single value without retaining a per-run redactor. */
export function redactForPersistence<T>(
  value: T,
  options: PersistenceRedactionOptions = {},
): T {
  return createPersistenceRedactor(options).redact(value);
}

/** Redact stdout, stderr, error messages, or other unstructured text. */
export function redactTextForPersistence(
  value: string,
  options: PersistenceRedactionOptions = {},
): string {
  return createPersistenceRedactor(options).redactText(value);
}

function redactValue<T>(
  value: T,
  redactText: (value: string) => string,
  isSensitiveKey: (key: string) => boolean,
  replacement: string,
  seen: WeakMap<object, unknown>,
): T {
  if (typeof value === "string") return redactText(value) as T;
  if (value === null || typeof value !== "object") return value;

  const existing = seen.get(value);
  if (existing !== undefined) return existing as T;

  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value instanceof RegExp) return new RegExp(value.source, value.flags) as T;
  if (value instanceof Uint8Array) {
    const redacted = new TextEncoder().encode(redactText(new TextDecoder().decode(value)));
    return (Buffer.isBuffer(value) ? Buffer.from(redacted) : redacted) as T;
  }
  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [key, entry] of value) {
      const outputKey = redactValue(key, redactText, isSensitiveKey, replacement, seen);
      const outputValue = typeof key === "string" && isSensitiveKey(key) && entry != null
        ? replacement
        : redactValue(entry, redactText, isSensitiveKey, replacement, seen);
      copy.set(outputKey, outputValue);
    }
    return copy as T;
  }
  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    for (const entry of value) copy.add(redactValue(entry, redactText, isSensitiveKey, replacement, seen));
    return copy as T;
  }

  const copy: Record<PropertyKey, unknown> = Array.isArray(value)
    ? []
    : Object.create(Object.getPrototypeOf(value));
  seen.set(value, copy);

  for (const key of Reflect.ownKeys(value)) {
    // A fresh array already owns its non-configurable length property; indexed
    // properties below update it naturally.
    if (Array.isArray(copy) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    const outputKey = typeof key === "string" ? redactText(key) : key;
    let outputValue: unknown;
    try {
      outputValue = "value" in descriptor ? descriptor.value : Reflect.get(value, key);
    } catch {
      outputValue = undefined;
    }
    if (typeof key === "string" && isSensitiveKey(key) && outputValue != null) {
      outputValue = replacement;
    } else {
      outputValue = redactValue(outputValue, redactText, isSensitiveKey, replacement, seen);
    }
    Object.defineProperty(copy, outputKey, {
      value: outputValue,
      enumerable: descriptor.enumerable,
      configurable: true,
      writable: true,
    });
  }
  return copy as T;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}
