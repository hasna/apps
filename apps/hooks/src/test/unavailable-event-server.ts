/** An authenticated event endpoint that refuses storage instead of returning empty rows. */
export function unavailableEventServer(apiKey: string) {
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path !== "/api/v1/events") return new Response(null, { status: 404 });
      if (request.headers.get("x-api-key") !== apiKey) return new Response(null, { status: 401 });
      requests.push(`${request.method} ${path}`);
      return Response.json({ error: "fixture event store unavailable" }, { status: 503 });
    },
  });
  return { server, requests, url: `http://127.0.0.1:${server.port}` };
}
