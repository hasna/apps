import { PutObjectCommand, S3Client as AwsS3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { getConfig } from "./config.js";

/**
 * Provider-media copy storage — the artifact-kit pattern (#1639) applied to
 * telephony media.
 *
 * Why this exists: call recordings, voicemails and inbound MMS/WhatsApp media
 * live only at the provider (`media_url` rows pointing at Twilio). The object
 * at that URL is subject to the provider's retention and account status, so a
 * row's playback dies with the provider. Every recording/voicemail/inbound-
 * media row created after this change therefore carries an `object_key`
 * pointing at a content-addressed copy in the telephony media bucket
 * (`media/<call_or_message_id>/<sha256>.<ext>`), plus the digest that proves
 * the bytes.
 *
 * Env-config, soft-fail: the bucket comes from the environment
 * (HASNA_TELEPHONY_S3_BUCKET / TELEPHONY_S3_BUCKET; prefix default
 * `telephony`, so copies land at `<prefix>/media/<id>/<sha256>.<ext>`). With no bucket configured the storage is inert and every
 * copy is a no-op returning null. A failed copy — provider fetch error,
 * non-200 response, S3 upload error, anything — is logged and swallowed, so a
 * media problem never breaks the webhook or the row write: the row keeps
 * `object_key` null and the provider URL as the fallback. That is deliberate:
 * media copy is a retention improvement, not a control-plane dependency.
 */

/** Lowercase hex sha-256. Anything else must never reach a storage key. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The slice of the AWS client the storage uses; injectable so tests can stand in an in-memory bucket. */
export interface S3ClientLike {
  send(command: PutObjectCommand): Promise<unknown>;
}

export interface MediaStorageOptions {
  bucket?: string;
  prefix?: string;
  region?: string;
  /** Overrides the real S3 client (tests). Ignored when no bucket is configured. */
  client?: S3ClientLike;
}

export interface MediaCopyResult {
  objectKey: string;
  sha256: string;
  size: number;
}

export class MediaStorage {
  private bucket?: string;
  private prefix: string;
  private s3?: S3ClientLike;

  constructor(options: MediaStorageOptions = {}) {
    this.bucket = options.bucket;
    this.prefix = (options.prefix || "telephony").replace(/^\/+|\/+$/g, "");
    this.s3 = this.bucket ? options.client ?? new AwsS3Client({ region: options.region || process.env.AWS_REGION || "us-east-1" }) : undefined;
  }

  get usesS3(): boolean {
    return Boolean(this.bucket);
  }

  /**
   * Object key for a copied media object: `<prefix>/media/<mediaId>/<sha256>.<ext>`.
   * The mediaId segment is structural — it is the call id, message id, or
   * provider sid the row points at, never a free-form path — but it is still
   * sanitised like the artifact kit sanitises run ids: leading slashes and
   * `..` segments are stripped so a hostile value can never escape the prefix.
   */
  mediaKeyFor(mediaId: string, sha256: string, extension: string): string {
    const safeMediaId = mediaId.replace(/^\/+/, "").replace(/\.\.(?:\/|$)/g, "") || "unknown";
    const safeExt = extension.replace(/^\.+/, "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
    return `${this.prefix}/media/${safeMediaId}/${sha256}.${safeExt}`;
  }

  /**
   * Copy provider media into the bucket.
   *
   * Returns null — never throws — when the copy cannot happen: no bucket
   * configured, provider fetch failed or non-200, or the upload failed. Each
   * failure is logged and swallowed (soft-fail), because the caller's job is
   * to record the event, not to police the provider.
   */
  async copyProviderMedia(options: {
    mediaId: string;
    sourceUrl: string;
    contentType?: string;
    /** Injectable fetch (tests); defaults to the global fetch. */
    fetchImpl?: typeof fetch;
  }): Promise<MediaCopyResult | null> {
    const { mediaId, sourceUrl, contentType } = options;
    if (!this.bucket || !this.s3) return null;

    try {
      const fetchImpl = options.fetchImpl ?? fetch;
      const res = await fetchImpl(sourceUrl);
      if (!res.ok) {
        console.error(`[telephony] media copy: provider fetch failed for ${mediaId}: HTTP ${res.status}`);
        return null;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0) {
        console.error(`[telephony] media copy: provider returned an empty body for ${mediaId}`);
        return null;
      }

      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (!SHA256_HEX.test(sha256)) {
        console.error(`[telephony] media copy: digest computation produced an invalid sha256 for ${mediaId}`);
        return null;
      }

      const resolvedType = contentType ?? res.headers.get("content-type") ?? "application/octet-stream";
      const extension = extensionForContentType(resolvedType) ?? extensionForUrl(sourceUrl) ?? "bin";
      const objectKey = this.mediaKeyFor(mediaId, sha256, extension);

      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: bytes,
        ContentType: resolvedType,
      }));

      return { objectKey, sha256, size: bytes.length };
    } catch (error) {
      console.error(
        `[telephony] media copy: failed to copy provider media for ${mediaId} (${sourceUrl}):`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }
}

/** Build the storage from the environment config (bucket + prefix). */
export function mediaStorageFromConfig(): MediaStorage {
  const config = getConfig();
  return new MediaStorage({ bucket: config.s3_bucket, prefix: config.s3_prefix });
}

/** Convenience copy using the environment-config storage. */
export async function copyProviderMedia(
  mediaId: string,
  sourceUrl: string,
  contentType?: string,
  storage: MediaStorage = mediaStorageFromConfig(),
): Promise<MediaCopyResult | null> {
  return storage.copyProviderMedia({ mediaId, sourceUrl, contentType });
}

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

function extensionForContentType(contentType: string): string | null {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return CONTENT_TYPE_EXTENSIONS[base] ?? null;
}

function extensionForUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split("/").pop() ?? "";
    const dot = last.lastIndexOf(".");
    if (dot < 0 || dot === last.length - 1) return null;
    const ext = last.slice(dot + 1).toLowerCase();
    return /^[a-z0-9]{1,8}$/.test(ext) ? ext : null;
  } catch {
    return null;
  }
}