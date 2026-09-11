import {test,expect} from 'bun:test';
import {validatePlanSchedule} from '../lib/plan-schedule.js';
import {assertPlanReceipt,deleteSharedPlan,listSharedPlans} from './plan-api.js';
test('plan calendar dates reject normalization and invalid ranges while allowing absent legacy dates',()=>{
 for(const date of ['2027-02-29','2028-04-31','2028-1-01','2028-01-01T00:00:00Z','not a date',4,{},[]])expect(validatePlanSchedule({start_date:date})).not.toBeNull();
 expect(validatePlanSchedule({start_date:'2028-02-29',end_date:'2028-03-01'})).toBeNull();expect(validatePlanSchedule({})).toBeNull();expect(validatePlanSchedule({start_date:null,end_date:null})).toBeNull();expect(validatePlanSchedule({start_date:'2028-03-01',end_date:'2028-02-29'})).not.toBeNull();
});
test('plan mutation and deletion receipts reject silent field loss and malformed success without reflecting payloads',async()=>{
 const plan={id:'fixture',name:'fixture',status:'planning'};expect(()=>assertPlanReceipt(plan,{status:'planning'},'fixture')).not.toThrow();
 expect(()=>assertPlanReceipt(plan,{start_date:'2028-02-29'})).toThrow('did not confirm');
 expect(()=>assertPlanReceipt(plan,{},'other')).toThrow('receipt');
 const valid={schema_version:1,plan_id:'fixture',deleted:true,detached_task_ids:['a'],detached_task_list_ids:[],detached_tasks:1,detached_task_lists:0};
 const client=(raw:unknown)=>({transport:{post:async()=>raw}} as any);
 expect(await deleteSharedPlan(client(valid),'fixture',true)).toEqual(valid);
 for(const raw of [null,{}, {...valid,plan_id:'other'},{...valid,detached_tasks:0},{...valid,deleted:false},{...valid,detached_task_ids:['a','a'],detached_tasks:2}])await expect(deleteSharedPlan(client(raw),'fixture',true)).rejects.toThrow('receipt');
});

test('incomplete and cross-project plan lists never become empty successful results',async()=>{
 for(const raw of [{},{plans:[],count:1},{plans:[{id:'a',name:'a',project_id:'other'}],count:1}])await expect(listSharedPlans({transport:{get:async()=>raw}} as any,'selected')).rejects.toThrow();
});
test('explicit SQLite plan compatibility refuses additive fields before opening storage',async()=>{
 const {createPlan,updatePlan}=await import('../db/plans.js');
 for(const input of [{start_date:'2028-02-29'},{end_date:null},{status:'planning' as const},{status:'cancelled' as const}]){
  expect(()=>createPlan({name:'fixture',...input})).toThrow('explicit SQLite storage cannot retain');
  expect(()=>updatePlan('fixture',input)).toThrow('explicit SQLite storage cannot retain');
 }
});
