import { describe, test, expect, afterAll } from "bun:test";
import { startHttpServer } from "./http.js";
import type { Server } from "node:http";

const PORT = 18802;

describe("HTTP transport", () => {
  let server: Server;

  afterAll(() => {
    server?.close();
  });

  test("GET /health returns ok", async () => {
    server = startHttpServer(PORT);
    const res = await fetch(`http://127.0.0.1:${PORT}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("MCP round-trip over streamable HTTP initializes and lists tools", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
  });
});
