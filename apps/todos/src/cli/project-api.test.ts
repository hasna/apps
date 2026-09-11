import {test,expect} from "bun:test";
import {assertProjectReceipt} from "../lib/project-receipt.js";
import {cloudCreateProject,cloudDeleteProjectPreserving,cloudUpdateProject} from "./cloud-router.js";
import {cloudProjectPanel} from "./project-api.js";
import type {HasnaStorageClient} from "@hasna/contracts/client/storage";
const project={id:"fixture-project",name:"Fixture",path:"/fixture",metadata:{b:2,a:1}};
test("project mutation receipts verify identity and every requested field without reflecting payloads",async()=>{
 expect(assertProjectReceipt({project},{metadata:{a:1,b:2}})).toEqual(project);
 const marker="synthetic-private-value";
 const client={create:async()=>({project}),update:async()=>({project})} as unknown as HasnaStorageClient;
 await expect(cloudCreateProject(client,{name:"different",path:"/fixture"})).rejects.toThrow("did not confirm");
 await expect(cloudUpdateProject(client,"different-id",{})).rejects.toThrow("did not confirm");
 try{assertProjectReceipt({project},{metadata:{marker}});throw new Error("Expected receipt rejection");}catch(error){expect(String(error)).not.toContain(marker);}
 expect(()=>assertProjectReceipt({id:"x"})).toThrow("Invalid project receipt");
});
test("project deletion refuses malformed or mismatched success receipts",async()=>{
 const receipt={schema_version:1,project_id:project.id,deleted:true,preserved_tasks:2,preserved_plans:0,detached_task_lists:0,detached_child_projects:0};
 const client=(value:unknown)=>({transport:{post:async()=>value}} as unknown as HasnaStorageClient);
 expect(await cloudDeleteProjectPreserving(client(receipt),project.id,true)).toEqual(receipt);
 for(const value of [{},null,{...receipt,project_id:"other"},{...receipt,preserved_tasks:-1},{...receipt,deleted:"yes"},{...receipt,deleted:false}])await expect(cloudDeleteProjectPreserving(client(value),project.id,true)).rejects.toThrow("receipt");
});
test("panel refuses incomplete task or incorrectly scoped plan page rather than claiming an empty project",async()=>{
 const client={list:async()=>({raw:{tasks:[],total:1}})} as unknown as HasnaStorageClient;
 await expect(cloudProjectPanel(client,project as any,20)).rejects.toThrow("stalled");
 const wrong={list:async()=>({raw:{tasks:[],total:0}}),transport:{get:async()=>({plans:[{id:"plan",project_id:"other"}],count:1})}} as unknown as HasnaStorageClient;
 await expect(cloudProjectPanel(wrong,project as any,20)).rejects.toThrow("scoped");
});
