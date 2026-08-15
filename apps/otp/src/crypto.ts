import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const PREFIX = "enc:v1:";

let cachedKey: Buffer | null = null;
let cachedKeyPath: string | null = null;

export function getOtpHome(home?: string): string {
  return home ?? process.env.HASNA_OTP_HOME ?? join(homedir(), ".hasna", "otp");
}

export function ensureOtpHome(home?: string): string {
  const resolved = getOtpHome(home);
  if (!existsSync(resolved)) {
    mkdirSync(resolved, { recursive: true, mode: 0o700 });
  }
  chmodSync(resolved, 0o700);
  return resolved;
}

export function getKeyPath(home?: string): string {
  return join(ensureOtpHome(home), "vault.key");
}

export function getMasterKey(home?: string): Buffer {
  const keyPath = getKeyPath(home);
  if (cachedKey && cachedKeyPath === keyPath) return cachedKey;

  if (existsSync(keyPath)) {
    const value = readFileSync(keyPath, "utf8").trim();
    const key = Buffer.from(value, "hex");
    if (key.length !== KEY_BYTES) throw new Error("OTP vault key has an invalid length");
    chmodSync(keyPath, 0o600);
    cachedKey = key;
    cachedKeyPath = keyPath;
    return key;
  }

  const key = randomBytes(KEY_BYTES);
  writeFileSync(keyPath, `${key.toString("hex")}\n`, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  cachedKey = key;
  cachedKeyPath = keyPath;
  return key;
}

export function encryptSecret(plaintext: string, home?: string): string {
  const key = getMasterKey(home);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${Buffer.concat([encrypted, tag]).toString("hex")}`;
}

export function decryptSecret(stored: string, home?: string): string {
  if (!stored.startsWith(PREFIX)) {
    throw new Error("Refusing to decrypt a non-encrypted OTP secret");
  }
  const key = getMasterKey(home);
  const rest = stored.slice(PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator === -1) throw new Error("Malformed encrypted OTP secret");
  const iv = Buffer.from(rest.slice(0, separator), "hex");
  const combined = Buffer.from(rest.slice(separator + 1), "hex");
  if (iv.length !== IV_BYTES || combined.length <= 16) {
    throw new Error("Malformed encrypted OTP secret");
  }
  const tag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(0, combined.length - 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}
