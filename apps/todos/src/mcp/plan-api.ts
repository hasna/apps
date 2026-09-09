import type {HasnaStorageClient} from '@hasna/contracts/client/storage';
import type {TodosPlanDeleteReceipt} from '../storage/interfaces.js';
export async function deleteSharedPlan(client:HasnaStorageClient,id:string,force:boolean):Promise<TodosPlanDeleteReceipt>{
 const raw=await client.transport.post<TodosPlanDeleteReceipt>(`/plans/${encodeURIComponent(id)}/delete-preserving`,{force});
 if(!raw||raw.schema_version!==1||raw.plan_id!==id||typeof raw.deleted!=='boolean')throw new Error('Invalid plan deletion receipt; inspect server state before retrying');
 for(const [ids,count] of [[raw.detached_task_ids,raw.detached_tasks],[raw.detached_task_list_ids,raw.detached_task_lists]] as const){
  if(!Array.isArray(ids)||ids.some(value=>typeof value!=='string'||!value)||new Set(ids).size!==ids.length||!Number.isSafeInteger(count)||count!==ids.length||(!raw.deleted&&count!==0))throw new Error('Invalid plan deletion receipt; inspect server state before retrying');
 }
 return raw;
}

export function assertPlanReceipt(value:unknown,expected:Record<string,unknown>={},id?:string):asserts value is import('../types/index.js').Plan {
 if(!value||typeof value!=="object"||typeof (value as any).id!=="string"||!(value as any).id||typeof (value as any).name!=="string"||(id!==undefined&&(value as any).id!==id))throw new Error("Invalid plan receipt; inspect server state before retrying");
 for(const [key,field] of Object.entries(expected))if(field!==undefined&&(value as any)[key]!==field)throw new Error("The Todos API did not confirm every requested plan field; upgrade the API and inspect before retrying");
}

export async function listSharedPlans(client:HasnaStorageClient,projectId?:string):Promise<import('../types/index.js').Plan[]> {
 const raw=await client.transport.get<{plans:unknown[];count:number}>('/plans',{query:projectId?{project_id:projectId}:{}});
 if(!raw||!Array.isArray(raw.plans)||!Number.isSafeInteger(raw.count)||raw.count!==raw.plans.length||raw.count>10000)throw new Error("Incomplete plan listing; upgrade the Todos API or narrow the project filter");
 const ids=new Set<string>();
 for(const plan of raw.plans){assertPlanReceipt(plan);if(ids.has(plan.id)||(projectId!==undefined&&plan.project_id!==projectId))throw new Error("Invalid or incorrectly scoped plan listing");ids.add(plan.id);}
 return raw.plans as import('../types/index.js').Plan[];
}
