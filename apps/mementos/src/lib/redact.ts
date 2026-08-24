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
 * show, recall, tail, chain, versions). The write path redacts
 * `value`/`summary` at save time but NEVER the `key`, and values written
 * before write-side redaction (or via a bypassing write path) can sit raw in
 * the store — so a credential-shaped token can otherwise reach stdout verbatim
 * and trip secret scanners (package_registry_token on `npm_`,
 * AWS-access-key-id on `AKIA`, ...).
 *
 * Free-text fields — `key`, `value`, `summary`, `when_to_use` and every
 * string leaf of `metadata` — are passed through {@link redactSecrets};
 * coordination metadata (id, scope, category, importance, status, timestamps,
 * agent/project/session/machine attribution, version, flags) is preserved
 * unchanged so consumers can still coordinate on the row.
 */
export function redactMemoryForOutput(memory: Memory): Memory {
  return {
    ...memory,
    key: redactSecrets(memory.key),
    value: redactSecrets(memory.value),
    summary: memory.summary ? redactSecrets(memory.summary) : null,
    when_to_use: memory.when_to_use ? redactSecrets(memory.when_to_use) : null,
    metadata: redactValueTree(memory.metadata) as Record<string, unknown>,
  };
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
