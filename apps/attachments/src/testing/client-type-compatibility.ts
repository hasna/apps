import type { Attachment, UploadOptions, DownloadResult } from "../core/client-types";
import type { Attachment as PreviousAttachment } from "../core/db";
import type { UploadOptions as PreviousUploadOptions } from "../core/upload";
import type { DownloadResult as PreviousDownloadResult } from "../core/download";

// Compare against the preserved implementation declarations, not aliases to the new DTOs.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type AttachmentCompatibility = Assert<Equal<Attachment, PreviousAttachment>>;
export type UploadCompatibility = Assert<Equal<UploadOptions, PreviousUploadOptions>>;
export type DownloadCompatibility = Assert<Equal<DownloadResult, PreviousDownloadResult>>;
