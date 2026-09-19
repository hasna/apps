import { basename } from "path";
import type { Attachment } from "./db";
import type { UploadOptions } from "./upload";
import type { DownloadResult } from "./download";
import { resolveAttachmentsV1, type AttachmentsV1Store, type V1UploadOptions } from "./cloud-v1";

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
 * The authenticated {@link ApiStore} implements it so a
 * caller never branches on transport.
 */
export interface Store {
  /** Which transport backs this store — for diagnostics only, not for branching logic. */
  readonly transport: "cloud-http";
  /** Authenticated `<origin>/v1` base URL. */
  readonly baseUrl: string;

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

  /** Persist feedback through the authenticated service. */
  saveFeedback(input: FeedbackInput): Promise<void>;

  /** Mint a presigned upload URL through the service; no client S3 credentials. */
  presignUpload(
    filename: string,
    contentType: string | undefined,
    expiryMs: number,
    sha256?: string,
  ): Promise<{ id: string; uploadUrl: string; contentType: string; filename: string }>;

  /** Finalize a presigned direct upload: verify size, generate the link, mark ready. */
  presignComplete(
    id: string,
    options: { expiryMs: number | null; password?: string; maxDownloads?: number; linkType: "presigned" | "server" },
  ): Promise<{ attachment: Attachment; link: string; size: number }>;

  /** Release any held resources (DB handles). Always safe to call. */
  close(): void;
}

/** All upload options are honored on the hosted /v1 path; kept as the single refusal point for any future option. */
function assertApiSupported(options: UploadOptions | undefined): void {
  if (!options) return;
}

function toV1UploadOptions(options: UploadOptions = {}): V1UploadOptions {
  assertApiSupported(options);
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

/** Authenticated HTTPS Store. */
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
  /** Retired option: true is rejected. */
  forceLocal?: boolean;
}

/** Resolve HTTPS credentials before any client data operation. */
export function resolveStore(env: NodeJS.ProcessEnv = process.env, options: ResolveStoreOptions = {}): Store {
  if (options.forceLocal) throw new Error("Local client storage is retired; configure the authenticated HTTPS API.");
  const resolved = resolveAttachmentsV1(env);
  return new ApiStore(resolved.store!);
}

/** Convenience: filename from a path, matching the CLI's display behavior. */
export function displayName(path: string): string {
  return basename(path);
}
