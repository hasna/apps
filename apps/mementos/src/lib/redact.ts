// ============================================================================
// Secret redaction — auto-detect and replace secrets before storing memories
// ============================================================================

import type { Memory } from "../types/index.js";

const REDACTED = "[REDACTED]";

const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  // OpenAI API keys
  { name: "openai_key", pattern: /sk-[a-zA-Z0-9_-]{20,}/g },
  // Anthropic API keys
  { name: "anthropic_key", pattern: /sk[-]ant[-][a-zA-Z0-9_-]{20,}/g },
  // Generic API key prefixes
  { name: "generic_key", pattern: /(?:pk|tok|key|token|api[_-]?key)[_-][a-zA-Z0-9_-]{16,}/gi },
  // AWS access keys
  { name: "aws_key", pattern: /AKIA[A-Z0-9]{16}/g },
  // AWS secret keys (40-char base64)
  { name: "aws_secret", pattern: /(?<=AWS_SECRET_ACCESS_KEY\s*=\s*)[A-Za-z0-9/+=]{40}/g },
  // GitHub tokens
  { name: "github_token", pattern: /gh[ps]_[a-zA-Z0-9]{36,}/g },
  { name: "github_oauth", pattern: /gho[_][a-zA-Z0-9]{36,}/g },
  // npm tokens
  { name: "npm_token", pattern: /npm_[a-zA-Z0-9]{36,}/g },
  // Bearer tokens in headers
  { name: "bearer", pattern: /Bearer\s+[a-zA-Z0-9_\-.]{20,}/g },
  // Connection strings with credentials
  { name: "conn_string", pattern: /(?:postgres|postgresql|mysql|mongodb|redis|amqp|mqtt):\/\/[^\s"'`]+@[^\s"'`]+/gi },
  // .env style secrets (KEY=value where KEY contains SECRET, TOKEN, PASSWORD, API_KEY, etc.)
  { name: "env_secret", pattern: /(?:SECRET|TOKEN|PASSWORD|PASSPHRASE|API_KEY|PRIVATE_KEY|AUTH|CREDENTIAL)[_A-Z]*\s*=\s*["']?[^\s"'\n]{8,}["']?/gi },
  // Stripe keys
  { name: "stripe_key", pattern: /(?:sk|pk|rk)_(?:test|live)_[a-zA-Z0-9]{20,}/g },
  // Slack tokens
  { name: "slack_token", pattern: /xox[bpras]-[a-zA-Z0-9-]{20,}/g },
  // JWT tokens (3 base64 parts separated by dots)
  { name: "jwt", pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },
  // Hex-encoded secrets (32+ chars that look like hashes/tokens)
  { name: "hex_secret", pattern: /(?<=(?:key|token|secret|password|hash)\s*[:=]\s*["']?)[0-9a-f]{32,}(?=["']?)/gi },
];

/**
 * The HIGH-CONFIDENCE standalone-token shapes: unambiguous prefixes that a
 * real credential carries (registry tokens, GitHub/AWS/OpenAI/Anthropic/Stripe/
 * Slack tokens, JWTs). This subset is what a MEMORY KEY or a TAG may be tested
 * against. The broad {@link SECRET_PATTERNS} set additionally contains
 * heuristic shapes — `generic_key` (`key-…16+ chars`), `env_secret`
 * (`SECRET=value`), `hex_secret` — that are correct for INLINE free text but
 * FALSE-POSITIVE on a short identifier: a benign auto-generated key like
 * `short-key-test-content-here` matches `generic_key` and would be stored/
 * displayed as `short-[REDACTED]`. Acceptance criterion 5 requires ordinary
 * keys and tags to be preserved, so identifiers use ONLY this conservative
 * set (which still covers every incident-detector shape that fires on the
 * high-confidence token prefixes).
 */
const KEY_TAG_SECRET_PATTERNS: { name: string; pattern: RegExp }[] =
  SECRET_PATTERNS.filter((p) =>
    new Set([
      "openai_key",
      "anthropic_key",
      "aws_key",
      "github_token",
      "github_oauth",
      "npm_token",
      "stripe_key",
      "slack_token",
      "jwt",
    ]).has(p.name),
  );

/**
 * Detect and redact secrets from text.
 * Returns the text with secrets replaced by [REDACTED].
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const { pattern } of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

/**
 * Redact a credential-shaped MEMORY KEY or TAG. Uses only the conservative
 * high-confidence token shapes (see {@link KEY_TAG_SECRET_PATTERNS}) so
 * ordinary identifiers survive untouched — the broad set's heuristic patterns
 * false-positive on benign keys/tags that merely contain the substrings
 * `key-`, `token-`, `SECRET=`, etc.
 */
export function redactCredentialKey(text: string): string {
  let result = text;
  for (const { pattern } of KEY_TAG_SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

/**
 * Check if text contains any detectable secrets.
 */
export function containsSecrets(text: string): boolean {
  for (const { pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
}

/**
 * Redact every string leaf of a JSON value (metadata, nested objects, arrays)
 * in place of a plain JSON round-trip, which risks breaking when a value
 * straddles the pattern boundary.
 */
function redactValueTree(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactValueTree);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValueTree(v);
    }
    return out;
  }
  return value;
}

/**
 * Return a display-safe copy of a memory for READ surfaces (list, search,
 * show, recall, tail, chain, versions, when-to-use, pin/unpin/archive/update/
 * save receipts). The write path redacts `value`/`summary` at save time but
 * historically NEVER the `key` — and both TAGS and `key` are storable raw via
 * `save --tags` / `update --tags` and via any bypassing write path — so a
 * credential-shaped key OR TAG can otherwise reach stdout verbatim and trip
 * the high-confidence token detectors (registry-token and AWS-access-key-id
 * shapes among them).
 *
 * Free-text fields — `key`, `value`, `summary`, `when_to_use`, every TAG and
 * every string leaf of `metadata` — are passed through redaction. `key` and
 * `tags` use the conservative {@link redactCredentialKey} (so ordinary
 * identifiers survive — acceptance criterion 5); `value`, `summary`,
 * `when_to_use` and `metadata` use the broad {@link redactSecrets} (over-
 * redaction in inline free text is acceptable). Coordination metadata (id,
 * scope, category, importance, status, timestamps, agent/project/session/
 * machine attribution, version, flags) is preserved unchanged so consumers
 * can still coordinate on the row.
 */
export function redactMemoryForOutput(memory: Memory): Memory {
  return {
    ...memory,
    key: redactCredentialKey(memory.key),
    value: redactSecrets(memory.value),
    summary: memory.summary ? redactSecrets(memory.summary) : null,
    when_to_use: memory.when_to_use ? redactSecrets(memory.when_to_use) : null,
    // `tags` is required on the local Memory type, but an API-mode server row
    // can omit it; default to [] so the projection never crashes on a row that
    // predates the tags column in the response.
    tags: (memory.tags ?? []).map((t) => redactCredentialKey(t)),
    metadata: redactValueTree(memory.metadata) as Record<string, unknown>,
  };
}

/**
 * Redact the free-text fields of a version-history row before it reaches a READ
 * surface (`versions`, `diff`). `value`, `summary`, `when_to_use` and `tags`
 * carry the same stored free-text leak class as the memory fields; coordination
 * metadata (version, importance, scope, category, pinned, status, created_at,
 * ids) is preserved. Tags use the conservative {@link redactCredentialKey}.
 */
export function redactVersionForOutput<V extends { value: string; summary: string | null; tags?: string[]; when_to_use?: string | null }>(
  version: V,
): V {
  return {
    ...version,
    value: redactSecrets(version.value),
    summary: version.summary ? redactSecrets(version.summary) : null,
    tags: version.tags?.map((t) => redactCredentialKey(t)),
    when_to_use: version.when_to_use != null ? redactSecrets(version.when_to_use) : version.when_to_use,
  };
}

/**
 * Redact the free-text fields of a WRITE input (`CreateMemoryInput` /
 * `UpdateMemoryInput`) BEFORE storage and BEFORE any lookup/guard that keys on
 * those values. The write path must not persist a credential-shaped key or tag
 * raw (acceptance criterion 2): `key` and `tags` use the conservative
 * {@link redactCredentialKey} (so ordinary identifiers survive — criterion 5),
 * while `value`, `summary`, `when_to_use` and every string leaf of `metadata`
 * use the broad {@link redactSecrets}. Redaction is idempotent, so a double
 * application (CLI layer + db layer) is safe. Coordination fields (category,
 * scope, importance, source, status, version, ids, timestamps) are preserved.
 */
export function redactMemoryWriteInput<T extends object>(input: T): T {
  const out = { ...input } as Record<string, unknown>;
  if (typeof out.key === "string") out.key = redactCredentialKey(out.key);
  if (typeof out.value === "string") out.value = redactSecrets(out.value);
  if (out.summary !== undefined && out.summary !== null) {
    out.summary = redactSecrets(String(out.summary));
  }
  if (Array.isArray(out.tags)) {
    out.tags = (out.tags as unknown[]).map((t) => redactCredentialKey(String(t)));
  }
  if (typeof out.when_to_use === "string") {
    out.when_to_use = redactSecrets(out.when_to_use);
  }
  if (out.metadata !== undefined) {
    out.metadata = redactValueTree(out.metadata);
  }
  return out as unknown as T;
}

/**
 * Redact a string leaf that is NOT part of the Memory object but carries
 * memory-derived text on a read surface — notably the highlight SNIPPETS of a
 * search result. A query that matches inside a credential-shaped key produces
 * a snippet window that spans the whole key, so redacting the memory alone is
 * not enough for the search read path.
 */
export function redactTextFragment(text: string): string {
  return redactSecrets(text);
}

/**
 * A display-safe copy of a search result: the memory is passed through
 * {@link redactMemoryForOutput} and every highlight snippet is passed through
 * {@link redactTextFragment}. The result's own coordination fields (score,
 * match_type, field names) survive unchanged.
 */
export function redactSearchResultForOutput<T extends { memory: Memory; highlights?: { field: string; snippet: string }[] }>(
  result: T
): T {
  return {
    ...result,
    memory: redactMemoryForOutput(result.memory),
    highlights: result.highlights?.map((h) => ({
      field: h.field,
      snippet: redactTextFragment(h.snippet),
    })),
  };
}
