import {test,expect} from "bun:test";
import {spawn} from "node:child_process";
import {mkdir,mkdtemp,writeFile,readFile,rm,readdir} from "node:fs/promises";
import {join} from "node:path";
import {homedir} from "node:os";
import {launch, validateOriForPlan} from "../src/launcher";
import type {SwitcherClient} from "../src/sdk";
import {SwitcherError} from "../src/sdk";
import {providerFromPreset} from "../src/presets";
import {resolveLaunchProvider} from "../src/direct-launch";
test("Gemini auth mismatch is rejected before discovery or credential lookup",async()=>{
  let touched=false;
  const client={
    getProfile:async()=>({providerId:"gemini",harness:"gemini"}),
    getProvider:async()=>({protocol:"gemini-generate-content",authStyle:"bearer"}),
    refreshModels:async()=>{touched=true;throw new Error("unexpected discovery");},
  } as unknown as SwitcherClient;
  await expect(launch(client,"gemini",{resolveCredential:async()=>{touched=true;return "fixture";}})).rejects.toMatchObject({code:"auth_mismatch"});
  expect(touched).toBe(false);
});

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

test("Ori backend preflights its contract, preserves the Switcher catalog and uses the explicit Ori executable", async () => {
  const root=join(homedir(),"Workspace/scratch/switcher-tests"); await mkdir(root,{recursive:true}); const dir=await mkdtemp(join(root,"ori-launch-"));
  const executable=join(dir,"ori-fixture"),nativeExecutable=join(dir,"native-codex");
  await writeFile(nativeExecutable,"#!/bin/sh\necho codex-cli 0.153.4\n",{mode:0o700});
  await writeFile(executable, `#!/bin/sh
if [ "$1" = "--version" ]; then printf '%s\\n' '@ori-runtime/cli 0.12.1+fixture'; exit 0; fi
if [ "$1 $2 $3" = "harness list --json" ]; then printf '%s\\n' '{"ok":true,"data":{"launchable":[{"kind":"codex","installed":true,"path":"${nativeExecutable}"},{"kind":"grok","installed":true,"path":"/fixture/grok"},{"kind":"opencode","installed":false}]}}'; exit 0; fi
printf '%s\\n' "$@" > "$PWD/args"
if [ -n "$OPENROUTER_API_KEY" ]; then printf '%s\\n' present > "$PWD/key-presence"; else printf '%s\\n' absent > "$PWD/key-presence"; fi
exit 7
`,{mode:0o700});
  const records:any[]=[]; let resolved=0;
  const client={
    getProfile:async(id:string)=>({id,providerId:"openrouter",harness:"codex"}), refreshModels:async()=>({}),
    launchPlan:async()=>({planToken:"a".repeat(64),profile:{harness:"codex",model:"openrouter/model"},provider:{id:"openrouter",baseUrl:"https://openrouter.ai/api/v1",protocol:"openai-responses",credentialEnv:"SWITCHER_PROVIDER_OPENROUTER",authStyle:"bearer"},catalog:{models:[{id:"openrouter/model",name:"Fixture",supportedParameters:["tools"]},{id:"other/model",name:"Other",available:false}],refreshedAt:new Date().toISOString(),source:"remote"},warnings:[]}),
    createRun:async(body:any)=>({id:body.profileId,version:1}), finishRun:async(_id:string,_version:number,body:any)=>{records.push(body);},
  } as unknown as SwitcherClient;
  try {
    const routed=providerFromPreset("openrouter",{protocol:"openai-responses",harness:"codex"});
    const resolvedProvider=await resolveLaunchProvider({
      getProvider:async()=>{throw new SwitcherError(404,"not_found","fixture");},
      createProvider:async(input:any)=>({...input,version:1,updatedAt:new Date().toISOString()}),
    } as unknown as SwitcherClient,"openrouter",{protocol:"openai-responses",harness:"codex"});
    expect(resolvedProvider.id).toBe(routed.id);
    expect(resolvedProvider.baseUrl).toBe("https://openrouter.ai/api/v1");
    const routedClient={...client,launchPlan:async(id:string)=>({...await client.launchPlan(id),provider:resolvedProvider})} as unknown as SwitcherClient;
    const diagnostic=await validateOriForPlan(await routedClient.launchPlan("ori-profile"),{oriExecutable:executable,cwd:dir});
    expect(diagnostic.contract.version).toBe("0.12.1+fixture");
    const selectedKey=process.env.OPENROUTER_API_KEY,unrelatedKey=process.env.OTHER_PROVIDER_API_KEY;
    process.env.OPENROUTER_API_KEY="fixture";process.env.OTHER_PROVIDER_API_KEY="fixture";
    try {
      await writeFile(nativeExecutable,"#!/bin/sh\nif [ -n \"$OPENROUTER_API_KEY$OTHER_PROVIDER_API_KEY\" ]; then exit 91; fi\necho codex-cli 0.153.4\n",{mode:0o700});
      await expect(validateOriForPlan(await routedClient.launchPlan("ori-profile"),{oriExecutable:executable,cwd:dir})).resolves.toMatchObject({contract:{version:"0.12.1+fixture"}});
    } finally {
      if(selectedKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=selectedKey;
      if(unrelatedKey===undefined)delete process.env.OTHER_PROVIDER_API_KEY;else process.env.OTHER_PROVIDER_API_KEY=unrelatedKey;
    }

    await writeFile(nativeExecutable,"#!/bin/sh\necho codex-cli 0.152.0\n",{mode:0o700});
    await expect(launch(routedClient,"ori-profile",{backend:"ori",oriExecutable:executable,cwd:dir,stateDir:join(dir,"state"),resolveCredential:async()=>{resolved++;return "fixture";}})).rejects.toThrow("Codex >=0.153.0");
    expect(resolved).toBe(0);expect(await readdir(join(dir,"state"))).toEqual([]);
    await writeFile(nativeExecutable,"#!/bin/sh\necho codex-cli 0.153.4\n",{mode:0o700});
    await expect(validateOriForPlan({...await routedClient.launchPlan("ori-profile"),provider:{...resolvedProvider,authStyle:"x-api-key"}},{oriExecutable:executable,cwd:dir})).rejects.toThrow("Bearer authentication contract");
    const previousLogin=process.env.ORI_REQUIRE_LOGIN; process.env.ORI_REQUIRE_LOGIN="1"; resolved=0;
    try {
      await expect(launch(routedClient,"ori-profile",{backend:"ori",oriExecutable:executable,resolveCredential:async()=>{resolved++;return "fixture";}})).rejects.toThrow("cannot bypass native Ori login policy");
      expect(resolved).toBe(0);
    } finally { if(previousLogin===undefined) delete process.env.ORI_REQUIRE_LOGIN; else process.env.ORI_REQUIRE_LOGIN=previousLogin; }
    const grokClient={...client,launchPlan:async()=>({...(await client.launchPlan("grok")),profile:{harness:"grok",model:"openrouter/model"},provider:{id:"openrouter",baseUrl:"https://openrouter.ai/api/v1",protocol:"openai-chat",credentialEnv:"SWITCHER_PROVIDER_OPENROUTER",authStyle:"bearer"}})} as unknown as SwitcherClient;
    const previousGrok=process.env.GROK_DISABLE_API_KEY_AUTH; process.env.GROK_DISABLE_API_KEY_AUTH="deployment-lockdown";
    try { await expect(validateOriForPlan(await grokClient.launchPlan("grok"),{oriExecutable:executable})).rejects.toThrow("native authentication policy"); }
    finally { if(previousGrok===undefined) delete process.env.GROK_DISABLE_API_KEY_AUTH; else process.env.GROK_DISABLE_API_KEY_AUTH=previousGrok; }
    const code=await launch(routedClient,"ori-profile",{backend:"ori",oriExecutable:executable,cwd:dir,stateDir:join(dir,"state"),resolveCredential:async()=>{resolved++;return "fixture-openrouter-key";}});
    expect(code).toBe(7); expect(resolved).toBe(1); expect(records.at(-1)).toMatchObject({status:"failed",exitCode:7});
    const args=(await readFile(join(dir,"args"),"utf8")).split("\n");
    expect(args.slice(0,3)).toEqual(["codex","--model","openrouter/model"]);
    expect(args.some(value=>value.startsWith("model_catalog_json=../../"))).toBe(false);
    expect(args.some(value=>value.startsWith("model_catalog_json=\"/"))).toBe(true);
    expect(await readFile(join(dir,"key-presence"),"utf8")).toBe("present\n");
    const badClient={...client,launchPlan:async()=>({...(await client.launchPlan("bad")),provider:{id:"openrouter",baseUrl:"https://evil.example/api/v1",protocol:"openai-responses",credentialEnv:"SWITCHER_PROVIDER_OPENROUTER",authStyle:"bearer"}})} as unknown as SwitcherClient;
    resolved=0; await expect(launch(badClient,"bad",{backend:"ori",oriExecutable:executable,resolveCredential:async()=>{resolved++;return "fixture";}})).rejects.toThrow("openrouter"); expect(resolved).toBe(0);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("concurrent launches isolate config, preserve child exit on API failure, time out and clean state",async()=>{
  const root=join(homedir(),"Workspace/scratch/switcher-tests");await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,"launch-"));
  const executable=join(dir,"fake-codex");const records:any[]=[];
  await writeFile(executable,`#!/bin/sh\nif [ "$1" = '--version' ]; then echo 'codex-cli 0.153.4'; exit 0; fi\nprintf '%s\\n' "$@" > "$PWD/args"\nexit 7\n`,{mode:0o700});
  const client={getProfile:async(id:string)=>({id,providerId:id,harness:"codex"}),refreshModels:async()=>({}),launchPlan:async(id:string)=>({profile:{harness:"codex",model:id},provider:{baseUrl:"https://example.com/v1",protocol:"openai-responses",credentialEnv:"SWITCHER_PROVIDER_TEST"},catalog:{models:[{id,name:id}]},warnings:[]}),createRun:async(body:any)=>({id:body.profileId,version:1}),finishRun:async(id:string,_v:number,body:any)=>{records.push({id,...body});throw new Error("API temporarily unavailable");}} as unknown as SwitcherClient;
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
  const client={getProfile:async()=>({providerId:"fixture",harness:"codex"}),refreshModels:async()=>({}),launchPlan:async()=>({profile:{harness:"codex",model:"fixture-model"},provider:{baseUrl:"http://127.0.0.1:1",protocol:"openai-responses"},catalog:{models:[{id:"fixture-model",name:"Fixture"}]},warnings:[]}),createRun:async()=>({id:"fixture",version:1}),finishRun:async(_id:string,_version:number,body:any)=>{records.push(body);}} as unknown as SwitcherClient;
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


test("SDK rejects native profile overrides before catalog or credential lookup",async()=>{
  let touched=false;
  const client={getProfile:async()=>({harness:"codex"}),refreshModels:async()=>{touched=true;throw new Error("unexpected discovery");}} as unknown as SwitcherClient;
  await expect(launch(client,"saved",{args:["exec","-moutside"],resolveCredential:async()=>{touched=true;return "fixture";}})).rejects.toThrow("profile");
  expect(touched).toBe(false);
});

test("a changed API launch plan is checked again before local credential lookup",async()=>{
  let credentialRead=false;
  const client={getProfile:async()=>({harness:"claude"}),launchPlan:async()=>({profile:{harness:"codex"}})} as unknown as SwitcherClient;
  await expect(launch(client,"changed",{refresh:false,args:["-moutside"],resolveCredential:async()=>{credentialRead=true;return "fixture";}})).rejects.toThrow("profile");
  expect(credentialRead).toBe(false);
});


test.skipIf(process.platform === "win32")("launch timeout covers Prime readiness and finalizes a late run without starting the client",async()=>{
  const root=join(homedir(),"Workspace/scratch/switcher-tests");await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,"prime-timeout-"));const runtime=join(homedir(),"Workspace/scratch/u");await mkdir(runtime,{recursive:true});
  const executable=join(dir,"prime-fixture"),clientStarted=join(dir,"client-started");
  await writeFile(executable,`#!${process.execPath}
import {createServer} from 'node:net';
const socket=process.argv[process.argv.indexOf('--daemon-socket')+1];
if(process.argv.includes('--version')){console.log('prime-agent 0.9.2');process.exit(0);}
if(process.argv.includes('--mode')){
  process.on('SIGTERM',()=>process.exit(143));
  setTimeout(()=>{const server=createServer(connection=>{connection.write(JSON.stringify({type:'daemon_hello'})+'\\n');connection.on('data',data=>{for(const line of data.toString().split('\\n')){if(!line)continue;const request=JSON.parse(line);if(request.command?.type==='shutdown'){connection.write(JSON.stringify({type:'response',success:true})+'\\n');server.close(()=>process.exit(0));}}});});server.listen(socket)},1500);
  setInterval(()=>{},1000);
} else {await Bun.write(${JSON.stringify(clientStarted)},'started');process.exit(99)}
`,{mode:0o700});
  const records:any[]=[];
  const client={
    getProfile:async()=>({providerId:'fixture',harness:'prime-agent',model:'fixture-model'}),refreshModels:async()=>{},
    launchPlan:async()=>({planToken:'${"a".repeat(64)}',profile:{harness:'prime-agent',model:'fixture-model'},provider:{baseUrl:'http://127.0.0.1:1/v1',protocol:'openai-chat',authStyle:'bearer'},catalog:{models:[{id:'fixture-model',name:'Fixture',supportedParameters:['tools'],inputModalities:['text'],outputModalities:['text']}],refreshedAt:new Date().toISOString(),source:'manual'},warnings:[]}),
    createRun:async()=>({id:'fixture-run',version:1}),finishRun:async(_id:string,_version:number,body:any)=>{records.push(body);},
  } as unknown as SwitcherClient;
  const previousTmp=process.env.TMPDIR;process.env.TMPDIR=runtime;
  try {
    let error:any;
    try { await launch(client,'fixture',{executable,cwd:dir,stateDir:join(dir,'state'),resolveCredential:async()=> 'fixture-key',timeoutMs:100,refresh:false}); }
    catch (caught) { error=caught; }
    expect(error).toMatchObject({code:'interrupted',exitCode:143});
    expect(await readFile(clientStarted).catch(()=>''),'native client must not start after readiness timeout').toBe('');
    expect(records).toEqual([]);
    await Bun.sleep(1700);
    expect(await readFile(clientStarted).catch(()=>''),'late supervisor must not reach the client').toBe('');
  } finally { if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp;await rm(dir,{recursive:true,force:true}); }
},10_000);

test("launch timeout finalizes a createRun that resolves after cancellation",async()=>{
  const root=join(homedir(),"Workspace/scratch/switcher-tests");await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,"late-run-"));
  const executable=join(dir,"codex-fixture"),started=join(dir,"native-started");
  await writeFile(executable,`#!${process.execPath}
if(process.argv.includes('--version')){console.log('codex-cli 0.153.4');process.exit(0)}
await Bun.write(${JSON.stringify(started)},'started');process.exit(7);
`,{mode:0o700});
  const records:any[]=[];
  const client={
    getProfile:async()=>({providerId:'fixture',harness:'codex',model:'fixture-model'}),refreshModels:async()=>{},
    launchPlan:async()=>({planToken:'${"b".repeat(64)}',profile:{harness:'codex',model:'fixture-model'},provider:{baseUrl:'http://127.0.0.1:1/v1',protocol:'openai-responses'},catalog:{models:[{id:'fixture-model',name:'Fixture'}],refreshedAt:new Date().toISOString(),source:'manual'},warnings:[]}),
    createRun:async()=>{await Bun.sleep(700);return {id:'late-run',version:3};},finishRun:async(_id:string,_version:number,body:any)=>{records.push(body);},
  } as unknown as SwitcherClient;
  try {
    let error:any;
    try { await launch(client,'fixture',{executable,cwd:dir,stateDir:join(dir,'state'),resolveCredential:async()=> 'fixture-key',timeoutMs:500,refresh:false}); }
    catch (caught) { error=caught; }
    expect(error).toMatchObject({code:'interrupted',exitCode:143});
    expect(records).toEqual([{status:'interrupted',exitCode:143}]);
    expect(await readFile(started).catch(()=>''),'native client must not start after createRun cancellation').toBe('');
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("same-turn preparation cancellation finalizes a createRun before its race continuation",async()=>{
  const root=join(homedir(),"Workspace/scratch/switcher-tests");await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,"same-turn-run-"));
  const executable=join(dir,"codex-fixture"),started=join(dir,"native-started");
  await writeFile(executable,`#!${process.execPath}
if(process.argv.includes('--version')){console.log('codex-cli 0.153.4');process.exit(0)}
await Bun.write(${JSON.stringify(started)},'started');process.exit(7);
`,{mode:0o700});
  const records:any[]=[];
  const client={
    getProfile:async()=>({providerId:'fixture',harness:'codex',model:'fixture-model'}),refreshModels:async()=>{},
    launchPlan:async()=>({planToken:'${"c".repeat(64)}',profile:{harness:'codex',model:'fixture-model'},provider:{baseUrl:'http://127.0.0.1:1/v1',protocol:'openai-responses'},catalog:{models:[{id:'fixture-model',name:'Fixture'}],refreshedAt:new Date().toISOString(),source:'manual'},warnings:[]}),
    createRun:()=>new Promise(resolve=>setTimeout(()=>{process.emit('SIGTERM');resolve({id:'same-turn-run',version:4});},0)),finishRun:async(_id:string,_version:number,body:any)=>{records.push(body);},
  } as unknown as SwitcherClient;
  try {
    let error:any;
    try { await launch(client,'fixture',{executable,cwd:dir,stateDir:join(dir,'state'),resolveCredential:async()=> 'fixture-key',timeoutMs:5000,refresh:false}); }
    catch (caught) { error=caught; }
    expect(error).toMatchObject({code:'interrupted',exitCode:143});
    expect(records).toEqual([{status:'interrupted',exitCode:143}]);
    expect(await readFile(started).catch(()=>''),'native client must not start after same-turn cancellation').toBe('');
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("same-turn signal and createRun resolution finalize exactly once in either order",async()=>{
  const root=join(homedir(),"Workspace/scratch/switcher-tests");await mkdir(root,{recursive:true});
  const dir=await mkdtemp(join(root,"same-turn-orders-"));const executable=join(dir,"codex-fixture");
  await writeFile(executable,`#!${process.execPath}\nif(process.argv.includes('--version')){console.log('codex-cli 0.153.4');process.exit(0)}\nawait Bun.write(${JSON.stringify(join(dir,"native-started"))},'started');process.exit(7);`,{mode:0o700});
  try {
    for(const signal of ["SIGINT","SIGTERM","SIGHUP"] as const) for(const order of ["signal-first","resolve-first"] as const) {
      const records:any[]=[];
      const client={
        getProfile:async()=>({providerId:'fixture',harness:'codex',model:'fixture-model'}),refreshModels:async()=>{},
        launchPlan:async()=>({planToken:'${"d".repeat(64)}',profile:{harness:'codex',model:'fixture-model'},provider:{baseUrl:'http://127.0.0.1:1/v1',protocol:'openai-responses'},catalog:{models:[{id:'fixture-model',name:'Fixture'}],refreshedAt:new Date().toISOString(),source:'manual'},warnings:[]}),
        createRun:()=>new Promise(resolve=>setTimeout(()=>{
          if(order==='signal-first'){process.emit(signal);resolve({id:'same-turn-run',version:4});}
          else {resolve({id:'same-turn-run',version:4});queueMicrotask(()=>process.emit(signal));}
        },0)),
        finishRun:async(_id:string,_version:number,body:any)=>{records.push(body);},
      } as unknown as SwitcherClient;
      let error:any;
      try { await launch(client,'fixture',{executable,cwd:dir,stateDir:join(dir,`${signal}-${order}`),resolveCredential:async()=> 'fixture-key',timeoutMs:5000,refresh:false}); }
      catch (caught) { error=caught; }
      expect(error).toMatchObject({code:'interrupted',exitCode:signal==='SIGINT'?130:signal==='SIGTERM'?143:129});
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({status:'interrupted',exitCode:signal==='SIGINT'?130:signal==='SIGTERM'?143:129});
      expect(await readFile(join(dir,'native-started')).catch(()=>'')).toBe('');
    }
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test.skipIf(process.platform === "win32")("Prime launch cancellation during supervisor readiness cleans up before native client spawn",async()=>{
  const root=join(homedir(),"Workspace/scratch/switcher-tests");await mkdir(root,{recursive:true});
  const dir=await mkdtemp(join(root,"prime-signal-"));
  // Keep the owned runtime short enough for Unix socket paths on macOS and Linux.
  const runtime=await mkdtemp(join(homedir(),"Workspace","scratch","u"));
  const executable=join(dir,"prime-fixture"),runner=join(dir,"runner.ts"),spawned=join(dir,"daemon-spawned"),clientStarted=join(dir,"client-started");
  const launcherSource = await Bun.file(join(process.cwd(),"src/launcher.ts")).exists() ? join(process.cwd(),"src/launcher.ts") : join(process.cwd(),"apps/switcher/src/launcher.ts");
  await writeFile(executable,`#!${process.execPath}
import {createServer} from 'node:net';
import {writeFileSync,unlinkSync} from 'node:fs';
const socket=process.argv[process.argv.indexOf('--daemon-socket')+1];
if(process.argv.includes('--version')){console.log('prime-agent 0.9.2');process.exit(0);}
if(process.argv.includes('--mode')){
  writeFileSync(${JSON.stringify(spawned)},socket);
  const stop=()=>{try{unlinkSync(socket)}catch{};process.exit(143)};process.on('SIGTERM',stop);process.on('SIGINT',stop);
  setTimeout(()=>{const server=createServer(connection=>{connection.setEncoding('utf8');connection.write(JSON.stringify({type:'daemon_hello'})+'\\n');connection.on('data',data=>{for(const line of data.split('\\n')){if(!line)continue;const request=JSON.parse(line);if(request.command?.type==='shutdown'){connection.write(JSON.stringify({type:'response',success:true})+'\\n');server.close(()=>{try{unlinkSync(socket)}catch{};process.exit(0)});}}});});server.listen(socket)},1500);
  setInterval(()=>{},1000);
} else {writeFileSync(${JSON.stringify(clientStarted)},'started');process.exit(99)}
`,{mode:0o700});
  await writeFile(runner,`import {launch} from ${JSON.stringify(launcherSource)};
const fixture=${JSON.stringify(executable)};
const client={getProfile:async()=>({providerId:'fixture',harness:'prime-agent',model:'fixture-model'}),refreshModels:async()=>({}),launchPlan:async()=>({planToken:'${"a".repeat(64)}',profile:{harness:'prime-agent',model:'fixture-model'},provider:{baseUrl:'http://127.0.0.1:1/v1',protocol:'openai-chat',authStyle:'bearer'},catalog:{models:[{id:'fixture-model',name:'Fixture',supportedParameters:['tools'],inputModalities:['text'],outputModalities:['text']}],refreshedAt:new Date().toISOString(),source:'manual'},warnings:[]}),createRun:async()=>({id:'fixture',version:1}),finishRun:async()=>{}};
try{const code=await launch(client,'fixture',{executable:fixture,cwd:${JSON.stringify(dir)},stateDir:${JSON.stringify(join(dir,"state"))},refresh:false});process.exitCode=code}catch(error){console.error(error);process.exitCode=error?.exitCode??1}
`);
  const child=spawn(process.execPath,[runner],{cwd:dir,env:{...process.env,TMPDIR:runtime,HASNA_SWITCHER_HOME:join(dir,"home"),SWITCHER_PROVIDER_FIXTURE:"fixture-key"},stdio:["ignore","pipe","pipe"]});
  let stderr="";child.stderr?.on("data",chunk=>{stderr+=chunk.toString()});
  try {
    const deadline=Date.now()+5000;while(Date.now()<deadline){try{await readFile(spawned);break}catch{await Bun.sleep(10)}}
    if (!(await readFile(spawned).then(()=>true,()=>false))) throw new Error(`Prime fixture did not spawn: ${stderr}`);
    expect(await readFile(spawned,"utf8")).toContain(".sock");
    child.kill("SIGTERM");
    const code=await new Promise<number>((resolve,reject)=>{child.once("error",reject);child.once("exit",value=>resolve(value??-1))});
    expect(code,stderr).toBe(143);expect(await readFile(clientStarted).catch(()=>"")).toBe("");
    const socket=await readFile(spawned,"utf8");expect(await readFile(socket).catch(()=>"")).toBe("");expect(await readdir(join(dir,"state")).catch(()=>[])).toEqual(["sessions"]);
    await Bun.sleep(1600);expect(await readFile(socket).catch(()=>"")).toBe("");
  } finally {if(!child.killed)child.kill("SIGKILL");await rm(dir,{recursive:true,force:true});await rm(runtime,{recursive:true,force:true});}
},15_000);

test.skipIf(process.platform === "win32")("normal exit and timeout stop owned harness descendants before removing launch state",async()=>{
  const root=join(homedir(),"Workspace/scratch/switcher-tests");await mkdir(root,{recursive:true});
  const dir=await mkdtemp(join(root,"process-tree-"));
  const executable=join(dir,"native");const descendant=join(dir,"descendant.ts");
  await writeFile(descendant,`import {writeFileSync} from 'node:fs';\nprocess.on('SIGTERM',()=>{});writeFileSync('descendant.pid',String(process.pid));setInterval(()=>writeFileSync('heartbeat',String(Date.now())),25);\n`);
  await writeFile(executable,`#!${process.execPath}\nimport {spawn} from 'node:child_process';import {existsSync} from 'node:fs';\nif(process.argv.includes('--version')){console.log('codex-cli 0.153.4');process.exit(0);}\nspawn(process.execPath,[${JSON.stringify(descendant)}],{stdio:'ignore'}).unref();\nprocess.on('SIGTERM',()=>process.exit(143));\nsetInterval(()=>{if(process.argv.includes('--fixture-exit')&&existsSync('heartbeat'))process.exit(7);},25);\n`,{mode:0o700});
  const records:any[]=[];
  const client={getProfile:async()=>({providerId:"fixture",harness:"codex"}),refreshModels:async()=>({}),launchPlan:async()=>({profile:{harness:"codex",model:"fixture-model"},provider:{baseUrl:"http://127.0.0.1:1",protocol:"openai-responses"},catalog:{models:[{id:"fixture-model",name:"Fixture"}]},warnings:[]}),createRun:async()=>({id:"fixture",version:1}),finishRun:async(_id:string,_version:number,body:any)=>{records.push(body);}} as unknown as SwitcherClient;
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
