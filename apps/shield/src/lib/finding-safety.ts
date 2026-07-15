import { ScannerType, type Finding, type FindingInput } from "../types/index.js";

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

function safeRuleId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/g, "-");
  return boundedSingleLine(normalized || "credential", MAX_RULE_ID_LENGTH);
}

export function isCredentialFinding(finding: Pick<FindingLike, "rule_id" | "scanner_type" | "message">): boolean {
  if (finding.scanner_type === ScannerType.Secrets || finding.scanner_type === ScannerType.GitHistory) {
    return true;
  }

  return /(?:secret|credential|password|passphrase|private[-_ ]?key|api[-_ ]?key|access[-_ ]?key|token|bearer|high[-_ ]?entropy)/i.test(
    `${finding.rule_id} ${finding.message}`,
  );
}

export function sanitizeFindingForPersistence<T extends FindingLike>(finding: T): T {
  if (!isCredentialFinding(finding)) return finding;

  return {
    ...finding,
    file: boundedSingleLine(finding.file, MAX_LOCATION_LENGTH),
    message: `Potential credential exposure detected (${safeRuleId(finding.rule_id)})`,
    ...(finding.code_snippet != null ? { code_snippet: REDACTED_FINDING_TEXT } : {}),
  } as T;
}

export function sanitizeFindingForOutput<T extends FindingLike>(finding: T): T {
  const sensitive = isCredentialFinding(finding);
  const result = {
    ...finding,
    file: boundedSingleLine(finding.file, MAX_LOCATION_LENGTH),
    message: sensitive
      ? `Potential credential exposure detected (${safeRuleId(finding.rule_id)})`
      : boundedSingleLine(finding.message, MAX_MESSAGE_LENGTH),
    ...(finding.code_snippet != null ? { code_snippet: REDACTED_FINDING_TEXT } : {}),
  } as T;

  if ("llm_explanation" in result && result.llm_explanation != null) {
    result.llm_explanation = sensitive
      ? REDACTED_FINDING_TEXT
      : boundedSingleLine(result.llm_explanation, MAX_MESSAGE_LENGTH);
  }
  if ("llm_fix" in result && result.llm_fix != null) {
    result.llm_fix = sensitive
      ? REDACTED_FINDING_TEXT
      : boundedSingleLine(result.llm_fix, MAX_MESSAGE_LENGTH);
  }
  if ("suppressed_reason" in result && result.suppressed_reason != null) {
    result.suppressed_reason = sensitive
      ? REDACTED_FINDING_TEXT
      : boundedSingleLine(result.suppressed_reason, MAX_MESSAGE_LENGTH);
  }

  return result;
}
