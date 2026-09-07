import {expect,test} from "bun:test";
import {mkdir,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";
import {prepareOriModelPolicy} from "../src/ori-model-policy";

for(const target of ["codex","grok"] as const)test(`Ori ${target} shim executes exact native args and isolates credentials`,async()=>{
 const scratch=join(homedir(),"Workspace/scratch/switcher-tests");await mkdir(scratch,{recursive:true});
 const root=await mkdtemp(join(scratch,"ori-policy-"));
 try{
  const native=join(root,"native"),capture=join(root,"capture"),path=join(root,target);
  await writeFile(native,'#!/bin/sh\nprintf \'%s\\0\' "$@" > "$CAPTURE"\nprintf \'%s\\0\' "$SWITCHER_HARNESS_API_KEY" "${OPENROUTER_API_KEY-unset}" >> "$CAPTURE"\n',{mode:0o700});
  const args=["exec","a ' quote","literal `echo x`","literal $(echo x)","a\nb"];
  const shim=prepareOriModelPolicy(target,{executable:native,args,env:{SWITCHER_HARNESS_API_KEY:"synthetic-local",CAPTURE:capture}});
  expect(shim.script).not.toContain("synthetic-local");
  await writeFile(path,shim.script,{mode:0o700});
  const child=Bun.spawn([path,"--model","wrong"],{env:{...shim.env,OPENROUTER_API_KEY:"synthetic-parent"},stdin:"ignore",stdout:"pipe",stderr:"pipe"});
  const stderr=await new Response(child.stderr).text();expect(await child.exited,stderr).toBe(0);
  expect((await readFile(capture,"utf8")).split("\0")).toEqual([...args,"synthetic-local","unset",""]);
 }finally{await rm(root,{recursive:true,force:true});}
});

test("Ori shim rejects invalid executable, argument and env inputs",()=>{
 for(const prepared of [{executable:"relative",args:[],env:{}},{executable:"/native",args:["x\0"],env:{}},{executable:"/native",args:[],env:{"X;echo": "v"}},{executable:"/native",args:[],env:{X:"v\0"}}])expect(()=>prepareOriModelPolicy("codex",prepared)).toThrow();
});
