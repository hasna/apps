import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import type { TypedDb } from "../types/db-adapter.js";

export const OWNER_DIR_MODE = 0o700;
export const OWNER_FILE_MODE = 0o600;

const ENCRYPTED_JSON_VERSION = 1;
const ENCRYPTED_JSON_ALG = "aes-256-gcm";
const KEY_DIR = "keys";
const STATE_KEY_FILE = "browser-state.key";
const ENCRYPTED_SUFFIX = ".enc";
const URL_QUERY_ENV = "BROWSER_PERSIST_URL_QUERY";
const RAW_HEADERS_ENV = "BROWSER_PERSIST_RAW_NETWORK_HEADERS";
const RAW_BODY_ENV = "BROWSER_PERSIST_RAW_NETWORK_BODY";
const CONSOLE_MAX_CHARS_ENV = "BROWSER_CONSOLE_MAX_CHARS";
const DB_RETENTION_HOURS_ENV = "BROWSER_DB_RETENTION_HOURS";
const DEFAULT_CONSOLE_MAX_CHARS = 2000;
const DEFAULT_DB_RETENTION_HOURS = 24;

const SENSITIVE_HEADER_RE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token|x-amz-security-token)$/i;
const SENSITIVE_QUERY_RE = /(access[_-]?token|auth|authorization|code|credential|jwt|key|pass|password|secret|session|sig|signature|token)/i;
const TOKEN_SHAPED_RE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const SECRET_ASSIGNMENT_RE = /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|KEY|AUTH)[A-Z0-9_]*\s*[:=]\s*)["']?[^"',\s}]+/gi;
const AWS_KEY_RE = /\bAKIA[0-9A-Z]{16}\b/g;
const OPENAI_KEY_RE = /\bsk-[A-Za-z0-9_-]{20,}\b/g;
const URL_CREDENTIAL_RE = /\/\/([^/\s:@]+):([^/\s@]+)@/g;

export interface BrowserSecurityCounts {
  insecureDirectories: number;
  insecureFiles: number;
  plaintextAuthStateFiles: number;
  encryptedAuthStateFiles: number;
  sqliteArtifactFiles: number;
  rawNetworkRows: number;
  rawConsoleRows: number;
  rawSessionUrlRows: number;
  rawAuthFlowStateRows: number;
  expiredNetworkRows: number;
  expiredConsoleRows: number;
  remediatedFiles: number;
  remediatedDirectories: number;
  remediatedDbRows: number;
  prunedDbRows: number;
}

export interface BrowserSecurityReport {
  applied: boolean;
  retentionHours: number;
  counts: BrowserSecurityCounts;
  warnings: string[];
}

type BrowserStorageTable = "network_log" | "console_log" | "sessions" | "auth_flows" | string;
type Row = Record<string, unknown>;

export function ensureOwnerOnlyDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: OWNER_DIR_MODE });
  chmodIfPossible(path, OWNER_DIR_MODE);
}

export function ensureOwnerOnlyFile(path: string): void {
  if (existsSync(path)) chmodIfPossible(path, OWNER_FILE_MODE);
}

export function writeOwnerOnlyFile(path: string, data: string | Buffer, opts?: { ensureParent?: boolean }): void {
  if (opts?.ensureParent !== false) ensureOwnerOnlyDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, { mode: OWNER_FILE_MODE });
  chmodIfPossible(tmp, OWNER_FILE_MODE);
  renameSync(tmp, path);
  chmodIfPossible(path, OWNER_FILE_MODE);
}

export function ensureSqliteArtifactsOwnerOnly(dbPath: string): void {
  ensureOwnerOnlyDir(dirname(dbPath));
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    ensureOwnerOnlyFile(path);
  }
}

export function writePlainJsonFile(path: string, value: unknown): void {
  writeOwnerOnlyFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function encryptedPathForJson(path: string): string {
  return path.endsWith(ENCRYPTED_SUFFIX) ? path : `${path}${ENCRYPTED_SUFFIX}`;
}

export function writeEncryptedJsonFile(path: string, value: unknown, dataDir: string): string {
  const target = encryptedPathForJson(path);
  const key = readOrCreateStateKey(dataDir);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTED_JSON_ALG, key, iv);
  const plaintext = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const payload = {
    version: ENCRYPTED_JSON_VERSION,
    alg: ENCRYPTED_JSON_ALG,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  writeOwnerOnlyFile(target, `${JSON.stringify(payload, null, 2)}\n`);
  if (target !== path && existsSync(path)) {
    try { unlinkSync(path); } catch {}
  }
  return target;
}

export function readEncryptedJsonFile<T>(path: string, dataDir: string): T {
  const payload = JSON.parse(readFileSync(path, "utf8")) as {
    version?: number;
    alg?: string;
    iv?: string;
    tag?: string;
    ciphertext?: string;
  };
  if (payload.version !== ENCRYPTED_JSON_VERSION || payload.alg !== ENCRYPTED_JSON_ALG) {
    throw new Error("Unsupported encrypted browser state format");
  }
  if (!payload.iv || !payload.tag || !payload.ciphertext) {
    throw new Error("Invalid encrypted browser state payload");
  }
  const key = readOrCreateStateKey(dataDir);
  const decipher = createDecipheriv(ENCRYPTED_JSON_ALG, key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

export function readSecureJsonFile<T>(path: string, dataDir: string): T {
  if (path.endsWith(ENCRYPTED_SUFFIX)) return readEncryptedJsonFile<T>(path, dataDir);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function sanitizeStorageName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") {
    throw new Error("Storage state/profile name must not be empty");
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0") || trimmed.includes("..")) {
    throw new Error("Storage state/profile name must not contain path segments");
  }
  return trimmed;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(URL_CREDENTIAL_RE, "//[redacted]@")
    .replace(TOKEN_SHAPED_RE, "$1[redacted]")
    .replace(SECRET_ASSIGNMENT_RE, "$1[redacted]")
    .replace(AWS_KEY_RE, "[redacted-aws-access-key]")
    .replace(OPENAI_KEY_RE, "[redacted-openai-api-key]");
}

export function sanitizeUrlForPersistence(value: string | null | undefined): string | null {
  if (!value) return null;
  const redacted = redactSensitiveText(value);
  try {
    const hadBareOrigin = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+(?:[?#].*)?$/i.test(redacted);
    const parsed = new URL(redacted);
    if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) {
      return `${parsed.protocol}[redacted]`;
    }
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    if (envEnabled(URL_QUERY_ENV)) {
      for (const key of [...parsed.searchParams.keys()]) {
        parsed.searchParams.set(key, SENSITIVE_QUERY_RE.test(key) ? "[redacted]" : "[value]");
      }
    } else {
      parsed.search = "";
    }
    if (hadBareOrigin && parsed.pathname === "/" && !parsed.search) {
      return `${parsed.protocol}//${parsed.host}`;
    }
    return parsed.toString();
  } catch {
    return redactSensitiveText(value).slice(0, 2048);
  }
}

export function sanitizeHeadersForPersistence(value: string | Record<string, unknown> | null | undefined): string | null {
  if (!value || !envEnabled(RAW_HEADERS_ENV)) return null;
  const headers = typeof value === "string" ? parseJsonObject(value) : value;
  if (!headers) return null;
  const sanitized: Record<string, string> = {};
  for (const [key, raw] of Object.entries(headers)) {
    sanitized[key] = SENSITIVE_HEADER_RE.test(key)
      ? "[redacted]"
      : redactSensitiveText(String(raw)).slice(0, 512);
  }
  return JSON.stringify(sanitized);
}

export function sanitizeBodyForPersistence(value: string | null | undefined): string | null {
  if (!value || !envEnabled(RAW_BODY_ENV)) return null;
  return truncateText(redactSensitiveText(value), 4096);
}

export function sanitizeConsoleMessageForPersistence(value: string): string {
  return truncateText(redactSensitiveText(value), readConsoleMaxChars());
}

export function sanitizeStorageStateReference(value: string | null | undefined, dataDir: string): string | null {
  if (!value) return null;
  if (value.startsWith("storage-state:")) return value;
  const statesDir = join(dataDir, "states");
  const file = basename(value).replace(/\.enc$/i, "").replace(/\.json$/i, "");
  if (value.startsWith(statesDir) && file) return `storage-state:${file}`;
  return "external-storage-state:[redacted]";
}

export function sanitizeBrowserDbRow(table: BrowserStorageTable, row: Row, dataDir: string): Row {
  if (table === "network_log") {
    return {
      ...row,
      url: typeof row.url === "string" ? sanitizeUrlForPersistence(row.url) : row.url,
      request_headers: sanitizeHeadersForPersistence(row.request_headers as string | null | undefined),
      response_headers: sanitizeHeadersForPersistence(row.response_headers as string | null | undefined),
      request_body: sanitizeBodyForPersistence(row.request_body as string | null | undefined),
    };
  }
  if (table === "console_log") {
    return {
      ...row,
      message: typeof row.message === "string" ? sanitizeConsoleMessageForPersistence(row.message) : row.message,
      source: typeof row.source === "string" ? sanitizeUrlForPersistence(row.source) : row.source,
    };
  }
  if (table === "sessions") {
    return {
      ...row,
      start_url: typeof row.start_url === "string" ? sanitizeUrlForPersistence(row.start_url) : row.start_url,
      browser_live_view_url: typeof row.browser_live_view_url === "string" ? sanitizeUrlForPersistence(row.browser_live_view_url) : row.browser_live_view_url,
    };
  }
  if (table === "auth_flows") {
    return {
      ...row,
      storage_state_path: typeof row.storage_state_path === "string"
        ? sanitizeStorageStateReference(row.storage_state_path, dataDir)
        : row.storage_state_path,
    };
  }
  return row;
}

export function sqliteTimestampCutoff(retentionHours: number): string {
  return new Date(Date.now() - retentionHours * 3_600_000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
}

export function applyBrowserDbRetention(db: TypedDb, retentionHours = readDbRetentionHours()): number {
  const cutoff = sqliteTimestampCutoff(retentionHours);
  let pruned = 0;
  pruned += runDelete(db, "DELETE FROM network_log WHERE timestamp < ?");
  pruned += runDelete(db, "DELETE FROM console_log WHERE timestamp < ?");
  function runDelete(innerDb: TypedDb, sql: string): number {
    try {
      return innerDb.prepare(sql).run(cutoff).changes ?? 0;
    } catch {
      return 0;
    }
  }
  return pruned;
}

export function auditBrowserStorageSecurity(dataDir: string, db: TypedDb, opts: { apply?: boolean; retentionHours?: number } = {}): BrowserSecurityReport {
  const applied = opts.apply === true;
  const retentionHours = opts.retentionHours ?? readDbRetentionHours();
  const counts: BrowserSecurityCounts = {
    insecureDirectories: 0,
    insecureFiles: 0,
    plaintextAuthStateFiles: 0,
    encryptedAuthStateFiles: 0,
    sqliteArtifactFiles: 0,
    rawNetworkRows: 0,
    rawConsoleRows: 0,
    rawSessionUrlRows: 0,
    rawAuthFlowStateRows: 0,
    expiredNetworkRows: 0,
    expiredConsoleRows: 0,
    remediatedFiles: 0,
    remediatedDirectories: 0,
    remediatedDbRows: 0,
    prunedDbRows: 0,
  };
  const warnings: string[] = [];

  try {
    ensureOwnerOnlyDir(dataDir);
    scanFilesystem(dataDir, dataDir, counts, applied);
  } catch (error) {
    warnings.push(`filesystem_scan_failed:${error instanceof Error ? error.name : "unknown"}`);
  }

  try {
    scanDatabase(db, dataDir, counts, applied, retentionHours);
  } catch (error) {
    warnings.push(`database_scan_failed:${error instanceof Error ? error.name : "unknown"}`);
  }

  return { applied, retentionHours, counts, warnings };
}

function scanFilesystem(root: string, current: string, counts: BrowserSecurityCounts, apply: boolean): void {
  const entries = existsSync(current) ? readdirSync(current, { withFileTypes: true }) : [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (entry.isDirectory()) {
      if (hasGroupOrWorldBits(stat.mode)) {
        counts.insecureDirectories += 1;
        if (apply) {
          chmodIfPossible(path, OWNER_DIR_MODE);
          counts.remediatedDirectories += 1;
        }
      }
      scanFilesystem(root, path, counts, apply);
      continue;
    }
    if (!entry.isFile()) continue;
    if (hasGroupOrWorldBits(stat.mode)) {
      counts.insecureFiles += 1;
      if (apply) {
        chmodIfPossible(path, OWNER_FILE_MODE);
        counts.remediatedFiles += 1;
      }
    }
    if (isSqliteArtifact(path)) counts.sqliteArtifactFiles += 1;
    if (isEncryptedAuthArtifact(path)) counts.encryptedAuthStateFiles += 1;
    if (isPlaintextAuthArtifact(root, path)) {
      counts.plaintextAuthStateFiles += 1;
      if (apply && encryptPlaintextArtifact(path, root)) counts.remediatedFiles += 1;
    }
  }
}

function scanDatabase(db: TypedDb, dataDir: string, counts: BrowserSecurityCounts, apply: boolean, retentionHours: number): void {
  const cutoff = sqliteTimestampCutoff(retentionHours);
  counts.expiredNetworkRows = countRows(db, "SELECT COUNT(*) AS count FROM network_log WHERE timestamp < ?", [cutoff]);
  counts.expiredConsoleRows = countRows(db, "SELECT COUNT(*) AS count FROM console_log WHERE timestamp < ?", [cutoff]);

  const networkRows = db.query<Row, []>("SELECT id, url, request_headers, response_headers, request_body FROM network_log").all();
  for (const row of networkRows) {
    const sanitized = sanitizeBrowserDbRow("network_log", row, dataDir);
    if (rowDiffers(row, sanitized)) {
      counts.rawNetworkRows += 1;
      if (apply) {
        db.prepare("UPDATE network_log SET url = ?, request_headers = ?, response_headers = ?, request_body = ? WHERE id = ?")
          .run(sanitized.url ?? null, sanitized.request_headers ?? null, sanitized.response_headers ?? null, sanitized.request_body ?? null, row.id);
        counts.remediatedDbRows += 1;
      }
    }
  }

  const consoleRows = db.query<Row, []>("SELECT id, message, source FROM console_log").all();
  for (const row of consoleRows) {
    const sanitized = sanitizeBrowserDbRow("console_log", row, dataDir);
    if (rowDiffers(row, sanitized)) {
      counts.rawConsoleRows += 1;
      if (apply) {
        db.prepare("UPDATE console_log SET message = ?, source = ? WHERE id = ?")
          .run(sanitized.message ?? "", sanitized.source ?? null, row.id);
        counts.remediatedDbRows += 1;
      }
    }
  }

  const sessionRows = db.query<Row, []>("SELECT id, start_url, browser_live_view_url FROM sessions").all();
  for (const row of sessionRows) {
    const sanitized = sanitizeBrowserDbRow("sessions", row, dataDir);
    if (rowDiffers(row, sanitized)) {
      counts.rawSessionUrlRows += 1;
      if (apply) {
        db.prepare("UPDATE sessions SET start_url = ?, browser_live_view_url = ? WHERE id = ?")
          .run(sanitized.start_url ?? null, sanitized.browser_live_view_url ?? null, row.id);
        counts.remediatedDbRows += 1;
      }
    }
  }

  const authRows = db.query<Row, []>("SELECT id, storage_state_path FROM auth_flows").all();
  for (const row of authRows) {
    const sanitized = sanitizeBrowserDbRow("auth_flows", row, dataDir);
    if (rowDiffers(row, sanitized)) {
      counts.rawAuthFlowStateRows += 1;
      if (apply) {
        db.prepare("UPDATE auth_flows SET storage_state_path = ? WHERE id = ?")
          .run(sanitized.storage_state_path ?? null, row.id);
        counts.remediatedDbRows += 1;
      }
    }
  }

  if (apply) counts.prunedDbRows = applyBrowserDbRetention(db, retentionHours);
}

function readOrCreateStateKey(dataDir: string): Buffer {
  const dir = join(dataDir, KEY_DIR);
  ensureOwnerOnlyDir(dir);
  const path = join(dir, STATE_KEY_FILE);
  if (existsSync(path)) {
    const key = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
    if (key.length !== 32) throw new Error("Invalid browser state encryption key");
    ensureOwnerOnlyFile(path);
    return key;
  }
  const key = randomBytes(32);
  writeOwnerOnlyFile(path, `${key.toString("base64")}\n`);
  return key;
}

function encryptPlaintextArtifact(path: string, dataDir: string): boolean {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    writeEncryptedJsonFile(path, value, dataDir);
    rmSync(path, { force: true });
    return true;
  } catch {
    return false;
  }
}

function isPlaintextAuthArtifact(root: string, path: string): boolean {
  if (!path.endsWith(".json") || path.endsWith(".json.enc")) return false;
  const relative = path.slice(root.length + 1);
  return /^states\/[^/]+\.json$/.test(relative)
    || /^profiles\/[^/]+\/(?:cookies|storage)\.json$/.test(relative);
}

function isEncryptedAuthArtifact(path: string): boolean {
  return /\/(?:states\/[^/]+|profiles\/[^/]+\/(?:cookies|storage))\.json\.enc$/.test(path);
}

function isSqliteArtifact(path: string): boolean {
  return /(?:\.db|\.sqlite|\.sqlite3)(?:-wal|-shm)?$/i.test(path) || /browser\.db(?:-wal|-shm)?$/i.test(path);
}

function hasGroupOrWorldBits(mode: number): boolean {
  return (mode & 0o077) !== 0;
}

function chmodIfPossible(path: string, mode: number): void {
  if (process.platform === "win32") return;
  try {
    chmodSync(path, mode);
  } catch {
    // Best-effort on mounted filesystems.
  }
}

function envEnabled(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function readConsoleMaxChars(): number {
  const parsed = Number.parseInt(process.env[CONSOLE_MAX_CHARS_ENV] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CONSOLE_MAX_CHARS;
}

function readDbRetentionHours(): number {
  const parsed = Number.parseInt(process.env[DB_RETENTION_HOURS_ENV] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DB_RETENTION_HOURS;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}[truncated:${value.length - maxChars}]`;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function rowDiffers(a: Row, b: Row): boolean {
  for (const key of Object.keys(b)) {
    if ((a[key] ?? null) !== (b[key] ?? null)) return true;
  }
  return false;
}

function countRows(db: TypedDb, sql: string, params: unknown[]): number {
  try {
    const row = db.query<{ count: number }, unknown[]>(sql).get(...params);
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}
