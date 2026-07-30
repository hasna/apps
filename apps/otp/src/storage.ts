import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decryptSecret, encryptSecret, ensureOtpHome, getKeyPath, getMasterKey, getOtpHome } from "./crypto.js";
import { parseOtpAuthUri } from "./otpauth.js";
import {
  generateTotp,
  normalizeAlgorithm,
  normalizeBase32Secret,
  normalizeDigits,
  normalizePeriod,
} from "./totp.js";
import type {
  AddOtpEntryInput,
  GeneratedOtpCode,
  ImportOtpUriInput,
  OtpEntry,
  OtpStorageOptions,
  OtpStorageStatus,
  OtpStoreFile,
  StoredOtpEntry,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function storePath(home?: string): string {
  return join(ensureOtpHome(home), "entries.json");
}

function emptyStore(): OtpStoreFile {
  const now = nowIso();
  return {
    schema: "open-otp.store.v1",
    created_at: now,
    updated_at: now,
    entries: [],
  };
}

function assertStore(value: unknown): asserts value is OtpStoreFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OTP store is malformed");
  }
  const candidate = value as Partial<OtpStoreFile>;
  if (candidate.schema !== "open-otp.store.v1" || !Array.isArray(candidate.entries)) {
    throw new Error("OTP store is malformed or unsupported");
  }
}

function readStore(home?: string): OtpStoreFile {
  const path = storePath(home);
  if (!existsSync(path)) return emptyStore();
  const contents = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch {
    throw new Error(`OTP store at "${path}" is malformed`);
  }
  assertStore(parsed);
  return parsed;
}

function writeStore(store: OtpStoreFile, home?: string): void {
  const path = storePath(home);
  store.updated_at = nowIso();
  const tmpPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmpPath, 0o600);
  renameSync(tmpPath, path);
  chmodSync(path, 0o600);
}

function publicEntry(entry: StoredOtpEntry): OtpEntry {
  const { encrypted_secret: _encryptedSecret, ...publicFields } = entry;
  return publicFields;
}

function normalizeLabel(input: AddOtpEntryInput): string {
  const label = input.label?.trim() || (input.issuer ? `${input.issuer.trim()}:${input.account.trim()}` : input.account.trim());
  if (!label) throw new Error("OTP label is required");
  return label;
}

interface NormalizedEntryInput {
  id: string;
  issuer?: string;
  account: string;
  label: string;
  secret: string;
  algorithm: StoredOtpEntry["algorithm"];
  digits: number;
  period: number;
}

function normalizeEntryInput(input: AddOtpEntryInput): NormalizedEntryInput {
  const account = input.account.trim();
  if (!account) throw new Error("OTP account is required");
  const issuer = input.issuer?.trim() || undefined;
  const normalized: NormalizedEntryInput = {
    id: input.id?.trim() || randomUUID(),
    account,
    label: normalizeLabel({ ...input, ...(issuer ? { issuer } : {}), account }),
    secret: normalizeBase32Secret(input.secret),
    algorithm: normalizeAlgorithm(input.algorithm),
    digits: normalizeDigits(input.digits),
    period: normalizePeriod(input.period),
  };
  if (issuer) normalized.issuer = issuer;
  return normalized;
}

function findByTarget(store: OtpStoreFile, target: string): StoredOtpEntry | undefined {
  const normalized = target.trim().toLowerCase();
  const matches = store.entries.filter((entry) =>
    entry.id.toLowerCase() === normalized ||
    entry.label.toLowerCase() === normalized ||
    `${entry.issuer ?? ""}:${entry.account}`.toLowerCase() === normalized ||
    entry.account.toLowerCase() === normalized
  );
  if (matches.length > 1) {
    throw new Error(`OTP target "${target}" is ambiguous; use an id`);
  }
  return matches[0];
}

export function bootstrapOtpStorage(options: OtpStorageOptions = {}): OtpStorageStatus {
  const home = ensureOtpHome(options.home);
  getMasterKey(home);
  const store = readStore(home);
  if (!existsSync(storePath(home))) writeStore(store, home);
  return getOtpStorageStatus({ home });
}

export function getOtpStorageStatus(options: OtpStorageOptions = {}): OtpStorageStatus {
  const home = ensureOtpHome(options.home);
  const path = storePath(home);
  const keyPath = getKeyPath(home);
  const store = readStore(home);
  return {
    home,
    store_path: path,
    key_path: keyPath,
    store_exists: existsSync(path),
    key_exists: existsSync(keyPath),
    entries: store.entries.length,
    storage: "local-encrypted",
    encrypted_at_rest: true,
  };
}

export function listOtpEntries(options: OtpStorageOptions = {}): OtpEntry[] {
  return readStore(options.home).entries.map(publicEntry);
}

export function getOtpEntry(target: string, options: OtpStorageOptions = {}): OtpEntry | undefined {
  const entry = findByTarget(readStore(options.home), target);
  return entry ? publicEntry(entry) : undefined;
}

export function addOtpEntry(input: AddOtpEntryInput, options: OtpStorageOptions = {}): OtpEntry {
  const normalized = normalizeEntryInput(input);
  const store = readStore(options.home);
  if (store.entries.some((entry) => entry.id === normalized.id)) {
    throw new Error(`OTP entry id "${normalized.id}" already exists`);
  }
  if (store.entries.some((entry) => entry.label.toLowerCase() === normalized.label.toLowerCase())) {
    throw new Error(`OTP entry label "${normalized.label}" already exists`);
  }
  const timestamp = nowIso();
  const entry: StoredOtpEntry = {
    id: normalized.id,
    account: normalized.account,
    label: normalized.label,
    algorithm: normalized.algorithm,
    digits: normalized.digits,
    period: normalized.period,
    encrypted_secret: encryptSecret(normalized.secret, options.home),
    created_at: timestamp,
    updated_at: timestamp,
  };
  if (normalized.issuer) entry.issuer = normalized.issuer;
  store.entries.push(entry);
  writeStore(store, options.home);
  return publicEntry(entry);
}

export function importOtpAuthUri(input: ImportOtpUriInput, options: OtpStorageOptions = {}): OtpEntry {
  const parsed = parseOtpAuthUri(input.uri);
  if (input.id) parsed.id = input.id;
  if (input.label) parsed.label = input.label;
  return addOtpEntry(parsed, options);
}

export function removeOtpEntry(target: string, options: OtpStorageOptions = {}): OtpEntry | undefined {
  const store = readStore(options.home);
  const entry = findByTarget(store, target);
  if (!entry) return undefined;
  store.entries = store.entries.filter((candidate) => candidate.id !== entry.id);
  writeStore(store, options.home);
  return publicEntry(entry);
}

export function generateOtpCode(target: string, options: OtpStorageOptions & { at?: Date | number } = {}): GeneratedOtpCode {
  const entry = findByTarget(readStore(options.home), target);
  if (!entry) throw new Error(`OTP entry "${target}" was not found`);
  const secret = decryptSecret(entry.encrypted_secret, options.home);
  const totpOptions: {
    algorithm: StoredOtpEntry["algorithm"];
    digits: number;
    period: number;
    at?: Date | number;
  } = {
    algorithm: entry.algorithm,
    digits: entry.digits,
    period: entry.period,
  };
  if (options.at !== undefined) totpOptions.at = options.at;
  const generated = generateTotp(secret, totpOptions);
  const result: GeneratedOtpCode = {
    id: entry.id,
    label: entry.label,
    account: entry.account,
    ...generated,
  };
  if (entry.issuer) result.issuer = entry.issuer;
  return result;
}

export function getOtpStorePath(options: OtpStorageOptions = {}): string {
  return storePath(options.home);
}

export function getDefaultOtpHome(): string {
  return getOtpHome();
}
