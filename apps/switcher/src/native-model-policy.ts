/** Pure compilation of the documented native model-policy surfaces.
 *
 * This module deliberately does not launch processes, read configuration, or
 * infer provider aliases. Callers provide the exact model IDs they have
 * already selected and may then serialize the returned env/config values.
 */
export const nativeRoles = ["main", "subagent", "fast", "planning", "review", "summary", "compaction", "weak", "editor"] as const;
export type NativeRole = typeof nativeRoles[number];
export type NativePolicyHarness = "claude" | "codex" | "grok" | "opencode" | "opencode2" | "omp" | "hermes" | "aider" | "kilo" | "gemini" | "cline" | "dsh" | "pi" | "prime-agent";
export type NativeModelPolicyInput = {
  harness: NativePolicyHarness;
  mainModel: string;
  roles?: Partial<Record<NativeRole, string>>;
  version?: string;
};
export type NativeModelPolicy = {
  harness: NativePolicyHarness;
  env: Record<string, string>;
  config: Record<string, unknown>;
  unsupportedRoles: NativeRole[];
};

const versionAtLeast = (raw: string | undefined, minimum: readonly [number, number, number]) => {
  const match = raw?.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const actual = match.slice(1).map(Number);
  for (let i = 0; i < 3; i++) {
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
  }
  return true;
};

function exactModels(input: NativeModelPolicyInput): Record<NativeRole, string> {
  if (!input.mainModel.trim()) throw new Error("Native model policy requires a non-empty main model.");
  const result = Object.fromEntries(nativeRoles.map(role => [role, input.roles?.[role]?.trim() || input.mainModel.trim()])) as Record<NativeRole, string>;
  for (const role of nativeRoles) if (!result[role]) throw new Error(`Native model policy role ${role} is empty.`);
  return result;
}

const unsupported = (...roles: NativeRole[]) => roles;

/** Compile exact role assignments into native settings/env without inventing knobs. */
export function compileNativeModelPolicy(input: NativeModelPolicyInput): NativeModelPolicy {
  const models = exactModels(input);
  const env: Record<string, string> = {};
  const config: Record<string, unknown> = {};
  let unsupportedRoles: NativeRole[] = [];
  switch (input.harness) {
    case "claude":
      if (!versionAtLeast(input.version, [2, 1, 257])) throw new Error("Claude model policy enforcement requires Claude Code >=2.1.257.");
      env.ANTHROPIC_MODEL = models.main;
      env.ANTHROPIC_DEFAULT_MODEL = models.main;
      env.CLAUDE_CODE_SUBAGENT_MODEL = models.subagent;
      env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE = "1";
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = models.main;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = models.main;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = models.fast;
      env.ANTHROPIC_DEFAULT_FABLE_MODEL = models.main;
      unsupportedRoles = unsupported("planning", "review", "summary", "compaction", "weak", "editor");
      break;
    case "codex":
      config.model = models.main;
      config.review_model = models.review;
      config.agents = { default_subagent_model: models.subagent };
      unsupportedRoles = unsupported("fast", "planning", "summary", "compaction", "weak", "editor");
      break;
    case "grok":
      config.models = { default: models.main, session_summary: models.summary };
      unsupportedRoles = unsupported("subagent", "fast", "planning", "review", "compaction", "weak", "editor");
      break;
    case "omp":
      config.modelRoles = { default: models.main, smol: models.fast, slow: models.planning, plan: models.planning };
      unsupportedRoles = unsupported("subagent", "review", "summary", "compaction", "weak", "editor");
      break;
    case "kilo":
      config.model = models.main;
      config.small_model = models.weak;
      config.subagent_model = models.subagent;
      unsupportedRoles = unsupported("fast", "planning", "review", "summary", "compaction", "editor");
      break;
    case "aider":
      config.model = models.main;
      config.weak_model_name = models.weak;
      config.editor_model_name = models.editor;
      unsupportedRoles = unsupported("subagent", "fast", "planning", "review", "summary", "compaction");
      break;
    case "opencode":
    case "opencode2":
    case "hermes":
    case "gemini":
    case "cline":
    case "dsh":
    case "pi":
    case "prime-agent":
      config.model = models.main;
      unsupportedRoles = nativeRoles.filter(role => role !== "main");
      break;
  }
  return { harness: input.harness, env, config, unsupportedRoles };
}
