import { createHash } from "crypto";
import { ScannerType, type Finding, type FindingInput, type Scan } from "../types/index.js";
import { containsRecognizedCredential } from "./credential-recognition.js";

export const REDACTED_FINDING_TEXT = "[REDACTED]";

const MAX_LOCATION_LENGTH = 512;
const MAX_MESSAGE_LENGTH = 512;
const MAX_RULE_ID_LENGTH = 128;
const MAX_IDENTIFIER_LENGTH = 256;

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

/**
 * Produce a durable opaque key for replacing a credential-bearing database
 * identifier. Callers verify uniqueness against the destination table and
 * deterministically retry on the theoretical 48-bit correlation collision.
 * Keeping the visible correlation short also prevents the opaque replacement
 * itself from being classified as a high-entropy credential.
 */
export function opaqueIdentifierForStorage(
  value: string,
  kind: string,
  attempt = 0,
): string {
  const safeKind = kind.replace(/[^A-Z0-9_-]/gi, "-").toUpperCase();
  const correlation = createHash("sha256")
    .update(`${safeKind}\0${value}\0${attempt}`)
    .digest("hex")
    .slice(0, 12);
  return `[REDACTED-${safeKind}:${correlation}]`;
}

/** Preserve correlation without retaining a credential-bearing identifier. */
export function sanitizeIdentifierForOutput(value: string, kind = "ID"): string {
  return containsCredentialLikeText(value)
    ? stableRedaction(value, kind.replace(/[^A-Z0-9_-]/gi, "-").toUpperCase())
    : boundedSingleLine(value, MAX_IDENTIFIER_LENGTH);
}

export function sanitizeFingerprintForOutput(value: string): string {
  return sanitizeIdentifierForOutput(value, "FINGERPRINT");
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
    ...("id" in finding ? { id: sanitizeIdentifierForOutput(finding.id, "ID") } : {}),
    ...("scan_id" in finding
      ? { scan_id: sanitizeIdentifierForOutput(finding.scan_id, "SCAN-ID") }
      : {}),
    rule_id: ruleId,
    scanner_type: sanitizeTextForBoundary(String(finding.scanner_type), 128),
    severity: sanitizeTextForBoundary(String(finding.severity), 128),
    file: sanitizeLocationForOutput(finding.file),
    message: sensitive
      ? `Potential credential exposure detected (${ruleId})`
      : sanitizeTextForBoundary(finding.message, MAX_MESSAGE_LENGTH),
    ...(finding.code_snippet != null ? { code_snippet: REDACTED_FINDING_TEXT } : {}),
    ...("fingerprint" in finding
      ? { fingerprint: sanitizeFingerprintForOutput(finding.fingerprint) }
      : {}),
    ...("created_at" in finding
      ? { created_at: sanitizeTextForBoundary(finding.created_at, 128) }
      : {}),
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
  // This final recursive pass is intentional: a newly added string field must
  // be safe by default until it receives a more specific correlation policy.
  return sanitizeValueForBoundary(result);
}

export function sanitizeFindingForPersistence<T extends FindingLike>(finding: T): T {
  return sanitizeFinding(finding);
}

export function sanitizeFindingForOutput<T extends FindingLike>(finding: T): T {
  return sanitizeFinding(finding);
}

export function sanitizeScanForOutput(scan: Scan): Scan {
  const safe = {
    ...scan,
    id: sanitizeIdentifierForOutput(scan.id, "SCAN-ID"),
    project_id: sanitizeIdentifierForOutput(scan.project_id, "PROJECT-ID"),
    status: sanitizeTextForBoundary(String(scan.status), 128),
    scanner_types: scan.scanner_types.map((scannerType) =>
      sanitizeTextForBoundary(String(scannerType), 128)),
    started_at: sanitizeTextForBoundary(scan.started_at, 128),
    completed_at: scan.completed_at == null
      ? null
      : sanitizeTextForBoundary(scan.completed_at, 128),
    error: scan.error == null ? null : sanitizeTextForBoundary(scan.error, MAX_MESSAGE_LENGTH),
    created_at: sanitizeTextForBoundary(scan.created_at, 128),
  } as Scan;
  return sanitizeValueForBoundary(safe);
}
