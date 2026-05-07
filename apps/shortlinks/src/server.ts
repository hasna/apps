import { ShortlinksStore } from "./store.js";
import type { ClickInput, Link } from "./types.js";

export interface ShortlinksRuntimeStore {
  totalStats(): { domains: number; links: number; clicks: number } | Promise<{ domains: number; links: number; clicks: number }>;
  resolve(hostname: string, slug: string): Link | null | Promise<Link | null>;
  recordClick(link: Link, input?: ClickInput): unknown | Promise<unknown>;
}

export interface ShortlinksHandlerOptions {
  store?: ShortlinksRuntimeStore;
  dbPath?: string;
  defaultHost?: string;
  redirectStatus?: 301 | 302 | 307 | 308;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getHost(request: Request, fallback?: string): string {
  const forwarded = request.headers.get("x-forwarded-host");
  const host = forwarded || request.headers.get("host") || fallback || "";
  return host.split(",")[0]!.trim().split(":")[0]!;
}

function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip");
}

function isExpired(link: Link): boolean {
  return Boolean(link.expires_at && new Date(link.expires_at).getTime() <= Date.now());
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

    return Response.redirect(link.destination_url, redirectStatus);
  };
}

export function serveShortlinks(options: ShortlinksHandlerOptions & { host?: string; port?: number } = {}) {
  const host = options.host || "127.0.0.1";
  const port = options.port || 8787;
  const fetch = createShortlinksHandler(options);
  return Bun.serve({ hostname: host, port, fetch });
}
