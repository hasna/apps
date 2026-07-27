import { loadConfig, saveConfig, type SecretSafetyConfig } from "./config.js";

export interface SecretFinding {
  pattern: string;
  count: number;
}

interface SecretPattern {
  name: string;
  regex: RegExp;
  replacement?: string | ((substring: string, ...args: string[]) => string);
}

const DEFAULT_SECRET_PATTERNS: SecretPattern[] = [
  { name: "aws-access-key", regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, replacement: "[REDACTED_AWS_KEY]" },
  { name: "private-key", regex: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g, replacement: "[REDACTED_PRIVATE_KEY]" },
  { name: "openai-token", regex: /\bsk-[A-Za-z0-9_-]{12,}\b/g, replacement: "[REDACTED_TOKEN]" },
  { name: "npm-token", regex: /\bnpm_[A-Za-z0-9]{20,}\b/g, replacement: "[REDACTED_NPM_TOKEN]" },
  { name: "github-fine-grained-token", regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: "[REDACTED_GITHUB_TOKEN]" },
  { name: "github-token", regex: /\bgh[opsu]_[A-Za-z0-9]{20,}\b/g, replacement: "[REDACTED_GITHUB_TOKEN]" },
  { name: "env-secret-assignment", regex: /\b([A-Za-z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Za-z0-9_]*)\s*=\s*['"]?[^'"\s]{8,}/gi, replacement: "$1=[REDACTED]" },
  { name: "bearer-token", regex: /\b(bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi, replacement: "$1 [REDACTED]" },
];

const DEFAULT_SECRET_KEY_PATTERN = /api[_-]?key|token|secret|password/i;
const NON_SECRET_USAGE_KEYS = new Set([
  "tokens",
  "total_tokens",
  "token_count",
  "input_tokens",
  "output_tokens",
  "prompt_tokens",
  "completion_tokens",
  "cost_tokens",
]);

function unique(values: string[] | undefined): string[] {
  return Array.from(new Set((values || []).map((value) => value.trim()).filter(Boolean)));
}

function cloneRegex(regex: RegExp): RegExp {
  return new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
}

function customPatterns(): SecretPattern[] {
  return unique(loadConfig().secret_safety?.redaction_patterns).flatMap((pattern) => {
    try {
      return [{ name: `custom:${pattern}`, regex: new RegExp(pattern, "g") }];
    } catch {
      return [];
    }
  });
}

function secretPatterns(): SecretPattern[] {
  return [...customPatterns(), ...DEFAULT_SECRET_PATTERNS];
}

const REDACTION_PLACEHOLDER = String.raw`\[REDACTED(?:_[A-Z_]+)?\]`;

function isRedactionPlaceholderMatch(match: string): boolean {
  const trimmed = match.trim();
  return new RegExp(`^${REDACTION_PLACEHOLDER}$`).test(trimmed)
    || new RegExp(`=\\s*['"]?${REDACTION_PLACEHOLDER}['"]?$`).test(trimmed);
}

/**
 * True only when the key is *entirely* a placeholder, e.g. "[REDACTED_GITHUB_TOKEN]".
 *
 * Deliberately NOT isRedactionPlaceholderMatch: that predicate is match-scoped and also
 * accepts "NAME=[REDACTED]" so findings suppression can ignore already-redacted env
 * assignments. Accepting that shape as a *key* would disable key-based redaction for the
 * exact keys the sanitizer itself produces — env-secret-assignment rewrites a
 * "<credential-ish name>=<secret>" key into "<same name>=[REDACTED]" — and the opaque value
 * beneath it matches no text pattern, so it would be emitted in cleartext.
 *
 * Widening REDACTION_PLACEHOLDER widens this key exemption too, silently: any shape it starts
 * accepting stops having its value redacted. Treat a change to that constant as a change to
 * this exemption and re-check the key matrix in redaction.test.ts.
 *
 * Known and accepted consequence: a key named *literally* "[REDACTED_PASSWORD]" (or any other
 * placeholder spelling) no longer has its value redacted by key name. Such a key is
 * indistinguishable from output this module produced itself.
 */
function isRedactionPlaceholderKey(key: string): boolean {
  return new RegExp(`^${REDACTION_PLACEHOLDER}$`).test(key.trim());
}

function isSecretKey(key: string): boolean {
  // A key that has already been reduced to a redaction placeholder is not a secret
  // name: placeholders such as "[REDACTED_GITHUB_TOKEN]" contain "TOKEN", which would
  // otherwise re-trigger key-based redaction and destroy the clean value beneath it.
  if (isRedactionPlaceholderKey(key)) return false;
  if (NON_SECRET_USAGE_KEYS.has(key.toLowerCase())) return false;
  if (DEFAULT_SECRET_KEY_PATTERN.test(key)) return true;
  return unique(loadConfig().secret_safety?.redaction_keys).some((pattern) => key.toLowerCase().includes(pattern.toLowerCase()));
}

export function redactEvidenceText(value: string): string {
  let redacted = value;
  for (const pattern of secretPatterns()) {
    const regex = cloneRegex(pattern.regex);
    const replacement = pattern.replacement ?? "[REDACTED]";
    redacted = typeof replacement === "string"
      ? redacted.replace(regex, replacement)
      : redacted.replace(regex, replacement);
  }
  return redacted;
}

export function redactValue<T>(value: T): T {
  if (typeof value === "string") return redactEvidenceText(value) as T;
  if (Array.isArray(value)) return value.map(redactValue) as T;
  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(key)) {
        redacted[key] = "[REDACTED]";
      } else {
        redacted[key] = redactValue(child);
      }
    }
    return redacted as T;
  }
  return value;
}

export function listSecretFindings(value: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const pattern of secretPatterns()) {
    const matches = value.match(cloneRegex(pattern.regex))?.filter((match) => !isRedactionPlaceholderMatch(match));
    if (matches?.length) findings.push({ pattern: pattern.name, count: matches.length });
  }
  return findings;
}

export function hasSecretFindings(value: string): boolean {
  return listSecretFindings(value).length > 0;
}

export function getSecretSafetyConfig(): SecretSafetyConfig {
  return {
    redaction_patterns: unique(loadConfig().secret_safety?.redaction_patterns),
    redaction_keys: unique(loadConfig().secret_safety?.redaction_keys),
  };
}

export function upsertSecretSafetyConfig(input: SecretSafetyConfig): SecretSafetyConfig {
  const config = loadConfig();
  const next: SecretSafetyConfig = {
    redaction_patterns: unique([...(config.secret_safety?.redaction_patterns || []), ...(input.redaction_patterns || [])]),
    redaction_keys: unique([...(config.secret_safety?.redaction_keys || []), ...(input.redaction_keys || [])]),
  };
  saveConfig({ ...config, secret_safety: next });
  return next;
}
