import { test,expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync,mkdirSync,readdirSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloudQueryTasks,taskTimestamp } from "./task-query-api.js";
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";

async function fixture(run:(cli:(args:string[])=>Promise<any>,state:any)=>Promise<void>) {
  const root=mkdtempSync(join(tmpdir(),"todos-task-query-"));
  const now=new Date();const yesterday=new Date(now);yesterday.setDate(yesterday.getDate()-1);yesterday.setHours(12,0,0,0);
  const project=randomUUID();const other=randomUUID();
  const make=(title:string,extra:any={})=>({id:randomUUID(),short_id:title,title,status:"pending",priority:"medium",project_id:project,assigned_to:"one",agent_id:"creator",due_at:null,archived_at:null,parent_id:null,updated_at:now.toISOString(),...extra});
  const tasks=[make("mine-one"),make("mine-two",{agent_id:"one"}),make("other-project",{project_id:other}),make("yesterday",{status:"completed",updated_at:yesterday.toISOString(),assigned_to:"different"}),make("overdue-subtask",{parent_id:"parent",due_at:"2020-01-01T00:00:00Z"}),make("cancelled-dependency",{status:"cancelled"}),make("old-done",{status:"completed",due_at:"2020-01-01T00:00:00Z",updated_at:"2020-01-01T00:00:00Z"})];
  const requests:URL[]=[];let missingDependency=false;let omitTotal=false;
  const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(req){
    expect(req.method).toBe("GET");expect(req.headers.get("authorization")??req.headers.get("x-api-key")).toContain("fixture-task-query-key");
    const url=new URL(req.url);requests.push(url);
    if(url.pathname==="/v1/projects")return Response.json({projects:[{id:project,name:"fixture-project",path:"/fixture/project"}],total:1});
    if(url.pathname==="/v1/tasks") {
      let found=tasks.filter(t=>!t.archived_at);
      for(const key of ["project_id","status","assigned_to","agent_id"] as const)if(url.searchParams.has(key))found=found.filter(t=>t[key]===url.searchParams.get(key));
      if(url.searchParams.get("include_subtasks")!=="true")found=found.filter(t=>!t.parent_id);
      const offset=Number(url.searchParams.get("offset")??0);return Response.json({tasks:found.slice(offset,offset+1),...(omitTotal?{}:{total:found.length})});
    }
    const match=url.pathname.match(/^\/v1\/tasks\/([^/]+)(\/dependencies)?$/);
    if(match) {
      if(match[2])return Response.json({dependencies:match[1]===tasks[0]!.id?[{task_id:tasks[0]!.id,depends_on:missingDependency?"missing":tasks[1]!.id}]:match[1]===tasks[1]!.id?[{task_id:tasks[1]!.id,depends_on:tasks[5]!.id}]:[],blocked_by:[]});
      const task=tasks.find(t=>t.id===match[1]);return task?Response.json({task}):Response.json({error:"not found"},{status:404});
    }
    return Response.json({error:"missing fixture route"},{status:404});
  }});
  const env=Object.fromEntries(Object.entries(process.env).filter(([key,value])=>value!==undefined&&!/^(HASNA_|TODOS_|DATABASE_URL$|PG|XDG_)/.test(key))) as Record<string,string>;
  env.HOME=root;env.HASNA_STATION=`fixture-${randomUUID()}`;env.HASNA_TODOS_DB_PATH=join(root,"trap.db");
  const config=join(root,".hasna/todos/config");mkdirSync(config,{recursive:true,mode:0o700});writeFileSync(join(config,"credentials"),`HASNA_TODOS_API_URL=${server.url.origin}\nHASNA_TODOS_API_KEY=fixture-task-query-key\n`,{mode:0o600});
  const cli=async(args:string[])=>{
    const proc=Bun.spawn([process.execPath,"src/cli/index.tsx",...args],{cwd:join(import.meta.dir,"../.."),env,stdout:"pipe",stderr:"pipe"});const timer=setTimeout(()=>proc.kill(),20000);
    try {const [stdout,stderr,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);return {stdout,stderr,code};}finally{clearTimeout(timer);}
  };
  try {await run(cli,{project,tasks,requests,missing:()=>{missingDependency=true;},old:()=>{omitTotal=true;}});expect(readdirSync(root,{recursive:true}).map(String).filter(p=>/\.(db|sqlite|sqlite3)(-wal|-shm)?$/.test(p))).toEqual([]);}
  finally {server.stop(true);rmSync(root,{recursive:true,force:true});}
}
test("saved-account CLI mine exhausts pages, merges assignment/creator and scopes project without SQLite",async()=>{
  await fixture(async(cli,state)=>{
    const result=await cli(["--project","fixture-project","mine","one","--json"]);expect(result.code,result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).map((t:any)=>t.title)).toEqual(["mine-one","mine-two","cancelled-dependency","old-done"]);
    expect(state.requests.some((u:URL)=>u.searchParams.get("offset")==="1")).toBe(true);
    const before=state.requests.length;expect((await cli(["mine"," ","--json"])).code).not.toBe(0);expect(state.requests.length).toBe(before);
  });
},30000);
test("blocked and overdue use all matching pages and truthful dependency state",async()=>{
  await fixture(async(cli,state)=>{
    const blocked=await cli(["blocked","--project","fixture-project","--json"]);expect(blocked.code,blocked.stderr).toBe(0);expect(JSON.parse(blocked.stdout).map((t:any)=>t.title)).toEqual(["mine-one"]);
    const overdue=await cli(["overdue","--project",state.project,"--json"]);expect(overdue.code,overdue.stderr).toBe(0);expect(JSON.parse(overdue.stdout).map((t:any)=>t.title)).toEqual(["overdue-subtask"]);
    state.missing();const bad=await cli(["blocked","--json"]);expect(bad.code).not.toBe(0);expect(bad.stderr).toContain("unavailable");expect(bad.stdout).not.toContain("No blocked tasks");
  });
},30000);
test("today and yesterday read all activity pages and retain date groups",async()=>{
  await fixture(async(cli,state)=>{
    const today=await cli(["today","--json"]);expect(today.code,today.stderr).toBe(0);const current=JSON.parse(today.stdout);expect(current.changed.some((t:any)=>t.title==="overdue-subtask")).toBe(true);expect(current.completed).toEqual([]);
    const previous=await cli(["yesterday","--json"]);expect(previous.code,previous.stderr).toBe(0);expect(JSON.parse(previous.stdout).completed.map((t:any)=>t.title)).toEqual(["yesterday"]);
    state.old();const old=await cli(["today","--json"]);expect(old.code).not.toBe(0);expect(old.stderr).toContain("upgrade the Todos API");
  });
},30000);
test("pagination refuses old, changing, stalled, repeated or widened task pages",async()=>{
  for(const pages of [
    [{tasks:[]}], [{tasks:[{id:"a"}],total:2},{tasks:[],total:2}], [{tasks:[{id:"a"}],total:2},{tasks:[{id:"b"}],total:3}], [{tasks:[{id:"a"}],total:2},{tasks:[{id:"a"}],total:2}], [{tasks:[{id:"a",project_id:"wrong"}],total:1}],
  ]) {let i=0;const client={list:async()=>({raw:pages[i++]})} as unknown as HasnaStorageClient;await expect(cloudQueryTasks(client,pages.length===1&&pages[0]!.total===1?{project_id:"wanted"}:{})).rejects.toThrow();}
  expect(taskTimestamp("2026-09-07 12:00:00")).toBe(Date.parse("2026-09-07T12:00:00Z"));
});
