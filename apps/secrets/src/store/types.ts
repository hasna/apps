// The single secrets Store abstraction.
//
// ONE interface, TWO transports. Every CLI command, MCP tool, and SDK caller
// that reads or writes vault DATA goes through `Store`. There are exactly two
// implementations:
//
//   • LocalStore — the on-box encrypted SQLite vault (resolved through
//     @hasna/paths dataDir({app:"secrets"}) with gated legacy adoption —
//     ~/.hasna/secrets/vault.db until the store is migrated to the XDG data
//     home; see src/data-dir.ts).
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
} from "../types.js";

/** Typed not-found for version operations (server maps it to 404). */
export class VersionNotFoundError extends Error {
  readonly status = 404 as const;
  constructor(message: string) {
    super(message);
    this.name = "VersionNotFoundError";
  }
}

/** Expected-current mismatch on restore (server maps it to 409). */
export class VersionConflictError extends Error {
  readonly status = 409 as const;
  constructor(message: string) {
    super(message);
    this.name = "VersionConflictError";
  }
}

/**
 * Untrusted metadata (reason/label) failed the write-boundary policy (server
 * maps it to 400): too long, or scanner-detected credential-shaped content.
 * The message never carries the offending text, so it cannot echo a value.
 */
export class MetadataValidationError extends Error {
  readonly status = 400 as const;
  constructor(message: string) {
    super(message);
    this.name = "MetadataValidationError";
  }
}

export interface Store {
  /** Which transport backs this store. */
  readonly mode: "local" | "api";

  // ── secrets ────────────────────────────────────────────────────────────
  setSecret(key: string, value: string, type?: SecretType, label?: string, expiresAt?: string, opts?: SetSecretOptions): Promise<SetSecretResult>;
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

  // ── secret versioning ──────────────────────────────────────────────────────
  /** Metadata-only version history, newest first. Never returns value material. */
  listVersions(key: string, limit?: number): Promise<SecretVersionMeta[]>;
  /**
   * Version evidence in the same class as `get --check`: length + sha256 of the
   * value. The value itself never leaves the store.
   */
  checkVersion(key: string, version: number): Promise<SecretVersionCheck>;
  /**
   * Append-only restore: the historical value is copied server-side into a new
   * current version; the history is never rewound or deleted.
   */
  restoreVersion(key: string, version: number, opts: RestoreVersionOptions): Promise<SecretVersionMeta>;
  /** Retention sweep: count + age bounds. Never prunes the current version. */
  pruneVersionHistory(): Promise<PruneVersionsResult>;
  /**
   * Idempotent baseline: every existing value becomes version 1
   * (`change_kind=migration`) exactly once. No-op when already backfilled.
   */
  runVersionBackfill(): Promise<number>;

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
