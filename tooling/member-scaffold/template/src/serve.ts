/**
 * Serve entry — `<name>-serve` bin. Zero-dependency HTTP surface: health,
 * readiness, version and the OpenAPI document the contract references.
 */
const OPENAPI = JSON.stringify(
  { openapi: "3.0.3", info: { title: "@hasna/__MEMBER__", version: "0.0.0" }, paths: { "/health": { get: { summary: "Health probe", responses: { "200": { description: "ok" } } } } } },
  null,
  2,
);

const server = Bun.serve({
  port: Number(process.env.PORT ?? 0),
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health" || url.pathname === "/ready") return Response.json({ ok: true });
    if (url.pathname === "/version") return Response.json({ version: "0.0.0" });
    if (url.pathname === "/openapi.json") return new Response(OPENAPI, { headers: { "content-type": "application/json" } });
    if (url.pathname.startsWith("/v1")) return Response.json({ error: "not implemented" }, { status: 501 });
    return new Response("not found", { status: 404 });
  },
});

console.log(`@hasna/__MEMBER__-serve listening on ${server.url.href}`);
