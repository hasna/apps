// TEST ONLY: preserves mocked command/MCP behavior during the transport migration.
// Never imported by production entry points or included in package declarations.
import { basename } from "path";
import { nanoid } from "nanoid";
import { lookup as mimeLookup } from "mime-types";
import type { Attachment } from "../core/db";
import { AttachmentsDB } from "../core/db";
import { S3Client } from "../core/s3";
import { LocalObjectStore } from "../core/object-storage";
import {
  getConfig,
  parseExpiryStrict,
  validateS3Config,
  validateStorageConfig,
  type AttachmentsConfig,
} from "../core/config";
import {
  generatePresignedLink,
  generateShareLink,
  getLinkType,
  resolveDeliverableLinkType,
  resolveLocalShareBaseUrl,
} from "../core/links";
<<<<<<< HEAD
import { sanitizeFilename } from "../core/security";
=======
import { createObjectKey, sanitizeFilename } from "../core/security";
>>>>>>> 7d0a86135 (wip: contracts paths resolver + migrate src modules (ruling #1668))
import { stagingKey } from "../core/artifact-keys";
import {
  uploadFile as coreUploadFile,
  uploadFromUrl as coreUploadFromUrl,
  uploadFromBuffer as coreUploadFromBuffer,
  uploadStreamAttachment as coreUploadStream,
  type UploadOptions,
} from "../core/upload";
import { downloadAttachment, type DownloadResult } from "../core/download";
import { resolveAttachmentsV1, type AttachmentsV1Store, type V1UploadOptions } from "../core/cloud-v1";
import { parseFriendlySlug, requireFriendlySlugPassword } from "../core/friendly-slug";


import type { Store, LinkResult, ListOptions, FeedbackInput, RegenerateLinkOptions } from "../core/store";
export class MockedStoreFixture implements Store {
  readonly transport = "local" as const;
  readonly baseUrl = null;

  private _db: AttachmentsDB | null = null;
  private readonly config: AttachmentsConfig;

  constructor(config?: AttachmentsConfig) {
    this.config = config ?? getConfig();
  }

  private db(): AttachmentsDB {
    if (!this._db) this._db = new AttachmentsDB(":memory:");
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
  ): Promise<{ id: string; uploadUrl: string; contentType: string; filename: string }> {
    validateS3Config(this.config);
    const filename = sanitizeFilename(filenameInput);
    const detected = mimeLookup(filename);
    const contentType = contentTypeInput ?? (detected !== false ? detected : "application/octet-stream");
    const id = `att_${nanoid(11)}`;
    // Fixture mirrors a legacy client that does not digest its bytes up
    // front: the server mints a staging key (compatibility namespace) and the
    // row keeps it verbatim, so reads resolve unchanged.
    const s3Key = stagingKey(id);
    const uploadUrl = await new S3Client(this.config.s3).presignPut(s3Key, contentType, Math.floor(expiryMs / 1000));
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
    });
    return { id, uploadUrl, contentType, filename };
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
