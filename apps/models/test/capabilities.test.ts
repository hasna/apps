import { expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  MODEL_CAPABILITY_FIXTURES,
  assertModelCapability,
  validateModelCapability,
} from "../src/capabilities.js";
import { ModelsStore } from "../src/storage.js";
import type { ModelCapability } from "../src/types.js";

test("golden model capability fixtures cover routing provider states", () => {
  expect(MODEL_CAPABILITY_FIXTURES.map((item) => item.runtime.kind)).toEqual(
    expect.arrayContaining(["openai-compatible", "ollama", "lm-studio", "huggingface-artifact"]),
  );
  expect(MODEL_CAPABILITY_FIXTURES.some((item) => item.providerHealth.status === "unavailable")).toBe(true);
  for (const fixture of MODEL_CAPABILITY_FIXTURES) {
    expect(validateModelCapability(fixture)).toEqual({ ok: true, errors: [] });
  }
});

test("capability validation rejects missing pricing and unknown tool support", () => {
  const base = structuredClone(MODEL_CAPABILITY_FIXTURES[0]!) as ModelCapability;
  const missingPricing = { ...base, pricing: undefined as unknown as ModelCapability["pricing"] };
  expect(() => assertModelCapability(missingPricing)).toThrow("pricing is required");

  const unknownTools = { ...base, toolUse: "unknown" as ModelCapability["toolUse"] };
  expect(validateModelCapability(unknownTools).errors).toContain("toolUse must be yes, no, or partial");
});

test("stores and resolves capabilities by model id and alias", () => {
  const dir = mkdtempSync(join(tmpdir(), "models-capabilities-"));
  const store = new ModelsStore(join(dir, "models.db"));

  expect(store.upsertCapabilities(MODEL_CAPABILITY_FIXTURES)).toBe(MODEL_CAPABILITY_FIXTURES.length);
  expect(store.catalogStats().capabilities).toBe(MODEL_CAPABILITY_FIXTURES.length);
  expect(store.listCapabilities({ provider: "ollama" })).toHaveLength(1);
  expect(store.findCapability("ollama:llama3.1:8b")?.runtime.kind).toBe("ollama");
  expect(store.findCapability("down-model")?.providerHealth.status).toBe("unavailable");
  expect(store.findCapability("missing")).toBeNull();
  store.close();
});
