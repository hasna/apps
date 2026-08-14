export interface ShareOptions {
  expiry?: string;             // e.g. '7d', '24h'
  linkType?: "presigned" | "server";
}

export interface SharedDocument {
  attachmentId: string;
  shareLink: string;
  expiresAt: string | null;
}

let _attachments: typeof import("@hasna/attachments") | null = null;

async function getAttachments(): Promise<typeof import("@hasna/attachments")> {
  if (_attachments) return _attachments;
  try {
    _attachments = await import("@hasna/attachments");
    return _attachments;
  } catch {
    throw new Error(
      "@hasna/attachments is not installed. Run: bun install @hasna/attachments"
    );
  }
}

/**
 * Returns true if the @hasna/attachments package is configured (S3 bucket set).
 */
export function isAttachmentsConfigured(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@hasna/attachments") as typeof import("@hasna/attachments");
    const cfg = mod.getConfig();
    return !!(
      cfg.s3.bucket &&
      cfg.s3.region &&
      cfg.s3.accessKeyId &&
      cfg.s3.secretAccessKey
    );
  } catch {
    return false;
  }
}

/**
 * Upload a PDF document to attachments and get a shareable link.
 */
export async function shareDocument(
  filePath: string,
  _fileName: string,
  options?: ShareOptions
): Promise<SharedDocument> {
  const mod = await getAttachments();

  const attachment = await mod.uploadFile(filePath, {
    expiry: options?.expiry ?? "7d",
    linkType: options?.linkType,
    tag: "signatures",
  });

  let expiresAt: string | null = null;
  if (attachment.expiresAt !== null && attachment.expiresAt !== undefined) {
    expiresAt = new Date(attachment.expiresAt).toISOString();
  }

  return {
    attachmentId: attachment.id,
    shareLink: attachment.link ?? "",
    expiresAt,
  };
}

/**
 * Download a document from an attachment ID to local path.
 */
export async function receiveDocument(
  attachmentId: string,
  outputPath: string
): Promise<void> {
  const mod = await getAttachments();
  await mod.downloadAttachment(attachmentId, outputPath);
}
