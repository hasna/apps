import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  type _Object,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { fromIni } from "@aws-sdk/credential-providers";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { createWriteStream, createReadStream, statSync } from "fs";
import { basename, extname } from "path";
import { pipeline } from "stream/promises";
import { lookup as mimeLookup } from "mime-types";
import { upsertFile, listFiles } from "../db/files.js";
import { getDb } from "../db/database.js";
import { markSourceIndexed } from "../db/sources.js";
import { upsertS3ObjectRecord } from "../db/s3-objects.js";
import { isMissingS3ObjectError } from "../s3.js";
import type { Source, IndexStats, S3Config } from "../types/index.js";
import type { StreamingBlobPayloadInputTypes } from "@smithy/types";

let credentialProviderFactory: typeof fromIni = fromIni;

export function setS3CredentialProviderFactoryForTests(factory?: typeof fromIni): void {
  credentialProviderFactory = factory ?? fromIni;
}

export type S3CredentialSource =
  | "static_config"
  | "aws_profile"
  | "default_provider_chain";

export interface S3ClientConfigDiagnostics {
  region: string;
  endpoint_configured: boolean;
  force_path_style: boolean;
  credential_source: S3CredentialSource;
  profile_configured: boolean;
  static_access_key_configured: boolean;
  session_token_configured: boolean;
}

export function createS3ClientConfig(source: Source): S3ClientConfig {
  const cfg = source.config as S3Config;
  validateS3CredentialConfig(cfg);
  return {
    region: source.region ?? "us-east-1",
    // Only attach a checksum when the caller explicitly asks for one (we pass an
    // explicit SHA256 for evidence objects). The AWS SDK default of
    // `WHEN_SUPPORTED` auto-injects an `x-amz-sdk-checksum-algorithm` marker and
    // hoists checksum handling in a way that breaks presigned PUT signatures
    // (the marker is neither signed nor sent by a thin client). `WHEN_REQUIRED`
    // keeps presigned URLs deterministic and self-consistent.
    requestChecksumCalculation: "WHEN_REQUIRED",
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    ...(cfg.forcePathStyle !== undefined ? { forcePathStyle: cfg.forcePathStyle } : {}),
    ...(cfg.accessKeyId
      ? {
          credentials: {
            accessKeyId: cfg.accessKeyId,
            secretAccessKey: cfg.secretAccessKey!,
            sessionToken: cfg.sessionToken,
          },
        }
      : cfg.profile
        ? { credentials: credentialProviderFactory({ profile: cfg.profile }) }
        : {}),
  };
}

export function describeS3ClientConfig(source: Source): S3ClientConfigDiagnostics {
  const cfg = source.config as S3Config;
  return {
    region: source.region ?? "us-east-1",
    endpoint_configured: Boolean(cfg.endpoint),
    force_path_style: Boolean(cfg.forcePathStyle),
    credential_source: cfg.accessKeyId
      ? "static_config"
      : cfg.profile
        ? "aws_profile"
        : "default_provider_chain",
    profile_configured: Boolean(cfg.profile),
    static_access_key_configured: Boolean(cfg.accessKeyId),
    session_token_configured: Boolean(cfg.sessionToken),
  };
}

function makeClient(source: Source): S3Client {
  return new S3Client(createS3ClientConfig(source));
}

export async function indexS3Source(source: Source, machine_id: string): Promise<IndexStats> {
  if (!source.bucket) throw new Error("S3 source missing bucket");
  const client = makeClient(source);
  const start = Date.now();
  const stats: IndexStats = { source_id: source.id, added: 0, updated: 0, deleted: 0, errors: 0, duration_ms: 0 };

  const seen = new Set<string>();

  let continuationToken: string | undefined;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: source.bucket,
        Prefix: source.prefix ?? undefined,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of resp.Contents ?? []) {
      if (!obj.Key || obj.Key.endsWith("/")) continue;
      seen.add(obj.Key);
      await indexS3Object(obj, source, machine_id, stats);
    }

    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  // Mark files as deleted if they no longer exist in S3
  const indexedFiles = listFiles({ source_id: source.id, status: "active" });
  for (const file of indexedFiles) {
    if (!seen.has(file.path)) {
      const result = getDb().run(
        "UPDATE files SET status='deleted', indexed_at=datetime('now') WHERE id=? AND status='active'",
        [file.id]
      );
      if (result.changes > 0) stats.deleted++;
    }
  }

  stats.duration_ms = Date.now() - start;
  markSourceIndexed(source.id, stats.added + stats.updated);
  return stats;
}

async function indexS3Object(
  obj: _Object,
  source: Source,
  machine_id: string,
  stats: IndexStats
): Promise<void> {
  const key = obj.Key!;
  if (key.endsWith("/")) return; // skip folder markers

  try {
    const name = basename(key);
    const ext = extname(name).toLowerCase();
    const mime = (mimeLookup(name) || "application/octet-stream") as string;
    const size = obj.Size ?? 0;
    const modified_at = obj.LastModified?.toISOString();
    const etag = obj.ETag?.replace(/"/g, "");

    upsertS3ObjectRecord({
      source_id: source.id,
      bucket: source.bucket!,
      region: source.region ?? "us-east-1",
      object_key: key,
      etag,
      size,
      content_type: mime,
      storage_class: obj.StorageClass,
      discovered_at: modified_at,
      metadata: {
        discovery: "list_objects_v2",
        checksum_algorithm: obj.ChecksumAlgorithm,
        checksum_type: obj.ChecksumType,
        etag_is_content_hash: false,
      },
    });

    const result = upsertFile({
      source_id: source.id,
      machine_id,
      path: key,
      name,
      ext,
      size,
      mime,
      hash: undefined,
      status: "active",
      modified_at,
    });
    if (result.created_at === result.indexed_at) stats.added++;
    else stats.updated++;
  } catch {
    stats.errors++;
  }
}

export async function downloadFromS3(source: Source, filePath: string, destPath: string): Promise<void> {
  if (!source.bucket) throw new Error("S3 source missing bucket");
  const client = makeClient(source);
  const resp = await client.send(
    new GetObjectCommand({ Bucket: source.bucket, Key: filePath })
  );
  if (!resp.Body) throw new Error("Empty response body");
  const ws = createWriteStream(destPath);
  await pipeline(resp.Body as NodeJS.ReadableStream, ws);
}

export async function uploadToS3(source: Source, localPath: string, s3Key?: string): Promise<string> {
  if (!source.bucket) throw new Error("S3 source missing bucket");
  const key = s3Key ?? (source.prefix ? `${source.prefix}/${basename(localPath)}` : basename(localPath));
  const mime = (mimeLookup(localPath) || "application/octet-stream") as string;
  const stat = statSync(localPath);

  return uploadBufferToS3(source, createReadStream(localPath), key, mime, stat.size);
}

export async function uploadBufferToS3(
  source: Source,
  body: StreamingBlobPayloadInputTypes,
  s3Key: string,
  contentType = "application/octet-stream",
  contentLength?: number,
  metadata?: Record<string, string>,
  checksumSha256?: string,
): Promise<string> {
  if (!source.bucket) throw new Error("S3 source missing bucket");
  const client = makeClient(source);
  const params = {
    Bucket: source.bucket,
    Key: s3Key,
    Body: body,
    ContentType: contentType,
    ...(contentLength !== undefined ? { ContentLength: contentLength } : {}),
    ...(metadata ? { Metadata: metadata } : {}),
    ...(checksumSha256
      ? { ChecksumAlgorithm: "SHA256" as const, ChecksumSHA256: normalizeSha256Checksum(checksumSha256) }
      : {}),
  };

  if (checksumSha256) {
    await client.send(new PutObjectCommand(params));
    return s3Key;
  }

  const upload = new Upload({
    client,
    params,
  });

  await upload.done();
  return s3Key;
}

export async function deleteFromS3(source: Source, filePath: string): Promise<void> {
  if (!source.bucket) throw new Error("S3 source missing bucket");
  const client = makeClient(source);
  await client.send(new DeleteObjectCommand({ Bucket: source.bucket, Key: filePath }));
}

export async function copyS3Object(
  source: Source,
  fromKey: string,
  toKey: string,
  metadata?: Record<string, string>,
  contentType?: string,
): Promise<void> {
  if (!source.bucket) throw new Error("S3 source missing bucket");
  const client = makeClient(source);
  await client.send(new CopyObjectCommand({
    Bucket: source.bucket,
    Key: toKey,
    CopySource: `${source.bucket}/${encodeS3CopySourceKey(fromKey)}`,
    ...(contentType ? { ContentType: contentType } : {}),
    ...(metadata ? { Metadata: metadata, MetadataDirective: "REPLACE" } : {}),
  }));
}

export async function getPresignedUrl(source: Source, filePath: string, expiresIn = 3600): Promise<string> {
  if (!source.bucket) throw new Error("S3 source missing bucket");
  const client = makeClient(source);
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: source.bucket, Key: filePath }),
    { expiresIn }
  );
}

export async function getPresignedPutUrl(
  source: Source,
  filePath: string,
  opts: {
    expiresIn?: number;
    contentType?: string;
    contentLength?: number;
    checksumSha256?: string;
    metadata?: Record<string, string>;
  } = {},
): Promise<string> {
  if (!source.bucket) throw new Error("S3 source missing bucket");
  const client = makeClient(source);
  // The presigner's default behavior HOISTS `content-type`, `x-amz-checksum-*`
  // and `x-amz-meta-*` into the query string, leaving `SignedHeaders=content-length;host`.
  // A thin client that sends those values as real HTTP headers (per the intent's
  // `required_headers`) then trips S3's "headers present which were not signed"
  // AccessDenied. Force every header the client will send into BOTH the signed
  // set and the unhoistable set so the signature covers exactly what is sent.
  const signedHeaders = new Set<string>(["content-type"]);
  if (opts.checksumSha256) signedHeaders.add("x-amz-checksum-sha256");
  for (const key of Object.keys(opts.metadata ?? {})) {
    signedHeaders.add(`x-amz-meta-${key.toLowerCase()}`);
  }
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: source.bucket,
      Key: filePath,
      ContentType: opts.contentType,
      ...(opts.contentLength !== undefined ? { ContentLength: opts.contentLength } : {}),
      ...(opts.checksumSha256
        ? { ChecksumAlgorithm: "SHA256" as const, ChecksumSHA256: normalizeSha256Checksum(opts.checksumSha256) }
        : {}),
      ...(opts.metadata ? { Metadata: opts.metadata } : {}),
    }),
    { expiresIn: opts.expiresIn ?? 600, signableHeaders: signedHeaders, unhoistableHeaders: signedHeaders },
  );
}

export async function headS3Object(source: Source, filePath: string): Promise<{
  size: number;
  mime: string;
  modified_at: string;
  version_id?: string;
  etag?: string;
  checksum_sha256?: string;
  storage_class?: string;
  server_side_encryption?: string;
  sse_kms_key_id?: string;
  metadata: Record<string, string>;
} | null> {
  if (!source.bucket) return null;
  try {
    const client = makeClient(source);
    const resp = await client.send(new HeadObjectCommand({ Bucket: source.bucket, Key: filePath }));
    return {
      size: resp.ContentLength ?? 0,
      mime: resp.ContentType ?? "application/octet-stream",
      modified_at: resp.LastModified?.toISOString() ?? new Date().toISOString(),
      version_id: resp.VersionId,
      etag: resp.ETag?.replace(/"/g, ""),
      checksum_sha256: normalizeSha256ChecksumToHex(resp.ChecksumSHA256),
      storage_class: resp.StorageClass,
      server_side_encryption: resp.ServerSideEncryption,
      sse_kms_key_id: resp.SSEKMSKeyId,
      metadata: resp.Metadata ?? {},
    };
  } catch (error) {
    if (isMissingS3ObjectError(error)) return null;
    throw error;
  }
}

function encodeS3CopySourceKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function normalizeSha256Checksum(checksum: string): string {
  return /^[a-f0-9]{64}$/i.test(checksum)
    ? Buffer.from(checksum, "hex").toString("base64")
    : checksum;
}

function normalizeSha256ChecksumToHex(checksum: string | undefined): string | undefined {
  if (!checksum) return undefined;
  if (/^[a-f0-9]{64}$/i.test(checksum)) return checksum.toLowerCase();
  try {
    const decoded = Buffer.from(checksum, "base64");
    if (decoded.length === 32) return decoded.toString("hex");
  } catch {
    return checksum;
  }
  return checksum;
}

function validateS3CredentialConfig(cfg: S3Config): void {
  if (cfg.accessKeyId && !cfg.secretAccessKey) {
    throw new Error("S3 source static credentials require both accessKeyId and secretAccessKey. Prefer an AWS profile or the default provider chain.");
  }
  if (cfg.secretAccessKey && !cfg.accessKeyId) {
    throw new Error("S3 source static credentials require both accessKeyId and secretAccessKey. Prefer an AWS profile or the default provider chain.");
  }
}
