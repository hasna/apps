import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { callHttpAdapter } from "./http.js";
import { callFunctionAdapter } from "./function.js";
import { callCliAdapter } from "./cli.js";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ─── HTTP adapter tests ───────────────────────────────────────────────────────

describe("HTTP adapter", () => {
  let server: ReturnType<typeof Bun.serve>;
  let port: number;

  beforeAll(() => {
    port = 19450 + Math.floor(Math.random() * 100);
    server = Bun.serve({
      port,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/chat") {
          return Response.json({
            choices: [{ message: { content: "Hello from mock server!" } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          });
        }
        if (url.pathname === "/api/custom") {
          return Response.json({ output: "custom response" });
        }
        if (url.pathname === "/api/slow") {
          return new Promise((resolve) =>
            setTimeout(() => resolve(Response.json({ content: "slow" })), 200)
          );
        }
        return new Response("Not found", { status: 404 });
      },
    });
  });

  afterAll(() => server.stop());

  test("calls endpoint and extracts OpenAI-style response", async () => {
    const result = await callHttpAdapter(
      { type: "http", url: `http://localhost:${port}/api/chat` },
      "hello"
    );
    expect(result.output).toBe("Hello from mock server!");
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("extracts token usage from response", async () => {
    const result = await callHttpAdapter(
      { type: "http", url: `http://localhost:${port}/api/chat` },
      "hello"
    );
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
  });

  test("uses custom outputPath to extract response field", async () => {
    const result = await callHttpAdapter(
      { type: "http", url: `http://localhost:${port}/api/custom`, outputPath: "output" },
      "hello"
    );
    expect(result.output).toBe("custom response");
  });

  test("captures latency in durationMs", async () => {
    const result = await callHttpAdapter(
      { type: "http", url: `http://localhost:${port}/api/slow` },
      "hello"
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(150);
  });

  test("returns error on connection failure", async () => {
    const result = await callHttpAdapter(
      { type: "http", url: "http://localhost:1/nonexistent", timeoutMs: 500 },
      "hello"
    );
    expect(result.error).toBeTruthy();
    expect(result.output).toBe("");
  });

  test("sends multi-turn conversation as messages array", async () => {
    let capturedBody: unknown;
    const captureServer = Bun.serve({
      port: port + 50,
      async fetch(req) {
        capturedBody = await req.json();
        return Response.json({ content: "ok" });
      },
    });

    await callHttpAdapter(
      { type: "http", url: `http://localhost:${port + 50}/chat` },
      "",
      [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "how are you?" },
      ]
    );

    captureServer.stop();
    const body = capturedBody as { messages: Array<{ role: string; content: string }> };
    expect(body.messages.length).toBe(3);
    expect(body.messages[0]!.role).toBe("user");
    expect(body.messages[2]!.content).toBe("how are you?");
  });
});

// ─── Function adapter tests ───────────────────────────────────────────────────

describe("Function adapter", () => {
  let modulePath: string;

  beforeAll(() => {
    const dir = join(tmpdir(), "evals-fn-test-" + Date.now());
    mkdirSync(dir, { recursive: true });
    modulePath = join(dir, "handler.js");
    writeFileSync(modulePath, `
      export default async function(input) {
        return "echo: " + input;
      }
      export async function namedExport(input) {
        return "named: " + input;
      }
      export async function throwsError(input) {
        throw new Error("deliberate error");
      }
    `);
  });

  test("calls default export with input", async () => {
    const result = await callFunctionAdapter(
      { type: "function", modulePath },
      "test input"
    );
    expect(result.output).toBe("echo: test input");
    expect(result.error).toBeUndefined();
  });

  test("calls named export when specified", async () => {
    const result = await callFunctionAdapter(
      { type: "function", modulePath, exportName: "namedExport" },
      "hello"
    );
    expect(result.output).toBe("named: hello");
  });

  test("returns error when function throws", async () => {
    const result = await callFunctionAdapter(
      { type: "function", modulePath, exportName: "throwsError" },
      "hello"
    );
    expect(result.error).toContain("deliberate error");
    expect(result.output).toBe("");
  });

  test("returns error for missing export", async () => {
    const result = await callFunctionAdapter(
      { type: "function", modulePath, exportName: "doesNotExist" },
      "hello"
    );
    expect(result.error).toBeTruthy();
  });
});

// ─── CLI adapter tests ────────────────────────────────────────────────────────

describe("CLI adapter", () => {
  test("captures stdout from command", async () => {
    const result = await callCliAdapter(
      { type: "cli", command: "echo hello world" },
      "ignored"
    );
    expect(result.output).toBe("hello world");
    expect(result.error).toBeUndefined();
  });

  test("substitutes {{input}} in command", async () => {
    const result = await callCliAdapter(
      { type: "cli", command: "echo {{input}}" },
      "my test input"
    );
    expect(result.output).toContain("my test input");
  });

  test("captures exit code error", async () => {
    const result = await callCliAdapter(
      { type: "cli", command: "exit 1" },
      "hello"
    );
    expect(result.error).toContain("exit");
  });

  test("tracks durationMs", async () => {
    const result = await callCliAdapter(
      { type: "cli", command: "echo timing" },
      "x"
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("passes env vars to command", async () => {
    const result = await callCliAdapter(
      { type: "cli", command: "echo $EVALS_TEST_VAR", env: { EVALS_TEST_VAR: "injected" } },
      "x"
    );
    expect(result.output).toBe("injected");
  });
});
