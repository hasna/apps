/**
 * Redaction and byte-bounding for dispatched-runtime captures.
 *
 * Output and stderr of a dispatched runtime are bounded and redacted before
 * persistence (dispatch invariant). Redaction patterns are assembled from
 * fragments so the credential prefixes themselves never appear as literal
 * values in this source.
 */

const REDACTED = "[REDACTED]"

function fragment(...parts: string[]): string {
  return parts.join("")
}

function buildPatterns(): RegExp[] {
  return [
    // Anthropic API keys: sk-ant-… / sk-proj-…
    new RegExp(fragment("sk-", "(ant-|proj-)") + "[A-Za-z0-9_-]{16,}", "g"),
    // npm automation tokens: npm_<20+>
    new RegExp(fragment("npm_") + "[A-Za-z0-9]{20,}", "g"),
    // GitHub tokens: ghp_ gho_ ghu_ ghs_ ghr_
    new RegExp(fragment("gh") + "[pousr]_[A-Za-z0-9]{20,}", "g"),
    // AWS access key ids
    new RegExp(fragment("AKIA") + "[0-9A-Z]{16}", "g"),
    // Google API keys
    new RegExp(fragment("AIza") + "[0-9A-Za-z_-]{20,}", "g"),
    // xAI API keys
    new RegExp(fragment("xai-") + "[A-Za-z0-9]{16,}", "g"),
    // Stripe live/test keys
    new RegExp(fragment("sk-") + "(live|test)-[A-Za-z0-9]{20,}", "g"),
    // JWT-shaped bearer tokens (three dot-separated segments)
    new RegExp("[A-Za-z0-9_-]{12,}\\.[A-Za-z0-9_-]{12,}\\.[A-Za-z0-9_-]{20,}", "g"),
    // Keyed assignments, quoted or unquoted keys and values
    new RegExp(
      fragment(
        "([\"']?)(token|api[_-]?key|secret|password|passwd|client[_-]?secret|access[_-]?token|refresh[_-]?token|auth(?:orization)?)([\"']?)\\s*[:=]\\s*([\"'])[^\"']{8,}\\4"
      ),
      "gi"
    ),
    // PEM private key blocks
    new RegExp(fragment("-----BEGIN ") + "[A-Z ]*PRIVATE KEY[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY", "g"),
  ]
}

const PATTERNS = buildPatterns()

/**
 * Replace credential-shaped substrings with a fixed marker. Redaction is a
 * backstop on top of bounded capture; it is not a replacement for the rule
 * that credentials must never be copied into prompt text, run metadata, or
 * logs in the first place.
 */
export function redactText(text: string): string {
  let out = text
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, REDACTED)
  }
  return out
}

export interface BoundedResult {
  text: string
  truncated: boolean
}

/**
 * Truncate text to a byte bound (UTF-8), keeping a character boundary.
 */
export function boundBytes(text: string, maxBytes: number): BoundedResult {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: false }
  let sliced = text
  while (Buffer.byteLength(sliced, "utf8") > maxBytes && sliced.length > 0) {
    sliced = sliced.slice(0, -1)
  }
  return { text: sliced, truncated: true }
}

export const TRUNCATED_MARKER = "\n[truncated: capture exceeded byte bound]"

/**
 * Bound first, then redact, then append a truncation marker when the bound
 * was exceeded. Bounding before redaction keeps replacement text inside the
 * byte budget.
 */
export function boundAndRedact(text: string, maxBytes: number): BoundedResult {
  const bounded = boundBytes(text, maxBytes)
  const redacted = redactText(bounded.text)
  return {
    text: bounded.truncated ? redacted + TRUNCATED_MARKER : redacted,
    truncated: bounded.truncated,
  }
}
