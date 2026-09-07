import { homedir } from "node:os";
import { join } from "node:path";
import { isSelfHostedMode, selfHostedStoreFor } from "../db/self-hosted-store.js";
import type { AttachmentDetail } from "./attachment-actions.js";
import { resolveMailDataSource } from "./mail-data-source.js";
import { MAX_ATTACHMENT_DOWNLOAD_BYTES, writeAttachmentFile, type SavedAttachment } from "./attachment-download.js";

/** An authenticated API resource link, never a credential-bearing share URL. */
export function attachmentLink(messageId: string, attachment: AttachmentDetail): { url: string; requiresAuthentication: boolean } | null {
  if (isSelfHostedMode()) {
    if (attachment.index === undefined) return null;
    const url = new URL(selfHostedStoreFor("messages").baseUrl);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error("Attachment links require an HTTP API");
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/messages/${encodeURIComponent(messageId)}/attachments/${attachment.index}`;
    return { url: url.href, requiresAuthentication: true };
  }
  if (attachment.file_url) return { url: attachment.file_url, requiresAuthentication: false };
  if (attachment.location_type === "s3" && attachment.location) return { url: attachment.location, requiresAuthentication: true };
  return null;
}

export async function downloadTuiAttachment(messageId: string, index: number): Promise<SavedAttachment> {
  const content = await resolveMailDataSource().getAttachmentContent(messageId, index, { maxBytes: MAX_ATTACHMENT_DOWNLOAD_BYTES });
  if (content.state === "not_found") throw new Error("This attachment could not be found. Refresh the message and try again.");
  if (content.state === "content_unavailable") throw new Error("This attachment has no stored content to download.");
  return writeAttachmentFile(content, join(homedir(), "Downloads"));
}
