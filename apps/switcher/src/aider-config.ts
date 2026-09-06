import { readFile, writeFile, lstat, copyFile, rename, realpath, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, basename, join, resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { parseDocument } from "yaml";
import { aiderArguments, aiderConfigKey } from "./aider-args";
import { privateDirectory } from "./runtime";
import type { HarnessLaunchInput, PreparedLaunch } from "./harness-types";

const KEY="SWITCHER_HARNESS_API_KEY";
type Config=Record<string,unknown>;
const object=(v:unknown):v is Config=>!!v&&typeof v==="object"&&!Array.isArray(v);
async function data(path:string):Promise<unknown|undefined> {
  let text:string;
  try { const stat=await lstat(path);if(!stat.isFile()||stat.size>1024*1024)throw new Error("unsupported");text=await readFile(path,"utf8"); }
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return;throw new Error(`Aider configuration must be a readable regular file smaller than 1 MiB: ${path}`);}
  const parsed=parseDocument(text,{uniqueKeys:true});
  if(parsed.errors.length)throw new Error(`Aider configuration is not valid unambiguous YAML: ${path}`);
  try{return parsed.toJS({maxAliasCount:0});}catch{throw new Error(`Aider configuration aliases are unsupported: ${path}`);}
}
async function gitRoot(path:string):Promise<string|undefined> {
  let parent=resolve(path);const missing:string[]=[];
  for(;;){try{parent=await realpath(parent);break;}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;if(dirname(parent)===parent)throw error;missing.unshift(basename(parent));parent=dirname(parent);}}
  for(let dir=join(parent,...missing);;dir=dirname(dir)) {
    try {await lstat(join(dir,".git"));return dir;}catch(error){if(!["ENOENT","ENOTDIR"].includes((error as NodeJS.ErrnoException).code??""))throw error;}
    if(dirname(dir)===dir)return;
  }
}
const falseValue=(v:unknown)=>v===undefined||v===null||v===false||v===0||typeof v==="string"&&["","false","no","off","0"].includes(v.toLowerCase());
const startup=`yes-always gui browser upgrade install-main-branch just-check-update apply-clipboard-edits test lint commit`.split(" ");
const safeParameters=new Set(`max_tokens temperature top_p top_k min_p stop seed reasoning_effort thinking`.split(" "));
const expandHome=(path:string,home:string)=>path==="~"?home:path.startsWith("~/")?join(home,path.slice(2)):path;
// These native files are still read by Aider even with an explicit --config.
// Reject specific startup conflicts instead of weakening native confirmations.
// This is a preflight policy check, not a sandbox against concurrent project edits.
export async function validateAiderConfiguration(cwd:string,args:readonly string[]=[],home=process.env.HOME??homedir()):Promise<Config> {
  if(!isAbsolute(home))throw new Error("Aider requires an absolute HOME to preserve native instruction paths.");
  const parsed=aiderArguments(args),cwdRoot=await gitRoot(cwd);
  const roots=new Set([resolve(home),...(cwdRoot?[cwdRoot]:[]),resolve(cwd)]);
  for(const file of parsed.files){const target=resolve(cwd,file),root=await gitRoot(target);if(root&&root!==cwdRoot)throw new Error("Aider editable files must use the selected working directory's Git repository; select --cwd for that repository.");}
  let effective:Config={};
  for(const root of roots) {
    const path=join(root,".aider.conf.yml"),value=await data(path);
    if(value!==undefined) {
      if(!object(value))throw new Error(`Aider configuration must be a mapping: ${path}`);
      const normalized:Config={};
      for(const [key,setting] of Object.entries(value)) {
        const name=key.replace(/^--/,"");
        if(!aiderConfigKey(name)||Object.hasOwn(normalized,name))throw new Error(`Aider configuration requires exact, unambiguous native option names: ${path}`);
        normalized[name]=setting;
      }
      for(const key of [...startup,"load"])if(!falseValue(normalized[key]))throw new Error(`Aider ${key} in ${path} conflicts with a provider-bound launch. Remove that startup setting; explicit native task options remain available.`);
      if(normalized.encoding!==undefined&&!['utf8','utf-8'].includes(String(normalized.encoding).toLowerCase()))throw new Error("Aider profile history requires UTF-8 encoding.");
      for(const file of typeof normalized.file==="string"?[normalized.file]:Array.isArray(normalized.file)?normalized.file:[]){if(typeof file!=="string")throw new Error("Aider configured file paths must be strings.");const fileRoot=await gitRoot(resolve(cwd,file));if(fileRoot&&fileRoot!==cwdRoot)throw new Error("Aider configured editable files must use the selected working directory's Git repository.");}
      effective={...effective,...normalized};
    }
    const settings=await data(join(root,".aider.model.settings.yml"));
    if(settings!==undefined) {
      if(!Array.isArray(settings))throw new Error("Aider model settings must be a list.");
      for(const entry of settings)if(!object(entry)||entry.extra_params!==undefined&&(!object(entry.extra_params)||Object.keys(entry.extra_params).some(key=>!safeParameters.has(key))))
        throw new Error(`Aider custom transport or callback model settings cannot be preserved safely: ${join(root,".aider.model.settings.yml")}`);
    }
  }
  if(effective.read!==undefined&&!(typeof effective.read==="string"||Array.isArray(effective.read)&&effective.read.every(v=>typeof v==="string")))throw new Error("Aider read-only instruction paths must be a string or a list of strings.");
  const reads=parsed.reads.length?parsed.reads:typeof effective.read==="string"?[effective.read]:effective.read as string[]??[];
  for(const path of reads){try{await access(resolve(cwd,expandHome(path,home)),constants.R_OK);}catch{throw new Error(`Aider read-only instruction file is not readable: ${path}`);}}
  if(effective.read!==undefined)effective.read=typeof effective.read==="string"?expandHome(effective.read,home):(effective.read as string[]).map(path=>expandHome(path,home));
  return effective;
}
export function aiderModelName(protocol:HarnessLaunchInput["protocol"],id:string):string {
  return `${protocol==="anthropic-messages"?"anthropic":protocol==="openai-responses"?"openai/responses":"openai"}/${id}`;
}
async function historyFile(path:string):Promise<void> {
  const stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024||process.platform!=="win32"&&((stat.mode&0o077)!==0||stat.uid!==process.getuid?.()))throw new Error("Aider history must be an owner-only regular file smaller than 64 MiB.");
}
export async function prepareAider(input:HarnessLaunchInput):Promise<PreparedLaunch> {
  if(input.protocol==="openai-chat"&&input.models.some(m=>m.id.startsWith("responses/")))throw new Error("Aider reserves the responses/ model prefix for its Responses transport; this Chat catalog cannot be mapped exactly.");
  if(input.protocol==="openai-responses"&&input.models.some(m=>m.id.includes("responses/")))throw new Error("Aider/LiteLLM removes responses/ segments from Responses model names; this catalog cannot be mapped exactly.");
  const parsed=aiderArguments(input.args??[]),global=await validateAiderConfiguration(input.cwd,input.args);
  // ConfigArgParse appends list-valued configuration after argv. Keeping a
  // literal -- would turn those generated settings into filenames. Aider's
  // positional tail contains filenames, so preserve them as absolute paths.
  const literal=parsed.args.indexOf("--");
  if(literal>=0){const files=parsed.args.splice(literal).slice(1);parsed.args.push(...files.map(path=>resolve(input.cwd,path)));}
  const sourceHome=process.env.HOME??homedir();
  for(let i=0;i<parsed.args.length;i++){if(parsed.args[i]==="--read"){i++;parsed.args[i]=expandHome(parsed.args[i],sourceHome);}else if(parsed.args[i].startsWith("--read="))parsed.args[i]="--read="+expandHome(parsed.args[i].slice(7),sourceHome);}
  const home=join(input.stateDir,"aider-home");await privateDirectory(home);
  // Keep Git's existing identity/signing/hooks policy without giving native
  // `git config --global` the user's actual global file as its write target.
  const originalHome=process.env.HOME??homedir();
  const gitSources=process.env.GIT_CONFIG_GLOBAL?[resolve(process.env.GIT_CONFIG_GLOBAL)]:[join(process.env.XDG_CONFIG_HOME??join(originalHome,".config"),"git","config"),join(originalHome,".gitconfig")];
  const gitConfig=join(home,".gitconfig");
  await writeFile(gitConfig,gitSources.map(path=>`[include]\n\tpath = ${JSON.stringify(path)}\n`).join(""),{mode:0o600,flag:"wx"});
  const sessions=input.sessionDir??join(input.stateDir,"sessions");await privateDirectory(sessions);
  const id=crypto.randomUUID(),history=join(sessions,`${id}.chat.md`),inputHistory=join(sessions,`${id}.input`);
  if(parsed.restore) {
    const latest=join(sessions,"latest.json");await historyFile(latest).catch(()=>{throw new Error("No valid completed Aider history is available for this profile.");});
    const previous=JSON.parse(await readFile(latest,"utf8"));
    if(!object(previous)||typeof previous.id!=="string"||!/^[-a-f0-9]{36}$/.test(previous.id))throw new Error("Invalid Aider history reference.");
    const source=join(sessions,`${previous.id}.chat.md`);await historyFile(source);
    await copyFile(source,history,1);
  }else await writeFile(history,"",{mode:0o600,flag:"wx"});
  const originalHistoryLength=(await readFile(history,"utf8")).length;
  await writeFile(inputHistory,"",{mode:0o600,flag:"wx"});
  const model=aiderModelName(input.protocol,input.model);
  const extra={api_base:input.protocol==="anthropic-messages"?input.baseUrl.replace(/\/v1$/i,""):input.baseUrl,api_key:`os.environ/${KEY}`};
  const settings=join(input.stateDir,"aider-model-settings.json"),metadata=join(input.stateDir,"aider-model-metadata.json"),config=join(input.stateDir,"aider-config.json"),empty=join(input.stateDir,"aider-empty.env");
  const definitions=input.models.map(m=>({name:aiderModelName(input.protocol,m.id),edit_format:"whole",use_repo_map:true,weak_model_name:aiderModelName(input.protocol,m.id),editor_model_name:aiderModelName(input.protocol,m.id),extra_params:extra}));
  await writeFile(settings,JSON.stringify([...definitions,{name:"aider/extra_params",extra_params:extra}]),{mode:0o600,flag:"wx"});
  await writeFile(metadata,JSON.stringify(Object.fromEntries(input.models.map(m=>[aiderModelName(input.protocol,m.id),{
    ...(m.contextWindow?{max_input_tokens:m.contextWindow}:{}),...(m.maxOutputTokens?{max_output_tokens:m.maxOutputTokens,max_tokens:m.maxOutputTokens}:{}),
    litellm_provider:input.protocol==="anthropic-messages"?"anthropic":"openai",mode:"chat",
    supports_vision:m.inputModalities?.includes("image")??false,
  }]))),{mode:0o600,flag:"wx"});
  // Keep effective home/Git-root/project UI, instruction and repository preferences. Authority,
  // credentials, history and startup controls are owned by this launch.
  const ignored=new Set(`model weak-model editor-model openai-api-key anthropic-api-key openai-api-base openai-api-type openai-api-version openai-api-deployment-id openai-organization-id set-env api-key alias config env-file model-settings-file model-metadata-file input-history-file chat-history-file llm-history-file restore-chat-history load analytics analytics-log analytics-posthog-host analytics-posthog-project-api-key analytics-disable check-update show-release-notes`.split(" "));
  const preserved=Object.fromEntries(Object.entries(global).filter(([key])=>!ignored.has(key)&&!startup.includes(key)));
  await writeFile(config,JSON.stringify({...preserved,model,"weak-model":model,"editor-model":model,"model-settings-file":settings,"model-metadata-file":metadata,"env-file":empty,"input-history-file":inputHistory,"chat-history-file":history,"llm-history-file":"","restore-chat-history":parsed.restore,"load":"","analytics":false,"check-update":false,"show-release-notes":false,"openai-api-key":"","anthropic-api-key":"","openai-api-base":input.baseUrl,"openai-api-type":"","openai-api-version":"","openai-api-deployment-id":"","openai-organization-id":""}),{mode:0o600,flag:"wx"});
  await writeFile(empty,"",{mode:0o600,flag:"wx"});
  // One explicit alias suppresses inherited append-list aliases. A random
  // unused name avoids parsing provider IDs containing colons as alias syntax.
  const aliases=["--alias",`switcher-${id}:${model}`];
  let cleaned=false;
  return {executable:input.executable??"aider",args:["--config",config,"--model",model,"--weak-model",model,"--editor-model",model,"--set-env","PYTHON_DOTENV_DISABLED=1","--api-key","SWITCHER_UNUSED=unused",...aliases,...parsed.args],
    env:{HOME:home,XDG_CONFIG_HOME:join(home,"config"),XDG_CACHE_HOME:join(home,"cache"),XDG_DATA_HOME:join(home,"data"),PYTHON_DOTENV_DISABLED:"1",LITELLM_LOCAL_MODEL_COST_MAP:"True",[KEY]:input.credential!,[input.protocol==="anthropic-messages"?"ANTHROPIC_API_KEY":"OPENAI_API_KEY"]:input.credential!},
    configPaths:[config,settings,metadata,empty,gitConfig],warnings:[
      ...(input.protocol==="openai-responses"?["Aider 0.86.2 with LiteLLM 1.81.10 uses buffered Responses requests even when native streaming is requested; incremental upstream Responses output is unavailable through this adapter."]:[]),
      "Aider uses native file context and whole-file edits; it does not expose an autonomous file-read function tool. The provider must follow Aider's edit format.",
      "Aider has no session ID: --restore-chat-history continues the last closed conversation for this profile in a new independent transcript. Concurrent launches never share writable history; diagnostic-only runs do not replace conversation history.",
      "Aider receives the full provider catalog under native protocol-prefixed model names; /models also lists built-in definitions. Models outside this launch catalog are rejected by the bridge.",
      "Aider preserves ordinary project configuration and global UI/repository preferences. Startup conflicts fail preflight; dotenv, provider settings and global model overrides are isolated. Do not concurrently change native startup configuration during launch.",
    ],cleanup:async()=>{
      if(cleaned)return;cleaned=true;
      await historyFile(history);
      if(!/^#### /m.test((await readFile(history,"utf8")).slice(originalHistoryLength)))return;
      const pending=join(sessions,`${id}.latest.json`);await writeFile(pending,JSON.stringify({id}),{mode:0o600,flag:"wx"});await rename(pending,join(sessions,"latest.json"));
    }};
}
