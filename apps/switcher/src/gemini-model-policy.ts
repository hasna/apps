import { Fault, type Model } from "./domain";
import type { CompiledModelPolicy, ModelRole } from "./model-policy";

/** The settings fragment understood by Gemini CLI 0.58.0. */
export type GeminiModelPolicyFragment = {
  modelConfigs: {
    customOverrides: Array<{ match: { model: string }; modelConfig: { model: string } }>;
    modelChains: Record<string, Array<{ model: string; isLastResort: true }>>;
    modelDefinitions: Record<string, {
      displayName: string;
      tier: "custom";
      family: "switcher";
      isPreview: false;
      isVisible: true;
      features: { thinking: false; multimodalToolUse: boolean };
    }>;
    modelIdResolutions: Record<string, { default: string; contexts: [] }>;
    classifierIdResolutions: Record<string, {default:string;contexts:[]}>;
  };
  agents?: {
    overrides: {
      codebase_investigator: { modelConfig: { model: string } };
    };
  };
};

const nativeAgentRole: ModelRole = "subagent";
const nativeRoleAliases: Readonly<Record<Exclude<ModelRole, "subagent">, readonly string[]>> = {
  fast: ["fast-ack-helper","prompt-completion","loop-detection","next-speaker-checker"],
  planning: [],
  review: [],
  summary: ["summarizer-default", "summarizer-shell", "agent-history-provider-summarizer","context-snapshotter"],
  compaction: ["chat-compression-default", "chat-compression-3-pro", "chat-compression-3-flash", "chat-compression-3.1-flash-lite", "chat-compression-2.5-pro", "chat-compression-2.5-flash", "chat-compression-2.5-flash-lite"],
  weak: ["classifier"],
  editor: ["llm-edit-fixer","edit-corrector"],
};
const nativeChainNames = ["preview","auto-preview","default","auto-default","lite"] as const;
const mainUtilityAliases=["web-search","web-fetch","web-fetch-fallback","loop-detection-double-check"];
// These are native symbolic requests in DEFAULT_MODEL_CONFIGS. They are
// redirected only when they are not real provider catalog IDs.
const nativeUtilityAliases = ["auto", "pro", "flash", "flash-lite", "auto-gemini-3", "auto-gemini-2.5"] as const;

function ownRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 300 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Fault(400, "invalid_model_policy", `${label} is invalid.`);
  }
  return value;
}

/**
 * Compile the portable Switcher policy into native Gemini 0.58.0 settings.
 *
 * Gemini's stable native route controls are modelConfigs.modelIdResolutions
 * and agents.overrides.<agent>.modelConfig.model. Its modelConfigs.modelChains
 * field receives terminal selected-model chains; the gateway owns explicit
 * ordered fallback and retry semantics.
 */
export function compileGeminiModelPolicy(
  selectedModel: string,
  models: readonly Model[],
  compiled: CompiledModelPolicy,
): GeminiModelPolicyFragment {
  const selected = safeId(selectedModel, "model");
  if (compiled.model !== selected) throw new Fault(400, "invalid_model_policy", "Gemini policy does not match the selected model.");
  for(const role of ["planning","review"] as const)if(compiled.roles[role]!==selected)throw new Fault(400,"unsupported_model_role",`Gemini 0.58.0 does not expose an independent ${role} model slot.`);
  const eligible = new Map(models.filter(model => model.available !== false).map(model => [model.id, model]));
  if (!eligible.has(selected) || !compiled.allowedModels.includes(selected)) throw new Fault(422, "model_unavailable", "Selected model is not in the eligible Gemini catalog.");

  for (const model of compiled.allowedModels) {
    safeId(model, "allowed model");
    if (!eligible.has(model)) throw new Fault(422, "model_unavailable", "A policy model is not in the eligible Gemini catalog.");
  }
  const subagent = safeId(compiled.roles[nativeAgentRole], "subagent model");
  if (!eligible.has(subagent)) throw new Fault(422, "model_unavailable", "Subagent model is not in the eligible Gemini catalog.");
  for (const role of Object.keys(nativeRoleAliases) as Exclude<ModelRole, "subagent">[]) {
    if (!eligible.has(compiled.roles[role])) throw new Fault(422, "model_unavailable", `The ${role} model is not in the eligible Gemini catalog.`);
  }

  const modelIdResolutions = ownRecord<{ default: string; contexts: [] }>();
  const customOverrides: Array<{ match: { model: string }; modelConfig: { model: string } }> = [];
  const modelChains = ownRecord<Array<{ model: string; isLastResort: true }>>();
  // Keep the provider catalog visible to Gemini's model picker. Visibility is
  // catalog metadata; the gateway still enforces compiled.allowedModels.
  const modelDefinitions = ownRecord<GeminiModelPolicyFragment["modelConfigs"]["modelDefinitions"][string]>();
  for (const model of models) {
    const id = safeId(model.id, "catalog model");
    modelDefinitions[id] = {
      displayName: model.name,
      tier: "custom",
      family: "switcher",
      isPreview: false,
      isVisible: true,
      features: { thinking: false, multimodalToolUse: model.inputModalities?.includes("image") ?? false },
    };
  }
  for (const id of [...new Set([...compiled.allowedModels, ...models.map(model => model.id)])]) {
    safeId(id, "catalog model");
    modelIdResolutions[id] = { default: id, contexts: [] };
  }
  for (const alias of nativeUtilityAliases) {
    if (!eligible.has(alias)) modelIdResolutions[alias] = { default: selected, contexts: [] };
  }
  for (const role of Object.keys(nativeRoleAliases) as Exclude<ModelRole, "subagent">[]) {
    for (const alias of nativeRoleAliases[role]) customOverrides.push({ match: { model: alias }, modelConfig: { model: compiled.roles[role] } });
  }
  for(const alias of mainUtilityAliases)customOverrides.push({match:{model:alias},modelConfig:{model:selected}});
  // Native defaults include modelChains even when settings omit them. Replace
  // every built-in chain with a terminal selected-policy entry.
  for (const name of nativeChainNames) modelChains[name] = [{ model: selected, isLastResort: true }];

  const fragment: GeminiModelPolicyFragment = { modelConfigs: { customOverrides, modelChains, modelDefinitions, modelIdResolutions,classifierIdResolutions:{flash:{default:selected,contexts:[]},pro:{default:selected,contexts:[]}} } };
  // Gemini's built-in investigator otherwise retains its native Pro default.
  // Always pin it, including the ordinary inherit-selected-main case.
  fragment.agents = { overrides: { codebase_investigator: { modelConfig: { model: subagent } } } };
  return fragment;
}
