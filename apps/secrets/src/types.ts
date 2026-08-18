export type SecretType = "api_key" | "password" | "token" | "credential" | "other";
export type VaultItemKind =
  | "login"
  | "address"
  | "identity"
  | "payment_card"
  | "secure_note"
  | "api_key"
  | "custom";

export interface SecretEntry {
  key: string;
  value: string;
  type: SecretType;
  label?: string;
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

export type SecretMetadata = Omit<SecretEntry, "value">;

export type VaultItemPayload = Record<string, unknown>;

export interface VaultItem {
  id: string;
  kind: VaultItemKind;
  title: string;
  subtitle?: string;
  domains: string[];
  tags: string[];
  favorite: boolean;
  data: VaultItemPayload;
  created_at: string;
  updated_at: string;
}

export type VaultItemMetadata = Omit<VaultItem, "data">;

export interface VaultItemInput {
  id?: string;
  kind: VaultItemKind;
  title: string;
  subtitle?: string;
  domains?: string[];
  tags?: string[];
  favorite?: boolean;
  data: VaultItemPayload;
}

export interface AuditEntry {
  id: number;
  action: "get" | "set" | "delete" | "restore";
  key: string;
  agent: string;
  timestamp: string;
}

// ── secret versioning ─────────────────────────────────────────────────────────
//
// Append-only, server-owned value history. Every row holds the value in the same
// protected encrypted envelope as the current vault (never returned by any
// history surface), plus a keyed fingerprint and metadata only. See the
// versioning design study for the full contract.

export type VersionChangeKind = "initial" | "set" | "rotation" | "import" | "restore" | "migration";

/** Keep at most this many total versions per key, including the current one. */
export const MAX_VERSIONS_PER_KEY = 20;
/** Superseded (non-current) versions older than this many days are pruned. */
export const SUPERSEDED_VERSION_AGE_DAYS = 180;

export interface SecretVersionMeta {
  version: number;
  change_kind: VersionChangeKind;
  reason?: string;
  label?: string;
  created_at: string;
  created_by: string;
  source_version?: number;
  batch_id?: string;
  provider_expires_at?: string;
  value_length: number;
  /** Short keyed fingerprint (16 hex chars) for metadata-only comparison. */
  fingerprint: string;
  /** True when this version is the one currently served by get/exec. */
  current: boolean;
}

/** `versions --version N --check` evidence: length + full sha256 of the value. */
export interface SecretVersionCheck extends SecretVersionMeta {
  /** sha256 of the decrypted value — the same evidence class as `get --check`. */
  hash: string;
}

/**
 * Options carried by a value-writing operation into the version row it creates.
 *
 * `reason` and `label` are untrusted free-text metadata (spec §2.7.6): they are
 * length-bounded and scanner-checked at the store write boundary — never stored
 * verbatim without passing `assertMetadataSafe`, and never used to carry value
 * material. Credential-shaped content is refused with a typed error.
 */
export interface SetSecretOptions {
  /** Operator reason; required for rotation and restore, optional elsewhere. */
  reason?: string;
  /** Explicit change kind; defaults to `set` (or `initial` for a new key). */
  changeKind?: VersionChangeKind;
  /** Groups a bulk operation (e.g. import-env --push) for audit. */
  batchId?: string;
}

export type SetSecretResult = SecretEntry & {
  /** Version created (or already current) by this write. */
  version?: number;
  /** True when the value did not change and no new version was created. */
  unchanged?: boolean;
};

export interface RestoreVersionOptions {
  /** Required. Recorded on the new version row. */
  reason: string;
  /**
   * Required. The current version the caller believes is served. The restore is
   * refused with a conflict when it differs — the CAS that makes a restore
   * concurrency-safe (spec §2.2/§2.7.8). The CLI always submits it (explicit
   * `--expect-current`, or fetch-then-submit interactively), so requiring it
   * here breaks no sanctioned path.
   */
  expectCurrent: number;
}

export interface PruneVersionsResult {
  /** Number of version rows deleted by the retention sweep. */
  versions: number;
}

export interface User {
  id: string;
  name: string;
  type: "human" | "agent";
  registered_at: string;
  last_seen?: string;
}

export interface SecretExportBundle {
  version: number;
  redacted: boolean;
  secrets: Record<string, SecretEntry>;
}

export interface StoreCounts {
  secrets: number;
  byType: Record<SecretType, number>;
  withLabels: number;
  expired: number;
  expiringSoon: number;
  users: number;
  usersByType: Record<"human" | "agent", number>;
  auditEntries: number;
}

export interface StoreDescriptor {
  /** `local` uses the on-box sqlite vault; `api` routes to the hosted HTTP API. */
  kind: "local" | "api";
  /** Human-safe location: the vault file path (local) or the API origin (api). Never a key. */
  location: string;
}

export interface EncryptVaultResult {
  migrated: number;
  alreadyEncrypted: number;
}

export type AwsCredentialMode = "static" | "default" | "profile" | "role";

export interface AwsConfig {
  access_key_id?: string;
  secret_access_key?: string;
  session_token?: string;
  region?: string;
  prefix?: string;
  credential_mode?: AwsCredentialMode;
  profile?: string;
  role_arn?: string;
  source_profile?: string;
  external_id?: string;
  session_name?: string;
}
