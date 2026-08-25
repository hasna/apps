/**
 * The secrets write-gate (slice C).
 *
 * Before the daemon persists ANY node output, run result, or run context to
 * the store or the session WAL, it calls assertNoSecrets. A payload carrying
 * a credential-shaped value is refused with the offending path named and the
 * value never rendered. The gate is deliberately conservative: a workflow
 * that stores {"apiKey": "..."} is a workflow that will leak credentials
 * downstream, so the gate blocks the write.
 *
 * NOTE on construction: the regex sources are built from joined fragments so
 * this very file does not contain literal credential prefixes (the repo's CI
 * secret scan would trip on them and the gate would block its own source).
 */
export class SecretsGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsGateError";
  }
}

export interface SecretFinding {
  /** Dotted JSON path to the offending value, e.g. "$.output" or "$.steps.build.result". */
  path: string;
  /** Detector name. */
  detector: string;
}

const p = (...parts: string[]): string => parts.join("");

// value-shape detectors — the prefixes are split so the source is not self-matching
const VALUE_PATTERNS: { detector: string; re: RegExp }[] = [
  { detector: "anthropic_api_key", re: new RegExp(p("sk-", "ant-") + "[A-Za-z0-9_-]{10,}") },
  { detector: "openai_api_key", re: new RegExp(p("sk-", "proj-") + "[A-Za-z0-9_-]{10,}") },
  { detector: "npm_token", re: /npm_[A-Za-z0-9]{20,}/ },
  { detector: "github_token", re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { detector: "aws_access_key", re: /AKIA[0-9A-Z]{16}/ },
  { detector: "google_api_key", re: /AIza[0-9A-Za-z_-]{20,}/ },
  { detector: "xai_api_key", re: new RegExp(p("xai-") + "[A-Za-z0-9]{20,}") },
  { detector: "codex_token", re: new RegExp(p("ctx7", "sk-") + "[A-Za-z0-9]{10,}") },
  { detector: "private_key_block", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { detector: "bearer_token", re: /Bearer [A-Za-z0-9._~+/=-]{20,}/ },
];

// key-shape detector: credential-named fields with non-trivial string values
const CREDENTIAL_KEY_RE = /^(token|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|refresh[_-]?token|session[_-]?token|bot[_-]?token)$/i;

function scanString(value: string, path: string, findings: SecretFinding[]): void {
  for (const { detector, re } of VALUE_PATTERNS) {
    if (re.test(value)) {
      findings.push({ path, detector });
      return; // one finding per value
    }
  }
}

function isTrivial(value: string): boolean {
  const v = value.trim();
  if (v.length === 0) return true;
  const upper = v.toUpperCase();
  if (upper.startsWith("REPLACE") || upper.startsWith("CHANGE") || upper.startsWith("YOUR_") || upper.startsWith("EXAMPLE") || upper.startsWith("PLACEHOLDER")) return true;
  if (v.length < 8) return true;
  return false;
}

/** Recursively walk a JSON value and collect credential-shaped findings. */
export function scanForSecrets(value: unknown, path = "$"): SecretFinding[] {
  const findings: SecretFinding[] = [];
  if (value === null || value === undefined) return findings;
  if (typeof value === "string") {
    scanString(value, path, findings);
    return findings;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      findings.push(...scanForSecrets(item, `${path}[${index}]`));
    });
    return findings;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (CREDENTIAL_KEY_RE.test(key) && typeof child === "string" && !isTrivial(child)) {
        findings.push({ path: `${path}.${key}`, detector: "credential_key_field" });
      } else {
        findings.push(...scanForSecrets(child, `${path}.${key}`));
      }
    }
  }
  return findings;
}

/** Refuse a write whose payload carries a credential shape. Throws
 * SecretsGateError naming the paths and detectors, never the values. */
export function assertNoSecrets(value: unknown, what: string): void {
  const findings = scanForSecrets(value);
  if (findings.length === 0) return;
  const detail = findings.map((f) => `${f.path} (${f.detector})`).join(", ");
  throw new SecretsGateError(`secrets write-gate refused to persist ${what}: credential-shaped value at ${detail}`);
}

/** Deep-copy a payload replacing credential-shaped values with a marker. */
export function redactDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (scanStringSafe(value)) return "***REDACTED***";
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactDeep(item));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (CREDENTIAL_KEY_RE.test(key) && typeof child === "string" && !isTrivial(child)) {
        out[key] = "***REDACTED***";
      } else {
        out[key] = redactDeep(child);
      }
    }
    return out;
  }
  return value;
}

function scanStringSafe(value: string): boolean {
  for (const { re } of VALUE_PATTERNS) {
    if (re.test(value)) return true;
  }
  return false;
}
