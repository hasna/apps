import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { callHttpAdapter } from "./http.js";
import { callCliAdapter } from "./cli.js";

// ─── HTTP adapter — path/response edge cases ──────────────────────────────────

describe("HTTP adapter — response shape edge cases", () => {
  let server: ReturnType<typeof Bun.serve>;
  let port: number;

  beforeAll(() => {
    port = 19470 + Math.floor(Math.random() * 30);
    server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);
        switch (url.pathname) {
          case "/anthropic-style":
            return Response.json({
              content: [{ type: "text", text: "anthropic response" }],
            });
          case "/message-content":
            return Response.json({
              message: { content: "message style response" },
            });
          case "/text-field":
            return Response.json({ text: "text field response" });
          case "/output-field":
            return Response.json({ output: "output field response" });
          case "/fallback-json":
            return Response.json({ unknown_shape: true, value: 42 });
          case "/array-negative":
            // Array indexing with negative index via outputPath
            return Response.json({
              messages: ["first", "second", "third"],
            });
          case "/nested-create":
            return Response.json({ result: { answer: "nested" } });
          case "/404":
            return new Response("Not found", { status: 404 });
          case "/custom-input-path":
            return req.json().then((b: Record<string, unknown>) =>
              Response.json({ echo: (b["data"] as Record<string, unknown>)?.["query"] })
            );
          default:
            return Response.json({ content: "default" });
        }
      },
    });
  });

  afterAll(() => server.stop());

  test("extracts message.content style response", async () => {
    const result = await callHttpAdapter(
      { type: "http", url: `http://localhost:${port}/message-content` },
      "hello"
    );
    expect(result.output).toBe("message style response");
  });

  test("extracts text field response", async () => {
    const result = await callHttpAdapter(
      { type: "http", url: `http://localhost:${port}/text-field` },
      "hello"
    );
    expect(result.output).toBe("text field response");
  });

  test("extracts output field response", async () => {
    const result = await callHttpAdapter(
      { type: "http", url: `http://localhost:${port}/output-field` },
      "hello"
    );
    expect(result.output).toBe("output field response");
  });

  test("falls back to JSON.stringify for unknown shape", async () => {
    const result = await callHttpAdapter(
      { type: "http", url: `http://localhost:${port}/fallback-json` },
      "hello"
    );
    expect(result.output).toContain("unknown_shape");
  });

  test("uses custom outputPath for nested extraction", async () => {
    const result = await callHttpAdapter(
      { type: "http", url: `http://localhost:${port}/nested-create`, outputPath: "result.answer" },
      "hello"
    );
    expect(result.output).toBe("nested");
  });

  test("handles negative array index in outputPath", async () => {
    const result = await callHttpAdapter(
      { type: "http", url: `http://localhost:${port}/array-negative`, outputPath: "messages[-1]" },
      "hello"
    );
    expect(result.output).toBe("third");
  });

  test("uses custom inputPath to set request body field", async () => {
    const result = await callHttpAdapter(
      {
        type: "http",
        url: `http://localhost:${port}/custom-input-path`,
        inputPath: "data.query",
        outputPath: "echo",
      },
      "my search"
    );
    expect(result.output).toBe("my search");
  });

  test("handles 404 text response (JSON parse fails → error)", async () => {
    const result = await callHttpAdapter(
      { type: "http", url: `http://localhost:${port}/404` },
      "hello"
    );
    // Non-JSON body causes json() to throw → captured as error
    expect(result.error).toBeTruthy();
    expect(result.output).toBe("");
  });

  test("returns error on connection refused (unreachable host)", async () => {
    const result = await callHttpAdapter(
      { type: "http", url: "http://localhost:1/unreachable", timeoutMs: 200 },
      "hello"
    );
    expect(result.error).toBeTruthy();
    expect(result.output).toBe("");
  });
});

// ─── CLI adapter — error and timeout paths ────────────────────────────────────

describe("CLI adapter — error and edge cases", () => {
  test("returns output even when exit code non-zero (with stdout)", async () => {
    // Script that prints to stdout but exits with code 1
    const result = await callCliAdapter(
      { type: "cli", command: "echo 'partial output' && exit 1" },
      "x"
    );
    expect(result.output).toContain("partial output");
    expect(result.error).toBeTruthy();
  });

  test("empty command runs silently (bash -c '' exits 0)", async () => {
    const result = await callCliAdapter(
      { type: "cli", command: "" },
      "x"
    );
    // bash -c "" is valid and exits 0 with no output
    expect(result.output).toBe("");
    expect(result.error).toBeUndefined();
  });

  test("env variables are passed correctly", async () => {
    const result = await callCliAdapter(
      { type: "cli", command: "echo $EVALS_TEST_X $EVALS_TEST_Y", env: { EVALS_TEST_X: "foo", EVALS_TEST_Y: "bar" } },
      "x"
    );
    expect(result.output).toContain("foo");
    expect(result.output).toContain("bar");
  });

  test("{{input}} placeholder is replaced in command", async () => {
    const result = await callCliAdapter(
      { type: "cli", command: "printf '%s' '{{input}}'" },
      "replaced!"
    );
    expect(result.output).toContain("replaced!");
  });

  test("captures multiline stdout correctly", async () => {
    const result = await callCliAdapter(
      { type: "cli", command: "printf 'line1\\nline2\\nline3'" },
      "x"
    );
    expect(result.output).toContain("line1");
    expect(result.output).toContain("line3");
  });
});
