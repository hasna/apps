// The single secrets Store abstraction.
//
// ONE interface, TWO transports. Every CLI command, MCP tool, and SDK caller
// that reads or writes vault DATA goes through `Store`. There are exactly two
// implementations:
//
//   • LocalStore — the on-box encrypted SQLite vault (~/.hasna/secrets/vault.db).
//   • ApiStore   — the self_hosted/cloud HTTP API at `<API_URL>/v1` with a bearer
//     key. Delegates to the vendored @hasna/contracts storage client.
//
// `getStore()` (./index.ts) resolves which transport to use from the client-flip
// env (HASNA_SECRETS_API_URL + HASNA_SECRETS_API_KEY / HASNA_SECRETS_STORAGE_MODE).
// Callers NEVER branch on mode themselves and NEVER touch sqlite or fetch
// directly — that was the split-brain bug this module eliminates.
//
// `self_hosted` and `cloud` are the SAME client code (ApiStore); only the URL and
// key differ, and that distinction is server-side tenancy. `local` is
// first-class and fully functional.
//
// SAFETY: the API key never leaves the transport; it is never logged, returned,
// or embedded in any value produced by an implementation.

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

export interface Store {
  /** Which transport backs this store. */
  readonly mode: "local" | "api";

  // ── secrets ────────────────────────────────────────────────────────────
  setSecret(key: string, value: string, type?: SecretType, label?: string, expiresAt?: string): Promise<SecretEntry>;
  getSecret(key: string): Promise<SecretEntry | undefined>;
  deleteSecret(key: string): Promise<boolean>;
  listSecrets(namespace?: string): Promise<SecretEntry[]>;
  listSecretMetadata(namespace?: string): Promise<SecretMetadata[]>;
  searchSecrets(query: string): Promise<SecretEntry[]>;
  searchSecretMetadata(query: string): Promise<SecretMetadata[]>;
  importSecrets(entries: Array<{ key: string; value: string; type?: SecretType; label?: string; expires_at?: string }>): Promise<number>;
  exportSecrets(redact?: boolean): Promise<SecretExportBundle>;
  pruneExpired(): Promise<number>;

  // ── structured vault items ───────────────────────────────────────────────
  setVaultItem(input: VaultItemInput): Promise<VaultItem>;
  getVaultItem(id: string): Promise<VaultItem | undefined>;
  deleteVaultItem(id: string): Promise<boolean>;
  listVaultItemMetadata(kind?: VaultItemKind): Promise<VaultItemMetadata[]>;
  searchVaultItemMetadata(query: string): Promise<VaultItemMetadata[]>;
  matchVaultItemsForUrl(rawUrl: string): Promise<VaultItemMetadata[]>;

  // ── users / agents registry ──────────────────────────────────────────────
  registerUser(id: string, name: string, type?: "human" | "agent"): Promise<User>;
  getUser(id: string): Promise<User | undefined>;
  listUsers(type?: "human" | "agent"): Promise<User[]>;
  deleteUser(id: string): Promise<boolean>;
  touchUser(id: string): Promise<void>;

  // ── audit ────────────────────────────────────────────────────────────────
  getAuditLog(key?: string, limit?: number): Promise<AuditEntry[]>;

  // ── feedback ───────────────────────────────────────────────────────────────
  sendFeedback(message: string, email?: string, category?: string): Promise<void>;

  // ── status / maintenance ───────────────────────────────────────────────────
  /** Metadata-only counts for `secrets status`. Never includes secret values. */
  status(): Promise<StoreCounts>;
  /** Describe the transport and its (key-free) location. */
  describe(): StoreDescriptor;
  /**
   * Encrypt any plaintext rows in the local vault. Local-only maintenance; in
   * api mode the server owns encryption, so this throws instead of pretending.
   */
  encryptVault(): Promise<EncryptVaultResult>;
}
