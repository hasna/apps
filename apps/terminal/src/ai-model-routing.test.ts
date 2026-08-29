// Regression tests for O15-04797 — NL provider model selection must not
// hardcode models a configured key cannot access (Cerebras 404, Groq 404,
// xAI stop-param 400).
import { describe, expect, test } from "bun:test";
import { pickModel } from "./ai.js";
import { selectAccessibleModel } from "./providers/base.js";

describe("NL model routing (O15-04797 regression)", () => {
  test("cerebras NL picks gpt-oss-120b when qwen-3-235b is not accessible (was 404 model_not_found)", async () => {
    const provider = {
      name: "cerebras",
      listModels: async () => ["gemma-4-31b", "gpt-oss-120b"],
    } as any;
    const routing = await pickModel("what is 2 plus 2", provider);
    expect(routing.fast).toBe("gpt-oss-120b");
    expect(routing.smart).toBe("gpt-oss-120b");
    expect(routing.pick).toBe("fast");
  });

  test("xai NL picks a stop-capable accessible model, never grok-code-fast-1 / grok-4-fast-non-reasoning", async () => {
    const provider = {
      name: "xai",
      listModels: async () => ["grok-4.20-0309-non-reasoning", "grok-4.20-0309-reasoning", "grok-4.6"],
    } as any;
    const routing = await pickModel("what is 2 plus 2", provider);
    expect(routing.fast).toBe("grok-4.20-0309-non-reasoning");
    expect(routing.smart).toBe("grok-4.20-0309-non-reasoning");
  });

  test("complex prompts route to the smart model slot", async () => {
    const provider = {
      name: "xai",
      listModels: async () => ["grok-4.20-0309-non-reasoning", "grok-4.6"],
    } as any;
    const routing = await pickModel("undo the last change and then revert the previous commit as well", provider);
    expect(routing.pick).toBe("smart");
  });

  test("falls back to the static defaults when the model list cannot be discovered", async () => {
    const provider = {
      name: "cerebras",
      listModels: async () => [],
    } as any;
    const routing = await pickModel("what is 2 plus 2", provider);
    expect(routing.fast).toBe("qwen-3-235b-a22b-instruct-2507");
  });

  test("selectAccessibleModel picks the first preferred model present in the accessible list", () => {
    expect(
      selectAccessibleModel(
        ["grok-4.20-0309-non-reasoning", "grok-code-fast-1"],
        ["grok-4.20-0309-reasoning", "grok-code-fast-1"],
        "grok-code-fast-1",
      ),
    ).toBe("grok-code-fast-1");
  });
});
