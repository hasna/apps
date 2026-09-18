import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { describe, expect, test } from "bun:test";
import { pureInput, uniqueJson, validatePureOutput, PURE_DESCRIPTOR_DIGEST, assertPureAdmission } from "./runtime-pure-contract.js";
import { readRuntimeConfig } from "./runtime-policy.js";
import type { FrozenAdmission } from "../sdk/execution/types.js";

describe("bounded pure contract", () => {
  test("strict JSON detects escaped duplicate keys at any object depth", () => {
    for (const raw of ['{"input":{"pattern":"a","patte\\u0072n":"b"}}', '{"items":[{"x":1,"x":2}]}'])
      expect(() => uniqueJson(raw)).toThrow("Duplicate JSON key");
    expect(uniqueJson('{"__proto__":{"ok":true},"items":[null,true,-1.2e3,"\\\"}"]}')).toEqual(JSON.parse('{"__proto__":{"ok":true},"items":[null,true,-1.2e3,"\\\"}"]}'));
    expect(() => uniqueJson('['.repeat(34) + '0' + ']'.repeat(34))).toThrow("nesting");
  });
  test("trusted JSON adapter preserves literal NUL, equals and option-like input without compiling patterns", () => {
    const input = { pattern: "--file=\0[", text: "\n--command=anything", flags: "gi" };
    expect(pureInput(input)).toEqual(input);
    for (const value of [{ ...input, file: "/tmp/input" }, { ...input, flags: "gg" }, { ...input, flags: "uv" },
      { ...input, pattern: "é".repeat(257) }, { ...input, text: "a".repeat(4097) }, { ...input, text: "\0".repeat(4096) }])
      expect(() => pureInput(value)).toThrow();
  });
  test("output binds literal admitted flags and UTF-16 indexes; no artifacts or alternative schemas", () => {
    const input = { pattern: "a+", text: "😀aaa", flags: "gi" };
    const output = { pattern: input.pattern, flags: input.flags, matches: [{ match: "aaa", index: 2, groups: [null, "a"], namedGroups: { captured: "a" } }] };
    expect(() => validatePureOutput(JSON.stringify(output), input)).not.toThrow();
    for (const bad of [{ ...output, flags: "ig" }, { ...output, pattern: "other" }, { ...output, artifacts: [] },
      { ...output, matches: [{ ...output.matches[0], index: 1 }] }, { ...output, matches: [{ ...output.matches[0], namedGroups: { bad: null } }] }])
      expect(() => validatePureOutput(JSON.stringify(bad), input)).toThrow();
  });
  test("configuration cannot reinterpret a legacy PDF identity as pure by array order", () => {
    const imageDigest = "sha256:" + "a".repeat(64);
    const config = { cluster: "synthetic", taskDefinition: "synthetic", containerName: "synthetic", region: "synthetic", apiOrigin: "https://example.com/api/v1", imageDigest,
      subnets: ["synthetic"], securityGroups: ["synthetic"], reviewedBundles: [{ slug: "pdf-generate", version: "1.0.0", sha256: "b".repeat(64), tenantId: "synthetic", imageDigest,
        executionContract: { id: "regex-test.v1", descriptorDigest: PURE_DESCRIPTOR_DIGEST, entrypoint: "src/index.ts", entrypointDigest: "c".repeat(64) } }] };
    expect(() => readRuntimeConfig({ HASNA_SKILLS_RUNTIME_CONFIG: JSON.stringify(config) })).toThrow("reserved");
  });
  test("forged admission cannot relax isolation or silently become a PDF run", () => {
    const admission: FrozenAdmission = { contractVersion: 1, runId: "run_synthetic", tenantId: "synthetic-tenant", skillId: "synthetic-pure", skillVersion: "1.0.0", bundleDigest: "b".repeat(64), runtimeImageDigest: "sha256:" + "c".repeat(64), inputDigest: "d".repeat(64), idempotencyKey: "synthetic-key", createdAt: new Date().toISOString(), runtime: "bun", dependencyLayerTag: null,
      executionContract: { id: "regex-test.v1", descriptorDigest: PURE_DESCRIPTOR_DIGEST, entrypoint: "src/index.ts", entrypointDigest: "a".repeat(64) },
      policy: { egress: "deny", egressAllowlist: [], networkByteCap: 0 },
      limits: { maxDurationMs: 5000, maxMemoryMb: 512, maxCpuUnits: 256, maxArtifactsBytes: 0, maxConcurrency: 1 } };
    expect(() => assertPureAdmission(admission)).not.toThrow();
    for (const bad of [{ ...admission, dependencyLayerTag: "pdf" }, { ...admission, policy: { ...admission.policy, egressAllowlist: ["example.com"] } },
      { ...admission, limits: { ...admission.limits, maxDurationMs: 60000 } }, { ...admission, executionContract: { ...admission.executionContract!, id: "unreviewed.v2" } }])
      expect(() => assertPureAdmission(bad as FrozenAdmission)).toThrow();
  });
});
