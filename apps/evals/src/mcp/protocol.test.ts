import { afterEach, describe, expect, it, mock } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpServer, MCP_NAME } from "./http.js";
import { buildServer, parseCursor, boolArg } from "./server.js";
import type { EvalRun } from "../types/index.js";

// Sol-guided coverage (tests-coverage-sol workflow, evals lane):
//   "Start the evals HTTP/MCP server with Bun.serve port 0, read the actual
//    port, and stop it in finally; do not copy existing fixed-port collision
//    fixtures. Use the real MCP client to invoke every evals_* tool with valid
//    and invalid arguments. Assert valid results are structured, invalid zod
//    arguments return structured error responses rather than thrown exceptions,
//    boolArg handles true/'true'/false/'false'/1, parseCursor clamps as
//    documented, unknown tools return the documented error, and all three tools
//    are registered."

// Mock the SDK so judge calls never hit a provider.
mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mock(async () => ({
        content: [{ type: "text", text: "REASONING: Looks good.\nVERDICT: PASS" }],
        usage: { input_tokens: 50, output_tokens: 20 },
      })),
    };
  },
}));

function makeRun(id: string): EvalRun {
  return {
    id,
    createdAt: new Date().toISOString(),
    dataset: "test.jsonl",
    results: [
      { caseId: "c1", verdict: "PASS", output: "ok", assertionResults: [], durationMs: 50 },
    ],
    stats: { total: 1, passed: 1, failed: 0, unknown: 0, errors: 0, passRate: 1.0, totalDurationMs: 100, totalCostUsd: 0.001, totalTokens: 50 },
  };
}

afterEach(() => {
  const { closeDatabase } = require("../db/store.js") as typeof import("../db/store.js");
  closeDatabase();
  delete process.env["EVALS_DB_PATH"];
});

describe("evals-mcp protocol contract", () => {
  it("registers every evals_* tool and serves it over a port-0 server stopped in finally", async () => {
    process.env["EVALS_DB_PATH"] = ":memory:";

    // Kernel-assigned ephemeral port; the actual port is read back and the
    // server is always stopped in finally (no fixed-port collision fixtures).
    const server = startHttpServer({ port: 0, log: () => {} });
    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const health = await fetch(`${baseUrl}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok", name: MCP_NAME });

      const client = new Client({ name: "evals-protocol-test", version: "1.0.0" }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
      try {
        await client.connect(transport, { timeout: 10_000 });
        const tools = await client.listTools(undefined, { timeout: 10_000 });
        const names = tools.tools.map((t) => t.name).sort();
        // The three core tools the MCP surface documents…
        expect(names).toContain("evals_run");
        expect(names).toContain("evals_judge");
        expect(names).toContain("evals_compare");
        // …and the full registered set.
        for (const expected of ["evals_run_single", "evals_list_datasets", "evals_get_results", "evals_create_case", "evals_generate_cases"]) {
          expect(names).toContain(expected);
        }
      } finally {
        await client.close();
      }
    } finally {
      server.stop(true);
    }
  });

  it("valid evals_judge arguments return a structured, non-error result", async () => {
    process.env["EVALS_DB_PATH"] = ":memory:";
    const server = startHttpServer({ port: 0, log: () => {} });
    try {
      const client = new Client({ name: "evals-protocol-test", version: "1.0.0" }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`));
      try {
        await client.connect(transport, { timeout: 10_000 });
        const result = await client.callTool(
          { name: "evals_judge", arguments: { input: "2+2?", output: "4", rubric: "must be 4" } },
          undefined,
          { timeout: 10_000 }
        );
        expect(result.isError).toBeFalsy();
        const text = (result.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "";
        // The evals_judge tool returns "VERDICT\nreasoning".
        expect(text).toContain("PASS");
        expect(text).toContain("Looks good.");
      } finally {
        await client.close();
      }
    } finally {
      server.stop(true);
    }
  });

  it("invalid zod arguments (bad adapter) return a structured error response, not a thrown exception", async () => {
    process.env["EVALS_DB_PATH"] = ":memory:";
    const server = startHttpServer({ port: 0, log: () => {} });
    try {
      const client = new Client({ name: "evals-protocol-test", version: "1.0.0" }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`));
      try {
        await client.connect(transport, { timeout: 10_000 });
        // AdapterSchema requires a `type` member; {} must be rejected by zod and
        // surface as an isError result carrying the error text.
        const result = await client.callTool(
          { name: "evals_run", arguments: { dataset: "nope.jsonl", adapter: {} } },
          undefined,
          { timeout: 10_000 }
        );
        expect(result.isError).toBe(true);
        const text = (result.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "";
        expect(text).toContain("Error");
      } finally {
        await client.close();
      }
    } finally {
      server.stop(true);
    }
  });

  it("unknown tools return the documented error text without throwing", async () => {
    process.env["EVALS_DB_PATH"] = ":memory:";
    const server = startHttpServer({ port: 0, log: () => {} });
    try {
      const client = new Client({ name: "evals-protocol-test", version: "1.0.0" }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`));
      try {
        await client.connect(transport, { timeout: 10_000 });
        const result = await client.callTool(
          { name: "evals_nope", arguments: {} },
          undefined,
          { timeout: 10_000 }
        );
        expect(result.isError).toBeFalsy();
        const text = (result.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "";
        expect(text).toBe("Unknown tool: evals_nope");
      } finally {
        await client.close();
      }
    } finally {
      server.stop(true);
    }
  });

  it("evals_get_results clamps invalid cursors in the MCP path", async () => {
    process.env["EVALS_DB_PATH"] = ":memory:";
    const { saveRun } = await import("../db/store.js");
    saveRun(makeRun("mcp-cursor-1"));
    saveRun(makeRun("mcp-cursor-2"));
    saveRun(makeRun("mcp-cursor-3"));

    const server = startHttpServer({ port: 0, log: () => {} });
    try {
      const client = new Client({ name: "evals-protocol-test", version: "1.0.0" }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`));
      try {
        await client.connect(transport, { timeout: 10_000 });
        const cases: Array<[unknown, number]> = [
          ["-1", 0],      // negative -> 0
          ["NaN", 0],     // not finite -> 0
          ["abc", 0],     // not a number -> 0
          ["2.7", 2],     // float -> floored
          ["1", 1],
        ];
        for (const [cursor, expected] of cases) {
          const result = await client.callTool(
            { name: "evals_get_results", arguments: { format: "json", cursor } },
            undefined,
            { timeout: 10_000 }
          );
          const text = (result.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "";
          const parsed = JSON.parse(text) as { cursor: number };
          expect(parsed.cursor).toBe(expected);
        }
      } finally {
        await client.close();
      }
    } finally {
      server.stop(true);
    }
  });
});

describe("server seams (exported, no behavior change)", () => {
  it("parseCursor clamps undefined, null, empty, negative, NaN, and floats", () => {
    expect(parseCursor(undefined)).toBe(0);
    expect(parseCursor(null)).toBe(0);
    expect(parseCursor("")).toBe(0);
    expect(parseCursor(-5)).toBe(0);
    expect(parseCursor("-5")).toBe(0);
    expect(parseCursor(NaN)).toBe(0);
    expect(parseCursor("NaN")).toBe(0);
    expect(parseCursor(2.7)).toBe(2);
    expect(parseCursor("2.7")).toBe(2);
    expect(parseCursor(3)).toBe(3);
    expect(parseCursor("100000")).toBe(100000);
  });

  it("boolArg maps true/'true' to true and false/'false'/numbers to false", () => {
    expect(boolArg(true)).toBe(true);
    expect(boolArg("true")).toBe(true);
    expect(boolArg(false)).toBe(false);
    expect(boolArg("false")).toBe(false);
    expect(boolArg(1)).toBe(false);
    expect(boolArg(0)).toBe(false);
    expect(boolArg(undefined)).toBe(false);
  });
});

// buildServer import is referenced to keep the seam module graph loaded even if
// the http.test.ts suite changes; the protocol tests above exercise it through
// the running server.
void buildServer;
