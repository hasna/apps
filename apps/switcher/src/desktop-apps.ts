import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { Fault } from "./domain";

export type ChatGPTInstallation = {path:string; executable:string; codexExecutable:string; bundleId:string; version:string};
export type DesktopHost = {
  platform:string; home:string;
  run(command:string,args:string[]):Promise<string>;
  executable(path:string):Promise<boolean>;
  isDirectory(path:string):Promise<boolean>;
};
const execute = promisify(execFile);
const host: DesktopHost = {
  platform:process.platform,home:homedir(),
  async run(command,args) {
    const {stdout} = await execute(command,args,{encoding:"utf8",timeout:8_000,maxBuffer:64*1024,env:{PATH:"/usr/bin:/bin",HOME:homedir()}});
    return stdout.trim();
  },
  async executable(path) {try {await access(path,constants.X_OK);return (await stat(path)).isFile();}catch{return false;}},
  async isDirectory(path) {try{return (await stat(path)).isDirectory();}catch{return false;}},
};

/** Detect the unified app or its former Codex name, without launching it. */
export async function detectChatGPTApp(appPath?:string, system:DesktopHost=host):Promise<ChatGPTInstallation> {
  if(system.platform!=="darwin")throw new Fault(422,"unsupported_platform","ChatGPT provider launches currently require the macOS desktop app.");
  let candidates:string[];
  if(appPath!==undefined) candidates=[appPath];
  else {
    candidates=["ChatGPT.app","Codex.app"].flatMap(name=>[join(system.home,"Applications",name),join("/Applications",name)]);
    try {
      const found=await system.run("/usr/bin/osascript",["-l","JavaScript","-e",'ObjC.import("AppKit"); const url = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier("com.openai.codex"); url.isNil() ? "" : ObjC.unwrap(url.path);']);
      if(found)candidates.push(found);
    }catch{/* Standard locations still work if Launch Services is unavailable. */}
  }
  for(const path of new Set(candidates)) {
    if(!isAbsolute(path)||!path.endsWith(".app")||!await system.isDirectory(path))continue;
    const plist=join(path,"Contents/Info.plist");
    const field=(name:string)=>system.run("/usr/bin/plutil",["-extract",name,"raw","-o","-",plist]);
    try {
      const bundleId=await field("CFBundleIdentifier");
      if(bundleId!=="com.openai.codex")continue;
      const name=await field("CFBundleExecutable"),version=await field("CFBundleShortVersionString");
      if(!/^[A-Za-z0-9 _-]+$/.test(name))continue;
      const executable=join(path,"Contents/MacOS",name),codexExecutable=join(path,"Contents/Resources/codex");
      if(await system.executable(executable)&&await system.executable(codexExecutable))return{path,executable,codexExecutable,bundleId,version};
    }catch{/* Invalid/incomplete app bundles are never executed. */}
  }
  throw new Fault(404,"app_not_installed","Install the current ChatGPT/Codex macOS app or use --app-path with its absolute .app path. Legacy ChatGPT Classic cannot run custom Codex providers.");
}
