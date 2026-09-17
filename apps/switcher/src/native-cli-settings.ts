import {lstat,readFile,writeFile,symlink} from "node:fs/promises";
import {join,isAbsolute} from "node:path";
import {homedir} from "node:os";
import {privateDirectory} from "./runtime";

export function nativeHome(env:NodeJS.ProcessEnv):string {
 const home=env.HOME??homedir();if(!isAbsolute(home))throw new Error("Native CLI requires an absolute home.");return home;
}
export async function readNativeSettings(path:string):Promise<Record<string,any>> {
 let file;try{file=await lstat(path);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {};throw error;}
 if(!file.isFile()||file.size>1024*1024)throw new Error("Native CLI settings must be a bounded regular file.");
 let value;try{value=JSON.parse(await readFile(path,"utf8"));}catch{throw new Error("Native CLI settings must contain a JSON object.");}
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Native CLI settings must contain a JSON object.");
 return value;
}
export function rejectNativeRouting(value:unknown,keys:ReadonlySet<string>):void {
 if(!value||typeof value!=="object")return;
 for(const [key,item] of Object.entries(value)) {
  const normalized=key.toLowerCase().replace(/[-_]/g,"");
  if(keys.has(normalized))throw new Error("Native CLI routing configuration conflicts with the Switcher launch profile.");
  rejectNativeRouting(item,keys);
 }
}
export async function writeNativeSettings(path:string,value:unknown):Promise<string> {
 await writeFile(path,JSON.stringify(value,null,2)+"\n",{mode:0o600,flag:"wx"});return path;
}
export async function durableNativeDirectory(root:string,target:string,name:string):Promise<void> {
 const directory=join(target,name);await privateDirectory(directory);await symlink(directory,join(root,name),"dir");
}

export async function readNativeText(path:string):Promise<string|undefined> {
 let file;try{file=await lstat(path);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw error;}
 if(!file.isFile()||file.size>1024*1024)throw new Error("Native CLI policy and instructions must be bounded regular files.");
 const text=await readFile(path,"utf8");if(Buffer.byteLength(text)>1024*1024)throw new Error("Native CLI policy and instructions exceed their size limit.");return text;
}
