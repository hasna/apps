import { expect, test } from "bun:test";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexStateRequestStream, rewriteCodexStateRequest } from "../src/codex-state-bridge";
import { listCodexSessions, resolveCodexResumeArguments } from "../src/codex-session-discovery";
import { prepareChatGPTLaunch } from "../src/chatgpt-launch";
import { resolveNativeState } from "../src/native-state";
import type { PreparedLaunch } from "../src/harness-types";
import { HarnessSettlementError } from "../src/harness-process";
import { desktopAdmissionFixture, desktopHelperFixture } from "./fixtures/codex-desktop";

const routing = { model: "new-provider/model", config: { model_provider: "switcher", model_providers:{switcher:{name:"Switcher",base_url:"http://127.0.0.1:9876/v1",wire_api:"responses",requires_openai_auth:false,env_key:"SWITCHER_HARNESS_API_KEY"}},model_catalog_json:"/catalog.json",sqlite_home: "/canonical" } };
const request = (value: unknown) => Buffer.from(JSON.stringify(value));
async function fixture(body: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "switcher-session-discovery-")));
  try { await body(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("catalog requests remove provider filtering and enable native read-repair while retaining pagination and workspace filters", () => {
  const value = JSON.parse(rewriteCodexStateRequest(request({ id: "list-1", method: "thread/list", params: {
    modelProviders: ["old-provider"], useStateDbOnly: true, cursor: "opaque", cwd: "/project", archived: true, limit: 15,
  } }), routing).toString());
  expect(value).toEqual({ id: "list-1", method: "thread/list", params: { modelProviders: [], useStateDbOnly: false, cursor: "opaque", cwd: "/project", archived: true, limit: 15 } });
});

test("start/resume/fork pin routing including equivalent TOML keys and preserve permission controls", () => {
  for(const method of ["thread/start","thread/resume","thread/fork"]) {
    const params=JSON.parse(rewriteCodexStateRequest(request({id:1,method,params:{model:"old",modelProvider:"openai",...(method==="thread/start"?{allowProviderModelFallback:true}:{}),approvalPolicy:"never",sandbox:"read-only",config:{'model_providers.switcher.base_url':"https://unrelated.invalid",'"sqlite_home"':"/other",'"model_provider"':"other",'model':"other",agents:{enabled:false,worker:{description:"keep",config_file:"/old"}},memories:{custom:"keep",extract_model:"old"},'permissions.custom.filesystem':{":root":"read"}}}}),routing).toString()).params;
    expect(params.modelProvider).toBe("switcher");expect(params.model).toBe(routing.model);
    expect(params.config).toEqual({...routing.config,agents:{enabled:false,worker:{description:"keep"}},memories:{custom:"keep"},'permissions.custom.filesystem':{":root":"read"}});
    expect(params.approvalPolicy).toBe("never");expect(params.sandbox).toBe("read-only");
    if(method==="thread/start")expect(params.allowProviderModelFallback).toBe(false);else expect(params.allowProviderModelFallback).toBeUndefined();
  }
  expect(()=>rewriteCodexStateRequest(request({method:"thread/start",params:{model:"old",config:{mcp_servers:{evil:{command:"outside"}}}}}),routing)).toThrow();
  for(const config of [{auth_home:"/other"},{cli_auth_credentials_store:"keyring"},{nested:{authHome:"/other"}},{profile:"unowned"},{mcp_servers:{bad:{command:"outside"}}},{nested:{auth_command:"outside"}},
    {"nested.mcp_servers.evil.command":"/tmp/evil"},{"agents.worker.mcp_servers.evil.command":"/tmp/evil"},{"agents.worker.auth_command":"/tmp/helper"},
    {agents:{worker:{mcp_servers:{evil:{command:"/tmp/evil"}}}}},{memories:{nested:{plugins:{evil:true}}}},
    {nested:{"mcp_servers.evil.command":"/tmp/evil"}},{nested:{'"mcp_servers"':{evil:{command:"/tmp/evil"}}}},{nested:{"auth_command.evil":"/tmp/helper"}},{safe:{"model_provider.evil":"outside"}},
    {nested:{"provider.evil":"outside"}}])
    expect(()=>rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{config}}),routing)).toThrow();
  const stripped=JSON.parse(rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{config:{"x.model_providers.evil.base_url":"https://evil.invalid",safe:"keep"}}}),routing).toString());expect(stripped.params.config.safe).toBe("keep");expect(stripped.params.config["x.model_providers.evil.base_url"]).toBeUndefined();
  const providerStripped=JSON.parse(rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{config:{provider:"outside","agents.worker.provider":"outside",agents:{worker:{provider:"outside",description:"keep"}}}}}),routing).toString());expect(providerStripped.params.config.provider).toBeUndefined();expect(providerStripped.params.config["agents.worker.provider"]).toBeUndefined();expect(providerStripped.params.config.agents).toEqual({worker:{description:"keep"}});
  expect(()=>rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{}}),{...routing,config:{...routing.config,model_providers:{switcher:{...routing.config.model_providers.switcher,base_url:"https://evil.invalid"}}}})).toThrow();
  expect(()=>rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{}}),{...routing,config:{...routing.config,agents:{worker:{"mcp_servers.evil.command":"/tmp/evil"}}}})).toThrow();
  expect(()=>rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{}}),{...routing,config:{...routing.config,agents:{worker:{provider:"outside"}}}})).toThrow();
});

test("managed requests reject top-level provider, transport and credential aliases without inspecting opaque input", () => {
  const unsafe = ["transport","transports","plugin","plugins","mcp_server","mcp_servers","mcpServer","mcpServers","model_provider","provider","providers","providerId","modelId","model_providers","model_catalog_json","review_model","sqlite_home","config_file","extract_model","consolidation_model","default_subagent_model","profile","profiles","include","auth_home","authHome","cli_auth_credentials_store","cliAuthCredentialsStore","env_key","envKey","env_http_headers","envHttpHeaders","http_headers","httpHeaders","httpHeader","header","headers","auth","authorization","Authorization","api_key","apiKey","api-key","x-api-key","auth_command","authCommand","base_url","baseUrl","baseURL","wire_api","wireApi","wireAPI","requires_openai_auth","requiresOpenaiAuth","requiresOpenAIAuth"];
  for(const method of ["thread/list","thread/start","thread/resume","thread/fork"])
    for(const key of unsafe)
      expect(()=>rewriteCodexStateRequest(request({id:1,method,params:{[key]:"outside"}}),routing)).toThrow();
  for(const key of ['"provider.evil"','"mcp_servers.evil.command"','"authCommand.evil"','"baseUrl.evil"'])
    expect(()=>rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{[key]:"outside"}}),routing)).toThrow();
  const history=[{type:"function_call",arguments:{provider:"opaque",headers:{authorization:"opaque"},plugins:["opaque"]}}];
  const input=[{type:"text",text:"opaque",metadata:{transport:"literal conversation data"}}];
  const permissions={custom:{provider:"literal permission metadata",headers:["literal"]}};
  const value=JSON.parse(rewriteCodexStateRequest(request({id:1,method:"thread/resume",params:{threadId:"exact",history,input,permissions,cwd:"/project",sandbox:"read-only",approvalPolicy:"never"}}),routing).toString());
  expect(value.params).toMatchObject({threadId:"exact",history,input,permissions,cwd:"/project",sandbox:"read-only",approvalPolicy:"never",modelProvider:"switcher",model:routing.model});
});

test("quoted dotted config and agents/memories owned fields cannot override generated routing", () => {
  for(const key of ['"model_provider.evil"','"base_url.evil"','"wire_api.evil"','"modelProvider.evil"','"sqlite_home.evil"']) {
    const value=JSON.parse(rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{config:{[key]:"outside",safe:"keep"}}}),routing).toString());
    expect(value.params.config[key]).toBeUndefined();expect(value.params.config.safe).toBe("keep");
  }
  for(const key of ['"mcp_servers.evil.command"','"plugins.evil"','"auth_command.evil"','"envHttpHeaders.evil"','"headers.evil"'])
    expect(()=>rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{config:{[key]:"outside"}}}),routing)).toThrow();
  const owned=["model","model_provider","provider","providers","providerId","modelId","model_catalog_json","review_model","sqlite_home","config_file","extract_model","consolidation_model","baseURL","wireAPI","requires_openai_auth","requiresOpenaiAuth","requiresOpenAIAuth","default_subagent_model","default_subagent_reasoning_effort","default_subagent_reasoning_summary","defaultSubagentModel","defaultSubagentReasoningEffort","defaultSubagentReasoningSummary"];
  for(const root of ["agents","memories"])
    for(const key of owned) {
      const nested={safe:"keep",worker:{description:"keep",[key]:"outside",nested:{[key]:"outside"}}};
      const dotted=`${root}.worker.${key}`,quoted=`"${root}.worker.${key}"`;
      const value=JSON.parse(rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{config:{[root]:nested,[dotted]:"outside",[quoted]:"outside"}}}),routing).toString());
      expect(value.params.config[dotted]).toBeUndefined();expect(value.params.config[quoted]).toBeUndefined();
      expect(value.params.config[root]).toEqual({...routing.config[root],safe:"keep",worker:{description:"keep",nested:{}}});
    }
});

test("malformed and ambiguous config paths fail closed before native decoding", () => {
  for(const key of ["safe[","model_provider[",'"unclosed',"agents..worker","memories.worker["])
    expect(()=>rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{config:{[key]:"outside"}}}),routing)).toThrow();
  for(const root of ["agents","memories"])
    for(const entries of [
      [[root,{safe:true}],[`${root}.worker.description`,"outside"]],
      [[`${root}.worker.description`,"outside"],[root,{safe:true}]],
      [[`"${root}"`,{safe:true}],[root,{safe:true}]],
      [[root,{safe:true}],[`'${root}'`,{safe:true}]],
    ]) expect(()=>rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{config:Object.fromEntries(entries)}}),routing)).toThrow();
});

test("agent role names are opaque while their routing fields remain launch-owned", () => {
  const agents=Object.fromEntries(["model","provider","plugins","headers","config_file"].map(name=>[name,{description:`${name} specialist`,model:"outside",config_file:"/outside",permissions:{custom:true}}]));
  const value=JSON.parse(rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{config:{agents}}}),routing).toString());
  expect(value.params.config.agents).toEqual(Object.fromEntries(Object.entries(agents).map(([name,item])=>[name,{description:item.description,permissions:{custom:true}}])));
  for(const unsafe of [JSON.parse('{"__proto__":{"description":"outside"}}'),JSON.parse('{"constructor":{"description":"outside"}}')]) {
    expect(()=>rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{config:{agents:unsafe}}}),routing)).toThrow();
    expect(()=>rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{}}),{...routing,config:{...routing.config,agents:unsafe}})).toThrow();
  }
});

test("generated routing accepts only its loopback schema and sanitized private subtrees", () => {
  const invalid = [
    {...routing,model:123 as unknown as string},
    {...routing,config:{...routing.config,model_catalog_json:"/tmp/../catalog.json"}},
    {...routing,config:{...routing.config,sqlite_home:"/tmp//state"}},
    {...routing,config:{...routing.config,model_providers:{switcher:{...routing.config.model_providers.switcher,name:"Outside"}}}},
    {...routing,config:{...routing.config,model_providers:{switcher:{...routing.config.model_providers.switcher,base_url:"http://127.0.0.1:9876/not-v1"}}}},
    {...routing,config:{...routing.config,agents:{model:"outside"}}},
    {...routing,config:{...routing.config,agents:{worker:{config_file:"/tmp/../outside"}}}},
    {...routing,config:{...routing.config,memories:{extract_model:"bad\nmodel"}}},
    {...routing,config:{...routing.config,model_catalog_json:"relative/catalog.json"}},
    {...routing,config:{...routing.config,model_catalog_json:"/"}},
    {...routing,config:{...routing.config,model_catalog_json:"/tmp/catalog.json/"}},
    {...routing,config:{...routing.config,model_catalog_json:"/tmp/./catalog.json"}},
    {...routing,config:{...routing.config,model_catalog_json:"/tmp/bad\rcatalog.json"}},
    {...routing,config:{...routing.config,model_catalog_json:7}},
    {...routing,config:{...routing.config,model_providers:{switcher:{name:"Switcher",base_url:"http://127.0.0.1:9876/v1",wire_api:"responses",requires_openai_auth:false}}}},
    {...routing,config:{...routing.config,model_providers:{switcher:{...routing.config.model_providers.switcher,env_http_headers:{"x-api-key":"SWITCHER_HARNESS_API_KEY"}}}}},
    {...routing,config:{...routing.config,model_providers:{switcher:{name:"Switcher",base_url:"http://127.0.0.1:9876/v1",wire_api:"responses",requires_openai_auth:false,env_http_headers:{authorization:"SWITCHER_HARNESS_API_KEY"}}}}},
    {...routing,config:{...routing.config,model_providers:{switcher:{name:"Switcher",base_url:"http://127.0.0.1:9876/v1",wire_api:"responses",requires_openai_auth:false,env_http_headers:{"x-api-key":"WRONG"}}}}},
    {...routing,config:{...routing.config,model_providers:{switcher:{name:"Switcher",base_url:"http://127.0.0.1:9876/v1",wire_api:"responses",requires_openai_auth:false,env_http_headers:{"x-api-key":"SWITCHER_HARNESS_API_KEY","api-key":"SWITCHER_HARNESS_API_KEY"}}}}},
  ];
  for(const candidate of invalid)expect(()=>rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{}}),candidate)).toThrow();
  for(const header of ["x-api-key","api-key"]) {
    const candidate={...routing,config:{...routing.config,agents:{default_subagent_model:"safe/model",enabled:false,worker:{description:"keep",config_file:"/tmp/worker.toml"},model:{description:"Model specialist",config_file:"/tmp/model.toml"},provider:{description:"Provider specialist",config_file:"/tmp/provider.toml"},plugins:{description:"Plugin specialist",config_file:"/tmp/plugins.toml"},headers:{description:"Header specialist",config_file:"/tmp/headers.toml"}},memories:{custom:"keep",extract_model:"safe/model",consolidation_model:"safe/model"},model_providers:{switcher:{name:"Switcher",base_url:"http://127.0.0.1:9876/v1",wire_api:"responses",requires_openai_auth:false,env_http_headers:{[header]:"SWITCHER_HARNESS_API_KEY"}}}}};
    const value=JSON.parse(rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{}}),candidate).toString());
    expect(value.params.config).toEqual(candidate.config);
  }
});

test("resume retains native ID/history/tool IDs and permissions with current provider routing", () => {
  const history = [{ type: "function_call", call_id: "exact-call", arguments: "opaque" }, { type: "function_call_output", call_id: "exact-call", output: "unchanged" }];
  const value = JSON.parse(rewriteCodexStateRequest(request({ id: 9, method: "thread/resume", params: {
    threadId: "exact-thread", history, model: "old-model", modelProvider: "openai", sandbox: "read-only", approvalPolicy: "never",
    config: { model_provider: "old", unrelated: { keep: true } },
  } }), routing).toString());
  expect(value.params).toEqual({ threadId: "exact-thread", history, model: routing.model, modelProvider: "switcher", sandbox: "read-only", approvalPolicy: "never", config: { ...routing.config, unrelated: { keep: true } } });
  const unchanged = Buffer.from(' { "id":17, "method":"turn/start", "params":{"input":[{"text":"exact bytes"}]} } ');
  expect(rewriteCodexStateRequest(unchanged, routing)).toBe(unchanged);
});

test("request framing handles fragmented/coalesced lines and fails closed on malformed, truncated or oversized input", async () => {
  const stream = codexStateRequestStream(routing), chunks: Buffer[] = [];
  stream.on("data", chunk => chunks.push(chunk));
  const ended = once(stream, "end");
  stream.write('{"id":1,"method":"thread/');stream.write('list","params":{}}\n{"method":"initialized"}\n');stream.end();await ended;
  expect(Buffer.concat(chunks).toString().split("\n").filter(Boolean).map(JSON.parse)).toEqual([
    { id: 1, method: "thread/list", params: { modelProviders: [], useStateDbOnly: false } }, { method: "initialized" },
  ]);
  expect(()=>rewriteCodexStateRequest(Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xff,0x22,0x7d]),routing)).toThrow();
  for (const body of ["not-json\n", '{"id":1}', "x".repeat(8 * 1024 * 1024 + 1)]) {
    const invalid = codexStateRequestStream(routing);const error = once(invalid, "error");invalid.resume();invalid.end(body);
    expect((await error)[0]).toBeInstanceOf(Error);
  }
});

test("metadata discovery rejects unbounded caller queries before spawning native code", async () => {
  const prepared: PreparedLaunch = { executable: "/must-not-run", args: [], env: {}, warnings: [], configPaths: [] };
  for (const query of [{limit:0},{limit:101},{limit:1,cursor:"x".repeat(4097)},{limit:1,searchTerm:"x".repeat(1025)}])
    await expect(listCodexSessions(prepared,"/project",query)).rejects.toMatchObject({code:"codex_session_discovery"});
});

test("real metadata child lists every provider without starting a turn and is reaped before returning", () => fixture(async root => {
  const childFile = join(root, "native.ts"), calls = join(root, "calls.jsonl"), closed = join(root, "closed"), environment=join(root,"environment.json");
  await writeFile(childFile, `import{appendFileSync,writeFileSync}from'node:fs';import{createInterface}from'node:readline';
writeFileSync(${JSON.stringify(closed)},String(process.pid));writeFileSync(${JSON.stringify(environment)},JSON.stringify({credential:process.env.SWITCHER_HARNESS_API_KEY,hasna:process.env.HASNA_CODEX_STATE_HOME,home:process.env.CODEX_HOME}));
createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);appendFileSync(${JSON.stringify(calls)},JSON.stringify(r)+'\\n');
if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{userAgent:'fixture'}}));
if(r.method==='thread/list')console.log(JSON.stringify({id:r.id,result:{data:[{id:'00000000-0000-0000-0000-000000000001',cwd:${JSON.stringify(root)},name:'Old provider conversation'}],nextCursor:null}}));});`, { mode: 0o600 });
  const prepared: PreparedLaunch = { executable: process.execPath, args: [childFile], env: { HOME: root, CODEX_HOME:root, SWITCHER_HARNESS_API_KEY:"PRIVATE_PROVIDER_SENTINEL", HASNA_CODEX_STATE_HOME:"PRIVATE_STATE_SENTINEL" }, warnings: [], configPaths: [] };
  const page = await listCodexSessions(prepared, root, { limit: 30, cwd: root });
  expect(page.data[0].name).toBe("Old provider conversation");
  const rows = (await readFile(calls, "utf8")).trim().split("\n").map(JSON.parse);
  expect(rows.map(row => row.method)).toEqual(["initialize", "initialized", "thread/list"]);
  expect(rows[2].params).toMatchObject({ modelProviders: [], useStateDbOnly: false, cwd: root });
  expect(JSON.parse(await readFile(environment,"utf8"))).toEqual({credential:"switcher-metadata-no-auth",home:root});
  const pid = Number(await readFile(closed, "utf8"));expect(() => process.kill(pid, 0)).toThrow();
}));

test("resume --last obtains native cross-provider ID, preserves prompt, and explicit IDs never invoke discovery", async () => {
  const prepared: PreparedLaunch = { executable: "unused", args: [], env: {}, warnings: [], configPaths: [] };
  const queries: unknown[] = [], id = "00000000-0000-0000-0000-000000000001";
  const list = async (_prepared: PreparedLaunch, _cwd: string, query: unknown) => { queries.push(query); return { data: [{ id, cwd: "/project" }], nextCursor: null }; };
  expect(await resolveCodexResumeArguments(prepared, ["resume", "--last", "--all", "Continue exactly"], "/project", list)).toEqual(["resume", id, "Continue exactly"]);
  expect(queries).toEqual([{ limit: 1 }]);
  expect(await resolveCodexResumeArguments(prepared, ["resume", id], "/project", list)).toEqual(["resume", id]);expect(queries).toHaveLength(1);
  expect(await resolveCodexResumeArguments(prepared, ["resume", "--last", "--", "--all"], "/project", list)).toEqual(["resume", id, "--", "--all"]);
  expect(queries[1]).toEqual({ limit: 1, cwd: "/project" });
  expect(await resolveCodexResumeArguments(prepared, ["resume", "-c", "--last", id], "/project", list)).toEqual(["resume", "-c", "--last", id]);expect(queries).toHaveLength(2);
  await expect(resolveCodexResumeArguments(prepared, ["resume", "--last"], "/project", async () => ({ data: [], nextCursor: null }))).rejects.toMatchObject({ code: "codex_session_missing" });
  expect(await resolveCodexResumeArguments(prepared,["resume","-hV"],"/project",async()=>{throw new Error("help must not discover") })).toEqual(["resume","-hV"]);
});


test("malformed native thread identifiers fail closed", () => fixture(async root => {
  const path=join(root,"bad-id.ts");
  await writeFile(path,`import{createInterface}from'node:readline';createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));if(r.method==='thread/list')console.log(JSON.stringify({id:r.id,result:{data:[{id:'------------------------------------',cwd:${JSON.stringify(root)}}],nextCursor:null}}));});`,{mode:0o600});
  await expect(listCodexSessions({executable:process.execPath,args:[path],env:{HOME:root},warnings:[],configPaths:[]},root,{limit:1})).rejects.toMatchObject({code:"codex_session_discovery"});
}));

test("malformed native metadata fails without echoing its body and reaps the owned process", () => fixture(async root => {
  const path = join(root, "invalid.ts"), pidPath = join(root, "pid");
  await writeFile(path, `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(pidPath)},String(process.pid));console.log('PRIVATE_FIXTURE_INVALID_JSON');setInterval(()=>{},1000);`, { mode: 0o600 });
  let caught: unknown;
  try { await listCodexSessions({ executable: process.execPath, args: [path], env: { HOME: root }, warnings: [], configPaths: [] }, root, { limit: 1 }); }
  catch(error) { caught = error; }
  expect(caught).toMatchObject({ code: "codex_session_discovery" });expect(String(caught)).not.toContain("PRIVATE_FIXTURE");
  expect(() => process.kill(Number(require("node:fs").readFileSync(pidPath, "utf8")), 0)).toThrow();
}));

test("resume discovery honors global options and every native cd form without treating option values as commands", async () => {
  const prepared:PreparedLaunch={executable:"unused",args:[],env:{},warnings:[],configPaths:[]},id="00000000-0000-0000-0000-000000000001";
  const calls:{cwd:string;query:unknown}[]=[];
  const list=async(_p:PreparedLaunch,cwd:string,query:unknown)=>{calls.push({cwd,query});return{data:[{id,cwd}],nextCursor:null}};
  for(const native of [["--sandbox","read-only","resume","--last","--cd","/other"],["--cd=/other","resume","--last"],["-C/other","resume","--last"],["resume","--last","-C","../other"]]) {
    const result=await resolveCodexResumeArguments(prepared,native,"/project",list);
    expect(result).toContain(id);expect(calls.at(-1)).toEqual({cwd:"/other",query:{limit:1,cwd:"/other"}});
  }
  const literal=["-c",'instructions="resume"',"--","resume"];
  expect(await resolveCodexResumeArguments(prepared,literal,"/project",list)).toEqual(literal);expect(calls).toHaveLength(4);
});

async function waitGone(pid:number){const deadline=Date.now()+2000;while(Date.now()<deadline){try{process.kill(pid,0);await Bun.sleep(20);}catch{return;}}expect(()=>process.kill(pid,0)).toThrow();}

test.skipIf(process.platform==="win32")("bridge reaps a stubborn descendant after the app-server leader exits normally", () => fixture(async root => {
  const native=join(root,"native.ts"),descendant=join(root,"descendant.ts"),pidPath=join(root,"descendant.pid"),bridge=join(import.meta.dir,"../src/codex-state-bridge.ts");
  await writeFile(descendant,`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(pidPath)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`,{mode:0o600});
  await writeFile(native,`#!${process.execPath}
import{spawn}from'node:child_process';import{existsSync}from'node:fs';spawn(process.execPath,[${JSON.stringify(descendant)}],{stdio:['ignore','inherit','ignore']}).unref();while(!existsSync(${JSON.stringify(pidPath)}))await Bun.sleep(5);`,{mode:0o700});
  const child=Bun.spawn([process.execPath,bridge,native,routing.model,JSON.stringify(routing.config),"app-server"],{env:{PATH:process.env.PATH,HOME:root},stdin:"pipe",stdout:"pipe",stderr:"pipe"});child.stdin.end();
  expect(await child.exited).toBe(0);await waitGone(Number(await readFile(pidPath,"utf8")));
}));

test.skipIf(process.platform==="win32")("bridge reaps stubborn descendants after protocol failure and parent signal", () => fixture(async root => {
  const bridge=join(import.meta.dir,"../src/codex-state-bridge.ts");
  for(const mode of ["protocol","signal"]){
    const descendant=join(root,`descendant-${mode}.ts`),native=join(root,`native-${mode}`),pidPath=join(root,`descendant-${mode}.pid`);
    await writeFile(descendant,`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(pidPath)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`,{mode:0o600});
    await writeFile(native,`#!${process.execPath}
import{spawn}from'node:child_process';spawn(process.execPath,[${JSON.stringify(descendant)}],{stdio:['ignore','inherit','ignore']}).unref();process.stdin.resume();setInterval(()=>{},1000);`,{mode:0o700});
    const child=Bun.spawn([process.execPath,bridge,native,routing.model,JSON.stringify(routing.config),"app-server"],{env:{PATH:process.env.PATH,HOME:root},stdin:"pipe",stdout:"pipe",stderr:"pipe"});
    const deadline=Date.now()+2000;while(!await Bun.file(pidPath).exists()&&Date.now()<deadline)await Bun.sleep(10);expect(await Bun.file(pidPath).exists()).toBe(true);
    if(mode==="protocol"){child.stdin.write("not-json\n");child.stdin.end();}else child.kill("SIGTERM");
    expect(await child.exited).not.toBe(0);await waitGone(Number(await readFile(pidPath,"utf8")));
  }
}),10_000);

test("two desktop provider launches share the corpus while keeping Electron/auth overlays separate and sandbox arguments exact", () => fixture(async root => {
  await mkdir(join(root,".codex"),{mode:0o700});
  await writeFile(join(root,".codex/model.md"),"native fixture instructions",{mode:0o600});
  await writeFile(join(root,".codex/compact.md"),"native compact fixture",{mode:0o600});
  const canonicalConfig='developer_instructions="shared developer fixture"\nmodel_instructions_file="model.md"\nexperimental_compact_prompt_file="compact.md"\ninclude_environment_context=false\nproject_doc_fallback_filenames=["RULES.md"]\n';
  await writeFile(join(root,".codex/config.toml"),canonicalConfig,{mode:0o600});
  const state = await resolveNativeState("codex", { HOME: root });
  const nativePath = join(root, "native-codex");
  await mkdir(join(state.home, "sessions"), { mode: 0o700 });
  const transcript = '{"type":"function_call_output","call_id":"preserved","output":"exact"}\n';
  await writeFile(join(state.home, "sessions/thread.jsonl"), transcript, { mode: 0o600 });
  await writeFile(nativePath, `#!${process.execPath}\nimport{createInterface}from'node:readline';if(process.argv[2]==='sandbox'){console.log(JSON.stringify(process.argv.slice(2)))}else{createInterface({input:process.stdin}).on('line',line=>console.log(line))}\n`, { mode: 0o700 });
  const app = { path: "/fixture/ChatGPT.app", executable: "/fixture/ChatGPT", codexExecutable: nativePath, bundleId: "com.openai.codex", version: "26.901.51231" };
  let previousElectron: string | undefined;
  for (const model of ["provider-a/model", "provider-b/model"]) {
    const launch = join(root, model.slice(0, 10)), session=join(root,"desktop",model.slice(0,10));await mkdir(launch, { mode: 0o700 });
    const native: PreparedLaunch = { executable: nativePath, args: ["-c", `model=${JSON.stringify(model)}`, "-c", 'model_provider="switcher"', "-c", 'model_providers.switcher={name="Switcher",base_url="http://127.0.0.1:9876/v1",wire_api="responses",requires_openai_auth=false,env_key="SWITCHER_HARNESS_API_KEY"}', "-c", 'model_catalog_json="/catalog.json"', "-c", `sqlite_home=${JSON.stringify(state.sqliteHome)}`], env: { SWITCHER_HARNESS_API_KEY: "fixture-only" }, configPaths: [], warnings: [] };
    const prepared = await prepareChatGPTLaunch(native, app, launch, session, state, await desktopAdmissionFixture(nativePath,session,state));
    try {
      expect(prepared.env.HASNA_CODEX_STATE_HOME).toBe(state.home);expect(prepared.env.CODEX_SQLITE_HOME).toBe(state.home);
      const config=Bun.TOML.parse(await readFile(join(prepared.env.CODEX_HOME,"config.toml"),"utf8"));
      expect(config).toMatchObject({developer_instructions:"shared developer fixture",model_instructions_file:"model.md",experimental_compact_prompt_file:"compact.md",include_environment_context:false,project_doc_fallback_filenames:["RULES.md"]});
      expect(prepared.env.CODEX_HOME).toBe(state.home);
      const binding=JSON.parse(await readFile(join(launch,"desktop-binding.json"),"utf8"));expect(binding.args).toContain(`model=${JSON.stringify(model)}`);expect(binding.authHome).toBe(join(launch,"auth"));
      expect(await readFile(join(state.home,"config.toml"),"utf8")).toBe(canonicalConfig);
      if(previousElectron)expect(prepared.env.CODEX_ELECTRON_USER_DATA_PATH).not.toBe(previousElectron);previousElectron=prepared.env.CODEX_ELECTRON_USER_DATA_PATH;
      expect(await readFile(join(prepared.env.CODEX_HOME, "sessions/thread.jsonl"), "utf8")).toBe(transcript);
      expect(await Bun.file(join(session,"codex/config.toml")).exists()).toBe(false);
      const nativeArgs = ["sandbox", "--", "node", "kernel.js"];
      const child = Bun.spawn(await desktopHelperFixture(prepared,nativePath,nativeArgs), { env: { PATH: process.env.PATH, ...prepared.env }, stdout: "pipe", stderr: "pipe" });
      expect(JSON.parse(await new Response(child.stdout).text())).toEqual(nativeArgs);expect(await child.exited).toBe(0);
      const bridge = Bun.spawn(await desktopHelperFixture(prepared,nativePath,["-c","features.code_mode_host=true","app-server","--analytics-default-enabled"]), { env: { PATH: process.env.PATH, ...prepared.env }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      bridge.stdin.write(JSON.stringify({ id: 1, method: "thread/list", params: { modelProviders: ["openai"] } }) + "\n");bridge.stdin.end();
      const output = JSON.parse(await new Response(bridge.stdout).text());expect(await bridge.exited).toBe(0);
      expect(output.params).toEqual({ modelProviders: [], useStateDbOnly: false });
    } finally { await prepared.cleanup?.(); }
    expect(await Bun.file(join(launch, "auth/auth.json")).exists()).toBe(false);
  }
  const conflicted=join(root,"desktop/conflicted"),launch=join(root,"conflicted-launch");await mkdir(join(conflicted,"codex"),{recursive:true,mode:0o700});await mkdir(launch,{mode:0o700});await writeFile(join(conflicted,"codex/config.toml"),'include="private.toml"\n',{mode:0o600});
  const native:PreparedLaunch={executable:nativePath,args:["-c",'model="provider/model"',"-c",'model_provider="switcher"'],env:{SWITCHER_HARNESS_API_KEY:"fixture-only"},configPaths:[],warnings:[]};
  await expect(desktopAdmissionFixture(nativePath,conflicted,state)).rejects.toMatchObject({code:"native_state_migration_required"});expect(await Bun.file(join(conflicted,"codex/auth.json")).exists()).toBe(false);
}));


test.skipIf(process.platform === "win32")("escaped native pipe owner bounds bridge exit and retains auth plus restart fence", () => fixture(async root => {
  const nativePath = join(root, "native"), escaped = join(root, "escaped.ts"), driver = join(root, "driver.ts");
  const witness = join(root, "witness.json"), pidPath = join(root, "escaped.pid"), bridgePid = join(root, "bridge.pid"), receipt = join(root, "receipt.json");
  const launch = join(root, "launch"), session = join(root, "desktop");
  await mkdir(launch, { mode: 0o700 });
  const state = await resolveNativeState("codex", { HOME: root });
  await writeFile(escaped, `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setInterval(()=>{},1000);`, { mode: 0o600 });
  await writeFile(nativePath, `#!${process.execPath}
import{spawn}from'node:child_process';import{existsSync,writeFileSync}from'node:fs';
const child=spawn(process.execPath,[${JSON.stringify(escaped)}],{detached:true,stdio:['ignore','inherit','inherit']});child.unref();
writeFileSync(${JSON.stringify(witness)},JSON.stringify({native:process.pid,escaped:child.pid}));
while(!existsSync(${JSON.stringify(pidPath)}))await Bun.sleep(5);process.exit(0);`, { mode: 0o700 });
  const native: PreparedLaunch = { executable: nativePath, args: ["-c", `model=${JSON.stringify(routing.model)}`, "-c", 'model_provider="switcher"', "-c", 'model_providers.switcher={name="Switcher",base_url="http://127.0.0.1:9876/v1",wire_api="responses",requires_openai_auth=false,env_key="SWITCHER_HARNESS_API_KEY"}', "-c", 'model_catalog_json="/catalog.json"', "-c", `sqlite_home=${JSON.stringify(state.sqliteHome)}`], env: { SWITCHER_HARNESS_API_KEY: "fixture-only" }, configPaths: [], warnings: [] };
  const app = { path: "/fixture/ChatGPT.app", executable: "/fixture/ChatGPT", codexExecutable: nativePath, bundleId: "com.openai.codex", version: "26.901.51231" };
  await writeFile(driver, `import{readFile,readdir,writeFile}from'node:fs/promises';
import{prepareChatGPTLaunch}from ${JSON.stringify(join(import.meta.dir, "../src/chatgpt-launch.ts"))};
import{HarnessSettlementError}from ${JSON.stringify(join(import.meta.dir, "../src/harness-process.ts"))};
import{desktopAdmissionFixture,desktopHelperFixture}from ${JSON.stringify(join(import.meta.dir,"./fixtures/codex-desktop.ts"))};
let cleanupCalls=0,transportCloses=0;
const native={...${JSON.stringify(native)},cleanup:async()=>{cleanupCalls++;},closeTransport:async()=>{transportCloses++;}};
const prepared=await prepareChatGPTLaunch(native,${JSON.stringify(app)},${JSON.stringify(launch)},${JSON.stringify(session)},${JSON.stringify(state)},await desktopAdmissionFixture(native.executable,${JSON.stringify(session)},${JSON.stringify(state)}));
const auth=${JSON.stringify(join(launch, "auth/auth.json"))},config=${JSON.stringify(join(launch, "desktop-binding.json"))};
const beforeAuth=await readFile(auth,'utf8'),beforeConfig=await readFile(config,'utf8'),started=performance.now();
const child=Bun.spawn(await desktopHelperFixture(prepared,native.executable,['-c','features.code_mode_host=true','app-server','--analytics-default-enabled']),{env:{PATH:process.env.PATH,...prepared.env},stdin:'pipe',stdout:'pipe',stderr:'pipe'});
await writeFile(${JSON.stringify(bridgePid)},String(child.pid));child.stdin.end();
const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
let cleanupUncertain=false;try{await prepared.cleanup();}catch(error){cleanupUncertain=error instanceof HarnessSettlementError;}
await writeFile(${JSON.stringify(receipt)},JSON.stringify({code,elapsed:performance.now()-started,stdoutBytes:stdout.length,stderrBytes:stderr.length,cleanupUncertain,cleanupCalls,transportCloses,authRetained:await readFile(auth,'utf8')===beforeAuth,configRetained:await readFile(config,'utf8')===beforeConfig,pending:await readdir(${JSON.stringify(join(session, "codex-bridges"))})}));
process.exit(0);`, { mode: 0o600 });
  const child = Bun.spawn([process.execPath, driver], { env: { PATH: process.env.PATH, HOME: root }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 12000);
  try {
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(code, stderr).toBe(0); expect(timedOut).toBe(false);
    const result = JSON.parse(await readFile(receipt, "utf8"));
    expect(result).toMatchObject({ code: 1, cleanupUncertain: true, cleanupCalls: 0, transportCloses: 1, authRetained: true, configRetained: true, stdoutBytes: 0, stderrBytes: 0 });
    expect(result.elapsed).toBeLessThan(9000); expect(result.pending).toHaveLength(1);
    const pending = join(session, "codex-bridges", result.pending[0]);
    expect((await stat(pending)).mode & 0o777).toBe(0o600);
    const owned = JSON.parse(await readFile(witness, "utf8"));
    expect(() => process.kill(-owned.native, 0)).toThrow();
    expect(() => process.kill(owned.escaped, 0)).not.toThrow();
    const beforeAuth = await readFile(join(launch, "auth/auth.json"), "utf8"), beforeConfig = await readFile(join(launch, "desktop-binding.json"), "utf8");
    const nextLaunch = join(root, "next-launch"); await mkdir(nextLaunch, { mode: 0o700 });
    // The old desktop lease was released by its process exit. The persistent
    // receipt, including repeated failed admission, must fence every restart.
    for (let attempt = 0; attempt < 2; attempt++)
      await expect(desktopAdmissionFixture(nativePath,session,state)).rejects.toBeInstanceOf(HarnessSettlementError);
    expect(await readFile(join(launch, "auth/auth.json"), "utf8")).toBe(beforeAuth);
    expect(await readFile(join(launch, "desktop-binding.json"), "utf8")).toBe(beforeConfig);
    expect(await readdir(join(session, "codex-bridges"))).toEqual(result.pending);
    expect(await readdir(nextLaunch)).toEqual([]);
  } finally {
    clearTimeout(timer); child.kill("SIGKILL");
    const owned = JSON.parse(await readFile(witness, "utf8").catch(() => "{}"));
    for (const pid of [owned.native, owned.escaped]) if (Number.isSafeInteger(pid) && pid > 0) { try { process.kill(-pid, "SIGKILL"); } catch {} }
    const helper = Number(await readFile(bridgePid, "utf8").catch(() => "0"));
    if (helper > 0) { try { process.kill(helper, "SIGKILL"); } catch {} }
    if (owned.escaped) await waitGone(owned.escaped);
  }
}), 15000);

test("bridge receipt admission rejects unsafe directories and clears only a settled failed-spawn receipt", () => fixture(async root => {
  const directory = join(root, "pending"), alias = join(root, "alias"), bridge = join(import.meta.dir, "../src/codex-state-bridge.ts");
  await mkdir(directory, { mode: 0o700 }); await symlink(directory, alias);
  const prior = join(directory, "other-invocation.pending"); await writeFile(prior, "preserve", { mode: 0o600 });
  for (const candidate of [alias, directory]) {
    const child = Bun.spawn([process.execPath, bridge, "--settlement-dir", candidate, "/absent-native-fixture", routing.model, JSON.stringify(routing.config), "app-server"], { env: { PATH: process.env.PATH, HOME: root }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    try { expect(await child.exited).toBe(1); }
    finally { clearTimeout(timer); }
    expect(await readdir(directory)).toEqual(["other-invocation.pending"]);
    expect(await readFile(prior, "utf8")).toBe("preserve");
  }
}));
