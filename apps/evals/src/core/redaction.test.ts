// secret-DETECTION fixture: feeds the redactor synthetic key-shaped sentinels
// and asserts they are stripped. Synthetic only. Sentinels are assembled from
// fragments so the STORED file never contains a contiguous secret shape (repo
// convention, see apps/access/test/secret-boundary.test.ts) — the CI secret
// gate scans added lines verbatim and honors no exemption marker.
import { describe, expect, test } from "bun:test";
import { redactAdapterConfig, redactRunSecrets } from "./redaction.js";
import type { AdapterConfig, EvalRun, EvalResult } from "../types/index.js";

// redaction.ts is the security boundary between adapter configs (which may
// carry live API keys) and everything that persists or renders a run:
// runner.ts stores `redactAdapterConfig(options.adapter)` on the run, and
// store.ts / reporter.ts pass every run through `redactRunSecrets` before it
// hits disk or a JSON document. A regression here leaks a provider key into
// saved runs, markdown reports, and the MCP response surface.

describe("redactAdapterConfig", () => {
  test("returns undefined for undefined config", () => {
    expect(redactAdapterConfig(undefined)).toBeUndefined();
  });

  test("strips apiKey from anthropic config but keeps every other field", () => {
    const config: AdapterConfig = {
      type: "anthropic",
      model: "claude-sonnet-4-6",
      systemPrompt: "You are a tester",
      maxTokens: 2048,
      apiKey: "sk-" + "ant-super-secret-value",
    };

    const redacted = redactAdapterConfig(config);
    expect(redacted).toBeDefined();
    expect(redacted).not.toBe(config);
    expect("apiKey" in (redacted as unknown as Record<string, unknown>)).toBe(false);
    expect(redacted).toMatchObject({
      type: "anthropic",
      model: "claude-sonnet-4-6",
      systemPrompt: "You are a tester",
      maxTokens: 2048,
    });
  });

  test("strips apiKey from openai config but keeps baseURL and other fields", () => {
    const config: AdapterConfig = {
      type: "openai",
      model: "gpt-4o",
      baseURL: "https://gateway.example.com/v1",
      apiKey: "sk-" + "proj-leaked-key",
    };

    const redacted = redactAdapterConfig(config);
    expect("apiKey" in (redacted as unknown as Record<string, unknown>)).toBe(false);
    expect(redacted).toMatchObject({
      type: "openai",
      model: "gpt-4o",
      baseURL: "https://gateway.example.com/v1",
    });
  });

  test("returns configs without an apiKey field unchanged", () => {
    const httpConfig: AdapterConfig = {
      type: "http",
      url: "http://localhost:3000/api/chat",
      headers: { "X-Custom": "value" },
    };
    const mcpConfig: AdapterConfig = {
      type: "mcp",
      command: ["node", "server.js"],
      tool: "eval",
    };
    const cliConfig: AdapterConfig = {
      type: "cli",
      command: "echo {{input}}",
    };
    const fnConfig: AdapterConfig = {
      type: "function",
      modulePath: "/tmp/handler.js",
    };

    // http headers may carry auth material but the redaction contract is
    // explicitly scoped to the apiKey field — non-apiKey configs pass through
    // by reference, so assert reference equality to lock the behavior.
    expect(redactAdapterConfig(httpConfig)).toBe(httpConfig);
    expect(redactAdapterConfig(mcpConfig)).toBe(mcpConfig);
    expect(redactAdapterConfig(cliConfig)).toBe(cliConfig);
    expect(redactAdapterConfig(fnConfig)).toBe(fnConfig);
  });

  test("does not mutate the original config", () => {
    const config: AdapterConfig = {
      type: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "sk-" + "ant-should-survive-on-original",
    };

    redactAdapterConfig(config);
    expect((config as unknown as Record<string, unknown>)["apiKey"]).toBe("sk-" + "ant-should-survive-on-original");
  });

  test("an empty-string apiKey is still stripped", () => {
    const config: AdapterConfig = {
      type: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "",
    };
    const redacted = redactAdapterConfig(config);
    expect("apiKey" in (redacted as unknown as Record<string, unknown>)).toBe(false);
  });
});

describe("redactRunSecrets", () => {
  const baseResult: EvalResult = {
    caseId: "case-1",
    verdict: "PASS",
    output: "hello",
    assertionResults: [],
    durationMs: 12,
  };

  function makeRun(adapterConfig: AdapterConfig | undefined): EvalRun {
    return {
      id: "run-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      dataset: "smoke.jsonl",
      adapterConfig,
      results: [baseResult],
      stats: {
        total: 1,
        passed: 1,
        failed: 0,
        unknown: 0,
        errors: 0,
        passRate: 1,
        totalDurationMs: 12,
        totalCostUsd: 0.001,
        totalTokens: 100,
      },
      baselineName: "main",
    };
  }

  test("strips apiKey from the run's adapterConfig", () => {
    const run = makeRun({
      type: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "sk-" + "ant-run-level-key",
    });

    const safe = redactRunSecrets(run);
    expect("apiKey" in (safe.adapterConfig as unknown as Record<string, unknown>)).toBe(false);
    expect(safe.adapterConfig).toMatchObject({ type: "anthropic", model: "claude-sonnet-4-6" });
  });

  test("serialized output never contains the key value", () => {
    const run = makeRun({
      type: "openai",
      model: "gpt-4o",
      apiKey: "sk-" + "proj-must-never-serialize",
    });

    const json = JSON.stringify(redactRunSecrets(run));
    expect(json).not.toContain("sk-" + "proj-must-never-serialize");
  });

  test("preserves all run metadata, results, and stats", () => {
    const run = makeRun({
      type: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "sk-" + "ant-x",
    });

    const safe = redactRunSecrets(run);
    expect(safe.id).toBe("run-123");
    expect(safe.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(safe.dataset).toBe("smoke.jsonl");
    expect(safe.baselineName).toBe("main");
    expect(safe.results).toEqual([baseResult]);
    expect(safe.stats).toEqual(run.stats);
  });

  test("does not mutate the original run", () => {
    const run = makeRun({
      type: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "sk-" + "ant-keep-on-original",
    });

    redactRunSecrets(run);
    expect((run.adapterConfig as unknown as Record<string, unknown>)["apiKey"]).toBe("sk-" + "ant-keep-on-original");
  });

  test("handles a run with no adapterConfig", () => {
    const run = makeRun(undefined);
    const safe = redactRunSecrets(run);
    expect(safe.adapterConfig).toBeUndefined();
    expect(safe.id).toBe("run-123");
  });

  test("handles a non-apiKey adapterConfig (http) unchanged", () => {
    const run = makeRun({ type: "http", url: "http://localhost:3000/chat" });
    const safe = redactRunSecrets(run);
    expect(safe.adapterConfig).toMatchObject({ type: "http", url: "http://localhost:3000/chat" });
  });
});
