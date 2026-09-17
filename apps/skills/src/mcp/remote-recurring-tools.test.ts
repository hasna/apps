import { expect, test } from "bun:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerRecurringTools } from "./remote-recurring-tools.js";
import { recurringFixtureEnvironment, recurringProtocol, recurringFixtureRequest } from "../lib/recurring-surface.fixture.js";
import { listMcpToolContracts } from "../lib/mcp-contracts.js";
import { recurringSurfaceOperations } from "../lib/recurring-surface.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

test("actual in-memory MCP protocol advertises and invokes every recurring operation through one client path", () => recurringProtocol(f => recurringFixtureEnvironment(f.env, async () => {
  const server = new McpServer({ name: "recurring-unit", version: "1" }), client = new Client({ name: "recurring-client-unit", version: "1" });
  registerRecurringTools(server); const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(left); await client.connect(right);
  const invoke = async (name: string, input: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: input });
    expect(response.isError).not.toBe(true);
    const text = (response.content as Array<{ text: string }>)[0]!.text;
    expect(text).not.toContain("inert-session"); expect(text).not.toContain("123456");
    return JSON.parse(text);
  };
  try {
    const tools = (await client.listTools()).tools;
    expect(tools.map(t => t.name).sort()).toEqual(recurringSurfaceOperations.map(t => t.name).sort());
    const contracts = listMcpToolContracts();
    for (const tool of tools) expect(contracts.find(c => c.name === tool.name)?.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    expect(await invoke("preview_recurring_consent", { request: recurringFixtureRequest() })).toMatchObject({ draftId: f.draftId });
    expect(await invoke("get_recurring_draft", { draftId: f.draftId })).toEqual(f.preview());
    expect(await invoke("request_recurring_verification", { draftId: f.draftId, email: "owner@example.test", confirm: true })).toMatchObject({ deliveryConfirmed: false, activated: false });
    const directory = join(f.root, "mcp-activation");
    const activated = await invoke("activate_recurring_consent", { ...f.context, draftId: f.draftId, approval: f.approval, recoveryDirectory: directory, email: "owner@example.test", code: "123456", confirm: true });
    const consentId = activated.result.consent.consentId;
    expect((await invoke("list_recurring_consents", { limit: 1 })).items).toHaveLength(1);
    expect((await invoke("get_recurring_consent", { consentId })).total).toEqual({ reservedCredits: 0, settledCredits: 0, admittedOccurrences: 0 });
    expect((await invoke("list_recurring_occurrences", { consentId, limit: 1 })).nextCursor).toBeNull();
    expect((await invoke("recover_recurring_consent", { recoveryDirectory: directory })).outcomeUnknown).toBe(false);
    expect((await invoke("revoke_recurring_consent", { ...f.context, consentId, recoveryDirectory: join(f.root, "mcp-revoke"), confirm: true })).result.cancellationIsSeparate).toBe(true);
    const count = f.calls.length;
    for (const input of [{ draftId: f.draftId, approval: f.approval }, { ...f.context, draftId: f.draftId, approval: f.approval, recoveryDirectory: directory,
      email: "owner@example.test", code: "123456", confirm: false }, { limit: 101 }]) {
      const response = await client.callTool({ name: "limit" in input ? "list_recurring_consents" : "activate_recurring_consent", arguments: input });
      expect(response.isError).toBe(true);
    }
    expect(f.calls).toHaveLength(count);
  } finally { await client.close(); await server.close(); }
})));
