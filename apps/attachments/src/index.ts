// Canonical public client boundary. No server, configuration secrets, or local CRUD exports.
export { ApiStore, resolveStore } from "./core/store.js";
export type { Store, ListOptions, LinkResult, RegenerateLinkOptions, ResolveStoreOptions, UploadOptions, FeedbackInput } from "./core/store.js";
export { resolveAttachmentsV1 } from "./core/cloud-v1.js";
export type { AttachmentsV1Store } from "./core/cloud-v1.js";
export type { Attachment, DownloadResult } from "./core/client-types.js";
