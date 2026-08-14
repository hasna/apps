export default {
  async fetch(request, env) {
    const origin = env.SHORTLINKS_ORIGIN;
    if (!origin) {
      return new Response("SHORTLINKS_ORIGIN is not configured", { status: 500 });
    }

    const incoming = new URL(request.url);
    const upstream = new URL(incoming.pathname + incoming.search, origin);
    const headers = new Headers(request.headers);
    headers.set("x-forwarded-host", incoming.host);
    headers.set("x-shortlinks-worker", "cloudflare");

    return fetch(upstream.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual"
    });
  }
};
