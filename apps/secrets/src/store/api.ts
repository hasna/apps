// ApiStore — the self_hosted/cloud transport.
//
// Every read and write routes to the app's cloud HTTP API at `<API_URL>/v1` with
// the bearer key, via the vendored @hasna/contracts storage client. `self_hosted`
// and `cloud` are identical here; only the URL/key differ (server-side tenancy).
//
// SAFETY: values are sent as plaintext over TLS to the API, which encrypts them
// server-side with the cloud master key — the local master key is never used in
// api mode. The API key lives only inside the transport and is never logged,
// returned, or embedded in any value produced here.

import type { HasnaStorageClient } from "./contracts-client/index.js";
import { assertValidSecretPath } from "../hasna-xyz-paths.js";
import { computeCounts, matchVaultItemsForUrl } from "./local.js";

const VAULT_ITEM_KINDS: VaultItemKind[] = [
  "login",
  "address",
  "identity",
  "payment_card",
  "secure_note",
  "api_key",
  "custom",
];
import type {
  AuditEntry,
  EncryptVaultResult,
  SecretEntry,
  SecretExportBundle,
  SecretMetadata,
  SecretType,
  StoreCounts,
  StoreDescriptor,
  User,
  VaultItem,
  VaultItemInput,
  VaultItemKind,
  VaultItemMetadata,
} from "../types.js";
import type { Store } from "./types.js";

type Transport = HasnaStorageClient["transport"];

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { status?: number }).status === 404;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: number }).status;
    if (status) return `server error ${status}`;
  }
  return String(error);
}

export class ApiStore implements Store {
  readonly mode = "api" as const;
  private readonly client: HasnaStorageClient;
  private readonly transport: Transport;

  constructor(client: HasnaStorageClient) {
    this.client = client;
    this.transport = client.transport;
  }

  // ── secrets ────────────────────────────────────────────────────────────
  async setSecret(key: string, value: string, type: SecretType = "other", label?: string, expiresAt?: string): Promise<SecretEntry> {
    assertValidSecretPath(key);
    // The Store contract's 5th arg is an absolute ISO expiry (parseTtl already resolved any --ttl duration).
    // Send it as `expires_at`; forwarding it as `ttl` makes the server try to parse an ISO string as a duration -> 500.
    await this.transport.post("/secrets", { key, value, type, ...(label ? { label } : {}), ...(expiresAt ? { expires_at: expiresAt } : {}) });
    // POST returns metadata only; fetch the full entry to match the Store contract.
    const entry = await this.getSecret(key);
    if (entry) return entry;
    const now = new Date().toISOString();
    return { key, value, type, ...(label ? { label } : {}), created_at: now, updated_at: now };
  }

  async getSecret(key: string): Promise<SecretEntry | undefined> {
    try {
      return await this.transport.get<SecretEntry>("/secrets/get", { query: { key } });
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async deleteSecret(key: string): Promise<boolean> {
    try {
      const res = await this.transport.del<{ deleted?: boolean }>("/secrets", undefined, { query: { key } });
      return Boolean(res?.deleted ?? true);
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async listSecretMetadata(namespace?: string): Promise<SecretMetadata[]> {
    const res = await this.transport.get<{ secrets?: SecretMetadata[] }>("/secrets", { query: namespace ? { namespace } : {} });
    return res.secrets ?? [];
  }

  async listSecrets(namespace?: string): Promise<SecretEntry[]> {
    const meta = await this.listSecretMetadata(namespace);
    return this.fetchValues(meta);
  }

  async searchSecretMetadata(query: string): Promise<SecretMetadata[]> {
    const res = await this.transport.get<{ results?: SecretMetadata[] }>("/secrets/search", { query: { q: query } });
    return res.results ?? [];
  }

  async searchSecrets(query: string): Promise<SecretEntry[]> {
    const meta = await this.searchSecretMetadata(query);
    return this.fetchValues(meta);
  }

  /**
   * Fetch full entries for a list of metadata rows, best-effort. A single secret
   * that the server cannot return (e.g. a value that fails server-side decryption
   * → 500) must not abort a bulk read like `export-env` or `list --values`. Such
   * rows are skipped with a value-free warning; 404s (deleted between calls) are
   * dropped silently. Single-key `getSecret` stays strict.
   */
  private async fetchValues(meta: SecretMetadata[]): Promise<SecretEntry[]> {
    const settled = await Promise.allSettled(meta.map((m) => this.getSecret(m.key)));
    const entries: SecretEntry[] = [];
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]!;
      if (result.status === "fulfilled") {
        if (result.value) entries.push(result.value);
      } else {
        // Never log the value or the key's secret material — key path only.
        console.warn(`⚠ Skipped unreadable secret "${meta[i]!.key}": ${errorMessage(result.reason)}`);
      }
    }
    return entries;
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
    const secrets: Record<string, SecretEntry> = {};
    if (redact) {
      for (const m of await this.listSecretMetadata()) secrets[m.key] = { ...(m as SecretEntry), value: "***REDACTED***" };
      return { version: 2, redacted: true, secrets };
    }
    for (const e of await this.listSecrets()) secrets[e.key] = e;
    return { version: 2, redacted: false, secrets };
  }

  async pruneExpired(): Promise<number> {
    // The server owns TTL/expiry enforcement; there is nothing to prune client-side.
    return 0;
  }

  // ── structured vault items ───────────────────────────────────────────────
  async setVaultItem(input: VaultItemInput): Promise<VaultItem> {
    if (!VAULT_ITEM_KINDS.includes(input.kind)) {
      throw new Error(`Invalid vault item kind "${input.kind}". Valid: ${VAULT_ITEM_KINDS.join(", ")}`);
    }
    if (!input.title.trim()) throw new Error("Vault item title is required");
    return this.transport.post<VaultItem>("/items", {
      kind: input.kind,
      title: input.title,
      data: input.data ?? {},
      ...(input.id ? { id: input.id } : {}),
      ...(input.subtitle ? { subtitle: input.subtitle } : {}),
      ...(input.domains ? { domains: input.domains } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
      ...(input.favorite !== undefined ? { favorite: input.favorite } : {}),
    });
  }

  async getVaultItem(id: string): Promise<VaultItem | undefined> {
    const item = await this.client.get<VaultItem>("items", id);
    return item ?? undefined;
  }

  async deleteVaultItem(id: string): Promise<boolean> {
    try {
      const res = await this.transport.del<{ deleted?: boolean }>(`/items/${encodeURIComponent(id)}`);
      return Boolean(res?.deleted ?? true);
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async listVaultItemMetadata(kind?: VaultItemKind): Promise<VaultItemMetadata[]> {
    const res = await this.transport.get<{ items?: VaultItemMetadata[] }>("/items", { query: kind ? { kind } : {} });
    return res.items ?? [];
  }

  async searchVaultItemMetadata(query: string): Promise<VaultItemMetadata[]> {
    const res = await this.transport.get<{ results?: VaultItemMetadata[] }>("/items/search", { query: { q: query } });
    return res.results ?? [];
  }

  async matchVaultItemsForUrl(rawUrl: string): Promise<VaultItemMetadata[]> {
    return matchVaultItemsForUrl(rawUrl, () => this.listVaultItemMetadata());
  }

  // ── users / agents registry ──────────────────────────────────────────────
  async registerUser(id: string, name: string, type: "human" | "agent" = "human"): Promise<User> {
    return this.transport.post<User>("/users", { id, name, type });
  }

  async listUsers(type?: "human" | "agent"): Promise<User[]> {
    const res = await this.transport.get<{ users?: User[] }>("/users", { query: type ? { type } : {} });
    return res.users ?? [];
  }

  async getUser(id: string): Promise<User | undefined> {
    return (await this.listUsers()).find((u) => u.id === id);
  }

  async deleteUser(id: string): Promise<boolean> {
    try {
      const res = await this.transport.del<{ deleted?: boolean }>(`/users/${encodeURIComponent(id)}`);
      return Boolean(res?.deleted ?? true);
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async touchUser(): Promise<void> {
    // The server records user activity on register; no separate client ping.
  }

  // ── audit ────────────────────────────────────────────────────────────────
  async getAuditLog(key?: string, limit = 100): Promise<AuditEntry[]> {
    const res = await this.transport.get<{ entries?: AuditEntry[] }>("/audit", { query: { ...(key ? { key } : {}), limit } });
    return res.entries ?? [];
  }

  // ── feedback ───────────────────────────────────────────────────────────────
  async sendFeedback(message: string, email?: string, category = "general"): Promise<void> {
    await this.transport.post("/feedback", { message, ...(email ? { email } : {}), category });
  }

  // ── status / maintenance ───────────────────────────────────────────────────
  async status(): Promise<StoreCounts> {
    const [secrets, users, audit] = await Promise.all([
      this.listSecretMetadata(),
      this.listUsers(),
      this.getAuditLog(undefined, 1000),
    ]);
    return computeCounts(
      secrets.map((s) => ({ type: s.type, label: s.label ?? null, expires_at: s.expires_at ?? null })),
      users.map((u) => ({ type: u.type })),
      audit.length,
    );
  }

  describe(): StoreDescriptor {
    // transport.baseUrl is `<origin>/v1`; report the origin only (never the key).
    let location = this.transport.baseUrl;
    try {
      location = new URL(this.transport.baseUrl).origin;
    } catch {
      /* keep the raw base if it is not a parseable URL */
    }
    return { mode: "api", location };
  }

  async encryptVault(): Promise<EncryptVaultResult> {
    throw new Error("encrypt-vault is a local-vault operation; in api mode the server owns encryption at rest.");
  }
}
