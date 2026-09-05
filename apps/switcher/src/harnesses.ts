import { mkdir, writeFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compatible, endpoint, codingEligible } from "./domain";
import type { HarnessId, HarnessLaunchInput, PreparedLaunch } from "./harness-types";
const execute = promisify(execFile);
const KEY = "SWITCHER_HARNESS_API_KEY";
const quote = (value: unknown) => JSON.stringify(value);
export async function detectHarness(harness: HarnessId, override?: string) {
  const executable = override ?? Bun.which(harness) ?? harness;
  try {
    const {stdout} = await execute(executable,["--version"],{timeout:8000,maxBuffer:65536});
    return {harness,executable,available:true,version:stdout.trim().slice(0,200)};
  } catch { return {harness,executable,available:false,version:undefined}; }
}
const versionAtLeast = (raw: string | undefined, minimum: number[]) => {
  const match = raw?.match(/(\d+)\.(\d+)\.(\d+)/);
  if(!match) return false;
  const actual=match.slice(1).map(Number);
  for(let i=0;i<3;i++){if(actual[i]>minimum[i])return true;if(actual[i]<minimum[i])return false;}return true;
};
async function jsonFile(dir:string,name:string,value:unknown) {
  const path=join(dir,name);await writeFile(path,JSON.stringify(value,null,2)+"\n",{mode:0o600,flag:"wx"});return path;
}
function codexModel(model: HarnessLaunchInput["models"][number], priority:number) {
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
  const apiBackend={"anthropic-messages":"messages","openai-responses":"responses","openai-chat":"chat_completions"}[input.protocol];
  const apiPath={"anthropic-messages":"/messages","openai-responses":"/responses","openai-chat":"/chat/completions"}[input.protocol];
  server=Bun.serve({hostname:"127.0.0.1",port:0,maxRequestBodySize:4*1024*1024,idleTimeout:255,async fetch(request){
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
    if(input.credential) headers[input.authStyle==="x-api-key"?"x-api-key":"authorization"]=input.authStyle==="x-api-key"?input.credential:`Bearer ${input.credential}`;
    if(input.protocol==="anthropic-messages") {
      headers["anthropic-version"]=request.headers.get("anthropic-version")??"2023-06-01";
      if(request.headers.has("anthropic-beta")) headers["anthropic-beta"]=request.headers.get("anthropic-beta")!;
    }
    try {
      const response=await fetch(`${input.baseUrl}${apiPath}`,{method:"POST",headers,body:JSON.stringify(body),redirect:"manual",signal:AbortSignal.any([request.signal,AbortSignal.timeout(240000)])});
      if(!response.ok){await response.body?.cancel();return Response.json({error:{message:`Provider returned HTTP ${response.status}`}},{status:response.status>=300&&response.status<400?502:response.status});}
      return new Response(response.body,{status:response.status,headers:{"content-type":response.headers.get("content-type")??"application/json","cache-control":"no-store"}});
    }catch{return Response.json({error:{message:"Provider request failed"}},{status:502});}
  }});
  return {baseUrl:new URL("v1",server.url).href,token,cleanup:async()=>{await server.stop(true);}};
}
function grokAlias(input: HarnessLaunchInput, model: string) {
  return "switcher-" + createHash("sha256").update(JSON.stringify([input.baseUrl,input.protocol])).digest("hex").slice(0,12) + "/" + model;
}
async function prepareNativeLaunch(input: HarnessLaunchInput): Promise<PreparedLaunch> {
  input={...input,baseUrl:endpoint(input.baseUrl)};
  if(!compatible(input.harness,input.protocol)) throw new Error("Harness and provider protocol are incompatible.");
  if(!isAbsolute(input.stateDir)||!isAbsolute(input.cwd)) throw new Error("Launch state and working directories must be absolute.");
  if(!input.models.length||!input.models.some(m=>m.id===input.model)) throw new Error("Selected model is missing from the launch catalog.");
  if(input.models.some(m=>!codingEligible(m))) throw new Error("Launch catalog contains a model explicitly ineligible for coding.");
  if(input.credential&&/[\r\n]/.test(input.credential)) throw new Error("Provider credential contains invalid header characters.");
  await mkdir(input.stateDir,{recursive:true,mode:0o700});
  const args=[...(input.args??[])];const env:Record<string,string>={};
  const warnings:string[]=[];const configPaths:string[]=[];
  const executable=input.executable??input.harness;
  const missing=input.models.filter(m=>!m.contextWindow).length;
  if(missing) warnings.push(`${missing} catalog models have no declared context limit; native fallback limits may be inaccurate.`);
  if(input.harness==="claude") {
    if(!versionAtLeast(input.version,[2,1,242])) throw new Error("Claude Code >=2.1.242 is required for a full native modelPicker.");
    env.ANTHROPIC_BASE_URL=input.baseUrl.replace(/\/v1$/,"");
    env.ANTHROPIC_MODEL=input.model;
    env[input.authStyle==="x-api-key"?"ANTHROPIC_API_KEY":"ANTHROPIC_AUTH_TOKEN"]=input.credential??"switcher-local-no-auth";
    const file=await jsonFile(input.stateDir,"claude-settings.json",{modelPicker:{replaceBuiltInOptions:true,options:input.models.map(m=>({model:m.id,label:m.name,description:m.description?.slice(0,300)}))}});
    configPaths.push(file);
    warnings.push("Claude managed settings and model allowlists can restrict the generated picker.");
    return {executable,args:["--settings",file,"--model",input.model,...args],env,configPaths,warnings};
  }
  if(input.harness==="codex") {
    if(!versionAtLeast(input.version,[0,153,0])) throw new Error("Codex >=0.153.0 is required by this catalog adapter.");
    const file=await jsonFile(input.stateDir,"codex-models.json",{models:input.models.map(codexModel)});
    configPaths.push(file);
    env[KEY]=input.credential??"switcher-local-no-auth";
    const provider:Record<string,unknown>={name:"Switcher",base_url:input.baseUrl,wire_api:"responses",requires_openai_auth:false};
    {
      if(input.authStyle==="x-api-key") provider.env_http_headers={"x-api-key":KEY};
      else provider.env_key=KEY;
    }
    const toml=Object.entries(provider).map(([k,v])=>`${k} = ${typeof v==="object"?"{ "+Object.entries(v as object).map(([key,value])=>`${quote(key)} = ${quote(value)}`).join(", ")+" }":quote(v)}`).join(", ");
    const overrides=["-c",`model_provider="switcher"`,"-c",`model_providers.switcher={ ${toml} }`,"-c",`model_catalog_json=${quote(file)}`,"-c",`model=${quote(input.model)}`];
    warnings.push("Codex catalog uses conservative generic tool metadata and a model-neutral coding prompt; provider-specific reasoning is not advertised.");
    return {executable,args:[...overrides,...args],env,configPaths,warnings};
  }
  if(input.harness==="grok") {
    if(!versionAtLeast(input.version,[1,0,13])) throw new Error("Grok Build >=1.0.13 is required by this remote catalog adapter.");
    if(args.some(a=>["--resume","-r","--continue","-c"].includes(a))) throw new Error("Grok resume is not supported by the per-launch bridge yet; start a new session.");
    const file=await jsonFile(input.stateDir,"grok-overlay.json",{models:{default:grokAlias(input,input.model),allowed_models:input.models.map(m=>grokAlias(input,m.id))}});
    configPaths.push(file);
    const bridge=grokBridge(input);
    env.GROK_MODELS_BASE_URL=bridge.baseUrl;env.GROK_MODELS_LIST_URL=bridge.baseUrl+"/models";
    env.GROK_XAI_API_BASE_URL=bridge.baseUrl;
    env.XAI_API_KEY=bridge.token;env[KEY]=bridge.token;
    env.GROK_CONFIG_PATH=file;
    warnings.push("Grok uses a per-launch loopback catalog/auth bridge; native managed model policies still apply.");
    return {executable,args:["--model",grokAlias(input,input.model),...args],env,configPaths,warnings,cleanup:bridge.cleanup};
  }
  if(!input.version?.includes("opencode2")&&!versionAtLeast(input.version,[2,0,0])) throw new Error("Use the OpenCode 2 executable, not legacy OpenCode.");
  const providerID="switcher-"+createHash("sha256").update(input.baseUrl+input.protocol).digest("hex").slice(0,12);
  const packageName={"anthropic-messages":"anthropic","openai-responses":"openai/responses","openai-chat":"openai-compatible"}[input.protocol];
  const models=Object.fromEntries(input.models.map(m=>[m.id,{
    modelID:m.id,name:m.name,
    // The native schema requires the complete object. Keep unknowns in the
    // API catalog; use text-only native defaults and warn about assumptions.
    capabilities:{tools:m.supportedParameters?.includes("tools")??true,input:m.inputModalities??["text"],output:m.outputModalities??["text"]},
    limit:{...(m.contextWindow?{context:m.contextWindow}:{}),...(m.maxOutputTokens?{output:m.maxOutputTokens}:{})},
  }]));
  const settings:Record<string,string>={baseURL:input.baseUrl};
  env[KEY]=input.credential??"switcher-local-no-auth";settings.apiKey=`{env:${KEY}}`;
  const config={model:`${providerID}/${input.model}`,providers:{[providerID]:{name:"Switcher",env:[KEY],package:`@opencode-ai/ai/providers/${packageName}`,settings,models}}};
  const file=await jsonFile(input.stateDir,"opencode.json",config);configPaths.push(file);
  env.OPENCODE_CONFIG=file;
  // Inline content wins over project provider settings without changing user files.
  env.OPENCODE_CONFIG_CONTENT=JSON.stringify({model:config.model});
  const native=args[0]==="run"?["run","--standalone","--model",`${providerID}/${input.model}`,...args.slice(1)]:args[0]==="models"?["models","--standalone",...args.slice(1)]:["--standalone",...args];
  warnings.push("OpenCode 2 uses a standalone server so concurrent launch profiles cannot share provider configuration.");
  if(input.models.some(m=>!m.supportedParameters||!m.inputModalities||!m.outputModalities)) warnings.push("OpenCode requires complete capabilities; unknown fields use text-only/tool-enabled native defaults, not verified provider capabilities.");
  return {executable,args:native,env,configPaths,warnings};
}
export async function prepareHarnessLaunch(input: HarnessLaunchInput): Promise<PreparedLaunch> {
  const reserved:Record<HarnessId,string[]>={
    claude:["--model","--settings","--setting-sources"],
    codex:["--model","-m","--profile","-p"],
    grok:["--model","-m","--oauth"],
    opencode2:["--model","-m","--server"],
  };
  for(let i=0;i<(input.args??[]).length;i++){
    const arg=input.args![i],flag=arg.split("=")[0];
    if(reserved[input.harness].includes(flag)) throw new Error("Provider/model configuration arguments are reserved by the launch profile; update the profile instead.");
    if(input.harness==="codex"&&(flag==="-c"||flag==="--config"||arg.startsWith("-c"))){
      const value=arg==="-c"||arg==="--config"?input.args![i+1]??"":arg.replace(/^(-c|--config=)/,"");
      if(/^(model|model_provider|model_providers|model_catalog_json)([.=]|$)/.test(value.trim())) throw new Error("Codex provider/model configuration must come from the launch profile.");
    }
  }
  const nativeAuth=input.protocol==="anthropic-messages"?"x-api-key":"bearer";
  const adaptAuth=input.harness==="opencode2"&&(input.authStyle??"bearer")!==nativeAuth;
  if(input.harness==="opencode2"&&(!input.credential||adaptAuth)&&(input.args??[]).some(a=>["--continue","-c","--session","-s","--fork"].includes(a.split("=")[0]))) throw new Error("OpenCode resume with a temporary auth bridge is not supported yet; start a new session.");
  if((input.credential&&!adaptAuth)||input.harness==="grok") return prepareNativeLaunch(input);
  // No-auth endpoints must not receive a native login credential or even a
  // synthetic token. Authenticate only to this loopback hop, then strip auth.
  const bridge=grokBridge({...input,baseUrl:endpoint(input.baseUrl)});
  try{
    const prepared=await prepareNativeLaunch({...input,baseUrl:bridge.baseUrl,credential:bridge.token,authStyle:input.harness==="opencode2"?nativeAuth:"bearer"});
    return {...prepared,cleanup:async()=>{await prepared.cleanup?.();await bridge.cleanup();}};
  }catch(error){await bridge.cleanup();throw error;}
}
