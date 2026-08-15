process.env["TESTERS_DB_PATH"] = ":memory:";

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import {
  isAIEndpoint,
  profileAIEndpoint,
  MODEL_PRICING,
} from "./ai-profiler.js";

describe("ai-profiler", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ─── isAIEndpoint ──────────────────────────────────────────────────────────

  describe("isAIEndpoint", () => {
    test("detects /chat in path", () => {
      expect(isAIEndpoint("https://api.example.com/v1/chat")).toBe(true);
    });

    test("detects /completions in path", () => {
      expect(isAIEndpoint("https://api.openai.com/v1/chat/completions")).toBe(true);
    });

    test("detects /generate in path", () => {
      expect(isAIEndpoint("https://api.example.com/generate")).toBe(true);
    });

    test("detects /ask in path", () => {
      expect(isAIEndpoint("https://api.example.com/ask")).toBe(true);
    });

    test("detects /query in path", () => {
      expect(isAIEndpoint("https://api.example.com/query")).toBe(true);
    });

    test("detects /infer in path", () => {
      expect(isAIEndpoint("https://api.example.com/infer")).toBe(true);
    });

    test("returns false for regular endpoints", () => {
      expect(isAIEndpoint("https://api.example.com/health")).toBe(false);
    });

    test("returns false for /users endpoint", () => {
      expect(isAIEndpoint("https://api.example.com/users")).toBe(false);
    });

    test("detects via response body with choices field", () => {
      const body = JSON.stringify({ choices: [{ message: { content: "hello" } }] });
      expect(isAIEndpoint("https://api.example.com/v1/response", body)).toBe(true);
    });

    test("detects via response body with usage field", () => {
      const body = JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 20 } });
      expect(isAIEndpoint("https://api.example.com/v1/response", body)).toBe(true);
    });

    test("detects via response body with candidates field", () => {
      const body = JSON.stringify({ candidates: [{ content: { parts: [] } }] });
      expect(isAIEndpoint("https://api.example.com/v1/response", body)).toBe(true);
    });

    test("returns false when no AI signal in URL or body", () => {
      const body = JSON.stringify({ status: "ok", data: [] });
      expect(isAIEndpoint("https://api.example.com/health", body)).toBe(false);
    });

    test("handles path-only URL (no host)", () => {
      expect(isAIEndpoint("/api/chat")).toBe(true);
    });

    test("handles non-JSON response body gracefully", () => {
      expect(isAIEndpoint("https://api.example.com/health", "plain text response")).toBe(false);
    });
  });

  // ─── MODEL_PRICING ─────────────────────────────────────────────────────────

  describe("MODEL_PRICING", () => {
    test("contains major models", () => {
      expect(MODEL_PRICING["claude-haiku-4-5"]).toBeDefined();
      expect(MODEL_PRICING["claude-sonnet-4-6"]).toBeDefined();
      expect(MODEL_PRICING["gpt-4o-mini"]).toBeDefined();
      expect(MODEL_PRICING["gpt-4o"]).toBeDefined();
      expect(MODEL_PRICING["gemini-2.0-flash"]).toBeDefined();
      expect(MODEL_PRICING["gemini-1.5-pro"]).toBeDefined();
    });

    test("each pricing entry is [input_cents, output_cents] tuple", () => {
      for (const [, pricing] of Object.entries(MODEL_PRICING)) {
        expect(Array.isArray(pricing)).toBe(true);
        expect(pricing.length).toBe(2);
        expect(typeof pricing[0]).toBe("number");
        expect(typeof pricing[1]).toBe("number");
      }
    });
  });

  // ─── profileAIEndpoint ─────────────────────────────────────────────────────

  describe("profileAIEndpoint", () => {
    test("returns profile with statusCode from response", async () => {
      const responseBody = JSON.stringify({
        choices: [{ message: { content: "hello" } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
        model: "gpt-4o-mini",
      });
      global.fetch = mock(() =>
        Promise.resolve(new Response(responseBody, {
          status: 200,
          headers: { "content-type": "application/json" },
        }))
      );

      const profile = await profileAIEndpoint("https://api.openai.com/v1/chat/completions");

      expect(profile.statusCode).toBe(200);
      expect(profile.endpoint).toBe("https://api.openai.com/v1/chat/completions");
      expect(profile.totalMs).toBeGreaterThanOrEqual(0);
      expect(profile.ttftMs).toBeNull(); // non-streaming
    });

    test("extracts inputTokens and outputTokens from OpenAI-style usage", async () => {
      const responseBody = JSON.stringify({
        choices: [],
        usage: { prompt_tokens: 150, completion_tokens: 75 },
        model: "gpt-4o",
      });
      global.fetch = mock(() =>
        Promise.resolve(new Response(responseBody, { status: 200 }))
      );

      const profile = await profileAIEndpoint("https://api.openai.com/v1/chat/completions");

      expect(profile.inputTokens).toBe(150);
      expect(profile.outputTokens).toBe(75);
    });

    test("extracts inputTokens and outputTokens from Anthropic-style usage", async () => {
      const responseBody = JSON.stringify({
        content: [{ type: "text", text: "hello" }],
        usage: { input_tokens: 200, output_tokens: 80 },
        model: "claude-sonnet-4-6",
      });
      global.fetch = mock(() =>
        Promise.resolve(new Response(responseBody, { status: 200 }))
      );

      const profile = await profileAIEndpoint("https://api.anthropic.com/v1/messages");

      expect(profile.inputTokens).toBe(200);
      expect(profile.outputTokens).toBe(80);
    });

    test("extracts model from response body", async () => {
      const responseBody = JSON.stringify({
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        model: "gpt-4o-mini",
      });
      global.fetch = mock(() =>
        Promise.resolve(new Response(responseBody, { status: 200 }))
      );

      const profile = await profileAIEndpoint("https://api.openai.com/v1/chat");

      expect(profile.model).toBe("gpt-4o-mini");
    });

    test("extracts model from x-model header", async () => {
      const responseBody = JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5 } });
      global.fetch = mock(() =>
        Promise.resolve(new Response(responseBody, {
          status: 200,
          headers: { "x-model": "gpt-4o" },
        }))
      );

      const profile = await profileAIEndpoint("https://api.example.com/chat");

      expect(profile.model).toBe("gpt-4o");
    });

    test("detects OpenAI provider from x-openai-* headers", async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response("{}", {
          status: 200,
          headers: { "openai-version": "2020-10-01" },
        }))
      );

      const profile = await profileAIEndpoint("https://api.openai.com/v1/chat");

      expect(profile.provider).toBe("openai");
    });

    test("detects Anthropic provider from anthropic-ratelimit header", async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response("{}", {
          status: 200,
          headers: { "anthropic-ratelimit-requests-limit": "100" },
        }))
      );

      const profile = await profileAIEndpoint("https://api.anthropic.com/v1/messages");

      expect(profile.provider).toBe("anthropic");
    });

    test("returns null provider when no provider headers", async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response("{}", { status: 200 }))
      );

      const profile = await profileAIEndpoint("https://api.example.com/chat");

      expect(profile.provider).toBeNull();
    });

    test("calculates cost for known model", async () => {
      // gpt-4o-mini: 15 cents/M input, 60 cents/M output
      // 1000 input + 500 output → (1000/1M)*15 + (500/1M)*60 = 0.015 + 0.03 = 0.045 cents
      const responseBody = JSON.stringify({
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
        model: "gpt-4o-mini",
      });
      global.fetch = mock(() =>
        Promise.resolve(new Response(responseBody, { status: 200 }))
      );

      const profile = await profileAIEndpoint("https://api.openai.com/v1/chat");

      expect(profile.estimatedCostCents).not.toBeNull();
      expect(profile.estimatedCostCents!).toBeCloseTo(0.045, 4);
    });

    test("returns null cost when model not in pricing table", async () => {
      const responseBody = JSON.stringify({
        usage: { prompt_tokens: 100, completion_tokens: 50 },
        model: "unknown-model-xyz",
      });
      global.fetch = mock(() =>
        Promise.resolve(new Response(responseBody, { status: 200 }))
      );

      const profile = await profileAIEndpoint("https://api.example.com/chat");

      expect(profile.estimatedCostCents).toBeNull();
    });

    test("returns null cost when tokens are unknown", async () => {
      const responseBody = JSON.stringify({ model: "gpt-4o" });
      global.fetch = mock(() =>
        Promise.resolve(new Response(responseBody, { status: 200 }))
      );

      const profile = await profileAIEndpoint("https://api.example.com/chat");

      expect(profile.estimatedCostCents).toBeNull();
    });

    test("handles network error gracefully", async () => {
      global.fetch = mock(() => Promise.reject(new Error("Network error")));

      const profile = await profileAIEndpoint("https://api.example.com/chat");

      expect(profile.statusCode).toBe(0);
      expect(profile.inputTokens).toBeNull();
      expect(profile.outputTokens).toBeNull();
      expect(profile.model).toBeNull();
      expect(profile.provider).toBeNull();
      expect(profile.estimatedCostCents).toBeNull();
    });

    test("uses POST method by default", async () => {
      let capturedInit: RequestInit | undefined;
      global.fetch = mock((_url: string, init?: RequestInit) => {
        capturedInit = init;
        return Promise.resolve(new Response("{}", { status: 200 }));
      });

      await profileAIEndpoint("https://api.example.com/chat");

      expect(capturedInit?.method).toBe("POST");
    });

    test("uses custom method when specified", async () => {
      let capturedInit: RequestInit | undefined;
      global.fetch = mock((_url: string, init?: RequestInit) => {
        capturedInit = init;
        return Promise.resolve(new Response("{}", { status: 200 }));
      });

      await profileAIEndpoint("https://api.example.com/chat", { method: "GET" });

      expect(capturedInit?.method).toBe("GET");
    });

    test("passes custom headers", async () => {
      let capturedInit: RequestInit | undefined;
      global.fetch = mock((_url: string, init?: RequestInit) => {
        capturedInit = init;
        return Promise.resolve(new Response("{}", { status: 200 }));
      });

      await profileAIEndpoint("https://api.example.com/chat", {
        headers: { Authorization: "Bearer test-key" },
      });

      expect((capturedInit?.headers as Record<string, string>)?.["Authorization"]).toBe("Bearer test-key");
    });

    test("passes request body for POST", async () => {
      let capturedInit: RequestInit | undefined;
      global.fetch = mock((_url: string, init?: RequestInit) => {
        capturedInit = init;
        return Promise.resolve(new Response("{}", { status: 200 }));
      });

      const body = JSON.stringify({ messages: [{ role: "user", content: "hello" }] });
      await profileAIEndpoint("https://api.example.com/chat", { body });

      expect(capturedInit?.body).toBe(body);
    });
  });
});
