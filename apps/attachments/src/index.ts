// Canonical public client boundary. The store seam can serve either transport
// (hosted `ApiStore` or on-box `LocalStore`); classes and server internals are
// NOT exported here — callers go through `resolveStore`.
export { ApiStore, resolveStore } from "./core/store.js";
export type { Store, ListOptions, LinkResult, RegenerateLinkOptions, ResolveStoreOptions, UploadOptions, FeedbackInput } from "./core/store.js";
export { resolveAttachmentsV1 } from "./core/cloud-v1.js";
export type { AttachmentsV1Store } from "./core/cloud-v1.js";
export { resolveAttachmentsTransport } from "./core/client-config.js";
export type {
  AttachmentsClientEnvKeys,
  AttachmentsCredentialChainOptions,
  AttachmentsCredentialTier,
  AttachmentsTransportResolution,
  Env,
  KeychainCommandResult,
  ResolveAttachmentsTransportOptions,
} from "./core/client-config.js";
export type { Attachment } from "./core/db.js";
export type { DownloadResult } from "./core/download.js";