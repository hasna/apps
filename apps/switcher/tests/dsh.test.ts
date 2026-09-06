import {test,expect} from "bun:test";
import {mkdtemp,mkdir,readFile,rm,stat} from "node:fs/promises";
import {join} from "node:path";
import {homedir} from "node:os";
import {prepareHarnessLaunch,validateHarnessVersion} from "../src/harnesses";
import {dshArguments} from "../src/dsh-args";
import {validateOriLaunchRequest} from "../src/ori-backend";
import {launch} from "../src/launcher";
import type {HarnessLaunchInput} from "../src/harness-types";

test("DSH accepts only native profiles with a bound route and a loopback web listener",()=>{
  expect(dshArguments([])).toEqual({profile:"web",args:["--host","127.0.0.1","--port","0"]});
  expect(dshArguments(["web","--no-open"]).args).toContain("--no-open");
  expect(dshArguments(["--profile","acp"])).toEqual({profile:"acp",args:[]});
  expect(dshArguments(["--profile=headless","Read the project"])).toEqual({profile:"headless",args:["Read the project"]});
  for(const task of ["web","plugin"])expect(()=>dshArguments(["--profile","headless",task])).toThrow("one task");
  for(const args of [["--profile","sdk"],["--profile","sdk-minimal"],["--profile","outside"],["plugin","add","anything"],["--host","0.0.0.0"],["--trusted-host","outside"],["--patch","outside"],["--profile","acp","--model","outside"],["--profile","headless","task","--resume","id"],["--profile","headless"]])expect(()=>dshArguments(args)).toThrow();
  for(const version of [undefined,"0.1.1-rc.2","0.1.2-alpha.1","0.1.2-rc.0"])expect(()=>validateHarnessVersion("dsh",version)).toThrow("0.1.2-rc.1");
  expect(()=>validateHarnessVersion("dsh","0.1.2-rc.1")).not.toThrow();
  expect(()=>validateOriLaunchRequest({target:"dsh"} as any)).toThrow("setup only");
});

test("DSH composes the full exact catalog, route and persistent storage without a provider key file",async()=>{
  const base=process.env.SWITCHER_TEST_ROOT??join(homedir(),"Workspace/scratch/switcher-native-tests");await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,"dsh-unit-"));
  const input:HarnessLaunchInput={harness:"dsh",baseUrl:"https://provider.example/prefix/v1",protocol:"openai-chat",model:"vendor/model",models:[{id:"vendor/model",name:"Selected",contextWindow:32768,maxOutputTokens:8192,inputModalities:["text","image"]},{id:"other/catalog/model",name:"Other"}],credential:"synthetic-fixture-key",stateDir:join(root,"launch"),sessionDir:join(root,"persistent"),cwd:root,version:"0.1.2-rc.1",args:["--profile","acp"]};
  try {
    const prepared=await prepareHarnessLaunch(input);
    const text=await readFile(prepared.configPaths[0],"utf8");const patch=JSON.parse(text);const row=(id:string)=>patch.find((r:any)=>r.id===id);
    expect(text).not.toContain(input.credential!);expect(prepared.args.join(" ")).not.toContain(input.credential!);
    expect(row("llm-deepseek").disabled).toBe(true);
    const providers=row("llm-pi-ai").config.providers;const id=Object.keys(providers)[0];expect(Object.keys(providers)).toHaveLength(1);
    expect(providers[id]).toMatchObject({api:"openai-completions",baseURL:input.baseUrl,apiKeyEnv:"SWITCHER_HARNESS_API_KEY"});
    expect(providers[id].models.map((m:any)=>m.id)).toEqual(input.models.map(m=>m.id));
    expect(providers[id].models[0].input).toEqual(["text","image"]);
    expect(row("agent-default-model").config).toEqual({provider:id,model:input.model});
    expect(row("acp").config).toEqual(row("agent-default-model").config);
    expect(row("session-persistence-jsonl").config.root).toBe(join(input.sessionDir!,"sessions"));expect(row("attachment-local").config.dshHome).toBe(input.sessionDir);
    expect((await stat(prepared.configPaths[0])).mode&0o777).toBe(0o600);
    expect((await stat(prepared.env.DSH_HOME)).mode&0o777).toBe(0o700);
    await expect(prepareHarnessLaunch({...input,stateDir:join(root,"escape"),args:["--patch=outside"]})).rejects.toThrow("reserved");
  } finally {await rm(root,{recursive:true,force:true});}
});

test("DSH bridges non-native auth without losing a deployment prefix or a stable provider identity",async()=>{
  const base=process.env.SWITCHER_TEST_ROOT??join(homedir(),"Workspace/scratch/switcher-native-tests");await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,"dsh-auth-"));
  const seen:any[]=[];const upstream=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(request){seen.push({path:new URL(request.url).pathname,auth:request.headers.get("authorization"),key:request.headers.get("x-api-key"),body:await request.json()});return Response.json({ok:true});}});
  try {
    for(const [i,protocol,authStyle,credential] of [[0,"anthropic-messages","bearer","synthetic-key"],[1,"openai-chat","x-api-key","synthetic-key"],[2,"openai-responses","bearer",undefined]] as const){
      const path={"anthropic-messages":"/messages","openai-chat":"/chat/completions","openai-responses":"/responses"}[protocol];
      const input:HarnessLaunchInput={harness:"dsh",version:"0.1.2-rc.1",baseUrl:upstream.url.origin+"/deployment/v1",protocol,authStyle,credential,model:"ns/model",models:[{id:"ns/model",name:"Model"}],stateDir:join(root,String(i)),cwd:root};
      const prepared=await prepareHarnessLaunch(input);
      try {
        const patch=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));const providers=patch.find((row:any)=>row.id==="llm-pi-ai").config.providers;const provider=Object.values(providers)[0] as any;
        const response=await fetch(provider.baseURL+(protocol==="anthropic-messages"?"/v1":"")+path,{method:"POST",headers:{"content-type":"application/json",[protocol==="anthropic-messages"?"x-api-key":"authorization"]:protocol==="anthropic-messages"?prepared.env.SWITCHER_HARNESS_API_KEY:"Bearer "+prepared.env.SWITCHER_HARNESS_API_KEY},body:JSON.stringify({model:input.model})});
        expect(response.status).toBe(200);await response.body?.cancel();
        expect(seen.at(-1)).toEqual({path:"/deployment/v1"+path,auth:credential&&authStyle==="bearer"?"Bearer "+credential:null,key:credential&&authStyle==="x-api-key"?credential:null,body:{model:input.model}});
        const again=await prepareHarnessLaunch({...input,stateDir:join(root,String(i)+"again")});
        try {const other=JSON.parse(await readFile(again.configPaths[0],"utf8")).find((row:any)=>row.id==="llm-pi-ai").config.providers;expect(Object.keys(other)).toEqual(Object.keys(providers));}finally{await again.cleanup?.();}
      } finally {await prepared.cleanup?.();}
    }
  } finally {await upstream.stop(true);await rm(root,{recursive:true,force:true});}
});

test("DSH rejects custom profiles before SDK catalog discovery or credential resolution",async()=>{
  for(const args of [["--profile","sdk"],["--host","0.0.0.0"]]) {
    const calls:string[]=[];
    const client={getProfile:async()=>{calls.push("profile");return {harness:"dsh",providerId:"fixture"};},refreshModels:async()=>{calls.push("discovery");throw Error("unexpected discovery");}} as any;
    await expect(launch(client,"fixture",{args,resolveCredential:async()=>{calls.push("credential");return "synthetic-fixture-key";}})).rejects.toThrow("DSH");
    expect(calls).toEqual(["profile"]);
  }
});
