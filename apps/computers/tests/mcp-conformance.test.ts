import { describe, expect, test } from "bun:test";
import { ComputersMcpServer, SAFE_MCP_TOOLS } from "../src/mcp";

const client = {
  listComputers: async () => [], getComputer: async (id: string) => ({ id }), listOperations: async () => [],
  requestExec: async () => ({ id: "operation_exec" }), installPlan: async () => ({ decision: "deny" }), providerReadiness: async () => [],
};

async function message(server: ComputersMcpServer, value: unknown): Promise<unknown> {
  const raw = await server.handle(value);
  return raw === undefined ? undefined : JSON.parse(raw);
}

describe("MCP 2025-03-26 JSON-RPC conformance", () => {
  test("accepts only string or signed-integer request IDs and treats null as an invalid request", async () => {
    for (const id of [null, 1.25, true, false, {}, []]) {
      const server = new ComputersMcpServer(client as never);
      expect(await message(server, { jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "reviewer-probe", version: "1" } } }))
        .toEqual({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
    }
    const server = new ComputersMcpServer(client as never);
    expect(await message(server, { jsonrpc: "2.0", id: -7, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "reviewer-probe", version: "1" } } }))
      .toMatchObject({ id: -7, result: { protocolVersion: "2025-03-26" } });
    expect(await message(new ComputersMcpServer(client as never), { jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "reviewer-probe", version: "1" } } })).toBeUndefined();
  });

  test("rejects initialize in a batch without mutating lifecycle state", async () => {
    const server = new ComputersMcpServer(client as never);
    expect(await message(server, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "batch-probe", version: "1" } } },
      { jsonrpc: "2.0", id: 2, method: "ping", params: {} },
    ])).toEqual([
      { jsonrpc: "2.0", id: 1, error: { code: -32600, message: "Invalid Request" } },
      { jsonrpc: "2.0", id: 2, error: { code: -32002, message: "Server not initialized" } },
    ]);
    expect(await message(server, { jsonrpc: "2.0", id: "direct-after-batch", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "direct-probe", version: "1" } } }))
      .toMatchObject({ id: "direct-after-batch", result: { protocolVersion: "2025-03-26" } });
  });

  test("negotiates the server protocol version for unsupported client versions", async () => {
    const server = new ComputersMcpServer(client as never);
    expect(await message(server, { jsonrpc: "2.0", id: "version-probe", method: "initialize", params: {
      protocolVersion: "2099-01-01", capabilities: { roots: { listChanged: false }, sampling: {} }, clientInfo: { name: "version-probe", version: "1" },
    } })).toMatchObject({ jsonrpc: "2.0", id: "version-probe", result: {
      protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "computers-mcp" },
    } });
  });

  test("requires valid JSON-RPC requests and initialized negotiation", async () => {
    const server = new ComputersMcpServer(client as never);
    expect(await message(server, { method: "initialize", id: 1 })).toMatchObject({ error: { code: -32600 } });
    expect(await message(server, { jsonrpc: "2.0", id: 1, method: "tools/list" })).toMatchObject({ error: { code: -32002 } });
    expect(await message(server, { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: { roots: { listChanged: true }, sampling: {} }, clientInfo: { name: "test", version: "1" } } })).toMatchObject({ result: { protocolVersion: "2025-03-26" } });
    expect(await message(server, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    expect(await message(server, { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })).toMatchObject({ result: { tools: expect.any(Array) } });
    expect(await message(server, { jsonrpc: "2.0", id: 4, method: "ping", params: { extra: true } })).toMatchObject({ error: { code: -32602 } });
    expect(await message(server, { jsonrpc: "2.0", method: "tools/call", params: { name: "computers_get", arguments: { id: "cmp_good" } } })).toBeUndefined();
  });

  test("handles batches, notifications, unknown methods/tools, and invalid args correctly", async () => {
    const server = new ComputersMcpServer(client as never);
    await message(server, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    await message(server, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(await message(server, [])).toMatchObject({ error: { code: -32600 } });
    const batch = await message(server, [
      { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 99 } },
      { jsonrpc: "2.0", id: 2, method: "unknown" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "missing", arguments: {} } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "computers_get", arguments: { id: "cmp_good", extra: true } } },
    ]) as Array<{ id: number; error: { code: number } }>;
    expect(batch).toHaveLength(3);
    expect(batch.map((item) => item.error.code)).toEqual([-32601, -32602, -32602]);
  });

  test("publishes strict safe tool schemas and annotations with no forbidden tool", () => {
    for (const tool of SAFE_MCP_TOOLS) expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(SAFE_MCP_TOOLS.find((tool) => tool.name === "computers_exec_request")?.annotations)
      .toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true });
    expect(SAFE_MCP_TOOLS.find((tool) => tool.name === "computers_install_plan")?.annotations)
      .toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
    for (const tool of SAFE_MCP_TOOLS.filter((item) => !["computers_exec_request", "computers_install_plan"].includes(item.name))) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    }
    const names = SAFE_MCP_TOOLS.map((tool) => tool.name).join(" ");
    for (const forbidden of ["delete", "restore", "reassign", "policy", "sandbox"]) expect(names).not.toContain(forbidden);
  });
});
