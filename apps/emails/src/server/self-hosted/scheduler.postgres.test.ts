import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import {
  createPgPool,
  createQueryClient,
  type PoolQueryClient,
} from "../../storage-kit/index.js";
import { EmailsSelfHostedStore } from "./store.js";
import { resourceSpecForPath } from "./resources.js";
const databaseUrl = process.env.EMAILS_SCHEDULER_TEST_POSTGRES_URL;
const schema = `emails_scheduler_${crypto.randomUUID().replaceAll("-", "")}`;
let admin: ReturnType<typeof createPgPool>;
let pool: ReturnType<typeof createPgPool>;
let client: PoolQueryClient;
let store: EmailsSelfHostedStore;
const tenantA = "00000000-0000-0000-0000-000000000001",
  tenantB = "00000000-0000-0000-0000-000000000002";
beforeAll(async () => {
  if (!databaseUrl) return;
  admin = createPgPool({
    connectionString: databaseUrl,
    env: { PGSSLMODE: "disable" },
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  pool = createPgPool({
    connectionString: url.toString(),
    env: { PGSSLMODE: "disable" },
  });
  client = createQueryClient(pool);
  store = new EmailsSelfHostedStore(client);
  await client.execute(
    `CREATE TABLE scheduled_emails(id text PRIMARY KEY, tenant_id uuid NOT NULL, scheduled_at timestamptz, status text NOT NULL DEFAULT 'pending', error text, subject text DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now());`,
  );
});
afterAll(async () => {
  if (!databaseUrl) return;
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
beforeEach(async () => {
  if (databaseUrl) await client.execute("TRUNCATE scheduled_emails");
});
const pgtest = test.skipIf(!databaseUrl);
pgtest(
  "concurrent claims are disjoint, tenant-scoped and exclude future/cancelled work",
  async () => {
    await client.execute(
      `INSERT INTO scheduled_emails(id,tenant_id,scheduled_at,status) VALUES ('a',$1,now()-interval '1 hour','pending'),('b',$1,now()-interval '1 hour','pending'),('other',$2,now()-interval '1 hour','pending'),('future',$1,now()+interval '1 hour','pending'),('cancelled',$1,now()-interval '1 hour','cancelled')`,
      [tenantA, tenantB],
    );
    const scoped = store.forTenant(tenantA);
    const [one, two] = await Promise.all([
      scoped.claimDueScheduled(1),
      scoped.claimDueScheduled(1),
    ]);
    expect(one).toHaveLength(1);
    expect(two).toHaveLength(1);
    expect(one[0]!.id).not.toBe(two[0]!.id);
    expect([one[0]!.id, two[0]!.id].sort()).toEqual(["a", "b"]);
    expect(await scoped.claimDueScheduled(10)).toHaveLength(0);
  },
);
pgtest(
  "stale lease is reclaimed and old completion cannot overwrite new owner",
  async () => {
    await client.execute(
      `INSERT INTO scheduled_emails(id,tenant_id,scheduled_at,status,updated_at) VALUES ('a',$1,now()-interval '1 hour','processing',now()-interval '10 minutes')`,
      [tenantA],
    );
    const old = await client.one<{ updated_at: Date }>(
      "SELECT updated_at FROM scheduled_emails WHERE id='a'",
    );
    const scoped = store.forTenant(tenantA);
    const [claimed] = await scoped.claimDueScheduled(1);
    expect(
      await scoped.finishScheduled(
        "a",
        old.updated_at.toISOString(),
        "sent",
        null,
      ),
    ).toBe(false);
    expect(
      await store
        .forTenant(tenantB)
        .finishScheduled(
          "a",
          (claimed!.updated_at as Date).toISOString(),
          "sent",
          null,
        ),
    ).toBe(false);
    expect(
      await scoped.finishScheduled(
        "a",
        (claimed!.updated_at as Date).toISOString(),
        "sent",
        null,
      ),
    ).toBe(true);
    expect(await scoped.claimDueScheduled(1)).toHaveLength(0);
  },
);
pgtest(
  "in-flight jobs cannot be cancelled, edited or deleted through generic CRUD",
  async () => {
    await client.execute(
      `INSERT INTO scheduled_emails(id,tenant_id,scheduled_at) VALUES ('a',$1,now()-interval '1 hour')`,
      [tenantA],
    );
    const scoped = store.forTenant(tenantA);
    await scoped.claimDueScheduled(1);
    const spec = resourceSpecForPath("scheduled")!;
    expect(
      await scoped.updateResource(spec, "a", {
        status: "cancelled",
        subject: "changed",
      }),
    ).toBeNull();
    expect(await scoped.deleteResource(spec, "a")).toBe(false);
    const record = await client.one<{ status: string; subject: string }>(
      "SELECT status,subject FROM scheduled_emails WHERE id='a'",
    );
    expect(record).toEqual({ status: "processing", subject: "" });
  },
);
