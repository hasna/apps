export type SensitiveContentKind =
  | "private_key"
  | "cloud_key"
  | "bearer_token"
  | "personal_access_token"
  | "database_url"
  | "multiline_env_dump";

export interface SensitiveContentFinding {
  kind: SensitiveContentKind;
  label: string;
  line: number;
}

interface PatternRule {
  kind: SensitiveContentKind;
  label: string;
  pattern: RegExp;
  redaction: string;
}

const KIND_REDACTIONS: Record<SensitiveContentKind, string> = {
  private_key: "[REDACTED:PRIVATE_KEY]",
  cloud_key: "[REDACTED:CLOUD_KEY]",
  bearer_token: "[REDACTED:BEARER_TOKEN]",
  personal_access_token: "[REDACTED:PAT]",
  database_url: "[REDACTED:DATABASE_URL]",
  multiline_env_dump: "[REDACTED:ENV_DUMP]",
};

const AUTH_CHARS = "[A-Za-z0-9._~+/@=-]";
const ASSIGNED_VALUE_PATTERN = String.raw`\s*[:=]\s*["']?[A-Za-z0-9._~+/@=-]{16,}["']?`;

function envKey(...parts: string[]): string {
  return parts.join("_");
}

const CLOUD_ENV_NAMES = [
  envKey("AWS", "SECRET", "ACCESS", "KEY"),
  envKey("AWS", "ACCESS", "KEY", "ID"),
  envKey("GOOGLE", "API", "KEY"),
  envKey("OPENAI", "API", "KEY"),
  envKey("ANTHROPIC", "API", "KEY"),
  envKey("CLOUDFLARE", "API", "TOKEN"),
  envKey("STRIPE", "SECRET", "KEY"),
];

const VCS_ENV_NAMES = [
  envKey("PERSONAL", "ACCESS", "TOKEN"),
  envKey("GITHUB", "TOKEN"),
  envKey("GITLAB", "TOKEN"),
  envKey("GH", "TOKEN"),
  "PAT",
];

const DATABASE_ENV_NAMES = [
  envKey("DATABASE", "URL"),
  envKey("DATABASE", "URI"),
  envKey("DB", "URL"),
  envKey("POSTGRES", "URL"),
  envKey("POSTGRESQL", "URL"),
  envKey("MYSQL", "URL"),
  envKey("MONGODB", "URI"),
  envKey("REDIS", "URL"),
];

const SENSITIVE_PATTERNS: PatternRule[] = [
  {
    kind: "private_key",
    label: "private key",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gi,
    redaction: KIND_REDACTIONS.private_key,
  },
  {
    kind: "private_key",
    label: "private key",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/gi,
    redaction: KIND_REDACTIONS.private_key,
  },
  {
    kind: "cloud_key",
    label: "cloud key",
    pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[A-Z0-9]{16}\b/g,
    redaction: KIND_REDACTIONS.cloud_key,
  },
  {
    kind: "cloud_key",
    label: "cloud key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    redaction: KIND_REDACTIONS.cloud_key,
  },
  {
    kind: "cloud_key",
    label: "cloud key",
    pattern: /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,})\b/g,
    redaction: KIND_REDACTIONS.cloud_key,
  },
  {
    kind: "cloud_key",
    label: "cloud key",
    pattern: new RegExp(String.raw`\b(?:${CLOUD_ENV_NAMES.join("|")})${ASSIGNED_VALUE_PATTERN}`, "gi"),
    redaction: KIND_REDACTIONS.cloud_key,
  },
  {
    kind: "bearer_token",
    label: "bearer token",
    pattern: new RegExp(`\\bBearer\\s+${AUTH_CHARS}{20,}`, "gi"),
    redaction: KIND_REDACTIONS.bearer_token,
  },
  {
    kind: "personal_access_token",
    label: "personal access token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b|github_pat_[A-Za-z0-9_]{20,}\b|glpat-[A-Za-z0-9_-]{20,}\b/g,
    redaction: KIND_REDACTIONS.personal_access_token,
  },
  {
    kind: "personal_access_token",
    label: "personal access token",
    pattern: new RegExp(String.raw`\b(?:${VCS_ENV_NAMES.join("|")})${ASSIGNED_VALUE_PATTERN}`, "gi"),
    redaction: KIND_REDACTIONS.personal_access_token,
  },
  {
    kind: "database_url",
    label: "database URL",
    pattern: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|mssql):\/\/[^\s"'<>`]+/gi,
    redaction: KIND_REDACTIONS.database_url,
  },
];

const ENV_ASSIGNMENT = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*=\s*(.+?)\s*$/;
const MIN_ENV_DUMP_LINES = 3;

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function dedupeFindings(findings: SensitiveContentFinding[]): SensitiveContentFinding[] {
  const seen = new Set<string>();
  const deduped: SensitiveContentFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.kind}:${finding.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

function envDumpRanges(text: string): Array<{ start: number; end: number; line: number }> {
  const ranges: Array<{ start: number; end: number; line: number }> = [];
  const lines = text.matchAll(/[^\n]*(?:\n|$)/g);
  let current: { start: number; end: number; count: number; line: number } | null = null;
  let line = 1;

  for (const match of lines) {
    const rawLine = match[0];
    if (rawLine === "") break;
    const start = match.index ?? 0;
    const end = start + rawLine.length;
    const trimmed = rawLine.trim();
    const isEnvLine = trimmed.length > 0 && !trimmed.startsWith("#") && ENV_ASSIGNMENT.test(rawLine);

    if (isEnvLine) {
      if (!current) current = { start, end, count: 1, line };
      else {
        current.end = end;
        current.count++;
      }
    } else {
      if (current && current.count >= MIN_ENV_DUMP_LINES) {
        ranges.push({ start: current.start, end: current.end, line: current.line });
      }
      current = null;
    }
    line++;
  }

  if (current && current.count >= MIN_ENV_DUMP_LINES) {
    ranges.push({ start: current.start, end: current.end, line: current.line });
  }

  return ranges;
}

export class SensitiveContentError extends Error {
  readonly findings: SensitiveContentFinding[];

  constructor(context: string, findings: SensitiveContentFinding[]) {
    const labels = [...new Set(findings.map((finding) => finding.label))].join(", ");
    super(`${context} blocked: sensitive content detected (${labels}). Remove secrets before sending.`);
    this.name = "SensitiveContentError";
    this.findings = findings;
  }
}

export function scanSensitiveContent(text: string): SensitiveContentFinding[] {
  if (!text) return [];
  const findings: SensitiveContentFinding[] = [];

  for (const rule of SENSITIVE_PATTERNS) {
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({
        kind: rule.kind,
        label: rule.label,
        line: lineNumberAt(text, match.index ?? 0),
      });
    }
  }

  for (const range of envDumpRanges(text)) {
    findings.push({
      kind: "multiline_env_dump",
      label: "multiline env dump",
      line: range.line,
    });
  }

  return dedupeFindings(findings).sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

export function assertNoSensitiveContent(text: string, context = "Message content"): void {
  const findings = scanSensitiveContent(text);
  if (findings.length > 0) {
    throw new SensitiveContentError(context, findings);
  }
}

function scalarKeyValueText(key: string, value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return `${key}=${String(value)}`;
  }
  return null;
}

function normalizeMetadataKey(key: string): string {
  return key.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function metadataKeyFindings(key: string): SensitiveContentFinding[] {
  const normalized = normalizeMetadataKey(key);
  const findings: SensitiveContentFinding[] = [];

  if (CLOUD_ENV_NAMES.includes(normalized)) {
    findings.push({ kind: "cloud_key", label: "cloud key", line: 1 });
  }
  if (VCS_ENV_NAMES.includes(normalized)) {
    findings.push({ kind: "personal_access_token", label: "personal access token", line: 1 });
  }
  if (DATABASE_ENV_NAMES.includes(normalized)) {
    findings.push({ kind: "database_url", label: "database URL", line: 1 });
  }
  if (normalized.includes("PRIVATE_KEY")) {
    findings.push({ kind: "private_key", label: "private key", line: 1 });
  }
  if (normalized === "AUTHORIZATION" || normalized === "BEARER_TOKEN") {
    findings.push({ kind: "bearer_token", label: "bearer token", line: 1 });
  }

  return dedupeFindings(findings);
}

function scanSensitiveValue(value: unknown, seen = new WeakSet<object>()): SensitiveContentFinding[] {
  const findings: SensitiveContentFinding[] = [];

  if (typeof value === "string") {
    findings.push(...scanSensitiveContent(value));
    return findings;
  }

  if (!value || typeof value !== "object") return findings;
  if (seen.has(value)) return findings;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      findings.push(...scanSensitiveValue(item, seen));
    }
    return dedupeFindings(findings);
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const keyFindings = [...scanSensitiveContent(key), ...metadataKeyFindings(key)];
    findings.push(...keyFindings);
    const keyValueText = scalarKeyValueText(key, nested);
    if (keyValueText) findings.push(...scanSensitiveContent(keyValueText));
    findings.push(...scanSensitiveValue(nested, seen));
  }

  return dedupeFindings(findings);
}

export function assertNoSensitiveValue(value: unknown, context = "Message metadata"): void {
  const findings = scanSensitiveValue(value);
  if (findings.length > 0) {
    throw new SensitiveContentError(context, findings);
  }
}

function redactionForFindings(findings: SensitiveContentFinding[]): string {
  return [...new Set(findings.map((finding) => KIND_REDACTIONS[finding.kind]))].join(" ");
}

export function redactSensitiveText(text: string): string {
  if (!text) return text;
  let redacted = text;

  for (const range of envDumpRanges(redacted).sort((a, b) => b.start - a.start)) {
    redacted = `${redacted.slice(0, range.start)}[REDACTED:ENV_DUMP]\n${redacted.slice(range.end)}`;
  }

  for (const rule of SENSITIVE_PATTERNS) {
    redacted = redacted.replace(rule.pattern, rule.redaction);
  }

  return redacted;
}

export function redactSensitiveValue<T>(value: T): T {
  if (typeof value === "string") return redactSensitiveText(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item)) as T;
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      const redactedKey = redactSensitiveText(key);
      const keyFindings = metadataKeyFindings(key);
      const keyValueText = scalarKeyValueText(key, nested);
      const contextualFindings = keyValueText ? scanSensitiveContent(keyValueText) : [];
      const findings = [...keyFindings, ...contextualFindings];
      result[redactedKey] = findings.length > 0
        ? redactionForFindings(findings)
        : redactSensitiveValue(nested);
    }
    return result as T;
  }
  return value;
}
