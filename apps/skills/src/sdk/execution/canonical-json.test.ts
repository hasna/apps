import { describe, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../../test-preload.js";
useDefaultTestTimeout();

import { createSubmitRunService, digestInput } from "./admission.js";
import { createImageProfileRegistry } from "./image-profile.js";
import { MemoryRunExecutionStore, SqliteRunExecutionStore, type RunExecutionStore } from "./storage.js";
import { canonicalJson } from "./types.js";

describe("canonical JSON input identity", () => {
  test("retains explicit special keys at every JSON object depth without mutating the input", () => {
    // Object literals give __proto__ special syntax; parsed JSON gives it an own data property.
    const input = JSON.parse('{"z":[{"__proto__":{"nested":true},"constructor":"text"}],"__proto__":{"marker":"owned"},"prototype":null,"a":{"__proto__":[1,2]}}');
    const before = JSON.stringify(input);
    const originalPrototype = Object.getPrototypeOf(input);
    const serialized = canonicalJson(input);
    expect(serialized).toBe('{"__proto__":{"marker":"owned"},"a":{"__proto__":[1,2]},"prototype":null,"z":[{"__proto__":{"nested":true},"constructor":"text"}]}');
    expect(Object.hasOwn(JSON.parse(serialized), "__proto__")).toBe(true);
    expect(JSON.parse(serialized)).toEqual(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.getPrototypeOf(input)).toBe(originalPrototype);
    expect(Object.hasOwn(Object.prototype, "marker")).toBe(false);
  });

  test("preserves each JSON value assigned to __proto__, including null-prototype records", () => {
    for (const value of [null, false, 0, "text", [1, "two"], { nested: true }]) {
      const parsed = JSON.parse('{"__proto__":' + JSON.stringify(value) + '}');
      const record = Object.assign(Object.create(null), parsed);
      for (const input of [parsed, record]) {
        expect(canonicalJson(input)).toBe(JSON.stringify(parsed));
        expect(digestInput(input)).not.toBe(digestInput({}));
      }
    }
  });

  test("equivalent JSON key order shares identity while distinct values and array order do not", () => {
    const first = JSON.parse('{"topic":"example","__proto__":{"b":2,"a":1}}');
    const reordered = JSON.parse('{"__proto__":{"a":1,"b":2},"topic":"example"}');
    expect(canonicalJson(first)).toBe(canonicalJson(reordered));
    expect(digestInput(first)).toBe(digestInput(reordered));
    const different = [
      JSON.parse('{"topic":"example"}'),
      JSON.parse('{"topic":"example","__proto__":{"a":1,"b":3}}'),
      { parts: ["a", "bc"] }, { parts: ["ab", "c"] },
      { parts: ["bc", "a"] }, { parts: ["a\u0000b", "c"] },
      { parts: ["a", "b\u0000c"] }, { parts: [1, "1"] }, { parts: ["1", 1] },
      { text: "é" }, { text: "e\u0301" },
    ];
    const digests = [first, ...different].map(digestInput);
    expect(new Set(digests).size).toBe(digests.length);
  });
});

const profiles = createImageProfileRegistry({
  runtimes: [{ runtime: "bun", version: "1.3.14", imageDigest: "sha256:" + "a".repeat(64) }],
  dependencyLayers: {},
});
const stores: Array<[string, () => RunExecutionStore]> = [
  ["memory", () => new MemoryRunExecutionStore()],
  ["sqlite", () => new SqliteRunExecutionStore(":memory:")],
];

for (const [label, makeStore] of stores) {
  test(`admission distinguishes explicit __proto__ data while deduplicating reordered input (${label})`, async () => {
    const store = makeStore();
    try {
      const service = createSubmitRunService({ store, imageProfiles: profiles });
      const base = {
        tenantId: "tenant-canonical-json", skillId: "example-skill", skillVersion: "1.0.0",
        bundleDigest: "sha256:" + "b".repeat(64), runtime: "bun" as const,
      };
      const first = await service.submit({ ...base, input: { topic: "example" }, idempotencyKey: "without-own-key" });
      const second = await service.submit({ ...base, input: JSON.parse('{"topic":"example","__proto__":{"b":2,"a":1}}'), idempotencyKey: "with-own-key" });
      expect(first.created).toBe(true);
      expect(second.created).toBe(true);
      expect(second.run.runId).not.toBe(first.run.runId);
      expect(second.run.inputDigest).not.toBe(first.run.inputDigest);
      const duplicate = await service.submit({ ...base, input: JSON.parse('{"__proto__":{"a":1,"b":2},"topic":"example"}'), idempotencyKey: "reordered-own-key" });
      expect(duplicate.created).toBe(false);
      expect(duplicate.run.runId).toBe(second.run.runId);
      expect((await store.getRun(first.run.runId))?.admission.inputDigest).toBe(first.run.inputDigest);
      expect((await store.getRun(second.run.runId))?.admission.inputDigest).toBe(second.run.inputDigest);
    } finally {
      await store.close?.();
    }
  });
}
