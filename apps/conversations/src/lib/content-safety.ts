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

/**
 * Verdict tokens from a credential PRESENCE test, which is the idiom the
 * credential-hygiene rules prescribe *instead of* printing a value:
 *
 *   [ -n "${SOME_KEY:-}" ] && echo set || echo unset
 *
 * `SOME_KEY=set` is the opposite of a leak — it is the documented way to avoid
 * one — so treating it as an env dump punished authors for following the rule
 * this guard exists to enforce, and destroyed an incident report that did
 * (message #609657).
 *
 * This narrows detection and cannot mask a credential: a real secret value is
 * never exactly the literal token `set`, `unset`, or `missing`. The exclusion is
 * a fixed, closed list of verdict words — never a length, entropy, or
 * looks-random heuristic, which is where a guard silently stops catching things.
 *
 * STRICTLY the output of a presence test, and nothing else. An earlier revision
 * of this list also carried `true`, `false`, `yes`, `no`, `none`, `null`,
 * `undefined`, `empty`, `ok` and `redacted`. Those are ordinary FLAG VALUES that
 * a real `.env` file is full of, and excluding them from the count silently
 * weakened the guard: a dump of two real secrets beside three boolean flags
 * stopped reaching MIN_ENV_DUMP_LINES, so it was neither redacted NOR blocked at
 * send — `assertNoSensitiveContent` throws only when a finding exists, so the
 * credential was accepted and persisted.
 *
 * The distinction that was lost, and is the reason this list stays short: a flag
 * line must not TERMINATE a run, but it must still COUNT toward one. Those are
 * different questions, and classifying `DEBUG=true` as a `value` answers both
 * correctly — exactly as the pre-fix code did.
 */
const PRESENCE_VERDICTS = new Set([
  "set",
  "unset",
  "present",
  "absent",
  "missing",
]);

function isPresenceVerdict(rawValue: string): boolean {
  const bare = rawValue
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/^[<(\[]|[>)\]]$/g, "")
    .trim()
    .toLowerCase();
  return PRESENCE_VERDICTS.has(bare);
}

type EnvLineKind = "value" | "verdict" | "other";

/**
 * Classify a line for env-dump detection.
 *
 *  - "value"   — `NAME=<something that could be a real value>`, INCLUDING flag
 *                values like `DEBUG=true`. A flag is still a value: it counts
 *                toward a dump, because real `.env` pastes mix flags and secrets.
 *  - "verdict" — `NAME=set` / `NAME=unset`: the output of a presence test, which
 *                is definitionally not a value
 *  - "other"   — anything else, including prose and comments
 */
function classifyEnvLine(rawLine: string): EnvLineKind {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#")) return "other";

  const match = ENV_ASSIGNMENT.exec(rawLine);
  if (!match) return "other";

  return isPresenceVerdict(match[2] ?? "") ? "verdict" : "value";
}

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
    const kind = classifyEnvLine(rawLine);

    if (kind === "value") {
      if (!current) current = { start, end, count: 1, line };
      else {
        current.end = end;
        current.count++;
      }
    } else if (kind === "verdict") {
      // NEUTRAL, deliberately: a presence verdict neither counts toward a dump
      // nor breaks one.
      //
      // Not counting is what lets the sanctioned presence test survive.
      // Not breaking is what keeps a report that MIXES a presence check into a
      // genuine paste from splitting into runs too short to detect.
      //
      // Only true presence verdicts (`set`/`unset`/...) reach this branch.
      // Ordinary flag values such as `DEBUG=true` are classified "value" and
      // COUNT, which is what the pre-fix code did and what must not regress:
      // a real .env paste is mostly flags, and a threshold that ignores them
      // stops firing on the dumps it exists to catch.
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

      // Whole-value replacement applies in exactly ONE case: the KEY itself
      // declares the field to be a credential (DATABASE_URL, AWS_SECRET_ACCESS_KEY,
      // authorization, ...). There the entire value IS the secret, so partial
      // survival would leak it.
      //
      // In every other case the value is ordinary content that merely CONTAINS
      // something sensitive-looking, and it is redacted span-by-span via
      // redactSensitiveText. Replacing it wholesale is what silently destroyed
      // real messages: a message body carrying one connection string was stored
      // as nothing but "[REDACTED:DATABASE_URL]", taking an entire incident
      // report with it (#608243, #609657).
      //
      // This does not weaken detection. The span redactor still replaces every
      // match; the difference is blast radius, not whether the secret survives.
      if (metadataKeyFindings(key).length > 0) {
        result[redactedKey] = redactionForFindings(metadataKeyFindings(key));
        continue;
      }

      result[redactedKey] = redactSensitiveValue(nested);
    }
    return result as T;
  }
  return value;
}

/**
 * Outcome of a redaction pass: the redacted payload plus what fired.
 *
 * Redaction that nobody can observe is how three messages were destroyed before
 * anyone noticed. Every redacting entry point has a reporting twin so the caller
 * can tell the author their message was rewritten.
 */
export interface RedactionOutcome<T> {
  value: T;
  findings: SensitiveContentFinding[];
  redacted: boolean;
}

export function redactSensitiveTextWithFindings(text: string): { text: string; findings: SensitiveContentFinding[]; redacted: boolean } {
  const findings = scanSensitiveContent(text);
  return { text: redactSensitiveText(text), findings, redacted: findings.length > 0 };
}

export function redactSensitiveValueWithFindings<T>(value: T): RedactionOutcome<T> {
  const findings = scanSensitiveValue(value);
  return { value: redactSensitiveValue(value), findings, redacted: findings.length > 0 };
}

/**
 * Attach a redaction notice to a just-written message, at the STORE FUNNEL.
 *
 * Every body-persisting path — CLI send/reply/edit/broadcast, MCP send_message /
 * send_to_channel / reply / edit_message / send_to_session, the HTTP routes and
 * the TUI — goes through ConversationsStore.sendMessage or .editMessage. Doing
 * the check here means a new send path inherits it instead of having to remember
 * it.
 *
 * Hand-applying the notice per call site is what left `broadcast` reporting
 * `total: N` successes while every one of the N bodies had been replaced.
 *
 * The field is set only when the body actually changed, so absence is a positive
 * statement: the funnel checked, and nothing was rewritten.
 */
export function attachSendRedaction<T extends { content?: string | null }>(
  submitted: string,
  msg: T,
): T & { redaction?: SendRedactionNotice } {
  const notice = describeSendRedaction(submitted, msg?.content ?? null);
  if (!notice.redacted) return msg;
  return { ...msg, redaction: notice };
}

export interface SendRedactionNotice {
  redacted: boolean;
  findings: SensitiveContentFinding[];
  labels: string[];
  message: string;
}

/**
 * Compare what an author submitted against what readers will actually see.
 *
 * This is deliberately a DIFF of the stored/rendered content rather than a
 * re-run of the patterns, so it reports honestly no matter which layer did the
 * rewriting — local SQLite, the cloud API response redactor, or a server on an
 * older build. A notice derived from re-scanning would agree with itself and
 * miss exactly the divergence that made this silent.
 *
 * The failure this closes: a send returned success and a real message id while
 * the body had been replaced wholesale, so the author had no way to know. All
 * three known losses were found by a different agent reading the channel.
 */
export function describeSendRedaction(submitted: string, stored: string | null | undefined): SendRedactionNotice {
  const rendered = stored ?? "";
  if (submitted === rendered) {
    return { redacted: false, findings: [], labels: [], message: "" };
  }

  const findings = scanSensitiveContent(submitted);
  const labels = [...new Set(findings.map((finding) => finding.label))];
  const wholeMessage = rendered.trim().startsWith("[REDACTED") && !rendered.includes("\n");
  const detail = labels.length > 0 ? ` (${labels.join(", ")})` : "";

  // Wording matters here: the row is written RAW and rewritten when rendered, so
  // "stored as" would teach the opposite of what is true and send anyone chasing
  // a recovery down the wrong path. What the author needs to know is what
  // READERS get.
  return {
    redacted: true,
    findings,
    labels,
    message: wholeMessage
      ? `Readers will see only "${rendered.trim()}" — your ENTIRE body was replaced${detail}.`
      : `Readers will see this message with redactions applied${detail}. Part of what you wrote will not reach them.`,
  };
}
