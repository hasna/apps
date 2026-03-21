import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync, createHash } from "node:crypto";

const VAULT_DIR = join(process.env["HOME"] || "~", ".contacts");
const VAULT_CONFIG = join(VAULT_DIR, "vault.json");
const DOCUMENTS_DIR = join(VAULT_DIR, "documents");

let _derivedKey: Buffer | null = null;

interface VaultConfig {
  salt: string;      // hex
  key_hash: string;  // hex — SHA-256 of derived key, for verification
  created_at: string;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, 100000, 32, "sha512");
}

export function initVault(passphrase: string): void {
  if (!existsSync(VAULT_DIR)) mkdirSync(VAULT_DIR, { recursive: true });
  if (!existsSync(DOCUMENTS_DIR)) mkdirSync(DOCUMENTS_DIR, { recursive: true });
  const salt = randomBytes(32);
  const key = deriveKey(passphrase, salt);
  const keyHash = createHash("sha256").update(key).digest("hex");
  const config: VaultConfig = { salt: salt.toString("hex"), key_hash: keyHash, created_at: new Date().toISOString() };
  writeFileSync(VAULT_CONFIG, JSON.stringify(config, null, 2));
  _derivedKey = key;
}

export function isVaultInitialized(): boolean {
  return existsSync(VAULT_CONFIG);
}

export function unlockVault(passphrase: string): boolean {
  if (!existsSync(VAULT_CONFIG)) throw new Error("Vault not initialized. Run 'contacts vault init' first.");
  const config: VaultConfig = JSON.parse(readFileSync(VAULT_CONFIG, "utf-8"));
  const salt = Buffer.from(config.salt, "hex");
  const key = deriveKey(passphrase, salt);
  const keyHash = createHash("sha256").update(key).digest("hex");
  if (keyHash !== config.key_hash) return false;
  _derivedKey = key;
  return true;
}

export function lockVault(): void {
  _derivedKey = null;
}

export function isVaultUnlocked(): boolean {
  return _derivedKey !== null;
}

export function requireVault(): Buffer {
  if (!_derivedKey) throw new Error("Vault is locked. Unlock with 'contacts vault unlock' or vault_unlock MCP tool first.");
  return _derivedKey;
}

export function encrypt(plaintext: string): { ciphertext: string; iv: string } {
  const key = requireVault();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return { ciphertext: encrypted + ":" + authTag, iv: iv.toString("hex") };
}

export function decrypt(ciphertext: string, iv: string): string {
  const key = requireVault();
  const [encData, authTag] = ciphertext.split(":");
  if (!encData || !authTag) throw new Error("Invalid ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(authTag, "hex"));
  let decrypted = decipher.update(encData, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function encryptFile(sourcePath: string, entityId: string): string {
  const key = requireVault();
  if (!existsSync(DOCUMENTS_DIR)) mkdirSync(DOCUMENTS_DIR, { recursive: true });
  const data = readFileSync(sourcePath);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const destPath = join(DOCUMENTS_DIR, `${entityId}.enc`);
  // Write: iv (16 bytes) + authTag (16 bytes) + encrypted data
  const output = Buffer.concat([iv, authTag, encrypted]);
  writeFileSync(destPath, output);
  return destPath;
}

export function decryptFile(encPath: string): Buffer {
  const key = requireVault();
  const data = readFileSync(encPath);
  const iv = data.subarray(0, 16);
  const authTag = data.subarray(16, 32);
  const encrypted = data.subarray(32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function getDocumentsDir(): string {
  if (!existsSync(DOCUMENTS_DIR)) mkdirSync(DOCUMENTS_DIR, { recursive: true });
  return DOCUMENTS_DIR;
}
