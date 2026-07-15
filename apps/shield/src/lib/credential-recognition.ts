import { Severity } from "../types/index.js";

export interface CredentialPattern {
  id: string;
  name: string;
  pattern: RegExp;
  severity: Severity;
}

export interface CredentialRecognition {
  index: number;
  length: number;
  rule: CredentialPattern;
}

interface CredentialPatternDefinition {
  flags: string;
  id: string;
  name: string;
  severity: Severity;
  source: string;
}

// These definitions are the sole named-credential vocabulary for both the
// secrets scanner and every persistence/output/provider boundary. Keep the
// definitions data-only so each consumer gets a fresh RegExp and cannot leak
// lastIndex state into another scan.
const SCANNER_PATTERN_DEFINITIONS: CredentialPatternDefinition[] = [
  {
    id: "aws-access-key",
    name: "AWS Access Key",
    source: String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`,
    flags: "g",
    severity: Severity.Critical,
  },
  {
    id: "aws-secret-key",
    name: "AWS Secret Key",
    source: String.raw`(?:aws_secret_access_key|aws_secret_key|secret_access_key)\s*[=:]\s*['"]?([A-Za-z0-9/+=]{40})['"]?`,
    flags: "gi",
    severity: Severity.Critical,
  },
  {
    id: "github-token",
    name: "GitHub Token",
    source: String.raw`\b(?:ghp_[A-Za-z0-9_]{36,}|gho_[A-Za-z0-9_]{36,}|ghs_[A-Za-z0-9_]{36,}|ghr_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{22,})\b`,
    flags: "g",
    severity: Severity.Critical,
  },
  {
    id: "stripe-secret-key",
    name: "Stripe Secret Key",
    source: String.raw`\bsk_live_[A-Za-z0-9]{24,}\b`,
    flags: "g",
    severity: Severity.Critical,
  },
  {
    id: "stripe-publishable-key",
    name: "Stripe Publishable Key",
    source: String.raw`\bpk_live_[A-Za-z0-9]{24,}\b`,
    flags: "g",
    severity: Severity.Medium,
  },
  {
    id: "generic-api-key",
    name: "Generic API Key",
    source: String.raw`(?:api_key|apikey|api[-_]?key)\s*[=:]\s*['"]([A-Za-z0-9_\-]{16,})['"]`,
    flags: "gi",
    severity: Severity.High,
  },
  {
    id: "private-key",
    name: "Private Key",
    source: String.raw`-----BEGIN\s+(?:RSA|DSA|EC|PGP|OPENSSH)?\s*PRIVATE KEY-----`,
    flags: "g",
    severity: Severity.Critical,
  },
  {
    id: "jwt-token",
    name: "JWT Token",
    source: String.raw`\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b`,
    flags: "g",
    severity: Severity.High,
  },
  {
    id: "slack-token",
    name: "Slack Token",
    source: String.raw`\bxox[bps]-[A-Za-z0-9\-]{24,}\b`,
    flags: "g",
    severity: Severity.Critical,
  },
  {
    id: "database-url",
    name: "Database URL",
    source: String.raw`\b(?:postgres(?:ql)?` + String.raw`://[^\s'"]+|mysql` +
      String.raw`://[^\s'"]+|mongodb(?:\+srv)?` + String.raw`://[^\s'"]+)`,
    flags: "gi",
    severity: Severity.High,
  },
];

// Boundary-only formats are deliberately conservative additions. They do not
// expand ordinary file-scan findings, but they do make the shared recognizer a
// superset at every output boundary.
const BOUNDARY_ONLY_PATTERN_DEFINITIONS: CredentialPatternDefinition[] = [
  {
    id: "stripe-test-key",
    name: "Stripe Test Key",
    source: String.raw`\bsk_test_[A-Za-z0-9]{12,}\b`,
    flags: "gi",
    severity: Severity.High,
  },
  {
    id: "provider-api-key",
    name: "Provider API Key",
    source: String.raw`\bsk-(?:live|test|proj)-[A-Za-z0-9_-]{12,}\b`,
    flags: "gi",
    severity: Severity.High,
  },
  {
    id: "bearer-token",
    name: "Bearer Token",
    source: String.raw`\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}\b`,
    flags: "gi",
    severity: Severity.High,
  },
  {
    id: "generic-credential-assignment",
    name: "Generic Credential Assignment",
    source: String.raw`\b(?:api[_-]?key|access[_-]?key|secret(?:[_-]?key)?|token|password|passwd|passphrase|credential)\s*[:=]\s*["']?[^\s"'\x60,;]{8,}["']?`,
    flags: "gi",
    severity: Severity.High,
  },
  {
    id: "authenticated-url",
    name: "Authenticated URL",
    source: String.raw`\b(?:https?|ssh)://[^\s/:@]+:[^\s/@]+@[^\s]+`,
    flags: "gi",
    severity: Severity.High,
  },
];

const ENV_API_KEY_DEFINITION: CredentialPatternDefinition = {
  id: "generic-api-key",
  name: "Generic API Key",
  source: String.raw`(?:api_key|apikey|api[-_]?key)\s*=\s*([A-Za-z0-9_\-]{16,})(?=\s|$|[;,#])`,
  flags: "gi",
  severity: Severity.High,
};

const HIGH_ENTROPY_HEX_DEFINITION: CredentialPatternDefinition = {
  id: "high-entropy-hex",
  name: "High-entropy hex string",
  source: String.raw`\b[0-9a-fA-F]{16,}\b`,
  flags: "g",
  severity: Severity.Medium,
};

const HIGH_ENTROPY_BASE64_DEFINITION: CredentialPatternDefinition = {
  id: "high-entropy-base64",
  name: "High-entropy base64 string",
  source: String.raw`\b[A-Za-z0-9+/=]{20,}\b`,
  flags: "g",
  severity: Severity.Medium,
};

function materialize(definition: CredentialPatternDefinition): CredentialPattern {
  return {
    id: definition.id,
    name: definition.name,
    pattern: new RegExp(definition.source, definition.flags),
    severity: definition.severity,
  };
}

export const SECRET_PATTERNS: CredentialPattern[] = SCANNER_PATTERN_DEFINITIONS.map(materialize);

export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const frequencies = new Map<string, number>();
  for (const character of value) {
    frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of frequencies.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function collectPatternMatches(
  value: string,
  definitions: CredentialPatternDefinition[],
): CredentialRecognition[] {
  const recognitions: CredentialRecognition[] = [];
  for (const definition of definitions) {
    const rule = materialize(definition);
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(value)) !== null) {
      recognitions.push({ index: match.index, length: match[0].length, rule });
      if (match[0].length === 0) rule.pattern.lastIndex++;
    }
  }
  return recognitions;
}

function collectEntropyMatches(value: string): CredentialRecognition[] {
  const recognitions: CredentialRecognition[] = [];
  for (const [definition, threshold] of [
    [HIGH_ENTROPY_HEX_DEFINITION, 4.5],
    [HIGH_ENTROPY_BASE64_DEFINITION, 5.0],
  ] as const) {
    const rule = materialize(definition);
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(value)) !== null) {
      if (shannonEntropy(match[0]) > threshold) {
        recognitions.push({ index: match.index, length: match[0].length, rule });
      }
      if (match[0].length === 0) rule.pattern.lastIndex++;
    }
  }
  return recognitions;
}

export interface CredentialRecognitionOptions {
  boundary?: boolean;
  envLike?: boolean;
}

/**
 * Canonical credential recognizer used by both the scanner and every trust
 * boundary. A boundary is a strict superset of scanner recognition.
 */
export function recognizeCredentialText(
  value: string,
  options: CredentialRecognitionOptions = {},
): CredentialRecognition[] {
  const definitions = options.boundary
    ? [...SCANNER_PATTERN_DEFINITIONS, ...BOUNDARY_ONLY_PATTERN_DEFINITIONS]
    : SCANNER_PATTERN_DEFINITIONS;
  const recognitions = collectPatternMatches(value, definitions);
  if (options.envLike || options.boundary) {
    recognitions.push(...collectPatternMatches(value, [ENV_API_KEY_DEFINITION]));
  }
  recognitions.push(...collectEntropyMatches(value));
  return recognitions.sort((left, right) => left.index - right.index || right.length - left.length);
}

export function containsRecognizedCredential(value: string | null | undefined): boolean {
  return Boolean(value && recognizeCredentialText(value, { boundary: true }).length > 0);
}
