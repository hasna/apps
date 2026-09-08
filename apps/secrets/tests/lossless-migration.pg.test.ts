import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintApiKey, ApiKeyStore } from "@hasna/contracts/auth";
import { createHandler, createCloudVerifier } from "../src/server/serve.js";
import { tenantStore } from "../src/server/tenant-client.js";
import { CloudSecretsStore } from "../src/server/cloud-store.js";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createQueryClient } from "../src/generated/storage-kit/query.js";
import { MigrationLedger } from "../src/generated/storage-kit/migrations.js";
import { SECRETS_MIGRATIONS } from "../src/server/cloud-migrations.js";
import { importVault, migrationCapability } from "../src/server/vault-migration.js";
import { COLUMNS, TABLES, proof, type Snapshot } from "../src/migration/snapshot.js";
import { _resetCloudMasterKey } from "../src/server/cloud-crypto.js";

const dsn=process.env.SECRETS_TEST_DATABASE_URL;
(dsn ? test : test.skip)("real PG: durable transfer, re-encryption, replay, conflict rollback and active tenant fence",async()=>{
 const schema='migration_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:dsn});const saved=process.env.HASNA_SECRETS_MASTER_KEY;
 process.env.HASNA_SECRETS_MASTER_KEY=randomBytes(32).toString('hex');_resetCloudMasterKey();
 let pool:Pool|undefined;let servicePool:Pool|undefined;const role='migration_role_'+randomUUID().replaceAll('-','');
 try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool=new Pool({connectionString:dsn,options:`-c search_path=${schema}`});const db=createQueryClient(pool);
  await new MigrationLedger(db,SECRETS_MIGRATIONS).migrate();
  const tenant=randomUUID(),kid=randomUUID();
  await db.execute("INSERT INTO tenants(id,slug,name) VALUES($1,$2,'fixture')",[tenant,tenant]);
  await db.execute("INSERT INTO api_keys(kid,app,scopes,token_hash,issued_at,tenant_id) VALUES($1,'secrets','[\"secrets:migrate\"]',$2,now(),$3)",[kid,randomUUID(),tenant]);
  await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
  await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
  await admin.query(`REVOKE ALL ON ${schema}.secret_key_owners FROM ${role}`);
  await admin.query(`GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
  servicePool=new Pool({connectionString:dsn,options:`-c search_path=${schema} -c role=${role} -c synchronous_commit=off`});const runtimeDb=createQueryClient(servicePool);
  const a={tenantId:tenant,kid};await expect(migrationCapability(db,a)).rejects.toThrow('row-level security');expect((await migrationCapability(runtimeDb,a)).protocol).toBe('secrets-lossless-v1');
  const tables={} as Snapshot['tables'];const when='2020-01-01T00:00:00.000Z';
  for(const t of TABLES) {
   const row=Object.fromEntries(COLUMNS[t].map(c=>[c,null]));
   Object.assign(row,{...(t==='secrets'||t==='secret_versions'?{key:'fixture/key'}:{id:t==='audit_log'?998:randomUUID()})});
   for(const c of COLUMNS[t]) if(['created_at','updated_at','timestamp','registered_at'].includes(c))row[c]=when;
   if(t==='secrets')Object.assign(row,{value:'synthetic-current',type:'other'});
   if(t==='vault_items')Object.assign(row,{kind:'secure_note',title:'fixture',domains:'[]',tags:'[]',favorite:0,data:'{"body":"synthetic-note"}'});
   if(t==='audit_log')Object.assign(row,{action:'set',key:'fixture/key',agent:'original-agent'});
   if(t==='users')Object.assign(row,{name:'original-user',type:'human'});
   if(t==='feedback')Object.assign(row,{message:'fixture feedback',category:'general'});
   if(t==='secret_versions')Object.assign(row,{version:1,value_blob:'synthetic-historical',value_hash:'original-keyed-fingerprint',value_length:20,change_kind:'initial',created_by:'original-agent'});
   tables[t]=[row];
  }
  tables.secret_versions.push({...tables.secret_versions[0]!,key:'fixture/orphan',version:7});
  const snapshot:Snapshot={schema:1,audit_sequence:0,tables};const input={expected_tenant_id:tenant,expected_kid:kid,migration_id:randomUUID(),source_id:randomUUID(),nonce:randomBytes(32).toString('hex'),snapshot};
  // Every serving connection starts asynchronous; the transaction must override it.
  expect((await runtimeDb.get<{value:string}>("SELECT current_setting('synchronous_commit') AS value"))!.value).toBe('off');
  await db.execute("ALTER TABLE vault_migrations ADD CONSTRAINT fixture_durable_receipt CHECK(current_setting('synchronous_commit')='on')");
  // A late journal failure rolls back imported payloads, even after read/write work.
  await db.execute("CREATE FUNCTION fixture_fail_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic commit failure'; END $$");
  await db.execute("CREATE CONSTRAINT TRIGGER fixture_fail_commit AFTER INSERT ON vault_migrations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fixture_fail_commit()");
  await expect(importVault(runtimeDb,a,input)).rejects.toThrow('synthetic commit failure');
  for(const table of [...TABLES,'vault_migrations','vault_migration_keys'])expect((await db.get<{n:string}>(`SELECT count(*) n FROM ${table}`))!.n).toBe('0');
  expect((await runtimeDb.get<{value:string}>("SELECT current_setting('synchronous_commit') AS value"))!.value).toBe('off');
  await db.execute('DROP TRIGGER fixture_fail_commit ON vault_migrations');
  const concurrent=await Promise.all([importVault(runtimeDb,a,input),importVault(runtimeDb,a,input)]);expect(concurrent.filter(r=>r.replayed)).toHaveLength(1);const receipt=concurrent[0]!;expect(receipt.proof).toBe(proof(snapshot,input.nonce));expect(Object.values(receipt.counts)).toEqual([1,1,1,1,1,2]);
  expect((await db.get<{value:string}>('SELECT value FROM secrets WHERE key=$1',['fixture/key']))!.value.startsWith('enc:v1:')).toBe(true);
  expect((await importVault(runtimeDb,a,input)).replayed).toBe(true);
  expect((await runtimeDb.get<{value:string}>("SELECT current_setting('synchronous_commit') AS value"))!.value).toBe('off');
  await expect(importVault(runtimeDb,a,{...input,migration_id:randomUUID()})).rejects.toThrow('migration_destination_identity_conflict');
  await expect(importVault(runtimeDb,a,{...input,snapshot:{...snapshot,tables:{...tables,feedback:[]}}})).rejects.toThrow('migration_replay_conflict');
  const signing=randomBytes(32).toString('hex');const authStore=new ApiKeyStore(db);
  const token=mintApiKey({app:'secrets',scopes:['secrets:*'],signingSecret:signing});await authStore.insertMinted(token);
  await db.execute('UPDATE api_keys SET tenant_id=$1 WHERE kid=$2',[tenant,token.kid]);
  let afterCapability:(()=>void)|undefined;const actualHandler=createHandler({client:runtimeDb,store:new CloudSecretsStore(runtimeDb),verifier:createCloudVerifier(runtimeDb,signing)});
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){const response=await actualHandler(req);if(req.method==='GET' && new URL(req.url).pathname==='/v1/migrations/vault')afterCapability?.();return response;}});
  const dir=mkdtempSync(join(tmpdir(),'migration-cli-'));
  try {
    const source=join(dir,'source.db'),keyPath=join(dir,'key');writeFileSync(keyPath,randomBytes(32).toString('hex'),{mode:0o600});
    const local=new Database(source);
    for(const table of TABLES) {
      local.exec(`CREATE TABLE ${table} (${COLUMNS[table].map(c=>`${c} ${['favorite','version','value_length','source_version'].includes(c) || (table==='audit_log' && c==='id')?'INTEGER':'TEXT'}`).join(',')})`);
      for(const row of snapshot.tables[table])local.query(`INSERT INTO ${table} VALUES (${COLUMNS[table].map(()=>'?').join(',')})`).run(...COLUMNS[table].map(c=>row[c]));
    }
    local.close();
    const command=[process.execPath,'src/index.ts','migrate-vault','--source',source,'--key-file',keyPath,'--source-id',input.source_id,'--migration-id',input.migration_id,'--tenant',tenant];
    const env={...process.env,HOME:dir,HASNA_HOME:dir,HASNA_CONFIG_HOME:dir,HASNA_SECRETS_API_URL:`http://127.0.0.1:${server.port}`,HASNA_SECRETS_API_KEY_OVERRIDE:token.token};
    const child=Bun.spawn(command,{cwd:join(import.meta.dir,'..'),env,stdout:'pipe',stderr:'pipe'});
    const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    expect(code).toBe(0);expect(JSON.parse(stdout).verified).toBe(true);expect(JSON.parse(stdout).replayed).toBe(true);expect(stdout+stderr).not.toContain('synthetic-current');expect(stdout+stderr).not.toContain(token.token);
    const reader=mintApiKey({app:'secrets',scopes:['secrets:read'],signingSecret:signing});await authStore.insertMinted(reader);await db.execute('UPDATE api_keys SET tenant_id=$1 WHERE kid=$2',[tenant,reader.kid]);
    const denied=await fetch(`http://127.0.0.1:${server.port}/v1/migrations/vault`,{headers:{'x-api-key':reader.token}});expect(denied.status).toBe(403);
    const wrongTenant=await importVault(runtimeDb,{tenantId:randomUUID(),kid:token.kid},input).catch(e=>e);expect(wrongTenant.code).toBe('migration_destination_changed');
    const otherTenant=randomUUID();await db.execute("INSERT INTO tenants(id,slug,name) VALUES($1,$2,'other fixture')",[otherTenant,otherTenant]);
    const other=mintApiKey({app:'secrets',scopes:['secrets:*'],signingSecret:signing});await authStore.insertMinted(other);await db.execute('UPDATE api_keys SET tenant_id=$1 WHERE kid=$2',[otherTenant,other.kid]);
    const configDir=join(dir,'secrets','config');mkdirSync(configDir,{recursive:true,mode:0o700});const credentialPath=join(configDir,'credentials');
    const saveCredential=(value:string)=>writeFileSync(credentialPath,`HASNA_SECRETS_API_KEY="${value}"\n`,{mode:0o600});saveCredential(token.token);
    afterCapability=()=>saveCredential(other.token);
    const diskEnv={...env,HASNA_CONFIG_HOME:'',HASNA_STATION:randomUUID()} as Record<string,string>;
    for(const name of ['HASNA_SECRETS_API_KEY_OVERRIDE','HASNA_SECRETS_API_KEY','SECRETS_API_KEY','HASNA_SECRETS_API_KEY_REF','HASNA_PROFILE'])delete diskEnv[name];
    const rotating=Bun.spawn(command,{cwd:join(import.meta.dir,'..'),env:diskEnv,stdout:'pipe',stderr:'pipe'});
    const [rotatingOut,rotatingErr,rotatingCode]=await Promise.all([new Response(rotating.stdout).text(),new Response(rotating.stderr).text(),rotating.exited]);afterCapability=undefined;
    expect(rotatingCode).toBe(1);expect(rotatingOut).toBe('');expect((await db.get<{n:string}>('SELECT count(*) n FROM vault_migrations WHERE tenant_id=$1',[otherTenant]))!.n).toBe('0');expect(rotatingOut+rotatingErr).not.toContain(token.token);expect(rotatingOut+rotatingErr).not.toContain(other.token);
    async function otherRequest(path:string,method='GET',body?:unknown){return fetch(`http://127.0.0.1:${server.port}/v1${path}`,{method,headers:{'x-api-key':other.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
    expect((await otherRequest('/secrets/get?key=fixture/key')).status).toBe(404);
    for(const [path,field] of [['/secrets','secrets'],['/secrets/search?q=fixture','results'],['/secrets/versions?key=fixture/key','versions'],['/secrets/versions?key=fixture/orphan','versions'],['/items','items'],['/items/search?q=fixture','results'],['/users','users']] as const) {
      const response=await otherRequest(path);expect(response.status).toBe(200);expect((await response.json())[field]).toEqual([]);
    }
    expect((await otherRequest('/secrets/versions/check?key=fixture/key&version=1')).status).toBe(404);
    expect((await otherRequest('/items/'+tables.vault_items[0]!.id)).status).toBe(404);
    const audit=await (await otherRequest('/audit')).json();expect(audit.entries.some((r:any)=>r.agent==='original-agent')).toBe(false);
    for(const key of ['fixture/key','fixture/orphan'])expect((await otherRequest('/secrets','POST',{key,value:'foreign-write'})).ok).toBe(false);
    expect((await otherRequest('/secrets/restore','POST',{key:'fixture/key',version:1,reason:'fixture',expected_current_version:1})).ok).toBe(false);
    expect((await otherRequest('/users','POST',{id:tables.users[0]!.id,name:'foreign-user'})).ok).toBe(false);
    expect((await otherRequest('/items','POST',{id:tables.vault_items[0]!.id,kind:'secure_note',title:'foreign',data:{body:'foreign'}})).ok).toBe(false);
    expect((await otherRequest('/secrets?key=fixture/key','DELETE')).status).toBe(404);
    expect((await otherRequest('/items/'+tables.vault_items[0]!.id,'DELETE')).status).toBe(404);
    expect((await otherRequest('/users/'+tables.users[0]!.id,'DELETE')).status).toBe(404);
    expect((await importVault(runtimeDb,a,input)).verified).toBe(true);
    await expect(importVault(runtimeDb,{tenantId:otherTenant,kid:other.kid},input)).rejects.toThrow('migration_destination_changed');
    // No-context SQL through the serving role sees no other tenant rows.
    expect((await runtimeDb.many('SELECT * FROM secrets'))).toEqual([]);
    expect((await runtimeDb.many('SELECT * FROM secret_versions'))).toEqual([]);
    const foreignPost=await fetch(`http://127.0.0.1:${server.port}/v1/migrations/vault`,{method:'POST',headers:{'x-api-key':other.token,'x-secrets-migration-tenant':tenant,'x-secrets-migration-kid':token.kid,'Content-Type':'application/json'},body:'invalid JSON must not be parsed'});expect(foreignPost.status).toBe(403);expect((await foreignPost.json()).error).toBe('migration_destination_changed');
    // Later ordinary writes must retain every imported history version.
    await db.execute("UPDATE secret_versions SET created_at='2000-01-01' WHERE key='fixture/key'");
    await tenantStore(runtimeDb,tenant,token.kid,['secrets:write']).setSecret('fixture/key','next-synthetic','other',undefined,undefined,'fixture',tenant);
    await tenantStore(runtimeDb,tenant,token.kid,['secrets:write']).pruneVersionHistory();
    expect((await db.get<{n:string}>("SELECT count(*) n FROM secret_versions WHERE key='fixture/key'"))!.n).toBe('2');
    await db.execute('UPDATE secret_versions SET created_at=$1 WHERE key=$2 AND version=1',[when,'fixture/key']);
    // Restore current secret metadata so the subsequent changed-feedback check is isolated.
    await db.execute('UPDATE secrets SET value=$1,updated_at=$2 WHERE key=$3',[(await import('../src/server/cloud-crypto.js')).encryptValue('synthetic-current'),when,'fixture/key']);
  } finally {server.stop(true);rmSync(dir,{recursive:true,force:true});}
  await db.execute("UPDATE feedback SET message='changed' WHERE tenant_id=$1",[tenant]);
  await expect(importVault(runtimeDb,a,input)).rejects.toThrow('migration_readback_conflict');
  await db.execute("UPDATE tenants SET status='suspended' WHERE id=$1",[tenant]);
  await expect(migrationCapability(runtimeDb,a)).rejects.toThrow('migration_authority_changed');
 } finally {
  await servicePool?.end();await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.query(`DROP ROLE IF EXISTS ${role}`);await admin.end();
  if(saved===undefined)delete process.env.HASNA_SECRETS_MASTER_KEY;else process.env.HASNA_SECRETS_MASTER_KEY=saved;_resetCloudMasterKey();
 }
},30000);
