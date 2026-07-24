import { describe, expect, test } from "bun:test";
import {
  ARTIFACT_REPLAY_POLICY,
  SOURCE_REPLAY_POLICY,
  assertArchiveExtractionClosed,
  assertCommandRecordMatchesPolicy,
  type CanonicalCommandPolicy,
} from "../scripts/stage-a-verifier-policy.js";

function recordFor(policy: CanonicalCommandPolicy): Record<string, unknown> {
  return {
    label: policy.label,
    argv: [...policy.argv],
    env: { ...policy.env },
    stdin: policy.stdin,
    deadline_ms: policy.deadlineMs,
    output_limit_bytes: policy.outputLimitBytes,
    termination: "exit",
    timed_out: false,
    output_limited: false,
    expected_exit: policy.expectedExit,
    expected_authority_floor_occurrences: policy.expectedAuthorityFloor,
    preloads: policy.preloads.map((path) => ({ path })),
    inputs: policy.inputs.map((path) => ({ path })),
    output_comparison: {
      mode: policy.outputComparisonRules.length ? "normalized-text-v1" : "exact-bytes",
      rules: [...policy.outputComparisonRules],
    },
  };
}

describe("standalone verifier-owned semantic policy", () => {
  test("owns the complete source and artifact command matrices", () => {
    expect(SOURCE_REPLAY_POLICY).toHaveLength(29);
    expect(ARTIFACT_REPLAY_POLICY).toHaveLength(13);
    expect(new Set(SOURCE_REPLAY_POLICY.map((policy) => policy.label)).size).toBe(29);
    expect(new Set(ARTIFACT_REPLAY_POLICY.map((policy) => policy.label)).size).toBe(13);
    for (const policy of [...SOURCE_REPLAY_POLICY, ...ARTIFACT_REPLAY_POLICY]) {
      expect(policy.argv.length).toBeGreaterThan(0);
      expect(policy.stdin).toBe("ignore");
      expect(policy.env.HASNA_TODOS_STORAGE_MODE).toBe("remote");
      expect(policy.env.TODOS_STORAGE_MODE).toBe("remote");
    }
  });

  test("rejects a self-consistent benign command substitution", () => {
    const policy = SOURCE_REPLAY_POLICY[0]!;
    const record = recordFor(policy);
    record.argv = ["/opt/bin/bun", "-e", "process.exit(0)"];
    record.expected_exit = 0;
    expect(() => assertCommandRecordMatchesPolicy(record, policy, "tampered record"))
      .toThrow(/argv/i);
  });

  test("rejects manifest-selected env, stdin, preload, exit, deadline, and output semantics", () => {
    const policy = SOURCE_REPLAY_POLICY.find((candidate) => candidate.preloads.length > 0)!;
    for (const [field, mutate] of [
      ["env", (record: Record<string, any>) => { record.env.TODOS_STORAGE_MODE = "local"; }],
      ["stdin", (record: Record<string, any>) => { record.stdin = "inherit"; }],
      ["preloads", (record: Record<string, any>) => { record.preloads = []; }],
      ["expected exit", (record: Record<string, any>) => { record.expected_exit = policy.expectedExit === 0 ? 1 : 0; }],
      ["deadline", (record: Record<string, any>) => { record.deadline_ms = policy.deadlineMs + 1; }],
      ["output limit", (record: Record<string, any>) => { record.output_limit_bytes = policy.outputLimitBytes + 1; }],
      ["termination", (record: Record<string, any>) => { record.termination = "timeout"; }],
      ["timeout outcome", (record: Record<string, any>) => { record.timed_out = true; }],
      ["output-limit outcome", (record: Record<string, any>) => { record.output_limited = true; }],
    ] as const) {
      const record = recordFor(policy);
      mutate(record);
      expect(() => assertCommandRecordMatchesPolicy(record, policy, field)).toThrow();
    }
  });

  test("requires explicit parent directories for standalone extraction closure", () => {
    const orphaned = [
      { path: "dashboard/node_modules", type: "directory" },
      { path: "dashboard/node_modules/example", type: "file" },
    ];
    expect(() => assertArchiveExtractionClosed(orphaned)).toThrow(/dashboard/);
    expect(() => assertArchiveExtractionClosed([
      { path: "dashboard", type: "directory" },
      ...orphaned,
    ])).not.toThrow();
  });
});
