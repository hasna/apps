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
 * Bounded records: every persisted field is bounded before it reaches the
 * SDK — title, content (byte-bound), tag count and length, metadata key
 * count and value shape (primitives only, strings bounded), and failure
 * messages. Credential-prefix values and sensitive metadata keys are
 * redacted so raw environment data, command arguments or oversized output
 * cannot persist as Knowledge content.
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
const MAX_METADATA_STRING_LENGTH = 512;
const MAX_ERROR_MESSAGE_LENGTH = 2000;

const REDACTED = "[REDACTED]";

/**
 * Credential-prefix patterns, length-gated so the safe placeholder form
 * (`${NPM_TOKEN}` and friends) never matches. A bare high-entropy value has
 * no recognisable prefix and is out of scope for a pattern list by
 * construction; the sensitive-key rule below covers it in metadata.
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /sk-proj-[A-Za-z0-9_-]{10,}/g,
  /npm_[A-Za-z0-9]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /gho_[A-Za-z0-9]{20,}/g,
  /xai-[A-Za-z0-9_-]{10,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /ctx7sk-[A-Za-z0-9_-]{10,}/g,
];

/** Metadata keys whose values are redacted regardless of shape. */
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
  "api-key",
  "auth",
  "authorization",
  "credentials",
  "credential",
  "private_key",
  "private-key",
  "access_key",
  "access-key",
  "client_secret",
  "client-secret",
  "authorization_header",
]);

function redactSecrets(value: string): string {
  let out = value;
  for (const pattern of CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

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

/**
 * Metadata allowlist: only primitive values are persisted (objects, arrays
 * and undefined are dropped), string values are bounded and redacted, and
 * sensitive keys are redacted regardless of value. Key count is bounded.
 */
function sanitizeMetadata(input: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!input) return out;
  for (const key of Object.keys(input)) {
    if (Object.keys(out).length >= MAX_METADATA_KEYS) break;
    const value = input[key];
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      if (SECRET_METADATA_KEYS.has(key.toLowerCase())) {
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
        const title = sanitizeTitle(request.title);
        const content = sanitizeContent(request.content);
        const tags = sanitizeTags([...(config.tags ?? []), ...(request.tags ?? [])]);
        const metadata = sanitizeMetadata(request.metadata);
        if (config.collectionId !== undefined) {
          metadata.collectionId = config.collectionId;
        }

        if (request.id !== undefined) {
          // The local transport's `items.create` appends a new row without an
          // existing-id lookup, so idempotency cannot be delegated to the SDK:
          // look the stable id up first and update the existing item instead of
          // duplicating. The API transport upserts server-side, so this path is
          // correct on both transports.
          const existing = await client.items.get(request.id);
          if (existing !== null) {
            const updated = await client.items.update(request.id, { title, content, tags, metadata });
            if (updated !== null) {
              return { ok: true, value: { id: updated.id, title: updated.title } };
            }
            // The item disappeared between the get and the update: fall through
            // and recreate it so the effect record still exists.
          }
        }

        const created = await client.items.create({
          id: request.id,
          title,
          content,
          tags,
          metadata,
        });
        return { ok: true, value: { id: created.id, title: created.title } };
      } catch (error) {
        return failure(error);
      }
    },
  };
}
