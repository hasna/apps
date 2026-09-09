import { test, expect } from "bun:test";
import { randomUUID, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { ApiKeyStore, mintApiKey } from "@hasna/contracts/auth";
import { createQueryClient } from "../src/generated/storage-kit/query.js";
import { MigrationLedger } from "../src/generated/storage-kit/migrations.js";
import { SECRETS_MIGRATIONS } from "../src/server/cloud-migrations.js";
import { createHandler, createCloudVerifier } from "../src/server/serve.js";
import { encryptValue, fingerprintValue, _resetCloudMasterKey } from "../src/server/cloud-crypto.js";
import { CloudSecretsStore } from "../src/server/cloud-store.js";

const dsn = process.env.SECRETS_TEST_DATABASE_URL;
(dsn ? test : test.skip)("encryption repair verifies all tables, tenant isolation and rollback", async () => {
  const oldMaster = process.env.HASNA_SECRETS_MASTER_KEY;
  process.env.HASNA_SECRETS_MASTER_KEY = randomBytes(32).toString("hex"); _resetCloudMasterKey();
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
    const writer = await key(["secrets:read","secrets:write","secrets:migrate"]), reader = await key(["secrets:read"]);
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createHandler({ client: runtime, store: new CloudSecretsStore(runtime), verifier: createCloudVerifier(runtime, signing) }) });
    const call = (path:string, token=writer.token) => fetch(`${server!.url.origin}/v1/encryption/${path}`, {method:path==="status"?"GET":"POST",headers:{"x-api-key":token}});
    await db.transaction(async tx=>{
      await tx.execute("SELECT set_config('app.secrets_tenant_id',$1,true)",[tenant]);
      await tx.execute("INSERT INTO secrets(key,value,type,created_at,updated_at,tenant_id) VALUES('plain','synthetic','other','old','unchanged',$1)",[tenant]);
      await tx.execute("INSERT INTO vault_items(id,kind,title,data,created_at,updated_at,tenant_id) VALUES('item','secure_note','fixture','{}','old','unchanged',$1)",[tenant]);
      await tx.execute("INSERT INTO secret_versions(key,version,value_blob,value_hash,value_length,change_kind,created_at,created_by,tenant_id) VALUES('orphan',1,'synthetic',$1,9,'initial','old','fixture',$2)",[fingerprintValue('synthetic'),tenant]);
      await tx.execute("INSERT INTO vault_migrations(id,tenant_id,source_id,manifest) VALUES($1,$2,$3,$4)",[randomUUID(),tenant,randomUUID(),encryptValue('{}')]);
      await tx.execute("SELECT set_config('app.secrets_tenant_id',$1,true)",[other]);
      await tx.execute("INSERT INTO secrets(key,value,type,created_at,updated_at,tenant_id) VALUES('other','other-synthetic','other','old','old',$1)",[other]);
    });
    expect((await call("repair",reader.token)).status).toBe(403);
    expect((await fetch(`${server.url.origin}/v1/encryption/status`)).status).toBe(401);
    const initial=await (await call("status")).json();
    expect(initial.complete).toBe(true);expect(initial.verified).toBe(false);expect(initial.tenant_id).toBe(tenant);
    for(const table of ["secrets","vault_items","secret_versions"]) expect(initial.tables[table].plaintext).toBe(1);
    expect(initial.tables.vault_migrations.active).toBe(1);
    await db.execute("UPDATE vault_migrations SET manifest='enc:v1:broken' WHERE tenant_id=$1",[tenant]);
    const corrupted=await (await call("status")).json();expect(corrupted.tables.vault_migrations.unreadable).toBe(1);
    expect((await call("repair")).status).toBe(409);
    expect((await db.get<{value:string}>("SELECT value FROM secrets WHERE key='plain'"))?.value).toBe("synthetic");
    await db.execute("UPDATE vault_migrations SET manifest=$1 WHERE tenant_id=$2",[encryptValue('{}'),tenant]);
    const response=await call("repair");expect(response.status).toBe(200);
    const receipt=await response.json();expect(receipt.verified).toBe(true);
    for(const table of ["secrets","vault_items","secret_versions"]) expect(receipt.tables[table].repaired).toBe(1);
    expect((await db.get<{value:string}>("SELECT value FROM secrets WHERE key='other'"))?.value).toBe("other-synthetic");
    expect(await db.get("SELECT created_at,updated_at FROM secrets WHERE key='plain'")).toEqual({created_at:"old",updated_at:"unchanged"});
    expect(await db.get("SELECT value_hash,created_at FROM secret_versions WHERE key='orphan'")).toEqual({value_hash:fingerprintValue('synthetic'),created_at:"old"});
    expect((await (await call("repair")).json()).tables.secret_versions.repaired).toBe(0);
    await db.execute("UPDATE secrets SET value='rollback-synthetic' WHERE key='plain'");
    await db.execute("CREATE FUNCTION reject_repair_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$");
    await db.execute("CREATE TRIGGER reject_repair_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_repair_audit()");
    expect((await call("repair")).status).toBe(503);
    expect((await db.get<{value:string}>("SELECT value FROM secrets WHERE key='plain'"))?.value).toBe("rollback-synthetic");
    expect((await db.many("SELECT * FROM audit_log WHERE action='encryption_repair' AND tenant_id=$1",[tenant])).length).toBe(2);
    await db.execute("DROP TRIGGER reject_repair_audit ON audit_log");
    const writerConnection=await pool.connect();let pending:Promise<Response>|undefined;
    try {
      await writerConnection.query("BEGIN");
      await writerConnection.query("UPDATE secrets SET value='concurrent-synthetic' WHERE key='plain'");
      pending=call("repair");let waiting=false;const deadline=Date.now()+4000;
      while(Date.now()<deadline) {
        const result=await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'SELECT key,value FROM secrets%'",[schema]);
        if(result.rowCount){waiting=true;break;}await Bun.sleep(20);
      }
      expect(waiting).toBe(true);
      await writerConnection.query("COMMIT");
      expect((await pending).status).toBe(503);
      expect((await db.get<{value:string}>("SELECT value FROM secrets WHERE key='plain'"))?.value).toBe("concurrent-synthetic");
    } finally {await writerConnection.query("ROLLBACK");writerConnection.release();if(pending)await pending;}

  } finally {
    server?.stop(true); await service?.end(); await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`); await admin.end();
    if(oldMaster===undefined) delete process.env.HASNA_SECRETS_MASTER_KEY; else process.env.HASNA_SECRETS_MASTER_KEY=oldMaster; _resetCloudMasterKey();
  }
}, 20000);
