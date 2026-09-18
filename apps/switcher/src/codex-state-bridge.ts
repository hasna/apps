import { spawn } from "node:child_process";
import { Transform } from "node:stream";
import { once } from "node:events";
import { codexConfigPath } from "./harness-arguments";
import { codexRoutingKeys, codexTransportKeys } from "./codex-model-policy";

const MAX_FRAME = 8 * 1024 * 1024;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value);
const decoder = new TextDecoder("utf-8",{fatal:true});
const credentialKeys = new Set(["env_key","env_http_headers","http_headers","auth_command"]);
const routingAliases = new Set(["modelProvider","modelProviders","modelCatalogJson","reviewModel","modelId","providerId","providers","baseUrl","baseURL","wireApi","wireAPI","requires_openai_auth","requiresOpenaiAuth","requiresOpenAIAuth"]);
const credentialAliases = new Set(["envKey","envHttpHeaders","httpHeaders","httpHeader","header","headers","authCommand","auth","authorization","Authorization","api_key","apiKey","api-key","x-api-key"]);
const stateOwnedKeys = new Set(["review_model","sqlite_home","config_file","extract_model","consolidation_model","sqliteHome","configFile","extractModel","consolidationModel"]);
const agentOwnedKeys = new Set(["default_subagent_model","default_subagent_reasoning_effort","default_subagent_reasoning_summary","defaultSubagentModel","defaultSubagentReasoningEffort","defaultSubagentReasoningSummary"]);
const prototypeKeys = new Set(["__proto__","prototype","constructor"]);
const forbiddenKeys = new Set([...codexTransportKeys,...credentialKeys,...credentialAliases,"plugin","mcpServer","mcpServers","profile","profiles","include",...prototypeKeys]);
const ownedKeys = new Set([...codexRoutingKeys,...routingAliases,...stateOwnedKeys,...agentOwnedKeys]);
const unsafeKeys = new Set([...forbiddenKeys,...ownedKeys]);
const managedParamKeys = new Set(["config","model","modelProvider","modelProviders","allowProviderModelFallback"]);
const unsafeParamKeys = new Set([...forbiddenKeys,...ownedKeys,...managedParamKeys,"provider","plugins"]);
function configKeySegments(key:string):string[]{
  const parts=codexConfigPath(key).flatMap(part=>part.split(".")).filter(Boolean);
  if(!parts.length)throw new Error("codex_state_config_key");return parts;
}
function securityKeySegments(key:string):string[]{
  try{return configKeySegments(key);}catch{return key.match(/[A-Za-z_][A-Za-z0-9_]*/g)??[];}
}
function safePath(value:unknown):value is string{if(typeof value!=="string"||!value.startsWith("/")||/[\r\n\0]/.test(value))return false;const parts=value.split("/").slice(1);return parts.length>0&&parts.every(part=>part!==""&&part!=="."&&part!=="..");}
function merge(base:ObjectValue,overlay:ObjectValue):ObjectValue{
  const result={...base};for(const[key,value]of Object.entries(overlay))result[key]=object(value)&&object(result[key])?merge(result[key] as ObjectValue,value):value;return result;
}
function sanitizeOwnedTree(value:unknown,additionalOwned:Set<string>,path:string):unknown{
  if(Array.isArray(value))return value.map((item,index)=>sanitizeOwnedTree(item,additionalOwned,`${path}[${index}]`));
  if(!object(value))return value;
  const result:ObjectValue={};
  for(const[key,item]of Object.entries(value)){
    const segments=securityKeySegments(key);
    if(segments.some(part=>forbiddenKeys.has(part)))throw new Error(`codex_state_unsafe_config:${path}.${key}`);
    if(segments.some(part=>ownedKeys.has(part)||additionalOwned.has(part)))continue;
    result[key]=sanitizeOwnedTree(item,additionalOwned,`${path}.${key}`);
  }
  return result;
}
function safeAgents(value:unknown):unknown{
  if(!object(value))throw new Error("codex_state_agents");
  const result:ObjectValue={};
  for(const[name,item]of Object.entries(value)){
    if(prototypeKeys.has(name))throw new Error(`codex_state_unsafe_config:agents.${name}`);
    if(agentOwnedKeys.has(name))continue;
    if(object(item)){result[name]=sanitizeOwnedTree(item,new Set(),`agents.${name}`);continue;}
    if(securityKeySegments(name).some(part=>unsafeKeys.has(part)))throw new Error(`codex_state_unsafe_config:agents.${name}`);
    result[name]=item;
  }
  return result;
}
function safeMemories(value:unknown):unknown{
  if(!object(value))throw new Error("codex_state_memories");
  return sanitizeOwnedTree(value,new Set(),"memories");
}
function validateRouting(routing:CodexStateRouting):void{
  if(typeof routing.model!=="string"||!routing.model||routing.model.length>4096||/[\r\n\0]/.test(routing.model))throw new Error("codex_state_routing");
  const allowed=new Set(["model_provider","model_providers","model_catalog_json","review_model","agents","memories","sqlite_home"]);
  if(Object.keys(routing.config).some(key=>!allowed.has(key))||routing.config.model_provider!=="switcher")throw new Error("codex_state_routing");
  const providers=routing.config.model_providers;if(!object(providers)||Object.keys(providers).length!==1||!object(providers.switcher))throw new Error("codex_state_routing");
  const provider=providers.switcher as ObjectValue,providerKeys=new Set(["name","base_url","wire_api","requires_openai_auth","env_key","env_http_headers"]);
  if(Object.keys(provider).some(key=>!providerKeys.has(key))||provider.name!=="Switcher"||provider.wire_api!=="responses"||provider.requires_openai_auth!==false)throw new Error("codex_state_routing");
  const url=new URL(String(provider.base_url));if(url.protocol!=="http:"||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.port||url.pathname!=="/v1"||url.username||url.password||url.search||url.hash)throw new Error("codex_state_routing");
  if(provider.env_key!==undefined&&provider.env_key!=="SWITCHER_HARNESS_API_KEY")throw new Error("codex_state_routing");
  if(provider.env_http_headers!==undefined){if(!object(provider.env_http_headers)||Object.keys(provider.env_http_headers).length!==1||Object.keys(provider.env_http_headers).some(key=>!["x-api-key","api-key"].includes(key))||Object.values(provider.env_http_headers).some(value=>value!=="SWITCHER_HARNESS_API_KEY"))throw new Error("codex_state_routing");}
  if((provider.env_key===undefined)===(provider.env_http_headers===undefined))throw new Error("codex_state_routing");
  for(const key of ["model_catalog_json","sqlite_home"])if(!safePath(routing.config[key]))throw new Error("codex_state_routing");
  if(routing.config.review_model!==undefined&&(typeof routing.config.review_model!=="string"||/[\r\n\0]/.test(routing.config.review_model)))throw new Error("codex_state_routing");
  if(routing.config.agents!==undefined){
    const agents=routing.config.agents;if(!object(agents))throw new Error("codex_state_routing");
    for(const [name,item] of Object.entries(agents)){
      if(prototypeKeys.has(name))throw new Error("codex_state_routing");
      if(name==="default_subagent_model"){if(typeof item!=="string"||/[\r\n\0]/.test(item))throw new Error("codex_state_routing");continue;}
      if(!object(item)){assertSafeRetained({[name]:item},"routing.agents");continue;}
      const copy=structuredClone(item);
      if(copy.config_file!==undefined){if(!safePath(copy.config_file))throw new Error("codex_state_routing");delete copy.config_file;}
      assertSafeRetained(copy,`routing.agents.${name}`);
    }
  }
  if(routing.config.memories!==undefined){
    if(!object(routing.config.memories))throw new Error("codex_state_routing");
    const memories=structuredClone(routing.config.memories);
    for(const key of ["extract_model","consolidation_model"]){if(memories[key]!==undefined&&(typeof memories[key]!=="string"||/[\r\n\0]/.test(memories[key])))throw new Error("codex_state_routing");delete memories[key];}
    assertSafeRetained(memories,"routing.memories");
  }
}
function assertSafeRetained(value: unknown, path = "config"): void {
  if (Array.isArray(value)) { value.forEach((item,index)=>assertSafeRetained(item,`${path}[${index}]`));return; }
  if (!object(value)) return;
  for (const [key,item] of Object.entries(value)) {
    if(securityKeySegments(key).some(part=>unsafeKeys.has(part)))throw new Error(`codex_state_unsafe_config:${path}.${key}`);
    assertSafeRetained(item,`${path}.${key}`);
  }
}
function safeManagedParams(params:ObjectValue):ObjectValue{
  const safe:ObjectValue={};
  for(const [key,value]of Object.entries(params)){
    if(managedParamKeys.has(key))continue;
    if(securityKeySegments(key).some(part=>unsafeParamKeys.has(part)))throw new Error("codex_state_param_override");
    safe[key]=value;
  }
  return safe;
}
export type CodexStateRouting = { model: string; config: ObjectValue };

/** Supported native RPC only: catalog read-repair and current launch routing.
 * Thread IDs, histories, tool calls, permissions and response bytes are intact. */
export function rewriteCodexStateRequest(line: Buffer, routing: CodexStateRouting): Buffer {
  validateRouting(routing);if (line.length > MAX_FRAME) throw new Error("codex_state_frame_limit");
  const request: unknown = JSON.parse(decoder.decode(line));
  if (!object(request)) throw new Error("codex_state_protocol");
  const managed=["thread/list","thread/start","thread/resume","thread/fork"].includes(String(request.method));
  if(managed&&!Object.hasOwn(request,"id"))throw new Error("codex_state_protocol");
  if(!managed)return line;
  if (request.params != null && !object(request.params)) throw new Error("codex_state_protocol");
  const params = (request.params ?? {}) as ObjectValue,safeParams=safeManagedParams(params);
  if (request.method === "thread/list") {
    request.params = { ...safeParams, modelProviders: [], useStateDbOnly: false };
  } else {
    if (params.config != null && !object(params.config)) throw new Error("codex_state_protocol");
    const retained: ObjectValue = {};
    for(const [key,value] of Object.entries(params.config ?? {})) {
      const path=configKeySegments(key),root=path[0];
      if(path.some(item=>forbiddenKeys.has(item)))throw new Error("codex_state_transport_override");
      if(path.some(item=>ownedKeys.has(item)))continue;
      if((root==="agents"||root==="memories")&&path.length>1)throw new Error("codex_state_config_ambiguous");
      if(root==="agents"){if(Object.hasOwn(retained,root))throw new Error("codex_state_config_ambiguous");retained[root]=safeAgents(value);}
      else if(root==="memories"){if(Object.hasOwn(retained,root))throw new Error("codex_state_config_ambiguous");retained[root]=safeMemories(value);}
      else {assertSafeRetained({[key]:value});retained[key]=value;}
    }
    request.params = { ...safeParams, modelProvider: "switcher", model: routing.model,
      ...(request.method === "thread/start" ? { allowProviderModelFallback: false } : {}),
      config: merge(retained,routing.config) };
  }
  return Buffer.from(JSON.stringify(request));
}

export function codexStateRequestStream(routing: CodexStateRouting): Transform {
  let pending = Buffer.alloc(0);
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        const joined = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        let start = 0, end: number;
        while ((end = joined.indexOf(10, start)) >= 0) {
          const line = joined.subarray(start, end);
          if (line.length) this.push(Buffer.concat([rewriteCodexStateRequest(line, routing), Buffer.from("\n")]));
          start = end + 1;
        }
        pending = Buffer.from(joined.subarray(start));
        if (pending.length > MAX_FRAME) throw new Error("codex_state_frame_limit");
        callback();
      } catch { callback(new Error("codex_state_protocol")); }
    },
    flush(callback) { callback(pending.length ? new Error("codex_state_truncated_frame") : undefined); },
  });
}

/** The native app-server owns inference and state. This process only adapts
 * requests over its supported stdio API, with no retry or conversation replay. */
export async function runCodexStateBridge(executable: string, args: string[], routing: CodexStateRouting): Promise<number> {
  const grouped=process.platform!=="win32";
  const child = spawn(executable, args, { stdio: ["pipe", "pipe", "inherit"], detached:grouped });
  const requests = codexStateRequestStream(routing);
  let stopping = false, failed = false, timer: ReturnType<typeof setTimeout> | undefined;
  const signal=(value:NodeJS.Signals)=>{try{if(grouped&&child.pid)process.kill(-child.pid,value);else child.kill(value);}catch(error){if((error as NodeJS.ErrnoException).code!=="ESRCH")failed=true;}};
  const groupExists=()=>{if(!grouped||!child.pid)return false;try{process.kill(-child.pid,0);return true;}catch{return false;}};
  const reapGroup=async()=>{
    if(!groupExists())return;signal("SIGTERM");const deadline=Date.now()+1000;
    while(groupExists()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
    if(groupExists()){signal("SIGKILL");const killed=Date.now()+1000;while(groupExists()&&Date.now()<killed)await new Promise(resolve=>setTimeout(resolve,25));}
    if(groupExists())failed=true;
  };
  const stop = () => {
    if (stopping) return; stopping = true;
    child.stdin.destroy(); signal("SIGTERM");
    timer = setTimeout(() => signal("SIGKILL"), 5000); timer.unref();
  };
  const fail = () => { failed = true; stop(); };
  child.on("error", fail); child.stdin.on("error", fail); requests.on("error", fail);
  process.stdout.on("error", fail);
  process.on("SIGINT", stop); process.on("SIGTERM", stop); process.on("SIGHUP", stop);
  const endInput = () => { timer ??= setTimeout(stop, 5000); timer.unref(); };
  process.stdin.once("end", endInput);
  process.stdin.pipe(requests).pipe(child.stdin); child.stdout.pipe(process.stdout, { end: false });
  let code:number|null|undefined;
  // The leader's exit must trigger group cleanup even when a descendant still
  // holds an inherited stdout/stderr descriptor and delays Node's close event.
  try { [code] = await once(child, "exit") as [number|null]; }
  catch { failed=true; }
  finally {
    await reapGroup();if (timer) clearTimeout(timer);
    process.stdin.unpipe(requests); requests.destroy(); child.stdout.unpipe(process.stdout);
    process.stdin.pause();
    process.stdin.off("end", endInput); process.stdout.off("error", fail);
    process.off("SIGINT", stop); process.off("SIGTERM", stop); process.off("SIGHUP", stop);
  }
  return failed ? 1 : typeof code === "number" ? code : 1;
}

if (import.meta.main) {
  try {
    const [executable, model, config, ...args] = process.argv.slice(2);
    const parsed: unknown = JSON.parse(config);
    if (!executable?.startsWith("/") || !model || !object(parsed) || args[0] !== "app-server") throw new Error();
    process.exitCode = await runCodexStateBridge(executable, args, { model, config: parsed });
  } catch { console.error("Switcher native session bridge failed."); process.exitCode = 1; }
}
