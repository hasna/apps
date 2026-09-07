import { describe, expect, test } from "bun:test";
import { compileModelPolicy } from "../src/model-policy";
import { compileGeminiModelPolicy } from "../src/gemini-model-policy";
import type { Model } from "../src/domain";

const models: Model[] = [
  { id: "main", name: "Main", inputModalities: ["text", "image"] },
  { id: "sub", name: "Subagent" },
  { id: "fallback", name: "Fallback", available: true },
  { id: "hidden", name: "Hidden", available: false },
];

// Mirrors the pinned ModelConfigService.resolveModelId implementation
// (chunk-RTL6OG34.js:341900-341927): exact key lookup, first matching context,
// then default. This fixture exercises the native resolver contract without
// starting Gemini or making a provider call.
function nativeResolve(fragment: ReturnType<typeof compileGeminiModelPolicy>, requested: string): string {
  return fragment.modelConfigs.modelIdResolutions[requested]?.default ?? requested;
}

function policy(model = "main", roles?: Record<string, string>) {
  return compileModelPolicy(model, models, { roles: roles as never, fallbacks: { main: ["fallback"] } });
}

describe("Gemini 0.58 model policy compiler", () => {
  test("emits exact catalog resolutions and keeps every default role on selected main", () => {
    const compiled = policy();
    const fragment = compileGeminiModelPolicy("main", models, compiled);
    expect(Object.keys(fragment.modelConfigs.modelDefinitions).sort()).toEqual(["fallback", "hidden", "main", "sub"]);
    expect(fragment.modelConfigs.modelIdResolutions.main).toEqual({ default: "main", contexts: [] });
    expect(fragment.modelConfigs.modelIdResolutions.flash).toEqual({ default: "main", contexts: [] });
    expect(fragment.modelConfigs.modelDefinitions.main).toMatchObject({ displayName: "Main", family: "switcher", isVisible: true });
    expect(fragment.agents).toEqual({ overrides: { codebase_investigator: { modelConfig: { model: "main" } } } });
    expect(fragment.modelConfigs.modelChains["lite"]).toEqual([{ model: "main", isLastResort: true }]);
  });

  test("maps an explicit subagent role only to the verified codebase investigator slot", () => {
    const compiled = policy("main", { subagent: "sub" });
    const fragment = compileGeminiModelPolicy("main", models, compiled);
    expect(fragment.agents).toEqual({ overrides: { codebase_investigator: { modelConfig: { model: "sub" } } } });
  });

  test("pinned native resolver maps utility aliases and investigator config to selected main", () => {
    const fragment = compileGeminiModelPolicy("main", models, policy());
    expect(nativeResolve(fragment, "flash")).toBe("main");
    expect(nativeResolve(fragment, "auto")).toBe("main");
    expect(fragment.agents?.overrides.codebase_investigator.modelConfig.model).toBe("main");
    expect(nativeResolve(fragment, "provider-unlisted")).toBe("provider-unlisted");
  });

  test("pins verified utility role aliases to their compiled role models", () => {
    const compiled = policy("main", { fast: "sub", summary: "sub", editor: "fallback" });
    const fragment = compileGeminiModelPolicy("main", models, compiled);
    expect(fragment.modelConfigs.customOverrides).toContainEqual({ match: { model: "fast-ack-helper" }, modelConfig: { model: "sub" } });
    expect(fragment.modelConfigs.customOverrides).toContainEqual({ match: { model: "prompt-completion" }, modelConfig: { model: "sub" } });
    expect(fragment.modelConfigs.customOverrides).toContainEqual({ match: { model: "summarizer-default" }, modelConfig: { model: "sub" } });
    expect(fragment.modelConfigs.customOverrides).toContainEqual({ match: { model: "llm-edit-fixer" }, modelConfig: { model: "fallback" } });
    expect(fragment.modelConfigs.modelChains["default"]).toEqual([{ model: "main", isLastResort: true }]);
  });

  test("replaces inherited native availability chains with selected-only terminal chains", () => {
    const fragment = compileGeminiModelPolicy("main", models, policy());
    expect(fragment.modelConfigs.modelChains["default"]).toEqual([{ model: "main", isLastResort: true }]);
  });

  test("rejects selected-model mismatch and unavailable catalog entries safely", () => {
    const compiled = policy();
    expect(() => compileGeminiModelPolicy("sub", models, compiled)).toThrow(/does not match/);
    expect(() => compileGeminiModelPolicy("main", [{ id: "main", name: "Main", available: false }], compiled)).toThrow(/eligible Gemini catalog/);
  });
});

test.skipIf(!process.env.SWITCHER_GEMINI_CORE_BUNDLE)("installed Gemini ModelConfigService resolves utility roles and disables every inherited fallback chain",async()=>{
  const {ModelConfigService,DEFAULT_MODEL_CONFIGS}=await import(process.env.SWITCHER_GEMINI_CORE_BUNDLE!);
  const compiled=compileModelPolicy("main",models,{roles:{subagent:"sub",summary:"sub"}});
  const fragment=compileGeminiModelPolicy("main",models,compiled);
  const native=new ModelConfigService({...DEFAULT_MODEL_CONFIGS,...fragment.modelConfigs});
  for(const override of fragment.modelConfigs.customOverrides){
    expect(Object.hasOwn(DEFAULT_MODEL_CONFIGS.aliases,override.match.model),override.match.model).toBe(true);
    const config=native.getResolvedConfig({model:override.match.model});
    expect(config.model).toBe(override.modelConfig.model);
    const original=new ModelConfigService(DEFAULT_MODEL_CONFIGS).getResolvedConfig({model:override.match.model});
    expect(config.generateContentConfig).toEqual(original.generateContentConfig);
  }
  expect(Object.keys(fragment.modelConfigs.modelChains).sort()).toEqual(Object.keys(DEFAULT_MODEL_CONFIGS.modelChains).sort());
  for(const name of Object.keys(DEFAULT_MODEL_CONFIGS.modelChains))expect(native.resolveChain(name).map((row:any)=>row.model)).toEqual(["main"]);
  for(const tier of ["flash","pro"])expect(native.resolveClassifierModelId(tier,"auto",{hasAccessToPreview:false})).toBe("main");
  expect(fragment.agents?.overrides.codebase_investigator.modelConfig.model).toBe("sub");
});
