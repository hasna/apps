/**
 * Write-path secret scrubbing. `scrubSecrets` removes credential material from
 * text before it is persisted (run stdout/stderr/error, goal evidence, raw
 * model responses). Display-layer truncation/redaction lives in format.ts;
 * this module is about never writing recoverable secrets to disk at all.
 *
 * The function is idempotent (`scrubSecrets(scrubSecrets(x)) === scrubSecrets(x)`)
 * and linear over the input, so it stays fast on multi-hundred-KB outputs.
 */

const SCRUBBED = "[SCRUBBED]";

/** Well-known credential token shapes replaced wholesale. */
const TOKEN_PATTERNS: RegExp[] = [
  // Anthropic API keys.
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g,
  // OpenAI project-scoped keys.
  /\bsk-proj-[A-Za-z0-9_-]{8,}/g,
  // AWS access key ids.
  /\bAKIA[0-9A-Z]{16}\b/g,
  // GitHub classic personal access tokens.
  /\bghp_[A-Za-z0-9]{16,}\b/g,
  // GitHub fine-grained personal access tokens.
  /\bgithub_pat_[A-Za-z0-9_]{16,}\b/g,
  // Slack tokens (xoxb-, xoxp-, xoxa-, xoxr-, xoxs-, ...).
  /\bxox[a-z]-[A-Za-z0-9-]{8,}/g,
  // JWTs (header.payload.signature, base64url segments starting with eyJ).
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{10,}\b/g,
];

/**
 * Authorization headers (`Authorization: Bearer <token>`, `authorization =
 * "Basic <token>"`). Only the credential after the scheme is replaced so the
 * header shape (and any surrounding JSON quoting) stays intact. Quotes may be
 * backslash-escaped (`Authorization\": \"Bearer …`) so headers inside
 * JSON-encoded agent stdout are still caught.
 */
const AUTHORIZATION_PATTERN = /(\bAuthorization(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?(?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]{16,}/gi;

/** PEM private key blocks (including truncated blocks missing their END line). */
const PEM_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;

/**
 * Generic secret-looking assignments: `SOME_API_KEY="..."`, `token: '...'`,
 * `PASSWORD=...`. The captured value is only scrubbed when it looks like real
 * credential material (see {@link isLikelySecretValue}) so ordinary config
 * such as `KEY="true"` or repeated filler survives. Double-quoted values
 * consume backslash escapes pairwise (`\\.`) so a `\"` inside a JSON string
 * never terminates the value early, while an unescaped closing quote can
 * never be swallowed. A dedicated `\"…\"` branch (and optional `\` before the
 * key's closing quote) matches assignments that were JSON-escaped by an
 * agent's JSON stdout envelope, and the replacement keeps the `\"` delimiters
 * so the document stays valid JSON. The key-name run is bounded at 64 chars:
 * an unbounded `*` backtracks O(n) per position hunting for the key/token
 * suffix, which turns a single long unbroken alphanumeric run (a 256KB base64
 * blob in run output) into an O(n^2) scan.
 */
const ASSIGNMENT_PATTERN =
  /([A-Za-z0-9_.-]{0,64}(?:key|token|secret|passwd|password|passphrase|credentials?)(?:\\?["'])?\s*[:=]\s*)(\\"([^"\\\r\n]{12,})\\"|"((?:[^"\\\r\n]|\\[^\r\n]){12,})"|'([^'\\\r\n]{12,})'|([A-Za-z0-9+/_.=-]{16,}))/gi;

/**
 * Structured identifier fields whose names end in "key" but never hold
 * credential material: workflow idempotency/dedupe/route correlation ids.
 * Without this allowlist the generic assignment heuristic scrubs every
 * workflow run envelope's `idempotencyKey` (`<32-hex loop id>:<ISO
 * timestamp>:attempt:N` clears the entropy threshold), corrupting persisted
 * run stdout that consumers correlate/replay by.
 */
const BENIGN_KEY_NAME_PATTERN = /(?:^|[._-])(?:idempotency|dedupe|route)[_-]?key$/i;

/**
 * Cheap literal precheck before running ASSIGNMENT_PATTERN: text that never
 * mentions a credential-ish key name cannot match it, and the indexOf scan is
 * orders of magnitude cheaper than the per-position regex attempt on large
 * pattern-free outputs (a 256KB base64 blob, repeated filler).
 */
const ASSIGNMENT_HINTS = ["key", "token", "secret", "pass", "credential"];

function mayContainAssignment(text: string): boolean {
  const lowered = text.toLowerCase();
  return ASSIGNMENT_HINTS.some((hint) => lowered.includes(hint));
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function isLikelySecretValue(value: string): boolean {
  if (value.length < 12) return false;
  if (value.includes(SCRUBBED)) return false;
  // Filesystem paths assigned to *_KEY_PATH-style settings are not secrets.
  if (value.startsWith("/") || value.startsWith("~") || value.startsWith("./")) return false;
  return shannonEntropy(value) >= 3.2;
}

/**
 * Replace credential tokens in `text` with "[SCRUBBED]". Idempotent and safe
 * to run on JSON-encoded payloads (replacements never introduce quotes).
 */
export function scrubSecrets(text: string): string {
  if (!text) return text;
  let scrubbed = text;
  for (const pattern of TOKEN_PATTERNS) scrubbed = scrubbed.replace(pattern, SCRUBBED);
  scrubbed = scrubbed.replace(AUTHORIZATION_PATTERN, `$1${SCRUBBED}`);
  scrubbed = scrubbed.replace(PEM_PATTERN, SCRUBBED);
  if (!mayContainAssignment(scrubbed)) return scrubbed;
  scrubbed = scrubbed.replace(
    ASSIGNMENT_PATTERN,
    (
      match: string,
      prefix: string,
      quotedValue: string,
      escapedQuoted?: string,
      doubleQuoted?: string,
      singleQuoted?: string,
      bare?: string,
    ) => {
      const value = escapedQuoted ?? doubleQuoted ?? singleQuoted ?? bare ?? "";
      const keyName = /^[A-Za-z0-9_.-]*/.exec(prefix)?.[0] ?? "";
      if (BENIGN_KEY_NAME_PATTERN.test(keyName)) return match;
      if (!isLikelySecretValue(value)) return match;
      const quote = quotedValue.startsWith('\\"') ? '\\"' : quotedValue.startsWith('"') ? '"' : quotedValue.startsWith("'") ? "'" : "";
      return `${prefix}${quote}${SCRUBBED}${quote}`;
    },
  );
  return scrubbed;
}

/**
 * Recursively scrub the string leaves of a JSON-serializable value. Run this
 * BEFORE `JSON.stringify` when persisting structured payloads (goal evidence,
 * raw model responses): stringify escapes quotes, which would otherwise hide
 * quoted secrets from the flat text patterns above.
 */
export function scrubSecretsDeep<T>(value: T): T {
  if (typeof value === "string") return scrubSecrets(value) as unknown as T;
  if (Array.isArray(value)) return value.map((entry) => scrubSecretsDeep(entry)) as unknown as T;
  if (value !== null && typeof value === "object") {
    // Honor toJSON (Date, custom classes) the way JSON.stringify would,
    // instead of flattening such objects to {} via Object.entries.
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") return scrubSecretsDeep(toJSON.call(value)) as unknown as T;
    const scrubbed: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) scrubbed[key] = scrubSecretsDeep(entry);
    return scrubbed as unknown as T;
  }
  return value;
}

/**
 * The display-layer redaction placeholder produced by `redact()` in format.ts:
 * `[redacted]` or `[redacted <n> chars]`, and nothing else. Anchored on
 * purpose — prose that merely mentions a placeholder ("why does [redacted 12
 * chars] appear in my output?") is real content and must not be treated as one.
 *
 * This lives here, next to the write-path scrubber, because three unrelated
 * layers need the same answer and must not each carry their own copy of the
 * shape: format.ts (so redaction is idempotent), workflow-events.ts (so a
 * re-sanitized event payload is not re-wrapped), and executor.ts (so a prompt
 * that arrives already redacted is never handed to a provider as if it were an
 * instruction — incident 607176).
 */
const REDACTION_PLACEHOLDER = /^\[redacted(?: \d+ chars)?\]$/;

/**
 * True when `value` is exactly a redaction placeholder, not text containing
 * one. Returns a plain boolean rather than a `value is string` predicate on
 * purpose: callers ask this about a value they have already narrowed to a
 * string, and a predicate would narrow the *false* branch to `never`.
 */
export function isRedactionPlaceholder(value: unknown): boolean {
  return typeof value === "string" && REDACTION_PLACEHOLDER.test(value.trim());
}
