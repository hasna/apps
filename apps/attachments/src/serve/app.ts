/**
 * Attachments serve HTTP app.
 *
 * Surfaces the standard health/ready/version probes plus a versioned `/v1`
 * REST API guarded by @hasna/contracts API-key auth. PURE REMOTE (Amendment
 * A1): all metadata reads/writes go through the injected Postgres store; object
 * bytes live in S3 (or a local store in dev). No sync or cache in the service.
 */

import { Hono, type Context } from "hono";
import { nanoid } from "nanoid";
import { Readable } from "stream";
import { createCipheriv, randomBytes, scryptSync } from "crypto";
import { lookup as mimeLookup } from "mime-types";
import { verifyApiKey, type ApiKeyVerifier } from "@hasna/contracts/auth";
import type { PoolQueryClient } from "../server-storage/query.js";
import { checkHealth, checkReady } from "../server-storage/health.js";
import { PgAttachmentsStore } from "../db/pg-store.js";
import { ATTACHMENTS_MIGRATIONS } from "../db/migrations.js";
import type { Attachment } from "../core/db.js";
import type { AttachmentsConfig } from "../core/config.js";
import {
  getPublicBaseUrl,
  normalizePublicPath,
  parseExpiryStrict,
  resolveStorageBackend,
} from "../core/config.js";
import { createObjectStore } from "../core/object-storage.js";
import { S3Client } from "../core/s3.js";
import { openAttachmentStream, isExpired } from "../core/download.js";
import {
  PresignExpiryError,
  generatePresignedLink,
  generateShareLink,
  getLinkType,
  resolveDeliverableLinkType,
} from "../core/links.js";
import { sanitizeFilename, contentDispositionAttachment } from "../core/security.js";
import {
  buildArtifactManifest,
  canonicalBlobKey,
  isSha256Hex,
  manifestKey,
  sha256Hex,
  stagingKey,
} from "../core/artifact-keys.js";
import {
  FriendlySlugError,
  parseFriendlySlug,
  requireFriendlySlugPassword,
} from "../core/friendly-slug.js";
import { buildOpenApiDocument } from "./openapi.js";
import { registerCloudPublicRoutes } from "./public-routes.js";
import type { EmailSender } from "../core/email-gate.js";
import { isValidEmail } from "../core/security.js";

export interface ServeAppDeps {
  client: PoolQueryClient;
  store: PgAttachmentsStore;
  config: AttachmentsConfig;
  version: string;
  mode: string;
  signingSecret: string;
  /**
   * Key lifecycle verdict, wired straight into the 1.0.2 verifier as
   * `keyStatus` — the only hook form that can refuse keys this service has no
   * record of. `ApiKeyStore.keyStatus` implements it. Required: a serve app
   * without one cannot revoke anything, and the strict verifier refuses to
   * boot silently permissive.
   */
  keyStatus: (kid: string) => "active" | "revoked" | "unknown" | "expired" | Promise<"active" | "revoked" | "unknown" | "expired">;
  audit?: (event: unknown) => void;
  /**
   * Email sender for email-gated share links. When undefined, the public
   * routes resolve one from the environment (ATTACHMENTS_EMAIL_FROM +
   * ATTACHMENTS_RESEND_API_KEY or SES creds); pass null explicitly to force
   * the unconfigured path in tests.
   */
  emailSender?: EmailSender | null;
}

const APP_SLUG = "attachments";

function toApiAttachment(a: Attachment) {
  return {
    id: a.id,
    filename: a.filename,
    size: a.size,
    content_type: a.contentType,
    link: a.link,
    tag: a.tag,
    expires_at: a.expiresAt,
    created_at: a.createdAt,
    encrypted: !!a.encryptionAlgorithm,
  };
}

/** Thrown for caller mistakes that must surface as HTTP 400, never a bare 500. */
class BadRequestError extends Error {}
class ConflictError extends Error {}

/**
 * Turn a handler failure into a response. Caller mistakes become 400 with the
 * reason; anything else is logged in full and answered with a 500 that still
 * carries the message — these routes are API-key authenticated, and the opaque
 * "Internal Server Error" was exactly what made D1/D2 undiagnosable from the CLI.
 */
function badRequestOrRethrow(c: Context, err: unknown): Response {
  if (err instanceof BadRequestError || err instanceof PresignExpiryError) {
    return c.json({ error: err.message }, 400);
  }
  if (err instanceof ConflictError) {
    return c.json({ error: err.message }, 409);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[v1]", c.req.method, c.req.path, message);
  return c.json({ error: "Internal Server Error", detail: message }, 500);
}

function parseExpiryOr400(expiry: string): { milliseconds: number | null; never: boolean } {
  try {
    return parseExpiryStrict(expiry);
  } catch (err) {
    throw new BadRequestError(err instanceof Error ? err.message : String(err));
  }
}

function parseFriendlySlugOr400(slug: string): string {
  try {
    return parseFriendlySlug(slug);
  } catch (err) {
    if (err instanceof FriendlySlugError) throw new BadRequestError(err.message);
    throw err;
  }
}

/**
 * Validate a client-supplied base URL for a server-hosted share link
 * (`--internal` / `base_url`). The server mints the link against this address,
 * which must be the address through which THIS server (and therefore the share
 * token in its database) is actually reachable. Accepts only a clean absolute
 * http(s) URL: embedded credentials, query strings or fragments would either
 * leak into the minted link or make the token path unresolvable.
 */
function parseBaseUrlOr400(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BadRequestError("base_url must be an absolute http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BadRequestError("base_url must be an absolute http(s) URL");
  }
  if (parsed.username || parsed.password) {
    throw new BadRequestError("base_url must not embed credentials");
  }
  if (parsed.search || parsed.hash) {
    throw new BadRequestError("base_url must not carry a query string or fragment");
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined || value === "") return undefined;
  return value === "true" || value === "1";
}

/**
 * Parse the email-gate upload fields from any transport shape (multipart
 * string fields, JSON body, query params). `allowed_emails` accepts a
 * comma-separated string or (JSON bodies) an array. Invalid addresses are a
 * caller mistake → 400.
 */
function parseEmailGateFields(input: {
  requireEmail?: unknown;
  allowedEmails?: unknown;
}): { requireEmail?: boolean; allowedEmails?: string[] | null } {
  const requireEmail =
    typeof input.requireEmail === "boolean"
      ? input.requireEmail
      : parseBool(typeof input.requireEmail === "string" ? input.requireEmail : undefined);
  let raw: string[] = [];
  if (typeof input.allowedEmails === "string") {
    raw = input.allowedEmails
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
  } else if (Array.isArray(input.allowedEmails)) {
    raw = input.allowedEmails.filter((e): e is string => typeof e === "string");
  }
  const bad = raw.filter((e) => !isValidEmail(e));
  if (bad.length > 0) {
    throw new BadRequestError(`Invalid allowed_emails value(s): ${bad.join(", ")}`);
  }
  const allowedEmails = raw.length > 0 ? raw : null;
  return {
    requireEmail: requireEmail === true || allowedEmails !== null,
    allowedEmails,
  };
}

function isShareTokenConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    (message.includes("unique") || message.includes("duplicate")) &&
    (message.includes("token_hash") || message.includes("share_links"))
  );
}

interface ParsedMultipartUpload {
  filename: string;
  buffer: Buffer;
  contentType?: string;
  fields: Record<string, string>;
}

/**
 * Parse a `multipart/form-data` upload.
 *
 * D1(c): the old code had no multipart branch at all — it fell through to the
 * raw-body reader and stored the whole encoded envelope (boundary + part
 * headers) as the file, corrupting every multipart upload while also losing the
 * filename and content type.
 */
async function parseMultipartUpload(c: Context): Promise<ParsedMultipartUpload> {
  const form = await c.req.raw.formData();
  const fields: Record<string, string> = {};
  let file: File | null = null;
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    } else if (!file || key === "file") {
      file = value;
    }
  }
  if (!file) throw new BadRequestError("multipart/form-data upload requires a file part");
  const declaredName = file.name && file.name !== "blob" ? file.name : undefined;
  const filename = sanitizeFilename(
    declaredName ?? fields["filename"] ?? c.req.query("filename") ?? `upload_${nanoid(8)}`,
  );
  return {
    filename,
    buffer: Buffer.from(await file.arrayBuffer()),
    ...(file.type && file.type !== "application/octet-stream" ? { contentType: file.type } : {}),
    fields,
  };
}

async function uploadBufferToStore(
  config: AttachmentsConfig,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const store = createObjectStore(config);
  if (store instanceof S3Client) {
    await store.upload(key, body, contentType);
  } else {
    await store.uploadBuffer(key, body, contentType);
  }
}

/**
 * Encrypt a buffer at rest with the same scheme the local backend uses
 * (core/upload.ts buildEncryptionTransform): a per-upload random salt/iv and an
 * aes-256-gcm key derived from the caller-supplied password via scrypt. The
 * salt/iv/tag travel in the metadata row so the download path can re-derive
 * the key from the same password and verify the auth tag. Key material is the
 * password itself, never a master key: no key bytes are stored or logged.
 */
function encryptBuffer(
  password: string,
  buffer: Buffer,
): { buffer: Buffer; algorithm: string; salt: string; iv: string; tag: string } {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  return {
    buffer: Buffer.concat([cipher.update(buffer), cipher.final()]),
    algorithm: "aes-256-gcm",
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
  };
}

export function createServeApp(deps: ServeAppDeps): Hono {
  const app = new Hono();
  const { store, client, config, version, mode } = deps;
  const publicBaseUrl = getPublicBaseUrl(config);

  const verifier: ApiKeyVerifier = verifyApiKey({
    app: APP_SLUG,
    signingSecret: deps.signingSecret,
    // The strict 1.0.2 verifier demands a status hook — bare `isRevoked`
    // cannot refuse keys this service has no record of, and a service with no
    // hook at all cannot revoke anything. Production wires the store's
    // keyStatus; the type keeps the hook required, so a test fixture that
    // wants a permissive app says so with its own explicit stub.
    keyStatus: deps.keyStatus,
    ...(deps.audit ? { audit: deps.audit as never } : {}),
  });

  const publicPath = normalizePublicPath(config.server.publicPath);

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    if (c.req.path === publicPath || c.req.path.startsWith(`${publicPath}/`)) {
      // Same policy the on-box server applies to its public pages. `form-action
      // 'self'` is what lets the password form post back through whatever host
      // fronts this service.
      c.header(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      );
      c.header("Cache-Control", "no-store");
      if (publicBaseUrl.startsWith("https://") || c.req.header("x-forwarded-proto") === "https") {
        c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      }
    }
  });

  // Public share links (`/a/:token`). Registered before /v1 so the service that
  // MINTS these links is also the service that SERVES them (D3).
  registerCloudPublicRoutes(app, { store, config, emailSender: deps.emailSender });

  // Authenticate + enforce scopes for a /v1 request. Returns a Response on
  // failure (caller should return it), or null on success.
  async function requireScopes(c: Context, scopes: string[]): Promise<Response | null> {
    const decision = await verifier.authenticate(c.req.raw.headers, {
      method: c.req.method,
      path: c.req.path,
      requiredScopes: scopes,
    });
    if (!decision.ok) {
      return c.json({ error: decision.message, reason: decision.reason }, decision.status);
    }
    c.set("apiKey", decision.principal);
    return null;
  }

  // ── Health / ready / version ────────────────────────────────────────────
  app.get("/health", async (c) => {
    const health = await checkHealth(client);
    return c.json(
      { status: health.ok ? "ok" : "degraded", version, mode, db_latency_ms: health.latencyMs },
      health.ok ? 200 : 503,
    );
  });

  app.get("/ready", async (c) => {
    const ready = await checkReady(client, ATTACHMENTS_MIGRATIONS);
    return c.json(
      {
        status: ready.ok ? "ready" : "not_ready",
        version,
        mode,
        pending_migrations: ready.pendingMigrations,
        ...(ready.error ? { error: ready.error } : {}),
      },
      ready.ok ? 200 : 503,
    );
  });

  app.get("/version", (c) => c.json({ status: "ok", version, mode, name: `@hasna/${APP_SLUG}` }));

  app.get("/openapi.json", (c) => c.json(buildOpenApiDocument(version)));

  // ── /v1 API ──────────────────────────────────────────────────────────────
  app.get("/v1/slugs/:slug", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:read`]);
    if (denied) return denied;
    try {
      const slug = parseFriendlySlugOr400(c.req.param("slug"));
      const existing = await store.findShareLinkByToken(slug);
      return c.json({ slug, available: existing === null });
    } catch (err) {
      return badRequestOrRethrow(c, err);
    }
  });

  app.get("/v1/attachments", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:read`]);
    if (denied) return denied;
    const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : 50;
    const includeExpired = c.req.query("expired") === "true";
    const tag = c.req.query("tag") || undefined;
    const rows = await store.findAll({ limit, includeExpired, tag });
    return c.json(rows.map(toApiAttachment));
  });

  app.post("/v1/attachments", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:write`]);
    if (denied) return denied;

    const contentType = c.req.header("content-type") ?? "";
    let filename: string;
    let buffer: Buffer;
    let declaredContentType: string | undefined;
    let opts: {
      expiry?: string;
      tag?: string;
      password?: string;
      maxDownloads?: number;
      linkType?: "presigned" | "server";
      encrypt?: boolean;
      baseUrl?: string;
      requireEmail?: boolean;
      allowedEmails?: string[] | null;
    } = {};

    const parseLinkType = (value: string | undefined): "presigned" | "server" | undefined =>
      value === "presigned" || value === "server" ? value : undefined;
    const parseCount = (value: string | undefined): number | undefined => {
      if (value === undefined || value === "") return undefined;
      const parsed = parseInt(value, 10);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
    };

    try {
    if (contentType.includes("multipart/form-data")) {
      const parsed = await parseMultipartUpload(c);
      filename = parsed.filename;
      buffer = parsed.buffer;
      declaredContentType = parsed.contentType;
      opts = {
        expiry: parsed.fields["expiry"] ?? c.req.query("expiry") ?? undefined,
        tag: parsed.fields["tag"] ?? c.req.query("tag") ?? undefined,
        password: parsed.fields["password"] ?? c.req.header("x-attachments-password") ?? undefined,
        maxDownloads: parseCount(parsed.fields["max_downloads"] ?? c.req.query("max_downloads") ?? undefined),
        linkType: parseLinkType(parsed.fields["link_type"] ?? c.req.query("link_type") ?? undefined),
        encrypt: parsed.fields["encrypt"] === "true" || parsed.fields["encrypt"] === "1",
        baseUrl: parsed.fields["base_url"] ?? c.req.query("base_url") ?? undefined,
        ...parseEmailGateFields({
          requireEmail: parsed.fields["require_email"] ?? c.req.query("require_email") ?? undefined,
          allowedEmails: parsed.fields["allowed_emails"] ?? c.req.query("allowed_emails") ?? undefined,
        }),
      };
    } else if (contentType.includes("application/json")) {
      const body = (await c.req.json().catch(() => null)) as
        | {
            filename?: string;
            content_base64?: string;
            expiry?: string;
            tag?: string;
            password?: string;
            max_downloads?: number;
            link_type?: "presigned" | "server";
            encrypt?: boolean;
            base_url?: string;
            require_email?: boolean;
            allowed_emails?: string[] | string;
          }
        | null;
      if (!body?.filename || typeof body.content_base64 !== "string") {
        return c.json({ error: "filename and content_base64 are required" }, 400);
      }
      filename = sanitizeFilename(body.filename);
      buffer = Buffer.from(body.content_base64, "base64");
      opts = {
        expiry: body.expiry,
        tag: body.tag,
        password: body.password,
        maxDownloads: body.max_downloads,
        linkType: body.link_type,
        encrypt: body.encrypt === true,
        baseUrl: body.base_url,
        ...parseEmailGateFields({
          requireEmail: body.require_email,
          allowedEmails: body.allowed_emails,
        }),
      };
    } else {
      // Raw streaming upload: bytes in the request body.
      filename = sanitizeFilename(
        c.req.query("filename") ?? c.req.header("x-filename") ?? `upload_${nanoid(8)}`,
      );
      const ab = await c.req.arrayBuffer();
      buffer = Buffer.from(ab);
      opts = {
        expiry: c.req.query("expiry") ?? undefined,
        tag: c.req.query("tag") ?? undefined,
        password: c.req.header("x-attachments-password") ?? undefined,
        maxDownloads: c.req.query("max_downloads") ? parseInt(c.req.query("max_downloads")!, 10) : undefined,
        linkType:
          c.req.query("link_type") === "presigned" || c.req.query("link_type") === "server"
            ? (c.req.query("link_type") as "presigned" | "server")
            : undefined,
        encrypt:
          c.req.query("encrypt") === "true" ||
          c.req.query("encrypt") === "1" ||
          c.req.header("x-attachments-encrypt") === "true",
        baseUrl: c.req.query("base_url") ?? undefined,
        ...parseEmailGateFields({
          requireEmail: c.req.query("require_email") ?? undefined,
          allowedEmails: c.req.query("allowed_emails") ?? undefined,
        }),
      };
    }

    if (buffer.byteLength > config.storage.maxSizeBytes) {
      return c.json(
        { error: `File too large. Maximum size is ${config.storage.maxSizeBytes} bytes.` },
        413,
      );
    }

    const resolvedType =
      declaredContentType ?? ((mimeLookup(filename) || "application/octet-stream") as string);
    const id = `att_${nanoid(10)}`;
    const backend = resolveStorageBackend(config);
    const { milliseconds: expiryMs } = parseExpiryOr400(opts.expiry ?? config.defaults.expiry);
    const expiresAt = expiryMs !== null ? Date.now() + expiryMs : null;

    if (opts.encrypt && !opts.password) {
      return c.json(
        { error: "--encrypt requires a password so the file can be decrypted later" },
        400,
      );
    }
    // Same at-rest scheme as the local backend: encrypt BEFORE the bytes reach
    // the object store; the salt/iv/tag ride in the metadata row so the
    // download path re-derives the key from the same password.
    const encryption = opts.encrypt && opts.password ? encryptBuffer(opts.password, buffer) : null;
    const storedBytes = encryption ? encryption.buffer : buffer;
    // Content-addressed canonical key: the digest of the bytes actually stored
    // (ciphertext when encrypted). A duplicate upload lands on the same key —
    // an idempotent overwrite, never a second object.
    const objectKey = canonicalBlobKey(sha256Hex(storedBytes), filename);
    const linkBaseUrl = parseBaseUrlOr400(opts.baseUrl);

    const linkType = resolveDeliverableLinkType({
      requested: opts.linkType ?? getLinkType(config),
      backend,
      expiryMs,
      password: opts.password,
      encrypt: opts.encrypt,
      maxDownloads: opts.maxDownloads,
      requireEmail: opts.requireEmail,
    });

    const storeHandle = createObjectStore(config);
    const head = (storeHandle as { head?: (k: string) => Promise<unknown> }).head;
    let existing = false;
    if (typeof head === "function") {
      try {
        await head.call(storeHandle, objectKey);
        existing = true;
      } catch {
        // missing — upload below
      }
    }
    if (!existing) {
      await uploadBufferToStore(config, objectKey, storedBytes, resolvedType);
    }
    if (backend === "s3") {
      await uploadBufferToStore(
        config,
        manifestKey(id),
        Buffer.from(
          JSON.stringify(
            buildArtifactManifest({
              id,
              sha256: sha256Hex(storedBytes),
              byteSize: storedBytes.byteLength,
              contentType: resolvedType,
              filename,
              createdAt: Date.now(),
              storageKey: objectKey,
            }),
            null,
            2,
          ),
        ),
        "application/json",
      );
    }

    let link: string | null = null;
    if (linkType === "presigned") {
      link = await generatePresignedLink(new S3Client(config.s3), objectKey, expiryMs);
    }

    const attachment: Attachment = {
      id,
      filename,
      s3Key: objectKey,
      bucket: backend === "s3" ? config.s3.bucket : "local",
      size: buffer.byteLength,
      contentType: resolvedType,
      link,
      tag: opts.tag ?? null,
      expiresAt,
      createdAt: Date.now(),
      storageBackend: backend,
      status: "ready",
      encryptionAlgorithm: encryption?.algorithm ?? null,
      encryptionSalt: encryption?.salt ?? null,
      encryptionIv: encryption?.iv ?? null,
      encryptionTag: encryption?.tag ?? null,
      downloads: 0,
      contentSha256: sha256Hex(storedBytes),
    };
    await store.insert(attachment);

    if (linkType === "server") {
      const { token } = await store.createShareLink({
        attachmentId: id,
        expiresAt,
        password: opts.password,
        maxUses: opts.maxDownloads ?? null,
        requireEmail: opts.requireEmail,
        allowedEmails: opts.allowedEmails,
      });
      link = generateShareLink(token, linkBaseUrl ?? publicBaseUrl, config.server.publicPath);
      await store.updateLink(id, link, expiresAt);
      attachment.link = link;
    }

    return c.json(toApiAttachment(attachment), 201);
    } catch (err) {
      return badRequestOrRethrow(c, err);
    }
  });

  app.get("/v1/attachments/:id", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:read`]);
    if (denied) return denied;
    const attachment = await store.findById(c.req.param("id"));
    if (!attachment) return c.json({ error: "Not found" }, 404);
    return c.json(toApiAttachment(attachment));
  });

  app.delete("/v1/attachments/:id", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:write`]);
    if (denied) return denied;
    const id = c.req.param("id");
    const attachment = await store.findById(id);
    if (!attachment) return c.json({ error: "Not found" }, 404);
    try {
      await createObjectStore(config).delete(attachment.s3Key);
    } catch {
      // Object deletion failure is non-fatal for metadata cleanup.
    }
    await store.delete(id);
    return c.json({ deleted: true, id });
  });

  app.get("/v1/attachments/:id/download", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:read`]);
    if (denied) return denied;
    const attachment = await store.findById(c.req.param("id"));
    if (!attachment) return c.json({ error: "Not found" }, 404);
    if (isExpired(attachment)) return c.json({ error: "Attachment has expired" }, 410);
    // Encrypted attachments decrypt on the server with the caller-supplied
    // password (same contract as the local backend); a missing password is a
    // caller mistake and answers 400, never a bare 500.
    const password = c.req.header("x-attachments-password");
    if (attachment.encryptionAlgorithm && !password) {
      return c.json({ error: "Attachment is encrypted and requires a password" }, 400);
    }
    let result;
    try {
      result = await openAttachmentStream(attachment, {
        config,
        rangeHeader: c.req.header("range"),
        password,
      });
    } catch (err: unknown) {
      return badRequestOrRethrow(c, err);
    }
    c.header("Content-Disposition", contentDispositionAttachment(attachment.filename));
    c.header("Content-Type", result.contentType ?? attachment.contentType);
    if (result.contentLength !== undefined) c.header("Content-Length", String(result.contentLength));
    const body =
      typeof (result.body as Readable).pipe === "function"
        ? (Readable.toWeb(result.body as Readable) as unknown as ReadableStream<Uint8Array>)
        : (result.body as ReadableStream<Uint8Array>);
    await store.incrementDownloads(attachment.id);
    return c.body(body as never, result.status);
  });

  app.get("/v1/attachments/:id/link", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:read`]);
    if (denied) return denied;
    const attachment = await store.findById(c.req.param("id"));
    if (!attachment) return c.json({ error: "Not found" }, 404);
    return c.json({ link: attachment.link, expires_at: attachment.expiresAt });
  });

  app.post("/v1/attachments/:id/link", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:write`]);
    if (denied) return denied;
    const id = c.req.param("id");
    const attachment = await store.findById(id);
    if (!attachment) return c.json({ error: "Not found" }, 404);

    const body = (await c.req.json().catch(() => ({}))) as {
      expiry?: string;
      password?: string;
      max_downloads?: number;
      link_type?: "presigned" | "server";
      slug?: string;
      base_url?: string;
    };
    try {
      const slug = body.slug ? parseFriendlySlugOr400(body.slug) : undefined;
      const linkBaseUrl = parseBaseUrlOr400(body.base_url);
      try {
        requireFriendlySlugPassword(slug, body.password);
      } catch (err) {
        if (err instanceof FriendlySlugError) throw new BadRequestError(err.message);
        throw err;
      }
      if (slug && (await store.findShareLinkByToken(slug))) {
        throw new ConflictError(`Friendly slug is already in use: ${slug}`);
      }
      const { milliseconds: expiryMs } = parseExpiryOr400(body.expiry ?? config.defaults.expiry);
      const newExpiresAt = expiryMs !== null ? Date.now() + expiryMs : null;
      const linkType = resolveDeliverableLinkType({
        requested: body.link_type ?? config.defaults.linkType,
        backend: attachment.storageBackend ?? "s3",
        expiryMs,
        password: body.password,
        maxDownloads: body.max_downloads,
        slug,
      });

      let newLink: string;
      if (linkType === "presigned") {
        newLink = await generatePresignedLink(new S3Client(config.s3), attachment.s3Key, expiryMs);
      } else {
        let token: string;
        try {
          ({ token } = await store.createShareLink({
            attachmentId: id,
            expiresAt: newExpiresAt,
            token: slug,
            password: body.password,
            maxUses: body.max_downloads ?? null,
          }));
        } catch (err) {
          if (slug && isShareTokenConflict(err)) {
            throw new ConflictError(`Friendly slug is already in use: ${slug}`);
          }
          throw err;
        }
        newLink = generateShareLink(token, linkBaseUrl ?? publicBaseUrl, config.server.publicPath);
      }
      await store.updateLink(id, newLink, newExpiresAt);
      return c.json({
        link: newLink,
        expires_at: newExpiresAt,
        link_type: linkType,
        ...(slug ? { slug } : {}),
      });
    } catch (err) {
      return badRequestOrRethrow(c, err);
    }
  });

  app.post("/v1/attachments/presign-upload", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:write`]);
    if (denied) return denied;
    try {
      const body = (await c.req.json().catch(() => null)) as
        | { filename?: string; content_type?: string; expiry?: string; size?: number; sha256?: string }
        | null;
      if (!body?.filename) {
        return c.json({ error: "filename is required" }, 400);
      }
      if (resolveStorageBackend(config) !== "s3") {
        throw new BadRequestError("presigned upload requires an S3 storage backend");
      }
      if (typeof body.size === "number" && body.size > config.storage.maxSizeBytes) {
        return c.json({ error: `File too large. Maximum size is ${config.storage.maxSizeBytes} bytes.` }, 413);
      }
      const filename = sanitizeFilename(body.filename);
      const contentType =
        body.content_type ?? ((mimeLookup(filename) || "application/octet-stream") as string);
      const { milliseconds: expiryMs, never } = parseExpiryOr400(body.expiry ?? "1h");
      if (never) throw new BadRequestError("Presigned upload expiry cannot be never");
      const expirySeconds = Math.floor(expiryMs! / 1000);
      const id = `att_${nanoid(10)}`;
      const clientSha256 = typeof body.sha256 === "string" && body.sha256.trim() !== "" ? body.sha256.trim().toLowerCase() : undefined;
      if (clientSha256 !== undefined && !isSha256Hex(clientSha256)) {
        throw new BadRequestError("sha256 must be a lowercase hex sha-256 digest");
      }
      // Content-addressed canonical key when the client digests its bytes up
      // front (a duplicate upload lands on the same object); a staging key in
      // the compatibility namespace otherwise. Rows persist whichever key was
      // minted, so both are resolvable for the whole migration window.
      const objectKey = clientSha256 ? canonicalBlobKey(clientSha256, filename) : stagingKey(id);
      const uploadUrl = await new S3Client(config.s3).presignPut(objectKey, contentType, expirySeconds, clientSha256);
      const now = Date.now();
      await store.insert({
        id,
        filename,
        s3Key: objectKey,
        bucket: config.s3.bucket,
        size: 0,
        contentType,
        link: null,
        tag: null,
        expiresAt: now + expiryMs!,
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
      return c.json(
        {
          id,
          upload_url: uploadUrl,
          content_type: contentType,
          filename,
          expires_at: now + expiryMs!,
          finalize_url: `/v1/attachments/${id}/presign-upload/complete`,
        },
        201,
      );
    } catch (err) {
      return badRequestOrRethrow(c, err);
    }
  });

  app.post("/v1/attachments/:id/presign-upload/complete", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:write`]);
    if (denied) return denied;
    const id = c.req.param("id");
    let body: { expiry?: string; password?: string; max_downloads?: number; link_type?: "presigned" | "server" } = {};
    try {
      body = await c.req.json();
    } catch {
      // Body is optional; defaults come from config.
    }
    try {
      const attachment = await store.findById(id);
      if (!attachment) return c.json({ error: "Pending attachment not found" }, 404);
      if (attachment.status !== "pending") return c.json({ error: "Attachment upload is already complete" }, 409);
      if (resolveStorageBackend(config) !== "s3") {
        throw new BadRequestError("presigned upload requires an S3 storage backend");
      }

      const s3 = new S3Client(config.s3);
      const info = await s3.head(attachment.s3Key);
      if (info.contentLength !== undefined && info.contentLength > config.storage.maxSizeBytes) {
        await createObjectStore(config).delete(attachment.s3Key).catch(() => undefined);
        await store.delete(id);
        return c.json({ error: `File too large. Maximum size is ${config.storage.maxSizeBytes} bytes.` }, 413);
      }
      // When the creating client supplied a digest, the object must carry it:
      // a content-addressed key whose bytes disagree with the key would serve
      // corrupt bytes under another object's address.
      if (
        attachment.contentSha256 &&
        info.checksumSha256 !== undefined &&
        info.checksumSha256 !== attachment.contentSha256
      ) {
        await createObjectStore(config).delete(attachment.s3Key).catch(() => undefined);
        await store.delete(id);
        return c.json(
          { error: `Uploaded object checksum does not match the declared sha256 (${attachment.contentSha256.slice(0, 12)}…)` },
          400,
        );
      }
      // Publish the per-row artifact manifest (S3 store).
      await uploadBufferToStore(
        config,
        manifestKey(id),
        Buffer.from(
          JSON.stringify(
            buildArtifactManifest({
              id,
              sha256: attachment.contentSha256 ?? undefined,
              byteSize: info.contentLength ?? attachment.size,
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
      const { milliseconds: expiryMs } = parseExpiryOr400(body.expiry ?? config.defaults.expiry);
      const expiresAt = expiryMs !== null ? Date.now() + expiryMs : null;
      const maxDownloads =
        typeof body.max_downloads === "number" && body.max_downloads > 0 ? Math.floor(body.max_downloads) : undefined;
      const linkType = resolveDeliverableLinkType({
        requested: body.link_type ?? getLinkType(config),
        backend: attachment.storageBackend ?? "s3",
        expiryMs,
        password: body.password,
        maxDownloads,
      });

      let link: string;
      if (linkType === "presigned") {
        link = await generatePresignedLink(s3, attachment.s3Key, expiryMs);
      } else {
        const { token } = await store.createShareLink({
          attachmentId: id,
          expiresAt,
          password: body.password,
          maxUses: maxDownloads ?? null,
        });
        link = generateShareLink(token, publicBaseUrl, publicPath);
        await store.updateLink(id, link, expiresAt);
      }
      const size = info.contentLength ?? attachment.size;
      await store.markReady({
        id,
        size,
        contentType: info.contentType ?? attachment.contentType,
        link,
        expiresAt,
      });
      const ready = (await store.findById(id)) ?? { ...attachment, size, link };
      return c.json({ attachment: toApiAttachment(ready), link, size });
    } catch (err) {
      return badRequestOrRethrow(c, err);
    }
  });

  app.post("/v1/feedback", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:write`]);
    if (denied) return denied;
    const body = (await c.req.json().catch(() => ({}))) as {
      message?: string;
      email?: string | null;
      category?: string;
      version?: string | null;
    };
    if (!body.message || typeof body.message !== "string" || body.message.trim() === "") {
      return c.json({ error: "message is required" }, 400);
    }
    await store.saveFeedback({
      message: body.message,
      email: typeof body.email === "string" ? body.email : null,
      category: typeof body.category === "string" ? body.category : "general",
      version: typeof body.version === "string" ? body.version : null,
    });
    return c.json({ ok: true });
  });

  return app;
}
