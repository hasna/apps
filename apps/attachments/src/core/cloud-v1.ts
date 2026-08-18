// Storage resolver for the attachments CLI, built on the @hasna/contracts
// client seam.
//
// LOCKED ARCHITECTURE: when `HASNA_ATTACHMENTS_API_URL` + `HASNA_ATTACHMENTS_API_KEY`
// are set, every read and write routes to the app's cloud HTTP API at
// `<API_URL>/v1` with the bearer key — never the local SQLite store, never a raw
// DSN. The toggle is the presence of the two env vars (that is what the fleet
// flip tool writes): the contracts client resolves the http transport when the
// pair is present, and the local store otherwise. There is no storage-mode
// variable; the 0.11.1 seam refuses one.
//
// SAFETY: the API key never appears in logs or return values. It lives only
// inside the contracts transport (and, for the binary download stream that the
// JSON transport can't carry, a single scoped fetch below that resolves the key
// through the seam's resolveCredential).

import { createWriteStream, existsSync, statSync } from "fs";
import { basename, join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { lookup as mimeLookup } from "mime-types";
import { resolveCredential } from "@hasna/contracts/client";
import { resolveStorageClient, type HasnaStorageClient } from "@hasna/contracts/client/storage";
import type { Attachment } from "./db";

const APP_SLUG = "attachments";

type JsonFetch = typeof fetch;

/** Transport overrides accepted by the contracts client seam (test injection). */
type ResolveStorageClientOverrides = Parameters<typeof resolveStorageClient>[2];

/** The `/v1` attachment envelope (snake_case) returned by the serve API. */
type ApiAttachment = {
  id: string;
  filename: string;
  size: number;
  content_type?: string;
  link: string | null;
  tag?: string | null;
  expires_at?: number | null;
  created_at?: number;
  encrypted?: boolean;
};

export interface V1UploadOptions {
  expiry?: string;
  tag?: string;
  password?: string;
  maxDownloads?: number;
  linkType?: "presigned" | "server";
  encrypt?: boolean;
  requireEmail?: boolean;
  allowedEmails?: string[] | null;
  filename?: string;
  /** Custom base URL for a server-hosted share link (e.g. an internal/Tailscale address). */
  baseUrl?: string;
}

export interface V1ListOptions {
  limit?: number;
  includeExpired?: boolean;
  tag?: string;
}

export interface V1DownloadResult {
  path: string;
  filename: string;
  size: number;
}

/** The record-level storage surface the CLI needs, backed by `<API_URL>/v1`. */
export interface AttachmentsV1Store {
  readonly baseUrl: string;
  list(options?: V1ListOptions): Promise<Attachment[]>;
  get(id: string): Promise<Attachment | null>;
  uploadBuffer(filename: string, bytes: Uint8Array, options?: V1UploadOptions): Promise<Attachment>;
  uploadFile(path: string, options?: V1UploadOptions): Promise<Attachment>;
  uploadStream(stream: NodeJS.ReadableStream, filename: string, options?: V1UploadOptions): Promise<Attachment>;
  uploadUrl(url: string, options?: V1UploadOptions): Promise<Attachment>;
  delete(id: string): Promise<void>;
  getLink(id: string): Promise<{ link: string | null; expires_at: number | null }>;
  isSlugAvailable(slug: string): Promise<boolean>;
  regenerateLink(
    id: string,
    options: {
      expiry?: string;
      password?: string;
      maxDownloads?: number;
      linkType?: "presigned" | "server";
      slug?: string;
      baseUrl?: string;
    },
  ): Promise<{ link: string | null; expires_at: number | null; slug?: string }>;
  download(id: string, output: string | undefined, options?: { password?: string }): Promise<V1DownloadResult>;
  saveFeedback(input: { message: string; email?: string | null; category?: string; version?: string | null }): Promise<void>;
  presignUpload(
    filename: string,
    contentType: string | undefined,
    expiryMs: number,
  ): Promise<{ id: string; uploadUrl: string; contentType: string; filename: string; expiresAt: number }>;
  presignComplete(
    id: string,
    options: { expiryMs: number | null; password?: string; maxDownloads?: number; linkType: "presigned" | "server" },
  ): Promise<{ attachment: Attachment; link: string; size: number }>;
}

/**
 * Round-trip a parsed expiry (ms) back to a parseable duration string so the
 * /v1 server (which parses "30m"/"24h"/"7d"/"never") accepts it. Every value
 * `parseExpiryStrict` can produce divides evenly into a whole-unit string.
 */
function expiryMsToString(expiryMs: number | null): string {
  if (expiryMs === null) return "never";
  if (expiryMs % 86400000 === 0) return `${expiryMs / 86400000}d`;
  if (expiryMs % 3600000 === 0) return `${expiryMs / 3600000}h`;
  return `${Math.ceil(expiryMs / 60000)}m`;
}

export type ResolveAttachmentsV1Result =
  | { transport: "cloud-http"; store: AttachmentsV1Store }
  | { transport: "local"; store: null };

function toAttachment(input: ApiAttachment): Attachment {
  return {
    id: input.id,
    filename: input.filename,
    s3Key: "",
    bucket: "cloud",
    size: input.size,
    contentType: input.content_type ?? "application/octet-stream",
    link: input.link,
    tag: input.tag ?? null,
    expiresAt: input.expires_at ?? null,
    createdAt: input.created_at ?? Date.now(),
    storageBackend: "s3",
    status: "ready",
  };
}

/**
 * Resolve the attachments storage backend for this process through the
 * @hasna/contracts client seam. Returns a `cloud-http` store wired to
 * `<API_URL>/v1` when the seam resolves the http transport (API URL + key
 * present), otherwise `{ transport: 'local' }` so the caller uses the local
 * SQLite store. The seam throws when an API URL is set without a key
 * (misconfigured), so a client never silently drifts back to local.
 */
export function resolveAttachmentsV1(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: ResolveStorageClientOverrides,
): ResolveAttachmentsV1Result {
  const resolved = resolveStorageClient(APP_SLUG, env, overrides);
  if (resolved.transport !== "http") return { transport: "local", store: null };
  return { transport: "cloud-http", store: makeStore(resolved.client, env) };
}

/**
 * Build a diagnosable client-side error for a failed API call.
 *
 * D1(a): the previous message was just the raw response body, so a server that
 * answered `Internal Server Error` produced a CLI error of exactly
 * "Internal Server Error" — no status, no route, no server-side reason. Every
 * failure then required CloudWatch to identify. The API key is never included.
 */
export function describeApiFailure(
  method: string,
  path: string,
  status: number,
  body: string,
): string {
  const route = `${method.toUpperCase()} /v1${path}`;
  let reason = body.trim();
  if (reason.startsWith("{")) {
    try {
      const parsed = JSON.parse(reason) as { error?: unknown; detail?: unknown; message?: unknown };
      const parts = [parsed.error, parsed.detail ?? parsed.message]
        .filter((v): v is string => typeof v === "string" && v.trim() !== "");
      if (parts.length > 0) reason = Array.from(new Set(parts)).join(" — ");
    } catch {
      /* keep the raw body */
    }
  }
  if (reason.length > 500) reason = `${reason.slice(0, 500)}…`;
  return reason
    ? `${route} failed: HTTP ${status} — ${reason}`
    : `${route} failed: HTTP ${status}`;
}

function makeStore(client: HasnaStorageClient, env: NodeJS.ProcessEnv): AttachmentsV1Store {
  const uploadBody = (filename: string, bytes: Uint8Array, options: V1UploadOptions) => ({
    filename,
    content_base64: Buffer.from(bytes).toString("base64"),
    ...(options.expiry ? { expiry: options.expiry } : {}),
    ...(options.tag ? { tag: options.tag } : {}),
    ...(options.password ? { password: options.password } : {}),
    ...(options.maxDownloads ? { max_downloads: options.maxDownloads } : {}),
    ...(options.linkType ? { link_type: options.linkType } : {}),
    ...(options.encrypt ? { encrypt: true } : {}),
    ...(options.baseUrl ? { base_url: options.baseUrl } : {}),
    ...(options.requireEmail !== undefined ? { require_email: options.requireEmail } : {}),
    ...(options.allowedEmails && options.allowedEmails.length > 0
      ? { allowed_emails: options.allowedEmails }
      : {}),
  });

  const store: AttachmentsV1Store = {
    baseUrl: client.baseUrl,

    async list(options: V1ListOptions = {}): Promise<Attachment[]> {
      const query: Record<string, string> = {};
      if (options.limit) query.limit = String(options.limit);
      if (options.includeExpired) query.expired = "true";
      if (options.tag) query.tag = options.tag;
      const result = await client.list<ApiAttachment>("attachments", { query });
      return result.items.map(toAttachment);
    },

    async get(id: string): Promise<Attachment | null> {
      const row = await client.get<ApiAttachment>("attachments", id);
      return row ? toAttachment(row) : null;
    },

    async uploadBuffer(filename: string, bytes: Uint8Array, options: V1UploadOptions = {}): Promise<Attachment> {
      const created = await client.create<ApiAttachment>("attachments", uploadBody(filename, bytes, options));
      return toAttachment(created);
    },

    async uploadFile(path: string, options: V1UploadOptions = {}): Promise<Attachment> {
      const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
      return store.uploadBuffer(options.filename || basename(path), bytes, options);
    },

    async uploadStream(stream: NodeJS.ReadableStream, filename: string, options: V1UploadOptions = {}): Promise<Attachment> {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return store.uploadBuffer(options.filename || filename, Buffer.concat(chunks), options);
    },

    async uploadUrl(url: string, options: V1UploadOptions = {}): Promise<Attachment> {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const parsed = new URL(url);
      const filename = options.filename || decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "download");
      return store.uploadBuffer(filename, bytes, options);
    },

    async delete(id: string): Promise<void> {
      await client.delete("attachments", id);
    },

    async getLink(id: string): Promise<{ link: string | null; expires_at: number | null }> {
      return client.transport.get(`/attachments/${encodeURIComponent(id)}/link`);
    },

    async isSlugAvailable(slug: string): Promise<boolean> {
      const result = await client.transport.get<{ slug: string; available: boolean }>(
        `/slugs/${encodeURIComponent(slug)}`,
      );
      return result.available;
    },

    async regenerateLink(id, options): Promise<{ link: string | null; expires_at: number | null }> {
      return client.transport.post(`/attachments/${encodeURIComponent(id)}/link`, {
        expiry: options.expiry,
        password: options.password,
        max_downloads: options.maxDownloads,
        link_type: options.linkType,
        slug: options.slug,
        base_url: options.baseUrl,
      });
    },

    async download(id: string, output: string | undefined, options: { password?: string } = {}): Promise<V1DownloadResult> {
      // The JSON transport can't carry a binary stream, so hit the download route
      // directly with a scoped fetch. The key is resolved through the contracts
      // seam (resolveCredential) — the same credential the transport uses; it is
      // never logged or returned.
      const apiUrl = client.baseUrl.replace(/\/+$/, "");
      const apiKey = resolveCredential("attachments", env)?.apiKey ?? "";
      const response = await fetch(`${apiUrl}/attachments/${encodeURIComponent(id)}/download`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "x-api-key": apiKey,
          ...(options.password ? { "x-attachments-password": options.password } : {}),
        },
      });
      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => "");
        throw new Error(text || `Download failed with HTTP ${response.status}`);
      }
      const disposition = response.headers.get("content-disposition");
      const match = disposition ? /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition) : null;
      const filename = (match ? decodeURIComponent(match[1]!.replace(/^"|"$/g, "")) : null)
        || basename(new URL(response.url).pathname)
        || "attachment";
      const path = resolveDownloadPath(output, filename);
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(path));
      return { path, filename, size: Number(response.headers.get("content-length") || statSync(path).size) };
    },

    async saveFeedback(input): Promise<void> {
      await client.transport.post("/feedback", {
        message: input.message,
        email: input.email ?? null,
        category: input.category ?? "general",
        version: input.version ?? null,
      });
    },

    async presignUpload(filename: string, contentType: string | undefined, expiryMs: number) {
      if (expiryMs === null || expiryMs <= 0) {
        throw new Error("Presigned upload expiry cannot be never");
      }
      const detected = mimeLookup(filename);
      const resolvedType = contentType ?? (detected !== false ? detected : "application/octet-stream");
      const result = await client.transport.post<{
        id: string;
        upload_url: string;
        expires_at?: number;
      }>("/attachments/presign-upload", {
        filename,
        content_type: resolvedType,
        expiry: expiryMsToString(expiryMs),
      });
      return {
        id: result.id,
        uploadUrl: result.upload_url,
        contentType: resolvedType,
        filename,
        expiresAt: result.expires_at ?? Date.now() + expiryMs,
      };
    },

    async presignComplete(id, options) {
      const result = await client.transport.post<{
        attachment: ApiAttachment;
        link: string;
        size: number;
      }>(`/attachments/${encodeURIComponent(id)}/presign-upload/complete`, {
        expiry: expiryMsToString(options.expiryMs),
        password: options.password,
        max_downloads: options.maxDownloads,
        link_type: options.linkType,
      });
      return { attachment: toAttachment(result.attachment), link: result.link, size: result.size };
    },
  };
  return store;
}

function resolveDownloadPath(output: string | undefined, filename: string): string {
  if (!output) return join(process.cwd(), filename);
  if (existsSync(output) && statSync(output).isDirectory()) return join(output, filename);
  if (output.endsWith("/") || output.endsWith("\\")) return join(output, filename);
  return output;
}
