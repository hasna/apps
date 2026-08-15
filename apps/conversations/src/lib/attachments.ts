import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { assertNoSensitiveContent } from "./content-safety.js";

export const MAX_ATTACHMENTS_PER_MESSAGE = 16;
export const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 128 * 1024 * 1024;

const ATTACHMENT_SCAN_CHUNK_BYTES = 64 * 1024;
const ATTACHMENT_SCAN_CARRY_CHARS = 8192;

const BLOCKED_OPAQUE_ATTACHMENT_EXTENSIONS = new Set([
  "bundle",
  "zip",
  "gz",
  "tgz",
  "tar",
]);

const MIME_TYPES: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  js: "text/javascript",
  ts: "text/typescript",
  py: "text/x-python",
  html: "text/html",
  css: "text/css",
  xml: "application/xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  pdf: "application/pdf",
  csv: "text/csv",
  yaml: "text/yaml",
  yml: "text/yaml",
};

export interface AttachmentSource {
  name: string;
  source_path: string;
}

export interface PreparedAttachmentSource {
  safeSource: string;
  safeName: string;
  size: number;
  mimeType: string;
}

export interface AttachmentUpload {
  name: string;
  content_base64: string;
}

export interface DecodedAttachmentUpload {
  name: string;
  size: number;
  mimeType: string;
  content: Buffer;
}

export function attachmentMimeType(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (BLOCKED_OPAQUE_ATTACHMENT_EXTENSIONS.has(extension)) {
    throw new Error(
      `Archive and compressed attachment types are not supported securely: ${name}. Extract and attach safe files instead.`,
    );
  }
  const mimeType = MIME_TYPES[extension];
  if (!mimeType) {
    throw new Error(
      `Unsupported attachment type for ${name}. Supported extensions: ${Object.keys(MIME_TYPES).sort().join(", ")}.`,
    );
  }
  return mimeType;
}

function safeAttachmentName(name: string): string {
  const safeName = basename(name.replace(/\0/g, ""));
  if (!safeName || safeName.startsWith(".") || safeName !== name) {
    throw new Error(`Invalid attachment name: ${name}`);
  }
  attachmentMimeType(safeName);
  return safeName;
}

function assertAttachmentBufferSafe(content: Buffer): void {
  let carry = "";
  for (let offset = 0; offset < content.length; offset += ATTACHMENT_SCAN_CHUNK_BYTES) {
    const text = carry + content.subarray(offset, offset + ATTACHMENT_SCAN_CHUNK_BYTES).toString("utf8");
    assertNoSensitiveContent(text, "Message attachment content");
    carry = text.slice(-ATTACHMENT_SCAN_CARRY_CHARS);
  }
}

function assertAttachmentFileSafe(path: string): void {
  const fd = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(ATTACHMENT_SCAN_CHUNK_BYTES);
  let carry = "";

  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      const text = carry + buffer.subarray(0, bytesRead).toString("utf8");
      assertNoSensitiveContent(text, "Message attachment content");
      carry = text.slice(-ATTACHMENT_SCAN_CARRY_CHARS);
    }
  } finally {
    closeSync(fd);
  }
}

function assertAttachmentPopulation(count: number): void {
  if (count > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error(
      `Too many attachments: ${count}. Maximum is ${MAX_ATTACHMENTS_PER_MESSAGE} per message.`,
    );
  }
}

function assertAttachmentSize(name: string, size: number): void {
  if (size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `Attachment ${name} exceeds maximum size of ${MAX_ATTACHMENT_BYTES} bytes (64 MiB).`,
    );
  }
}

function assertTotalSize(size: number): void {
  if (size > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error(
      `Attachments exceed maximum combined size of ${MAX_TOTAL_ATTACHMENT_BYTES} bytes (128 MiB).`,
    );
  }
}

export function prepareAttachmentSources(
  attachments: AttachmentSource[] | undefined,
): PreparedAttachmentSource[] {
  if (!attachments?.length) return [];
  assertAttachmentPopulation(attachments.length);

  const names = new Set<string>();
  let totalSize = 0;
  const prepared = attachments.map((attachment) => {
    assertNoSensitiveContent(attachment.name, "Message attachment name");
    assertNoSensitiveContent(attachment.source_path, "Message attachment path");

    const safeName = safeAttachmentName(attachment.name);
    if (names.has(safeName)) {
      throw new Error(`Duplicate attachment name: ${safeName}`);
    }
    names.add(safeName);

    const absolute = resolve(attachment.source_path);
    if (!existsSync(absolute)) {
      throw new Error(`Attachment source not found: ${attachment.source_path}`);
    }
    const safeSource = realpathSync(absolute);
    const stat = statSync(safeSource);
    if (!stat.isFile()) {
      throw new Error(`Attachment source must be a regular file: ${attachment.source_path}`);
    }
    assertAttachmentSize(safeName, stat.size);
    totalSize += stat.size;
    assertTotalSize(totalSize);
    assertAttachmentFileSafe(safeSource);

    return {
      safeSource,
      safeName,
      size: stat.size,
      mimeType: attachmentMimeType(safeName),
    };
  });

  return prepared;
}

export function encodeAttachmentUploads(
  prepared: PreparedAttachmentSource[],
): AttachmentUpload[] {
  return prepared.map((attachment) => {
    const content = readFileSync(attachment.safeSource);
    if (content.length !== attachment.size) {
      throw new Error(`Attachment changed while being prepared: ${attachment.safeName}`);
    }
    // Validate the exact bytes that will cross the wire. The source may have
    // changed after the earlier file preflight without changing its length.
    assertAttachmentBufferSafe(content);
    return {
      name: attachment.safeName,
      content_base64: content.toString("base64"),
    };
  });
}

function decodeBase64(value: unknown, name: string): Buffer {
  if (typeof value !== "string") {
    throw new Error(`Attachment ${name} content_base64 must be a string.`);
  }
  if (value !== "" && (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))) {
    throw new Error(`Attachment ${name} content_base64 is invalid.`);
  }
  const content = Buffer.from(value, "base64");
  if (content.toString("base64") !== value) {
    throw new Error(`Attachment ${name} content_base64 is invalid.`);
  }
  return content;
}

export function decodeAttachmentUploads(value: unknown): DecodedAttachmentUpload[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("attachments must be an array.");
  }
  assertAttachmentPopulation(value.length);

  const names = new Set<string>();
  let totalSize = 0;
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Each attachment must be an object.");
    }
    const attachment = raw as Record<string, unknown>;
    if (typeof attachment.name !== "string") {
      throw new Error("Attachment name must be a string.");
    }
    assertNoSensitiveContent(attachment.name, "Message attachment name");
    const name = safeAttachmentName(attachment.name);
    if (names.has(name)) {
      throw new Error(`Duplicate attachment name: ${name}`);
    }
    names.add(name);

    const content = decodeBase64(attachment.content_base64, name);
    assertAttachmentSize(name, content.length);
    totalSize += content.length;
    assertTotalSize(totalSize);
    assertAttachmentBufferSafe(content);

    return {
      name,
      size: content.length,
      mimeType: attachmentMimeType(name),
      content,
    };
  });
}
