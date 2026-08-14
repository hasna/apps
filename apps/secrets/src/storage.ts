// Public storage surface for @hasna/secrets.
//
// The DSN-on-client Postgres sync ("storage push/pull/sync") has been removed:
// distributing a raw database URL to clients is forbidden. Self-hosting is
// api-mode only — the client talks to `<API_URL>/v1` with a bearer key. This
// subpath now exposes the single Store abstraction so embedders route through
// the same LocalStore/ApiStore the CLI and MCP use.

export { getStore, isApiMode, LocalStore, ApiStore, SecretDecryptionError } from "./store/index.js";
export type { Store } from "./store/types.js";
export type {
  StoreCounts,
  StoreDescriptor,
  EncryptVaultResult,
  SecretExportBundle,
  User,
} from "./types.js";
