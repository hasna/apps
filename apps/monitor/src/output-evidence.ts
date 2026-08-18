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

import { readFileSync } from "node:fs";

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
  const withUrls = redactUrlCredentials(withPrefixes);

  return {
    text: withUrls,
    redacted: withUrls !== text,
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

  let content: string;
  try {
    content = readFileSync(options.path, "utf8");
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

  // Bound first, then redact the bounded excerpt (a redacted-then-truncated
  // buffer could cut a redaction marker).
  const excerpt = content.slice(0, maxExcerptBytes);

  if (redact) {
    const redacted = redactOutputText(excerpt);
    return {
      kind: options.kind,
      retained: true,
      excerpt: redacted.text,
      bytes: options.bytes,
      truncated: options.truncated,
      redacted: redacted.redacted,
    };
  }

  // Unredacted retention is refused when the content still carries
  // credential shape: unrestricted process output never reaches a receipt.
  if (containsCredentialShape(excerpt)) {
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
    excerpt,
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
