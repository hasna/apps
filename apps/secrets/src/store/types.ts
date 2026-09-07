// The single secrets Store abstraction.
//
// Ordinary CLI/MCP/default library access resolves ApiStore through canonical
// saved credentials. Explicit LocalStore construction is a separate compatibility
// handle for library fixtures and migration tooling, never an ambient selector.
// Retired local/database selectors are rejected before ordinary store access.
// Deprecated mode variables remain inert and cannot select SQLite.
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
   * Encrypt any plaintext rows in the ACTIVE vault. Local: encrypts plaintext rows.
   * API: atomically verifies all four tenant payload tables and encrypts legacy
   * plaintext under secrets:migrate; unreadable ciphertext fails closed.
   */
  encryptionStatus?(): Promise<import("../encryption-maintenance.js").EncryptionReceipt>;
  encryptVault(): Promise<EncryptVaultResult>;
}
