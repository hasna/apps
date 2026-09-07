import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import {
  createPgPool,
  createQueryClient,
  type PoolQueryClient,
} from "../../storage-kit/index.js";
import { SequenceWorkerStore } from "./sequence-worker.js";
import { EmailsSelfHostedStore } from "./store.js";
import { resourceSpecForPath } from "./resources.js";
const databaseUrl = process.env.EMAILS_TEST_POSTGRES_URL;
const schema = `emails_sequence_${crypto.randomUUID().replaceAll("-", "")}`;
let admin: ReturnType<typeof createPgPool>,
  pool: ReturnType<typeof createPgPool>,
  client: PoolQueryClient;
const a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002";
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
  await client.execute(`CREATE TABLE sequences(id text PRIMARY KEY,tenant_id uuid,status text);
 CREATE TABLE sequence_steps(id text PRIMARY KEY,tenant_id uuid,sequence_id text,step_number int,delay_hours int,template_name text,from_address text,subject_override text,created_at timestamptz DEFAULT now());
 CREATE TABLE templates(id text PRIMARY KEY,tenant_id uuid,name text,subject_template text,text_template text,html_template text);
 CREATE TABLE addresses(id text PRIMARY KEY,tenant_id uuid,email text,status text,provider_id text);
 CREATE TABLE sequence_enrollments(id text PRIMARY KEY,tenant_id uuid,sequence_id text,contact_email text,provider_id text,current_step int DEFAULT 0,status text DEFAULT 'active',next_send_at timestamptz DEFAULT now(),completed_at timestamptz,updated_at timestamptz DEFAULT now(),execution_lease timestamptz,execution_payload jsonb,execution_error text,execution_started boolean DEFAULT false);`);
});
afterAll(async () => {
  if (databaseUrl) {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
beforeEach(async () => {
  if (!databaseUrl) return;
  await client.execute(
    "TRUNCATE sequences,sequence_steps,templates,addresses,sequence_enrollments",
  );
  for (const sql of `INSERT INTO sequences VALUES('seq',$1,'active'),('other',$2,'active'),('paused',$1,'paused');
 INSERT INTO templates VALUES('template',$1,'welcome','Hello {{email}}','Body',NULL);
 INSERT INTO sequence_steps(id,tenant_id,sequence_id,step_number,delay_hours,template_name,from_address) VALUES('step1',$1,'seq',1,0,'welcome','sender@example.com'),('step2',$1,'seq',2,2,'welcome','sender@example.com');
 INSERT INTO sequence_enrollments(id,tenant_id,sequence_id,contact_email) VALUES('e1',$1,'seq','recipient@example.com'),('e2',$1,'seq','two@example.com'),('foreign',$2,'other','other@example.com'),('paused',$1,'paused','paused@example.com');`
    .split(";")
    .filter((s) => s.trim()))
    await client.execute(sql, sql.includes("$2") ? [a, b] : [a]);
});
const pgtest = test.skipIf(!databaseUrl);
pgtest(
  "claims are disjoint, tenant scoped and exclude paused/cancelled enrollments",
  async () => {
    const store = new SequenceWorkerStore(client, a);
    const [one, two] = await Promise.all([store.claim(1), store.claim(1)]);
    expect(one).toHaveLength(1);
    expect(two).toHaveLength(1);
    expect(one[0]!.id).not.toBe(two[0]!.id);
    expect(await store.claim(10)).toHaveLength(0);
    const api = new EmailsSelfHostedStore(client).forTenant(a);
    const spec = resourceSpecForPath("sequence-enrollments")!;
    expect(
      await api.updateResource(spec, String(one[0]!.id), {
        status: "cancelled",
      }),
    ).toBeNull();
    expect(await api.deleteResource(spec, String(one[0]!.id))).toBe(false);
  },
);
pgtest(
  "snapshot survives edits and reclaim; stale completion cannot advance; success schedules next step",
  async () => {
    const store = new SequenceWorkerStore(client, a);
    const [first] = await store.claim(1);
    const snapshot = await store.prepare(first!);
    expect(snapshot?.subject).toContain("recipient@example.com");
    await client.execute("UPDATE templates SET subject_template='Changed'");
    await client.execute(
      "UPDATE sequence_enrollments SET execution_lease=now()-interval '10 minutes' WHERE id=$1",
      [first!.id],
    );
    const [reclaimed] = await store.claim(1);
    expect(reclaimed!.id).toBe(first!.id);
    expect(await store.prepare(reclaimed!)).toEqual(snapshot);
    expect(await store.isCurrent(first!)).toBe(false);
    expect(await store.isCurrent(reclaimed!)).toBe(true);
    expect(await store.finish(first!, snapshot, "sent", null)).toBe(false);
    expect(await store.finish(reclaimed!, snapshot, "sent", null)).toBe(true);
    expect(await store.finish(reclaimed!, snapshot, "sent", null)).toBe(false);
    const row = await client.one<Record<string, unknown>>(
      "SELECT * FROM sequence_enrollments WHERE id=$1",
      [first!.id],
    );
    expect(row.current_step).toBe(1);
    expect(row.status).toBe("active");
    expect(row.execution_payload).toBeNull();
    expect(new Date(String(row.next_send_at)).getTime()).toBeGreaterThan(
      Date.now() + 7100000,
    );
    const api = new EmailsSelfHostedStore(client).forTenant(a);
    expect(
      await api.updateResource(
        resourceSpecForPath("sequence-enrollments")!,
        String(row.id),
        { current_step: 0 },
      ),
    ).toBeNull();
  },
);
pgtest(
  "failed send retains snapshot and position; cancellation fences old workers and excludes future claims",
  async () => {
    const store = new SequenceWorkerStore(client, a);
    const [row] = await store.claim(1);
    const snapshot = await store.prepare(row!);
    expect(
      await store.finish(row!, snapshot, "failed", "recipient_suppressed"),
    ).toBe(true);
    const failed = await client.one<Record<string, unknown>>(
      "SELECT * FROM sequence_enrollments WHERE id=$1",
      [row!.id],
    );
    expect(failed.current_step).toBe(0);
    expect(failed.execution_error).toBe("recipient_suppressed");
    expect(failed.execution_payload).toEqual(snapshot);
    const api = new EmailsSelfHostedStore(client).forTenant(a);
    expect(
      await api.updateResource(
        resourceSpecForPath("sequence-enrollments")!,
        String(row!.id),
        { status: "cancelled" },
      ),
    ).not.toBeNull();
    expect(await store.finish(row!, snapshot, "sent", null)).toBe(false);
    await client.execute(
      "UPDATE sequence_enrollments SET next_send_at=now()-interval '1 minute'",
    );
    expect((await store.claim(10)).some((x) => x.id === row!.id)).toBe(false);
  },
);

pgtest(
  "final step completes and duplicate active enrollment refuses before send",
  async () => {
    const store = new SequenceWorkerStore(client, a);
    await client.execute(
      "UPDATE sequence_enrollments SET current_step=1 WHERE id='e1'",
    );
    const [row] = await store.claim(1);
    const snapshot = await store.prepare(row!);
    expect(snapshot?.next_delay_hours).toBeNull();
    expect(await store.finish(row!, snapshot, "sent", null)).toBe(true);
    const completed = await client.one<Record<string, unknown>>(
      "SELECT * FROM sequence_enrollments WHERE id=$1",
      [row!.id],
    );
    expect(completed.status).toBe("completed");
    expect(completed.next_send_at).toBeNull();
    await client.execute(
      "INSERT INTO sequence_enrollments(id,tenant_id,sequence_id,contact_email) VALUES('duplicate',$1,'seq','two@example.com')",
      [a],
    );
    const [duplicate] = await store.claim(1);
    await expect(store.prepare(duplicate!)).rejects.toThrow(
      "Duplicate active enrollments",
    );
  },
);
