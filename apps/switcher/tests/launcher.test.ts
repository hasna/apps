import {test,expect} from "bun:test";
import {mkdir,mkdtemp,writeFile,readFile,rm,readdir} from "node:fs/promises";
import {join} from "node:path";
import {homedir} from "node:os";
import {launch} from "../src/launcher";
import type {SwitcherClient} from "../src/sdk";
test("Grok authentication lockdown rejects provider launch before discovery or credential lookup",async()=>{
  const prior=process.env.GROK_DISABLE_API_KEY_AUTH,team=process.env.GROK_FORCE_LOGIN_TEAM_ID;
  let touched=false;
  const client={getProfile:async()=>({harness:"grok"}),refreshModels:async()=>{touched=true;throw new Error("unexpected discovery");}} as unknown as SwitcherClient;
  try {
    for (const value of ["true","deployment-lockdown"]) {
      process.env.GROK_DISABLE_API_KEY_AUTH=value;
      await expect(launch(client,"locked",{resolveCredential:async()=>{touched=true;return "fixture";}})).rejects.toThrow("native authentication policy");
    }
    process.env.GROK_DISABLE_API_KEY_AUTH="false";process.env.GROK_FORCE_LOGIN_TEAM_ID="fixture-team";
    await expect(launch(client,"locked")).rejects.toThrow("native authentication policy");
    expect(touched).toBe(false);
  } finally {if(prior===undefined)delete process.env.GROK_DISABLE_API_KEY_AUTH;else process.env.GROK_DISABLE_API_KEY_AUTH=prior;if(team===undefined)delete process.env.GROK_FORCE_LOGIN_TEAM_ID;else process.env.GROK_FORCE_LOGIN_TEAM_ID=team;}
});
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

test.skipIf(process.platform === "win32")("normal exit and timeout stop owned harness descendants before removing launch state",async()=>{
  const root=join(homedir(),"Workspace/scratch/switcher-tests");await mkdir(root,{recursive:true});
  const dir=await mkdtemp(join(root,"process-tree-"));
  const executable=join(dir,"native");const descendant=join(dir,"descendant.ts");
  await writeFile(descendant,`import {writeFileSync} from 'node:fs';\nprocess.on('SIGTERM',()=>{});writeFileSync('descendant.pid',String(process.pid));setInterval(()=>writeFileSync('heartbeat',String(Date.now())),25);\n`);
  await writeFile(executable,`#!${process.execPath}\nimport {spawn} from 'node:child_process';import {existsSync} from 'node:fs';\nif(process.argv.includes('--version')){console.log('codex-cli 0.153.4');process.exit(0);}\nspawn(process.execPath,[${JSON.stringify(descendant)}],{stdio:'ignore'}).unref();\nprocess.on('SIGTERM',()=>process.exit(143));\nsetInterval(()=>{if(process.argv.includes('--fixture-exit')&&existsSync('heartbeat'))process.exit(7);},25);\n`,{mode:0o700});
  const records:any[]=[];
  const client={getProfile:async()=>({providerId:"fixture"}),refreshModels:async()=>({}),launchPlan:async()=>({profile:{harness:"codex",model:"fixture-model"},provider:{baseUrl:"http://127.0.0.1:1",protocol:"openai-responses"},catalog:{models:[{id:"fixture-model",name:"Fixture"}]},warnings:[]}),createRun:async()=>({id:"fixture",version:1}),finishRun:async(_id:string,_version:number,body:any)=>{records.push(body);}} as unknown as SwitcherClient;
  try {
    for(const mode of ["normal","timeout"]) {
      const project=join(dir,mode);await mkdir(project);
      try {
        const code=await launch(client,"fixture",{executable,cwd:project,stateDir:join(project,"state"),args:mode==="normal"?["--fixture-exit"]:[],timeoutMs:mode==="normal"?undefined:500});
        expect(code).toBe(mode==="normal"?7:143);
        expect(records.at(-1).status).toBe(mode==="normal"?"failed":"interrupted");
        const heartbeat=await readFile(join(project,"heartbeat"),"utf8");
        await Bun.sleep(150);
        expect(await readFile(join(project,"heartbeat"),"utf8")).toBe(heartbeat);
        expect(await readdir(join(project,"state"))).toEqual([]);
      } finally {
        // Preserve a failing regression's evidence without leaving its fixture running.
        try {process.kill(Number(await readFile(join(project,"descendant.pid"),"utf8")),"SIGKILL");} catch {}
      }
    }
  } finally {await rm(dir,{recursive:true,force:true});}
},25_000);
