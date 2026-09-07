import {mkdir,open,realpath,readdir,stat,writeFile} from "node:fs/promises";
import {constants} from "node:fs";
import {dirname,isAbsolute,join,relative,resolve} from "node:path";
import {homedir} from "node:os";
import {randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {userInfo} from "node:os";
import {childEnvironment} from "./harness-environment";
import {parse,parseTree,type ParseError,type Node as JsonNode} from "jsonc-parser";
import {parseDocument} from "yaml";
import {z} from "zod";

type ObjectValue=Record<string,unknown>;
const object=(v:unknown):v is ObjectValue=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const own=(v:ObjectValue,k:string)=>Object.hasOwn(v,k);
const maxFileBytes=1024*1024,maxTotalBytes=8*1024*1024,maxFiles=256;
const inside=(root:string,path:string)=>{const rel=relative(root,path);return rel===""||(!isAbsolute(rel)&&rel!==".."&&!rel.startsWith("../"));};
function invalid(path:string,field:string):never{throw new Error(`Kilo cannot preserve ${field} in ${path}; use supported explicit policy and literal instructions.`);}
function record(v:unknown,p:string,f:string):ObjectValue{if(!object(v))invalid(p,f);return v;}
function string(v:unknown,p:string,f:string):string{if(typeof v!=="string")invalid(p,f);return v;}
function literal(v:string,p:string,f:string):string{if(/\{(?:env|file):/.test(v))invalid(p,`${f} variable reference`);return v;}
function merge(a:ObjectValue,b:ObjectValue):ObjectValue{const out={...a};for(const [k,v]of Object.entries(b)){Object.defineProperty(out,k,{value:object(v)&&object(out[k])?merge(out[k],v):v,enumerable:true,writable:true,configurable:true});}return out;}
function permission(value:unknown,path:string,home:string):ObjectValue{
 const source=typeof value==="string"?{"*":value}:record(value,path,"permission");const result:ObjectValue={};
 for(const [name,item]of Object.entries(source)){
  literal(name,path,"permission name");if(typeof item==="string"){if(!["allow","deny","ask"].includes(item))invalid(path,"permission action");result[name]=item;continue;}
  const rules=record(item,path,"permission rule"),out:ObjectValue={};
  for(const [pattern,effect]of Object.entries(rules)){literal(pattern,path,"permission pattern");if(!["allow","deny","ask"].includes(effect as string))invalid(path,"permission action");const expanded=pattern==="~"||pattern==="$HOME"?home:pattern.startsWith("~/")?join(home,pattern.slice(2)):pattern.startsWith("$HOME")?home+pattern.slice(5):pattern;out[expanded]=effect;}result[name]=out;
 }return result;
}
function rejectDuplicateKeys(node:JsonNode|undefined,path:string):void {
  if(!node)return;
  if(node.type==="object") {const names=new Set<string>();for(const property of node.children??[]){const name=property.children?.[0]?.value as string;if(names.has(name))invalid(path,"duplicate configuration key");names.add(name);}}
  for(const child of node.children??[])rejectDuplicateKeys(child,path);
}
function jsonc(text:string,path:string):ObjectValue {
  const errors:ParseError[]=[];const value:unknown=parse(text,errors,{allowTrailingComma:true});
  if(errors.length)invalid(path,"JSON/JSONC configuration");rejectDuplicateKeys(parseTree(text),path);
  return record(value,path,"configuration object");
}


/** Read native policies as data; native config inspection itself may write project files. */
export async function kiloSettings(cwd:string,stateDir:string,env:NodeJS.ProcessEnv=process.env,options:{writeInstructions?:boolean}={}){
 for(const name of ["HOME","XDG_CONFIG_HOME","KILO_CONFIG_DIR"])if(env[name]&&!isAbsolute(env[name]!))throw new Error(`Kilo requires an absolute ${name}.`);
 const home=resolve(env.HOME||homedir()),configRoot=join(env.XDG_CONFIG_HOME||join(home,".config"),"kilo");
 const exists=async(path:string)=>stat(path).then(()=>true,e=>{if(e.code==="ENOENT")return false;throw e;});
 const managed=process.platform==="darwin"?"/Library/Application Support/kilo":process.platform==="win32"?join(env.ProgramData||"C:\\ProgramData","kilo"):"/etc/kilo";
 const managedPaths=[... ["kilo.jsonc","kilo.json","opencode.jsonc","opencode.json"].map(name=>join(managed,name)),...(process.platform==="darwin"?[join("/Library/Managed Preferences",userInfo().username,"ai.opencode.managed.plist"),"/Library/Managed Preferences/ai.opencode.managed.plist"]:[])];
 for(const path of managedPaths)if(await exists(path))throw new Error("Kilo system-managed configuration cannot be isolated by this adapter; use its managed native interface separately.");
 if(await exists(join(configRoot,"config")))throw new Error("Kilo legacy TOML policy must be migrated with the native CLI before Switcher launch.");
 let root=resolve(cwd),primary:string|undefined;
 // Git's read-only metadata commands have no provider credentials and never run the native CLI or plugins.
 try{const exec=(args:string[])=>execFileSync("git",args,{cwd,env:childEnvironment(),timeout:3000,maxBuffer:65536,stdio:["ignore","pipe","ignore"]}).toString().trim();root=exec(["rev-parse","--show-toplevel"]);const listing=exec(["worktree","list","--porcelain","-z"]);const fields=listing.split("\0\0",1)[0].split("\0");const line=fields.find(v=>v.startsWith("worktree "));if(line&&!fields.includes("bare"))primary=line.slice(9);}catch{/* Unversioned projects are confined to cwd. */}
 root=await realpath(root);cwd=await realpath(cwd);if(!inside(root,cwd))root=cwd;
 const ancestry=(start:string,stop:string)=>{const out:string[]=[];for(let dir=start;;dir=dirname(dir)){out.push(dir);if(dir===stop||dirname(dir)===dir)break;}return out;};
 const ancestors=ancestry(cwd,root),enabled=!["1","true"].includes((env.KILO_DISABLE_PROJECT_CONFIG??"").toLowerCase());
  let files=0,total=0;
  const paths:string[]=[];
  async function read(path:string,optional=true):Promise<string|undefined> {
    let handle;try{handle=await open(path,constants.O_RDONLY|constants.O_NONBLOCK);}catch(error){if(optional&&(error as NodeJS.ErrnoException).code==="ENOENT")return;throw new Error(`Kilo cannot read policy or instructions at ${path}.`);}
    try {
      const info=await handle.stat();if(!info.isFile()||info.size>maxFileBytes||++files>maxFiles)throw new Error(`Kilo policy/instruction input exceeds its bounded file limit at ${path}.`);
      const buffer=Buffer.alloc(maxFileBytes+1);let length=0;
      while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
      if(length>maxFileBytes||(total+=length)>maxTotalBytes)throw new Error(`Kilo policy/instruction input exceeds its bounded byte limit at ${path}.`);
      const content=buffer.subarray(0,length).toString("utf8");
      paths.push(path);return content;
    }finally{await handle.close();}
  }

 const seen=new Set<string>();let config:ObjectValue={},global:ObjectValue={};const instructionRefs:{pattern:string;trusted:boolean;source:string}[]=[];
 const configuredAgents:ObjectValue={};
 function policy(v:ObjectValue,path:string):ObjectValue{
  const out:ObjectValue={};
  if(own(v,"tools")){const tools=record(v.tools,path,"tools permission");for(const enabled of Object.values(tools))if(typeof enabled!=="boolean")invalid(path,"tools permission");out.tools=tools;}
  if(own(v,"permission"))out.permission=permission(v.permission,path,home);
  return out;
 }
 function agent(v:unknown,path:string):ObjectValue{
  const item=record(v,path,"agent");
  if(own(item,"model")||own(item,"provider")||own(item,"options"))invalid(path,"agent provider/model authority");
  const out=policy(item,path);
  for(const key of ["prompt","description","displayName","color"]){if(own(item,key))out[key]=literal(string(item[key],path,`agent ${key}`),path,`agent ${key}`);}
  for(const key of ["disable","hidden"]){if(own(item,key)){if(typeof item[key]!=="boolean")invalid(path,`agent ${key}`);out[key]=item[key];}}
  if(own(item,"mode")){if(!["primary","subagent","all"].includes(item.mode as string))invalid(path,"agent mode");out.mode=item.mode;}
  const steps=item.steps??item.maxSteps;if(steps!==undefined){if(typeof steps!=="number"||!Number.isSafeInteger(steps)||steps<1)invalid(path,"agent steps");out.steps=steps;}
  return out;
 }
 function safe(value:ObjectValue,path:string,trusted:boolean):ObjectValue{
  if(own(value,"model")||own(value,"small_model")||own(value,"subagent_model")||own(value,"provider"))invalid(path,"provider/model authority configuration");
  const out=policy(value,path);
  if(own(value,"permissions"))invalid(path,"unsupported plural permissions");
  if(own(value,"sandbox")||object(value.experimental)&&Object.keys(value.experimental).some(key=>key.startsWith("sandbox")))invalid(path,"native sandbox configuration (use its native managed interface)");
  if(own(value,"default_agent"))out.default_agent=literal(string(value.default_agent,path,"default_agent"),path,"default_agent");
  for(const kind of ["agent","mode"]){if(own(value,kind)){const entries=record(value[kind],path,kind),result:ObjectValue={};for(const[name,item]of Object.entries(entries)){literal(name,path,"agent name");Object.defineProperty(result,name,{value:agent(item,path),enumerable:true,writable:true,configurable:true});}out[kind]=result;}}
  for(const key of ["enabled_providers","disabled_providers"]){if(own(value,key)){const list=z.array(z.string()).safeParse(value[key]);if(!list.success)invalid(path,"provider policy");out[key]=list.data;}}
  if(own(value,"instructions")){const list=z.array(z.string()).safeParse(value.instructions);if(!list.success)invalid(path,"instructions");for(const pattern of list.data)instructionRefs.push({pattern:literal(pattern,path,"instruction path"),trusted,source:path});}
  return out;
 }
 async function document(path:string,trusted:boolean){const text=await read(path);if(text===undefined)return;const canonical=await realpath(path);if(seen.has(canonical))return;seen.add(canonical);const clean=safe(jsonc(text,path),path,trusted);config=merge(config,clean);if(object(clean.agent))Object.assign(configuredAgents,merge(configuredAgents,clean.agent));}
 async function agents(directory:string,trusted:boolean){
  for(const sub of ["agent","agents","mode","modes"]){const base=join(directory,sub),visited=new Set<string>();let examined=0;
   async function walk(dir:string,depth:number):Promise<void>{let names:string[];try{const canonical=await realpath(dir);if(visited.has(canonical))return;visited.add(canonical);names=await readdir(dir);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return;throw e;}
    if(depth>16||(examined+=names.length)>maxFiles)invalid(dir,"bounded agent directory");
    for(const name of names.sort()){const path=join(dir,name),info=await stat(path);if(info.isDirectory()){if(sub==="agent"||sub==="agents")await walk(path,depth+1);continue;}if(!name.endsWith(".md"))continue;
     if(!trusted&&!inside(root,await realpath(path))&&!(primary&&inside(primary,path)&&inside(primary,await realpath(path))))invalid(path,"external project agent source");
     const text=(await read(path,false))!,match=text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);let data:ObjectValue={};
     if(match){const parsed=parseDocument(match[1],{uniqueKeys:true});if(parsed.errors.length)invalid(path,"agent YAML");try{data=record(parsed.toJS({maxAliasCount:0}),path,"agent YAML");}catch{invalid(path,"agent YAML");}}
     const id=relative(base,path).replaceAll("\\","/").replace(/\.md$/,"");let clean=agent({...data,prompt:text.slice(match?.[0].length??0).trim(),...(sub==="mode"||sub==="modes"?{mode:"primary"}:{})},path);
     const old=object(config.agent)&&object(config.agent[id])?config.agent[id]:undefined;
     if(old){clean=merge(old,clean);const explicit=configuredAgents[id];if(clean.mode==="primary"&&object(explicit)&&explicit.mode!=="primary")clean=merge(clean,{...explicit,mode:explicit.mode??"all"});}
     config.agent={...(object(config.agent)?config.agent:{}),[id]:clean};
    }
   }await walk(base,0);
  }
 }
 for(const name of ["config.json","kilo.json","kilo.jsonc","opencode.json","opencode.jsonc"])await document(join(configRoot,name),true);
 global=structuredClone(config);
 if(env.KILO_CONFIG)await document(resolve(cwd,env.KILO_CONFIG),true);
 if(enabled)for(const name of ["kilo","opencode"])for(const dir of [...ancestors].reverse())for(const suffix of [".json",".jsonc"])await document(join(dir,name+suffix),false);
 const dirs:{path:string;trusted:boolean;files:boolean}[]=[{path:configRoot,trusted:true,files:false}];
 if(enabled&&primary&&primary!==root){const relativeCwd=relative(root,cwd);for(const dir of ancestry(resolve(primary,relativeCwd),primary))for(const name of [".kilocode",".kilo"])dirs.push({path:join(dir,name),trusted:false,files:true});}
 if(enabled)for(const dir of ancestors)for(const name of [".kilocode",".kilo"])dirs.push({path:join(dir,name),trusted:false,files:true});
 for(const name of [".kilocode",".kilo"])dirs.push({path:join(home,name),trusted:true,files:true});
 if(env.KILO_CONFIG_DIR)dirs.push({path:env.KILO_CONFIG_DIR,trusted:true,files:true});
 const seenDirs=new Set<string>();for(const dir of dirs){const canonical=await realpath(dir.path).catch(e=>{if(e.code==="ENOENT")return dir.path;throw e;});if(seenDirs.has(canonical))continue;seenDirs.add(canonical);if(dir.files)for(const name of ["kilo.jsonc","kilo.json","opencode.jsonc","opencode.json"])await document(join(dir.path,name),dir.trusted);await agents(dir.path,dir.trusted);}
 if(env.KILO_CONFIG_CONTENT)config=merge(config,safe(jsonc(env.KILO_CONFIG_CONTENT,"KILO_CONFIG_CONTENT"),join(cwd,"KILO_CONFIG_CONTENT"),true));
 if(env.KILO_PERMISSION)config=merge(config,{permission:permission(JSON.parse(env.KILO_PERMISSION),"KILO_PERMISSION",home)});
 const instructionPaths=new Map<string,{trusted:boolean;source:string}>();
 async function add(path:string,trusted:boolean,source=path){if(await exists(path)){const canonical=await realpath(path);if(!trusted&&!inside(root,canonical))invalid(path,"external project instruction");if(!instructionPaths.has(canonical)||trusted)instructionPaths.set(canonical,{trusted,source});}}
 for(const path of [...(env.KILO_CONFIG_DIR?[join(env.KILO_CONFIG_DIR,"AGENTS.md")]:[]),join(configRoot,"AGENTS.md"),...(!env.KILO_DISABLE_CLAUDE_CODE&&!env.KILO_DISABLE_CLAUDE_CODE_PROMPT?[join(home,".claude","CLAUDE.md")]:[])]){if(await exists(path)){await add(path,true);break;}}
 if(enabled)for(const name of ["AGENTS.md",...(!env.KILO_DISABLE_CLAUDE_CODE&&!env.KILO_DISABLE_CLAUDE_CODE_PROMPT?["CLAUDE.md"]:[]),"CONTEXT.md"]){let found=false;for(const dir of ancestors){if(await exists(join(dir,name))){await add(join(dir,name),false);found=true;}}if(found)break;}
 for(const ref of instructionRefs){if(/^https?:/.test(ref.pattern))invalid(ref.source,"remote instruction (snapshot required)");const pattern=ref.pattern.startsWith("~/")?join(home,ref.pattern.slice(2)):ref.pattern;
  const searches=isAbsolute(pattern)?[{dir:dirname(pattern),glob:pattern.slice(dirname(pattern).length+1)}]:(enabled?ancestors:[env.KILO_CONFIG_DIR||configRoot]).map(dir=>({dir,glob:pattern}));
  let count=0;for(const search of searches)for await(const file of new Bun.Glob(search.glob).scan({cwd:search.dir,absolute:true,onlyFiles:true,dot:true})){if(++count>64)invalid(ref.source,"bounded instruction glob");await add(file,ref.trusted&&isAbsolute(pattern),ref.source);}
 }
 if(instructionPaths.size>64)invalid(cwd,"bounded instructions");const instructions:string[]=[];
 for(const [path]of instructionPaths){const content=literal((await read(path,false))!,path,"instruction text");if(options.writeInstructions!==false){const target=join(stateDir,`kilo-instructions-${instructions.length}.txt`);await writeFile(target,`Instructions from: ${path}\n${content}`,{mode:0o600,flag:"wx"});instructions.push(target);}}
 return {config,global,instructions,sourcePaths:paths};
}
/** Kilo substitutes variables before parsing JSON; only the generated key reference is active. */
export function kiloConfigText(config:Record<string,unknown>,providerID?:string,keyEnv?:string){
 let value=config,marker:string|undefined;
 if(providerID&&keyEnv){marker=randomUUID();const providers=config.provider as Record<string,{options:Record<string,unknown>}>;const selected=providers[providerID];value={...config,provider:{...providers,[providerID]:{...selected,options:{...selected.options,apiKey:marker}}}};}
 let text=JSON.stringify(value,null,2).replace(/\{(env|file):/g,"\\u007b$1:");if(marker)text=text.replace(JSON.stringify(marker),JSON.stringify(`{env:${keyEnv}}`));return text+"\n";
}
