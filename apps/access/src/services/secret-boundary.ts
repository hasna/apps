import { ValidationError } from "../types/index.js";

const SECRET_REF_MAX_LENGTH = 256;
const SECRET_REF_PATH_RE = /^[a-z0-9][a-z0-9._-]*(\/@?[a-z0-9][a-z0-9._:@-]*)+$/i;
const SECRET_REF_PROVIDER_RE = /^provider:[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._:@-]*$/i;

const RAW_SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:sk-[A-Za-z0-9_-]{8,}|xai-[A-Za-z0-9_-]{8,}|npm_[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9_]{8,}|gho_[A-Za-z0-9_]{8,}|ghs_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]+|glpat-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{12,}|ASIA[0-9A-Z]{12,})\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i,
  /\bapi[_-]?key\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{20,}/i,
  /\btoken\s*[:=]\s*["']?(?:[A-Za-z0-9._~+/-]{32,}|[A-Za-z0-9._~+/-]*[=_-][A-Za-z0-9._~+/-]{16,})/i,
];

export function assertNoRawSecretValues(value: unknown, fieldPath: string): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (RAW_SECRET_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      throw new ValidationError(`${fieldPath} looks like a raw secret value; store only secret_ref references.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRawSecretValues(item, `${fieldPath}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      assertNoRawSecretValues(item, `${fieldPath}.${key}`);
    }
  }
}

export function validateSecretRef(value: string, fieldPath = "secret_ref"): string {
  const secretRef = value?.trim();
  if (!secretRef) throw new ValidationError(`${fieldPath} is required.`);
  assertNoRawSecretValues(secretRef, fieldPath);
  if (
    secretRef.length > SECRET_REF_MAX_LENGTH ||
    /[\s\x00-\x1f\x7f]/.test(secretRef) ||
    (!SECRET_REF_PATH_RE.test(secretRef) && !SECRET_REF_PROVIDER_RE.test(secretRef))
  ) {
    throw new ValidationError(
      `${fieldPath} must be a namespaced secret reference path like hasna/access/name or provider:<provider>:<kind>:<id>.`,
    );
  }
  return secretRef;
}
