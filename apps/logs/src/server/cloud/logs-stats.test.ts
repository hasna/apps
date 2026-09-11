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
    const since = Date.parse(String(params.at(-1)));
    const count = (values: string[]): Record<string, string> => {
      const counts = new Map<string, number>();
      for (const value of values)
        counts.set(value, (counts.get(value) ?? 0) + 1);
      return Object.fromEntries(
        [...counts].map(([key, value]) => [key, String(value)]),
      );
    };
    const byLevel = count(scope.map((row) => row.level));
    const byService = Object.fromEntries(
      Object.entries(count(scope.map((row) => row.service ?? "-")))
        .sort(([aName, aCount], [bName, bCount]) =>
          Number(bCount) - Number(aCount) || aName.localeCompare(bName),
        )
        .slice(0, 5),
    );
    const validTimes = scope
      .map((row) => Date.parse(row.timestamp))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const byDay = count(
      validTimes
        .filter((observedAt) => observedAt >= since)
        .map((observedAt) => new Date(observedAt).toISOString().slice(0, 10)),
    );

    return [
      {
        total: String(scope.length),
        by_level: byLevel,
        by_service: byService,
        by_day: byDay,
        oldest:
          validTimes[0] === undefined ? null : new Date(validTimes[0]),
        newest:
          validTimes.at(-1) === undefined
            ? null
            : new Date(validTimes.at(-1)!),
      },
    ] as unknown as T[];
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

  test("empty corpus returns a complete zero/null contract", async () => {
    const h = app([]);
    const res = await h.app.request("/v1/logs/stats", { headers: read() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      total: 0,
      errors: 0,
      warns: 0,
      fatals: 0,
      by_level: {},
      by_service: {},
      by_day: {},
      oldest: null,
      newest: null,
    });
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

  test("coalesces missing and literal dash services into one bucket", async () => {
    const h = app([
      { project_id: null, level: "info", service: null, timestamp: day(0) },
      { project_id: null, level: "warn", service: "-", timestamp: day(0) },
    ]);
    const res = await h.app.request("/v1/logs/stats", { headers: read() });
    expect(res.status).toBe(200);
    expect((await res.json()).by_service).toEqual({ "-": 2 });
  });

  test("bounds the service response to five database-ranked buckets", async () => {
    const h = app(
      ["a", "b", "c", "d", "e", "f", "g"].flatMap((service, index) =>
        Array.from({ length: index + 1 }, () => ({
          project_id: null,
          level: "info",
          service,
          timestamp: day(0),
        })),
      ),
    );
    const res = await h.app.request("/v1/logs/stats", { headers: read() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.by_service)).toHaveLength(5);
    expect(Object.keys(body.by_service).sort()).toEqual(["c", "d", "e", "f", "g"]);
  });

  test("uses timestamptz-safe bounds and UTC buckets while ignoring invalid text", async () => {
    const older = new Date(NOW - 2 * 3_600_000);
    const newer = new Date(NOW - 3_600_000);
    const olderWithOffset = new Date(older.getTime() + 2 * 3_600_000)
      .toISOString()
      .replace("Z", "+02:00");
    const h = app([
      {
        project_id: null,
        level: "info",
        service: "api",
        timestamp: olderWithOffset,
      },
      {
        project_id: null,
        level: "info",
        service: "api",
        timestamp: newer.toISOString(),
      },
      {
        project_id: null,
        level: "info",
        service: "api",
        timestamp: "not-a-timestamp",
      },
    ]);
    const res = await h.app.request("/v1/logs/stats?days=1", {
      headers: read(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.oldest).toBe(older.toISOString());
    expect(body.newest).toBe(newer.toISOString());
    expect(Object.values(body.by_day).reduce((sum: number, n) => sum + Number(n), 0))
      .toBe(2);
    expect(h.sql).toHaveLength(1);
    expect(h.sql[0]).toContain("WITH scoped_logs AS MATERIALIZED");
    expect(h.sql[0]).toContain("pg_input_is_valid");
    expect(h.sql[0]).toContain("AT TIME ZONE 'UTC'");
    expect(h.sql[0]).toContain("::timestamptz");
    expect(h.sql[0]).toContain("LIMIT 5");
  });

  test("stats is not swallowed by /logs/:id", async () => {
    const h = app();
    await h.app.request("/v1/logs/stats", { headers: read() });
    // The single-log route reads `FROM logs WHERE id`; the stats aggregates
    // never do. If ordering regressed, "stats" would be read as a log id.
    expect(h.sql.some((text) => text.includes("FROM logs WHERE id"))).toBe(
      false,
    );
    expect(h.sql.length).toBe(1);
  });

  test("the route is published in the openapi document", () => {
    const doc = buildOpenApiDocument("9.9.9") as unknown as {
      paths: Record<string, { get?: { operationId?: string } }>;
      components: {
        schemas: Record<string, { required?: string[] }>;
      };
    };
    expect(doc.paths["/v1/logs/stats"]?.get?.operationId).toBe("logStats");
    expect(doc.components.schemas.LogStats?.required).toContain("oldest");
    expect(doc.components.schemas.LogStats?.required).toContain("newest");
  });
});
