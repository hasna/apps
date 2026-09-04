import { PutObjectCommand, S3Client as AwsS3Client } from "@aws-sdk/client-s3";

/**
 * Content-addressed artefact upload for log build artefacts (page scans, HAR /
 * performance snapshots, browser captures, ...). Follows the artifact-kit
 * pattern from hasna/apps#1639: bucket + prefix come from the environment
 * (`LOGS_S3_BUCKET` / `LOGS_S3_PREFIX`), objects are keyed
 * `<prefix>/<run_id>/<sha256>` so identical bytes dedupe and a single
 * lifecycle rule can expire them, and every failure is soft — recording an
 * artefact never fails because its upload did.
 *
 * The hosted tier reads the same `object_key` back off the artefact row to
 * stream the bytes; machines without a bucket configured keep the historical
 * local-path-only behaviour (local fallback).
 */

/** Lowercase hex sha-256. Anything else must never reach a storage key. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The slice of the AWS client the uploader uses; injectable so tests can stand in an in-memory bucket. */
export interface S3ClientLike {
  send(command: PutObjectCommand): Promise<unknown>;
}

export interface ArtifactRemoteOptions {
  bucket?: string;
  prefix?: string;
  region?: string;
  /** Overrides the real S3 client (tests). Ignored when no bucket is configured. */
  client?: S3ClientLike;
  /** Soft-fail diagnostics; defaults to a console warning. */
  logger?: (message: string) => void;
}

export class ArtifactRemote {
  private readonly bucket?: string;
  private readonly prefix: string;
  private readonly s3?: S3ClientLike;
  private readonly logger: (message: string) => void;

  constructor(options: ArtifactRemoteOptions = {}) {
    const bucket = options.bucket ?? envBucket();
    this.bucket = bucket;
    this.prefix = stripSlashes(
      options.prefix ?? process.env.LOGS_S3_PREFIX ?? "artifacts",
    );
    this.s3 = bucket
      ? (options.client ??
        new AwsS3Client({
          region: options.region || process.env.AWS_REGION || "us-east-1",
        }))
      : undefined;
    this.logger =
      options.logger ??
      ((message) => console.warn(`[logs] artefact upload: ${message}`));
  }

  /** Whether an S3 bucket is configured; gates upload attempts. */
  get enabled(): boolean {
    return Boolean(this.bucket && this.s3);
  }

  /** Object key for a run artefact's bytes: `<prefix>/<run_id>/<sha256>`. */
  objectKeyFor(runId: string, sha256: string): string {
    return `${this.prefix}/${runId}/${sha256}`;
  }

  /**
   * Upload artefact bytes, content-addressed by their sha-256. Soft-fail:
   * returns the object key on success, and null when nothing is configured,
   * the digest is unusable as a storage key, or the upload throws — the
   * caller keeps recording the artefact locally either way.
   */
  async uploadBytes(
    runId: string,
    sha256: string,
    bytes: Uint8Array,
    contentType = "application/octet-stream",
  ): Promise<string | null> {
    if (!this.enabled) return null;
    if (!SHA256_HEX.test(sha256)) return null;
    const key = this.objectKeyFor(runId, sha256);
    try {
      await this.s3!.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
        }),
      );
      return key;
    } catch (error) {
      this.logger(`upload failed for ${key}: ${errorMessage(error)}`);
      return null;
    }
  }
}

function envBucket(): string | undefined {
  return process.env.LOGS_S3_BUCKET || process.env.HASNA_LOGS_S3_BUCKET || undefined;
}

function stripSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}