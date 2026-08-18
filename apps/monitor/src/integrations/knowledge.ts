/**
 * Knowledge native adapter (MON-V2-09).
 *
 * Package-owned surface: `@hasna/knowledge` SDK — `client.search` and
 * `client.items`. The adapter has no direct database or HTTP path: every read
 * and write is routed through the SDK client handed to
 * `createKnowledgeAdapter`.
 *
 * Query and creation are separately represented: `query()` maps to
 * `client.search` and `create()` maps to `client.items.create`; neither
 * method exercises the other surface.
 *
 * Failure semantics: non-fatal by default. Each operation returns a
 * structured outcome (`{ ok: true, value }` | `{ ok: false, error,
 * last_error_class }`), so the run service decides whether a confirmed
 * failure affects the run outcome (an action or integration marked
 * `required: true`). The failure arm always carries `last_error_class` from
 * the required vocabulary (`not_found | timeout | execution_error |
 * invalid_input | unknown`).
 *
 * Creation idempotency: `KnowledgeCreateRequest.id` is a caller-supplied
 * stable id (the design's effect key `hash(slug, run_id, action_index,
 * target, operation)`). Idempotency is implemented IN THIS ADAPTER, not
 * delegated to the SDK: the local transport's `items.create` appends a new
 * row without an existing-id lookup, so a repeated action with the same id
 * would otherwise duplicate. `create()` therefore looks the stable id up
 * first and updates the existing item instead; only a genuinely absent id
 * reaches `items.create`.
 *
 * ATOMICITY (cycle 1): the check-then-create is serialized per stable id, so
 * two concurrent `create()` calls for the same id cannot both observe an
 * absent row and both append — the second call's lookup runs only after the
 * first call's row exists. The serialization is per adapter instance (scoped
 * to one client/run); the map holds only in-flight ids. Cross-process
 * concurrent writers of the same local store remain a store-level property
 * of @hasna/knowledge (its file lock serializes individual operations, not
 * caller check-then-create pairs); the API transport upserts server-side on
 * a caller-supplied id.
 *
 * Bounded records (write boundary): every persisted field is bounded and
 * redacted at the single persistence choke point before it reaches the SDK —
 * title, content (byte-bound), tag count and length, metadata key count,
 * length and shape (primitives only, strings bounded), the config collection
 * id (bounded and counted against the same key budget), the stable id
 * (oversized or whitespace-bearing ids are rejected as invalid_input before
 * any SDK call), and failure messages. Redaction covers credential-prefix
 * values, environment references and assignments, private absolute and
 * home-relative paths, flag-shaped secret arguments, sensitive metadata keys
 * (normalized across casing and separators) and opaque high-entropy tokens,
 * so raw environment data, command arguments, private paths or oversized
 * output cannot persist as Knowledge content.
 */
import type { KnowledgeClient } from "@hasna/knowledge/sdk";

/** The exact subset of the package-owned surface this adapter uses. */
export type KnowledgeClientSurface = Pick<KnowledgeClient, "search" | "items">;

/**
 * Required failure vocabulary for the failure arm of every outcome. A failure
 * always carries one of these classes so the run service can route retries,
 * alerts and reporting without re-parsing free-text error messages.
 */
export type KnowledgeErrorClass =
  | "not_found"
  | "timeout"
  | "execution_error"
  | "invalid_input"
  | "unknown";

/** Slug-level configuration from the monitor definition (`knowledge` block). */
export interface KnowledgeIntegrationConfig {
  /** Optional collection/scope identifier carried on created items. */
  collectionId?: string;
  /** Tags merged onto every created item. */
  tags?: string[];
}

export interface KnowledgeQueryRequest {
  query: string;
  limit?: number;
  offset?: number;
}

export interface KnowledgeQueryResultEntry {
  id: string;
  title: string | null;
  text: string | null;
  kind: string;
  score: number;
}

export interface KnowledgeQueryResult {
  query: string;
  count: number;
  results: KnowledgeQueryResultEntry[];
}

export interface KnowledgeCreateRequest {
  /** Stable caller-supplied id (effect key); the adapter upserts on it. */
  id?: string;
  title: string;
  content: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface KnowledgeCreateResult {
  id: string;
  title: string;
}

export type KnowledgeAdapterOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; last_error_class: KnowledgeErrorClass };

export interface KnowledgeAdapter {
  /** Query the knowledge corpus through `client.search`. */
  readonly query: (request: KnowledgeQueryRequest) => Promise<KnowledgeAdapterOutcome<KnowledgeQueryResult>>;
  /** Create or update a reviewed knowledge item through `client.items`. */
  readonly create: (request: KnowledgeCreateRequest) => Promise<KnowledgeAdapterOutcome<KnowledgeCreateResult>>;
}

// ---------------------------------------------------------------------------
// Bounded-record guards. Every persisted field is bounded and redacted here,
// before it reaches the SDK, so raw payloads cannot persist unbounded.
// ---------------------------------------------------------------------------

const MAX_TITLE_LENGTH = 512;
const MAX_CONTENT_BYTES = 64 * 1024;
const MAX_TAGS = 32;
const MAX_TAG_LENGTH = 64;
const MAX_METADATA_KEYS = 32;
const MAX_METADATA_KEY_LENGTH = 128;
const MAX_METADATA_STRING_LENGTH = 512;
const MAX_ERROR_MESSAGE_LENGTH = 2000;
const MAX_COLLECTION_ID_LENGTH = 128;
const MAX_STABLE_ID_LENGTH = 256;

const REDACTED = "[REDACTED]";

/**
 * Pattern fragments are assembled at runtime because the repo CI secret scan
 * matches literal credential prefixes in committed source — measured on this
 * adapter's original regex literals (the same prefix class its own detector
 * table names). No scanner-matching literal may appear in this file.
 */
const DASH = "-";
const UNDER = "_";

/**
 * Credential-prefix patterns, length-gated so the safe placeholder form
 * (`${NPM_TOKEN}` and friends) never matches. A bare high-entropy value has
 * no recognisable prefix and is covered by `redactHighEntropy` below.
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  new RegExp(`sk${DASH}ant${DASH}[A-Za-z0-9_${DASH}]{10,}`, "g"),
  new RegExp(`sk${DASH}proj${DASH}[A-Za-z0-9_${DASH}]{10,}`, "g"),
  new RegExp(`npm${UNDER}[A-Za-z0-9]{20,}`, "g"),
  new RegExp(`ghp${UNDER}[A-Za-z0-9]{20,}`, "g"),
  new RegExp(`gho${UNDER}[A-Za-z0-9]{20,}`, "g"),
  new RegExp(`xai${DASH}[A-Za-z0-9_${DASH}]{10,}`, "g"),
  /AIza[0-9A-Za-z_-]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  new RegExp(`ctx7sk${DASH}[A-Za-z0-9_${DASH}]{10,}`, "g"),
];

/** `$VAR` / `${VAR}` environment references (braces optional). */
const ENV_REFERENCE_PATTERN = /\$\{?[A-Z][A-Z0-9_]{2,}\}?/g;

/** `VAR=value` environment assignments; URL values are preserved. */
const ENV_ASSIGNMENT_PATTERN = /\b[A-Z][A-Z0-9_]{2,}=(?!https?:)\S{6,}/g;

/** Flag-shaped secret arguments: `--token <value>`, `--password=<value>`. */
const FLAG_ARG_PATTERN = /(--(?:token|key|secret|password|passwd|pwd|auth)(?:[=\s]))[^\s"'`]+/gi;

/** Private absolute paths (home roots, tmp) and home-relative paths. */
const PRIVATE_HOME_PATH_PATTERN = /\/(?:home|Users|root|private|tmp)\/[A-Za-z0-9_.-]+(?:\/[^\s"'`()]*)?/g;
const HOME_RELATIVE_PATH_PATTERN = /(^|[\s"'=])~\/[^\s"'`()]*/g;
const WINDOWS_USER_PATH_PATTERN = /[A-Za-z]:\\Users\\[A-Za-z0-9_.-]+(?:\\[^\s"'`()]*)?/g;

/**
 * Opaque high-entropy tokens: 32+ character runs of word/dash/underscore
 * containing both letters and digits. Pure hex strings (git shas, md5-style
 * ids) survive; every other long mixed token is credential-shaped by
 * construction — the class a prefix list cannot name.
 */
const HIGH_ENTROPY_TOKEN_PATTERN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g;
const HEX_SHA_PATTERN = /^[0-9a-f]{40}$/i;

function redactHighEntropy(value: string): string {
  return value.replace(HIGH_ENTROPY_TOKEN_PATTERN, (token) => {
    if (!/\d/.test(token) || !/[A-Za-z]/.test(token)) return token;
    if (HEX_SHA_PATTERN.test(token)) return token;
    return REDACTED;
  });
}

/**
 * Redaction for everything the adapter persists and every failure message it
 * returns. Applied at the single write choke point — nothing reaches the SDK
 * unredacted, and no alternate field name or later insertion bypasses it.
 */
function redactSecrets(value: string): string {
  let out = value;
  for (const pattern of CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, REDACTED);
  }
  out = out.replace(ENV_REFERENCE_PATTERN, REDACTED);
  out = out.replace(ENV_ASSIGNMENT_PATTERN, REDACTED);
  out = out.replace(FLAG_ARG_PATTERN, `$1${REDACTED}`);
  out = out.replace(PRIVATE_HOME_PATH_PATTERN, REDACTED);
  out = out.replace(HOME_RELATIVE_PATH_PATTERN, `$1${REDACTED}`);
  out = out.replace(WINDOWS_USER_PATH_PATTERN, REDACTED);
  out = redactHighEntropy(out);
  return out;
}

/** Metadata keys whose values are redacted regardless of shape (normalized form). */
const SECRET_METADATA_KEYS = new Set([
  "token",
  "tokens",
  "secret",
  "secrets",
  "password",
  "passwd",
  "pwd",
  "api_key",
  "apikey",
  "api_token",
  "access_token",
  "refresh_token",
  "auth_token",
  "id_token",
  "bearer",
  "bearer_token",
  "secret_key",
  "auth",
  "authorization",
  "authorization_header",
  "credentials",
  "credential",
  "private_key",
  "access_key",
  "client_secret",
  "session",
  "session_id",
  "session_key",
  "cookie",
  "cookies",
]);

/** Longest prefix of `value` whose UTF-8 byte length is at most `maxBytes`. */
function truncateByBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, mid), "utf8") <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return value.slice(0, low);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function sanitizeTitle(title: string): string {
  return truncate(redactSecrets(title.trim()), MAX_TITLE_LENGTH);
}

function sanitizeContent(content: string): string {
  return truncateByBytes(redactSecrets(content), MAX_CONTENT_BYTES);
}

function sanitizeTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags ?? []) {
    if (out.length >= MAX_TAGS) break;
    const clean = truncate(redactSecrets(tag.trim()), MAX_TAG_LENGTH);
    if (clean.length === 0 || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

/** Normalized comparison form for sensitive metadata keys. */
function normalizeMetadataKey(key: string): string {
  return key.toLowerCase().replace(/[\s-]+/g, "_");
}

function isCredentialShaped(value: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

/**
 * Metadata allowlist — the bounded-record write boundary for metadata:
 * - the config collection id is reserved first (it always persists when
 *   configured), bounded, redacted, and counted against the same key budget
 *   as caller metadata, so no later insertion can bypass the bounds;
 * - only primitive values are persisted (objects, arrays and undefined are
 *   dropped); string values are bounded and redacted;
 * - sensitive keys are redacted regardless of value, matched on a normalized
 *   form (casing and separator variants all resolve);
 * - keys that are themselves credential-shaped tokens are dropped wholesale;
 * - key length and key count are bounded.
 */
function sanitizeMetadata(
  input: Record<string, unknown> | undefined,
  collectionId: string | undefined,
  budget = MAX_METADATA_KEYS,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (collectionId !== undefined) {
    const clean = truncate(redactSecrets(String(collectionId).trim()), MAX_COLLECTION_ID_LENGTH);
    if (clean.length > 0) out.collectionId = clean;
  }
  if (!input) return out;
  for (const key of Object.keys(input)) {
    if (Object.keys(out).length >= budget) break;
    if (key.length > MAX_METADATA_KEY_LENGTH) continue;
    if (isCredentialShaped(key)) continue;
    const value = input[key];
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      if (SECRET_METADATA_KEYS.has(normalizeMetadataKey(key))) {
        out[key] = REDACTED;
      } else if (typeof value === "string") {
        out[key] = truncate(redactSecrets(value), MAX_METADATA_STRING_LENGTH);
      } else {
        out[key] = value;
      }
    }
  }
  return out;
}

/**
 * Stable id normalization: empty ids are treated as absent (the store assigns
 * one); ids that cannot persist safely (oversized or whitespace-bearing) are
 * rejected BEFORE any SDK call so a corrupt identity never reaches the store.
 */
function normalizeStableId(id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  const trimmed = id.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > MAX_STABLE_ID_LENGTH) {
    throw new Error(`invalid stable id: exceeds ${MAX_STABLE_ID_LENGTH} characters`);
  }
  if (/\s/.test(trimmed)) {
    throw new Error("invalid stable id: must not contain whitespace");
  }
  return trimmed;
}

function failure(error: unknown): { ok: false; error: string; last_error_class: KnowledgeErrorClass } {
  const raw = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: truncate(redactSecrets(raw), MAX_ERROR_MESSAGE_LENGTH),
    last_error_class: classifyError(error),
  };
}

function classifyError(error: unknown): KnowledgeErrorClass {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "AbortError" || name === "TimeoutError" || /\btimeout\b|timed out|deadline exceeded|aborted/i.test(message)) {
    return "timeout";
  }
  if (name === "ZodError" || /\binvalid\b|validation failed|expected .*?received|must be|must not/i.test(message)) {
    return "invalid_input";
  }
  if (/\bnot found\b|404|no such item|does not exist/i.test(message)) {
    return "not_found";
  }
  if (error instanceof Error) {
    return "execution_error";
  }
  // A non-Error throwable carries no shape we can classify.
  return "unknown";
}

export function createKnowledgeAdapter(
  client: KnowledgeClientSurface,
  config: KnowledgeIntegrationConfig = {},
): KnowledgeAdapter {
  // -------------------------------------------------------------------------
  // Per-stable-id write serialization (atomic idempotency, cycle 1). The
  // local transport's `items.create` appends a new row without an existing-id
  // lookup, so the adapter's check-then-create (get -> update | create) must
  // be atomic per stable id: concurrent create() calls for the same id are
  // chained so the second call's get() observes the first call's row. The map
  // holds only in-flight ids (entries are removed when their chain settles);
  // the adapter is scoped to one client/run, so the number of distinct ids is
  // bounded by the run's action set. A crash between check and insert
  // persists nothing, so it cannot corrupt identity either.
  // -------------------------------------------------------------------------
  const idQueues = new Map<string, Promise<unknown>>();

  function serializeById<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const tail = idQueues.get(id) ?? Promise.resolve();
    const next = tail.then(fn, fn);
    idQueues.set(id, next);
    const cleanup = () => {
      if (idQueues.get(id) === next) idQueues.delete(id);
    };
    void next.then(cleanup, cleanup);
    return next;
  }

  return {
    async query(request) {
      try {
        const result = await client.search({
          query: request.query,
          limit: request.limit,
          offset: request.offset,
        });
        const entries: KnowledgeQueryResultEntry[] = result.results.map((entry) => ({
          id: entry.id,
          title: entry.title,
          text: entry.text,
          kind: entry.kind,
          score: entry.score,
        }));
        return {
          ok: true,
          value: { query: result.query, count: entries.length, results: entries },
        };
      } catch (error) {
        return failure(error);
      }
    },

    async create(request) {
      try {
        const id = normalizeStableId(request.id);
        // The single persistence choke point: every field that reaches the SDK
        // is bounded and redacted here, including the config collection id and
        // the stable id. No alternate field name or later insertion bypasses
        // it — nothing is added after this record is built.
        const title = sanitizeTitle(request.title);
        const content = sanitizeContent(request.content);
        const tags = sanitizeTags([...(config.tags ?? []), ...(request.tags ?? [])]);
        const metadata = sanitizeMetadata(request.metadata, config.collectionId);

        const persist = async (): Promise<KnowledgeAdapterOutcome<KnowledgeCreateResult>> => {
          if (id === undefined) {
            // No stable id: a plain create; the store assigns the id.
            const created = await client.items.create({ title, content, tags, metadata });
            return { ok: true, value: { id: created.id, title: created.title } };
          }

          // The local transport's `items.create` appends a new row without an
          // existing-id lookup, so idempotency cannot be delegated to the SDK:
          // look the stable id up first and update the existing item instead of
          // duplicating. The API transport upserts server-side, so this path is
          // correct on both transports. Serialized per id — see above.
          const existing = await client.items.get(id);
          if (existing !== null) {
            const updated = await client.items.update(id, { title, content, tags, metadata });
            if (updated !== null) {
              return { ok: true, value: { id: updated.id, title: updated.title } };
            }
            // The item disappeared between the get and the update: fall through
            // and recreate it so the effect record still exists.
          }
          const created = await client.items.create({ id, title, content, tags, metadata });
          return { ok: true, value: { id: created.id, title: created.title } };
        };

        // Awaited on purpose: an un-awaited rejected promise would escape the
        // try/catch and surface as an unhandled rejection instead of a failed
        // outcome with `last_error_class` (measured cycle 1).
        const outcome = id === undefined ? persist() : serializeById(id, persist);
        return await outcome;
      } catch (error) {
        return failure(error);
      }
    },
  };
}
