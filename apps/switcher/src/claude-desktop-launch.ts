import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access,rm,writeFile } from "node:fs/promises";
import { homedir,userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Fault,validateHarnessProvider } from "./domain";
import { privateDirectory } from "./runtime";
import { compileModelPolicy } from "./model-policy";
import { createInferenceGateway } from "./inference-gateway";
import { desktopLease,safeDesktopRead,writeDesktopPrivate } from "./desktop-state";
import type { ClaudeDesktopInstallation } from "./desktop-apps";
import type { HarnessLaunchInput,PreparedLaunch } from "./harness-types";

const execute=promisify(execFile);
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
export const claudeDesktopDataDirectory=()=>join(homedir(),"Library/Application Support/Claude-3p");
type DesktopSystem={userData:string;assertAvailable:()=>Promise<void>};

async function assertAvailable(userData:string) {
  for(const path of [join("/Library/Managed Preferences",userInfo().username,"com.anthropic.claudefordesktop.plist"),"/Library/Managed Preferences/com.anthropic.claudefordesktop.plist"])
    if(await access(path).then(()=>true,()=>false))throw new Fault(409,"desktop_managed","Claude has managed preferences. Configure its gateway through the administrator's policy; Switcher will not override it.");
  let openFiles:string;
  try {openFiles=(await execute("/usr/sbin/lsof",["-n","-P","-Fpn","-a","-u",String(process.getuid?.()),"-c","Claude"],{encoding:"utf8",maxBuffer:8*1024*1024,timeout:8000})).stdout;}
  catch(error){if((error as {code?:number}).code===1)return;throw new Fault(409,"desktop_process_check","Could not check whether Claude's third-party profile is already running.");}
  if(openFiles.split("\n").some(line=>line.startsWith("n"+userData+"/")))throw new Fault(409,"desktop_busy","Claude's third-party instance is already running. Quit that instance before changing its provider; the normal Claude instance can stay open.");
}

type Receipt={id:string;configHash:string;previousMeta:string|null;appliedMeta:string};
function metadata(text:string|undefined):Record<string,unknown>&{entries:Record<string,unknown>[]} {
  const value=text===undefined?{entries:[]}:JSON.parse(text);
  if(!value||typeof value!=="object"||Array.isArray(value)||!Array.isArray(value.entries)||value.entries.some((item:unknown)=>!item||typeof item!=="object"||Array.isArray(item)))
    throw new Fault(422,"desktop_config_invalid","Claude's configuration library metadata is invalid.");
  return value;
}

/** Use the vendor-supported local configuration library, preserving the prior
 * selection. The signed app rejects custom userData development overrides. */
export async function prepareClaudeDesktopLaunch(input:HarnessLaunchInput,app:ClaudeDesktopInstallation,sessionDir:string,system?:DesktopSystem):Promise<PreparedLaunch> {
  if(input.harness!=="claude")throw new Fault(422,"desktop_harness","Claude desktop requires the Claude Messages adapter.");
  validateHarnessProvider("claude",{protocol:input.protocol,authStyle:input.authStyle??"bearer"});
  if(input.args?.length||input.reasoning||input.dangerouslyBypassApprovalsAndSandbox)throw new Fault(400,"desktop_arguments","Claude desktop uses its own effort and permission controls; native CLI arguments and Codex-only launch controls are not accepted.");
  const version=app.version.split(".").map(Number);
  if(version.length<3||version.some(n=>!Number.isSafeInteger(n))||version[0]<1||(version[0]===1&&version[1]<52386))
    throw new Fault(422,"desktop_version","Claude desktop 1.52386.0 or newer is required for this verified gateway adapter.");
  const userData=system?.userData??claudeDesktopDataDirectory();
  const check=system?.assertAvailable??(()=>assertAvailable(userData));
  await check();await privateDirectory(userData);
  const library=join(userData,"configLibrary");await privateDirectory(library);
  const release=await desktopLease(join(library,".switcher-lease.sqlite"));
  const metaPath=join(library,"_meta.json"),receiptPath=join(library,".switcher-selection.json");
  let receipt:Receipt|undefined,gateway:ReturnType<typeof createInferenceGateway>|undefined,closed=false;
  const restore=async(record:Receipt)=>{
    if(!/^[a-f0-9-]{36}$/.test(record.id)||typeof record.configHash!=="string"||typeof record.appliedMeta!=="string"||(record.previousMeta!==null&&typeof record.previousMeta!=="string"))
      throw new Fault(422,"desktop_config_invalid","Claude's Switcher recovery record is invalid.");
    const configPath=join(library,record.id+".json"),current=await safeDesktopRead(configPath);
    if(current!==undefined&&hash(current)!==record.configHash)throw new Fault(409,"desktop_config_changed","The Switcher Claude configuration was edited outside this launch. Switcher will preserve it; review the configuration library before relaunching.");
    const currentMeta=await safeDesktopRead(metaPath);
    if(currentMeta!==record.appliedMeta&&currentMeta!== (record.previousMeta??undefined))throw new Fault(409,"desktop_config_changed","Claude's selected configuration changed during this launch. Switcher will preserve the changed selection; review its configuration library before relaunching.");
    if(record.previousMeta===null)await rm(metaPath,{force:true});else await writeDesktopPrivate(metaPath,record.previousMeta);
    await rm(configPath,{force:true});await rm(receiptPath,{force:true});
  };
  const cleanup=async()=>{
    if(closed)return;closed=true;
    try {await gateway?.cleanup();if(receipt)await restore(receipt);}
    finally{release();}
  };
  try {
    const recovery=await safeDesktopRead(receiptPath);if(recovery)await restore(JSON.parse(recovery));
    const localConfig=await safeDesktopRead(join(userData,"claude_desktop_config.json"));
    if(localConfig&&JSON.parse(localConfig).deploymentMode==="1p")throw new Fault(409,"desktop_mode","Claude's third-party profile is set to standard account mode. Select third-party mode in Claude before launching this gateway.");
    await privateDirectory(sessionDir);
    const roles=input.modelPolicy?.roles;
    const targets={sonnet:input.model,opus:roles?.planning??input.model,haiku:roles?.fast??input.model};
    const aliases=Object.fromEntries(Object.entries(targets).map(([tier,model])=>["switcher/"+tier,model]));
    for(const [alias,target] of Object.entries(aliases))if(input.modelPolicy?.aliases?.[alias]&&input.modelPolicy.aliases[alias]!==target)
      throw new Fault(409,"desktop_alias_conflict","The model policy conflicts with Claude desktop's reserved switcher/sonnet, switcher/opus or switcher/haiku routing aliases.");
    const compiledPolicy=compileModelPolicy(input.model,input.models,{...input.modelPolicy,version:1,aliases:{...input.modelPolicy?.aliases,...aliases}});
    const catalogPath=join(input.stateDir,"claude-desktop-policy.json");
    await writeFile(catalogPath,JSON.stringify({policy:compiledPolicy,models:input.models}),{mode:0o600,flag:"wx"});
    gateway=createInferenceGateway({...input,compiledPolicy,catalogPath});
    const id=crypto.randomUUID(),configPath=join(library,id+".json");
    const config=JSON.stringify({inferenceProvider:"gateway",inferenceGatewayBaseUrl:gateway.baseUrl.replace(/\/v1$/,""),inferenceGatewayApiKey:gateway.token,inferenceGatewayAuthScheme:"bearer",modelDiscoveryEnabled:false,
      inferenceModels:Object.entries(targets).map(([tier,model])=>({name:"switcher/"+tier,labelOverride:model,anthropicFamilyTier:tier,isFamilyDefault:true}))});
    const previousMeta=await safeDesktopRead(metaPath);
    const meta=metadata(previousMeta);
    const appliedMeta=JSON.stringify({...meta,appliedId:id,entries:[...meta.entries,{id,name:`Switcher: ${input.providerId??"provider"} / ${input.model}`} ]});
    receipt={id,configHash:hash(config),previousMeta:previousMeta??null,appliedMeta};
    await writeDesktopPrivate(configPath,config);
    await writeDesktopPrivate(receiptPath,JSON.stringify(receipt));
    await writeDesktopPrivate(metaPath,appliedMeta);
    return {executable:app.executable,args:[],env:{CLAUDE_CONFIG_DIR:sessionDir},configPaths:[catalogPath,configPath],beforeLaunch:check,cleanup,
      warnings:[`Claude desktop gateway: ${input.providerId??"provider"} / ${input.model}. Uses the shared Claude-3p profile, separate from the normal Claude account. Quit this instance before switching providers; keep Switcher running until then. The previous configuration selection is restored on exit. Managed settings and native permissions remain authoritative.`]};
  }catch(error){try{await cleanup();}catch{/* Preserve the original preparation error and recovery receipt. */}throw error;}
}
