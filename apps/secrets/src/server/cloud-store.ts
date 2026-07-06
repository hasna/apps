/**
 * Postgres-backed secrets store for the deployed serve (PURE REMOTE, A1).
 *
 * Mirrors the local SQLite `store.ts` surface (secrets + structured vault items
 * + users + audit + feedback) but every read/write hits the cloud Postgres
 * directly via the vendored storage kit's TypedQueryClient. Secret and vault
 * payload values are encrypted at rest with the app-layer master key.
 */

import { randomUUID } from "node:crypto";
import type { TypedQueryClient } from "../generated/storage-kit/index.js";
import { assertValidSecretPath } from "../hasna-xyz-paths.js";
import { decryptValue, encryptValue } from "./cloud-crypto.js";
import type {
  SecretEntry,
  SecretMetadata,
  SecretType,
  VaultItem,
  VaultItemInput,
  VaultItemKind,
  VaultItemMetadata,
  VaultItemPayload,
} from "../types.js";

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

  private async audit(action: "get" | "set" | "delete", key: string, actor: string): Promise<void> {
    await this.db.execute(
      "INSERT INTO audit_log (action, key, agent, timestamp) VALUES ($1, $2, $3, $4)",
      [action, key, actor, new Date().toISOString()],
    );
  }

  // ---- secrets ----
  async setSecret(
    key: string,
    value: string,
    type: SecretType = "other",
    label: string | undefined,
    expiresAt: string | undefined,
    actor: string,
  ): Promise<SecretEntry> {
    assertValidSecretPath(key);
    const now = new Date().toISOString();
    const existing = await this.db.get<{ created_at: string }>(
      "SELECT created_at FROM secrets WHERE key = $1",
      [key],
    );
    await this.db.execute(
      `INSERT INTO secrets (key, value, type, label, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value, type = excluded.type, label = excluded.label,
         expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
      [key, encryptValue(value), type, label ?? null, expiresAt ?? null, existing?.created_at ?? now, now],
    );
    await this.audit("set", key, actor);
    return (await this.getSecret(key, actor))!;
  }

  async getSecret(key: string, actor: string): Promise<SecretEntry | undefined> {
    const row = await this.db.get<SecretRow>("SELECT * FROM secrets WHERE key = $1", [key]);
    if (!row) return undefined;
    await this.audit("get", key, actor);
    return {
      key: row.key,
      value: decryptValue(row.value),
      type: row.type,
      ...(row.label ? { label: row.label } : {}),
      ...(row.expires_at ? { expires_at: row.expires_at } : {}),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async deleteSecret(key: string, actor: string): Promise<boolean> {
    const rows = await this.db.many<{ key: string }>(
      "DELETE FROM secrets WHERE key = $1 RETURNING key",
      [key],
    );
    if (rows.length === 0) return false;
    await this.audit("delete", key, actor);
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
  async setVaultItem(input: VaultItemInput, actor: string): Promise<VaultItem> {
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
      `INSERT INTO vault_items (id, kind, title, subtitle, domains, tags, favorite, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind, title = excluded.title, subtitle = excluded.subtitle,
         domains = excluded.domains, tags = excluded.tags, favorite = excluded.favorite,
         data = excluded.data, updated_at = excluded.updated_at`,
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
      ],
    );
    await this.audit("set", `vault-item/${id}`, actor);
    return (await this.getVaultItem(id, actor))!;
  }

  async getVaultItem(id: string, actor: string): Promise<VaultItem | undefined> {
    const row = await this.db.get<VaultRow>("SELECT * FROM vault_items WHERE id = $1", [id]);
    if (!row || !row.data) return undefined;
    await this.audit("get", `vault-item/${id}`, actor);
    const payload = JSON.parse(decryptValue(row.data)) as VaultItemPayload;
    return { ...vaultMeta(row), data: payload };
  }

  async deleteVaultItem(id: string, actor: string): Promise<boolean> {
    const rows = await this.db.many<{ id: string }>(
      "DELETE FROM vault_items WHERE id = $1 RETURNING id",
      [id],
    );
    if (rows.length === 0) return false;
    await this.audit("delete", `vault-item/${id}`, actor);
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
  async registerUser(id: string, name: string, type: "human" | "agent" = "human"): Promise<CloudUser> {
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO users (id, name, type, registered_at, last_seen)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, last_seen = excluded.last_seen`,
      [id, name, type, now, now],
    );
    return (await this.db.get<CloudUser>("SELECT * FROM users WHERE id = $1", [id]))!;
  }

  async listUsers(type?: "human" | "agent"): Promise<CloudUser[]> {
    if (type) {
      return this.db.many<CloudUser>("SELECT * FROM users WHERE type = $1 ORDER BY name", [type]);
    }
    return this.db.many<CloudUser>("SELECT * FROM users ORDER BY type, name");
  }

  // ---- audit ----
  async getAuditLog(key: string | undefined, limit = 50): Promise<Array<{ id: number; action: string; key: string; agent: string; timestamp: string }>> {
    if (key) {
      return this.db.many("SELECT * FROM audit_log WHERE key = $1 ORDER BY timestamp DESC LIMIT $2", [key, limit]);
    }
    return this.db.many("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT $1", [limit]);
  }

  // ---- feedback ----
  async addFeedback(message: string, email: string | undefined, category: string, version: string): Promise<void> {
    await this.db.execute(
      "INSERT INTO feedback (id, message, email, category, version, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [randomUUID(), message, email ?? null, category, version, new Date().toISOString()],
    );
  }
}
