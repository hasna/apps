import { describe, expect, test } from "bun:test";
import { buildOpenApiDocument } from "./openapi.ts";
import { buildCloudApp } from "./app.ts";
import {
  SIGNING_SECRET,
  buildTestCloudApp,
  fakeClient,
  mintApiKey,
  tokenWith,
} from "./test-helpers.ts";

/** Alias kept so existing tests read unchanged: the in-memory cloud app. */
function app() {
  return buildTestCloudApp();
}


describe("cloud serve probes", () => {
  test("/version returns status, version, backend", async () => {
    const res = await app().request("/version");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      version: "9.9.9",
      backend: "postgresql",
    });
  });

  test("/health reports db ok", async () => {
    const res = await app().request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.backend).toBe("postgresql");
    expect(body.db.ok).toBe(true);
  });

  test("/ready is ready when all migrations applied", async () => {
    const res = await app().request("/ready");
    expect(res.status).toBe(200);
    expect((await res.json()).pending_migrations).toEqual([]);
  });

  test("/openapi.json is served", async () => {
    const res = await app().request("/openapi.json");
    expect(res.status).toBe(200);
    expect((await res.json()).info.title).toBe("Logs");
  });
});

describe("cloud serve auth", () => {
  test("401 without a key", async () => {
    const res = await app().request("/v1/logs");
    expect(res.status).toBe(401);
  });

  test("401 with a bogus key", async () => {
    const res = await app().request("/v1/logs", {
      headers: { "x-api-key": "hasna_logs_bogus" },
    });
    expect(res.status).toBe(401);
  });

  test("403 when scope is insufficient", async () => {
    const res = await app().request("/v1/logs", {
      method: "POST",
      headers: {
        "x-api-key": tokenWith(["logs:read"]),
        "content-type": "application/json",
      },
      body: JSON.stringify({ level: "info", message: "x" }),
    });
    expect(res.status).toBe(403);
  });

  test("wrong-app token is rejected", async () => {
    const other = mintApiKey({
      app: "todos",
      scopes: ["todos:*"],
      signingSecret: SIGNING_SECRET,
    }).token;
    const res = await app().request("/v1/logs", {
      headers: { "x-api-key": other },
    });
    expect(res.status).toBe(401);
  });
});

describe("cloud serve CRUD roundtrip", () => {
  test("create project, ingest log, read, delete", async () => {
    const a = app();
    const key = tokenWith(["logs:read", "logs:write"]);
    const h = { "x-api-key": key, "content-type": "application/json" };

    const proj = await (
      await a.request("/v1/projects", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ name: "t" }),
      })
    ).json();
    expect(proj.id).toBeTruthy();

    const created = await a.request("/v1/logs", {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        level: "error",
        message: "boom",
        project_id: proj.id,
      }),
    });
    expect(created.status).toBe(201);
    const log = await created.json();
    expect(log.level).toBe("error");

    const got = await a.request(`/v1/logs/${log.id}`, {
      headers: { "x-api-key": key },
    });
    expect(got.status).toBe(200);

    const del = await a.request(`/v1/logs/${log.id}`, {
      method: "DELETE",
      headers: { "x-api-key": key },
    });
    expect((await del.json()).deleted).toBe(true);

    const gone = await a.request(`/v1/logs/${log.id}`, {
      headers: { "x-api-key": key },
    });
    expect(gone.status).toBe(404);
  });

  test("invalid level is rejected 400", async () => {
    const res = await app().request("/v1/logs", {
      method: "POST",
      headers: {
        "x-api-key": tokenWith(["logs:write"]),
        "content-type": "application/json",
      },
      body: JSON.stringify({ level: "nope", message: "x" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("cloud serve logs paging (offset forwarding)", () => {
  test("?limit=2&offset=2 returns the next page, not page 1 again", async () => {
    const a = app();
    const key = tokenWith(["logs:read", "logs:write"]);
    const h = { "x-api-key": key, "content-type": "application/json" };

    const proj = await (
      await a.request("/v1/projects", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ name: "paging" }),
      })
    ).json();

    // Seed three logs with distinct timestamps so ORDER BY timestamp DESC is
    // deterministic: newest first is msg-3, msg-2, msg-1.
    for (let i = 1; i <= 3; i++) {
      const res = await a.request("/v1/logs", {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          project_id: proj.id,
          level: "info",
          message: `msg-${i}`,
          timestamp: `2026-01-01T00:00:0${i}.000Z`,
        }),
      });
      expect(res.status).toBe(201);
    }

    const page1 = (await (
      await a.request(`/v1/logs?project_id=${proj.id}&limit=2`, {
        headers: { "x-api-key": key },
      })
    ).json()) as { logs: { message: string }[] };
    const page2 = (await (
      await a.request(`/v1/logs?project_id=${proj.id}&limit=2&offset=2`, {
        headers: { "x-api-key": key },
      })
    ).json()) as { logs: { message: string }[] };

    const m1 = page1.logs.map((l) => l.message);
    const m2 = page2.logs.map((l) => l.message);

    // Page 2 must be the rows after page 1, not page 1 replayed.
    expect(m1).toEqual(["msg-3", "msg-2"]);
    expect(m2).toEqual(["msg-1"]);
    expect(m2).not.toEqual(m1);
  });
});

describe("cloud serve data-plane parity (v1 surface)", () => {
  // Guards the review finding: events / test-reports / pages / jobs / perf /
  // issues / alert-rules / diagnose / compare must exist on the cloud /v1 API
  // so the ApiStore has parity with the local store after the fleet flip.
  const readRoutes = [
    "/v1/pages?project_id=p1",
    "/v1/jobs",
    "/v1/events",
    "/v1/test-reports",
    "/v1/perf/latest?project_id=p1",
    "/v1/perf/trend?project_id=p1",
    "/v1/issues",
    "/v1/alert-rules",
    "/v1/sessions/s1/context",
    "/v1/diagnose?project_id=p1",
    "/v1/compare?project_id=p1&a_since=2026-01-01&a_until=2026-01-02&b_since=2026-01-03&b_until=2026-01-04",
    "/v1/logs/l1/context",
  ];

  for (const route of readRoutes) {
    test(`GET ${route} requires a key (401)`, async () => {
      const res = await app().request(route);
      expect(res.status).toBe(401);
    });

    test(`GET ${route} succeeds with logs:read`, async () => {
      const res = await app().request(route, {
        headers: { "x-api-key": tokenWith(["logs:read"]) },
      });
      expect(res.status).toBe(200);
    });
  }

  test("write routes reject insufficient scope (403)", async () => {
    const h = {
      "x-api-key": tokenWith(["logs:read"]),
      "content-type": "application/json",
    };
    const pages = await app().request("/v1/pages", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ project_id: "p1", url: "https://x.test/" }),
    });
    expect(pages.status).toBe(403);
    const alerts = await app().request("/v1/alert-rules", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ project_id: "p1", name: "r" }),
    });
    expect(alerts.status).toBe(403);
  });

  test("POST /v1/events ingests a telemetry event and it round-trips", async () => {
    const a = app();
    const write = {
      "x-api-key": tokenWith(["logs:write"]),
      "content-type": "application/json",
    };
    const read = { "x-api-key": tokenWith(["logs:read"]) };

    // A logs:read key cannot ingest.
    const forbidden = await a.request("/v1/events", {
      method: "POST",
      headers: { ...read, "content-type": "application/json" },
      body: JSON.stringify({ type: "log", message: "hi" }),
    });
    expect(forbidden.status).toBe(403);

    // Ingest a single event.
    const created = await a.request("/v1/events", {
      method: "POST",
      headers: write,
      body: JSON.stringify({
        type: "log",
        source: "cli",
        message: "hello cloud",
        attributes: { project_id: "p1" },
      }),
    });
    expect(created.status).toBe(201);
    const event = (await created.json()) as { event_id: string; raw: unknown };
    expect(typeof event.event_id).toBe("string");
    expect(event.raw).toBeNull();

    // It is retrievable via search and by id.
    const listed = await a.request("/v1/events", { headers: read });
    expect(listed.status).toBe(200);
    expect(((await listed.json()).events as unknown[]).length).toBe(1);

    const fetched = await a.request(`/v1/events/${event.event_id}`, {
      headers: read,
    });
    expect(fetched.status).toBe(200);
    expect(((await fetched.json()) as { event_id: string }).event_id).toBe(
      event.event_id,
    );

    // A batch re-post of the same event is idempotent (inserted count 0).
    const batch = await a.request("/v1/events", {
      method: "POST",
      headers: write,
      body: JSON.stringify({ events: [{ type: "log", event_id: event.event_id }] }),
    });
    expect(batch.status).toBe(201);
    expect(((await batch.json()) as { inserted: number }).inserted).toBe(0);
  });

  test("POST /v1/events rejects an invalid event (422)", async () => {
    const res = await app().request("/v1/events", {
      method: "POST",
      headers: {
        "x-api-key": tokenWith(["logs:write"]),
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "not-a-real-type" }),
    });
    expect(res.status).toBe(422);
  });

  test("feedback requires logs:write and accepts a message", async () => {
    const res = await app().request("/v1/feedback", {
      method: "POST",
      headers: {
        "x-api-key": tokenWith(["logs:write"]),
        "content-type": "application/json",
      },
      body: JSON.stringify({ message: "great tool" }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).ok).toBe(true);
  });
});

describe("cloud serve scan-run + maintenance surface (localonly-logs)", () => {
  function appWithState() {
    const f = fakeClient();
    f.state.projects.set("proj-1", {
      id: "proj-1",
      name: "scanproj",
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
    const a = buildCloudApp({
      client: f.client,
      version: "9.9.9",
      signingSecret: SIGNING_SECRET,
      keyStatus: async (): Promise<"active"> => "active",
    });
    return { a, f };
  }

  test("GET /v1/jobs/:id returns the job and 404s for an unknown id", async () => {
    const { a } = appWithState();
    const read = { "x-api-key": tokenWith(["logs:read"]) };
    const got = await a.request("/v1/jobs/job-1", { headers: read });
    expect(got.status).toBe(200);
    expect((await got.json() as { id: string }).id).toBe("job-1");
    const missing = await a.request("/v1/jobs/nope", { headers: read });
    expect(missing.status).toBe(404);
  });

  test("PUT /v1/jobs/:id updates last_run_at", async () => {
    const { a } = appWithState();
    const write = {
      "x-api-key": tokenWith(["logs:write"]),
      "content-type": "application/json",
    };
    const res = await a.request("/v1/jobs/job-1", {
      method: "PUT",
      headers: write,
      body: JSON.stringify({ last_run_at: "2026-08-18T00:00:00.000Z" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).last_run_at).toBe("2026-08-18T00:00:00.000Z");
    const missing = await a.request("/v1/jobs/nope", {
      method: "PUT",
      headers: write,
      body: JSON.stringify({ last_run_at: "2026-08-18T00:00:00.000Z" }),
    });
    expect(missing.status).toBe(404);
  });

  test("POST /v1/jobs/:id/runs then PATCH finishes the run", async () => {
    const { a, f } = appWithState();
    const write = {
      "x-api-key": tokenWith(["logs:write"]),
      "content-type": "application/json",
    };
    const created = await a.request("/v1/jobs/job-1/runs", {
      method: "POST",
      headers: write,
      body: JSON.stringify({ page_id: "page-1" }),
    });
    expect(created.status).toBe(201);
    const run = (await created.json()) as { id: string; status: string };
    expect(run.status).toBe("running");
    expect(f.state.scanRuns.get(run.id)?.job_id).toBe("job-1");

    const finished = await a.request(
      `/v1/jobs/job-1/runs/${run.id}`,
      {
        method: "PATCH",
        headers: write,
        body: JSON.stringify({
          status: "completed",
          logs_collected: 3,
          errors_found: 1,
          perf_score: 88,
        }),
      },
    );
    expect(finished.status).toBe(200);
    const done = (await finished.json()) as {
      status: string;
      logs_collected: number;
      finished_at: string | null;
    };
    expect(done.status).toBe("completed");
    expect(done.logs_collected).toBe(3);
    expect(done.finished_at).not.toBeNull();

    const missing = await a.request("/v1/jobs/job-1/runs/nope", {
      method: "PATCH",
      headers: write,
      body: JSON.stringify({ status: "failed", logs_collected: 0, errors_found: 0 }),
    });
    expect(missing.status).toBe(404);
  });

  test("GET/PATCH /v1/pages/:id and POST /v1/perf/snapshot", async () => {
    const { a } = appWithState();
    const read = { "x-api-key": tokenWith(["logs:read"]) };
    const write = {
      "x-api-key": tokenWith(["logs:write"]),
      "content-type": "application/json",
    };
    const got = await a.request("/v1/pages/page-1", { headers: read });
    expect(got.status).toBe(200);
    expect((await got.json() as { url: string }).url).toBe("https://example.com");
    expect((await a.request("/v1/pages/nope", { headers: read })).status).toBe(404);

    const touched = await a.request("/v1/pages/page-1", {
      method: "PATCH",
      headers: write,
      body: JSON.stringify({ last_scanned_at: "2026-08-18T01:00:00.000Z" }),
    });
    expect(touched.status).toBe(200);
    expect((await touched.json() as { last_scanned_at: string }).last_scanned_at).toBe("2026-08-18T01:00:00.000Z");

    const perf = await a.request("/v1/perf/snapshot", {
      method: "POST",
      headers: write,
      body: JSON.stringify({
        project_id: "proj-1",
        page_id: "page-1",
        url: "https://example.com",
        fcp: 12.5,
        ttfb: 3.1,
      }),
    });
    expect(perf.status).toBe(201);
    expect((await perf.json() as { fcp: number }).fcp).toBe(12.5);
  });

  test("GET /v1/events supports the after-cursor ascending tail", async () => {
    const { a } = appWithState();
    const write = {
      "x-api-key": tokenWith(["logs:write"]),
      "content-type": "application/json",
    };
    const read = { "x-api-key": tokenWith(["logs:read"]) };
    const times = [
      "2026-08-18T00:00:00.000Z",
      "2026-08-18T00:00:01.000Z",
      "2026-08-18T00:00:02.000Z",
    ];
    for (const [i, t] of times.entries()) {
      const res = await a.request("/v1/events", {
        method: "POST",
        headers: write,
        body: JSON.stringify({
          type: "metric",
          source: "cli",
          event_id: `watch-evt-${i + 1}`,
          event_time: t,
          message: `watch event ${i + 1}`,
        }),
      });
      expect(res.status).toBe(201);
    }

    // Default (no cursor) is newest-first.
    const desc = await a.request("/v1/events", { headers: read });
    const descEvents = (await desc.json() as { events: Array<{ event_id: string }> }).events;
    expect(descEvents.map((e) => e.event_id)).toEqual([
      "watch-evt-3",
      "watch-evt-2",
      "watch-evt-1",
    ]);

    // Ascending tail after the second event returns only the third.
    const asc = await a.request(
      "/v1/events?order=asc&after_time=2026-08-18T00%3A00%3A01.000Z&after_id=watch-evt-2",
      { headers: read },
    );
    const ascEvents = (await asc.json() as { events: Array<{ event_id: string }> }).events;
    expect(ascEvents.map((e) => e.event_id)).toEqual(["watch-evt-3"]);

    // Ascending from the start returns everything oldest-first.
    const fromStart = await a.request("/v1/events?order=asc", {
      headers: read,
    });
    const startEvents = (await fromStart.json() as { events: Array<{ event_id: string }> }).events;
    expect(startEvents.map((e) => e.event_id)).toEqual([
      "watch-evt-1",
      "watch-evt-2",
      "watch-evt-3",
    ]);
  });
});

describe("openapi + sdk", () => {
  test("document lists all 7 operations", () => {
    const doc = buildOpenApiDocument("1.0.0");
    const opIds: string[] = [];
    for (const item of Object.values(
      doc.paths as Record<string, Record<string, { operationId?: string }>>,
    )) {
      for (const op of Object.values(item)) {
        if (op && typeof op === "object" && op.operationId)
          opIds.push(op.operationId);
      }
    }
    expect(opIds.sort()).toEqual(
      [
        "createProject",
        "deleteLog",
        "getLog",
        "getProject",
        "ingestLog",
        "listLogs",
        "listProjects",
      ].sort(),
    );
  });
});
