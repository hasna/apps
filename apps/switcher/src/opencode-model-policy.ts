import type {ModelPolicy} from "./model-policy-schema";

type Dict = Record<string, unknown>;
export type OpenCodeRole = "main" | "subagent" | "planning" | "summary" | "compaction";
export type OpenCodeCompiledRoles = Partial<Record<OpenCodeRole, string>>;
export type PreservedOpenCodeAgent = Dict & {name: string};

export type OpenCodeModelPolicyInput = {
  providerId: string;
  mainModel: string;
  roles?: OpenCodeCompiledRoles | ModelPolicy["roles"];
  preservedAgents?: PreservedOpenCodeAgent[];
  /** OpenCode 2's native `agents` table or legacy OpenCode's `agent` table. */
  format?: "v2" | "legacy";
};

export type OpenCodeModelPolicyResult = {
  model: string;
  agents: PreservedOpenCodeAgent[];
  /** Only native OpenCode fields are emitted. */
  config: {model: string; agents?: Record<string, Dict>; agent?: Record<string, Dict>};
};

const routeForAgent = (agent: PreservedOpenCodeAgent): OpenCodeRole | undefined => {
  const name = agent.name.toLowerCase();
  if (name === "general" || name === "explore") return "subagent";
  if (name === "plan") return "planning";
  if (name === "summary" || name === "title") return "summary";
  if (name === "compaction") return "compaction";
  if (agent.mode === "subagent") return "subagent";
  if (agent.mode === "primary" || agent.mode === "all" || name === "main" || name === "build") return "main";
  return undefined;
};

function selectedModel(providerId: string, role: OpenCodeRole | undefined, mainModel: string, roles: OpenCodeCompiledRoles): string {
  const model = role && roles[role];
  return `${providerId}/${model ?? mainModel}`;
}

/**
 * Merge Switcher routing into native OpenCode agent declarations. Prompts,
 * permissions, modes and other native fields are copied without alteration.
 */
export function compileOpenCodeModelPolicy(input: OpenCodeModelPolicyInput): OpenCodeModelPolicyResult {
  const roles = input.roles ?? {};
  const unsupported=["review","weak","editor",...(input.format==="legacy"?[]:["fast","summary","compaction"])].filter(role=>{const selected=(roles as Record<string,string>)[role];return selected&&selected!==input.mainModel;});
  if(unsupported.length)throw new Error(`OpenCode does not expose native model controls for: ${unsupported.join(", ")}.`);
  const preserved = [...(input.preservedAgents ?? [])];
  // These are native built-in selectors; declaring their model keeps the
  // launch policy effective even when the user's config did not declare them.
  const names = new Set(preserved.map((agent) => agent.name));
  for (const name of ["general", "explore", "plan",...(input.format==="legacy"?["title","summary","compaction"]:[])]) if (!names.has(name)) preserved.push({name});
  const agents: PreservedOpenCodeAgent[] = preserved.map((agent) => {
    const role = routeForAgent(agent);
    const {name, ...native} = agent;
    return {name, ...native, model: selectedModel(input.providerId, role ?? "main", input.mainModel, roles)};
  });
  const entries = Object.fromEntries(agents.map(({name, ...agent}) => [name, agent]));
  return {
    model: `${input.providerId}/${input.mainModel}`,
    agents,
    config: input.format === "legacy" ? {model: `${input.providerId}/${input.mainModel}`, agent: entries} : {model: `${input.providerId}/${input.mainModel}`, agents: entries},
  };
}

/** Match OpenCode's explicit agent selection without interpreting prompt values as flags. */
export function openCodeInvocationModel(args:readonly string[], policy:OpenCodeModelPolicyResult, defaultAgent?:string):string {
 let name=defaultAgent;
 const values=new Set(["--session","--prompt","--agent","--format","--file","--title","--command","--variant","--log-level","--replay-limit","--completions","-s","-f"]);
 for(let i=0;i<args.length;i++){
   const arg=args[i];if(arg==="--")break;
   if(arg.startsWith("--agent=")){name=arg.slice(8);continue;}
   if(values.has(arg)){if(arg==="--agent")name=args[i+1];i++;}
 }
 const selected=policy.agents.find(agent=>agent.name===name)?.model;
 return typeof selected==="string"?selected:policy.model;
}
