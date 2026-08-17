/**
 * Shared redaction for integration projections. Mirrors the owning files
 * package's default redaction pattern family (private keys, cloud-access keys,
 * bot/API tokens, bearer tokens, key=value credential shapes) so injected
 * external text never carries credential material into a rendered prompt.
 */

const REDACT_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bs[k]-(?:proj|ant|live|test|or|admin)-[A-Za-z0-9_-]{12,}\b/g,
  /\bs[k]-[A-Za-z0-9]{32,}\b/g,
  /\b(?:xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
  /\bx[a]i-[A-Za-z0-9_-]{12,}\b/g,
  /\bnp[m]_[A-Za-z0-9_]{12,}\b/g,
  /\bctx7s[k]-[A-Za-z0-9_-]{12,}\b/g,
  /\bAI[z]a[A-Za-z0-9_-]{20,}\b/g,
  /\bsecre[t][-_]?token:\s*["']?[^"'\s]{8,}/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
  /\b[A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|SECRET|PASSWORD)\b\s*[:=]\s*["']?[^"'\s]{8,}/gi,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\b\s*[:=]\s*["']?[^"'\s]{8,}/gi,
]

const REDACTED_MARKER = "[REDACTED]"

/** Redact credential-shaped spans from a text field. Returns the safe text. */
export function redactText(value: string): string {
  if (!value) return value
  let out = value
  for (const pattern of REDACT_PATTERNS) {
    out = out.replace(pattern, REDACTED_MARKER)
  }
  return out
}

/** True when the text contains at least one credential-shaped span. */
export function containsCredentialShape(value: string): boolean {
  for (const pattern of REDACT_PATTERNS) {
    const probe = new RegExp(pattern.source, pattern.flags.replace("g", ""))
    if (probe.test(value)) return true
  }
  return false
}

/** Truncate a string to a hard byte budget; the caller records truncation. */
export function truncateText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false }
  return { text: value.slice(0, maxChars), truncated: true }
}

/** Shared bound constants for projections. */
export const PROJECTION_BOUNDS = {
  /** todos */
  todoTitleChars: 200,
  todoDescriptionChars: 500,
  /** conversations */
  channelDescriptionChars: 200,
  channelTopicChars: 200,
  channelTags: 20,
  channelPreviewLimit: 10,
  channelPreviewBytes: 320,
  channelMaxBytes: 4096,
  /** knowledge */
  knowledgeTitleChars: 200,
  knowledgeContentChars: 4000,
  knowledgeContentMaxBytes: 8192,
  /** mementos */
  mementoValueChars: 1000,
  mementoSummaryChars: 300,
  mementoSearchLimit: 5,
  /** files (delegated to the owning context-pack bounds) */
  fileMaxExcerptChars: 900,
  fileMaxTotalChars: 6000,
  fileMaxExcerpts: 12,
} as const
