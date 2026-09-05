import { test, expect } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { prepareHarnessLaunch } from "../src/harnesses";
import { childEnvironment } from "../src/launcher";
import type { HarnessLaunchInput } from "../src/harness-types";
async function fixture() {
  const base=process.env.SWITCHER_TEST_ROOT??join(homedir(),"Workspace","scratch","switcher-tests");
  await mkdir(base,{recursive:true}); const stateDir=await mkdtemp(join(base,"harness-"));
  return {stateDir,cwd:stateDir,baseUrl:"https://example.com/prefix/v1",protocol:"openai-responses" as const,model:"vendor/model",models:[{id:"vendor/model",name:"Model",contextWindow:64000,maxOutputTokens:8000,supportedParameters:["tools"],outputModalities:["text"]}],credential:"fixture-never-a-real-key"};
}
test("Claude and Codex configurations preserve model IDs, endpoint prefixes and credentials only in env",async()=>{
  const input=await fixture();
  try{
    const claude=await prepareHarnessLaunch({...input,harness:"claude",protocol:"anthropic-messages",version:"2.1.261",authStyle:"bearer",args:["-p","hello"]});
    expect(claude.env.ANTHROPIC_BASE_URL).toBe("https://example.com/prefix");expect(claude.env.ANTHROPIC_AUTH_TOKEN).toBe(input.credential);
    const settings=JSON.parse(await readFile(claude.configPaths[0],"utf8"));expect(settings.modelPicker.options[0].model).toBe(input.model);
    expect(JSON.stringify(settings)).not.toContain(input.credential);expect(claude.args).toContain("hello");
    const codex=await prepareHarnessLaunch({...input,harness:"codex",version:"codex-cli 0.153.4",args:["exec","hello"]});
    const catalog=JSON.parse(await readFile(codex.configPaths[0],"utf8"));expect(catalog.models[0].slug).toBe(input.model);expect(catalog.models[0].context_window).toBe(64000);
    expect(codex.args.join(" ")).toContain('wire_api = "responses"');expect(codex.args.join(" ")).not.toContain(input.credential);
    expect(JSON.stringify(catalog)).not.toContain(input.credential);
  } finally {await rm(input.stateDir,{recursive:true,force:true});}
});
test("unsupported protocols, old clients and unsafe model catalogs fail before launch",async()=>{
  const input=await fixture();
  try {
    await expect(prepareHarnessLaunch({...input,harness:"codex",protocol:"openai-chat",version:"0.153.4"})).rejects.toThrow("incompatible");
    await expect(prepareHarnessLaunch({...input,harness:"claude",protocol:"anthropic-messages",version:"2.1.100"})).rejects.toThrow("2.1.242");
    await expect(prepareHarnessLaunch({...input,harness:"opencode2",version:"1.2.0"})).rejects.toThrow("legacy");
    await expect(prepareHarnessLaunch({...input,harness:"grok",version:"1.0.13",args:["--resume"]})).rejects.toThrow("resume");
    await expect(prepareHarnessLaunch({...input,harness:"opencode2",version:"opencode2 v0.0.0-beta-18999",credential:undefined,args:["run","--continue"]})).rejects.toThrow("resume");
    await expect(prepareHarnessLaunch({...input,harness:"codex",version:"0.153.4",models:[]})).rejects.toThrow("missing");
  } finally {await rm(input.stateDir,{recursive:true,force:true});}
});
test("OpenCode2 config uses v2 schema and isolated execution without broad permission flags",async()=>{
  const input=await fixture();
  try{
    const prepared=await prepareHarnessLaunch({...input,harness:"opencode2",version:"opencode2 v0.0.0-beta-18999",args:["run","hello"]});
    const config=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));
    const provider:any=Object.values(config.providers)[0];expect(provider.package).toEndWith("/openai/responses");
    expect(provider.models[input.model].capabilities).toEqual({tools:true,input:["text"],output:["text"]});
    expect(provider.models[input.model].modelID).toBe(input.model);expect(provider.models[input.model].limit.context).toBe(64000);
    expect(JSON.stringify(config)).not.toContain(input.credential);expect(prepared.args.slice(0,2)).toEqual(["run","--standalone"]);
    expect(prepared.args).not.toContain("--auto");expect(prepared.env.OPENCODE_CONFIG_CONTENT.length).toBeLessThan(1000);
  } finally {await rm(input.stateDir,{recursive:true,force:true});}
});
test("Grok catalog bridge preserves streaming, changes upstream model, isolates auth and shuts down",async()=>{
  const input=await fixture();const received:any[]=[];
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){received.push({path:new URL(req.url).pathname,key:req.headers.get("x-api-key"),auth:req.headers.get("authorization"),body:await req.json()});return new Response('data: {"type":"message_stop"}\n\n',{headers:{"content-type":"text/event-stream"}});}});
  let prepared:Awaited<ReturnType<typeof prepareHarnessLaunch>>|undefined;
  try {
    prepared=await prepareHarnessLaunch({...input,harness:"grok",baseUrl:upstream.url.origin+"/prefix/v1",protocol:"anthropic-messages",authStyle:"x-api-key",version:"grok 1.0.13",models:[...input.models,{...input.models[0],id:"second/model"}]});
    const url=prepared.env.GROK_MODELS_BASE_URL;
    expect((await fetch(url+"/models")).status).toBe(401);
    const headers={authorization:`Bearer ${prepared.env.XAI_API_KEY}`,"content-type":"application/json"};
    const catalog=await (await fetch(url+"/models",{headers})).json() as any;
    expect(catalog.data.map((m:any)=>m.model)).toEqual(["vendor/model","second/model"]);expect(catalog.data[0].id).toStartWith("switcher-");
    expect(JSON.stringify(catalog)).not.toContain(input.credential);expect(JSON.stringify(catalog)).not.toContain(prepared.env.XAI_API_KEY);
    for(const model of ["vendor/model","second/model"]){
      const response=await fetch(url+"/messages",{method:"POST",headers,body:JSON.stringify({model,stream:true,messages:[]})});
      expect(await response.text()).toBe('data: {"type":"message_stop"}\n\n');
    }
    expect(received.map(r=>r.body.model)).toEqual(["vendor/model","second/model"]);expect(received[0].key).toBe(input.credential);expect(received[0].auth).toBeNull();
    expect(received[0].path).toBe("/prefix/v1/messages");
    expect((await fetch(url+"/messages",{method:"POST",headers,body:JSON.stringify({model:"outside"})})).status).toBe(403);
    await prepared.cleanup?.();prepared=undefined;await expect(fetch(url+"/models",{headers})).rejects.toThrow();
  }finally{await prepared?.cleanup?.();await upstream.stop(true);await rm(input.stateDir,{recursive:true,force:true});}
});
test("child environment excludes operator and unrelated provider credentials",()=>{
  const env=childEnvironment({HOME:"/home/example",PATH:"/usr/bin",HASNA_SWITCHER_API_KEY:"operator",SWITCHER_PROVIDER_A:"provider-a",AWS_SECRET_ACCESS_KEY:"other",ANTHROPIC_AUTH_TOKEN:"old",LC_ALL:"en_US.UTF-8"});
  expect(env).toEqual({HOME:"/home/example",PATH:"/usr/bin",LC_ALL:"en_US.UTF-8"});
});
test("reserved provider flags cannot redirect a profile and no-auth endpoints receive no synthetic credential",async()=>{
  const input=await fixture();let prepared:Awaited<ReturnType<typeof prepareHarnessLaunch>>|undefined;
  const received:Headers[]=[];const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(req){received.push(req.headers);return Response.json({ok:true});}});
  try{
    for(const args of [["--model=outside"],["-c","model_provider=outside"],["--config=model_providers.switcher.base_url=outside"]]) await expect(prepareHarnessLaunch({...input,harness:"codex",version:"0.153.4",args})).rejects.toThrow("profile");
    prepared=await prepareHarnessLaunch({...input,harness:"claude",version:"2.1.261",protocol:"anthropic-messages",baseUrl:upstream.url.origin+"/v1",credential:undefined});
    const res=await fetch(prepared.env.ANTHROPIC_BASE_URL+"/v1/messages",{method:"POST",headers:{authorization:`Bearer ${prepared.env.ANTHROPIC_AUTH_TOKEN}`,"content-type":"application/json","anthropic-beta":"test-beta"},body:JSON.stringify({model:input.model})});
    expect(res.status).toBe(200);expect(received[0].get("authorization")).toBeNull();expect(received[0].get("x-api-key")).toBeNull();expect(received[0].get("anthropic-beta")).toBe("test-beta");
  }finally{await prepared?.cleanup?.();await upstream.stop(true);await rm(input.stateDir,{recursive:true,force:true});}
});
test("OpenCode's fixed native auth convention can bridge a provider's different auth style",async()=>{
  const input=await fixture();let prepared:Awaited<ReturnType<typeof prepareHarnessLaunch>>|undefined;
  let auth:string|null=null,key:string|null=null;
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(req){auth=req.headers.get("authorization");key=req.headers.get("x-api-key");return Response.json({ok:true});}});
  try{
    prepared=await prepareHarnessLaunch({...input,harness:"opencode2",version:"opencode2 v0.0.0-beta-18999",protocol:"anthropic-messages",authStyle:"bearer",baseUrl:upstream.url.origin+"/v1"});
    const config=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));const provider:any=Object.values(config.providers)[0];
    const response=await fetch(provider.settings.baseURL+"/messages",{method:"POST",headers:{"x-api-key":prepared.env.SWITCHER_HARNESS_API_KEY,"content-type":"application/json"},body:JSON.stringify({model:input.model})});
    expect(response.status).toBe(200);expect(auth).toBe(`Bearer ${input.credential}`);expect(key).toBeNull();
  }finally{await prepared?.cleanup?.();await upstream.stop(true);await rm(input.stateDir,{recursive:true,force:true});}
});
