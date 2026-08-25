/**
 * Regression tests for the four lane adapters (slice E).
 *
 * SDK paths are exercised through the injectable loaders with stub SDKs that
 * match the REAL shapes measured from the installed packages
 * (@anthropic-ai/claude-agent-sdk 0.3.234, @openai/codex-sdk 0.147.0,
 * @cursor/sdk 1.0.28): claude query() -> async generator of SDKMessage,
 * codex Codex.startThread().run() -> { finalResponse }, cursor
 * Agent.send() -> { status, result }. The CLI fallback path is exercised
 * against a real temp executable.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeAdapter } from "./claude.js";
import { createCodexAdapter } from "./codex.js";
import { createCursorAdapter } from "./cursor.js";
import { createGrokAdapter } from "./grok.js";
import { resolveLane, runLaneJob, laneInventory } from "./index.js";
import { LaneAdapterShapeError, type LaneJob } from "./types.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "workflows-lanes-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const job: LaneJob = { lane: "claude", prompt: "do the thing" };

/** An async generator of SDKMessage-shaped objects (the real Query shape). */
async function* claudeMessages(output: string): AsyncGenerator<Record<string, unknown>> {
  yield { type: "assistant", message: { content: [{ type: "text", text: output }] } };
  yield { type: "user", message: { content: [] } };
}

describe("claude adapter", () => {
  test("maps query() assistant text into the result via the real SDK shape", async () => {
    const adapter = createClaudeAdapter({
      sdkLoader: async () => ({
        query: async (params: { prompt: string }) => {
          expect(params.prompt).toBe("do the thing");
          return claudeMessages("built the thing");
        },
      }),
    });
    const result = await adapter.run(job);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("built the thing");
  });

  test("falls back to the local claude CLI when the SDK is unavailable", async () => {
    const cliPath = join(dir, "fake-claude");
    writeFileSync(cliPath, "#!/bin/sh\necho cli-did-it\n", "utf8");
    chmodSync(cliPath, 0o755);
    const adapter = createClaudeAdapter({ sdkLoader: async () => { throw new Error("no sdk"); }, cliPath });
    const result = await adapter.run(job);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("cli-did-it");
  });

  test("reports exit 127 with a named substrate when neither SDK nor CLI exists", async () => {
    const adapter = createClaudeAdapter({
      sdkLoader: async () => { throw new Error("no sdk"); },
      cliPath: join(dir, "definitely-missing-cli"),
    });
    const result = await adapter.run(job);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(127);
    expect(result.error).toContain("@anthropic-ai/claude-agent-sdk");
  });

  test("enforces the timeout budget", async () => {
    const adapter = createClaudeAdapter({
      sdkLoader: async () => ({
        query: async () => new Promise<never>(() => {}), // never resolves
      }),
    });
    const result = await adapter.run({ ...job, timeoutMs: 50 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("50ms");
  });

  test("enforces the timeout budget on a stalled stream (regression: for-await was unbounded)", async () => {
    // The SDK query resolves immediately to an async generator whose stream
    // never yields (a stalled API connection after the first chunk). The
    // budget must bound the ITERATION, not only the generator's creation —
    // measured live 2026-08-25: `workflows run` on the sample graph exceeded
    // the declared 120s lane budget for 6+ minutes on a real SDK call.
    async function* stalledStream(): AsyncGenerator<Record<string, unknown>> {
      yield { type: "assistant", message: { content: [{ type: "text", text: "partial" }] } };
      await new Promise<never>(() => {}); // never yields again
    }
    const adapter = createClaudeAdapter({
      sdkLoader: async () => ({
        query: async () => stalledStream(),
      }),
    });
    const started = Date.now();
    const result = await adapter.run({ ...job, timeoutMs: 100 });
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("100ms");
    expect(elapsed).toBeLessThan(10_000); // bounded, not a hang
  });

  test("rejects an SDK that does not export query()", async () => {
    const adapter = createClaudeAdapter({ sdkLoader: async () => ({}) });
    let threw: unknown = null;
    try {
      await adapter.run(job);
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(LaneAdapterShapeError);
  });
});

describe("codex adapter", () => {
  test("maps Codex.startThread().run() finalResponse via the real SDK shape", async () => {
    const adapter = createCodexAdapter({
      sdkLoader: async () => ({
        Codex: class {
          startThread() {
            return {
              run: async (input: string) => {
                expect(input).toBe("do the thing");
                return { finalResponse: "codex answered", items: [], usage: null };
              },
            };
          }
        },
      }),
    });
    const result = await adapter.run(job);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("codex answered");
  });

  test("falls back to the local codex CLI when the SDK is unavailable", async () => {
    const cliPath = join(dir, "fake-codex");
    writeFileSync(cliPath, "#!/bin/sh\necho codex-cli-did-it\n", "utf8");
    chmodSync(cliPath, 0o755);
    const adapter = createCodexAdapter({ sdkLoader: async () => { throw new Error("no sdk"); }, cliPath });
    const result = await adapter.run(job);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("codex-cli-did-it");
  });

  test("reports exit 127 when neither SDK nor CLI exists", async () => {
    const adapter = createCodexAdapter({
      sdkLoader: async () => { throw new Error("no sdk"); },
      cliPath: join(dir, "missing-codex"),
    });
    const result = await adapter.run(job);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(127);
    expect(result.error).toContain("@openai/codex-sdk");
  });
});

describe("cursor adapter (local mode)", () => {
  test("maps Agent.send() Run via the real SDK shape", async () => {
    const adapter = createCursorAdapter({
      sdkLoader: async () => ({
        Agent: class {
          send = async (_m: string) => ({ status: "finished", result: "cursor-local-did-it" });
        },
      }),
    });
    const result = await adapter.run(job);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("cursor-local-did-it");
  });

  test("a run in error status is a failed lane", async () => {
    const adapter = createCursorAdapter({
      sdkLoader: async () => ({
        Agent: class {
          send = async () => ({ status: "error", result: "" });
        },
      }),
    });
    const result = await adapter.run(job);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  test("falls back to cursor-agent CLI when the SDK is unavailable", async () => {
    const cliPath = join(dir, "fake-cursor-agent");
    writeFileSync(cliPath, "#!/bin/sh\necho cursor-cli-did-it\n", "utf8");
    chmodSync(cliPath, 0o755);
    const adapter = createCursorAdapter({ sdkLoader: async () => { throw new Error("no sdk"); }, cliPath });
    const result = await adapter.run(job);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("cursor-cli-did-it");
  });
});

describe("grok adapter", () => {
  test("drives the grok CLI when present", async () => {
    const cliPath = join(dir, "fake-grok");
    writeFileSync(cliPath, "#!/bin/sh\necho grok-did-it\n", "utf8");
    chmodSync(cliPath, 0o755);
    const adapter = createGrokAdapter({ cliPath });
    const result = await adapter.run(job);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("grok-did-it");
  });

  test("reports LANE_DEPENDENCY_MISSING (127) when no grok substrate exists", async () => {
    const adapter = createGrokAdapter({ cliPath: join(dir, "missing-grok") });
    const result = await adapter.run(job);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(127);
    expect(result.error).toContain("grok CLI");
  });
});

describe("registry", () => {
  test("resolves all four lanes and lists the inventory", async () => {
    expect(resolveLane("claude").kind).toBe("claude");
    expect(resolveLane("codex").kind).toBe("codex");
    expect(resolveLane("cursor").kind).toBe("cursor");
    expect(resolveLane("grok").kind).toBe("grok");
    const inventory = await laneInventory();
    expect(inventory.map((i) => i.kind).sort()).toEqual(["claude", "codex", "cursor", "grok"]);
  });

  test("the inventory carries the wired-vs-not-ready-with-reason shape", async () => {
    const inventory = await laneInventory();
    for (const lane of inventory) {
      expect(typeof lane.wired).toBe("boolean");
      expect(typeof lane.sdk).toBe("string");
      if (lane.wired) {
        expect(typeof lane.via).toBe("string");
      } else {
        expect(typeof lane.reason).toBe("string");
        expect(lane.reason!.length).toBeGreaterThan(0);
      }
    }
  });

  test("probe reports wired via sdk when the SDK loader resolves", async () => {
    const probe = await createClaudeAdapter({ sdkLoader: async () => ({ query: async () => claudeMessages("x") }) }).probe();
    expect(probe.kind).toBe("claude");
    expect(probe.wired).toBe(true);
    expect(probe.via).toBe("sdk");
  });

  test("probe reports not-ready with a named reason when no substrate exists", async () => {
    const probe = await createGrokAdapter({ cliPath: "definitely-no-such-grok-binary" }).probe();
    expect(probe.kind).toBe("grok");
    expect(probe.wired).toBe(false);
    expect(probe.reason).toMatch(/grok/);
  });

  test("unknown lane throws", () => {
    expect(() => resolveLane("unknown" as never)).toThrow(/unknown lane/);
  });

  test("runLaneJob validates the lane before dispatch", async () => {
    await expect(runLaneJob({ lane: "unknown" as never, prompt: "x" })).rejects.toThrow(/unknown lane/);
  });
  // NOTE: a live runLaneJob dispatch (real SDK/CLI with real auth) is not a
  // unit test — it is the workflow's live-verify gate, exercised there.
});
