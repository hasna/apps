// LocalStore — the on-box encrypted SQLite vault.
//
// This is the ONLY module (besides ../db.ts which owns the connection/migrations)
// that touches sqlite for vault data. Every value is encrypted at rest via
// ../crypto.ts. LocalStore is first-class: the app is fully functional with no
// cloud config at all.

import { randomUUID, createHash } from "node:crypto";
import { hostname } from "node:os";
import type { Database } from "bun:sqlite";
import { getDb } from "../db.js";
import { encrypt, decrypt, isEncrypted, fingerprintValue, shortFingerprint } from "../crypto.js";
import { assertValidSecretPath } from "../hasna-xyz-paths.js";
import { VERSION } from "../version.js";
import type {
  AuditEntry,
  EncryptVaultResult,
  PruneVersionsResult,
  RestoreVersionOptions,
  SecretEntry,
  SecretExportBundle,
  SecretMetadata,
  SecretType,
  SecretVersionCheck,
  SecretVersionMeta,
  SetSecretOptions,
  SetSecretResult,
  StoreCounts,
  StoreDescriptor,
  User,
  VaultItem,
  VaultItemInput,
  VaultItemKind,
  VaultItemMetadata,
  VaultItemPayload,
  VersionChangeKind,
} from "../types.js";
import { MAX_VERSIONS_PER_KEY, SUPERSEDED_VERSION_AGE_DAYS } from "../types.js";
import { assertMetadataSafe } from "../metadata.js";
import { VersionConflictError, VersionNotFoundError, type Store } from "./types.js";

const VAULT_ITEM_KINDS: VaultItemKind[] = [
  "login",
  "address",
  "identity",
  "payment_card",
  "secure_note",
  "api_key",
  "custom",
];

const SECRET_TYPES: SecretType[] = ["api_key", "password", "token", "credential", "other"];
const USER_TYPES = ["human", "agent"] as const;

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

interface VersionRow {
  key: string;
  version: number;
  value_blob: string;
  value_hash: string;
  value_length: number;
  change_kind: VersionChangeKind;
  reason: string | null;
  label: string | null;
  source_version: number | null;
  batch_id: string | null;
  provider_expires_at: string | null;
  created_at: string;
  created_by: string;
}

interface NewVersionInput {
  version: number;
  valueBlob: string;
  valueHash: string;
  valueLength: number;
  changeKind: VersionChangeKind;
  reason?: string;
  label?: string;
  sourceVersion?: number;
  batchId?: string;
  createdAt: string;
  createdBy: string;
}

function currentAgent(): string {
  return process.env.AGENT_ID ?? process.env.USER ?? hostname();
}

function metadataColumns(): string {
  return "key, type, label, expires_at, created_at, updated_at";
}

/** Metadata-only projection of a version row; never includes value material. */
function versionMeta(row: VersionRow, currentVersion: number): SecretVersionMeta {
  return {
    version: row.version,
    change_kind: row.change_kind,
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.label ? { label: row.label } : {}),
    ...(row.source_version ? { source_version: row.source_version } : {}),
    ...(row.batch_id ? { batch_id: row.batch_id } : {}),
    ...(row.provider_expires_at ? { provider_expires_at: row.provider_expires_at } : {}),
    created_at: row.created_at,
    created_by: row.created_by,
    value_length: row.value_length,
    fingerprint: shortFingerprint(row.value_hash),
    current: row.version === currentVersion,
  };
}

function vaultItemMetadataColumns(): string {
  return "id, kind, title, subtitle, domains, tags, favorite, created_at, updated_at";
}

function decryptRows(rows: SecretEntry[]): SecretEntry[] {
  return rows.map((r) => ({ ...r, value: decrypt(r.value) }));
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

function baseDomain(host: string): string {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
}

function domainMatches(host: string, domain: string): boolean {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;
  return host === normalized || host.endsWith(`.${normalized}`);
}

function hostSearchTerms(host: string): string[] {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 1) return [host];
  const terms = new Set<string>([host]);
  terms.add(parts.slice(-2).join("."));
  terms.add(parts[0]);
  return [...terms].filter(Boolean);
}

export class LocalStore implements Store {
  readonly mode = "local" as const;

  private db(): Database {
    return getDb();
  }

  private audit(action: AuditEntry["action"], key: string): void {
    this.db()
      .prepare("INSERT INTO audit_log (action, key, agent, timestamp) VALUES (?, ?, ?, ?)")
      .run(action, key, currentAgent(), new Date().toISOString());
  }

  // ── secrets ────────────────────────────────────────────────────────────
  async setSecret(key: string, value: string, type: SecretType = "other", label?: string, expiresAt?: string, opts?: SetSecretOptions): Promise<SetSecretResult> {
    assertValidSecretPath(key);
    // Metadata policy (spec §2.7.6): reason/label are scanned and length-bounded
    // before anything is written, so a rejected payload performs zero mutation.
    assertMetadataSafe("reason", opts?.reason);
    assertMetadataSafe("label", label);
    const db = this.db();
    const now = new Date().toISOString();
    const existing = db.prepare("SELECT created_at FROM secrets WHERE key = ?").get(key) as
      | { created_at: string }
      | undefined;

    // Pre-upgrade vaults have no version rows yet; the current value becomes
    // version 1 (change_kind=migration) exactly once, before any comparison.
    if (existing) this.ensureVersionBaseline(key);

    const current = this.currentVersionRow(key);
    const hash = fingerprintValue(value);
    let version: number;
    let unchanged = false;
    if (current) {
      if (current.value_hash === hash) {
        // No value change: return `unchanged` instead of creating noise. The
        // metadata upsert below still runs (type/label/expiry may have changed).
        unchanged = true;
        version = current.version;
      } else {
        version = current.version + 1;
        this.insertVersion(key, {
          version,
          valueBlob: encrypt(value),
          valueHash: hash,
          valueLength: value.length,
          changeKind: opts?.changeKind ?? "set",
          reason: opts?.reason,
          batchId: opts?.batchId,
          createdAt: now,
          createdBy: currentAgent(),
        });
      }
    } else {
      version = 1;
      this.insertVersion(key, {
        version,
        valueBlob: encrypt(value),
        valueHash: hash,
        valueLength: value.length,
        changeKind: "initial",
        reason: opts?.reason,
        batchId: opts?.batchId,
        createdAt: now,
        createdBy: currentAgent(),
      });
    }

    db.prepare(`
      INSERT INTO secrets (key, value, type, label, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        type = excluded.type,
        label = excluded.label,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `).run(key, encrypt(value), type, label ?? null, expiresAt ?? null, existing?.created_at ?? now, now);

    this.audit("set", key);
    const entry = await this.getSecret(key);
    return { ...entry!, version, unchanged };
  }

  async getSecret(key: string): Promise<SecretEntry | undefined> {
    const row = this.db().prepare("SELECT * FROM secrets WHERE key = ?").get(key) as SecretEntry | undefined;
    if (!row) return undefined;
    row.value = decrypt(row.value);
    this.audit("get", key);
    return row;
  }

  async deleteSecret(key: string): Promise<boolean> {
    const result = this.db().prepare("DELETE FROM secrets WHERE key = ?").run(key);
    if (result.changes === 0) return false;
    this.audit("delete", key);
    return true;
  }

  async listSecrets(namespace?: string): Promise<SecretEntry[]> {
    const db = this.db();
    let rows: SecretEntry[];
    if (!namespace) {
      rows = db.prepare("SELECT * FROM secrets ORDER BY key").all() as SecretEntry[];
    } else {
      const prefix = namespace.endsWith("/") ? namespace : `${namespace}/`;
      rows = db.prepare("SELECT * FROM secrets WHERE key LIKE ? OR key = ? ORDER BY key").all(`${prefix}%`, namespace) as SecretEntry[];
    }
    return decryptRows(rows);
  }

  async listSecretMetadata(namespace?: string): Promise<SecretMetadata[]> {
    const db = this.db();
    if (!namespace) {
      return db.prepare(`SELECT ${metadataColumns()} FROM secrets ORDER BY key`).all() as SecretMetadata[];
    }
    const prefix = namespace.endsWith("/") ? namespace : `${namespace}/`;
    return db
      .prepare(`SELECT ${metadataColumns()} FROM secrets WHERE key LIKE ? OR key = ? ORDER BY key`)
      .all(`${prefix}%`, namespace) as SecretMetadata[];
  }

  async searchSecrets(query: string): Promise<SecretEntry[]> {
    const q = `%${query}%`;
    const rows = this.db()
      .prepare("SELECT * FROM secrets WHERE key LIKE ? OR label LIKE ? OR type LIKE ? ORDER BY key")
      .all(q, q, q) as SecretEntry[];
    return decryptRows(rows);
  }

  async searchSecretMetadata(query: string): Promise<SecretMetadata[]> {
    const q = `%${query}%`;
    return this.db()
      .prepare(`SELECT ${metadataColumns()} FROM secrets WHERE key LIKE ? OR label LIKE ? OR type LIKE ? ORDER BY key`)
      .all(q, q, q) as SecretMetadata[];
  }

  async importSecrets(entries: Array<{ key: string; value: string; type?: SecretType; label?: string; expires_at?: string }>): Promise<number> {
    let count = 0;
    for (const e of entries) {
      await this.setSecret(e.key, e.value, e.type ?? "other", e.label, e.expires_at);
      count++;
    }
    return count;
  }

  async exportSecrets(redact = true): Promise<SecretExportBundle> {
    const db = this.db();
    const secrets: Record<string, SecretEntry> = {};
    if (redact) {
      const rows = db.prepare(`SELECT ${metadataColumns()} FROM secrets ORDER BY key`).all() as SecretMetadata[];
      for (const row of rows) secrets[row.key] = { ...row, value: "***REDACTED***" };
      return { version: 2, redacted: true, secrets };
    }
    const rows = db.prepare("SELECT * FROM secrets ORDER BY key").all() as SecretEntry[];
    for (const row of rows) secrets[row.key] = { ...row, value: decrypt(row.value) };
    return { version: 2, redacted: false, secrets };
  }

  async pruneExpired(): Promise<number> {
    return this.db()
      .prepare("DELETE FROM secrets WHERE expires_at IS NOT NULL AND expires_at < ?")
      .run(new Date().toISOString()).changes;
  }

  // ── secret versioning ───────────────────────────────────────────────────
  async listVersions(key: string, limit = 20): Promise<SecretVersionMeta[]> {
    const db = this.db();
    const max = db.prepare("SELECT MAX(version) AS version FROM secret_versions WHERE key = ?").get(key) as
      | { version: number | null }
      | undefined;
    const currentVersion = max?.version ?? 0;
    const rows = db
      .prepare(
        `SELECT version, change_kind, reason, label, source_version, batch_id, provider_expires_at,
                created_at, created_by, value_length, value_hash
         FROM secret_versions WHERE key = ? ORDER BY version DESC LIMIT ?`,
      )
      .all(key, limit) as VersionRow[];
    return rows.map((row) => versionMeta(row, currentVersion));
  }

  async checkVersion(key: string, version: number): Promise<SecretVersionCheck> {
    const db = this.db();
    const max = db.prepare("SELECT MAX(version) AS version FROM secret_versions WHERE key = ?").get(key) as
      | { version: number | null }
      | undefined;
    const currentVersion = max?.version ?? 0;
    const row = db.prepare("SELECT * FROM secret_versions WHERE key = ? AND version = ?").get(key, version) as
      | VersionRow
      | undefined;
    if (!row) throw new VersionNotFoundError(`Version ${version} not found for key ${key}`);
    const digest = createHash("sha256").update(decrypt(row.value_blob)).digest("hex");
    return { ...versionMeta(row, currentVersion), hash: digest };
  }

  async restoreVersion(key: string, version: number, opts: RestoreVersionOptions): Promise<SecretVersionMeta> {
    const reason = opts.reason?.trim();
    if (!reason) throw new Error("A reason is required for restore.");
    assertMetadataSafe("reason", reason);
    if (typeof opts.expectCurrent !== "number" || !Number.isInteger(opts.expectCurrent) || opts.expectCurrent < 1) {
      throw new Error("expected_current_version is required and must be a positive integer.");
    }
    const db = this.db();
    const now = new Date().toISOString();
    // bun:sqlite's transaction() wraps the callback; the wrapped function must
    // be invoked to run the read-validate-insert/update atomically.
    const run = db.transaction(() => {
      const secretsRow = db.prepare("SELECT created_at FROM secrets WHERE key = ?").get(key) as
        | { created_at: string }
        | undefined;
      if (!secretsRow) throw new VersionNotFoundError(`Secret not found: ${key}`);
      const source = db.prepare("SELECT * FROM secret_versions WHERE key = ? AND version = ?").get(key, version) as
        | VersionRow
        | undefined;
      if (!source) throw new VersionNotFoundError(`Version ${version} not found for key ${key}`);
      const max = db.prepare("SELECT MAX(version) AS version FROM secret_versions WHERE key = ?").get(key) as
        | { version: number | null }
        | undefined;
      const currentVersion = max?.version ?? 0;
      if (opts.expectCurrent !== currentVersion) {
        throw new VersionConflictError(
          `Current version is ${currentVersion}, expected ${opts.expectCurrent}. Re-list versions and retry.`,
        );
      }
      const plaintext = decrypt(source.value_blob);
      const newVersion = currentVersion + 1;
      const row = this.insertVersion(key, {
        version: newVersion,
        valueBlob: source.value_blob,
        valueHash: fingerprintValue(plaintext),
        valueLength: plaintext.length,
        changeKind: "restore",
        reason,
        sourceVersion: version,
        createdAt: now,
        createdBy: currentAgent(),
      });
      // The current value served by get/exec must match the restored version.
      db.prepare("UPDATE secrets SET value = ?, updated_at = ? WHERE key = ?").run(source.value_blob, now, key);
      return versionMeta(row, newVersion);
    });
    const meta = run();
    this.audit("restore", key);
    return meta;
  }

  async pruneVersionHistory(): Promise<PruneVersionsResult> {
    const cutoff = new Date(Date.now() - SUPERSEDED_VERSION_AGE_DAYS * 86_400_000).toISOString();
    const result = this.db()
      .prepare(
        `DELETE FROM secret_versions
         WHERE version < (SELECT MAX(v2.version) FROM secret_versions v2 WHERE v2.key = secret_versions.key)
           AND (
             version NOT IN (
               SELECT v3.version FROM secret_versions v3
               WHERE v3.key = secret_versions.key ORDER BY v3.version DESC LIMIT ?
             )
             OR created_at < ?
           )`,
      )
      .run(MAX_VERSIONS_PER_KEY, cutoff);
    return { versions: result.changes };
  }

  async runVersionBackfill(): Promise<number> {
    const db = this.db();
    const keys = db.prepare("SELECT key FROM secrets").all() as Array<{ key: string }>;
    let created = 0;
    for (const { key } of keys) created += this.ensureVersionBaseline(key) ? 1 : 0;
    return created;
  }

  /**
   * Current version row (or undefined when the key has no history yet). The
   * baseline makes sure pre-upgrade values count as version 1 first.
   */
  private currentVersionRow(key: string): VersionRow | undefined {
    return this.db()
      .prepare(
        "SELECT * FROM secret_versions WHERE key = ? AND version = (SELECT MAX(version) FROM secret_versions WHERE key = ?)",
      )
      .get(key, key) as VersionRow | undefined;
  }

  /** Idempotent: an existing value with no version rows becomes version 1 (migration). */
  private ensureVersionBaseline(key: string): boolean {
    const db = this.db();
    const row = db.prepare("SELECT value FROM secrets WHERE key = ?").get(key) as { value: string } | undefined;
    if (!row) return false;
    const existing = db.prepare("SELECT 1 FROM secret_versions WHERE key = ? AND version = 1").get(key);
    if (existing) return false;
    const plaintext = decrypt(row.value);
    this.insertVersion(key, {
      version: 1,
      valueBlob: row.value,
      valueHash: fingerprintValue(plaintext),
      valueLength: plaintext.length,
      changeKind: "migration",
      reason: "baseline current value",
      createdAt: new Date().toISOString(),
      createdBy: "system:migration",
    });
    return true;
  }

  /** Insert one immutable version row, then enforce retention for this key. */
  private insertVersion(key: string, input: NewVersionInput): VersionRow {
    const db = this.db();
    db.prepare(
      `INSERT INTO secret_versions
         (key, version, value_blob, value_hash, value_length, change_kind, reason, label,
          source_version, batch_id, provider_expires_at, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      key,
      input.version,
      input.valueBlob,
      input.valueHash,
      input.valueLength,
      input.changeKind,
      input.reason ?? null,
      input.label ?? null,
      input.sourceVersion ?? null,
      input.batchId ?? null,
      null, // provider_expires_at — not exposed by any current write surface
      input.createdAt,
      input.createdBy,
    );
    this.pruneVersionHistoryForKey(key);
    return {
      key,
      version: input.version,
      value_blob: input.valueBlob,
      value_hash: input.valueHash,
      value_length: input.valueLength,
      change_kind: input.changeKind,
      reason: input.reason ?? null,
      label: input.label ?? null,
      source_version: input.sourceVersion ?? null,
      batch_id: input.batchId ?? null,
      provider_expires_at: null,
      created_at: input.createdAt,
      created_by: input.createdBy,
    };
  }

  /** Retention for one key: count + superseded-age bounds; never the current version. */
  private pruneVersionHistoryForKey(key: string): void {
    const cutoff = new Date(Date.now() - SUPERSEDED_VERSION_AGE_DAYS * 86_400_000).toISOString();
    this.db()
      .prepare(
        `DELETE FROM secret_versions
         WHERE key = ? AND version < (SELECT MAX(v2.version) FROM secret_versions v2 WHERE v2.key = secret_versions.key)
           AND (
             version NOT IN (
               SELECT v3.version FROM secret_versions v3
               WHERE v3.key = secret_versions.key ORDER BY v3.version DESC LIMIT ?
             )
             OR created_at < ?
           )`,
      )
      .run(key, MAX_VERSIONS_PER_KEY, cutoff);
  }

  // ── structured vault items ───────────────────────────────────────────────
  async setVaultItem(input: VaultItemInput): Promise<VaultItem> {
    assertVaultItemKind(input.kind);
    const title = input.title.trim();
    if (!title) throw new Error("Vault item title is required");

    const db = this.db();
    const id = input.id?.trim() || randomUUID();
    const now = new Date().toISOString();
    const existing = db.prepare("SELECT created_at FROM vault_items WHERE id = ?").get(id) as
      | { created_at: string }
      | undefined;
    const data = encrypt(JSON.stringify(normalizeVaultPayload(input.kind, input.data ?? {})));

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
      JSON.stringify(normalizeDomains(input.domains)),
      JSON.stringify(normalizeStringArray(input.tags)),
      input.favorite ? 1 : 0,
      data,
      existing?.created_at ?? now,
      now,
    );

    this.audit("set", `vault-item/${id}`);
    return (await this.getVaultItem(id))!;
  }

  async getVaultItem(id: string): Promise<VaultItem | undefined> {
    const row = this.db().prepare("SELECT * FROM vault_items WHERE id = ?").get(id) as VaultItemRow | undefined;
    if (!row) return undefined;
    this.audit("get", `vault-item/${id}`);
    return rowToVaultItem(row);
  }

  async deleteVaultItem(id: string): Promise<boolean> {
    const result = this.db().prepare("DELETE FROM vault_items WHERE id = ?").run(id);
    if (result.changes === 0) return false;
    this.audit("delete", `vault-item/${id}`);
    return true;
  }

  async listVaultItemMetadata(kind?: VaultItemKind): Promise<VaultItemMetadata[]> {
    const db = this.db();
    const rows = kind
      ? (db.prepare(`SELECT ${vaultItemMetadataColumns()} FROM vault_items WHERE kind = ? ORDER BY favorite DESC, title`).all(kind) as VaultItemRow[])
      : (db.prepare(`SELECT ${vaultItemMetadataColumns()} FROM vault_items ORDER BY favorite DESC, title`).all() as VaultItemRow[]);
    return rows.map(rowToVaultItemMetadata);
  }

  async searchVaultItemMetadata(query: string): Promise<VaultItemMetadata[]> {
    const q = `%${query}%`;
    const rows = this.db()
      .prepare(`
        SELECT ${vaultItemMetadataColumns()}
        FROM vault_items
        WHERE title LIKE ? OR subtitle LIKE ? OR kind LIKE ? OR domains LIKE ? OR tags LIKE ?
        ORDER BY favorite DESC, title
      `)
      .all(q, q, q, q, q) as VaultItemRow[];
    return rows.map(rowToVaultItemMetadata);
  }

  async matchVaultItemsForUrl(rawUrl: string): Promise<VaultItemMetadata[]> {
    return matchVaultItemsForUrl(rawUrl, () => this.listVaultItemMetadata());
  }

  // ── users / agents registry ──────────────────────────────────────────────
  async registerUser(id: string, name: string, type: "human" | "agent" = "human"): Promise<User> {
    const db = this.db();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (id, name, type, registered_at, last_seen)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, last_seen = excluded.last_seen
    `).run(id, name, type, now, now);
    return (await this.getUser(id))!;
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.db().prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
  }

  async listUsers(type?: "human" | "agent"): Promise<User[]> {
    const db = this.db();
    if (type) return db.prepare("SELECT * FROM users WHERE type = ? ORDER BY name").all(type) as User[];
    return db.prepare("SELECT * FROM users ORDER BY type, name").all() as User[];
  }

  async deleteUser(id: string): Promise<boolean> {
    return this.db().prepare("DELETE FROM users WHERE id = ?").run(id).changes > 0;
  }

  async touchUser(id: string): Promise<void> {
    this.db().prepare("UPDATE users SET last_seen = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  // ── audit ────────────────────────────────────────────────────────────────
  async getAuditLog(key?: string, limit = 100): Promise<AuditEntry[]> {
    const db = this.db();
    if (key) {
      return db.prepare("SELECT * FROM audit_log WHERE key = ? ORDER BY timestamp DESC LIMIT ?").all(key, limit) as AuditEntry[];
    }
    return db.prepare("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?").all(limit) as AuditEntry[];
  }

  // ── feedback ───────────────────────────────────────────────────────────────
  async sendFeedback(message: string, email?: string, category = "general"): Promise<void> {
    this.db().run(
      "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
      [message, email ?? null, category, VERSION],
    );
  }

  // ── status / maintenance ───────────────────────────────────────────────────
  async status(): Promise<StoreCounts> {
    const db = this.db();
    const secretRows = db.prepare("SELECT type, label, expires_at FROM secrets").all() as Array<{
      type: string;
      label: string | null;
      expires_at: string | null;
    }>;
    const userRows = db.prepare("SELECT type FROM users").all() as Array<{ type: "human" | "agent" }>;
    const auditEntries = Number((db.prepare("SELECT COUNT(*) as count FROM audit_log").get() as { count: number }).count);
    return computeCounts(secretRows, userRows, auditEntries);
  }

  describe(): StoreDescriptor {
    const path = String((this.db() as { filename?: string }).filename ?? "");
    return { mode: "local", location: path };
  }

  /**
   * Synchronous metadata-only count of local vault secret rows (never includes
   * values). Local runs reach this store only through the explicit
   * HASNA_SECRETS_LOCAL_VAULT=1 opt-in — there is no silent fallback anymore.
   */
  countSecretsSync(): number {
    const db = this.db();
    const row = db.prepare("SELECT COUNT(*) AS count FROM secrets").get() as { count: number } | null;
    return row?.count ?? 0;
  }

  async encryptVault(): Promise<EncryptVaultResult> {
    const db = this.db();
    const rows = db.prepare("SELECT key, value FROM secrets").all() as { key: string; value: string }[];
    let migrated = 0;
    let alreadyEncrypted = 0;
    for (const row of rows) {
      if (isEncrypted(row.value)) {
        alreadyEncrypted++;
        continue;
      }
      db.prepare("UPDATE secrets SET value = ?, updated_at = ? WHERE key = ?").run(encrypt(row.value), new Date().toISOString(), row.key);
      migrated++;
    }
    return { migrated, alreadyEncrypted };
  }
}

// Shared helpers reused by ApiStore (no sqlite involved) ──────────────────────

/**
 * URL → matching vault items, given a metadata lister. Pure over the metadata,
 * so both LocalStore and ApiStore share the same matching rules.
 */
export async function matchVaultItemsForUrl(
  rawUrl: string,
  list: () => Promise<VaultItemMetadata[]>,
): Promise<VaultItemMetadata[]> {
  let host: string;
  try {
    host = normalizeDomain(rawUrl);
  } catch {
    return [];
  }
  if (!host) return [];

  const base = baseDomain(host);
  const terms = hostSearchTerms(host);
  const items = await list();
  return items.filter((item) => {
    if (item.domains.length > 0) {
      return item.domains.some((domain) => domainMatches(host, domain));
    }
    const haystack = [item.title, item.subtitle, ...item.tags].filter(Boolean).join(" ").toLowerCase();
    return terms.some((term) => haystack.includes(term)) || haystack.includes(base);
  });
}

/** Derive metadata-only counts from secret + user rows. Shared by both stores. */
export function computeCounts(
  secretRows: Array<{ type: string; label: string | null; expires_at: string | null }>,
  userRows: Array<{ type: "human" | "agent" }>,
  auditEntries: number,
  expiringSoonDays = 14,
): StoreCounts {
  const now = Date.now();
  const expiringSoonMs = Math.max(1, expiringSoonDays) * 86_400_000;
  const byType = Object.fromEntries(SECRET_TYPES.map((type) => [type, 0])) as Record<SecretType, number>;
  let withLabels = 0;
  let expired = 0;
  let expiringSoon = 0;

  for (const row of secretRows) {
    const type = SECRET_TYPES.includes(row.type as SecretType) ? (row.type as SecretType) : "other";
    byType[type] += 1;
    if (row.label) withLabels += 1;
    if (!row.expires_at) continue;
    const expiresAt = Date.parse(row.expires_at);
    if (Number.isNaN(expiresAt)) continue;
    if (expiresAt < now) expired += 1;
    else if (expiresAt - now <= expiringSoonMs) expiringSoon += 1;
  }

  const usersByType = Object.fromEntries(USER_TYPES.map((type) => [type, 0])) as Record<"human" | "agent", number>;
  for (const row of userRows) {
    if (row.type === "human" || row.type === "agent") usersByType[row.type] += 1;
  }

  return {
    secrets: secretRows.length,
    byType,
    withLabels,
    expired,
    expiringSoon,
    users: userRows.length,
    usersByType,
    auditEntries,
  };
}
