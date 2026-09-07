import {mkdir,open,realpath,readdir,stat,writeFile} from "node:fs/promises";
import {constants} from "node:fs";
import {dirname,isAbsolute,join,relative,resolve} from "node:path";
import {homedir} from "node:os";
import {randomUUID} from "node:crypto";
import {Database} from "bun:sqlite";
import {parse,parseTree,type ParseError,type Node as JsonNode} from "jsonc-parser";
import {parseDocument} from "yaml";
import {z} from "zod";

const effect=z.enum(["allow","deny","ask"]);
const rule=z.object({action:z.string(),resource:z.string(),effect}).strict();
type Rule=z.infer<typeof rule>;
type ObjectValue=Record<string,unknown>;
type Agent={system?:string;description?:string;mode?:"primary"|"subagent"|"all";hidden?:boolean;color?:string;steps?:number;disabled?:boolean;permissions?:Rule[]};
type Document={path:string;value:ObjectValue};
const object=(value:unknown):value is ObjectValue=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const own=(value:ObjectValue,key:string)=>Object.hasOwn(value,key);
const maxFileBytes=1024*1024,maxTotalBytes=8*1024*1024,maxFiles=256;
const inside=(root:string,path:string)=>{const rel=relative(root,path);return rel===""||(!isAbsolute(rel)&&rel!==".."&&!rel.startsWith("../"));};
const action=(value:string)=>({bash:"shell",task:"subagent",write:"edit",patch:"edit"}[value]??value);

function invalid(path:string,field:string):never {throw new Error(`OpenCode 2 cannot preserve ${field} in ${path}; use a supported explicit permission or agent declaration.`);}
function record(value:unknown,path:string,field:string):ObjectValue {if(!object(value))invalid(path,field);return value;}
function string(value:unknown,path:string,field:string):string {if(typeof value!=="string")invalid(path,field);return value;}
function literal(value:string,path:string,field:string):string {if(/\{(?:env|file):/.test(value))invalid(path,`${field} variable reference`);return value;}

function permissions(value:ObjectValue,path:string,home:string):Rule[] {
  const result:Rule[]=[];
  if(own(value,"tools"))for(const [name,enabled] of Object.entries(record(value.tools,path,"tools permission"))){
    if(typeof enabled!=="boolean")invalid(path,"tools permission");
    result.push({action:action(name),resource:"*",effect:enabled?"allow":"deny"});
  }
  if(own(value,"permission")) {
    const legacy=typeof value.permission==="string"?{"*":value.permission}:record(value.permission,path,"permission");
    for(const [name,permission] of Object.entries(legacy)) {
      const entries=typeof permission==="string"?{"*":permission}:record(permission,path,"permission");
      for(const [resource,item] of Object.entries(entries)) {
        const parsed=effect.safeParse(item);if(!parsed.success)invalid(path,"permission");
        result.push({action:action(name),resource,effect:parsed.data});
      }
    }
  }
  if(own(value,"permissions")) {
    const parsed=z.array(rule).safeParse(value.permissions);if(!parsed.success)invalid(path,"permissions");result.push(...parsed.data);
  }
  return result.map(item=>{
    literal(item.action,path,"permission action");literal(item.resource,path,"permission resource");
    if(!["read","edit","external_directory"].includes(item.action))return item;
    const resource=item.resource==="~"||item.resource==="$HOME"?home:item.resource.startsWith("~/")?join(home,item.resource.slice(2)):item.resource.startsWith("$HOME/")||item.resource.startsWith("$HOME\\")?join(home,item.resource.slice(6)):item.resource;
    return {...item,resource};
  });
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

// A preserved session database may also register remote configuration sources.
// Those can add providers/plugins before the isolated local configuration loads.
// Inspect only this nonsecret key, read-only; never rewrite native user state.
async function checkRemoteConfiguration(dataHome:string) {
  const path=join(dataHome,"opencode","opencode.db");
  const legacyAuth=await stat(join(dataHome,"opencode","auth.json")).then(()=>true,error=>{if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;});
  try {await stat(path);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT"){if(legacyAuth)throw new Error("OpenCode 2 legacy credential migration may import remote configuration; initialize native migration without a Switcher credential or use an isolated XDG_DATA_HOME first.");return;}throw error;}
  let db:Database|undefined;
  try {
    db=new Database(path,{readonly:true,create:false});
    if(legacyAuth) {
      const migrated=db.query("SELECT id FROM migration WHERE id = ?").get("20260805200742_import_legacy_credentials");
      if(!migrated)throw new Error("legacy remote configuration migration pending");
    }
    const table=db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='kv'").get();
    if(!table)return;
    const found=db.query("SELECT value FROM kv WHERE key = ?").get("wellknown:sources") as {value:string}|null;
    if(found) {const value:unknown=JSON.parse(found.value);if(!Array.isArray(value)||value.length)throw new Error("remote sources");}
  } catch {throw new Error("OpenCode 2 session data contains remote configuration or cannot be checked safely; use an explicitly isolated XDG_DATA_HOME before launching.");}
  finally {db?.close();}
}

/** Preserve native policy and prompts as data, without running native plugins or loading provider settings. */
export async function isolateOpenCode2(cwd:string,stateDir:string,providerID:string,env:NodeJS.ProcessEnv=process.env) {
  for(const name of ["HOME","XDG_CONFIG_HOME","XDG_DATA_HOME","OPENCODE_CONFIG_DIR"])if(env[name]&&!isAbsolute(env[name]!))throw new Error(`OpenCode 2 requires an absolute ${name} to preserve native configuration authority.`);
  const home=resolve(env.HOME||homedir());
  const configRoot=resolve(env.OPENCODE_CONFIG_DIR||join(env.XDG_CONFIG_HOME||join(home,".config"),"opencode"));
  const canonicalConfigRoot=await realpath(configRoot).catch(error=>{if((error as NodeJS.ErrnoException).code==="ENOENT")return configRoot;throw error;});
  const dataHome=resolve(env.XDG_DATA_HOME||join(home,".local","share"));
  await checkRemoteConfiguration(dataHome);
  let files=0,total=0;
  const paths:string[]=[];
  async function read(path:string,optional=true):Promise<string|undefined> {
    let handle;try{handle=await open(path,constants.O_RDONLY|constants.O_NONBLOCK);}catch(error){if(optional&&(error as NodeJS.ErrnoException).code==="ENOENT")return;throw new Error(`OpenCode 2 cannot read policy or instructions at ${path}.`);}
    try {
      const info=await handle.stat();if(!info.isFile()||info.size>maxFileBytes||++files>maxFiles)throw new Error(`OpenCode 2 policy/instruction input exceeds its bounded file limit at ${path}.`);
      const buffer=Buffer.alloc(maxFileBytes+1);let length=0;
      while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
      if(length>maxFileBytes||(total+=length)>maxTotalBytes)throw new Error(`OpenCode 2 policy/instruction input exceeds its bounded byte limit at ${path}.`);
      const content=buffer.subarray(0,length).toString("utf8");
      paths.push(path);return content;
    }finally{await handle.close();}
  }
  async function prompt(value:unknown,path:string):Promise<string> {
    let text=string(value,path,"agent prompt");if(text.includes("{env:"))invalid(path,"agent prompt environment reference");
    let result="",cursor=0;
    for(const match of text.matchAll(/\{file:([^}]+)\}/g)) {
      const requested=match[1].startsWith("~/")?join(home,match[1].slice(2)):resolve(dirname(path),match[1]);
      const content=(await read(requested,false))!.trim();literal(content,requested,"nested prompt variable reference");
      result+=text.slice(cursor,match.index)+content;cursor=match.index!+match[0].length;
    }
    return result+text.slice(cursor);
  }
  const documents:Document[]=[];const seen=new Set<string>();
  async function document(path:string) {const text=await read(path);if(text===undefined)return;const canonical=await realpath(path);if(seen.has(canonical))return;seen.add(canonical);documents.push({path,value:jsonc(text,path)});}
  async function agentsDirectory(directory:string) {
    for(const source of ["agent","agents","mode","modes"]) {
      const base=join(directory,source),entries:string[]=[];const visited=new Set<string>();let examined=0;
      async function walk(dir:string,depth:number):Promise<void> {
        let names:string[];try{const actual=await realpath(dir);if(visited.has(actual))return;visited.add(actual);names=await readdir(dir);}
        catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return;throw new Error(`OpenCode 2 cannot inspect agent policy in ${dir}.`);}
        if(depth>16||(examined+=names.length)>maxFiles)throw new Error("OpenCode 2 agent policy exceeds its bounded directory limit.");
        for(const name of names){const path=join(dir,name);const info=await stat(path);if(info.isDirectory()){if(source==="agent"||source==="agents")await walk(path,depth+1);}else if(name.endsWith(".md"))entries.push(path);}
      }
      await walk(base,0);
      for(const path of entries.sort()) {
        const text=(await read(path,false))!;const match=text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);let data:ObjectValue={};
        if(match) {const parsed=parseDocument(match[1],{uniqueKeys:true});if(parsed.errors.length)invalid(path,"agent YAML frontmatter");try{data=record(parsed.toJS({maxAliasCount:0}),path,"agent YAML frontmatter");}catch{invalid(path,"agent YAML frontmatter");}}
        const body=text.slice(match?.[0].length??0).trim();
        const nativeKeys=new Set(["model","request","system","description","mode","hidden","color","steps","disabled","permissions","variant"]);
        const legacy=Object.keys(data).some(key=>!nativeKeys.has(key));
        const name=relative(base,path).replaceAll("\\","/").replace(/\.md$/,"");
        const value={...data,[legacy?"prompt":"system"]:body,...(source==="mode"||source==="modes"?{mode:"primary"}:{})};
        // Markdown body is literal in the native loader; do not interpret it as config variables.
        documents.push({path,value:{[legacy?"agent":"agents"]:{[name]:value},__literalAgentBody:true}});
      }
    }
  }
  async function directory(path:string) {await document(join(path,"opencode.json"));await document(join(path,"opencode.jsonc"));await agentsDirectory(path);}
  await directory(configRoot);
  if(env.OPENCODE_CONFIG)await document(resolve(cwd,env.OPENCODE_CONFIG));
  const ancestors:string[]=[];for(let path=resolve(cwd);;path=dirname(path)){ancestors.push(path);if(dirname(path)===path)break;}
  const projectEnabled=!["1","true"].includes((env.OPENCODE_CONFIG_PROJECT_DISABLE??env.OPENCODE_DISABLE_PROJECT_CONFIG??"").toLowerCase());
  if(projectEnabled) {
    for(const path of [...ancestors].reverse()){await document(join(path,"opencode.json"));await document(join(path,"opencode.jsonc"));}
    for(const path of [...ancestors].reverse()) {
      const candidate=join(path,".opencode");const canonical=await realpath(candidate).catch(error=>{if((error as NodeJS.ErrnoException).code==="ENOENT")return candidate;throw error;});
      if(canonical!==canonicalConfigRoot)await directory(candidate);
    }
  }
  if(env.OPENCODE_CONFIG_CONTENT)documents.push({path:join(cwd,"OPENCODE_CONFIG_CONTENT"),value:jsonc(env.OPENCODE_CONFIG_CONTENT,"OPENCODE_CONFIG_CONTENT")});
  const policy:Rule[]=[];const agents:Record<string,Agent>=Object.create(null);let defaultAgent:string|undefined;
  const providerPolicies:{action:"provider.use";resource:string;effect:"allow"|"deny"}[][]=[];
  for(const {path,value} of documents) {
    policy.push(...permissions(value,path,home));
    if(own(value,"default_agent"))defaultAgent=literal(string(value.default_agent,path,"default_agent"),path,"default_agent");
    const policies:{action:"provider.use";resource:string;effect:"allow"|"deny"}[]=[];
    if(own(value,"enabled_providers")){const names=z.array(z.string()).safeParse(value.enabled_providers);if(!names.success)invalid(path,"provider policy");policies.push({action:"provider.use",resource:"*",effect:"deny"},...names.data.map(resource=>({action:"provider.use" as const,resource,effect:"allow" as const})));}
    if(own(value,"disabled_providers")){const names=z.array(z.string()).safeParse(value.disabled_providers);if(!names.success)invalid(path,"provider policy");policies.push(...names.data.map(resource=>({action:"provider.use" as const,resource,effect:"deny" as const})));}
    if(object(value.experimental)&&own(value.experimental,"policies")){const parsed=z.array(z.object({action:z.literal("provider.use"),resource:z.string(),effect:z.enum(["allow","deny"])}).strict()).safeParse(value.experimental.policies);if(!parsed.success)invalid(path,"provider policy");policies.push(...parsed.data);}
    providerPolicies.push(policies);
    const legacy=own(value,"agent")?record(value.agent,path,"agent"):{};const modes=own(value,"mode")?record(value.mode,path,"mode"):{};const native=own(value,"agents")?record(value.agents,path,"agents"):{};
    const selected=new Map(Object.entries(legacy).map(([name,item])=>[name,{item,legacy:true,primary:false}]));
    for(const [name,item] of Object.entries(modes))selected.set(name,{item,legacy:true,primary:true});
    for(const [name,item] of Object.entries(native))selected.set(name,{item,legacy:false,primary:false});
    for(const [name,entry] of selected) {
      literal(name,path,"agent name");const item=record(entry.item,path,"agent");const target=agents[name]??={};
      const system=entry.legacy?item.prompt:item.system;
      if(system!==undefined)target.system=value.__literalAgentBody?string(system,path,"agent prompt"):await prompt(system,path);
      if(own(item,"description"))target.description=string(item.description,path,"agent description");
      if(own(item,"mode")){const parsed=z.enum(["primary","subagent","all"]).safeParse(item.mode);if(!parsed.success)invalid(path,"agent mode");target.mode=parsed.data;}
      if(entry.primary)target.mode="primary";
      for(const key of ["hidden","disabled"] as const) {const raw=key==="disabled"&&entry.legacy?item.disable:item[key];if(raw!==undefined){if(typeof raw!=="boolean")invalid(path,`agent ${key}`);target[key]=raw;}}
      if(own(item,"steps")||own(item,"maxSteps")){const raw=item.steps??item.maxSteps;if(typeof raw!=="number"||!Number.isSafeInteger(raw)||raw<1)invalid(path,"agent steps");target.steps=raw;}
      if(own(item,"color")){const raw=string(item.color,path,"agent color");target.color=/^#[0-9a-fA-F]{6}$/.test(raw)?raw:entry.legacy?"#aaaaaa":invalid(path,"agent color");}
      const rules=permissions(item,path,home);if(rules.length)target.permissions=[...(target.permissions??[]),...rules];
    }
  }
  const matches=(pattern:string)=>new RegExp("^"+pattern.replaceAll("\\","/").replace(/[.+^${}()|[\]\\]/g,"\\$&").replace(/\*/g,".*").replace(/\?/g,".")+"$","s").test(providerID);
  if(providerPolicies.reverse().flat().filter(item=>matches(item.resource)).at(-1)?.effect==="deny")throw new Error("OpenCode 2 native provider policy denies this Switcher provider; update that policy before launching.");
  const instructions:string[]=[];const instructionSeen=new Set<string>();
  async function instruction(path:string) {const content=await read(path);if(content===undefined)return;const actual=await realpath(path);if(instructionSeen.has(actual))return;instructionSeen.add(actual);instructions.push(`Instructions from: ${path}\n${content}`);}
  await instruction(join(configRoot,"AGENTS.md"));
  if(projectEnabled) {
    // Native instructions walk to the user's home when cwd is beneath it;
    // elsewhere they stop at the project Git root (or cwd when unversioned).
    let stop=resolve(cwd);if(inside(home,resolve(cwd)))stop=home;else for(const path of ancestors){if(await stat(join(path,".git")).then(()=>true,()=>false)){stop=path;break;}}
    for(const path of ancestors){await instruction(join(path,"AGENTS.md"));if(path===stop)break;}
  }
  // beta-19157 does not consume config.instructions. Keeping it would imply
  // protections the installed native does not actually load; preserve AGENTS.
  const privateHome=join(stateDir,"opencode-home"),privateConfig=join(stateDir,"opencode-config");
  const instructionFile=join(privateConfig,"opencode","AGENTS.md");
  await mkdir(dirname(instructionFile),{recursive:true,mode:0o700});await mkdir(privateHome,{recursive:true,mode:0o700});
  await writeFile(instructionFile,instructions.join("\n\n"),{flag:"wx",mode:0o600});
  return {
    config:{permissions:policy,agents,...(defaultAgent?{default_agent:defaultAgent}:{}),experimental:{policies:[{action:"provider.use",resource:"*",effect:"deny"},{action:"provider.use",resource:providerID,effect:"allow"}]}},
    env:{HOME:privateHome,XDG_CONFIG_HOME:privateConfig,OPENCODE_CONFIG_DIR:join(privateConfig,"opencode"),XDG_CACHE_HOME:join(stateDir,"opencode-cache"),XDG_STATE_HOME:join(stateDir,"opencode-state"),XDG_DATA_HOME:dataHome,OPENCODE_DISABLE_PROJECT_CONFIG:"true",OPENCODE_CONFIG_PROJECT_DISABLE:"true",OPENCODE_DISABLE_MODELS_FETCH:"true"},
    instructionFile,sourcePaths:paths,
  };
}

/** Native substitutes variables before parsing JSON; quote literal prompt/model tokens without evaluating them. */
export function openCode2ConfigText(config:Record<string,unknown>,providerID:string,keyEnv:string):string {
  const marker=randomUUID();const providers=config.providers as Record<string,{settings:Record<string,unknown>}>;
  const selected=providers[providerID];
  const value={...config,providers:{...providers,[providerID]:{...selected,settings:{...selected.settings,apiKey:marker}}}};
  return JSON.stringify(value,null,2).replace(/\{(env|file):/g,"\\u007b$1:").replace(JSON.stringify(marker),JSON.stringify(`{env:${keyEnv}}`))+"\n";
}
