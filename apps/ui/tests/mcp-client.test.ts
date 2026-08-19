// McpHttpClient over a local ephemeral server (Bun.serve on port 0).
//
// The client speaks the MCP-over-HTTP subset the harvest uses against the
// ui.sh MCP. These tests script plain-JSON and SSE responses on a real local
// HTTP server — no network, no mocks of the transport itself — and assert the
// framing, session handling, and error contracts end to end. parseBody is not
// exported; every assertion exercises the client's public surface. The server
// is stopped in a finally block, never killed implicitly.

import { describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { McpHttpClient } from "../src/mcp-client.ts";

interface RecordedRequest {
  headers: Headers;
  body: { jsonrpc: string; id?: number; method: string; params?: unknown };
}

function startServer(handler: (req: Request, requests: RecordedRequest[]) => Response): {
  server: Server;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      // Must await the body read: an unawaited req.json() rejects once the
      // response is sent and crashes the server process.
      const body = (await req.json()) as RecordedRequest["body"];
      requests.push({ headers: req.headers, body });
      return handler(req, requests);
    },
  });
  return { server, requests };
}

function rpcResult(body: RecordedRequest["body"], result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: body.id, result });
}

describe("McpHttpClient over an ephemeral local server", () => {
  test("initialize exchanges two requests and echoes the session id afterwards", async () => {
    const { server, requests } = startServer((req, all) => {
      const body = all.at(-1)!.body;
      if (body.method === "initialize") {
        return Response.json(
          {
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              serverInfo: { name: "fake-ui-sh", version: "1" },
            },
          },
          { headers: { "Mcp-Session-Id": "sess-abc123" } },
        );
      }
      if (body.method === "tools/list") return rpcResult(body, { tools: [{ name: "uidotsh_fetch" }] });
      return rpcResult(body, {});
    });

    try {
      const client = new McpHttpClient({ url: server.url });
      await client.initialize();
      const list = await client.listTools();
      expect(Array.isArray(list)).toBe(true);
      expect(list).toEqual([{ name: "uidotsh_fetch" }]);

      expect(requests).toHaveLength(3);
      expect(requests[0].body.method).toBe("initialize");
      expect(requests[1].body.method).toBe("notifications/initialized");
      expect(requests[2].body.method).toBe("tools/list");
      // Session id is captured from the first response and sent on the next.
      expect(requests[0].headers.get("mcp-session-id")).toBeNull();
      expect(requests[1].headers.get("mcp-session-id")).toBe("sess-abc123");
      expect(requests[2].headers.get("mcp-session-id")).toBe("sess-abc123");
    } finally {
      server.stop(true);
    }
  });

  test("parses a plain JSON body", async () => {
    const { server, requests } = startServer((_req, all) => rpcResult(all.at(-1)!.body, { tools: [{ name: "uidotsh_fetch" }] }));
    try {
      const client = new McpHttpClient({ url: server.url });
      await client.initialize();
      const tools = await client.listTools();
      expect(tools).toEqual([{ name: "uidotsh_fetch" }]);
    } finally {
      server.stop(true);
    }
  });

  test("SSE: the first result/error frame wins", async () => {
    let initializeCalls = 0;
    const { server } = startServer((_req, all) => {
      const body = all.at(-1)!.body;
      if (body.method === "initialize") {
        initializeCalls++;
        if (initializeCalls === 1) {
          // First data frame carries an error, second a result -> error wins.
          const sse = [
            "event: message",
            'data: {"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}',
            "",
            "event: message",
            'data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"second"}}',
            "",
          ].join("\n");
          return new Response(sse, { headers: { "content-type": "text/event-stream" } });
        }
        return rpcResult(body, { protocolVersion: "2024-11-05" });
      }
      // First frame carries a result, second a different one -> first wins.
      const sse = [
        "event: message",
        'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"first-tool"}]}}',
        "",
        "event: message",
        'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"second-tool"}]}}',
        "",
      ].join("\n");
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    });

    try {
      const client = new McpHttpClient({ url: server.url });
      await expect(client.initialize()).rejects.toThrow("MCP initialize error -32601: Method not found");
      // The second initialize happens on a fresh client whose first frame carries the result.
      const client2 = new McpHttpClient({ url: server.url });
      await expect(client2.initialize()).resolves.toBeUndefined();
      const tools = await client2.listTools();
      expect(tools).toEqual([{ name: "first-tool" }]);
    } finally {
      server.stop(true);
    }
  });

  test("non-OK HTTP status becomes MCP method HTTP status", async () => {
    const { server } = startServer(() => new Response("boom", { status: 500 }));
    try {
      const client = new McpHttpClient({ url: server.url });
      await expect(client.initialize()).rejects.toThrow("MCP initialize HTTP 500: boom");
    } finally {
      server.stop(true);
    }
  });

  test("JSON-RPC error becomes MCP method error code: message", async () => {
    const { server } = startServer((_req, all) => {
      const body = all.at(-1)!.body;
      if (body.method === "initialize") return rpcResult(body, {});
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32601, message: "Method not found" },
      });
    });
    try {
      const client = new McpHttpClient({ url: server.url });
      await client.initialize();
      await expect(client.listTools()).rejects.toThrow("MCP tools/list error -32601: Method not found");
    } finally {
      server.stop(true);
    }
  });

  test("callToolText concatenates only text content with newlines", async () => {
    const { server } = startServer((_req, all) => {
      const body = all.at(-1)!.body;
      if (body.method === "tools/call") {
        return rpcResult(body, {
          content: [
            { type: "text", text: "alpha" },
            { type: "image", data: "not-text" },
            { type: "resource", resource: { uri: "uidotsh://ui" } },
            { type: "text", text: "beta" },
          ],
        });
      }
      return rpcResult(body, {});
    });
    try {
      const client = new McpHttpClient({ url: server.url });
      await client.initialize();
      const text = await client.callToolText("uidotsh_fetch", { uri: "uidotsh://ui" });
      expect(text).toBe("alpha\nbeta");
      expect(text).not.toContain("not-text");
    } finally {
      server.stop(true);
    }
  });
});
