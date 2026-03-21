import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync, createHash } from "node:crypto";

const VAULT_DIR = join(process.env["HOME"] || "~", ".contacts");
const VAULT_CONFIG = join(VAULT_DIR, "vault.json");
const VAULT_SESSION = join(VAULT_DIR, ".vault-session");
const DOCUMENTS_DIR = join(VAULT_DIR, "documents");
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

let _derivedKey: Buffer | null = null;

interface VaultConfig {
  salt: string;      // hex
  key_hash: string;  // hex — SHA-256 of derived key, for verification
  created_at: string;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, 100000, 32, "sha512");
}

function saveSession(key: Buffer): void {
  const session = {
    key: key.toString("hex"),
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
  writeFileSync(VAULT_SESSION, JSON.stringify(session), { mode: 0o600 });
}

function loadSession(): Buffer | null {
  if (!existsSync(VAULT_SESSION)) return null;
  try {
    const session = JSON.parse(readFileSync(VAULT_SESSION, "utf-8"));
    if (new Date(session.expires_at).getTime() < Date.now()) {
      try { unlinkSync(VAULT_SESSION); } catch {}
      return null;
    }
    return Buffer.from(session.key, "hex");
  } catch {
    return null;
  }
}

function clearSession(): void {
  try { if (existsSync(VAULT_SESSION)) unlinkSync(VAULT_SESSION); } catch {}
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
  saveSession(key);
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
  saveSession(key);
  return true;
}

export function lockVault(): void {
  _derivedKey = null;
  clearSession();
}

export function isVaultUnlocked(): boolean {
  if (_derivedKey) return true;
  // Check for persisted session
  const sessionKey = loadSession();
  if (sessionKey) {
    _derivedKey = sessionKey;
    return true;
  }
  return false;
}

export function requireVault(): Buffer {
  if (_derivedKey) return _derivedKey;
  // Try loading from session file
  const sessionKey = loadSession();
  if (sessionKey) {
    _derivedKey = sessionKey;
    return _derivedKey;
  }
  throw new Error("Vault is locked. Unlock with 'contacts vault unlock --passphrase <pass>' or vault_unlock MCP tool first.");
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

/**
 * Store a file attachment (PLAIN, not encrypted) so agents can access it directly.
 * Text values in the DB are encrypted; file attachments are plain for agent access.
 * Returns the destination path.
 */
export function storeFile(sourcePath: string, entityId: string): string {
  if (!existsSync(DOCUMENTS_DIR)) mkdirSync(DOCUMENTS_DIR, { recursive: true });
  const ext = sourcePath.split(".").pop() || "bin";
  const destPath = join(DOCUMENTS_DIR, `${entityId}.${ext}`);
  const data = readFileSync(sourcePath);
  writeFileSync(destPath, data);
  return destPath;
}

/**
 * Get the file path for a document attachment. Returns null if no file exists.
 */
export function getDocumentFilePath(entityId: string): string | null {
  if (!existsSync(DOCUMENTS_DIR)) return null;
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const files = readdirSync(DOCUMENTS_DIR);
  const match = files.find((f: string) => f.startsWith(`${entityId}.`) && !f.endsWith(".enc"));
  return match ? join(DOCUMENTS_DIR, match) : null;
}

// Legacy encrypted file support (for any files encrypted before v0.6.3)
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
