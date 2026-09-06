// Canonical public client boundary. No server, configuration secrets, or local CRUD exports.
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