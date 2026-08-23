// Tests for the `provision-runner-key` provisioning path.
//
// Two layers:
//  1. Hermetic tests with a recording mock client — always run. They pin the
//     SQL SHAPE (advisory lock first, idempotency select, exact inserts), the
//     claim/row timestamp alignment, and the never-mint-twice contract.
//  2. Live Postgres tests — run only when LOOPS_TEST_DATABASE_URL points at a
//     DISPOSABLE dedicated cluster (the same convention as
//     postgres-loop-storage.test.ts). They push the verb through the REAL
//     migration + tenant-enforcement path and prove the minted key actually
//     authenticates through `open_loops_authenticate_key` as a machine-kind
//     key, then prove the second run is a true no-op.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { hashToken, verifyApiKeyToken } from "@hasna/contracts/auth";
import type { QueryResultRow } from "pg";
import type { PoolQueryClient, TypedQueryClient } from "../../generated/storage-kit/query.js";
import { PgPoolExecutor } from "./pg-executor.js";
import { PostgresStorage } from "./postgres.js";
import { provisionRunnerKey } from "./provision-runner-key.js";
import { loadTenantBackfillBundle } from "./tenant-backfill.js";
import { assertTenantEnforcementBootstrap } from "../../serve/index.js";

const SIGNING_SECRET = "provision-test-signing-secret-32-bytes";
const APP = "loops";

// ---------------------------------------------------------------------------
// Hermetic layer — recording mock client.
// ---------------------------------------------------------------------------

function mockClient(activeKey: { kid: string; expires_at: string | Date } | null) {
  const statements: Array<{ sql: string; params: readonly unknown[] }> = [];
  const base: TypedQueryClient = {
    query: async <T extends QueryResultRow>() => ({ rows: [] as T[], rowCount: 0 }),
    many: async <T extends QueryResultRow>() => [] as T[],
    one: async <T extends QueryResultRow>() => {
      throw new Error("unexpected one()");
    },
    get: async <T extends QueryResultRow>(sql: string, params: readonly unknown[] = []) => {
      statements.push({ sql, params });
      if (sql.includes("FROM api_keys key") && sql.includes("token_kind = 'machine'")) {
        return (activeKey ?? null) as unknown as T | null;
      }
      return null;
    },
    execute: async (sql: string, params: readonly unknown[] = []) => {
      statements.push({ sql, params });
    },
  };
  const client: PoolQueryClient = {
    ...base,
    pool: null as never,
    transaction: async <T>(fn: (transaction: TypedQueryClient) => Promise<T>): Promise<T> => fn(base),
    close: async () => undefined,
  };
  return { client, statements };
}

const NOW_MS = 1_752_000_000_000;
const RUNNER = "station-provision-test";
const TENANT = "tenant-provision-test";

function options(over: Partial<Parameters<typeof provisionRunnerKey>[1]> = {}) {
  return {
    runnerId: RUNNER,
    tenantId: TENANT,
    roles: ["worker", "service"],
    scopes: ["loops:runner"],
    ttlSeconds: 3600,
    signingSecret: SIGNING_SECRET,
    nowMs: NOW_MS,
    kid: "testkid123",
    ...over,
  };
}

describe("provisionRunnerKey (hermetic)", () => {
  test("mints once: advisory lock, no-op check, then principal/membership/roles/key inserts", async () => {
    const { client, statements } = mockClient(null);
    const outcome = await provisionRunnerKey(client, options());

    expect(outcome.status).toBe("provisioned");
    if (outcome.status !== "provisioned") return;
    expect(outcome.runnerId).toBe(RUNNER);
    expect(outcome.kid).toBe("testkid123");
    expect(outcome.expiresAt).toBe(new Date((NOW_MS / 1000 + 3600) * 1000).toISOString());
    expect(outcome.token.startsWith(`hasna_${APP}_`)).toBe(true);

    const kinds = statements.map((s) => s.sql.replace(/\s+/g, " ").trim());
    expect(kinds.some((sql) => sql.startsWith("SELECT pg_advisory_xact_lock"))).toBe(true);
    expect(kinds.some((sql) => sql.includes("FROM api_keys key") && sql.includes("token_kind = 'machine'"))).toBe(true);

    const principalInsert = statements.find((s) => s.sql.includes("INSERT INTO principals"));
    expect(principalInsert?.params).toEqual([RUNNER]);
    const membershipInsert = statements.find((s) => s.sql.includes("INSERT INTO tenant_memberships"));
    expect(membershipInsert?.params).toEqual([TENANT, RUNNER]);
    const roleInsert = statements.filter((s) => s.sql.includes("INSERT INTO tenant_membership_roles"));
    expect(roleInsert.map((s) => s.params?.[2])).toEqual(["worker", "service"]);
    const roleDelete = statements.find((s) => s.sql.includes("DELETE FROM tenant_membership_roles"));
    expect(roleDelete?.params).toEqual([TENANT, RUNNER]);

    // Never two active keys: any otherwise-active machine-kind key for the
    // runner is disabled before the new key is inserted.
    const disableUpdate = statements.find((s) => s.sql.includes("UPDATE api_keys"));
    expect(disableUpdate?.sql).toContain("SET disabled_at = now()");
    expect(disableUpdate?.sql).toContain("token_kind = 'machine'");
    expect(disableUpdate?.params).toEqual([RUNNER]);
    const keyInsertIndex = statements.findIndex((s) => s.sql.includes("INSERT INTO api_keys"));
    const disableUpdateIndex = statements.findIndex((s) => s.sql.includes("UPDATE api_keys"));
    expect(disableUpdateIndex).toBeGreaterThanOrEqual(0);
    expect(keyInsertIndex).toBeGreaterThan(disableUpdateIndex);

    const keyInsert = statements.find((s) => s.sql.includes("INSERT INTO api_keys"));
    expect(keyInsert?.params).toEqual([
      "testkid123",
      RUNNER,
      JSON.stringify(["loops:runner"]),
      hashToken(outcome.token),
      new Date((NOW_MS / 1000) * 1000),
      new Date((NOW_MS / 1000 + 3600) * 1000),
      TENANT,
      RUNNER,
    ]);
    expect(keyInsert?.sql).toContain("'machine'");
    expect(keyInsert?.sql).toContain("'provision-runner-key'");
  });

  test("issued_at / expires_at rows align with the token claims at second granularity", async () => {
    const { client } = mockClient(null);
    const outcome = await provisionRunnerKey(client, options());
    if (outcome.status !== "provisioned") throw new Error("expected provisioned");

    const verified = verifyApiKeyToken(outcome.token, {
      signingSecret: SIGNING_SECRET,
      expectedApp: APP,
      nowMs: NOW_MS,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.claims.kid).toBe("testkid123");
    expect(verified.claims.tid).toBe(TENANT);
    expect(verified.claims.agent).toBe(RUNNER);
    expect(verified.claims.scopes).toEqual(["loops:runner"]);
    expect(verified.claims.iat).toBe(Math.floor(NOW_MS / 1000));
    expect(verified.claims.exp).toBe(Math.floor(NOW_MS / 1000) + 3600);
    expect(new Date(verified.claims.exp! * 1000).toISOString()).toBe(outcome.expiresAt);
  });

  test("no-op when an active machine-kind key already exists — and NEVER a second insert", async () => {
    const existingKid = "existingkey1";
    const existingExpires = new Date(NOW_MS + 3_600_000).toISOString();
    const { client, statements } = mockClient({ kid: existingKid, expires_at: existingExpires });

    const outcome = await provisionRunnerKey(client, options());
    expect(outcome.status).toBe("already_provisioned");
    expect(outcome.kid).toBe(existingKid);
    expect(outcome.expiresAt).toBe(existingExpires);
    expect(statements.filter((s) => s.sql.includes("INSERT"))).toHaveLength(0);
    expect(statements.filter((s) => s.sql.includes("DELETE FROM"))).toHaveLength(0);
  });

  test("the idempotency check only matches unexpired, non-revoked, non-disabled machine keys for loops", async () => {
    const { client, statements } = mockClient(null);
    await provisionRunnerKey(client, options());
    const check = statements.find((s) => s.sql.includes("FROM api_keys key"));
    expect(check).toBeDefined();
    expect(check?.sql).toContain("key.token_kind = 'machine'");
    expect(check?.sql).toContain("key.app = 'loops'");
    expect(check?.sql).toContain("key.revoked_at IS NULL");
    expect(check?.sql).toContain("key.disabled_at IS NULL");
    expect(check?.sql).toContain("key.expires_at IS NULL OR key.expires_at > now()");
    expect(check?.sql).toContain("principal.kind = 'machine'");
    expect(check?.sql).toContain("principal.status = 'active'");
    // The no-op must be bound to the REQUESTED binding: an active key in a
    // different tenant, or one whose membership lacks a requested role or
    // whose scopes do not cover the requested scopes, is NOT a no-op — it
    // must be disabled and re-minted for the requested binding.
    expect(check?.sql).toContain("key.tenant_id = $2");
    expect(check?.sql).toContain("key.scopes @> $3::jsonb");
    expect(check?.sql).toContain("tenant_memberships");
    expect(check?.sql).toContain("mr.role = ANY($4)");
    expect(check?.sql).toContain("ms.status = 'active'");
    expect(check?.params?.[1]).toBe(TENANT);
    expect(check?.params?.[2]).toBe(JSON.stringify(["loops:runner"]));
    expect(check?.params?.[3]).toEqual(["worker", "service"]);
  });

  test("deliverToken is invoked with the minted token inside the transaction (never on already_provisioned)", async () => {
    const delivered: string[] = [];
    const { client } = mockClient(null);
    const outcome = await provisionRunnerKey(client, options({ deliverToken: (token) => delivered.push(token) }));
    expect(outcome.status).toBe("provisioned");
    if (outcome.status !== "provisioned") return;
    expect(delivered).toEqual([outcome.token]);

    const deliveredOnNoop: string[] = [];
    const { client: noopClient } = mockClient({ kid: "existingkey1", expires_at: new Date(NOW_MS + 3_600_000).toISOString() });
    const noop = await provisionRunnerKey(noopClient, options({ deliverToken: (token) => deliveredOnNoop.push(token) }));
    expect(noop.status).toBe("already_provisioned");
    expect(deliveredOnNoop).toHaveLength(0);
  });

  test("a throwing deliverToken aborts the provisioning call (rolls the transaction back on a real client)", async () => {
    const { client, statements } = mockClient(null);
    await expect(
      provisionRunnerKey(
        client,
        options({ deliverToken: () => { throw new Error("token-out write failed: disk full"); } }),
      ),
    ).rejects.toThrow("disk full");
    // The mint itself ran before delivery — the failure is in delivery, and
    // the caller must see it propagate so nothing is treated as provisioned.
    expect(statements.some((s) => s.sql.includes("INSERT INTO api_keys"))).toBe(true);
  });

  test("validation rejects malformed input before any statement runs", async () => {
    const cases: Array<[Partial<Parameters<typeof provisionRunnerKey>[1]>, RegExp]> = [
      [{ runnerId: "  " }, /requires a runner id/i],
      [{ runnerId: "has whitespace" }, /must not contain whitespace/i],
      [{ tenantId: "" }, /Invalid tenant id/i],
      [{ tenantId: "bad/tenant" }, /Invalid tenant id/i],
      [{ roles: [] }, /at least one role/i],
      [{ roles: ["admin", "root"] }, /invalid role 'root'/i],
      [{ scopes: [] }, /at least one scope/i],
      [{ scopes: ["loops:runner", "not-a-scope"] }, /invalid scope 'not-a-scope'/i],
      [{ ttlSeconds: 0 }, /ttlSeconds must be a positive number/i],
      [{ ttlSeconds: Number.NaN }, /ttlSeconds must be a positive number/i],
      [{ signingSecret: "" }, /requires a signing secret/i],
    ];
    for (const [over, expected] of cases) {
      const { client, statements } = mockClient(null);
      await expect(provisionRunnerKey(client, options(over))).rejects.toThrow(expected);
      expect(statements, String(over)).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Live layer — exclusive disposable Postgres cluster (skipped when unset).
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.LOOPS_TEST_DATABASE_URL;
const RUN_LIVE = typeof DATABASE_URL === "string" && DATABASE_URL.length > 0;
const liveSuite = RUN_LIVE ? describe : describe.skip;

const ISO_DB = `loops_provision_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const BOOTSTRAP = `loops_provision_bootstrap_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const BOOTSTRAP_PASSWORD = `provision-bootstrap-${Date.now()}`;
const AUTH_LOGIN = `loops_provision_auth_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const AUTH_PASSWORD = `provision-auth-${Date.now()}`;
const TEST_RUNNER = `station-provision-${Date.now()}`;
const TEST_TENANT = `tenant-provision-${Date.now()}`;

async function admin(sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function adminQuery<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<T>(sql)).rows;
  } finally {
    await client.end();
  }
}

liveSuite("provisionRunnerKey (live Postgres)", () => {
  let executor: PgPoolExecutor | undefined;

  beforeAll(async () => {
    const [inventory] = await adminQuery<{ database_count: number; open_loops_role_count: number }>(`
      SELECT (SELECT count(*)::int FROM pg_database WHERE NOT datistemplate) AS database_count,
             (SELECT count(*)::int FROM pg_roles WHERE rolname IN (
               'open_loops_owner', 'open_loops_migrator',
               'open_loops_runtime', 'open_loops_authenticator'
             )) AS open_loops_role_count
    `);
    if (inventory?.database_count !== 1 || inventory.open_loops_role_count !== 0) {
      throw new Error(
        "LOOPS_TEST_DATABASE_URL must point at an exclusive disposable PostgreSQL cluster with no Loops roles",
      );
    }

    await admin(`CREATE ROLE ${BOOTSTRAP} LOGIN CREATEROLE PASSWORD '${BOOTSTRAP_PASSWORD}'`);
    await admin(`CREATE DATABASE ${ISO_DB} OWNER ${BOOTSTRAP}`);
    await admin(`
      DO $roles$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_owner') THEN
          CREATE ROLE open_loops_owner INHERIT NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_migrator') THEN
          CREATE ROLE open_loops_migrator INHERIT NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_runtime') THEN
          CREATE ROLE open_loops_runtime INHERIT NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_authenticator') THEN
          CREATE ROLE open_loops_authenticator INHERIT NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        END IF;
      END $roles$;
      GRANT open_loops_owner, open_loops_migrator
        TO ${BOOTSTRAP} WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
    `);
    const url = new URL(DATABASE_URL!);
    url.pathname = `/${ISO_DB}`;
    url.searchParams.delete("host");
    url.hostname = "127.0.0.1";
    url.username = BOOTSTRAP;
    url.password = BOOTSTRAP_PASSWORD;
    executor = PgPoolExecutor.fromConnectionString({
      connectionString: url.toString(),
      applicationName: "loops-provision-runner-key-test",
    });

    // Production-shaped bootstrap: migrate to 0008, load the explicit tenant
    // bundle, probe authority, then enforce tenancy (0010) and migrate the
    // remainder. This mirrors the deployed control-plane state the verb runs
    // against.
    const schema = new PostgresStorage(executor);
    await schema.migrate({ through: "0008_tenant_prepare" });
    await loadTenantBackfillBundle(executor.queryClient, {
      schema: "open-loops.tenant-backfill/v1",
      tenants: [{ id: TEST_TENANT, slug: TEST_TENANT, name: "Provision Test Tenant", status: "active" }],
      principals: [],
      memberships: [],
      keyBindings: [],
      rowAssignments: [],
    });
    await assertTenantEnforcementBootstrap(executor.queryClient);
    await schema.migrate();

    await admin(`
      CREATE ROLE ${AUTH_LOGIN} LOGIN PASSWORD '${AUTH_PASSWORD}' NOBYPASSRLS;
      GRANT open_loops_authenticator TO ${AUTH_LOGIN};
      GRANT CONNECT ON DATABASE ${ISO_DB} TO ${AUTH_LOGIN};
    `);
  });

  afterAll(async () => {
    if (executor) {
      await executor.close();
      executor = undefined;
    }
    await admin(`DROP DATABASE IF EXISTS ${ISO_DB} WITH (FORCE)`);
    await admin(`
      DO $cleanup$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${AUTH_LOGIN}') THEN
          EXECUTE format('DROP OWNED BY %I', '${AUTH_LOGIN}');
          EXECUTE format('DROP ROLE %I', '${AUTH_LOGIN}');
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${BOOTSTRAP}') THEN
          EXECUTE format('DROP OWNED BY %I', '${BOOTSTRAP}');
          EXECUTE format('DROP ROLE %I', '${BOOTSTRAP}');
        END IF;
      END $cleanup$;
      DROP ROLE IF EXISTS open_loops_authenticator;
      DROP ROLE IF EXISTS open_loops_runtime;
      DROP ROLE IF EXISTS open_loops_migrator;
      DROP ROLE IF EXISTS open_loops_owner;
    `);
    const [leftovers] = await adminQuery<{ database_count: number; role_count: number }>(`
      SELECT (SELECT count(*)::int FROM pg_database
               WHERE datname='${ISO_DB}' OR datname LIKE 'loops_provision_%') AS database_count,
             (SELECT count(*)::int FROM pg_roles
               WHERE rolname IN (
                 'open_loops_owner', 'open_loops_migrator',
                 'open_loops_runtime', 'open_loops_authenticator'
               ) OR rolname LIKE 'loops_provision_%') AS role_count
    `);
    if (leftovers?.database_count !== 0 || leftovers.role_count !== 0) {
      throw new Error("PostgreSQL integration test left database or role artifacts behind");
    }
  });

  test("provisions a working machine-kind runner key and authenticates through the enforced schema", async () => {
    const nowMs = Date.now();
    const outcome = await provisionRunnerKey(executor!.queryClient, {
      runnerId: TEST_RUNNER,
      tenantId: TEST_TENANT,
      roles: ["worker", "service"],
      scopes: ["loops:runner"],
      ttlSeconds: 3600,
      signingSecret: SIGNING_SECRET,
      nowMs,
    });

    expect(outcome.status).toBe("provisioned");
    if (outcome.status !== "provisioned") return;

    // The token verifies against the same signing secret the server uses.
    const verified = verifyApiKeyToken(outcome.token, {
      signingSecret: SIGNING_SECRET,
      expectedApp: APP,
      nowMs,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    // The api_keys row matches the claims bit-for-bit at second granularity.
    const row = await executor!.queryClient.get<{
      kid: string;
      app: string;
      agent: string | null;
      scopes: unknown;
      token_hash: string;
      issued_at: string;
      expires_at: string | null;
      tenant_id: string;
      principal_id: string;
      token_kind: string;
      created_by: string;
      revoked_at: string | null;
      disabled_at: string | null;
    }>(
      `SELECT kid, app, agent, scopes, token_hash, issued_at, expires_at, tenant_id, principal_id,
              token_kind, created_by, revoked_at, disabled_at
         FROM api_keys WHERE kid = $1`,
      [outcome.kid],
    );
    expect(row).not.toBeNull();
    expect(row?.app).toBe("loops");
    expect(row?.agent).toBe(TEST_RUNNER);
    expect(row?.tenant_id).toBe(TEST_TENANT);
    expect(row?.principal_id).toBe(TEST_RUNNER);
    expect(row?.token_kind).toBe("machine");
    expect(row?.created_by).toBe("provision-runner-key");
    expect(row?.revoked_at).toBeNull();
    expect(row?.disabled_at).toBeNull();
    expect(row?.token_hash).toBe(hashToken(outcome.token));
    expect(row?.scopes).toBeDefined();
    expect(JSON.parse(String(row?.scopes))).toEqual(["loops:runner"]);
    expect(Math.floor(new Date(row!.issued_at).getTime() / 1000)).toBe(verified.claims.iat);
    expect(Math.floor(new Date(row!.expires_at!).getTime() / 1000)).toBe(verified.claims.exp!);

    // The exact auth path the control-plane uses accepts the key as machine-kind.
    const authUrl = new URL(DATABASE_URL!);
    authUrl.pathname = `/${ISO_DB}`;
    authUrl.searchParams.delete("host");
    authUrl.hostname = "127.0.0.1";
    authUrl.username = AUTH_LOGIN;
    authUrl.password = AUTH_PASSWORD;
    const auth = new pg.Client({ connectionString: authUrl.toString() });
    await auth.connect();
    try {
      const bound = await auth.query<{
        kid: string;
        app: string;
        agent: string | null;
        tenant_id: string;
        tenant_status: string;
        principal_id: string;
        principal_status: string;
        membership_status: string;
        token_kind: string;
        roles: string[];
      }>(
        "SELECT * FROM public.open_loops_authenticate_key($1, $2)",
        [outcome.kid, row!.token_hash],
      );
      expect(bound.rows).toHaveLength(1);
      expect(bound.rows[0].token_kind).toBe("machine");
      expect(bound.rows[0].tenant_id).toBe(TEST_TENANT);
      expect(bound.rows[0].tenant_status).toBe("active");
      expect(bound.rows[0].principal_id).toBe(TEST_RUNNER);
      expect(bound.rows[0].principal_status).toBe("active");
      expect(bound.rows[0].membership_status).toBe("active");
      expect(bound.rows[0].app).toBe("loops");
      expect(bound.rows[0].agent).toBe(TEST_RUNNER);
      expect([...bound.rows[0].roles].sort()).toEqual(["service", "worker"]);
    } finally {
      await auth.end();
    }
  });

  test("second run is a true no-op: same key, no second row, no new token", async () => {
    const first = await provisionRunnerKey(executor!.queryClient, {
      runnerId: TEST_RUNNER,
      tenantId: TEST_TENANT,
      roles: ["worker", "service"],
      scopes: ["loops:runner"],
      ttlSeconds: 3600,
      signingSecret: SIGNING_SECRET,
    });
    expect(first.status).toBe("already_provisioned");

    const rows = await executor!.queryClient.many<{ kid: string }>(
      `SELECT kid FROM api_keys WHERE principal_id = $1 AND token_kind = 'machine'`,
      [TEST_RUNNER],
    );
    expect(rows).toHaveLength(1);
    if (first.status === "provisioned") throw new Error("second run must not mint");
  });

  test("a failing token delivery rolls the mint back — a re-run mints a fresh key instead of stranding a lost key", async () => {
    const failedRunner = `${TEST_RUNNER}-delivery-fail`;
    await expect(
      provisionRunnerKey(executor!.queryClient, {
        runnerId: failedRunner,
        tenantId: TEST_TENANT,
        roles: ["worker", "service"],
        scopes: ["loops:runner"],
        ttlSeconds: 3600,
        signingSecret: SIGNING_SECRET,
        deliverToken: () => {
          throw new Error("token-out write failed: disk full");
        },
      }),
    ).rejects.toThrow("disk full");

    // The mint was rolled back: no key exists, so the re-run provisions
    // fresh rather than reporting already_provisioned for a key whose
    // plaintext was lost.
    const afterFailure = await executor!.queryClient.many<{ kid: string }>(
      `SELECT kid FROM api_keys WHERE principal_id = $1 AND token_kind = 'machine'`,
      [failedRunner],
    );
    expect(afterFailure).toHaveLength(0);

    const delivered: string[] = [];
    const recovered = await provisionRunnerKey(executor!.queryClient, {
      runnerId: failedRunner,
      tenantId: TEST_TENANT,
      roles: ["worker", "service"],
      scopes: ["loops:runner"],
      ttlSeconds: 3600,
      signingSecret: SIGNING_SECRET,
      deliverToken: (token) => delivered.push(token),
    });
    expect(recovered.status).toBe("provisioned");
    if (recovered.status !== "provisioned") return;
    expect(delivered).toEqual([recovered.token]);

    const keys = await executor!.queryClient.many<{ kid: string }>(
      `SELECT kid FROM api_keys WHERE principal_id = $1 AND token_kind = 'machine'`,
      [failedRunner],
    );
    expect(keys).toHaveLength(1);
    expect(keys[0].kid).toBe(recovered.kid);
  });

  test("an existing key for a DIFFERENT tenant is not a no-op — a fresh key is minted for the requested tenant", async () => {
    const secondTenant = `${TEST_TENANT}-b`;
    const movingRunner = `${TEST_RUNNER}-tenant-move`;
    await loadTenantBackfillBundle(executor!.queryClient, {
      schema: "open-loops.tenant-backfill/v1",
      tenants: [{ id: secondTenant, slug: secondTenant, name: "Provision Test Tenant B", status: "active" }],
      principals: [],
      memberships: [],
      keyBindings: [],
      rowAssignments: [],
    });

    const first = await provisionRunnerKey(executor!.queryClient, {
      runnerId: movingRunner,
      tenantId: TEST_TENANT,
      roles: ["worker", "service"],
      scopes: ["loops:runner"],
      ttlSeconds: 3600,
      signingSecret: SIGNING_SECRET,
    });
    expect(first.status).toBe("provisioned");

    // Same runner, second tenant: the tenant-A key must NOT satisfy the
    // no-op check — a fresh machine key bound to tenant B is minted, and the
    // tenant-A key is disabled so exactly one active key remains.
    const second = await provisionRunnerKey(executor!.queryClient, {
      runnerId: movingRunner,
      tenantId: secondTenant,
      roles: ["worker", "service"],
      scopes: ["loops:runner"],
      ttlSeconds: 3600,
      signingSecret: SIGNING_SECRET,
    });
    expect(second.status).toBe("provisioned");
    if (second.status !== "provisioned") return;

    const keys = await executor!.queryClient.many<{
      kid: string;
      tenant_id: string;
      disabled_at: string | null;
    }>(
      `SELECT kid, tenant_id, disabled_at FROM api_keys
        WHERE principal_id = $1 AND token_kind = 'machine'
        ORDER BY issued_at`,
      [movingRunner],
    );
    expect(keys).toHaveLength(2);
    const active = keys.filter((key) => key.disabled_at === null);
    expect(active).toHaveLength(1);
    expect(active[0].kid).toBe(second.kid);
    expect(active[0].tenant_id).toBe(secondTenant);

    // A re-run for tenant B is now a true no-op.
    const third = await provisionRunnerKey(executor!.queryClient, {
      runnerId: movingRunner,
      tenantId: secondTenant,
      roles: ["worker", "service"],
      scopes: ["loops:runner"],
      ttlSeconds: 3600,
      signingSecret: SIGNING_SECRET,
    });
    expect(third.status).toBe("already_provisioned");
    expect(third.kid).toBe(second.kid);
  });

  test("suspended-principal reactivation disables the old key — exactly one active key afterward", async () => {
    // Provision, suspend the principal while its key is still unexpired, then
    // re-provision: the verb must reactivate the principal, disable the old
    // key, and mint exactly one replacement — never two active keys.
    const first = await provisionRunnerKey(executor!.queryClient, {
      runnerId: TEST_RUNNER,
      tenantId: TEST_TENANT,
      roles: ["worker", "service"],
      scopes: ["loops:runner"],
      ttlSeconds: 3600,
      signingSecret: SIGNING_SECRET,
    });
    expect(first.status).toBe("already_provisioned"); // still active from the previous test

    await executor!.queryClient.execute(
      `UPDATE principals SET status='suspended', updated_at=now() WHERE id = $1`,
      [TEST_RUNNER],
    );

    const second = await provisionRunnerKey(executor!.queryClient, {
      runnerId: TEST_RUNNER,
      tenantId: TEST_TENANT,
      roles: ["worker", "service"],
      scopes: ["loops:runner"],
      ttlSeconds: 3600,
      signingSecret: SIGNING_SECRET,
    });
    expect(second.status).toBe("provisioned");
    if (second.status !== "provisioned") return;

    const keys = await executor!.queryClient.many<{
      kid: string;
      disabled_at: string | null;
      revoked_at: string | null;
      expires_at: string | null;
    }>(
      `SELECT kid, disabled_at, revoked_at, expires_at
         FROM api_keys
        WHERE principal_id = $1 AND token_kind = 'machine'
        ORDER BY issued_at`,
      [TEST_RUNNER],
    );
    expect(keys).toHaveLength(2);
    expect(keys.filter((key) => key.disabled_at === null)).toHaveLength(1);
    expect(keys.filter((key) => key.disabled_at === null)[0].kid).toBe(second.kid);
    const disabled = keys.filter((key) => key.disabled_at !== null);
    expect(disabled).toHaveLength(1);
    expect(disabled[0].kid).toBe(first.kid);

    const principal = await executor!.queryClient.get<{ status: string; kind: string }>(
      `SELECT status, kind FROM principals WHERE id = $1`,
      [TEST_RUNNER],
    );
    expect(principal?.status).toBe("active");
    expect(principal?.kind).toBe("machine");
  });
});