// Public storage surface for @hasna/secrets.
//
// getStore always resolves the shared API. LocalStore is retained only as an
// explicitly constructed library compatibility handle; no ordinary client selects
// it through environment variables or missing credentials.

export { getStore, isApiMode, LocalStore, ApiStore, SecretDecryptionError } from "./store/index.js";
export type { Store } from "./store/types.js";
export type {
  StoreCounts,
  StoreDescriptor,
  EncryptVaultResult,
  SecretExportBundle,
  User,
} from "./types.js";
