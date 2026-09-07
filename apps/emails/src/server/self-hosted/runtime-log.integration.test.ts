import { beforeAll, afterAll, expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { createPgPool, createQueryClient, MigrationLedger, type PoolQueryClient } from "../../storage-kit/index.js";
import { emailsSelfHostedMigrations, DEFAULT_TENANT_ID } from "./migrations.js";
import { EmailsSelfHostedStore } from "./store.js";
import { handleSelfHostedRequest, type SelfHostedServiceDeps } from "./service.js";
import { testAuthDeps } from "./auth/test-support.js";
import { withRuntimeLog } from "./runtime-log.js";
const url=process.env.EMAILS_TEST_POSTGRES_URL, run=test.skipIf(!url);let db:PoolQueryClient;const other="00000000-0000-4000-8000-000000000037";
beforeAll(async()=>{if(!url)return;db=createQueryClient(createPgPool({connectionString:url,env:{PGSSLMODE:"disable"}}));await db.execute("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public");await new MigrationLedger(db,emailsSelfHostedMigrations()).migrate();await db.execute("INSERT INTO tenants(id,name,slug,status) VALUES($1,'Other','runtime-other','active')",[other]);},60000);
afterAll(async()=>{await db?.close();});
function fixture(){const secret=crypto.randomUUID();const deps={client:db,store:new EmailsSelfHostedStore(db),verifier:verifyApiKey({app:"emails",signingSecret:secret,keyStatus:async()=>"active"}),version:"fixture",migrations:[],...testAuthDeps(db,secret),env:{}} as SelfHostedServiceDeps;return{deps,request:async(path:string,method="GET",body?:unknown,scopes=["emails:*"])=>handleSelfHostedRequest(deps,new Request(`https://fixture${path}`,{method,headers:{authorization:`Bearer ${mintApiKey({app:"emails",scopes,signingSecret:secret}).token}`,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})}))};}
run("actual scheduler handler persists ordered entry/exit logs and exposes only tenant operator records",async()=>{
 const f=fixture();const response=(await f.request("/v1/scheduled/run","POST",{limit:1,sequence_limit:0}))!;expect(response.status).toBe(200);
 const tail=(await f.request("/v1/runtime/logs?component=scheduler&lines=2"))!;expect(tail.status).toBe(200);const body=await tail.json();expect(body).toMatchObject({scope:"tenant_api_operations",container_stdout:false,worker_liveness:"not_measured"});expect(body.items.map((x:any)=>x.event)).toEqual(["returned","started"]);expect(body.items[0].request_id).toBe(body.items[1].request_id);
 for(const scopes of [["emails:read"],["emails:write"]])expect((await f.request("/v1/runtime/logs","GET",undefined,scopes))!.status).toBe(403);
 expect((await f.request("/v1/runtime/logs?lines=2x"))!.status).toBe(400);expect((await f.request("/v1/runtime/logs","POST",{}))!.status).toBe(405);
});
run("durable log table rejects update/delete and keeps tenants isolated",async()=>{
 const root=new EmailsSelfHostedStore(db), own=root.forTenant(DEFAULT_TENANT_ID), foreign=root.forTenant(other);
 await withRuntimeLog(foreign,"sync","sync_s3",async()=>Response.json({private_value:"must not persist"},{status:202}));
 expect(await own.tailRuntimeLogs("sync",10)).toEqual([]);const rows=await foreign.tailRuntimeLogs("sync",10);expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({event:"returned",http_status:202});expect(JSON.stringify(rows)).not.toContain("private_value");
 await expect(db.execute("UPDATE runtime_logs SET event='threw',http_status=NULL WHERE id=$1",[rows[0]!.id])).rejects.toThrow("append-only");await expect(db.execute("DELETE FROM runtime_logs WHERE id=$1",[rows[0]!.id])).rejects.toThrow("append-only");
 const role=`runtime_reader_${Date.now()}`;await db.execute(`CREATE ROLE "${role}"; GRANT USAGE ON SCHEMA public TO "${role}"; GRANT SELECT,INSERT,UPDATE,DELETE ON runtime_logs TO "${role}"`);
 try{await db.transaction(async tx=>{await tx.execute(`SET LOCAL ROLE "${role}"`);await tx.execute("SELECT set_config('app.current_tenant',$1,true)",[DEFAULT_TENANT_ID]);expect(await tx.many("SELECT id FROM runtime_logs WHERE tenant_id=$1",[other])).toEqual([]);});await expect(db.transaction(async tx=>{await tx.execute(`SET LOCAL ROLE "${role}"`);await tx.execute("SELECT set_config('app.current_tenant',$1,true)",[DEFAULT_TENANT_ID]);await tx.execute("INSERT INTO runtime_logs(id,tenant_id,request_id,component,operation,event) VALUES($1,$2,$3,'sync','sync_s3','started')",[crypto.randomUUID(),other,crypto.randomUUID()]);})).rejects.toThrow(/row.level security/);}finally{await db.execute(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`);}
});
run("components without instrumentation return an honest empty log, never a stopped-worker claim",async()=>{
 const f=fixture(), response=(await f.request("/v1/runtime/logs?component=nightly"))!;expect(response.status).toBe(200);expect(await response.json()).toEqual({scope:"tenant_api_operations",component:"nightly",items:[],container_stdout:false,worker_liveness:"not_measured"});
});
