export interface RedactionResult {
  value: unknown;
  findings: string[];
}

const secretPatternParts = [
  "sk-" + "ant-",
  "sk-" + "proj-",
  "npm" + "_[A-Za-z]",
  "gh" + "o_",
  "gh" + "p_",
  "secret-" + "token:",
  "ctx7" + "sk-",
  "x" + "ai-",
  "AI" + "za[A-Za-z0-9]",
  "AK" + "IA[A-Z0-9]"
];

const secretPattern = new RegExp(secretPatternParts.join("|"));
const sensitiveKeyPattern = /secret|token|key|password/i;
const envNamePattern = /^[A-Z][A-Z0-9_]{2,}$/;

export function containsRawSecret(input: unknown): boolean {
  return collectSecretFindings(input).length > 0;
}

export function assertNoRawSecrets(input: unknown, context: string): void {
  const findings = collectSecretFindings(input);
  if (findings.length > 0) {
    throw new Error(`${context} contains raw credential-shaped values at ${findings.join(", ")}`);
  }
}

export function collectSecretFindings(input: unknown, path = "$"): string[] {
  if (typeof input === "string") return secretPattern.test(input) ? [path] : [];
  if (Array.isArray(input)) return input.flatMap((entry, index) => collectSecretFindings(entry, `${path}[${index}]`));
  if (input && typeof input === "object") {
    return Object.entries(input as Record<string, unknown>).flatMap(([key, value]) =>
      collectSecretFindings(value, `${path}.${key}`)
    );
  }
  return [];
}

export function redactEvidence(input: unknown): unknown {
  return redactEvidenceWithFindings(input).value;
}

export function redactEvidenceWithFindings(input: unknown): RedactionResult {
  const findings: string[] = [];

  function redact(value: unknown, path: string): unknown {
    if (typeof value === "string") {
      if (!secretPattern.test(value)) return value;
      findings.push(path);
      return "[REDACTED]";
    }
    if (Array.isArray(value)) return value.map((entry, index) => redact(entry, `${path}[${index}]`));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
          const childPath = `${path}.${key}`;
          if (sensitiveKeyPattern.test(key)) {
            if (isSafeSecretReferenceValue(entry)) return [key, entry];
            findings.push(childPath);
            return [key, "[REDACTED]"];
          }
          return [key, redact(entry, childPath)];
        })
      );
    }
    return value;
  }

  return {
    value: redact(input, "$"),
    findings
  };
}

function isSafeSecretReferenceValue(input: unknown): boolean {
  if (typeof input === "string") return envNamePattern.test(input) && !secretPattern.test(input);
  if (Array.isArray(input)) {
    return input.every((entry) => typeof entry === "string" && envNamePattern.test(entry) && !secretPattern.test(entry));
  }
  return false;
}
