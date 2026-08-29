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
const DATABASE_URL_DEFINITION: CredentialPatternDefinition = {
  id: "database-url",
  name: "Database URL",
  source: String.raw`\b(?:postgres(?:ql)?` + String.raw`://[^\s'"]+|mysql` +
    String.raw`://[^\s'"]+|mongodb(?:\+srv)?` + String.raw`://[^\s'"]+)`,
  flags: "gi",
  severity: Severity.High,
};

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
    source: String.raw`\b(?:ghp[_][A-Za-z0-9_]{36,}|gho[_][A-Za-z0-9_]{36,}|ghs[_][A-Za-z0-9_]{36,}|ghr[_][A-Za-z0-9_]{36,}|github_pat[_][A-Za-z0-9_]{22,})\b`,
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
  DATABASE_URL_DEFINITION,
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
  // Thirty-two characters avoids treating short hexadecimal identifiers as
  // credentials while still covering 128-bit and larger secret material.
  source: String.raw`\b[0-9a-fA-F]{32,}\b`,
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

// A database URL that is obviously a placeholder — a localhost/dev default, a
// documentation example, or an IaC template — carries no credential. Reporting
// every connection string regardless of content floods scans with these, so the
// database-url rule (and any high-entropy token that sits inside such a URL)
// must stay silent for the placeholder class while continuing to flag genuinely
// suspicious connection strings.
const LOOPBACK_HOST_RE = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;
const UPPERCASE_PLACEHOLDER_HOST_RE = /^[A-Z]{2,}$/;

function hostOfDatabaseUrl(dsn: string): string {
  const afterScheme = dsn.slice(dsn.indexOf("://") + 3);
  const withoutUserInfo = afterScheme.includes("@")
    ? afterScheme.slice(afterScheme.indexOf("@") + 1)
    : afterScheme;
  const authority = withoutUserInfo.split(/[/?]/, 1)[0];
  return authority.startsWith("[")
    ? authority.slice(0, authority.indexOf("]") + 1)
    : authority.split(":")[0];
}

/** True when the matched connection string is a non-credential placeholder. */
export function isPlaceholderDatabaseUrl(value: string): boolean {
  // Template / IaC placeholders such as <username> or ${DB_HOST}.
  if (value.includes("<") || value.includes("${")) return true;
  const host = hostOfDatabaseUrl(value);
  if (LOOPBACK_HOST_RE.test(host)) return true;
  // Documentation uppercase placeholders, e.g. postgresql://USER:PASSWORD@HOST:5432/DBNAME.
  if (UPPERCASE_PLACEHOLDER_HOST_RE.test(host.replace(/^\[|\]$/g, ""))) return true;
  return false;
}

/** Span ([start, end)) of every placeholder connection string in `value`. */
function findPlaceholderDatabaseUrlSpans(value: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const rule = materialize(DATABASE_URL_DEFINITION);
  let match: RegExpExecArray | null;
  while ((match = rule.pattern.exec(value)) !== null) {
    if (isPlaceholderDatabaseUrl(match[0])) {
      spans.push([match.index, match.index + match[0].length]);
    }
    if (match[0].length === 0) rule.pattern.lastIndex++;
  }
  return spans;
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
      if (
        definition.id === DATABASE_URL_DEFINITION.id
        && isPlaceholderDatabaseUrl(match[0])
      ) {
        if (match[0].length === 0) rule.pattern.lastIndex++;
        continue;
      }
      recognitions.push({ index: match.index, length: match[0].length, rule });
      if (match[0].length === 0) rule.pattern.lastIndex++;
    }
  }
  return recognitions;
}

function isExactPinnedGitHubActionRevision(
  value: string,
  index: number,
  match: string,
): boolean {
  if (match.length !== 40) return false;
  const unquoted = /^\s*(?:-\s+)?uses:\s*[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@([0-9a-fA-F]{40})\s*(?:#.*)?$/;
  const quoted = /^\s*(?:-\s+)?uses:\s*(["'])[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@([0-9a-fA-F]{40})\1\s*(?:#.*)?$/;
  const parsed = unquoted.exec(value);
  const revision = parsed?.[1] ?? quoted.exec(value)?.[2];
  return revision === match && value.indexOf(match) === index;
}

function isPlausibleBase64Token(value: string): boolean {
  const unpadded = value.replace(/=+$/, "");
  const paddingLength = value.length - unpadded.length;
  if (paddingLength > 2 || unpadded.length < 22) return false;
  if (paddingLength > 0 && value.length % 4 !== 0) return false;
  if (paddingLength === 0 && unpadded.length % 4 === 1) return false;

  // Random binary tokens almost always span at least three Base64 character
  // classes. Requiring that diversity sharply bounds false positives from
  // prose, identifiers, repeated fixtures, and numeric values at short sample
  // lengths without requiring '+' or '/' to be present.
  const uppercase = [...unpadded].filter((character) => /[A-Z]/.test(character)).length;
  const lowercase = [...unpadded].filter((character) => /[a-z]/.test(character)).length;
  const hasNonLetter = /[0-9+/]/.test(unpadded);
  const letterCount = uppercase + lowercase;
  // CamelCase source identifiers can satisfy a naive three-class check only
  // because their names contain "64". Random Base64 has balanced letter case;
  // requiring the minority case to make up 18% of letters rejects those
  // identifiers while retaining >98% of random 16-byte and >99.7% of random
  // 24/32-byte samples before the independent entropy bound.
  const minorityCaseRatio = letterCount === 0
    ? 0
    : Math.min(uppercase, lowercase) / letterCount;
  return hasNonLetter && minorityCaseRatio >= 0.18;
}

function normalizedSampleEntropy(value: string, alphabetSize: number): number {
  const sample = value.replace(/=+$/, "");
  const reachableAlphabetSize = Math.min(alphabetSize, sample.length);
  if (reachableAlphabetSize <= 1) return 0;
  return shannonEntropy(sample) / Math.log2(reachableAlphabetSize);
}

function collectEntropyMatches(
  value: string,
  allowPinnedGitHubActionRevision = false,
  boundary = false,
): CredentialRecognition[] {
  const recognitions: CredentialRecognition[] = [];
  // A high-entropy token embedded in a placeholder connection string is itself
  // placeholder material (e.g. a long fake password in a docs example), so it
  // must not be reported either.
  const placeholderDatabaseUrlSpans = findPlaceholderDatabaseUrlSpans(value);
  // Normalize against the maximum empirical entropy reachable by this sample,
  // not merely the alphabet maximum. A 22-character Base64 token cannot
  // empirically exceed log2(22), while a hexadecimal alphabet tops out at 4.
  for (const { definition, alphabetSize, normalizedThreshold } of [
    {
      definition: HIGH_ENTROPY_HEX_DEFINITION,
      alphabetSize: 16,
      normalizedThreshold: 0.875, // 3.5 / log2(16)
    },
    {
      definition: HIGH_ENTROPY_BASE64_DEFINITION,
      alphabetSize: 64,
      // Monte Carlo bounds for uniformly random 16/24/32-byte tokens place
      // more than 99.9% above this length-aware threshold. Structured-safe
      // controls are also required to span three character classes.
      normalizedThreshold: 0.8,
    },
  ] as const) {
    const rule = materialize(definition);
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(value)) !== null) {
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;
      const insidePlaceholderDatabaseUrl = placeholderDatabaseUrlSpans.some(
        ([spanStart, spanEnd]) => spanStart <= matchStart && matchEnd <= spanEnd,
      );
      if (insidePlaceholderDatabaseUrl) {
        if (match[0].length === 0) rule.pattern.lastIndex++;
        continue;
      }
      if (
        definition.id === HIGH_ENTROPY_HEX_DEFINITION.id
        && allowPinnedGitHubActionRevision
        && isExactPinnedGitHubActionRevision(value, match.index, match[0])
      ) {
        continue;
      }
      const plausibleBase64 =
        definition.id !== HIGH_ENTROPY_BASE64_DEFINITION.id
        || isPlausibleBase64Token(match[0]);
      if (
        definition.id === HIGH_ENTROPY_BASE64_DEFINITION.id
        && !plausibleBase64
      ) {
        // A credential embedded in a path or identifier can be swallowed by
        // the broad Base64 alphabet (notably '/'). Boundary recognition must
        // remain a strict scanner superset, so inspect canonical common-token
        // windows inside the greedy candidate without changing scanner noise.
        if (boundary) {
          for (const windowLength of [44, 43, 32, 24, 22]) {
            if (windowLength > match[0].length) continue;
            for (let offset = 0; offset <= match[0].length - windowLength; offset++) {
              const window = match[0].slice(offset, offset + windowLength);
              if (
                isPlausibleBase64Token(window)
                && normalizedSampleEntropy(window, alphabetSize) >= normalizedThreshold
              ) {
                recognitions.push({
                  index: match.index + offset,
                  length: windowLength,
                  rule,
                });
                offset = match[0].length;
              }
            }
          }
        }
        continue;
      }
      const normalizedEntropy = normalizedSampleEntropy(match[0], alphabetSize);
      if (normalizedEntropy >= normalizedThreshold) {
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
  /** Scanner-only exception after the source path is verified as a workflow. */
  trustedGitHubWorkflowFile?: boolean;
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
  recognitions.push(...collectEntropyMatches(
    value,
    options.trustedGitHubWorkflowFile === true && options.boundary !== true,
    options.boundary === true,
  ));
  return recognitions.sort((left, right) => left.index - right.index || right.length - left.length);
}

export function containsRecognizedCredential(value: string | null | undefined): boolean {
  return Boolean(value && recognizeCredentialText(value, { boundary: true }).length > 0);
}
