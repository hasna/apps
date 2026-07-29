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

/** Env vars the master key is read from, in priority order. */
export const MASTER_KEY_ENV = ["HASNA_SECRETS_MASTER_KEY", "SECRETS_MASTER_KEY"] as const;

export const VAULT_DECRYPTION_ERROR_CODE = "VAULT_DECRYPTION_FAILED" as const;
export const VAULT_DECRYPTION_RECOVERY =
  "Restore HASNA_SECRETS_MASTER_KEY (or SECRETS_MASTER_KEY) to the value used when this entry was encrypted, or overwrite/delete and recreate the affected entry.";

/** Safe, typed boundary error for encrypted data that the configured key cannot read. */
export class VaultDecryptionError extends Error {
  readonly code = VAULT_DECRYPTION_ERROR_CODE;
  readonly recovery = VAULT_DECRYPTION_RECOVERY;

  constructor() {
    super("Encrypted vault data cannot be decrypted with the configured master key.");
    this.name = "VaultDecryptionError";
  }
}

let _cached: Buffer | null = null;

/**
 * Resolve the 32-byte master key from the environment. Accepts a base64 or hex
 * 32-byte value, or any other string which is hashed (sha256) to 32 bytes so an
 * operator-supplied passphrase also works. Throws when unset (fail-closed).
 */
export function getCloudMasterKey(env: NodeJS.ProcessEnv = process.env): Buffer {
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

  let key: Buffer;
  const b64 = tryDecode(raw, "base64");
  const hex = tryDecode(raw, "hex");
  if (b64 && b64.length === 32) key = b64;
  else if (hex && hex.length === 32) key = hex;
  else key = createHash("sha256").update(raw, "utf8").digest();

  _cached = key;
  return key;
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

export function decryptValue(stored: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!isEncrypted(stored)) return stored; // legacy/plaintext passthrough
  try {
    const rest = stored.slice(PREFIX.length);
    const sep = rest.indexOf(":");
    if (sep === -1) throw new Error("Malformed encrypted value");
    const iv = Buffer.from(rest.slice(0, sep), "hex");
    const payload = Buffer.from(rest.slice(sep + 1), "hex");
    const tag = payload.subarray(payload.length - 16);
    const ciphertext = payload.subarray(0, payload.length - 16);
    const key = getCloudMasterKey(env);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Do not expose OpenSSL's low-level authentication message. Callers can use
    // the stable code and recovery guidance without receiving key/value material.
    throw new VaultDecryptionError();
  }
}

/** Test-only: reset the cached key. */
export function _resetCloudMasterKey(): void {
  _cached = null;
}
