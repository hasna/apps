import { createHash } from 'node:crypto';
import type { TodosPostgresQueryClient } from './postgres-sync.js';
import { TASK_STATUSES, TASK_PRIORITIES, PLAN_STATUSES } from '../types/index.js';
import { validateSnapshotRoutingRecords } from '../lib/slugs.js';

export const ATOMIC_PROJECT_MIGRATION_VERSION = 1 as const;
const families = { projects:'projects', tasks:'tasks', plans:'plans', taskLists:'task_lists', auditHistory:'audit_history' } as const;
type Row = Record<string, unknown>;
type Stored = {object_type:string;object_id:string;payload:Row;updated_at:string|Date;deleted_at:string|Date|null;version:number|null;source_machine_id?:string|null};
export type AtomicMigrationAuthority = {tenant_id:string;kid:string;deployment_id:string};
export type AtomicMigrationRequest = {schema_version:1;operation_id:string;expected_authority:AtomicMigrationAuthority;snapshot:Record<string,unknown>;snapshot_hash:string};
export type AtomicMigrationRecordReceipt = {object_type:string;object_id:string;outcome:'inserted'|'updated'|'identical'|'superseded'|'deleted'|'detached';before_hash:string|null;after_hash:string;source_hash:string};
export type AtomicMigrationReceipt = {schema_version:1;operation_id:string;snapshot_hash:string;authority:AtomicMigrationAuthority;status:'complete';records:AtomicMigrationRecordReceipt[]};
export class AtomicMigrationError extends Error {
 constructor(readonly status:number,message:string,readonly record?:{object_type:string;object_id:string}) {super(message);this.name='AtomicMigrationError';}
}
function fail(message:string,status=409,record?:Stored):never {throw new AtomicMigrationError(status,message,record&&{object_type:record.object_type,object_id:record.object_id});}
function plain(value:unknown):value is Row {return !!value && typeof value==='object' && !Array.isArray(value) && (Object.getPrototypeOf(value)===Object.prototype || Object.getPrototypeOf(value)===null);}
function canonical(value:unknown,depth=0):string {
 if(depth>32)fail('Migration JSON depth exceeds 32',400);
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
 if(plain(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
 return fail('Migration requires finite JSON values',400);
}
export function atomicMigrationHash(value:unknown):string {return createHash('sha256').update(canonical(value)).digest('hex');}
function stamp(value:unknown):string {if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail('Migration clocks require canonical millisecond UTC timestamps',400);return value;}
function version(value:unknown):number {if(value==null)return 0;if(!Number.isSafeInteger(value)||Number(value)<0)fail('Invalid migration version',400);return value as number;}
function key(row:Pick<Stored,'object_type'|'object_id'>):string {return row.object_type+'\0'+row.object_id;}
function normalized(row:Stored):Stored {return {...row,source_machine_id:row.source_machine_id??null,updated_at:new Date(row.updated_at).toISOString(),deleted_at:row.deleted_at?new Date(row.deleted_at).toISOString():null};}
function digest(row:Stored):string {return atomicMigrationHash(normalized(row));}
function compare(a:Stored,b:Stored):number {return Date.parse(String(a.updated_at))-Date.parse(String(b.updated_at)) || version(a.version)-version(b.version);}
function identity(value:unknown):string {if(typeof value!=='string'||!value.trim()||value.length>256||value.includes('\0'))fail('Invalid migration record identity',400);return value;}
function validate(request:AtomicMigrationRequest):Stored[] {
 if(!plain(request)||request.schema_version!==1||typeof request.operation_id!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(request.operation_id))fail('Invalid migration operation identity/version',400);
 if(Object.keys(request).some(k=>!['schema_version','operation_id','expected_authority','snapshot','snapshot_hash'].includes(k))||Buffer.byteLength(canonical(request))>2200000)fail('Unsupported or oversized migration envelope',400);
 if(!plain(request.expected_authority))fail('Expected migration authority is required',400);
 identity(request.expected_authority.tenant_id);identity(request.expected_authority.kid);identity(request.expected_authority.deployment_id);
 if(!plain(request.snapshot))fail('Migration snapshot must be an object',400);
 const encoded=canonical(request.snapshot);if(Buffer.byteLength(encoded)>2*1024*1024)fail('Migration snapshot exceeds 2 MiB',413);
 if(atomicMigrationHash(request.snapshot)!==request.snapshot_hash)fail('Migration snapshot hash mismatch',400);
 const allowed=new Set([...Object.keys(families),'tombstones','exportedAt','source']);
 for(const [name,value] of Object.entries(request.snapshot))if(!allowed.has(name) && !(Array.isArray(value)&&value.length===0))fail(`Unsupported atomic migration family: ${name}`,400);
 const rows:Stored[]=[];
 for(const [name,type] of Object.entries(families)) {
  const values=request.snapshot[name]??[];if(!Array.isArray(values))fail(`Invalid migration array: ${name}`,400);
  for(const value of values) {
   if(!plain(value))fail('Invalid migration record',400);
   const id=identity(value.id);const clock=stamp(value.updated_at??value.created_at);
   if(type==='tasks'){
    if(typeof value.title!=='string'||!TASK_STATUSES.includes(value.status as any)||!TASK_PRIORITIES.includes(value.priority as any))fail('Invalid task migration payload',400);
    if(value.locked_by||value.runner_id)fail('Active task leases require separate migration reconciliation',409);
   }
   if(type==='plans'&&(typeof value.name!=='string'||!PLAN_STATUSES.includes(value.status as any)))fail('Invalid plan migration payload',400);
   if(type==='projects'&&typeof value.name!=='string')fail('Invalid project migration payload',400);
   if(type==='audit_history'&&(typeof value.task_id!=='string'||typeof value.action!=='string'))fail('Invalid history migration payload',400);
   rows.push({object_type:type,object_id:id,payload:value,updated_at:clock,deleted_at:null,version:value.version==null?null:version(value.version),source_machine_id:typeof value.source_machine_id==='string'?value.source_machine_id:null});
  }
 }
 const tombstones=request.snapshot.tombstones??[];if(!Array.isArray(tombstones))fail('Invalid tombstone array',400);
 for(const value of tombstones) {
  if(!plain(value)||value.object_type!=='projects')fail('Atomic migration supports only project tombstones',400);
  if(!plain(value.payload))fail('Project tombstone must preserve its original payload',400);
  if(stamp(value.updated_at)<stamp(value.deleted_at))fail('Tombstone update clock precedes deletion',400);
  const id=identity(value.object_id);if(value.payload.id!==id)fail('Tombstone payload identity mismatch',400);
  rows.push({object_type:'projects',object_id:id,payload:value.payload,updated_at:stamp(value.updated_at),deleted_at:stamp(value.deleted_at),version:value.version==null?null:version(value.version),source_machine_id:typeof value.source_machine_id==='string'?value.source_machine_id:null});
 }
 if(!rows.length||rows.length>1000)fail('Atomic migration requires 1-1000 records',400);
 const unique=new Map<string,Stored>();
 for(const row of rows){const previous=unique.get(key(row));if(previous&&digest(previous)!==digest(row))fail('Divergent duplicate migration identity',409,row);unique.set(key(row),row);}
 return [...unique.values()];
}
function validateGraph(rows:Map<string,Stored>):void {
 const live=[...rows.values()].filter(r=>!r.deleted_at);
 const get=(type:string,id:unknown)=>typeof id==='string'?rows.get(type+'\0'+id):undefined;
 for(const row of live){
  if(row.object_type==='audit_history'){if(!get('tasks',row.payload.task_id))fail('Migration history references an unknown task',409,row);continue;}
  if(!['projects','tasks','plans','task_lists'].includes(row.object_type))continue;
  if(row.object_type==='tasks'&&row.payload.plan_id){const plan=get('plans',row.payload.plan_id);if(plan&&!plan.deleted_at&&(plan.payload.project_id??null)!==(row.payload.project_id??null))fail('Migration task project conflicts with its plan',409,row);}
  if(['tasks','plans'].includes(row.object_type)&&row.payload.task_list_id!=null){
   const selector=row.payload.task_list_id;
   if(typeof selector!=='string'||!selector)fail('Invalid migration task-list selector',409,row);
   const candidates=live.filter(candidate=>candidate.object_type==='task_lists'&&(candidate.payload.project_id??null)===(row.payload.project_id??null)&&(candidate.object_id===selector||candidate.payload.slug===selector));
   const project=get('projects',row.payload.project_id);
   const canonicalDefault=project&&!project.deleted_at&&project.payload.task_list_id===selector;
   if(candidates.length>1||(!candidates.length&&!canonicalDefault))fail('Migration task-list reference is missing or ambiguous; explicit reconciliation required',409,row);
  }
  const refs: [string,unknown][]=[];
  if(row.object_type==='projects')refs.push(['projects',row.payload.parent_id]);
  else refs.push(['projects',row.payload.project_id]);
  if(row.object_type==='tasks')refs.push(['tasks',row.payload.parent_id],['plans',row.payload.plan_id]);
  for(const [type,id] of refs){if(id==null)continue;if(typeof id!=='string'||!id||!get(type,id)||get(type,id)!.deleted_at)fail('Migration reference is missing or deleted',409,row);}
  if(row.object_type==='tasks'&&row.payload.parent_id){const parent=get('tasks',row.payload.parent_id)!;if((parent.payload.project_id??null)!==(row.payload.project_id??null))fail('Migration task parent crosses project scope',409,row);}
 }
 for(const type of ['projects','tasks'])for(const row of live.filter(r=>r.object_type===type)){
  const seen=new Set<string>();let cursor:Stored|undefined=row;
  while(cursor){if(seen.has(cursor.object_id))fail('Migration hierarchy contains a cycle',409,row);seen.add(cursor.object_id);cursor=get(type,cursor.payload.parent_id);}
 }
 const projects=live.filter(r=>r.object_type==='projects').map(r=>r.payload);
 const lists=live.filter(r=>r.object_type==='task_lists').map(r=>r.payload);
 const errors=validateSnapshotRoutingRecords(projects as any,lists as any);if(errors.length)fail('Migration project/list routing conflict');
}

/** No DDL in BEGIN: caller ensures the existing record schema first. Journal and
 * original manifest are immutable records in that same tenant/service table. */
export function createAtomicProjectMigration(options:{client:TodosPostgresQueryClient;table:string;service:string;ensureSchema:()=>Promise<void>}) {
 if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(options.table))throw new Error('Unsafe migration table');
 return {async apply(request:AtomicMigrationRequest):Promise<AtomicMigrationReceipt> {
  const incoming=validate(request);
  if(!options.client.transaction)fail('Atomic migration requires a transaction-capable backend',501);
  await options.ensureSchema();
  return options.client.transaction!(async client=>{
   const deadline=Date.now()+20000;
   await client.query("SET LOCAL lock_timeout = '5s'");
   await client.query("SET LOCAL statement_timeout = '15s'");
   // Do not inherit asynchronous commit when issuing a durable receipt.
   await client.query("SET LOCAL synchronous_commit = 'on'");
   const durability=await client.query<{fsync:string;full_page_writes:string;synchronous_commit:string}>("SELECT current_setting('fsync') AS fsync,current_setting('full_page_writes') AS full_page_writes,current_setting('synchronous_commit') AS synchronous_commit");
   const durable=durability.rows[0];
   if(durable?.fsync!=='on'||durable.full_page_writes!=='on'||durable.synchronous_commit!=='on')fail('Migration database durability settings are not ready',503);
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':task-parent-integrity',0))",[options.service]);
   // Also fence older writers which do not yet participate in the graph lock.
   // Bounded operation; this deployment-wide table lock is deliberate and documented.
   await client.query(`LOCK TABLE ${options.table} IN SHARE ROW EXCLUSIVE MODE`);
   const journalId=atomicMigrationHash({operation_id:request.operation_id});
   const journal=await client.query<{request_hash:string;receipt:AtomicMigrationReceipt}>(`SELECT payload->>'request_hash' AS request_hash,payload->'receipt' AS receipt FROM ${options.table} WHERE service=$1 AND object_type='atomic_project_migrations' AND object_id=$2`,[options.service,journalId]);
   const requestHash=atomicMigrationHash(request);
   if(journal.rows[0]){if(journal.rows[0].request_hash!==requestHash)fail('Migration operation identity was already used for another request');return journal.rows[0].receipt;}
   const bounds=await client.query<{records:string;bytes:string;largest:string}>(`SELECT count(*)::text AS records,COALESCE(sum(octet_length(payload::text)),0)::text AS bytes,COALESCE(max(octet_length(payload::text)),0)::text AS largest FROM ${options.table} WHERE service=$1 AND object_type IN ('projects','tasks','plans','task_lists','audit_history')`,[options.service]);
   const size=bounds.rows[0];if(!size||Number(size.records)>10000||Number(size.bytes)>16*1024*1024||Number(size.largest)>2*1024*1024)fail('Atomic migration destination exceeds its bounded row/byte scope',413);
   const selected=await client.query<Stored>(`SELECT object_type,object_id,payload,updated_at,deleted_at,version,source_machine_id FROM ${options.table} WHERE service=$1 AND object_type IN ('projects','tasks','plans','task_lists','audit_history') LIMIT 10001 FOR UPDATE`,[options.service]);
   if(selected.rows.length>10000)fail('Atomic migration destination exceeds bounded 10000-record scope',413);
   for(const row of selected.rows){canonical(row.payload);if(Date.now()>deadline)fail('Migration destination validation exceeded time budget',503);}
   const original=new Map(selected.rows.map(r=>[key(r),normalized(r)]));const current=new Map(original);
   const receipts:AtomicMigrationRecordReceipt[]=[];
   const receipt=(source:Stored,before:Stored|undefined,after:Stored,outcome:AtomicMigrationRecordReceipt['outcome'])=>receipts.push({object_type:source.object_type,object_id:source.object_id,outcome,before_hash:before?digest(before):null,after_hash:digest(after),source_hash:digest(source)});
   for(const row of incoming.filter(r=>!r.deleted_at)){
    const before=current.get(key(row));
    if(before){
     if(digest(before)===digest(row)){receipt(row,before,before,'identical');continue;}
     if(before.object_type==='tasks'&&(before.payload.locked_by||before.payload.runner_id))fail('Active destination task lease requires reconciliation',409,before);
     if(row.object_type==='audit_history')fail('Immutable history identity conflict',409,row);
     const clock=compare(row,before);if(clock===0)fail('Ambiguous equal-clock migration conflict',409,row);
     if(clock<0){receipt(row,before,before,'superseded');continue;}
     if(before.deleted_at)fail('Migration cannot implicitly resurrect a deleted record',409,row);
    }
    current.set(key(row),row);receipt(row,before,row,before?'updated':'inserted');
   }
   for(const row of incoming.filter(r=>r.deleted_at)){
    const before=current.get(key(row));
    if(before){
     if(digest(before)===digest(row)){receipt(row,before,before,'identical');continue;}
     const clock=compare(row,before);if(clock===0)fail('Ambiguous equal-clock lifecycle conflict',409,row);
     if(clock<0){receipt(row,before,before,'superseded');continue;}
    }
    for(const [id,linked] of current){
     if(linked.deleted_at)continue;
     const field=linked.object_type==='projects'?'parent_id':'project_id';
     if(!['projects','tasks','plans','task_lists'].includes(linked.object_type)||linked.payload[field]!==row.object_id)continue;
     if(compare(linked,row)>0)fail('A newer linked record conflicts with the historical project deletion',409,linked);
     if(linked.object_type==='tasks'&&(linked.payload.locked_by||linked.payload.runner_id))fail('Active linked task lease requires reconciliation',409,linked);
     const detached:Stored={...linked,payload:{...linked.payload,[field]:null,updated_at:row.updated_at},updated_at:row.updated_at};
     if(linked.object_type==='tasks'){detached.version=version(linked.version)+1;detached.payload.version=detached.version;}
     current.set(id,detached);receipt(linked,linked,detached,'detached');
    }
    current.set(key(row),row);receipt(row,before,row,'deleted');
   }
   validateGraph(current);
   for(const [id,row] of current){
    if(Date.now()>deadline)fail("Atomic migration exceeded its transaction time budget",503);
    const before=original.get(id);if(before&&digest(before)===digest(row))continue;
    await client.query(`INSERT INTO ${options.table}(service,object_type,object_id,payload,updated_at,deleted_at,version,source_machine_id) VALUES($1,$2,$3,$4::jsonb,$5::timestamptz,$6::timestamptz,$7,$8) ON CONFLICT(service,object_type,object_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=EXCLUDED.updated_at,deleted_at=EXCLUDED.deleted_at,version=EXCLUDED.version,source_machine_id=EXCLUDED.source_machine_id`,[options.service,row.object_type,row.object_id,row.payload,row.updated_at,row.deleted_at,row.version,row.source_machine_id??null]);
   }
   const result:AtomicMigrationReceipt={schema_version:1,operation_id:request.operation_id,snapshot_hash:request.snapshot_hash,authority:request.expected_authority,status:'complete',records:receipts};
   // Keep original source payloads and every changed destination payload, including
   // newer winners, so reconciliation never destroys migration history.
   const changedKeys=new Set(receipts.map(row=>key(row)));
   const evidence={request_hash:requestHash,request,receipt:result,before:[...original.values()].filter(row=>changedKeys.has(key(row)))};
   if(Date.now()>deadline)fail("Atomic migration exceeded its transaction time budget",503);
   await client.query(`INSERT INTO ${options.table}(service,object_type,object_id,payload,updated_at) VALUES($1,'atomic_project_migrations',$2,$3::jsonb,now())`,[options.service,journalId,evidence]);
   return result;
  });
 }};
}
