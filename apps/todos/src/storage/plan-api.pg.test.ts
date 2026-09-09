import {test,expect} from "bun:test";
import {randomUUID} from "node:crypto";
import {createTodosCloudQueryClient} from "./cloud-client.js";
import {createPostgresTodosStorageAdapter} from "./postgres-adapter.js";
import {handleV1Request,type V1RequestDependencies} from "../server/v1.js";
const pgTest=process.env.TODOS_TEST_PG_URL?test:test.skip;
async function fixture(run:(store:ReturnType<typeof createPostgresTodosStorageAdapter>,client:ReturnType<typeof createTodosCloudQueryClient>,table:string)=>Promise<void>){
 const client=createTodosCloudQueryClient(process.env.TODOS_TEST_PG_URL!,{max:4});const table=`todos_plans_fixture_${randomUUID().replaceAll("-","")}`;
 const store=createPostgresTodosStorageAdapter({client,service:"plans-fixture",tableName:table,cursorTableName:`${table}_cursor`});
 try{await run(store,client,table);}finally{await client.query(`DROP TABLE IF EXISTS ${table},${table}_cursor`);await client.close();}
}
pgTest('plan dates/status and preserving deletion retain linked content, comments, histories and unrelated service rows',async()=>fixture(async(store,client,table)=>{
 const list=await store.taskLists.create({name:'retained list'});
 const plan=await store.plans.create({name:'future',task_list_id:list.id,status:'planning',start_date:'2028-02-29',end_date:'2028-03-01'});
 expect(plan).toMatchObject({status:'planning',start_date:'2028-02-29',end_date:'2028-03-01'});
 await expect(store.plans.update(plan.id,{end_date:'2028-02-28'})).rejects.toThrow('precede');
 const task=await store.tasks.create({title:'retained',plan_id:plan.id,description:'fixture content'});
 await store.audit.addComment({task_id:task.id,content:'fixture history'});
 const comments=await store.audit.getComments(task.id);
 await store.audit.logTaskChange(task.id,'fixture_history');
 const history=await store.audit.getTaskHistory(task.id);
 await store.plans.addComment!({plan_id:plan.id,content:'preserved plan notes'});
 const planComments=await store.plans.getComments!(plan.id);
 await expect(store.plans.deletePreserving!(plan.id,false)).rejects.toThrow('linked records');
 expect(await store.plans.get(plan.id)).not.toBeNull();
 const foreign=createPostgresTodosStorageAdapter({client,service:'foreign-fixture',tableName:table,cursorTableName:`${table}_cursor`});
 const other=await foreign.plans.create({name:'foreign'});
 expect(await foreign.plans.deletePreserving!(plan.id,true)).toMatchObject({deleted:false,detached_tasks:0});
 const receipt=await store.plans.deletePreserving!(plan.id,true);
 expect(receipt).toMatchObject({deleted:true,detached_tasks:1,detached_task_ids:[task.id],detached_task_list_ids:[list.id],detached_task_lists:1});
 expect(await store.taskLists.get(list.id)).toEqual(list);
 expect(await store.tasks.get(task.id)).toMatchObject({title:'retained',description:'fixture content',plan_id:null,version:task.version+1});
 expect(await store.audit.getComments(task.id)).toEqual(comments);
 expect(await store.audit.getTaskHistory(task.id)).toEqual(history);
 const retained=await client.query<{payload:unknown}>(`SELECT payload FROM ${table} WHERE service='plans-fixture' AND object_type='plan_comments' AND deleted_at IS NULL`);
 expect(retained.rows.map(row=>row.payload)).toEqual(planComments);
 expect(await foreign.plans.get(other.id)).not.toBeNull();
 await expect(store.tasks.create({title:'stale membership',plan_id:plan.id})).rejects.toThrow();
 expect(await store.plans.deletePreserving!(plan.id,true)).toMatchObject({deleted:false,detached_tasks:0});
}),20000);
pgTest('preserving deletion rolls back all detaches when the final plan write fails',async()=>fixture(async(store,client,table)=>{
 const plan=await store.plans.create({name:'rollback'});const task=await store.tasks.create({title:'keep',plan_id:plan.id});
 const functionName=`${table}_reject`;
 await client.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.object_type='plans' AND NEW.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'fixture rejected plan write'; END IF; RETURN NEW; END $$`);
 try{
 await client.query(`CREATE TRIGGER reject_plan BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
 await expect(store.plans.deletePreserving!(plan.id,true)).rejects.toThrow('fixture rejected');
 expect(await store.tasks.get(task.id)).toEqual(task);expect(await store.plans.get(plan.id)).toEqual(plan);
 }finally{await client.query(`DROP TRIGGER reject_plan ON ${table}`);await client.query(`DROP FUNCTION ${functionName}()`);}
}),20000);

pgTest('fresh signed MCP plan workflow persists advertised fields and complete pages without client SQLite',async()=>fixture(async(store,client,table)=>{
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
  const created=await call("create_plan",{name:" MCP plan ",slug:"MCP Plan",status:"planning",start_date:"2028-02-29",end_date:"2028-03-01"});expect(created.isError,text(created)).not.toBe(true);
  const plan=(await store.plans.list())[0]!;expect(plan).toMatchObject({name:"MCP plan",slug:"mcp-plan",status:"planning",start_date:"2028-02-29"});
  const template=await store.tasks.create({title:"paged",plan_id:plan.id});
  for(let i=1;i<201;i++){const task={...template,id:randomUUID()};await client.query(`INSERT INTO ${table}(service,object_type,object_id,payload,updated_at,version) VALUES ('plans-fixture','tasks',$1,$2::text::jsonb,$3::timestamptz,1)`,[task.id,JSON.stringify(task),task.updated_at]);}
  const detail=await call("get_plan",{plan_id:plan.id});expect(detail.isError,text(detail)).not.toBe(true);expect(text(detail)).toContain("Tasks: 201");
  expect(text(await call("list_plans",{status:"planning"}))).toContain("MCP plan");
  expect(text(await call("list_plans",{status:"cancelled"}))).toContain("No plans");
  expect((await call("update_plan",{plan_id:plan.id,status:"cancelled",end_date:"2028-03-02"})).isError).not.toBe(true);
  expect(await store.plans.get(plan.id)).toMatchObject({status:"cancelled",end_date:"2028-03-02"});
  expect((await call("delete_plan",{plan_id:plan.id})).isError).toBe(true);
  const deleted=await call("delete_plan",{plan_id:plan.id,force:true});expect(deleted.isError,text(deleted)).not.toBe(true);expect(JSON.parse(text(deleted)).detached_tasks).toBe(201);
  expect((await store.tasks.get(template.id))?.plan_id).toBeNull();
  expect(readdirSync(root,{recursive:true}).map(String).filter(path=>/\.(db|sqlite|sqlite3)(?:-wal|-shm|-journal)?$/.test(path))).toEqual([]);
 }finally{await mcp.close();server.stop(true);rmSync(root,{recursive:true,force:true});}
}),60000);
pgTest('actual plan HTTP routes enforce tenant/write authority and validate schedule before persistence',async()=>fixture(async(store)=>{
 let tid='fixture-tenant';let scopes=['todos:read','todos:write'];
 const deps:V1RequestDependencies={ensureSchema:async()=>{},getStorageAdapter:()=>store,getMachineRegistryTenantId:()=> 'fixture-tenant',getVerifier:()=>({authenticate:async(_headers:Headers,{requiredScopes:needed}:{requiredScopes:string[]})=>needed.every(scope=>scopes.includes(scope))?{ok:true,principal:{kid:'fixture',tid,agent:'fixture',scopes}}:{ok:false,status:403,message:'fixture scope denied',reason:'scope'}}) as any};
 const req=async(path:string,method='GET',body?:unknown)=>{const url=new URL(`http://fixture.test/v1/${path}`);return (await handleV1Request(new Request(url,{method,...(body!==undefined?{body:JSON.stringify(body)}:{})}),url,deps))!;};
 for(const body of [{name:'invalid',start_date:'2027-02-29'},{name:'invalid',start_date:'2028-03-01',end_date:'2028-02-29'}])expect((await req('plans','POST',body)).status).toBe(400);
 expect(await store.plans.list()).toEqual([]);
 const created=await req('plans','POST',{name:'http',status:'planning',start_date:'2028-02-29',end_date:'2028-03-01'});expect(created.status).toBe(201);const {plan}=await created.json();
 expect((await req(`plans/${plan.id}`,'PATCH',{end_date:'2028-02-28'})).status).toBe(400);
 for(const body of [true,[],{force:'yes'}])expect((await req(`plans/${plan.id}/delete-preserving`,'POST',body)).status).toBe(400);
 scopes=['todos:read'];expect((await req(`plans/${plan.id}/delete-preserving`,'POST',{force:true})).status).toBe(403);
 scopes=['todos:read','todos:write'];tid='other-tenant';expect((await req(`plans/${plan.id}/delete-preserving`,'POST',{force:true})).status).toBe(403);
 expect(await store.plans.get(plan.id)).toMatchObject({start_date:'2028-02-29',end_date:'2028-03-01'});
}),20000);
pgTest('concurrent task membership and plan deletion never leave a live dangling membership',async()=>fixture(async(store)=>{
 for(let i=0;i<5;i++){
 const plan=await store.plans.create({name:`race-${i}`});
 const [deletion,creation]=await Promise.allSettled([store.plans.deletePreserving!(plan.id,true),store.tasks.create({title:`race task ${i}`,plan_id:plan.id})]);
 expect(deletion.status).toBe('fulfilled');expect(await store.plans.get(plan.id)).toBeNull();
 if(creation.status==='fulfilled')expect((await store.tasks.get(creation.value.id))?.plan_id).toBeNull();
 }
}),20000);
pgTest('concurrent full-plan patches from one observed revision cannot overwrite accepted fields or schedules',async()=>fixture(async(store,client,table)=>{
 const plan=await store.plans.create({name:'concurrent',start_date:'2028-02-01',end_date:'2028-02-29'});
 let reads=0;let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
 const wrapped={...client,query:async(sql:string,params?:unknown[])=>{
  const result=await client.query(sql,params);
  if(sql.includes('SELECT object_type, object_id, payload, updated_at')&&params?.[1]==='plans'&&params?.[2]===plan.id){reads++;if(reads===2)release();await barrier;}
  return result;
 }} as typeof client;
 const concurrent=createPostgresTodosStorageAdapter({client:wrapped,service:'plans-fixture',tableName:table,cursorTableName:`${table}_cursor`});
 const results=await Promise.allSettled([concurrent.plans.update(plan.id,{name:'accepted name'}),concurrent.plans.update(plan.id,{end_date:'2028-03-01'})]);
 expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 const failure=results.find(result=>result.status==='rejected') as PromiseRejectedResult;expect(failure.reason.constructor.name).toBe('PlanRevisionConflictError');
 const accepted=(results.find(result=>result.status==='fulfilled') as PromiseFulfilledResult<any>).value;
 expect(await store.plans.get(plan.id)).toEqual(accepted);
 expect(Date.parse(accepted.updated_at)).toBeGreaterThan(Date.parse(plan.updated_at));
}),20000);
