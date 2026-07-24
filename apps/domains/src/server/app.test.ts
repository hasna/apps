import { describe, expect, test } from "bun:test";
import { mintApiKey } from "@hasna/contracts/auth";
import type { TypedQueryClient } from "../generated/storage-kit/index.js";
import { createServeApp } from "./app.js";

const SIGNING = "test-signing-secret-do-not-use-in-prod";

/**
 * Minimal in-memory fake of the vendored kit's TypedQueryClient. Handles only
 * the query shapes the domains-serve repo + health probe emit, backed by plain
 * arrays — enough for a real CRUD roundtrip in a unit test without Postgres.
 */
function fakeDb(): TypedQueryClient {
  const domains: Record<string, unknown>[] = [];

  async function run(sql: string, params: readonly unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/^SELECT 1 AS ok/i.test(s)) return { rows: [{ ok: 1 }], rowCount: 1 };
    if (/^INSERT INTO domains/i.test(s)) {
      const [id, name, registrar, status, registered_at, expires_at, auto_renew, is_premium, premium_price, standard_price, purchase_price, purchase_date, nameservers, whois, ssl_expires_at, ssl_issuer, notes, metadata, created_at, updated_at] = params as unknown[];
      if (domains.some((d) => d["name"] === name)) {
        throw new Error('duplicate key value violates unique constraint "domains_name_key"');
      }
      const row = { id, name, registrar, status, registered_at, expires_at, auto_renew, is_premium, premium_price, standard_price, purchase_price, purchase_date, nameservers, whois, ssl_expires_at, ssl_issuer, notes, metadata, created_at, updated_at };
      domains.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (/^SELECT \* FROM domains WHERE id = \$1/i.test(s)) {
      const row = domains.find((d) => d["id"] === params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/^SELECT \* FROM domains WHERE name = \$1/i.test(s)) {
      const row = domains.find((d) => d["name"] === params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/^SELECT \* FROM domains/i.test(s)) {
      return { rows: [...domains], rowCount: domains.length };
    }
    if (/^DELETE FROM domains WHERE id = \$1/i.test(s)) {
      const idx = domains.findIndex((d) => d["id"] === params[0]);
      if (idx >= 0) domains.splice(idx, 1);
      return { rows: [], rowCount: idx >= 0 ? 1 : 0 };
    }
    if (/count\(\*\).*FROM domains/i.test(s)) {
      return { rows: [{ n: String(domains.length), total: String(domains.length) }], rowCount: 1 };
    }
    if (/^INSERT INTO alerts/i.test(s)) {
      const [id, domain_id, type, trigger_days_before, created_at] = params as unknown[];
      return { rows: [{ id, domain_id, type, trigger_days_before, created_at }], rowCount: 1 };
    }
    // migration ledger noise (checkReady) — pretend migrated
    if (/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(s)) return { rows: [], rowCount: 0 };
    if (/FROM schema_migrations/i.test(s)) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  }

  const client: TypedQueryClient = {
    async query(sql, params) {
      const r = await run(sql, params);
      return { rows: r.rows as never, rowCount: r.rowCount };
    },
    async many(sql, params) {
      return (await run(sql, params)).rows as never;
    },
    async get(sql, params) {
      return ((await run(sql, params)).rows[0] ?? null) as never;
    },
    async one(sql, params) {
      const rows = (await run(sql, params)).rows;
      if (rows.length !== 1) throw new Error("expected one row");
      return rows[0] as never;
    },
    async execute(sql, params) {
      await run(sql, params);
    },
  };
  return client;
}

function appWithKey(scopes: string[]) {
  const app = createServeApp({ db: fakeDb(), signingSecret: SIGNING, version: "9.9.9" });
  const { token } = mintApiKey({ app: "domains", scopes, signingSecret: SIGNING });
  return { app, token };
}

describe("domains-serve app", () => {
  test("GET /health is public and returns status+version+mode", async () => {
    const { app } = appWithKey(["domains:*"]);
    const res = await app.handle(new Request("http://x/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
    expect(body["version"]).toBe("9.9.9");
    expect(body["mode"]).toBeDefined();
  });

  test("GET /version returns {status,version,mode}", async () => {
    const { app } = appWithKey(["domains:*"]);
    const body = (await (await app.handle(new Request("http://x/version"))).json()) as Record<string, unknown>;
    expect(body).toEqual({ status: "ok", version: "9.9.9", mode: "self_hosted" });
  });

  test("GET /openapi.json exposes the /v1 spec", async () => {
    const { app } = appWithKey(["domains:*"]);
    const spec = (await (await app.handle(new Request("http://x/openapi.json"))).json()) as Record<string, any>;
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/v1/domains"]).toBeDefined();
  });

  test("/v1/domains requires an API key (401 without one)", async () => {
    const { app } = appWithKey(["domains:*"]);
    const res = await app.handle(new Request("http://x/v1/domains"));
    expect(res.status).toBe(401);
  });

  test("authenticated CRUD roundtrip with a scoped key", async () => {
    const { app, token } = appWithKey(["domains:read", "domains:write"]);
    const h = { "x-api-key": token, "content-type": "application/json" };

    const created = await app.handle(
      new Request("http://x/v1/domains", { method: "POST", headers: h, body: JSON.stringify({ name: "roundtrip.dev", registrar: "route53" }) }),
    );
    expect(created.status).toBe(201);
    const domain = (await created.json()) as Record<string, unknown>;
    expect(domain["name"]).toBe("roundtrip.dev");
    const id = domain["id"] as string;

    const got = await app.handle(new Request(`http://x/v1/domains/${id}`, { headers: h }));
    expect(got.status).toBe(200);

    const list = (await (await app.handle(new Request("http://x/v1/domains", { headers: h }))).json()) as Record<string, unknown>;
    expect(list["count"]).toBe(1);

    const del = (await (await app.handle(new Request(`http://x/v1/domains/${id}`, { method: "DELETE", headers: h }))).json()) as Record<string, unknown>;
    expect(del["deleted"]).toBe(true);
  });

  test("read-only key is denied write (403 insufficient scope)", async () => {
    const { app, token } = appWithKey(["domains:read"]);
    const res = await app.handle(
      new Request("http://x/v1/domains", {
        method: "POST",
        headers: { "x-api-key": token, "content-type": "application/json" },
        body: JSON.stringify({ name: "nope.dev" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  // Regression: nested per-domain collection routes (emails/alerts) and the DNS
  // PATCH route must be WIRED, not fall through to the catch-all 404. A stale
  // server build lacking these routes returns {error:"Not found"} (the catch-all)
  // and hard-fails `domain get`, `domain emails`, `alert set/list`, MCP
  // get_domain/create_alert/list_alerts/update_dns_record in cloud mode.
  test("per-domain emails route is wired (routed 200, not catch-all 404)", async () => {
    const { app, token } = appWithKey(["domains:read", "domains:write"]);
    const h = { "x-api-key": token, "content-type": "application/json" };
    const created = await app.handle(
      new Request("http://x/v1/domains", { method: "POST", headers: h, body: JSON.stringify({ name: "emails.dev", registrar: "route53" }) }),
    );
    const id = ((await created.json()) as Record<string, unknown>)["id"] as string;
    const res = await app.handle(new Request(`http://x/v1/domains/${id}/emails`, { headers: h }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["emails"]).toEqual([]);
    expect(body["count"]).toBe(0);
  });

  test("per-domain alerts route is wired for list + create", async () => {
    const { app, token } = appWithKey(["domains:read", "domains:write"]);
    const h = { "x-api-key": token, "content-type": "application/json" };
    const created = await app.handle(
      new Request("http://x/v1/domains", { method: "POST", headers: h, body: JSON.stringify({ name: "alerts.dev", registrar: "route53" }) }),
    );
    const id = ((await created.json()) as Record<string, unknown>)["id"] as string;

    const list = await app.handle(new Request(`http://x/v1/domains/${id}/alerts`, { headers: h }));
    expect(list.status).toBe(200);
    expect(((await list.json()) as Record<string, unknown>)["alerts"]).toEqual([]);

    const set = await app.handle(
      new Request(`http://x/v1/domains/${id}/alerts`, { method: "POST", headers: h, body: JSON.stringify({ type: "expiry", trigger_days_before: 30 }) }),
    );
    expect(set.status).toBe(201);
    expect(((await set.json()) as Record<string, unknown>)["type"]).toBe("expiry");
  });

  test("DNS PATCH route is wired (routed 404 body, not catch-all)", async () => {
    const { app, token } = appWithKey(["domains:read", "domains:write"]);
    const h = { "x-api-key": token, "content-type": "application/json" };
    const res = await app.handle(
      new Request("http://x/v1/dns/does-not-exist", { method: "PATCH", headers: h, body: JSON.stringify({ ttl: 600 }) }),
    );
    expect(res.status).toBe(404);
    // Distinguishes a wired route (record missing) from an absent route (catch-all).
    expect(((await res.json()) as Record<string, unknown>)["error"]).toBe("dns record not found");
  });

  test("a key for another app is rejected", async () => {
    const app = createServeApp({ db: fakeDb(), signingSecret: SIGNING, version: "9.9.9" });
    const { token } = mintApiKey({ app: "todos", scopes: ["todos:*"], signingSecret: SIGNING });
    const res = await app.handle(new Request("http://x/v1/domains", { headers: { "x-api-key": token } }));
    expect(res.status).toBe(401);
  });
});
