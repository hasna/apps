/**
 * Canonical authenticated HTTPS /v1 SDK. The unauthenticated legacy /api
 * client is retired.
 *
 * The generated `AttachmentsApiClient` stays the zero-argument surface here;
 * `resolveAttachmentsSdkTransport` / `createAttachmentsApiClient` add the
 * shared credential chain (per-request, fresh) for callers that want the
 * fleet resolver without writing a private copy. The generated file is kept
 * byte-identical to the standalone @hasna/attachments-sdk package.
 */
export * from "./generated.js";
export {
  createAttachmentsApiClient,
  resolveAttachmentsSdkTransport,
} from "./resolve.js";
export type {
  AttachmentsSdkTransport,
  ResolveAttachmentsSdkTransportOptions,
} from "./resolve.js";