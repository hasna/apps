import {test,expect,setDefaultTimeout} from "bun:test";
import {randomUUID} from "node:crypto";
// Spawns the CLI against a Postgres-backed fixture; bun's 5s default is too tight.
setDefaultTimeout(60_000);
import {createTodosCloudQueryClient} from "./cloud-client.js";
import {createPostgresTodosStorageAdapter} from "./postgres-adapter.js";
import {handleV1Request,type V1RequestDependencies} from "../server/v1.js";
const pgTest=process.env.TODOS_TEST_PG_URL?test:test.skip;
async function fixture(run:(store:ReturnType<typeof createPostgresTodosStorageAdapter>,client:ReturnType<typeof createTodosCloudQueryClient>,table:string)=>Promise<void>){
 const client=createTodosCloudQueryClient(process.env.TODOS_TEST_PG_URL!,{max:4});const table=`todos_projects_fixture_${randomUUID().replaceAll("-","")}`;
 const store=createPostgresTodosStorageAdapter({client,service:"projects-fixture",tableName:table,cursorTableName:`${table}_cursor`});
 try{await run(store,client,table);}finally{await client.query(`DROP TABLE IF EXISTS ${table},${table}_cursor`);await client.close();}
}
pgTest("project deletion confirms nonempty scope, preserves all content and rejects stale membership writers",async()=>fixture(async(store,client,table)=>{
 const project=await store.projects.create({name:"fixture",path:"/fixture",status:"on_hold",short_id:"FX",metadata:{nested:{enabled:true}}});
 const task=await store.tasks.create({title:"preserve task",project_id:project.id});
 const plan=await store.plans!.create({name:"preserve plan",project_id:project.id});
 const list=await store.taskLists!.create({name:"preserve list",project_id:project.id});
 const child=await store.projects.create({name:"child",path:"/child",parent_id:project.id});
 await expect(store.projects.deletePreserving!(project.id,false)).rejects.toThrow("linked records");
 await expect(store.projects.delete(project.id)).rejects.toThrow("linked records");
 await expect(store.projects.deletePreserving!(project.id,true,undefined,true)).rejects.toThrow();
 expect(await store.projects.get(project.id)).toMatchObject({status:"on_hold",short_id:"FX",metadata:{nested:{enabled:true}}});
 expect(await store.projects.deletePreserving!(project.id,true)).toMatchObject({deleted:true,preserved_tasks:1,preserved_plans:1,detached_task_lists:1,detached_child_projects:1});
 expect(await store.projects.get(project.id)).toBeNull();
 expect(await store.tasks.get(task.id)).toMatchObject({title:task.title,project_id:null,version:task.version+1});
 expect(await store.plans!.get(plan.id)).toMatchObject({name:plan.name,project_id:null});
 expect(await store.taskLists!.get(list.id)).toMatchObject({name:list.name,project_id:null});
 expect(await store.projects.get(child.id)).toMatchObject({parent_id:null});
 await expect(store.tasks.update(task.id,{project_id:project.id,version:task.version})).rejects.toThrow();
 await expect(store.plans!.create({name:"late",project_id:project.id})).rejects.toThrow("Project not found");
 expect((await store.projects.deletePreserving!(project.id,true)).deleted).toBe(false);
 const stored=await client.query<{deleted_at:unknown}>(`SELECT deleted_at FROM ${table} WHERE service='projects-fixture' AND object_type='projects' AND object_id=$1`,[project.id]);expect(stored.rows[0]?.deleted_at).toBeTruthy();
}),20000);
pgTest("late transaction failure rolls back detaches and project tombstone",async()=>fixture(async(store,client,table)=>{
 const project=await store.projects.create({name:"rollback",path:"/rollback"});const task=await store.tasks.create({title:"keep",project_id:project.id});
 await client.query(`ALTER TABLE ${table} ADD CONSTRAINT fixture_no_project_tombstone CHECK (object_type <> 'projects' OR deleted_at IS NULL)`);
 await expect(store.projects.deletePreserving!(project.id,true)).rejects.toThrow();
 expect(await store.projects.get(project.id)).not.toBeNull();expect(await store.tasks.get(task.id)).toMatchObject({project_id:project.id,version:task.version});
}),20000);
pgTest("concurrent project deletion and new project membership never leave dangling tasks",async()=>fixture(async(store)=>{
 for(let attempt=0;attempt<3;attempt++){
 const project=await store.projects.create({name:`race${attempt}`,path:`/race${attempt}`});
 const results=await Promise.allSettled([store.tasks.create({title:"racing child",project_id:project.id}),store.projects.deletePreserving!(project.id,true)]);
 expect(results[1]?.status).toBe("fulfilled");
 const task=results[0];if(task?.status==='fulfilled')expect(await store.tasks.get(task.value.id)).toMatchObject({project_id:null});
 expect((await store.tasks.list({project_id:project.id,include_subtasks:true}))).toHaveLength(0);
 }
}),20000);
pgTest("real handler enforces read/write and configured tenant before project registry operations",async()=>fixture(async(store)=>{
 let scopes=["todos:read","todos:write"],tid="fixture-tenant";
 const deps:V1RequestDependencies={ensureSchema:async()=>{},getStorageAdapter:()=>store,getMachineRegistryTenantId:()=>"fixture-tenant",getVerifier:()=>({authenticate:async(_headers:unknown,options:any)=>options.requiredScopes.every((scope:string)=>scopes.includes(scope))?{ok:true,principal:{kid:"fixture",tid,agent:"fixture",scopes}}:{ok:false,status:403,message:"fixture scope denied",reason:"scope"}}) as any};
 const req=async(path:string,method="GET",body?:unknown)=>{const url=new URL(`http://fixture.test/v1/${path}`);return (await handleV1Request(new Request(url,{method,...(body?{body:JSON.stringify(body)}:{})}),url,deps))!;};
 const created=await req("projects","POST",{name:"wire",path:"/wire",status:"archived",metadata:{test:true},short_id:"WIRE"});expect(created.status).toBe(201);const {project}=await created.json();
 expect(project).toMatchObject({status:"archived",metadata:{test:true},short_id:"WIRE"});
 scopes=["todos:read"];expect((await req(`projects/${project.id}`,"PATCH",{name:"denied"})).status).toBe(403);expect((await req(`projects/${project.id}/delete-preserving`,"POST",{force:true})).status).toBe(403);
 scopes=["todos:read","todos:write"];tid="other-tenant";expect((await req("projects")).status).toBe(403);expect((await req("projects","POST",{name:"foreign",path:"/foreign"})).status).toBe(403);
 tid="fixture-tenant";expect((await req(`projects/${project.id}`,"PATCH",{metadata:[]})).status).toBe(400);expect((await req(`projects/${project.id}/delete-preserving`,"POST",{force:"yes"})).status).toBe(400);
 expect(await store.projects.get(project.id)).toMatchObject({name:"wire"});
}),20000);

pgTest("fresh MCP and CLI use signed saved credentials for project CRUD and complete task counts without a client database",async()=>fixture(async(store,client,table)=>{
 const {mintApiKey,verifyApiKey}=await import("@hasna/contracts/auth");
 const {Client}=await import("@modelcontextprotocol/sdk/client/index.js");
 const {StdioClientTransport}=await import("@modelcontextprotocol/sdk/client/stdio.js");
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync,readdirSync,chmodSync}=await import("node:fs");
 const {join}=await import("node:path");const {tmpdir}=await import("node:os");
 const root=mkdtempSync(join(tmpdir(),"todos-project-api-"));chmodSync(root,0o700);
 const signingSecret=randomUUID()+randomUUID();const key=mintApiKey({app:"todos",scopes:["todos:read","todos:write"],signingSecret,agent:"fixture",tid:"fixture-tenant"});
 const verifier=verifyApiKey({app:"todos",signingSecret,keyStatus:async(kid:string)=>kid===key.kid?"active":"unknown"});
 const deps:V1RequestDependencies={ensureSchema:async()=>{},getStorageAdapter:()=>store,getMachineRegistryTenantId:()=>"fixture-tenant",getVerifier:()=>verifier};
 const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>(await handleV1Request(req,new URL(req.url),deps))??new Response("Not found",{status:404})});
 const config=join(root,".hasna/todos/config");mkdirSync(config,{recursive:true,mode:0o700});writeFileSync(join(config,"credentials"),`HASNA_TODOS_API_URL=${server.url.origin}\nHASNA_TODOS_API_KEY=${key.token}\n`,{mode:0o600});
 const env={PATH:process.env.PATH??"",HOME:root,USERPROFILE:root,HASNA_STATION:`fixture-${randomUUID()}`,TMPDIR:root,NO_COLOR:"1",TODOS_PROFILE:"full"};
 const mcp=new Client({name:"project-fixture",version:"1"});const transport=new StdioClientTransport({command:process.execPath,args:["--no-env-file","src/mcp/index.ts","--profile","full"],cwd:join(import.meta.dir,"../.."),env,stderr:"pipe"});
 const text=(value:any)=>value.content.map((item:any)=>item.text??"").join("\n");
 try{
  expect((await fetch(new URL("/v1/projects",server.url))).status).toBe(401);
  await mcp.connect(transport);const call=(name:string,args:any)=>mcp.callTool({name,arguments:args});
  const created=await call("create_project",{name:"MCP fixture",path:"/fixture/mcp",status:"on_hold",short_id:"MCP-FIX",metadata:{nested:{value:2}}});expect(created.isError,text(created)).not.toBe(true);
  const project=(await store.projects.list())[0]!;expect(project).toMatchObject({status:"on_hold",short_id:"MCP-FIX",metadata:{nested:{value:2}}});
  const template=await store.tasks.create({title:"counted task",project_id:project.id});
  for(let n=1;n<=200;n++){
   const task={...template,id:randomUUID(),short_id:`FIX-${n}`,title:`counted task ${n}`};
   await client.query(`INSERT INTO ${table}(service,object_type,object_id,payload,updated_at,version) VALUES ('projects-fixture','tasks',$1,$2::text::jsonb,$3::timestamptz,1)`,[task.id,JSON.stringify(task),task.updated_at]);
  }
  const details=await call("get_project",{project_id:"MCP-FIX"});expect(details.isError,text(details)).not.toBe(true);expect(text(details)).toContain("Tasks:       201");
  const updated=await call("update_project",{project_id:project.id,status:"archived",metadata:{saved:true}});expect(updated.isError,text(updated)).not.toBe(true);expect(await store.projects.get(project.id)).toMatchObject({status:"archived",metadata:{saved:true}});
  expect(text(await call("list_projects",{status:"archived"}))).toContain("MCP fixture");
  expect((await call("delete_project",{project_id:project.id})).isError).toBe(true);
  const deleted=await call("delete_project",{project_id:project.id,force:true});expect(deleted.isError,text(deleted)).not.toBe(true);expect(JSON.parse(text(deleted))).toMatchObject({deleted:true,preserved_tasks:201});
  const panelProject=await store.projects.create({name:"Panel fixture",path:"/fixture/panel"});await store.tasks.create({title:"panel task",project_id:panelProject.id});
  const proc=Bun.spawn([process.execPath,"--no-env-file","src/cli/index.tsx","project-panel","--project",panelProject.id,"--json"],{cwd:join(import.meta.dir,"../.."),env,stdout:"pipe",stderr:"pipe"});
  const output=await new Response(proc.stdout).text();const stderr=await new Response(proc.stderr).text();expect(await proc.exited,stderr).toBe(0);expect(JSON.parse(output).metrics.find((metric:any)=>metric.id==="total_tasks").value).toBe(1);
  expect(readdirSync(root,{recursive:true}).map(String).filter(path=>/\.(db|sqlite|sqlite3)(?:-wal|-shm|-journal)?$/.test(path))).toEqual([]);
 }finally{await mcp.close();server.stop(true);rmSync(root,{recursive:true,force:true});}
}),60000);

pgTest("fresh snapshot imports nested projects before linked records and refuses unsafe project tombstones before writes", async () => fixture(async (source) => fixture(async (target) => {
 const parent = await source.projects.create({name:"import parent",path:"/import-parent"});
 const child = await source.projects.create({name:"import child",path:"/import-child",parent_id:parent.id});
 const task = await source.tasks.create({title:"imported content",project_id:child.id});
 const snapshot = await source.sync!.exportSnapshot();
 snapshot.projects.reverse();
 const duplicate = await target.sync!.importSnapshot({...snapshot,projects:[...snapshot.projects,{...parent,task_list_id:"duplicate-identity"}]});
 expect(duplicate.errors).toEqual(["Snapshot contains duplicate project identities"]);
 expect(await target.projects.list()).toEqual([]);
 const receipt = await target.sync!.importSnapshot(snapshot);
 expect(receipt.errors).toEqual([]);
 expect(await target.tasks.get(task.id)).toMatchObject({project_id:child.id,title:task.title});
 expect(await target.projects.get(child.id)).toMatchObject({parent_id:parent.id});
 const rejected = await target.sync!.importSnapshot({...snapshot,tombstones:[{object_type:"projects",object_id:child.id,deleted_at:new Date().toISOString()}]});
 expect(rejected.errors).toEqual(["Project tombstones require explicit reference-preserving project deletion"]);
 expect(rejected.inserted + rejected.updated + rejected.deleted!).toBe(0);
 expect(await target.projects.get(child.id)).not.toBeNull();
 expect(await target.tasks.get(task.id)).toMatchObject({project_id:child.id});
})), 20000);
