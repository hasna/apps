import {mkdir, readFile, realpath, stat, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, join, relative, resolve} from "node:path";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {modelPolicySchema, type ModelPolicy} from "./model-policy-schema";

type Dict = Record<string, unknown>;
const dict = (v: unknown): v is Dict => v !== null && typeof v === "object" && !Array.isArray(v);
const model = (v: string) => JSON.stringify(v);

/** Keys which can redirect a Codex request outside Switcher's launch provider. */
export const codexRoutingKeys = new Set(["model", "model_provider", "model_providers", "model_catalog_json", "base_url", "wire_api", "env_key", "env_http_headers", "http_headers", "auth_command", "include"]);
export const codexTransportKeys = new Set(["mcp_servers", "mcp_server", "transport", "transports", "plugins"]);

export type CodexAgentInput = {
  description?: string;
  config_file?: string;
  nickname_candidates?: string[];
  /** Parsed contents of config_file. The caller reads native config layers. */
  config?: Dict;
  trusted?: boolean;
};

export type CodexModelPolicyInput = {
  model: string;
  policy?: ModelPolicy;
  /** Effective native global/project config, after Codex precedence is applied. */
  effectiveConfig?: Dict;
  agents?: Record<string, CodexAgentInput>;
  switcherProvider: string;
  switcherBaseUrl: string;
  /** Project config is never activated unless the caller has established trust. */
  trustedProject?: boolean;
};

export type CodexAgentOverride = {
  name: string;
  model: string;
  config: Dict;
  sourceConfigFile?: string;
  trusted: boolean;
};

export type CodexModelPolicyResult = {
  model: string;
  subagentModel: string;
  reviewModel: string;
  provider: {name: string; base_url: string};
  /** Structured -c values; the launcher serializes these as TOML. */
  overrides: Record<string, unknown>;
  agents: CodexAgentOverride[];
  ignoredUntrustedAgents: string[];
};

/** Extract named role declarations from an already merged native config layer. */
export function codexAgentsFromEffectiveConfig(config: Dict, trustedProject = true, baseDir?: string): Record<string, CodexAgentInput> {
  const raw = config.agents;
  if (!dict(raw)) return {};
  const out: Record<string, CodexAgentInput> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (["enabled", "max_concurrent_threads_per_session", "max_threads", "max_depth", "job_max_runtime_seconds", "interrupt_message", "default_subagent_model", "default_subagent_reasoning_effort", "default_subagent_reasoning_summary"].includes(name)) continue;
    if (!dict(value)) throw new Error(`Codex agents.${name} must be an object.`);
    const rawConfigFile = value.config_file;
    if (rawConfigFile !== undefined && typeof rawConfigFile !== "string") throw new Error(`Codex agents.${name}.config_file must be a string.`);
    const configFile = rawConfigFile === undefined ? undefined : isAbsolute(rawConfigFile) ? rawConfigFile : baseDir ? resolve(baseDir, rawConfigFile) : undefined;
    if (rawConfigFile !== undefined && !configFile) throw new Error(`Codex agents.${name}.config_file must be absolute after precedence resolution.`);
    const definition: CodexAgentInput = {trusted: trustedProject, config_file: configFile as string | undefined};
    if (value.description !== undefined) { if (typeof value.description !== "string") throw new Error(`Codex agents.${name}.description must be a string.`); definition.description = value.description; }
    if (value.nickname_candidates !== undefined) { if (!Array.isArray(value.nickname_candidates) || value.nickname_candidates.some((item) => typeof item !== "string")) throw new Error(`Codex agents.${name}.nickname_candidates must be strings.`); definition.nickname_candidates = value.nickname_candidates as string[]; }
    out[name] = definition;
  }
  return out;
}

function reject(key: string): never {
  throw new Error(`Codex policy cannot preserve ${key}; provider, transport, and include configuration are launch-owned.`);
}

function cloneAgentConfig(value: Dict, selectedModel: string, provider: string): Dict {
  const out: Dict = {};
  for (const [key, item] of Object.entries(value)) {
    if (codexTransportKeys.has(key) || key === "include" || key === "model_providers") reject(key);
    if (key === "model") { out.model = selectedModel; continue; }
    if (key === "model_provider" || key === "provider") { out[key] = provider; continue; }
    if (key === "model_catalog_json" || key === "base_url" || key === "wire_api" || key === "env_key" || key === "auth_command" || key === "model_instructions_file") reject(key);
    out[key] = scanNested(item, key);
  }
  out.model = selectedModel;
  out.model_provider = provider;
  return out;
}

function scanNested(value: unknown, path: string): unknown {
  if (Array.isArray(value)) return value.map((item, index) => scanNested(item, `${path}[${index}]`));
  if (!dict(value)) return value;
  for (const [key, item] of Object.entries(value)) {
    if (codexTransportKeys.has(key) || key === "config_file" || key === "include" || key === "model_providers" || key === "base_url" || key === "auth_command" || key === "model_instructions_file") reject(`${path}.${key}`);
    if (key === "agents" && dict(item)) for (const [name, role] of Object.entries(item)) if (dict(role) && role.config_file !== undefined) reject(`${path}.agents.${name}.config_file`);
    scanNested(item, `${path}.${key}`);
  }
  return value;
}

/** Compile only routing controls; native instructions, permissions and descriptions remain intact. */
export function compileCodexModelPolicy(input: CodexModelPolicyInput): CodexModelPolicyResult {
  const policy = modelPolicySchema.parse(input.policy ?? {});
  const subagentModel = policy.roles?.subagent ?? input.model;
  const reviewModel = policy.roles?.review ?? input.model;
  const unsupported = ["fast", "planning", "summary", "compaction", "weak", "editor"].filter((role) => policy.roles?.[role as keyof NonNullable<ModelPolicy["roles"]>] !== undefined && policy.roles?.[role as keyof NonNullable<ModelPolicy["roles"]>] !== input.model);
  if (unsupported.length) throw new Error(`Codex does not expose role controls for: ${unsupported.join(", ")}.`);
  const agents: CodexAgentOverride[] = [];
  const ignoredUntrustedAgents: string[] = [];
  for (const [name, definition] of Object.entries(input.agents ?? {})) {
    if (!definition.trusted && input.trustedProject === false) { ignoredUntrustedAgents.push(name); continue; }
    const selected = name === "review" ? reviewModel : subagentModel;
    agents.push({name, model: selected, config: cloneAgentConfig(definition.config ?? {}, selected, input.switcherProvider), sourceConfigFile: definition.config_file, trusted: definition.trusted !== false});
  }
  return {
    model: input.model,
    subagentModel,
    reviewModel,
    provider: {name: input.switcherProvider, base_url: input.switcherBaseUrl},
    overrides: {
      model: input.model,
      model_provider: input.switcherProvider,
      "agents.default_subagent_model": subagentModel,
      review_model: reviewModel,
    },
    agents,
    ignoredUntrustedAgents,
  };
}

function tomlValue(value: unknown): string {
  if (typeof value === "string") return model(value);
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
  if (dict(value)) return `{ ${Object.entries(value).map(([key, item]) => `${tomlKey(key)} = ${tomlValue(item)}`).join(", ")} }`;
  throw new Error("Codex agent config contains an unsupported value.");
}
function tomlKey(key: string): string { return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key); }

/** Small deterministic TOML writer for the copied, sanitized agent config layer. */
export function renderCodexAgentToml(config: Dict): string {
  const lines: string[] = [];
  const emit = (value: Dict, section?: string) => {
    const scalars: [string, unknown][] = [], tables: [string, Dict][] = [];
    for (const [key, item] of Object.entries(value)) dict(item) ? tables.push([key, item]) : scalars.push([key, item]);
    if (section) lines.push(`[${section}]`);
    for (const [key, item] of scalars) lines.push(`${tomlKey(key)} = ${tomlValue(item)}`);
    for (const [key, item] of tables) lines.push(`${tomlKey(key)} = ${tomlValue(item)}`);
  };
  emit(config);
  return `${lines.join("\n")}\n`;
}

/** Copy sanitized role layers into the per-launch state directory. */
export async function writeCodexAgentOverrides(result: CodexModelPolicyResult, stateDir: string): Promise<Record<string, string>> {
  const root = resolve(stateDir); await mkdir(root, {recursive: true});
  const paths: Record<string, string> = {};
  for (const agent of result.agents) {
    const digest = createHash("sha256").update(agent.name).digest("hex").slice(0, 16);
    const path = join(root, `agent-${digest}.toml`);
    await writeFile(path, renderCodexAgentToml(agent.config), {encoding: "utf8", mode: 0o600, flag: "wx"}); paths[agent.name] = path;
  }
  return paths;
}

export type PrepareCodexModelPolicyInput = Omit<CodexModelPolicyInput, "effectiveConfig" | "agents"> & {cwd: string; stateDir: string; home?: string};

/** Load global Codex config plus trusted .codex/config.toml ancestors, then prepare role layers. */
export async function prepareCodexModelPolicy(input: PrepareCodexModelPolicyInput): Promise<CodexModelPolicyResult & {agentConfigPaths: Record<string, string>; configPaths: string[]}> {
  const home = resolve(input.home ?? process.env.CODEX_HOME ?? join(process.env.HOME ?? "/", ".codex"));
  const cwd = resolve(input.cwd);
  const globalPath=join(home,"config.toml");
  const readConfig=async(path:string):Promise<Dict|undefined>=>{
    let info;try{info=await stat(path);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return;throw error;}
    if(!info.isFile()||info.size>1024*1024)throw new Error(`Codex config must be a regular file no larger than 1 MiB: ${path}`);
    const text=await readFile(path,"utf8");
    if(Buffer.byteLength(text)>1024*1024)throw new Error(`Codex config exceeds 1 MiB: ${path}`);
    try{return Bun.TOML.parse(text) as Dict;}catch{throw new Error(`Cannot parse Codex config: ${path}`);}
  };
  const global=await readConfig(globalPath)??{};
  const projects=dict(global.projects)?global.projects:{};
  const markers=global.project_root_markers??[".git"];
  if(!Array.isArray(markers)||markers.some(m=>typeof m!=="string"||isAbsolute(m)||m.includes("..")))throw new Error("Unsupported Codex project root markers.");
  const ancestorDirs:string[]=[];
  for(let dir=cwd;;dir=dirname(dir)){ancestorDirs.push(dir);if(dirname(dir)===dir)break;}
  let projectRoot=cwd;
  findRoot:for(const dir of ancestorDirs)for(const marker of markers){
    try{const info=await stat(join(dir,marker));if(marker===".git"&&info.isDirectory())await stat(join(dir,marker,"HEAD"));projectRoot=dir;break findRoot;}catch{/* no marker */}
  }
  let repoRoot:string|undefined;
  try{const common=execFileSync("git",["-C",cwd,"rev-parse","--path-format=absolute","--git-common-dir"],{encoding:"utf8",timeout:3000,stdio:["ignore","pipe","ignore"]}).trim();repoRoot=dirname(common);}catch{/* no Git repository */}
  const trust=async(dir:string):Promise<string|undefined>=>{
    const keys=[resolve(dir)];try{keys.push(await realpath(dir));}catch{/* unavailable */}
    for(const key of keys){const entry=projects[key];if(dict(entry)&&typeof entry.trust_level==="string")return entry.trust_level;}
  };
  const projectTrust=await trust(projectRoot),repoTrust=repoRoot?await trust(repoRoot):undefined;
  const layers:{path:string;config:Dict}[]=[{path:globalPath,config:global}];
  const projectDirs=ancestorDirs.slice(0,ancestorDirs.indexOf(projectRoot)+1).reverse();
  for(const dir of projectDirs){
    const path=join(dir,".codex","config.toml");if(path===globalPath)continue;
    const decision=await trust(dir)??projectTrust??repoTrust;
    if(decision!=="trusted")continue;
    const config=await readConfig(path);if(config)layers.push({path,config});
  }
  let effective:Dict={};const agents:Record<string,CodexAgentInput>={};const loaded:string[]=[];
  for(const {path,config} of layers){
    const found=codexAgentsFromEffectiveConfig(config,true,dirname(path));
    for(const [name,definition] of Object.entries(found)){
      const present=Object.fromEntries(Object.entries(definition).filter(([,value])=>value!==undefined));
      agents[name]={...agents[name],...present};
    }
    effective={...effective,...config};loaded.push(path);
  }
  for(const definition of Object.values(agents))if(definition.config_file)definition.config=await readCodexAgentConfig(definition.config_file);
  const result = compileCodexModelPolicy({...input, effectiveConfig: effective, agents});
  return {...result, agentConfigPaths: await writeCodexAgentOverrides(result, input.stateDir), configPaths: loaded};
}

/** Read a referenced role layer without activating it; callers must establish project trust. */
export async function readCodexAgentConfig(path: string): Promise<Dict> {
  if (!isAbsolute(path)) throw new Error("Codex agent config_file must be absolute before launch.");
  const canonical = await realpath(path); const info = await stat(canonical);
  if (!info.isFile() || info.size > 1024 * 1024) throw new Error(`Codex agent config must be a regular file no larger than 1 MiB: ${path}`);
  const text = await readFile(canonical, "utf8");
  try { return (Bun as typeof Bun).TOML.parse(text) as Dict; } catch { throw new Error(`Cannot parse Codex agent config_file: ${path}`); }
}
