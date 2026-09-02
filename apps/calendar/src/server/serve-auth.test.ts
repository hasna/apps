import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "bun";
import { serve } from "./serve.js";
import { AuthNotConfiguredError } from "./auth-posture.js";
import { closeCloud } from "./cloud.js";
import { resetStoreCache } from "../store/index.js";
import { closeDatabase } from "../db/database.js";

/**
 * REGRESSION FENCE for defect 1: `/mcp` was mounted AFTER `handleV1Request`,
 * which returns null for every non-`/v1` path — so the only auth choke point in
 * the process never saw it. Anonymous `POST /mcp {"method":"tools/list"}`
 * returned HTTP 200 with the full 23-tool catalogue (`create_org`,
 * `register_agent`, `create_event`, `update_event`, `delete_event`,
 * `add_member`, …) on the public ALB-fronted deployment.
 *
 * Against main these tests fail: `/mcp` answers 200 and the body contains
 * `create_org` in every posture.
 *
 * `/health`, `/ready`, `/version` and `/openapi.json` MUST stay public in every
 * posture — the ALB target group health-checks `/health` with a 200 matcher and
 * ECS cycles the task if it stops answering.
 */

const CREDENTIAL = "serve-credential-for-tests-only";
const DUMMY_DSN = "postgres://calendar_app@127.0.0.1:1/calendar_test";
const DUMMY_SIGNING_SECRET = "signing-secret-for-tests-only";

const CLIENT_FLIP_AND_HOSTED_VARS = [
  "HASNA_CALENDAR_API_URL",
  "CALENDAR_API_URL",
  "HASNA_CALENDAR_API_KEY",
  "CALENDAR_API_KEY",
  "HASNA_CALENDAR_DATABASE_URL",
  "CALENDAR_DATABASE_URL",
  "DATABASE_URL",
  "HASNA_CALENDAR_API_SIGNING_KEY",
  "HASNA_API_SIGNING_KEY",
  "API_KEY_SIGNING_SECRET",
  "CALENDAR_SERVE_API_KEY",
  "HASNA_CALENDAR_SERVE_API_KEY",
  "CALENDAR_ALLOW_ANONYMOUS",
  "CALENDAR_DB_PATH",
  "CALENDAR_HOST",
  "HOST",
] as const;

let started: Server | null = null;
let tempHome: string | null = null;

function applyEnv(env: Record<string, string>) {
  for (const key of CLIENT_FLIP_AND_HOSTED_VARS) delete process.env[key];
  tempHome = mkdtempSync(join(tmpdir(), "calendar-serve-auth-"));
  process.env.CALENDAR_DB_PATH = join(tempHome, "calendar.db");
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  resetStoreCache();
}

function startServer(env: Record<string, string>, options: Parameters<typeof serve>[1] = {}) {
  applyEnv(env);
  started = serve(0, { host: "127.0.0.1", ...options });
  return `http://127.0.0.1:${started.port}`;
}

afterEach(async () => {
  if (started) {
    started.stop(true);
    started = null;
  }
  await closeCloud();
  resetStoreCache();
  closeDatabase();
  for (const key of CLIENT_FLIP_AND_HOSTED_VARS) delete process.env[key];
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
});

const TOOLS_LIST = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

async function mcpPost(base: string, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { ...MCP_HEADERS, ...extraHeaders },
    body: TOOLS_LIST,
  });
  return { status: res.status, body: await res.text() };
}

/** The probe routes the ALB / ECS depend on. Must be 200 in every posture. */
async function expectProbesPublic(base: string, opts: { ready: boolean }) {
  for (const path of ["/health", "/version", "/openapi.json", ...(opts.ready ? ["/ready"] : [])]) {
    const res = await fetch(`${base}${path}`);
    expect(`${path} -> ${res.status}`).toBe(`${path} -> 200`);
    const text = await res.text();
    // Probes are metadata only: never a credential, never a DSN.
    expect(text).not.toContain(CREDENTIAL);
    expect(text).not.toContain(DUMMY_SIGNING_SECRET);
    expect(text).not.toContain("postgres://");
  }
}

describe("hosted posture (the calendar-prod shape): /mcp is not served at all", () => {
  const hostedEnv = {
    HASNA_CALENDAR_DATABASE_URL: DUMMY_DSN,
    HASNA_CALENDAR_API_SIGNING_KEY: DUMMY_SIGNING_SECRET,
  };

  test("anonymous POST /mcp is refused and discloses no tool catalogue", async () => {
    const base = startServer(hostedEnv);
    const { status, body } = await mcpPost(base);
    expect(status).toBe(404);
    expect(body).not.toContain("create_org");
    expect(body).not.toContain("register_agent");
    expect(body).not.toContain("delete_event");
    expect(JSON.parse(body).code).toBe("LOCAL_PLANE_DISABLED");
  });

  test.each(["GET", "DELETE", "PUT", "PATCH"])("anonymous %s /mcp is refused too", async (method) => {
    const base = startServer(hostedEnv);
    const res = await fetch(`${base}/mcp`, { method, headers: MCP_HEADERS });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("create_org");
  });

  test("a guessed credential does not re-open the plane", async () => {
    const base = startServer(hostedEnv);
    for (const headers of [
      { "x-api-key": CREDENTIAL },
      { authorization: `Bearer ${CREDENTIAL}` },
      { "x-forwarded-for": "127.0.0.1" },
    ]) {
      const { status, body } = await mcpPost(base, headers);
      expect(status).toBe(404);
      expect(body).not.toContain("create_org");
    }
  });

  test("every /v1 data route rejects an anonymous caller", async () => {
    const base = startServer(hostedEnv);
    const reads = [
      "/v1/orgs",
      "/v1/calendars",
      "/v1/events",
      "/v1/events/search?q=x",
      "/v1/events/conflicts?calendar_id=c&start=2026-01-01T00:00:00Z&end=2026-01-01T01:00:00Z",
      "/v1/attendees?event_id=e",
      "/v1/agents",
      "/v1/availability?agent_id=a",
      "/v1/members?org_id=o",
      "/v1",
    ];
    for (const path of reads) {
      const res = await fetch(`${base}${path}`);
      expect(`GET ${path} -> ${res.status}`).toBe(`GET ${path} -> 401`);
    }
    const writes: Array<[string, string]> = [
      ["POST", "/v1/orgs"],
      ["POST", "/v1/calendars"],
      ["POST", "/v1/events"],
      ["POST", "/v1/attendees"],
      ["POST", "/v1/agents"],
      ["POST", "/v1/availability"],
      ["POST", "/v1/members"],
      ["PATCH", "/v1/events/abc"],
      ["DELETE", "/v1/events/abc"],
      ["DELETE", "/v1/orgs/abc"],
    ];
    for (const [method, path] of writes) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : "{}",
      });
      expect(`${method} ${path} -> ${res.status}`).toBe(`${method} ${path} -> 401`);
    }
  });

  test("probes stay public (ALB health check keeps passing)", async () => {
    const base = startServer(hostedEnv);
    // /ready is excluded here only because it dials the (deliberately dead) DSN.
    await expectProbesPublic(base, { ready: false });
  });

  test("/health reports the postgres backend label", async () => {
    const base = startServer(hostedEnv);
    const health = (await (await fetch(`${base}/health`)).json()) as { backend: string; status: string };
    expect(health.status).toBe("ok");
    expect(health.backend).toBe("postgres");
  });

  test("OPTIONS /mcp is claimed by the guarded route, not the CORS handler", async () => {
    // Documented quirk (pre-existing shape, now asserted): route 14 matches on
    // PATH only, so a preflight goes through the auth posture and gets 404 here
    // (401 under `enforce`) with no Access-Control-* headers. Only paths that are
    // neither /v1* nor /mcp reach the route-15 CORS responder.
    const base = startServer(hostedEnv);
    const res = await fetch(`${base}/mcp`, { method: "OPTIONS" });
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(await res.text()).not.toContain("create_org");

    const other = await fetch(`${base}/anything-else`, { method: "OPTIONS" });
    expect(other.status).toBe(200);
    expect(other.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("PostgreSQL-only server posture", () => {
  test("no DSN, no credential: the server refuses to start", () => {
    applyEnv({});
    expect(() => serve(0, { host: "127.0.0.1" })).toThrow("HASNA_CALENDAR_DATABASE_URL is required");
  });

  test("/health reports the PostgreSQL backend label", async () => {
    const base = startServer({ HASNA_CALENDAR_DATABASE_URL: DUMMY_DSN });
    const health = (await (await fetch(`${base}/health`)).json()) as { backend: string; status: string };
    expect(health.status).toBe("ok");
    expect(health.backend).toBe("postgres");
  });
});

describe("enforce posture: /mcp requires the serve credential", () => {
  const enforceEnv = { CALENDAR_SERVE_API_KEY: CREDENTIAL, HASNA_CALENDAR_DATABASE_URL: DUMMY_DSN, HASNA_CALENDAR_API_URL: "https://calendar.example.test", HASNA_CALENDAR_API_KEY: "fixture-key" };

  test("anonymous POST /mcp is 401 and leaks no tool names", async () => {
    const base = startServer(enforceEnv);
    const { status, body } = await mcpPost(base);
    expect(status).toBe(401);
    expect(body).not.toContain("create_org");
    expect(JSON.parse(body).code).toBe("UNAUTHENTICATED");
  });

  test("a wrong credential is 401", async () => {
    const base = startServer(enforceEnv);
    const { status } = await mcpPost(base, { "x-api-key": "wrong" });
    expect(status).toBe(401);
  });

  test("the correct credential reaches the MCP transport", async () => {
    const base = startServer(enforceEnv);
    for (const headers of [{ "x-api-key": CREDENTIAL }, { authorization: `Bearer ${CREDENTIAL}` }]) {
      const { status, body } = await mcpPost(base, headers);
      expect(status).toBe(200);
      expect(body).toContain("create_org");
    }
  });

  test("probes stay public and never echo the credential", async () => {
    const base = startServer(enforceEnv);
    await expectProbesPublic(base, { ready: false });
  });
});

describe("anonymous-loopback posture", () => {
  test("anonymous opt-in does not create a SQLite server", () => {
    applyEnv({ CALENDAR_ALLOW_ANONYMOUS: "1" });
    expect(() => serve(0, { host: "127.0.0.1" })).toThrow("HASNA_CALENDAR_DATABASE_URL is required");
  });

  test("serve() REFUSES to bind 0.0.0.0 with only --allow-anonymous", () => {
    applyEnv({ CALENDAR_ALLOW_ANONYMOUS: "1" });
    expect(() => serve(0, { host: "0.0.0.0" })).toThrow("HASNA_CALENDAR_DATABASE_URL is required");
  });

  test("serve() REFUSES to start with nothing configured at all", () => {
    applyEnv({});
    expect(() => serve(0, { host: "127.0.0.1" })).toThrow("HASNA_CALENDAR_DATABASE_URL is required");
    expect(() => serve(0, { host: "0.0.0.0" })).toThrow("HASNA_CALENDAR_DATABASE_URL is required");
  });
});

describe("split-backend guard: a hosted serve process with an on-box-SQLite client flip is refused", () => {
  test("serve() throws SplitStorePlaneError when /mcp would hit a different store", () => {
    // Hosted /v1 (Postgres) + a serve credential, but the client env points
    // getStore() nowhere (no API URL+key): /mcp would serve on-box SQLite.
    applyEnv({ HASNA_CALENDAR_DATABASE_URL: DUMMY_DSN });
    expect(() =>
      serve(0, {
        host: "127.0.0.1",
        apiKey: CREDENTIAL,
      }),
    ).toThrow(/two DIFFERENT datasets/);
  });
});
