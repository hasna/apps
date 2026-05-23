/**
 * Optional local encryption for sensitive task metadata and export bundles.
 * Keys from TODOS_ENCRYPTION_KEY env or ~/.hasna/todos/encryption.key — never hardcoded.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export const ENCRYPTION_SCHEMA_VERSION = "todos.encrypted-field.v1";
export const EXPORT_PROFILES = ["redacted", "encrypted", "plaintext"] as const;
export type ExportProfile = (typeof EXPORT_PROFILES)[number];

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export interface EncryptedPayload {
  schema_version: typeof ENCRYPTION_SCHEMA_VERSION;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface ExportBundleOptions {
  profile: ExportProfile;
  acknowledge_plaintext?: boolean;
  fields?: string[];
}

function getKeyPath(): string {
  const home = process.env["HOME"] || "~";
  return join(home, ".hasna", "todos", "encryption.key");
}

export function getEncryptionKeySource(): "env" | "file" | "none" {
  if (process.env["TODOS_ENCRYPTION_KEY"]) return "env";
  if (existsSync(getKeyPath())) return "file";
  return "none";
}

export function loadEncryptionKey(): Buffer | null {
  if (process.env["TODOS_ENCRYPTION_KEY"]) {
    return scryptSync(process.env["TODOS_ENCRYPTION_KEY"], "todos-salt", KEY_LENGTH);
  }
  const path = getKeyPath();
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8").trim();
  return scryptSync(raw, "todos-salt", KEY_LENGTH);
}

export function initEncryptionKeyFile(): string {
  const path = getKeyPath();
  if (existsSync(path)) return path;
  mkdirSync(dirname(path), { recursive: true });
  const secret = randomBytes(32).toString("hex");
  writeFileSync(path, secret, { mode: 0o600 });
  return path;
}

export function encryptValue(plaintext: string, key?: Buffer): EncryptedPayload {
  const k = key ?? loadEncryptionKey();
  if (!k) throw new Error("Encryption key not configured. Set TODOS_ENCRYPTION_KEY or run todos crypto init-key");

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, k, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    schema_version: ENCRYPTION_SCHEMA_VERSION,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

export function decryptValue(payload: EncryptedPayload, key?: Buffer): string {
  const k = key ?? loadEncryptionKey();
  if (!k) throw new Error("Encryption key not configured");

  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");

  const decipher = createDecipheriv(ALGORITHM, k, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as EncryptedPayload).schema_version === ENCRYPTION_SCHEMA_VERSION &&
    typeof (value as EncryptedPayload).ciphertext === "string"
  );
}

const SENSITIVE_KEYS = new Set([
  "secret", "token", "password", "api_key", "apikey", "credential", "private_key",
]);

export function redactObject(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 8) return { _redacted: true };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lower) || lower.includes("secret") || lower.includes("token")) {
      out[key] = "[REDACTED]";
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value) && !isEncryptedPayload(value)) {
      out[key] = redactObject(value as Record<string, unknown>, depth + 1);
    } else if (isEncryptedPayload(value)) {
      out[key] = "[ENCRYPTED]";
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function encryptSensitiveFields(
  metadata: Record<string, unknown>,
  key?: Buffer,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...metadata };
  for (const [field, value] of Object.entries(metadata)) {
    const lower = field.toLowerCase();
    if (typeof value === "string" && (SENSITIVE_KEYS.has(lower) || lower.includes("secret") || lower.includes("token"))) {
      out[field] = encryptValue(value, key);
      out[`_${field}_encrypted`] = true;
    }
  }
  return out;
}

export function decryptSensitiveFields(
  metadata: Record<string, unknown>,
  key?: Buffer,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...metadata };
  for (const [field, value] of Object.entries(metadata)) {
    if (isEncryptedPayload(value)) {
      out[field] = decryptValue(value, key);
      delete out[`_${field}_encrypted`];
    }
  }
  return out;
}

export function applyExportProfile(
  data: Record<string, unknown>,
  options: ExportBundleOptions,
): { data: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = [];

  if (options.profile === "plaintext") {
    if (!options.acknowledge_plaintext) {
      throw new Error(
        "Plaintext export requires --acknowledge-plaintext. This may expose secrets in metadata and evidence.",
      );
    }
    warnings.push("PLAINTEXT EXPORT: sensitive fields may be exposed");
    return { data, warnings };
  }

  if (options.profile === "encrypted") {
    const key = loadEncryptionKey();
    if (!key) throw new Error("Encrypted export requires encryption key (TODOS_ENCRYPTION_KEY or todos crypto init-key)");
    return {
      data: encryptSensitiveFields(data, key),
      warnings: ["Export uses encrypted profile for sensitive fields"],
    };
  }

  // redacted (default)
  return {
    data: redactObject(data),
    warnings: ["Export uses redacted profile — sensitive fields replaced with [REDACTED]"],
  };
}

export function assertExportProfileAllowed(profile: string): ExportProfile {
  if (!EXPORT_PROFILES.includes(profile as ExportProfile)) {
    throw new Error(`Invalid export profile: ${profile}. Use: ${EXPORT_PROFILES.join(", ")}`);
  }
  return profile as ExportProfile;
}
