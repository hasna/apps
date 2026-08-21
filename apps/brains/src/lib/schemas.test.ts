import { describe, expect, test } from "bun:test";
import { FinetuneStartSchema, ProviderSchema } from "./schemas.js";

describe("ProviderSchema legacy-name migration", () => {
  test("accepts the canonical provider names", () => {
    expect(ProviderSchema.parse("openai")).toBe("openai");
    expect(ProviderSchema.parse("tinker")).toBe("tinker");
  });

  test("normalizes the pre-0.0.36 legacy provider name thinker-labs to tinker", () => {
    // 0.0.35 and earlier persisted and dispatched provider value "thinker-labs".
    // Existing rows and callers must keep working after the rename (regression
    // for the release-review P1: provider rename without a migration path).
    expect(ProviderSchema.parse("thinker-labs")).toBe("tinker");
  });

  test("rejects an unknown provider", () => {
    expect(ProviderSchema.safeParse("mystery-provider").success).toBe(false);
  });

  test("FinetuneStartSchema normalizes the legacy provider in nested schemas", () => {
    const parsed = FinetuneStartSchema.parse({
      provider: "thinker-labs",
      baseModel: "gpt-4o-mini",
      name: "legacy-config-model",
    });
    expect(parsed.provider).toBe("tinker");
  });
});
