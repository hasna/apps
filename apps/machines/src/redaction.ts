import type { MachineManifest } from "./types.js";

export const REDACTED_VALUE = "[redacted]";
export const PRIVATE_METADATA_ENV = "HASNA_MACHINES_PRIVATE_METADATA";
export const PRIVATE_METADATA_FALLBACK_ENV = "MACHINES_PRIVATE_METADATA";
export const PRIVATE_OUTPUT_ENV = "HASNA_MACHINES_ALLOW_PRIVATE_OUTPUT";
export const PRIVATE_OUTPUT_FALLBACK_ENV = "MACHINES_ALLOW_PRIVATE_OUTPUT";
export const PRIVATE_OUTPUT_DENIED_WARNING = `private_output_denied:set ${PRIVATE_OUTPUT_ENV}=1 to allow private metadata output`;

const SENSITIVE_KEY_PATTERN = /(password|passwd|token|credential|private[_-]?key|privateKey|api[_-]?key|github.*key|pem|secret)/i;
const SECRET_REFERENCE_KEY_PATTERN = /(secret(ref(erence)?|key)?|secretRef|secretKey)$/i;
const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bghp[_][A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
];

const ADDITIONAL_SENSITIVE_VALUE_PATTERNS = [
  new RegExp(String.raw`\bgh${"o"}_[A-Za-z0-9_]{20,}\b`),
  new RegExp(String.raw`\bgh${"s"}_[A-Za-z0-9_]{20,}\b`),
  new RegExp(String.raw`\bgh${"u"}_[A-Za-z0-9_]{20,}\b`),
  /\bnpm_[A-Za-z0-9_]{8,}\b/,
  new RegExp(String.raw`\b${"ctx7sk"}-[A-Za-z0-9_-]{8,}\b`),
  new RegExp(String.raw`\b${"xai"}-[A-Za-z0-9_-]{8,}\b`),
  /\bAIza[A-Za-z0-9_-]{20,}\b/,
  new RegExp(String.raw`\b${"secret"}-token:[^\s"'<>]+`, "i"),
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\bBasic\s+[A-Za-z0-9+/]+=*/i,
];

const ALL_SENSITIVE_VALUE_PATTERNS = [
  ...SENSITIVE_VALUE_PATTERNS,
  ...ADDITIONAL_SENSITIVE_VALUE_PATTERNS,
];

const IPV4_PATTERN = /\b(?:10|127|169\.254|172\.(?:1[6-9]|2\d|3[0-1])|192\.168|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))(?:\.\d{1,3}){2}\b/g;
const IPV6_PATTERN = /\b(?:fc|fd|fe80)[0-9a-f:]*:[0-9a-f:]+\b/gi;
const DATABASE_URL_PATTERN = /\b(?:postgres(?:ql)?|mysql|mariadb|redis|mongodb|s3):\/\/[^\s"'<>]+/gi;
const PRIVATE_HOST_PATTERN = /\b(?:[A-Za-z0-9._%+-]+@)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*(?:\.tailnet(?:\.[A-Za-z0-9-]+)*|\.ts\.net|\.private(?:\.[A-Za-z0-9-]+)*|\.internal|\.local)\b/gi;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function isPrivateMetadataEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[PRIVATE_METADATA_ENV] ?? env[PRIVATE_METADATA_FALLBACK_ENV];
  return ["1", "true", "yes", "on", "private"].includes(String(value ?? "").trim().toLowerCase());
}

export function isPrivateOutputEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[PRIVATE_OUTPUT_ENV] ?? env[PRIVATE_OUTPUT_FALLBACK_ENV];
  return ["1", "true", "yes", "on", "private"].includes(String(value ?? "").trim().toLowerCase());
}

function isSecretReferenceKey(key: string): boolean {
  return SECRET_REFERENCE_KEY_PATTERN.test(key);
}

function looksSensitiveString(value: string): boolean {
  return ALL_SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function redactSensitiveStringPatterns(value: string): string {
  return ALL_SENSITIVE_VALUE_PATTERNS.reduce((current, pattern) => current.replace(pattern, REDACTED_VALUE), value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function redactPath(value: string): string {
  return value
    .replace(/\/home\/[^/\s]+/g, "/home/<user>")
    .replace(/\/Users\/[^/\s]+/g, "/Users/<user>")
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, "C:\\Users\\<user>");
}

export function redactNetworkValue(value: string): string {
  if (!value.trim()) return value;
  return REDACTED_VALUE;
}

export function redactErrorMessage(value: string): string {
  return redactSensitiveStringPatterns(redactPath(value))
    .replace(/\bAWS_SECRET_ACCESS_KEY=([^\s"'<>]+)/gi, `AWS_SECRET_ACCESS_KEY=${REDACTED_VALUE}`)
    .replace(/\b(password|passwd|token|secret|api[_-]?key|credential)=([^\s"'<>]+)/gi, (_match, key) => `${key}=${REDACTED_VALUE}`)
    .replace(DATABASE_URL_PATTERN, (match) => {
      const scheme = match.match(/^([a-z][a-z0-9+.-]*:\/\/)/i)?.[1] ?? "";
      return `${scheme}${REDACTED_VALUE}`;
    })
    .replace(IPV4_PATTERN, REDACTED_VALUE)
    .replace(IPV6_PATTERN, REDACTED_VALUE)
    .replace(PRIVATE_HOST_PATTERN, REDACTED_VALUE);
}

export interface IncrementalCredentialRedactor {
  push(value: string): string;
  finish(): string;
}

export function createIncrementalCredentialRedactor(): IncrementalCredentialRedactor {
  const redactedValue = "[redacted]";
  const pendingTailChars = 64;
  const patterns = [
    {
      start: /\bAWS_SECRET_ACCESS_KEY=/i,
      value: /[^\s"'<>]/,
      minimumValueChars: 1,
      render: (prefix: string) => `${prefix}${redactedValue}`,
    },
    {
      start: /\b(?:password|passwd|token|secret|api[_-]?key|credential)=/i,
      value: /[^\s"'<>]/,
      minimumValueChars: 1,
      render: (prefix: string) => `${prefix}${redactedValue}`,
    },
    {
      start: /\b(?:Bearer|Basic)\s+/i,
      value: /[A-Za-z0-9._~+/-=]/,
      minimumValueChars: 1,
      render: () => redactedValue,
    },
    {
      start: /\bsecret[-]token:/i,
      value: /[^\s"'<>]/,
      minimumValueChars: 1,
      render: () => redactedValue,
    },
    {
      start: /\b(?:postgres(?:ql)?|mysql|mariadb|redis|mongodb|s3):\/\//i,
      value: /[^\s"'<>]/,
      minimumValueChars: 1,
      render: (prefix: string) => `${prefix}${redactedValue}`,
    },
    {
      start: /\bgithub_pat_/i,
      value: /[A-Za-z0-9_]/,
      minimumValueChars: 20,
      render: () => redactedValue,
    },
    {
      start: /\bgh[pous]_/i,
      value: /[A-Za-z0-9_]/,
      minimumValueChars: 20,
      render: () => redactedValue,
    },
    {
      start: /\bxox[baprs]-/i,
      value: /[A-Za-z0-9-]/,
      minimumValueChars: 20,
      render: () => redactedValue,
    },
    {
      start: /\bAKIA/,
      value: /[0-9A-Z]/,
      minimumValueChars: 16,
      render: () => redactedValue,
    },
    {
      start: /\bsk-/,
      value: /[A-Za-z0-9_-]/,
      minimumValueChars: 20,
      render: () => redactedValue,
    },
    {
      start: /\bnpm_/i,
      value: /[A-Za-z0-9_]/,
      minimumValueChars: 8,
      render: () => redactedValue,
    },
    {
      start: /\b(?:ctx7sk|xai)-/i,
      value: /[A-Za-z0-9_-]/,
      minimumValueChars: 8,
      render: () => redactedValue,
    },
    {
      start: /\bAIza/,
      value: /[A-Za-z0-9_-]/,
      minimumValueChars: 20,
      render: () => redactedValue,
    },
  ];
  let pending = "";
  let active: {
    pattern: (typeof patterns)[number];
    prefix: string;
    rawValue: string;
    emitted: boolean;
  } | null = null;

  const characterMatches = (pattern: RegExp, value: string): boolean => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  };

  const findNext = (): {
    index: number;
    match: string;
    pattern: (typeof patterns)[number];
  } | null => {
    let next: {
      index: number;
      match: string;
      pattern: (typeof patterns)[number];
    } | null = null;

    for (const pattern of patterns) {
      pattern.start.lastIndex = 0;
      const match = pattern.start.exec(pending);
      if (!match || (next && match.index >= next.index)) continue;
      next = { index: match.index, match: match[0], pattern };
    }
    return next;
  };

  const drain = (final: boolean): string => {
    let output = "";

    while (true) {
      if (active) {
        let consumed = 0;
        while (consumed < pending.length && characterMatches(active.pattern.value, pending[consumed]!)) {
          if (!active.emitted) {
            active.rawValue += pending[consumed]!;
            if (active.rawValue.length >= active.pattern.minimumValueChars) {
              output += active.pattern.render(active.prefix);
              active.rawValue = "";
              active.emitted = true;
            }
          }
          consumed += 1;
        }
        pending = pending.slice(consumed);

        if (pending.length === 0) {
          if (final) {
            if (!active.emitted) output += `${active.prefix}${active.rawValue}`;
            active = null;
          }
          return output;
        }

        if (!active.emitted) output += `${active.prefix}${active.rawValue}`;
        active = null;
        continue;
      }

      const next = findNext();
      if (next) {
        output += pending.slice(0, next.index);
        pending = pending.slice(next.index + next.match.length);
        active = {
          pattern: next.pattern,
          prefix: next.match,
          rawValue: "",
          emitted: false,
        };
        continue;
      }

      if (final) {
        output += pending;
        pending = "";
        return output;
      }

      if (pending.length <= pendingTailChars) return output;
      output += pending.slice(0, -pendingTailChars);
      pending = pending.slice(-pendingTailChars);
      return output;
    }
  };

  return {
    push(value: string): string {
      pending += value;
      return drain(false);
    },
    finish(): string {
      return drain(true);
    },
  };
}

export function redactPrivateRef(value: string): string {
  const trimmed = value.trim();
  const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*:\/\/)/i);
  if (scheme) return `${scheme[1]}<redacted>`;
  const colon = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  if (colon) return `${colon[1]}:<redacted>`;
  return "<private-manifest-ref:redacted>";
}

export function redactIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80) || "adapter";
}

export interface RedactSensitiveValueOptions {
  redactPaths?: boolean;
  redactSecretReferences?: boolean;
}

export function redactSensitiveValue(value: unknown, key = "", options: RedactSensitiveValueOptions = {}): unknown {
  if (typeof value === "string") {
    if (isSensitiveKey(key) && !(!options.redactSecretReferences && isSecretReferenceKey(key) && !looksSensitiveString(value))) {
      return REDACTED_VALUE;
    }
    if (looksSensitiveString(value)) return REDACTED_VALUE;
    return options.redactPaths === false ? value : redactPath(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValue(entry, key, options));
  }

  if (isRecord(value)) {
    const redacted: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      redacted[entryKey] = redactSensitiveValue(entryValue, entryKey, options);
    }
    return redacted;
  }

  return value;
}

export function publicMetadataKeys(metadata: Record<string, unknown> | undefined): string[] {
  return Object.keys(metadata ?? {})
    .filter((key) => !isSensitiveKey(key))
    .sort();
}

export function redactMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  return redactSensitiveValue(metadata ?? {}) as Record<string, unknown>;
}

export function redactMetadataForTopology(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  return redactSensitiveValue(metadata ?? {}, "", { redactPaths: false, redactSecretReferences: true }) as Record<string, unknown>;
}

export function redactManifestForDiagnostics(machine: MachineManifest): Record<string, unknown> {
  const metadata = redactMetadata(machine.metadata);
  for (const key of ["user", "username", "login"]) {
    if (typeof metadata[key] === "string") metadata[key] = REDACTED_VALUE;
  }

  return {
    id: machine.id,
    hostname: machine.hostname ? REDACTED_VALUE : undefined,
    sshAddress: machine.sshAddress ? REDACTED_VALUE : undefined,
    tailscaleName: machine.tailscaleName ? REDACTED_VALUE : undefined,
    platform: machine.platform,
    connection: machine.connection,
    workspacePath: redactPath(machine.workspacePath),
    bunPath: machine.bunPath ? redactPath(machine.bunPath) : undefined,
    tags: machine.tags ?? [],
    metadata,
    packages: machine.packages?.map((pkg) => ({ ...pkg })),
    apps: machine.apps?.map((app) => ({ ...app })),
    files: machine.files?.map((file) => ({
      ...file,
      source: redactPath(file.source),
      target: redactPath(file.target),
    })),
  };
}
