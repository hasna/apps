import type { MachineManifest } from "./types.js";

export const REDACTED_VALUE = "[redacted]";

const SENSITIVE_KEY_PATTERN = /(password|passwd|token|credential|private[_-]?key|privateKey|api[_-]?key|github.*key|pem|secret)/i;
const SECRET_REFERENCE_KEY_PATTERN = /(secret(ref(erence)?|key)?|secretRef|secretKey)$/i;
const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bghp_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function isSecretReferenceKey(key: string): boolean {
  return SECRET_REFERENCE_KEY_PATTERN.test(key);
}

function looksSensitiveString(value: string): boolean {
  return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
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

export function redactSensitiveValue(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    if (isSensitiveKey(key) && !(isSecretReferenceKey(key) && !looksSensitiveString(value))) {
      return REDACTED_VALUE;
    }
    if (looksSensitiveString(value)) return REDACTED_VALUE;
    return redactPath(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValue(entry, key));
  }

  if (isRecord(value)) {
    const redacted: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      redacted[entryKey] = redactSensitiveValue(entryValue, entryKey);
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
