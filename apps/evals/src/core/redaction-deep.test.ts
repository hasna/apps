import { describe, expect, test } from "bun:test";
import { redactAdapterConfig, redactRunSecrets } from "./redaction.js";
import type { AdapterConfig, EvalRun, EvalResult } from "../types/index.js";

// Sol-guided coverage (tests-coverage-sol workflow, evals lane), priority 1:
//   "Add pure tests for redactAdapterConfig and redactRunSecrets using a
//    synthetic config with apiKey, url, model, systemPrompt, nested metadata,
//    and arrays. Assert the returned config has no apiKey key, preserves every
//    non-secret field exactly, leaves undefined input undefined, and does not
//    mutate the original object: the original must still contain its apiKey
//    while the returned object must not. Add a negative config without apiKey
//    and assert deep equality. For a run, assert all fields and adapterConfig
//    safe fields survive while the key is absent. Search the serialized result
//    recursively so a leaked nested key cannot pass."
//
// The recursive serialized search makes the test strong in both directions:
// the secret VALUE must be absent from the entire serialized tree, while every
// preserved field must be present exactly — so a redaction that simply dropped
// the whole config (or failed to drop the key) cannot pass.

const SECRET = "LIVE-SECRET-VALUE-9f2c1a77"; // synthetic fixture; deliberately not a real key shape

function syntheticConfig(): AdapterConfig {
  return {
    type: "anthropic",
    url: "https://api.example.com/v1/messages",
    model: "claude-sonnet-4-6",
    systemPrompt: "You are a tester",
    maxTokens: 2048,
    apiKey: SECRET,
    metadata: {
      env: "prod",
      tags: ["a", "b", "c"],
      owner: { name: "qa", team: "evals" },
    },
    headers: { "X-Custom": "v1", "X-Other": ["x", "y"] },
  } as unknown as AdapterConfig;
}

/** Recursively collect every key and every string value in a serializable tree. */
function collect(obj: unknown, keys: string[], values: string[]): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj === "string") {
    values.push(obj);
    return;
  }
  if (typeof obj === "number" || typeof obj === "boolean") return;
  if (Array.isArray(obj)) {
    for (const item of obj) collect(item, keys, values);
    return;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as unknown as Record<string, unknown>)) {
      keys.push(k);
      collect(v, keys, values);
    }
  }
}

describe("redactAdapterConfig — deep synthetic config", () => {
  test("strips apiKey, preserves every non-secret field exactly, and does not mutate the original", () => {
    const config = syntheticConfig();
    const redacted = redactAdapterConfig(config);

    // The original still carries the key — redaction must not mutate in place.
    expect((config as unknown as Record<string, unknown>)["apiKey"]).toBe(SECRET);
    expect(redacted).not.toBe(config);

    // No apiKey key anywhere at the top level of the returned config.
    expect("apiKey" in (redacted as unknown as Record<string, unknown>)).toBe(false);

    // Every non-secret field survives exactly: url, model, systemPrompt,
    // maxTokens, nested metadata (with arrays), and the headers map.
    expect((redacted as unknown as Record<string, unknown>)["url"]).toBe("https://api.example.com/v1/messages");
    expect((redacted as unknown as Record<string, unknown>)["model"]).toBe("claude-sonnet-4-6");
    expect((redacted as unknown as Record<string, unknown>)["systemPrompt"]).toBe("You are a tester");
    expect((redacted as unknown as Record<string, unknown>)["maxTokens"]).toBe(2048);
    expect((redacted as unknown as Record<string, unknown>)["metadata"]).toEqual({
      env: "prod",
      tags: ["a", "b", "c"],
      owner: { name: "qa", team: "evals" },
    });
    expect((redacted as unknown as Record<string, unknown>)["headers"]).toEqual({ "X-Custom": "v1", "X-Other": ["x", "y"] });
  });

  test("the serialized returned config contains no apiKey key and no key value at any depth", () => {
    const redacted = redactAdapterConfig(syntheticConfig());

    const keys: string[] = [];
    const values: string[] = [];
    collect(redacted, keys, values);

    // No key named apiKey anywhere in the returned tree.
    expect(keys).not.toContain("apiKey");
    // The secret VALUE is absent from the entire serialized tree — a leaked
    // nested key could not pass this recursive search.
    expect(values).not.toContain(SECRET);
    expect(JSON.stringify(redacted)).not.toContain(SECRET);
  });

  test("negative: a config without apiKey survives deep-equal, keys and values intact", () => {
    const config = syntheticConfig();
    delete (config as unknown as Record<string, unknown>)["apiKey"];

    const redacted = redactAdapterConfig(config);
    expect(redacted).toEqual(config);

    const keys: string[] = [];
    const values: string[] = [];
    collect(redacted, keys, values);
    expect(keys).toContain("url");
    expect(keys).toContain("metadata");
    expect(values).toContain("a");
    expect(values).toContain("https://api.example.com/v1/messages");
  });

  test("undefined input stays undefined", () => {
    expect(redactAdapterConfig(undefined)).toBeUndefined();
  });
});

describe("redactRunSecrets — deep run", () => {
  const baseResult: EvalResult = {
    caseId: "case-1",
    verdict: "PASS",
    output: "hello",
    assertionResults: [],
    durationMs: 12,
  };

  function makeRun(): EvalRun {
    return {
      id: "run-deep-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      dataset: "deep.jsonl",
      baselineName: "main",
      adapterConfig: syntheticConfig(),
      results: [baseResult],
      stats: {
        total: 1,
        passed: 1,
        failed: 0,
        unknown: 0,
        errors: 0,
        passRate: 1,
        totalDurationMs: 12,
        totalCostUsd: 0.001,
        totalTokens: 100,
      },
    };
  }

  test("all run fields and safe adapterConfig fields survive while the key is absent", () => {
    const run = makeRun();
    const safe = redactRunSecrets(run);

    expect(safe.id).toBe("run-deep-1");
    expect(safe.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(safe.dataset).toBe("deep.jsonl");
    expect(safe.baselineName).toBe("main");
    expect(safe.results).toEqual([baseResult]);
    expect(safe.stats).toEqual(run.stats);

    const adapter = safe.adapterConfig as unknown as Record<string, unknown>;
    expect("apiKey" in adapter).toBe(false);
    expect(adapter["model"]).toBe("claude-sonnet-4-6");
    expect(adapter["url"]).toBe("https://api.example.com/v1/messages");
    expect(adapter["metadata"]).toEqual({
      env: "prod",
      tags: ["a", "b", "c"],
      owner: { name: "qa", team: "evals" },
    });
  });

  test("the serialized run contains no apiKey key and no key value at any depth", () => {
    const safe = redactRunSecrets(makeRun());

    const keys: string[] = [];
    const values: string[] = [];
    collect(safe, keys, values);
    expect(keys).not.toContain("apiKey");
    expect(values).not.toContain(SECRET);
    expect(JSON.stringify(safe)).not.toContain(SECRET);
  });

  test("the original run is not mutated", () => {
    const run = makeRun();
    redactRunSecrets(run);
    expect((run.adapterConfig as unknown as Record<string, unknown>)["apiKey"]).toBe(SECRET);
  });
});
