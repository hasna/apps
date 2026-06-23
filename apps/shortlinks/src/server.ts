import { ShortlinksStore } from "./store.js";
import type { AddDomainInput, ClickInput, CreateLinkInput, Domain, Link, LinkStats } from "./types.js";

export interface ShortlinksRuntimeStore {
  totalStats(): { domains: number; links: number; clicks: number } | Promise<{ domains: number; links: number; clicks: number }>;
  resolve(hostname: string, slug: string): Link | null | Promise<Link | null>;
  recordClick(link: Link, input?: ClickInput): unknown | Promise<unknown>;
  consumeLinkUse?(link: Link): Link | null | Promise<Link | null>;
  createLink?(input: CreateLinkInput): Link | Promise<Link>;
  listLinks?(input?: { domain?: string; activeOnly?: boolean; limit?: number }): Link[] | Promise<Link[]>;
  getLink?(hostnameOrSlug: string, slug?: string): Link | null | Promise<Link | null>;
  setLinkActive?(hostnameOrSlug: string, slugOrActive: string | boolean, maybeActive?: boolean): Link | Promise<Link>;
  deleteLink?(hostnameOrSlug: string, slug?: string): Link | Promise<Link>;
  getStats?(hostnameOrSlug: string, slug?: string): LinkStats | Promise<LinkStats>;
  addDomain?(input: AddDomainInput): Domain | Promise<Domain>;
  listDomains?(): Domain[] | Promise<Domain[]>;
  getDomain?(hostname: string): Domain | null | Promise<Domain | null>;
}

export interface ShortlinksHandlerOptions {
  store?: ShortlinksRuntimeStore;
  dbPath?: string;
  defaultHost?: string;
  redirectStatus?: 301 | 302 | 307 | 308;
  reservedPathPrefixes?: string[];
  apiPathPrefix?: string;
  apiToken?: string | null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function publicErrorPage(input: {
  title: string;
  message: string;
  detail?: string;
  status: number;
  slug?: string;
}): Response {
  const detail = input.detail ? `<p class="detail">${htmlEscape(input.detail)}</p>` : "";
  const slug = input.slug ? `<p class="slug">${htmlEscape(input.slug)}</p>` : "";
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(input.title)} - Shortlink</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f7f8; color: #172026; }
    main { width: min(92vw, 520px); border: 1px solid #d7dee3; border-radius: 8px; background: #fff; padding: 28px; box-shadow: 0 18px 48px rgb(23 32 38 / 10%); }
    .status { display: inline-flex; align-items: center; min-height: 28px; padding: 0 10px; border-radius: 999px; background: #eef2f5; color: #46545f; font-size: 13px; font-weight: 700; }
    h1 { margin: 18px 0 10px; font-size: 24px; line-height: 1.2; letter-spacing: 0; }
    p { margin: 0; color: #46545f; line-height: 1.55; }
    .detail { margin-top: 12px; color: #6a7780; font-size: 14px; }
    .slug { margin-top: 18px; padding: 10px 12px; border: 1px solid #d7dee3; border-radius: 6px; background: #fafbfc; color: #172026; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; overflow-wrap: anywhere; }
    @media (prefers-color-scheme: dark) {
      body { background: #101417; color: #f4f7f8; }
      main { background: #171d21; border-color: #2b363d; box-shadow: none; }
      .status { background: #263139; color: #cbd5db; }
      p { color: #bac6cc; }
      .detail { color: #8c9aa3; }
      .slug { background: #101417; border-color: #2b363d; color: #f4f7f8; }
    }
  </style>
</head>
<body>
  <main>
    <div class="status">${input.status}</div>
    <h1>${htmlEscape(input.title)}</h1>
    <p>${htmlEscape(input.message)}</p>
    ${detail}
    ${slug}
  </main>
</body>
</html>`;
  return new Response(body, {
    status: input.status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function publicShortlinkError(kind: "invalid" | "missing" | "reserved" | "not_found" | "disabled" | "expired" | "used", slug: string, host?: string): Response {
  if (kind === "disabled") {
    return publicErrorPage({
      title: "This shortlink is disabled",
      message: "The owner has turned this shortlink off.",
      detail: "Ask the sender for a new link if you still need access.",
      status: 410,
      slug: slug ? `${host ?? ""}/${slug}` : undefined,
    });
  }
  if (kind === "expired") {
    return publicErrorPage({
      title: "This shortlink has expired",
      message: "The owner set an expiration time for this shortlink, and it is no longer available.",
      detail: "Ask the sender to create a fresh link.",
      status: 410,
      slug: slug ? `${host ?? ""}/${slug}` : undefined,
    });
  }
  if (kind === "used") {
    return publicErrorPage({
      title: "This shortlink has already been used",
      message: "The owner limited how many times this shortlink can be opened, and that limit has been reached.",
      detail: "Ask the sender for a new link if you still need access.",
      status: 410,
      slug: slug ? `${host ?? ""}/${slug}` : undefined,
    });
  }
  if (kind === "reserved") {
    return publicErrorPage({
      title: "This path is reserved",
      message: "This address is reserved for another has.na feature.",
      status: 404,
      slug,
    });
  }
  if (kind === "invalid") {
    return publicErrorPage({
      title: "Invalid shortlink",
      message: "This shortlink address is not valid.",
      status: 400,
    });
  }
  if (kind === "missing") {
    return publicErrorPage({
      title: "Missing shortlink",
      message: "No shortlink slug was provided.",
      status: 404,
    });
  }
  return publicErrorPage({
    title: "Shortlink not found",
    message: "This shortlink does not exist or is no longer available.",
    detail: "Check the address or ask the sender for a new link.",
    status: 404,
    slug: slug ? `${host ?? ""}/${slug}` : undefined,
  });
}

function cleanToken(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function apiToken(options: ShortlinksHandlerOptions): string | null {
  if (options.apiToken !== undefined) return cleanToken(options.apiToken);
  return cleanToken(process.env.SHORTLINKS_API_TOKEN) || cleanToken(process.env.HASNA_SHORTLINKS_API_TOKEN);
}

function requestToken(request: Request): string | null {
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return bearer || request.headers.get("x-shortlinks-token") || request.headers.get("x-api-key");
}

function isMutatingMethod(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized !== "GET" && normalized !== "HEAD" && normalized !== "OPTIONS";
}

function authorizeApiRequest(request: Request, options: ShortlinksHandlerOptions): Response | null {
  const token = apiToken(options);
  if (!token) {
    if (isMutatingMethod(request.method)) {
      return json({
        error: "Admin API token is required for write routes. Set SHORTLINKS_API_TOKEN or HASNA_SHORTLINKS_API_TOKEN.",
      }, 401);
    }
    return null;
  }
  return requestToken(request) === token ? null : json({ error: "Unauthorized" }, 401);
}

async function readJsonBody<T extends Record<string, unknown>>(request: Request): Promise<T> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : {} as T;
  } catch {
    return {} as T;
  }
}

function requireMethod(store: ShortlinksRuntimeStore, method: keyof ShortlinksRuntimeStore): any {
  const fn = store[method];
  if (typeof fn !== "function") throw new Error(`Store does not support ${String(method)}.`);
  return fn.bind(store);
}

async function handleApi(request: Request, apiPath: string, store: ShortlinksRuntimeStore, options: ShortlinksHandlerOptions): Promise<Response> {
  if (apiPath === "/health" && (request.method === "GET" || request.method === "HEAD")) {
    return json({
      ok: true,
      service: "shortlinks",
      api_auth_required: Boolean(apiToken(options)),
      api_mutation_auth_required: true,
      stats: await store.totalStats(),
    });
  }
  const authError = authorizeApiRequest(request, options);
  if (authError) return authError;

  const url = new URL(request.url);
  const segments = apiPath.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);

  try {
    if (apiPath === "/links" && request.method === "GET") {
      const listLinks = requireMethod(store, "listLinks") as NonNullable<ShortlinksRuntimeStore["listLinks"]>;
      return json(await listLinks({
        domain: url.searchParams.get("domain") || undefined,
        activeOnly: url.searchParams.get("active") === "true",
        limit: Number(url.searchParams.get("limit") || "100"),
      }));
    }

    if (apiPath === "/links" && request.method === "POST") {
      const body = await readJsonBody<Record<string, unknown>>(request);
      const destinationUrl = String(body.destination_url || body.url || "");
      if (!destinationUrl) return json({ error: "destination_url is required" }, 400);
      const createLink = requireMethod(store, "createLink") as NonNullable<ShortlinksRuntimeStore["createLink"]>;
      return json(await createLink({
        destinationUrl,
        domain: typeof body.domain === "string" ? body.domain : undefined,
        slug: typeof body.slug === "string" ? body.slug : undefined,
        title: typeof body.title === "string" ? body.title : undefined,
        expiresAt: typeof body.expires_at === "string" ? body.expires_at : typeof body.expires === "string" ? body.expires : undefined,
        maxUses: typeof body.max_uses === "number" ? body.max_uses : typeof body.maxUses === "number" ? body.maxUses : undefined,
        slugLength: typeof body.length === "number" ? body.length : undefined,
      }), 201);
    }

    if (segments[0] === "links" && segments[1] && request.method === "GET") {
      const getLink = requireMethod(store, "getLink") as NonNullable<ShortlinksRuntimeStore["getLink"]>;
      const domain = url.searchParams.get("domain") || undefined;
      const link = domain ? await getLink(domain, segments[1]) : await getLink(segments[1]);
      return link ? json(link) : json({ error: "Link not found." }, 404);
    }

    if (segments[0] === "links" && segments[1] && request.method === "DELETE") {
      const deleteLink = requireMethod(store, "deleteLink") as NonNullable<ShortlinksRuntimeStore["deleteLink"]>;
      const domain = url.searchParams.get("domain") || undefined;
      return json(domain ? await deleteLink(domain, segments[1]) : await deleteLink(segments[1]));
    }

    if (segments[0] === "links" && segments[1] && segments[2] === "active" && request.method === "POST") {
      const body = await readJsonBody<{ active?: unknown }>(request);
      const setLinkActive = requireMethod(store, "setLinkActive") as NonNullable<ShortlinksRuntimeStore["setLinkActive"]>;
      const domain = url.searchParams.get("domain") || undefined;
      const active = Boolean(body.active);
      return json(domain ? await setLinkActive(domain, segments[1], active) : await setLinkActive(segments[1], active));
    }

    if (apiPath === "/stats" && request.method === "GET") {
      return json(await store.totalStats());
    }

    if (segments[0] === "stats" && segments[1] && request.method === "GET") {
      const getStats = requireMethod(store, "getStats") as NonNullable<ShortlinksRuntimeStore["getStats"]>;
      const domain = url.searchParams.get("domain") || undefined;
      return json(domain ? await getStats(domain, segments[1]) : await getStats(segments[1]));
    }

    if (apiPath === "/domains" && request.method === "GET") {
      const listDomains = requireMethod(store, "listDomains") as NonNullable<ShortlinksRuntimeStore["listDomains"]>;
      return json(await listDomains());
    }

    if (apiPath === "/domains" && request.method === "POST") {
      const body = await readJsonBody<Record<string, unknown>>(request);
      const hostname = String(body.hostname || "");
      if (!hostname) return json({ error: "hostname is required" }, 400);
      const addDomain = requireMethod(store, "addDomain") as NonNullable<ShortlinksRuntimeStore["addDomain"]>;
      return json(await addDomain({
        hostname,
        provider: typeof body.provider === "string" ? body.provider : "manual",
        defaultDomain: Boolean(body.default_domain || body.default),
        originUrl: typeof body.origin_url === "string" ? body.origin_url : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      }), 201);
    }

    if (segments[0] === "domains" && segments[1] && request.method === "GET") {
      const getDomain = requireMethod(store, "getDomain") as NonNullable<ShortlinksRuntimeStore["getDomain"]>;
      const domain = await getDomain(segments[1]);
      return domain ? json(domain) : json({ error: "Domain not found." }, 404);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  return json({ error: "Not found." }, 404);
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
  const reservedPathPrefixes = new Set((options.reservedPathPrefixes ?? ["a"]).map((prefix) => prefix.toLowerCase()));
  const apiPathPrefix = (options.apiPathPrefix || process.env.SHORTLINKS_API_PATH_PREFIX || "/api").replace(/\/+$/, "") || "/api";

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname === apiPathPrefix || url.pathname.startsWith(`${apiPathPrefix}/`)) {
      const apiPath = url.pathname.slice(apiPathPrefix.length) || "/";
      return handleApi(request, apiPath, store, options);
    }

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
      return publicShortlinkError("invalid", "");
    }
    if (!slug) return publicShortlinkError("missing", "");
    if (reservedPathPrefixes.has(slug.toLowerCase())) {
      return publicShortlinkError("reserved", slug);
    }

    const host = getHost(request, options.defaultHost);
    if (!host) return publicErrorPage({
      title: "Invalid shortlink request",
      message: "This request did not include a host name.",
      status: 400,
    });

    let link: Link | null = null;
    try {
      link = await store.resolve(host, slug);
    } catch {
      return publicShortlinkError("not_found", slug, host);
    }
    if (!link) return publicShortlinkError("not_found", slug, host);
    if (!link.active) return publicShortlinkError("disabled", slug, host);
    if (isExpired(link)) return publicShortlinkError("expired", slug, host);
    if (link.max_uses !== null && link.used_count >= link.max_uses) {
      return publicShortlinkError("used", slug, host);
    }

    if (request.method.toUpperCase() === "HEAD") {
      return new Response(null, {
        status: redirectStatus,
        headers: { location: link.destination_url },
      });
    }

    const consumed = store.consumeLinkUse ? await store.consumeLinkUse(link) : link;
    if (!consumed) {
      return publicShortlinkError("used", slug, host);
    }

    await store.recordClick(consumed, {
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
