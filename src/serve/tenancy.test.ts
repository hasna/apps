import { afterAll, describe, expect, test } from "bun:test";
import { mintApiKey } from "@hasna/contracts/auth";
import { createPgPool, createQueryClient } from "../generated/storage-kit/index.js";
import { runProjectsMigrations } from "./migrations.js";
import { ProjectsPgStore } from "./pg-store.js";
import { ROOT_TENANT_ID, resolveTenantContext } from "./tenancy.js";

// Pure (no-DB) assertions always run.
describe("tenancy constants", () => {
  test("ROOT_TENANT_ID is the fleet-fixed default UUID", () => {
    expect(ROOT_TENANT_ID).toBe("adfd95c7-ee8b-52cb-ae47-4ae65dae3313");
  });
});

// Live isolation tests, gated on a real Postgres.
const LIVE_URL = process.env.PROJECTS_TEST_DATABASE_URL;
const TENANT_B = "11111111-1111-1111-1111-111111111111";

if (LIVE_URL)
  describe("tenancy isolation (live)", () => {
    const pool = createPgPool({ connectionString: LIVE_URL, applicationName: "projects-tenancy-test" });
    const client = createQueryClient(pool);
    const rootStore = new ProjectsPgStore(client, { tenantId: ROOT_TENANT_ID });
    const tenantBStore = new ProjectsPgStore(client, { tenantId: TENANT_B });

    afterAll(async () => {
      await pool.end();
    });

    test("migrations seed the ROOT tenant + system principal", async () => {
      await runProjectsMigrations(client);
      const tenant = await client.get<{ slug: string; kind: string }>(
        "SELECT slug, kind FROM tenants WHERE id = $1",
        [ROOT_TENANT_ID],
      );
      expect(tenant?.slug).toBe("hasna");
      expect(tenant?.kind).toBe("root");
      const membership = await client.get<{ role: string }>(
        "SELECT role FROM memberships WHERE tenant_id = $1",
        [ROOT_TENANT_ID],
      );
      expect(membership?.role).toBe("owner");
      // register tenant B so api_key_context FK is satisfiable
      await client.execute(
        "INSERT INTO tenants (id, slug, name, kind) VALUES ($1,'tenant-b','Tenant B','org') ON CONFLICT (id) DO NOTHING",
        [TENANT_B],
      );
    });

    test("workspaces created in tenant A are invisible to tenant B", async () => {
      const a = await rootStore.createWorkspace({ name: `Iso A ${Date.now()}` });
      const b = await tenantBStore.createWorkspace({ name: `Iso B ${Date.now()}` });

      // A cannot see B's workspace and vice versa
      expect(await rootStore.getWorkspace(b.id)).toBeNull();
      expect(await tenantBStore.getWorkspace(a.id)).toBeNull();

      const aList = await rootStore.listWorkspaces();
      const bList = await tenantBStore.listWorkspaces();
      expect(aList.some((w) => w.id === a.id)).toBe(true);
      expect(aList.some((w) => w.id === b.id)).toBe(false);
      expect(bList.some((w) => w.id === b.id)).toBe(true);
      expect(bList.some((w) => w.id === a.id)).toBe(false);

      // cleanup
      await rootStore.deleteWorkspace(a.id, { hard: true });
      await tenantBStore.deleteWorkspace(b.id, { hard: true });
    });

    test("agent runs and budgets are tenant-scoped", async () => {
      const runA = await rootStore.createAgentRun({ prompt: "root run" });
      const runB = await tenantBStore.createAgentRun({ prompt: "tenant-b run" });
      expect(await rootStore.getAgentRun(runB.id)).toBeNull();
      expect(await tenantBStore.getAgentRun(runA.id)).toBeNull();

      const budgetA = await rootStore.createBudget({ scope_type: "project", scope_id: "x", window: "monthly", max_usd: 10 });
      const bBudgets = await tenantBStore.listBudgets();
      expect(bBudgets.some((x) => x.id === budgetA.id)).toBe(false);

      await rootStore.updateAgentRun(runA.id, { status: "completed" });
      // cross-tenant update must not find the row
      await expect(tenantBStore.updateAgentRun(runA.id, { status: "failed" })).rejects.toThrow();

      await rootStore.deleteBudget(budgetA.id);
    });

    test("unbound valid key resolves to ROOT (R1 non-fail-closed); bound key resolves to its tenant", async () => {
      const minted = mintApiKey({ app: "projects", scopes: ["projects:*"], signingSecret: "x".repeat(32) });
      // unbound
      const ctxUnbound = await resolveTenantContext(client, {
        kid: minted.kid,
        app: "projects",
        scopes: ["projects:*"],
        agent: null,
        claims: minted.claims,
      });
      expect(ctxUnbound.tenantId).toBe(ROOT_TENANT_ID);
      expect(ctxUnbound.bound).toBe(false);

      // bind the kid to tenant B, then re-resolve
      await client.execute(
        "INSERT INTO api_key_context (kid, tenant_id, principal_type, scopes) VALUES ($1,$2,'service','[]') ON CONFLICT (kid) DO UPDATE SET tenant_id = EXCLUDED.tenant_id",
        [minted.kid, TENANT_B],
      );
      const ctxBound = await resolveTenantContext(client, {
        kid: minted.kid,
        app: "projects",
        scopes: ["projects:*"],
        agent: null,
        claims: minted.claims,
      });
      expect(ctxBound.tenantId).toBe(TENANT_B);
      expect(ctxBound.bound).toBe(true);
      await client.execute("DELETE FROM api_key_context WHERE kid = $1", [minted.kid]);
    });
  });
