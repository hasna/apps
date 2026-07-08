import { describe, expect, test } from "bun:test";
import { mintApiKey } from "@hasna/contracts/auth";
import type { QueryResultRow } from "pg";
import { logsCloudMigrations } from "../../db/pg-migrate.ts";
import type { TypedQueryClient } from "../../generated/storage-kit/index.ts";
import { buildCloudApp } from "./app.ts";
import { buildOpenApiDocument } from "./openapi.ts";

const SIGNING_SECRET = "test-signing-secret-do-not-use-in-prod";

/**
 * In-memory fake of the vendored kit's TypedQueryClient. Enough to exercise the
 * cloud routes without a live Postgres: it pattern-matches on the SQL text.
 */
function fakeClient(): {
  client: TypedQueryClient;
  state: {
    logs: Map<string, Record<string, unknown>>;
    projects: Map<string, Record<string, unknown>>;
  };
} {
  const state = {
    logs: new Map<string, Record<string, unknown>>(),
    projects: new Map<string, Record<string, unknown>>(),
    migrations: logsCloudMigrations().map((m) => ({ id: m.id })),
  };

  async function run<T extends QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const s = sql.replace(/\s+/g, " ").trim();
    if (s.startsWith("SELECT id FROM schema_migrations")) {
      return state.migrations as unknown as T[];
    }
    if (s.startsWith("SELECT 1 AS ok")) return [{ ok: 1 } as unknown as T];
    if (s.startsWith("INSERT INTO projects")) {
      const [id, name] = params as string[];
      const row = {
        id,
        name,
        github_repo: null,
        base_url: null,
        description: null,
        created_at: new Date().toISOString(),
      };
      state.projects.set(id ?? "", row);
      return [row as unknown as T];
    }
    if (
      s.startsWith(
        "SELECT id, name, github_repo, base_url, description, created_at FROM projects WHERE name",
      )
    ) {
      return []; // no dup
    }
    if (
      s.startsWith(
        "SELECT id, name, github_repo, base_url, description, created_at FROM projects WHERE id",
      )
    ) {
      const row = state.projects.get((params as string[])[0] ?? "");
      return row ? [row as unknown as T] : [];
    }
    if (
      s.startsWith(
        "SELECT id, name, github_repo, base_url, description, created_at FROM projects",
      )
    ) {
      return [...state.projects.values()] as unknown as T[];
    }
    if (s.startsWith("INSERT INTO logs")) {
      const p = params as unknown[];
      const row = {
        id: p[0],
        timestamp: new Date().toISOString(),
        project_id: p[2],
        level: p[3],
        source: p[4],
        service: p[5],
        message: p[6],
        trace_id: p[7],
        session_id: p[8],
        agent: p[9],
        url: p[10],
        stack_trace: p[11],
        metadata: p[12],
      };
      state.logs.set(p[0] as string, row);
      return [row as unknown as T];
    }
    if (s.startsWith("DELETE FROM logs WHERE id")) {
      const id = (params as string[])[0] ?? "";
      const existed = state.logs.delete(id);
      return existed ? [{ id } as unknown as T] : [];
    }
    if (s.startsWith("SELECT") && s.includes("FROM logs WHERE id")) {
      const row = state.logs.get((params as string[])[0] ?? "");
      return row ? [row as unknown as T] : [];
    }
    if (s.startsWith("SELECT") && s.includes("FROM logs")) {
      return [...state.logs.values()] as unknown as T[];
    }
    if (s.startsWith("INSERT INTO feedback")) {
      return [{ id: "fb1" } as unknown as T];
    }
    return [];
  }

  const client: TypedQueryClient = {
    async query(sql, params) {
      const rows = await run(sql, params);
      return { rows, rowCount: rows.length };
    },
    many: (sql, params) => run(sql, params),
    async get(sql, params) {
      const rows = await run(sql, params);
      return rows[0] ?? null;
    },
    async one(sql, params) {
      const rows = await run(sql, params);
      if (rows.length !== 1) throw new Error("expected one row");
      return rows[0] as T;
    },
    async execute(sql, params) {
      await run(sql, params);
    },
  };
  return { client, state };
}

function tokenWith(scopes: string[]): string {
  return mintApiKey({
    app: "logs",
    scopes,
    signingSecret: SIGNING_SECRET,
    agent: "test",
  }).token;
}

function app() {
  return buildCloudApp({
    client: fakeClient().client,
    version: "9.9.9",
    signingSecret: SIGNING_SECRET,
  });
}

describe("cloud serve probes", () => {
  test("/version returns status, version, mode", async () => {
    const res = await app().request("/version");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      version: "9.9.9",
      mode: "cloud",
    });
  });

  test("/health reports db ok", async () => {
    const res = await app().request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.mode).toBe("cloud");
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
