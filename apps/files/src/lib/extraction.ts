import { closeSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getLatestFileVersion } from "../db/file-versions.js";
import { buildOpenFilesFileRef, buildOpenFilesFileRevisionRef } from "./source-ref.js";
import { resolveFileObject } from "./file-object.js";
import { createS3ClientConfig } from "./s3.js";
import type { ExtractedTextResult, ExtractedTextSegment, FileWithTags } from "../types/index.js";

const EXTRACTOR_NAME = "open-files-text-v1";
const DEFAULT_MAX_BYTES = 1024 * 1024;
const JSON_MAX_BYTES = 512 * 1024;
const MAX_BYTES_CEILING = 10 * 1024 * 1024;
const DEFAULT_MAX_SEGMENT_CHARS = 4000;

export interface ExtractTextOptions {
  max_bytes?: number;
  max_segment_chars?: number;
  redactor?: (text: string) => string;
  redact_patterns?: RegExp[];
}

export interface ExtractTextFromBufferInput extends ExtractTextOptions {
  source_ref: string;
  file_id?: string;
  revision_id?: string;
  mime: string;
  bytes: Buffer | Uint8Array;
  total_size?: number;
}

export async function extractTextFromFile(fileId: string, opts: ExtractTextOptions = {}): Promise<ExtractedTextResult> {
  const resolved = resolveFileObject(fileId);
  const revision = getLatestFileVersion(fileId);
  const sourceRef = revision
    ? buildOpenFilesFileRevisionRef(fileId, revision.id)
    : buildOpenFilesFileRef(fileId);
  const maxBytes = normalizeMaxBytes(opts.max_bytes, resolved.file.mime);

  if (!isExtractableTextMime(resolved.file.mime, resolved.file.name)) {
    return baseResult({
      source_ref: sourceRef,
      file: resolved.file,
      revision_id: revision?.id,
      status: "unsupported",
      status_reason: `Unsupported MIME type for text extraction: ${resolved.file.mime}`,
      max_bytes: maxBytes,
      max_segment_chars: normalizeMaxSegmentChars(opts.max_segment_chars),
    });
  }

  const bytes = await readResolvedBytes(resolved, maxBytes);
  return extractTextFromBuffer({
    ...opts,
    source_ref: sourceRef,
    file_id: fileId,
    revision_id: revision?.id,
    mime: resolved.file.mime,
    bytes,
    total_size: resolved.file.size,
  });
}

export function extractTextFromBuffer(input: ExtractTextFromBufferInput): ExtractedTextResult {
  const maxBytes = normalizeMaxBytes(input.max_bytes, input.mime);
  const maxSegmentChars = normalizeMaxSegmentChars(input.max_segment_chars);
  const bytes = Buffer.from(input.bytes).slice(0, maxBytes);
  const supportedMime = isExtractableTextMime(input.mime);

  if (!supportedMime) {
    return {
      source_ref: input.source_ref,
      file_id: input.file_id,
      revision_id: input.revision_id,
      status: "unsupported",
      status_reason: `Unsupported MIME type for text extraction: ${input.mime}`,
      mime: input.mime,
      bytes_read: 0,
      total_size: input.total_size,
      truncated: false,
      redacted: false,
      segments: [],
      metadata: {
        extractor: EXTRACTOR_NAME,
        max_bytes: maxBytes,
        max_segment_chars: maxSegmentChars,
        supported_mime: false,
      },
    };
  }

  const decoded = decodeText(bytes);
  if (decoded.binary) {
    return {
      source_ref: input.source_ref,
      file_id: input.file_id,
      revision_id: input.revision_id,
      status: "unsupported",
      status_reason: "Input appears to contain binary bytes.",
      mime: input.mime,
      encoding: decoded.encoding,
      bytes_read: bytes.length,
      total_size: input.total_size,
      truncated: isTruncated(bytes.length, input.total_size, maxBytes),
      redacted: false,
      segments: [],
      metadata: {
        extractor: EXTRACTOR_NAME,
        max_bytes: maxBytes,
        max_segment_chars: maxSegmentChars,
        supported_mime: true,
      },
    };
  }

  const text = decoded.text;
  if (text.length === 0) {
    return {
      source_ref: input.source_ref,
      file_id: input.file_id,
      revision_id: input.revision_id,
      status: "empty",
      mime: input.mime,
      encoding: decoded.encoding,
      bytes_read: bytes.length,
      total_size: input.total_size,
      truncated: isTruncated(bytes.length, input.total_size, maxBytes),
      redacted: false,
      segments: [],
      metadata: {
        extractor: EXTRACTOR_NAME,
        max_bytes: maxBytes,
        max_segment_chars: maxSegmentChars,
        supported_mime: true,
      },
    };
  }

  const redactor = composeRedactor(input);
  const outputText = redactor(text);
  const segments = segmentText(outputText, maxSegmentChars);

  return {
    source_ref: input.source_ref,
    file_id: input.file_id,
    revision_id: input.revision_id,
    status: isTruncated(bytes.length, input.total_size, maxBytes) ? "too_large" : "ready",
    status_reason: isTruncated(bytes.length, input.total_size, maxBytes)
      ? `Extraction limited to ${maxBytes} bytes.`
      : undefined,
    mime: input.mime,
    encoding: decoded.encoding,
    bytes_read: bytes.length,
    total_size: input.total_size,
    truncated: isTruncated(bytes.length, input.total_size, maxBytes),
    redacted: Boolean(input.redactor || input.redact_patterns?.length),
    segments,
    metadata: {
      extractor: EXTRACTOR_NAME,
      max_bytes: maxBytes,
      max_segment_chars: maxSegmentChars,
      supported_mime: true,
    },
  };
}

export function isExtractableTextMime(mime: string, filename = ""): boolean {
  const normalized = mime.split(";")[0]!.toLowerCase();
  if (normalized.startsWith("text/")) return true;
  if ([
    "application/json",
    "application/ld+json",
    "application/xml",
    "application/xhtml+xml",
    "application/yaml",
    "application/x-yaml",
    "application/toml",
    "application/javascript",
    "application/typescript",
    "application/sql",
    "image/svg+xml",
  ].includes(normalized)) return true;

  return /\.(md|markdown|mdx|txt|csv|tsv|json|jsonl|yaml|yml|toml|xml|html|htm|css|js|jsx|ts|tsx|sql|svg)$/i.test(filename);
}

async function readResolvedBytes(
  resolved: ReturnType<typeof resolveFileObject>,
  maxBytes: number,
): Promise<Buffer> {
  if (resolved.storageSource.type === "local") {
    return readLocalFilePrefix(join(resolved.storageSource.path!, resolved.objectKey), maxBytes);
  }

  if (resolved.storageSource.type === "s3") {
    const client = new S3Client(createS3ClientConfig(resolved.storageSource));
    const response = await client.send(new GetObjectCommand({
      Bucket: resolved.storageSource.bucket!,
      Key: resolved.objectKey,
      Range: `bytes=0-${maxBytes - 1}`,
    }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).slice(0, maxBytes);
  }

  throw new Error(`Unsupported storage provider for extraction: ${resolved.storageSource.type}`);
}

function segmentText(text: string, maxSegmentChars: number): ExtractedTextSegment[] {
  const segments: ExtractedTextSegment[] = [];
  const lines = text.match(/[^\n]*(?:\n|$)/g)?.filter((line) => line.length > 0) ?? [text];
  let charCursor = 0;
  let lineNumber = 1;
  let currentSection: string | undefined;
  let current = "";
  let segmentCharStart = 0;
  let segmentLineStart = 1;
  let segmentSection: string | undefined;

  const flush = (charEnd: number, lineEnd: number) => {
    if (!current) return;
    const textValue = current;
    segments.push({
      index: segments.length,
      text: textValue,
      byte_start: Buffer.byteLength(text.slice(0, segmentCharStart), "utf8"),
      byte_end: Buffer.byteLength(text.slice(0, charEnd), "utf8"),
      char_start: segmentCharStart,
      char_end: charEnd,
      line_start: segmentLineStart,
      line_end: lineEnd,
      section_hint: segmentSection,
    });
    current = "";
  };

  for (const line of lines) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading && current) {
      flush(charCursor, lineNumber - 1);
    }
    if (heading) currentSection = heading[1]?.trim();

    if (!current) {
      segmentCharStart = charCursor;
      segmentLineStart = lineNumber;
      segmentSection = currentSection;
    }

    if (current && current.length + line.length > maxSegmentChars) {
      flush(charCursor, lineNumber - 1);
      segmentCharStart = charCursor;
      segmentLineStart = lineNumber;
      segmentSection = currentSection;
    }

    if (line.length > maxSegmentChars) {
      let offset = 0;
      while (offset < line.length) {
        if (current) flush(charCursor, lineNumber);
        const chunk = line.slice(offset, offset + maxSegmentChars);
        const start = charCursor + offset;
        const end = start + chunk.length;
        segments.push({
          index: segments.length,
          text: chunk,
          byte_start: Buffer.byteLength(text.slice(0, start), "utf8"),
          byte_end: Buffer.byteLength(text.slice(0, end), "utf8"),
          char_start: start,
          char_end: end,
          line_start: lineNumber,
          line_end: lineNumber,
          section_hint: currentSection,
        });
        offset += maxSegmentChars;
      }
    } else {
      current += line;
    }

    charCursor += line.length;
    lineNumber++;
  }
  flush(charCursor, lineNumber - 1);
  return segments;
}

function decodeText(bytes: Buffer): { text: string; encoding: string; binary: boolean } {
  if (bytes.length === 0) return { text: "", encoding: "utf-8", binary: false };
  if (bytes.includes(0) && !hasUtf16Bom(bytes)) {
    return { text: "", encoding: "binary", binary: true };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: bytes.slice(2).toString("utf16le"), encoding: "utf-16le", binary: false };
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: bytes.slice(3).toString("utf8"), encoding: "utf-8-bom", binary: false };
  }
  return { text: bytes.toString("utf8"), encoding: "utf-8", binary: false };
}

function composeRedactor(opts: ExtractTextOptions): (text: string) => string {
  return (text) => {
    let value = opts.redactor ? opts.redactor(text) : text;
    for (const pattern of opts.redact_patterns ?? []) {
      value = value.replace(pattern, "[REDACTED]");
    }
    return value;
  };
}

function baseResult(opts: {
  source_ref: string;
  file: FileWithTags;
  revision_id?: string;
  status: ExtractedTextResult["status"];
  status_reason?: string;
  max_bytes: number;
  max_segment_chars: number;
}): ExtractedTextResult {
  return {
    source_ref: opts.source_ref,
    file_id: opts.file.id,
    revision_id: opts.revision_id,
    status: opts.status,
    status_reason: opts.status_reason,
    mime: opts.file.mime,
    bytes_read: 0,
    total_size: opts.file.size,
    truncated: false,
    redacted: false,
    segments: [],
    metadata: {
      extractor: EXTRACTOR_NAME,
      max_bytes: opts.max_bytes,
      max_segment_chars: opts.max_segment_chars,
      supported_mime: false,
    },
  };
}

function normalizeMaxBytes(value: number | undefined, mime: string): number {
  const fallback = mime.includes("json") ? JSON_MAX_BYTES : DEFAULT_MAX_BYTES;
  if (!Number.isFinite(value ?? fallback)) return fallback;
  return Math.min(MAX_BYTES_CEILING, Math.max(1, Math.floor(value ?? fallback)));
}

function readLocalFilePrefix(path: string, maxBytes: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

function normalizeMaxSegmentChars(value: number | undefined): number {
  return Math.max(256, Math.floor(value ?? DEFAULT_MAX_SEGMENT_CHARS));
}

function isTruncated(bytesRead: number, totalSize: number | undefined, maxBytes: number): boolean {
  return totalSize !== undefined ? totalSize > bytesRead : bytesRead >= maxBytes;
}

function hasUtf16Bom(bytes: Buffer): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xfe;
}
