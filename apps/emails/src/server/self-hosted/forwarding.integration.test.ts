import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import {
  createPgPool,
  createQueryClient,
  MigrationLedger,
  type PoolQueryClient,
} from "../../storage-kit/index.js";
import { EmailsSelfHostedStore } from "./store.js";
import { resourceSpecForPath } from "./resources.js";
import { emailsSelfHostedMigrations } from "./migrations.js";

const databaseUrl = process.env.EMAILS_TEST_POSTGRES_URL;
const schema = "public";
const rlsRole = `forwarding_rls_${crypto.randomUUID().replaceAll("-", "")}`;
let rlsRoleCreated = false;
let pool: ReturnType<typeof createPgPool>;
let client: PoolQueryClient, store: EmailsSelfHostedStore;
const tenantA = "00000000-0000-0000-0000-000000000001",
  tenantB = "00000000-0000-0000-0000-000000000002";
// Rebuilding the cold schema can exceed Bun's default 5s hook deadline.
// Match the other migration fixtures without extending individual case limits.
beforeAll(async () => {
  if (!databaseUrl) return;
  pool = createPgPool({
    connectionString: databaseUrl,
    env: { PGSSLMODE: "disable" },
  });
  client = createQueryClient(pool);
  store = new EmailsSelfHostedStore(client);
  await client.execute(
    "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public",
  );
  await new MigrationLedger(client, emailsSelfHostedMigrations()).migrate();
  await client.execute(
    "INSERT INTO tenants(id,slug,name) VALUES($1,'forwarding-a','Fixture A'),($2,'forwarding-b','Fixture B') ON CONFLICT(id) DO NOTHING",
    [tenantA, tenantB],
  );
  await client.execute(
    `CREATE ROLE "${rlsRole}" NOLOGIN; GRANT USAGE ON SCHEMA public TO "${rlsRole}"; GRANT SELECT,INSERT,UPDATE,DELETE ON forwarding_delivery_jobs TO "${rlsRole}"`,
  );
  rlsRoleCreated = true;
}, 60_000);
afterAll(async () => {
  if (!pool) return;
  try {
    if (rlsRoleCreated)
      await client.execute(`DROP OWNED BY "${rlsRole}"; DROP ROLE "${rlsRole}"`);
  } finally {
    await pool.end();
  }
});
beforeEach(async () => {
  if (databaseUrl)
    await client.execute(
      "TRUNCATE forwarding_rules,messages,forwarding_delivery_jobs CASCADE",
    );
});

async function seed(
  rule = "rule-a",
  message = "message-a",
  tenant = tenantA,
  source = "source@example.test",
) {
  await client.execute(
    "INSERT INTO forwarding_rules(id,tenant_id,source_address,target_address,created_at) VALUES($1,$2,$3,'target@example.test',now()-interval '1 day') ON CONFLICT DO NOTHING",
    [rule, tenant, source],
  );
  await client.execute(
    "INSERT INTO messages(id,tenant_id,from_addr,direction,received_at,body_text) VALUES($1,$2,'sender@example.test','inbound',now(),'Original')",
    [message, tenant],
  );
  await client.execute(
    "INSERT INTO message_recipients(tenant_id,message_id,email,domain,sort_ts) VALUES($1,$2,$3,split_part($3,'@',2),now())",
    [tenant, message, source],
  );
}
const pgtest = test.skipIf(!databaseUrl);
pgtest(
  "exact to/cc recipient matching, rule age, direction and tenant isolation govern eligibility",
  async () => {
    await seed();
    await seed("rule-a", "old");
    await seed("rule-a", "outbound");
    await seed("rule-a", "substring");
    await seed("rule-a", "cc");
    await seed("other-rule", "other-message", tenantB);
    await seed(
      "disabled",
      "disabled-message",
      tenantA,
      "disabled@example.test",
    );
    await client.execute(
      "UPDATE messages SET received_at=now()-interval '2 days' WHERE id='old'; UPDATE messages SET direction='outbound' WHERE id='outbound'; UPDATE message_recipients SET email='prefixsource@example.test' WHERE message_id='substring'; UPDATE message_recipients SET kind='cc' WHERE message_id='cc'; UPDATE forwarding_rules SET enabled=false WHERE id='disabled'",
    );
    const scoped = store.forTenant(tenantA);
    const claims = await scoped.claimForwarding({ limit: 100 });
    expect(claims.map((c) => c.message_id).sort()).toEqual(["cc", "message-a"]);
    expect(
      (await scoped.claimForwarding({ backfill: true })).map(
        (c) => c.message_id,
      ),
    ).toEqual(["old"]);
    expect(
      (await store.forTenant(tenantB).claimForwarding({})).map(
        (c) => c.message_id,
      ),
    ).toEqual(["other-message"]);
  },
);
pgtest(
  "concurrent runners claim disjoint work and a confirmed delivery cannot repeat",
  async () => {
    await seed();
    await seed("rule-b", "message-b", tenantA, "second@example.test");
    const scoped = store.forTenant(tenantA);
    const [a, b] = await Promise.all([
      scoped.claimForwarding({ limit: 1 }),
      scoped.claimForwarding({ limit: 1 }),
    ]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]!.message_id).not.toBe(b[0]!.message_id);
    expect(
      await scoped.finishForwarding(a[0]!, "sent", "sent-copy", null),
    ).toBe(true);
    expect(await scoped.claimForwarding({})).toEqual([]);
  },
);
pgtest(
  "stale lease retries retain their first payload and only the current tenant lease can complete",
  async () => {
    await seed();
    await client.execute("UPDATE messages SET body_html='<p>Original HTML</p>',attachments=$1::jsonb", [JSON.stringify([{filename:"original.txt",content_type:"text/plain",size:1,content_base64:"YQ=="}])]);
    const scoped = store.forTenant(tenantA);
    const [original] = await scoped.claimForwarding({
      fromAddress: "original@example.test",
    });
    expect(original!.snapshot.message.body_html).toBe("<p>Original HTML</p>");
    expect(original!.snapshot.message.attachments).toEqual([{filename:"original.txt",content_type:"text/plain",size:1,content_base64:"YQ=="}]);
    await client.execute(
      "UPDATE forwarding_delivery_jobs SET updated_at=now()-interval '6 minutes'; UPDATE messages SET body_text='changed',body_html='changed',attachments='[]'::jsonb; UPDATE forwarding_rules SET target_address='changed@example.test'",
    );
    const [retry] = await scoped.claimForwarding({
      fromAddress: "changed@example.test",
    });
    expect(retry!.lease).not.toBe(original!.lease);
    expect(retry!.snapshot).toEqual(original!.snapshot);
    expect(
      await scoped.finishForwarding(original!, "sent", "old-copy", null),
    ).toBe(false);
    expect(
      await store
        .forTenant(tenantB)
        .finishForwarding(retry!, "sent", "other-copy", null),
    ).toBe(false);
    expect(
      await scoped.finishForwarding(retry!, "sent", "confirmed-copy", null),
    ).toBe(true);
    expect(await scoped.claimForwarding({})).toEqual([]);
  },
);
pgtest(
  "disabling fences retries while processing content and deletion stay immutable",
  async () => {
    await seed();
    const scoped = store.forTenant(tenantA);
    const spec = resourceSpecForPath("forwarding")!;
    await scoped.claimForwarding({});
    expect(
      await scoped.updateResource(spec, "rule-a", {
        target_address: "changed@example.test",
      }),
    ).toBeNull();
    expect(await scoped.deleteResource(spec, "rule-a")).toBe(false);
    expect(
      await scoped.updateResource(spec, "rule-a", { enabled: false }),
    ).toMatchObject({ enabled: false });
    await client.execute(
      "UPDATE forwarding_delivery_jobs SET updated_at=now()-interval '6 minutes'",
    );
    expect(await scoped.claimForwarding({})).toEqual([]);
    await client.execute("UPDATE forwarding_delivery_jobs SET status='failed'");
    expect(await scoped.claimForwarding({})).toEqual([]);
    await client.execute(
      "UPDATE forwarding_delivery_jobs SET status='processing'",
    );
    expect(
      await scoped.updateResource(spec, "rule-a", { enabled: true }),
    ).toMatchObject({ enabled: true });
    expect(await scoped.claimForwarding({})).toHaveLength(1);
  },
);
pgtest(
  "migration enables forced tenant row isolation on immutable delivery snapshots",
  async () => {
    const table = await client.one<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='forwarding_delivery_jobs'::regclass",
    );
    expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const policies = await client.many<{ qual: string; with_check: string }>(
      "SELECT qual,with_check FROM pg_policies WHERE schemaname=$1 AND tablename='forwarding_delivery_jobs'",
      [schema],
    );
    expect(policies).toHaveLength(1);
    expect(policies[0]!.qual).toContain("app.current_tenant");
    expect(policies[0]!.with_check).toContain("app.current_tenant");
    await seed();
    await seed("other-rule", "other-message", tenantB);
    await store.forTenant(tenantA).claimForwarding({});
    await store.forTenant(tenantB).claimForwarding({});
    const session = await pool.connect();
    try {
      await session.query("BEGIN");
      await session.query(`SET LOCAL ROLE "${rlsRole}"`);
      await session.query("SELECT set_config('app.current_tenant',$1,true)", [
        tenantA,
      ]);
      expect(
        (await session.query("SELECT tenant_id FROM forwarding_delivery_jobs"))
          .rows,
      ).toEqual([{ tenant_id: tenantA }]);
      expect(
        (
          await session.query(
            "UPDATE forwarding_delivery_jobs SET status='sent' WHERE tenant_id=$1",
            [tenantB],
          )
        ).rowCount,
      ).toBe(0);
      await expect(
        session.query(
          "INSERT INTO forwarding_delivery_jobs(tenant_id,rule_id,message_id,snapshot,status,lease) VALUES($1,'intruder','intruder','{}','processing',$2)",
          [tenantB, crypto.randomUUID()],
        ),
      ).rejects.toThrow("row-level security");
    } finally {
      await session.query("ROLLBACK");
      session.release();
    }
  },
);
