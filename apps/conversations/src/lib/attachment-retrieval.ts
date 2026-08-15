import type { Attachment } from "../types.js";

export type AttachmentRetrievalErrorCode =
  | "MESSAGE_NOT_FOUND"
  | "ATTACHMENT_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "CONTENT_MISSING"
  | "INTEGRITY_MISMATCH"
  | "INVALID_RESPONSE";

export class AttachmentRetrievalError extends Error {
  constructor(
    readonly code: AttachmentRetrievalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AttachmentRetrievalError";
  }
}

export interface RetrievedAttachment {
  message_id: number;
  name: string;
  mime_type: string;
  size: number;
  content: Uint8Array;
}

export function messageNotFoundError(messageId: number): AttachmentRetrievalError {
  return new AttachmentRetrievalError(
    "MESSAGE_NOT_FOUND",
    `Message #${messageId} not found. Check the message id with conversations show ${messageId} --json.`,
  );
}

export function attachmentNotFoundError(
  messageId: number,
  name: string,
): AttachmentRetrievalError {
  return new AttachmentRetrievalError(
    "ATTACHMENT_NOT_FOUND",
    `Attachment "${name}" not found on message #${messageId}. ` +
      `List available names with conversations show ${messageId} --json.`,
  );
}

export function attachmentPermissionError(
  messageId: number,
  name: string,
): AttachmentRetrievalError {
  return new AttachmentRetrievalError(
    "PERMISSION_DENIED",
    `Permission denied while reading attachment "${name}" from message #${messageId}. ` +
      "Check read permissions for the attachment store or the configured Conversations API key scope.",
  );
}

export function attachmentContentMissingError(
  messageId: number,
  name: string,
): AttachmentRetrievalError {
  return new AttachmentRetrievalError(
    "CONTENT_MISSING",
    `Attachment "${name}" is recorded on message #${messageId}, but its bytes are missing. ` +
      "Ask the sender to attach the file again.",
  );
}

export function attachmentIntegrityError(
  messageId: number,
  name: string,
): AttachmentRetrievalError {
  return new AttachmentRetrievalError(
    "INTEGRITY_MISMATCH",
    `Attachment "${name}" on message #${messageId} failed its path or size integrity check. ` +
      "Do not use the downloaded bytes; ask the sender to attach the file again.",
  );
}

function invalidResponseError(
  messageId: number,
  name: string,
): AttachmentRetrievalError {
  return new AttachmentRetrievalError(
    "INVALID_RESPONSE",
    `Attachment response for "${name}" on message #${messageId} was invalid. ` +
      "Retry after upgrading the Conversations server to the same version as the CLI.",
  );
}

export function isPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "EACCES" || code === "EPERM";
}

export function decodeAttachmentResponse(
  value: unknown,
  messageId: number,
  attachment: Attachment,
): RetrievedAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidResponseError(messageId, attachment.name);
  }
  const response = value as Record<string, unknown>;
  if (
    response.name !== attachment.name ||
    response.mime_type !== attachment.mime_type ||
    response.size !== attachment.size ||
    typeof response.content_base64 !== "string"
  ) {
    throw invalidResponseError(messageId, attachment.name);
  }

  const encoded = response.content_base64;
  if (
    encoded !== "" &&
    (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
  ) {
    throw invalidResponseError(messageId, attachment.name);
  }
  const content = Buffer.from(encoded, "base64");
  if (content.toString("base64") !== encoded || content.length !== attachment.size) {
    throw invalidResponseError(messageId, attachment.name);
  }

  return {
    message_id: messageId,
    name: attachment.name,
    mime_type: attachment.mime_type,
    size: attachment.size,
    content,
  };
}
