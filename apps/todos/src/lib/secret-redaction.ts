/**
 * Local redaction and secret-safety guardrails for logs, exports, comments, and debug output.
 */

import { readFileSync, existsSync } from "node:fs";
import { redactValue as redactObject } from "./redaction.js";

export const SECRET_REDACTION_SCHEMA = ["todos", "secret_redaction", "v1"].join(".");
export const REDACTION_PLACEHOLDER = "[REDACTED]";

export interface SecretPattern {
  name: string;
  pattern: RegExp;
  /** Only low-confidence assignment rules may accept exact placeholders. */
  exact_placeholders?: readonly string[];
  custom?: boolean;
}

export interface SecretMatch {
  pattern: string;
  index: number;
  line: number;
}

export interface SecretScanResult {
  schema_version: typeof SECRET_REDACTION_SCHEMA;
  clean: boolean;
  matches: SecretMatch[];
  redacted_text?: string;
}

export interface RedactionOptions {
  custom_patterns?: RegExp[];
  allowlist?: RegExp[];
  placeholder?: string;
}

const EXACT_LOW_CONFIDENCE_PLACEHOLDERS = [
  "your-api-key-here",
  "example-token",
  "[REDACTED]",
] as const;

export function isLowConfidenceSecretPattern(pattern: string): boolean {
  return pattern === "generic_credential_assignment"
    || pattern === "encoded_generic_credential_assignment";
}

const GENERIC_CREDENTIAL_ASSIGNMENT_SOURCE = String.raw`\b(?:[a-z0-9_-]*(?:api[_-]?key|secret|token|password|passwd)[a-z0-9_-]*)\b"?\s*[:=]\s*(?:([\'"])([^\'"\r\n]{8,})\1|([^\s\'";,\]\[(){}<>&?#]{8,}))`;
const GENERIC_CREDENTIAL_ASSIGNMENT_PATTERN = new RegExp(
  GENERIC_CREDENTIAL_ASSIGNMENT_SOURCE,
  "dgi",
);

const DEFAULT_PATTERNS: SecretPattern[] = [
  { name: "openai_sk", pattern: /\bsk-[a-zA-Z0-9_-]{10,}\b/g },
  { name: "openai_token", pattern: /\bsk-[a-zA-Z0-9_-]{20,}\b/g },
  { name: "github_pat", pattern: /\bghp_[a-zA-Z0-9]{20,}\b/g },
  { name: "github_oauth", pattern: /\bgho_[a-zA-Z0-9]{20,}\b/g },
  { name: "github_token", pattern: /\b(?:github_pat_|gh[opusr]_)[a-zA-Z0-9_]{20,}\b/g },
  { name: "npm_token", pattern: /\bnpm_[a-zA-Z0-9]{20,}\b/g },
  { name: "aws_access_key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "bearer_token", pattern: /\bBearer\s+[a-zA-Z0-9\-._~+/]{12,}=*/gi },
  { name: "jwt", pattern: /\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g },
  { name: "private_key_block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  {
    name: "generic_credential_assignment",
    pattern: GENERIC_CREDENTIAL_ASSIGNMENT_PATTERN,
    exact_placeholders: EXACT_LOW_CONFIDENCE_PLACEHOLDERS,
  },
];

const MAX_PERCENT_DECODE_PASSES = 32;
const ENCODED_GENERIC_CREDENTIAL_PATTERN = new RegExp(
  GENERIC_CREDENTIAL_ASSIGNMENT_SOURCE,
  "dgi",
);

interface EncodedSecretSpan {
  start: number;
  end: number;
  matches: SecretMatch[];
}

interface DecodedUnit {
  value: string;
  start: number;
  end: number;
  encoded: boolean;
}

interface SourceSpan {
  start: number;
  end: number;
}

let customRedactors: Array<(text: string) => string> = [];

export function registerCustomRedactor(fn: (text: string) => string): void {
  customRedactors.push(fn);
}

export function resetCustomRedactors(): void {
  customRedactors = [];
}

function assignmentValue(match: string): string {
  const separator = Math.max(match.indexOf("="), match.indexOf(":"));
  return (separator >= 0 ? match.slice(separator + 1) : match).trim().replace(/^['"]|['"]$/g, "");
}

function isExactPlaceholder(match: string, placeholders: readonly string[] | undefined): boolean {
  if (!placeholders) return false;
  const value = assignmentValue(match);
  return placeholders.some((placeholder) => value === placeholder);
}

function genericValueRange(match: RegExpExecArray): SourceSpan {
  const indices = (match as RegExpExecArray & {
    indices?: Array<[number, number] | undefined>;
  }).indices;
  const indexed = indices?.[2] ?? indices?.[3];
  if (indexed) return { start: indexed[0], end: indexed[1] };
  const value = match[2] ?? match[3] ?? assignmentValue(match[0]);
  const relative = match[0].lastIndexOf(value);
  return {
    start: match.index + Math.max(0, relative),
    end: match.index + Math.max(0, relative) + value.length,
  };
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) if (text.charCodeAt(cursor) === 10) line += 1;
  return line;
}

function customAllowlisted(text: string, match: string, index: number, allowlist: RegExp[]): boolean {
  const context = text.slice(Math.max(0, index - 20), Math.min(text.length, index + match.length + 20));
  return allowlist.some((pattern) => {
    const direct = new RegExp(pattern.source, pattern.flags.replace("g", ""));
    return direct.test(match) || direct.test(context);
  });
}

function collectMatches(
  text: string,
  patterns: readonly SecretPattern[],
  allowlist: RegExp[],
): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const { name, pattern, exact_placeholders, custom } of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (isExactPlaceholder(match[0], exact_placeholders)) continue;
      if (custom && customAllowlisted(text, match[0], match.index, allowlist)) continue;
      matches.push({ pattern: name, index: match.index, line: lineAt(text, match.index) });
      if (match[0].length === 0) re.lastIndex += 1;
    }
  }
  return matches;
}

function collectEncodedSecretSpans(text: string): EncodedSecretSpan[] {
  let units: DecodedUnit[] = Array.from({ length: text.length }, (_value, index) => ({
    value: text[index]!,
    start: index,
    end: index + 1,
    encoded: false,
  }));
  const spans: EncodedSecretSpan[] = [];
  let decodeLimitReached = false;

  for (let pass = 0; pass < MAX_PERCENT_DECODE_PASSES; pass += 1) {
    const next: DecodedUnit[] = [];
    let changed = false;
    for (let index = 0; index < units.length; index += 1) {
      const first = units[index]!;
      const second = units[index + 1];
      const third = units[index + 2];
      if (first.value === "%" && second && third &&
          /^[0-9a-f]$/i.test(second.value) && /^[0-9a-f]$/i.test(third.value)) {
        const code = Number.parseInt(`${second.value}${third.value}`, 16);
        // ASCII escapes decode directly. A standalone high byte becomes one
        // detection-only sentinel so its hex digits cannot be mistaken for a
        // credential-key prefix; the original `%HH` remains untouched in the
        // returned source text while adjacent ASCII escapes are inspected.
        next.push({
          value: code <= 0x7f ? String.fromCharCode(code) : "\ufffd",
          start: first.start,
          end: third.end,
          encoded: true,
        });
        index += 2;
        changed = true;
        continue;
      }
      next.push(first);
    }
    if (!changed) break;
    units = next;

    const decoded = units.map((unit) => unit.value).join("");
    for (const { name, pattern, exact_placeholders } of DEFAULT_PATTERNS) {
      // The general raw-text assignment rule deliberately accepts broad value
      // punctuation. For source-span mapping, stop at structural delimiters so
      // encoded redaction does not consume surrounding JSON/markup brackets.
      const encodedPattern = name === "generic_credential_assignment"
        ? ENCODED_GENERIC_CREDENTIAL_PATTERN
        : pattern;
      const flags = encodedPattern.flags.includes("g") ? encodedPattern.flags : `${encodedPattern.flags}g`;
      const re = new RegExp(encodedPattern.source, flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(decoded)) !== null) {
        if (isExactPlaceholder(match[0], exact_placeholders)) continue;
        const completeMatchUnits = units.slice(match.index, match.index + match[0].length);
        if (!completeMatchUnits.some((unit) => unit.encoded)) continue;
        const range = name === "generic_credential_assignment"
          ? genericValueRange(match)
          : { start: match.index, end: match.index + match[0].length };
        const matchedUnits = units.slice(range.start, range.end);
        if (matchedUnits.length === 0) continue;
        spans.push({
          start: matchedUnits[0]!.start,
          end: matchedUnits[matchedUnits.length - 1]!.end,
          matches: [{ pattern: name, index: match.index, line: lineAt(decoded, match.index) }],
        });
        if (match[0].length === 0) re.lastIndex += 1;
      }
    }
    if (pass === MAX_PERCENT_DECODE_PASSES - 1) {
      decodeLimitReached = units.some((unit, index) =>
        unit.value === "%" && /^[0-9a-f]$/i.test(units[index + 1]?.value ?? "")
          && /^[0-9a-f]$/i.test(units[index + 2]?.value ?? ""));
    }
  }

  // Reaching the bound before a fixed point is a representation attack. Fail
  // closed on each remaining non-structural encoded token without consuming
  // JSON/NDJSON or markup delimiters.
  if (decodeLimitReached) {
    const delimiter = /[\s'";,\]\[(){}<>&?#]/;
    let index = 0;
    while (index < units.length) {
      while (index < units.length && delimiter.test(units[index]!.value)) index += 1;
      const start = index;
      while (index < units.length && !delimiter.test(units[index]!.value)) index += 1;
      const token = units.slice(start, index);
      if (token.some((unit) => unit.encoded) && token.some((unit) => unit.value === "%")) {
        spans.push({
          start: token[0]!.start,
          end: token[token.length - 1]!.end,
          matches: [{ pattern: "decode_limit", index: start, line: 1 }],
        });
      }
    }
  }

  // Multiple patterns and recursive passes can identify overlapping source
  // ranges. Merge them before replacement so reverse-order edits cannot expose
  // a suffix of the same encoded credential.
  const merged: EncodedSecretSpan[] = [];
  for (const span of spans.sort((left, right) => left.start - right.start || left.end - right.end)) {
    const previous = merged.at(-1);
    if (!previous || span.start >= previous.end) {
      merged.push({ ...span, matches: [...span.matches] });
      continue;
    }
    previous.end = Math.max(previous.end, span.end);
    previous.matches.push(...span.matches);
  }
  for (const span of merged) {
    span.matches = [...new Map(span.matches.map((match) => [match.pattern, match])).values()];
  }
  return merged;
}

export function scanTextForSecrets(text: string, options: RedactionOptions = {}): SecretScanResult {
  const allowlist = options.allowlist ?? [];
  const patterns: SecretPattern[] = [
    ...DEFAULT_PATTERNS,
    ...(options.custom_patterns?.map((pattern, index) => ({ name: `custom_${index}`, pattern, custom: true })) ?? []),
  ];
  const matches = collectMatches(text, patterns, allowlist);

  for (const span of collectEncodedSecretSpans(text)) {
    for (const match of span.matches) {
      matches.push({
        pattern: `encoded_${match.pattern}`,
        index: span.start,
        line: lineAt(text, span.start),
      });
    }
  }

  const unique = [...new Map(matches.map((match) => [`${match.pattern}:${match.index}`, match])).values()]
    .sort((left, right) => left.index - right.index || left.pattern.localeCompare(right.pattern));

  return {
    schema_version: SECRET_REDACTION_SCHEMA,
    clean: unique.length === 0,
    matches: unique,
  };
}

export function redactText(text: string, options: RedactionOptions = {}): string {
  const placeholder = options.placeholder ?? REDACTION_PLACEHOLDER;
  const spans: SourceSpan[] = collectEncodedSecretSpans(text);
  for (const { name, pattern, exact_placeholders } of DEFAULT_PATTERNS) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (isExactPlaceholder(match[0], exact_placeholders)) continue;
      spans.push(name === "generic_credential_assignment"
        ? genericValueRange(match)
        : { start: match.index, end: match.index + match[0].length });
      if (match[0].length === 0) re.lastIndex += 1;
    }
  }

  for (const custom of options.custom_patterns ?? []) {
    const flags = custom.flags.includes("g") ? custom.flags : `${custom.flags}g`;
    const re = new RegExp(custom.source, flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      spans.push({ start: match.index, end: match.index + match[0].length });
      if (match[0].length === 0) re.lastIndex += 1;
    }
  }

  const merged: SourceSpan[] = [];
  for (const span of spans.sort((left, right) => left.start - right.start || left.end - right.end)) {
    const previous = merged.at(-1);
    if (!previous || span.start >= previous.end) merged.push({ ...span });
    else previous.end = Math.max(previous.end, span.end);
  }
  let out = text;
  for (const span of merged.reverse()) {
    out = `${out.slice(0, span.start)}${placeholder}${out.slice(span.end)}`;
  }

  for (const fn of customRedactors) {
    out = fn(out);
  }

  return out;
}

export interface SecretScanByteProjection {
  name: "raw-utf8" | "printable-bytes" | "compact-ascii" | "utf16le" | "utf16be";
  text: string;
}

function printableByteProjection(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) {
    output += (byte >= 0x20 && byte <= 0x7e) || byte === 0x09 || byte === 0x0a || byte === 0x0d
      ? String.fromCharCode(byte)
      : "\n";
  }
  return output;
}

function compactAsciiProjection(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) if (byte >= 0x20 && byte <= 0x7e) output += String.fromCharCode(byte);
  return output;
}

function utf16Projection(bytes: Uint8Array, bigEndian: boolean): string {
  const evenLength = bytes.byteLength - (bytes.byteLength % 2);
  const copy = new Uint8Array(evenLength);
  if (bigEndian) {
    for (let index = 0; index < evenLength; index += 2) {
      copy[index] = bytes[index + 1]!;
      copy[index + 1] = bytes[index]!;
    }
  } else {
    copy.set(bytes.subarray(0, evenLength));
  }
  return new TextDecoder("utf-16le").decode(copy);
}

/** Every credential scan must cover raw bytes and representation-bypass views. */
export function secretScanByteProjections(bytes: Uint8Array): SecretScanByteProjection[] {
  return [
    { name: "raw-utf8", text: new TextDecoder("utf-8").decode(bytes) },
    { name: "printable-bytes", text: printableByteProjection(bytes) },
    { name: "compact-ascii", text: compactAsciiProjection(bytes) },
    { name: "utf16le", text: utf16Projection(bytes, false) },
    { name: "utf16be", text: utf16Projection(bytes, true) },
  ];
}

export function scanAndRedactText(text: string, options: RedactionOptions = {}): SecretScanResult {
  const scan = scanTextForSecrets(text, options);
  return {
    ...scan,
    redacted_text: redactText(text, options),
  };
}

export function scanFileForSecrets(path: string, options: RedactionOptions = {}): SecretScanResult {
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  const content = readFileSync(path, "utf8");
  return scanAndRedactText(content, options);
}

/** Safe JSON stringify for CLI/MCP — redacts object fields and embedded secret patterns in strings. */
export function safeStringify(value: unknown, space?: number): string {
  const redacted = typeof value === "object" && value !== null && !Array.isArray(value)
    ? redactObject(value as Record<string, unknown>)
    : value;

  const json = JSON.stringify(redacted, null, space);
  return redactText(json);
}

export function assertNoSecrets(text: string, context?: string): void {
  const scan = scanTextForSecrets(text);
  if (!scan.clean) {
    const summary = scan.matches.map((m) => `${m.pattern}@${m.line ?? m.index}`).join(", ");
    throw new Error(`Secret pattern detected${context ? ` in ${context}` : ""}: ${summary}`);
  }
}

export function redactCommentContent(content: string): string {
  return redactText(content);
}

export function redactHandoffPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return redactObject(payload);
}

export function redactExportRecord(record: Record<string, unknown>): Record<string, unknown> {
  const base = redactObject(record);
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === "string") {
      base[key] = redactText(value);
    }
  }
  return base;
}

export function getDefaultSecretPatterns(): Array<{ name: string; source: string }> {
  return DEFAULT_PATTERNS.map((p) => ({ name: p.name, source: p.pattern.source }));
}
