import { useDefaultTestTimeout } from "../test-preload.js";
import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerRemoteCustomerTools } from "./remote-customer-tools.js";
import { listMcpToolContracts } from "../lib/mcp-contracts.js";

useDefaultTestTimeout();

test("MCP checkout schema and protocol retain the caller key across explicit recovery only", async () => {
  const savedFetch = globalThis.fetch;
  const env = { HASNA_SKILLS_API_URL: "https://checkout-mcp.example.test", HASNA_SKILLS_API_KEY_OVERRIDE: "synthetic-mcp-credential", HASNA_SKILLS_API_KEY_REF: undefined, HASNA_PROFILE: undefined };
  const previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const posts: any[] = [];
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    expect(String(input)).toBe("https://checkout-mcp.example.test/api/v1/billing/credits");
    if (init?.method !== "POST") return Response.json([{ id: "credits_100", credits: 100 }]);
    const body = JSON.parse(String(init.body)); posts.push(body);
    return Response.json(posts.length === 1 ? { error: "credit checkout creation unresolved", requestIdempotencyKey: body.idempotencyKey, detail: "SERVER_SECRET", retryAfterSeconds: 30 }
      : posts.length === 2 ? { error: "credit checkout in_progress", requestIdempotencyKey: body.idempotencyKey }
      : { url: "https://checkout.example.test/session", requestIdempotencyKey: body.idempotencyKey }, { status: posts.length === 1 ? 503 : posts.length === 2 ? 409 : 200 });
  }) as typeof fetch;
  const server = new McpServer({ name: "checkout-fixture", version: "1" }), client = new Client({ name: "checkout-consumer", version: "1" });
  registerRemoteCustomerTools(server); const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(left); await client.connect(right);
    const tool = (await client.listTools()).tools.find(t => t.name === "create_credit_checkout")!;
    expect(tool.inputSchema.properties).toHaveProperty("idempotency_key");
    const contract = listMcpToolContracts().find(t => t.name === tool.name)!;
    expect(contract.params).toEqual(["pack_id", "idempotency_key?"]);
    expect(contract.inputSchema.properties).toHaveProperty("idempotency_key");
    for (let n = 1; n <= 3; n++) {
      const result = await client.callTool({ name: tool.name, arguments: { pack_id: "credits_100", idempotency_key: "mcp-checkout-0001" } });
      expect(posts).toHaveLength(n);
      expect(result.isError === true).toBe(n < 3);
      const text = (result.content as Array<{ text: string }>)[0]!.text;
      expect(text).not.toContain("SERVER_SECRET"); expect(text).not.toContain("synthetic-mcp-credential");
      const data = JSON.parse(text); expect(data.requestIdempotencyKey).toBe("mcp-checkout-0001");
      if (n < 3) expect(data.code).toBe(n === 1 ? "CREDIT_CHECKOUT_UNCONFIRMED" : "CREDIT_CHECKOUT_IN_PROGRESS");
      else expect(data.url).toBe("https://checkout.example.test/session");
    }
    expect(posts).toEqual(Array.from({ length: 3 }, () => ({ packId: "credits_100", idempotencyKey: "mcp-checkout-0001" })));
    expect((await client.callTool({ name: tool.name, arguments: { pack_id: "credits_100", idempotency_key: "bad\nkey" } })).isError).toBe(true);
    expect(posts).toHaveLength(3);
  } finally {
    await client.close(); await server.close(); globalThis.fetch = savedFetch;
    for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
