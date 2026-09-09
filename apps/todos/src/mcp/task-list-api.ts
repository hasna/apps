import type {HasnaStorageClient} from '@hasna/contracts/client/storage';
import type {TaskList} from '../types/index.js';
import type {TodosTaskListDeleteReceipt} from '../storage/interfaces.js';
export function assertTaskListReceipt(value:unknown,expected:Record<string,unknown>={},id?:string):asserts value is TaskList {
 if(!value||typeof value!=='object'||typeof (value as any).id!=='string'||!(value as any).id||typeof (value as any).name!=='string'||(id!==undefined&&(value as any).id!==id))throw new Error('Invalid task-list receipt; inspect server state before retrying');
 for(const [key,field] of Object.entries(expected))if(field!==undefined&&(value as any)[key]!==field)throw new Error('The Todos API did not confirm every requested task-list field; upgrade the API and inspect before retrying');
}
export async function listSharedTaskLists(client:HasnaStorageClient,projectId?:string):Promise<TaskList[]> {
 const raw=await client.transport.get<{task_lists:unknown[];count:number}>('/task-lists',{query:projectId?{project_id:projectId}:{}});
 if(!raw||!Array.isArray(raw.task_lists)||!Number.isSafeInteger(raw.count)||raw.count!==raw.task_lists.length||raw.count>10000)throw new Error('Incomplete task-list listing; upgrade the Todos API or narrow the project filter');
 const ids=new Set<string>();
 for(const list of raw.task_lists){assertTaskListReceipt(list);if(ids.has(list.id)||(projectId!==undefined&&list.project_id!==projectId))throw new Error('Invalid or incorrectly scoped task-list listing');ids.add(list.id);}
 return raw.task_lists as TaskList[];
}
export async function resolveSharedTaskList(client:HasnaStorageClient,ref:string):Promise<TaskList>{
 const lists=await listSharedTaskLists(client);const matches=lists.filter(list=>list.id===ref||list.slug===ref||list.id.startsWith(ref));
 if(matches.length!==1)throw new Error(matches.length?'Ambiguous task-list selector':'Task list not found');
 return matches[0]!;
}
export async function deleteSharedTaskList(client:HasnaStorageClient,id:string,force:boolean):Promise<TodosTaskListDeleteReceipt>{
 const raw=await client.transport.post<TodosTaskListDeleteReceipt>(`/task-lists/${encodeURIComponent(id)}/delete-preserving`,{force});
 if(!raw||raw.schema_version!==1||raw.task_list_id!==id||typeof raw.deleted!=='boolean')throw new Error('Invalid task-list deletion receipt; inspect server state before retrying');
 for(const [ids,count] of [[raw.detached_task_ids,raw.detached_tasks],[raw.detached_plan_ids,raw.detached_plans]] as const){
  if(!Array.isArray(ids)||ids.some(value=>typeof value!=='string'||!value)||new Set(ids).size!==ids.length||!Number.isSafeInteger(count)||count!==ids.length||(!raw.deleted&&count!==0))throw new Error('Invalid task-list deletion receipt; inspect server state before retrying');
 }
 return raw;
}
