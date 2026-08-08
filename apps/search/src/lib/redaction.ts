import type { SearchResult } from "../types/index.js";

export const REDACTION_PLACEHOLDER = "[REDACTED]";

const SENSITIVE_KEY_SOURCE =
  String.raw`\b[a-z0-9_-]*(?:api[_-]?key|access[_-]?key|secret(?:[_-]?key)?|client[_-]?secret|(?:auth|access|refresh)[_-]?token|token|password|passwd|pwd|passphrase|private[_-]?key)\b`;

const SENSITIVE_EQUALS_ASSIGNMENT_PATTERN = new RegExp(
  `(${SENSITIVE_KEY_SOURCE}["'\\x60]?[\\s]*=[\\s]*)(?![=>])(["'\\x60]?).*$`,
  "i",
);

// Preserve ordinary TypeScript annotations while still protecting quoted JSON
// and unquoted YAML-style credential values.
const TYPE_ANNOTATION_VALUE_SOURCE =
  String.raw`(?:(?:string|number|boolean|unknown|any|never|object|symbol|bigint|undefined|null)\b[\s|&]*)+[;,\])}]?\s*$`;
const SENSITIVE_COLON_ASSIGNMENT_PATTERN = new RegExp(
  `(${SENSITIVE_KEY_SOURCE}["'\\x60]?[\\s]*:(?![\\s]*${TYPE_ANNOTATION_VALUE_SOURCE})[\\s]*)(["'\\x60]?).*$`,
  "i",
);

const SENSITIVE_ASSIGNMENT_PATTERNS = [
  SENSITIVE_EQUALS_ASSIGNMENT_PATTERN,
  SENSITIVE_COLON_ASSIGNMENT_PATTERN,
] as const;

const CREDENTIAL_URL_PATTERN = /([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)([^@\s/]+)(@)/gi;
const BEARER_TOKEN_PATTERN = /(\bBearer\s+)[a-z0-9._~+/-]{8,}=*/gi;

const INLINE_CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bsk-[a-z0-9_-]{10,}\b/gi,
  /\bgh[pousr]_[a-z0-9]{20,}\b/gi,
  /\bgithub_pat_[a-z0-9_]{20,}\b/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[a-z0-9_-]+\.eyJ[a-z0-9_-]+\.[a-z0-9_-]+\b/gi,
];

/**
 * Redact credential-bearing values from one emitted text field.
 *
 * Search matching still runs against the original source line. This function
 * belongs at the output boundary so ranking and line coordinates remain exact.
 */
export function redactCredentialBearingText(text: string): string {
  let redacted = text;
  for (const pattern of SENSITIVE_ASSIGNMENT_PATTERNS) {
    redacted = redacted.replace(
      pattern,
      (_match: string, prefix: string, quote: string) =>
        `${prefix}${quote}${REDACTION_PLACEHOLDER}${quote}`,
    );
  }

  redacted = redacted.replace(
    CREDENTIAL_URL_PATTERN,
    (_match: string, prefix: string, _credential: string, suffix: string) =>
      `${prefix}${REDACTION_PLACEHOLDER}${suffix}`,
  );
  redacted = redacted.replace(
    BEARER_TOKEN_PATTERN,
    (_match: string, prefix: string) => `${prefix}${REDACTION_PLACEHOLDER}`,
  );

  for (const pattern of INLINE_CREDENTIAL_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTION_PLACEHOLDER);
  }

  return redacted;
}

function redactContentMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const matches = metadata["matches"];
  if (!Array.isArray(matches)) return metadata;

  let changed = false;
  const redactedMatches = matches.map((match) => {
    if (typeof match !== "object" || match === null || Array.isArray(match)) return match;
    const record = match as Record<string, unknown>;
    const text = record["text"];
    if (typeof text !== "string") return match;

    const redactedText = redactCredentialBearingText(text);
    if (redactedText === text) return match;
    changed = true;
    return { ...record, text: redactedText };
  });

  return changed ? { ...metadata, matches: redactedMatches } : metadata;
}

/** Protect live, newly persisted, and historical local-content result output. */
export function redactContentSearchResult(result: SearchResult): SearchResult {
  if (result.source !== "content") return result;

  const snippet = redactCredentialBearingText(result.snippet);
  const metadata = redactContentMetadata(result.metadata);
  if (snippet === result.snippet && metadata === result.metadata) return result;

  return { ...result, snippet, metadata };
}
