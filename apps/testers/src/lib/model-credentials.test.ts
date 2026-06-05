import { describe, expect, test } from "bun:test";

import {
  checkModelCredential,
  resolveModelCredential,
  resolveModelCredentialReference,
} from "./model-credentials.js";

describe("model credentials", () => {
  test("resolves env, optional env, secret, and literal references", () => {
    const env = { ANTHROPIC_API_KEY: "anthropic-key" };
    const resolver = (value: string) => value === "@secrets:model/key" ? "secret-key" : null;

    expect(resolveModelCredentialReference("$ANTHROPIC_API_KEY", env, resolver)).toEqual({
      source: "env",
      apiKey: "anthropic-key",
    });
    expect(resolveModelCredentialReference("$?OPENAI_API_KEY", env, resolver)).toEqual({
      source: "optional-env",
      apiKey: null,
    });
    expect(resolveModelCredentialReference("@secrets:model/key", env, resolver)).toEqual({
      source: "secret",
      apiKey: "secret-key",
    });
    expect(resolveModelCredentialReference("literal-key", env, resolver)).toEqual({
      source: "literal",
      apiKey: "literal-key",
    });
  });

  test("detects model provider and default credential key", () => {
    expect(resolveModelCredential("quick", { env: { ANTHROPIC_API_KEY: "key" } })).toMatchObject({
      provider: "anthropic",
      envKey: "ANTHROPIC_API_KEY",
      apiKey: "key",
    });
    expect(resolveModelCredential("gpt-4o-mini", { env: { OPENAI_API_KEY: "key" } })).toMatchObject({
      provider: "openai",
      envKey: "OPENAI_API_KEY",
      apiKey: "key",
    });
    expect(resolveModelCredential("gemini-2.0-flash", { env: { GOOGLE_API_KEY: "key" } })).toMatchObject({
      provider: "google",
      envKey: "GOOGLE_API_KEY",
      apiKey: "key",
    });
    expect(resolveModelCredential("cerebras-fast", { env: { CEREBRAS_API_KEY: "key" } })).toMatchObject({
      provider: "cerebras",
      envKey: "CEREBRAS_API_KEY",
      apiKey: "key",
    });
    expect(resolveModelCredential("glm-4.6", { env: { ZAI_API_KEY: "key" } })).toMatchObject({
      provider: "zai",
      envKey: "ZAI_API_KEY",
      apiKey: "key",
    });
  });

  test("validates with injected validator and does not expose api key", async () => {
    const check = await checkModelCredential("gpt-4o-mini", {
      env: { OPENAI_API_KEY: "real-key" },
      validator: async (input) => ({
        ok: input.apiKey === "real-key",
        status: 200,
      }),
    });

    expect(check).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      ok: true,
      status: 200,
    });
    expect(JSON.stringify(check)).not.toContain("real-key");
  });

  test("returns a missing credential failure before live validation", async () => {
    let called = false;
    const check = await checkModelCredential("quick", {
      env: {},
      validator: async () => {
        called = true;
        return { ok: true };
      },
    });

    expect(called).toBe(false);
    expect(check.ok).toBe(false);
    expect(check.message).toContain("ANTHROPIC_API_KEY");
  });
});
