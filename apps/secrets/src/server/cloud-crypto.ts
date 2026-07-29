/**
 * App-layer value encryption for the cloud (PURE REMOTE, Amendment A1) secrets
 * service. Unlike the local CLI crypto (file/KMS keyed), the deployed
 * `secrets-serve` runs statelessly: the master key is injected via the
 * environment (a Secrets Manager secret) and never touches disk.
 *
 * Fail-closed: a secrets vault MUST NOT persist plaintext. If no master key is
 * configured the accessor throws — the service refuses to boot rather than
 * silently store cleartext.
 *
 * Wire format matches the local vault: "enc:v1:<iv-hex>:<ciphertext+tag-hex>".
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const PREFIX = "enc:v1:";

/** Env vars the active master key is read from, in priority order. */
export const MASTER_KEY_ENV = ["HASNA_SECRETS_MASTER_KEY", "SECRETS_MASTER_KEY"] as const;

/**
 * Optional JSON array of former master keys, newest first. These let the server
 * read ciphertext left behind by a key rotation (or the retired raw Postgres
 * sync) long enough for CloudSecretsStore to rewrite it with the active key.
 */
export const PREVIOUS_MASTER_KEYS_ENV = [
  "HASNA_SECRETS_PREVIOUS_MASTER_KEYS",
  "SECRETS_PREVIOUS_MASTER_KEYS",
] as const;

interface MasterKeyring {
  active: Buffer;
  previous: Buffer[];
}

let _cached: MasterKeyring | null = null;

/**
 * Resolve the 32-byte master key from the environment. Accepts a base64 or hex
 * 32-byte value, or any other string which is hashed (sha256) to 32 bytes so an
 * operator-supplied passphrase also works. Throws when unset (fail-closed).
 */
export function getCloudMasterKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  return getCloudMasterKeyring(env).active;
}

function getCloudMasterKeyring(env: NodeJS.ProcessEnv): MasterKeyring {
  if (_cached) return _cached;
  let raw: string | undefined;
  for (const key of MASTER_KEY_ENV) {
    const v = env[key]?.trim();
    if (v) {
      raw = v;
      break;
    }
  }
  if (!raw) {
    throw new Error(
      `secrets-serve requires a master key. Set ${MASTER_KEY_ENV[0]} (base64/hex 32 bytes) — the vault refuses to store plaintext.`,
    );
  }

  const active = deriveKey(raw);
  const previous = readPreviousKeys(env).map(deriveKey);
  _cached = { active, previous };
  return _cached;
}

function deriveKey(raw: string): Buffer {
  const b64 = tryDecode(raw, "base64");
  const hex = tryDecode(raw, "hex");
  if (b64 && b64.length === 32) return b64;
  if (hex && hex.length === 32) return hex;
  return createHash("sha256").update(raw, "utf8").digest();
}

function readPreviousKeys(env: NodeJS.ProcessEnv): string[] {
  for (const name of PREVIOUS_MASTER_KEYS_ENV) {
    const raw = env[name]?.trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`${name} must be a JSON array of non-empty strings.`);
    }
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string" || !value.trim())) {
      throw new Error(`${name} must be a JSON array of non-empty strings.`);
    }
    return parsed.map((value) => value.trim());
  }
  return [];
}

function tryDecode(value: string, encoding: "base64" | "hex"): Buffer | null {
  try {
    if (encoding === "hex" && !/^[0-9a-fA-F]+$/.test(value)) return null;
    const buf = Buffer.from(value, encoding);
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

export function isEncrypted(value: string): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptValue(plaintext: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = getCloudMasterKey(env);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${Buffer.concat([ciphertext, tag]).toString("hex")}`;
}

export interface DecryptedCloudValue {
  value: string;
  /** True when a previous key succeeded and the ciphertext should be rewritten. */
  needsReencryption: boolean;
}

/** Decrypt a value and report whether it used a previous master key. */
export function decryptValueWithMetadata(
  stored: string,
  env: NodeJS.ProcessEnv = process.env,
): DecryptedCloudValue {
  if (!isEncrypted(stored)) return { value: stored, needsReencryption: false }; // legacy/plaintext passthrough
  const rest = stored.slice(PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep === -1) throw new Error("Malformed encrypted value");
  const ivHex = rest.slice(0, sep);
  const payloadHex = rest.slice(sep + 1);
  if (!/^[0-9a-f]+$/i.test(ivHex) || ivHex.length !== IV_BYTES * 2) {
    throw new Error("Malformed encrypted value");
  }
  if (!/^[0-9a-f]+$/i.test(payloadHex) || payloadHex.length < 32 || payloadHex.length % 2 !== 0) {
    throw new Error("Malformed encrypted value");
  }
  const iv = Buffer.from(ivHex, "hex");
  const payload = Buffer.from(payloadHex, "hex");
  const tag = payload.subarray(payload.length - 16);
  const ciphertext = payload.subarray(0, payload.length - 16);
  const keyring = getCloudMasterKeyring(env);
  const keys = [keyring.active, ...keyring.previous];
  for (let index = 0; index < keys.length; index++) {
    try {
      const decipher = createDecipheriv(ALGO, keys[index]!, iv);
      decipher.setAuthTag(tag);
      const value = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      return { value, needsReencryption: index > 0 };
    } catch {
      // AES-GCM authentication failure: try the next explicitly configured key.
    }
  }
  throw new Error("Unable to decrypt stored value with the configured master keys");
}

export function decryptValue(stored: string, env: NodeJS.ProcessEnv = process.env): string {
  return decryptValueWithMetadata(stored, env).value;
}

/** Test-only: reset the cached key. */
export function _resetCloudMasterKey(): void {
  _cached = null;
}
