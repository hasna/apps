import { projectChannelRegistrationDigest } from "../lib/project-channel-registration.js";
import { expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { ApiKeyStore, mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { createQueryClient } from "../generated/storage-kit/query.js";
import { PG_MIGRATIONS } from "../lib/pg-migrations.js";
import { adoptCorpus, inspectCorpus, readCorpusBinding, type CorpusExpectation } from "./corpus-binding.js";
import { startApiServer } from "./api.js";
import { projectChannelRegistrationPgCapability, lookupProjectChannelRegistrationReceiptPg, registerProjectChannelPg } from "./project-channel-registration-pg.js";

const dsn = process.env.CONVERSATIONS_TEST_DATABASE_URL;
const pgTest = dsn ? test : test.skip;
async function fixture(run: (f: {
  schema:string;
  owner: ReturnType<typeof createQueryClient>;
  runtime: ReturnType<typeof createQueryClient>;
  start: (expected?:CorpusExpectation) => ReturnType<typeof startApiServer>;
  request: (server:ReturnType<typeof startApiServer>, tenant:string|null, path:string, method?:string) => Promise<Response>;
}) => Promise<void>) {
  const schema = `corpus_${randomUUID().replaceAll("-", "")}`;
  const role = `${schema}_app`;
  const admin = new Pool({connectionString:dsn,max:1});
  let pool:Pool|undefined, serving:Pool|undefined;
  const servers: ReturnType<typeof startApiServer>[] = [];
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    pool = new Pool({connectionString:dsn,options:`-csearch_path=${schema}`,max:3});
    const owner = createQueryClient(pool);
    for (const sql of PG_MIGRATIONS) await owner.execute(sql);
    const keys = new ApiKeyStore(owner); await keys.ensureSchema();
    await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    // Broad data grants deliberately prove the trigger's role check is real.
    await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
    await admin.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
    serving = new Pool({connectionString:dsn,options:`-csearch_path=${schema} -crole=${role}`,max:3});
    const runtime = createQueryClient(serving);
    const signingSecret = randomBytes(32);
    const start = (expected:CorpusExpectation = {}) => {
      const server = startApiServer({port:0,host:"127.0.0.1",deps:{client:runtime,keys:new ApiKeyStore(runtime),incidentProjector:null,corpusExpectation:expected,
        verifier:verifyApiKey({app:"conversations",signingSecret,keyStatus:keys.keyStatus})}});
      servers.push(server); return server;
    };
    const request = async (server:ReturnType<typeof startApiServer>,tenant:string|null,path:string,method="GET") => {
      const minted = mintApiKey({app:"conversations",agent:"synthetic-operator",...(tenant?{tid:tenant}:{}),scopes:["*"],signingSecret});
      await keys.insertMinted(minted);
      return fetch(`http://127.0.0.1:${server.port}${path}`,{method,headers:{"x-api-key":minted.token,"content-type":"application/json"},...(method==="GET"?{}:{body:"{}"})});
    };
    await run({schema,owner,runtime,start,request});
  } finally {
    for (const server of servers) server.stop(true);
    await serving?.end(); await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.end();
  }
}

pgTest("unbound corpus refuses readiness and all authenticated corpus access without first-caller adoption",async()=>fixture(async({owner,start,request})=>{
  const server=start();
  expect((await fetch(`http://127.0.0.1:${server.port}/health`)).status).toBe(200);
  expect((await fetch(`http://127.0.0.1:${server.port}/ready`)).status).toBe(503);
  for(const path of ["/v1/messages","/v1/projects","/v1/channels"]){expect((await request(server,"tenant-a",path)).status).toBe(503);}
  expect(await owner.many("SELECT * FROM conversations_corpus_binding")).toEqual([]);
}),20000);

pgTest("owner adoption is immutable, parameterized and replayable; server-role claims cannot initialize",async()=>fixture(async({owner,runtime})=>{
  const inventory=await inspectCorpus(owner);
  const input={...inventory,tenant_id:"tenant-a",authority_id:"authority-a",actor:"operator-fixture"};
  await expect(adoptCorpus(runtime,input)).rejects.toThrow("owner role");
  await expect(adoptCorpus(owner,{...input,legacy_receipt_digest:"0".repeat(64)})).rejects.toThrow("inventory changed");
  expect(await owner.many("SELECT * FROM conversations_corpus_binding")).toEqual([]);
  const receipt=await adoptCorpus(owner,input);
  expect((await adoptCorpus(owner,input)).receipt_id).toBe(receipt.receipt_id);
  await expect(adoptCorpus(owner,{...input,tenant_id:"tenant-b"})).rejects.toThrow("cannot reassign");
  await expect(owner.execute("UPDATE conversations_corpus_binding SET tenant_id='tenant-b'")).rejects.toThrow("immutable");
  await expect(runtime.execute("DELETE FROM conversations_corpus_binding")).rejects.toThrow("immutable");
  await expect(owner.execute("TRUNCATE conversations_corpus_binding CASCADE")).rejects.toThrow("immutable");
  expect(await readCorpusBinding(runtime)).toMatchObject({tenant_id:"tenant-a",authority_id:"authority-a"});
}),20000);

pgTest("signed tenant ownership applies to reads, writes, admin, outbox and registration after restart",async()=>fixture(async({owner,start,request})=>{
  const inventory=await inspectCorpus(owner);
  await adoptCorpus(owner,{...inventory,tenant_id:"tenant-a",authority_id:"authority-a",actor:"operator-fixture"});
  for(let n=0;n<2;n++){
    const server=start({corpus_id:inventory.corpus_id,tenant_id:"tenant-a",authority_id:"authority-a"});
    expect((await fetch(`http://127.0.0.1:${server.port}/ready`)).status).toBe(200);
    expect((await request(server,"tenant-a","/v1/messages")).status).toBe(200);
    for(const tenant of ["tenant-b",null]){
      expect((await request(server,tenant,"/v1/messages")).status).toBe(403);
      for(const path of ["/v1/projects","/v1/admin/redact-messages","/v1/events/outbox/drain","/v1/channels/project-registration"])
        expect((await request(server,tenant,path,"POST")).status).toBe(403);
    }
    server.stop(true);
  }
  for (const expected of [{tenant_id:"tenant-b"},{authority_id:"wrong-authority"},{corpus_id:"wrong-corpus"}]) {
    const wrong=start(expected);
    expect((await fetch(`http://127.0.0.1:${wrong.port}/ready`)).status).toBe(503);
    expect((await request(wrong,"tenant-a","/v1/messages")).status).toBe(503);
  }
  expect(await projectChannelRegistrationPgCapability(owner)).toMatchObject({tenant_id:"tenant-a",authority_id:"authority-a",corpus_id:inventory.corpus_id});
}),20000);

pgTest("legacy default receipts are mapped by content hash without rewriting historical proofs",async()=>fixture(async({owner})=>{
  const inventory=await inspectCorpus(owner);
  const receiptId=randomUUID();
  const precondition=projectChannelRegistrationDigest({target_selector:"fixture",expected:"absent"});
  await owner.execute(`INSERT INTO project_channel_registration_receipts(receipt_id,authority,route,package_version,authority_id,tenant_id,corpus_id,operation_id,step_id,resource_kind,direction,idempotency_key,request_digest,precondition_digest,outcome,created_by_operation)
    VALUES($1,'conversations','fixture','fixture','conversations','default',$2,'fixture-operation','fixture-step','channel','forward','fixture-key','fixture-request',$3,'terminal_nonacceptance',FALSE)`,[receiptId,inventory.corpus_id,precondition]);
  const before=await owner.one("SELECT to_jsonb(r)::text AS value FROM project_channel_registration_receipts r WHERE receipt_id=$1",[receiptId]);
  await expect(adoptCorpus(owner,{...inventory,tenant_id:"tenant-a",authority_id:"authority-a",actor:"operator-fixture"})).rejects.toThrow("inventory changed");
  const actual=await inspectCorpus(owner);
  expect(actual.legacy_receipt_count).toBe(1);
  const adopted=await adoptCorpus(owner,{...actual,tenant_id:"tenant-a",authority_id:"authority-a",actor:"operator-fixture"});
  expect(await owner.one("SELECT to_jsonb(r)::text AS value FROM project_channel_registration_receipts r WHERE receipt_id=$1",[receiptId])).toEqual(before);
  expect(await owner.one("SELECT receipt_id,adoption_receipt_id FROM conversations_corpus_legacy_receipts WHERE receipt_id=$1",[receiptId])).toEqual({receipt_id:receiptId,adoption_receipt_id:adopted.receipt_id});
  await owner.execute("SET TIME ZONE 'Pacific/Honolulu'");
  const historical = await lookupProjectChannelRegistrationReceiptPg(owner, {authority:"conversations",authority_route:"fixture",package_version:"fixture",authority_id:"conversations",tenant_id:"default",corpus_id:inventory.corpus_id,operation_id:"fixture-operation",step_id:"fixture-step",resource_kind:"channel",direction:"forward",target_selector:"fixture",idempotency_key:"fixture-key",request_digest:"fixture-request",precondition_digest:precondition,max_items:1,response_byte_limit:32768,time_budget_ms:5000});
  expect((await inspectCorpus(owner)).legacy_receipt_digest).toBe(actual.legacy_receipt_digest);
  expect(historical.receipt.receipt_id).toBe(receiptId);
  expect(historical.receipt.tenant_id).toBe("default");
  const cap=await projectChannelRegistrationPgCapability(owner);
  const desired={channel:"fixture",project_id:"wks_ys8tzpsZJMNtx0ORZtLsA",project_slug:"fixture",project_kind:"work"};
  await expect(registerProjectChannelPg(owner,{operation_intent:"create",operation_id:"fixture-operation",step_id:"fixture-step",resource_kind:"channel",direction:"forward",authority_route:cap.route,package_version:cap.package_version,authority_id:cap.authority_id,tenant_id:cap.tenant_id,corpus_id:cap.corpus_id,target_selector:"fixture",idempotency_key:"fixture-key",request_digest:projectChannelRegistrationDigest(desired),precondition_digest:precondition,project_id:desired.project_id,project_slug:"fixture",project_name:"Fixture",desired,target:{digest:"fixture",withOwnedPath:consumer=>consumer("/fixture")},response_byte_limit:32768,time_budget_ms:5000,call_limit:1})).rejects.toThrow("historical ownership evidence");
  expect(await owner.many("SELECT * FROM channels")).toEqual([]);


}),20000);

pgTest("adoption rolls back binding when legacy mapping insertion fails",async()=>fixture(async({owner})=>{
  const inventory=await inspectCorpus(owner);
  await owner.execute(`INSERT INTO project_channel_registration_receipts(receipt_id,authority,route,package_version,authority_id,tenant_id,corpus_id,operation_id,step_id,resource_kind,direction,idempotency_key,request_digest,precondition_digest,outcome,created_by_operation)
    VALUES('rollback-receipt','conversations','fixture','fixture','conversations','default',$1,'operation','step','channel','forward','key','request','precondition','terminal_nonacceptance',FALSE)`,[inventory.corpus_id]);
  const actual=await inspectCorpus(owner);
  await owner.execute("ALTER TABLE conversations_corpus_legacy_receipts ADD CONSTRAINT fixture_mapping_failure CHECK (receipt_id <> 'rollback-receipt')");
  await expect(adoptCorpus(owner,{...actual,tenant_id:"tenant-a",authority_id:"authority-a",actor:"operator-fixture"})).rejects.toThrow();
  expect(await owner.many("SELECT * FROM conversations_corpus_binding")).toEqual([]);
  expect(await owner.many("SELECT * FROM conversations_corpus_legacy_receipts")).toEqual([]);
  expect((await inspectCorpus(owner)).legacy_receipt_digest).toBe(actual.legacy_receipt_digest);
}),20000);

pgTest("operator CLI inspects and adopts only the explicit owner connection with reviewable metadata",async()=>fixture(async({schema,owner})=>{
  const {mkdtempSync,rmSync}=await import("node:fs");
  const {tmpdir}=await import("node:os");
  const {join}=await import("node:path");
  const home=mkdtempSync(join(tmpdir(),"corpus-owner-cli-"));
  const url=new URL(dsn!);url.searchParams.set("options",`-csearch_path=${schema}`);
  const run=async(args:string[],configured=true)=>{
    const proc=Bun.spawn([process.execPath,"--no-env-file","src/server/serve-entry.ts","corpus",...args],{cwd:join(import.meta.dir,"../.."),env:{PATH:process.env.PATH??"",HOME:home,HASNA_STATION:`fixture-${randomUUID()}`,...(configured?{HASNA_CONVERSATIONS_DATABASE_URL_OWNER:url.toString()}:{})},stdout:"pipe",stderr:"pipe"});
    const [stdout,stderr,exit]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
    expect(stdout+stderr).not.toContain(url.toString());return {stdout,stderr,exit};
  };
  try{
    const missing=await run(["inspect"],false);expect(missing.exit).toBe(1);
    const inspected=await run(["inspect"]);expect(inspected.exit).toBe(0);
    const inventory=JSON.parse(inspected.stdout);expect(Object.keys(inventory).sort()).toEqual(["corpus_id","legacy_receipt_count","legacy_receipt_digest","unmapped_identity_count"]);
    const adopted=await run(["adopt","--corpus-id",inventory.corpus_id,"--tenant-id","tenant-cli","--authority-id","authority-cli","--actor","fixture-operator","--legacy-receipt-count",String(inventory.legacy_receipt_count),"--legacy-receipt-digest",inventory.legacy_receipt_digest]);
    expect(adopted.exit).toBe(0);expect(JSON.parse(adopted.stdout)).toMatchObject({tenant_id:"tenant-cli",corpus_id:inventory.corpus_id});
    expect(await readCorpusBinding(owner)).toMatchObject({tenant_id:"tenant-cli"});
  }finally{rmSync(home,{recursive:true,force:true});}
}),20000);
