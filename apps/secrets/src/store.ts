import { randomUUID } from "crypto";
import { hostname } from "os";
import { getDb } from "./db.js";
import { encrypt, decrypt, isEncrypted } from "./crypto.js";
import { assertValidSecretPath } from "./hasna-xyz-paths.js";
import {
  resolveSecretsCloud,
  cloudSetSecret,
  cloudGetSecret,
  cloudDeleteSecret,
  cloudListSecrets,
  cloudListSecretMetadata,
  cloudSearchSecrets,
  cloudSearchSecretMetadata,
  cloudSetVaultItem,
  cloudGetVaultItem,
  cloudDeleteVaultItem,
  cloudListVaultItemMetadata,
  cloudSearchVaultItemMetadata,
  cloudGetAuditLog,
  cloudRegisterUser,
  cloudGetUser,
  cloudListUsers,
} from "./store-cloud.js";
import type {
  SecretEntry,
  SecretMetadata,
  SecretType,
  AuditEntry,
  VaultItem,
  VaultItemInput,
  VaultItemKind,
  VaultItemMetadata,
  VaultItemPayload,
} from "./types.js";

const VAULT_ITEM_KINDS: VaultItemKind[] = [
  "login",
  "address",
  "identity",
  "payment_card",
  "secure_note",
  "api_key",
  "custom",
];

interface VaultItemRow {
  id: string;
  kind: VaultItemKind;
  title: string;
  subtitle?: string | null;
  domains: string;
  tags: string;
  favorite: number | boolean;
  data?: string;
  created_at: string;
  updated_at: string;
}

function currentAgent(): string {
  return process.env.AGENT_ID ?? process.env.USER ?? hostname();
}

function audit(action: AuditEntry["action"], key: string): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO audit_log (action, key, agent, timestamp) VALUES (?, ?, ?, ?)"
  ).run(action, key, currentAgent(), new Date().toISOString());
}

export async function setSecret(
  key: string,
  value: string,
  type: SecretType = "other",
  label?: string,
  expiresAt?: string
): Promise<SecretEntry> {
  const cloud = resolveSecretsCloud();
  if (cloud) {
    assertValidSecretPath(key);
    return cloudSetSecret(cloud, key, value, type, label, expiresAt);
  }
  return localSetSecret(key, value, type, label, expiresAt);
}

function localSetSecret(
  key: string,
  value: string,
  type: SecretType = "other",
  label?: string,
  expiresAt?: string
): SecretEntry {
  assertValidSecretPath(key);

  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT created_at FROM secrets WHERE key = ?").get(key) as
    | { created_at: string }
    | undefined;

  const encryptedValue = encrypt(value);
  db.prepare(`
    INSERT INTO secrets (key, value, type, label, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      type = excluded.type,
      label = excluded.label,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run(key, encryptedValue, type, label ?? null, expiresAt ?? null, existing?.created_at ?? now, now);

  audit("set", key);
  return localGetSecret(key)!;
}

export async function getSecret(key: string): Promise<SecretEntry | undefined> {
  const cloud = resolveSecretsCloud();
  if (cloud) return cloudGetSecret(cloud, key);
  return localGetSecret(key);
}

function localGetSecret(key: string): SecretEntry | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM secrets WHERE key = ?").get(key) as SecretEntry | undefined;
  if (!row) return undefined;
  row.value = decrypt(row.value);
  audit("get", key);
  return row;
}

export async function deleteSecret(key: string): Promise<boolean> {
  const cloud = resolveSecretsCloud();
  if (cloud) return cloudDeleteSecret(cloud, key);
  return localDeleteSecret(key);
}

function localDeleteSecret(key: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM secrets WHERE key = ?").run(key);
  if (result.changes === 0) return false;
  audit("delete", key);
  return true;
}

function decryptRows(rows: SecretEntry[]): SecretEntry[] {
  return rows.map((r) => ({ ...r, value: decrypt(r.value) }));
}

function metadataColumns(): string {
  return "key, type, label, expires_at, created_at, updated_at";
}

function vaultItemMetadataColumns(): string {
  return "id, kind, title, subtitle, domains, tags, favorite, created_at, updated_at";
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function normalizeDomain(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw) return "";
  try {
    const withScheme = raw.includes("://") ? raw : `https://${raw}`;
    return new URL(withScheme).hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
  }
}

function normalizeStringArray(values?: string[]): string[] {
  if (!values) return [];
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  ) as T;
}

function normalizeVaultPayload(kind: VaultItemKind, payload: VaultItemPayload): VaultItemPayload {
  const data = compactObject(payload);

  switch (kind) {
    case "login":
      return compactObject({
        username: data.username ?? data.email ?? data.login,
        email: data.email,
        login: data.login,
        password: data.password,
        url: data.url,
        totp: data.totp,
        notes: data.notes,
      });
    case "address":
    case "identity":
      return compactObject({
        name: data.name,
        givenName: data.givenName,
        familyName: data.familyName,
        organization: data.organization,
        company: data.company,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        city: data.city,
        state: data.state,
        postalCode: data.postalCode,
        country: data.country,
        phone: data.phone,
        email: data.email,
      });
    case "payment_card":
      return compactObject({
        cardName: data.cardName ?? data.name,
        cardNumber: data.cardNumber,
        expiration: data.expiration,
        expirationMonth: data.expirationMonth,
        expirationYear: data.expirationYear,
        securityCode: data.securityCode ?? data.cvv ?? data.cvc,
        billingAddress: data.billingAddress,
        name: data.name,
      });
    default:
      return data;
  }
}

function normalizeDomains(values?: string[]): string[] {
  return [...new Set(normalizeStringArray(values).map(normalizeDomain).filter(Boolean))];
}

function rowToVaultItemMetadata(row: VaultItemRow): VaultItemMetadata {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    ...(row.subtitle ? { subtitle: row.subtitle } : {}),
    domains: parseJsonArray(row.domains),
    tags: parseJsonArray(row.tags),
    favorite: Boolean(row.favorite),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseVaultPayload(stored: string): VaultItemPayload {
  const decrypted = decrypt(stored);
  const parsed = JSON.parse(decrypted);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Malformed vault item payload");
  }
  return parsed as VaultItemPayload;
}

function rowToVaultItem(row: VaultItemRow): VaultItem {
  if (!row.data) throw new Error("Vault item row is missing encrypted data");
  return {
    ...rowToVaultItemMetadata(row),
    data: parseVaultPayload(row.data),
  };
}

function assertVaultItemKind(kind: string): asserts kind is VaultItemKind {
  if (!VAULT_ITEM_KINDS.includes(kind as VaultItemKind)) {
    throw new Error(`Invalid vault item kind "${kind}". Valid: ${VAULT_ITEM_KINDS.join(", ")}`);
  }
}

function baseDomain(hostname: string): string {
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join(".");
}

function domainMatches(hostname: string, domain: string): boolean {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

function hostSearchTerms(hostname: string): string[] {
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 1) return [hostname];
  const terms = new Set<string>([hostname]);
  terms.add(parts.slice(-2).join("."));
  terms.add(parts[0]);
  return [...terms].filter(Boolean);
}

export async function setVaultItem(input: VaultItemInput): Promise<VaultItem> {
  const cloud = resolveSecretsCloud();
  if (cloud) {
    assertVaultItemKind(input.kind);
    if (!input.title.trim()) throw new Error("Vault item title is required");
    return cloudSetVaultItem(cloud, input);
  }
  return localSetVaultItem(input);
}

function localSetVaultItem(input: VaultItemInput): VaultItem {
  assertVaultItemKind(input.kind);
  const title = input.title.trim();
  if (!title) throw new Error("Vault item title is required");

  const db = getDb();
  const id = input.id?.trim() || randomUUID();
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT created_at FROM vault_items WHERE id = ?").get(id) as
    | { created_at: string }
    | undefined;
  const data = encrypt(JSON.stringify(normalizeVaultPayload(input.kind, input.data ?? {})));
  const domains = JSON.stringify(normalizeDomains(input.domains));
  const tags = JSON.stringify(normalizeStringArray(input.tags));

  db.prepare(`
    INSERT INTO vault_items (id, kind, title, subtitle, domains, tags, favorite, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      title = excluded.title,
      subtitle = excluded.subtitle,
      domains = excluded.domains,
      tags = excluded.tags,
      favorite = excluded.favorite,
      data = excluded.data,
      updated_at = excluded.updated_at
  `).run(
    id,
    input.kind,
    title,
    input.subtitle?.trim() || null,
    domains,
    tags,
    input.favorite ? 1 : 0,
    data,
    existing?.created_at ?? now,
    now,
  );

  audit("set", `vault-item/${id}`);
  return localGetVaultItem(id)!;
}

export async function getVaultItem(id: string): Promise<VaultItem | undefined> {
  const cloud = resolveSecretsCloud();
  if (cloud) return cloudGetVaultItem(cloud, id);
  return localGetVaultItem(id);
}

function localGetVaultItem(id: string): VaultItem | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM vault_items WHERE id = ?").get(id) as VaultItemRow | undefined;
  if (!row) return undefined;
  audit("get", `vault-item/${id}`);
  return rowToVaultItem(row);
}

export async function deleteVaultItem(id: string): Promise<boolean> {
  const cloud = resolveSecretsCloud();
  if (cloud) return cloudDeleteVaultItem(cloud, id);
  return localDeleteVaultItem(id);
}

function localDeleteVaultItem(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM vault_items WHERE id = ?").run(id);
  if (result.changes === 0) return false;
  audit("delete", `vault-item/${id}`);
  return true;
}

export async function listVaultItemMetadata(kind?: VaultItemKind): Promise<VaultItemMetadata[]> {
  const cloud = resolveSecretsCloud();
  if (cloud) return cloudListVaultItemMetadata(cloud, kind);
  return localListVaultItemMetadata(kind);
}

function localListVaultItemMetadata(kind?: VaultItemKind): VaultItemMetadata[] {
  const db = getDb();
  const rows = kind
    ? db
      .prepare(`SELECT ${vaultItemMetadataColumns()} FROM vault_items WHERE kind = ? ORDER BY favorite DESC, title`)
      .all(kind) as VaultItemRow[]
    : db
      .prepare(`SELECT ${vaultItemMetadataColumns()} FROM vault_items ORDER BY favorite DESC, title`)
      .all() as VaultItemRow[];
  return rows.map(rowToVaultItemMetadata);
}

export async function searchVaultItemMetadata(query: string): Promise<VaultItemMetadata[]> {
  const cloud = resolveSecretsCloud();
  if (cloud) return cloudSearchVaultItemMetadata(cloud, query);
  return localSearchVaultItemMetadata(query);
}

function localSearchVaultItemMetadata(query: string): VaultItemMetadata[] {
  const db = getDb();
  const q = `%${query}%`;
  const rows = db
    .prepare(`
      SELECT ${vaultItemMetadataColumns()}
      FROM vault_items
      WHERE title LIKE ? OR subtitle LIKE ? OR kind LIKE ? OR domains LIKE ? OR tags LIKE ?
      ORDER BY favorite DESC, title
    `)
    .all(q, q, q, q, q) as VaultItemRow[];
  return rows.map(rowToVaultItemMetadata);
}

export async function matchVaultItemsForUrl(rawUrl: string): Promise<VaultItemMetadata[]> {
  let hostname: string;
  try {
    hostname = normalizeDomain(rawUrl);
  } catch {
    return [];
  }
  if (!hostname) return [];

  const base = baseDomain(hostname);
  const terms = hostSearchTerms(hostname);
  const items = await listVaultItemMetadata();
  return items.filter((item) => {
    if (item.domains.length > 0) {
      return item.domains.some((domain) => domainMatches(hostname, domain));
    }
    const haystack = [item.title, item.subtitle, ...item.tags]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return terms.some((term) => haystack.includes(term)) || haystack.includes(base);
  });
}

export async function listSecrets(namespace?: string): Promise<SecretEntry[]> {
  const cloud = resolveSecretsCloud();
  if (cloud) return cloudListSecrets(cloud, namespace);
  return localListSecrets(namespace);
}

function localListSecrets(namespace?: string): SecretEntry[] {
  const db = getDb();
  let rows: SecretEntry[];
  if (!namespace) {
    rows = db.prepare("SELECT * FROM secrets ORDER BY key").all() as SecretEntry[];
  } else {
    const prefix = namespace.endsWith("/") ? namespace : `${namespace}/`;
    rows = db
      .prepare("SELECT * FROM secrets WHERE key LIKE ? OR key = ? ORDER BY key")
      .all(`${prefix}%`, namespace) as SecretEntry[];
  }
  return decryptRows(rows);
}

export async function listSecretMetadata(namespace?: string): Promise<SecretMetadata[]> {
  const cloud = resolveSecretsCloud();
  if (cloud) return cloudListSecretMetadata(cloud, namespace);
  return localListSecretMetadata(namespace);
}

function localListSecretMetadata(namespace?: string): SecretMetadata[] {
  const db = getDb();
  if (!namespace) {
    return db
      .prepare(`SELECT ${metadataColumns()} FROM secrets ORDER BY key`)
      .all() as SecretMetadata[];
  }

  const prefix = namespace.endsWith("/") ? namespace : `${namespace}/`;
  return db
    .prepare(`SELECT ${metadataColumns()} FROM secrets WHERE key LIKE ? OR key = ? ORDER BY key`)
    .all(`${prefix}%`, namespace) as SecretMetadata[];
}

export async function searchSecrets(query: string): Promise<SecretEntry[]> {
  const cloud = resolveSecretsCloud();
  if (cloud) return cloudSearchSecrets(cloud, query);
  return localSearchSecrets(query);
}

function localSearchSecrets(query: string): SecretEntry[] {
  const db = getDb();
  const q = `%${query}%`;
  const rows = db
    .prepare(
      "SELECT * FROM secrets WHERE key LIKE ? OR label LIKE ? OR type LIKE ? ORDER BY key"
    )
    .all(q, q, q) as SecretEntry[];
  return decryptRows(rows);
}

export async function searchSecretMetadata(query: string): Promise<SecretMetadata[]> {
  const cloud = resolveSecretsCloud();
  if (cloud) return cloudSearchSecretMetadata(cloud, query);
  return localSearchSecretMetadata(query);
}

function localSearchSecretMetadata(query: string): SecretMetadata[] {
  const db = getDb();
  const q = `%${query}%`;
  return db
    .prepare(
      `SELECT ${metadataColumns()} FROM secrets WHERE key LIKE ? OR label LIKE ? OR type LIKE ? ORDER BY key`
    )
    .all(q, q, q) as SecretMetadata[];
}

export async function importSecrets(
  entries: Array<{ key: string; value: string; type?: SecretType; label?: string; expires_at?: string }>
): Promise<number> {
  let count = 0;
  for (const e of entries) {
    await setSecret(e.key, e.value, e.type ?? "other", e.label, e.expires_at);
    count++;
  }
  return count;
}

export async function exportSecrets(redact = true): Promise<{ version: number; redacted: boolean; secrets: Record<string, SecretEntry> }> {
  const cloud = resolveSecretsCloud();
  if (cloud) {
    const secrets: Record<string, SecretEntry> = {};
    if (redact) {
      const meta = await cloudListSecretMetadata(cloud);
      for (const m of meta) secrets[m.key] = { ...(m as SecretEntry), value: "***REDACTED***" };
      return { version: 2, redacted: true, secrets };
    }
    const entries = await cloudListSecrets(cloud);
    for (const e of entries) secrets[e.key] = e;
    return { version: 2, redacted: false, secrets };
  }
  return localExportSecrets(redact);
}

function localExportSecrets(redact = true): { version: number; redacted: boolean; secrets: Record<string, SecretEntry> } {
  const db = getDb();
  const secrets: Record<string, SecretEntry> = {};

  if (redact) {
    const rows = db.prepare(`SELECT ${metadataColumns()} FROM secrets ORDER BY key`).all() as SecretMetadata[];
    for (const row of rows) {
      secrets[row.key] = { ...row, value: "***REDACTED***" };
    }
    return { version: 2, redacted: true, secrets };
  }

  const rows = db.prepare("SELECT * FROM secrets ORDER BY key").all() as SecretEntry[];
  for (const row of rows) {
    const decrypted = { ...row, value: decrypt(row.value) };
    secrets[row.key] = decrypted;
  }
  return { version: 2, redacted: false, secrets };
}

export async function getAuditLog(key?: string, limit = 100): Promise<AuditEntry[]> {
  const cloud = resolveSecretsCloud();
  if (cloud) return cloudGetAuditLog(cloud, key, limit);
  return localGetAuditLog(key, limit);
}

function localGetAuditLog(key?: string, limit = 100): AuditEntry[] {
  const db = getDb();
  if (key) {
    return db
      .prepare("SELECT * FROM audit_log WHERE key = ? ORDER BY timestamp DESC LIMIT ?")
      .all(key, limit) as AuditEntry[];
  }
  return db
    .prepare("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?")
    .all(limit) as AuditEntry[];
}

export async function pruneExpired(): Promise<number> {
  // Cloud mode: the server owns TTL/expiry enforcement, so there is nothing to
  // prune from the client. Local mode: sweep expired rows from the vault.
  if (resolveSecretsCloud()) return 0;
  const db = getDb();
  const result = db
    .prepare("DELETE FROM secrets WHERE expires_at IS NOT NULL AND expires_at < ?")
    .run(new Date().toISOString());
  return result.changes;
}

export function getVaultPath(): string {
  const db = getDb();
  return (db as any).filename as string;
}

// Users / agents registry
export interface User {
  id: string;
  name: string;
  type: "human" | "agent";
  registered_at: string;
  last_seen?: string;
}

export async function registerUser(id: string, name: string, type: "human" | "agent" = "human"): Promise<User> {
  const cloud = resolveSecretsCloud();
  if (cloud) return (await cloudRegisterUser(cloud, id, name, type)) as User;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, name, type, registered_at, last_seen)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, last_seen = excluded.last_seen
  `).run(id, name, type, now, now);
  return localGetUser(id)!;
}

export async function getUser(id: string): Promise<User | undefined> {
  const cloud = resolveSecretsCloud();
  if (cloud) return (await cloudGetUser(cloud, id)) as User | undefined;
  return localGetUser(id);
}

function localGetUser(id: string): User | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
}

export async function listUsers(type?: "human" | "agent"): Promise<User[]> {
  const cloud = resolveSecretsCloud();
  if (cloud) return (await cloudListUsers(cloud, type)) as User[];
  const db = getDb();
  if (type) {
    return db.prepare("SELECT * FROM users WHERE type = ? ORDER BY name").all(type) as User[];
  }
  return db.prepare("SELECT * FROM users ORDER BY type, name").all() as User[];
}

export async function deleteUser(id: string): Promise<boolean> {
  // No cloud delete-user route; local vault only.
  if (resolveSecretsCloud()) return false;
  const db = getDb();
  return db.prepare("DELETE FROM users WHERE id = ?").run(id).changes > 0;
}

export async function touchUser(id: string): Promise<void> {
  // Cloud user activity is tracked server-side; nothing to touch from the client.
  if (resolveSecretsCloud()) return;
  const db = getDb();
  db.prepare("UPDATE users SET last_seen = ? WHERE id = ?").run(new Date().toISOString(), id);
}
