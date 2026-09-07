// Unified storage abstraction for the attachments client (CLI / MCP / package
// root). There is ONE `Store` interface with exactly two transport
// implementations behind it:
//
//   - LocalStore  — on-box: SQLite metadata (AttachmentsDB) + S3/local object
//                   bytes. First-class; reachable ONLY through the deliberate
//                   unhosted opt-in (local-opt-in.ts): an explicit
//                   `HASNA_ATTACHMENTS_DB_PATH`/`ATTACHMENTS_DB_PATH`, or
//                   `HASNA_ATTACHMENTS_LOCAL=1`/`ATTACHMENTS_LOCAL=1` when the
//                   environment configures no authority.
//   - ApiStore    — authenticated HTTPS `<API_URL>/v1` + bearer key, via
//                   @hasna/contracts (client-config.ts). Any API URL + API key;
//                   the two differ only by URL/key, which is a server-side
//                   tenancy detail, not client code.
//
// The transport is decided by `resolveStore` from the environment — the ONE
// place that decision is made — so every command/tool/method routes through
// the same interface and no caller ever touches sqlite (`bun:sqlite`) or a raw
// `fetch` directly. There is no `*_MODE` / `*_STORAGE_MODE` selector anywhere:
// the retired mode words are inert, and the transport is decided by what
// RESOLVES (hosted) or by the explicit opt-in (local). Hosted mode with no
// resolvable credential FAILS LOUD; local mode only ever happens through the
// opt-in, never as a fallback from a failed hosted resolution.

import { basename } from "path";
import { nanoid } from "nanoid";
import { lookup as mimeLookup } from "mime-types";
import type { Attachment } from "./db";
import { AttachmentsDB } from "./db";
import { S3Client } from "./s3";
import { LocalObjectStore } from "./object-storage";
import {
  getConfig,
  parseExpiryStrict,
  validateS3Config,
  validateStorageConfig,
  type AttachmentsConfig,
} from "./config";
import {
  generatePresignedLink,
  generateShareLink,
  getLinkType,
  resolveDeliverableLinkType,
  resolveLocalShareBaseUrl,
} from "./links";
import { sanitizeFilename } from "./security";
import {
  buildArtifactManifest,
  canonicalBlobKey,
  isSha256Hex,
  manifestKey,
  stagingKey,
} from "./artifact-keys";
import {
  uploadFile as coreUploadFile,
  uploadFromUrl as coreUploadFromUrl,
  uploadFromBuffer as coreUploadFromBuffer,
  uploadStreamAttachment as coreUploadStream,
  type UploadOptions,
} from "./upload";
import { downloadAttachment, type DownloadResult } from "./download";
import { parseFriendlySlug, requireFriendlySlugPassword } from "./friendly-slug";
import { resolveAttachmentsV1, type AttachmentsV1Store, type V1UploadOptions } from "./cloud-v1";
import { announceAttachmentsLocalMode, selectsAttachmentsLocalStore } from "./local-opt-in";

export type { UploadOptions } from "./upload";

/** Result of a link read / regeneration. `expires_at` is a unix ms timestamp. */
export interface LinkResult {
  link: string | null;
  expires_at: number | null;
  slug?: string;
}

export interface ListOptions {
  limit?: number;
  includeExpired?: boolean;
  tag?: string;
}

export interface RegenerateLinkOptions {
  expiry?: string;
  password?: string;
  maxDownloads?: number;
  linkType?: "presigned" | "server";
  slug?: string;
  /** Custom base URL for the server-hosted share link (e.g. an internal/Tailscale address). */
  baseUrl?: string;
}

/** A single feedback note about the service. */
export interface FeedbackInput {
  message: string;
  email?: string | null;
  category?: string;
  version?: string | null;
}

/**
 * The single storage surface every CLI command, MCP tool and SDK method uses.
 * Both {@link LocalStore} and {@link ApiStore} implement it identically so a
 * caller never branches on transport.
 */
export interface Store {
  /** Which transport backs this store — for diagnostics only, not for branching logic. */
  readonly transport: "local" | "cloud-http";
  /** `<origin>/v1` base URL for ApiStore; null for LocalStore. */
  readonly baseUrl: string | null;

  list(options?: ListOptions): Promise<Attachment[]>;
  get(id: string): Promise<Attachment | null>;

  uploadFile(path: string, options?: UploadOptions): Promise<Attachment>;
  uploadUrl(url: string, options?: UploadOptions): Promise<Attachment>;
  uploadBuffer(buffer: Buffer | Uint8Array, filename: string, options?: UploadOptions): Promise<Attachment>;
  uploadStream(
    stream: NodeJS.ReadableStream,
    filename: string,
    contentType: string | undefined,
    options?: UploadOptions,
  ): Promise<Attachment>;

  delete(id: string): Promise<void>;
  deleteExpired(): Promise<number>;

  getLink(id: string): Promise<LinkResult>;
  isSlugAvailable(slug: string): Promise<boolean>;
  regenerateLink(id: string, options: RegenerateLinkOptions): Promise<LinkResult>;

  download(idOrUrl: string, output?: string, options?: { password?: string }): Promise<DownloadResult>;

  /** Persist a feedback note (on-box in local mode, `<API_URL>/v1/feedback` in api mode). */
  saveFeedback(input: FeedbackInput): Promise<void>;

  /**
   * Create a presigned S3 PUT URL for a direct client->S3 upload plus a pending
   * record. The URL is minted by whichever side holds the S3 credentials — the
   * client's own config in local mode, the `/v1` server in hosted mode — so
   * the client itself never needs credentials. expiryMs must be > 0.
   */
  presignUpload(
    filename: string,
    contentType: string | undefined,
    expiryMs: number,
    sha256?: string,
  ): Promise<{ id: string; uploadUrl: string; contentType: string; filename: string; expiresAt: number }>;

  /** Finalize a presigned direct upload: verify size, generate the link, mark ready. */
  presignComplete(
    id: string,
    options: { expiryMs: number | null; password?: string; maxDownloads?: number; linkType: "presigned" | "server" },
  ): Promise<{ attachment: Attachment; link: string; size: number }>;

  /** Release any held resources (DB handles). Always safe to call. */
  close(): void;
}

function toV1UploadOptions(options: UploadOptions = {}): V1UploadOptions {
  return {
    expiry: options.expiry,
    tag: options.tag,
    password: options.password,
    maxDownloads: options.maxDownloads,
    linkType: options.linkType,
    encrypt: options.encrypt,
    baseUrl: options.baseUrl,
    requireEmail: options.requireEmail,
    allowedEmails: options.allowedEmails,
  };
}

/**
 * On-box store: SQLite metadata + S3/local object bytes. First-class; works
 * with no cloud configuration. A single {@link AttachmentsDB} handle is reused
 * across calls and released by {@link LocalStore.close}.
 */
export class LocalStore implements Store {
  readonly transport = "local" as const;
  readonly baseUrl = null;

  private _db: AttachmentsDB | null = null;
  private readonly config: AttachmentsConfig;

  constructor(config?: AttachmentsConfig) {
    this.config = config ?? getConfig();
  }

  private db(): AttachmentsDB {
    if (!this._db) this._db = new AttachmentsDB();
    return this._db;
  }

  async list(options: ListOptions = {}): Promise<Attachment[]> {
    return this.db().findAll(options);
  }

  async get(id: string): Promise<Attachment | null> {
    return this.db().findById(id);
  }

  async uploadFile(path: string, options: UploadOptions = {}): Promise<Attachment> {
    validateStorageConfig(this.config);
    return coreUploadFile(path, options, { db: this.db(), config: this.config });
  }

  async uploadUrl(url: string, options: UploadOptions = {}): Promise<Attachment> {
    validateStorageConfig(this.config);
    return coreUploadFromUrl(url, options, { db: this.db(), config: this.config });
  }

  async uploadBuffer(buffer: Buffer | Uint8Array, filename: string, options: UploadOptions = {}): Promise<Attachment> {
    validateStorageConfig(this.config);
    return coreUploadFromBuffer(Buffer.from(buffer), filename, options, { db: this.db(), config: this.config });
  }

  async uploadStream(
    stream: NodeJS.ReadableStream,
    filename: string,
    contentType: string | undefined,
    options: UploadOptions = {},
  ): Promise<Attachment> {
    validateStorageConfig(this.config);
    return coreUploadStream(stream, filename, contentType, options, { db: this.db(), config: this.config });
  }

  async delete(id: string): Promise<void> {
    const db = this.db();
    const att = db.findById(id);
    if (!att) throw new Error(`Attachment not found: ${id}`);
    await this.deleteObjectBytes(att);
    db.delete(id);
  }

  async deleteExpired(): Promise<number> {
    const db = this.db();
    const now = Date.now();
    const expired = db.findAll({ includeExpired: true }).filter((a) => a.expiresAt !== null && a.expiresAt <= now);
    for (const att of expired) {
      // Delete the bytes first; only drop the DB record once the object is
      // gone. If object deletion fails, surface the error rather than orphaning
      // the bytes with a dangling (deleted) record.
      await this.deleteObjectBytes(att);
      db.delete(att.id);
    }
    return expired.length;
  }

  private async deleteObjectBytes(att: Attachment): Promise<void> {
    const backend = att.storageBackend ?? (att.bucket === "local" ? "local" : "s3");
    if (backend === "local") {
      await new LocalObjectStore(this.config).delete(att.s3Key);
    } else {
      await new S3Client(this.config.s3).delete(att.s3Key);
    }
  }

  async getLink(id: string): Promise<LinkResult> {
    const att = this.db().findById(id);
    if (!att) throw new Error(`Attachment not found: ${id}`);
    return { link: att.link, expires_at: att.expiresAt };
  }

  async isSlugAvailable(slugInput: string): Promise<boolean> {
    const slug = parseFriendlySlug(slugInput);
    return this.db().findShareLinkByToken(slug) === null;
  }

  async regenerateLink(id: string, options: RegenerateLinkOptions): Promise<LinkResult> {
    const db = this.db();
    const att = db.findById(id);
    if (!att) throw new Error(`Attachment not found: ${id}`);

    const slug = options.slug ? parseFriendlySlug(options.slug) : undefined;
    requireFriendlySlugPassword(slug, options.password);
    if (slug && !(await this.isSlugAvailable(slug))) {
      throw new Error(`Friendly slug is already in use: ${slug}`);
    }
    const { milliseconds: expiryMs } = parseExpiryStrict(options.expiry ?? this.config.defaults.expiry);
    const expiresAt = expiryMs !== null ? Date.now() + expiryMs : null;
    const linkType = resolveDeliverableLinkType({
      requested: options.linkType ?? getLinkType(this.config),
      backend: att.storageBackend ?? "s3",
      expiryMs,
      password: options.password,
      maxDownloads: options.maxDownloads,
      slug,
    });

    let link: string;
    if (linkType === "presigned") {
      link = await generatePresignedLink(new S3Client(this.config.s3), att.s3Key, expiryMs);
    } else {
      const { token } = db.createShareLink({
        attachmentId: att.id,
        expiresAt,
        token: slug,
        password: options.password,
        maxUses: options.maxDownloads ?? null,
      });
      link = generateShareLink(
        token,
        options.baseUrl ?? resolveLocalShareBaseUrl(this.config).baseUrl,
        this.config.server.publicPath,
      );
    }
    db.updateLink(att.id, link, expiresAt);
    return { link, expires_at: expiresAt, ...(slug ? { slug } : {}) };
  }

  async download(idOrUrl: string, output?: string, options: { password?: string } = {}): Promise<DownloadResult> {
    return downloadAttachment(idOrUrl, output, { db: this.db(), config: this.config }, { password: options.password });
  }

  /**
   * Create a presigned S3 PUT URL for a direct client->S3 upload plus a pending
   * DB record. Local/S3 only (the caller holds S3 creds). expiryMs must be > 0.
   */
  async presignUpload(
    filenameInput: string,
    contentTypeInput: string | undefined,
    expiryMs: number,
    sha256?: string,
  ): Promise<{ id: string; uploadUrl: string; contentType: string; filename: string; expiresAt: number }> {
    if (expiryMs === null || expiryMs <= 0) {
      throw new Error("Presigned upload expiry cannot be never");
    }
    validateS3Config(this.config);
    const filename = sanitizeFilename(filenameInput);
    const detected = mimeLookup(filename);
    const contentType = contentTypeInput ?? (detected !== false ? detected : "application/octet-stream");
    const id = `att_${nanoid(10)}`;
    const clientSha256 =
      sha256 !== undefined && sha256.trim() !== "" ? sha256.trim().toLowerCase() : undefined;
    if (clientSha256 !== undefined && !isSha256Hex(clientSha256)) {
      throw new Error("sha256 must be a lowercase hex sha-256 digest");
    }
    // Content-addressed canonical key when the caller digests its bytes up
    // front (duplicate uploads land on the same object); a staging key in the
    // compatibility namespace otherwise — the same rule as the `/v1` service.
    const s3Key = clientSha256 ? canonicalBlobKey(clientSha256, filename) : stagingKey(id);
    const uploadUrl = await new S3Client(this.config.s3).presignPut(
      s3Key,
      contentType,
      Math.floor(expiryMs / 1000),
      clientSha256,
    );
    const now = Date.now();
    this.db().insert({
      id,
      filename,
      s3Key,
      bucket: this.config.s3.bucket,
      size: 0,
      contentType,
      link: null,
      tag: null,
      expiresAt: now + expiryMs,
      createdAt: now,
      storageBackend: "s3",
      status: "pending",
      encryptionAlgorithm: null,
      encryptionSalt: null,
      encryptionIv: null,
      encryptionTag: null,
      downloads: 0,
      contentSha256: clientSha256 ?? null,
    });
    return { id, uploadUrl, contentType, filename, expiresAt: now + expiryMs };
  }

  /** Finalize a presigned direct upload: verify size, generate the link, mark ready. */
  async presignComplete(
    id: string,
    options: { expiryMs: number | null; password?: string; maxDownloads?: number; linkType: "presigned" | "server" },
  ): Promise<{ attachment: Attachment; link: string; size: number }> {
    validateS3Config(this.config);
    const db = this.db();
    const attachment = db.findById(id);
    if (!attachment) throw new Error(`Pending attachment not found: ${id}`);
    if (attachment.status !== "pending") throw new Error(`Attachment upload is already complete: ${id}`);

    const s3 = new S3Client(this.config.s3);
    const info = await s3.head(attachment.s3Key);
    const size = info.contentLength ?? attachment.size;
    if (size > this.config.storage.maxSizeBytes) {
      await s3.delete(attachment.s3Key).catch(() => undefined);
      db.delete(id);
      throw new Error(`File too large. Maximum size is ${this.config.storage.maxSizeBytes} bytes.`);
    }
    // When the creating client supplied a digest, the object must carry it: a
    // content-addressed key whose bytes disagree with the key would serve
    // corrupt bytes under another object's address.
    if (
      attachment.contentSha256 &&
      info.checksumSha256 !== undefined &&
      info.checksumSha256 !== attachment.contentSha256
    ) {
      await s3.delete(attachment.s3Key).catch(() => undefined);
      db.delete(id);
      throw new Error(
        `Uploaded object checksum does not match the declared sha256 (${attachment.contentSha256.slice(0, 12)}…)`,
      );
    }
    // Publish the per-row artifact manifest (S3 store).
    await s3.upload(
      manifestKey(id),
      Buffer.from(
        JSON.stringify(
          buildArtifactManifest({
            id,
            sha256: attachment.contentSha256 ?? undefined,
            byteSize: size,
            contentType: info.contentType ?? attachment.contentType,
            filename: attachment.filename,
            createdAt: attachment.createdAt,
            storageKey: attachment.s3Key,
          }),
          null,
          2,
        ),
      ),
      "application/json",
    );

    const expiresAt = options.expiryMs !== null ? Date.now() + options.expiryMs : null;
    const linkType = resolveDeliverableLinkType({
      requested: options.linkType,
      backend: attachment.storageBackend ?? "s3",
      expiryMs: options.expiryMs,
      password: options.password,
      maxDownloads: options.maxDownloads,
    });
    let link: string;
    if (linkType === "presigned") {
      link = await generatePresignedLink(s3, attachment.s3Key, options.expiryMs);
    } else {
      const { token } = db.createShareLink({
        attachmentId: attachment.id,
        expiresAt,
        password: options.password,
        maxUses: options.maxDownloads ?? null,
      });
      link = generateShareLink(
        token,
        resolveLocalShareBaseUrl(this.config).baseUrl,
        this.config.server.publicPath,
      );
    }
    db.markReady({ id: attachment.id, size, contentType: info.contentType ?? attachment.contentType, link, expiresAt });
    return { attachment, link, size };
  }

  /** Persist a feedback note to the on-box feedback table. */
  async saveFeedback(input: FeedbackInput): Promise<void> {
    this.db().run(
      "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
      [input.message, input.email ?? null, input.category ?? "general", input.version ?? null],
    );
  }

  close(): void {
    this._db?.close();
    this._db = null;
  }
}

/**
 * Hosted store: every read and write goes to `<API_URL>/v1` with the bearer
 * key, via the @hasna/contracts HTTP storage client. Never touches sqlite,
 * never sees a DSN.
 */
export class ApiStore implements Store {
  readonly transport = "cloud-http" as const;
  readonly baseUrl: string;

  constructor(private readonly v1: AttachmentsV1Store) {
    this.baseUrl = v1.baseUrl;
  }

  list(options: ListOptions = {}): Promise<Attachment[]> {
    return this.v1.list(options);
  }

  get(id: string): Promise<Attachment | null> {
    return this.v1.get(id);
  }

  uploadFile(path: string, options: UploadOptions = {}): Promise<Attachment> {
    return this.v1.uploadFile(path, toV1UploadOptions(options));
  }

  uploadUrl(url: string, options: UploadOptions = {}): Promise<Attachment> {
    return this.v1.uploadUrl(url, toV1UploadOptions(options));
  }

  uploadBuffer(buffer: Buffer | Uint8Array, filename: string, options: UploadOptions = {}): Promise<Attachment> {
    return this.v1.uploadBuffer(filename, buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), toV1UploadOptions(options));
  }

  uploadStream(
    stream: NodeJS.ReadableStream,
    filename: string,
    _contentType: string | undefined,
    options: UploadOptions = {},
  ): Promise<Attachment> {
    return this.v1.uploadStream(stream, filename, toV1UploadOptions(options));
  }

  delete(id: string): Promise<void> {
    return this.v1.delete(id);
  }

  async deleteExpired(): Promise<number> {
    // The service enforces expiry server-side; there is no bulk
    // purge route, so remove the expired records the API still reports.
    const all = await this.v1.list({ includeExpired: true });
    const now = Date.now();
    const expired = all.filter((a) => a.expiresAt !== null && a.expiresAt <= now);
    for (const att of expired) await this.v1.delete(att.id);
    return expired.length;
  }

  getLink(id: string): Promise<LinkResult> {
    return this.v1.getLink(id);
  }

  isSlugAvailable(slug: string): Promise<boolean> {
    return this.v1.isSlugAvailable(slug);
  }

  regenerateLink(id: string, options: RegenerateLinkOptions): Promise<LinkResult> {
    return this.v1.regenerateLink(id, options);
  }

  download(idOrUrl: string, output?: string, options: { password?: string } = {}): Promise<DownloadResult> {
    return this.v1.download(idOrUrl, output, options);
  }

  saveFeedback(input: FeedbackInput): Promise<void> {
    return this.v1.saveFeedback(input);
  }

  presignUpload(filename: string, contentType: string | undefined, expiryMs: number, sha256?: string) {
    return this.v1.presignUpload(filename, contentType, expiryMs, sha256);
  }

  presignComplete(
    id: string,
    options: { expiryMs: number | null; password?: string; maxDownloads?: number; linkType: "presigned" | "server" },
  ) {
    return this.v1.presignComplete(id, options);
  }

  close(): void {
    /* no persistent client-side resource to release */
  }
}

export interface ResolveStoreOptions {
  /** Force the on-box LocalStore even when the environment configures an authority. */
  forceLocal?: boolean;
}

/**
 * The one call every command/tool/method makes to get its store.
 *
 * - An explicit local signal (a `HASNA_ATTACHMENTS_DB_PATH` /
 *   `ATTACHMENTS_DB_PATH` file, or the `HASNA_ATTACHMENTS_LOCAL=1` /
 *   `ATTACHMENTS_LOCAL=1` opt-in when the environment configures no
 *   authority) selects the on-box {@link LocalStore}, answered WITHOUT the
 *   resolver — no Keychain item and no credential file is read for a local
 *   run, and the run prints the LOCAL-mode notice.
 * - Otherwise the authenticated {@link ApiStore} resolves through the shared
 *   @hasna/contracts chain (fresh on every call) against any configured API
 *   URL + key, defaulting the authority to the fleet gateway.
 * - Hosted configuration that does not resolve FAILS LOUD — there is no
 *   silent local fallback, no default database, no `*_MODE` selector.
 */
export function resolveStore(env: NodeJS.ProcessEnv = process.env, options: ResolveStoreOptions = {}): Store {
  if (options.forceLocal || selectsAttachmentsLocalStore(env)) {
    announceAttachmentsLocalMode(env);
    return new LocalStore();
  }
  const resolved = resolveAttachmentsV1(env);
  return new ApiStore(resolved.store!);
}

/** Convenience: filename from a path, matching the CLI's display behavior. */
export function displayName(path: string): string {
  return basename(path);
}