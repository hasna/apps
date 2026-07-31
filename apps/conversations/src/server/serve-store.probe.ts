// Test fixture for serve-store.e2e.test.ts. NOT part of the shipped CLI —
// nothing imports it from src, so it never enters a bundle (see `files` in
// package.json).
//
// Runs in a child process for the same reason store-divergence.probe.ts does:
// the local SQLite handle and the resolved store are process-level singletons,
// so store resolution cannot be exercised honestly inside one test process.
//
//   seed   — create the local SQLite fixtures (deliberately different counts from
//            the stub cloud, so answering from the wrong store is a WRONG ANSWER
//            rather than a stylistic one)
//   probe  — start the dashboard server and hit one GET per endpoint class,
//            reporting the status and the count each one returned
//
// Prints one JSON line to stdout.

import { startDashboardServer } from "./serve.js";
import { createChannel } from "../lib/channels.js";
import { createProject } from "../lib/projects.js";
import { sendMessage } from "../lib/messages.js";

/** Local fixture sizes. Every one differs from its stub-cloud counterpart. */
export const LOCAL = { channels: 3, projects: 2, messages: 4 };

/**
 * One GET per endpoint CLASS in serve.ts, keyed by the lib module each one used to
 * import directly. A class passes only if it answered from the configured store —
 * which is why each case reports a COUNT, not just a status code.
 */
const CASES: Array<{ endpointClass: string; path: string; method?: string; body?: unknown }> = [
  { endpointClass: "status", path: "/api/status" },
  { endpointClass: "messages", path: "/api/messages" },
  { endpointClass: "messages.search", path: "/api/messages/search?q=cloud" },
  { endpointClass: "messages.export", path: "/api/export" },
  { endpointClass: "messages.pinned", path: "/api/messages/pinned" },
  { endpointClass: "sessions", path: "/api/sessions" },
  { endpointClass: "channels", path: "/api/channels" },
  { endpointClass: "projects", path: "/api/projects" },
  { endpointClass: "presence", path: "/api/agents" },
  { endpointClass: "hot", path: "/api/sessions/hot" },
  { endpointClass: "graph", path: "/api/graph?entity_type=agent&entity_id=cloud-agent" },
  { endpointClass: "graph.network", path: "/api/graph/agent/cloud-agent" },
  { endpointClass: "reactions", path: "/api/reactions?message_id=1" },
  { endpointClass: "locks", path: "/api/locks" },
  // Mutations. These matter separately from the GETs because each one wraps its
  // store call in the SAME try/catch it uses for JSON.parse, so a store refusal
  // can be misreported as the caller's fault (400) instead of the server's (503).
  {
    endpointClass: "write.messages",
    path: "/api/messages",
    method: "POST",
    body: { from: "probe-agent", to: "other-agent", content: "probe-write" },
  },
  {
    endpointClass: "write.channels",
    path: "/api/channels",
    method: "POST",
    body: { name: "probe-written-channel", created_by: "probe-agent" },
  },
  {
    endpointClass: "write.projects",
    path: "/api/projects",
    method: "POST",
    body: { name: "probe-written-project", created_by: "probe-agent" },
  },
];

/**
 * How many rows a payload represents. Arrays count directly; the status object
 * reports its own channel total; anything else counts as a present-but-unsized
 * answer so a class is never silently scored as empty.
 */
function sizeOf(path: string, body: unknown): number | null {
  if (Array.isArray(body)) return body.length;
  if (body && typeof body === "object") {
    const rec = body as Record<string, unknown>;
    if (path === "/api/status" && typeof rec.total_channels === "number") return rec.total_channels;
    if (Array.isArray(rec.related)) return rec.related.length;
    if (Array.isArray(rec.messages)) return rec.messages.length;
    if (Array.isArray(rec.nodes)) return rec.nodes.length;
  }
  return null;
}

function seed(): void {
  for (let i = 0; i < LOCAL.channels; i++) createChannel(`local-channel-${i}`, "local-agent");
  for (let i = 0; i < LOCAL.projects; i++) {
    createProject({ name: `local-project-${i}`, created_by: "local-agent" });
  }
  for (let i = 0; i < LOCAL.messages; i++) {
    sendMessage({ from: "local-agent", to: "other-agent", content: `local-message-${i}` });
  }
  console.log(JSON.stringify({ seeded: LOCAL }));
}

async function probeAll(includeWrites: boolean): Promise<void> {
  const server = startDashboardServer(0, "127.0.0.1");
  const base = `http://127.0.0.1:${server.port}`;
  const results: Record<string, unknown> = {};

  const cases = includeWrites ? CASES : CASES.filter((c) => !c.method || c.method === "GET");

  for (const { endpointClass, path, method, body: payload } of cases) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: method ?? "GET",
        ...(payload === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
      });
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      const rec = (body ?? {}) as Record<string, unknown>;
      results[endpointClass] = {
        path,
        status: res.status,
        size: sizeOf(path.split("?")[0]!, body),
        // The error MESSAGE is asserted on, so a refusal is distinguishable from a
        // generic 500. Never a credential value: store errors name variables only.
        error: res.ok ? undefined : rec.error ?? String(body).slice(0, 200),
        // Which store the endpoint says answered it, where it says so.
        mode: rec.mode,
        apiUrlPresent: Boolean(rec.api_url),
        dbPathPresent: Boolean(rec.db_path),
      };
    } catch (error) {
      results[endpointClass] = { path, threw: true, message: (error as Error).message };
    }
  }

  server.stop(true);
  console.log(JSON.stringify(results));
}

// The test imports LOCAL from this module, so the executable half must not run on
// import — otherwise fetching the fixture constant would kill the test process.
if (import.meta.main) {
  const [mode] = process.argv.slice(2);
  if (mode === "seed") {
    seed();
    process.exit(0);
  } else if (mode === "probe") {
    // Reads only. Used wherever a case asserts on a COUNT, because a write would
    // move the local fixture out from under the next arm's assertions.
    await probeAll(false);
    process.exit(0);
  } else if (mode === "probe-writes") {
    await probeAll(true);
    process.exit(0);
  } else {
    console.error(`unknown probe mode: ${mode}`);
    process.exit(64);
  }
}
