import {test,expect} from 'bun:test';
import {assertTaskListReceipt,listSharedTaskLists,resolveSharedTaskList,deleteSharedTaskList} from './task-list-api.js';
import {cloudListTaskListTasks} from '../cli/cloud-router.js';
test('task-list receipts reject field loss, ambiguous selectors and incomplete listings',async()=>{
 const row={id:'a',name:'a',slug:'b',status:'completed'};expect(()=>assertTaskListReceipt(row,{status:'completed'},'a')).not.toThrow();expect(()=>assertTaskListReceipt(row,{status:'archived'})).toThrow('did not confirm');
 for(const raw of [{},{task_lists:[],count:1},{task_lists:[row,row],count:2},{task_lists:[{...row,project_id:'other'}],count:1}])await expect(listSharedTaskLists({transport:{get:async()=>raw}} as any,'selected')).rejects.toThrow();
 await expect(resolveSharedTaskList({transport:{get:async()=>({task_lists:[row,{id:'b',name:'b',slug:'c'}],count:2})}} as any,'b')).rejects.toThrow('Ambiguous');
});
test('task-list delete receipt validates exact IDs/counts and missing capabilities fail closed',async()=>{
 const valid={schema_version:1,task_list_id:'a',deleted:true,detached_task_ids:['t'],detached_plan_ids:['p'],detached_tasks:1,detached_plans:1};const client=(raw:unknown)=>({transport:{post:async()=>raw}} as any);
 expect(await deleteSharedTaskList(client(valid),'a',true)).toEqual(valid);
 for(const raw of [null,{}, {...valid,task_list_id:'wrong'},{...valid,detached_plans:0},{...valid,deleted:false},{...valid,detached_task_ids:['t','t'],detached_tasks:2}])await expect(deleteSharedTaskList(client(raw),'a',true)).rejects.toThrow('receipt');
 await expect(deleteSharedTaskList({transport:{post:async()=>{throw new Error('405 upgrade API');}}} as any,'a',true)).rejects.toThrow('405');
});
test('task-list full detail rejects absent/changing totals, wrong scopes and repeated pages',async()=>{
 const task={id:'t',task_list_id:'list'};
 for(const pages of [[{tasks:[task]}],[{tasks:[{...task,task_list_id:'other'}],total:1}],[{tasks:[task],total:2},{tasks:[task],total:2}],[{tasks:[task],total:2},{tasks:[],total:3}],[{tasks:[],total:10001}]]){
  let i=0;const client={list:async()=>{const raw=pages[i++]!;return {raw,items:raw.tasks};}} as any;
  await expect(cloudListTaskListTasks(client,'list')).rejects.toThrow();
 }
});
test('explicit SQLite task-list compatibility never silently discards status',async()=>{
 const {createTaskList,updateTaskList}=await import('../db/task-lists.js');expect(()=>createTaskList({name:'fixture',status:'active'})).toThrow('cannot retain');expect(()=>updateTaskList('fixture',{status:'archived'})).toThrow('cannot retain');
});
test('SQLite snapshot import rejects task-list status before opening a database or partially writing records',async()=>{
 const {importSqliteTodosStorageSnapshot}=await import('../storage/sqlite-snapshot.js');
 const result=importSqliteTodosStorageSnapshot({taskLists:[{id:'fixture',status:'completed'}]} as any);
 expect(result).toMatchObject({inserted:0,updated:0,deleted:0,errors:[expect.stringContaining('cannot retain')]});
});
