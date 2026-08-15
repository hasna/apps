process.env.TESTERS_DB_PATH = ":memory:";

import { describe, expect, test } from "bun:test";
import { resolveAgentApiKeyForModel } from "./runner.js";

describe("resolveAgentApiKeyForModel", () => {
  test("uses configured Anthropic keys only for Anthropic models", () => {
    expect(resolveAgentApiKeyForModel("claude-haiku-4-5-20251001", undefined, "anthropic-config-key")).toBe(
      "anthropic-config-key",
    );
    expect(resolveAgentApiKeyForModel("qwen-3-coder", undefined, "anthropic-config-key")).toBeUndefined();
    expect(resolveAgentApiKeyForModel("glm-5.1", undefined, "anthropic-config-key")).toBeUndefined();
  });

  test("keeps explicit API keys as deliberate per-run overrides", () => {
    expect(resolveAgentApiKeyForModel("glm-5.1", "explicit-run-key", "anthropic-config-key")).toBe(
      "explicit-run-key",
    );
  });
});
