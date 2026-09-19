/**
 * Public share-link routes (`/a/:token`) for the CLOUD service.
 *
 * D3 root cause: `createServeApp` only ever exposed `/health`, `/ready`,
 * `/version` and `/v1/*`, yet it hands out `<public base>/a/<token>` links —
 * including every password-protected link, because passwords force a
 * server-hosted link. Those links 404'd because the route did not exist in this
 * service at all.
 *
 * These handlers mirror the on-box routes in `src/api/routes/public.ts` but run
 * against the injected Postgres store. The access policy, the rendered pages and
 * the password throttle are all shared modules — this file only wires them to
 * the async store, it does not restate any rule.
 */

import type { Context, Hono } from "hono";
import type { Attachment } from "../core/db.js";
import type { AttachmentsConfig } from "../core/config.js";
import { getPublicBaseUrl, normalizePublicPath } from "../core/config.js";

/**
 * The emailed grant URL. The share link was minted at upload time against the
 * requested `base_url` when one was given (`--internal` / `base_url`), and the
 * stored `attachment.link` carries that choice — including any path the base
 * URL bore (`https://host/gateway` mints `https://host/gateway/a/<token>`).
 * Emailing a grant against a different base would hand the recipient a link
 * that either does not resolve on the uploader's chosen host/path or escapes
 * the internal routing the uploader selected. So the grant rides on the stored
 * link itself when it is an absolute http(s) URL; fall back to the configured
 * public base only when no such stored link exists.
 */
function grantLinkUrl(
  config: AttachmentsConfig,
  attachment: Attachment,
  token: string,
  publicPath: string,
  grant: string,
): string {
  const stored = attachment.link;
  if (stored) {
    try {
      const parsed = new URL(stored);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        const separator = parsed.search ? "&" : "?";
        return `${stored}${separator}grant=${encodeURIComponent(grant)}`;
      }
    } catch {
      // fall through to the configured public base
    }
  }
  return `${getPublicBaseUrl(config)}${sharePagePath(token, publicPath)}?grant=${encodeURIComponent(grant)}`;
}
import { openAttachmentStream } from "../core/download.js";
import { contentDispositionAttachment } from "../core/security.js";
import {
  ShareAccessError,
  resolveShareAccessAsync,
  type AsyncShareAccessSource,
  type ShareAccessResult,
} from "../core/share.js";
import {
  EmailGateError,
  requestAccessGrantAsync,
  verifyAccessGrantAsync,
  type AsyncEmailGateSource,
  type EmailSender,
} from "../core/email-gate.js";
import { resolveEmailSender } from "../core/email-sender.js";
import {
  PasswordThrottle,
  clientIdentity,
  parseTrustedProxies,
  passwordFailureKey,
} from "../core/password-throttle.js";
import {
  renderDownloadPage,
  renderPublicErrorPage,
  renderShareAccessError,
  sharePagePath,
} from "../api/public-pages.js";
import { toWebBody } from "../api/streams.js";

/** The store the public routes need: share-link access plus email-gate grants. */
export type CloudPublicStore = AsyncShareAccessSource & AsyncEmailGateSource;

export interface CloudPublicRoutesDeps {
  store: CloudPublicStore;
  config: AttachmentsConfig;
  /**
   * Trust `x-forwarded-for` & friends when identifying a caller for throttling.
   * The cloud service always sits behind an ALB (and usually a Caddy in front of
   * that), so it defaults to on; set ATTACHMENTS_TRUST_PROXY=0 to disable.
   */
  trustProxy?: boolean;
  /**
   * Addresses of proxies we operate in front of this service (the Caddy that
   * fronts the public attachment domain). Hops matching these are stepped over
   * when identifying a caller, so a shared edge does not bucket every visitor
   * together. Defaults to ATTACHMENTS_TRUSTED_PROXIES (comma separated).
   */
  trustedProxies?: readonly string[];
  throttle?: PasswordThrottle;
  /**
   * Email sender for email-gated share links. Undefined: resolve from the
   * environment (ATTACHMENTS_EMAIL_FROM + RESEND/SES) at request time; null:
   * force the unconfigured path (503 page).
   */
  emailSender?: EmailSender | null;
}

function resolveTrustProxy(explicit: boolean | undefined): boolean {
  if (explicit !== undefined) return explicit;
  return process.env["ATTACHMENTS_TRUST_PROXY"] !== "0";
}

function directAddress(c: Context): string | null {
  const server = (c.env as { server?: { requestIP?: (req: Request) => { address?: string } | null } } | undefined)
    ?.server;
  try {
    return server?.requestIP?.(c.req.raw)?.address ?? null;
  } catch {
    return null;
  }
}

function isConfirmedDownloadRequest(c: Context): boolean {
  return c.req.header("x-attachments-download") === "1" || c.req.query("download") === "1";
}

export function registerCloudPublicRoutes(app: Hono, deps: CloudPublicRoutesDeps): void {
  const { store, config } = deps;
  const publicPath = normalizePublicPath(config.server.publicPath);
  const trustProxy = resolveTrustProxy(deps.trustProxy);
  const trustedProxies =
    deps.trustedProxies ?? parseTrustedProxies(process.env["ATTACHMENTS_TRUSTED_PROXIES"]);
  const throttle = deps.throttle ?? new PasswordThrottle();
  const emailSender: EmailSender | null =
    deps.emailSender !== undefined ? deps.emailSender : resolveEmailSender(process.env);

  const identity = (c: Context, token: string) =>
    passwordFailureKey(
      token,
      clientIdentity(c.req, { trustProxy, trustedProxies, directAddress: directAddress(c) })
    );

  const errorPage = (c: Context, token: string, err: ShareAccessError) =>
    c.html(renderShareAccessError(token, err, publicPath), err.status);

  const downloadPage = (
    c: Context,
    token: string,
    access: ShareAccessResult,
    extra: { error?: string; status?: 200 | 400 | 401 | 403 | 404 | 410; grantToken?: string; notice?: string } = {}
  ) =>
    c.html(
      renderDownloadPage({
        token,
        filename: access.attachment.filename,
        size: access.attachment.size,
        expiresAt: access.shareLink.expiresAt ?? access.attachment.expiresAt,
        requiresPassword: !!access.shareLink.passwordHash,
        requiresEmail: access.shareLink.requireEmail,
        grantToken: extra.grantToken,
        maxUses: access.shareLink.maxUses,
        usedCount: access.shareLink.usedCount,
        publicPath,
        ...(extra.error ? { error: extra.error } : {}),
        ...(extra.notice ? { notice: extra.notice } : {}),
      }),
      extra.status ?? 200
    );

  /**
   * Email-gate check for a share-link page or download. Returns the verified
   * grant token, or null when the link is not email-gated or the visitor holds
   * no (valid) grant.
   */
  const resolveGrantToken = async (
    c: Context,
    token: string,
    access: ShareAccessResult
  ): Promise<string | undefined> => {
    if (!access.shareLink.requireEmail) return undefined;
    const grantToken = c.req.query("grant") ?? undefined;
    if (!grantToken) return undefined;
    try {
      await verifyAccessGrantAsync(store, token, grantToken);
      return grantToken;
    } catch {
      return undefined;
    }
  };

  // Unauthenticated surface: log the detail, never render it back to the visitor.
  function fatal(c: Context, err: unknown) {
    console.error("[public]", c.req.method, c.req.path, err instanceof Error ? err.stack : String(err));
    return c.html(
      renderPublicErrorPage({
        title: "Attachment unavailable",
        message: "Something went wrong while opening this attachment.",
        detail: "Try again in a moment, or ask the sender for a fresh link.",
        status: 500,
      }),
      500
    );
  }

  function setDownloadHeaders(c: Context, attachment: Attachment, contentType?: string) {
    c.header("Content-Disposition", contentDispositionAttachment(attachment.filename));
    c.header("Accept-Ranges", attachment.encryptionAlgorithm ? "none" : "bytes");
    c.header("Content-Type", contentType ?? attachment.contentType);
  }

  // Attachment landing page — never returns bytes, only metadata plus the form.
  app.get(`${publicPath}/:token`, async (c) => {
    const token = c.req.param("token")!;
    try {
      const access = await resolveShareAccessAsync(store, token, { consume: false });
      if (isHead(c)) {
        c.header("Content-Type", "text/html; charset=UTF-8");
        c.header("Content-Length", "0");
        c.header("X-Attachment-Filename", access.attachment.filename);
        return c.body(null, 200);
      }
      const grantToken = await resolveGrantToken(c, token, access);
      return downloadPage(c, token, access, { grantToken });
    } catch (err) {
      if (err instanceof ShareAccessError) {
        return isHead(c) ? c.body(null, err.status) : errorPage(c, token, err);
      }
      return isHead(c) ? c.body(null, 500) : fatal(c, err);
    }
  });

  // Hono dispatches HEAD to the GET handler, so HEAD is handled inside the GET
  // handlers rather than through a separate registration.
  const isHead = (c: Context) => c.req.raw.method.toUpperCase() === "HEAD";

  async function serveDownload(c: Context, password?: string, grantToken?: string) {
    const token = c.req.param("token")!;
    // Email-gated links serve bytes only to a verified emailed grant. Without a
    // grant the visitor lands on the request-access page; with a bogus or
    // expired grant they get an explicit error page, never the bytes.
    const gateLink = await store.findShareLinkByToken(token);
    if (gateLink?.requireEmail) {
      const grant = grantToken ?? c.req.query("grant") ?? undefined;
      if (!grant) {
        return c.redirect(sharePagePath(token, publicPath), 303);
      }
      try {
        await verifyAccessGrantAsync(store, token, grant);
      } catch (err) {
        const status = err instanceof EmailGateError ? err.status : 401;
        return c.html(
          renderShareAccessError(
            token,
            new ShareAccessError("Invalid or expired access link", status as 401 | 410),
            publicPath
          ),
          status
        );
      }
    }

    const key = identity(c, token);
    if (throttle.isLimited(key)) {
      return c.html(
        renderPublicErrorPage({
          title: "Too many password attempts",
          message:
            "This attachment is temporarily locked because the password was entered incorrectly too many times.",
          detail: "Try again later or ask the sender to create a fresh link.",
          status: 429,
          actionHref: sharePagePath(token, publicPath),
          actionLabel: "Back to Attachment",
        }),
        429
      );
    }

    let access: ShareAccessResult;
    try {
      access = await resolveShareAccessAsync(store, token, {
        password,
        consume: false,
        requirePassword: true,
      });
      if (password) throttle.clear(key);
    } catch (err) {
      if (!(err instanceof ShareAccessError)) return fatal(c, err);
      if (err.status !== 401) return errorPage(c, token, err);
      // Only a submitted-and-wrong password counts. A bare GET (link preview,
      // prefetch, someone opening the page) must not be able to lock the link.
      if (password !== undefined) throttle.recordFailure(key);
      try {
        const retry = await resolveShareAccessAsync(store, token, { consume: false });
        return downloadPage(c, token, retry, {
          status: 401,
          error: "Enter the correct password to download this attachment.",
        });
      } catch {
        return errorPage(c, token, err);
      }
    }

    try {
      const result = await openAttachmentStream(access.attachment, {
        config,
        rangeHeader: c.req.header("range"),
        password,
      });
      const consumed = await store.consumeShareLink(access.shareLink.id);
      if (!consumed) {
        return errorPage(
          c,
          token,
          new ShareAccessError("Share link is no longer available", 410)
        );
      }
      await store.incrementDownloads(access.attachment.id);
      setDownloadHeaders(c, access.attachment, result.contentType);
      if (result.contentLength !== undefined) c.header("Content-Length", String(result.contentLength));
      if (result.contentRange) c.header("Content-Range", result.contentRange);
      return c.body(toWebBody(result.body) as never, result.status);
    } catch (err) {
      return fatal(c, err);
    }
  }

  app.get(`${publicPath}/:token/download`, async (c) => {
    const token = c.req.param("token")!;
    try {
      const access = await resolveShareAccessAsync(store, token, { consume: false });
      if (isHead(c)) {
        // Metadata probe: report what a download would deliver without
        // consuming a use or requiring the password.
        setDownloadHeaders(c, access.attachment);
        c.header("Content-Length", String(access.attachment.size));
        return c.body(null, 200);
      }
      // A limited-use link must not be burned by a link preview / prefetch.
      if (access.shareLink.maxUses !== null && !isConfirmedDownloadRequest(c)) {
        return c.redirect(sharePagePath(token, publicPath), 303);
      }
    } catch (err) {
      if (err instanceof ShareAccessError) {
        if (isHead(c)) return c.body(null, err.status);
        // 401 means the link is password protected: fall through so the shared
        // handler renders the form instead of a bare error page.
        if (err.status !== 401) return errorPage(c, token, err);
      } else {
        return isHead(c) ? c.body(null, 500) : fatal(c, err);
      }
    }
    return serveDownload(c, undefined, c.req.query("grant"));
  });

  app.post(`${publicPath}/:token/download`, async (c) => {
    let password: string | undefined;
    let grantToken: string | undefined;
    try {
      const body = await c.req.parseBody();
      password = typeof body["password"] === "string" ? body["password"] : undefined;
      grantToken = typeof body["grant"] === "string" ? body["grant"] : undefined;
    } catch {
      password = undefined;
    }
    return serveDownload(c, password, grantToken);
  });

  // Email-gated links: the visitor submits their address and receives an
  // emailed one-window grant. Mirrors the on-box requestAccessHandler against
  // the async store.
  app.post(`${publicPath}/:token/request-access`, async (c) => {
    const token = c.req.param("token")!;
    let email = "";
    try {
      const body = await c.req.parseBody();
      email = typeof body["email"] === "string" ? body["email"] : "";
    } catch {
      email = "";
    }
    const sender = emailSender;
    if (!sender) {
      return c.html(
        renderPublicErrorPage({
          title: "Email access unavailable",
          message:
            "This link requires email access, but the server is not configured to send email.",
          detail: "Ask the sender to share the file another way.",
          status: 503,
          actionHref: sharePagePath(token, publicPath),
          actionLabel: "Back to Attachment",
        }),
        503
      );
    }
    try {
      const access = await resolveShareAccessAsync(store, token, { consume: false });
      await requestAccessGrantAsync({
        source: store,
        token,
        email,
        sender,
        filename: access.attachment.filename,
        buildAccessUrl: (grant) =>
          grantLinkUrl(config, access.attachment, token, publicPath, grant),
      });
      return downloadPage(c, token, access, {
        notice: "Check your inbox — we emailed you an access link.",
      });
    } catch (err) {
      if (err instanceof EmailGateError || err instanceof ShareAccessError) {
        try {
          const access = await resolveShareAccessAsync(store, token, { consume: false });
          return downloadPage(c, token, access, {
            status: err.status,
            error: err.message,
          });
        } catch {
          return errorPage(
            c,
            token,
            err instanceof ShareAccessError
              ? err
              : new ShareAccessError(err.message, err.status as 401 | 404 | 410)
          );
        }
      }
      return fatal(c, err);
    }
  });
}
