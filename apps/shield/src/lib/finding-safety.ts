import { createHash } from "crypto";
import { ScannerType, type Finding, type FindingInput } from "../types/index.js";

export const REDACTED_FINDING_TEXT = "[REDACTED]";

const MAX_LOCATION_LENGTH = 512;
const MAX_MESSAGE_LENGTH = 512;
const MAX_RULE_ID_LENGTH = 128;

type FindingLike = FindingInput | Finding;

// Deliberately conservative credential-value patterns. These run at trust
// boundaries in addition to the scanner's richer detection rules, so adjacent
// secrets cannot ride along with an otherwise non-credential finding.
const CREDENTIAL_PATTERNS: RegExp[] = [
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/gi,
  /\bgh[opusr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bASIA[0-9A-Z]{16}\b/g,
  /(?:aws_secret_access_key|aws_secret_key|secret_access_key)\s*[=:]\s*["']?[A-Za-z0-9/+=]{40}["']?/gi,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bsk_(?:live|test)_[A-Za-z0-9]{12,}\b/gi,
  /\bpk_live_[A-Za-z0-9]{24,}\b/gi,
  /\bsk-(?:live|test|proj)-[A-Za-z0-9_-]{12,}\b/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}={0,2}\b/gi,
  /\b(?:api[_-]?key|access[_-]?key|secret(?:[_-]?key)?|token|password|passwd|passphrase|credential)\s*[:=]\s*["']?[^\s"'`,;]{8,}["']?/gi,
  /\b(?:https?|ssh):\/\/[^\s/:@]+:[^\s/@]+@[^\s]+/gi,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi,
];

function boundedSingleLine(value: string, maxLength: number): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function stableRedaction(value: string, kind: string): string {
  const correlation = createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `[REDACTED-${kind}:${correlation}]`;
}

export function containsCredentialLikeText(value: string | null | undefined): boolean {
  if (!value) return false;
  if (CREDENTIAL_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  })) return true;

  // Refuse high-entropy opaque tokens even when they do not match a named
  // provider format. This mirrors the scanner's last-resort secret heuristic.
  for (const candidate of value.match(/[A-Za-z0-9+/=_-]{20,}/g) ?? []) {
    const frequencies = new Map<string, number>();
    for (const character of candidate) {
      frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
    }
    let entropy = 0;
    for (const count of frequencies.values()) {
      const probability = count / candidate.length;
      entropy -= probability * Math.log2(probability);
    }
    if (entropy > 5) return true;
  }
  return false;
}

/** Redact credential values from arbitrary untrusted text before a boundary. */
export function sanitizeTextForBoundary(
  value: string,
  maxLength = MAX_MESSAGE_LENGTH,
): string {
  if (containsCredentialLikeText(value)) {
    return `${REDACTED_FINDING_TEXT} ${stableRedaction(value, "TEXT")}`;
  }
  let sanitized = value;
  for (const pattern of CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, REDACTED_FINDING_TEXT);
  }
  return boundedSingleLine(sanitized, maxLength);
}

/** Recursively sanitize JSON-compatible data before persistence or output. */
export function sanitizeValueForBoundary<T>(value: T): T {
  if (typeof value === "string") return sanitizeTextForBoundary(value, 12_000) as T;
  if (Array.isArray(value)) return value.map(sanitizeValueForBoundary) as T;
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[sanitizeTextForBoundary(key, 256)] = sanitizeValueForBoundary(entry);
    }
    return result as T;
  }
  return value;
}

export function sanitizeLocationForOutput(value: string): string {
  return containsCredentialLikeText(value)
    ? stableRedaction(value, "LOCATION")
    : boundedSingleLine(value, MAX_LOCATION_LENGTH);
}

function safeRuleId(value: string): string {
  if (containsCredentialLikeText(value)) return stableRedaction(value, "RULE");
  const normalized = value.replace(/[^A-Za-z0-9._-]/g, "-");
  return boundedSingleLine(normalized || "finding", MAX_RULE_ID_LENGTH);
}

export function isCredentialFinding(finding: Pick<FindingLike, "rule_id" | "scanner_type" | "message">): boolean {
  if (finding.scanner_type === ScannerType.Secrets || finding.scanner_type === ScannerType.GitHistory) {
    return true;
  }

  return /(?:secret|credential|password|passphrase|private[-_ ]?key|api[-_ ]?key|access[-_ ]?key|token|bearer|high[-_ ]?entropy)/i.test(
    `${finding.rule_id} ${finding.message}`,
  );
}

function sanitizeFinding<T extends FindingLike>(finding: T): T {
  const sensitive = isCredentialFinding(finding);
  const ruleId = safeRuleId(finding.rule_id);
  const result = {
    ...finding,
    rule_id: ruleId,
    file: sanitizeLocationForOutput(finding.file),
    message: sensitive
      ? `Potential credential exposure detected (${ruleId})`
      : sanitizeTextForBoundary(finding.message, MAX_MESSAGE_LENGTH),
    ...(finding.code_snippet != null ? { code_snippet: REDACTED_FINDING_TEXT } : {}),
  } as T;

  if ("llm_explanation" in result && result.llm_explanation != null) {
    result.llm_explanation = sensitive
      ? REDACTED_FINDING_TEXT
      : sanitizeTextForBoundary(result.llm_explanation, MAX_MESSAGE_LENGTH);
  }
  if ("llm_fix" in result && result.llm_fix != null) {
    result.llm_fix = sensitive
      ? REDACTED_FINDING_TEXT
      : sanitizeTextForBoundary(result.llm_fix, MAX_MESSAGE_LENGTH);
  }
  if ("suppressed_reason" in result && result.suppressed_reason != null) {
    result.suppressed_reason = sensitive
      ? REDACTED_FINDING_TEXT
      : sanitizeTextForBoundary(result.suppressed_reason, MAX_MESSAGE_LENGTH);
  }
  return result;
}

export function sanitizeFindingForPersistence<T extends FindingLike>(finding: T): T {
  return sanitizeFinding(finding);
}

export function sanitizeFindingForOutput<T extends FindingLike>(finding: T): T {
  return sanitizeFinding(finding);
}
