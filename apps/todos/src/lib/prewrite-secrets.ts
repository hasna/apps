import { listSecretFindings, redactEvidenceText, redactValue } from "./redaction.js";
import { redactText, scanTextForSecrets } from "./secret-redaction.js";

export const PREWRITE_SECRET_SCAN_SCHEMA = ["todos", "prewrite_secret_scan", "v1"].join(".");

export type PreWriteSecretMode = "redact" | "block";

export interface PreWriteSecretFinding {
  pattern: string;
  count: number;
  lines: number[];
}

export interface PreWriteSecretScanResult {
  schema_version: typeof PREWRITE_SECRET_SCAN_SCHEMA;
  clean: boolean;
  context: string;
  findings: PreWriteSecretFinding[];
}

export class PreWriteSecretError extends Error {
  readonly context: string;
  readonly findings: PreWriteSecretFinding[];

  constructor(context: string, findings: PreWriteSecretFinding[]) {
    const summary = findings.map((finding) => `${finding.pattern}:${finding.count}`).join(", ");
    super(`Secret pattern detected before persistence in ${context}: ${summary}`);
    this.name = "PreWriteSecretError";
    this.context = context;
    this.findings = findings;
  }
}

function mergeFindings(findings: PreWriteSecretFinding[]): PreWriteSecretFinding[] {
  const byPattern = new Map<string, PreWriteSecretFinding>();
  for (const finding of findings) {
    const existing = byPattern.get(finding.pattern);
    if (!existing) {
      byPattern.set(finding.pattern, {
        pattern: finding.pattern,
        count: finding.count,
        lines: Array.from(new Set(finding.lines)).sort((a, b) => a - b),
      });
      continue;
    }
    existing.count += finding.count;
    existing.lines = Array.from(new Set([...existing.lines, ...finding.lines])).sort((a, b) => a - b);
  }
  return [...byPattern.values()].sort((left, right) => left.pattern.localeCompare(right.pattern));
}

export function redactPreWriteText(value: string): string {
  return redactText(redactEvidenceText(value));
}

export function scanPreWriteText(value: string, context = "text"): PreWriteSecretScanResult {
  const redacted = redactPreWriteText(value);
  if (redacted === value) {
    return {
      schema_version: PREWRITE_SECRET_SCAN_SCHEMA,
      clean: true,
      context,
      findings: [],
    };
  }

  const structural = scanTextForSecrets(value).matches.map((match) => ({
    pattern: match.pattern,
    count: 1,
    lines: match.line ? [match.line] : [],
  }));
  const configured = listSecretFindings(value).map((finding) => ({
    pattern: finding.pattern,
    count: finding.count,
    lines: [],
  }));

  return {
    schema_version: PREWRITE_SECRET_SCAN_SCHEMA,
    clean: false,
    context,
    findings: mergeFindings([...structural, ...configured]),
  };
}

export function assertPreWriteTextClean(value: string, context = "text"): void {
  const scan = scanPreWriteText(value, context);
  if (!scan.clean) throw new PreWriteSecretError(context, scan.findings);
}

export function sanitizePreWriteText(
  value: string,
  context = "text",
  options: { mode?: PreWriteSecretMode } = {},
): string {
  const mode = options.mode ?? "redact";
  if (mode === "block") {
    assertPreWriteTextClean(value, context);
    return value;
  }
  return redactPreWriteText(value);
}

export function sanitizePreWriteValue<T>(
  value: T,
  context = "value",
  options: { mode?: PreWriteSecretMode } = {},
): T {
  if (typeof value === "string") return sanitizePreWriteText(value, context, options) as T;
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizePreWriteValue(item, `${context}[${index}]`, options)) as T;
  }
  if (value && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const safeKey = sanitizePreWriteText(key, `${context}.$key`, options);
      sanitized[safeKey] = sanitizePreWriteValue(child, `${context}.${safeKey}`, options);
    }
    return redactValue(sanitized) as T;
  }
  return value;
}

export function sanitizePreWriteJsonString(value: string | null | undefined, context = "json"): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(sanitizePreWriteValue(JSON.parse(value), context));
  } catch {
    return sanitizePreWriteText(value, context);
  }
}
