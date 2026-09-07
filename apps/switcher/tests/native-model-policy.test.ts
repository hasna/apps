import { describe, expect, test } from "bun:test";
import { compileNativeModelPolicy } from "../src/native-model-policy";

const roles = { main: "flash", subagent: "pro", fast: "flash", planning: "pro", review: "review", summary: "flash", compaction: "flash", weak: "flash", editor: "review" } as const;

describe("compileNativeModelPolicy", () => {
  test("compiles Claude's documented default, tier aliases and FORCE policy", () => {
    const policy = compileNativeModelPolicy({ harness: "claude", version: "2.1.263", mainModel: "flash", roles });
    expect(policy.env).toEqual({
      ANTHROPIC_MODEL: "flash", ANTHROPIC_DEFAULT_MODEL: "flash", CLAUDE_CODE_SUBAGENT_MODEL: "pro", CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "flash", ANTHROPIC_DEFAULT_SONNET_MODEL: "flash", ANTHROPIC_DEFAULT_HAIKU_MODEL: "flash", ANTHROPIC_DEFAULT_FABLE_MODEL: "flash",
    });
    expect(policy.unsupportedRoles).toEqual(["planning", "review", "summary", "compaction", "weak", "editor"]);
    expect(() => compileNativeModelPolicy({ harness: "claude", version: "2.1.256", mainModel: "flash" })).toThrow("2.1.257");
  });

  test("keeps Codex review and default subagent settings explicit", () => {
    const policy = compileNativeModelPolicy({ harness: "codex", mainModel: "flash", roles });
    expect(policy.config).toEqual({ model: "flash", review_model: "review", agents: { default_subagent_model: "pro" } });
  });

  test("compiles only verified OMP and Kilo role names", () => {
    expect(compileNativeModelPolicy({ harness: "omp", mainModel: "flash", roles }).config).toEqual({ modelRoles: { default: "flash", smol: "flash", slow: "pro", plan: "pro" } });
    expect(compileNativeModelPolicy({ harness: "kilo", mainModel: "flash", roles }).config).toEqual({ model: "flash", small_model: "flash", subagent_model: "pro" });
  });

  test("rejects an empty main model and reports unsupported native surfaces", () => {
    expect(() => compileNativeModelPolicy({ harness: "pi", mainModel: " " })).toThrow("non-empty");
    const policy = compileNativeModelPolicy({ harness: "dsh", mainModel: "flash" });
    expect(policy.config).toEqual({ model: "flash" });
    expect(policy.unsupportedRoles).toContain("subagent");
  });
});
