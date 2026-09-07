import { afterAll, beforeAll, expect, test } from "bun:test";
import { createPgPool, createQueryClient, MigrationLedger, type PoolQueryClient } from "../../storage-kit/index.js";
import { EmailsSelfHostedStore, type MessageInput } from "./store.js";
import { DEFAULT_TENANT_ID, emailsSelfHostedMigrations } from "./migrations.js";
const databaseUrl = process.env.EMAILS_TEST_POSTGRES_URL;
let client: PoolQueryClient;
const other = "00000000-0000-0000-0000-000000000099";
beforeAll(async () => {
  if (!databaseUrl) return;
  client = createQueryClient(createPgPool({ connectionString: databaseUrl, env: { PGSSLMODE: "disable" } }));
  await client.execute("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public");
  await new MigrationLedger(client, emailsSelfHostedMigrations()).migrate();
  await client.execute("INSERT INTO inbound_domain_routes(domain,tenant_id) VALUES('example.com',$1::uuid)", [DEFAULT_TENANT_ID]);
}, 60000);
afterAll(async () => { await client?.close(); });
const pgtest = test.skipIf(!databaseUrl);
function input(): MessageInput { return { direction: "inbound", from_addr: "sender@example.net", to_addrs: ["inbox@example.com"], subject: "Synthetic SMTP", body_text: "Synthetic", status: "received", attachments: [{ filename: "fixture.txt", size: 3, content_type: "text/plain", content_base64: "YWJj" }] }; }
pgtest("concurrent equal submissions insert one message and receipt; replay preserves edits and deletion", async () => {
  const scoped = new EmailsSelfHostedStore(client).forTenant(DEFAULT_TENANT_ID), transaction = crypto.randomUUID(), hash = "a".repeat(64);
  const results = await Promise.all(Array.from({ length: 8 }, () => scoped.submitSmtpMessage(input(), transaction, hash)));
  expect(new Set(results.map(result => result.id)).size).toBe(1); expect(results.filter(result => !result.duplicate)).toHaveLength(1);
  const id = results[0]!.id;
  expect(await client.one("SELECT count(*)::int AS n FROM messages WHERE id=$1", [id])).toEqual({ n: 1 });
  await client.execute("UPDATE messages SET subject='User edited' WHERE id=$1", [id]);
  expect(await scoped.submitSmtpMessage(input(), transaction, hash)).toEqual({ stored: true, id, duplicate: true });
  expect(await client.one("SELECT subject FROM messages WHERE id=$1", [id])).toEqual({ subject: "User edited" });
  await client.execute("DELETE FROM messages WHERE id=$1", [id]);
  expect(await scoped.submitSmtpMessage(input(), transaction, hash)).toEqual({ stored: true, id, duplicate: true });
  expect(await client.one("SELECT count(*)::int AS n FROM messages WHERE id=$1", [id])).toEqual({ n: 0 });
});
pgtest("changed retry hash conflicts and message insertion failure rolls back receipt", async () => {
  const scoped = new EmailsSelfHostedStore(client).forTenant(DEFAULT_TENANT_ID), transaction = crypto.randomUUID();
  await scoped.submitSmtpMessage(input(), transaction, "b".repeat(64));
  await expect(scoped.submitSmtpMessage(input(), transaction, "c".repeat(64))).rejects.toThrow("conflicts");
  const broken = crypto.randomUUID();
  await expect(scoped.submitSmtpMessage({ ...input(), received_at: "not-a-valid-date" }, broken, "d".repeat(64))).rejects.toThrow();
  expect(await client.one("SELECT count(*)::int AS n FROM smtp_submission_receipts WHERE transaction_id=$1", [broken])).toEqual({ n: 0 });
});
pgtest("final transaction route check prevents foreign tenant writes and receipt table forces tenant RLS", async () => {
  const scoped = new EmailsSelfHostedStore(client).forTenant(other);
  await expect(scoped.submitSmtpMessage(input(), crypto.randomUUID(), "e".repeat(64))).rejects.toThrow("routing changed");
  const table = await client.one("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='smtp_submission_receipts'");
  expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  expect(await client.one("SELECT count(*)::int AS n FROM smtp_submission_receipts WHERE tenant_id=$1", [other])).toEqual({ n: 0 });
});
