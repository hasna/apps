import { readFileSync, statSync, writeFileSync, unlinkSync, mkdirSync, mkdtempSync, rmSync, createReadStream, createWriteStream } from "fs";
import { basename, join } from "path";
import { tmpdir } from "os";
import { createCipheriv, createHash, randomBytes, scryptSync } from "crypto";
import { nanoid } from "nanoid";
import { lookup as mimeLookup } from "mime-types";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { S3Client } from "./s3";
import { AttachmentsDB, Attachment } from "./db";
import {
  getConfig,
  normalizeConfig,
  parseExpiryStrict,
  resolveStorageBackend,
} from "./config";
import {
  generatePresignedLink,
  generateShareLink,
  getLinkType,
  resolveDeliverableLinkType,
  resolveLocalShareBaseUrl,
} from "./links";
import { trackUploadCost } from "./economy";
import { sanitizeFilename } from "./security";
import {
  buildArtifactManifest,
  canonicalBlobKey,
  manifestKey,
  sha256File,
  type ArtifactManifest,
} from "./artifact-keys";
import { LocalObjectStore, createObjectStore } from "./object-storage";

export interface UploadOptions {
  expiry?: string;       // e.g. "24h", "7d", "never" — overrides config default
  tag?: string;
  linkType?: "presigned" | "server";
  password?: string;
  encrypt?: boolean;
  maxDownloads?: number;
  requireEmail?: boolean;
  allowedEmails?: string[] | null;
  baseUrl?: string;
}

export interface UploadDeps {
  s3?: InstanceType<typeof S3Client>;
  objectStore?: InstanceType<typeof S3Client> | InstanceType<typeof LocalObjectStore>;
  db?: InstanceType<typeof AttachmentsDB>;
  config?: ReturnType<typeof getConfig>;
}

function buildEncryptionTransform(password: string): {
  transform: (stream: NodeJS.ReadableStream) => NodeJS.ReadableStream;
  algorithm: string;
  salt: string;
  iv: string;
  tag: () => string | null;
} {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  return {
    algorithm: "aes-256-gcm",
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    transform: (stream) => stream.pipe(cipher),
    tag: () => {
      try {
        return cipher.getAuthTag().toString("hex");
      } catch {
        return null;
      }
    },
  };
}

/**
 * Spill a byte source (through the optional at-rest transform) to a temp file
 * while hashing and counting. The canonical storage key is derived from the
 * digest of these FINAL bytes (the ciphertext when encrypted), so the digest
 * must be known before the object key can be built. Returns the staged file,
 * its sha-256 and its size. The caller owns cleanup of the returned path.
 */
async function stageBytes(
  input: NodeJS.ReadableStream,
  transform: ((stream: NodeJS.ReadableStream) => NodeJS.ReadableStream) | undefined,
  maxSizeBytes: number,
): Promise<{ dir: string; path: string; sha256: string; size: number }> {
  const dir = mkdtempSync(join(tmpdir(), "attachments-stage-"));
  const path = join(dir, "bytes.bin");
  const hash = createHash("sha256");
  let size = 0;

  let source: NodeJS.ReadableStream = input;
  if (transform) source = transform(source);

  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += Buffer.byteLength(chunk);
      if (size > maxSizeBytes) {
        callback(new Error(`File too large. Maximum size is ${maxSizeBytes} bytes.`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  await pipeline(source, counter, createWriteStream(path));
  return { dir, path, sha256: hash.digest("hex"), size };
}

/**
 * The store a caller-provided dep set resolves to for the given backend.
 * Mirrors the resolution inside `uploadObject` so dedup checks and the actual
 * upload hit the same store.
 */
function resolveUploadStore(
  storageBackend: "local" | "s3",
  deps: UploadDeps,
  config: ReturnType<typeof getConfig>,
): LocalObjectStore | S3Client {
  if (deps.objectStore) return deps.objectStore;
  if (storageBackend === "s3") return deps.s3 ?? new S3Client(config.s3);
  return new LocalObjectStore(config);
}

/**
 * True when the store reports the object already exists. Content-addressed
 * keys make a repeat upload an idempotent overwrite of the SAME object — a
 * duplicate upload never creates a second object — and this short-circuit also
 * saves the redundant PUT. Stores without `head` (the local backend) always
 * report false; local writes to the same canonical path are also idempotent.
 */
async function objectExists(store: LocalObjectStore | S3Client, key: string): Promise<boolean> {
  const head = (store as { head?: (k: string) => Promise<unknown> }).head;
  if (typeof head !== "function") return false;
  try {
    await head.call(store, key);
    return true;
  } catch {
    return false;
  }
}

async function uploadObject(
  key: string,
  filePath: string,
  contentType: string,
  storageBackend: "local" | "s3",
  deps: UploadDeps,
  config: ReturnType<typeof getConfig>,
): Promise<void> {
  const store = resolveUploadStore(storageBackend, deps, config);
  if (await objectExists(store, key)) return;

  if ("uploadFile" in store) {
    await store.uploadFile(key, filePath, contentType);
    return;
  }
  await (store as unknown as { upload(key: string, body: Buffer, contentType: string): Promise<void> }).upload(
    key,
    readFileSync(filePath),
    contentType,
  );
}

/**
 * Publish the per-row artifact manifest (S3 only). The manifest carries the
 * content address and provenance summary so a bucket listing is restorable
 * without the metadata database; it is written once per attachment id.
 */
async function writeManifest(
  manifest: ArtifactManifest,
  storageBackend: "local" | "s3",
  deps: UploadDeps,
  config: ReturnType<typeof getConfig>,
): Promise<void> {
  if (storageBackend !== "s3") return;
  const body = Buffer.from(JSON.stringify(manifest, null, 2));
  const store = deps.objectStore ?? deps.s3;
  if (store && typeof (store as { upload?: unknown }).upload === "function") {
    await (store as { upload(key: string, body: Buffer, contentType: string): Promise<void> }).upload(
      manifestKey(manifest.id),
      body,
      "application/json",
    );
    return;
  }
  const s3 = new S3Client(config.s3);
  await s3.upload(manifestKey(manifest.id), body, "application/json");
}

function cleanupStaged(dir: string | null): void {
  if (!dir) return;
  rmSync(dir, { recursive: true, force: true });
}

export async function uploadFile(
  filePath: string,
  opts: UploadOptions = {},
  _deps: UploadDeps = {}
): Promise<Attachment> {
  const config = _deps.config ? normalizeConfig(_deps.config) : getConfig();

  const fileSize = statSync(filePath).size;
  if (fileSize > config.storage.maxSizeBytes) {
    throw new Error(`File too large. Maximum size is ${config.storage.maxSizeBytes} bytes.`);
  }

  const filename = sanitizeFilename(basename(filePath));
  const detectedMime = mimeLookup(filename);
  const contentType = detectedMime !== false ? detectedMime : "application/octet-stream";

  const id = `att_${nanoid(10)}`;
  const storageBackend = resolveStorageBackend(config);

  const encryption = opts.encrypt && opts.password ? buildEncryptionTransform(opts.password) : null;

  // The canonical key is derived from the digest of the bytes actually stored
  // (ciphertext when encrypted). Encrypted uploads are staged through the
  // transform once so the digest is computed on the final bytes and the
  // transform never runs twice.
  let sourcePath: string | null = null;
  let stagedDir: string | null = null;
  let sha256: string;
  let finalSize = fileSize;
  let encryptionTag: string | null = null;
  if (encryption) {
    const staged = await stageBytes(
      createReadStream(filePath),
      encryption.transform,
      config.storage.maxSizeBytes,
    );
    stagedDir = staged.dir;
    sourcePath = staged.path;
    sha256 = staged.sha256;
    finalSize = staged.size;
    encryptionTag = encryption.tag() ?? null;
  } else {
    sha256 = await sha256File(filePath);
  }

  try {
    const objectKey = canonicalBlobKey(sha256, filename);

    await uploadObject(objectKey, sourcePath ?? filePath, contentType, storageBackend, { ..._deps, config }, config);

    await writeManifest(
      buildArtifactManifest({
        id,
        sha256,
        byteSize: finalSize,
        contentType,
        filename,
        createdAt: Date.now(),
        storageKey: objectKey,
      }),
      storageBackend,
      { ..._deps, config },
      config,
    );

    // Resolve expiry
    const expiryStr = opts.expiry ?? config.defaults.expiry;
    const { milliseconds: expiryMs } = parseExpiryStrict(expiryStr);
    const expiresAt = expiryMs !== null ? Date.now() + expiryMs : null;

    // Resolve link type
    const resolvedLinkType = resolveDeliverableLinkType({
      requested: opts.linkType ?? getLinkType(config),
      backend: storageBackend,
      expiryMs,
      password: opts.password,
      encrypt: opts.encrypt,
      maxDownloads: opts.maxDownloads,
      requireEmail: opts.requireEmail,
    });

    // Generate link
    let link: string | null = null;
    if (resolvedLinkType === "presigned") {
      const s3 = _deps.s3 ?? new S3Client(config.s3);
      link = await generatePresignedLink(s3, objectKey, expiryMs);
    }

    // Build attachment record
    const attachment: Attachment = {
      id,
      filename,
      s3Key: objectKey,
      bucket: storageBackend === "s3" ? config.s3.bucket : "local",
      size: finalSize,
      contentType,
      link,
      tag: opts.tag ?? null,
      expiresAt,
      createdAt: Date.now(),
      storageBackend,
      status: "ready",
      encryptionAlgorithm: encryption?.algorithm ?? null,
      encryptionSalt: encryption?.salt ?? null,
      encryptionIv: encryption?.iv ?? null,
      encryptionTag,
      downloads: 0,
      contentSha256: sha256,
    };

    // Insert into DB
    const db = _deps.db ?? new AttachmentsDB();
    try {
      db.insert(attachment);
      if (resolvedLinkType === "server") {
        const { token } =
          "createShareLink" in db
            ? db.createShareLink({
                attachmentId: id,
                expiresAt,
                password: opts.password,
                maxUses: opts.maxDownloads ?? null,
                requireEmail: opts.requireEmail,
                allowedEmails: opts.allowedEmails ?? null,
              })
            : { token: id };
        link = generateShareLink(
          token,
          opts.baseUrl ?? resolveLocalShareBaseUrl(config).baseUrl,
          config.server.publicPath,
        );
        if ("updateLink" in db) db.updateLink(id, link, expiresAt);
        attachment.link = link;
      }
    } finally {
      if (!_deps.db) db.close();
    }

    // Optionally track upload cost to economy server (non-blocking, silent failure)
    void trackUploadCost({ filename, sizeBytes: finalSize, operation: "upload" });

    return attachment;
  } finally {
    cleanupStaged(stagedDir);
  }
}

export async function uploadStreamAttachment(
  stream: NodeJS.ReadableStream,
  filenameInput: string,
  contentTypeInput?: string,
  opts: UploadOptions & { size?: number } = {},
  _deps: UploadDeps = {}
): Promise<Attachment> {
  const config = _deps.config ? normalizeConfig(_deps.config) : getConfig();
  if (opts.size !== undefined && opts.size > config.storage.maxSizeBytes) {
    throw new Error(`File too large. Maximum size is ${config.storage.maxSizeBytes} bytes.`);
  }

  const filename = sanitizeFilename(filenameInput);
  const detectedMime = mimeLookup(filename);
  const contentType = contentTypeInput ?? (detectedMime !== false ? detectedMime : "application/octet-stream");
  const id = `att_${nanoid(10)}`;
  const storageBackend = resolveStorageBackend(config);

  const encryption = opts.encrypt && opts.password ? buildEncryptionTransform(opts.password) : null;
  const staged = await stageBytes(stream, encryption?.transform, config.storage.maxSizeBytes);
  const encryptionTag = encryption?.tag() ?? null;
  const finalSize = opts.size ?? staged.size;

  try {
    const objectKey = canonicalBlobKey(staged.sha256, filename);

    await uploadObject(objectKey, staged.path, contentType, storageBackend, { ..._deps, config }, config);

    await writeManifest(
      buildArtifactManifest({
        id,
        sha256: staged.sha256,
        byteSize: staged.size,
        contentType,
        filename,
        createdAt: Date.now(),
        storageKey: objectKey,
      }),
      storageBackend,
      { ..._deps, config },
      config,
    );

    const expiryStr = opts.expiry ?? config.defaults.expiry;
    const { milliseconds: expiryMs } = parseExpiryStrict(expiryStr);
    const expiresAt = expiryMs !== null ? Date.now() + expiryMs : null;

    const resolvedLinkType = resolveDeliverableLinkType({
      requested: opts.linkType ?? getLinkType(config),
      backend: storageBackend,
      expiryMs,
      password: opts.password,
      encrypt: opts.encrypt,
      maxDownloads: opts.maxDownloads,
      requireEmail: opts.requireEmail,
    });

    let link: string | null = null;
    if (resolvedLinkType === "presigned") {
      const s3 = _deps.s3 ?? new S3Client(config.s3);
      link = await generatePresignedLink(s3, objectKey, expiryMs);
    }

    const attachment: Attachment = {
      id,
      filename,
      s3Key: objectKey,
      bucket: storageBackend === "s3" ? config.s3.bucket : "local",
      size: finalSize,
      contentType,
      link,
      tag: opts.tag ?? null,
      expiresAt,
      createdAt: Date.now(),
      storageBackend,
      status: "ready",
      encryptionAlgorithm: encryption?.algorithm ?? null,
      encryptionSalt: encryption?.salt ?? null,
      encryptionIv: encryption?.iv ?? null,
      encryptionTag,
      downloads: 0,
      contentSha256: staged.sha256,
    };

    const db = _deps.db ?? new AttachmentsDB();
    try {
      db.insert(attachment);
      if (resolvedLinkType === "server") {
        const { token } = db.createShareLink({
          attachmentId: id,
          expiresAt,
          password: opts.password,
          maxUses: opts.maxDownloads ?? null,
          requireEmail: opts.requireEmail,
          allowedEmails: opts.allowedEmails ?? null,
        });
        link = generateShareLink(
          token,
          opts.baseUrl ?? resolveLocalShareBaseUrl(config).baseUrl,
          config.server.publicPath,
        );
        db.updateLink(id, link, expiresAt);
        attachment.link = link;
      }
    } finally {
      if (!_deps.db) db.close();
    }

    void trackUploadCost({ filename, sizeBytes: finalSize, operation: "upload" });
    return attachment;
  } finally {
    cleanupStaged(staged.dir);
  }
}

export async function uploadFromBuffer(
  buffer: Buffer,
  filename: string,
  opts: UploadOptions = {},
  deps: UploadDeps = {}
): Promise<Attachment> {
  const tempDir = join(tmpdir(), "attachments-stdin");
  mkdirSync(tempDir, { recursive: true });
  const tempPath = join(tempDir, filename);

  try {
    writeFileSync(tempPath, buffer);
    return await uploadFile(tempPath, opts, deps);
  } finally {
    try {
      unlinkSync(tempPath);
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Extract a filename from a URL, using Content-Disposition header if available,
 * otherwise falling back to the last path segment.
 */
function extractFilenameFromUrl(url: string, contentDisposition?: string | null): string {
  // Try Content-Disposition header first
  if (contentDisposition) {
    const match = contentDisposition.match(/filename[*]?=(?:UTF-8''|"?)([^";]+)"?/i);
    if (match?.[1]) {
      return decodeURIComponent(match[1].trim());
    }
  }

  // Fall back to last path segment from URL
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length > 0) {
      const lastSegment = decodeURIComponent(segments[segments.length - 1]!);
      if (lastSegment && lastSegment.includes(".")) {
        return lastSegment;
      }
    }
  } catch {
    // invalid URL, fall through
  }

  return `download_${nanoid(6)}`;
}

export async function uploadFromUrl(
  url: string,
  opts: UploadOptions = {},
  deps: UploadDeps = {}
): Promise<Attachment> {
  const config = deps.config ? normalizeConfig(deps.config) : getConfig();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }
  const contentLength = response.headers.get("content-length");
  const size = contentLength ? parseInt(contentLength, 10) : undefined;
  if (size !== undefined && size > config.storage.maxSizeBytes) {
    throw new Error(`File too large. Maximum size is ${config.storage.maxSizeBytes} bytes.`);
  }

  const contentDisposition = response.headers.get("content-disposition");
  const filename = extractFilenameFromUrl(url, contentDisposition);
  if (!response.body) {
    throw new Error("URL response did not include a readable body");
  }
  return uploadStreamAttachment(
        Readable.fromWeb(response.body as never),
    filename,
    response.headers.get("content-type") ?? undefined,
    { ...opts, size },
    { ...deps, config }
  );
}