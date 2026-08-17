/**
 * Postgres-backed secrets store for the deployed serve (PURE REMOTE, A1).
 *
 * Mirrors the local SQLite `store.ts` surface (secrets + structured vault items
 * + users + audit + feedback) but every read/write hits the cloud Postgres
 * directly via the vendored storage kit's TypedQueryClient. Secret and vault
 * payload values are encrypted at rest with the app-layer master key.
 */

import { createHash, randomUUID } from "node:crypto";
import type { TypedQueryClient } from "../generated/storage-kit/index.js";
import { assertValidSecretPath } from "../hasna-xyz-paths.js";
import { decryptValue, decryptValueWithMetadata, encryptValue, fingerprintValue, shortFingerprint } from "./cloud-crypto.js";
import type {
  PruneVersionsResult,
  RestoreVersionOptions,
  SecretEntry,
  SecretMetadata,
  SecretType,
  SecretVersionCheck,
  SecretVersionMeta,
  SetSecretOptions,
  SetSecretResult,
  VaultItem,
  VaultItemInput,
  VaultItemKind,
  VaultItemMetadata,
  VaultItemPayload,
  VersionChangeKind,
} from "../types.js";
import { MAX_VERSIONS_PER_KEY, SUPERSEDED_VERSION_AGE_DAYS } from "../types.js";
import { VersionConflictError, VersionNotFoundError } from "../store/types.js";
import { assertMetadataSafe } from "../metadata.js";

const VAULT_ITEM_KINDS: VaultItemKind[] = [
  "login",
  "address",
  "identity",
  "payment_card",
  "secure_note",
  "api_key",
  "custom",
];

interface SecretRow {
  key: string;
  value: string;
  type: SecretType;
  label: string | null;
  expires_at: string | null;
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

interface VaultRow {
  id: string;
  kind: VaultItemKind;
  title: string;
  subtitle: string | null;
  domains: string;
  tags: string;
  favorite: number | boolean;
  data?: string;
  created_at: string;
  updated_at: string;
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function normalizeStringArray(values?: string[]): string[] {
  if (!values) return [];
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
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

function normalizeDomains(values?: string[]): string[] {
  return [...new Set(normalizeStringArray(values).map(normalizeDomain).filter(Boolean))];
}

function requireTenantId(tenantId: string): string {
  const normalized = tenantId?.trim();
  if (!normalized) throw new Error("Tenant context is required");
  return normalized;
}

function secretMeta(row: SecretRow): SecretMetadata {
  return {
    key: row.key,
    type: row.type,
    ...(row.label ? { label: row.label } : {}),
    ...(row.expires_at ? { expires_at: row.expires_at } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
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

function vaultMeta(row: VaultRow): VaultItemMetadata {
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

export interface CloudUser {
  id: string;
  name: string;
  type: "human" | "agent";
  registered_at: string;
  last_seen?: string;
}

export class CloudSecretsStore {
  constructor(private readonly db: TypedQueryClient) {}

  private async audit(
    action: "get" | "set" | "delete" | "restore",
    key: string,
    actor: string,
    tenantId: string,
  ): Promise<void> {
    const tenant = requireTenantId(tenantId);
    await this.db.execute(
      "INSERT INTO audit_log (action, key, agent, timestamp, tenant_id) VALUES ($1, $2, $3, $4, $5)",
      [action, key, actor, new Date().toISOString(), tenant],
    );
  }

  /**
   * Run a callback inside a transaction when the underlying client supports one
   * (the server pool does), otherwise execute sequentially (test shims). Restore
   * relies on this for the read-validate-insert/update sequence to be atomic.
   */
  private async runInTransaction<T>(fn: (db: TypedQueryClient) => Promise<T>): Promise<T> {
    const transaction = (
      this.db as unknown as { transaction?: (cb: (client: TypedQueryClient) => Promise<T>) => Promise<T> }
    ).transaction;
    if (typeof transaction === "function") return transaction(fn);
    return fn(this.db);
  }

  // ---- secrets ----
  async setSecret(
    key: string,
    value: string,
    type: SecretType = "other",
    label: string | undefined,
    expiresAt: string | undefined,
    actor: string,
    tenantId: string,
    opts?: SetSecretOptions,
  ): Promise<SetSecretResult> {
    const tenant = requireTenantId(tenantId);
    assertValidSecretPath(key);
    // Metadata policy (spec §2.7.6): reason/label are scanned and length-bounded
    // before anything is written, so a rejected payload performs zero mutation.
    assertMetadataSafe("reason", opts?.reason);
    assertMetadataSafe("label", label);
    const now = new Date().toISOString();
    await this.ensureVersionBaseline(key);
    const current = await this.currentVersionRow(key);
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
        await this.insertVersion(key, {
          version,
          valueBlob: encryptValue(value),
          valueHash: hash,
          valueLength: value.length,
          changeKind: opts?.changeKind ?? "set",
          reason: opts?.reason,
          batchId: opts?.batchId,
          createdAt: now,
          createdBy: actor,
        });
      }
    } else {
      version = 1;
      await this.insertVersion(key, {
        version,
        valueBlob: encryptValue(value),
        valueHash: hash,
        valueLength: value.length,
        changeKind: "initial",
        reason: opts?.reason,
        batchId: opts?.batchId,
        createdAt: now,
        createdBy: actor,
      });
    }
    const existing = await this.db.get<{ created_at: string }>(
      "SELECT created_at FROM secrets WHERE key = $1",
      [key],
    );
    await this.db.execute(
      `INSERT INTO secrets (key, value, type, label, expires_at, created_at, updated_at, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value, type = excluded.type, label = excluded.label,
         expires_at = excluded.expires_at, updated_at = excluded.updated_at,
         tenant_id = excluded.tenant_id`,
      [key, encryptValue(value), type, label ?? null, expiresAt ?? null, existing?.created_at ?? now, now, tenant],
    );
    await this.audit("set", key, actor, tenant);
    const entry = await this.getSecret(key, actor, tenant);
    return { ...entry!, version, unchanged };
  }

  // ---- secret versioning ----
  async listVersions(key: string, actor: string, tenantId: string, limit = 20): Promise<SecretVersionMeta[]> {
    const tenant = requireTenantId(tenantId);
    const max = await this.db.get<{ version: number | null }>(
      "SELECT MAX(version) AS version FROM secret_versions WHERE key = $1",
      [key],
    );
    const currentVersion = max?.version ?? 0;
    const rows = await this.db.many<VersionRow>(
      `SELECT version, change_kind, reason, label, source_version, batch_id, provider_expires_at,
              created_at, created_by, value_length, value_hash
       FROM secret_versions WHERE key = $1 ORDER BY version DESC LIMIT $2`,
      [key, limit],
    );
    await this.audit("get", key, actor, tenant);
    return rows.map((row) => versionMeta(row, currentVersion));
  }

  async checkVersion(key: string, version: number, actor: string, tenantId: string): Promise<SecretVersionCheck> {
    const tenant = requireTenantId(tenantId);
    const max = await this.db.get<{ version: number | null }>(
      "SELECT MAX(version) AS version FROM secret_versions WHERE key = $1",
      [key],
    );
    const currentVersion = max?.version ?? 0;
    const row = await this.db.get<VersionRow>(
      "SELECT * FROM secret_versions WHERE key = $1 AND version = $2",
      [key, version],
    );
    if (!row) throw new VersionNotFoundError(`Version ${version} not found for key ${key}`);
    const digest = createHash("sha256").update(decryptValue(row.value_blob)).digest("hex");
    await this.audit("get", key, actor, tenant);
    return { ...versionMeta(row, currentVersion), hash: digest };
  }

  async restoreVersion(
    key: string,
    version: number,
    opts: RestoreVersionOptions,
    actor: string,
    tenantId: string,
  ): Promise<SecretVersionMeta> {
    const tenant = requireTenantId(tenantId);
    const reason = opts.reason?.trim();
    if (!reason) throw new Error("A reason is required for restore.");
    assertMetadataSafe("reason", reason);
    if (typeof opts.expectCurrent !== "number" || !Number.isInteger(opts.expectCurrent) || opts.expectCurrent < 1) {
      throw new Error("expected_current_version is required and must be a positive integer.");
    }
    return this.runInTransaction(async (db) => {
      const secretsRow = await db.get<{ created_at: string }>("SELECT created_at FROM secrets WHERE key = $1", [key]);
      if (!secretsRow) throw new VersionNotFoundError(`Secret not found: ${key}`);
      const source = await db.get<VersionRow>(
        "SELECT * FROM secret_versions WHERE key = $1 AND version = $2",
        [key, version],
      );
      if (!source) throw new VersionNotFoundError(`Version ${version} not found for key ${key}`);
      const max = await db.get<{ version: number | null }>(
        "SELECT MAX(version) AS version FROM secret_versions WHERE key = $1",
        [key],
      );
      const currentVersion = max?.version ?? 0;
      if (opts.expectCurrent !== currentVersion) {
        throw new VersionConflictError(
          `Current version is ${currentVersion}, expected ${opts.expectCurrent}. Re-list versions and retry.`,
        );
      }
      const plaintext = decryptValue(source.value_blob);
      const newVersion = currentVersion + 1;
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO secret_versions
           (key, version, value_blob, value_hash, value_length, change_kind, reason, label,
            source_version, batch_id, provider_expires_at, created_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          key,
          newVersion,
          source.value_blob,
          fingerprintValue(plaintext),
          plaintext.length,
          "restore",
          reason,
          null,
          version,
          null,
          null,
          now,
          actor,
        ],
      );
      // The current value served by get/exec must match the restored version.
      await db.execute("UPDATE secrets SET value = $1, updated_at = $2 WHERE key = $3", [source.value_blob, now, key]);
      await this.pruneVersionHistoryForKey(key, db);
      return versionMeta({ ...source, version: newVersion, value_length: plaintext.length, reason, source_version: version, created_at: now, created_by: actor }, newVersion);
    }).then(async (meta) => {
      await this.audit("restore", key, actor, tenant);
      return meta;
    });
  }

  async pruneVersionHistory(): Promise<PruneVersionsResult> {
    const cutoff = new Date(Date.now() - SUPERSEDED_VERSION_AGE_DAYS * 86_400_000).toISOString();
    const result = await this.db.query(
      `DELETE FROM secret_versions
       WHERE version < (SELECT MAX(v2.version) FROM secret_versions v2 WHERE v2.key = secret_versions.key)
         AND (
           version NOT IN (
             SELECT v3.version FROM secret_versions v3
             WHERE v3.key = secret_versions.key ORDER BY v3.version DESC LIMIT $1
           )
           OR created_at < $2
         )`,
      [MAX_VERSIONS_PER_KEY, cutoff],
    );
    return { versions: result.rowCount ?? 0 };
  }

  async runVersionBackfill(): Promise<number> {
    const keys = await this.db.many<{ key: string }>("SELECT key FROM secrets");
    let created = 0;
    for (const { key } of keys) created += (await this.ensureVersionBaseline(key)) ? 1 : 0;
    return created;
  }

  /** Current version row, or null when the key has no history yet. */
  private async currentVersionRow(key: string, db: TypedQueryClient = this.db): Promise<VersionRow | null> {
    return db.get<VersionRow>(
      "SELECT * FROM secret_versions WHERE key = $1 AND version = (SELECT MAX(version) FROM secret_versions WHERE key = $1)",
      [key],
    );
  }

  /** Idempotent: an existing value with no version rows becomes version 1 (migration). */
  private async ensureVersionBaseline(key: string): Promise<boolean> {
    const row = await this.db.get<{ value: string }>("SELECT value FROM secrets WHERE key = $1", [key]);
    if (!row) return false;
    const existing = await this.db.get("SELECT 1 FROM secret_versions WHERE key = $1 AND version = 1", [key]);
    if (existing) return false;
    const plaintext = decryptValue(row.value);
    await this.insertVersion(key, {
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
  private async insertVersion(key: string, input: NewVersionInput): Promise<void> {
    await this.db.execute(
      `INSERT INTO secret_versions
         (key, version, value_blob, value_hash, value_length, change_kind, reason, label,
          source_version, batch_id, provider_expires_at, created_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
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
      ],
    );
    await this.pruneVersionHistoryForKey(key);
  }

  /** Retention for one key: count + superseded-age bounds; never the current version. */
  private async pruneVersionHistoryForKey(key: string, db: TypedQueryClient = this.db): Promise<void> {
    const cutoff = new Date(Date.now() - SUPERSEDED_VERSION_AGE_DAYS * 86_400_000).toISOString();
    await db.execute(
      `DELETE FROM secret_versions
       WHERE key = $1 AND version < (SELECT MAX(v2.version) FROM secret_versions v2 WHERE v2.key = secret_versions.key)
         AND (
           version NOT IN (
             SELECT v3.version FROM secret_versions v3
             WHERE v3.key = secret_versions.key ORDER BY v3.version DESC LIMIT $2
           )
           OR created_at < $3
         )`,
      [key, MAX_VERSIONS_PER_KEY, cutoff],
    );
  }

  async getSecret(key: string, actor: string, tenantId: string): Promise<SecretEntry | undefined> {
    const tenant = requireTenantId(tenantId);
    const row = await this.db.get<SecretRow>("SELECT * FROM secrets WHERE key = $1", [key]);
    if (!row) return undefined;
    await this.audit("get", key, actor, tenant);
    const decrypted = decryptValueWithMetadata(row.value);
    if (decrypted.needsReencryption) {
      // Compare-and-swap avoids overwriting a concurrent set. Do not change
      // updated_at: the secret material did not change during key repair.
      await this.db.execute(
        "UPDATE secrets SET value = $1 WHERE key = $2 AND value = $3",
        [encryptValue(decrypted.value), key, row.value],
      );
    }
    return {
      key: row.key,
      value: decrypted.value,
      type: row.type,
      ...(row.label ? { label: row.label } : {}),
      ...(row.expires_at ? { expires_at: row.expires_at } : {}),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async deleteSecret(key: string, actor: string, tenantId: string): Promise<boolean> {
    const tenant = requireTenantId(tenantId);
    const rows = await this.db.many<{ key: string }>(
      "DELETE FROM secrets WHERE key = $1 RETURNING key",
      [key],
    );
    if (rows.length === 0) return false;
    await this.audit("delete", key, actor, tenant);
    return true;
  }

  async listSecretMetadata(namespace?: string): Promise<SecretMetadata[]> {
    if (!namespace) {
      const rows = await this.db.many<SecretRow>(
        "SELECT key, type, label, expires_at, created_at, updated_at FROM secrets ORDER BY key",
      );
      return rows.map(secretMeta);
    }
    const prefix = namespace.endsWith("/") ? namespace : `${namespace}/`;
    const rows = await this.db.many<SecretRow>(
      "SELECT key, type, label, expires_at, created_at, updated_at FROM secrets WHERE key LIKE $1 OR key = $2 ORDER BY key",
      [`${prefix}%`, namespace],
    );
    return rows.map(secretMeta);
  }

  async searchSecretMetadata(query: string): Promise<SecretMetadata[]> {
    const q = `%${query}%`;
    const rows = await this.db.many<SecretRow>(
      "SELECT key, type, label, expires_at, created_at, updated_at FROM secrets WHERE key ILIKE $1 OR label ILIKE $1 OR type ILIKE $1 ORDER BY key",
      [q],
    );
    return rows.map(secretMeta);
  }

  // ---- vault items ----
  async setVaultItem(input: VaultItemInput, actor: string, tenantId: string): Promise<VaultItem> {
    const tenant = requireTenantId(tenantId);
    if (!VAULT_ITEM_KINDS.includes(input.kind)) {
      throw new Error(`Invalid vault item kind "${input.kind}"`);
    }
    const title = input.title.trim();
    if (!title) throw new Error("Vault item title is required");
    const id = input.id?.trim() || randomUUID();
    const now = new Date().toISOString();
    const existing = await this.db.get<{ created_at: string }>(
      "SELECT created_at FROM vault_items WHERE id = $1",
      [id],
    );
    const data = encryptValue(JSON.stringify(input.data ?? {}));
    await this.db.execute(
      `INSERT INTO vault_items (id, kind, title, subtitle, domains, tags, favorite, data, created_at, updated_at, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind, title = excluded.title, subtitle = excluded.subtitle,
         domains = excluded.domains, tags = excluded.tags, favorite = excluded.favorite,
         data = excluded.data, updated_at = excluded.updated_at,
         tenant_id = excluded.tenant_id`,
      [
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
        tenant,
      ],
    );
    await this.audit("set", `vault-item/${id}`, actor, tenant);
    return (await this.getVaultItem(id, actor, tenant))!;
  }

  async getVaultItem(id: string, actor: string, tenantId: string): Promise<VaultItem | undefined> {
    const tenant = requireTenantId(tenantId);
    const row = await this.db.get<VaultRow>("SELECT * FROM vault_items WHERE id = $1", [id]);
    if (!row || !row.data) return undefined;
    await this.audit("get", `vault-item/${id}`, actor, tenant);
    const decrypted = decryptValueWithMetadata(row.data);
    if (decrypted.needsReencryption) {
      await this.db.execute(
        "UPDATE vault_items SET data = $1 WHERE id = $2 AND data = $3",
        [encryptValue(decrypted.value), id, row.data],
      );
    }
    const payload = JSON.parse(decrypted.value) as VaultItemPayload;
    return { ...vaultMeta(row), data: payload };
  }

  async deleteVaultItem(id: string, actor: string, tenantId: string): Promise<boolean> {
    const tenant = requireTenantId(tenantId);
    const rows = await this.db.many<{ id: string }>(
      "DELETE FROM vault_items WHERE id = $1 RETURNING id",
      [id],
    );
    if (rows.length === 0) return false;
    await this.audit("delete", `vault-item/${id}`, actor, tenant);
    return true;
  }

  async listVaultItemMetadata(kind?: VaultItemKind): Promise<VaultItemMetadata[]> {
    const cols = "id, kind, title, subtitle, domains, tags, favorite, created_at, updated_at";
    const rows = kind
      ? await this.db.many<VaultRow>(
          `SELECT ${cols} FROM vault_items WHERE kind = $1 ORDER BY favorite DESC, title`,
          [kind],
        )
      : await this.db.many<VaultRow>(
          `SELECT ${cols} FROM vault_items ORDER BY favorite DESC, title`,
        );
    return rows.map(vaultMeta);
  }

  async searchVaultItemMetadata(query: string): Promise<VaultItemMetadata[]> {
    const cols = "id, kind, title, subtitle, domains, tags, favorite, created_at, updated_at";
    const q = `%${query}%`;
    const rows = await this.db.many<VaultRow>(
      `SELECT ${cols} FROM vault_items
       WHERE title ILIKE $1 OR subtitle ILIKE $1 OR kind ILIKE $1 OR domains ILIKE $1 OR tags ILIKE $1
       ORDER BY favorite DESC, title`,
      [q],
    );
    return rows.map(vaultMeta);
  }

  // ---- users ----
  async registerUser(
    id: string,
    name: string,
    type: "human" | "agent" = "human",
    tenantId: string,
  ): Promise<CloudUser> {
    const tenant = requireTenantId(tenantId);
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO users (id, name, type, registered_at, last_seen, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, type = excluded.type, last_seen = excluded.last_seen,
         tenant_id = excluded.tenant_id`,
      [id, name, type, now, now, tenant],
    );
    return (await this.db.get<CloudUser>("SELECT * FROM users WHERE id = $1", [id]))!;
  }

  async listUsers(type?: "human" | "agent"): Promise<CloudUser[]> {
    if (type) {
      return this.db.many<CloudUser>("SELECT * FROM users WHERE type = $1 ORDER BY name", [type]);
    }
    return this.db.many<CloudUser>("SELECT * FROM users ORDER BY type, name");
  }

  async deleteUser(id: string): Promise<boolean> {
    const rows = await this.db.many<{ id: string }>("DELETE FROM users WHERE id = $1 RETURNING id", [id]);
    return rows.length > 0;
  }

  // ---- audit ----
  async getAuditLog(key: string | undefined, limit = 50): Promise<Array<{ id: number; action: string; key: string; agent: string; timestamp: string }>> {
    if (key) {
      return this.db.many("SELECT * FROM audit_log WHERE key = $1 ORDER BY timestamp DESC LIMIT $2", [key, limit]);
    }
    return this.db.many("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT $1", [limit]);
  }

  // ---- feedback ----
  async addFeedback(
    message: string,
    email: string | undefined,
    category: string,
    version: string,
    tenantId: string,
  ): Promise<void> {
    const tenant = requireTenantId(tenantId);
    await this.db.execute(
      "INSERT INTO feedback (id, message, email, category, version, created_at, tenant_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [randomUUID(), message, email ?? null, category, version, new Date().toISOString(), tenant],
    );
  }
}
