import { expect, test } from "bun:test";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexStateRequestStream, rewriteCodexStateRequest } from "../src/codex-state-bridge";
import { listCodexSessions, resolveCodexResumeArguments } from "../src/codex-session-discovery";
import { prepareChatGPTLaunch } from "../src/chatgpt-launch";
import { nativeDesktopStateId, resolveNativeState } from "../src/native-state";
import type { PreparedLaunch } from "../src/harness-types";

const routing = { model: "new-provider/model", config: { model_provider: "switcher", sqlite_home: "/canonical" } };
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
    const params=JSON.parse(rewriteCodexStateRequest(request({id:1,method,params:{model:"old",modelProvider:"openai",...(method==="thread/start"?{allowProviderModelFallback:true}:{}),approvalPolicy:"never",sandbox:"read-only",config:{'model_providers.switcher.base_url':"https://unrelated.invalid",'"sqlite_home"':"/other",'"model_provider"':"other",'model':"other",'permissions.custom.filesystem':{":root":"read"}}}}),routing).toString()).params;
    expect(params.modelProvider).toBe("switcher");expect(params.model).toBe(routing.model);
    expect(params.config).toEqual({...routing.config,'permissions.custom.filesystem':{":root":"read"}});
    expect(params.approvalPolicy).toBe("never");expect(params.sandbox).toBe("read-only");
    if(method==="thread/start")expect(params.allowProviderModelFallback).toBe(false);else expect(params.allowProviderModelFallback).toBeUndefined();
  }
  expect(()=>rewriteCodexStateRequest(request({id:1,method:"thread/start",params:{config:{profile:"unowned"}}}),routing)).toThrow();
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
  for (const body of ["not-json\n", '{"id":1}', "x".repeat(8 * 1024 * 1024 + 1)]) {
    const invalid = codexStateRequestStream(routing);const error = once(invalid, "error");invalid.resume();invalid.end(body);
    expect((await error)[0]).toBeInstanceOf(Error);
  }
});

test("real metadata child lists every provider without starting a turn and is reaped before returning", () => fixture(async root => {
  const childFile = join(root, "native.ts"), calls = join(root, "calls.jsonl"), closed = join(root, "closed");
  await writeFile(childFile, `import{appendFileSync,writeFileSync}from'node:fs';import{createInterface}from'node:readline';
writeFileSync(${JSON.stringify(closed)},String(process.pid));
createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);appendFileSync(${JSON.stringify(calls)},JSON.stringify(r)+'\\n');
if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{userAgent:'fixture'}}));
if(r.method==='thread/list')console.log(JSON.stringify({id:r.id,result:{data:[{id:'00000000-0000-0000-0000-000000000001',cwd:${JSON.stringify(root)},name:'Old provider conversation'}],nextCursor:null}}));});`, { mode: 0o600 });
  const prepared: PreparedLaunch = { executable: process.execPath, args: [childFile], env: { HOME: root }, warnings: [], configPaths: [] };
  const page = await listCodexSessions(prepared, root, { limit: 30, cwd: root });
  expect(page.data[0].name).toBe("Old provider conversation");
  const rows = (await readFile(calls, "utf8")).trim().split("\n").map(JSON.parse);
  expect(rows.map(row => row.method)).toEqual(["initialize", "initialized", "thread/list"]);
  expect(rows[2].params).toMatchObject({ modelProviders: [], useStateDbOnly: false, cwd: root });
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
});

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

test("two desktop provider launches keep the same corpus/Electron identity while auth is ephemeral and sandbox arguments stay exact", () => fixture(async root => {
  await mkdir(join(root,".codex"),{mode:0o700});
  await writeFile(join(root,".codex/model.md"),"native fixture instructions",{mode:0o600});
  const canonicalConfig='developer_instructions="shared developer fixture"\nmodel_instructions_file="model.md"\ninclude_environment_context=false\nproject_doc_fallback_filenames=["RULES.md"]\n';
  await writeFile(join(root,".codex/config.toml"),canonicalConfig,{mode:0o600});
  const state = await resolveNativeState("codex", { HOME: root });
  const session = join(root, nativeDesktopStateId(state)), nativePath = join(root, "native-codex");
  await mkdir(join(state.home, "sessions"), { mode: 0o700 });
  const transcript = '{"type":"function_call_output","call_id":"preserved","output":"exact"}\n';
  await writeFile(join(state.home, "sessions/thread.jsonl"), transcript, { mode: 0o600 });
  await writeFile(nativePath, `#!${process.execPath}\nimport{createInterface}from'node:readline';if(process.argv[2]==='sandbox'){console.log(JSON.stringify(process.argv.slice(2)))}else{createInterface({input:process.stdin}).on('line',line=>console.log(line))}\n`, { mode: 0o700 });
  const app = { path: "/fixture/ChatGPT.app", executable: "/fixture/ChatGPT", codexExecutable: nativePath, bundleId: "com.openai.codex", version: "26.901.51231" };
  let previousElectron: string | undefined;
  for (const model of ["provider-a/model", "provider-b/model"]) {
    const launch = join(root, model.slice(0, 10));await mkdir(launch, { mode: 0o700 });
    const native: PreparedLaunch = { executable: nativePath, args: ["-c", `model=${JSON.stringify(model)}`, "-c", 'model_provider="switcher"', "-c", `sqlite_home=${JSON.stringify(state.sqliteHome)}`], env: { SWITCHER_HARNESS_API_KEY: "fixture-only" }, configPaths: [], warnings: [] };
    const prepared = await prepareChatGPTLaunch(native, app, launch, session, state);
    try {
      expect(prepared.env.HASNA_CODEX_STATE_HOME).toBe(state.home);expect(prepared.env.CODEX_SQLITE_HOME).toBe(state.home);
      const config=Bun.TOML.parse(await readFile(join(prepared.env.CODEX_HOME,"config.toml"),"utf8"));
      expect(config).toMatchObject({model,model_provider:"switcher",developer_instructions:"shared developer fixture",model_instructions_file:join(state.home,"model.md"),include_environment_context:false,project_doc_fallback_filenames:["RULES.md"]});
      expect(await readFile(join(state.home,"config.toml"),"utf8")).toBe(canonicalConfig);
      if(previousElectron)expect(prepared.env.CODEX_ELECTRON_USER_DATA_PATH).toBe(previousElectron);previousElectron=prepared.env.CODEX_ELECTRON_USER_DATA_PATH;
      expect(await readFile(join(prepared.env.CODEX_HOME, "sessions/thread.jsonl"), "utf8")).toBe(transcript);
      expect(await realpath(join(prepared.env.CODEX_HOME, "thread-writer-locks"))).toBe(join(state.home, "thread-writer-locks"));
      const nativeArgs = ["sandbox", "--", "node", "kernel.js"];
      const child = Bun.spawn([prepared.env.CODEX_CLI_PATH, ...nativeArgs], { env: { PATH: process.env.PATH, ...prepared.env }, stdout: "pipe", stderr: "pipe" });
      expect(JSON.parse(await new Response(child.stdout).text())).toEqual(nativeArgs);expect(await child.exited).toBe(0);
      const bridge = Bun.spawn([prepared.env.CODEX_CLI_PATH, "app-server"], { env: { PATH: process.env.PATH, ...prepared.env }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      bridge.stdin.write(JSON.stringify({ id: 1, method: "thread/list", params: { modelProviders: ["openai"] } }) + "\n");bridge.stdin.end();
      const output = JSON.parse(await new Response(bridge.stdout).text());expect(await bridge.exited).toBe(0);
      expect(output.params).toEqual({ modelProviders: [], useStateDbOnly: false });
    } finally { await prepared.cleanup?.(); }
    expect(await Bun.file(join(session, "codex/auth.json")).exists()).toBe(false);
  }
}));
