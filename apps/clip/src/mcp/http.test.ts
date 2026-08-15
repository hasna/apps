import { describe, expect, it } from "bun:test";
import { handleMcpHttpRequest, startHttpServer } from "./http.js";

describe("MCP HTTP transport", () => {
  it("returns health, transport negotiation errors, and not found responses", async () => {
    const health = await handleMcpHttpRequest(new Request("http://127.0.0.1:8874/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok", name: "clip" });

    const mcp = await handleMcpHttpRequest(new Request("http://127.0.0.1:8874/mcp", { method: "GET" }));
    expect(mcp.status).toBe(406);
    expect(await mcp.text()).toContain("Not Acceptable");

    const missing = await handleMcpHttpRequest(new Request("http://127.0.0.1:8874/nope"));
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Not Found");
  });

  it("starts an HTTP server with the supplied host, port, and log callback", async () => {
    const logs: string[] = [];
    const server = startHttpServer({ port: 0, hostname: "127.0.0.1", log: (message) => logs.push(message) });
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(logs[0]).toContain(`http://127.0.0.1:${server.port}/mcp`);

      const response = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(response.status).toBe(200);
      expect((await response.json() as { name: string }).name).toBe("clip");
    } finally {
      server.stop(true);
    }
  });
});
