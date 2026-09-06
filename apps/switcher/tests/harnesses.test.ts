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
    expect(claude.env.ANTHROPIC_DEFAULT_MODEL).toBe(input.model);
    expect(claude.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe(input.model);
    expect(claude.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE).toBeUndefined();
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
    await expect(prepareHarnessLaunch({...input,harness:"codex",version:"0.153.4",models:[]})).rejects.toThrow("missing");
  } finally {await rm(input.stateDir,{recursive:true,force:true});}
});
test("Pi uses the selected provider/model across all supported wire protocols and preserves native resume flags",async()=>{
  const input=await fixture();
  try {
    for (const [protocol,api,authStyle] of [["anthropic-messages","anthropic-messages","x-api-key"],["openai-responses","openai-responses","bearer"],["openai-chat","openai-completions","bearer"]] as const) {
      const prepared=await prepareHarnessLaunch({...input,stateDir:join(input.stateDir,protocol),harness:"pi",protocol,authStyle,version:"0.85.1",args:["--session","/owned/session.jsonl","--continue","-p","prompt"]});
      try {
        const config=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));
        const provider:any=Object.values(config.providers)[0];
        expect(provider.api).toBe(api);expect(provider.baseUrl).toBe(protocol==="anthropic-messages"?input.baseUrl.replace(/\/v1$/i,""):input.baseUrl);expect(provider.models).toHaveLength(input.models.length);
        expect(config.providers[Object.keys(config.providers)[0]].apiKey).toBe("$SWITCHER_HARNESS_API_KEY");
        expect(prepared.args.slice(0,6)).toEqual(["--provider",Object.keys(config.providers)[0],"--model",input.model,"--models",`${Object.keys(config.providers)[0]}/**`]);
        expect(prepared.args.slice(6)).toEqual(["--session","/owned/session.jsonl","--continue","-p","prompt"]);
        expect(JSON.stringify(config)).not.toContain(input.credential);expect(prepared.env.PI_CODING_AGENT_DIR).toEndWith("/pi-agent");
      } finally { await prepared.cleanup?.(); }
    }
    await expect(prepareHarnessLaunch({...input,harness:"pi",protocol:"openai-chat",version:"0.85.1",args:["--model","outside"]})).rejects.toThrow("reserved");
    await expect(prepareHarnessLaunch({...input,harness:"pi",protocol:"openai-chat",version:"0.85.1",args:["--models","google/*"]})).rejects.toThrow("reserved");
    await expect(prepareHarnessLaunch({...input,harness:"pi",protocol:"openai-chat",version:"0.85.1",models:[...input.models,{...input.models[0],id:"VENDOR/MODEL"}]})).rejects.toThrow("letter case");
    await expect(prepareHarnessLaunch({...input,harness:"pi",protocol:"openai-chat",version:"0.85.1",models:[...input.models,{...input.models[0],id:"other"},{...input.models[0],id:"OTHER"}]})).rejects.toThrow("letter case");
    await expect(prepareHarnessLaunch({...input,harness:"pi",protocol:"openai-chat",version:"0.85.0"})).rejects.toThrow("0.85.1");
  } finally { await rm(input.stateDir,{recursive:true,force:true}); }
});
test("OMP writes an isolated provider-qualified catalog for all native APIs without persisting credentials",async()=>{
  const input=await fixture();
  const models=[...input.models,{...input.models[0],id:"vendor/team/model",name:"Nested"}];
  try {
    for(const [protocol,api,authStyle] of [["anthropic-messages","anthropic-messages","x-api-key"],["openai-responses","openai-responses","bearer"],["openai-chat","openai-completions","bearer"]] as const) {
      const prepared=await prepareHarnessLaunch({...input,stateDir:join(input.stateDir,protocol),harness:"omp",protocol,authStyle,version:"omp/18.1.11",models,args:["-p","prompt"]});
      try {
        const config=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));
        const settings=JSON.parse(await readFile(prepared.configPaths[1],"utf8"));
        const provider:any=config.providers.switcher;
        expect(provider.api).toBe(api);
        if(protocol==="anthropic-messages") expect(provider.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
        else expect(provider.baseUrl).toBe(input.baseUrl);
        expect(provider.models.map((m:any)=>m.id)).toEqual(models.map(m=>m.id));
        expect(settings.enabledModels).toEqual(["switcher/**"]);expect(settings.modelRoles).toEqual({default:`switcher/${input.model}`,smol:`switcher/${input.model}`,slow:`switcher/${input.model}`,plan:`switcher/${input.model}`});
        expect(prepared.args.slice(0,6)).toEqual(["--model",`switcher/${input.model}`,"--models","switcher/**","--session-dir",join(input.stateDir,protocol,"sessions")]);
        expect(provider.apiKey ?? provider.headers?.["x-api-key"]).toBe("SWITCHER_HARNESS_API_KEY");
        expect(provider.authHeader).toBe(true);
        expect(JSON.stringify(config)).not.toContain(input.credential);expect(JSON.stringify(settings)).not.toContain(input.credential);
      } finally { await prepared.cleanup?.(); }
    }
    await expect(prepareHarnessLaunch({...input,harness:"omp",version:"omp/18.1.11",args:["--model","outside"]})).rejects.toThrow("reserved");
    await expect(prepareHarnessLaunch({...input,harness:"omp",version:"omp/18.1.11",args:["--config","outside"]})).rejects.toThrow("reserved");
    await expect(prepareHarnessLaunch({...input,harness:"omp",version:"omp/18.1.11",args:["--no-rules"]})).rejects.toThrow("reserved");
    for (const args of [
      ["--auto-approve"], ["--yolo"], ["--approval-mode", "yolo"], ["--approval-mode=yolo"], ["--plan-yolo"],
      ["--alias", "switcher-profile"], ["--plugin-dir", "/outside/plugin"], ["--hook", "/outside/hook.ts"],
      ["--extension", "/outside/extension.ts"], ["-e", "/outside/extension.ts"], ["--trusted-extension", "/outside/extension.ts"],
      ["--from-claude"], ["--from-codex"],
    ]) {
      await expect(prepareHarnessLaunch({...input,harness:"omp",version:"omp/18.1.11",args})).rejects.toThrow("reserved");
    }
    for (const args of [["--tools", "read"], ["--no-tools"], ["--add-dir", input.cwd]]) {
      const prepared=await prepareHarnessLaunch({...input,harness:"omp",version:"omp/18.1.11",args});
      try {
        expect(prepared.args.slice(-args.length)).toEqual(args);
      } finally { await prepared.cleanup?.(); }
    }
    await expect(prepareHarnessLaunch({...input,harness:"omp",version:"omp/18.1.11",models:[...models,{...models[0],id:"VENDOR/MODEL"}] })).rejects.toThrow("letter case");
    await expect(prepareHarnessLaunch({...input,harness:"omp",version:"omp/18.1.10"})).rejects.toThrow("18.1.11");
  } finally { await rm(input.stateDir,{recursive:true,force:true}); }
});
test("Pi bridges protocol/auth mismatches without leaking bridge credentials upstream",async()=>{
  const input=await fixture();
  const upstreamRequests:any[]=[];
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(request){upstreamRequests.push({path:new URL(request.url).pathname,authorization:request.headers.get("authorization"),key:request.headers.get("x-api-key")});return Response.json({ok:true});}});
  const cases=[
    {protocol:"anthropic-messages" as const,authStyle:"bearer" as const,path:"/v1/messages",upstreamPath:"/v1/messages",native:"x-api-key" as const},
    {protocol:"openai-responses" as const,authStyle:"x-api-key" as const,path:"/responses",upstreamPath:"/v1/responses",native:"authorization" as const},
    {protocol:"openai-chat" as const,authStyle:"x-api-key" as const,path:"/chat/completions",upstreamPath:"/v1/chat/completions",native:"authorization" as const},
  ];
  try {
    for(const [i,entry] of cases.entries()) {
      const prepared=await prepareHarnessLaunch({...input,stateDir:join(input.stateDir,String(i)),harness:"pi",baseUrl:upstream.url.origin+"/v1",protocol:entry.protocol,authStyle:entry.authStyle,version:"0.85.1"});
      try {
        const config=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));
        const base=(Object.values(config.providers)[0] as any).baseUrl;
        const headers:Record<string,string>={"content-type":"application/json"};headers[entry.native]=entry.native==="authorization"?`Bearer ${prepared.env.SWITCHER_HARNESS_API_KEY}`:prepared.env.SWITCHER_HARNESS_API_KEY;
        expect((await fetch(base+entry.path,{method:"POST",headers,body:JSON.stringify({model:input.model})})).status).toBe(200);
        expect((await fetch(base+entry.path,{method:"POST",headers:{...headers,[entry.native]:entry.native==="authorization"?"Bearer wrong-key":"wrong-key"},body:JSON.stringify({model:input.model})})).status).toBe(401);
      } finally { await prepared.cleanup?.(); }
    }
    expect(upstreamRequests.map(request=>request.path)).toEqual(cases.map(entry=>entry.upstreamPath));
    expect(upstreamRequests[0].authorization).toBe(`Bearer ${input.credential}`);expect(upstreamRequests[0].key).toBeNull();
    expect(upstreamRequests[1].authorization).toBeNull();expect(upstreamRequests[1].key).toBe(input.credential);
    expect(upstreamRequests[2].authorization).toBeNull();expect(upstreamRequests[2].key).toBe(input.credential);
  } finally { await upstream.stop(true);await rm(input.stateDir,{recursive:true,force:true}); }
});
test("OMP protocol bridge keeps its transformed endpoint and upstream authentication", async () => {
  const input = await fixture();
  const upstreamRequests: Array<{ authorization: string | null; key: string | null }> = [];
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    upstreamRequests.push({ authorization: request.headers.get("authorization"), key: request.headers.get("x-api-key") });
    return Response.json({ ok: true });
  }});
  const stateDir = join(input.stateDir, "omp-bridge");
  try {
    const prepared = await prepareHarnessLaunch({ ...input, baseUrl: `${upstream.url.origin}/v1`, credential: undefined, stateDir, harness: "omp", protocol: "openai-chat", authStyle: "x-api-key", version: "omp/18.1.11" });
    const config = JSON.parse(await readFile(prepared.configPaths[0], "utf8"));
    const provider = config.providers.switcher;
    expect(provider.baseUrl).not.toBe(input.baseUrl);
    expect(provider.baseUrl).toContain("127.0.0.1");
    expect(provider.baseUrl).toContain("/v1");
    expect(prepared.env.SWITCHER_HARNESS_API_KEY).not.toBe(input.credential);
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${prepared.env.SWITCHER_HARNESS_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: input.model, messages: [{ role: "user", content: "fixture" }] }),
    });
    expect(response.status).toBe(200);
    expect(upstreamRequests).toEqual([{ authorization: null, key: null }]);
    await prepared.cleanup?.();
  } finally {
    await upstream.stop(true);
    await rm(input.stateDir, { recursive: true, force: true });
  }
});
test("Grok resumes with a fresh bridge and the selected profile model; unsafe interactive queued prompts fail",async()=>{
  const input=await fixture();
  const safe=[
    ["--resume"], ["--resume","session"], ["--resume=session"], ["--load","session"],
    ["--load=session"], ["--continue"], ["-c"], ["-rsession"], ["-crsession"],
    ["--resume","session","-p","prompt"], ["--continue","--single=prompt"],
    ["--continue","--print","prompt"], ["--continue","--prompt-file","prompt.txt"],
    ["--continue","--prompt-json","[]"], ["--continue","-pprompt"],
    ["--resume","session","--reasoning-effort","high","--rules","A rule"],
    ["--resume","session","--no-alt-screen"],
    ["--rules","--resume","ordinary new prompt"],
  ];
  let stableModel:string|undefined;
  try {
    for(const [i,args] of safe.entries()) {
      const prepared=await prepareHarnessLaunch({...input,stateDir:join(input.stateDir,String(i)),harness:"grok",version:"1.0.13",args});
      try { stableModel??=prepared.args[1]; expect(prepared.args[1]).toBe(stableModel); expect(prepared.args[2]).toBe("--no-leader"); expect(prepared.args.slice(3)).toEqual(args); expect(JSON.parse(await readFile(prepared.configPaths[0],"utf8")).models.session_summary).toBe(stableModel); }
      finally { await prepared.cleanup?.(); }
    }
    for(const args of [
      ["--resume","session","prompt"], ["--resume=session","prompt"], ["--load=session","prompt"],
      ["--load","session","prompt"], ["--continue","prompt"], ["-c","prompt"],
      ["-rsession","prompt"], ["-crsession","prompt"], ["--continue","--","-p"],
      ["--continue","--rules","-p","prompt"], ["--continue","--system-prompt=--print","prompt"],
    ]) await expect(prepareHarnessLaunch({...input,harness:"grok",version:"1.0.13",args})).rejects.toThrow("inline prompt");
    for(const args of [["--leader"],["--leader-socket","/some/socket"],["--leader-socket=/some/socket"]])
      await expect(prepareHarnessLaunch({...input,harness:"grok",version:"1.0.13",args})).rejects.toThrow("reserved");
  } finally { await rm(input.stateDir,{recursive:true,force:true}); }
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
test("OpenCode provider identity stays stable when its per-launch auth bridge changes",async()=>{
  const first = await fixture(); const second = await fixture();
  const prepared: Awaited<ReturnType<typeof prepareHarnessLaunch>>[] = [];
  try {
    for (const input of [first,second]) prepared.push(await prepareHarnessLaunch({...input,harness:"opencode2",version:"opencode2 v0.0.0-beta-19157",protocol:"anthropic-messages",authStyle:"bearer",args:["run","--session","fixture-session"]}));
    const configs = await Promise.all(prepared.map(async p=>JSON.parse(await readFile(p.configPaths[0],"utf8"))));
    expect(Object.keys(configs[0].providers)).toEqual(Object.keys(configs[1].providers));
    expect(configs[0].model).toBe(configs[1].model);
    const providers = configs.map(c=>Object.values(c.providers)[0] as any);
    expect(providers[0].settings.baseURL).not.toBe(providers[1].settings.baseURL);
    expect(prepared[0].env.SWITCHER_HARNESS_API_KEY).not.toBe(prepared[1].env.SWITCHER_HARNESS_API_KEY);
    expect(prepared[1].args).toContain("fixture-session");
  } finally {
    await Promise.all(prepared.map(p=>p.cleanup?.()));
    await rm(first.stateDir,{recursive:true,force:true}); await rm(second.stateDir,{recursive:true,force:true});
  }
});


test.skipIf(!process.env.SWITCHER_TEST_PI_PACKAGE)("installed Pi picker scope retains nested model IDs and excludes another provider",async()=>{
  const {pathToFileURL}=await import("node:url");
  const native=await import(pathToFileURL(join(process.env.SWITCHER_TEST_PI_PACKAGE!,"dist/core/model-resolver.js")).href);
  const input=await fixture();
  try {
    const models=[...input.models,{...input.models[0],id:"bare-model"},{...input.models[0],id:"vendor/team/model"}];
    const prepared=await prepareHarnessLaunch({...input,models,harness:"pi",protocol:"openai-chat",authStyle:"bearer",version:"0.85.1"});
    const provider=prepared.args[1],scope=prepared.args[prepared.args.indexOf("--models")+1];
    const available=[...models.map(model=>({...model,provider})),{id:"vendor/model",name:"Another account",provider:"outside-provider"}];
    const resolved=native.resolveModelScopeFromModels([scope],available);
    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.scopedModels.map((row:any)=>row.model.id)).toEqual(models.map(model=>model.id));
    expect(resolved.scopedModels.every((row:any)=>row.model.provider===provider)).toBe(true);
  } finally {await rm(input.stateDir,{recursive:true,force:true});}
});

test("auth bridges cancel unfinished upstream SSE before shutting down",async()=>{
  const input=await fixture();let source:ReadableStreamDefaultController<Uint8Array>|undefined;
  let upstreamSignal:AbortSignal|undefined;
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){
    upstreamSignal=request.signal;
    return new Response(new ReadableStream<Uint8Array>({start(controller){source=controller;controller.enqueue(new TextEncoder().encode('data: {"type":"message_stop"}\n\n'));}}),{headers:{"content-type":"text/event-stream"}});
  }});
  let prepared:Awaited<ReturnType<typeof prepareHarnessLaunch>>|undefined;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  let closing:Promise<void>|undefined;
  try {
    prepared=await prepareHarnessLaunch({...input,harness:"opencode2",protocol:"anthropic-messages",authStyle:"bearer",baseUrl:upstream.url.origin+"/v1",version:"opencode2 beta"});
    const config=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));const provider:any=Object.values(config.providers)[0];
    const response=await fetch(provider.settings.baseURL+"/messages",{method:"POST",headers:{"x-api-key":prepared.env.SWITCHER_HARNESS_API_KEY,"content-type":"application/json"},body:JSON.stringify({model:input.model,messages:[],stream:true})});
    reader=response.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toContain("message_stop");
    // The native harness can stop consuming once it sees the terminal event,
    // leaving the provider's streaming response open when the process exits.
    let stopped=false;closing=Promise.all([prepared.cleanup!(),prepared.cleanup!()]).then(()=>{stopped=true;});
    await Promise.race([closing,Bun.sleep(500)]);
    expect(stopped).toBe(true);
    await expect(fetch(provider.settings.baseURL+"/models")).rejects.toThrow();
    expect(upstreamSignal?.aborted).toBe(true);
  } finally {
    try{source?.close();}catch{}
    await reader?.cancel().catch(()=>{});
    await closing?.catch(()=>{});
    if(!closing)await prepared?.cleanup?.();
    await upstream.stop(true);await rm(input.stateDir,{recursive:true,force:true});
  }
},5000);
