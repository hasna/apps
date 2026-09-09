import { test, expect, setDefaultTimeout } from "bun:test";
// Spawns child processes (CLI/server/scripts); bun's 5s default is too tight on a loaded host.
setDefaultTimeout(60_000);

import {randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {mintApiKey,verifyApiKey} from '@hasna/contracts/auth';
import {createTodosCloudQueryClient} from '../storage/cloud-client.js';
import {createPostgresTodosStorageAdapter} from '../storage/postgres-adapter.js';
import {handleV1Request,type V1RequestDependencies} from '../server/v1.js';
const pgTest=process.env.TODOS_TEST_PG_URL?test:test.skip;
pgTest('fresh CLI lists aliases use saved API credentials, full pages and preserving delete without SQLite',async()=>{
 const client=createTodosCloudQueryClient(process.env.TODOS_TEST_PG_URL!,{max:4});const table=`lists_cli_${randomUUID().replaceAll('-','')}`;
 const store=createPostgresTodosStorageAdapter({client,service:'lists-cli-fixture',tableName:table,cursorTableName:`${table}_cursor`});
 const root=mkdtempSync(join(tmpdir(),'todos-lists-cli-'));const signingSecret=randomUUID()+randomUUID();
 const key=mintApiKey({app:'todos',scopes:['todos:read','todos:write'],signingSecret,tid:'fixture-tenant',agent:'fixture'});
 const verifier=verifyApiKey({app:'todos',signingSecret,keyStatus:async(kid:string)=>kid===key.kid?'active':'unknown'});
 const deps:V1RequestDependencies={ensureSchema:async()=>{},getStorageAdapter:()=>store,getMachineRegistryTenantId:()=> 'fixture-tenant',getVerifier:()=>verifier};let rejectDelete=false;let requests=0;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async req=>{requests++;return rejectDelete&&new URL(req.url).pathname.endsWith('/delete-preserving')?new Response('old fixture API',{status:405}):(await handleV1Request(req,new URL(req.url),deps))??new Response('Not found',{status:404});}});
 const config=join(root,'.hasna/todos/config');mkdirSync(config,{recursive:true,mode:0o700});writeFileSync(join(config,'credentials'),`HASNA_TODOS_API_URL=${server.url.origin}\nHASNA_TODOS_API_KEY=${key.token}\n`,{mode:0o600});
 const env={PATH:process.env.PATH??'',HOME:root,USERPROFILE:root,HASNA_STATION:`fixture-${randomUUID()}`,TMPDIR:root,NO_COLOR:'1'};
 const run=async(args:string[])=>{const child=Bun.spawn([process.execPath,'--no-env-file','src/cli/index.tsx',...args],{cwd:join(import.meta.dir,'../..'),env,stdout:'pipe',stderr:'pipe'});const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);return {stdout,stderr,code};};
 try{
  const created=await run(['--json','tl','--add',' Shared list ','--slug','Shared List','--status','completed']);expect(created.code,created.stderr).toBe(0);const list=JSON.parse(created.stdout);expect(list).toMatchObject({name:'Shared list',slug:'shared-list',status:'completed'});
  const beforeInvalid=requests;
  for(const args of [['lists','--status','invented'],['lists','--add','new','--delete',list.id],['lists','--force'],['lists','--update',list.id,'--slug','!!!']])expect((await run(args)).code).not.toBe(0);
  expect(requests).toBe(beforeInvalid);
  const task=await store.tasks.create({title:'kept task',task_list_id:list.id});
  for(let i=1;i<201;i++){const row={...task,id:randomUUID()};await client.query(`INSERT INTO ${table}(service,object_type,object_id,payload,updated_at,version) VALUES ('lists-cli-fixture','tasks',$1,$2::text::jsonb,$3::timestamptz,1)`,[row.id,JSON.stringify(row),row.updated_at]);}
  const shown=await run(['--json','task-lists','--show',list.id]);expect(shown.code,shown.stderr).toBe(0);expect(JSON.parse(shown.stdout).tasks).toHaveLength(201);
  const human=await run(['lists','--show',list.id]);expect(human.code,human.stderr).toBe(0);expect(human.stdout).toContain('Tasks: 201');expect(human.stdout).toContain('Shared list');
  const updated=await run(['--json','lists','--update',list.id,'--name','Updated','--description','preserved note','--status','archived']);expect(updated.code,updated.stderr).toBe(0);expect(await store.taskLists.get(list.id)).toMatchObject({name:'Updated',description:'preserved note',status:'archived'});
  const listed=await run(['--json','tl','--status','archived']);expect(listed.code,listed.stderr).toBe(0);expect(JSON.parse(listed.stdout)).toHaveLength(1);
  const refused=await run(['--json','lists','--delete',list.id]);expect(refused.code).not.toBe(0);expect(await store.taskLists.get(list.id)).not.toBeNull();
  rejectDelete=true;const old=await run(['--json','lists','--delete',list.id,'--force']);expect(old.code).not.toBe(0);expect(await store.taskLists.get(list.id)).not.toBeNull();rejectDelete=false;
  const deleted=await run(['--json','lists','--delete',list.id,'--force']);expect(deleted.code,deleted.stderr).toBe(0);expect(JSON.parse(deleted.stdout)).toMatchObject({deleted:true,detached_tasks:201});expect((await store.tasks.get(task.id))?.task_list_id).toBeNull();
  expect(readdirSync(root,{recursive:true}).map(String).filter(path=>/\.(db|sqlite|sqlite3)(?:-wal|-shm|-journal)?$/.test(path))).toEqual([]);
 }finally{server.stop(true);await client.query(`DROP TABLE IF EXISTS ${table},${table}_cursor`);await client.close();rmSync(root,{recursive:true,force:true});}
},60000);
