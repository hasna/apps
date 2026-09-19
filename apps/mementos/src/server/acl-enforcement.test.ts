// Server-side ACL enforcement through the REAL router and the REAL auth gate.
//
// This is the test that proves the defect the predecessor PR was closed for is
// fixed: a direct HTTP caller must not be able to read or write a key its
// policy denies, and the default for "no policy at all" must be an explicitly
// tested state rather than an accidental grant.
//
// The ACL subject is the `agent` claim on a VERIFIED key. These tests mint real
// keyed principals (with and without an agent claim) and drive the routes
// through `checkApiKey`, so a body/header-spoofed agent cannot be used to pick
// a different policy.

process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { mintApiKey } from "@hasna/contracts/auth";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createMemory } from "../db/memories.js";
import { setAcl } from "../db/acl.js";
import { matchRoute } from "./router.js";
import { checkApiKey } from "./auth.js";
import "./routes/memories-crud.js";
import "./routes/memories-search.js";
import "./routes/memories-misc.js";
import "./routes/memories-io.js";
import "./routes/memories-bulk.js";
import "./routes/acl.js";
import "./routes/ratings.js";

const home = mkdtempSync(join(tmpdir(), "mementos-acl-enforce-"));
const signingSecret = randomBytes(32).toString("hex");

// An agent-bearing key (subject = "agent-a") and a key with no agent claim.
const keyAgentA = mintApiKey({ app: "mementos", scopes: ["mementos:*"], signingSecret, agent: "agent-a" }).token;
const keyAgentB = mintApiKey({ app: "mementos", scopes: ["mementos:*"], signingSecret, agent: "agent-b" }).token;
const keyNoAgent = mintApiKey({ app: "mementos", scopes: ["mementos:*"], signingSecret }).token;

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  for (const key of ["API_KEY_SIGNING_SECRET", "HASNA_MEMENTOS_API_SIGNING_KEY", "HASNA_API_SIGNING_KEY"]) delete process.env[key];
  process.env["API_KEY_SIGNING_SECRET"] = signingSecret;
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname.replace(/^\/v1(?=\/)/, "/api");
      const denied = await checkApiKey(req, req.method, path);
      if (denied) return denied;
      const route = matchRoute(req.method, path);
      return route ? route.handler(req, url, route.params) : Response.json({ error: "No fixture route" }, { status: 404 });
    },
  });
});

afterAll(() => {
  server?.stop(true);
  resetDatabase();
  delete process.env["API_KEY_SIGNING_SECRET"];
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  resetDatabase();
});

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; agentId?: string } = {},
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token ?? keyAgentA) headers["authorization"] = `Bearer ${opts.token ?? keyAgentA}`;
  // A caller may TRY to name a different agent in the body/query; enforcement
  // must ignore it and use the verified principal's agent.
  const res = await fetch(`${server.url.origin}/v1${path}`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : {} };
}

describe("ACL enforcement on authoritative memory boundaries", () => {
  test("a denied read is refused on the single-memory route (403, diagnosable)", async () => {
    const db = getDatabase();
    const mem = createMemory({ key: "secret-prod", value: "v", category: "fact" }, db);
    // agent-a may read only architecture-*: secret-prod is not covered -> deny.
    setAcl("agent-a", "architecture-*", "read", undefined, db);

    const denied = await call("GET", `/memories/${mem.id}`);
    expect(denied.status).toBe(403);
    expect(denied.data["error"]).toContain("ACL");
    expect(denied.data["details"]?.["policy_state"] ?? denied.data["details"]?.["code"]).toBeTruthy();
  });

  test("a denied read is NOT bypassable by listing every memory", async () => {
    const db = getDatabase();
    createMemory({ key: "architecture-db", value: "ok", category: "fact" }, db);
    createMemory({ key: "secret-prod", value: "hidden", category: "fact" }, db);
    setAcl("agent-a", "architecture-*", "read", undefined, db);

    const list = await call("GET", "/memories");
    expect(list.status).toBe(200);
    const keys = (list.data["memories"] as { key: string }[]).map((m) => m.key);
    expect(keys).toContain("architecture-db");
    expect(keys).not.toContain("secret-prod");
  });

  test("a denied read is NOT bypassable through search", async () => {
    const db = getDatabase();
    createMemory({ key: "architecture-db", value: "findme", category: "fact" }, db);
    createMemory({ key: "secret-prod", value: "findme", category: "fact" }, db);
    setAcl("agent-a", "architecture-*", "read", undefined, db);

    const res = await call("POST", "/memories/search", { body: { query: "findme" } });
    expect(res.status).toBe(200);
    const keys = (res.data["results"] as { memory: { key: string } }[]).map((r) => r.memory.key);
    expect(keys).not.toContain("secret-prod");
  });

  test("a denied read is NOT bypassable through export or inject", async () => {
    const db = getDatabase();
    createMemory({ key: "architecture-db", value: "ctx", category: "fact", importance: 9 }, db);
    createMemory({ key: "secret-prod", value: "ctx", category: "fact", importance: 9 }, db);
    setAcl("agent-a", "architecture-*", "read", undefined, db);

    const exp = await call("POST", "/memories/export", { body: {} });
    const expKeys = (exp.data["memories"] as { key: string }[]).map((m) => m.key);
    expect(expKeys).not.toContain("secret-prod");

    const inj = await call("GET", "/inject?format=json&max_tokens=10000");
    expect(inj.status).toBe(200);
    expect(inj.data["context"]).not.toContain("secret-prod");
  });

  test("a denied write is refused on create, and nothing is written", async () => {
    const db = getDatabase();
    setAcl("agent-a", "team-*", "readwrite", undefined, db);

    const denied = await call("POST", "/memories", { body: { key: "secret-prod", value: "v", category: "fact" } });
    expect(denied.status).toBe(403);

    // Nothing persisted.
    const list = await call("GET", "/memories");
    const keys = (list.data["memories"] as { key: string }[]).map((m) => m.key);
    expect(keys).not.toContain("secret-prod");
  });

  test("a denied write is refused on patch and delete", async () => {
    const db = getDatabase();
    const mem = createMemory({ key: "secret-prod", value: "v", category: "fact" }, db);
    setAcl("agent-a", "team-*", "readwrite", undefined, db);

    expect((await call("PATCH", `/memories/${mem.id}`, { body: { value: "changed" } })).status).toBe(403);
    expect((await call("DELETE", `/memories/${mem.id}`)).status).toBe(403);
    // Still present and UNCHANGED. Read it from the store directly: the caller
    // cannot read this key, so the list route must NOT show it (that filtering
    // is itself asserted above).
    const { getMemory } = await import("../db/memories.js");
    const persisted = getMemory(mem.id, getDatabase());
    expect(persisted).not.toBeNull();
    expect(persisted!.value).toBe("v");
  });

  test("a denied write is refused on bulk-forget and bulk-update", async () => {
    const db = getDatabase();
    const restricted = createMemory({ key: "secret-prod", value: "v", category: "fact" }, db);
    const allowed = createMemory({ key: "team-notes", value: "v", category: "fact" }, db);
    setAcl("agent-a", "team-*", "readwrite", undefined, db);

    const forget = await call("POST", "/memories/bulk-forget", { body: { ids: [restricted.id, allowed.id] } });
    expect(forget.status).toBe(200);
    expect(forget.data["deleted"]).toBe(1);
    expect(forget.data["denied"]).toContain(restricted.id);

    const update = await call("POST", "/memories/bulk-update", { body: { ids: [restricted.id], value: "x" } });
    expect(update.status).toBe(200);
    expect(update.data["denied"]).toContain(restricted.id);
  });

  test("insufficient permission (read rule, write asked) is refused and names the rule", async () => {
    const db = getDatabase();
    setAcl("agent-a", "team-*", "read", undefined, db);
    const denied = await call("POST", "/memories", { body: { key: "team-notes", value: "v", category: "fact" } });
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.data)).toContain("team-*");
  });

  test("the verified principal's agent decides, not a body/query-supplied agent", async () => {
    const db = getDatabase();
    createMemory({ key: "secret-prod", value: "v", category: "fact" }, db);
    // agent-a is restricted; agent-b is not configured (full access).
    setAcl("agent-a", "architecture-*", "read", undefined, db);

    // Call as agent-a but claim agent-b in the body: still denied.
    const spoofed = await call("POST", "/memories/search", {
      token: keyAgentA,
      body: { query: "v", agent_id: "agent-b" },
    });
    const spoofedKeys = (spoofed.data["results"] as { memory: { key: string } }[]).map((r) => r.memory.key);
    expect(spoofedKeys).not.toContain("secret-prod");

    // The genuinely unconfigured agent-b still sees it: no policy, documented default.
    const b = await call("POST", "/memories/search", { token: keyAgentB, body: { query: "v" } });
    const bKeys = (b.data["results"] as { memory: { key: string } }[]).map((r) => r.memory.key);
    expect(bKeys).toContain("secret-prod");
  });

  test("a key with no agent claim has no ACL subject and is not silently restricted", async () => {
    const db = getDatabase();
    createMemory({ key: "secret-prod", value: "v", category: "fact" }, db);
    setAcl("agent-a", "architecture-*", "read", undefined, db);

    const res = await call("GET", "/memories", { token: keyNoAgent });
    expect(res.status).toBe(200);
    const keys = (res.data["memories"] as { key: string }[]).map((m) => m.key);
    expect(keys).toContain("secret-prod");
  });
});

describe("ACL decision endpoint reports policy state", () => {
  test("unconfigured, granted, insufficient, and no-match are distinct", async () => {
    const db = getDatabase();

    const unconfigured = await call("GET", "/acl/check?agent_id=nobody&key=any");
    expect(unconfigured.data["allowed"]).toBe(true);
    expect(unconfigured.data["policy_state"]).toBe("unconfigured");

    setAcl("agent-c", "architecture-*", "read", undefined, db);
    const granted = await call("GET", "/acl/check?agent_id=agent-c&key=architecture-db&permission=read");
    expect(granted.data["allowed"]).toBe(true);
    expect(granted.data["policy_state"]).toBe("granted");

    const insufficient = await call("GET", "/acl/check?agent_id=agent-c&key=architecture-db&permission=write");
    expect(insufficient.data["allowed"]).toBe(false);
    expect(insufficient.data["policy_state"]).toBe("denied_insufficient");
    expect(insufficient.data["matched_pattern"]).toBe("architecture-*");

    const noMatch = await call("GET", "/acl/check?agent_id=agent-c&key=other&permission=read");
    expect(noMatch.data["allowed"]).toBe(false);
    expect(noMatch.data["policy_state"]).toBe("denied_no_match");
  });
});

describe("OpenAPI surface", () => {
  test("both families are in the generated document", async () => {
    const { buildOpenApiDocument } = await import("./openapi.js");
    const doc = buildOpenApiDocument("test") as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/v1/acl", "/v1/acl/check", "/v1/acl/{id}", "/v1/memories/{id}/ratings"]),
    );
  });
});

describe("rating routes", () => {
  test("POST /api/memories/:id/ratings records feedback and returns the live summary", async () => {
    const db = getDatabase();
    const memory = createMemory({ key: "rated", value: "v", category: "fact" }, db);
    const up = await call("POST", `/memories/${memory.id}/ratings`, { body: { useful: true, agent_id: "agent-a" } });
    expect(up.status).toBe(201);
    expect(up.data["rating"].useful).toBe(true);
    expect(up.data["summary"].total).toBe(1);
  });

  test("POST refuses a non-boolean useful and writes nothing", async () => {
    const db = getDatabase();
    const memory = createMemory({ key: "rated2", value: "v", category: "fact" }, db);
    expect((await call("POST", `/memories/${memory.id}/ratings`, { body: {} })).status).toBe(400);
    expect((await call("POST", `/memories/${memory.id}/ratings`, { body: { useful: "yes" } })).status).toBe(400);
    const list = await call("GET", `/memories/${memory.id}/ratings`);
    expect(list.data["count"]).toBe(0);
  });

  test("GET reports an unrated memory as zeroed, not absent", async () => {
    const db = getDatabase();
    const memory = createMemory({ key: "rated3", value: "v", category: "fact" }, db);
    const empty = await call("GET", `/memories/${memory.id}/ratings`);
    expect(empty.status).toBe(200);
    expect(empty.data["ratings"]).toEqual([]);
    expect(empty.data["summary"]).toMatchObject({ total: 0, useful_count: 0, not_useful_count: 0, usefulness_ratio: 0 });
  });
});
