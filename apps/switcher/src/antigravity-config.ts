import {join} from "node:path";
import {readFile,writeFile,lstat} from "node:fs/promises";
import {privateDirectory} from "./runtime";
import {nativeHome,readNativeSettings,rejectNativeRouting,writeNativeSettings,durableNativeDirectory} from "./native-cli-settings";
import type {HarnessLaunchInput,PreparedLaunch} from "./harness-types";

// Observed in the pinned 1.2.5 native request stream before the main turn.
export const antigravityHelperModel="gemini-3.1-flash-lite-preview";
const routing=new Set(["custommodels","custommodelsconfig","apikey","baseurl","modelconfig","modelconfigoverrides"]);
export async function validateAntigravityConfiguration(cwd:string,env:NodeJS.ProcessEnv=process.env) {
 const home=nativeHome(env),paths=[join(home,".gemini","config","config.json"),join(home,".gemini","antigravity-cli","settings.json"),join(cwd,".gemini","antigravity-cli","settings.json")];
 const layers=[];
 for(const path of [...new Set(paths)]){const settings=await readNativeSettings(path);rejectNativeRouting(settings,routing);layers.push(settings);}
 // Native CLI settings override shared app settings. Project instructions stay
 // in the workspace; a project settings file is rejected to avoid false scope.
 if(cwd!==home&&Object.keys(layers.at(-1)??{}).length)throw new Error("Antigravity project settings are not a supported native routing or permission source.");
 return {home,settings:Object.assign({},...layers)};
}
export async function prepareAntigravity(input:HarnessLaunchInput):Promise<PreparedLaunch> {
 const original=await validateAntigravityConfiguration(input.cwd);
 const home=join(input.stateDir,"antigravity-home"),gemini=join(home,".gemini"),dir=join(gemini,"antigravity-cli"),shared=join(gemini,"config");
 for(const path of [home,gemini,dir,shared])await privateDirectory(path);
 const durable=join(input.sessionDir??join(input.stateDir,"sessions"),"antigravity");await privateDirectory(durable);
 for(const name of ["conversations","brain","annotations","knowledge","cache"])await durableNativeDirectory(dir,durable,name);
 await durableNativeDirectory(shared,join(durable,"shared"),"projects");
 const settings={...original.settings,modelProvider:"gemini",customModelsConfig:{customModels:{switcher:{modelName:input.model}}}};
 const path=await writeNativeSettings(join(dir,"settings.json"),settings);
 // Preserve global instructions without inheriting provider auth, plugins or
 // shared app state. Project rules/skills are still discovered by the native CLI.
 const context=join(original.home,".gemini","GEMINI.md");
 try{const file=await lstat(context);if(!file.isFile()||file.size>1024*1024)throw new Error("Antigravity global instructions must be a bounded regular file.");await writeFile(join(gemini,"GEMINI.md"),await readFile(context),{mode:0o600,flag:"wx"});}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
 return {executable:input.executable??"agy",args:["--add-dir",input.cwd,"--model","switcher",...(input.args??[])],env:{HOME:home,GEMINI_API_KEY:input.credential!,GOOGLE_GEMINI_BASE_URL:input.baseUrl.replace(/\/v1beta\/?$/i,"")},configPaths:[path],warnings:[
  "Antigravity 1.2.5 uses an isolated native home, preserved permission settings and durable profile conversations. Native project instructions and permissions remain active.",
  "The native Flash Lite helper is routed to the policy fast model (main by default). Other models remain subject to the launch policy. Global plugins, authentication and shared app state are not imported; ~ in native tools resolves to the private home.",
 ]};
}
