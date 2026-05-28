import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { loadConfig, saveConfig, type LocalEncryptionProfileConfig } from "./config.js";
import { redactValue } from "./redaction.js";

export const TODOS_ENCRYPTED_VALUE_KIND = "hasna.todos.encrypted-value";
export const TODOS_ENCRYPTED_BRIDGE_KIND = "hasna.todos.encrypted-bridge";
export const TODOS_ENCRYPTION_SCHEMA_VERSION = 1;
export const DEFAULT_ENCRYPTION_PROFILE = "default";
export const DEFAULT_ENCRYPTION_KEY_ENV = "TODOS_ENCRYPTION_KEY";

export interface LocalEncryptionEnvelope {
  schemaVersion: typeof TODOS_ENCRYPTION_SCHEMA_VERSION;
  kind: typeof TODOS_ENCRYPTED_VALUE_KIND;
  encryptedAt: string;
  profile: string;
  key_env: string;
  algorithm: "aes-256-gcm";
  kdf: "scrypt";
  salt: string;
  iv: string;
  auth_tag: string;
  ciphertext: string;
  plaintext_sha256: string;
}

export interface EncryptedLocalBridgeBundle {
  schemaVersion: typeof TODOS_ENCRYPTION_SCHEMA_VERSION;
  kind: typeof TODOS_ENCRYPTED_BRIDGE_KIND;
  encryptedAt: string;
  package: {
    packageName: "@hasna/todos";
    repository: "hasna/todos";
    version: string;
  };
  plaintext: {
    kind: string;
    schemaVersion: number;
    sha256: string;
  };
  encryption: Omit<LocalEncryptionEnvelope, "schemaVersion" | "kind" | "encryptedAt" | "plaintext_sha256">;
  warnings: string[];
}

export interface UpsertEncryptionProfileInput {
  name: string;
  key_env?: string;
  description?: string;
  salt?: string;
}

export class EncryptionKeyUnavailableError extends Error {
  constructor(readonly keyEnv: string, readonly profile: string) {
    super(`Encryption key is locked: set ${keyEnv} to use profile ${profile}`);
  }
}

export class EncryptedPayloadError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function now(): string {
  return new Date().toISOString();
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeProfileName(value: string | undefined): string {
  const name = (value || DEFAULT_ENCRYPTION_PROFILE).trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error("encryption profile names may only contain letters, numbers, dots, underscores, and dashes");
  return name;
}

function randomBase64(bytes: number): string {
  return randomBytes(bytes).toString("base64");
}

function deriveKey(secret: string, salt: string): Buffer {
  if (secret.length < 12) throw new Error("encryption key must be at least 12 characters");
  return scryptSync(secret, Buffer.from(salt, "base64"), 32);
}

function profileFromConfig(name: string): LocalEncryptionProfileConfig | null {
  return loadConfig().encryption_profiles?.[name] ?? null;
}

export function ensureEncryptionProfile(name = DEFAULT_ENCRYPTION_PROFILE): LocalEncryptionProfileConfig {
  const normalized = normalizeProfileName(name);
  const existing = profileFromConfig(normalized);
  if (existing) return existing;
  return upsertEncryptionProfile({ name: normalized });
}

export function listEncryptionProfiles(): LocalEncryptionProfileConfig[] {
  return Object.values(loadConfig().encryption_profiles ?? {})
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function upsertEncryptionProfile(input: UpsertEncryptionProfileInput): LocalEncryptionProfileConfig {
  const name = normalizeProfileName(input.name);
  const config = loadConfig();
  const existing = config.encryption_profiles?.[name];
  const timestamp = now();
  const profile: LocalEncryptionProfileConfig = {
    name,
    algorithm: "aes-256-gcm",
    kdf: "scrypt",
    key_env: input.key_env?.trim() || existing?.key_env || DEFAULT_ENCRYPTION_KEY_ENV,
    salt: input.salt || existing?.salt || randomBase64(16),
    description: input.description ?? existing?.description,
    created_at: existing?.created_at || timestamp,
    updated_at: timestamp,
  };
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(profile.key_env)) throw new Error("key_env must be a valid environment variable name");
  saveConfig({
    ...config,
    encryption_profiles: {
      ...(config.encryption_profiles ?? {}),
      [name]: profile,
    },
  });
  return profile;
}

export function removeEncryptionProfile(name: string): boolean {
  const normalized = normalizeProfileName(name);
  const config = loadConfig();
  if (!config.encryption_profiles?.[normalized]) return false;
  const next = { ...config.encryption_profiles };
  delete next[normalized];
  saveConfig({ ...config, encryption_profiles: next });
  return true;
}

export function encryptionProfileStatus(name = DEFAULT_ENCRYPTION_PROFILE, env: NodeJS.ProcessEnv = process.env) {
  const profile = ensureEncryptionProfile(name);
  return {
    profile: redactValue(profile),
    locked: !env[profile.key_env],
    key_env: profile.key_env,
    key_present: Boolean(env[profile.key_env]),
  };
}

function keyForProfile(profile: LocalEncryptionProfileConfig, env: NodeJS.ProcessEnv): Buffer {
  const secret = env[profile.key_env];
  if (!secret) throw new EncryptionKeyUnavailableError(profile.key_env, profile.name);
  return deriveKey(secret, profile.salt);
}

export function encryptString(
  plaintext: string,
  options: { profile?: string; env?: NodeJS.ProcessEnv; encryptedAt?: string } = {},
): LocalEncryptionEnvelope {
  const profile = ensureEncryptionProfile(options.profile);
  const key = keyForProfile(profile, options.env ?? process.env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    schemaVersion: TODOS_ENCRYPTION_SCHEMA_VERSION,
    kind: TODOS_ENCRYPTED_VALUE_KIND,
    encryptedAt: options.encryptedAt ?? now(),
    profile: profile.name,
    key_env: profile.key_env,
    algorithm: "aes-256-gcm",
    kdf: "scrypt",
    salt: profile.salt,
    iv: iv.toString("base64"),
    auth_tag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    plaintext_sha256: sha256(plaintext),
  };
}

export function isEncryptedValue(value: unknown): value is LocalEncryptionEnvelope {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  return Boolean(record && record.kind === TODOS_ENCRYPTED_VALUE_KIND && record.schemaVersion === TODOS_ENCRYPTION_SCHEMA_VERSION);
}

export function decryptString(envelope: LocalEncryptionEnvelope, env: NodeJS.ProcessEnv = process.env): string {
  if (!isEncryptedValue(envelope)) throw new EncryptedPayloadError("value is not a hasna/todos encrypted envelope");
  const profile = profileFromConfig(envelope.profile) ?? {
    name: envelope.profile,
    algorithm: envelope.algorithm,
    kdf: envelope.kdf,
    key_env: envelope.key_env,
    salt: envelope.salt,
  };
  const key = keyForProfile(profile, env);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.auth_tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const expected = Buffer.from(envelope.plaintext_sha256, "hex");
  const actual = Buffer.from(sha256(plaintext), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new EncryptedPayloadError("decrypted payload checksum mismatch");
  }
  return plaintext;
}

export function encryptValue(value: unknown, options: { profile?: string; env?: NodeJS.ProcessEnv } = {}): LocalEncryptionEnvelope {
  return encryptString(JSON.stringify(value), options);
}

export function decryptValue<T = unknown>(envelope: LocalEncryptionEnvelope, env: NodeJS.ProcessEnv = process.env): T {
  return JSON.parse(decryptString(envelope, env)) as T;
}

export function looksSensitiveKey(key: string): boolean {
  return /api[_-]?key|token|secret|password|credential|evidence|artifact|output|summary|metadata/i.test(key);
}

export function encryptSensitiveFields(value: unknown, options: { profile?: string; env?: NodeJS.ProcessEnv } = {}): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => encryptSensitiveFields(item, options));
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isEncryptedValue(child)) {
      out[key] = child;
    } else if (looksSensitiveKey(key) && child !== null && child !== undefined) {
      out[key] = encryptValue(child, options);
    } else {
      out[key] = encryptSensitiveFields(child, options);
    }
  }
  return out;
}

export function createEncryptedBridgeBundle(
  bundle: {
    kind: string;
    schemaVersion: number;
    package: { packageName: "@hasna/todos"; repository: "hasna/todos"; version: string };
  },
  options: { profile?: string; env?: NodeJS.ProcessEnv; encryptedAt?: string } = {},
): EncryptedLocalBridgeBundle {
  const plaintext = JSON.stringify(bundle);
  const envelope = encryptString(plaintext, options);
  return {
    schemaVersion: TODOS_ENCRYPTION_SCHEMA_VERSION,
    kind: TODOS_ENCRYPTED_BRIDGE_KIND,
    encryptedAt: envelope.encryptedAt,
    package: bundle.package,
    plaintext: {
      kind: bundle.kind,
      schemaVersion: bundle.schemaVersion,
      sha256: envelope.plaintext_sha256,
    },
    encryption: {
      profile: envelope.profile,
      key_env: envelope.key_env,
      algorithm: envelope.algorithm,
      kdf: envelope.kdf,
      salt: envelope.salt,
      iv: envelope.iv,
      auth_tag: envelope.auth_tag,
      ciphertext: envelope.ciphertext,
    },
    warnings: [
      "This export is encrypted locally. The key material is not stored in this file.",
      `Set ${envelope.key_env} before decrypting or importing it.`,
    ],
  };
}

export function isEncryptedBridgeBundle(value: unknown): value is EncryptedLocalBridgeBundle {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  return Boolean(record && record.kind === TODOS_ENCRYPTED_BRIDGE_KIND && record.schemaVersion === TODOS_ENCRYPTION_SCHEMA_VERSION);
}

export function decryptBridgeBundle<T>(
  bundle: EncryptedLocalBridgeBundle,
  env: NodeJS.ProcessEnv = process.env,
): T {
  if (!isEncryptedBridgeBundle(bundle)) throw new EncryptedPayloadError("bundle is not an encrypted hasna/todos bridge export");
  const plaintext = decryptString({
    schemaVersion: TODOS_ENCRYPTION_SCHEMA_VERSION,
    kind: TODOS_ENCRYPTED_VALUE_KIND,
    encryptedAt: bundle.encryptedAt,
    profile: bundle.encryption.profile,
    key_env: bundle.encryption.key_env,
    algorithm: bundle.encryption.algorithm,
    kdf: bundle.encryption.kdf,
    salt: bundle.encryption.salt,
    iv: bundle.encryption.iv,
    auth_tag: bundle.encryption.auth_tag,
    ciphertext: bundle.encryption.ciphertext,
    plaintext_sha256: bundle.plaintext.sha256,
  }, env);
  return JSON.parse(plaintext) as T;
}
