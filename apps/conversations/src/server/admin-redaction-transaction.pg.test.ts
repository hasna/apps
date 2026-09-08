import { adoptCorpus, inspectCorpus } from "./corpus-binding.js";
import { expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { ApiKeyStore, mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { createQueryClient } from "../generated/storage-kit/query.js";
import { PG_MIGRATIONS } from "../lib/pg-migrations.js";
import { hashText } from "../lib/admin-redaction.js";
import { startApiServer } from "./api.js";

// Explicit disposable test DSN only; never fall back to a live application DSN.
const dsn = process.env.CONVERSATIONS_TEST_DATABASE_URL;
const pgTest = dsn ? test : test.skip;

async function fixture(run: (f: {
  client: ReturnType<typeof createQueryClient>;
  pool: Pool;
  ids: number[];
  applicationName: string;
  apply: (ids: number[]) => Promise<Response>;
}) => Promise<void>) {
  const schema = `redaction_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: dsn, max: 1 });
  let pool: Pool | undefined;
  let server: ReturnType<typeof startApiServer> | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: dsn, options: `-csearch_path=${schema}`, application_name: schema, max: 5 });
    const client = createQueryClient(pool);
    for (const sql of PG_MIGRATIONS) await client.execute(sql);
    await adoptCorpus(client, { ...await inspectCorpus(client), tenant_id: "default", authority_id: "conversations", actor: "fixture-operator" });
    const ids: number[] = [];
    for (let index = 0; index < 2; index++) {
      const uuid = randomUUID();
      const row = await client.one<{ id: string }>(
        "INSERT INTO messages(uuid,session_id,from_agent,to_agent,content,metadata,attachments) VALUES($1,'fixture','alice','bob',$2,$3,$4) RETURNING id",
        [uuid, `synthetic-private-content-${index}`, JSON.stringify({ fixture: `synthetic-private-metadata-${index}` }), JSON.stringify([{ name: "fixture.txt", size: 4 }])],
      );
      ids.push(Number(row.id));
      await client.execute("INSERT INTO message_attachments(message_id,name,mime_type,size,content) VALUES($1,'fixture.txt','text/plain',4,$2)", [row.id, Buffer.from("data")]);
      await client.execute("INSERT INTO conversations_event_outbox(id,source,type,envelope_json) VALUES($1,'fixture','conversations.message.created',$2)", [uuid, JSON.stringify({ data: { uuid, content_preview: `synthetic-private-preview-${index}`, preserved: "unchanged" } })]);
    }
    const signingSecret = randomBytes(32).toString("hex");
    const minted = mintApiKey({ app: "conversations", tid: "default", agent: "redaction-fixture", scopes: ["conversations:admin-redact"], signingSecret });
    server = startApiServer({ port: 0, host: "127.0.0.1", deps: {
      client, keys: new ApiKeyStore(client), incidentProjector: null,
      verifier: verifyApiKey({ app: "conversations", signingSecret, keyStatus: async () => "active" as const }),
    } });
    const base = `http://127.0.0.1:${server.port}`;
    await run({ client, pool, ids, applicationName: schema, apply: requested => fetch(`${base}/v1/admin/redact-messages`, {
      method: "POST", headers: { "x-api-key": minted.token, "content-type": "application/json" },
      body: JSON.stringify({ ids: requested, apply: true, backup_confirmed: true, dry_run_confirmed: true, authority: "synthetic-test-authority", reason: "synthetic redaction regression" }),
    }) });
  } finally {
    server?.stop(true);
    await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}

pgTest("actual API commits content, attachment purge, outbox scrub and audit together", async () => {
  await fixture(async ({ client, ids, apply }) => {
    const response = await apply(ids);
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt.redacted_count).toBe(2);
    expect(receipt.actor).toBe("redaction-fixture");
    const messages = await client.many("SELECT content,metadata,attachments FROM messages ORDER BY id");
    expect(messages.every(row => row.content === "[REDACTED by conversations admin redaction]")).toBe(true);
    expect(JSON.stringify(messages)).not.toContain("synthetic-private");
    expect(await client.many("SELECT * FROM message_attachments")).toEqual([]);
    const outbox = await client.many<{ envelope_json: string }>("SELECT envelope_json FROM conversations_event_outbox");
    expect(outbox.every(row => JSON.parse(row.envelope_json).data.content_preview === "[REDACTED by conversations admin redaction]")).toBe(true);
    expect(outbox.every(row => JSON.parse(row.envelope_json).data.preserved === "unchanged")).toBe(true);
    const audit = await client.many("SELECT actor,attachment_files_deleted,before_hashes FROM message_redaction_audit ORDER BY message_id");
    expect(audit).toHaveLength(2);
    expect(audit.every(row => row.actor === "redaction-fixture" && Number(row.attachment_files_deleted) === 1)).toBe(true);
    expect(JSON.parse(audit[0]!.before_hashes).content_sha256).toBe(hashText("synthetic-private-content-0"));
  });
}, 20000);

pgTest("second audit insertion failure rolls back all earlier redaction surfaces", async () => {
  await fixture(async ({ client, ids, apply }) => {
    const snapshot = async () => ({
      messages: await client.many("SELECT * FROM messages ORDER BY id"),
      attachments: await client.many("SELECT * FROM message_attachments ORDER BY message_id,name"),
      outbox: await client.many("SELECT * FROM conversations_event_outbox ORDER BY id"),
      audit: await client.many("SELECT * FROM message_redaction_audit ORDER BY id"),
    });
    const before = await snapshot();
    await client.execute(`CREATE FUNCTION reject_second_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.message_id = ${ids[1]} THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await client.execute("CREATE TRIGGER reject_second_audit BEFORE INSERT ON message_redaction_audit FOR EACH ROW EXECUTE FUNCTION reject_second_audit()");
    const response = await apply(ids);
    expect(response.ok).toBe(false);
    expect(await snapshot()).toEqual(before);
  });
}, 20000);

pgTest("redaction waits for a conflicting row lock and audits the committed content", async () => {
  await fixture(async ({ client, pool, ids, applicationName, apply }) => {
    const editor = await pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await editor.query("BEGIN");
      await editor.query("UPDATE messages SET content='synthetic-concurrent-edit' WHERE id=$1", [ids[0]]);
      pending = apply([ids[0]!]);
      let locked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const row = await client.get<{ waiting: boolean }>("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%FROM messages WHERE id = ANY%' AND query LIKE '%FOR UPDATE%') waiting", [applicationName]);
        if (row?.waiting) { locked = true; break; }
        await Bun.sleep(10);
      }
      expect(locked).toBe(true);
      await editor.query("COMMIT");
      const response = await pending;
      expect(response.status).toBe(200);
      const audit = await client.one<{ before_hashes: string }>("SELECT before_hashes FROM message_redaction_audit WHERE message_id=$1", [ids[0]]);
      expect(JSON.parse(audit.before_hashes).content_sha256).toBe(hashText("synthetic-concurrent-edit"));
      expect((await client.one<{ content: string }>("SELECT content FROM messages WHERE id=$1", [ids[0]])).content).toBe("[REDACTED by conversations admin redaction]");
    } finally {
      await editor.query("ROLLBACK");
      editor.release();
      await pending?.catch(() => {});
    }
  });
}, 20000);
