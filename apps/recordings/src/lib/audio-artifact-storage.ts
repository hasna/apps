/**
 * Artifact kit for recording audio — the object-store half of the storage
 * layer, modelled on the shared kit pattern first shipped for skills bundles
 * (hasna/apps#1639, apps/skills/src/server/artifact-storage.ts).
 *
 * One class, `AudioArtifactStorage`, has two modes:
 *   • db/local-only — no bucket configured: `usesS3` is false, every method is
 *     a no-op returning null, and recordings keep the historical behaviour of
 *     `audio_path`-only provenance on the recording machine.
 *   • s3 — a bucket is configured (env `HASNA_RECORDINGS_S3_BUCKET` /
 *     `RECORDINGS_S3_BUCKET`): audio bytes are placed as a content-addressed
 *     object `recordings/<recording_id>/<sha256>.<ext>` (prefix configurable
 *     via `HASNA_RECORDINGS_S3_PREFIX`), and the row records the object key,
 *     the digest and the byte size.
 *
 * The key is content-addressed: the digest is part of the key, so re-uploading
 * the same bytes is idempotent (identical key, identical object) and a wrong
 * digest can never be stored because only a verified lowercase hex sha-256 is
 * accepted into a key. The recording id segment is structural — one recording
 * never shares a key with another, and a bucket policy or lifecycle rule can
 * key on it.
 *
 * The S3 client is injectable (`client` option) so tests can stand in an
 * in-memory bucket exactly like the skills kit tests do. Credentials are
 * never read here: the AWS SDK resolves them from the ambient environment /
 * instance role at send time.
 */

import { GetObjectCommand, PutObjectCommand, S3Client as AwsS3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

/** Lowercase hex sha-256. Anything else must never reach a storage key. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Default object-key prefix; matches the issue's `recordings/<id>/<sha256>.<ext>` layout. */
export const DEFAULT_S3_PREFIX = "recordings";

/** The slice of the AWS client the storage uses; injectable so tests can stand in an in-memory bucket. */
export interface S3ClientLike {
  send(command: PutObjectCommand | GetObjectCommand): Promise<{ Body?: unknown }>;
}

export interface AudioArtifactStorageOptions {
  bucket?: string;
  prefix?: string;
  region?: string;
  /** Overrides the real S3 client (tests). Ignored when no bucket is configured. */
  client?: S3ClientLike;
}

/** What a successful upload wrote, for the row link. */
export interface UploadedAudioRef {
  objectKey: string;
  sha256: string;
  bytes: number;
}

const AUDIO_CONTENT_TYPES: Readonly<Record<string, string>> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  webm: "audio/webm",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

/** RFC-ish content type for a file extension; unknown extensions fall back to application/octet-stream. */
export function contentTypeForExtension(extension: string): string {
  return AUDIO_CONTENT_TYPES[extension.toLowerCase()] ?? "application/octet-stream";
}

export class AudioArtifactStorage {
  private bucket?: string;
  private prefix: string;
  private s3?: S3ClientLike;

  constructor(options: AudioArtifactStorageOptions = {}) {
    this.bucket = options.bucket;
    this.prefix = (options.prefix || DEFAULT_S3_PREFIX).replace(/^\/+|\/+$/g, "");
    this.s3 = this.bucket
      ? options.client ?? new AwsS3Client({ region: options.region || process.env.AWS_REGION || "us-east-1" })
      : undefined;
  }

  get usesS3(): boolean {
    return Boolean(this.bucket);
  }

  /**
   * Content-addressed object key for a recording's audio:
   * `<prefix>/<recordingId>/<sha256>.<extension>`. The digest is the whole
   * name — there is no caller-supplied path component to sanitise, only a
   * digest to refuse if it is not one, and an extension to bound.
   */
  objectKeyFor(recordingId: string, sha256: string, extension: string): string {
    assertSha256(sha256);
    const safeExtension = extension.toLowerCase().match(/^[a-z0-9]+/)?.[0] || "bin";
    return `${this.prefix}/${recordingId}/${sha256}.${safeExtension}`;
  }

  /**
   * Upload one audio file as a content-addressed object.
   *
   * Returns null when no bucket is configured (local-only mode) or when the
   * file cannot be read — in which case nothing is written and nothing was
   * lost. Throws only on a genuine storage failure, which the caller decides
   * how softly to treat.
   */
  async uploadAudio(recordingId: string, audioPath: string): Promise<UploadedAudioRef | null> {
    if (!this.bucket || !this.s3) return null;
    const bytes = await readFileBytes(audioPath);
    if (!bytes) return null;
    const sha256 = sha256Hex(bytes);
    const extension = extensionOf(audioPath);
    const key = this.objectKeyFor(recordingId, sha256, extension);
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: bytes,
      ContentType: contentTypeForExtension(extension),
    }));
    return { objectKey: key, sha256, bytes: bytes.byteLength };
  }

  /**
   * Read an uploaded object back, for anywhere-any-machine playback.
   *
   * Returns null when no bucket is configured or the object does not exist.
   * The caller checks the digest when it needs proof of identity.
   */
  async readAudio(objectKey: string): Promise<Uint8Array | null> {
    if (!this.bucket || !this.s3) return null;
    try {
      const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return await bodyToBytes(response.Body);
    } catch {
      return null;
    }
  }
}

/**
 * Resolve the kit from the environment. The bucket comes from
 * HASNA_RECORDINGS_S3_BUCKET (preferred, matches the hosted service env
 * naming) or RECORDINGS_S3_BUCKET; the prefix defaults to "recordings" and the
 * region to AWS_REGION, then us-east-1.
 */
export function resolveAudioArtifactStorage(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  client?: S3ClientLike,
): AudioArtifactStorage {
  const bucket = env.HASNA_RECORDINGS_S3_BUCKET || env.RECORDINGS_S3_BUCKET || undefined;
  const prefix = env.HASNA_RECORDINGS_S3_PREFIX || env.RECORDINGS_S3_PREFIX || undefined;
  const region = env.RECORDINGS_S3_REGION || env.AWS_REGION || undefined;
  return new AudioArtifactStorage({ bucket, prefix, region, client });
}

/**
 * The creation-time hook: upload a recording's audio when a bucket is
 * configured, and NEVER let a storage failure take the recording down with it.
 * The row already exists by the time this runs; a failed or unconfigured
 * upload leaves the historical `audio_path` provenance in place and returns
 * null. This is the deliberate fail-soft contract of the app-side fix — the
 * hosted service's fail-closed rule is an infra-side concern (hasna/apps#1645).
 */
export async function uploadAudioAtCreation(
  recordingId: string,
  audioPath: string | null | undefined,
  storage: AudioArtifactStorage = resolveAudioArtifactStorage(),
): Promise<UploadedAudioRef | null> {
  if (!audioPath) return null;
  if (!storage.usesS3) return null;
  try {
    const uploaded = await storage.uploadAudio(recordingId, audioPath);
    if (!uploaded) return null;
    console.warn(`recordings: uploaded audio for ${recordingId} to ${uploaded.objectKey}`);
    return uploaded;
  } catch (error) {
    console.warn(
      `recordings: audio upload failed for ${recordingId} (${String(error instanceof Error ? error.message : error)}); keeping local audio_path only`,
    );
    return null;
  }
}

function assertSha256(value: string): void {
  if (!SHA256_HEX.test(value)) {
    throw new Error("audio digest must be a lowercase hex sha-256; refusing to build a storage key from it");
  }
}

function sha256Hex(bytes: Uint8Array): string {
  const hash = createHash("sha256");
  hash.update(bytes);
  return hash.digest("hex");
}

async function readFileBytes(path: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path));
  } catch {
    return null;
  }
}

function extensionOf(path: string): string {
  const extension = extname(path).replace(/^\./, "").toLowerCase();
  return extension || "bin";
}

async function bodyToBytes(body: unknown): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  if (body instanceof Uint8Array) return body;
  if (typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function") {
    return new Uint8Array(await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
  }
  if (typeof (body as ReadableStream<Uint8Array>).getReader === "function") {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return concat(chunks);
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  }
  return concat(chunks);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}