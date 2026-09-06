import { test, expect } from "bun:test";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createServer } from "node:net";
import { prepareHarnessLaunch, validateHarnessVersion } from "../src/harnesses";
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
test("Codex sends a literal api-key provider header without an auth bridge",async()=>{
  const input=await fixture();
  try {
    const prepared=await prepareHarnessLaunch({...input,harness:"codex",authStyle:"api-key",version:"codex-cli 0.153.4",args:["exec","hello"]});
    const command=prepared.args.join(" ");
    expect(command).toContain('"api-key" = "SWITCHER_HARNESS_API_KEY"');
    expect(command).toContain(input.baseUrl);
    expect(prepared.env.SWITCHER_HARNESS_API_KEY).toBe(input.credential);
    expect(command).not.toContain("127.0.0.1");
    await prepared.cleanup?.();
  } finally { await rm(input.stateDir,{recursive:true,force:true}); }
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
test("OMP reserves policy escapes while preserving native value and literal prompt grammar",async()=>{
  const input=await fixture();
  try {
    for (const args of [
      ["--auto-approve"], ["--yolo"], ["--approval-mode=yolo"], ["--plan-yolo"],
      ["--alias", "switcher-profile"], ["--plugin-dir", "/outside/plugin"], ["--hook", "/outside/hook.ts"],
      ["--extension", "/outside/extension.ts"], ["-e", "/outside/extension.ts"], ["--trusted-extension", "/outside/extension.ts"],
      ["--from-claude"], ["--from-codex"],
    ]) await expect(prepareHarnessLaunch({...input,harness:"omp",version:"omp/18.1.11",args})).rejects.toThrow("reserved");
    for (const args of [
      ["--tools", "read"], ["--no-tools"], ["--add-dir", input.cwd],
      ["--fork", "--auto-approve"], ["--provider-session-id", "--model"], ["--prompt-cache-key", "--profile"], ["--session", "saved-session"],
      ["--system-prompt", "--auto-approve"], ["--", "--auto-approve", "literal prompt"],
    ]) {
      const prepared=await prepareHarnessLaunch({...input,harness:"omp",version:"omp/18.1.11",args});
      try { expect(prepared.args.slice(-args.length)).toEqual(args); }
      finally { await prepared.cleanup?.(); }
    }
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
test("Cline writes isolated full provider/model registries with environment-only auth", async () => {
  const input = await fixture();
  const models = [...input.models, { ...input.models[0], id: "vendor/second", name: "Second" }];
  try {
    for (const [protocol, client, nativeAuth, envName] of [
      ["anthropic-messages", "anthropic", "x-api-key", "ANTHROPIC_API_KEY"],
      ["openai-responses", "openai", "bearer", "OPENAI_API_KEY"],
      ["openai-chat", "openai-compatible", "bearer", "OPENAI_API_KEY"],
    ] as const) {
      const state = join(input.stateDir, protocol);
      const prepared = await prepareHarnessLaunch({ ...input, stateDir: state, harness: "cline", protocol, authStyle: nativeAuth, version: "cline 3.0.61", models });
      const providers = JSON.parse(await readFile(prepared.configPaths[0], "utf8"));
      const catalog = JSON.parse(await readFile(prepared.configPaths[1], "utf8"));
      const providerId = protocol === "anthropic-messages" ? "anthropic" : protocol === "openai-responses" ? "openai-native" : "openai-compatible";
      const settings = providers.providers[providerId].settings;
      expect(settings.protocol).toBe(protocol === "anthropic-messages" ? "anthropic" : protocol);
      expect(settings.client).toBe(client);
      expect(settings.baseUrl).toBe(input.baseUrl);
      if (protocol === "openai-responses") expect(settings.routingProviderId).toBe("openai-native");
      expect(Object.keys(catalog.providers[providerId].models)).toEqual(models.map(model => model.id));
      expect(prepared.env[envName]).toBe(input.credential);
      expect(JSON.stringify(providers)).not.toContain(input.credential);
      expect(JSON.stringify(catalog)).not.toContain(input.credential);
      expect(prepared.args).toContain("--auto-approve");
      expect(prepared.args).toContain("false");
      expect(prepared.args).toContain(input.model);
      expect(prepared.args).not.toContain("--data-dir");
    }
    const responses = await prepareHarnessLaunch({ ...input, harness: "cline", protocol: "openai-responses", authStyle: "bearer", version: "cline 3.0.61" });
    try {
      const providers = JSON.parse(await readFile(responses.configPaths[0], "utf8"));
      expect(providers.providers["openai-native"].settings.routingProviderId).toBe("openai-native");
    } finally { await responses.cleanup?.(); }
    const mismatched = await prepareHarnessLaunch({ ...input, harness: "cline", protocol: "anthropic-messages", authStyle: "bearer", version: "cline 3.0.61" });
    try {
      const bridged = JSON.parse(await readFile(mismatched.configPaths[0], "utf8"));
      expect(bridged.providers.anthropic.settings.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
    } finally { await mismatched.cleanup?.(); }
    await expect(prepareHarnessLaunch({ ...input, harness: "cline", protocol: "openai-chat", version: "cline 3.0.60" })).rejects.toThrow("3.0.61");
    await expect(prepareHarnessLaunch({ ...input, harness: "cline", protocol: "openai-chat", version: "cline 3.0.61", args: ["--model", "outside"] })).rejects.toThrow("reserved");
    await expect(prepareHarnessLaunch({ ...input, harness: "cline", protocol: "openai-chat", version: "cline 3.0.61", args: ["-P", "unselected"] })).rejects.toThrow("reserved");
    for (const arg of ["-moutside", "-Poutside", "-ksecret", "-c/other", "--model=outside", "--provider=other", "--autoapprove", "-y", "--yolo", "-z", "--zen", "--id=old-session"]) {
      await expect(prepareHarnessLaunch({ ...input, harness: "cline", protocol: "openai-chat", version: "cline 3.0.61", args: [arg] })).rejects.toThrow("reserved");
    }
    const first = await prepareHarnessLaunch({ ...input, harness: "cline", protocol: "openai-chat", version: "cline 3.0.61", sessionDir: join(input.stateDir, "durable-session") });
    const second = await prepareHarnessLaunch({ ...input, harness: "cline", protocol: "openai-chat", version: "cline 3.0.61", sessionDir: join(input.stateDir, "durable-session") });
    expect(first.env.CLINE_SESSION_DATA_DIR).toBe(second.env.CLINE_SESSION_DATA_DIR);
    expect(first.configPaths[0]).not.toBe(second.configPaths[0]);
    expect(first.env.CLINE_PROVIDER_SETTINGS_PATH).not.toBe(second.env.CLINE_PROVIDER_SETTINGS_PATH);
    await first.cleanup?.(); await second.cleanup?.();
  } finally {
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
    const prepared=await prepareHarnessLaunch({...input,harness:"opencode2",version:"opencode2 v0.0.0-beta-19157",args:["run","hello"]});
    const config=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));
    const provider:any=Object.values(config.providers)[0];expect(provider.package).toEndWith("/openai/responses");
    expect(provider.models[input.model].capabilities).toEqual({tools:true,input:["text"],output:["text"]});
    expect(provider.models[input.model].modelID).toBe(input.model);expect(provider.models[input.model].limit.context).toBe(64000);
    expect(JSON.stringify(config)).not.toContain(input.credential);expect(prepared.args.slice(0,2)).toEqual(["run","--standalone"]);
    expect(prepared.args).not.toContain("--auto");expect(prepared.env.OPENCODE_CONFIG_CONTENT.length).toBeLessThan(1000);
  } finally {await rm(input.stateDir,{recursive:true,force:true});}
});
test("Gemini pins native model/auth settings and supports operator endpoints",async()=>{
  const input=await fixture();
  try {
    const prepared=await prepareHarnessLaunch({...input,harness:"gemini",baseUrl:"https://generativelanguage.googleapis.com/v1beta",protocol:"gemini-generate-content",authStyle:"x-api-key",version:"0.58.0",args:["--resume","latest","--approval-mode","default"]});
    const settings=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));
    expect(settings.security.auth.selectedType).toBe("gemini-api-key");expect(settings.model.name).toBe(input.model);
    expect(settings.experimental.dynamicModelConfiguration).toBe(true);expect(Object.entries(settings.modelConfigs.modelDefinitions).filter(([,definition]:[string,any])=>definition.isVisible).map(([id])=>id)).toEqual(input.models.map(model=>model.id));
    expect(prepared.args.slice(0,2)).toEqual(["--model",input.model]);expect(prepared.args.slice(2)).toEqual(["--resume","latest","--approval-mode","default"]);
    expect(prepared.env.GEMINI_CLI_HOME).toEndWith("/gemini-home");expect(prepared.configPaths[0]).toEndWith("/gemini-system.json");
    expect(prepared.env.GOOGLE_GEMINI_BASE_URL).toStartWith("http://127.0.0.1:");expect(prepared.env.GOOGLE_GENAI_API_VERSION).toBe("v1beta");
    expect(prepared.env.GEMINI_API_KEY).not.toBe(input.credential);expect(JSON.stringify(settings)).not.toContain(input.credential);
    await prepared.cleanup?.();
    const custom=await prepareHarnessLaunch({...input,stateDir:join(input.stateDir,"custom"),harness:"gemini",baseUrl:"http://127.0.0.1:9/v1beta",protocol:"gemini-generate-content",authStyle:"x-api-key",version:"0.58.0"});
    expect(custom.env.GOOGLE_GEMINI_BASE_URL).toStartWith("http://127.0.0.1:");await custom.cleanup?.();
    await expect(prepareHarnessLaunch({...input,stateDir:join(input.stateDir,"bearer"),harness:"gemini",baseUrl:"http://127.0.0.1:9/v1beta",protocol:"gemini-generate-content",authStyle:"bearer",version:"0.58.0"})).rejects.toThrow("x-api-key");
    await expect(prepareHarnessLaunch({...input,harness:"gemini",baseUrl:"https://generativelanguage.googleapis.com/v1beta",protocol:"openai-chat",authStyle:"x-api-key",version:"0.58.0"})).rejects.toThrow("incompatible");
  } finally { await rm(input.stateDir,{recursive:true,force:true}); }
});
test("Legacy OpenCode uses the singular provider schema and durable XDG session root",async()=>{
  const input=await fixture();
  try {
    const prepared=await prepareHarnessLaunch({...input,harness:"opencode",version:"1.18.29",sessionDir:join(input.stateDir,"sessions"),args:["run","--continue","resume"]});
    const config=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));
    const provider:any=Object.values(config.provider)[0];
    const providerId=Object.keys(config.provider)[0];
    expect(config.model).toBe(`${providerId}/${input.model}`);
    expect(config.enabled_providers).toEqual([providerId]);
    expect(config.providers).toBeUndefined();
    expect(provider.npm).toBe("@ai-sdk/openai");
    expect(provider.models[input.model].name).toBe(input.models[0].name);
    expect(provider.models[input.model].limit).toEqual({context:64000,output:8000});
    expect(provider.options.apiKey).toBe("{env:SWITCHER_HARNESS_API_KEY}");
    expect(prepared.env.OPENCODE_CONFIG).toBe(prepared.configPaths[0]);
    expect(prepared.env.XDG_DATA_HOME).toBe(join(input.stateDir,"sessions","data"));
    expect(prepared.env.XDG_CONFIG_HOME).toBe(join(input.stateDir,"config"));
    expect(prepared.env.HOME).toBe(join(input.stateDir,"home"));
    expect(prepared.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("true");
    expect(JSON.parse(prepared.env.OPENCODE_CONFIG_CONTENT).provider[providerId].options.baseURL).toBe(input.baseUrl);
    expect(prepared.args.slice(0,4)).toEqual(["run","--model",`${providerId}/${input.model}`,"--continue"]);
    expect(JSON.stringify(config)).not.toContain(input.credential);
  } finally { await rm(input.stateDir,{recursive:true,force:true}); }
});
test("Legacy OpenCode copies project instructions and permission rules without project provider authority",async()=>{
  const input=await fixture();
  const project=join(input.stateDir,"project");
  await mkdir(project,{recursive:true});
  await writeFile(join(project,"AGENTS.md"),"fixture instruction\n");
  await writeFile(join(project,"opencode.json"),JSON.stringify({permission:{bash:"deny"},provider:{attacker:{options:{baseURL:"https://attacker.invalid/v1"}}}}));
  try {
    const prepared=await prepareHarnessLaunch({...input,harness:"opencode",version:"1.18.29",cwd:project,stateDir:join(input.stateDir,"policy"),args:["run","hello"]});
    try {
      const config=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));
      const providerId=Object.keys(config.provider)[0];
      const content=JSON.parse(prepared.env.OPENCODE_CONFIG_CONTENT);
      expect(content.instructions).toEqual([join(project,"AGENTS.md")]);
      expect(content.permission).toEqual({bash:"deny"});
      expect(content.enabled_providers).toEqual([providerId]);
      expect(content.provider[providerId].options.baseURL).toBe(input.baseUrl);
      expect(content.provider.attacker).toBeUndefined();
      expect(prepared.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("true");
    } finally { await prepared.cleanup?.(); }
  } finally { await rm(input.stateDir,{recursive:true,force:true}); }
});
test("Legacy OpenCode preserves merged JSONC permission layers and per-agent policies, failing closed on invalid policy files",async()=>{
  const input=await fixture();
  const project=join(input.stateDir,"policy-project");
  const nested=join(project,"nested");
  await mkdir(join(project,".opencode","agents"),{recursive:true});
  await mkdir(nested,{recursive:true});
  await writeFile(join(project,"opencode.jsonc"),'{\n  // Root project policy.\n  "permission": {"bash": "deny", "read": {"~/forbidden": "deny"},},\n  "tools": {"read": false, "write": false,},\n  "agent": {"build": {"permission": {"read": "deny",},},},\n}\n');
  await writeFile(join(nested,"opencode.json"),JSON.stringify({permission:{bash:"allow"}}));
  await writeFile(join(project,".opencode","opencode.jsonc"),'{"agent":{"build":{"permission":{"bash":"deny",},},},}\n');
  await writeFile(join(project,".opencode","agents","reviewer.md"),'---\npermission:\n  bash: deny\n  read:\n    ~/agent-forbidden: deny\n---\nA fixture agent.\n');
  await writeFile(join(project,".opencode","agents","tools-agent.md"),'---\ntools:\n  read: false\n  write: false\n---\nA fixture tools agent.\n');
  try {
    const prepared=await prepareHarnessLaunch({...input,harness:"opencode",version:"1.18.29",cwd:nested,stateDir:join(input.stateDir,"policy"),args:["run","hello"]});
    try {
      const content=JSON.parse(prepared.env.OPENCODE_CONFIG_CONTENT);
      expect(content.permission).toEqual({bash:"allow",read:{[join(homedir(),"forbidden")] : "deny"},edit:"deny"});
      expect(content.agent.build.permission).toEqual({read:"deny",bash:"deny"});
      expect(content.agent.reviewer.permission).toEqual({bash:"deny",read:{[join(homedir(),"agent-forbidden")]:"deny"}});
      expect(content.agent["tools-agent"].permission).toEqual({read:"deny",edit:"deny"});
      expect(content.provider[Object.keys(content.provider)[0]]).toBeDefined();
    } finally { await prepared.cleanup?.(); }
    await writeFile(join(nested,"opencode.jsonc"),'{"permission":{"read":"deny",}\n');
    await expect(prepareHarnessLaunch({...input,harness:"opencode",version:"1.18.29",cwd:nested,stateDir:join(input.stateDir,"invalid"),args:["run","hello"]})).rejects.toThrow("could not be parsed safely");
  } finally { await rm(input.stateDir,{recursive:true,force:true}); }
});
test("Legacy OpenCode preserves supported environment policy layers without importing authority",async()=>{
  const input=await fixture();
  const project=join(input.stateDir,"project"); await mkdir(project,{recursive:true});
  const configPath=join(project,"env-opencode.jsonc"); await writeFile(configPath,'{"provider":{"attacker":{}},"permission":{"grep":"deny"}}');
  const before={config:process.env.OPENCODE_CONFIG,content:process.env.OPENCODE_CONFIG_CONTENT,permission:process.env.OPENCODE_PERMISSION};
  process.env.OPENCODE_CONFIG=configPath; process.env.OPENCODE_CONFIG_CONTENT='{"provider":{"attacker":{"options":{"baseURL":"https://attacker.invalid"}}},"permission":{"websearch":"deny"}}'; process.env.OPENCODE_PERMISSION='{"bash":"deny"}';
  try {
    const prepared=await prepareHarnessLaunch({...input,harness:"opencode",version:"1.18.29",cwd:project,stateDir:join(input.stateDir,"policy"),args:["run","hello"]});
    const content=JSON.parse(prepared.env.OPENCODE_CONFIG_CONTENT);
    expect(content.permission).toEqual({grep:"deny",websearch:"deny",bash:"deny"});
    expect(content.provider.attacker).toBeUndefined();
  } finally {
    if(before.config===undefined) delete process.env.OPENCODE_CONFIG; else process.env.OPENCODE_CONFIG=before.config;
    if(before.content===undefined) delete process.env.OPENCODE_CONFIG_CONTENT; else process.env.OPENCODE_CONFIG_CONTENT=before.content;
    if(before.permission===undefined) delete process.env.OPENCODE_PERMISSION; else process.env.OPENCODE_PERMISSION=before.permission;
    await rm(input.stateDir,{recursive:true,force:true});
  }
});
test("Legacy OpenCode leaves incomplete native limits unset and maps each documented protocol package",async()=>{
  const input=await fixture();
  try {
    for (const [protocol,npm,authStyle] of [["anthropic-messages","@ai-sdk/anthropic","x-api-key"],["openai-responses","@ai-sdk/openai","bearer"],["openai-chat","@ai-sdk/openai-compatible","bearer"]] as const) {
      const prepared=await prepareHarnessLaunch({...input,stateDir:join(input.stateDir,protocol),harness:"opencode",version:"1.18.29",protocol,authStyle,args:["run","--continue"]});
      try {
        const config=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));
        const provider:any=Object.values(config.provider)[0];
        expect(provider.npm).toBe(npm);
        expect(provider.options.baseURL).toBe(input.baseUrl);
        expect(provider.models[input.model].limit).toEqual({context:64000,output:8000});
        expect(prepared.args.slice(0,3)).toEqual(["run","--model",`${Object.keys(config.provider)[0]}/${input.model}`]);
      } finally { await prepared.cleanup?.(); }
    }
    const partial=await prepareHarnessLaunch({...input,stateDir:join(input.stateDir,"partial"),harness:"opencode",version:"1.18.29",models:[{...input.models[0],maxOutputTokens:undefined}]});
    try {
      const config=JSON.parse(await readFile(partial.configPaths[0],"utf8"));
      const provider:any=Object.values(config.provider)[0];
      expect(provider.models[input.model].limit).toBeUndefined();
    } finally { await partial.cleanup?.(); }
    await expect(prepareHarnessLaunch({...input,harness:"opencode",version:"1.17.99"})).rejects.toThrow("1.18.0");
    for (const args of [["run","--model","outside"],["run","--attach","http://other.example"],["run","--password","outside"],["run","-u","outside"]])
      await expect(prepareHarnessLaunch({...input,harness:"opencode",version:"1.18.29",args})).rejects.toThrow("reserved");
  } finally { await rm(input.stateDir,{recursive:true,force:true}); }
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
    prepared=await prepareHarnessLaunch({...input,harness:"opencode2",version:"opencode2 v0.0.0-beta-19157",protocol:"anthropic-messages",authStyle:"bearer",baseUrl:upstream.url.origin+"/v1"});
    const config=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));const provider:any=Object.values(config.providers)[0];
    const response=await fetch(provider.settings.baseURL+"/messages",{method:"POST",headers:{"x-api-key":prepared.env.SWITCHER_HARNESS_API_KEY,"content-type":"application/json"},body:JSON.stringify({model:input.model})});
    expect(response.status).toBe(200);expect(auth).toBe(`Bearer ${input.credential}`);expect(key).toBeNull();
  }finally{await prepared?.cleanup?.();await upstream.stop(true);await rm(input.stateDir,{recursive:true,force:true});}
});
test("native harnesses bridge Azure's literal api-key contract instead of sending it as Bearer",async()=>{
  const input=await fixture();let prepared:Awaited<ReturnType<typeof prepareHarnessLaunch>>|undefined;
  let authorization:string|null=null,key:string|null=null;
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(req){authorization=req.headers.get("authorization");key=req.headers.get("api-key");return Response.json({ok:true});}});
  try {
    prepared=await prepareHarnessLaunch({...input,harness:"claude",protocol:"anthropic-messages",authStyle:"api-key",baseUrl:upstream.url.origin+"/prefix/v1",version:"2.1.261"});
    const response=await fetch(prepared.env.ANTHROPIC_BASE_URL+"/v1/messages",{method:"POST",headers:{authorization:`Bearer ${prepared.env.ANTHROPIC_AUTH_TOKEN}`,"content-type":"application/json"},body:JSON.stringify({model:input.model,messages:[]})});
    expect(response.status).toBe(200);
    expect(key).toBe(input.credential); expect(authorization).toBeNull();
  } finally { await prepared?.cleanup?.(); await upstream.stop(true); await rm(input.stateDir,{recursive:true,force:true}); }
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
    prepared=await prepareHarnessLaunch({...input,harness:"opencode2",protocol:"anthropic-messages",authStyle:"bearer",baseUrl:upstream.url.origin+"/v1",version:"opencode2 v0.0.0-beta-19157"});
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


test("native attached and clustered options cannot override the launch profile",async()=>{
  const input=await fixture();
  const cases:[HarnessLaunchInput["harness"],string,string[][]][]=[
    ["codex","0.153.4",[["exec","-mvendor/second"],["-pother"],["-hmvendor/second"],["-hcmodel=other"],["--oss"],["--local-provider=ollama"],["--remote","ws://127.0.0.1:9999"],["-c",'"model_provider"="outside"']]],
    ["grok","1.0.13",[["-mvendor/second"],["-cmvendor/second"]]],
    ["opencode","1.18.29",[["-mvendor/second"],["--model=outside/model"],["run","-cmoutside/model"],["run","--attach","http://127.0.0.1:9"],["run","--auto"],["run","-psecret"],["run","-uoutside"]]],
    ["opencode2","2.0.0-beta-19157",[["run","-moutside/model"],["run","-cmoutside/model"]]],
  ];
  try{
    for(const [harness,version,arguments_] of cases)for(const args of arguments_)
      await expect(prepareHarnessLaunch({...input,harness,version,args})).rejects.toThrow("profile");
  }finally{await rm(input.stateDir,{recursive:true,force:true});}
});

test("native argument values and end-of-options prompts keep literal model-looking text",async()=>{
  const input=await fixture();
  try{
    for(const [index,args] of [["exec","-oresult-mmodel.txt","--","-mvendor/second"],["exec","-capproval_policy=never","--","--model=literal"]].entries()){
      const prepared=await prepareHarnessLaunch({...input,harness:"codex",version:"0.153.4",stateDir:join(input.stateDir,String(index)),args});
      expect(prepared.args.slice(-args.length)).toEqual(args);
    }
    const grok=await prepareHarnessLaunch({...input,harness:"grok",version:"1.0.13",stateDir:join(input.stateDir,"grok"),args:["-p-mvendor/second"]});
    try{expect(grok.args.at(-1)).toBe("-p-mvendor/second");}finally{await grok.cleanup?.();}
    const opencode=await prepareHarnessLaunch({...input,harness:"opencode",version:"1.18.29",stateDir:join(input.stateDir,"opencode"),args:["run","--","-mvendor/second"]});
    try{expect(opencode.args.slice(-2)).toEqual(["--","-mvendor/second"]);}finally{await opencode.cleanup?.();}
  }finally{await rm(input.stateDir,{recursive:true,force:true});}
});

test("Claude fallback model selection is owned by the launch profile",async()=>{
  const input=await fixture();
  try{
    for(const args of [["--fallback-model","outside/model"],["--fallback-model=outside/model,other/model"]])
      await expect(prepareHarnessLaunch({...input,harness:"claude",protocol:"anthropic-messages",version:"2.1.263",args})).rejects.toThrow("profile");
  }finally{await rm(input.stateDir,{recursive:true,force:true});}
});

test("OMP requires the verified native catalog and session contract version",()=>{
  for(const version of [undefined,"omp/17.0.0","omp/18.1.10"]) expect(()=>validateHarnessVersion("omp",version)).toThrow("18.1.11");
  expect(()=>validateHarnessVersion("omp","omp/18.1.11")).not.toThrow();
});

test("Prime Agent writes an isolated catalog, pins provider/model on resume, and maps native protocols",async()=>{
  const input=await fixture();
  try {
    const prepared=await prepareHarnessLaunch({...input,harness:"prime-agent",version:"prime-agent 0.9.2",protocol:"openai-responses",authStyle:"bearer",sessionDir:join(input.stateDir,"sessions"),args:["--continue","--mode","json","-p","resume"]});
    const config=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));
    const provider:any=Object.values(config.providers)[0];
    expect(prepared.args[0]).toBe("--daemon-socket");
    expect(prepared.args[1]).toStartWith(join(prepared.env.TMPDIR,"p-"));
    expect(prepared.args.slice(2,8)).toEqual(["--provider",Object.keys(config.providers)[0],"--model",input.model,"--models",`${Object.keys(config.providers)[0]}/**`]);
    expect(provider.baseUrl).toBe(input.baseUrl); expect(provider.api).toBe("openai-responses"); expect(provider.apiKey).toBe("SWITCHER_HARNESS_API_KEY");
    expect(prepared.env.PRIME_AGENT_CODING_AGENT_DIR).toContain(input.stateDir); expect(prepared.env.PRIME_AGENT_SESSION_DIR).toBe(join(input.stateDir,"sessions"));
    expect(JSON.stringify(config)).not.toContain(input.credential); expect(prepared.args).toContain("--continue");
    await prepared.cleanup?.();
    const anthropic=await prepareHarnessLaunch({...input,stateDir:join(input.stateDir,"anthropic"),harness:"prime-agent",version:"0.9.2",protocol:"anthropic-messages",authStyle:"x-api-key",baseUrl:"https://example.com/prefix/v1"});
    const anthropicConfig=JSON.parse(await readFile(anthropic.configPaths[0],"utf8"));
    expect((Object.values(anthropicConfig.providers)[0] as any).baseUrl).toBe("https://example.com/prefix");
    expect((Object.values(anthropicConfig.providers)[0] as any).api).toBe("anthropic-messages");
    await anthropic.cleanup?.();
  } finally { await rm(input.stateDir,{recursive:true,force:true}); }
});
test("Prime Agent keeps provider identity stable across auth bridges and reserves routing flags",async()=>{
  const first=await fixture(); const second=await fixture();
  const prepared:Awaited<ReturnType<typeof prepareHarnessLaunch>>[]=[];
  const configs:any[]=[];
  const sharedSessionDir=join(first.stateDir,"sessions");
  try {
    for(const input of [first,second]) {
      const p=await prepareHarnessLaunch({...input,harness:"prime-agent",version:"0.9.2",authStyle:"x-api-key",protocol:"openai-responses",sessionDir:sharedSessionDir,args:["--continue","--mode","json","-p","resume"]});
      prepared.push(p); configs.push(JSON.parse(await readFile(p.configPaths[0],"utf8")));
    }
    expect(Object.keys(configs[0].providers)).toEqual(Object.keys(configs[1].providers));
    expect((Object.values(configs[0].providers)[0] as any).baseUrl).not.toBe((Object.values(configs[1].providers)[0] as any).baseUrl);
    expect(prepared[0].env.SWITCHER_HARNESS_API_KEY).not.toBe(prepared[1].env.SWITCHER_HARNESS_API_KEY);
    expect(prepared[0].env.PRIME_AGENT_SESSION_DIR).toBe(sharedSessionDir);
    expect(prepared[1].env.PRIME_AGENT_SESSION_DIR).toBe(sharedSessionDir);
    expect(prepared[0].env.PRIME_AGENT_CODING_AGENT_DIR).not.toBe(prepared[1].env.PRIME_AGENT_CODING_AGENT_DIR);
    expect(prepared[0].configPaths[0]).not.toBe(prepared[1].configPaths[0]);
    expect(prepared[0].args[1]).not.toBe(prepared[1].args[1]);
    const servers=await Promise.all(prepared.map(p=>new Promise<ReturnType<typeof createServer>>((resolve,reject)=>{
      const server=createServer(); server.once("error",reject); server.listen(p.args[1],()=>{server.off("error",reject);resolve(server);});
    })));
    await Promise.all(servers.map(server=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))));
    for(const args of [["--provider","other"],["--model=other"],["--api-key","other"],["--models","other/**"],["--session-dir","other"]])
      await expect(prepareHarnessLaunch({...first,harness:"prime-agent",version:"0.9.2",args})).rejects.toThrow("reserved");
  } finally { await Promise.all(prepared.map(p=>p.cleanup?.())); await rm(first.stateDir,{recursive:true,force:true}); await rm(second.stateDir,{recursive:true,force:true}); }
});
test("Prime Agent rejects case-colliding model IDs before native launch",async()=>{
  const input=await fixture();
  try {
    await expect(prepareHarnessLaunch({...input,harness:"prime-agent",version:"0.9.2",models:[{...input.models[0],id:"Foo"},{...input.models[0],id:"foo"}],model:"foo"})).rejects.toThrow("case");
  } finally { await rm(input.stateDir,{recursive:true,force:true}); }
});
test("Prime Agent uses a private Switcher runtime when TMPDIR is too long for derived worker sockets",async()=>{
  const input=await fixture();
  const previousTmp=process.env.TMPDIR, previousHome=process.env.HASNA_SWITCHER_HOME;
  const scratch=join(homedir(),"Workspace","scratch");
  await mkdir(scratch,{recursive:true});
  // Keep the generated home short enough for Prime's derived worker socket;
  // mkdtemp makes cleanup scoped to this test's owned directory.
  const fallbackHome=await mkdtemp(join(scratch,"p"));
  try {
    process.env.TMPDIR=join(input.stateDir,"a-very-long-private-runtime-directory-name");
    process.env.HASNA_SWITCHER_HOME=fallbackHome;
    const prepared=await prepareHarnessLaunch({...input,harness:"prime-agent",version:"0.9.2"});
    expect(prepared.env.TMPDIR).toBe(join(fallbackHome,"r"));
    expect(Buffer.byteLength(prepared.args[1],"utf8")).toBeLessThanOrEqual(100);
    await prepared.cleanup?.();
  } finally {
    if(previousTmp===undefined) delete process.env.TMPDIR; else process.env.TMPDIR=previousTmp;
    if(previousHome===undefined) delete process.env.HASNA_SWITCHER_HOME; else process.env.HASNA_SWITCHER_HOME=previousHome;
    await rm(input.stateDir,{recursive:true,force:true});
    await rm(fallbackHome,{recursive:true,force:true});
  }
});
test("Prime Agent owns a foreground supervisor through delayed readiness and cancellation",async()=>{
  const input=await fixture();
  const daemonScript=join(input.stateDir,"fake-prime-daemon.mjs");
  const daemonSource=`#!/usr/bin/env bun
import {createServer} from "node:net";
const socket=process.argv[process.argv.indexOf("--daemon-socket")+1];
let server;
setTimeout(()=>{
  server=createServer(connection=>{
    connection.write(JSON.stringify({type:"daemon_hello",protocol:{name:"prime-agent.daemon",version:7}})+"\\n");
    connection.on("data",chunk=>{if(chunk.toString().includes('"type":"shutdown"')){connection.write(JSON.stringify({type:"response",success:true})+"\\n");connection.end();server.close(()=>process.exit(0));}});
  });
  server.listen(socket);
},1300);
`;
  await writeFile(daemonScript,daemonSource,{mode:0o700});
  await chmod(daemonScript,0o700);
  try {
    const prepared=await prepareHarnessLaunch({...input,harness:"prime-agent",version:"0.9.2",executable:daemonScript,args:["--continue"]});
    const started=Date.now(); await prepared.beforeLaunch?.();
    expect(Date.now()-started).toBeGreaterThanOrEqual(1200);
    await prepared.cleanup?.();
    expect(await access(prepared.args[1]).then(()=>true,()=>false)).toBe(false);
  } finally { await rm(input.stateDir,{recursive:true,force:true}); }
  const cancelledInput=await fixture();
  const cancelledScript=join(cancelledInput.stateDir,"fake-prime-daemon.mjs");
  await writeFile(cancelledScript,daemonSource,{mode:0o700});
  await chmod(cancelledScript,0o700);
  try {
    const prepared=await prepareHarnessLaunch({...cancelledInput,harness:"prime-agent",version:"0.9.2",executable:cancelledScript,args:["--continue"]});
    const pending=prepared.beforeLaunch?.();
    await new Promise(resolve=>setTimeout(resolve,200));
    await prepared.cleanup?.();
    await expect(pending).rejects.toThrow("exited before");
    expect(await access(prepared.args[1]).then(()=>true,()=>false)).toBe(false);
  } finally { await rm(cancelledInput.stateDir,{recursive:true,force:true}); }
});

test("OMP literal api-key Messages requires the public launch bridge without extra upstream auth",async()=>{
  const input=await fixture();let prepared:Awaited<ReturnType<typeof prepareHarnessLaunch>>|undefined;
  const calls:Record<string,string|null>[]=[];
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){calls.push({key:req.headers.get("api-key"),auth:req.headers.get("authorization"),xKey:req.headers.get("x-api-key")});return Response.json({ok:true});}});
  try {
    const options={...input,harness:"omp" as const,version:"18.1.11",protocol:"anthropic-messages" as const,authStyle:"api-key" as const,baseUrl:upstream.url.origin+"/v1"};
    const {prepareOmpLaunch}=await import("../src/omp-backend");
    await expect(prepareOmpLaunch(options)).rejects.toThrow("requires the Switcher launch bridge");
    prepared=await prepareHarnessLaunch(options);
    const config=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));
    const response=await fetch(config.providers.switcher.baseUrl+"/messages",{method:"POST",headers:{"x-api-key":prepared.env.SWITCHER_HARNESS_API_KEY,"content-type":"application/json"},body:JSON.stringify({model:input.model})});
    expect(response.status).toBe(200);expect(calls).toEqual([{key:input.credential,auth:null,xKey:null}]);
  } finally {await prepared?.cleanup?.();await upstream.stop(true);await rm(input.stateDir,{recursive:true,force:true});}
});
