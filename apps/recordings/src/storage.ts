// Public `@hasna/recordings/storage` surface.
//
// The storage layer is a single `Store` interface with two transports:
// LocalStore (on-box SQLite) and ApiStore (the server's HTTP `/v1` API + bearer
// key). There is NO client-side database DSN and NO client-side PostgresStore —
// the shared dataset is reached only through the authenticated API.
//
// The on-box file is reachable ONLY through the deliberate unhosted opt-in
// (HASNA_RECORDINGS_LOCAL=1, alias RECORDINGS_LOCAL=1); every other environment
// resolves its credential and authority through the ONE resolver in
// `@hasna/contracts` and fails closed with no credential. The hosted client
// re-resolves the credential on every request.

export { getStore, __resetStore, APP } from "./store.js";
export type { Store, RecordingStats, FeedbackInput } from "./store.js";

export {
  RECORDINGS_LOCAL_OPT_IN_ENV_KEYS,
  isRecordingsLocalOptIn,
  resolveRecordingsCloudClient,
  resolveRecordingsTransport,
  getRecordingsTransportStatus,
  createHttpTransport,
  createStorageClient,
  toV1BaseUrl,
  HasnaHttpError,
} from "./http/client.js";
export type {
  RecordsClientResolveOptions,
  RecordsCredentialChainOptions,
  RecordsKeychainTierOptions,
  RecordsKeychainCommandResult,
  RecordsKeychainCommandRunner,
  RecordsAuthorityResolution,
  RecordsTransportResolution,
  RecordsTransportStatus,
  RecordsCloudClient,
  StorageClient,
  QueryParams,
  HttpTransport,
} from "./http/client.js";