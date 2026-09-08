import { expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { ApiKeyStore, mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { createQueryClient } from "../generated/storage-kit/query.js";
import { PG_MIGRATIONS } from "../lib/pg-migrations.js";
import { buildConversationEventEnvelope, MESSAGE_CREATED_TYPE } from "../lib/events-bridge.js";
import { adoptCorpus, inspectCorpus, readCorpusBinding } from "./corpus-binding.js";
import { appendEventIntent, EventsOutboxStore } from "./events-outbox-store.js";
import { resolveEventsIntake } from "./events-intake-client.js";
import { drainServerEventOutbox } from "./events-outbox-pg.js";
import { redactMessagesPg } from "./admin-redaction-pg.js";
import { startApiServer } from "./api.js";
import { ConversationsClient } from "../sdk/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { assertNoClientDatabase } from "../lib/store/test-support/loopback-api-fixture.js";

const dsn = process.env.CONVERSATIONS_TEST_DATABASE_URL;
const pgTest = dsn ? test : test.skip;
// Fixture-only source imports exercise the actual sink implementation. Production
// imports only the reviewed package ./intake API; no sink source is vendored.
const sinkModule = (name: string) => import(new URL(`../../../events/src/server/${name}.ts`,import.meta.url).pathname);

async function fixture(run:(f:Awaited<ReturnType<typeof setup>>)=>Promise<void>) {
  const f=await setup(); try { await run(f); } finally { await f.close(); }
}
async function setup() {
  const {validateTestDatabaseUrl}=await import(new URL("../../scripts/live-postgres-test.ts",import.meta.url).pathname);
  validateTestDatabaseUrl(dsn);
  const suffix=randomUUID().replaceAll("-","");
  const sourceSchema=`delivery_source_${suffix}`,sinkSchema=`delivery_sink_${suffix}`;
  const sourceRole=`ds_${suffix}`,sinkRole=`dk_${suffix}`;
  const admin=new Pool({connectionString:dsn,max:1});
  const pools:Pool[]=[];
  const servers:ReturnType<typeof Bun.serve>[]=[];
  const home=mkdtempSync(join(tmpdir(),"conversations-intake-fixture-"));
  const close=async()=>{
    for(const s of servers)s.stop(true);
    await Promise.all(pools.map(p=>p.end()));
    await admin.query(`DROP SCHEMA IF EXISTS ${sourceSchema} CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS ${sinkSchema} CASCADE`);
    await admin.query(`DROP ROLE IF EXISTS ${sourceRole}`);
    await admin.query(`DROP ROLE IF EXISTS ${sinkRole}`);
    await admin.end();rmSync(home,{recursive:true,force:true});
  };
  try {
    for(const [schema,role] of [[sourceSchema,sourceRole],[sinkSchema,sinkRole]]) {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    }
    const connect=(schema:string,role?:string)=>{
      const p=new Pool({connectionString:dsn,options:`-csearch_path=${schema}${role?` -crole=${role}`:""}`,max:6});
      pools.push(p);return p;
    };
    const ownerPool=connect(sourceSchema),sinkOwner=connect(sinkSchema);
    const owner=createQueryClient(ownerPool);
    for(const migration of PG_MIGRATIONS)await owner.execute(migration);
    const sourceKeys=new ApiKeyStore(owner);await sourceKeys.ensureSchema();
    const source=await adoptCorpus(owner,{...await inspectCorpus(owner),tenant_id:randomUUID(),authority_id:"authority:Conversations_fixture.v1",actor:"fixture-owner"});
    const sinkAdmin=await sinkModule("intake-admin");
    const sinkStoreModule=await sinkModule("intake-postgres");
    const sinkId=randomUUID(),producerId=randomUUID(),sinkAuthority=randomUUID();
    await sinkAdmin.initializeIntake(sinkOwner,sinkId,sinkAuthority);
    await sinkAdmin.bindProducer(sinkOwner,{producer_id:producerId,tenant_id:source.tenant_id,app:"conversations",corpus_id:source.corpus_id,source_authority_id:source.authority_id});
    for(const [schema,role] of [[sourceSchema,sourceRole],[sinkSchema,sinkRole]]) {
      await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
      await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
      await admin.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
    }
    const runtime=createQueryClient(connect(sourceSchema,sourceRole));
    const sinkRuntime=connect(sinkSchema,sinkRole);
    const sinkStore=new sinkStoreModule.IntakePostgres(sinkRuntime,sinkId,sinkAuthority);
    await sinkStore.ready();
    const sinkSecret=randomBytes(32),sourceSecret=randomBytes(32);
    const sinkKeys=new ApiKeyStore(sinkStoreModule.authQueries(sinkOwner));
    const issueSink=async()=>{
      const key=mintApiKey({app:"events",tid:source.tenant_id,scopes:["events:intake","events:receipts"],signingSecret:sinkSecret});
      await sinkKeys.insertMinted(key);
      await sinkAdmin.grantProducerKey(sinkOwner,source.tenant_id,producerId,key.kid);return key;
    };
    const sinkKey=await issueSink();
    const sinkApi=await sinkModule("intake-api");
    const sinkServer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:sinkApi.createIntakeHandler(sinkStore,sinkSecret)});
    servers.push(sinkServer);
    const env:Record<string,string|undefined>={HOME:home,HASNA_HOME:join(home,".hasna"),HASNA_STATION:randomUUID(),
      HASNA_EVENTS_API_KEY_OVERRIDE:sinkKey.token,HASNA_EVENTS_API_URL:sinkServer.url.origin,
      HASNA_CONVERSATIONS_EVENTS_SINK_ID:sinkId,HASNA_CONVERSATIONS_EVENTS_PRODUCER_ID:producerId};
    const resolve=()=>resolveEventsIntake(source,env);
    const store=new EventsOutboxStore(runtime,source);await store.ready();
    const authorizeSource=()=>readCorpusBinding(runtime);
    const drain=()=>drainServerEventOutbox(runtime,20,{signal:new AbortController().signal,authorizeSource,resolveIntake:resolve});
    const append=async(id=randomUUID())=>{
      const envelope=buildConversationEventEnvelope({id:`conversations:message:${id}:created`,type:MESSAGE_CREATED_TYPE,
        time:new Date().toISOString(),data:{uuid:id,content_preview:"synthetic message"},appEvent:{kind:"message.created"}});
      await runtime.transaction(tx=>appendEventIntent(tx,envelope));return envelope;
    };
    const issueSource=async(tid:string|null=source.tenant_id,scopes=["conversations:events-drain"])=>{
      const key=mintApiKey({app:"conversations",...(tid?{tid}:{}),agent:"fixture-agent",scopes,signingSecret:sourceSecret});
      await sourceKeys.insertMinted(key);return key;
    };
    const sourceVerifier=verifyApiKey({app:"conversations",signingSecret:sourceSecret,keyStatus:sourceKeys.keyStatus});
    const sourceServer=startApiServer({host:"127.0.0.1",port:0,deps:{client:runtime,keys:new ApiKeyStore(runtime),
      verifier:sourceVerifier,eventsIntake:resolve}});
    servers.push(sourceServer);
    const sinkCount=async()=>Number((await sinkOwner.query("SELECT COUNT(*) count FROM events_intake_records")).rows[0].count);
    return {owner,ownerPool,runtime,source,store,append,drain,resolve,authorizeSource,env,home,sinkOwner,sinkRuntime,sinkKey,sinkKeys,issueSink,
      issueSource,sourceServer,sourceVerifier,sinkCount,close};
  }catch(error){await close();throw error;}
}

pgTest("new source capture is transactional and freezes persisted ownership without local files",()=>fixture(async f=>{
  await expect(f.runtime.transaction(async tx=>{
    await appendEventIntent(tx,buildConversationEventEnvelope({id:"rollback",type:MESSAGE_CREATED_TYPE,time:new Date().toISOString(),data:{}}));
    throw new Error("synthetic rollback");
  })).rejects.toThrow("synthetic rollback");
  expect(await f.owner.many("SELECT * FROM conversations_event_outbox")).toEqual([]);
  const e=await f.append();
  const d=await f.owner.one("SELECT * FROM conversations_event_deliveries WHERE outbox_id=$1",[e.id]);
  expect(d).toMatchObject({tenant_id:f.source.tenant_id,corpus_id:f.source.corpus_id,authority_id:f.source.authority_id,state:"pending",sink_id:null});
  expect(await f.drain()).toMatchObject({accepted:1,transported:1,spooled:0,retryable:0});
  expect(await f.sinkCount()).toBe(1);
  expect(readdirSync(f.home)).toEqual([]);
}),30000);

pgTest("competing workers claim once and expired claim completion cannot acknowledge a successor",()=>fixture(async f=>{
  await f.append();
  const target=f.resolve().target;
  const claims=await Promise.all([f.store.claim(target,30_000),f.store.claim(target,30_000)]);
  const claim=claims.find(c=>c!==null)!;expect(claim).not.toBe("quarantined");
  expect(claims.filter(Boolean)).toHaveLength(1);
  if(typeof claim!=="object")throw new Error("expected claim");
  await f.owner.execute("UPDATE conversations_event_deliveries SET lease_until=clock_timestamp()-interval '1 second' WHERE outbox_id=$1",[claim.id]);
  const replacement=await f.store.claim(target,30_000);
  if(!replacement||typeof replacement!=="object")throw new Error("expected replacement claim");
  expect(replacement.generation).not.toBe(claim.generation);
  expect(await f.store.beforeDispatch(claim,target)).toBe(false);
  expect(await f.store.beforeDispatch(replacement,target)).toBe(true);
  const receipt=await f.resolve().client.accept(replacement.request);
  expect(await f.store.complete(claim,receipt)).toBe(false);
  expect(await f.store.complete(replacement,receipt)).toBe(true);
  expect(await f.sinkCount()).toBe(1);
}),30000);

pgTest("lost response is reconciled under rotated authorized credentials without duplicate acceptance",()=>fixture(async f=>{
  await f.append();
  const lost=await drainServerEventOutbox(f.runtime,1,{signal:new AbortController().signal,authorizeSource:f.authorizeSource,
    resolveIntake:()=>{const r=f.resolve();return {...r,client:{...r.client,accept:async(...args:Parameters<typeof r.client.accept>)=>{
      await r.client.accept(...args);throw new Error("synthetic lost response");
    }}};}});
  expect(lost).toMatchObject({accepted:0,retryable:1});expect(await f.sinkCount()).toBe(1);
  const rotated=await f.issueSink();f.env.HASNA_EVENTS_API_KEY_OVERRIDE=rotated.token;
  await f.sinkKeys.revoke(f.sinkKey.kid);
  await f.owner.execute("UPDATE conversations_event_deliveries SET next_attempt_at=clock_timestamp()");
  expect(await f.drain()).toMatchObject({accepted:1,retryable:0});expect(await f.sinkCount()).toBe(1);
  const row=await f.owner.one("SELECT receipt,attempts FROM conversations_event_deliveries");
  expect(row.attempts).toBe(2);expect(row.receipt.status).toBe("accepted_durable");
}),30000);

pgTest("dedicated source scope and tenant are required before drain or sink dispatch",()=>fixture(async f=>{
  await f.append();
  for(const key of [await f.issueSource(null),await f.issueSource(randomUUID()),await f.issueSource(f.source.tenant_id,["conversations:write"])]) {
    const r=await fetch(new URL("/v1/events/outbox/drain",f.sourceServer.url),{method:"POST",headers:{"x-api-key":key.token}});
    expect(r.status).toBe(403);
  }
  expect(await f.sinkCount()).toBe(0);
  expect((await f.owner.one("SELECT attempts FROM conversations_event_deliveries")).attempts).toBe(0);
  const key=await f.issueSource();
  const r=await fetch(new URL("/v1/events/outbox/drain",f.sourceServer.url),{method:"POST",headers:{"x-api-key":key.token}});
  expect(r.status).toBe(200);expect(await r.json()).toMatchObject({accepted:1,spooled:0});
}),30000);

pgTest("redaction fences an active claim and audits an accepted remote copy without claiming erasure",()=>fixture(async f=>{
  const e=await f.append();
  const message=await f.owner.one<{id:number}>("INSERT INTO messages(uuid,session_id,from_agent,to_agent,content) VALUES($1,'fixture','alice','bob','synthetic message') RETURNING id",[e.data.uuid]);
  const before=await f.owner.one("SELECT envelope_sha256 FROM conversations_event_deliveries");
  let report:Awaited<ReturnType<typeof redactMessagesPg>>|undefined;
  const result=await drainServerEventOutbox(f.runtime,1,{signal:new AbortController().signal,authorizeSource:f.authorizeSource,
    resolveIntake:()=>{const r=f.resolve();return {...r,client:{...r.client,accept:async(...args:Parameters<typeof r.client.accept>)=>{
      const receipt=await r.client.accept(...args);
      report=await f.runtime.transaction(tx=>redactMessagesPg(tx,{ids:[Number(message.id)],actor:"fixture-agent",reason:"synthetic remediation",authority:"fixture-owner",apply:true,backupConfirmed:true,dryRunConfirmed:true}));
      return receipt;
    }}};}});
  expect(result).toMatchObject({accepted:0,lost_claim:1});expect(await f.sinkCount()).toBe(1);
  const row=await f.owner.one("SELECT * FROM conversations_event_deliveries");
  expect(row).toMatchObject({state:"quarantined",error_code:"payload_redacted",reconciliation_required:true,envelope_sha256:before.envelope_sha256,lease_token:null});
  expect(report!.messages[0]!.events_downstream_reconciliation![0]).toMatchObject({required:true,reason:"accepted_or_uncertain_copy",envelope_sha256:before.envelope_sha256});
  expect((await f.owner.one<{envelope_json:string}>("SELECT envelope_json FROM conversations_event_outbox")).envelope_json).not.toContain("synthetic message");
  expect((await f.sinkOwner.query("SELECT envelope_json FROM events_intake_records")).rows[0].envelope_json).toContain("synthetic message");
  const audit=await f.owner.one<{events_reconciliation_json:string}>("SELECT events_reconciliation_json FROM message_redaction_audit");
  expect(JSON.parse(audit.events_reconciliation_json)[0].required).toBe(true);
  expect(await f.drain()).toMatchObject({scanned:0,accepted:0});
}),30000);

pgTest("redaction before dispatch requires no downstream claim and preserves immutable accepted receipt history",()=>fixture(async f=>{
  const e=await f.append();
  const message=await f.owner.one<{id:number}>("INSERT INTO messages(uuid,session_id,from_agent,to_agent,content) VALUES($1,'fixture','alice','bob','synthetic message') RETURNING id",[e.data.uuid]);
  const claim=await f.store.claim(f.resolve().target,30_000);
  if(!claim||typeof claim!=="object")throw new Error("claim required");
  const options={ids:[Number(message.id)],actor:"fixture-agent",reason:"synthetic remediation",authority:"fixture-owner",apply:true,backupConfirmed:true,dryRunConfirmed:true};
  const report=await f.runtime.transaction(tx=>redactMessagesPg(tx,options));
  expect(report.messages[0]!.events_downstream_reconciliation![0]).toMatchObject({required:false,reason:"no_external_dispatch"});
  expect(await f.store.beforeDispatch(claim,f.resolve().target)).toBe(false);expect(await f.sinkCount()).toBe(0);
  const acceptedEvent=await f.append();
  const acceptedMessage=await f.owner.one<{id:number}>("INSERT INTO messages(uuid,session_id,from_agent,to_agent,content) VALUES($1,'fixture','alice','bob','synthetic message') RETURNING id",[acceptedEvent.data.uuid]);
  expect(await f.drain()).toMatchObject({accepted:1});
  const before=await f.owner.one("SELECT receipt FROM conversations_event_deliveries WHERE outbox_id=$1",[acceptedEvent.id]);
  const redacted=await f.runtime.transaction(tx=>redactMessagesPg(tx,{...options,ids:[Number(acceptedMessage.id)]}));
  const after=await f.owner.one("SELECT receipt,state,reconciliation_required FROM conversations_event_deliveries WHERE outbox_id=$1",[acceptedEvent.id]);
  expect(after).toMatchObject({receipt:before.receipt,state:"quarantined",reconciliation_required:true});
  expect(redacted.messages[0]!.events_downstream_reconciliation![0]!.receipt_id).toBe(before.receipt.receipt_id);
}),30000);

pgTest("legacy unbound rows stay unchanged and malformed new intents quarantine without HTTP",()=>fixture(async f=>{
  for(const status of ["pending","spooled","delivered","dead"])
    await f.owner.execute("INSERT INTO conversations_event_outbox(id,source,type,envelope_json,status) VALUES($1,'conversations','legacy','{}',$2)",[status,status]);
  const before=await f.owner.many("SELECT * FROM conversations_event_outbox ORDER BY id");
  expect(await f.drain()).toMatchObject({scanned:0,accepted:0});
  expect(await f.owner.many("SELECT * FROM conversations_event_outbox ORDER BY id")).toEqual(before);
  const envelope=buildConversationEventEnvelope({id:"invalid",type:MESSAGE_CREATED_TYPE,time:new Date().toISOString(),data:{password:"synthetic-forbidden-field"}});
  await f.runtime.transaction(tx=>appendEventIntent(tx,envelope));
  expect((await f.owner.one("SELECT state,error_code FROM conversations_event_deliveries")).state).toBe("quarantined");
  expect(await f.drain()).toMatchObject({scanned:0,accepted:0});expect(await f.sinkCount()).toBe(0);
}),30000);

pgTest("sink drift never rebinds a claimed intent and invalid receipts never acknowledge it",()=>fixture(async f=>{
  await f.append();
  const claim=await f.store.claim(f.resolve().target,30_000);
  if(!claim||typeof claim!=="object")throw new Error("claim required");
  expect(await f.store.beforeDispatch(claim,{...claim.target,producer_id:randomUUID()})).toBe(false);
  expect(await f.owner.one("SELECT state,producer_id,error_code FROM conversations_event_deliveries WHERE outbox_id=$1",[claim.id]))
    .toMatchObject({state:"quarantined",producer_id:claim.target.producer_id,error_code:"sink_changed"});
  await f.append();
  const bad=await drainServerEventOutbox(f.runtime,1,{signal:new AbortController().signal,authorizeSource:f.authorizeSource,
    resolveIntake:()=>{const r=f.resolve();return {...r,client:{...r.client,accept:async(...args:Parameters<typeof r.client.accept>)=>{
      const receipt=await r.client.accept(...args);return {...receipt,tenant_id:randomUUID()};
    }}};}});
  expect(bad).toMatchObject({accepted:0,retryable:1});expect(await f.sinkCount()).toBe(1);
  expect((await f.owner.one("SELECT receipt FROM conversations_event_deliveries WHERE state='retryable'")).receipt).toBeNull();
}),30000);

pgTest("receipt lookup miss rechecks redaction and cannot replay the old payload",()=>fixture(async f=>{
  const e=await f.append();
  const message=await f.owner.one<{id:number}>("INSERT INTO messages(uuid,session_id,from_agent,to_agent,content) VALUES($1,'fixture','alice','bob','synthetic message') RETURNING id",[e.data.uuid]);
  const first=await f.store.claim(f.resolve().target,30_000);
  if(!first||typeof first!=="object")throw new Error("claim required");
  await f.store.beforeDispatch(first,first.target);await f.store.retry(first);
  await f.owner.execute("UPDATE conversations_event_deliveries SET next_attempt_at=clock_timestamp()");
  let acceptCalls=0;
  const result=await drainServerEventOutbox(f.runtime,1,{signal:new AbortController().signal,authorizeSource:f.authorizeSource,
    resolveIntake:()=>{const r=f.resolve();return {...r,client:{...r.client,
      receipt:async(...args:Parameters<typeof r.client.receipt>)=>{
        try{return await r.client.receipt(...args);}catch(error){
          await f.runtime.transaction(tx=>redactMessagesPg(tx,{ids:[Number(message.id)],actor:"fixture-agent",reason:"synthetic remediation",authority:"fixture-owner",apply:true,backupConfirmed:true,dryRunConfirmed:true}));
          throw error;
        }
      },accept:async(...args:Parameters<typeof r.client.accept>)=>{acceptCalls++;return r.client.accept(...args);},
    }};}});
  expect(result).toMatchObject({accepted:0,lost_claim:1});expect(acceptCalls).toBe(0);expect(await f.sinkCount()).toBe(0);
  expect((await f.owner.one("SELECT state,reconciliation_required FROM conversations_event_deliveries"))).toMatchObject({state:"quarantined",reconciliation_required:true});
}),30000);

pgTest("runtime owner and foreign delivery writes are refused; receipt reads expose metadata only",()=>fixture(async f=>{
  await expect(new EventsOutboxStore(f.owner,f.source).ready()).rejects.toThrow("events_runtime_role_unsafe");
  const e=await f.append();
  await expect(f.runtime.execute("UPDATE conversations_event_deliveries SET tenant_id=$1 WHERE outbox_id=$2",[randomUUID(),e.id])).rejects.toThrow();
  await f.owner.execute("INSERT INTO conversations_event_outbox(id,source,type,envelope_json,status) VALUES('foreign','conversations','legacy','{}','pending')");
  await expect(f.runtime.execute("INSERT INTO conversations_event_deliveries(outbox_id,tenant_id,corpus_id,authority_id,envelope_sha256,dedupe_key,state) VALUES('foreign',$1,$2,$3,$4,'foreign','pending')",
    [randomUUID(),f.source.corpus_id,f.source.authority_id,"a".repeat(64)])).rejects.toThrow();
  await f.drain();
  const read=await f.issueSource(f.source.tenant_id,["conversations:read"]);
  const url=new URL("/v1/events/outbox/receipt",f.sourceServer.url);url.searchParams.set("event_id",e.id);
  const response=await fetch(url,{headers:{"x-api-key":read.token}});
  expect(response.status).toBe(200);
  const receipt=await response.json();
  expect(receipt).toMatchObject({outbox_id:e.id,state:"accepted",corpus_id:f.source.corpus_id,authority_id:f.source.authority_id});
  expect(receipt.receipt_id).toBeString();expect(JSON.stringify(receipt)).not.toContain("synthetic message");
  expect(receipt.envelope_json).toBeUndefined();expect(receipt.sink_url).toBeUndefined();
  const wrong=await f.issueSource(randomUUID(),["conversations:read"]);
  expect((await fetch(url,{headers:{"x-api-key":wrong.token}})).status).toBe(403);
  url.searchParams.set("event_id","foreign");expect((await fetch(url,{headers:{"x-api-key":read.token}})).status).toBe(404);
}),30000);

pgTest("source API stop aborts active intake I/O and preserves uncertain retry evidence",()=>fixture(async f=>{
  await f.append();
  let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
  let ioAborted=false;
  const server=startApiServer({host:"127.0.0.1",port:0,deps:{client:f.runtime,keys:new ApiKeyStore(f.runtime),
    verifier:f.sourceVerifier,
    eventsIntake:()=>{const r=f.resolve();return {...r,client:{...r.client,accept:async(_request,signal)=>{
      entered();await new Promise<void>((_resolve,reject)=>{
        const abort=()=>{ioAborted=true;reject(new Error("synthetic aborted write"));};
        if(signal?.aborted)abort();else signal?.addEventListener("abort",abort,{once:true});
      });throw new Error("unreachable");
    }}};}}});
  try {
    const sourceKey=await f.issueSource();
    const request=fetch(new URL("/v1/events/outbox/drain",server.url),{method:"POST",headers:{"x-api-key":sourceKey.token}});
    await started;
    await Promise.race([server.stop(),new Promise((_,reject)=>setTimeout(()=>reject(new Error("shutdown did not drain")),3000))]);
    const response=await request;expect(response.status).toBe(200);expect(await response.json()).toMatchObject({accepted:0,retryable:1});
    expect(ioAborted).toBe(true);expect(await f.sinkCount()).toBe(0);
    expect(await f.owner.one("SELECT state,external_may_exist,receipt FROM conversations_event_deliveries")).toMatchObject({state:"retryable",external_may_exist:true,receipt:null});
  }finally{await server.stop(true);}
}),30000);

pgTest("explicit malformed drain limits refuse before reserving any intent",()=>fixture(async f=>{
  await f.append();const key=await f.issueSource();
  for(const limit of ["","abc","1.5","101","-1","1junk"]) {
    const url=new URL("/v1/events/outbox/drain",f.sourceServer.url);url.searchParams.set("limit",limit);
    const response=await fetch(url,{method:"POST",headers:{"x-api-key":key.token}});
    expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:"invalid_events_drain_limit"});
  }
  expect((await f.owner.one("SELECT attempts FROM conversations_event_deliveries")).attempts).toBe(0);
  expect(await f.sinkCount()).toBe(0);
}),30000);

pgTest("all three source append sites capture bound intent atomically without intake configuration",()=>fixture(async f=>{
  const key=await f.issueSource(f.source.tenant_id,["conversations:read","conversations:write"]);
  const request=(path:string,body:Record<string,unknown>)=>fetch(new URL(path,f.sourceServer.url),{
    method:"POST",headers:{"x-api-key":key.token,"content-type":"application/json"},body:JSON.stringify(body)});
  delete f.env.HASNA_CONVERSATIONS_EVENTS_SINK_ID;
  expect((await request("/v1/messages",{from:"alice",to:"bob",content:"synthetic source capture"})).status).toBe(201);
  const create=await request("/v1/tasks",{subject:"synthetic task",reporter:"alice"});
  expect(create.status).toBe(201);const created=await create.json();
  expect((await request(`/v1/tasks/${created.task.id}/start`,{agent:"alice"})).status).toBe(200);
  const rows=await f.owner.many<{type:string;state:string;corpus_id:string;envelope_json:string}>("SELECT o.type,o.envelope_json,d.state,d.corpus_id FROM conversations_event_outbox o JOIN conversations_event_deliveries d ON d.outbox_id=o.id ORDER BY o.created_at");
  expect(rows).toHaveLength(3);expect(rows.every(r=>r.state==="pending"&&r.corpus_id===f.source.corpus_id)).toBe(true);
  expect(rows.map(r=>JSON.parse(r.envelope_json).data.action).filter(Boolean).sort()).toEqual(["created","started"]);
  await expect(f.drain()).rejects.toThrow("events_intake_not_configured");expect(await f.sinkCount()).toBe(0);
  // Force ledger insertion failure in the real transaction. The source write
  // must roll back as well; no network or spool fallback is permitted.
  await f.owner.execute("CREATE FUNCTION reject_fixture_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic capture failure'; END $$");
  await f.owner.execute("CREATE TRIGGER reject_fixture_delivery BEFORE INSERT ON conversations_event_deliveries FOR EACH ROW EXECUTE FUNCTION reject_fixture_delivery()");
  const before=await f.owner.one("SELECT COUNT(*)::int count FROM messages");
  expect((await request("/v1/messages",{from:"alice",to:"bob",content:"synthetic rolled back capture"})).status).toBe(400);
  expect(await f.owner.one("SELECT COUNT(*)::int count FROM messages")).toEqual(before);
  expect((await f.owner.one("SELECT COUNT(*)::int count FROM conversations_event_outbox")).count).toBe(3);
}),30000);

pgTest("fresh saved-credential CLI and MCP plus generated SDK preserve real intake receipt semantics",()=>fixture(async f=>{
  const sourceKey=await f.issueSource(f.source.tenant_id,["conversations:read","conversations:events-drain"]);
  const config=join(f.home,".hasna","conversations","config");mkdirSync(config,{recursive:true,mode:0o700});
  writeFileSync(join(config,"credentials"),`HASNA_CONVERSATIONS_API_URL=${f.sourceServer.url.origin}\nHASNA_CONVERSATIONS_API_KEY=${sourceKey.token}\n`,{mode:0o600});
  const env={PATH:process.env.PATH??"",HOME:f.home,USERPROFILE:f.home,TMPDIR:process.env.TMPDIR??tmpdir(),
    HASNA_STATION:`fixture-${randomUUID()}`,NO_COLOR:"1",FORCE_COLOR:"0"};
  const cli=async(args:string[])=>{
    const child=Bun.spawn([process.execPath,"--no-env-file",join(import.meta.dir,"../cli/index.tsx"),...args],{env,stdout:"pipe",stderr:"pipe"});
    const timer=setTimeout(()=>child.kill("SIGKILL"),15000);
    try{const [code,out]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);return {code,out};}
    finally{clearTimeout(timer);}
  };
  const e=await f.append();const result=await cli(["events-drain","--limit","1","--json"]);
  expect(result.code).toBe(0);expect(JSON.parse(result.out)).toMatchObject({protocol:"conversations.events-delivery.v1",accepted:1,spooled:0});
  const inspect=await cli(["events-receipt",e.id,"--json"]);
  expect(inspect.code).toBe(0);expect(JSON.parse(inspect.out)).toMatchObject({outbox_id:e.id,state:"accepted"});
  const bad=await cli(["events-drain","--limit","1junk","--json"]);expect(bad.code).not.toBe(0);
  await f.append();
  const mcp=new Client({name:"outbox-fixture",version:"0.0.0"});
  const transport=new StdioClientTransport({command:process.execPath,args:["--no-env-file",join(import.meta.dir,"../cli/index.tsx"),"mcp"],env,stderr:"ignore"});
  try{
    await mcp.connect(transport,{timeout:5000});
    const tools=await mcp.listTools();expect(tools.tools.some(t=>t.name==="events_drain")).toBe(true);
    const call=await mcp.callTool({name:"events_drain",arguments:{limit:1}});
    expect(call.isError).not.toBe(true);
    const text=(call.content as Array<{type:string;text:string}>)[0]!.text;
    expect(JSON.parse(text)).toMatchObject({accepted:1,spooled:0});
    const receipt=await mcp.callTool({name:"events_receipt",arguments:{event_id:e.id}});
    expect(receipt.isError).not.toBe(true);expect(JSON.parse((receipt.content as Array<{text:string}>)[0]!.text)).toMatchObject({state:"accepted",outbox_id:e.id});
  }finally{await mcp.close();await transport.close();}
  const sdk=new ConversationsClient({baseUrl:f.sourceServer.url.origin,apiKey:sourceKey.token});
  expect(await sdk.getEventDelivery({event_id:e.id})).toMatchObject({outbox_id:e.id,state:"accepted"});
  expect(await sdk.drainEventOutbox({limit:1})).toMatchObject({accepted:0,scanned:0});
  expect(await f.sinkCount()).toBe(2);assertNoClientDatabase(f.home);
}),30000);

pgTest("source mutation and immutable corpus drift fence dispatch while original intent remains inspectable",()=>fixture(async f=>{
  const e=await f.append();const first=await f.store.claim(f.resolve().target,30_000);
  if(!first||typeof first!=="object")throw new Error("claim required");
  await f.runtime.execute("UPDATE conversations_event_outbox SET envelope_json=$2 WHERE id=$1",[e.id,JSON.stringify({...e,data:{...e.data,content_preview:"redacted"}})]);
  expect(await f.store.beforeDispatch(first,first.target)).toBe(false);
  expect(await f.owner.one("SELECT state,error_code,envelope_sha256 FROM conversations_event_deliveries WHERE outbox_id=$1",[e.id]))
    .toMatchObject({state:"quarantined",error_code:"payload_redacted",envelope_sha256:first.request.envelope_sha256});
  const next=await f.append();const claim=await f.store.claim(f.resolve().target,30_000);
  if(!claim||typeof claim!=="object")throw new Error("claim required");
  await expect(f.runtime.execute("UPDATE conversations_corpus_binding SET tenant_id=$1",[randomUUID()])).rejects.toThrow();
  await expect(f.runtime.execute("UPDATE conversations_event_outbox SET type='hidden' WHERE id=$1",[next.id])).rejects.toThrow("immutable");
  // Simulate an operator changing the database outside the serving contract.
  // Normal runtime writes above are rejected by immutable ownership guards.
  await f.owner.execute("ALTER TABLE conversations_corpus_binding DISABLE TRIGGER USER");
  await f.owner.execute("UPDATE conversations_corpus_binding SET tenant_id=$1",[randomUUID()]);
  await f.owner.execute("ALTER TABLE conversations_corpus_binding ENABLE TRIGGER USER");
  await expect(f.store.beforeDispatch(claim,claim.target)).rejects.toThrow("events_source_binding_changed");
  const durable=await f.owner.one("SELECT tenant_id,envelope_sha256,external_may_exist FROM conversations_event_deliveries WHERE outbox_id=$1",[next.id]);
  expect(durable).toMatchObject({tenant_id:f.source.tenant_id,envelope_sha256:claim.request.envelope_sha256,external_may_exist:false});
  expect(await f.sinkCount()).toBe(0);
}),30000);

pgTest("duplicate identities cannot replace payloads and migration readiness cannot be bypassed",()=>fixture(async f=>{
  const e=await f.append();const original=await f.owner.one("SELECT * FROM conversations_event_deliveries");
  await f.runtime.transaction(tx=>appendEventIntent(tx,e));
  expect(await f.owner.one("SELECT * FROM conversations_event_deliveries")).toEqual(original);
  await expect(f.runtime.transaction(async tx=>{
    await tx.execute("INSERT INTO messages(uuid,session_id,from_agent,to_agent,content) VALUES('duplicate-rollback','fixture','alice','bob','synthetic')");
    await appendEventIntent(tx,{...e,data:{changed:true}});
  })).rejects.toThrow("event_intent_conflict");
  expect(await f.owner.many("SELECT * FROM messages WHERE uuid='duplicate-rollback'")).toEqual([]);
  expect(await f.owner.one("SELECT * FROM conversations_event_deliveries")).toEqual(original);
  await f.owner.execute("DELETE FROM _migrations WHERE id=16");
  await expect(f.store.ready()).rejects.toThrow("events_source_migration_required");
  await f.owner.execute(PG_MIGRATIONS[15]!);await f.store.ready();
  expect(await f.owner.one("SELECT * FROM conversations_event_deliveries")).toEqual(original);
  await f.owner.execute("ALTER TABLE conversations_event_outbox DISABLE TRIGGER conversations_event_delivery_invalidation");
  await expect(f.store.ready()).rejects.toThrow("events_source_migration_required");
}),30000);

pgTest("lost source dispatch-commit acknowledgement prevents HTTP and retains the exact replay intent",()=>fixture(async f=>{
  await f.append();let transactions=0,accepts=0;
  const ambiguous={...f.runtime,transaction:async<T>(work:Parameters<typeof f.runtime.transaction<T>>[0]):Promise<T>=>{
    const value=await f.runtime.transaction(work);
    if(++transactions===2)throw new Error("synthetic lost dispatch commit acknowledgement");
    return value;
  }};
  const resolve=()=>{const r=f.resolve();return {...r,client:{...r.client,accept:async(...args:Parameters<typeof r.client.accept>)=>{
    accepts++;return r.client.accept(...args);
  }}};};
  const result=await drainServerEventOutbox(ambiguous,1,{signal:new AbortController().signal,authorizeSource:f.authorizeSource,resolveIntake:resolve});
  expect(result).toMatchObject({accepted:0,retryable:1});expect(accepts).toBe(0);expect(await f.sinkCount()).toBe(0);
  const before=await f.owner.one("SELECT outbox_id,envelope_sha256,sink_id,producer_id,external_may_exist FROM conversations_event_deliveries");
  expect(before.external_may_exist).toBe(true);
  await f.owner.execute("UPDATE conversations_event_deliveries SET next_attempt_at=clock_timestamp()");
  expect(await f.drain()).toMatchObject({accepted:1,retryable:0});
  expect(await f.owner.one("SELECT outbox_id,envelope_sha256,sink_id,producer_id,external_may_exist FROM conversations_event_deliveries")).toEqual(before);
  expect(await f.sinkCount()).toBe(1);
}),30000);
