/**
 * `GET /v1/logs/stats` — the server half of the `logs stats` / `log_stats` port.
 *
 * Before this route, both the CLI `stats` command and the `log_stats` MCP tool
 * asked the API for `listLogs({ limit: 100000 })` and folded the rows in the
 * client. The aggregate now runs where the data is.
 *
 * The `TypedQueryClient` here is aggregate-aware on purpose: it asserts the SQL
 * shapes `CloudLogStore.statsSummary` issues and computes the answers from an
 * in-memory row set, so the test fails both when the route stops being wired
 * and when the store composes the response wrongly. (The repo-wide fake in
 * `test-helpers.ts` deliberately returns raw rows for `FROM logs`, which cannot
 * exercise a GROUP BY.)
 */
import { describe, expect, test } from "bun:test";
import type { QueryResultRow } from "pg";
import type { TypedQueryClient } from "../../generated/storage-kit/index.ts";
import { buildCloudApp } from "./app.ts";
import { buildOpenApiDocument } from "./openapi.ts";
import { SIGNING_SECRET, tokenWith } from "./test-helpers.ts";

interface Row {
  project_id: string | null;
  level: string;
  service: string | null;
  timestamp: string;
}

/** Pinned once so the fixture and the assertions describe the same instants. */
const NOW = Date.now();
const day = (offset: number): string =>
  new Date(NOW - offset * 86_400_000).toISOString();

/** Six rows across two projects, three levels, two services and four days. */
function rows(): Row[] {
  return [
    { project_id: "p1", level: "error", service: "api", timestamp: day(0) },
    { project_id: "p1", level: "error", service: "api", timestamp: day(1) },
    { project_id: "p1", level: "warn", service: null, timestamp: day(1) },
    { project_id: "p1", level: "info", service: "web", timestamp: day(5) },
    { project_id: "p1", level: "fatal", service: "api", timestamp: day(40) },
    { project_id: "p2", level: "info", service: "other", timestamp: day(0) },
  ];
}

function aggregateClient(data: Row[] = rows()): {
  client: TypedQueryClient;
  sql: string[];
} {
  const sql: string[] = [];
  const scoped = (text: string, params: readonly unknown[]): Row[] =>
    text.includes("project_id = $1")
      ? data.filter((r) => r.project_id === params[0])
      : data;

  const run = async <T extends QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> => {
    sql.push(text.replace(/\s+/g, " ").trim());
    const scope = scoped(text, params);

    if (text.includes("GROUP BY level")) {
      const counts = new Map<string, number>();
      for (const r of scope) counts.set(r.level, (counts.get(r.level) ?? 0) + 1);
      return [...counts].map(([level, c]) => ({
        level,
        c: String(c),
      })) as unknown as T[];
    }
    if (text.includes("GROUP BY service")) {
      const counts = new Map<string | null, number>();
      for (const r of scope)
        counts.set(r.service, (counts.get(r.service) ?? 0) + 1);
      return [...counts]
        .sort((a, b) => b[1] - a[1])
        .map(([service, c]) => ({ service, c: String(c) })) as unknown as T[];
    }
    if (text.includes("MIN(timestamp)")) {
      const times = scope.map((r) => r.timestamp).sort();
      return [
        { oldest: times[0] ?? null, newest: times.at(-1) ?? null },
      ] as unknown as T[];
    }
    if (text.includes("GROUP BY day")) {
      // The `timestamp >= $N` bound is the last parameter.
      const since = String(params.at(-1));
      const counts = new Map<string, number>();
      for (const r of scope) {
        if (r.timestamp < since) continue;
        const d = r.timestamp.slice(0, 10);
        counts.set(d, (counts.get(d) ?? 0) + 1);
      }
      return [...counts]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([d, c]) => ({ day: d, c: String(c) })) as unknown as T[];
    }
    throw new Error(`aggregateClient: unexpected SQL: ${text}`);
  };

  const client: TypedQueryClient = {
    async query<T extends QueryResultRow>(t: string, p?: readonly unknown[]) {
      const r = await run<T>(t, p);
      return { rows: r, rowCount: r.length };
    },
    many: <T extends QueryResultRow>(t: string, p?: readonly unknown[]) =>
      run<T>(t, p),
    async get<T extends QueryResultRow>(t: string, p?: readonly unknown[]) {
      return (await run<T>(t, p))[0] ?? null;
    },
    async one<T extends QueryResultRow>(t: string, p?: readonly unknown[]) {
      const r = await run<T>(t, p);
      if (r.length !== 1) throw new Error("expected one row");
      return r[0] as T;
    },
    async execute<T extends QueryResultRow>(t: string, p?: readonly unknown[]) {
      await run<T>(t, p);
    },
  };
  return { client, sql };
}

function app(data?: Row[]) {
  const { client, sql } = aggregateClient(data);
  return {
    sql,
    app: buildCloudApp({
      client,
      version: "9.9.9",
      signingSecret: SIGNING_SECRET,
      keyStatus: async (): Promise<"active"> => "active",
    }),
  };
}

const read = (): HeadersInit => ({
  authorization: `Bearer ${tokenWith(["logs:read"])}`,
});

describe("GET /v1/logs/stats", () => {
  test("refuses an unauthenticated caller and never runs a query", async () => {
    const h = app();
    const res = await h.app.request("/v1/logs/stats");
    expect(res.status).not.toBe(200);
    expect(h.sql).toEqual([]);
  });

  test("refuses a token without logs:read", async () => {
    const h = app();
    const res = await h.app.request("/v1/logs/stats", {
      headers: { authorization: `Bearer ${tokenWith(["logs:write"])}` },
    });
    expect(res.status).not.toBe(200);
    expect(h.sql).toEqual([]);
  });

  test("aggregates level, service, day and bounds server-side", async () => {
    const h = app();
    const res = await h.app.request("/v1/logs/stats", { headers: read() });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.total).toBe(6);
    expect(body.by_level).toEqual({ error: 2, warn: 1, info: 2, fatal: 1 });
    expect(body.errors).toBe(2);
    expect(body.warns).toBe(1);
    expect(body.fatals).toBe(1);
    // A null service renders as `-`, exactly as the client-side fold did.
    expect(body.by_service["-"]).toBe(1);
    expect(body.by_service.api).toBe(3);
    expect(body.by_service.web).toBe(1);
    expect(body.by_service.other).toBe(1);
    // Default window is 7 days: the 40-day-old fatal is outside it, but it
    // still counts in the totals and sets `oldest`.
    expect(Object.values(body.by_day).reduce((a: number, b) => a + Number(b), 0))
      .toBe(5);
    expect(body.oldest).toBe(
      [...rows()].map((r) => r.timestamp).sort()[0] ?? null,
    );
    expect(typeof body.newest).toBe("string");
    expect(body.oldest! < body.newest!).toBe(true);
  });

  test("project_id scopes every aggregate", async () => {
    const h = app();
    const res = await h.app.request("/v1/logs/stats?project_id=p2", {
      headers: read(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.by_level).toEqual({ info: 1 });
    expect(body.by_service).toEqual({ other: 1 });
    // Every query carried the scope — none of them silently counted p1.
    expect(h.sql.every((text) => text.includes("project_id = $1"))).toBe(true);
  });

  test("days narrows only the daily histogram", async () => {
    const h = app();
    const res = await h.app.request("/v1/logs/stats?days=2", {
      headers: read(),
    });
    const body = await res.json();
    expect(body.total).toBe(6);
    expect(Object.values(body.by_day).reduce((a: number, b) => a + Number(b), 0))
      .toBe(4);
  });

  test("stats is not swallowed by /logs/:id", async () => {
    const h = app();
    await h.app.request("/v1/logs/stats", { headers: read() });
    // The single-log route reads `FROM logs WHERE id`; the stats aggregates
    // never do. If ordering regressed, "stats" would be read as a log id.
    expect(h.sql.some((text) => text.includes("FROM logs WHERE id"))).toBe(
      false,
    );
    expect(h.sql.length).toBe(4);
  });

  test("the route is published in the openapi document", () => {
    const doc = buildOpenApiDocument("9.9.9") as unknown as {
      paths: Record<string, { get?: { operationId?: string } }>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.paths["/v1/logs/stats"]?.get?.operationId).toBe("logStats");
    expect(doc.components.schemas.LogStats).toBeDefined();
  });
});
