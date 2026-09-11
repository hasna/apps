// Standalone stub server for the mementos cloud API's hosted-transport arms
// that have no dedicated server process available in unit tests: memories
// (paged, for `backup`'s full-population read), synthesis run/rollback, and
// session ingest.
//
// Runs as its OWN process (`bun run transport-battery-stub-server.ts`) for the
// same reason as memories-page-stub-server.ts: the real CLI resolves cloud
// calls with a SYNCHRONOUS curl child (Bun.spawnSync), which deadlocks against
// an in-process stub.

const PORT = Number(process.env["STUB_PORT"] || 0);

const memories = Array.from({ length: 5 }, (_, i) => ({
  id: `mem-${String(i).padStart(5, "0")}`,
  key: `stub-key-${i}`,
  value: `stub value ${i}`,
  summary: null,
  category: "knowledge",
  scope: "shared",
  status: "active",
  pinned: false,
  importance: 5,
  source: "auto",
  tags: ["stub"],
  metadata: { stub: true },
  access_count: 0,
  version: 1,
  created_at: "2026-08-17T00:00:00.000Z",
  updated_at: "2026-08-17T00:00:00.000Z",
  agent_id: null,
  project_id: null,
  session_id: null,
}));

const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const u = new URL(req.url);

    if (req.method === "GET" && u.pathname === "/v1/memories") {
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

    if (req.method === "POST" && u.pathname === "/v1/synthesis/run") {
      return Response.json({
        run: {
          id: "stub-run-0001",
          status: "completed",
          corpus_size: 2,
          proposals_generated: 1,
          proposals_accepted: 0,
          started_at: "2026-09-07T00:00:00.000Z",
        },
        proposals: [],
        executed: 0,
        metrics: null,
        dryRun: true,
      });
    }

    if (req.method === "POST" && u.pathname.startsWith("/v1/synthesis/rollback/")) {
      return Response.json({ rolled_back: 1, errors: [] });
    }

    if (req.method === "POST" && u.pathname === "/v1/sessions/ingest") {
      return Response.json(
        { job_id: "stub-job-0001", status: "queued", message: "Session queued for memory extraction" },
        { status: 202 },
      );
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

console.error(`stub listening on ${server.port}`);
export {};