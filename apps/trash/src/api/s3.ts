import { S3Client, DeleteObjectCommand, GetBucketLifecycleConfigurationCommand, GetBucketVersioningCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, type HeadObjectCommandOutput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { inspectCapsuleStream } from "../capsule.js";
import { ApiError, type Entry } from "./domain.js";
import type { TransferGrant, TrashObjects } from "./objects.js";

export type S3Config = { bucket: string; region: string };
const GRANT_SECONDS = 300;
const objectPattern = /^trash\/[a-f0-9]{64}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function key(entry: Entry) {
  if (!objectPattern.test(entry.objectKey) || !entry.objectKey.endsWith(`/${entry.id}`)) throw new ApiError(500, "object_identity_invalid", "The stored object identity is invalid.");
  return entry.objectKey;
}
function version(value: string | undefined | null): string {
  if (!value || value === "null" || value.length > 1024 || /[\x00-\x20\x7f]/.test(value)) throw new ApiError(422, "object_version_required", "An immutable object version is required.");
  return value;
}
function verifyMetadata(metadata: HeadObjectCommandOutput, entry: Entry, expectedVersion?: string) {
  const found = version(metadata.VersionId);
  if ((expectedVersion && found !== expectedVersion) || metadata.ContentLength !== entry.artifact.sizeBytes || metadata.ChecksumSHA256 !== Buffer.from(entry.artifact.sha256, "hex").toString("base64")) {
    throw new ApiError(422, "artifact_mismatch", "Stored object version, size or checksum does not match the capture.");
  }
  return found;
}
function errorName(error: unknown): string { return error && typeof error === "object" && "name" in error ? String(error.name) : ""; }
async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "object_store_unavailable", "The payload store could not complete this operation.");
  }
}

/** Uses the AWS credential provider chain; credentials and bucket names never enter normal API results. */
export function createS3Objects(config: S3Config, suppliedClient?: S3Client): TrashObjects {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) || !/^[a-z]{2}(?:-[a-z]+)+-[1-9]$/.test(config.region)) {
    throw new ApiError(500, "object_config_invalid", "Configure a valid S3 bucket and region.");
  }
  const client = suppliedClient ?? new S3Client({ region: config.region, maxAttempts: 2, requestHandler: { connectionTimeout: 5000, requestTimeout: 120_000 } });
  const expiresAt = () => new Date(Date.now() + GRANT_SECONDS * 1000).toISOString();
  return {
    ready: () => safe(async () => {
      const signal = AbortSignal.timeout(10_000);
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }), { abortSignal: signal });
      const configuration = await client.send(new GetBucketVersioningCommand({ Bucket: config.bucket }), { abortSignal: signal });
      if (configuration.Status !== "Enabled") throw new ApiError(503, "versioning_required", "Payload storage must have versioning enabled.");
      try {
        const lifecycle = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: config.bucket }), { abortSignal: signal });
        if (lifecycle.Rules?.some((rule) => rule.Status === "Enabled" && (rule.Expiration || rule.NoncurrentVersionExpiration))) {
          throw new ApiError(503, "unsafe_lifecycle", "Payload lifecycle expiration would bypass Trash holds.");
        }
      } catch (error) { if (errorName(error) !== "NoSuchLifecycleConfiguration") throw error; }
    }),
    upload: (entry) => safe(async (): Promise<TransferGrant> => {
      const headers = {
        "content-length": String(entry.artifact.sizeBytes), "content-type": "application/octet-stream", "if-none-match": "*",
        "x-amz-checksum-sha256": Buffer.from(entry.artifact.sha256, "hex").toString("base64"), "x-amz-server-side-encryption": "AES256",
      };
      const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: config.bucket, Key: key(entry),
        ContentLength: entry.artifact.sizeBytes, ContentType: headers["content-type"], IfNoneMatch: "*", ChecksumSHA256: headers["x-amz-checksum-sha256"], ServerSideEncryption: "AES256" }), {
        expiresIn: GRANT_SECONDS, signableHeaders: new Set(["content-length", "content-type", "if-none-match"]),
        unhoistableHeaders: new Set(["x-amz-checksum-sha256", "x-amz-server-side-encryption"]),
      });
      return { url, method: "PUT", headers, expiresAt: expiresAt() };
    }),
    verify: (entry) => safe(async () => {
      const signal = AbortSignal.timeout(120_000);
      const expectedVersion = entry.objectVersion ? version(entry.objectVersion) : undefined;
      const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key(entry), ...(expectedVersion ? { VersionId: expectedVersion } : {}), ChecksumMode: "ENABLED" }), { abortSignal: signal });
      const objectVersion = verifyMetadata(head, entry, expectedVersion);
      const object = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key(entry), VersionId: objectVersion, ChecksumMode: "ENABLED" }), { abortSignal: signal });
      if (!object.Body) throw new ApiError(422, "object_empty", "The payload store returned no content.");
      const stream = object.Body.transformToWebStream();
      try {
        verifyMetadata(object, entry, objectVersion);
        const receipt = await inspectCapsuleStream(stream, entry.artifact.sizeBytes);
        if (receipt.artifact.sha256 !== entry.artifact.sha256) throw new ApiError(422, "artifact_mismatch", "The stored artifact failed its full checksum.");
        return { version: objectVersion, receipt };
      } finally { if (!stream.locked) void stream.cancel().catch(() => {}); }
    }),
    download: (entry) => safe(async (): Promise<TransferGrant> => {
      const objectVersion = version(entry.objectVersion);
      const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key(entry), VersionId: objectVersion, ChecksumMode: "ENABLED" }), { abortSignal: AbortSignal.timeout(10_000) });
      verifyMetadata(head, entry, objectVersion);
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key(entry), VersionId: objectVersion }), { expiresIn: GRANT_SECONDS });
      return { url, method: "GET", headers: {}, expiresAt: expiresAt() };
    }),
    remove: (entry) => safe(async () => {
      const objectVersion = version(entry.objectVersion); const objectKey = key(entry);
      const signal = AbortSignal.timeout(30_000);
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey, VersionId: objectVersion }), { abortSignal: signal });
      try {
        await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey, VersionId: objectVersion }), { abortSignal: signal });
      } catch (error) {
        if (["NotFound", "NoSuchVersion", "NoSuchKey"].includes(errorName(error))) return;
        throw error;
      }
      throw new ApiError(503, "object_delete_unconfirmed", "The payload version is still present after deletion.");
    }),
  };
}
