// Public redirect-server helpers never choose a backend implicitly. Hosted
// callers resolve the canonical app-base credential authority through
// ./client-store.ts and inject the resulting store; an omitted store is allowed
// only under the explicit HASNA_SHORTLINKS_LOCAL=1 opt-in. The on-box store is
// then loaded through the same gated dynamic-import seam, keeping `bun:sqlite`
// out of the CLI, MCP, and SDK client artifacts.
import { timingSafeEqual } from "node:crypto";
import { isLocalOptIn, LOCAL_OPT_IN_ENV_KEY, openExplicitLocalStore } from "./client-store.js";
import type { Env } from "./store-interface.js";
import type { ClickInput, Link } from "./types.js";
import {
  normalizeIpLiteral,
  resolveRequestClientIp,
  resolveTrustProxy,
  trustedProxiesFromEnv,
} from "./client-ip.js";
import { resolvePublicOrigin } from "./request-origin.js";
import { DEFAULT_DOMAIN_HOSTNAME } from "./slug.js";

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
  /** Inject the already-resolved hosted or local store. Required unless local mode is explicitly selected. */
  store?: ShortlinksRuntimeStore;
  /** Local database path. Never an opt-in by itself. */
  dbPath?: string;
  /** Environment used only to verify and resolve the explicit local-store opt-in. */
  env?: Env;
  /** Optional sink for the explicit-local notice. */
  notice?: (line: string) => void;
  /** Host fallback for synthetic/direct requests that have no Host header. */
  defaultHost?: string;
  /** Trust X-Forwarded-Host from a separately authenticated proxy. False by default. */
  trustForwardedHost?: boolean;
  /** Shared edge secret required before x-hasna-public-* routing hints are accepted. */
  linkRouterSecret?: string;
  redirectStatus?: 301 | 302 | 307 | 308;
  onRecordClickError?: (error: unknown, context: RecordClickErrorContext) => void | Promise<void>;
}

const REDIRECT_ALLOW_HEADER = "GET, HEAD";

export const LINK_ROUTER_AUTH_HEADER = "x-hasna-link-router-auth";

function trustedLinkRouterRequest(request: Request, configuredSecret?: string): boolean {
  const expected = configuredSecret?.trim() ?? "";
  const actual = request.headers.get(LINK_ROUTER_AUTH_HEADER)?.trim() ?? "";
  if (!expected || !actual) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: responseHeaders,
  });
}

/**
 * Host used to resolve a shortlink. The has.na/custom-domain edge sets
 * `x-hasna-public-host`, which is preferred over the API gateway's
 * `x-forwarded-host`, then Host. Every candidate is sanitized. This value is
 * used only for public link lookup and never for API authentication or tenant
 * authorization (see ./request-origin.ts).
 */
function getHost(
  request: Request,
  fallback?: string,
  trustForwardedHost?: boolean,
  trustHasnaPublicHost = false,
): string {
  let requestHost = fallback;
  try {
    requestHost = new URL(request.url).host || fallback;
  } catch {
    // The caller-provided fallback remains the final synthetic-request host.
  }
  const origin = resolvePublicOrigin({
    headers: request.headers,
    defaultHost: requestHost,
    trustHasnaPublicHost,
    trustForwardedHost: trustForwardedHost ?? resolveTrustProxy(),
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
  const redirectStatus = options.redirectStatus || 302;
  const env = options.env ?? process.env;
  if (!options.store && !isLocalOptIn(env)) {
    throw new Error(
      `createShortlinksHandler requires an injected store, or ${LOCAL_OPT_IN_ENV_KEY}=1 ` +
      `(alias SHORTLINKS_LOCAL=1) to explicitly authorize the on-box SQLite store.`,
    );
  }

  // The local store is opened lazily and once only after the explicit opt-in
  // was verified above. Hosted callers must inject their resolved HTTP store;
  // this public helper never reads a credential or invents an authority.
  let ownStore: Promise<ShortlinksRuntimeStore> | null = null;
  const getStore = (): ShortlinksRuntimeStore | Promise<ShortlinksRuntimeStore> => {
    if (options.store) return options.store;
    ownStore ??= openExplicitLocalStore(env, {
      dbPath: options.dbPath,
      notice: options.notice,
    });
    return ownStore;
  };

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      const store = await getStore();
      return json({ ok: true, service: "shortlinks", stats: await store.totalStats() });
    }

    if (url.pathname === "/" || url.pathname === "") {
      return json({ service: "shortlinks", ok: true });
    }

    const rawSegments = url.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    const firstSegment = rawSegments[0]?.toLowerCase() ?? "";
    // `/a` belongs to Attachments and `/v1` belongs to the authenticated API.
    // Refuse both roots and descendants if a routing mistake reaches this
    // public handler; arbitrary nested paths are never shortlinks.
    if (firstSegment === "a" || firstSegment === "v1" || rawSegments.length > 1) {
      return json({
        error: firstSegment === "a" || firstSegment === "v1"
          ? "Reserved path prefix."
          : "Shortlink paths must contain exactly one segment.",
      }, 404);
    }

    let slug = "";
    try {
      slug = decodeURIComponent(rawSegments[0] || "");
    } catch {
      return json({ error: "Invalid slug." }, 400);
    }
    if (!slug) return json({ error: "Missing slug." }, 404);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "Method not allowed." }, 405, { allow: REDIRECT_ALLOW_HEADER });
    }

    const linkRouterSecret = options.linkRouterSecret ?? env.HASNA_LINK_ROUTER_SHARED_SECRET;
    const host = getHost(
      request,
      options.defaultHost ?? DEFAULT_DOMAIN_HOSTNAME,
      options.trustForwardedHost ?? false,
      trustedLinkRouterRequest(request, linkRouterSecret),
    );
    if (!host) return json({ error: "Missing Host header." }, 400);

    const store = await getStore();
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
