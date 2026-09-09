import { test, expect } from "bun:test";
import { randomUUID, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { ApiKeyStore, mintApiKey } from "@hasna/contracts/auth";
import { createQueryClient } from "../src/generated/storage-kit/query.js";
import { MigrationLedger } from "../src/generated/storage-kit/migrations.js";
import { SECRETS_MIGRATIONS } from "../src/server/cloud-migrations.js";
import { createHandler, createCloudVerifier } from "../src/server/serve.js";
import { CloudSecretsStore } from "../src/server/cloud-store.js";

const dsn = process.env.SECRETS_TEST_DATABASE_URL;
(dsn ? test : test.skip)("real PG pruning rechecks concurrent renewal, isolates tenants and rolls audit failure back", async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const schema = `pruning_${suffix}`, role = `pruning_role_${suffix}`;
  const admin = new Pool({ connectionString: dsn });
  let pool: Pool | undefined, service: Pool | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: dsn, options: `-c search_path=${schema}` });
    const db = createQueryClient(pool);
    await new MigrationLedger(db, SECRETS_MIGRATIONS).migrate();
    await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
    await admin.query(`REVOKE ALL ON ${schema}.secret_key_owners FROM ${role}`);
    await admin.query(`GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
    service = new Pool({ connectionString: dsn, options: `-c search_path=${schema} -c role=${role}`, application_name: schema });
    const runtime = createQueryClient(service);
    const tenant = randomUUID(), other = randomUUID(), signing = randomBytes(32).toString("hex");
    for (const id of [tenant, other]) await db.execute("INSERT INTO tenants(id,slug,name) VALUES($1,$2,'fixture')", [id, id]);
    const keys = new ApiKeyStore(db);
    async function key(scopes: string[]) {
      const value = mintApiKey({ app: "secrets", scopes, signingSecret: signing });
      await keys.insertMinted(value);
      await db.execute("UPDATE api_keys SET tenant_id=$1 WHERE kid=$2", [tenant, value.kid]);
      return value;
    }
    const writer = await key(["secrets:write"]), reader = await key(["secrets:read"]);
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createHandler({ client: runtime, store: new CloudSecretsStore(runtime), verifier: createCloudVerifier(runtime, signing) }) });
    const url = `${server.url.origin}/v1/secrets/prune-expired`;
    const prune = (token = writer.token) => fetch(url, { method: "POST", headers: { "x-api-key": token, "content-type": "application/json" }, body: "{}" });
    async function insert(name: string, owner = tenant, expires: string | null = "2020-01-01") {
      await db.transaction(async tx => {
        await tx.execute("SELECT set_config('app.secrets_tenant_id',$1,true)", [owner]);
        await tx.execute("INSERT INTO secrets(key,value,type,expires_at,created_at,updated_at,tenant_id) VALUES($1,'synthetic-unread-value','other',$2,now(),now(),$3)", [name, expires, owner]);
      });
    }
    await insert("renewed"); await insert("expired"); await insert("other", other); await insert("no-ttl", tenant, null);
    expect((await prune(reader.token)).status).toBe(403);
    expect((await fetch(url, { method: "POST" })).status).toBe(401);
    const renewal = await pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await renewal.query("BEGIN");
      await renewal.query("SELECT set_config('app.secrets_tenant_id',$1,true)", [tenant]);
      await renewal.query("UPDATE secrets SET expires_at='2999-01-01' WHERE key='renewed'");
      pending = prune();
      let waiting = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const state = await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'DELETE FROM secrets%'", [schema]);
        if (state.rowCount) { waiting = true; break; }
        await Bun.sleep(20);
      }
      expect(waiting).toBe(true);
      await renewal.query("COMMIT");
      const response = await pending;
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ pruned: 1 });
    } finally { await renewal.query("ROLLBACK"); renewal.release(); if (pending) await pending; }
    expect((await db.many<{key:string}>("SELECT key FROM secrets ORDER BY key")).map(row => row.key)).toEqual(["no-ttl", "other", "renewed"]);
    expect(await db.many("SELECT key,agent,tenant_id FROM audit_log WHERE action='delete'")).toEqual([{ key: "expired", agent: writer.kid, tenant_id: tenant }]);
    expect(await (await prune()).json()).toEqual({ pruned: 0 });
    await insert("rollback");
    await db.execute("CREATE FUNCTION reject_prune_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$");
    await db.execute("CREATE TRIGGER reject_prune_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_prune_audit()");
    expect((await prune()).status).toBe(500);
    expect(await db.get("SELECT key FROM secrets WHERE key='rollback'")).toEqual({ key: "rollback" });
    expect((await db.many("SELECT key FROM audit_log WHERE action='delete'")).length).toBe(1);
  } finally {
    server?.stop(true); await service?.end(); await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`); await admin.end();
  }
}, 20000);
