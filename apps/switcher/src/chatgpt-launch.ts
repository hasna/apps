import { createHash } from "node:crypto";
import { writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Fault } from "./domain";
import { privateDirectory } from "./runtime";
import { codexDirectoryGuard } from "./codex-native";
import { HarnessSettlementError } from "./harness-process";
import { codexRoutingKeys, renderCodexAgentToml } from "./codex-model-policy";
import type { PreparedLaunch } from "./harness-types";
import type { ChatGPTInstallation } from "./desktop-apps";
import { safeDesktopRead as safeRead,writeDesktopPrivate as writePrivate,desktopLease } from "./desktop-state";
import { CODEX_INSTRUCTION_KEYS, nativeStateEnvironment, projectNativeState, type NativeState } from "./native-state";

type Dict=Record<string,unknown>;
const object=(value:unknown):value is Dict=>value!==null&&typeof value==="object"&&!Array.isArray(value);
function merge(base:Dict,overlay:Dict):Dict {
  const result={...base};
  for(const [key,value] of Object.entries(overlay)) result[key]=object(value)&&object(result[key])?merge(result[key] as Dict,value):value;
  return result;
}
function clearSwitcherModelState(config:Dict):void {
  for(const key of [...codexRoutingKeys,"review_model","sqlite_home","model_reasoning_effort","cli_auth_credentials_store","forced_login_method",...CODEX_INSTRUCTION_KEYS])delete config[key];
  if(object(config.agents)) {
    for(const key of ["default_subagent_model","default_subagent_reasoning_effort","default_subagent_reasoning_summary"])delete config.agents[key];
    for(const [name,value] of Object.entries(config.agents))if(object(value)){
      for(const key of ["model","model_provider","provider","config_file"])delete value[key];
      if(!Object.keys(value).length)delete config.agents[name];
    }
    if(!Object.keys(config.agents).length)delete config.agents;
  }
  if(object(config.memories)) {
    delete config.memories.extract_model;delete config.memories.consolidation_model;
    if(!Object.keys(config.memories).length)delete config.memories;
  }
}
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const quote=(value:string)=>`'${value.replaceAll("'","'\"'\"'")}'`;

/** Separate desktop state from the signed-in app. The upstream credential stays
 * in the parent gateway. SQLite releases the profile lease even after a crash. */
export async function prepareChatGPTLaunch(native:PreparedLaunch,app:ChatGPTInstallation,stateDir:string,sessionDir:string,sharedState?:NativeState):Promise<PreparedLaunch> {
  if(sharedState&&sharedState.tool!=="codex")throw new Fault(422,"native_state_tool","ChatGPT requires the canonical Codex corpus.");
  await privateDirectory(sessionDir);
  const home=join(sessionDir,"codex"),userData=join(sessionDir,"electron");
  await privateDirectory(home);await privateDirectory(userData);
  const release=await desktopLease(join(sessionDir,"launch.sqlite"));
  const settlementDirectory=join(sessionDir,"codex-bridges");
  let guardSettlement: (()=>Promise<void>)|undefined;
  let released=false,authText:string|undefined;
  const authPath=join(home,"auth.json"),receiptPath=join(home,".switcher-auth.sha256");
  const assertSettled=async()=>{
    if(!guardSettlement)return;
    try {await guardSettlement();if((await readdir(settlementDirectory)).length)throw new HarnessSettlementError();}
    catch {throw new HarnessSettlementError();}
  };
  const cleanup=async()=>{
    if(released)return;
    try {await assertSettled();}
    catch(error){try{await native.closeTransport?.();}finally{throw error;}}
    released=true;
    try {
      if(authText!==undefined&&await safeRead(authPath)===authText) {
        await rm(authPath,{force:true});await rm(receiptPath,{force:true});
      }
    }finally{release();}
  };
  try {
    if(sharedState){
      await privateDirectory(settlementDirectory);
      guardSettlement=await codexDirectoryGuard(settlementDirectory,true);
      // A crashed or uncertain earlier bridge may still own these auth files.
      await assertSettled();
      await projectNativeState(sharedState,home);
    }
    const settings:string[]=[];
    for(let i=0;i<native.args.length;i+=2){
      if(native.args[i]!=="-c"||typeof native.args[i+1]!=="string")throw new Fault(400,"desktop_arguments","Desktop launches accept provider/model settings, not native CLI commands.");
      if(!sharedState?.sqliteHome||!native.args[i+1].startsWith("sqlite_home="))settings.push(native.args[i+1]);
    }
    settings.push('cli_auth_credentials_store="file"','forced_login_method="api"');
    if(sharedState?.sqliteHome)settings.push(`sqlite_home=${JSON.stringify(sharedState.sqliteHome)}`);
    if(!settings.some(setting=>setting.startsWith("approval_policy=")))settings.push('approval_policy="on-request"');
    if(!settings.some(setting=>setting.startsWith("sandbox_mode=")))settings.push('sandbox_mode="workspace-write"');
    const configPath=join(home,"config.toml");
    const previousAuth=await safeRead(authPath),previousReceipt=await safeRead(receiptPath);
    if(previousAuth!==undefined&&previousReceipt!==digest(previousAuth))
      throw new Fault(409,"desktop_auth_changed","This isolated desktop profile contains authentication that Switcher did not create. Sign out of that provider profile before launching it again; Switcher will not overwrite it.");
    let existing:Dict={};
    try {existing=Bun.TOML.parse(await safeRead(configPath)??"") as Dict;}
    catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw new Fault(422,"desktop_config_invalid","The desktop profile config cannot be read safely.");}
    if(sharedState) {
      if(["profile","profiles","include"].some(key=>existing[key]!==undefined))throw new Fault(409,"desktop_config_routing","The private desktop overlay contains profile/include routing that cannot be reconciled with shared native state. Review the overlay before launching.");
      clearSwitcherModelState(existing);Object.assign(existing,sharedState.instructions);
    }
    const config=merge(existing,Bun.TOML.parse(settings.join("\n")) as Dict);
    await writePrivate(configPath,renderCodexAgentToml(config));
    const key=native.env.SWITCHER_HARNESS_API_KEY;
    if(!key)throw new Fault(500,"desktop_auth_missing","Desktop preparation did not receive a scoped gateway credential.");
    authText=JSON.stringify({OPENAI_API_KEY:key})+"\n";
    await writePrivate(receiptPath,digest(authText));
    await writePrivate(authPath,authText);
    const wrapper=join(stateDir,"chatgpt-codex");
    const overrides=settings.flatMap(setting=>["-c",setting]);
    let bridge = "";
    if(sharedState) {
      const entry = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./codex-state-bridge.ts" : "../codex-state-bridge.js", import.meta.url));
      const ownedKeys = new Set(["model_provider","model_providers","model_catalog_json","review_model","agents","memories","sqlite_home"]);
      const routing = Object.fromEntries(Object.entries(config).filter(([key])=>ownedKeys.has(key)));
      if(typeof config.model!=="string")throw new Fault(500,"desktop_model_missing","Desktop preparation did not receive its selected model.");
      bridge = `if [ "\${1-}" = app-server ]; then\n  exec ${[process.execPath,entry,"--settlement-dir",settlementDirectory,app.codexExecutable,config.model,JSON.stringify(routing)].map(quote).join(" ")} "$@" ${overrides.map(quote).join(" ")}\nfi\n`;
    }
    // The app also uses CODEX_CLI_PATH for `sandbox ... -- node kernel.js`.
    // Appending model options there passes them to the kernel, not Codex, and
    // breaks browser/computer tools. Preserve the helper's own sandbox policy.
    await writeFile(wrapper,`#!/bin/sh\nset -eu\nunset OPENAI_API_KEY CODEX_API_KEY CODEX_ACCESS_TOKEN OPENAI_BASE_URL OPENAI_ORG_ID OPENAI_ORGANIZATION OPENAI_PROJECT_ID\nexport CODEX_HOME=${quote(home)}\nif [ "\${1-}" = sandbox ]; then\n  exec ${quote(app.codexExecutable)} "$@"\nfi\n${bridge}exec ${quote(app.codexExecutable)} "$@" ${overrides.map(quote).join(" ")}\n`,{mode:0o700,flag:"wx"});
    return {...native,executable:app.executable,args:[`--user-data-dir=${userData}`],
      env:{...native.env,...(sharedState?nativeStateEnvironment(sharedState):{}),CODEX_HOME:home,CODEX_ELECTRON_USER_DATA_PATH:userData,CODEX_CLI_PATH:wrapper,CODEX_APP_SERVER_FORCE_CLI:"1",CODEX_APP_SERVER_USE_LOCAL_DAEMON:"0"},
      configPaths:[...native.configPaths,configPath,wrapper],
      warnings:[...native.warnings,`ChatGPT provider state is isolated.${sharedState?" Allowlisted local sessions and instructions use the shared corpus across providers by default.":""} Local Codex conversations use this provider; ChatGPT cloud Chat/Work and account-only features are not redirected. Keep Switcher running until you quit this app instance.`],
      cleanup:async()=>{await assertSettled().catch(async error=>{try{await native.closeTransport?.();}finally{throw error;}});try{await native.cleanup?.();}finally{await cleanup();}},
    };
  }catch(error){
    // No helper can have started before preparation returns. A stale receipt
    // still fences the next launch, but this failed admission owns no live lease.
    if(error instanceof HarnessSettlementError&&authText===undefined){released=true;release();try{await native.closeTransport?.();}finally{throw error;}}
    await cleanup();throw error;
  }
}
