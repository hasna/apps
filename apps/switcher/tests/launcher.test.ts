import {test,expect} from "bun:test";
import {mkdir,mkdtemp,writeFile,readFile,rm,readdir} from "node:fs/promises";
import {join} from "node:path";
import {homedir} from "node:os";
import {launch} from "../src/launcher";
import type {SwitcherClient} from "../src/sdk";
test("concurrent launches isolate config, preserve child exit on API failure, time out and clean state",async()=>{
  const root=join(homedir(),"Workspace/scratch/switcher-tests");await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,"launch-"));
  const executable=join(dir,"fake-codex");const records:any[]=[];
  await writeFile(executable,`#!/bin/sh\nif [ "$1" = '--version' ]; then echo 'codex-cli 0.153.4'; exit 0; fi\nprintf '%s\\n' "$@" > "$PWD/args"\nexit 7\n`,{mode:0o700});
  const client={getProfile:async(id:string)=>({id,providerId:id}),refreshModels:async()=>({}),launchPlan:async(id:string)=>({profile:{harness:"codex",model:id},provider:{baseUrl:"https://example.com/v1",protocol:"openai-responses",credentialEnv:"SWITCHER_PROVIDER_TEST"},catalog:{models:[{id,name:id}]},warnings:[]}),createRun:async(body:any)=>({id:body.profileId,version:1}),finishRun:async(id:string,_v:number,body:any)=>{records.push({id,...body});throw new Error("API temporarily unavailable");}} as unknown as SwitcherClient;
  const previous=process.env.SWITCHER_PROVIDER_TEST;process.env.SWITCHER_PROVIDER_TEST="test-not-real";
  try{
    const a=join(dir,"a"),b=join(dir,"b");await mkdir(a);await mkdir(b);
    expect(await Promise.all([launch(client,"first",{executable,cwd:a,stateDir:join(dir,"state")}),launch(client,"second",{executable,cwd:b,stateDir:join(dir,"state")})])).toEqual([7,7]);
    expect(await readFile(join(a,"args"),"utf8")).toContain('model="first"');expect(await readFile(join(b,"args"),"utf8")).toContain('model="second"');
    expect(await readdir(join(dir,"state"))).toEqual([]);expect(records.map(r=>r.exitCode)).toEqual([7,7]);
    await writeFile(executable,`#!/bin/sh\nif [ "$1" = '--version' ]; then echo 'codex-cli 0.153.4'; exit 0; fi\nexec sleep 60\n`,{mode:0o700});
    expect(await launch(client,"timed",{executable,cwd:a,stateDir:join(dir,"state"),timeoutMs:100})).toBe(143);
    expect(records.at(-1).status).toBe("interrupted");expect(await readdir(join(dir,"state"))).toEqual([]);
  }finally{if(previous===undefined)delete process.env.SWITCHER_PROVIDER_TEST;else process.env.SWITCHER_PROVIDER_TEST=previous;await rm(dir,{recursive:true,force:true});}
});
