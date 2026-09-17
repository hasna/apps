import {writeFile} from "node:fs/promises";
import {join,isAbsolute} from "node:path";
import {privateDirectory} from "./runtime";
import {nativeHome,readNativeText,readNativeSettings,rejectNativeRouting,writeNativeSettings,durableNativeDirectory} from "./native-cli-settings";
import type {HarnessLaunchInput,PreparedLaunch} from "./harness-types";

const routing=new Set(["model","provider","llmprovider","byok","apikey","auth","baseurl","litellmurl","configlocation","configdefaultlocations","modellocation","modeldefaultlocations","cachedir","juniehome","primarymodel","fastermodel","flags"]);
export async function validateJunieConfiguration(cwd:string,env:NodeJS.ProcessEnv=process.env) {
 const home=env.JUNIE_HOME??join(nativeHome(env),".junie");if(!isAbsolute(home))throw new Error("Junie requires an absolute native home.");
 const configs=[],settings=[];
 for(const root of [...new Set([home,join(cwd,".junie")])]) {
  const config=await readNativeSettings(join(root,"config.json")),setting=await readNativeSettings(join(root,"settings.json"));
  rejectNativeRouting(config,routing);rejectNativeRouting(setting,routing);configs.push(config);settings.push(setting);
 }
 return {configs,settings,allowlist:await readNativeText(join(home,"allowlist.json")),globalInstructions:await readNativeText(join(home,"AGENTS.md"))};
}
export async function prepareJunie(input:HarnessLaunchInput):Promise<PreparedLaunch> {
 const original=await validateJunieConfiguration(input.cwd);
 const home=join(input.stateDir,"junie-home"),models=join(home,"models"),cache=join(input.sessionDir??join(input.stateDir,"sessions"),"junie-cache");
 for(const path of [home,models,cache])await privateDirectory(path);
 await durableNativeDirectory(home,join(input.sessionDir??join(input.stateDir,"sessions"),"junie"),"sessions");
 const preservedPaths:string[]=[];
 for(const [name,content] of [["allowlist.json",original.allowlist],["AGENTS.md",original.globalInstructions]])if(content!==undefined){const path=join(home,name!);await writeFile(path,content,{mode:0o600,flag:"wx"});preservedPaths.push(path);}
 const apiType=input.protocol==="openai-chat"?"OpenAICompletion":input.protocol==="openai-responses"?"OpenAIResponses":"Anthropic";
 const suffix=input.protocol==="openai-chat"?"/chat/completions":input.protocol==="openai-responses"?"/responses":"/messages";
 const model=(id:string)=>({id,displayName:id,providerName:"Switcher",baseUrl:input.baseUrl+suffix,apiType,apiKey:"${SWITCHER_HARNESS_API_KEY}",maxContextLength:input.models.find(m=>m.id===id)?.contextWindow??128000});
 const profile=await writeNativeSettings(join(models,"switcher.json"),{...model(input.model),fasterModel:model(input.compiledPolicy!.roles.fast)});
 const config=await writeNativeSettings(join(home,"config.json"),Object.assign({},...original.configs,{"auto-update":false}));
 const settings=await writeNativeSettings(join(home,"settings.json"),Object.assign({},...original.settings));
 return {executable:input.executable??"junie",args:["--skip-update-check","--config-default-locations","false","--config-location",config,"--model-default-locations","false","--model-location",models,"--model","custom:switcher","--cache-dir",cache,...input.args??[]],env:{JUNIE_HOME:home,SWITCHER_HARNESS_API_KEY:input.credential!},configPaths:[profile,config,settings,...preservedPaths],warnings:[
  "Junie build 3196.5 uses an isolated custom model profile and durable profile cache and sessions. The primary and faster models use the managed gateway; inherited routing configuration fails preflight.",
  "Native permissions, project guidelines and native noninteractive trust behavior remain active. User and project settings, ordered global permission rules and global AGENTS.md are snapshotted; global authentication is not imported.",
 ]};
}
