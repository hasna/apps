/** Public attachment metadata. Historical storage labels are data, not client selectors. */
export interface Attachment {
  id: string;
  filename: string;
  s3Key: string;
  bucket: string;
  size: number;
  contentType: string;
  link: string | null;
  tag: string | null;
  expiresAt: number | null;
  createdAt: number;
  storageBackend?: "local" | "s3";
  status?: "ready" | "pending";
  encryptionAlgorithm?: string | null;
  encryptionSalt?: string | null;
  encryptionIv?: string | null;
  encryptionTag?: string | null;
  downloads?: number;
}

export interface UploadOptions {
  expiry?: string;
  tag?: string;
  linkType?: "presigned" | "server";
  password?: string;
  encrypt?: boolean;
  maxDownloads?: number;
  requireEmail?: boolean;
  allowedEmails?: string[] | null;
  baseUrl?: string;
}

export interface DownloadResult {
  path: string;
  filename: string;
  size: number;
}
