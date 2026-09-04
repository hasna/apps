/**
 * MON-V2-10 — Skills native adapter regression tests.
 *
 * Gate: tests use the exact `runSkill` SDK surface; instruction-only skills
 * are rejected; the bounded invocation result is stored without private
 * payloads; the record carries the slug_effects persistence vocabulary; the
 * effect key `hash(slug, run_id, action_index, target, operation)` is stable
 * and deduplicates through a durable effect store; SDK exceptions are
 * classified non-fatally; credential-shaped output is scrubbed (with a
 * non-vacuous echo test).
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
  REDACTION_MARKER,
  effectIdentity,
  invokeSkill,
  type SkillEffectContext,
  type SkillEffectRow,
  type SkillEffectStore,
  type SkillInvocationRecord,
  type SkillsIntegrationConfig,
} from "./skills.js";

const INSTRUCTION_SKILL_ERROR =
  "Skill 'demo' is an instruction skill (kind: instruction) and is not runnable. Instruction skills are consumed by coding agents via SKILL.md, not executed with 'skills run'.";
const NOT_FOUND_ERROR = "Skill 'demo' not found";

type RunSkillResult = Awaited<ReturnType<typeof runSkill>>;

function makeContext(overrides: Partial<SkillEffectContext> = {}): SkillEffectContext {
  return { slug: "demo-slug", runId: "run-1", actionIndex: 0, ...overrides };
}

function makeConfig(overrides: Partial<SkillsIntegrationConfig> = {}): SkillsIntegrationConfig {
  return { skillId: "demo", effect: makeContext(), ...overrides };
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

/** A fake runner that echoes the ambient sentinel into every output surface —
 * the non-vacuous counterpart of "stores no credentials". */
function makeEchoingRunner(): { calls: number; runner: typeof runSkill } {
  let calls = 0;
  const runner: typeof runSkill = async () => {
    calls += 1;
    const secret = process.env.HASNA_MONITOR_SKILLS_TEST_SECRET ?? "sentinel-value-xyz";
    const home = process.env.HOME ?? "";
    return {
      exitCode: 0,
      stdout: `echoed ${secret} at ${home}`,
      stderr: `echoed ${secret}`,
    };
  };
  return { calls, runner: runner as typeof runSkill };
}

/** In-memory effect store with the exact SlugRepository semantics: an effect
 * key can be reserved once; a repeated create returns the existing row with
 * `created: false`. */
interface FakeStore extends SkillEffectStore {
  rows: Map<string, SkillEffectRow>;
  createCount: number;
  updateCount: number;
}

function makeFakeStore(seedRows: SkillEffectRow[] = []): FakeStore {
  const rows = new Map<string, SkillEffectRow>();
  let seq = 0;
  for (const row of seedRows) rows.set(row.effect_key, row);
  const store: FakeStore = {
    rows,
    createCount: 0,
    updateCount: 0,
    getEffectByKey(effectKey) {
      return rows.get(effectKey) ?? null;
    },
    createEffect(input) {
      store.createCount += 1;
      const existing = rows.get(input.effectKey);
      if (existing !== undefined) return { created: false, effect: existing };
      const now = Math.floor(Date.now() / 1000);
      const effect: SkillEffectRow = {
        id: `effect-${seq++}`,
        run_id: input.runId,
        attempt_id: null,
        effect_key: input.effectKey,
        integration: input.integration,
        operation: input.operation,
        target: input.target ?? "",
        state: "planned",
        request_digest: input.requestDigest ?? "",
        external_id: null,
        result_pointer: null,
        last_error_class: null,
        created_at: now,
        updated_at: now,
      };
      rows.set(input.effectKey, effect);
      return { created: true, effect };
    },
    updateEffect(id, patch) {
      store.updateCount += 1;
      const row = [...rows.values()].find((r) => r.id === id);
      if (row === undefined) return;
      if (patch.state !== undefined) row.state = patch.state;
      if (patch.externalId !== undefined) row.external_id = patch.externalId;
      if (patch.resultPointer !== undefined) row.result_pointer = patch.resultPointer;
      if (patch.lastErrorClass !== undefined) row.last_error_class = patch.lastErrorClass;
      row.updated_at = Math.floor(Date.now() / 1000);
    },
  };
  return store;
}

function seededRow(overrides: Partial<SkillEffectRow> = {}): SkillEffectRow {
  return {
    id: "effect-seeded",
    run_id: "run-1",
    attempt_id: null,
    effect_key: "seed-key",
    integration: "skills",
    operation: "run",
    target: "demo",
    state: "failed",
    request_digest: "seed-digest",
    external_id: null,
    result_pointer: null,
    last_error_class: "execution_error",
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.HASNA_MONITOR_SKILLS_TEST_SECRET;
});

describe("skills adapter — exact runSkill SDK surface", () => {
  it("invokes root runSkill with (skillId, [], { stdio: \"pipe\" }) and no env passthrough", async () => {
    const fake = makeFakeRunner([{ exitCode: 0, stdout: "ok", stderr: "" }]);
    const outcome = await invokeSkill(makeConfig(), fake.runner);

    expect(outcome.ok).toBe(true);
    expect(outcome.deduplicated).toBe(false);
    expect(fake.calls).toHaveLength(1);
    const [name, args, options] = fake.calls[0]!;
    expect(name).toBe("demo");
    expect(args).toEqual([]);
    expect(options).toEqual({ stdio: "pipe" });
    expect(options).not.toHaveProperty("env");
    expect(options).not.toHaveProperty("installed");
  });

  it("records a succeeded outcome on exit code 0 with bounded stdout and stderr", async () => {
    const fake = makeFakeRunner([{ exitCode: 0, stdout: "hello", stderr: "" }]);
    const { record } = await invokeSkill(makeConfig(), fake.runner);

    expect(record.status).toBe("succeeded");
    expect(record.exit_code).toBe(0);
    expect(record.stdout).toBe("hello");
    expect(record.stderr).toBe("");
    expect(record.reason).toBeUndefined();
  });
});

describe("skills adapter — stable effect identity", () => {
  it("derives the same effect_key from the same five components", () => {
    const a = effectIdentity(makeContext(), "demo", "run");
    const b = effectIdentity(makeContext(), "demo", "run");
    expect(a.effectKey).toBe(b.effectKey);
    expect(a.requestDigest).toBe(b.requestDigest);
    expect(a.effectKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the effect_key when any of the five components changes", () => {
    const base = effectIdentity(makeContext(), "demo", "run");
    const variants = [
      effectIdentity(makeContext({ slug: "other-slug" }), "demo", "run"),
      effectIdentity(makeContext({ runId: "run-2" }), "demo", "run"),
      effectIdentity(makeContext({ actionIndex: 1 }), "demo", "run"),
      effectIdentity(makeContext(), "other-skill", "run"),
      effectIdentity(makeContext(), "demo", "verify"),
    ];
    for (const variant of variants) {
      expect(variant.effectKey).not.toBe(base.effectKey);
    }
    expect(new Set(variants.map((v) => v.effectKey)).size).toBe(variants.length);
  });

  it("carries the slug_effects vocabulary on a succeeded record", async () => {
    const fake = makeFakeRunner([{ exitCode: 0, stdout: "ok", stderr: "" }]);
    const { record } = await invokeSkill(makeConfig(), fake.runner);

    expect(record.effect_key).toBe(effectIdentity(makeContext(), "demo", "run").effectKey);
    expect(record.integration).toBe("skills");
    expect(record.operation).toBe("run");
    expect(record.target).toBe("demo");
    expect(record.state).toBe("confirmed");
    expect(record.request_digest).toBe(effectIdentity(makeContext(), "demo", "run").requestDigest);
    expect(record.skill_id).toBe("demo");
  });

  it("defaults target and operation and accepts explicit overrides", async () => {
    const fake = makeFakeRunner([{ exitCode: 0, stdout: "ok", stderr: "" }]);
    const { record } = await invokeSkill(
      makeConfig({ skillId: "demo", effect: makeContext({ target: "demo/check", operation: "verify" }) }),
      fake.runner,
    );
    expect(record.target).toBe("demo/check");
    expect(record.operation).toBe("verify");
  });
});

describe("skills adapter — durable deduplication through the effect store", () => {
  it("executes once and confirms the effect when the key is fresh", async () => {
    const store = makeFakeStore();
    const fake = makeFakeRunner([{ exitCode: 0, stdout: "ok", stderr: "" }]);
    const outcome = await invokeSkill(makeConfig(), fake.runner, store);

    expect(outcome.ok).toBe(true);
    expect(outcome.deduplicated).toBe(false);
    expect(fake.calls).toHaveLength(1);
    expect(store.updateCount).toBe(1);
    const stored = store.rows.get(effectIdentity(makeContext(), "demo", "run").effectKey);
    expect(stored?.state).toBe("confirmed");
    expect(stored?.integration).toBe("skills");
    expect(stored?.target).toBe("demo");
  });

  it("does NOT re-execute on a retry with the same five components", async () => {
    const store = makeFakeStore();
    const fake = makeFakeRunner([{ exitCode: 0, stdout: "ok", stderr: "" }]);
    const config = makeConfig();

    const first = await invokeSkill(config, fake.runner, store);
    const second = await invokeSkill(config, fake.runner, store);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.deduplicated).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(second.record.status).toBe("succeeded");
    expect(second.record.state).toBe("confirmed");
    expect(store.createCount).toBe(2);
    expect(store.updateCount).toBe(1);
  });

  it("deduplicates across a process restart (fresh adapter over the same durable store)", async () => {
    const store = makeFakeStore();
    const fake1 = makeFakeRunner([{ exitCode: 0, stdout: "ok", stderr: "" }]);
    await invokeSkill(makeConfig(), fake1.runner, store);

    // "Restart": a brand-new invokeSkill call and runner over the same store.
    const fake2 = makeFakeRunner([{ exitCode: 0, stdout: "ok", stderr: "" }]);
    const outcome = await invokeSkill(makeConfig(), fake2.runner, store);

    expect(outcome.deduplicated).toBe(true);
    expect(fake2.calls).toHaveLength(0);
  });

  it("returns a stored failed effect without executing, preserving its failure class", async () => {
    const key = effectIdentity(makeContext(), "demo", "run").effectKey;
    const store = makeFakeStore([seededRow({ effect_key: key })]);
    const fake = makeFakeRunner([{ exitCode: 0, stdout: "ok", stderr: "" }]);

    const outcome = await invokeSkill(makeConfig(), fake.runner, store);

    expect(outcome.ok).toBe(false);
    expect(outcome.deduplicated).toBe(true);
    expect(fake.calls).toHaveLength(0);
    expect(outcome.record.status).toBe("failed");
    expect(outcome.record.reason).toBe("stored-failure");
    expect(outcome.record.state).toBe("failed");
    expect(outcome.record.last_error_class).toBe("execution_error");
    expect(outcome.record.exit_code).toBe(-1);
    expect(outcome.requiredFailed).toBe(false);
  });

  it("flags a required integration failure on the deduplicated outcome", async () => {
    const key = effectIdentity(makeContext(), "demo", "run").effectKey;
    const store = makeFakeStore([seededRow({ effect_key: key })]);
    const fake = makeFakeRunner([{ exitCode: 0, stdout: "ok", stderr: "" }]);

    const outcome = await invokeSkill(makeConfig({ required: true }), fake.runner, store);
    expect(outcome.requiredFailed).toBe(true);
  });

  it("does not deduplicate without a store, but still records the identity", async () => {
    const fake = makeFakeRunner([{ exitCode: 0, stdout: "ok", stderr: "" }]);
    const first = await invokeSkill(makeConfig(), fake.runner);
    const second = await invokeSkill(makeConfig(), fake.runner);
    expect(fake.calls).toHaveLength(2);
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(false);
    expect(first.record.effect_key).toBe(second.record.effect_key);
  });
});

describe("skills adapter — instruction-only rejection", () => {
  it("rejects an instruction-only skill with reason instruction-only", async () => {
    const fake = makeFakeRunner([{ exitCode: 1, error: INSTRUCTION_SKILL_ERROR }]);
    const result = await invokeSkill(makeConfig(), fake.runner);

    expect(result.ok).toBe(false);
    expect(result.record.status).toBe("rejected");
    expect(result.record.reason).toBe("instruction-only");
    expect(result.record.exit_code).toBe(1);
    expect(result.record.state).toBe("failed");
    expect(result.record.last_error_class).toBe("invalid_input");
    expect(result.record.stdout).toBeUndefined();
  });

  it("rejects a portable instruction-skill rejection message the same way", async () => {
    const portable =
      "Portable skill 'demo' is an instruction skill (kind: instruction) and is not runnable. Instruction skills are consumed by coding agents via SKILL.md, not executed with 'skills run'.";
    const fake = makeFakeRunner([{ exitCode: 1, error: portable }]);
    const result = await invokeSkill(makeConfig(), fake.runner);

    expect(result.record.status).toBe("rejected");
    expect(result.record.reason).toBe("instruction-only");
  });

  it("rejects an unknown skill with reason not-found and class not_found", async () => {
    const fake = makeFakeRunner([{ exitCode: 1, error: NOT_FOUND_ERROR }]);
    const result = await invokeSkill(makeConfig(), fake.runner);

    expect(result.ok).toBe(false);
    expect(result.record.status).toBe("rejected");
    expect(result.record.reason).toBe("not-found");
    expect(result.record.last_error_class).toBe("not_found");
  });

  it("never stores a rejected instruction skill as succeeded", async () => {
    const fake = makeFakeRunner([{ exitCode: 1, error: INSTRUCTION_SKILL_ERROR }]);
    const { record } = await invokeSkill(makeConfig(), fake.runner);
    expect(record.status).not.toBe("succeeded");
  });
});

describe("skills adapter — failure classification", () => {
  it("classifies a generic non-zero exit as failed with class execution_error", async () => {
    const fake = makeFakeRunner([{ exitCode: 2, stderr: "boom", stdout: "partial" }]);
    const result = await invokeSkill(makeConfig(), fake.runner);

    expect(result.ok).toBe(false);
    expect(result.record.status).toBe("failed");
    expect(result.record.reason).toBe("non-zero-exit");
    expect(result.record.last_error_class).toBe("execution_error");
    expect(result.record.state).toBe("failed");
    expect(result.record.exit_code).toBe(2);
    expect(result.record.stderr).toBe("boom");
    expect(result.record.stdout).toBe("partial");
  });

  it("classifies a timeout message as class timeout", async () => {
    const fake = makeFakeRunner([{ exitCode: 124, error: "command timed out after 30s" }]);
    const result = await invokeSkill(makeConfig(), fake.runner);

    expect(result.record.status).toBe("failed");
    expect(result.record.reason).toBe("timeout");
    expect(result.record.last_error_class).toBe("timeout");
  });

  it("a required integration failure is flagged on the outcome", async () => {
    const fake = makeFakeRunner([{ exitCode: 1, error: NOT_FOUND_ERROR }]);
    const result = await invokeSkill(makeConfig({ required: true }), fake.runner);
    expect(result.requiredFailed).toBe(true);
  });

  it("a non-required integration failure is not flagged", async () => {
    const fake = makeFakeRunner([{ exitCode: 1, error: NOT_FOUND_ERROR }]);
    const result = await invokeSkill(makeConfig({ required: false }), fake.runner);
    expect(result.requiredFailed).toBe(false);
  });
});

describe("skills adapter — SDK exceptions are non-fatal", () => {
  it("classifies a rejected runner as a bounded failed outcome instead of throwing", async () => {
    const runner: typeof runSkill = async () => {
      throw new Error("spawn failed");
    };
    const outcome = await invokeSkill(makeConfig(), runner);

    expect(outcome.ok).toBe(false);
    expect(outcome.requiredFailed).toBe(false);
    expect(outcome.deduplicated).toBe(false);
    expect(outcome.record.status).toBe("failed");
    expect(outcome.record.reason).toBe("sdk-exception");
    expect(outcome.record.last_error_class).toBe("execution_error");
    expect(outcome.record.exit_code).toBe(-1);
    expect(outcome.record.error).toBe("spawn failed");
  });

  it("maps a thrown not-found error to class not_found", async () => {
    const runner: typeof runSkill = async () => {
      throw new Error("skill 'demo' not found");
    };
    const { record } = await invokeSkill(makeConfig(), runner);
    expect(record.status).toBe("rejected");
    expect(record.reason).toBe("not-found");
    expect(record.last_error_class).toBe("not_found");
  });

  it("maps a thrown instruction-only error to class invalid_input", async () => {
    const runner: typeof runSkill = async () => {
      throw new Error(INSTRUCTION_SKILL_ERROR);
    };
    const { record } = await invokeSkill(makeConfig(), runner);
    expect(record.status).toBe("rejected");
    expect(record.reason).toBe("instruction-only");
    expect(record.last_error_class).toBe("invalid_input");
  });

  it("maps a thrown timeout error to class timeout", async () => {
    const runner: typeof runSkill = async () => {
      throw new Error("runSkill timed out after 30000ms");
    };
    const { record } = await invokeSkill(makeConfig(), runner);
    expect(record.status).toBe("failed");
    expect(record.reason).toBe("timeout");
    expect(record.last_error_class).toBe("timeout");
  });

  it("flags requiredFailed for a thrown failure on a required integration", async () => {
    const runner: typeof runSkill = async () => {
      throw new Error("spawn failed");
    };
    const outcome = await invokeSkill(makeConfig({ required: true }), runner);
    expect(outcome.requiredFailed).toBe(true);
  });

  it("confirms a failed effect with its failure class when a store is present", async () => {
    const store = makeFakeStore();
    const runner: typeof runSkill = async () => {
      throw new Error("spawn failed");
    };
    const outcome = await invokeSkill(makeConfig(), runner, store);
    expect(outcome.ok).toBe(false);
    expect(outcome.record.last_error_class).toBe("execution_error");
    const stored = store.rows.get(effectIdentity(makeContext(), "demo", "run").effectKey);
    expect(stored?.state).toBe("failed");
    expect(stored?.last_error_class).toBe("execution_error");
  });
});

describe("skills adapter — credential scrub (non-vacuous)", () => {
  it("redacts an ambient credential value echoed by the skill from stdout and stderr", async () => {
    process.env.HASNA_MONITOR_SKILLS_TEST_SECRET = "sentinel-value-xyz";
    const echoing = makeEchoingRunner();
    const { record } = await invokeSkill(makeConfig(), echoing.runner);

    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("sentinel-value-xyz");
    expect(record.stdout).toContain(REDACTION_MARKER);
    expect(record.stderr).toContain(REDACTION_MARKER);
  });

  it("redacts the home directory path echoed by the skill", async () => {
    const home = process.env.HOME ?? "";
    const runner: typeof runSkill = async () => ({
      exitCode: 0,
      stdout: `resolved at ${home}`,
      stderr: "",
    });
    const { record } = await invokeSkill(makeConfig(), runner);
    expect(JSON.stringify(record)).not.toContain(home);
  });

  it("redacts a credential-shaped value not present in the environment", async () => {
    // Built at runtime so no scanner-matching literal prefix exists in the
    // source; the adapter's shape net still sees the value.
    const tokenShape = `sk-${"ant"}-abcdefghijklmnopqrstuvwxyz012345`;
    const runner: typeof runSkill = async () => ({
      exitCode: 0,
      stdout: `using ${tokenShape} now`,
      stderr: "",
    });
    const { record } = await invokeSkill(makeConfig(), runner);
    expect(JSON.stringify(record)).not.toContain(tokenShape);
    expect(record.stdout).toContain(REDACTION_MARKER);
  });

  it("scrubs before truncating, so a credential beyond the truncation point is still gone", async () => {
    process.env.HASNA_MONITOR_SKILLS_TEST_SECRET = "sentinel-value-xyz";
    const runner: typeof runSkill = async () => {
      const secret = process.env.HASNA_MONITOR_SKILLS_TEST_SECRET ?? "sentinel-value-xyz";
      return {
        exitCode: 0,
        stdout: `${"x".repeat(MAX_OUTPUT_BYTES * 2)}${secret}`,
        stderr: "",
      };
    };
    const { record } = await invokeSkill(makeConfig(), runner);
    expect(JSON.stringify(record)).not.toContain("sentinel-value-xyz");
    expect(record.stdout!.endsWith(OUTPUT_TRUNCATION_MARKER)).toBe(true);
  });

  it("scrubs the recorded error text as well", async () => {
    process.env.HASNA_MONITOR_SKILLS_TEST_SECRET = "sentinel-value-xyz";
    const runner: typeof runSkill = async () => {
      const secret = process.env.HASNA_MONITOR_SKILLS_TEST_SECRET ?? "sentinel-value-xyz";
      return { exitCode: 1, error: `failed near ${secret}` };
    };
    const { record } = await invokeSkill(makeConfig(), runner);
    expect(JSON.stringify(record)).not.toContain("sentinel-value-xyz");
    expect(record.error).toContain(REDACTION_MARKER);
  });

  it("stores no environment, arguments, or credential-bearing fields in the record", async () => {
    process.env.HASNA_MONITOR_SKILLS_TEST_SECRET = "sentinel-value-xyz";
    const echoing = makeEchoingRunner();
    const { record } = await invokeSkill(makeConfig(), echoing.runner);

    expect(record).not.toHaveProperty("env");
    expect(record).not.toHaveProperty("args");
    expect(record).not.toHaveProperty("path");
    const ALLOWED_KEYS = new Set([
      "effect_key",
      "integration",
      "operation",
      "target",
      "state",
      "request_digest",
      "external_id",
      "result_pointer",
      "last_error_class",
      "skill_id",
      "status",
      "reason",
      "exit_code",
      "stdout",
      "stderr",
      "error",
    ]);
    for (const key of Object.keys(record)) {
      expect(ALLOWED_KEYS.has(key)).toBe(true);
    }
  });
});

describe("skills adapter — bounded result without private payloads", () => {
  it("truncates oversized stdout and stderr so the stored field stays within MAX_OUTPUT_BYTES bytes", async () => {
    const big = "x".repeat(MAX_OUTPUT_BYTES * 4);
    const fake = makeFakeRunner([{ exitCode: 0, stdout: big, stderr: big }]);
    const { record } = await invokeSkill(makeConfig(), fake.runner);

    expect(Buffer.byteLength(record.stdout!, "utf8")).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    expect(Buffer.byteLength(record.stderr!, "utf8")).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    expect(record.stdout!.endsWith(OUTPUT_TRUNCATION_MARKER)).toBe(true);
    expect(record.stderr!.endsWith(OUTPUT_TRUNCATION_MARKER)).toBe(true);
  });

  it("keeps output under the bound for output at the exact limit", async () => {
    const exact = "y".repeat(MAX_OUTPUT_BYTES);
    const fake = makeFakeRunner([{ exitCode: 0, stdout: exact, stderr: "" }]);
    const { record } = await invokeSkill(makeConfig(), fake.runner);
    expect(record.stdout).toBe(exact);
    expect(Buffer.byteLength(record.stdout!, "utf8")).toBe(MAX_OUTPUT_BYTES);
  });

  it("truncates multi-byte output at a code-point boundary, never splitting a character", async () => {
    const emoji = "😀".repeat(MAX_OUTPUT_BYTES * 2);
    const fake = makeFakeRunner([{ exitCode: 0, stdout: emoji, stderr: "" }]);
    const { record } = await invokeSkill(makeConfig(), fake.runner);

    const storedText = record.stdout!;
    expect(Buffer.byteLength(storedText, "utf8")).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    expect(storedText.endsWith(OUTPUT_TRUNCATION_MARKER)).toBe(true);
    const content = storedText.slice(0, storedText.length - OUTPUT_TRUNCATION_MARKER.length);
    // Round-trip decode: if the cut had split a code point, re-encoding would differ.
    expect(Buffer.from(content, "utf8").toString("utf8")).toBe(content);
  });

  it("bounds the recorded error message as well", async () => {
    const hugeError = "e".repeat(MAX_OUTPUT_BYTES * 2);
    const fake = makeFakeRunner([{ exitCode: 1, error: hugeError }]);
    const { record } = await invokeSkill(makeConfig(), fake.runner);
    expect(Buffer.byteLength(record.error!, "utf8")).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    expect(record.error!.endsWith(OUTPUT_TRUNCATION_MARKER)).toBe(true);
  });
});
