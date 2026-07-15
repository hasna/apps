import { createHash } from "crypto";
import { ScannerType, type Finding, type FindingInput } from "../types/index.js";
import { containsRecognizedCredential } from "./credential-recognition.js";

export const REDACTED_FINDING_TEXT = "[REDACTED]";

const MAX_LOCATION_LENGTH = 512;
const MAX_MESSAGE_LENGTH = 512;
const MAX_RULE_ID_LENGTH = 128;

type FindingLike = FindingInput | Finding;

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
  return containsRecognizedCredential(value);
}

/** Redact credential values from arbitrary untrusted text before a boundary. */
export function sanitizeTextForBoundary(
  value: string,
  maxLength = MAX_MESSAGE_LENGTH,
): string {
  if (containsCredentialLikeText(value)) {
    return `${REDACTED_FINDING_TEXT} ${stableRedaction(value, "TEXT")}`;
  }
  return boundedSingleLine(value, maxLength);
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

export function sanitizeRuleIdForOutput(value: string): string {
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
  const ruleId = sanitizeRuleIdForOutput(finding.rule_id);
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
