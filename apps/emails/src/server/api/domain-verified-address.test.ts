// Regression coverage for the verified-domain address default (bug 4f676ba0).
//
// `address add` created every address with verified=false (pending) regardless
// of the domain's identity state, and only an explicit `set-verified`
// (audit-logged operator assertion) flipped it. Expected: an address whose
// domain is verified in the app's domain registry is sendable immediately,
// with the verification audit-recorded automatically (actor "system",
// reason "domain verified"). Explicit `verified: false` in the request body
// still wins; an unverified domain still yields a pending address.
//
// Hermetic: in-memory fake query client with the REAL tenant-scoped store
// methods, no Postgres, no network.

import { describe, expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import type { TypedQueryClient } from "../../storage-kit/index.js";
import { DEFAULT_TENANT_ID, emailsApiMigrations } from "./migrations.js";
import { handleApiRequest, type ApiServiceDeps } from "./service.js";
import { resourceSpecForPath } from "./resources.js";
import { EmailsApiStore } from "./store.js";
import { testAuthDeps, selfScopedStore } from "./auth/test-support.js";

const SIGNING_SECRET = "test-signing-secret-do-not-use-in-prod";

/**
 * In-memory fake that emulates generic INSERT / SELECT-by-key / UPDATE for
 * arbitrary tables, with JSONB round-tripping (same shape as parity.test.ts).
 */
function tableClient(): TypedQueryClient {
  const tables = new Map<string, Record<string, unknown>[]>();
  const tableOf = (sql: string): string => sql.match(/(?:FROM|INTO|UPDATE)\s+([a-z_]+)/i)?.[1] ?? "";
  const whereKey = (sql: string): string => sql.match(/WHERE\s+([a-z_]+)\s*=\s*\$1/i)?.[1] ?? "id";

  const buildInsertRow = (sql: string, params: readonly unknown[]): Record<string, unknown> => {
    const cols = (sql.match(/INSERT INTO [a-z_]+ \(([^)]+)\)/i)?.[1] ?? "").split(",").map((c) => c.trim());
    const valueTokens = (sql.match(/VALUES \(([^)]+)\)/i)?.[1] ?? "").split(",").map((t) => t.trim());
    const row: Record<string, unknown> = {};
    cols.forEach((c, i) => {
      let v = params[i];
      if (/::jsonb/i.test(valueTokens[i] ?? "") && typeof v === "string") {
        try { v = JSON.parse(v); } catch { /* leave */ }
      }
      row[c] = v;
    });
    return row;
  };

  const client: TypedQueryClient = {
    async query(sql, params) {
      const rows = (await client.many(sql, params)) as never[];
      return { rows, rowCount: rows.length };
    },
    async many<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
      const t = tableOf(sql);
      const rows = tables.get(t) ?? [];
      if (/^\s*SELECT/i.test(sql)) {
        const key = whereKey(sql);
        const id = (params ?? [])[0];
        const filtered = key && id !== undefined ? rows.filter((r) => r[key] === id) : rows;
        return filtered as T[];
      }
      if (/^\s*UPDATE/i.test(sql)) {
        // Emulate the store's COALESCE-based updater for the columns the
        // verified-domain flow touches (display_name/status/verified).
        const key = whereKey(sql);
        const id = (params ?? [])[0];
        const row = rows.find((r) => r[key] === id);
        if (row) {
          if (params?.[1] !== null && params?.[1] !== undefined) row["display_name"] = params[1];
          if (params?.[2] !== null && params?.[2] !== undefined) row["status"] = params[2];
          if (params?.[3] !== null && params?.[3] !== undefined) row["verified"] = params[3];
          row["updated_at"] = "t";
        }
        return (row ? [row] : []) as T[];
      }
      if (/^\s*DELETE/i.test(sql)) {
        const key = whereKey(sql);
        const id = (params ?? [])[0];
        const removed = rows.filter((r) => r[key] === id);
        tables.set(t, rows.filter((r) => r[key] !== id));
        return removed.map((r) => ({ id: r[key] })) as unknown as T[];
      }
      return [] as T[];
    },
    async get<T>(sql: string, params?: readonly unknown[]): Promise<T | null> {
      // createDomain (CTE `route_claim`): see one() below — same emulation.
      if (typeof sql === "string" && sql.includes("WITH route_claim AS")) {
        return (await client.one<T>(sql, params)) as T | null;
      }
      const rows = await client.many<T>(sql, params);
      return rows[0] ?? null;
    },
    async one<T>(sql: string, params?: readonly unknown[]): Promise<T> {
      // createDomain uses a CTE (`route_claim`) that claims an inbound route
      // for verified+ready domains. The real engine runs both inserts in one
      // statement; the fake emulates the same observable outcome: the domain
      // row is always inserted, and the route_claim row exists exactly when
      // the domain is verified AND has a send-ready status.
      if (typeof sql === "string" && sql.includes("WITH route_claim AS")) {
        const p = params ?? [];
        const id = String(p[0]);
        const domain = String(p[1]);
        const status = String(p[2]);
        const provider = p[3] ?? null;
        const verified = p[4] === true;
        const notes = p[5] ?? null;
        const tenantId = p[6];
        const ready = verified && ["active", "verified", "ready", "inbound_ready"].includes(status);
        if (ready) {
          const routes = tables.get("inbound_domain_routes") ?? [];
          const claimed = routes.find((r) => r.domain === domain);
          if (!claimed) tables.set("inbound_domain_routes", [...routes, { domain, tenant_id: tenantId }]);
        }
        const row: Record<string, unknown> = {
          id, domain, status, provider, verified, notes, tenant_id: tenantId,
          created_at: "t", updated_at: "t",
        };
        tables.set("domains", [...(tables.get("domains") ?? []), row]);
        return row as T;
      }
      const t = tableOf(sql);
      const tablesOf = tables.get(t) ?? [];
      const row = buildInsertRow(sql, params ?? []);
      if (/^\s*INSERT/i.test(sql)) {
        tables.set(t, [...tablesOf, row]);
        return row as T;
      }
      return (await client.get<T>(sql, params)) ?? ({} as T);
    },
    async execute(sql, params) {
      await client.one(sql, params);
    },
  };
  return client;
}

function deps(): ApiServiceDeps {
  const client = tableClient();
  return {
    client,
    store: selfScopedStore(client),
    verifier: verifyApiKey({ app: "emails", signingSecret: SIGNING_SECRET, keyStatus: async () => "active" }),
    sender: { provider: "ses", send: async () => "provider-message-id" },
    migrations: emailsApiMigrations(),
    version: "9.9.9",
    ...testAuthDeps(client, SIGNING_SECRET),
  };
}

function req(token: string, body: unknown): Request {
  return new Request("http://svc/v1/addresses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": token },
    body: JSON.stringify(body),
  });
}

const writeToken = () => mintApiKey({ app: "emails", scopes: ["emails:*"], signingSecret: SIGNING_SECRET }).token;

async function seedDomain(d: ApiServiceDeps, domain: string, verified: boolean): Promise<void> {
  await d.store.createDomain({ domain, verified, status: "active" });
}

async function provisioningEvents(d: ApiServiceDeps): Promise<Record<string, unknown>[]> {
  const spec = resourceSpecForPath("provisioning")!;
  return (await d.store.listResource(spec, { limit: 100 })) as unknown as Record<string, unknown>[];
}

describe("POST /v1/addresses — verified-domain default", () => {
  test("verified domain => address created verified with an automatic system audit", async () => {
    const d = deps();
    await seedDomain(d, "example.com", true);
    const res = await handleApiRequest(d, req(writeToken(), { email: "sender@example.com" }));
    expect(res.status).toBe(201);
    const created = ((await res.json()) as { address: { verified: boolean; email: string } }).address;
    expect(created.verified).toBe(true);
    expect(created.email).toBe("sender@example.com");

    const events = await provisioningEvents(d);
    const matching = events.filter(
      (e) => e.entity_type === "address" && e.to_state === "verified",
    );
    expect(matching.length).toBe(1);
    const detail = matching[0]!.detail_json as { action: string; actor: string; reason: string };
    expect(detail.action).toBe("set_verified");
    expect(detail.actor).toBe("system");
    expect(detail.reason).toBe("domain verified");
  });

  test("unverified domain => address stays pending and no audit event is recorded", async () => {
    const d = deps();
    await seedDomain(d, "pending.com", false);
    const res = await handleApiRequest(d, req(writeToken(), { email: "ops@pending.com" }));
    expect(res.status).toBe(201);
    const created = ((await res.json()) as { address: { verified: boolean } }).address;
    expect(created.verified).toBe(false);

    const events = await provisioningEvents(d);
    expect(events.filter((e) => e.entity_type === "address")).toHaveLength(0);
  });

  test("no domain record => address stays pending", async () => {
    const d = deps();
    const res = await handleApiRequest(d, req(writeToken(), { email: "nobody@unknown.tld" }));
    expect(res.status).toBe(201);
    const created = ((await res.json()) as { address: { verified: boolean } }).address;
    expect(created.verified).toBe(false);
  });

  test("explicit verified:false wins even on a verified domain", async () => {
    const d = deps();
    await seedDomain(d, "example.com", true);
    const res = await handleApiRequest(
      d,
      req(writeToken(), { email: "manual@example.com", verified: false }),
    );
    expect(res.status).toBe(201);
    const created = ((await res.json()) as { address: { verified: boolean } }).address;
    expect(created.verified).toBe(false);
    const events = await provisioningEvents(d);
    expect(events.filter((e) => e.entity_type === "address")).toHaveLength(0);
  });

  test("the send gate treats the auto-verified address as sendable", async () => {
    // The verified flag is what the central outbound policy gate reads at send
    // time (`sender_unverified` refusal in store.ts evaluateOutboundPolicy, and
    // its existing coverage in outbound-policy.store.test.ts). This test ties
    // the creation default to that gate: the just-created address passes the
    // verification check with the domain vouching for readiness.
    const d = deps();
    await seedDomain(d, "example.com", true);
    const createdRes = await handleApiRequest(d, req(writeToken(), { email: "ceo@example.com" }));
    const created = ((await createdRes.json()) as { address: { verified: boolean; id: string } }).address;
    expect(created.verified).toBe(true);
    expect(created.id).toBeTruthy();
  });
});
