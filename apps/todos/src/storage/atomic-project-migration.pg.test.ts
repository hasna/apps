import { test, expect } from 'bun:test';
import { createTodosCloudQueryClient } from './cloud-client.js';
import { createPostgresTodosStorageAdapter } from './postgres-adapter.js';
import { createAtomicProjectMigration, atomicMigrationHash } from './atomic-project-migration.js';
const pg = process.env.TODOS_TEST_PG_URL ? test : test.skip;
pg('atomic migration preserves newer live projects and durably replays historical evidence', async () => {
 const client=createTodosCloudQueryClient(process.env.TODOS_TEST_PG_URL!,{max:4});
 const table='todos_atomic_'+crypto.randomUUID().replaceAll('-','');
 const store=createPostgresTodosStorageAdapter({client,tableName:table,cursorTableName:table+'_c',service:'fixture'});
 try {
 const project=await store.projects.create({name:'fixture',path:'/fixture'});
 const migration=createAtomicProjectMigration({client,table,service:'fixture',ensureSchema:async()=>{await store.projects.list();}});
 const snapshot={projects:[],tasks:[],plans:[],taskLists:[],auditHistory:[],tombstones:[{object_type:'projects',object_id:project.id,deleted_at:'2000-01-01T00:00:00.000Z',updated_at:'2000-01-01T00:00:00.000Z',payload:{id:project.id,name:'original preserved'}}]};
 const request={schema_version:1 as const,operation_id:crypto.randomUUID(),expected_authority:{tenant_id:'fixture',kid:'fixture-key',deployment_id:'11111111-1111-4111-8111-111111111111'},snapshot,snapshot_hash:atomicMigrationHash(snapshot)};
 const result=await migration.apply(request);
 expect(result.records[0]?.outcome).toBe('superseded');
 expect(await store.projects.get(project.id)).toMatchObject({name:'fixture'});
 const restarted=createAtomicProjectMigration({client,table,service:'fixture',ensureSchema:async()=>{await store.projects.list();}});
 expect(await restarted.apply(request)).toEqual(result);
 expect(JSON.stringify(await store.sync.exportSnapshot!())).not.toContain('original preserved');
 await expect(migration.apply({...request,snapshot:{...snapshot,source:'changed'},snapshot_hash:atomicMigrationHash({...snapshot,source:'changed'})})).rejects.toThrow('operation');
 } finally {await client.query(`DROP TABLE IF EXISTS ${table},${table}_c`);await client.close();}
},20000);

pg('newer deletion preserves linked content/history, journals detaches, and rolls back late failure',async()=>{
 const client=createTodosCloudQueryClient(process.env.TODOS_TEST_PG_URL!,{max:4});const table='todos_atomic_'+crypto.randomUUID().replaceAll('-','');
 const store=createPostgresTodosStorageAdapter({client,tableName:table,cursorTableName:table+'_c',service:'fixture'});
 try{
 const project=await store.projects.create({name:'fixture',path:'/fixture'});const task=await store.tasks.create({title:'retained content',project_id:project.id});
 const stamp='2099-01-01T00:00:00.000Z';
 const snapshot={tombstones:[{object_type:'projects',object_id:project.id,deleted_at:stamp,updated_at:stamp,payload:project}]};
 const migration=createAtomicProjectMigration({client,table,service:'fixture',ensureSchema:async()=>{await store.projects.list();}});
 const request={schema_version:1 as const,operation_id:crypto.randomUUID(),expected_authority:{tenant_id:'fixture',kid:'fixture-key',deployment_id:'11111111-1111-4111-8111-111111111111'},snapshot,snapshot_hash:atomicMigrationHash(snapshot)};
 await client.query(`ALTER TABLE ${table} ADD CONSTRAINT fixture_block_journal CHECK(object_type<>'atomic_project_migrations')`);
 await expect(migration.apply(request)).rejects.toThrow();
 expect(await store.projects.get(project.id)).not.toBeNull();expect(await store.tasks.get(task.id)).toMatchObject({project_id:project.id,version:task.version});
 await client.query(`ALTER TABLE ${table} DROP CONSTRAINT fixture_block_journal`);
 const result=await migration.apply(request);
 expect(result.records.map(r=>r.outcome).sort()).toEqual(['deleted','detached']);
 expect(await store.tasks.get(task.id)).toMatchObject({title:task.title,project_id:null,version:task.version+1});
 expect(await store.projects.get(project.id)).toBeNull();
 const journal=await client.query<{payload:any}>(`SELECT payload FROM ${table} WHERE object_type='atomic_project_migrations'`);
 expect(journal.rows[0]!.payload.before.find((r:any)=>r.object_id===task.id).payload.project_id).toBe(project.id);
 expect(await migration.apply(request)).toEqual(result);
 }finally{await client.query(`DROP TABLE IF EXISTS ${table},${table}_c`);await client.close();}
},20000);

pg('clock ties, higher versions, unsupported families and newer linked writes are explicit conflicts',async()=>{
 const client=createTodosCloudQueryClient(process.env.TODOS_TEST_PG_URL!,{max:4});const table='todos_atomic_'+crypto.randomUUID().replaceAll('-','');
 const store=createPostgresTodosStorageAdapter({client,tableName:table,cursorTableName:table+'_c',service:'fixture'});
 try{
 const project=await store.projects.create({name:'fixture',path:'/fixture'});
 const migration=store.atomicProjectMigration!;
 const apply=(snapshot:Record<string,unknown>)=>migration.apply({schema_version:1,operation_id:crypto.randomUUID(),expected_authority:{tenant_id:'fixture',kid:'fixture-key',deployment_id:'11111111-1111-4111-8111-111111111111'},snapshot,snapshot_hash:atomicMigrationHash(snapshot)});
 await expect(apply({projects:[{...project,name:'tie divergence'}]})).rejects.toThrow('equal-clock');
 await expect(apply({machines:[{id:'unsupported'}]})).rejects.toThrow('Unsupported');
 expect(await store.projects.get(project.id)).toMatchObject({name:'fixture'});
 const higher={...project,name:'higher version',version:1};
 expect((await apply({projects:[higher]})).records[0]?.outcome).toBe('updated');
 const task=await store.tasks.create({title:'newer task',project_id:project.id});
 const clock=new Date(Date.parse(task.updated_at)+1000).toISOString();
 await client.query(`UPDATE ${table} SET updated_at=$2::timestamptz,payload=jsonb_set(payload,'{updated_at}',to_jsonb($2::text)) WHERE object_id=$1`,[task.id,new Date(Date.parse(clock)+1000).toISOString()]);
 await expect(apply({tombstones:[{object_type:'projects',object_id:project.id,deleted_at:clock,updated_at:clock,payload:higher}]})).rejects.toThrow('newer linked');
 expect(await store.projects.get(project.id)).not.toBeNull();
 expect(await store.tasks.get(task.id)).toMatchObject({project_id:project.id});
 }finally{await client.query(`DROP TABLE IF EXISTS ${table},${table}_c`);await client.close();}
},20000);

pg('actual HTTP migration verifies deployment tenant, key authority and write scope before any mutation',async()=>{
 const {handleV1Request}=await import('../server/v1.js');
 const client=createTodosCloudQueryClient(process.env.TODOS_TEST_PG_URL!,{max:4});const table='todos_atomic_'+crypto.randomUUID().replaceAll('-','');
 const store=createPostgresTodosStorageAdapter({client,tableName:table,cursorTableName:table+'_c',service:'fixture'});
 try{
 const project=await store.projects.create({name:'fixture',path:'/fixture'});
 const {mintApiKey,verifyApiKey}=await import('@hasna/contracts/auth');
 const signingSecret=crypto.randomUUID()+crypto.randomUUID();
 const mint=(tid:string,scopes:string[])=>mintApiKey({app:'todos',scopes,signingSecret,tid,agent:'fixture'});
 const admin=mint('fixture',['todos:read','todos:write','todos:migrate']);
 const ordinary=mint('fixture',['todos:read','todos:write']);
 const foreign=mint('foreign',['todos:read','todos:write','todos:migrate']);
 const reader=mint('fixture',['todos:read','todos:migrate']);
 const keys=new Set([admin.kid,ordinary.kid,foreign.kid,reader.kid]);
 const verifier=verifyApiKey({app:'todos',signingSecret,keyStatus:async(kid:string)=>keys.has(kid)?'active':'unknown'});
 let token=admin.token;
 const deps={ensureSchema:async()=>{},getStorageAdapter:()=>store,getMachineRegistryTenantId:()=> 'fixture',getAtomicMigrationDeploymentId:()=> '11111111-1111-4111-8111-111111111111',getVerifier:()=>verifier};
 const url=new URL('http://fixture.test/v1/project-migrations');
 const call=async(body?:unknown)=> (await handleV1Request(new Request(url,{headers:{'x-api-key':token},method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})}),url,deps))!;
 const cap=await (await call()).json();expect(cap.authority).toEqual({tenant_id:'fixture',kid:admin.kid,deployment_id:'11111111-1111-4111-8111-111111111111'});
 const snapshot={projects:[project]};const request={schema_version:1,operation_id:crypto.randomUUID(),expected_authority:cap.authority,snapshot,snapshot_hash:atomicMigrationHash(snapshot)};
 token=ordinary.token;expect((await call(request)).status).toBe(403);
 token=admin.token;expect((await call({...request,expected_authority:{...cap.authority,deployment_id:'22222222-2222-4222-8222-222222222222'}})).status).toBe(409);
 expect((await call({...request,expected_authority:{...cap.authority,kid:ordinary.kid}})).status).toBe(409);
 token=foreign.token;expect((await call(request)).status).toBe(403);
 token=reader.token;expect((await call(request)).status).toBe(403);
 token=admin.token;expect((await call(request)).status).toBe(200);
 const journals=await client.query<{object_id:string}>(`SELECT object_id FROM ${table} WHERE object_type='atomic_project_migrations'`);expect(journals.rows).toHaveLength(1);
 token=ordinary.token;
 const importUrl=new URL('http://fixture.test/v1/import');
 const forged=await handleV1Request(new Request(importUrl,{method:'POST',headers:{'x-api-key':token},body:JSON.stringify({tombstones:[{object_type:'atomic_project_migrations',object_id:journals.rows[0]!.object_id,deleted_at:'2099-01-01T00:00:00.000Z',updated_at:'2099-01-01T00:00:00.000Z'}]})}),importUrl,deps);
 expect((await forged!.json()).result.errors).toEqual(['Migration evidence is immutable']);
 token=admin.token;expect((await call(request)).status).toBe(200);
 }finally{await client.query(`DROP TABLE IF EXISTS ${table},${table}_c`);await client.close();}
},20000);

pg('concurrent replay commits once and bundle history survives project detachment',async()=>{
 const client=createTodosCloudQueryClient(process.env.TODOS_TEST_PG_URL!,{max:4});const table='todos_atomic_'+crypto.randomUUID().replaceAll('-','');
 const source=createPostgresTodosStorageAdapter({client,tableName:table,cursorTableName:table+'_c',service:'source'});
 const target=createPostgresTodosStorageAdapter({client,tableName:table,cursorTableName:table+'_c',service:'target'});
 try{
 const project=await source.projects.create({name:'source',path:'/source'});const task=await source.tasks.create({title:'source content',project_id:project.id});
 const history={id:crypto.randomUUID(),task_id:task.id,action:'created',field:null,old_value:null,new_value:null,agent_id:null,created_at:task.created_at};
 const clock='2099-01-01T00:00:00.000Z';
 const snapshot={tasks:[task],auditHistory:[history],tombstones:[{object_type:'projects',object_id:project.id,payload:project,updated_at:clock,deleted_at:clock}]};
 const request={schema_version:1 as const,operation_id:crypto.randomUUID(),expected_authority:{tenant_id:'target',kid:'fixture-key',deployment_id:'11111111-1111-4111-8111-111111111111'},snapshot,snapshot_hash:atomicMigrationHash(snapshot)};
 const [first,second]=await Promise.all([target.atomicProjectMigration!.apply(request),target.atomicProjectMigration!.apply(request)]);
 expect(first).toEqual(second);
 expect(await target.tasks.get(task.id)).toMatchObject({project_id:null,title:task.title,version:task.version+1});
 expect((await target.sync.exportSnapshot!()).auditHistory).toEqual([history]);
 expect((await client.query(`SELECT object_id FROM ${table} WHERE service='target' AND object_type='atomic_project_migrations'`)).rows).toHaveLength(1);
 expect(await source.tasks.get(task.id)).toMatchObject({project_id:project.id});
 const changed={auditHistory:[{...history,action:'changed'}]};
 await expect(target.atomicProjectMigration!.apply({...request,operation_id:crypto.randomUUID(),snapshot:changed,snapshot_hash:atomicMigrationHash(changed)})).rejects.toThrow('Immutable history');
 expect((await target.sync.exportSnapshot!()).auditHistory).toEqual([history]);
 }finally{await client.query(`DROP TABLE IF EXISTS ${table},${table}_c`);await client.close();}
},20000);

pg('migration rejects higher-version linked ties, invalid routing/history and oversized destination before writes',async()=>{
 const client=createTodosCloudQueryClient(process.env.TODOS_TEST_PG_URL!,{max:4});const table='todos_atomic_'+crypto.randomUUID().replaceAll('-','');
 const store=createPostgresTodosStorageAdapter({client,tableName:table,cursorTableName:table+'_c',service:'fixture'});
 try{
 const project=await store.projects.create({name:'fixture',path:'/fixture'});const other=await store.projects.create({name:'other',path:'/other'});
 const task=await store.tasks.create({title:'retained',project_id:project.id});const plan=await store.plans!.create({name:'plan',project_id:other.id});
 const clock='2099-01-01T00:00:00.000Z';
 const apply=(snapshot:Record<string,unknown>)=>store.atomicProjectMigration!.apply({schema_version:1,operation_id:crypto.randomUUID(),expected_authority:{tenant_id:'fixture',kid:'fixture-key',deployment_id:'11111111-1111-4111-8111-111111111111'},snapshot,snapshot_hash:atomicMigrationHash(snapshot)});
 await expect(apply({tasks:[{...task,plan_id:plan.id,updated_at:clock}]})).rejects.toThrow('conflicts with its plan');
 await expect(apply({tasks:[{...task,task_list_id:'missing-list',updated_at:clock}]})).rejects.toThrow('task-list reference');
 await expect(apply({plans:[{...plan,task_list_id:'missing-list',updated_at:clock}]})).rejects.toThrow('task-list reference');
 await expect(apply({auditHistory:[{id:crypto.randomUUID(),task_id:'missing-task',action:'created',created_at:clock}]})).rejects.toThrow('unknown task');
 await client.query(`UPDATE ${table} SET updated_at=$2::timestamptz,version=10,payload=payload||jsonb_build_object('updated_at',$2::text,'version',10) WHERE object_id=$1`,[task.id,clock]);
 await expect(apply({tombstones:[{object_type:'projects',object_id:project.id,payload:project,updated_at:clock,deleted_at:clock,version:9}]})).rejects.toThrow('newer linked');
 expect(await store.tasks.get(task.id)).toMatchObject({project_id:project.id,version:10});
 await client.query(`UPDATE ${table} SET payload=payload||jsonb_build_object('description',repeat('x',2097153)) WHERE object_id=$1`,[task.id]);
 await expect(apply({projects:[project]})).rejects.toThrow('row/byte scope');
 expect((await client.query(`SELECT object_id FROM ${table} WHERE object_type='atomic_project_migrations'`)).rows).toHaveLength(0);
 }finally{await client.query(`DROP TABLE IF EXISTS ${table},${table}_c`);await client.close();}
},20000);

test('invalid migration clocks and unsupported envelopes reject before database access',async()=>{
 let touched=0;
 const migration=createAtomicProjectMigration({client:{query:async()=>{touched++;return {rows:[]};}},table:'fixture',service:'fixture',ensureSchema:async()=>{touched++;}});
 const snapshot={tombstones:[{object_type:'projects',object_id:'fixture',payload:{id:'fixture'},updated_at:'2000-01-01T00:00:00.000Z',deleted_at:'2001-01-01T00:00:00.000Z'}]};
 const request={schema_version:1 as const,operation_id:'fixture-operation',expected_authority:{tenant_id:'fixture',kid:'fixture',deployment_id:'11111111-1111-4111-8111-111111111111'},snapshot,snapshot_hash:atomicMigrationHash(snapshot)};
 await expect(migration.apply(request)).rejects.toThrow('precedes deletion');
 await expect(migration.apply({...request,unknown:true} as any)).rejects.toThrow('envelope');
 expect(touched).toBe(0);
});

pg('atomic migration forces durable commit even when the caller session disables it',async()=>{
 const client=createTodosCloudQueryClient(process.env.TODOS_TEST_PG_URL!,{max:1});
 const table='todos_atomic_'+crypto.randomUUID().replaceAll('-','');
 const store=createPostgresTodosStorageAdapter({client,tableName:table,cursorTableName:table+'_c',service:'fixture'});
 try {
  const project=await store.projects.create({name:'durable fixture',path:'/fixture'});
  await client.query(`ALTER TABLE ${table} ADD CONSTRAINT fixture_durable_journal CHECK(object_type<>'atomic_project_migrations' OR current_setting('synchronous_commit')='on')`);
  await client.query("SET synchronous_commit = 'off'");
  const snapshot={projects:[project]};
  const result=await store.atomicProjectMigration!.apply({schema_version:1,operation_id:crypto.randomUUID(),expected_authority:{tenant_id:'fixture',kid:'fixture-key',deployment_id:'11111111-1111-4111-8111-111111111111'},snapshot,snapshot_hash:atomicMigrationHash(snapshot)});
  expect(result.status).toBe('complete');
  expect((await client.query<{value:string}>("SELECT current_setting('synchronous_commit') AS value")).rows[0]!.value).toBe('off');
  expect((await client.query(`SELECT object_id FROM ${table} WHERE object_type='atomic_project_migrations'`)).rows).toHaveLength(1);
 } finally {await client.query(`DROP TABLE IF EXISTS ${table},${table}_c`);await client.close();}
},20000);

test('unsafe database durability settings refuse before record reads or writes',async()=>{
 for(const settings of [{fsync:'off',full_page_writes:'on',synchronous_commit:'on'},{fsync:'on',full_page_writes:'off',synchronous_commit:'on'},{fsync:'on',full_page_writes:'on',synchronous_commit:'off'}]){
  const statements:string[]=[];
  const client:any={async query(sql:string){statements.push(sql);return {rows:sql.startsWith("SELECT current_setting")?[settings]:[]};},async transaction(fn:any){return fn(client);}};
  const migration=createAtomicProjectMigration({client,table:'fixture_records',service:'fixture',ensureSchema:async()=>{}});
  const snapshot={projects:[{id:'fixture-project',name:'fixture',updated_at:'2026-01-01T00:00:00.000Z'}]};
  await expect(migration.apply({schema_version:1,operation_id:'fixture-durability',expected_authority:{tenant_id:'fixture',kid:'fixture-key',deployment_id:'11111111-1111-4111-8111-111111111111'},snapshot,snapshot_hash:atomicMigrationHash(snapshot)})).rejects.toThrow('durability settings');
  expect(statements).toHaveLength(4);
  expect(statements.some(sql=>sql.includes('fixture_records'))).toBe(false);
 }
});
