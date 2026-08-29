import { afterEach, describe, expect, it, test } from "bun:test";
import { availableProviders, resetProvider } from "./index.js";
import { CerebrasProvider } from "./cerebras.js";
import { GroqProvider } from "./groq.js";
import { XaiProvider } from "./xai.js";
import { selectAccessibleModel } from "./base.js";

describe("providers", () => {
  it("lists available providers", () => {
    const providers = availableProviders();
    expect(providers.length).toBe(4);
    expect(providers[0].name).toBe("cerebras");
    expect(providers[1].name).toBe("groq");
    expect(providers[2].name).toBe("xai");
    expect(providers[3].name).toBe("anthropic");
  });

  it("resetProvider clears cache", () => {
    // Should not throw
    resetProvider();
  });
});

describe("selectAccessibleModel", () => {
  test("picks the first preferred model the key can access", () => {
    expect(selectAccessibleModel(
      ["gpt-oss-120b", "gemma-4-31b", "qwen-3-235b-a22b-instruct-2507"],
      ["gemma-4-31b", "gpt-oss-120b"],
      "qwen-3-235b-a22b-instruct-2507",
    )).toBe("gpt-oss-120b");
  });

  test("falls back to the static default when no preferred model is accessible", () => {
    expect(selectAccessibleModel(
      ["gpt-oss-120b"],
      ["some-other-model"],
      "qwen-3-235b-a22b-instruct-2507",
    )).toBe("qwen-3-235b-a22b-instruct-2507");
  });

  test("falls back to the static default when the model list is unknown (empty)", () => {
    expect(selectAccessibleModel(
      ["gpt-oss-120b"],
      [],
      "qwen-3-235b-a22b-instruct-2507",
    )).toBe("qwen-3-235b-a22b-instruct-2507");
  });
});

describe("per-key model discovery (O15-04797 regression)", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    resetProvider();
  });

  /** Mock fetch: /models returns the given ids; chat completions capture the request body. */
  function mockFetch(accessibleModels: string[] | null, captured: { body?: any }[]) {
    globalThis.fetch = (async (input: any, init: any) => {
      const url = String(input);
      if (url.endsWith("/models")) {
        if (accessibleModels === null) throw new Error("network down");
        return new Response(JSON.stringify({ data: accessibleModels.map((id) => ({ id })) }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      captured.push({ body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  }

  test("Cerebras complete() uses an accessible default model, not the hardcoded qwen-3-235b (was 404 model_not_found)", async () => {
    const captured: { body?: any }[] = [];
    // The live key only has access to gemma-4-31b and gpt-oss-120b — qwen-3-235b is NOT in the list.
    mockFetch(["gemma-4-31b", "gpt-oss-120b"], captured);
    const p = new CerebrasProvider();
    await p.complete("hi", { system: "" });
    expect(captured[0].body.model).toBe("gpt-oss-120b");
    expect(captured[0].body.model).not.toBe("qwen-3-235b-a22b-instruct-2507");
  });

  test("Cerebras complete() keeps the stop parameter when provided", async () => {
    const captured: { body?: any }[] = [];
    mockFetch(["gemma-4-31b", "gpt-oss-120b"], captured);
    const p = new CerebrasProvider();
    await p.complete("hi", { system: "", stop: ["\n"] });
    expect(captured[0].body.stop).toEqual(["\n"]);
  });

  test("XaiProvider never sends the stop parameter (models reject it with 400)", async () => {
    const captured: { body?: any }[] = [];
    mockFetch(["grok-4.20-0309-non-reasoning", "grok-4.6"], captured);
    const p = new XaiProvider();
    await p.complete("hi", { system: "", stop: ["\n"] });
    expect(captured[0].body).not.toHaveProperty("stop");
  });

  test("XaiProvider complete() resolves an accessible default model (grok-4.20-0309-non-reasoning, not grok-code-fast-1)", async () => {
    const captured: { body?: any }[] = [];
    mockFetch(["grok-4.20-0309-non-reasoning", "grok-4.20-0309-reasoning"], captured);
    const p = new XaiProvider();
    await p.complete("hi", { system: "" });
    expect(captured[0].body.model).toBe("grok-4.20-0309-non-reasoning");
  });

  test("GroqProvider complete() resolves an accessible default model (was 404 for moonshotai/kimi-k2-instruct / llama-3.1-8b-instant)", async () => {
    const captured: { body?: any }[] = [];
    // llama-3.1-8b-instant (historic output workhorse) is NOT in the mock list,
    // so resolution must skip it and pick the next accessible preference.
    mockFetch(["openai/gpt-oss-120b", "openai/gpt-oss-20b"], captured);
    const p = new GroqProvider();
    await p.complete("hi", { system: "" });
    expect(captured[0].body.model).toBe("openai/gpt-oss-20b");
  });

  test("complete() does not throw when the model list cannot be fetched (falls back to the static default)", async () => {
    const captured: { body?: any }[] = [];
    mockFetch(null, captured);
    const p = new CerebrasProvider();
    await p.complete("hi", { system: "" });
    // fetch fails for /models → static default used; the chat call itself still succeeds
    expect(captured[0].body.model).toBe("qwen-3-235b-a22b-instruct-2507");
  });
});
