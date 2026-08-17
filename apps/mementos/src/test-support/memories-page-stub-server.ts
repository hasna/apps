// Standalone stub server for the mementos cloud API's bounded-page contract
// (BUG 2796806b): single responses capped at 1000 rows with has_more /
// next_cursor / total.
//
// Runs as its OWN process (`bun run memories-page-stub-server.ts`) because the
// real CLI resolves cloud reads with a SYNCHRONOUS curl child (Bun.spawnSync):
// a stub served from the same process deadlocks — the spawn blocks the event
// loop that must answer the connection.

const PORT = Number(process.env["STUB_PORT"] || 0);
const ROWS = Number(process.env["STUB_ROWS"] || 1500);

const memories = Array.from({ length: ROWS }, (_, i) => ({
  id: `mem-${String(i).padStart(5, "0")}`,
  key: `key-${i}`,
  value: `value ${i}`,
  importance: 1,
  scope: "shared",
  category: "knowledge",
  status: "active",
  created_at: "2026-08-17T00:00:00.000Z",
}));

const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/v1/memories") {
      const limit = Math.min(Number(u.searchParams.get("limit")) || 1000, 1000);
      const offset = Number(u.searchParams.get("offset")) || 0;
      const page = memories.slice(offset, offset + limit);
      const has_more = offset + page.length < memories.length;
      return Response.json({
        memories: page,
        count: page.length,
        total: memories.length,
        limit,
        has_more,
        next_cursor: has_more ? offset + page.length : null,
      });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
});

console.error(`stub listening on ${server.port}`);
export {};
