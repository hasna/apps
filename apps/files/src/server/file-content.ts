import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Worker } from "node:worker_threads";
import {
  normalizeExtractMaxBytes,
  normalizeExtractMaxSegmentChars,
} from "../lib/extraction.js";
import { isMissingS3ObjectError } from "../s3.js";
import type { ExtractedTextResult } from "../types/index.js";

const HOSTED_EXTRACTION_TIMEOUT_MS = 2_000;

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

/** Server-side cap for the hosted content route's max_bytes query parameter.
 *  A client may request fewer bytes than this, never more: the cap keeps a
 *  reachable large object from exhausting server network/process resources. */
export const MAX_CONTENT_READ_BYTES = 10 * 1024 * 1024;

/** Normalize the content route's max_bytes query value. Absent or malformed
 *  values mean "no bound" (backwards-compatible full read); numeric values are
 *  floored and clamped to the server cap. */
export function normalizeContentReadLimit(raw: string | null): number | undefined {
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(Math.floor(value), MAX_CONTENT_READ_BYTES);
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

  const bytes = Buffer.from(await response.arrayBuffer()).subarray(0, maxBytes);
  return runHostedExtraction({
    source_ref: locator.source_ref,
    file_id: locator.file_id,
    revision_id: locator.revision_id,
    mime: locator.mime,
    bytes,
    total_size: locator.size,
    max_bytes: maxBytes,
    max_segment_chars: maxSegmentChars,
    redact_patterns: input.redact_patterns,
  });
}

interface HostedExtractionWorkerInput {
  source_ref: string;
  file_id?: string;
  revision_id?: string;
  mime: string;
  bytes: Buffer;
  total_size?: number;
  max_bytes: number;
  max_segment_chars: number;
  redact_patterns?: string[];
}

interface HostedExtractionWorkerMessage {
  ok: boolean;
  result?: ExtractedTextResult;
  error?: {
    name: string;
    message: string;
  };
}

function runHostedExtraction(input: HostedExtractionWorkerInput): Promise<ExtractedTextResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(hostedExtractionWorkerUrl());
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void worker.terminate();
      action();
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new Error("Hosted extraction timed out.")));
    }, HOSTED_EXTRACTION_TIMEOUT_MS);

    worker.once("message", (message: HostedExtractionWorkerMessage) => {
      if (message.ok && message.result) {
        finish(() => resolve(message.result!));
        return;
      }
      const error = message.error;
      finish(() => reject(error?.name === "SyntaxError"
        ? new SyntaxError(error.message)
        : new Error(error?.message ?? "Hosted extraction failed.")));
    });
    worker.once("error", (error) => {
      finish(() => reject(error));
    });
    worker.once("exit", (code) => {
      finish(() => reject(new Error(`Hosted extraction worker exited without a result (code ${code}).`)));
    });
    try {
      worker.postMessage(input);
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

function hostedExtractionWorkerUrl(): URL {
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  return new URL(`./file-content-worker.${extension}`, import.meta.url);
}

function responseBody(body: unknown): BodyInit {
  const candidate = body as { transformToWebStream?: () => ReadableStream<Uint8Array> };
  if (typeof candidate.transformToWebStream === "function") {
    return candidate.transformToWebStream();
  }
  return body as BodyInit;
}

/**
 * Server-signed S3 download URL for a remote file locator. The server owns the
 * object-store credentials; presigning happens here so the client never
 * touches S3 in api mode. Bounded to 1..3600 seconds, mirroring the local
 * `get_file_url` clamp.
 */
export async function signRemoteFileDownload(
  locator: RemoteFileLocator,
  options: { expires_in_seconds?: number } = {},
): Promise<string> {
  const requested = options.expires_in_seconds;
  const expiresIn = Number.isFinite(requested) ? Math.min(Math.max(Math.floor(requested ?? 3600), 1), 3600) : 3600;
  const client = new S3Client({ region: locator.region ?? "us-east-1" });
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: locator.bucket,
      Key: locator.object_key,
      ...(locator.version_id ? { VersionId: locator.version_id } : {}),
    }),
    { expiresIn },
  );
}
