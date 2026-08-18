/**
 * Bounded run evidence for slug output.
 *
 * Retained excerpts are size-bounded and redacted before they can enter a run
 * receipt. Raw private request bodies and unrestricted process output are
 * never written to receipts: sensitive or rejected output is represented by
 * `evidence_omitted_sensitive`, and a missing spool file is represented by
 * `omittedReason: "missing"` — this module never throws on missing evidence.
 *
 * The redactor follows the fleet credential vocabulary used by
 * `src/security.ts` (sensitive key segments) and adds the credential prefixes
 * the secrets scanner keys on, so an excerpt that would leak a value is either
 * redacted or omitted entirely.
 */

import { closeSync, openSync, readSync } from "node:fs";

const REDACTED = "***";

const SENSITIVE_SEGMENTS = new Set([
  "apikey",
  "authorization",
  "credential",
  "credentials",
  "pass",
  "passwd",
  "password",
  "secret",
  "token",
]);

const CREDENTIAL_PREFIX_PATTERN =
  /\b(sk-ant-[A-Za-z0-9_-]{8,}|sk-proj-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|xai-[A-Za-z0-9_-]{20,}|ctx7sk-[A-Za-z0-9_-]{10,}|AIza[A-Za-z0-9_-]{20,})/g;

const ASSIGNMENT_PATTERN =
  /(^|\s)([A-Za-z_][A-Za-z0-9_.-]*)(\s*=\s*)("[^"]*"|'[^']*'|[^\s]+)/g;

const LONG_OPTION_PATTERN =
  /(^|\s)(--[A-Za-z0-9][A-Za-z0-9_.-]*)(?:=("[^"]*"|'[^']*'|[^\s]+)|(\s+)(?!--)("[^"]*"|'[^']*'|[^\s]+))/g;

const URL_SCHEME_PATTERN = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\//g;

function keySegments(key: string): string[] {
  return key
    .replace(/^--?/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[-_.]+/)
    .filter(Boolean);
}

function isSensitiveKey(key: string): boolean {
  const segments = keySegments(key);
  const segmentSet = new Set(segments);
  if (segments.some((segment) => SENSITIVE_SEGMENTS.has(segment))) return true;
  if (segmentSet.has("api") && segmentSet.has("key")) return true;
  if (segmentSet.has("access") && segmentSet.has("key")) return true;
  if (segmentSet.has("private") && segmentSet.has("key")) return true;
  return false;
}

/** Sensitive for both assignment and option positions: same vocabulary as security.ts. */
function isAssignmentKeySensitive(key: string): boolean {
  return isSensitiveKey(key);
}

function redactUrlCredentials(text: string): string {
  let redacted = "";
  let cursor = 0;
  let lastMatchEnd = 0;
  URL_SCHEME_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = URL_SCHEME_PATTERN.exec(text)) !== null) {
    const schemeStart = match.index;
    if (schemeStart < lastMatchEnd) {
      URL_SCHEME_PATTERN.lastIndex = lastMatchEnd;
      continue;
    }
    const authorityStart = schemeStart + match[0].length;
    const tokenEnd = findUrlTokenEnd(text, authorityStart);
    const authorityEnd = findAuthorityEnd(text, authorityStart, tokenEnd);
    const credentialAt = lastAtSign(text, authorityStart, authorityEnd);

    if (credentialAt !== -1) {
      redacted += text.slice(cursor, authorityStart) + REDACTED + "@";
      cursor = credentialAt + 1;
    }
    lastMatchEnd = authorityEnd > tokenEnd ? authorityEnd : tokenEnd;
    if (URL_SCHEME_PATTERN.lastIndex < lastMatchEnd) {
      URL_SCHEME_PATTERN.lastIndex = lastMatchEnd;
    }
  }

  return cursor === 0 ? text : redacted + text.slice(cursor);
}

function findUrlTokenEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length && !/\s/.test(text[i]!)) i++;
  return i;
}

function lastAtSign(text: string, start: number, end: number): number {
  for (let i = end - 1; i >= start; i--) {
    if (text[i] === "@") return i;
  }
  return -1;
}

function findAuthorityEnd(text: string, start: number, end: number): number {
  for (let i = start; i < end; i++) {
    const char = text[i];
    if (char === "/" || char === "?" || char === "#" || char === " " || char === "\t") {
      return i;
    }
  }
  return end;
}

/**
 * Redact credential-shaped query/fragment parameters of URLs: `?token=...`,
 * signed-URL parameters such as `X-Amz-Signature=...`, `#access_token=...`.
 * The assignment and long-option patterns cannot reach these — there is no
 * leading whitespace before the key — so they survive into retained evidence
 * unless handled here.
 */
function redactUrlQueryParameters(text: string): string {
  let redacted = "";
  let cursor = 0;
  let lastMatchEnd = 0;
  URL_SCHEME_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = URL_SCHEME_PATTERN.exec(text)) !== null) {
    const schemeStart = match.index;
    if (schemeStart < lastMatchEnd) {
      URL_SCHEME_PATTERN.lastIndex = lastMatchEnd;
      continue;
    }
    const authorityStart = schemeStart + match[0].length;
    const tokenEnd = findUrlTokenEnd(text, authorityStart);
    const queryStart = findUrlQueryStart(text, authorityStart, tokenEnd);
    if (queryStart !== -1) {
      const section = text.slice(queryStart, tokenEnd);
      const redactedSection = redactQuerySection(section);
      if (redactedSection !== section) {
        redacted += text.slice(cursor, queryStart) + redactedSection;
        cursor = tokenEnd;
      }
    }
    lastMatchEnd = tokenEnd;
    if (URL_SCHEME_PATTERN.lastIndex < lastMatchEnd) {
      URL_SCHEME_PATTERN.lastIndex = lastMatchEnd;
    }
  }

  return cursor === 0 ? text : redacted + text.slice(cursor);
}

function findUrlQueryStart(text: string, start: number, end: number): number {
  for (let i = start; i < end; i++) {
    const char = text[i];
    if (char === "?" || char === "#") return i;
  }
  return -1;
}

function redactQuerySection(section: string): string {
  const marker = section[0];
  if (marker !== "?" && marker !== "#") return section;
  const redactedPairs = section.slice(1).split("&").map((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1) return pair;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (value === "" || !isUrlQueryKeySensitive(key)) return pair;
    return `${key}=${REDACTED}`;
  });
  return marker + redactedPairs.join("&");
}

/**
 * Query/fragment parameter keys whose values are credential-shaped: the global
 * sensitive-key vocabulary plus the signed-URL parameter family (Signature,
 * sig). A bare `key` alone stays ambiguous and is not redacted.
 */
function isUrlQueryKeySensitive(key: string): boolean {
  const segments = keySegments(key);
  const segmentSet = new Set(segments);
  if (segments.some((segment) => SENSITIVE_SEGMENTS.has(segment) || segment === "sig" || segment === "signature")) {
    return true;
  }
  if (segmentSet.has("api") && segmentSet.has("key")) return true;
  if (segmentSet.has("access") && segmentSet.has("key")) return true;
  if (segmentSet.has("private") && segmentSet.has("key")) return true;
  return false;
}

/**
 * Redact credential-shaped content in arbitrary output text. Returns the
 * redacted text and whether anything was redacted.
 */
export function redactOutputText(text: string): { text: string; redacted: boolean } {
  const withAssignments = text.replace(
    ASSIGNMENT_PATTERN,
    (match, leading: string, key: string, separator: string, value: string) =>
      isAssignmentKeySensitive(key) ? `${leading}${key}${separator}${REDACTED}` : match
  );

  const withOptions = withAssignments.replace(
    LONG_OPTION_PATTERN,
    (
      match,
      leading: string,
      option: string,
      equalsValue: string | undefined,
      whitespace: string | undefined
    ) => {
      if (!isSensitiveKey(option)) return match;
      if (equalsValue !== undefined) return `${leading}${option}=${REDACTED}`;
      return `${leading}${option}${whitespace ?? " "}${REDACTED}`;
    }
  );

  const withPrefixes = withOptions.replace(CREDENTIAL_PREFIX_PATTERN, REDACTED);
  const withUrlCredentials = redactUrlCredentials(withPrefixes);
  const withUrlQueries = redactUrlQueryParameters(withUrlCredentials);

  return {
    text: withUrlQueries,
    redacted: withUrlQueries !== text,
  };
}

/**
 * True when the text carries credential-shaped content, i.e. the redactor
 * would change it. Used to refuse unredacted retention of sensitive output.
 */
export function containsCredentialShape(text: string): boolean {
  return redactOutputText(text).redacted;
}

export interface StreamCaptureRef {
  kind: "stdout" | "stderr";
  /** Path of the mode-600 spool file produced by output-capture. */
  path: string;
  bytes: number;
  truncated: boolean;
}

export interface StreamEvidenceOptions {
  kind: "stdout" | "stderr";
  path: string;
  bytes: number;
  truncated: boolean;
  /** Max excerpt bytes retained in evidence. Must be >= 1. */
  maxExcerptBytes?: number;
  /** Redact the excerpt before retention (default true). */
  redact?: boolean;
  /** Omit this stream entirely as sensitive (e.g. a private request body). */
  omitSensitive?: boolean;
}

export interface StreamEvidence {
  kind: "stdout" | "stderr";
  retained: boolean;
  excerpt?: string;
  bytes: number;
  truncated: boolean;
  redacted: boolean;
  omittedReason?: "sensitive" | "missing" | "unbounded";
}

export interface RunEvidenceOptions {
  streams: StreamCaptureRef[];
  maxExcerptBytes?: number;
  redact?: boolean;
  omitSensitive?: boolean;
}

export interface RunEvidence {
  streams: StreamEvidence[];
  evidence_omitted_sensitive: boolean;
}

const DEFAULT_MAX_EXCERPT_BYTES = 64 * 1024;

/** Extra bytes read beyond the excerpt cap so a URL crossing the boundary is redacted whole. */
const URL_AUTHORITY_WINDOW_BYTES = 64 * 1024;
/** Chunk size when extending a window that ends inside a scheme:// token. */
const URL_WINDOW_EXTEND_CHUNK_BYTES = 64 * 1024;
/** Hard bound on the total window read for one stream. */
const URL_WINDOW_HARD_LIMIT_BYTES = 1024 * 1024;

function readBoundedUtf8(path: string, offset: number, length: number): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = readSync(fd, buffer, 0, length, offset);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** The last token of `text` when it is a scheme:// URL token, else null. */
function openUrlTokenAtEnd(text: string): RegExpMatchArray | null {
  return text.match(/(?:^|\s)([A-Za-z][A-Za-z0-9+.-]*:\/\/)\S*$/);
}

/**
 * Read a bounded evidence window: the excerpt cap plus a margin so a URL whose
 * authority crosses the cap boundary is redacted as a whole — truncation can
 * never hide the `@` of a `user:secret@host` authority. If the window still
 * ends inside a scheme:// token whose authority has not been seen, extend the
 * read until the token terminates or its `@` is visible; if the hard limit is
 * hit first, trim the unterminated token so no partial authority is retained.
 */
function readEvidenceWindow(path: string, maxExcerptBytes: number): string {
  let content = readBoundedUtf8(path, 0, maxExcerptBytes + URL_AUTHORITY_WINDOW_BYTES);
  let byteOffset = Buffer.byteLength(content, "utf8");

  while (byteOffset < URL_WINDOW_HARD_LIMIT_BYTES) {
    const tail = openUrlTokenAtEnd(content);
    if (tail === null || tail[0].includes("@")) break;
    const chunk = readBoundedUtf8(path, byteOffset, URL_WINDOW_EXTEND_CHUNK_BYTES);
    if (chunk === "") break;
    content += chunk;
    byteOffset += Buffer.byteLength(chunk, "utf8");
  }

  const tail = openUrlTokenAtEnd(content);
  if (tail !== null && tail.index !== undefined && !tail[0].includes("@")) {
    // The token may hide a `user:secret@` authority beyond what we read. Keep
    // it only when a path/query separator proves the authority ended inside the
    // window (the redactor then covers the whole token); otherwise trim it so
    // no partial authority can be retained.
    const rest = tail[0].slice((tail[1] ?? "").length);
    const authorityTerminated = /[/?#]/.test(rest);
    if (!authorityTerminated || byteOffset >= URL_WINDOW_HARD_LIMIT_BYTES) {
      content = content.slice(0, tail.index);
    }
  }
  return content;
}

export function buildStreamEvidence(options: StreamEvidenceOptions): StreamEvidence {
  const maxExcerptBytes = options.maxExcerptBytes ?? DEFAULT_MAX_EXCERPT_BYTES;
  const redact = options.redact ?? true;

  if (options.omitSensitive) {
    return {
      kind: options.kind,
      retained: false,
      bytes: options.bytes,
      truncated: options.truncated,
      redacted: false,
      omittedReason: "sensitive",
    };
  }

  if (maxExcerptBytes < 1) {
    return {
      kind: options.kind,
      retained: false,
      bytes: options.bytes,
      truncated: options.truncated,
      redacted: false,
      omittedReason: "unbounded",
    };
  }

  let windowText: string;
  try {
    // Bounded read: the cap plus a redaction margin, never the whole spool.
    windowText = readEvidenceWindow(options.path, maxExcerptBytes);
  } catch {
    // Missing evidence never throws: it is represented in the record.
    return {
      kind: options.kind,
      retained: false,
      bytes: options.bytes,
      truncated: options.truncated,
      redacted: false,
      omittedReason: "missing",
    };
  }

  // Redact the window, then bound the excerpt: a URL whose authority crosses
  // the cap is redacted as a whole, so truncation can never retain a partial
  // credential (a redacted-then-truncated marker is cosmetic, not a leak).
  if (redact) {
    const redacted = redactOutputText(windowText);
    return {
      kind: options.kind,
      retained: true,
      excerpt: redacted.text.slice(0, maxExcerptBytes),
      bytes: options.bytes,
      truncated: options.truncated,
      redacted: redacted.redacted,
    };
  }

  // Unredacted retention is refused when the window still carries credential
  // shape: unrestricted process output never reaches a receipt, and a
  // credential cut by the excerpt cap must not survive truncation.
  if (containsCredentialShape(windowText)) {
    return {
      kind: options.kind,
      retained: false,
      bytes: options.bytes,
      truncated: options.truncated,
      redacted: false,
      omittedReason: "sensitive",
    };
  }

  return {
    kind: options.kind,
    retained: true,
    excerpt: windowText.slice(0, maxExcerptBytes),
    bytes: options.bytes,
    truncated: options.truncated,
    redacted: false,
  };
}

export function buildRunEvidence(options: RunEvidenceOptions): RunEvidence {
  const streamEvidence = options.streams.map((stream) =>
    buildStreamEvidence({
      kind: stream.kind,
      path: stream.path,
      bytes: stream.bytes,
      truncated: stream.truncated,
      maxExcerptBytes: options.maxExcerptBytes,
      redact: options.redact,
      omitSensitive: options.omitSensitive,
    })
  );

  const evidence_omitted_sensitive = streamEvidence.some(
    (evidence) => evidence.omittedReason === "sensitive"
  );

  return { streams: streamEvidence, evidence_omitted_sensitive };
}
