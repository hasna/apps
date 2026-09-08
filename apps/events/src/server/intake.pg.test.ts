import { expect, test } from "bun:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createIntakeMcpServer } from "../mcp/intake.js";
import { ApiKeyStore, mintApiKey } from "@hasna/contracts/auth";
import { createIntakeClient, prepareIntake, type IntakeRequest } from "../intake/client.js";
import { initializeIntake, bindProducer, grantProducerKey, revokeProducerAccess } from "./intake-admin.js";
import { IntakePostgres, authQueries, tenantTransaction } from "./intake-postgres.js";
import { createIntakeHandler, bindingHeaders } from "./intake-api.js";
import { migrateIntake, INTAKE_MIGRATIONS, REQUIRED_INTAKE_SCHEMA } from "./intake-migrations.js";

const dsn=process.env.EVENTS_TEST_DATABASE_URL;
const pgTest=dsn?test:test.skip;
async function fixture(run:(f:Awaited<ReturnType<typeof setup>>)=>Promise<void>, initialized=true, identities: {corpus_id?:string;source_authority_id?:string} = {}, legacySchema=false){const f=await setup(initialized,identities,legacySchema);try{await run(f);}finally{await f.close();}}
async function setup(initialized=true, identities: {corpus_id?:string;source_authority_id?:string} = {}, legacySchema=false){
  const parsed=new URL(dsn!);
  if (!["postgres:","postgresql:"].includes(parsed.protocol)||parsed.hostname!=="127.0.0.1"||parsed.username!=="events_test"||parsed.pathname!=="/events_test"||!parsed.port||parsed.search||parsed.hash||!["","events_test"].includes(parsed.password))throw new Error("Disposable Events test database required");
  const schema=`events_${randomUUID().replaceAll("-","")}`,role=`${schema}_runtime`;
  const admin=new Pool({connectionString:dsn,max:1});
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
  const owner=new Pool({connectionString:dsn,options:`-csearch_path=${schema}`,max:4});
  const sink=randomUUID(),authority=randomUUID(),tenant=randomUUID();
  if(legacySchema){
    await owner.query("CREATE TABLE events_intake_migrations(id TEXT PRIMARY KEY,sha256 TEXT NOT NULL)");
    for(const migration of INTAKE_MIGRATIONS.filter(m=>m.id!==REQUIRED_INTAKE_SCHEMA.id)){
      await owner.query(migration.sql);
      await owner.query("INSERT INTO events_intake_migrations VALUES($1,$2)",[migration.id,createHash("sha256").update(migration.sql).digest("hex")]);
    }
    await owner.query("INSERT INTO events_intake_identity(singleton,sink_id,authority_id,protocol) VALUES(TRUE,$1,$2,'hasna.events.intake.v1')",[sink,authority]);
  }else if(initialized)await initializeIntake(owner,sink,authority);else await migrateIntake(owner);
  const binding={sink_id:sink,producer_id:randomUUID(),corpus_id:randomUUID(),source_authority_id:randomUUID(),...identities};
  await bindProducer(owner,{producer_id:binding.producer_id,corpus_id:binding.corpus_id,source_authority_id:binding.source_authority_id,tenant_id:tenant,app:"conversations"});
  await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  // Deliberately broad fixture grants test trigger protections as well as RLS.
  await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
  const runtime=new Pool({connectionString:dsn,options:`-csearch_path=${schema} -crole=${role} -csynchronous_commit=off`,max:8});
  const store=new IntakePostgres(runtime,sink,authority);
  const keys=new ApiKeyStore(authQueries(owner)),secret=randomBytes(32);
  async function issue(tid:string|null=tenant,scopes=["events:intake","events:receipts"],grant=true){
    const minted=mintApiKey({app:"events",...(tid?{tid}:{}),scopes,signingSecret:secret});await keys.insertMinted(minted);
    if(grant&&tid===tenant)await grantProducerKey(owner,tenant,binding.producer_id,minted.kid);
    return minted;
  }
  const key=await issue();
  const servers:ReturnType<typeof Bun.serve>[]=[];
  const start=()=>{const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:createIntakeHandler(store,secret)});servers.push(server);return server;};
  const server=start();
  const request=prepareIntake(binding,{id:"conversations:message:fixture:created",dedupeKey:"conversations:message:fixture:created",source:"conversations",type:"conversations.message.created",time:"2026-09-08T00:00:00.000Z",severity:"info",data:{message_id:"fixture",preview:"synthetic content"},metadata:{app_event:{action:"created"}},schemaVersion:"1.0"});
  const headers=(token=key.token,t=tenant)=>({...bindingHeaders(binding),"x-events-tenant-id":t,"x-api-key":token,"content-type":"application/json"});
  const post=(r:unknown=request,token=key.token,extra:Record<string,string>={})=>fetch(new URL("/v1/intake/events",server.url),{method:"POST",headers:{...headers(token),...extra},body:JSON.stringify(r)});
  const count=async()=>Number((await owner.query("SELECT count(*) FROM events_intake_records")).rows[0].count);
  return {schema,role,owner,runtime,store,binding,tenant,authority,keys,key,issue,request,headers,post,count,server,start,
    async close(){for(const s of servers)s.stop(true);await runtime.end();await owner.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.query(`DROP ROLE ${role}`);await admin.end();}};
}

pgTest("owner initialization is explicit and immutable; runtime cannot adopt a sink or mutate identities",()=>fixture(async f=>{
  await f.store.ready();
  await expect(initializeIntake(f.runtime,f.binding.sink_id,f.authority)).rejects.toThrow();
  await expect(initializeIntake(f.owner,randomUUID(),f.authority)).rejects.toThrow("immutable");
  await expect(f.runtime.query("UPDATE events_intake_identity SET authority_id=$1",[randomUUID()])).rejects.toThrow("immutable");
  await expect(f.runtime.query("TRUNCATE events_intake_records")).rejects.toThrow("immutable");
  await expect(new IntakePostgres(f.owner,f.binding.sink_id,f.authority).ready()).rejects.toThrow("runtime_role");
  await expect(new IntakePostgres(f.runtime,randomUUID(),f.authority).ready()).rejects.toThrow("not_initialized");
  await f.owner.query(`GRANT events_test TO ${f.role}`);
  try { await expect(f.store.ready()).rejects.toThrow("runtime_role"); } finally { await f.owner.query(`REVOKE events_test FROM ${f.role}`); }
  await f.owner.query(`ALTER TABLE api_keys OWNER TO ${f.role}`);
  try { await expect(f.store.ready()).rejects.toThrow("runtime_role"); } finally { await f.owner.query("ALTER TABLE api_keys OWNER TO events_test"); }
}),30000);

pgTest("actual signed HTTP intake commits exact canonical bytes and replays one immutable receipt",()=>fixture(async f=>{
  const response=await f.post();expect(response.status).toBe(201);const receipt=await response.json();
  expect(receipt.status).toBe("accepted_durable");expect(receipt.envelope_sha256).toBe(f.request.envelope_sha256);
  expect(await (await f.post()).json()).toEqual(receipt);expect(await f.count()).toBe(1);
  expect((await f.owner.query("SELECT envelope_json FROM events_intake_records")).rows[0].envelope_json).toBe(f.request.envelope_json);
  const raw=JSON.stringify(receipt);expect(raw).not.toContain("synthetic content");expect(raw).not.toContain(f.key.token);expect(raw).not.toContain("envelope_json");
  await expect(f.runtime.query("UPDATE events_intake_records SET envelope_json='{}'")).rejects.toThrow("immutable");
}),30000);

pgTest("wrong or missing tenants, scopes, grants, corpus, authority and source fail before persistence",()=>fixture(async f=>{
  for(const token of [(await f.issue(null,undefined,false)).token,(await f.issue(randomUUID(),undefined,false)).token,(await f.issue(f.tenant,["events:receipts"])).token,(await f.issue(f.tenant,undefined,false)).token])expect((await f.post(f.request,token)).status).toBeOneOf([401,403]);
  for(const k of ["sink_id","producer_id","corpus_id","source_authority_id"] as const){const changed={...f.request,[k]:randomUUID()};expect((await f.post(changed,f.key.token,bindingHeaders(changed))).status).toBeOneOf([403,409]);}
  const envelope=JSON.parse(f.request.envelope_json);envelope.source="other";expect((await f.post(prepareIntake(f.binding,envelope))).status).toBe(403);
  expect(await f.count()).toBe(0);
}),30000);

pgTest("revoked registered keys and revoked producer grants deny historical receipt replay",()=>fixture(async f=>{
  expect((await f.post()).status).toBe(201);
  const rotated=await f.issue();expect((await f.post(f.request,rotated.token)).status).toBe(201);
  await f.owner.query("UPDATE api_keys SET revoked_at=clock_timestamp() WHERE kid=$1",[f.key.kid]);
  expect((await f.post()).status).toBe(401);
  await revokeProducerAccess(f.owner,f.tenant,f.binding.producer_id,rotated.kid);
  expect((await f.post(f.request,rotated.token)).status).toBe(403);
  const third=await f.issue();await revokeProducerAccess(f.owner,f.tenant,f.binding.producer_id);
  expect((await f.post(f.request,third.token)).status).toBe(403);expect(await f.count()).toBe(1);
}),30000);

pgTest("non-owner FORCE RLS isolates direct SQL across tenants and pooled transaction reuse",()=>fixture(async f=>{
  await f.post();expect((await f.runtime.query("SELECT * FROM events_intake_records")).rows).toEqual([]);
  expect(await tenantTransaction(f.runtime,randomUUID(),async c=>(await c.query("SELECT * FROM events_intake_records")).rows)).toEqual([]);
  expect(await tenantTransaction(f.runtime,f.tenant,async c=>(await c.query("SELECT * FROM events_intake_records")).rows.length)).toBe(1);
  expect((await f.runtime.query("SELECT * FROM events_intake_records")).rows).toEqual([]);
  await expect(tenantTransaction(f.runtime,f.tenant,async c=>{await c.query("UPDATE events_producer_bindings SET active=FALSE,generation=generation+1");})).rejects.toThrow("owner role");
  await expect(f.runtime.query("UPDATE api_keys SET tid=$1",[randomUUID()])).rejects.toThrow("owner role");
  const flags=(await f.owner.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relname IN ('events_producer_bindings','events_producer_key_grants','events_intake_records')")).rows;
  expect(flags).toHaveLength(3);expect(flags.every(r=>r.relrowsecurity&&r.relforcerowsecurity)).toBe(true);
}),30000);

pgTest("concurrent duplicates converge and either unique identity rejects different immutable content",()=>fixture(async f=>{
  const responses=await Promise.all(Array.from({length:8},()=>f.post()));expect(responses.every(r=>r.status===201)).toBe(true);
  const receipts=await Promise.all(responses.map(r=>r.json()));expect(new Set(receipts.map(r=>r.receipt_id)).size).toBe(1);
  for(const patch of [{message:"changed"},{id:"other-id"},{dedupeKey:"other-key"}]){
    const changed=prepareIntake(f.binding,{...JSON.parse(f.request.envelope_json),...patch});expect((await f.post(changed)).status).toBe(409);
  }expect(await f.count()).toBe(1);
}),30000);

pgTest("a failed COMMIT never yields durable acceptance and leaves no record",()=>fixture(async f=>{
  await f.owner.query("CREATE FUNCTION fail_intake_commit() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic commit failure'; END $$; CREATE CONSTRAINT TRIGGER fail_at_commit AFTER INSERT ON events_intake_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_intake_commit()");
  const result=await f.post();expect(result.status).toBe(503);expect(await result.json()).toEqual({error:"intake_unavailable"});expect(await f.count()).toBe(0);
}),30000);

pgTest("revocation holding the grant lock fences an already authenticated request",()=>fixture(async f=>{
  const connection=await f.owner.connect();
  try{
    await connection.query("BEGIN");await connection.query("UPDATE events_producer_key_grants SET active=FALSE,generation=generation+1 WHERE kid=$1",[f.key.kid]);
    const pending=f.post();
    // Wait for the real runtime query to block on this transaction's lock.
    for(let n=0;n<100;n++){const waiting=await f.owner.query("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT kid FROM events_producer_key_grants%' AND pid<>pg_backend_pid()");if(Number(waiting.rows[0].count)>0)break;if(n===99)throw new Error("runtime did not reach the locked grant");await Bun.sleep(10);}
    await connection.query("COMMIT");expect((await pending).status).toBe(403);expect(await f.count()).toBe(0);
  }finally{await connection.query("ROLLBACK");connection.release();}
}),30000);

pgTest("restart readback uses the same durable receipt through the real shared API client",()=>fixture(async f=>{
  const env={HASNA_EVENTS_API_URL:f.server.url.origin,HASNA_EVENTS_API_KEY:f.key.token,HASNA_STATION:`intake-${randomUUID()}`};
  const client=createIntakeClient({env,binding:f.binding,tenantId:f.tenant});await client.capability();const accepted=await client.accept(f.request);
  f.server.stop(true);const server=f.start();env.HASNA_EVENTS_API_URL=server.url.origin;
  const restarted=createIntakeClient({env,binding:f.binding,tenantId:f.tenant});expect(await restarted.receipt(f.request)).toEqual(accepted);
  env.HASNA_EVENTS_API_KEY=(await f.issue(randomUUID(),undefined,false)).token;
  await expect(restarted.accept(f.request)).rejects.toThrow();expect(await f.count()).toBe(1);
}),30000);

pgTest("malformed, sensitive, noncanonical or mismatched envelopes never alter intake state",()=>fixture(async f=>{
  for(const patch of [{envelope_sha256:"0".repeat(64)},{envelope_json:` ${f.request.envelope_json}`},{event_id:"wrong"},{tenant_id:f.tenant},{envelope_json:'{"id":"one","id":"two"}'}])expect((await f.post({...f.request,...patch})).status).toBe(400);
  const sensitive={...JSON.parse(f.request.envelope_json),data:{password:"synthetic-only"}};
  const text=JSON.stringify(sensitive);expect((await f.post({...f.request,envelope_json:text})).status).toBe(400);
  expect(await f.count()).toBe(0);
}),30000);

pgTest("uninitialized database never adopts the first authenticated producer",()=>fixture(async f=>{
  expect((await fetch(`${f.server.url.origin}/ready`)).status).toBe(503);
  expect((await f.post()).status).toBe(503);
  expect((await f.owner.query("SELECT * FROM events_intake_identity")).rows).toEqual([]);
  expect(await f.count()).toBe(0);
  await initializeIntake(f.owner,f.binding.sink_id,f.authority);
  expect((await f.post()).status).toBe(201);
},false),30000);

pgTest("durable acceptance overrides asynchronous session commits before writing the record",()=>fixture(async f=>{
  expect((await f.runtime.query("SHOW synchronous_commit")).rows[0].synchronous_commit).toBe("off");
  await f.owner.query("CREATE FUNCTION require_synced_intake() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF current_setting('synchronous_commit')<>'on' THEN RAISE EXCEPTION 'asynchronous commit refused'; END IF; RETURN NEW; END $$; CREATE TRIGGER require_synced_intake BEFORE INSERT ON events_intake_records FOR EACH ROW EXECUTE FUNCTION require_synced_intake()");
  expect((await f.post()).status).toBe(201);expect(await f.count()).toBe(1);
  expect((await f.runtime.query("SHOW synchronous_commit")).rows[0].synchronous_commit).toBe("off");
}),30000);

pgTest("actual MCP tool calls use authenticated HTTP and preserve only verified durable receipts",()=>fixture(async f=>{
  const mcp=createIntakeMcpServer({HASNA_EVENTS_API_URL:f.server.url.origin,HASNA_EVENTS_API_KEY:f.key.token});
  const client=new Client({name:"synthetic-intake-test",version:"1"});
  const [a,b]=InMemoryTransport.createLinkedPair();await mcp.connect(a);await client.connect(b);
  try{
    const args={...f.binding,tenant_id:f.tenant};
    const listed=await client.listTools();expect(listed.tools.map(t=>t.name).sort()).toEqual(["events_intake_accept","events_intake_capability","events_intake_receipt"]);
    expect((await client.callTool({name:"events_intake_capability",arguments:args})).isError).not.toBe(true);
    const accepted=await client.callTool({name:"events_intake_accept",arguments:{...args,request:f.request}});
    expect(accepted.isError).not.toBe(true);
    const read=await client.callTool({name:"events_intake_receipt",arguments:{...args,request:f.request}});expect(read.content).toEqual(accepted.content);
    expect(JSON.stringify(accepted)).toContain("accepted_durable");expect(JSON.stringify(accepted)).not.toContain("synthetic content");
    await revokeProducerAccess(f.owner,f.tenant,f.binding.producer_id,f.key.kid);
    const refused=await client.callTool({name:"events_intake_accept",arguments:{...args,request:f.request}});
    expect(refused.isError).toBe(true);expect(JSON.stringify(refused)).toContain("unconfirmed");expect(JSON.stringify(refused)).not.toContain(f.key.token);expect(await f.count()).toBe(1);
  }finally{await client.close();await mcp.close();}
},true,{corpus_id:"cor_0123456789abcdef0123456789abcdef",source_authority_id:"Conversations:primary.authority-1"}),30000);

pgTest("fresh CLI consumes saved API configuration and a frozen stdin request without creating local data",()=>fixture(async f=>{
  const home=mkdtempSync(join(tmpdir(),"events-intake-cli-"));
  try{
    const config=join(home,".hasna","events","config");mkdirSync(config,{recursive:true});
    writeFileSync(join(config,"credentials"),`HASNA_EVENTS_API_KEY=${f.key.token}\nHASNA_EVENTS_API_URL=${f.server.url.origin}\n`,{mode:0o600});
    const env={PATH:process.env.PATH!,HOME:home,HASNA_HOME:join(home,".hasna"),HASNA_STATION:`fixture-${randomUUID()}`,TMPDIR:tmpdir()};
    const selectors=["--tenant-id",f.tenant,"--sink-id",f.binding.sink_id,"--producer-id",f.binding.producer_id,"--corpus-id",f.binding.corpus_id,"--source-authority-id",f.binding.source_authority_id];
    const child=Bun.spawn([process.execPath,"--no-env-file",join(import.meta.dir,"../cli/index.ts"),"intake","accept",...selectors],{env,stdin:new Blob([JSON.stringify(f.request)]),stdout:"pipe",stderr:"pipe"});
    const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    expect(exit,stderr).toBe(0);expect(JSON.parse(stdout).status).toBe("accepted_durable");expect(stdout+stderr).not.toContain(f.key.token);
    expect(readdirSync(config)).toEqual(["credentials"]);expect(readdirSync(join(home,".hasna","events"))).toEqual(["config"]);expect(await f.count()).toBe(1);
  }finally{rmSync(home,{recursive:true,force:true});}
},true,{corpus_id:"cor_0123456789abcdef0123456789abcdef",source_authority_id:"Conversations:primary.authority-1"}),30000);

pgTest("client freezes the reviewed request across asynchronous credential dispatch",()=>fixture(async f=>{
  const client=createIntakeClient({env:{HASNA_EVENTS_API_URL:f.server.url.origin,HASNA_EVENTS_API_KEY:f.key.token},binding:f.binding,tenantId:f.tenant});
  const mutable={...f.request};const pending=client.accept(mutable);
  Object.assign(mutable,prepareIntake(f.binding,{...JSON.parse(f.request.envelope_json),message:"changed after dispatch began"}));
  const receipt=await pending;expect(receipt.envelope_sha256).toBe(f.request.envelope_sha256);
  expect((await f.owner.query("SELECT envelope_json FROM events_intake_records")).rows[0].envelope_json).toBe(f.request.envelope_json);
  expect(await f.count()).toBe(1);
}),30000);

pgTest("opaque Conversations corpus and source authority survive signed HTTP acceptance, restart and exact replay",()=>fixture(async f=>{
  await f.store.ready();
  const first=await f.post();expect(first.status).toBe(201);
  const receipt=await first.json();
  expect(receipt).toMatchObject({corpus_id:"cor_0123456789abcdef0123456789abcdef",source_authority_id:"Conversations:primary.authority-1"});
  const restarted=f.start();
  const client=createIntakeClient({binding:f.binding,tenantId:f.tenant,env:{HASNA_EVENTS_API_URL:restarted.url.origin,HASNA_EVENTS_API_KEY_OVERRIDE:f.key.token}});
  expect(await client.receipt(f.request)).toEqual(receipt);
  expect(await client.accept(f.request)).toEqual(receipt);expect(await f.count()).toBe(1);
  const stored=(await f.owner.query("SELECT corpus_id,source_authority_id FROM events_producer_bindings")).rows[0];
  expect(stored).toEqual({corpus_id:f.binding.corpus_id,source_authority_id:f.binding.source_authority_id});
  const changed={...f.request,source_authority_id:"conversations:primary.authority-1"};
  expect((await f.post(changed,f.key.token,{"x-events-source-authority-id":changed.source_authority_id})).status).toBe(403);
  for(const value of [" cor_a","cor_a ","cor/a","a".repeat(129)])
    await expect(bindProducer(f.owner,{producer_id:randomUUID(),tenant_id:f.tenant,app:"conversations",corpus_id:value,source_authority_id:"authority"})).rejects.toThrow("source_identity");
},true,{corpus_id:"cor_0123456789abcdef0123456789abcdef",source_authority_id:"Conversations:primary.authority-1"}),30000);

pgTest("migration 0002 is required and preserves existing UUID bindings, payloads and receipts",()=>fixture(async f=>{
  await expect(f.store.ready()).rejects.toThrow("schema_upgrade_required");
  expect((await f.post()).status).toBe(503);
  const receiptId=randomUUID();
  await f.owner.query("INSERT INTO events_intake_records(tenant_id,producer_id,event_id,dedupe_key,envelope_sha256,envelope_json,receipt_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [f.tenant,f.binding.producer_id,f.request.event_id,f.request.dedupe_key,f.request.envelope_sha256,f.request.envelope_json,receiptId]);
  const before=(await f.owner.query("SELECT * FROM events_intake_records")).rows;
  const bindingBefore=(await f.owner.query("SELECT * FROM events_producer_bindings")).rows;
  const ledgerBefore=(await f.owner.query("SELECT * FROM events_intake_migrations ORDER BY id")).rows;
  await migrateIntake(f.owner);await f.store.ready();
  expect((await f.owner.query("SELECT * FROM events_intake_records")).rows).toEqual(before);
  expect((await f.owner.query("SELECT * FROM events_producer_bindings")).rows).toEqual(bindingBefore);
  expect((await f.owner.query("SELECT * FROM events_intake_migrations WHERE id<>$1 ORDER BY id",[REQUIRED_INTAKE_SCHEMA.id])).rows).toEqual(ledgerBefore);
  expect((await (await f.post()).json()).receipt_id).toBe(receiptId);
  await f.owner.query("UPDATE events_intake_migrations SET sha256=$1 WHERE id=$2",["0".repeat(64),REQUIRED_INTAKE_SCHEMA.id]);
  await expect(f.store.ready()).rejects.toThrow("schema_upgrade_required");
  await f.owner.query("UPDATE events_intake_migrations SET sha256=$1 WHERE id=$2",[REQUIRED_INTAKE_SCHEMA.sha256,REQUIRED_INTAKE_SCHEMA.id]);
  await f.owner.query("ALTER TABLE events_producer_bindings ALTER COLUMN corpus_id TYPE VARCHAR(128)");
  await expect(f.store.ready()).rejects.toThrow("schema_upgrade_required");
},true,{},true),30000);
