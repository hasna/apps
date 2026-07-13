import { afterAll, describe, expect, test } from "bun:test";
import { mintApiKey } from "@hasna/contracts/auth";
import { createPgPool, createQueryClient } from "../generated/storage-kit/index.js";
import { createFetchHandler } from "./app.js";
import { runProjectsMigrations } from "./migrations.js";
import { resolveTenantContext } from "./tenancy.js";

// End-to-end HTTP tests through the PRODUCTION handler path (db pool +
// per-request tenant transaction + RLS GUC set_config + expanded /v1). Gated on
// a real Postgres.
const LIVE_URL = process.env.PROJECTS_TEST_DATABASE_URL;
const SIGNING_SECRET = "test-signing-secret-projects-live-000000";

if (LIVE_URL)
  describe("projects-serve live handler (/v1 expanded, tenant tx)", () => {
    const pool = createPgPool({ connectionString: LIVE_URL, applicationName: "projects-app-live" });
    const client = createQueryClient(pool);
    const handler = createFetchHandler({
      db: client,
      resolveTenant: (p) => resolveTenantContext(client, p),
      version: "1.0.0-rc.1",
      app: "projects",
      signingSecret: SIGNING_SECRET,
    });
    const token = mintApiKey({ app: "projects", scopes: ["projects:*"], signingSecret: SIGNING_SECRET }).token;
    const auth = { "x-api-key": token, "content-type": "application/json" };

    afterAll(async () => {
      await pool.end();
    });

    test("migrations applied", async () => {
      await runProjectsMigrations(client);
    });

    test("full round-trip: project + location + agent-run + budget + spend + lock", async () => {
      // create project
      const created = await handler(
        new Request("http://x/v1/projects", { method: "POST", headers: auth, body: JSON.stringify({ name: `Live ${Date.now()}` }) }),
      );
      expect(created.status).toBe(201);
      const project = await created.json();
      expect(project.id).toMatch(/^wks_/);

      // location (machine-local state persisted centrally)
      const loc = await handler(
        new Request(`http://x/v1/projects/${project.id}/locations`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ path: "/tmp/live", machine_id: "spark01", is_primary: true }),
        }),
      );
      expect(loc.status).toBe(201);
      const locList = await (await handler(new Request(`http://x/v1/projects/${project.id}/locations`, { headers: auth }))).json();
      expect(locList.count).toBe(1);

      // agent run
      const run = await handler(
        new Request("http://x/v1/runs", { method: "POST", headers: auth, body: JSON.stringify({ workspace_id: project.id, prompt: "do the thing" }) }),
      );
      expect(run.status).toBe(201);
      const runBody = await run.json();
      const patched = await handler(
        new Request(`http://x/v1/runs/${runBody.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ status: "completed" }) }),
      );
      expect((await patched.json()).status).toBe("completed");

      // budget + spend
      const budget = await handler(
        new Request("http://x/v1/budgets", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ scope_type: "project", scope_id: project.id, window: "monthly", max_usd: 5 }),
        }),
      );
      expect(budget.status).toBe(201);
      const spend = await handler(
        new Request("http://x/v1/spend", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ workspace_id: project.id, usd: 1.25, total_tokens: 1000 }),
        }),
      );
      expect(spend.status).toBe(201);
      const spendList = await (await handler(new Request(`http://x/v1/spend?workspace_id=${project.id}`, { headers: auth }))).json();
      expect(spendList.spend[0].usd).toBeCloseTo(1.25);

      // lock acquire/release
      const lockKey = `live-lock-${Date.now()}`;
      const lock = await handler(
        new Request("http://x/v1/locks", { method: "POST", headers: auth, body: JSON.stringify({ lock_key: lockKey, workspace_id: project.id }) }),
      );
      expect(lock.status).toBe(201);
      const dup = await handler(
        new Request("http://x/v1/locks", { method: "POST", headers: auth, body: JSON.stringify({ lock_key: lockKey }) }),
      );
      expect(dup.status).toBe(400); // already held
      const released = await handler(new Request(`http://x/v1/locks/${lockKey}`, { method: "DELETE", headers: auth }));
      expect((await released.json()).released).toBe(true);

      // cleanup
      await handler(new Request(`http://x/v1/projects/${project.id}?hard=true`, { method: "DELETE", headers: auth }));
    });

    test("read scope cannot write to expanded endpoints", async () => {
      const readToken = mintApiKey({ app: "projects", scopes: ["projects:read"], signingSecret: SIGNING_SECRET }).token;
      const res = await handler(
        new Request("http://x/v1/budgets", {
          method: "POST",
          headers: { "x-api-key": readToken, "content-type": "application/json" },
          body: JSON.stringify({ scope_type: "project", scope_id: "x", window: "monthly" }),
        }),
      );
      expect(res.status).toBe(403);
    });
  });
