// Stub cloud server for io-restore-api.test.ts.
//
// It MUST run in its own process: the api-mode transport is a blocking
// Bun.spawnSync(curl), so an in-process Bun.serve() can never answer — the
// event loop is held by the spawnSync for the whole request and every call
// times out.
//
// Behaviour is selected by the FIRST path segment, so a single long-lived
// process can serve every case by varying the client's base URL:
//   /ok/v1/...       → the server accepts every row: 201 {inserted: n, ...}
//   /partial/v1/...  → the server rejects one row: 400 with rejected: 1
// It prints "READY <port>" on stdout once listening.
//
// Every bulk-upsert payload is recorded and re-served at GET /_received so
// the test can assert what the CLI actually sent (id fidelity, row count)
// without trusting the client's own report.

// Marks this file as a module so its top-level `server` is file-scoped rather
// than global — otherwise tsc reports it as a redeclaration of an identically
// named binding in another fixture stub server.
export {};

interface ReceivedBulk {
  mode: string;
  memories: Array<Record<string, unknown>>;
}

const received: ReceivedBulk[] = [];

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);

    // Test-side readback of what the CLI sent — never part of the /v1 surface.
    if (segments[0] === "_received") return json(received, 200);

    const mode = segments[0] ?? "ok";
    const route = `/${segments.slice(2).join("/")}`; // strip /<mode>/v1

    if (route === "/memories/bulk-upsert" && req.method === "POST") {
      const body = (await req.json()) as { memories?: Array<Record<string, unknown>> };
      const memories = body?.memories ?? [];
      received.push({ mode, memories });

      if (mode === "partial" && memories.length > 0) {
        const total = memories.length;
        return json(
          {
            inserted: total - 1,
            skipped: 0,
            rejected: 1,
            total,
            errors: [`Rejected "${String(memories[0]?.["key"] ?? "?")}": refused by stub`],
            error: `1 of ${total} memories were rejected and did not persist. See errors.`,
          },
          400
        );
      }
      return json(
        { inserted: memories.length, skipped: 0, rejected: 0, total: memories.length, errors: [] },
        201
      );
    }

    return json({ error: "Not found" }, 404);
  },
});

console.log(`READY ${server.port}`);
