/**
 * MON-V2-10 — Skills native adapter regression tests.
 *
 * Gate: tests use the exact `runSkill` SDK surface; instruction-only skills
 * are rejected; the bounded invocation result is stored without private
 * payloads.
 *
 * The runner under test is the root `runSkill` export of `@hasna/skills` (the
 * exact package-owned surface named in the monitor-v2 design). Tests inject a
 * fake typed as `typeof runSkill` so the call shape is pinned by the type
 * system, and assert the exact positional surface at runtime.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { runSkill } from "@hasna/skills";
import {
  MAX_OUTPUT_BYTES,
  OUTPUT_TRUNCATION_MARKER,
  invokeSkill,
  type SkillInvocationRecord,
  type SkillsIntegrationConfig,
} from "./skills.js";

const INSTRUCTION_SKILL_ERROR =
  "Skill 'demo' is an instruction skill (kind: instruction) and is not runnable. Instruction skills are consumed by coding agents via SKILL.md, not executed with 'skills run'.";
const NOT_FOUND_ERROR = "Skill 'demo' not found";

type RunSkillResult = Awaited<ReturnType<typeof runSkill>>;

function makeConfig(overrides: Partial<SkillsIntegrationConfig> = {}): SkillsIntegrationConfig {
  return { skillId: "demo", ...overrides };
}

interface FakeRunner {
  calls: Parameters<typeof runSkill>[];
  runner: typeof runSkill;
}

function makeFakeRunner(results: RunSkillResult[]): FakeRunner {
  const calls: Parameters<typeof runSkill>[] = [];
  let index = 0;
  const runner: typeof runSkill = async (...args) => {
    calls.push(args);
    const result = results[index];
    index += 1;
    if (result === undefined) {
      throw new Error("fake runner exhausted");
    }
    return result;
  };
  return { calls, runner };
}

function runFake(results: RunSkillResult[], config: SkillsIntegrationConfig = makeConfig()) {
  const fake = makeFakeRunner(results);
  return { fake, outcome: invokeSkill(config, fake.runner) };
}

afterEach(() => {
  delete process.env.HASNA_MONITOR_SKILLS_TEST_SECRET;
});

describe("skills adapter — exact runSkill SDK surface", () => {
  it("invokes root runSkill with (skillId, [], { stdio: \"pipe\" }) and no env passthrough", async () => {
    const { fake, outcome } = runFake([{ exitCode: 0, stdout: "ok", stderr: "" }]);
    const record = await outcome;

    expect(record.ok).toBe(true);
    expect(fake.calls).toHaveLength(1);
    const [name, args, options] = fake.calls[0]!;
    expect(name).toBe("demo");
    expect(args).toEqual([]);
    expect(options).toEqual({ stdio: "pipe" });
    expect(options).not.toHaveProperty("env");
    expect(options).not.toHaveProperty("installed");
  });

  it("records a succeeded outcome on exit code 0 with bounded stdout and stderr", async () => {
    const { outcome } = runFake([{ exitCode: 0, stdout: "hello", stderr: "" }]);
    const { record } = await outcome;

    expect(record.status).toBe("succeeded");
    expect(record.exitCode).toBe(0);
    expect(record.stdout).toBe("hello");
    expect(record.stderr).toBe("");
    expect(record.reason).toBeUndefined();
  });
});

describe("skills adapter — instruction-only rejection", () => {
  it("rejects an instruction-only skill with reason instruction-only", async () => {
    const { outcome } = runFake([{ exitCode: 1, error: INSTRUCTION_SKILL_ERROR }]);
    const result = await outcome;

    expect(result.ok).toBe(false);
    expect(result.record.status).toBe("rejected");
    expect(result.record.reason).toBe("instruction-only");
    expect(result.record.exitCode).toBe(1);
    expect(result.record.stdout).toBeUndefined();
  });

  it("rejects a portable instruction-skill rejection message the same way", async () => {
    const portable =
      "Portable skill 'demo' is an instruction skill (kind: instruction) and is not runnable. Instruction skills are consumed by coding agents via SKILL.md, not executed with 'skills run'.";
    const { outcome } = runFake([{ exitCode: 1, error: portable }]);
    const result = await outcome;

    expect(result.record.status).toBe("rejected");
    expect(result.record.reason).toBe("instruction-only");
  });

  it("rejects an unknown skill with reason not-found", async () => {
    const { outcome } = runFake([{ exitCode: 1, error: NOT_FOUND_ERROR }]);
    const result = await outcome;

    expect(result.ok).toBe(false);
    expect(result.record.status).toBe("rejected");
    expect(result.record.reason).toBe("not-found");
  });

  it("never stores a rejected instruction skill as succeeded", async () => {
    const { outcome } = runFake([{ exitCode: 1, error: INSTRUCTION_SKILL_ERROR }]);
    const { record } = await outcome;
    expect(record.status).not.toBe("succeeded");
  });
});

describe("skills adapter — failure classification", () => {
  it("classifies a generic non-zero exit as failed with reason non-zero-exit", async () => {
    const { outcome } = runFake([{ exitCode: 2, stderr: "boom", stdout: "partial" }]);
    const result = await outcome;

    expect(result.ok).toBe(false);
    expect(result.record.status).toBe("failed");
    expect(result.record.reason).toBe("non-zero-exit");
    expect(result.record.exitCode).toBe(2);
    expect(result.record.stderr).toBe("boom");
    expect(result.record.stdout).toBe("partial");
  });

  it("a required integration failure is flagged on the outcome", async () => {
    const { outcome } = runFake([{ exitCode: 1, error: NOT_FOUND_ERROR }], makeConfig({ required: true }));
    const result = await outcome;
    expect(result.requiredFailed).toBe(true);
  });

  it("a non-required integration failure is not flagged", async () => {
    const { outcome } = runFake([{ exitCode: 1, error: NOT_FOUND_ERROR }], makeConfig({ required: false }));
    const result = await outcome;
    expect(result.requiredFailed).toBe(false);
  });
});

describe("skills adapter — bounded result without private payloads", () => {
  it("truncates oversized stdout and stderr to MAX_OUTPUT_BYTES with a marker", async () => {
    const big = "x".repeat(MAX_OUTPUT_BYTES * 4);
    const { outcome } = runFake([{ exitCode: 0, stdout: big, stderr: big }]);
    const { record } = await outcome;

    expect(record.stdout!.length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES + OUTPUT_TRUNCATION_MARKER.length);
    expect(record.stderr!.length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES + OUTPUT_TRUNCATION_MARKER.length);
    expect(record.stdout!.endsWith(OUTPUT_TRUNCATION_MARKER)).toBe(true);
    expect(record.stderr!.endsWith(OUTPUT_TRUNCATION_MARKER)).toBe(true);
  });

  it("keeps output under the bound for output at the exact limit", async () => {
    const exact = "y".repeat(MAX_OUTPUT_BYTES);
    const { outcome } = runFake([{ exitCode: 0, stdout: exact, stderr: "" }]);
    const { record } = await outcome;
    expect(record.stdout).toBe(exact);
  });

  it("stores no environment, arguments, or credential-bearing fields in the record", async () => {
    process.env.HASNA_MONITOR_SKILLS_TEST_SECRET = "sentinel-value-xyz";
    const secret = process.env.HASNA_MONITOR_SKILLS_TEST_SECRET;
    const { outcome } = runFake(
      [{ exitCode: 0, stdout: "result", stderr: "" }],
      makeConfig(),
    );
    const result = await outcome;
    const record: SkillInvocationRecord = result.record;

    expect(record).not.toHaveProperty("env");
    expect(record).not.toHaveProperty("args");
    expect(record).not.toHaveProperty("path");
    expect(JSON.stringify(record)).not.toContain(secret);
    const ALLOWED_KEYS = new Set(["skillId", "status", "reason", "exitCode", "stdout", "stderr", "error"]);
    for (const key of Object.keys(record)) {
      expect(ALLOWED_KEYS.has(key)).toBe(true);
    }
  });

  it("bounds the recorded error message as well", async () => {
    const hugeError = "e".repeat(MAX_OUTPUT_BYTES * 2);
    const { outcome } = runFake([{ exitCode: 1, error: hugeError }]);
    const { record } = await outcome;
    expect(record.error!.length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES + OUTPUT_TRUNCATION_MARKER.length);
  });
});
