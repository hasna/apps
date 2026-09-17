import {test,expect} from "bun:test";
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,realpath,readdir,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {prepareHarnessLaunch,validateHarnessVersion} from "../src/harnesses";
import {assertHarnessArguments} from "../src/harness-arguments";
import {launch} from "../src/launcher";
import type {SwitcherClient} from "../src/sdk";
import {compatible,harnessSchema} from "../src/domain";
import {harnessInstallation} from "../src/harness-installation";
import {validateAntigravityConfiguration} from "../src/antigravity-config";
import {validateJunieConfiguration} from "../src/junie-config";

test("CLI adapters advertise verified binaries and reject incompatible native versions",()=>{
 for(const id of ["antigravity","junie"] as const)expect(harnessSchema.parse(id)).toBe(id);
 expect(harnessInstallation("antigravity").executable).toBe("agy");
 expect(compatible("antigravity","gemini-generate-content")).toBe(true);
 expect(compatible("antigravity","openai-chat")).toBe(false);
 expect(compatible("junie","openai-chat")).toBe(true);
 expect(()=>validateHarnessVersion("antigravity","1.1.24")).toThrow();
 expect(()=>validateHarnessVersion("antigravity","1.2.5")).not.toThrow();
 expect(()=>validateHarnessVersion("junie","Junie version: 26.9.14 (3196.5)")).not.toThrow();
 expect(()=>validateHarnessVersion("junie","3196.4")).toThrow();
});
test("native routing overrides cannot hide behind prompt arguments",()=>{
 for(const args of [["--model=x"],["--model","x"],["--remote-control"],["update"]])expect(()=>assertHarnessArguments("antigravity",args)).toThrow();
 expect(()=>assertHarnessArguments("antigravity",["-p","--model=x","--output-format","json"])).not.toThrow();
 for(const flag of ["--model","--provider","--auth","-a","--openrouter-api-key","--litellm-url","--config-location","--config-default-locations","--model-location","--model-default-locations","--cache-dir","--project","--acp","--gateway"])
  expect(()=>assertHarnessArguments("junie",[flag,"x"])).toThrow();
 expect(()=>assertHarnessArguments("junie",["--task","--model=x","--output-format","json"])).not.toThrow();
});
test("Antigravity owns routing, preserves permission policy and retains profile conversations",async()=>{
 const root=await mkdtemp(join(tmpdir(),"switcher-agy-")),oldHome=process.env.HOME;process.env.HOME=root;
 await mkdir(join(root,".gemini","antigravity-cli"),{recursive:true});
 await writeFile(join(root,".gemini","antigravity-cli","settings.json"),JSON.stringify({permissions:{deny:["command(rm)"]},toolPermission:"strict"}));
 const seen:string[]=[],events:any[]=[];
 const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(req){seen.push(new URL(req.url).pathname);expect(req.headers.get("x-goog-api-key")).toBe("fixture-provider");return Response.json({candidates:[]});}});
 let prepared:Awaited<ReturnType<typeof prepareHarnessLaunch>>|undefined;
 try {
  prepared=await prepareHarnessLaunch({harness:"antigravity",version:"1.2.5",cwd:root,stateDir:join(root,"state"),sessionDir:join(root,"sessions"),baseUrl:upstream.url.origin+"/v1beta",authStyle:"x-api-key",protocol:"gemini-generate-content",model:"gemini-main",models:[{id:"gemini-main",name:"Main"},{id:"gemini-fast",name:"Fast"}],modelPolicy:{version:1,roles:{fast:"gemini-fast"}},credential:"fixture-provider",onRoutingEvent:e=>events.push(e)});
  const settings=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));
  expect(settings.permissions.deny).toEqual(["command(rm)"]);expect(settings.toolPermission).toBe("strict");expect(settings.modelProvider).toBe("gemini");
  expect(Object.values(settings.customModelsConfig.customModels).map((m:any)=>m.modelName)).toContain("gemini-main");
  expect(JSON.stringify(settings)).not.toContain("fixture-provider");expect(prepared.env.GEMINI_API_KEY).not.toBe("fixture-provider");
  expect((await stat(prepared.configPaths[0])).mode&0o777).toBe(0o600);
  expect(prepared.args.slice(0,2)).toEqual(["--add-dir",root]);
  expect(await realpath(join(prepared.env.HOME,".gemini","antigravity-cli","conversations"))).toContain("sessions");
  const invoke=async(id:string)=>fetch(prepared!.env.GOOGLE_GEMINI_BASE_URL+`/v1beta/models/${id}:generateContent`,{method:"POST",headers:{"x-goog-api-key":prepared!.env.GEMINI_API_KEY},body:JSON.stringify({contents:[]})});
  expect((await invoke("gemini-main")).status).toBe(200);
  expect((await invoke("gemini-3.1-flash-lite-preview")).status).toBe(200);
  expect((await invoke("outside")).status).toBe(403);
  expect(seen).toEqual(["/v1beta/models/gemini-main:generateContent","/v1beta/models/gemini-fast:generateContent"]);
  expect(events.some(e=>e.reason==="antigravity_helper_model"&&e.resolvedModel==="gemini-fast")).toBe(true);
 } finally {await prepared?.cleanup?.();upstream.stop(true);if(oldHome===undefined)delete process.env.HOME;else process.env.HOME=oldHome;await rm(root,{recursive:true,force:true});}
});
test("Junie custom profiles use gateway env credentials, role slots and isolated settings",async()=>{
 const root=await mkdtemp(join(tmpdir(),"switcher-junie-")),oldHome=process.env.HOME;process.env.HOME=root;
 let prepared:Awaited<ReturnType<typeof prepareHarnessLaunch>>|undefined;
 try {
  await mkdir(join(root,".junie"));
  const allowlist={defaultBehavior:"ask",allowReadonlyCommands:false,rules:{executables:{rules:[{pattern:"curl **",action:"ask"},{prefix:"git status",action:"allow"}]}}};
  await writeFile(join(root,".junie","allowlist.json"),JSON.stringify(allowlist));
  await writeFile(join(root,".junie","AGENTS.md"),"Preserve global fixture instructions.\n");
  prepared=await prepareHarnessLaunch({harness:"junie",version:"26.9.14 (3196.5)",cwd:root,stateDir:join(root,"state"),sessionDir:join(root,"sessions"),baseUrl:"https://openrouter.ai/api/v1",protocol:"openai-chat",model:"vendor/main",models:[{id:"vendor/main",name:"Main"},{id:"vendor/fast",name:"Fast"}],modelPolicy:{version:1,roles:{fast:"vendor/fast"}},credential:"fixture-provider",args:["--task","Inspect code"]});
  expect(JSON.parse(await readFile(join(prepared.env.JUNIE_HOME,"allowlist.json"),"utf8"))).toEqual(allowlist);
  expect(await readFile(join(prepared.env.JUNIE_HOME,"AGENTS.md"),"utf8")).toBe("Preserve global fixture instructions.\n");
  const profile=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));
  expect(profile.id).toBe("vendor/main");expect(profile.apiType).toBe("OpenAICompletion");expect(profile.apiKey).toBe("${SWITCHER_HARNESS_API_KEY}");
  expect(profile.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1\/chat\/completions$/);expect(profile.fasterModel.id).toBe("vendor/fast");
  expect(prepared.args).toContain("custom:switcher");expect(prepared.args).toContain("--config-default-locations");expect(prepared.env.JUNIE_HOME).toContain("state");expect(prepared.args).toContain(join(root,"sessions","junie-cache"));
  expect(await realpath(join(prepared.env.JUNIE_HOME,"sessions"))).toBe(join(root,"sessions","junie","sessions"));
  expect(JSON.stringify(profile)).not.toContain("fixture-provider");expect(prepared.env.SWITCHER_HARNESS_API_KEY).not.toBe("fixture-provider");
 }finally{await prepared?.cleanup?.();if(oldHome===undefined)delete process.env.HOME;else process.env.HOME=oldHome;await rm(root,{recursive:true,force:true});}
});
test("native configuration rejects routing conflicts before credential delivery",async()=>{
 const root=await mkdtemp(join(tmpdir(),"switcher-cli-config-"));
 try {
  await mkdir(join(root,".junie"));await writeFile(join(root,".junie","settings.json"),JSON.stringify({provider:"openai"}));
  await expect(validateJunieConfiguration(root,{HOME:root})).rejects.toThrow("routing");
  await mkdir(join(root,".gemini","antigravity-cli"),{recursive:true});await writeFile(join(root,".gemini","antigravity-cli","settings.json"),JSON.stringify({customModelsConfig:{customModels:{other:{modelName:"outside"}}}}));
  await expect(validateAntigravityConfiguration(root,{HOME:root})).rejects.toThrow("routing");
 }finally{await rm(root,{recursive:true,force:true});}
});

test("native parser variants are rejected before discovery and credential lookup",async()=>{
 const cases={antigravity:[["-model=outside"],["-remote-control"],["-print","literal","-model","outside"]],junie:[["-p/absent"],["-c/cache"],["-afixture-auth"]]} as const;
 for(const harness of ["antigravity","junie"] as const)for(const args of cases[harness]){
  let touched=false;
  const client={getProfile:async()=>({harness}),getProvider:async()=>{touched=true;throw new Error("unexpected provider lookup");},refreshModels:async()=>{touched=true;throw new Error("unexpected discovery");}} as unknown as SwitcherClient;
  await expect(launch(client,"fixture",{args:[...args],resolveCredential:async()=>{touched=true;return "fixture";}})).rejects.toThrow("reserved");
  expect(touched).toBe(false);
 }
 expect(()=>assertHarnessArguments("antigravity",["-print","-model=literal"])).not.toThrow();
 expect(()=>assertHarnessArguments("junie",["--task","-p/literal"])).not.toThrow();
});
for(const harness of ["antigravity","junie"] as const)test(`${harness} launcher retains native sessions after private launch cleanup`,async()=>{
 const root=await mkdtemp(join(tmpdir(),"switcher-native-launch-")),oldHome=process.env.HOME,oldJunieHome=process.env.JUNIE_HOME;process.env.HOME=root;delete process.env.JUNIE_HOME;
 const state=join(root,"state"),executable=join(root,"native"),version=harness==="antigravity"?"1.2.5":"Junie version: 26.9.14 (3196.5)";
 const provider={id:"fixture",baseUrl:"http://127.0.0.1:1/v1beta",protocol:harness==="antigravity"?"gemini-generate-content":"openai-chat",authStyle:"x-api-key"};
 const client={getProfile:async()=>({harness,providerId:"fixture"}),getProvider:async()=>provider,refreshModels:async()=>({}),launchPlan:async()=>({profile:{harness,model:"fixture-model"},provider,catalog:{models:[{id:"fixture-model",name:"Fixture"}]},warnings:[]}),createRun:async()=>({id:"fixture",version:1}),finishRun:async()=>({})} as unknown as SwitcherClient;
 try{
  await writeFile(executable,`#!${process.execPath}
import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
if(process.argv.includes('--version')){console.log(${JSON.stringify(version)});process.exit(0);}
const dir=${harness==="antigravity"?'join(process.env.HOME,".gemini","antigravity-cli","conversations")':'join(process.env.JUNIE_HOME,"sessions")'};const file=join(dir,'retained.json');let count=0;try{count=Number(readFileSync(file,'utf8'));}catch{}writeFileSync(file,String(count+1));
`,{mode:0o700});
  for(let turn=1;turn<=2;turn++){
   expect(await launch(client,"fixture",{executable,cwd:root,stateDir:state,resolveCredential:async()=>"fixture-key"})).toBe(0);
   expect(await readdir(state)).toEqual(["sessions"]);
   const path=harness==="antigravity"?join(state,"sessions",harness,"fixture","antigravity","conversations","retained.json"):join(state,"sessions",harness,"fixture","junie","sessions","retained.json");
   expect(await readFile(path,"utf8")).toBe(String(turn));
  }
 }finally{if(oldHome===undefined)delete process.env.HOME;else process.env.HOME=oldHome;if(oldJunieHome===undefined)delete process.env.JUNIE_HOME;else process.env.JUNIE_HOME=oldJunieHome;await rm(root,{recursive:true,force:true});}
});

test("Antigravity rejects indistinguishable helper and main routing before starting a gateway",async()=>{
 const root=await mkdtemp(join(tmpdir(),"switcher-agy-ambiguous-"));
 try{
  await expect(prepareHarnessLaunch({harness:"antigravity",version:"1.2.5",cwd:root,stateDir:join(root,"state"),baseUrl:"https://generativelanguage.googleapis.com/v1beta",authStyle:"x-api-key",protocol:"gemini-generate-content",model:"gemini-3.1-flash-lite-preview",models:[{id:"gemini-3.1-flash-lite-preview",name:"Main"},{id:"gemini-other",name:"Fast"}],modelPolicy:{roles:{fast:"gemini-other"}},credential:"fixture-key"})).rejects.toThrow("indistinguishable");
  expect(await readdir(root)).toEqual([]);
  const previousHome=process.env.HOME;process.env.HOME=root;
  try{
   const prepared=await prepareHarnessLaunch({harness:"antigravity",version:"1.2.5",cwd:root,stateDir:join(root,"state"),baseUrl:"https://generativelanguage.googleapis.com/v1beta",authStyle:"x-api-key",protocol:"gemini-generate-content",model:"gemini-3.1-flash-lite-preview",models:[{id:"gemini-3.1-flash-lite-preview",name:"Main"}],modelPolicy:{roles:{fast:"gemini-3.1-flash-lite-preview"}},credential:"fixture-key"});
   expect(prepared.args).toContain("switcher");await prepared.cleanup?.();
  }finally{if(previousHome===undefined)delete process.env.HOME;else process.env.HOME=previousHome;}
 }finally{await rm(root,{recursive:true,force:true});}
});

test("Junie refuses unsafe global policy or instruction files before credential delivery",async()=>{
 const root=await mkdtemp(join(tmpdir(),"switcher-junie-policy-")),oldHome=process.env.HOME,oldJunie=process.env.JUNIE_HOME;process.env.HOME=root;delete process.env.JUNIE_HOME;
 let touched=false;
 const client={getProfile:async()=>({harness:"junie"}),refreshModels:async()=>{touched=true;throw new Error("unexpected discovery");}} as unknown as SwitcherClient;
 try{
  await mkdir(join(root,".junie"));await writeFile(join(root,"target"),"fixture");
  for(const name of ["allowlist.json","AGENTS.md"])for(const kind of ["symlink","directory","oversize"]){
   const path=join(root,".junie",name);
   if(kind==="symlink")await symlink(join(root,"target"),path);else if(kind==="directory")await mkdir(path);else await writeFile(path,"x".repeat(1024*1024+1));
   await expect(launch(client,"fixture",{cwd:root,resolveCredential:async()=>{touched=true;return "fixture";}})).rejects.toThrow("bounded regular");
   expect(touched).toBe(false);await rm(path,{recursive:true,force:true});
  }
 }finally{if(oldHome===undefined)delete process.env.HOME;else process.env.HOME=oldHome;if(oldJunie===undefined)delete process.env.JUNIE_HOME;else process.env.JUNIE_HOME=oldJunie;await rm(root,{recursive:true,force:true});}
});
