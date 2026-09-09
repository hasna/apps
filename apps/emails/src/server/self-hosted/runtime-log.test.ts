import { expect, test } from "bun:test";
import { runtimeLogQuery, withRuntimeLog, type RuntimeLogEntry, type RuntimeLogStore } from "./runtime-log.js";

test("logs have fixed fields and preserve durable202 receipts", async () => {
  const entries: unknown[] = [];
  const store = { appendRuntimeLog: async (item: unknown) => { entries.push(item); } } as RuntimeLogStore;
  const response = await withRuntimeLog(store, "scheduler", "scheduled_run", async () => Response.json({ sent: true, private_detail: "never in logs" }, {status:202}));
  expect(response.status).toBe(202); expect(entries).toHaveLength(2);
  expect(entries[1]).toMatchObject({component:"scheduler",operation:"scheduled_run",event:"returned",http_status:202});
  expect(JSON.stringify(entries)).not.toContain("never in logs");
  expect((entries[0] as RuntimeLogEntry).request_id).toBe((entries[1] as RuntimeLogEntry).request_id);
});
test("start sink failure prevents work and final sink failure preserves committed outcome", async () => {
  let calls=0,work=0;
  const store={appendRuntimeLog:async()=>{if(++calls===1)throw Error("synthetic DB outage");}} as unknown as RuntimeLogStore;
  await expect(withRuntimeLog(store,"sync","sync_s3",async()=>{work++;return Response.json({ok:true});})).rejects.toThrow();expect(work).toBe(0);
  const result=await withRuntimeLog({appendRuntimeLog:async()=>{if(++calls===3)throw Error("synthetic final write failure");}} as unknown as RuntimeLogStore,"inbound","smtp_import",async()=>Response.json({accepted:true},{status:201}));
  expect(result.status).toBe(201);expect(result.headers.get("X-Emails-Runtime-Log")).toBe("incomplete");expect(await result.json()).toEqual({accepted:true});
});
test("thrown errors are never serialized and tail input is strict", async()=>{
 const entries:unknown[]=[];const failure=Error("synthetic private provider detail");
 await expect(withRuntimeLog({appendRuntimeLog:async item=>{entries.push(item);}} as RuntimeLogStore,"inbound","watch",async()=>{throw failure;})).rejects.toBe(failure);
 expect(entries[1]).toMatchObject({event:"threw",http_status:null});expect(JSON.stringify(entries)).not.toContain(failure.message);
 for(const lines of ["0","-1","501","2x","1.2","", " 3"]){expect(()=>runtimeLogQuery("daemon",lines)).toThrow();}
 expect(()=>runtimeLogQuery("invalid","3")).toThrow();expect(runtimeLogQuery("nightly","500")).toEqual({component:"nightly",limit:500});
});

test("fresh CLI tails the authenticated API with strict limits and honest empty state", async()=>{
 const {mkdtemp,rm}=await import("node:fs/promises"),{tmpdir}=await import("node:os"),{join}=await import("node:path");
 const home=await mkdtemp(join(tmpdir(),"emails-runtime-cli-")), token=crypto.randomUUID();let calls=0, legacyStatus=0;
 const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:req=>{calls++;expect(req.headers.get("authorization")).toBe(`Bearer ${token}`);const url=new URL(req.url);if(legacyStatus)return Response.json({error:"not found"},{status:legacyStatus});expect(url.pathname).toBe("/v1/runtime/logs");expect(url.searchParams.get("component")).toBe("nightly");expect(url.searchParams.get("lines")).toBe("2");return Response.json({scope:"tenant_api_operations",component:"nightly",items:[],container_stdout:false,worker_liveness:"not_measured"});}});
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith("EMAILS_")&&!key.startsWith("HASNA_EMAILS_")));
 Object.assign(env,{HOME:home,HASNA_EMAILS_HOME:home,EMAILS_HOME:home,HASNA_EMAILS_API_URL:server.url.origin,HASNA_EMAILS_API_KEY:token,EMAILS_CLIENT_ENV_LOADED:"1",NO_COLOR:"1"});
 async function cli(lines:string){const child=Bun.spawn({cmd:[process.execPath,"--no-env-file","src/cli/index.tsx","--json","logs","tail","--component","nightly","--lines",lines],env,stdout:"pipe",stderr:"pipe"});const [code,out,error]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);return{code,out,error};}
 try{const good=await cli("2");expect(good.code).toBe(0);expect(JSON.parse(good.out)).toMatchObject({items:[],worker_liveness:"not_measured"});expect(good.error).toBe("");expect(calls).toBe(1);const bad=await cli("2x");expect(bad.code).toBe(1);expect(calls).toBe(1);expect(bad.error).toContain("1 to 500");for(const status of [404,405]){legacyStatus=status;const old=await cli("2");expect(old.code).toBe(1);expect(old.error).toContain("API needs an update to publish runtime logs");}}
 finally{server.stop(true);await rm(home,{recursive:true,force:true});}
},15000);
