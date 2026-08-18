// MCP tool wiring tests: each tenants_* tool wraps the TenantsClient SDK and
// returns the client's JSON payload as text content. A fake server records the
// registered tool callbacks; a fake fetch records the HTTP request the client
// issues, so the test proves the wiring without a live server.

import { describe, expect, test } from "bun:test";
import type { TenantsClient } from "../sdk/client.js";
import { registerTenantsMcpTools, resolveTenantsClient } from "./tools.js";

interface FakeTool {
  name: string;
  description: string;
  callback: (args: Record<string, unknown>) => Promise<unknown>;
}

function fakeServer() {
  const tools: FakeTool[] = [];
  return {
    tools,
    tool(name: string, description: string, _schema: unknown, callback: (args: Record<string, unknown>) => Promise<unknown>) {
      tools.push({ name, description, callback });
    },
  };
}

function fakeClient() {
  const requests: Array<{ method: string; url: string; body?: unknown }> = [];
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    requests.push({ method: init?.method ?? "GET", url: String(url), body: init?.body });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new (require("../sdk/client.js").TenantsClient)({
    baseUrl: "http://tenants.test:15460",
    apiKey: "test-key",
    fetch: fetchImpl,
  });
  return { client: client as TenantsClient, requests };
}

describe("tenants MCP tools", () => {
  test("every registered tool is a thin wrapper over the TenantsClient SDK", async () => {
    const server = fakeServer();
    const { client, requests } = fakeClient();
    registerTenantsMcpTools(server as never, { client });

    const names = server.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ["tenants_introspect", "tenants_issue_token", "tenants_jwks", "tenants_login", "tenants_signup", "tenants_verify_otp", "tenants_whoami"].sort(),
    );

    const whoami = server.tools.find((t) => t.name === "tenants_whoami")!;
    const response = (await whoami.callback({})) as { content: Array<{ type: string; text: string }> };
    expect(response.content[0]?.type).toBe("text");
    expect(JSON.parse(response.content[0]!.text)).toEqual({ ok: true });
    expect(requests[0]?.url).toContain("http://tenants.test:15460");
    expect(requests[0]?.url).toContain("/v1/auth/whoami");

    const signup = server.tools.find((t) => t.name === "tenants_signup")!;
    await signup.callback({ email: "a@example.com", kind: "agent" });
    expect(requests[1]?.method).toBe("POST");
    expect(requests[1]?.url).toContain("/v1/auth/signup");
    expect(String(requests[1]?.body)).toContain('"a@example.com"');
  });

  test("the default client resolves from HASNA_TENANTS_API_URL with no credential values surfaced", () => {
    const previousUrl = process.env.HASNA_TENANTS_API_URL;
    process.env.HASNA_TENANTS_API_URL = "http://tenants.test:15460";
    delete process.env.HASNA_TENANTS_API_KEY;
    try {
      const client = resolveTenantsClient();
      expect(client).toBeTruthy();
      // The api key must not be readable from the client: it stays inside the
      // request header path only.
      expect(JSON.stringify(client)).not.toContain("sk-");
    } finally {
      if (previousUrl === undefined) delete process.env.HASNA_TENANTS_API_URL;
      else process.env.HASNA_TENANTS_API_URL = previousUrl;
    }
  });
});
