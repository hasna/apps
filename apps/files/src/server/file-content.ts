import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  extractTextFromBuffer,
  normalizeExtractMaxBytes,
  normalizeExtractMaxSegmentChars,
} from "../lib/extraction.js";
import { isMissingS3ObjectError } from "../s3.js";
import type { ExtractedTextResult } from "../types/index.js";

export interface RemoteFileLocator {
  file_id: string;
  revision_id?: string;
  source_ref: string;
  mime: string;
  size: number;
  bucket: string;
  object_key: string;
  version_id?: string;
  region?: string;
  tenant_id?: string;
}

export interface RemoteObjectReadOptions {
  max_bytes?: number;
}

export type RemoteObjectReader = (
  locator: RemoteFileLocator,
  options?: RemoteObjectReadOptions,
) => Promise<Response | null>;

export const readRemoteObject: RemoteObjectReader = async (locator, options = {}) => {
  const client = new S3Client({ region: locator.region ?? "us-east-1" });
  try {
    const result = await client.send(new GetObjectCommand({
      Bucket: locator.bucket,
      Key: locator.object_key,
      VersionId: locator.version_id,
      ...(options.max_bytes
        ? { Range: `bytes=0-${Math.max(0, options.max_bytes - 1)}` }
        : {}),
    }));
    if (!result.Body) return null;
    return new Response(responseBody(result.Body), {
      headers: {
        "Content-Type": locator.mime || "application/octet-stream",
        ...(result.ContentLength !== undefined
          ? { "Content-Length": String(result.ContentLength) }
          : {}),
      },
    });
  } catch (error) {
    if (isMissingS3ObjectError(error)) return null;
    throw error;
  }
};

export async function extractRemoteFileText(
  locator: RemoteFileLocator,
  reader: RemoteObjectReader,
  input: {
    max_bytes?: number;
    max_segment_chars?: number;
    redact_patterns?: string[];
  } = {},
): Promise<ExtractedTextResult | null> {
  const maxBytes = normalizeExtractMaxBytes(input.max_bytes, locator.mime);
  const maxSegmentChars = normalizeExtractMaxSegmentChars(input.max_segment_chars);
  const response = await reader(locator, { max_bytes: maxBytes });
  if (!response) return null;

  const redactPatterns = (input.redact_patterns ?? []).map((pattern) => new RegExp(pattern, "g"));
  const bytes = Buffer.from(await response.arrayBuffer()).subarray(0, maxBytes);
  return extractTextFromBuffer({
    source_ref: locator.source_ref,
    file_id: locator.file_id,
    revision_id: locator.revision_id,
    mime: locator.mime,
    bytes,
    total_size: locator.size,
    max_bytes: maxBytes,
    max_segment_chars: maxSegmentChars,
    redact_patterns: redactPatterns,
  });
}

function responseBody(body: unknown): BodyInit {
  const candidate = body as { transformToWebStream?: () => ReadableStream<Uint8Array> };
  if (typeof candidate.transformToWebStream === "function") {
    return candidate.transformToWebStream();
  }
  return body as BodyInit;
}
