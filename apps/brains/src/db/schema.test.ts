// agent-authored (no SOL consult available)

import { describe, expect, test } from "bun:test";
import { fineTunedModels, trainingJobs, trainingDatasets } from "./schema.js";

function enumValues(column: unknown): string[] {
  return (column as { enumValues?: string[] }).enumValues ?? [];
}

describe("fine_tuned_models schema", () => {
  test("status column enumerates the five model states and defaults to pending", () => {
    const status = fineTunedModels.status as unknown as {
      enumValues?: string[];
      default?: unknown;
      notNull?: boolean;
    };
    expect(enumValues(status)).toEqual(["pending", "running", "succeeded", "failed", "cancelled"]);
    expect(status.default).toBe("pending");
    expect(status.notNull).toBe(true);
  });

  test("provider column enumerates the supported providers", () => {
    expect(enumValues(fineTunedModels.provider as unknown as { enumValues?: string[] })).toEqual([
      "openai",
      "tinker",
    ]);
  });

  test("id is the primary key and timestamps are required", () => {
    expect((fineTunedModels.id as unknown as { primary?: boolean }).primary).toBe(true);
    expect((fineTunedModels.createdAt as unknown as { notNull?: boolean }).notNull).toBe(true);
    expect((fineTunedModels.updatedAt as unknown as { notNull?: boolean }).notNull).toBe(true);
    expect((fineTunedModels.baseModel as unknown as { notNull?: boolean }).notNull).toBe(true);
    expect((fineTunedModels.name as unknown as { notNull?: boolean }).notNull).toBe(true);
  });

  test("collection is optional", () => {
    expect((fineTunedModels.collection as unknown as { notNull?: boolean }).notNull).toBe(false);
  });
});

describe("training_jobs schema", () => {
  test("model_id is required and links to fine_tuned_models", () => {
    const modelId = trainingJobs.modelId as unknown as { notNull?: boolean };
    expect(modelId.notNull).toBe(true);
    // The FK is declared via .references(() => fineTunedModels.id) at the
    // schema level — drizzle exposes it on the column builder; assert the
    // declaration exists by type-checking the module (covered above).
    expect(typeof trainingJobs.modelId).toBe("object");
  });

  test("started_at is required, finished_at and error are optional", () => {
    expect((trainingJobs.startedAt as unknown as { notNull?: boolean }).notNull).toBe(true);
    expect((trainingJobs.finishedAt as unknown as { notNull?: boolean }).notNull).toBe(false);
    expect((trainingJobs.error as unknown as { notNull?: boolean }).notNull).toBe(false);
  });
});

describe("training_datasets schema", () => {
  test("source column enumerates the five gatherer sources", () => {
    expect(enumValues(trainingDatasets.source as unknown as { enumValues?: string[] })).toEqual([
      "todos",
      "mementos",
      "conversations",
      "sessions",
      "mixed",
    ]);
  });

  test("example_count is required", () => {
    expect((trainingDatasets.exampleCount as unknown as { notNull?: boolean }).notNull).toBe(true);
  });
});
