import { afterEach, beforeEach, describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, listAuditEvents, listModelUsage } from "../src/db/index.js";
import { runTask } from "../src/agent/loop.js";
import { resetRunControlForTests } from "../src/agent/control.js";
import { listApprovals, listPolicyDecisions, listRunSteps } from "../src/agent/runtime.js";
import {
  classifyProviderError,
  createProvider,
  FallbackComputerProvider,
} from "../src/providers/index.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import type { ComputerDriver, ComputerProvider, DriverAction, Screenshot } from "../src/types/index.js";

const screenshot: Screenshot = {
  base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  size: { width: 1, height: 1 },
  timestamp: Date.now(),
};

function testDriver(overrides: Partial<ComputerDriver> = {}): ComputerDriver {
  return {
    getScreenSize: async () => screenshot.size,
    screenshot: async () => screenshot,
    execute: async (_action: DriverAction) => ({ success: true, duration_ms: 0 }),
    dispose: async () => {},
    ...overrides,
  };
}

function useTempDb(): string {
  closeDb();
  const tempDir = mkdtempSync(join(tmpdir(), "computer-provider-fallback-"));
  process.env.COMPUTER_DATA_DIR = tempDir;
  process.env.COMPUTER_DB_PATH = join(tempDir, "computer.db");
  return tempDir;
}

describe("providers", () => {
  beforeEach(() => {
    resetRunControlForTests();
  });

  afterEach(() => {
    resetRunControlForTests();
  });

  test("createProvider('anthropic') creates AnthropicProvider", () => {
    const provider = createProvider("anthropic");
    expect(provider.name).toBe("anthropic");
  });

  test("createProvider('openai') creates OpenAIProvider", () => {
    const provider = createProvider("openai");
    expect(provider.name).toBe("openai");
  });

  test("createProvider with unknown provider throws", () => {
    expect(() => createProvider("unknown" as any)).toThrow("Unknown provider");
  });

  test("createProvider can wrap a configured fallback provider", () => {
    const provider = createProvider("anthropic", {
      fallback: {
        enabled: true,
        provider: "openai",
        fallbackOn: ["error"],
      },
    });
    expect(provider).toBeInstanceOf(FallbackComputerProvider);
    expect(provider.name).toBe("anthropic");
  });

  test("classifies rate-limit and unsupported provider failures", () => {
    expect(classifyProviderError({ status: 429, message: "quota exceeded" })).toBe("rate_limit");
    expect(classifyProviderError({ status: 400, message: "computer_use not supported" })).toBe("unsupported");
    expect(classifyProviderError(new Error("network down"))).toBe("error");
  });

  test("fallback provider attempts the next configured provider and records audit rows", async () => {
    const tempDir = useTempDb();
    try {
      const primary: ComputerProvider = {
        name: "openai",
        analyze: async () => {
          throw new Error("temporary provider failure");
        },
      };
      const fallback: ComputerProvider = {
        name: "anthropic",
        analyze: async () => ({
          action: null,
          reasoning: "done from fallback",
          done: true,
        }),
      };
      const provider = new FallbackComputerProvider(primary, [fallback], {
        policy: { fallbackOn: ["error"] },
      });

      const response = await provider.analyze({
        task: "complete",
        screenshot,
        history: [],
      });

      expect(response.done).toBe(true);
      expect(response.reasoning).toContain("provider fallback: anthropic");
      expect(listAuditEvents({ transport: "provider", capability: "provider.analyze", limit: 5 })
        .map((event) => event.event)).toEqual([
        "provider.fallback_succeeded",
        "provider.fallback_attempt",
      ]);
    } finally {
      closeDb();
      delete process.env.COMPUTER_DATA_DIR;
      delete process.env.COMPUTER_DB_PATH;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("fallback policy can fail closed for disallowed failure classes", async () => {
    const tempDir = useTempDb();
    try {
      const primary: ComputerProvider = {
        name: "openai",
        analyze: async () => {
          throw new Error("network down");
        },
      };
      const fallback: ComputerProvider = {
        name: "anthropic",
        analyze: async () => {
          throw new Error("should not run");
        },
      };
      const provider = new FallbackComputerProvider(primary, [fallback], {
        policy: { fallbackOn: ["rate_limit"] },
      });

      await expect(provider.analyze({ task: "complete", screenshot, history: [] }))
        .rejects.toThrow("Provider analysis failed after 1 attempt");
    } finally {
      closeDb();
      delete process.env.COMPUTER_DATA_DIR;
      delete process.env.COMPUTER_DB_PATH;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("OpenAI pending safety checks suppress actions and surface structured checks", async () => {
    const provider = new OpenAIProvider({ apiKey: "test" });
    (provider as any).client.responses.create = async () => ({
      output: [
        {
          type: "computer_call",
          call_id: "call_safety",
          pending_safety_checks: [
            { id: "safety_1", code: "malicious_instructions", message: "The page contains suspicious instructions." },
          ],
          action: { type: "click", x: 10, y: 12 },
        },
      ],
      usage: { input_tokens: 12, output_tokens: 4 },
    });

    const response = await provider.analyze({ task: "click if safe", screenshot, history: [] });

    expect(response.action).toBeNull();
    expect(response.done).toBe(false);
    expect(response.reasoning).toContain("pending safety check");
    expect(response.pendingSafetyChecks).toEqual([
      {
        provider: "openai",
        id: "safety_1",
        code: "malicious_instructions",
        message: "The page contains suspicious instructions.",
      },
    ]);
    expect(response.usage).toEqual({ input: 12, output: 4 });
  });

  test("runTask turns OpenAI pending safety checks into approval gates before execution", async () => {
    const tempDir = useTempDb();
    try {
      const provider = new OpenAIProvider({ apiKey: "test" });
      (provider as any).client.responses.create = async () => ({
        output: [
          {
            type: "computer_call",
            call_id: "call_safety",
            pending_safety_checks: [
              { id: "safety_2", code: "external_risk", message: "Confirm before proceeding." },
            ],
            action: { type: "click", x: 10, y: 12 },
          },
        ],
        usage: { input_tokens: 8, output_tokens: 2 },
      });
      let executeCalls = 0;

      const session = await runTask({
        task: "trigger openai safety gate",
        maxSteps: 1,
        dryRun: false,
        driver: testDriver({
          execute: async () => {
            executeCalls += 1;
            return { success: true, duration_ms: 0 };
          },
        }),
        computerProvider: provider,
      });

      expect(session.status).toBe("waiting_on_approval");
      expect(executeCalls).toBe(0);
      expect(listApprovals(session.id)[0]).toEqual(expect.objectContaining({
        capability: "openai.safety_check",
        status: "pending",
      }));
      expect(listRunSteps(session.id)[0]).toEqual(expect.objectContaining({
        status: "waiting_on_approval",
      }));
      expect(listPolicyDecisions(session.id)[0]).toEqual(expect.objectContaining({
        capability: "openai.safety_check",
        decision: "requires_confirmation",
      }));
      expect(listModelUsage({ sessionId: session.id, phase: "executor" })[0]).toEqual(expect.objectContaining({
        provider: "openai",
        input_tokens: 8,
        output_tokens: 2,
      }));
    } finally {
      closeDb();
      delete process.env.COMPUTER_DATA_DIR;
      delete process.env.COMPUTER_DB_PATH;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
