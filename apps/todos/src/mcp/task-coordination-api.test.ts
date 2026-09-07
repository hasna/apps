import { test, expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { handleV1Request, type V1RequestDependencies } from "../server/v1.js";
import { cloudTaskGraph, cloudTaskLockStatus } from "./task-coordination-api.js";
import { cloudLockTask, cloudUnlockTask, cloudAddDependency, cloudRemoveDependency, cloudGetDependencies } from "../cli/cloud-router.js";
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";

async function fixture(run: (client:Client,state:any)=>Promise<void>) {
  const root=mkdtempSync(join(tmpdir(),"todos-coordination-"));
  const ids=[randomUUID(),randomUUID(),randomUUID()];
  const tasks=new Map(ids.map((id,i)=>[id,{id,short_id:`FIX-00${i+1}`,title:["Root task","Upstream task","Deep task"][i],status:"pending",priority:"medium",version:1,locked_by:null as string|null,locked_at:null as string|null,tags:[],metadata:{}}]));
  let scopes=["todos:*"];
  let writes=0;
  const edges:{task_id:string;depends_on:string}[]=[];
  const deps={ensureSchema:async()=>{},getVerifier:()=>({authenticate:async(headers:Headers,context:{requiredScopes:string[]})=>{
    expect(headers.get("authorization")??headers.get("x-api-key")).toContain("fixture-task-key");
    if (!scopes.includes("todos:*") && context.requiredScopes.some(scope=>!scopes.includes(scope))) return {ok:false,status:403,message:"Fixture key lacks required scope",reason:"scope"};
    return {ok:true,principal:{kid:"fixture-kid",agent:"agent-one",tid:null,scopes}};
  }}),getStorageAdapter:()=>({tasks:{
    get:async(id:string)=>tasks.get(id)??null,
    resolveRef:async(ref:string)=>[...tasks.values()].find(t=>t.short_id.toLowerCase()===ref.toLowerCase())??null,
    update:async(id:string,patch:any)=>{const task=tasks.get(id)!;if(patch.version!==task.version)throw new Error("version conflict");writes++;Object.assign(task,patch,{version:task.version+1});return task;},
    lock:async(id:string,agent:string)=>{const task=tasks.get(id)!;if(task.locked_by&&task.locked_by!==agent)return {success:false,error:"Lock held"};writes++;task.locked_by=agent;task.locked_at=new Date().toISOString();return {success:true,locked_by:agent,locked_at:task.locked_at};},
    unlock:async(id:string,agent?:string)=>{const task=tasks.get(id)!;if(agent&&agent!==task.locked_by)return false;writes++;task.locked_by=null;task.locked_at=null;return true;},
  },dependencies:{
    list:async(id:string)=>({dependencies:edges.filter(e=>e.task_id===id),blocked_by:edges.filter(e=>e.depends_on===id)}),
    add:async(id:string,dep:string)=>{if(id===dep)throw new Error("cycle");const edge={task_id:id,depends_on:dep};edges.push(edge);writes++;return edge;},
    remove:async(id:string,dep:string)=>{const i=edges.findIndex(e=>e.task_id===id&&e.depends_on===dep);if(i<0)return false;edges.splice(i,1);writes++;return true;},
  }})} as unknown as V1RequestDependencies;
  const server=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){return await handleV1Request(req,new URL(req.url),deps)??new Response(null,{status:404});}});
  const env=Object.fromEntries(Object.entries(process.env).filter(([key,value])=>value!==undefined&&!/^(HASNA_|TODOS_|DATABASE_URL$|PG|XDG_)/.test(key))) as Record<string,string>;
  env.HASNA_TODOS_PROFILE="full";env.HOME=root;env.HASNA_STATION=`fixture-${randomUUID()}`;env.HASNA_TODOS_DB_PATH=join(root,"trap.db");
  const config=join(root,".hasna/todos/config");mkdirSync(config,{recursive:true,mode:0o700});writeFileSync(join(config,"credentials"),`HASNA_TODOS_API_URL=${server.url.origin}\nHASNA_TODOS_API_KEY=fixture-task-key\n`,{mode:0o600});
  const client=new Client({name:"task-coordination-fixture",version:"1"});
  const transport=new StdioClientTransport({command:process.execPath,args:["src/mcp/index.ts","--profile","full"],cwd:join(import.meta.dir,"../.."),env,stderr:"pipe"});
  try {await client.connect(transport);await run(client,{ids,tasks,edges,setScopes:(value:string[])=>{scopes=value;},writes:()=>writes});expect(readdirSync(root,{recursive:true}).map(String).filter(p=>/\.(db|sqlite|sqlite3)(-wal|-shm)?$/.test(p))).toEqual([]);}
  finally {await client.close();server.stop(true);rmSync(root,{recursive:true,force:true});}
}
const text=(value:any)=>value.content.map((c:any)=>c.text??"").join("\n");
test("actual saved-credential MCP coordinates locks, CAS priority and full dependency graph through authenticated handler",async()=>{
  await fixture(async(client,state)=>{
    const call=(name:string,args:any)=>client.callTool({name,arguments:args});
    const [a,b,c]=state.ids;
    const locked = await call("lock_task",{task_id:"FIX-001",agent_id:"agent-one"}); expect(locked.isError, text(locked)).not.toBe(true);
    expect(JSON.parse(text(await call("check_task_lock",{task_id:a}))).locked).toBe(true);
    expect((await call("lock_task",{task_id:a,agent_id:"agent-two"})).isError).toBe(true);
    state.setScopes(["todos:read","todos:write"]);
    const before=state.writes();expect((await call("unlock_task",{task_id:a})).isError).toBe(true);expect(state.writes()).toBe(before);
    expect((await call("unlock_task",{task_id:a,agent_id:"agent-one"})).isError).not.toBe(true);
    expect((await call("prioritize_task",{task_id:a,priority:"high"})).isError).not.toBe(true);expect(state.tasks.get(a).priority).toBe("high");
    expect((await call("prioritize_task",{task_id:a,priority:"low",version:1})).isError).toBe(true);expect(state.tasks.get(a).priority).toBe("high");
    expect((await call("add_task_dependency",{task_id:a,depends_on:b})).isError).not.toBe(true);
    expect((await call("add_task_dependency",{task_id:b,depends_on:c})).isError).not.toBe(true);
    expect((await call("add_task_dependency",{task_id:a,depends_on:a})).isError).toBe(true);
    const up=await call("get_task_dependencies",{task_id:a,direction:"upstream"});expect(up.isError).not.toBe(true);expect(text(up)).toContain("Deep task");
    const down=await call("get_task_dependencies",{task_id:c,direction:"downstream"});expect(text(down)).toContain("Root task");
    expect(text(await call("remove_task_dependency",{task_id:a,depends_on:b}))).toContain("Dependency removed");
    expect(text(await call("remove_task_dependency",{task_id:a,depends_on:b}))).toContain("nothing removed");
    state.setScopes(["todos:read"]);const readOnlyWrites=state.writes();
    expect((await call("prioritize_task",{task_id:a,priority:"critical"})).isError).toBe(true);
    expect((await call("add_task_dependency",{task_id:a,depends_on:b})).isError).toBe(true);
    expect(state.writes()).toBe(readOnlyWrites);
  });
},30000);

test("shared CLI transport helpers reject missing, mismatched and ambiguous mutation receipts",async()=>{
  const fake=(value:unknown)=>({transport:{get:async()=>value,post:async()=>value,del:async()=>value}} as unknown as HasnaStorageClient);
  for(const value of [null,{}, {success:"true"}, {result:{}}]) {await expect(cloudLockTask(fake(value),"a","agent")).rejects.toThrow("receipt");await expect(cloudUnlockTask(fake(value),"a")).rejects.toThrow("receipt");}
  await expect(cloudAddDependency(fake({dependency:{task_id:"wrong",depends_on:"b"}}),"a","b")).rejects.toThrow("receipt");
  for(const value of [{},{removed:"false"},null])await expect(cloudRemoveDependency(fake(value),"a","b")).rejects.toThrow("receipt");
  await expect(cloudGetDependencies(fake({}),"a")).rejects.toThrow("incomplete");
  await expect(cloudGetDependencies(fake({dependencies:[{task_id:"wrong",depends_on:"b"}],blocked_by:[]}),"a")).rejects.toThrow("another task");
});
test("graph hydration refuses unreadable dependency rather than showing false completeness; lock fields fail closed",async()=>{
  const client={get:async(_kind:string,id:string)=>id==="a"?{id:"a",title:"A",status:"pending",priority:"medium",short_id:null,locked_by:null,locked_at:null}:null,transport:{get:async()=>({dependencies:[{task_id:"a",depends_on:"missing"}],blocked_by:[]})}} as unknown as HasnaStorageClient;
  await expect(cloudTaskGraph(client,"a")).rejects.toThrow("Task not found");
  expect((await cloudTaskLockStatus(client,"a")).expired).toBe(true);
  const malformed={get:async()=>({id:"a",title:"A",status:"pending"})} as unknown as HasnaStorageClient;
  await expect(cloudTaskLockStatus(malformed,"a")).rejects.toThrow("lock fields");
});

test("dependency graph limits and expired lock status are explicit",async()=>{
  const client={get:async(_kind:string,id:string)=>({id,title:id,status:"pending",priority:"medium",short_id:null,locked_by:"agent",locked_at:"2020-01-01T00:00:00.000Z"}),transport:{get:async(path:string)=>{const id=path.split("/")[2]!;return {dependencies:[{task_id:id,depends_on:String(Number(id)+1)}],blocked_by:[]};}}} as unknown as HasnaStorageClient;
  expect((await cloudTaskLockStatus(client,"0")).locked).toBe(false);
  await expect(cloudTaskGraph(client,"0","up")).rejects.toThrow("100 levels");
});
test("unsupported API status propagates without a success or a local fallback",async()=>{
  const unsupported=Object.assign(new Error("Upgrade the server: operation unsupported"),{status:501});
  const client={transport:{get:async()=>{throw unsupported;},post:async()=>{throw unsupported;},del:async()=>{throw unsupported;}}} as unknown as HasnaStorageClient;
  for(const operation of [()=>cloudLockTask(client,"a","agent"),()=>cloudUnlockTask(client,"a"),()=>cloudAddDependency(client,"a","b"),()=>cloudRemoveDependency(client,"a","b"),()=>cloudGetDependencies(client,"a")]) await expect(operation()).rejects.toThrow("Upgrade the server");
});

test("blank explicit lock agents never fall back to the authenticated principal",async()=>{
  let calls=0;const client={transport:{post:async()=>{calls++;return {success:true};}}} as unknown as HasnaStorageClient;
  await expect(cloudLockTask(client,"a"," ")).rejects.toThrow("must not be blank");
  await expect(cloudUnlockTask(client,"a","")).rejects.toThrow("must not be blank");
  expect(calls).toBe(0);
});
