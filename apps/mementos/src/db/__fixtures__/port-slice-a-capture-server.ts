// Stub cloud server for port-to-api-slice-a.test.ts.
//
// It MUST run in its own process: the api-mode transport is a blocking
// Bun.spawnSync(curl), so an in-process Bun.serve() can never answer — the
// event loop is held by the spawnSync for the whole request (same constraint
// as list-filter-capture-server.ts and fail-closed-stub-server.ts).
//
// Every request is appended to CAPTURE_FILE as one line
//   METHOD <pathname+search> <json body or "-">
// and answered with a body shaped like the real route's, so the client parse
// succeeds and the ported handler produces its normal output. The test then
// asserts on the captured lines: which /v1 route each CLI command and MCP tool
// actually hit.
//
// Prints "READY <port>" on stdout once listening.

import { appendFileSync } from "node:fs";

const captureFile = process.env["CAPTURE_FILE"];
if (!captureFile) throw new Error("CAPTURE_FILE is required");

const LOCK = {
  id: "lock-1",
  resource_type: "memory",
  resource_id: "shared:deploy-key:",
  agent_id: "agent-1",
  lock_type: "exclusive",
  locked_at: "2026-09-11T00:00:00.000Z",
  expires_at: "2099-01-01T00:00:00.000Z",
};

const RUN = {
  id: "run-1",
  triggered_by: "manual",
  project_id: null,
  agent_id: null,
  corpus_size: 42,
  proposals_generated: 3,
  proposals_accepted: 2,
  proposals_rejected: 1,
  status: "completed",
  error: null,
  started_at: "2026-09-11T00:00:00.000Z",
  completed_at: "2026-09-11T00:01:00.000Z",
};

const MACHINE = {
  id: "machine-1",
  name: "apple01",
  hostname: "apple01",
  platform: "darwin",
  is_primary: false,
  created_at: "2026-09-11T00:00:00.000Z",
  last_seen_at: "2026-09-11T00:00:00.000Z",
};

const JOB = {
  id: "job-1",
  session_id: "session-1",
  agent_id: "agent-1",
  project_id: null,
  source: "manual",
  status: "pending",
  transcript: "hello",
  chunk_count: 0,
  memories_extracted: 0,
  error: null,
  metadata: {},
  created_at: "2026-09-11T00:00:00.000Z",
  started_at: null,
  completed_at: null,
};

function respond(method: string, path: string): unknown {
  if (method === "POST" && path === "/v1/synthesis/run") {
    return { run: RUN, proposals: [], executed: 2, metrics: null, dryRun: false };
  }
  if (method === "POST" && path.startsWith("/v1/synthesis/rollback/")) {
    return { rolled_back: 2, errors: [] };
  }
  if (method === "GET" && path.startsWith("/v1/synthesis/runs")) {
    return { runs: [RUN], count: 1 };
  }
  if (method === "GET" && path.startsWith("/v1/synthesis/status")) {
    return { lastRun: RUN, recentRuns: [RUN] };
  }
  if (method === "POST" && path === "/v1/profile/synthesize") {
    return { profile: "## Profile\nhosted-profile-body", memory_count: 7, from_cache: false };
  }
  if (method === "POST" && path === "/v1/machines") return MACHINE;
  if (method === "GET" && path.startsWith("/v1/machines/")) {
    if (path.endsWith("/primary")) return { ...MACHINE, is_primary: true };
    return MACHINE;
  }
  if (method === "PATCH" && path.startsWith("/v1/machines/")) return { ...MACHINE, name: "renamed" };
  if (method === "POST" && path.endsWith("/primary")) return { ...MACHINE, is_primary: true };
  if (method === "POST" && path.endsWith("/touch")) return { touched: true, id: MACHINE.id };
  if (method === "DELETE" && path.startsWith("/v1/machines/")) return { deleted: true };
  if (method === "GET" && path.startsWith("/v1/machines")) return { machines: [MACHINE], count: 1 };
  if (method === "POST" && path === "/v1/locks") return LOCK;
  if (method === "DELETE" && path.startsWith("/v1/locks/")) return { released: true };
  if (method === "GET" && path.startsWith("/v1/locks")) return [LOCK];
  if (method === "DELETE" && /^\/v1\/agents\/[^/]+\/locks/.test(path)) return { released: 1 };
  if (method === "GET" && /^\/v1\/agents\/[^/]+\/locks/.test(path)) return [LOCK];
  if (method === "POST" && path === "/v1/sessions/ingest") {
    return { job_id: JOB.id, status: "queued", message: "Session queued for memory extraction" };
  }
  if (method === "GET" && path.startsWith("/v1/sessions/jobs/")) return JOB;
  if (method === "GET" && path.startsWith("/v1/sessions/jobs")) return { jobs: [JOB], count: 1 };
  if (method === "GET" && path.startsWith("/v1/sessions/queue/stats")) {
    return { pending: 2, processing: 1, completed: 5, failed: 0 };
  }
  if (method === "GET" && path.startsWith("/v1/memories/stale")) {
    return {
      memories: [
        {
          id: "mem-1",
          key: "old-key",
          value: "old value",
          importance: 3,
          scope: "shared",
          category: "fact",
          accessed_at: null,
          access_count: 0,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      total: 1,
      has_more: false,
      next_cursor: null,
    };
  }
  if (method === "GET" && path.startsWith("/v1/tool-events")) {
    return {
      events: [
        {
          id: "ev-1",
          tool_name: "Bash",
          action: null,
          success: true,
          error_type: null,
          error_message: null,
          tokens_used: null,
          latency_ms: 12,
          context: null,
          lesson: null,
          when_to_use: null,
          agent_id: null,
          project_id: null,
          session_id: null,
          metadata: "{}",
          created_at: "2026-09-11T00:00:00.000Z",
        },
      ],
    };
  }
  // Ambient traffic a handler may make on the way (project auto-registration,
  // memory reads). Shapes are valid-but-empty so nothing downstream invents
  // data; the assertions only look at the route lines above.
  if (method === "GET" && path.startsWith("/v1/projects")) return [];
  if (method === "POST" && path === "/v1/projects") {
    return { id: "proj-1", name: "stub", path: "/tmp/stub", created_at: "2026-09-11T00:00:00.000Z" };
  }
  if (method === "GET" && path.startsWith("/v1/memories")) {
    return { memories: [], has_more: false, next_cursor: null };
  }
  return {};
}

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const path = `${url.pathname}${url.search}`;
    let body = "-";
    if (req.method !== "GET" && req.method !== "HEAD") {
      const text = await req.text();
      if (text.trim()) body = text.replace(/\n/g, " ");
    }
    appendFileSync(captureFile, `${req.method} ${path} ${body}\n`);
    return Response.json(respond(req.method, url.pathname));
  },
});

console.log(`READY ${server.port}`);
