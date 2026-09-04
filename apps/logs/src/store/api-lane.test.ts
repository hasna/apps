/**
 * @hasna/logs — regression tests for the local-only-capability ports
 * (localonly-logs workflow, 2026-08-18).
 *
 * These tests pin the HOSTED-path behavior of the capabilities that previously
 * threw the "local-only operation" guard in api mode:
 *
 *   - `watch --events` / MCP `event_watch`  -> Store.watchEvents
 *   - `scan`                                -> Store.getScanJob + Store.runScanJob
 *
 * They drive the REAL HTTP transport (createClientTransport + ApiStore) against
 * the in-memory cloud `/v1` app backed by the fake Postgres client, so a pass
 * proves the capability works end-to-end on the hosted path — not merely that
 * a helper exists.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHasnaStorageClient } from "@hasna/contracts/client/storage";
import { createClientTransport } from "@hasna/contracts/client";
import { buildCloudApp } from "../server/cloud/app.ts";
import {
  SIGNING_SECRET,
  fakeClient,
  tokenWith,
} from "../server/cloud/test-helpers.ts";
import { ApiStore } from "./api.ts";
import type { LogEntry } from "../types/index.ts";

const ORIGINAL_ENV = new Map<string, string | undefined>([
  ["HASNA_LOGS_API_URL", process.env.HASNA_LOGS_API_URL],
  ["HASNA_LOGS_API_KEY", process.env.HASNA_LOGS_API_KEY],
  ["HOME", process.env.HOME],
]);

function buildApiStore(): {
  api: ApiStore;
  state: ReturnType<typeof fakeClient>["state"];
  client: import("@hasna/contracts/client/storage").HasnaStorageClient;
} {
  const f = fakeClient();
  f.state.projects.set("proj-1", {
    id: "proj-1",
    name: "hosted",
    github_repo: null,
    base_url: null,
    description: null,
    created_at: new Date().toISOString(),
  });
  f.state.pages.set("page-1", {
    id: "page-1",
    project_id: "proj-1",
    url: "https://example.com",
    path: "/",
    name: null,
    last_scanned_at: null,
    created_at: new Date().toISOString(),
  });
  f.state.scanJobs.set("job-1", {
    id: "job-1",
    project_id: "proj-1",
    page_id: null,
    schedule: "*/30 * * * *",
    enabled: true,
    last_run_at: null,
    created_at: new Date().toISOString(),
  });
  const app = buildCloudApp({
    client: f.client,
    version: "9.9.9",
    signingSecret: SIGNING_SECRET,
    keyStatus: async (): Promise<"active"> => "active",
  });
  process.env.HASNA_LOGS_API_URL = "http://127.0.0.1:1/v1";
  process.env.HASNA_LOGS_API_KEY = tokenWith(["logs:read", "logs:write"]);
  const transport = createClientTransport("logs", process.env, {
    fetchImpl: async (input, init) =>
      app.fetch(new Request(String(input), init)),
  });
  if (transport.transport !== "http") {
    throw new Error("expected http transport in api-lane tests");
  }
  const client = createHasnaStorageClient("logs", transport.client);
  return { api: new ApiStore(client), state: f.state, client };
}

async function ingestWatchEvent(
  api: ApiStore,
  event_id: string,
  event_time: string,
  message: string,
): Promise<void> {
  await api.pushEvent(
    {
      type: "metric",
      source: "cli",
      event_id,
      event_time,
      message,
    },
    { detectIdentity: false },
  );
}

describe("ApiStore.watchEvents (hosted event-catalog watch)", () => {
  test("from_start returns the catalog oldest-first", async () => {
    const { api } = buildApiStore();
    await ingestWatchEvent(api, "w1", "2026-08-18T00:00:00.000Z", "one");
    await ingestWatchEvent(api, "w2", "2026-08-18T00:00:01.000Z", "two");
    await ingestWatchEvent(api, "w3", "2026-08-18T00:00:02.000Z", "three");

    const result = await api.watchEvents({ from_start: true, limit: 10 });
    expect(result.overflow).toBeNull();
    expect(result.events.map((e) => e.event_id)).toEqual(["w1", "w2", "w3"]);
    expect(result.cursor).toBe("w3");
    expect(result.has_more).toBe(false);
  });

  test("anchored cursor returns only events after the anchor", async () => {
    const { api } = buildApiStore();
    await ingestWatchEvent(api, "w1", "2026-08-18T00:00:00.000Z", "one");
    await ingestWatchEvent(api, "w2", "2026-08-18T00:00:01.000Z", "two");
    await ingestWatchEvent(api, "w3", "2026-08-18T00:00:02.000Z", "three");

    const result = await api.watchEvents({
      last_event_id: "w2",
      limit: 10,
    });
    expect(result.overflow).toBeNull();
    expect(result.events.map((e) => e.event_id)).toEqual(["w3"]);
    expect(result.cursor).toBe("w3");
  });

  test("unknown anchor reports last_event_id_unknown without replaying history", async () => {
    const { api } = buildApiStore();
    await ingestWatchEvent(api, "w1", "2026-08-18T00:00:00.000Z", "one");

    const result = await api.watchEvents({ last_event_id: "missing", limit: 10 });
    expect(result.overflow).toEqual({
      reason: "last_event_id_unknown",
      last_event_id: "missing",
    });
    expect(result.events).toEqual([]);
    expect(result.cursor).toBe("w1");
  });

  test("no cursor and not from_start returns empty with the latest cursor", async () => {
    const { api } = buildApiStore();
    await ingestWatchEvent(api, "w1", "2026-08-18T00:00:00.000Z", "one");

    const result = await api.watchEvents({ limit: 10 });
    expect(result.events).toEqual([]);
    expect(result.has_more).toBe(false);
    expect(result.cursor).toBe("w1");
  });

  test("has_more is true when the catalog exceeds the limit", async () => {
    const { api } = buildApiStore();
    for (let i = 1; i <= 5; i++) {
      await ingestWatchEvent(
        api,
        `w${i}`,
        `2026-08-18T00:00:0${i - 1}.000Z`,
        `event ${i}`,
      );
    }
    const result = await api.watchEvents({ from_start: true, limit: 3 });
    expect(result.events.map((e) => e.event_id)).toEqual(["w1", "w2", "w3"]);
    expect(result.has_more).toBe(true);
    expect(result.cursor).toBe("w3");

    const next = await api.watchEvents({ last_event_id: "w3", limit: 3 });
    expect(next.events.map((e) => e.event_id)).toEqual(["w4", "w5"]);
    expect(next.has_more).toBe(false);
  });

  test("filters apply on the hosted path (event_type + project)", async () => {
    const { api } = buildApiStore();
    await ingestWatchEvent(api, "m1", "2026-08-18T00:00:00.000Z", "metric one");
    await api.pushEvent(
      {
        type: "log",
        source: "cli",
        event_id: "l1",
        event_time: "2026-08-18T00:00:01.000Z",
        message: "log one",
      },
      { detectIdentity: false },
    );

    const result = await api.watchEvents({
      from_start: true,
      event_type: "metric",
      limit: 10,
    });
    expect(result.events.map((e) => e.event_id)).toEqual(["m1"]);
  });

  test("include_internal=false hides MCP tool-call telemetry", async () => {
    const { api } = buildApiStore();
    await api.pushEvent(
      {
        type: "agent",
        source: "mcp",
        event_id: "telemetry-1",
        event_time: "2026-08-18T00:00:00.000Z",
        message: "MCP tool event_search completed",
        attributes: { category: "mcp_tool_call", tool_name: "event_search" },
      },
      { detectIdentity: false },
    );
    await ingestWatchEvent(api, "w1", "2026-08-18T00:00:01.000Z", "one");

    const hidden = await api.watchEvents({ from_start: true, limit: 10 });
    expect(hidden.events.map((e) => e.event_id)).toEqual(["w1"]);

    const shown = await api.watchEvents({
      from_start: true,
      limit: 10,
      include_internal: true,
    });
    expect(shown.events.map((e) => e.event_id)).toEqual([
      "telemetry-1",
      "w1",
    ]);
  });

  test("event inserted after the initial baseline poll is emitted on the anchored poll", async () => {
    const { api } = buildApiStore();
    await ingestWatchEvent(api, "b1", "2026-08-18T00:00:00.000Z", "baseline one");
    await ingestWatchEvent(api, "b2", "2026-08-18T00:00:01.000Z", "baseline two");

    const baseline = await api.watchEvents({ limit: 10 });
    expect(baseline.events).toEqual([]);
    expect(baseline.has_more).toBe(false);
    expect(baseline.cursor).toBe("b2");

    // The CLI watch loop adopts baseline.cursor as its next anchor; the event
    // ingested after the first poll must then be emitted on the anchored poll.
    await ingestWatchEvent(api, "b3", "2026-08-18T00:00:02.000Z", "after baseline");

    const next = await api.watchEvents({
      last_event_id: baseline.cursor ?? undefined,
      limit: 10,
    });
    expect(next.overflow).toBeNull();
    expect(next.events.map((e) => e.event_id)).toEqual(["b3"]);
    expect(next.cursor).toBe("b3");
  });

  test("service filter pages past non-matching events instead of truncating", async () => {
    const { api } = buildApiStore();
    const messages = [
      "alpha log 1",
      "alpha log 2",
      "alpha log 3",
      "svc-a event 1",
      "svc-a event 2",
      "alpha log 4",
      "svc-a event 3",
      "alpha log 5",
    ];
    for (let i = 0; i < messages.length; i++) {
      await ingestWatchEvent(
        api,
        `s${i + 1}`,
        `2026-08-18T00:00:0${i}.000Z`,
        messages[i],
      );
    }

    const first = await api.watchEvents({
      from_start: true,
      service: "svc-a",
      limit: 2,
    });
    expect(first.overflow).toBeNull();
    expect(first.events.map((e) => e.event_id)).toEqual(["s4", "s5"]);
    expect(first.has_more).toBe(true);
    expect(first.cursor).toBe("s5");

    const second = await api.watchEvents({
      last_event_id: "s5",
      service: "svc-a",
      limit: 2,
    });
    expect(second.events.map((e) => e.event_id)).toEqual(["s7"]);
    expect(second.has_more).toBe(false);
  });

  test("service filter safety bound never reports a silent false (has_more with last processed cursor)", async () => {
    const { api } = buildApiStore();
    // > PAGING_SAFETY_BOUND pages of non-matching events (page size limit+1=2,
    // bound 500 => 1000 processed events) followed by one matching event, so
    // the paging guard trips before the match is reached. The caller must
    // learn has_more=true with the last processed cursor and then reach the
    // match on the anchored poll — never a silent has_more=false.
    for (let i = 1; i <= 1002; i++) {
      const minutes = String(Math.floor((i - 1) / 60)).padStart(2, "0");
      const seconds = String((i - 1) % 60).padStart(2, "0");
      await ingestWatchEvent(
        api,
        `s${i}`,
        `2026-08-18T00:${minutes}:${seconds}.000Z`,
        `alpha log ${i}`,
      );
    }
    await ingestWatchEvent(
      api,
      "s1003",
      "2026-08-18T00:16:42.000Z",
      "svc-a final",
    );

    const first = await api.watchEvents({
      from_start: true,
      service: "svc-a",
      limit: 1,
    });
    expect(first.events.map((e) => e.event_id)).toEqual([]);
    expect(first.has_more).toBe(true);
    // 500 pages x 2 events processed before the safety bound trips.
    expect(first.cursor).toBe("s1000");

    const second = await api.watchEvents({
      last_event_id: first.cursor ?? undefined,
      service: "svc-a",
      limit: 1,
    });
    expect(second.events.map((e) => e.event_id)).toEqual(["s1003"]);
    expect(second.has_more).toBe(false);
  });
});

describe("ApiStore.listLogs (hosted logs paging)", () => {
  test("offset returns the second page, not page 1 again", async () => {
    const { api, state } = buildApiStore();
    // Seed three logs with distinct timestamps (newest first: msg-3, msg-2,
    // msg-1). The SDK sends offset (sdk/src/index.ts) and ApiStore forwards it
    // (src/store/api.ts), so this pins the whole hosted paging path.
    for (let i = 1; i <= 3; i++) {
      state.logs.set(`log-${i}`, {
        id: `log-${i}`,
        timestamp: `2026-01-01T00:00:0${i}.000Z`,
        project_id: "proj-1",
        level: "info",
        source: "sdk",
        service: null,
        message: `msg-${i}`,
        trace_id: null,
        session_id: null,
        agent: null,
        url: null,
        stack_trace: null,
        metadata: null,
      });
    }

    const page1 = await api.listLogs({ project_id: "proj-1", limit: 2 });
    const page2 = await api.listLogs({
      project_id: "proj-1",
      limit: 2,
      offset: 2,
    });

    expect(page1.map((r) => r.message)).toEqual(["msg-3", "msg-2"]);
    expect(page2.map((r) => r.message)).toEqual(["msg-1"]);
    expect(page2.map((r) => r.message)).not.toEqual(
      page1.map((r) => r.message),
    );
  });
});

describe("ApiStore scan port (hosted scan-run surface)", () => {
  test("getScanJob returns the job and null for an unknown id", async () => {
    const { api } = buildApiStore();
    const job = await api.getScanJob("job-1");
    expect(job?.id).toBe("job-1");
    expect(job?.project_id).toBe("proj-1");
    expect(await api.getScanJob("nope")).toBeNull();
  });

  test("runScanJob lands a completed run + last_run_at on the hosted path without the local-only guard", async () => {
    const { state, client } = buildApiStore();
    // Injectable scan executor keeps the test browser-free; it exercises the
    // hosted ingest sink so the full result path is proven.
    const apiWithExecutor = new ApiStore(client, {
      runScan: async (ctx, projectId, pageId) => {
        expect(projectId).toBe("proj-1");
        expect(pageId).toBe("page-1");
        const entry: LogEntry = {
          project_id: projectId,
          page_id: pageId,
          level: "error",
          source: "scanner",
          message: "hosted scan console error",
        };
        await ctx.ingest([entry]);
        await ctx.touchPage(pageId);
        return { logsCollected: 1, errorsFound: 1, perfScore: 77 };
      },
    });

    await apiWithExecutor.runScanJob("job-1", "proj-1", "page-1");

    const runs = [...state.scanRuns.values()];
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("completed");
    expect(runs[0]?.logs_collected).toBe(1);
    expect(runs[0]?.errors_found).toBe(1);
    expect(runs[0]?.perf_score).toBe(77);
    expect(runs[0]?.finished_at).not.toBeNull();

    const job = state.scanJobs.get("job-1");
    expect(job?.last_run_at).not.toBeNull();

    const page = state.pages.get("page-1");
    expect(page?.last_scanned_at).not.toBeNull();

    const logged = [...state.logs.values()];
    expect(logged.some((l) => l.message === "hosted scan console error")).toBe(
      true,
    );
  });

  test("runScanJob finishes a failed run when the scan throws", async () => {
    const { state, client } = buildApiStore();
    const apiWithExecutor = new ApiStore(client, {
      runScan: async () => {
        throw new Error("browser crashed");
      },
    });

    // Local parity: a failed page scan does not throw out of runScanJob.
    await apiWithExecutor.runScanJob("job-1", "proj-1", "page-1");

    const runs = [...state.scanRuns.values()];
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("failed");
    expect(runs[0]?.logs_collected).toBe(0);
    expect(runs[0]?.errors_found).toBe(0);
  });
});

beforeAll(() => {
  process.env.HASNA_LOGS_API_URL = "http://127.0.0.1:1/v1";
  process.env.HASNA_LOGS_API_KEY = tokenWith(["logs:read", "logs:write"]);
  // Point the client's disk tier ($HOME credential tier) at a temp dir so
  // the machine's real cloud config cannot disagree with the test key.
  process.env.HOME = mkdtempSync(join(tmpdir(), "logs-api-lane-home-"));
});

afterAll(() => {
  for (const [key, value] of ORIGINAL_ENV) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
