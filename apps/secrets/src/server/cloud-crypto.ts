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

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const PREFIX = "enc:v1:";

/** Env vars the active master key is read from, in priority order. */
export const MASTER_KEY_ENV = ["HASNA_SECRETS_MASTER_KEY", "SECRETS_MASTER_KEY"] as const;

/** Env vars containing former master keys during a rotation, newest first. */
export const PREVIOUS_MASTER_KEYS_ENV = [
  "HASNA_SECRETS_PREVIOUS_MASTER_KEYS",
  "SECRETS_PREVIOUS_MASTER_KEYS",
] as const;

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

interface MasterKeyring {
  active: Buffer;
  previous: Buffer[];
}

let _cached: MasterKeyring | null = null;

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

function getCloudMasterKeyring(env: NodeJS.ProcessEnv = process.env): MasterKeyring {
  if (_cached) return _cached;
  const configuredActive: string[] = [];
  for (const name of MASTER_KEY_ENV) {
    const value = env[name]?.trim();
    if (value) configuredActive.push(value);
  }
  if (configuredActive.length === 0) {
    throw new Error(
      `secrets-serve requires a master key. Set ${MASTER_KEY_ENV[0]} (base64/hex 32 bytes) — the vault refuses to store plaintext.`,
    );
  }

  const active = deriveKey(configuredActive[0]!);
  const seen = new Set([active.toString("hex")]);
  const previous = [...configuredActive.slice(1), ...readPreviousKeys(env)]
    .map(deriveKey)
    .filter((key) => {
      const fingerprint = key.toString("hex");
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    });
  _cached = { active, previous };
  return _cached;
}

/**
 * Resolve the 32-byte master key from the environment. Accepts a base64 or hex
 * 32-byte value, or any other string which is hashed (sha256) to 32 bytes so an
 * operator-supplied passphrase also works. Throws when unset (fail-closed).
 */
export function getCloudMasterKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  return getCloudMasterKeyring(env).active;
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
  needsReencryption: boolean;
}

/** Decrypt a value and report whether a previous master key was used. */
export function decryptValueWithMetadata(
  stored: string,
  env: NodeJS.ProcessEnv = process.env,
): DecryptedCloudValue {
  if (!isEncrypted(stored)) return { value: stored, needsReencryption: false }; // legacy/plaintext passthrough

  // Resolved OUTSIDE the try below, and it must stay there.
  //
  // getCloudMasterKey is the fail-closed accessor: it throws when NO master key
  // is configured at all. That is a service misconfiguration — the stored data
  // is intact and fully recoverable the moment the key comes back. Inside the
  // try it is caught indiscriminately and rethrown as VaultDecryptionError,
  // whose recovery text tells the operator to "overwrite/delete and recreate the
  // affected entry". Following that advice destroys recoverable secrets.
  //
  // The two conditions must stay distinguishable AT THE THROW SITE, not in the
  // wording: a message-only fix regresses the moment either string is edited.
  // Regression cover: tests/cloud-crypto.test.ts, "a missing master key is NOT
  // reported as a decryption failure".
  const keyring = getCloudMasterKeyring(env);
  const keys = [keyring.active, ...keyring.previous];

  try {
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
    for (let index = 0; index < keys.length; index++) {
      try {
        const decipher = createDecipheriv(ALGO, keys[index]!, iv);
        decipher.setAuthTag(tag);
        return {
          value: Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"),
          needsReencryption: index > 0,
        };
      } catch {
        // A configured legacy alias may own this row; try it without exposing
        // the AES-GCM authentication error or any key/value material.
      }
    }
    throw new VaultDecryptionError();
  } catch (error) {
    if (error instanceof VaultDecryptionError) throw error;
    // Do not expose OpenSSL's low-level authentication message. Callers can use
    // the stable code and recovery guidance without receiving key/value material.
    throw new VaultDecryptionError();
  }
}

export function decryptValue(stored: string, env: NodeJS.ProcessEnv = process.env): string {
  return decryptValueWithMetadata(stored, env).value;
}

/**
 * Keyed value fingerprint for version history. HMAC-SHA256 over the plaintext
 * with the master key: comparable between versions and against the current
 * value without exposing plaintext, and resistant to offline guessing of a
 * known value (a bare sha256 of a short credential is brute-forceable). The
 * full hex is stored on the version row; surfaces expose a short prefix.
 */
export function fingerprintValue(plaintext: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = getCloudMasterKey(env);
  return createHmac("sha256", key).update(plaintext, "utf8").digest("hex");
}

/** The routine metadata-only fingerprint prefix (16 hex chars). */
export function shortFingerprint(full: string): string {
  return full.slice(0, 16);
}

/** Test-only: reset the cached key. */
export function _resetCloudMasterKey(): void {
  _cached = null;
}
