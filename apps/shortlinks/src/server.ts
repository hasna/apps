import { ShortlinksStore } from "./store.js";
import type { ClickInput, Link } from "./types.js";
import {
  normalizeIpLiteral,
  resolveRequestClientIp,
  resolveTrustProxy,
  trustedProxiesFromEnv,
} from "./client-ip.js";
import { resolvePublicOrigin } from "./request-origin.js";

export interface ShortlinksRuntimeStore {
  totalStats(): { domains: number; links: number; clicks: number } | Promise<{ domains: number; links: number; clicks: number }>;
  resolve(hostname: string, slug: string): Link | null | Promise<Link | null>;
  recordClick(link: Link, input?: ClickInput): unknown | Promise<unknown>;
}

export interface RecordClickErrorContext {
  link: Link;
  request: Request;
}

export interface ShortlinksHandlerOptions {
  store?: ShortlinksRuntimeStore;
  dbPath?: string;
  defaultHost?: string;
  redirectStatus?: 301 | 302 | 307 | 308;
  onRecordClickError?: (error: unknown, context: RecordClickErrorContext) => void | Promise<void>;
}

const REDIRECT_ALLOW_HEADER = "GET, HEAD";

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: responseHeaders,
  });
}

/**
 * Host used to resolve a shortlink. `x-forwarded-host` is only honored when
 * the forwarding hop is explicitly trusted (SHORTLINKS_TRUST_PROXY) — the
 * shortlinks Cloudflare worker and the api.hasna.com gateway both set it —
 * and every candidate is sanitized, so a hostile header can never steer
 * resolution to an attacker-chosen domain (see ./request-origin.ts).
 */
function getHost(request: Request, fallback?: string): string {
  const origin = resolvePublicOrigin({
    headers: request.headers,
    defaultHost: fallback,
    trustForwardedHost: resolveTrustProxy(),
  });
  if (!origin) return "";
  const url = new URL(origin);
  return url.hostname;
}

/**
 * Caller identity for click analytics. Untrusted by default: the leftmost
 * X-Forwarded-For entry is client-written, so keying analytics on it without
 * a trust gate hands the client the pen. With SHORTLINKS_TRUST_PROXY=1 the
 * hardened derivation applies (validated x-real-ip set by the api gateway,
 * then the first untrusted XFF entry from the right), and the CF-Connecting-IP
 * the Cloudflare edge itself sets is accepted as a last resort — validated
 * like every other candidate (see ./client-ip.ts).
 */
function getClientIp(request: Request): string | null {
  const trust = resolveTrustProxy();
  if (!trust) return null;
  const derived = resolveRequestClientIp({
    headers: request.headers,
    socketAddress: null,
    trustProxy: true,
    trustedProxies: trustedProxiesFromEnv(),
  });
  if (derived) return derived;
  return normalizeIpLiteral(request.headers.get("cf-connecting-ip"));
}

function isExpired(link: Link): boolean {
  return Boolean(link.expires_at && new Date(link.expires_at).getTime() <= Date.now());
}

function logRecordClickError(link: Link): void {
  console.error(`[shortlinks] Click analytics recording failed for ${link.hostname}/${link.slug}.`);
}

export function createShortlinksHandler(options: ShortlinksHandlerOptions = {}): (request: Request) => Response | Promise<Response> {
  const store = options.store || new ShortlinksStore(options.dbPath);
  const redirectStatus = options.redirectStatus || 302;

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return json({ ok: true, service: "shortlinks", stats: await store.totalStats() });
    }

    if (url.pathname === "/" || url.pathname === "") {
      return json({ service: "shortlinks", ok: true });
    }

    let slug = "";
    try {
      slug = decodeURIComponent(url.pathname.replace(/^\/+/, "").split("/")[0] || "");
    } catch {
      return json({ error: "Invalid slug." }, 400);
    }
    if (!slug) return json({ error: "Missing slug." }, 404);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "Method not allowed." }, 405, { allow: REDIRECT_ALLOW_HEADER });
    }

    const host = getHost(request, options.defaultHost);
    if (!host) return json({ error: "Missing Host header." }, 400);

    let link: Link | null = null;
    try {
      link = await store.resolve(host, slug);
    } catch {
      return json({ error: "Shortlink not found.", slug, host }, 404);
    }
    if (!link) return json({ error: "Shortlink not found.", slug, host }, 404);
    if (!link.active) return json({ error: "Shortlink is disabled.", slug, host }, 410);
    if (isExpired(link)) return json({ error: "Shortlink is expired.", slug, host }, 410);

    if (request.method === "GET") {
      try {
        await store.recordClick(link, {
          ip: getClientIp(request),
          userAgent: request.headers.get("user-agent"),
          referer: request.headers.get("referer"),
          country: request.headers.get("cf-ipcountry"),
          metadata: {
            path: url.pathname,
            query: url.search,
          },
        });
      } catch (error) {
        if (options.onRecordClickError) {
          try {
            await options.onRecordClickError(error, { link, request });
          } catch {
            logRecordClickError(link);
          }
        } else {
          logRecordClickError(link);
        }
      }
    }

    return Response.redirect(link.destination_url, redirectStatus);
  };
}

export function serveShortlinks(options: ShortlinksHandlerOptions & { host?: string; port?: number } = {}) {
  const host = options.host || "127.0.0.1";
  const port = options.port || 8787;
  const fetch = createShortlinksHandler(options);
  return Bun.serve({ hostname: host, port, fetch });
}
