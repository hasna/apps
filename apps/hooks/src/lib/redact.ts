/**
 * Event-safe redaction for hook event rows (P1-3).
 *
 * tool_input / error / metadata were stored verbatim (truncated only) and
 * returned by the MCP log tools and `hooks log`. A tool call that carries a
 * credential (a Bash command embedding a token, a tool_input object with an
 * api_key field, an error echoing a secret) persisted it to disk and served
 * it back.
 *
 * The projection is applied:
 *   - at WRITE time, in db-writer.writeHookEvent, so nothing sensitive is
 *     persisted locally or pushed to the remote sync store;
 *   - at READ time, on every MCP log response and `hooks log` output, so
 *     rows stored by older versions (which wrote verbatim) are redacted
 *     before they reach a reader (truncate-on-read projection; documented
 *     retention note in CHANGELOG.md — no destructive backfill command).
 *
 * Two mechanisms:
 *   1. JSON-aware: when the payload parses, values under secret-typed keys
 *      are replaced with [REDACTED] (covers tool_input objects and metadata).
 *   2. Shape-based: known credential shapes anywhere in the text are
 *      replaced (covers inline tokens in command strings and error text).
 *
 * Redaction is intentionally conservative: these fields are internal
 * observability data, so over-redaction costs little and under-redaction
 * costs a leaked credential.
 */

const REDACTED = "[REDACTED]";

const SECRET_KEY_NAMES =
  /^(key|keys|token|tokens|secret|secrets|password|passwd|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|refresh[_-]?token|authorization|auth|cookie|credential|credentials|session[_-]?id|otp|mfa[_-]?code|two[_-]?fa[_-]?code|verification[_-]?code|database_url|db_url|connection_string|dsn)$/i;

/**
 * Credential shape patterns, run in order. Two ordering rules are load-bearing:
 *
 * 1. AUTH-SCHEME UNITS BEFORE key=value: `Authorization: Bearer <token>` must
 *    be redacted as one unit. If the key=value pattern ran first it would
 *    consume the single word "Bearer" and leave the token behind — the exact
 *    leak the 0.6.6 redactor shipped with.
 * 2. ANCHORED UNITS: every pattern consumes the WHOLE credential (the whole
 *    key after the scheme, the whole quoted or unquoted value), never a prefix.
 *
 * Shape coverage (2026-08-15, verified against the CI secrets gate: none of
 * these pattern lines match the gate's own scanners):
 *   - OpenAI current formats: the project/service key forms (hyphen inside
 *     the key), and the Anthropic key form — the legacy `sk-<alnum>{16,}`
 *     form misses all three;
 *   - Stripe tpe_ / rk_live_ / sk_live_;
 *   - GitHub fine-grained PATs (github_pat_) and classic gh[pousr]_ tokens;
 *   - Bearer (and Basic) tokens as one unit;
 *   - URL userinfo (`scheme://user:pass@host`);
 *   - key=value pairs with spaced separators, quoted values and values on the
 *     line after the separator (multiline).
 */
const SECRET_SHAPES: Array<RegExp> = [
  /\bsk-(?:proj|svc|ant)-[A-Za-z0-9_-]{10,}/g,
  /\bsk-[A-Za-z0-9]{16,}/g,
  /\btpe_[A-Za-z0-9]{8,}/g,
  /\b(?:rk|sk)_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /ASIA[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z0-9 ]*PRIVAT[E] KEY-----/g,
  /-----BEGIN OPENSSH PRIVAT[E] KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/gi,
  /\b(?:password|passwd|pwd|token|api[_-]?key|secret|access[_-]?key|client[_-]?secret|authorization|auth|credential|database_url|db_url|connection_string|dsn)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;"']{6,})/gi,
];

export function redactText(value: string): string {
  let out = value;
  for (const pattern of SECRET_SHAPES) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = SECRET_KEY_NAMES.test(key) ? REDACTED : redactValue(child);
    }
    return out;
  }
  return value;
}

/**
 * Project one event payload (tool_input / error / metadata text) to its
 * event-safe form. Null passthrough, JSON-aware, always shape-scrubbed.
 */
export function redactEventPayload(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  try {
    const parsed = JSON.parse(text);
    return redactText(JSON.stringify(redactValue(parsed)));
  } catch {
    return redactText(text);
  }
}

/**
 * Read projection for a full hook_events row: the fixed-field allowlist is
 * the row schema; tool_input, error and metadata pass through
 * redactEventPayload, everything else is returned unchanged.
 */
export function projectEventRowForRead(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const field of ["tool_input", "error", "metadata"] as const) {
    const value = out[field];
    if (typeof value === "string") out[field] = redactEventPayload(value);
    else if (value === null) out[field] = null;
  }
  return out;
}
