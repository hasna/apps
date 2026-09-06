import {test, expect} from "bun:test";
import {mkdir, mkdtemp, readFile, writeFile, rm, realpath} from "node:fs/promises";
import {join} from "node:path";
import {homedir} from "node:os";
import {pathToFileURL} from "node:url";
import {validateGeminiConfiguration} from "../src/gemini-config";
import {childEnvironment} from "../src/harness-environment";
import {prepareHarnessLaunch} from "../src/harnesses";
import {launch} from "../src/launcher";

async function fixture() {
  const base=process.env.SWITCHER_TEST_ROOT??join(homedir(),"Workspace/scratch/switcher-tests");await mkdir(base,{recursive:true});
  const root=await mkdtemp(join(base,"gemini-hardening-")),home=join(root,"home"),cwd=join(root,"project");
  await mkdir(join(home,".gemini"),{recursive:true,mode:0o700});await mkdir(join(cwd,".gemini"),{recursive:true,mode:0o700});
  return {root,home,cwd};
}
test("Gemini rejects native transport overrides before catalog, credentials or native launch",async()=>{
  const f=await fixture();let refreshed=false,resolved=false;
  const client:any={getProfile:async()=>({id:"p",harness:"gemini",providerId:"provider"}),getProvider:async()=>({protocol:"gemini-generate-content",authStyle:"x-api-key"}),refreshModels:async()=>{refreshed=true;throw new Error("unexpected refresh");}};
  try {
    for(const value of [
      {modelConfigs:{customAliases:{selected:{modelConfig:{model:"outside"}}}}},
      {modelConfigs:{customOverrides:[{match:{model:"selected"},modelConfig:{generateContentConfig:{httpOptions:{baseUrl:"http://127.0.0.1:9"}}}}]}},
      {agents:{overrides:{agent:{modelConfig:{model:"outside"}}}}},
      {security:{auth:{enforcedType:"oauth-personal"}}},
      {context:{fileName:"oauth_creds.json"}},
      {policyPaths:["~/project-policy.toml"]},
    ]) {
      await writeFile(join(f.cwd,".gemini/settings.json"),JSON.stringify(value));
      await expect(launch(client,"p",{cwd:f.cwd,resolveCredential:async()=>{resolved=true;return "synthetic";}})).rejects.toThrow();
    }
    expect(refreshed).toBe(false);expect(resolved).toBe(false);
    await writeFile(join(f.cwd,".gemini/settings.json"),'{"modelConfigs":{},"modelConfigs":{"customAliases":{}}}');
    await expect(validateGeminiConfiguration(f.cwd,{HOME:f.home})).rejects.toThrow("unambiguous");
  } finally {await rm(f.root,{recursive:true,force:true});}
});

test("Gemini launch settings are private while native session directories remain stable",async()=>{
  const f=await fixture(),saved={HOME:process.env.HOME,GEMINI_CLI_HOME:process.env.GEMINI_CLI_HOME,GEMINI_CLI_TRUST_WORKSPACE:process.env.GEMINI_CLI_TRUST_WORKSPACE,GEMINI_CLI_SYSTEM_SETTINGS_PATH:process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH,GEMINI_CLI_SYSTEM_DEFAULTS_PATH:process.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH};
  const prepared:Awaited<ReturnType<typeof prepareHarnessLaunch>>[]=[];
  try {
    process.env.HOME=f.home;delete process.env.GEMINI_CLI_HOME;process.env.GEMINI_CLI_TRUST_WORKSPACE="false";
    process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH=join(f.root,"system.json");process.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH=join(f.root,"defaults.json");
    await writeFile(process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH,JSON.stringify({security:{disableYoloMode:true},tools:{exclude:["run_shell_command"]}}));
    await writeFile(process.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH,JSON.stringify({general:{defaultApprovalMode:"plan"},adminPolicyPaths:["~/admin-policy.toml"]}));
    await writeFile(join(f.home,".gemini/settings.json"),JSON.stringify({security:{folderTrust:{enabled:true}},ui:{theme:"Default"}}));
    await writeFile(join(f.home,".gemini/GEMINI.md"),'Global instruction @./import.md and `@./not-an-import.md`.\n');
    await writeFile(join(f.home,".gemini/import.md"),'Imported instruction.\n');
    await writeFile(join(f.home,".gemini/trustedFolders.json"),JSON.stringify({[f.cwd]:"DO_NOT_TRUST"}));
    await mkdir(join(f.home,".gemini/policies"));await writeFile(join(f.home,".gemini/policies/deny.toml"),'[[rule]]\ntoolName = "run_shell_command"\ndecision = "deny"\npriority = 100\n');
    for(const name of ["first","second"]) prepared.push(await prepareHarnessLaunch({harness:"gemini",version:"0.58.0",model:name,models:[{id:name,name}],protocol:"gemini-generate-content",authStyle:"x-api-key",baseUrl:"http://127.0.0.1:9/v1beta",credential:"synthetic-upstream-fixture",cwd:f.cwd,stateDir:join(f.root,name),sessionDir:join(f.root,"sessions")}));
    expect(prepared[0].env.GEMINI_CLI_HOME).not.toBe(prepared[1].env.GEMINI_CLI_HOME);
    for(const [index,p]of prepared.entries()) {
      expect(p.env.GEMINI_CLI_TRUST_WORKSPACE).toBe("false");expect(p.env.GEMINI_API_KEY).not.toBe("synthetic-upstream-fixture");
      const config=JSON.parse(await readFile(p.configPaths[0],"utf8"));expect(config.model.name).toBe(index?"second":"first");expect(config.security.disableYoloMode).toBe(true);expect(config.tools.exclude).toEqual(["run_shell_command"]);
      expect(await readFile(join(p.env.GEMINI_CLI_HOME,".gemini/policies/deny.toml"),"utf8")).toContain('decision = "deny"');
      expect(await readFile(p.env.GEMINI_CLI_TRUSTED_FOLDERS_PATH,"utf8")).toContain("DO_NOT_TRUST");
      expect(await readFile(p.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH,"utf8")).toContain("plan");
      expect(JSON.parse(await readFile(p.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH,"utf8")).adminPolicyPaths).toEqual([join(f.home,"admin-policy.toml")]);
      const context=await readFile(join(p.env.GEMINI_CLI_HOME,".gemini/GEMINI.md"),"utf8");expect(context).toContain("@./.switcher-context/");expect(context).toContain("`@./not-an-import.md`");
    }
    expect(await realpath(join(prepared[0].env.GEMINI_CLI_HOME,".gemini/tmp"))).toBe(await realpath(join(prepared[1].env.GEMINI_CLI_HOME,".gemini/tmp")));
    expect(await readFile(prepared[0].configPaths[0],"utf8")).toContain('"name": "first"');
  } finally {await Promise.all(prepared.map(p=>p.cleanup?.()));for(const[key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await rm(f.root,{recursive:true,force:true});}
});

test.skipIf(!process.env.SWITCHER_TEST_GEMINI_PACKAGE)("installed Gemini settings loader preserves exact catalogs across concurrent profile preparations",async()=>{
  const f=await fixture(),prepared:Awaited<ReturnType<typeof prepareHarnessLaunch>>[]=[],children:ReturnType<typeof Bun.spawn>[]=[];
  const native=process.env.SWITCHER_TEST_GEMINI_PACKAGE!;
  const worker=join(f.root,"native-settings.mjs");
  const settingsUrl=pathToFileURL(join(native,"bundle/chunk-34DO53P3.js")).href,coreUrl=pathToFileURL(join(native,"bundle/chunk-MFLFXOVQ.js")).href;
  try {
    expect(JSON.parse(await readFile(join(native,"package.json"),"utf8")).version).toBe("0.58.0");
    await writeFile(worker,`import {loadSettings} from ${JSON.stringify(settingsUrl)};import {ModelConfigService,DEFAULT_MODEL_CONFIGS} from ${JSON.stringify(coreUrl)};const settings=loadSettings(process.cwd()).merged;const service=new ModelConfigService(settings.modelConfigs);console.log(JSON.stringify({options:service.getAvailableModelOptions({useGemini3_1:true,useGemini3_5Flash:true,useCustomTools:true,hasAccessToPreview:true}),model:settings.model.name,auth:settings.security.auth.selectedType}));`);
    const catalogs=[["fixture-model","gemini-3.1-pro-preview"],["fixture-second","gemini-2.5-pro"]];
    for(const[index,ids]of catalogs.entries())prepared.push(await prepareHarnessLaunch({harness:"gemini",version:"0.58.0",model:ids[0],models:ids.map(id=>({id,name:id})),protocol:"gemini-generate-content",authStyle:"x-api-key",credential:"synthetic-catalog-fixture",baseUrl:"http://127.0.0.1:9/v1beta",cwd:f.cwd,stateDir:join(f.root,String(index)),sessionDir:join(f.root,"sessions")}));
    // Native settings paths are captured at import time. Each launch must use a
    // fresh actual native loader after both launch configurations exist.
    for(const[index,p]of prepared.entries()) {
      const child=Bun.spawn([Bun.which("node")!,worker],{cwd:f.cwd,env:{...childEnvironment(),...p.env},stdout:"pipe",stderr:"pipe"});children.push(child);
      const timer=setTimeout(()=>child.kill("SIGKILL"),10_000);
      try {
        const[code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
        expect(code,err).toBe(0);const result=JSON.parse(out);
        expect(result.options.map((model:{modelId:string})=>model.modelId).sort()).toEqual([...catalogs[index]].sort());
        expect(result.model).toBe(catalogs[index][0]);expect(result.auth).toBe("gemini-api-key");
      }finally{clearTimeout(timer);}
    }
  }finally{for(const child of children)if(child.exitCode===null)child.kill("SIGKILL");await Promise.all(children.map(child=>child.exited));await Promise.all(prepared.map(p=>p.cleanup?.()));await rm(f.root,{recursive:true,force:true});}
},30_000);

test("Gemini bridge bounds model, routes, query and auth, and cancels unfinished upstream streams",async()=>{
  const f=await fixture(),calls:any[]=[],upstreamKey="synthetic-upstream-only";let cancelled=false;
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(request){calls.push({path:new URL(request.url).pathname,key:request.headers.get("x-goog-api-key"),auth:request.headers.get("authorization"),body:await request.json()});return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: {"done":true}\n\n'));},cancel(){cancelled=true;}}),{headers:{"content-type":"text/event-stream"}});}});
  let p:Awaited<ReturnType<typeof prepareHarnessLaunch>>|undefined;
  try {
    p=await prepareHarnessLaunch({harness:"gemini",version:"0.58.0",model:"fixture",models:[{id:"fixture",name:"Fixture"}],protocol:"gemini-generate-content",authStyle:"x-api-key",baseUrl:upstream.url.origin+"/prefix/v1beta",credential:upstreamKey,cwd:f.cwd,stateDir:join(f.root,"state")});
    const root=p.env.GOOGLE_GEMINI_BASE_URL,headers={"x-goog-api-key":p.env.GEMINI_API_KEY,"content-type":"application/json"},route=root+"/v1beta/models/fixture:streamGenerateContent";
    expect((await fetch(route,{method:"POST",body:"{}"})).status).toBe(401);
    for(const[path,body,status]of [["/v1beta/models/outside:generateContent","{}",403],["/v1beta/models/fixture:delete","{}",404],["/v1beta/models/fixture:generateContent?key=outside","{}",400],["/v1beta/models/fixture:countTokens",'{"generateContentRequest":{"model":"outside"}}',403]] as const)expect((await fetch(root+path,{method:"POST",headers,body})).status).toBe(status);
    const response=await fetch(route+"?alt=sse",{method:"POST",headers:{...headers,authorization:"Bearer ignored-native-header"},body:'{"contents":[]}'});
    const reader=response.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toContain("done");
    expect(calls).toEqual([{path:"/prefix/v1beta/models/fixture:streamGenerateContent",key:upstreamKey,auth:null,body:{contents:[]}}]);
    const began=performance.now();await p.cleanup!();expect(performance.now()-began).toBeLessThan(1500);expect((await reader.read()).done).toBe(true);
    await new Promise(resolve=>setTimeout(resolve,30));expect(cancelled).toBe(true);await expect(fetch(route,{headers})).rejects.toThrow();
  } finally {await p?.cleanup?.();await upstream.stop(true);await rm(f.root,{recursive:true,force:true});}
});
