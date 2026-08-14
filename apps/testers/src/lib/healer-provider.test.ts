process.env.TESTERS_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";

let tempDir: string | undefined;
let originalTestersDir: string | undefined;
let originalZaiKey: string | undefined;
let originalSelfHeal: string | undefined;
let originalFetch: typeof fetch;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "testers-healer-"));
  originalTestersDir = process.env["HASNA_TESTERS_DIR"];
  originalZaiKey = process.env["ZAI_API_KEY"];
  originalSelfHeal = process.env["TESTERS_SELF_HEAL"];
  originalFetch = globalThis.fetch;
  process.env["HASNA_TESTERS_DIR"] = tempDir;
  process.env["ZAI_API_KEY"] = "zai-provider-test-key";
  process.env["TESTERS_SELF_HEAL"] = "true";
  writeFileSync(join(tempDir, "config.json"), JSON.stringify({ selfHeal: true }));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalTestersDir === undefined) delete process.env["HASNA_TESTERS_DIR"];
  else process.env["HASNA_TESTERS_DIR"] = originalTestersDir;
  if (originalZaiKey === undefined) delete process.env["ZAI_API_KEY"];
  else process.env["ZAI_API_KEY"] = originalZaiKey;
  if (originalSelfHeal === undefined) delete process.env["TESTERS_SELF_HEAL"];
  else process.env["TESTERS_SELF_HEAL"] = originalSelfHeal;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("healSelector provider routing", () => {
  test("uses Z.AI-compatible models for self-healing", async () => {
    let requestBody: { model?: string } | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.z.ai/api/paas/v4/chat/completions");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer zai-provider-test-key",
        "Content-Type": "application/json",
      });
      requestBody = JSON.parse(String(init?.body)) as { model?: string };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            content: JSON.stringify({
              selector: "[data-testid='submit']",
              confidence: 0.9,
              reasoning: "The submit control has a stable test id.",
            }),
          },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 4, completion_tokens: 3 },
      }), { status: 200 });
    }) as typeof fetch;

    const fakePage = {
      screenshot: async () => Buffer.from("fake-png"),
      $: async (selector: string) => selector === "[data-testid='submit']" ? ({}) : null,
    } as unknown as Page;

    const { healSelector } = await import("./healer.js");
    const result = await healSelector({
      page: fakePage,
      failedSelector: ".submit",
      intent: "click the submit button",
      model: "glm-5.1",
    });

    expect(requestBody?.model).toBe("glm-5.1");
    expect(result).toMatchObject({
      newSelector: "[data-testid='submit']",
      confidence: 0.9,
      healed: true,
    });
  });
});
