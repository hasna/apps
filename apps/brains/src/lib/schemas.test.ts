// agent-authored (no SOL consult available)

import { describe, expect, test } from "bun:test";
import {
  ProviderSchema,
  FinetuneStartSchema,
  GatherOptionsSchema,
  ModelUpdateSchema,
  McpGatherSchema,
  McpFinetuneStartSchema,
  McpFinetuneStatusSchema,
} from "./schemas.js";
import { DEFAULT_GATHER_LIMIT } from "./compact-output.js";

describe("ProviderSchema", () => {
  test("accepts the two supported providers", () => {
    expect(ProviderSchema.parse("openai")).toBe("openai");
    expect(ProviderSchema.parse("tinker")).toBe("tinker");
  });

  test("rejects any other provider with the canonical error message", () => {
    const result = ProviderSchema.safeParse("gemini");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Invalid provider. Must be one of: openai, tinker",
      );
    }
  });
});

describe("FinetuneStartSchema", () => {
  test("accepts a complete valid payload", () => {
    const parsed = FinetuneStartSchema.parse({
      provider: "openai",
      baseModel: "gpt-4o-mini-2024-07-18",
      name: "my-model",
    });
    expect(parsed.dataset).toBeUndefined();
  });

  test("accepts an optional dataset", () => {
    const parsed = FinetuneStartSchema.parse({
      provider: "tinker",
      baseModel: "m",
      name: "n",
      dataset: "train.jsonl",
    });
    expect(parsed.dataset).toBe("train.jsonl");
  });

  test("rejects a missing base model with the zod required error", () => {
    const result = FinetuneStartSchema.safeParse({ provider: "openai", name: "n" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["baseModel"]);
      expect(result.error.issues[0]?.message).toBe("Required");
    }
  });

  test("rejects an empty base model with the custom message", () => {
    expect(() => FinetuneStartSchema.parse({ provider: "openai", baseModel: "", name: "n" })).toThrow(
      "Base model is required",
    );
  });

  test("rejects a missing name with the zod required error", () => {
    const result = FinetuneStartSchema.safeParse({ provider: "openai", baseModel: "m" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["name"]);
      expect(result.error.issues[0]?.message).toBe("Required");
    }
  });

  test("rejects an empty name with the custom message", () => {
    expect(() => FinetuneStartSchema.parse({ provider: "openai", baseModel: "m", name: "" })).toThrow(
      "Name is required",
    );
  });

  test("rejects an invalid provider", () => {
    expect(() =>
      FinetuneStartSchema.parse({ provider: "other", baseModel: "m", name: "n" }),
    ).toThrow();
  });
});

describe("GatherOptionsSchema", () => {
  test("applies defaults: source all, limit 500", () => {
    const parsed = GatherOptionsSchema.parse({});
    expect(parsed.source).toBe("all");
    expect(parsed.limit).toBe(500);
  });

  test("coerces numeric string limits", () => {
    expect(GatherOptionsSchema.parse({ limit: "10" }).limit).toBe(10);
  });

  test("rejects non-positive or fractional limits", () => {
    expect(() => GatherOptionsSchema.parse({ limit: 0 })).toThrow("Limit must be a positive integer");
    expect(() => GatherOptionsSchema.parse({ limit: -1 })).toThrow("Limit must be a positive integer");
    // 1.5 fails the .int() check before the positive() custom message
    const result = GatherOptionsSchema.safeParse({ limit: 1.5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Expected integer, received float");
    }
    expect(() => GatherOptionsSchema.parse({ limit: "abc" })).toThrow();
  });

  test("rejects unknown sources", () => {
    expect(() => GatherOptionsSchema.parse({ source: "emails" })).toThrow();
  });
});

describe("ModelUpdateSchema", () => {
  test("accepts an empty update", () => {
    expect(ModelUpdateSchema.parse({})).toEqual({});
  });

  test("accepts every optional field", () => {
    const parsed = ModelUpdateSchema.parse({
      displayName: "d",
      description: "desc",
      collection: "c",
      tags: ["a", "b"],
    });
    expect(parsed.tags).toEqual(["a", "b"]);
  });

  test("rejects a non-array tags field and non-string tags", () => {
    expect(() => ModelUpdateSchema.parse({ tags: "prod" })).toThrow();
    expect(() => ModelUpdateSchema.parse({ tags: ["a", 42] })).toThrow();
  });
});

describe("McpGatherSchema", () => {
  test("requires at least one source", () => {
    expect(() => McpGatherSchema.parse({ sources: [] })).toThrow("At least one source required");
  });

  test("defaults limit to DEFAULT_GATHER_LIMIT", () => {
    const parsed = McpGatherSchema.parse({ sources: ["todos"] });
    expect(parsed.limit).toBe(DEFAULT_GATHER_LIMIT);
  });

  test("accepts all supported sources", () => {
    const parsed = McpGatherSchema.parse({
      sources: ["todos", "mementos", "conversations", "sessions"],
      limit: 7,
    });
    expect(parsed.sources).toHaveLength(4);
    expect(parsed.limit).toBe(7);
  });

  test("rejects unknown sources and non-positive limits", () => {
    expect(() => McpGatherSchema.parse({ sources: ["emails"] })).toThrow();
    expect(() => McpGatherSchema.parse({ sources: ["todos"], limit: 0 })).toThrow();
    expect(() => McpGatherSchema.parse({ sources: ["todos"], limit: -3 })).toThrow();
    // Numeric strings are NOT coerced here — the MCP contract is typed numbers
    expect(() => McpGatherSchema.parse({ sources: ["todos"], limit: "5" })).toThrow();
  });
});

describe("McpFinetuneStartSchema", () => {
  test("requires base_model and provider", () => {
    const missingModel = McpFinetuneStartSchema.safeParse({ provider: "openai" });
    expect(missingModel.success).toBe(false);
    if (!missingModel.success) {
      expect(missingModel.error.issues[0]?.path).toEqual(["base_model"]);
      expect(missingModel.error.issues[0]?.message).toBe("Required");
    }
    expect(() => McpFinetuneStartSchema.parse({ base_model: "m" })).toThrow();
  });

  test("name and dataset_path are optional", () => {
    const parsed = McpFinetuneStartSchema.parse({ provider: "tinker", base_model: "m" });
    expect(parsed.name).toBeUndefined();
    expect(parsed.dataset_path).toBeUndefined();
  });
});

describe("McpFinetuneStatusSchema", () => {
  test("requires job_id and a valid provider", () => {
    const missingJob = McpFinetuneStatusSchema.safeParse({ provider: "openai" });
    expect(missingJob.success).toBe(false);
    if (!missingJob.success) {
      expect(missingJob.error.issues[0]?.path).toEqual(["job_id"]);
      expect(missingJob.error.issues[0]?.message).toBe("Required");
    }
    expect(() => McpFinetuneStatusSchema.parse({ job_id: "", provider: "openai" })).toThrow(
      "Job ID is required",
    );
    expect(() => McpFinetuneStatusSchema.parse({ job_id: "j1", provider: "other" })).toThrow();
  });

  test("accepts a valid payload", () => {
    const parsed = McpFinetuneStatusSchema.parse({ job_id: "job-1", provider: "openai" });
    expect(parsed.job_id).toBe("job-1");
    expect(parsed.provider).toBe("openai");
  });
});

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
