import {createHash} from "node:crypto";
import {mkdir,writeFile,stat} from "node:fs/promises";
import {isAbsolute,join} from "node:path";
import {Database} from "bun:sqlite";
import {kiloSettings,kiloConfigText} from "./kilo-config";
import {endpoint} from "./domain";
import {childEnvironment} from "./harness-environment";
import type {HarnessLaunchInput,PreparedLaunch} from "./harness-types";
const KEY="SWITCHER_HARNESS_API_KEY";

export function validateKiloArgs(args:string[]){
 const reserved=new Set(["--model","-m","--attach","--password","-p","--username","-u","--hostname","--port","--mdns","--mdns-domain","--cors","--dir","--worktree","--cloud-fork","--share","--command","--profile","--provider","--api-key","--config","--config-dir","--auth","--login"]);
 const values=new Set(["--session","-s","--prompt","--agent","--variant","--log-level","--replay-limit","--format","-f","--file","--title"]);
 const booleans=new Set(["--continue","-c","--fork","--pure","--print-logs","--mini","--no-replay","--thinking","--interactive","--verbose","--help","-h"]);
 for(let i=0;i<args.length;i++){
  const arg=args[i]; if(arg==="--") break;
  const equals=arg.indexOf("="),flag=equals<0?arg:arg.slice(0,equals);
  if(reserved.has(flag)||/^-m.+/.test(arg)) throw new Error("Kilo provider, model, endpoint, authentication overrides are reserved by the launch profile; update the profile instead.");
  if(equals<0&&values.has(flag)&&args[i+1]!==undefined&&!args[i+1].startsWith("-")) i++;
  if(equals<0&&arg.startsWith("-")&&!arg.startsWith("--")&&arg.length>2){for(let j=1;j<arg.length;j++){const short=`-${arg[j]}`;if(reserved.has(short)||short==="-m"||short==="-p"||short==="-u")throw new Error("Kilo provider, model, endpoint, authentication overrides are reserved by the launch profile; update the profile instead.");if(short==="-s"||short==="-f")break;}}
 }
 if(args[0]==="models"){
  for(let i=1;i<args.length;i++){const arg=args[i],equals=arg.indexOf("="),flag=equals<0?arg:arg.slice(0,equals);if(!arg.startsWith("-"))throw new Error("Kilo models is scoped to the selected provider; use --verbose to inspect its full catalog.");if(reserved.has(flag)||values.has(flag)&&equals<0){if(reserved.has(flag))throw new Error("Kilo models is scoped to the selected provider; use --verbose to inspect its full catalog.");if(equals<0)i++;continue;}if(!booleans.has(flag)||flag==="--continue"||flag==="-c"||flag==="--fork"||flag==="--thinking"||flag==="--interactive")throw new Error("Kilo models is scoped to the selected provider; use --verbose to inspect its full catalog.");}
 }
}

/** Validate native policy and instruction inputs without credentials or generated files. */
export async function validateKiloConfiguration(cwd:string,args:string[]=[]):Promise<void>{
 validateKiloArgs(args);
 await kiloSettings(cwd,cwd,childEnvironment(),{writeInstructions:false});
}

export async function prepareKilo(input:HarnessLaunchInput,providerBaseUrl:string):Promise<PreparedLaunch>{
 if(input.protocol==="gemini-generate-content") throw new Error("Kilo is incompatible with this protocol.");
 const args=[...(input.args??[])];validateKiloArgs(args);
 const authority=endpoint(input.baseUrl);
 const providerID="switcher-"+createHash("sha256").update(authority+input.protocol).digest("hex").slice(0,12),model=`${providerID}/${input.model}`;
 const sessionDir=input.sessionDir??join(input.stateDir,"sessions");
 const dbPath=join(sessionDir,"data","kilo","kilo.db");
 if(await stat(dbPath).then(()=>true,e=>{if(e.code==="ENOENT")return false;throw e;})){
  let db:Database|undefined;try{db=new Database(dbPath,{readonly:true,create:false});if(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='account_state'").get()&&db.query("SELECT active_account_id FROM account_state WHERE active_account_id IS NOT NULL LIMIT 1").get())throw new Error("active account");if(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='control_account'").get()&&db.query("SELECT active FROM control_account WHERE active = 1 LIMIT 1").get())throw new Error("legacy active account");}
  catch{throw new Error("Kilo session data has active account configuration or cannot be checked safely; use a separate Switcher profile before launching.");}finally{db?.close();}
 }
 const settings=await kiloSettings(input.cwd,input.stateDir,childEnvironment());
 if(Array.isArray(settings.config.enabled_providers)&&!settings.config.enabled_providers.includes(providerID)||Array.isArray(settings.config.disabled_providers)&&settings.config.disabled_providers.includes(providerID))throw new Error("Kilo native provider policy denies this Switcher provider; update that policy before launching.");
 const env:Record<string,string>={HOME:join(input.stateDir,"kilo-home"),TMPDIR:join(input.stateDir,"tmp"),XDG_CONFIG_HOME:join(input.stateDir,"config"),XDG_CACHE_HOME:join(input.stateDir,"cache"),XDG_STATE_HOME:join(input.stateDir,"state"),XDG_DATA_HOME:join(sessionDir,"data"),KILO_NO_DAEMON:"1",KILO_AUTH_CONTENT:"{}",KILO_PURE:"1",KILO_DISABLE_PROJECT_CONFIG:"true",KILO_DISABLE_MODELS_FETCH:"true"};
 await Promise.all(Object.entries(env).filter(([key])=>key==="HOME"||key==="TMPDIR"||key.startsWith("XDG_")).map(([,path])=>mkdir(path,{recursive:true,mode:0o700})));
 const globalDir=join(env.XDG_CONFIG_HOME,"kilo");await mkdir(globalDir,{mode:0o700});
 const globalFile=join(globalDir,"kilo.json");await writeFile(globalFile,kiloConfigText(settings.global),{mode:0o600,flag:"wx"});
 const npm={"anthropic-messages":"@ai-sdk/anthropic","openai-responses":"@ai-sdk/openai","openai-chat":"@ai-sdk/openai-compatible"}[input.protocol];
 const config={...settings.config,model,small_model:model,subagent_model:model,enabled_providers:[providerID],disabled_providers:[],instructions:settings.instructions,share:"disabled",provider:{[providerID]:{name:"Switcher",npm,options:{baseURL:providerBaseUrl,apiKey:"generated at serialization"},whitelist:input.models.map(m=>m.id),models:Object.fromEntries(input.models.map(m=>[m.id,{
  id:m.id,name:m.name,tool_call:m.supportedParameters?.includes("tools")??true,modalities:{input:m.inputModalities??["text"],output:m.outputModalities??["text"]},...(m.contextWindow&&m.maxOutputTokens?{limit:{context:m.contextWindow,output:m.maxOutputTokens}}:{}),
 }]))}}};
 const text=kiloConfigText(config,providerID,KEY),file=join(input.stateDir,"kilo.json");await writeFile(file,text,{mode:0o600,flag:"wx"});
 // CONTENT is native local policy provenance; only the selected provider/model
 // and a whitelist of captured policy/prompts can reach the native loader.
 env.KILO_CONFIG_CONTENT=text;env[KEY]=input.credential??"switcher-local-no-auth";
 const native=args[0]==="run"?["run","--model",model,...args.slice(1)]:args[0]==="models"?["models",providerID,...args.slice(1)]:["--model",model,...args];
 return {executable:input.executable??"kilo",args:native,env,configPaths:[file,globalFile,...settings.instructions.filter(isAbsolute)],warnings:["Kilo uses an isolated per-launch home/config and profile-specific durable sessions. Supported native permissions, agent prompts and instructions are captured at launch; provider overrides, plugins and other customization are excluded. Global configuration changes made in this isolated launch are temporary.","Kilo instruction variables, remote instruction URLs, legacy TOML, native sandbox policies and system-managed configuration require native preparation outside Switcher; unsupported policy forms stop the launch.","Kilo receives an ephemeral Switcher bridge token; trusted project MCP processes remain enabled and may use this scoped bridge capability. This adapter does not claim a complete MCP sandbox."]};
}
