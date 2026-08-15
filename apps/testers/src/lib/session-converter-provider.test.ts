import { describe, expect, test } from "bun:test";
import { convertSessionToScenario, type SessionEvent } from "./session-converter.js";

describe("convertSessionToScenario provider routing", () => {
  test("uses Cerebras-compatible models for AI session synthesis", async () => {
    const originalFetch = globalThis.fetch;
    const originalCerebrasKey = process.env["CEREBRAS_API_KEY"];
    process.env["CEREBRAS_API_KEY"] = "cerebras-provider-test-key";

    let requestBody: { model?: string } | undefined;
    try {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.cerebras.ai/v1/chat/completions");
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer cerebras-provider-test-key",
          "Content-Type": "application/json",
        });
        requestBody = JSON.parse(String(init?.body)) as { model?: string };
        return new Response(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: "Navigate to /projects\nClick the New project button",
            },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 4, completion_tokens: 3 },
        }), { status: 200 });
      }) as typeof fetch;

      const events: SessionEvent[] = [
        { type: "navigate", timestamp: 1, url: "https://app.example.com/projects" },
        { type: "click", timestamp: 2, selector: "[data-testid='new-project']" },
      ];

      const scenario = await convertSessionToScenario(events, { model: "qwen-3-coder" });

      expect(requestBody?.model).toBe("qwen-3-coder");
      expect(scenario.steps).toEqual([
        "Navigate to /projects",
        "Click the New project button",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalCerebrasKey === undefined) delete process.env["CEREBRAS_API_KEY"];
      else process.env["CEREBRAS_API_KEY"] = originalCerebrasKey;
    }
  });
});
