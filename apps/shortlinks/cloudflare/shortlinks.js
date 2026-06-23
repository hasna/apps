export default {
  async fetch(request, env) {
    const origin = env.SHORTLINKS_ORIGIN;
    if (!origin) {
      return new Response("SHORTLINKS_ORIGIN is not configured", { status: 500 });
    }

    const incoming = new URL(request.url);
    const proxyTo = (targetOrigin, marker) => {
      const upstream = new URL(incoming.pathname + incoming.search, targetOrigin);
      const headers = new Headers(request.headers);
      headers.set("x-forwarded-host", incoming.host);
      headers.set("x-shortlinks-worker", marker);

      return fetch(upstream.toString(), {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual"
      });
    };

    const splitList = (value, fallback) => (value || fallback)
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    let firstSegment = "";
    try {
      firstSegment = decodeURIComponent(incoming.pathname.replace(/^\/+/, "").split("/")[0] || "").toLowerCase();
    } catch {
      return new Response("Invalid path", { status: 400 });
    }

    const reserved = splitList(env.SHORTLINKS_RESERVED_PATH_PREFIXES, "a,api");
    if (firstSegment && reserved.includes(firstSegment)) {
      if (env.ATTACHMENTS_ORIGIN) {
        return proxyTo(env.ATTACHMENTS_ORIGIN, "attachments");
      }
      return new Response("Reserved path prefix", { status: 404 });
    }

    const normalizePathPrefix = (prefix) => {
      const trimmed = prefix.replace(/^\/+|\/+$/g, "");
      return trimmed ? "/" + trimmed : "/";
    };
    const adminPrefixes = splitList(
      [env.SHORTLINKS_ADMIN_PATH_PREFIXES, env.SHORTLINKS_API_PATH_PREFIX, "/api,/_shortlinks/api"].filter(Boolean).join(","),
      "/api,/_shortlinks/api"
    ).map(normalizePathPrefix);
    const path = incoming.pathname.replace(/\/+$/g, "").toLowerCase() || "/";
    if (adminPrefixes.some((prefix) => path === prefix || path.startsWith(prefix + "/"))) {
      return new Response("Not found", { status: 404 });
    }

    return proxyTo(origin, "cloudflare");
  }
};
