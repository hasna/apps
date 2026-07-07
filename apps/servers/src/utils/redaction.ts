const REDACTED_VALUE = "[redacted]";
const SENSITIVE_KEY_PATTERN = /(?:^|[_-])(secret|token|key|password|passwd|credential|authorization|auth|cookie|session|private)(?:$|[_-])/i;
const SENSITIVE_KEY_WORDS = new Set(["secret", "token", "key", "password", "passwd", "credential", "authorization", "auth", "cookie", "session", "private"]);

function splitIdentifierWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function isSensitiveKey(key: string): boolean {
  if (SENSITIVE_KEY_PATTERN.test(key) || /api[_-]?key/i.test(key) || /access[_-]?token/i.test(key) || /refresh[_-]?token/i.test(key)) {
    return true;
  }

  return splitIdentifierWords(key).some((word) => SENSITIVE_KEY_WORDS.has(word));
}

function redactSensitiveString(value: string): string {
  return value
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD|CREDENTIAL|AUTH)[A-Za-z0-9_]*\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s;&|]+)/gi, "$1[redacted]")
    .replace(/([?&][^=\s&]*(?:secret|token|key|password|passwd|credential|auth)[^=\s&]*=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]");
}

export function redactSensitiveFields<T>(value: T): T {
  if (typeof value === "string") {
    return redactSensitiveString(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item)) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = isSensitiveKey(key) && child != null ? REDACTED_VALUE : redactSensitiveFields(child);
  }

  return redacted as T;
}
