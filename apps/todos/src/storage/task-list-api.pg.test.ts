import {test,expect} from "bun:test";
import {randomUUID} from "node:crypto";
import {createTodosCloudQueryClient} from "./cloud-client.js";
import {createPostgresTodosStorageAdapter} from "./postgres-adapter.js";
import {handleV1Request,type V1RequestDependencies} from "../server/v1.js";
const pgTest=process.env.TODOS_TEST_PG_URL?test:test.skip;
async function fixture(run:(store:ReturnType<typeof createPostgresTodosStorageAdapter>,client:ReturnType<typeof createTodosCloudQueryClient>,table:string)=>Promise<void>){
 const client=createTodosCloudQueryClient(process.env.TODOS_TEST_PG_URL!,{max:4});const table=`todos_lists_fixture_${randomUUID().replaceAll("-","")}`;
 const store=createPostgresTodosStorageAdapter({client,service:"lists-fixture",tableName:table,cursorTableName:`${table}_cursor`});
 try{await run(store,client,table);}finally{await client.query(`DROP TABLE IF EXISTS ${table},${table}_cursor`);await client.close();}
}
pgTest('fresh signed MCP task-list workflow persists advertised fields and complete pages without client SQLite',async()=>fixture(async(store,client,table)=>{
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
  const created=await call("create_task_list",{name:" MCP list ",status:"completed"});expect(created.isError,text(created)).not.toBe(true);
  const plan=(await store.taskLists.list())[0]!;expect(plan).toMatchObject({name:"MCP list",slug:"mcp-list",status:"completed"});
  const template=await store.tasks.create({title:"paged",task_list_id:plan.id});
  for(let i=1;i<201;i++){const task={...template,id:randomUUID()};await client.query(`INSERT INTO ${table}(service,object_type,object_id,payload,updated_at,version) VALUES ('lists-fixture','tasks',$1,$2::text::jsonb,$3::timestamptz,1)`,[task.id,JSON.stringify(task),task.updated_at]);}
  const detail=await call("get_task_list",{task_list_id:plan.id});expect(detail.isError,text(detail)).not.toBe(true);expect(text(detail)).toContain("Tasks: 201");
  expect(text(await call("list_task_lists",{status:"completed"}))).toContain("MCP list");
  expect(text(await call("list_task_lists",{status:"archived"}))).toContain("No task lists");
  expect((await call("update_task_list",{task_list_id:plan.id,status:"archived"})).isError).not.toBe(true);
  expect(await store.taskLists.get(plan.id)).toMatchObject({status:"archived"});
  expect((await call("delete_task_list",{task_list_id:plan.id})).isError).toBe(true);
  const deleted=await call("delete_task_list",{task_list_id:plan.id,force:true});expect(deleted.isError,text(deleted)).not.toBe(true);expect(JSON.parse(text(deleted)).detached_tasks).toBe(201);
  expect((await store.tasks.get(template.id))?.task_list_id).toBeNull();
  expect(readdirSync(root,{recursive:true}).map(String).filter(path=>/\.(db|sqlite|sqlite3)(?:-wal|-shm|-journal)?$/.test(path))).toEqual([]);
 }finally{await mcp.close();server.stop(true);rmSync(root,{recursive:true,force:true});}
}),60000);
pgTest('preserving task-list deletion refuses nonempty lists and retains task/plan content, histories and project routing',async()=>fixture(async(store,client,table)=>{
 const list=await store.taskLists.create({name:'keep content',status:'completed'});
 const project=await store.projects.create({name:'routing',task_list_id:list.slug});
 const plan=await store.plans.create({name:'plan',task_list_id:list.id});
 const task=await store.tasks.create({title:'task',description:'fixture content',task_list_id:list.id,plan_id:plan.id});
 await store.audit.logTaskChange(task.id,'fixture'); const history=await store.audit.getTaskHistory(task.id);
 await expect(store.taskLists.deletePreserving!(list.id,false)).rejects.toThrow('linked records');
 const receipt=await store.taskLists.deletePreserving!(list.id,true);
 expect(receipt).toMatchObject({deleted:true,detached_tasks:1,detached_plans:1,detached_task_ids:[task.id],detached_plan_ids:[plan.id]});
 expect(await store.tasks.get(task.id)).toMatchObject({title:'task',description:'fixture content',task_list_id:null,plan_id:plan.id,version:task.version+1});
 expect(await store.plans.get(plan.id)).toMatchObject({name:'plan',task_list_id:null});
 expect(await store.projects.get(project.id)).toEqual(project);expect(await store.audit.getTaskHistory(task.id)).toEqual(history);
 await expect(store.tasks.create({title:'stale',task_list_id:list.id})).rejects.toThrow();
 await expect(store.plans.create({name:'stale',task_list_id:list.id})).rejects.toThrow();
 expect(await store.taskLists.deletePreserving!(list.id,true)).toMatchObject({deleted:false,detached_tasks:0,detached_plans:0});
}),20000);
pgTest('task-list final-write failure rolls back every detach',async()=>fixture(async(store,client,table)=>{
 const list=await store.taskLists.create({name:'rollback'});const task=await store.tasks.create({title:'retained',task_list_id:list.id});const plan=await store.plans.create({name:'retained',task_list_id:list.id});
 const fn=`${table}_reject`;await client.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.object_type='task_lists' AND NEW.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'fixture rejected'; END IF; RETURN NEW; END $$`);
 try{await client.query(`CREATE TRIGGER reject_list BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`);await expect(store.taskLists.deletePreserving!(list.id,true)).rejects.toThrow('fixture rejected');expect(await store.tasks.get(task.id)).toEqual(task);expect(await store.plans.get(plan.id)).toEqual(plan);expect(await store.taskLists.get(list.id)).toEqual(list);}finally{await client.query(`DROP TRIGGER reject_list ON ${table}`);await client.query(`DROP FUNCTION ${fn}()`);}
}),20000);
pgTest('task-list HTTP status and deletion validate input, scope and tenant before writes',async()=>fixture(async(store)=>{
 let tid='fixture-tenant';let scopes=['todos:read','todos:write'];
 const deps:V1RequestDependencies={ensureSchema:async()=>{},getStorageAdapter:()=>store,getMachineRegistryTenantId:()=> 'fixture-tenant',getVerifier:()=>({authenticate:async(_headers:Headers,{requiredScopes:needed}:{requiredScopes:string[]})=>needed.every(scope=>scopes.includes(scope))?{ok:true,principal:{kid:'fixture',tid,agent:'fixture',scopes}}:{ok:false,status:403,message:'fixture scope denied',reason:'scope'}}) as any};
 const req=async(path:string,method='GET',body?:unknown)=>{const url=new URL(`http://fixture.test/v1/${path}`);return (await handleV1Request(new Request(url,{method,...(body!==undefined?{body:JSON.stringify(body)}:{})}),url,deps))!;};
 expect((await req('task-lists','POST',{name:'invalid',status:'invented'})).status).toBe(400);
 const response=await req('task-lists','POST',{name:'valid',status:'archived'});expect(response.status).toBe(201);const {task_list:list}=await response.json();expect(list.status).toBe('archived');
 for(const body of [true,[],{force:'yes'}])expect((await req(`task-lists/${list.id}/delete-preserving`,'POST',body)).status).toBe(400);
 expect((await req(`task-lists/${list.id}`,'PATCH',{status:'invented'})).status).toBe(400);
 scopes=['todos:read'];expect((await req(`task-lists/${list.id}/delete-preserving`,'POST',{force:true})).status).toBe(403);
 scopes=['todos:read','todos:write'];tid='other-tenant';for(const [path,method,body] of [['task-lists','GET',undefined],[`task-lists/${list.id}`,'PATCH',{status:'active'}],[`task-lists/${list.id}/delete-preserving`,'POST',{force:true}]] as const)expect((await req(path,method,body)).status).toBe(403);
 expect(await store.taskLists.get(list.id)).toMatchObject({status:'archived'});
}),20000);
pgTest('task and plan membership racing list deletion never create dangling references',async()=>fixture(async(store)=>{
 for(let i=0;i<3;i++){
 const list=await store.taskLists.create({name:`race-${i}`});
 const [deletion,task,plan]=await Promise.allSettled([store.taskLists.deletePreserving!(list.id,true),store.tasks.create({title:'race',task_list_id:list.id}),store.plans.create({name:'race',task_list_id:list.id})]);
 expect(deletion.status).toBe('fulfilled');if(task.status==='fulfilled')expect((await store.tasks.get(task.value.id))?.task_list_id).toBeNull();if(plan.status==='fulfilled')expect((await store.plans.get(plan.value.id))?.task_list_id).toBeNull();
 }
}),20000);
pgTest('snapshot imports referenced lists and plans before tasks and preserves legacy status absence',async()=>fixture(async(store,client,table)=>{
 const list=await store.taskLists.create({name:'snapshot'});const plan=await store.plans.create({name:'snapshot',task_list_id:list.id});const task=await store.tasks.create({title:'snapshot',task_list_id:list.id,plan_id:plan.id});
 const snapshot=await store.sync.exportSnapshot!();delete snapshot.taskLists[0]!.status;
 const other=createPostgresTodosStorageAdapter({client,service:'snapshot-target',tableName:table,cursorTableName:`${table}_cursor`});
 const result=await other.sync.importSnapshot!(snapshot);expect(result.errors).toEqual([]);expect(await other.tasks.get(task.id)).toMatchObject({task_list_id:list.id,plan_id:plan.id});expect(await other.taskLists.get(list.id)).toMatchObject({status:'active'});
 expect(await other.taskLists.getBySlug(list.slug)).toMatchObject({status:'active'});
 expect((await other.taskLists.list()).find(row=>row.id===list.id)).toMatchObject({status:'active'});
 expect(await other.taskLists.update(list.id,{name:'renamed legacy'})).toMatchObject({status:'active',name:'renamed legacy'});
 const exported=await other.sync.exportSnapshot!();expect(exported.taskLists[0]!.status).toBeUndefined();
}),20000);
pgTest('concurrent task-list patches retain independent fields and stale plan-list assignment refuses after deletion',async()=>fixture(async(store)=>{
 const list=await store.taskLists.create({name:'concurrent'});
 await Promise.all([store.taskLists.update(list.id,{name:'accepted'}),store.taskLists.update(list.id,{status:'archived'})]);expect(await store.taskLists.get(list.id)).toMatchObject({name:'accepted',status:'archived'});
 const plan=await store.plans.create({name:'target'});await store.taskLists.deletePreserving!(list.id,true);await expect(store.plans.update(plan.id,{task_list_id:list.id})).rejects.toThrow();expect((await store.plans.get(plan.id))?.task_list_id).toBeNull();
}),20000);
