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
  /** If true, allowlisted contexts skip this pattern */
  allowlist_ok?: boolean;
}

export interface SecretMatch {
  pattern: string;
  match: string;
  index: number;
  line?: number;
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

const DEFAULT_PATTERNS: SecretPattern[] = [
  { name: "openai_sk", pattern: /\bsk-[a-zA-Z0-9]{10,}\b/g },
  { name: "github_pat", pattern: /\bghp_[a-zA-Z0-9]{20,}\b/g },
  { name: "github_oauth", pattern: /\bgho_[a-zA-Z0-9]{20,}\b/g },
  { name: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "bearer_token", pattern: /\bBearer\s+[a-zA-Z0-9\-._~+/]+=*\b/gi },
  { name: "jwt", pattern: /\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g },
  { name: "private_key_block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "generic_api_key", pattern: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"]?[a-zA-Z0-9\-._]{8,}['"]?/gi, allowlist_ok: true },
];

const DEFAULT_ALLOWLIST: RegExp[] = [
  /\[REDACTED\]/,
  /example\.com/i,
  /your-api-key-here/i,
  /sk-test/i,
  /ghp_xxx/i,
];

let customRedactors: Array<(text: string) => string> = [];

export function registerCustomRedactor(fn: (text: string) => string): void {
  customRedactors.push(fn);
}

export function resetCustomRedactors(): void {
  customRedactors = [];
}

function isAllowlisted(text: string, match: string, allowlist: RegExp[]): boolean {
  const context = text.slice(Math.max(0, text.indexOf(match) - 20), text.indexOf(match) + match.length + 20);
  return allowlist.some((re) => re.test(context) || re.test(match));
}

export function scanTextForSecrets(text: string, options: RedactionOptions = {}): SecretScanResult {
  const allowlist = [...DEFAULT_ALLOWLIST, ...(options.allowlist ?? [])];
  const matches: SecretMatch[] = [];
  const patterns: SecretPattern[] = [
    ...DEFAULT_PATTERNS,
    ...(options.custom_patterns?.map((p, i) => ({ name: `custom_${i}`, pattern: p })) ?? []),
  ];

  for (const { name, pattern, allowlist_ok } of patterns) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const match = m[0];
      if (allowlist_ok && isAllowlisted(text, match, allowlist)) continue;
      if (isAllowlisted(text, match, allowlist)) continue;
      const line = text.slice(0, m.index).split("\n").length;
      matches.push({ pattern: name, match: match.slice(0, 12) + (match.length > 12 ? "…" : ""), index: m.index, line });
    }
  }

  return {
    schema_version: SECRET_REDACTION_SCHEMA,
    clean: matches.length === 0,
    matches,
  };
}

export function redactText(text: string, options: RedactionOptions = {}): string {
  const placeholder = options.placeholder ?? REDACTION_PLACEHOLDER;
  let out = text;

  for (const { pattern, allowlist_ok } of DEFAULT_PATTERNS) {
    out = out.replace(new RegExp(pattern.source, pattern.flags), (match) => {
      if (allowlist_ok && isAllowlisted(out, match, [...DEFAULT_ALLOWLIST, ...(options.allowlist ?? [])])) {
        return match;
      }
      return placeholder;
    });
  }

  for (const custom of options.custom_patterns ?? []) {
    out = out.replace(custom, placeholder);
  }

  for (const fn of customRedactors) {
    out = fn(out);
  }

  return out;
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
