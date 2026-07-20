import { describe, expect, test } from "bun:test";
import type { AgentTarget, Loop, LoopRun } from "../types.js";
import {
  buildKnowledgeRecordForLoopRun,
  emitKnowledgeForLoopRun,
  resolveKnowledgeFeedbackConfig,
  targetWithKnowledgeContext,
  type KnowledgeCommandRunner,
} from "./knowledge-feedback.js";

const SECRET = ["ghp", "1234567890abcdef1234567890abcdef"].join("_");

function agentTarget(patch: Partial<AgentTarget> = {}): AgentTarget {
  return {
    type: "agent",
    provider: "codex",
    prompt: "Handle the bounded task.",
    knowledgeFeedback: { enabled: true },
    ...patch,
  };
}

function loopFixture(patch: Partial<Loop> = {}): Loop {
  return {
    id: "loop-knowledge",
    name: "knowledge-loop",
    status: "active",
    schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
    target: agentTarget(),
    catchUp: "latest",
    catchUpLimit: 1,
    overlap: "skip",
    maxAttempts: 1,
    retryDelayMs: 1_000,
    leaseMs: 60_000,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

function runFixture(patch: Partial<LoopRun> = {}): LoopRun {
  return {
    id: "run-knowledge",
    loopId: "loop-knowledge",
    loopName: "knowledge-loop",
    scheduledFor: "2026-01-01T00:00:00.000Z",
    attempt: 1,
    status: "failed",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1_000,
    stdout: "",
    stderr: "provider failed",
    error: "provider failed",
    exitCode: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    ...patch,
  };
}

function success(stdout = "") {
  return {
    status: 0,
    stdout,
    stderr: "",
    error: undefined,
  };
}

describe("Knowledge feedback", () => {
  test("is opt-in, explicitly disableable, and bounded by normalized defaults", () => {
    expect(resolveKnowledgeFeedbackConfig(undefined, {})).toBeUndefined();
    expect(resolveKnowledgeFeedbackConfig({ enabled: false }, {
      LOOPS_KNOWLEDGE_FEEDBACK: "true",
    })).toBeUndefined();
    expect(resolveKnowledgeFeedbackConfig(undefined, {
      LOOPS_KNOWLEDGE_FEEDBACK: "true",
      LOOPS_KNOWLEDGE_SCOPE: "project",
      LOOPS_KNOWLEDGE_MAX_ITEMS: "5",
      LOOPS_KNOWLEDGE_MAX_TOKENS: "900",
    })).toMatchObject({
      enabled: true,
      emit: true,
      readContext: true,
      command: "knowledge",
      scope: "project",
      maxItems: 5,
      maxTokens: 900,
      required: false,
    });
  });

  test("builds stable bounded dedupe records and scrubs credential canaries", () => {
    const config = resolveKnowledgeFeedbackConfig({
      enabled: true,
      tags: ["openloops", SECRET],
    }, {})!;
    const first = buildKnowledgeRecordForLoopRun(
      loopFixture(),
      runFixture({
        id: "run-one",
        stdout: `${"x".repeat(20_000)}\nAuthorization: Bearer ${SECRET}`,
        stderr: `credential=${SECRET}`,
        error: `failed with ${SECRET}`,
      }),
      config,
    );
    const second = buildKnowledgeRecordForLoopRun(
      loopFixture(),
      runFixture({
        id: "run-two",
        stdout: `${"x".repeat(20_000)}\nAuthorization: Bearer ${SECRET}`,
        stderr: `credential=${SECRET}`,
        error: `failed with ${SECRET}`,
      }),
      config,
    );

    expect(first).toBeDefined();
    expect(first?.id).toBe(second?.id);
    expect(first?.id).toMatch(/^openloops-feedback-[a-f0-9]+$/);
    expect(first?.content.length).toBeLessThanOrEqual(8_001);
    expect(first?.content).not.toContain(SECRET);
    expect(first?.content).toContain("[SCRUBBED]");
  });

  test("emission uses argv and remains nonthrowing when its runner throws", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: KnowledgeCommandRunner = async (command, args) => {
      calls.push({ command, args });
      throw new Error(`runner failed with ${SECRET}`);
    };
    const result = await emitKnowledgeForLoopRun(
      loopFixture({
        target: agentTarget({
          knowledgeFeedback: {
            enabled: true,
            command: "/tmp/knowledge cli",
            store: "/tmp/knowledge store.sqlite",
          },
        }),
      }),
      runFixture(),
      { runner, env: {} },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("/tmp/knowledge cli");
    expect(calls[0]?.args.slice(0, 5)).toEqual([
      "--store",
      "/tmp/knowledge store.sqlite",
      "--scope",
      "local",
      "--json",
    ]);
    expect(calls[0]?.args).toContain("upsert");
    expect(result).toMatchObject({ ok: false, emitted: false });
    expect(result?.error).not.toContain(SECRET);
  });

  test("malformed optional context is ignored while required context fails closed", async () => {
    const logs: string[] = [];
    const malformedRunner: KnowledgeCommandRunner = async () => success(JSON.stringify({
      ok: true,
      evidence: "not-an-array",
    }));
    const optional = agentTarget();
    const optionalResult = await targetWithKnowledgeContext(
      optional,
      { loopName: "knowledge-loop" },
      { runner: malformedRunner, env: {}, log: (message) => logs.push(message) },
    );
    expect(optionalResult).toBe(optional);
    expect(logs.join("\n")).toContain("context schema invalid");

    const required = agentTarget({
      knowledgeFeedback: { enabled: true, required: true },
    });
    await expect(targetWithKnowledgeContext(
      required,
      { loopName: "knowledge-loop" },
      { runner: malformedRunner, env: {} },
    )).rejects.toThrow("context schema invalid");
  });

  test("scrubs and individually bounds evidence and citation identifiers before interpolation", async () => {
    const overlongId = `evidence-${"a".repeat(200)}`;
    const runner: KnowledgeCommandRunner = async (_command, args) => {
      const contextIndex = args.indexOf("context");
      expect(contextIndex).toBeGreaterThanOrEqual(0);
      expect(args[contextIndex + 2]).toBe("openloops knowledge-loop codex");
      return success(JSON.stringify({
        ok: true,
        evidence: [{
          id: `ev-${SECRET}`,
          title: `title ${SECRET}`,
          text_preview: `preview ${SECRET} ${"p".repeat(2_000)}`,
          citation_ids: [
            "cite-safe:123",
            `cite-${SECRET}`,
            "cite-with\nnewline",
            overlongId,
            ...Array.from({ length: 20 }, (_, index) => `cite-${index}`),
          ],
        }],
      }));
    };
    const target = agentTarget();
    const result = await targetWithKnowledgeContext(
      target,
      { loopName: "knowledge-loop" },
      { runner, env: {} },
    ) as AgentTarget;

    expect(result.prompt).toContain("Relevant durable knowledge");
    expect(result.prompt).toContain("cite-safe:123");
    expect(result.prompt).toContain("cite-0");
    expect(result.prompt).not.toContain(SECRET);
    expect(result.prompt).not.toContain(overlongId);
    expect(result.prompt).not.toContain("cite-with\nnewline");
    expect(result.prompt).not.toContain("evidence=ev-");
    expect(result.prompt).toContain("[SCRUBBED]");
    expect(result.prompt.length - target.prompt.length).toBeLessThanOrEqual(4_002);
  });

  test("does not emit successful outcomes", async () => {
    let calls = 0;
    const runner: KnowledgeCommandRunner = async () => {
      calls += 1;
      return success();
    };
    const result = await emitKnowledgeForLoopRun(
      loopFixture(),
      runFixture({ status: "succeeded", error: undefined, exitCode: 0 }),
      { runner, env: {} },
    );
    expect(result).toMatchObject({
      ok: true,
      emitted: false,
      skippedReason: "run outcome is not knowledge-worthy",
    });
    expect(calls).toBe(0);
  });
});
