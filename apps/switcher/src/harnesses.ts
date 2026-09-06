import { prepareKilo, validateKiloConfiguration } from "./kilo";
import { prepareGemini, validateGeminiConfiguration } from "./gemini-config";
import { geminiBridge } from "./gemini-bridge";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, isAbsolute, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createConnection } from "node:net";
import { compatible, endpoint, harnessEligible } from "./domain";
import { prepareAider, validateAiderConfiguration } from "./aider-config";
import { childEnvironment } from "./harness-environment";
import { privateDirectory, switcherHome } from "./runtime";
import { authHeader } from "./auth";
import { validateGrokResume } from "./grok-args";
import { prepareClineLaunch } from "./cline-backend";
import { assertHarnessArguments } from "./harness-arguments";
import { isolateOpenCode2, openCode2ConfigText } from "./opencode2-config";
import { prepareOmpLaunch } from "./omp-backend";
import { dshArguments } from "./dsh-args";
import { prepareHermesLaunch } from "./hermes-backend";
import { harnessInstallation } from "./harness-installation";
import type { HarnessId, HarnessLaunchInput, PreparedLaunch } from "./harness-types";
const execute = promisify(execFile);
const KEY = "SWITCHER_HARNESS_API_KEY";
const quote = (value: unknown) => JSON.stringify(value);
export async function detectHarness(harness: HarnessId, override?: string) {
  const executable = override ?? Bun.which(harness) ?? harness;
  const installation = harnessInstallation(harness);
  try {
    const {stdout,stderr} = await execute(executable,["--version"],{timeout:8000,maxBuffer:65536,env:childEnvironment()});
    return {harness,executable,available:true,version:(stdout.trim()||stderr.trim()).slice(0,200),installation};
  } catch { return {harness,executable,available:false,version:undefined,installation}; }
}
export async function validateHarnessConfiguration(harness:HarnessId,cwd:string,args:readonly string[]=[]):Promise<void> {
  if(harness==="kilo") await validateKiloConfiguration(cwd,[...args]);
  if(harness==="aider")await validateAiderConfiguration(cwd,args);
  if(harness==="gemini") await validateGeminiConfiguration(cwd);
}
const versionAtLeast = (raw: string | undefined, minimum: number[]) => {
  const match = raw?.match(/(\d+)\.(\d+)\.(\d+)/);
  if(!match) return false;
  const actual=match.slice(1).map(Number);
  for(let i=0;i<3;i++){if(actual[i]>minimum[i])return true;if(actual[i]<minimum[i])return false;}return true;
};
export function validateHarnessVersion(harness: HarnessId, version: string | undefined): void {
  if(harness==="kilo"&&!versionAtLeast(version,[7,5,15])) throw new Error("Kilo >=7.5.15 is required by this scoped provider bridge.");
  if(harness==="omp"&&!versionAtLeast(version,[18,1,11])) throw new Error("OMP >=18.1.11 is required for the native catalog and persistent session adapter.");
  if(harness==="dsh"&&(!versionAtLeast(version,[0,1,2])||(/\b0\.1\.2-/.test(version??"")&&!/\b0\.1\.2-rc\.[1-9]\d*(?:\b|$)/.test(version??"")))) throw new Error("DeepSeek Harness (dsh) >=0.1.2-rc.1 is required for the native profile adapter.");
  if(harness==="aider"&&!/^(?:aider\s+)?0\.86\.2(?:\s|$)/i.test(version??""))throw new Error("Aider 0.86.2 is required by the verified native configuration adapter.");
  if(harness==="claude"&&!versionAtLeast(version,[2,1,242])) throw new Error("Claude Code >=2.1.242 is required for a full native modelPicker.");
  if(harness==="pi"&&!versionAtLeast(version,[0,85,1])) throw new Error("Pi >=0.85.1 is required by this catalog adapter.");
  if(harness==="codex"&&!versionAtLeast(version,[0,153,0])) throw new Error("Codex >=0.153.0 is required by this catalog adapter.");
  if(harness==="grok"&&!versionAtLeast(version,[1,0,13])) throw new Error("Grok Build >=1.0.13 is required by this remote catalog adapter.");
  if(harness==="cline"&&!versionAtLeast(version,[3,0,61])) throw new Error("Cline >=3.0.61 is required by this native provider adapter.");
  if(harness==="prime-agent"&&!versionAtLeast(version,[0,9,2])) throw new Error("Prime Agent >=0.9.2 is required by this catalog adapter.");
  if(harness==="opencode"&&!versionAtLeast(version,[1,18,0])) throw new Error("Legacy OpenCode >=1.18.0 is required by this catalog adapter.");
  if(harness==="opencode2") {
    const preview=version?.match(/opencode2.*beta-(\d+)/i);
    if(!(preview&&Number(preview[1])>=19157)&&!versionAtLeast(version,[2,0,0]))throw new Error("OpenCode 2 beta-19157 or newer is required for isolated provider configuration; legacy OpenCode is not supported by this adapter.");
  }
  if(harness==="hermes"&&!versionAtLeast(version,[0,21,0])) throw new Error("Hermes Agent >=0.21.0 is required by this provider and session adapter.");
  if(harness==="gemini"&&!/^0\.58\.0$/.test(version?.trim()??"")) throw new Error("Gemini CLI 0.58.0 is required by the verified native settings and argument contract.");
}
async function jsonFile(dir:string,name:string,value:unknown) {
  const path=join(dir,name);await writeFile(path,JSON.stringify(value,null,2)+"\n",{mode:0o600,flag:"wx"});return path;
}
async function projectInstructionPaths(cwd:string):Promise<string[]> {
  let dir=resolve(cwd);
  while(true) {
    for(const name of ["AGENTS.md","CLAUDE.md","CONTEXT.md"]) {
      const path=join(dir,name);
      if(await access(path).then(()=>true,()=>false)) return [path];
    }
    const parent=dirname(dir);
    if(parent===dir) return [];
    dir=parent;
  }
}
type ScopedOpenCodePolicy = {permission?:unknown};
type OpenCodePolicy = {permission?:unknown;tools?:Record<string,boolean>;agent?:Record<string,ScopedOpenCodePolicy>;mode?:Record<string,ScopedOpenCodePolicy>};
function policyRecord(value:unknown,path:string):Record<string,unknown>|undefined {
  if(value===undefined) return undefined;
  if(value===null||typeof value!=="object"||Array.isArray(value)) throw new Error(`OpenCode permission policy at ${path} must be an object.`);
  return value as Record<string,unknown>;
}
function policyValue(value:unknown,path:string):unknown {
  if(value===undefined) return undefined;
  if(typeof value==="string") {
    if(value!=="allow"&&value!=="ask"&&value!=="deny") throw new Error(`OpenCode permission policy at ${path} has an invalid action.`);
    return value;
  }
  return policyRecord(value,path);
}
function mergePolicy(target:Record<string,unknown>,source:Record<string,unknown>):Record<string,unknown> {
  const result={...target};
  for(const [key,value] of Object.entries(source)) {
    const previous=result[key];
    result[key]=previous&&typeof previous==="object"&&!Array.isArray(previous)&&value&&typeof value==="object"&&!Array.isArray(value)
      ? mergePolicy(previous as Record<string,unknown>,value as Record<string,unknown>) : value;
  }
  return result;
}
function mergePolicyValue(previous:unknown,next:unknown):unknown {
  if(previous===undefined) return next;
  if(next===undefined) return previous;
  if(previous&&typeof previous==="object"&&!Array.isArray(previous)&&next&&typeof next==="object"&&!Array.isArray(next))
    return mergePolicy(previous as Record<string,unknown>,next as Record<string,unknown>);
  return next;
}
function toolsPermission(value:unknown,path:string):Record<string,unknown>|undefined {
  const tools=policyRecord(value,path); if(tools===undefined) return undefined;
  const permission:Record<string,unknown>={};
  for(const [name,enabled] of Object.entries(tools)) {
    if(typeof enabled!=="boolean") throw new Error(`OpenCode tools policy at ${path}.${name} must be boolean.`);
    permission[name==="write"||name==="edit"||name==="patch"?"edit":name]=enabled?"allow":"deny";
  }
  return permission;
}
function expandHomePattern(value:unknown):unknown {
  if(typeof value!=="object"||value===null||Array.isArray(value)) return value;
  const record=value as Record<string,unknown>; const output:Record<string,unknown>={};
  for(const [key,item] of Object.entries(record)) {
    const expanded=key==="~"?homedir():key.startsWith("~/")?join(homedir(),key.slice(2)):key;
    output[expanded]=expandHomePattern(item);
  }
  return output;
}
function policyWithExpandedPatterns(value:unknown):unknown {
  if(typeof value!=="object"||value===null||Array.isArray(value)) return value;
  const record=value as Record<string,unknown>; const output:Record<string,unknown>={};
  for(const [key,item] of Object.entries(record)) output[key]=typeof item==="object"&&item!==null&&!Array.isArray(item)?expandHomePattern(item):item;
  return output;
}
function decodePolicy(text:string,file:string):OpenCodePolicy {
  let parsed:unknown;
  try { parsed=Bun.JSONC.parse(text); }
  catch(error) { throw new Error(`OpenCode permission policy could not be parsed safely: ${file}`,{cause:error}); }
  if(parsed===null||typeof parsed!=="object"||Array.isArray(parsed)) throw new Error(`OpenCode config at ${file} must be an object.`);
  const config=parsed as Record<string,unknown>;
  const permission=policyWithExpandedPatterns(policyValue(config.permission,`${file}:permission`));
  const toolsValue=policyRecord(config.tools,`${file}:tools`); const tools:Record<string,boolean>={};
  for(const [name,value] of Object.entries(toolsValue??{})) { if(typeof value!=="boolean") throw new Error(`OpenCode tools policy at ${file}:tools.${name} must be boolean.`); tools[name]=value; }
  const agentValue=policyRecord(config.agent,`${file}:agent`);
  const modeValue=policyRecord(config.mode,`${file}:mode`);
  const agent:OpenCodePolicy["agent"]={};
  for(const [name,value] of Object.entries(agentValue??{})) {
    const entry=policyRecord(value,`${file}:agent.${name}`);
    const entryPermission=policyWithExpandedPatterns(policyValue(entry?.permission,`${file}:agent.${name}.permission`));
    const entryTools=toolsPermission(entry?.tools,`${file}:agent.${name}.tools`);
    const merged=mergePolicyValue(entryTools,entryPermission);
    if(merged!==undefined) agent[name]={permission:merged};
  }
  const mode:OpenCodePolicy["mode"]={};
  for(const [name,value] of Object.entries(modeValue??{})) {
    const entry=policyRecord(value,`${file}:mode.${name}`);
    const entryPermission=policyWithExpandedPatterns(policyValue(entry?.permission,`${file}:mode.${name}.permission`));
    const entryTools=toolsPermission(entry?.tools,`${file}:mode.${name}.tools`);
    const merged=mergePolicyValue(entryTools,entryPermission);
    if(merged!==undefined) mode[name]={permission:merged};
  }
  return { ...(permission!==undefined?{permission}:{}), ...(Object.keys(tools).length?{tools}:{}), ...(Object.keys(agent).length?{agent}:{}), ...(Object.keys(mode).length?{mode}: {}) };
}
async function readPolicyFile(file:string):Promise<OpenCodePolicy|undefined> {
  let text:string;
  try { text=await readFile(file,"utf8"); }
  catch(error) {
    if((error as NodeJS.ErrnoException).code==="ENOENT") return undefined;
    throw error;
  }
  return decodePolicy(text,file);
}
async function agentPolicyFiles(dir:string,kind:"agent"|"mode"):Promise<Array<{file:string;root:string}>> {
  const result:Array<{file:string;root:string}>=[];
  const visit=async(current:string,root:string):Promise<void>=>{
    let entries;
    try { entries=await readdir(current,{withFileTypes:true}); }
    catch(error) { if((error as NodeJS.ErrnoException).code==="ENOENT") return; throw error; }
    for(const entry of entries) {
      const file=join(current,entry.name);
      if(entry.isDirectory()) await visit(file,root);
      else if(entry.isFile()&&entry.name.endsWith(".md")) result.push({file,root});
    }
  };
  for(const rootName of [kind,`${kind}s`]) await visit(join(dir,rootName),join(dir,rootName));
  return result.sort((a,b)=>a.file.localeCompare(b.file));
}
async function readAgentPolicyFile(file:string,kind:"agent"|"mode",root:string):Promise<{name:string;permission:unknown}|undefined> {
  const text=await readFile(file,"utf8");
  const match=text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if(!match) return undefined;
  let parsed:unknown;
  try { parsed=Bun.YAML.parse(match[1]); }
  catch(error) { throw new Error(`OpenCode ${kind} policy could not be parsed safely: ${file}`,{cause:error}); }
  const frontmatter=policyRecord(parsed,`${file}:frontmatter`);
  const permission=policyWithExpandedPatterns(policyValue(frontmatter?.permission,`${file}:permission`));
  const toolPermission=toolsPermission(frontmatter?.tools,`${file}:tools`);
  const merged=mergePolicyValue(toolPermission,permission);
  if(merged===undefined) return undefined;
  const relative=file.slice(root.length+1).replaceAll("\\","/").replace(/\.md$/i,"");
  return {name:relative||basename(file,".md"),permission:merged};
}
async function preservedOpenCodePolicy(cwd:string):Promise<{permission?:unknown;tools?:Record<string,boolean>;agent?:Record<string,{permission:unknown}>;mode?:Record<string,{permission:unknown}>}> {
  const result:{permission?:unknown;tools?:Record<string,boolean>;agent?:Record<string,{permission:unknown}>;mode?:Record<string,{permission:unknown}>}={};
  const applyLayer=(layer:OpenCodePolicy)=>{
    if(layer.permission!==undefined) result.permission=mergePolicyValue(result.permission,layer.permission);
    if(layer.tools) result.tools={...(result.tools??{}),...layer.tools};
    for(const [name,value] of Object.entries(layer.agent??{})) if(value.permission!==undefined)
      result.agent={...(result.agent??{}),[name]:{permission:mergePolicyValue(result.agent?.[name]?.permission,value.permission)}};
    for(const [name,value] of Object.entries(layer.mode??{})) if(value.permission!==undefined)
      result.mode={...(result.mode??{}),[name]:{permission:mergePolicyValue(result.mode?.[name]?.permission,value.permission)}};
  };
  const apply=async(file:string)=>{const layer=await readPolicyFile(file);if(layer)applyLayer(layer);};
  const applyText=(text:string,source:string)=>applyLayer(decodePolicy(text,source));
  const applyMarkdown=async(dir:string,kind:"agent"|"mode")=>{
    for(const entry of await agentPolicyFiles(dir,kind)) {
      const policy=await readAgentPolicyFile(entry.file,kind,entry.root); if(!policy) continue;
      const target=kind==="agent"?result.agent:result.mode;
      const merged=mergePolicyValue(target?.[policy.name]?.permission,policy.permission);
      if(kind==="agent") result.agent={...(result.agent??{}),[policy.name]:{permission:merged}};
      else result.mode={...(result.mode??{}),[policy.name]:{permission:merged}};
    }
  };
  const originalConfig=join(process.env.XDG_CONFIG_HOME??join(homedir(),".config"),"opencode");
  for(const name of ["config.json","opencode.json","opencode.jsonc"]) await apply(join(originalConfig,name));
  await applyMarkdown(originalConfig,"agent"); await applyMarkdown(originalConfig,"mode");
  if(process.env.OPENCODE_CONFIG) await apply(resolve(cwd,process.env.OPENCODE_CONFIG));
  const dirs:string[]=[]; let dir=resolve(cwd);
  while(true){dirs.push(dir);const parent=dirname(dir);if(parent===dir)break;dir=parent;}
  for(const current of [...dirs].reverse()) for(const name of ["opencode.jsonc","opencode.json"]) await apply(join(current,name));
  for(const current of dirs) {
    const configDir=join(current,".opencode");
    for(const name of ["opencode.json","opencode.jsonc"]) await apply(join(configDir,name));
    await applyMarkdown(configDir,"agent"); await applyMarkdown(configDir,"mode");
  }
  const homeConfig=join(homedir(),".opencode");
  for(const name of ["opencode.json","opencode.jsonc"]) await apply(join(homeConfig,name));
  await applyMarkdown(homeConfig,"agent"); await applyMarkdown(homeConfig,"mode");
  if(process.env.OPENCODE_CONFIG_DIR) {
    for(const name of ["opencode.json","opencode.jsonc"]) await apply(join(process.env.OPENCODE_CONFIG_DIR,name));
    await applyMarkdown(process.env.OPENCODE_CONFIG_DIR,"agent"); await applyMarkdown(process.env.OPENCODE_CONFIG_DIR,"mode");
  }
  if(process.env.OPENCODE_CONFIG_CONTENT) applyText(process.env.OPENCODE_CONFIG_CONTENT,"OPENCODE_CONFIG_CONTENT");
  if(process.env.OPENCODE_PERMISSION) {
    let permission:unknown;
    try { permission=JSON.parse(process.env.OPENCODE_PERMISSION); }
    catch(error) { throw new Error("OpenCode permission policy could not be parsed safely: OPENCODE_PERMISSION",{cause:error}); }
    const value=policyWithExpandedPatterns(policyValue(permission,"OPENCODE_PERMISSION"));
    applyLayer({permission:value});
  }
  if(result.tools) result.permission=mergePolicyValue(toolsPermission(result.tools,"OpenCode tools policy"),result.permission);
  return result;
}
export function codexModel(model: HarnessLaunchInput["models"][number], priority:number) {
  // Conservative wire/tool choices; no invented reasoning levels or model-specific policies.
  return {
    slug:model.id,display_name:model.name,description:model.description??model.id,
    shell_type:"shell_command",visibility:"list",supported_in_api:true,priority,
    supported_reasoning_levels:[],default_reasoning_level:null,
    support_verbosity:false,supports_reasoning_summary_parameter:false,default_verbosity:null,
    supports_parallel_tool_calls:false,apply_patch_tool_type:null,
    truncation_policy:{mode:"tokens",limit:10000},experimental_supported_tools:[],
    context_window:model.contextWindow??null,max_context_window:model.contextWindow??null,
    input_modalities:(model.inputModalities??["text"]).filter(m=>m==="text"||m==="image"),
    prefer_websockets:false,use_responses_lite:false,
    model_messages:{instructions_template:"You are Codex, a coding assistant. Help the user with their requested work. Follow the user and developer instructions, use the available tools when appropriate, preserve unrelated changes, and report actual results and remaining limitations.",instructions_variables:null},
  };
}
// Grok's environment config overlay deliberately forbids provider definitions.
// Its supported remote catalog seam accepts backend metadata. A task-local
// authenticated bridge supplies that catalog and forwards the selected protocol
// unchanged, keeping provider keys out of Grok's persistent model cache.
function grokBridge(input: HarnessLaunchInput) {
  const token=crypto.randomUUID()+crypto.randomUUID();const expected=createHash("sha256").update(`Bearer ${token}`).digest();
  const models=new Map(input.models.flatMap(m=>[[m.id,m.id],[grokAlias(input,m.id),m.id]]));
  let server: ReturnType<typeof Bun.serve>;
  let closing=false;
  let stopped:Promise<void>|undefined;
  const active=new Set<{abort:AbortController;done:Promise<void>;cancel?:()=>Promise<void>}>();
  const apiBackend={"anthropic-messages":"messages","openai-responses":"responses","openai-chat":"chat_completions","gemini-generate-content":"generate_content"}[input.protocol];
  const apiPath={"anthropic-messages":"/messages","openai-responses":"/responses","openai-chat":"/chat/completions","gemini-generate-content":"/generateContent"}[input.protocol];
  server=Bun.serve({hostname:"127.0.0.1",port:0,maxRequestBodySize:4*1024*1024,idleTimeout:255,async fetch(request){
    if(closing)return Response.json({error:{message:"Bridge is closing"}},{status:503});
    const auth=request.headers.get("authorization")??(request.headers.has("x-api-key")?`Bearer ${request.headers.get("x-api-key")}`:"");
    if(!timingSafeEqual(expected,createHash("sha256").update(auth).digest())) return Response.json({error:{message:"Unauthorized"}},{status:401});
    const path=new URL(request.url).pathname;
    // This describes only the authenticated, short-lived bridge credential.
    // The upstream provider still authorizes every inference request itself.
    if(request.method==="GET"&&path==="/v1/api-key") return Response.json({api_key_blocked:false,api_key_disabled:false,team_blocked:false});
    if(request.method==="GET"&&path==="/v1/models") return Response.json({data:input.models.map(m=>({
      id:grokAlias(input,m.id),model:m.id,name:m.name,description:m.description,base_url:new URL("v1",server.url).href,
      context_window:m.contextWindow,max_completion_tokens:m.maxOutputTokens,
      api_backend:apiBackend,env_key:KEY,
    }))});
    if(request.method!=="POST"||path!==`/v1${apiPath}`) return Response.json({error:{message:"Unsupported route"}},{status:404});
    let body: any;try{body=await request.json();}catch{return Response.json({error:{message:"Invalid JSON"}},{status:400});}
    if(!models.has(body.model)) return Response.json({error:{message:"Model is outside this launch catalog"}},{status:403});
    body.model=models.get(body.model);
    const headers:Record<string,string>={"content-type":"application/json"};
    if(input.credential) {const [header,value]=authHeader(input.authStyle??"bearer",input.credential);headers[header]=value;}
    if(input.protocol==="anthropic-messages") {
      headers["anthropic-version"]=request.headers.get("anthropic-version")??"2023-06-01";
      if(request.headers.has("anthropic-beta")) headers["anthropic-beta"]=request.headers.get("anthropic-beta")!;
    }
    if(closing)return Response.json({error:{message:"Bridge is closing"}},{status:503});
    let complete!:()=>void;
    const record:{abort:AbortController;done:Promise<void>;cancel?:()=>Promise<void>}={abort:new AbortController(),done:new Promise<void>(resolve=>{complete=resolve;})};
    const release=()=>{active.delete(record);complete();};
    active.add(record);
    try {
      const response=await fetch(`${input.baseUrl}${apiPath}`,{method:"POST",headers,body:JSON.stringify(body),redirect:"manual",signal:AbortSignal.any([record.abort.signal,request.signal,AbortSignal.timeout(240000)])});
      if(!response.ok){await response.body?.cancel();release();return Response.json({error:{message:`Provider returned HTTP ${response.status}`}},{status:response.status>=300&&response.status<400?502:response.status});}
      if(!response.body){release();return new Response(null,{status:response.status});}
      const reader=response.body.getReader();
      let ended=false;
      let output:ReadableStreamDefaultController<Uint8Array>;
      const end=(error?:Error)=>{
        if(ended)return;ended=true;
        try{if(error&&!closing)output.error(error);else output.close();}catch{}
        release();
      };
      const stream=new ReadableStream<Uint8Array>({
        start(controller){output=controller;},
        async pull(controller){
          try{const chunk=await reader.read();if(ended)return;if(chunk.done)end();else controller.enqueue(chunk.value);}
          catch{end(new Error("Provider stream ended unexpectedly"));}
        },
        async cancel(){
          ended=true;record.abort.abort();
          try{await reader.cancel();}finally{release();}
        },
      });
      record.cancel=async()=>{
        record.abort.abort();
        try{await reader.cancel();}catch{}finally{end();}
      };
      return new Response(stream,{status:response.status,headers:{"content-type":response.headers.get("content-type")??"application/json","cache-control":"no-store"}});
    }catch{release();return Response.json({error:{message:"Provider request failed"}},{status:502});}
  }});
  return {baseUrl:new URL("v1",server.url).href,token,cleanup:()=>stopped??=(async()=>{
    closing=true;
    // Close our forwarding streams before stopping the listener. Bun 1.3.14
    // can leave stop(true) pending if it destroys an unfinished proxied SSE
    // response while that response still owns an upstream reader.
    const pending=[...active];
    for(const record of pending)record.abort.abort();
    await Promise.allSettled(pending.map(async record=>{await record.cancel?.();await record.done;}));
    await server.stop(true);
  })()};
}
function grokAlias(input: HarnessLaunchInput, model: string) {
  return "switcher-" + createHash("sha256").update(JSON.stringify([input.baseUrl,input.protocol])).digest("hex").slice(0,12) + "/" + model;
}
function piProviderId(input: HarnessLaunchInput, providerBaseUrl: string) {
  return "switcher-" + createHash("sha256").update(JSON.stringify([endpoint(providerBaseUrl),input.protocol])).digest("hex").slice(0,12);
}
function piModel(input: HarnessLaunchInput, api: string) {
  return input.models.map(model=>({
    id:model.id,
    name:model.name,
    api,
    ...(model.contextWindow?{contextWindow:model.contextWindow}:{}),
    ...(model.maxOutputTokens?{maxTokens:model.maxOutputTokens}:{}),
    input:(model.inputModalities??["text"]).filter(modality=>modality==="text"||modality==="image").length>0
      ? (model.inputModalities??["text"]).filter(modality=>modality==="text"||modality==="image") : ["text"],
    ...(model.supportedParameters?.includes("reasoning")?{reasoning:true}:{}),
  }));
}
function primeProviderId(input: HarnessLaunchInput, providerBaseUrl: string) {
  return "switcher-" + createHash("sha256").update(JSON.stringify([endpoint(providerBaseUrl),input.protocol])).digest("hex").slice(0,12);
}
const PRIME_UNIX_SOCKET_LIMIT = 100;
const PRIME_DAEMON_STARTUP_TIMEOUT_MS = 30000;
const PRIME_DAEMON_SHUTDOWN_TIMEOUT_MS = 5000;

function primeSocketPaths(runtimeDir:string) {
  const basename=`p-${randomUUID().replaceAll("-","").slice(0,8)}.sock`;
  const daemonSocket=join(runtimeDir,basename);
  const uid=typeof process.getuid === "function" ? String(process.getuid()) : "user";
  const workerDir=join(runtimeDir,`prime-agent-${uid}`);
  const workerKey=createHash("sha256").update(daemonSocket).digest("hex").slice(0,12);
  const workerSocket=join(workerDir,`worker-${workerKey}-${"x".repeat(12)}.sock`);
  const overlong=[daemonSocket,workerSocket].find(path=>Buffer.byteLength(path,"utf8")>PRIME_UNIX_SOCKET_LIMIT);
  return {daemonSocket,runtimeDir,workerDir,workerPrefix:join(workerDir,`worker-${workerKey}-`),overlong};
}
async function primeSocketInfo() {
  // Unix-domain sockets have a small path limit. Keep the durable session
  // directory separate while giving each launch its own daemon in the OS
  // runtime directory, so one launch's cleanup cannot stop another launch.
  const requested=tmpdir();
  const direct=primeSocketPaths(requested);
  if(!direct.overlong) return direct;
  // Some macOS TMPDIR values are long enough for the supervisor socket but
  // too long once Prime derives its worker socket. Use a private, operator
  // owned directory under Switcher's canonical home in that case. Never
  // silently fall back to a shared system directory.
  const fallback=join(switcherHome(),"r");
  await privateDirectory(switcherHome());
  await privateDirectory(fallback);
  const scoped=primeSocketPaths(fallback);
  if(scoped.overlong) {
    throw new Error(`Prime Agent native socket path exceeds the ${PRIME_UNIX_SOCKET_LIMIT}-byte Unix limit even under Switcher runtime ${fallback} (${scoped.overlong}); choose a shorter private HASNA_SWITCHER_HOME.`);
  }
  return scoped;
}

type PrimeSupervisor = ReturnType<typeof Bun.spawn>;
function primeSignalSupervisor(supervisor:PrimeSupervisor,signal:NodeJS.Signals) {
  // Detached Bun children do not consistently expose a process group whose
  // ID equals the returned PID on every supported platform. Signal both the
  // owned group and the owned handle; the latter is the safe fallback when
  // group delivery reports success but reaches no child.
  try { process.kill(-supervisor.pid,signal); } catch(error) {
    if((error as NodeJS.ErrnoException).code!=="ESRCH") { /* direct handle below */ }
  }
  try { supervisor.kill(signal); } catch {}
}
async function primeReadinessProbe(socketPath:string):Promise<void> {
  await new Promise<void>((resolve,reject)=>{
    const socket=createConnection(socketPath); let settled=false; let buffer="";
    const finish=(error?:Error)=>{if(settled)return;settled=true;socket.removeAllListeners();socket.destroy();error?reject(error):resolve();};
    const timer=setTimeout(()=>finish(new Error("Prime Agent daemon hello timed out.")),500);
    const onLine=(line:string)=>{try {const value=JSON.parse(line) as {type?:string};if(value.type==="daemon_hello"){clearTimeout(timer);finish();}}catch{clearTimeout(timer);finish(new Error("Prime Agent daemon returned invalid hello JSON."));}};
    socket.on("data",chunk=>{buffer+=chunk.toString("utf8");let newline=buffer.indexOf("\n");while(newline>=0){const line=buffer.slice(0,newline).trim();buffer=buffer.slice(newline+1);if(line)onLine(line);newline=buffer.indexOf("\n");}});
    socket.once("error",error=>{clearTimeout(timer);finish(error instanceof Error?error:new Error(String(error)));});
    socket.once("timeout",()=>{clearTimeout(timer);finish(new Error("Prime Agent daemon hello timed out."));});
    socket.setTimeout(500);
  });
}
async function primeStartSupervisor(input:HarnessLaunchInput,executable:string,socketPath:string,env:Record<string,string>,onSpawn:(supervisor:PrimeSupervisor)=>void):Promise<PrimeSupervisor> {
  const supervisor=Bun.spawn([executable,"--mode","daemon","--daemon-socket",socketPath],{cwd:input.cwd,env:{...childEnvironment(),...env},stdin:"ignore",stdout:"ignore",stderr:"ignore",detached:true});
  onSpawn(supervisor);
  let exited=false; void supervisor.exited.then(()=>{exited=true;});
  const deadline=Date.now()+PRIME_DAEMON_STARTUP_TIMEOUT_MS;
  try {
    while(Date.now()<deadline) {
      if(exited) throw new Error("Prime Agent daemon exited before its owned hello handshake.");
      try { await primeReadinessProbe(socketPath); return supervisor; } catch {}
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    throw new Error(`Prime Agent daemon did not become ready within ${PRIME_DAEMON_STARTUP_TIMEOUT_MS/1000} seconds.`);
  } catch(error) {
    primeSignalSupervisor(supervisor,"SIGTERM");
    await Promise.race([supervisor.exited,new Promise(resolve=>setTimeout(resolve,1000))]);
    if(!exited) primeSignalSupervisor(supervisor,"SIGKILL");
    throw error;
  }
}
async function primeOwnedShutdown(socketPath:string,workerPrefix:string):Promise<void> {
  const exists=()=>access(socketPath).then(()=>true,()=>false);
  const workerEntries=()=>readdir(workerPrefix.slice(0,workerPrefix.lastIndexOf("/"))).then(entries=>entries.filter(entry=>entry.startsWith(workerPrefix.slice(workerPrefix.lastIndexOf("/")+1))),()=>[] as string[]);
  // The foreground supervisor is started by beforeLaunch and must already
  // have completed its hello handshake before the native client runs.
  if(!(await exists())) throw new Error(`Prime Agent owned daemon socket disappeared before cleanup (${socketPath}).`);
  let responseSeen=false;
  const requestId=`switcher_${randomUUID()}`;
  let requestSent=false;
  await new Promise<void>((resolve,reject)=>{
    const socket=createConnection(socketPath);
    let settled=false;
    let buffer="";
    let timeout:ReturnType<typeof setTimeout>|undefined;
    const finish=(error?:Error)=>{
      if(settled)return;
      settled=true;if(timeout)clearTimeout(timeout);socket.removeAllListeners();socket.destroy();
      if(error)reject(error);else resolve();
    };
    timeout=setTimeout(()=>finish(new Error(`Timed out shutting down the Prime Agent daemon on ${socketPath}.`)),3000);
    const onLine=(line:string)=>{
      try {
        const value=JSON.parse(line) as {type?:string;success?:boolean;error?:string};
        if(value.type==="daemon_hello" && !requestSent) {
          requestSent=true;
          socket.write(JSON.stringify({type:"command",id:requestId,protocol:{name:"prime-agent.daemon",version:7},clientId:requestId,command:{id:requestId,type:"shutdown",force:true}})+"\n");
        } else if(value.type==="response") {
          responseSeen=true;
          clearTimeout(timeout);
          if(value.success===false) finish(new Error(value.error??"Prime Agent daemon rejected shutdown."));
          else finish();
        }
      } catch { finish(new Error("Prime Agent daemon returned an invalid shutdown response.")); }
    };
    socket.on("data",chunk=>{
      buffer+=chunk.toString("utf8");
      let newline=buffer.indexOf("\n");
      while(newline>=0){const line=buffer.slice(0,newline).trim();buffer=buffer.slice(newline+1);if(line)onLine(line);newline=buffer.indexOf("\n");}
    });
    socket.once("error",error=>finish(error instanceof Error?error:new Error(String(error))));
    socket.once("close",()=>{if(!responseSeen)finish(new Error("Prime Agent daemon closed before acknowledging shutdown."));});
    socket.once("connect",()=>undefined);
  });
  const deadline=Date.now()+PRIME_DAEMON_SHUTDOWN_TIMEOUT_MS;
  while(Date.now()<deadline){
    const [daemonExists,workers]=await Promise.all([exists(),workerEntries()]);
    if(!daemonExists&&!workers.length)return;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error(responseSeen?`Prime Agent owned daemon or worker sockets remained after shutdown (${socketPath}).`:`Prime Agent daemon did not acknowledge owned shutdown and remained reachable (${socketPath}).`);
}
async function primeWaitExit(supervisor:PrimeSupervisor,timeout:number):Promise<boolean> {
  return await Promise.race([supervisor.exited.then(()=>true),new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),timeout))]);
}
async function primeRemainingSockets(socketPath:string,workerPrefix:string):Promise<string[]> {
  const daemon=await access(socketPath).then(()=>true,()=>false);
  const workerDir=workerPrefix.slice(0,workerPrefix.lastIndexOf("/"));
  const prefix=workerPrefix.slice(workerPrefix.lastIndexOf("/")+1);
  const workers=await readdir(workerDir).then(entries=>entries.filter(entry=>entry.startsWith(prefix)),()=>[] as string[]);
  return [...(daemon?[socketPath]:[]),...workers.map(entry=>join(workerDir,entry))];
}
function primeModel(input: HarnessLaunchInput, api: string) {
  return input.models.map(model => ({
    id:model.id,
    ...(model.name ? {name:model.name} : {}),
    api,
    reasoning:model.supportedParameters?.includes("reasoning") ?? false,
    input:(model.inputModalities ?? ["text"]).filter(modality=>modality==="text"||modality==="image").length>0
      ? (model.inputModalities ?? ["text"]).filter(modality=>modality==="text"||modality==="image") : ["text"],
    ...(model.contextWindow ? {contextWindow:model.contextWindow} : {}),
    ...(model.maxOutputTokens ? {maxTokens:model.maxOutputTokens} : {}),
  }));
}
async function prepareNativeLaunch(input: HarnessLaunchInput, providerBaseUrl = input.baseUrl): Promise<PreparedLaunch> {
  input={...input,baseUrl:endpoint(input.baseUrl)};
  if(!compatible(input.harness,input.protocol)) throw new Error("Harness and provider protocol are incompatible.");
  validateHarnessVersion(input.harness,input.version);
  if(!isAbsolute(input.stateDir)||!isAbsolute(input.cwd)) throw new Error("Launch state and working directories must be absolute.");
  if(!input.models.length||!input.models.some(m=>m.id===input.model)) throw new Error("Selected model is missing from the launch catalog.");
  if(input.models.some(m=>!harnessEligible(m,input.harness))) throw new Error("Launch catalog contains a model explicitly ineligible for coding.");
  if(input.credential&&/[\r\n]/.test(input.credential)) throw new Error("Provider credential contains invalid header characters.");
  await mkdir(input.stateDir,{recursive:true,mode:0o700});
  const args=[...(input.args??[])];const env:Record<string,string>={};
  const warnings:string[]=[];const configPaths:string[]=[];
  const executable=input.executable??input.harness;
  const missing=input.models.filter(m=>!m.contextWindow).length;
  if(missing) warnings.push(`${missing} catalog models have no declared context limit; native fallback limits may be inaccurate.`);
  if(input.harness==="gemini") return prepareGemini(input);
  if(input.protocol==="gemini-generate-content") throw new Error("Harness and provider protocol are incompatible.");
  if(input.harness==="aider")return prepareAider(input);
  if(input.harness==="claude") {
    env.ANTHROPIC_BASE_URL=input.baseUrl.replace(/\/v1$/,"");
    env.ANTHROPIC_MODEL=input.model;
    // The native Default picker row has separate precedence from --model.
    // Keep it and unassigned subagents on the selected provider model.
    env.ANTHROPIC_DEFAULT_MODEL=input.model;
    env.CLAUDE_CODE_SUBAGENT_MODEL=input.model;
    env[input.authStyle==="x-api-key"?"ANTHROPIC_API_KEY":"ANTHROPIC_AUTH_TOKEN"]=input.credential??"switcher-local-no-auth";
    const file=await jsonFile(input.stateDir,"claude-settings.json",{modelPicker:{replaceBuiltInOptions:true,options:input.models.map(m=>({model:m.id,label:m.name,description:m.description?.slice(0,300)}))}});
    configPaths.push(file);
    warnings.push("Claude managed settings and model allowlists can restrict the generated picker.");
    return {executable,args:["--settings",file,"--model",input.model,...args],env,configPaths,warnings};
  }
  if(input.harness==="codex") {
    const file=await jsonFile(input.stateDir,"codex-models.json",{models:input.models.map(codexModel)});
    configPaths.push(file);
    env[KEY]=input.credential??"switcher-local-no-auth";
    const provider:Record<string,unknown>={name:"Switcher",base_url:input.baseUrl,wire_api:"responses",requires_openai_auth:false};
    {
      if(input.authStyle==="x-api-key"||input.authStyle==="api-key") provider.env_http_headers={[input.authStyle]:KEY};
      else provider.env_key=KEY;
    }
    const toml=Object.entries(provider).map(([k,v])=>`${k} = ${typeof v==="object"?"{ "+Object.entries(v as object).map(([key,value])=>`${quote(key)} = ${quote(value)}`).join(", ")+" }":quote(v)}`).join(", ");
    const overrides=["-c",`model_provider="switcher"`,"-c",`model_providers.switcher={ ${toml} }`,"-c",`model_catalog_json=${quote(file)}`,"-c",`model=${quote(input.model)}`];
    warnings.push("Codex catalog uses conservative generic tool metadata and a model-neutral coding prompt; provider-specific reasoning is not advertised.");
    return {executable,args:[...overrides,...args],env,configPaths,warnings};
  }
  if(input.harness==="grok") {
    validateGrokResume(args);
    const file=await jsonFile(input.stateDir,"grok-overlay.json",{models:{default:grokAlias(input,input.model),session_summary:grokAlias(input,input.model),allowed_models:input.models.map(m=>grokAlias(input,m.id))}});
    configPaths.push(file);
    const bridge=grokBridge(input);
    env.GROK_MODELS_BASE_URL=bridge.baseUrl;env.GROK_MODELS_LIST_URL=bridge.baseUrl+"/models";
    env.GROK_XAI_API_BASE_URL=bridge.baseUrl;
    env.XAI_API_KEY=bridge.token;env[KEY]=bridge.token;
    env.GROK_CONFIG_PATH=file;
    warnings.push("Grok uses a per-launch loopback catalog/auth bridge; native managed model policies still apply.");
    // A leader keeps its original backend configuration; a new profile must
    // own a standalone backend and its current short-lived bridge credentials.
    return {executable,args:["--model",grokAlias(input,input.model),"--no-leader",...args],env,configPaths,warnings,cleanup:bridge.cleanup};
  }
  if(input.harness==="pi") {
    if(input.authStyle==="x-api-key"&&input.protocol!=="anthropic-messages") throw new Error("Pi can use x-api-key authentication only with the Anthropic Messages protocol.");
    if(new Set(input.models.map(model=>model.id.toLowerCase())).size!==input.models.length)
      throw new Error("Pi cannot safely select model IDs that differ only by letter case; update the provider catalog.");
    const api={"anthropic-messages":"anthropic-messages","openai-responses":"openai-responses","openai-chat":"openai-completions","gemini-generate-content":"gemini"}[input.protocol];
    const providerId=piProviderId(input,providerBaseUrl);
    const agentDir=join(input.stateDir,"pi-agent");
    const sessionDir=input.sessionDir??join(input.stateDir,"sessions");
    // Pi's Anthropic client appends /v1/messages to baseUrl. Switcher provider
    // URLs conventionally include the /v1 prefix, so keep deployment prefixes
    // while removing only that terminal protocol segment.
    const piBaseUrl=input.protocol==="anthropic-messages"?input.baseUrl.replace(/\/v1$/i,""):input.baseUrl;
    await mkdir(agentDir,{recursive:true,mode:0o700});
    await mkdir(sessionDir,{recursive:true,mode:0o700});
    const file=await jsonFile(agentDir,"models.json",{providers:{[providerId]:{
      name:"Switcher",
      baseUrl:piBaseUrl,
      api,
      apiKey:`$${KEY}`,
      models:piModel(input,api),
    }}});
    configPaths.push(file);
    env.PI_CODING_AGENT_DIR=agentDir;
    env.PI_CODING_AGENT_SESSION_DIR=sessionDir;
    env[KEY]=input.credential??"switcher-local-no-auth";
    warnings.push("Pi uses an isolated per-launch catalog and keeps sessions under Switcher state. Global settings, keybindings, extensions, themes and skills are not loaded; changes to this temporary agent configuration are removed at exit. Project customization remains native.");
    warnings.push("Pi scopes its picker and model cycling to this provider; its --list-models diagnostic still enumerates global model definitions.");
    return {executable,args:["--provider",providerId,"--model",input.model,"--models",`${providerId}/**`,...args],env,configPaths,warnings};
  }
  if(input.harness==="omp") return prepareOmpLaunch(input);
  if(input.harness==="dsh") {
    const selected=dshArguments(args);
    const providerId=piProviderId(input,providerBaseUrl);
    const api={"anthropic-messages":"anthropic-messages","openai-responses":"openai-responses","openai-chat":"openai-completions"}[input.protocol];
    const home=join(input.stateDir,"dsh-home");
    const sessionDir=input.sessionDir??join(input.stateDir,"dsh-state");
    if(!isAbsolute(sessionDir)) throw new Error("DSH session directory must be absolute.");
    await mkdir(home,{recursive:true,mode:0o700});
    await mkdir(sessionDir,{recursive:true,mode:0o700});
    const route={provider:providerId,model:input.model};
    const overlay:unknown[]=[
      {id:"llm-deepseek",disabled:true},
      {id:"llm-pi-ai",config:{providers:{[providerId]:{
        displayName:"Switcher",api,apiKeyEnv:KEY,
        baseURL:input.protocol==="anthropic-messages"?input.baseUrl.replace(/\/v1$/i,""):input.baseUrl,
        models:input.models.map(model=>({id:model.id,name:model.name,
          ...(model.contextWindow?{contextWindow:model.contextWindow}:{}),
          ...(model.maxOutputTokens?{maxTokens:model.maxOutputTokens}:{}),
          input:(model.inputModalities??["text"]).filter(modality=>modality==="text"||modality==="image"),
        })),
      }}}},
      {id:"agent-default-model",config:route},
      {id:"session-persistence-jsonl",config:{root:join(sessionDir,"sessions")}},
      {id:"attachment-local",config:{dshHome:sessionDir}},
      ...(selected.profile==="acp"?[{id:"acp",config:route}]:[]),
    ];
    const file=await jsonFile(input.stateDir,"dsh-patch.json",overlay);configPaths.push(file);
    env.DSH_HOME=home;env[KEY]=input.credential??"switcher-local-no-auth";
    warnings.push("DeepSeek Harness uses an isolated temporary home and its native pi-ai provider adapter. Global profiles, settings, plugins and saved credentials are not loaded; sessions and attachments persist under Switcher state per profile. Native project customization remains active.");
    if(selected.profile==="web") warnings.push("DSH opens its native browser UI on an allocated loopback port; use -- --no-open to print the URL without opening a browser.");
    if(selected.profile==="headless") warnings.push("DSH headless runs one fresh task; resume is available through the native web UI or ACP session/resume.");
    return {executable,args:["--profile",selected.profile,"--patch",file,...selected.args],env,configPaths,warnings};
  }
  if(input.harness==="cline") return prepareClineLaunch(input);
  if(input.harness==="hermes") return prepareHermesLaunch(input);
  if(input.harness==="prime-agent") {
    if(input.authStyle==="x-api-key"&&input.protocol!=="anthropic-messages") throw new Error("Prime Agent can use x-api-key authentication only with the Anthropic Messages protocol.");
    if(new Set(input.models.map(model=>model.id.toLowerCase())).size!==input.models.length)
      throw new Error("Prime Agent cannot safely select model IDs that differ only by letter case; update the provider catalog.");
    const api={"anthropic-messages":"anthropic-messages","openai-responses":"openai-responses","openai-chat":"openai-completions"}[input.protocol];
    const providerId=primeProviderId(input,providerBaseUrl);
    const sessionDir=input.sessionDir??join(input.stateDir,"sessions");
    // Keep the native config and daemon metadata under this launch's private
    // state directory; the launcher removes it after shutdown. Prime's
    // session directory remains durable so a later --continue launch can
    // restore history while receiving a fresh catalog and bridge.
    const agentDir=join(input.stateDir,"prime-agent");
    const socketInfo=await primeSocketInfo();
    const {daemonSocket,runtimeDir,workerPrefix}=socketInfo;
    const primeBaseUrl=input.protocol==="anthropic-messages"?input.baseUrl.replace(/\/v1$/i,""):input.baseUrl;
    await mkdir(agentDir,{recursive:true,mode:0o700});
    await mkdir(sessionDir,{recursive:true,mode:0o700});
    const file=join(agentDir,"models.json");
    await writeFile(file,JSON.stringify({providers:{[providerId]:{
      name:"Switcher",baseUrl:primeBaseUrl,api,apiKey:KEY,
      models:primeModel(input,api),
    }}},null,2)+"\n",{mode:0o600,flag:"w"});
    configPaths.push(file);
    env.PRIME_AGENT_CODING_AGENT_DIR=agentDir;
    env.PRIME_AGENT_SESSION_DIR=sessionDir;
    env[KEY]=input.credential??"switcher-local-no-auth";
    warnings.push("Prime Agent uses an isolated per-launch models.json catalog and session directory; built-in provider configuration and credential stores are not inherited.");
    warnings.push("Prime Agent's model list diagnostic still includes built-in providers; the launch model and scoped picker are restricted to the Switcher provider.");
    env.TMPDIR=runtimeDir;
    const executable=input.executable??input.harness;
    let supervisor:PrimeSupervisor|undefined;
    let starting:Promise<PrimeSupervisor>|undefined;
    let ready=false;
    const beforeLaunch=async()=>{
      if(ready)return;
      starting ??= primeStartSupervisor(input,executable,daemonSocket,env,child=>{supervisor=child});
      supervisor=await starting;
      ready=true;
    };
    let cleaned=false;
    const cleanup=async()=>{
      if(cleaned)return; cleaned=true;
      if(starting&&!ready&&supervisor) primeSignalSupervisor(supervisor,"SIGTERM");
      if(starting&&!ready) { try { await starting; } catch { return; } }
      if(!supervisor)return;
      let failure:Error|undefined;
      try { await primeOwnedShutdown(daemonSocket,workerPrefix); }
      catch(error) { failure=error instanceof Error?error:new Error(String(error)); }
      if(!await primeWaitExit(supervisor,PRIME_DAEMON_SHUTDOWN_TIMEOUT_MS)) {
        primeSignalSupervisor(supervisor,"SIGTERM");
        if(!await primeWaitExit(supervisor,1000)) primeSignalSupervisor(supervisor,"SIGKILL");
      }
      const remaining=await primeRemainingSockets(daemonSocket,workerPrefix);
      if(remaining.length&&!failure) failure=new Error(`Prime Agent owned processes remained after cleanup: ${remaining.join(", ")}.`);
      if(failure) throw failure;
    };
    return {executable,args:["--daemon-socket",daemonSocket,"--provider",providerId,"--model",input.model,"--models",`${providerId}/**`,...args],env,configPaths,warnings,beforeLaunch,cleanup};
  }

  if(input.harness==="opencode") {
    const providerID="switcher-"+createHash("sha256").update(endpoint(providerBaseUrl)+input.protocol).digest("hex").slice(0,12);
    const packageName={"anthropic-messages":"@ai-sdk/anthropic","openai-responses":"@ai-sdk/openai","openai-chat":"@ai-sdk/openai-compatible"}[input.protocol];
    const modelConfig=Object.fromEntries(input.models.map(model=>[model.id,{
      name:model.name,
      ...(model.contextWindow&&model.maxOutputTokens?{limit:{context:model.contextWindow,output:model.maxOutputTokens}}:{}),
    }]));
    const instructions=await projectInstructionPaths(input.cwd);
    const policy=await preservedOpenCodePolicy(input.cwd);
    const config={
      $schema:"https://opencode.ai/config.json",
      model:`${providerID}/${input.model}`,
      enabled_providers:[providerID],
      ...(instructions.length?{instructions}:{}),
      ...(policy.permission?{permission:policy.permission}:{}),
      ...(policy.agent?{agent:policy.agent}:{}),
      ...(policy.mode?{mode:policy.mode}:{}),
      provider:{[providerID]:{
        npm:packageName,name:"Switcher",
        options:{baseURL:input.baseUrl,apiKey:`{env:${KEY}}`},
        models:modelConfig,
      }},
    };
    const file=await jsonFile(input.stateDir,"opencode-legacy.json",config);configPaths.push(file);
    env.OPENCODE_CONFIG=file;
    // Keep OpenCode's session database durable for --continue while all
    // config/cache/state paths stay inside this launch's private directory.
    const sessionDir=input.sessionDir??join(input.stateDir,"sessions");
    await mkdir(sessionDir,{recursive:true,mode:0o700});
    env.XDG_DATA_HOME=join(sessionDir,"data");
    env.XDG_CONFIG_HOME=join(input.stateDir,"config");
    env.XDG_CACHE_HOME=join(input.stateDir,"cache");
    env.XDG_STATE_HOME=join(input.stateDir,"state");
    // OpenCode merges project and home configuration after OPENCODE_CONFIG;
    // isolate both locations and disable project config so a repository file
    // cannot redirect the selected provider or receive the injected key.
    env.HOME=join(input.stateDir,"home");
    env.OPENCODE_DISABLE_PROJECT_CONFIG="true";
    env.OPENCODE_CONFIG_CONTENT=JSON.stringify(config);
    env[KEY]=input.credential??"switcher-local-no-auth";
    const modelRef=`${providerID}/${input.model}`;
    const native=args[0]==="run"?["run","--model",modelRef,...args.slice(1)]:args[0]==="models"?["models",...args.slice(1)]:["--model",modelRef,...args];
    warnings.push("Legacy OpenCode uses the documented singular provider configuration and an isolated XDG data root for durable sessions; it is separate from OpenCode 2.");
    return {executable,args:native,env,configPaths,warnings};
  }
  // Session model references must identify the upstream provider, not the
  // allocated port of a temporary auth bridge which changes each launch.
  const providerID="switcher-"+createHash("sha256").update(endpoint(providerBaseUrl)+input.protocol).digest("hex").slice(0,12);
  const packageName={"anthropic-messages":"anthropic","openai-responses":"openai/responses","openai-chat":"openai-compatible","gemini-generate-content":"gemini"}[input.protocol];
  const models=Object.fromEntries(input.models.map(m=>[m.id,{
    modelID:m.id,name:m.name,
    // The native schema requires the complete object. Keep unknowns in the
    // API catalog; use text-only native defaults and warn about assumptions.
    capabilities:{tools:m.supportedParameters?.includes("tools")??true,input:m.inputModalities??["text"],output:m.outputModalities??["text"]},
    limit:{...(m.contextWindow?{context:m.contextWindow}:{}),...(m.maxOutputTokens?{output:m.maxOutputTokens}:{})},
  }]));
  const settings:Record<string,string>={baseURL:input.baseUrl};
  env[KEY]=input.credential??"switcher-local-no-auth";settings.apiKey=`{env:${KEY}}`;
  const isolated=await isolateOpenCode2(input.cwd,input.stateDir,providerID);
  const config={...isolated.config,model:`${providerID}/${input.model}`,providers:{[providerID]:{name:"Switcher",env:[KEY],package:`@opencode-ai/ai/providers/${packageName}`,settings,models}}};
  const file=join(input.stateDir,"opencode.json");
  await writeFile(file,openCode2ConfigText(config,providerID,KEY),{mode:0o600,flag:"wx"});
  configPaths.push(file,isolated.instructionFile);
  Object.assign(env,isolated.env);
  env.OPENCODE_CONFIG=file;
  env.OPENCODE_CONFIG_CONTENT="{}";
  const native=args[0]==="run"?["run","--standalone","--model",`${providerID}/${input.model}`,...args.slice(1)]:args[0]==="models"?["models","--standalone",...args.slice(1)]:["--standalone",...args];
  warnings.push("OpenCode 2 uses a standalone server so concurrent launch profiles cannot share provider configuration.");
  warnings.push("OpenCode 2 snapshots native permissions, agent prompts and AGENTS.md for this launch; provider overrides, plugins and live configuration reloads are isolated. Native session data remains in its original XDG data directory.");
  if(input.models.some(m=>!m.supportedParameters||!m.inputModalities||!m.outputModalities)) warnings.push("OpenCode requires complete capabilities; unknown fields use text-only/tool-enabled native defaults, not verified provider capabilities.");
  return {executable,args:native,env,configPaths,warnings};
}
export async function prepareHarnessLaunch(input: HarnessLaunchInput): Promise<PreparedLaunch> {
  assertHarnessArguments(input.harness,input.args ?? []);
  if(input.harness==="kilo") {
    await validateKiloConfiguration(input.cwd,[...input.args??[]]);
    if(input.protocol==="gemini-generate-content") throw new Error("Kilo is incompatible with this protocol.");
    validateHarnessVersion(input.harness,input.version);
    const bridge=grokBridge({...input,baseUrl:endpoint(input.baseUrl)});
    try {
      const prepared=await prepareKilo({...input,credential:bridge.token},bridge.baseUrl);
      return {...prepared,cleanup:async()=>{try{await prepared.cleanup?.();}finally{await bridge.cleanup();}}};
    } catch(error) {await bridge.cleanup();throw error;}
  }
  const nativeAuth=input.protocol==="anthropic-messages"?"x-api-key":"bearer";
  const adaptAuth=(input.authStyle==="api-key"&&!["codex","grok","hermes","gemini"].includes(input.harness))||(input.harness==="opencode"||input.harness==="opencode2"||input.harness==="pi"||input.harness==="dsh"||input.harness==="cline"||input.harness==="prime-agent")&&(input.authStyle??"bearer")!==nativeAuth;
  if(input.harness==="gemini") {
    if(input.protocol!=="gemini-generate-content") throw new Error("Gemini CLI is incompatible with this protocol.");
    if(input.authStyle!=="x-api-key") throw new Error("Gemini CLI requires x-api-key authentication.");
    validateHarnessVersion(input.harness,input.version);
    const configuration=await validateGeminiConfiguration(input.cwd);
    if(input.credential&&JSON.stringify([configuration.defaults,configuration.user,configuration.system]).includes(input.credential)) throw new Error("Gemini native configuration must not contain the upstream provider credential.");
    const bridge=geminiBridge(input);
    try {const prepared=await prepareNativeLaunch({...input,baseUrl:bridge.baseUrl,credential:bridge.token});return {...prepared,cleanup:async()=>{try{await prepared.cleanup?.();}finally{await bridge.cleanup();}}};}
    catch(error){await bridge.cleanup();throw error;}
  }
  if(input.harness!=="aider"&&((input.credential&&!adaptAuth)||input.harness==="grok")) return prepareNativeLaunch(input);
  // No-auth endpoints must not receive a native login credential or even a
  // synthetic token. Authenticate only to this loopback hop, then strip auth.
  const bridge=grokBridge({...input,baseUrl:endpoint(input.baseUrl)});
  try{
    const prepared=await prepareNativeLaunch({...input,baseUrl:bridge.baseUrl,credential:bridge.token,authStyle:(input.harness==="opencode"||input.harness==="opencode2"||input.harness==="cline"||input.harness==="prime-agent")?nativeAuth:"bearer"},input.baseUrl);
    return {...prepared,cleanup:async()=>{try{await prepared.cleanup?.();}finally{await bridge.cleanup();}}};
  }catch(error){await bridge.cleanup();throw error;}
}
