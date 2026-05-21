export function redactEvidenceText(value: string): string {
  return value
    .replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]")
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\b([A-Za-z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Za-z0-9_]*)\s*=\s*['"]?[^'"\s]{8,}/gi, "$1=[REDACTED]")
    .replace(/\b(bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 [REDACTED]");
}

export function redactValue<T>(value: T): T {
  if (typeof value === "string") return redactEvidenceText(value) as T;
  if (Array.isArray(value)) return value.map(redactValue) as T;
  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/api[_-]?key|token|secret|password/i.test(key)) {
        redacted[key] = "[REDACTED]";
      } else {
        redacted[key] = redactValue(child);
      }
    }
    return redacted as T;
  }
  return value;
}
