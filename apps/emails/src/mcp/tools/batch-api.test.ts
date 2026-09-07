import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import { registerMiscOpsTools } from "./misc-ops.js";
let stub: V1Stub;
const provider = "00000000-0000-4000-8000-000000000077";
beforeAll(async () => { stub = await startV1Stub({ openapi: true, apiKey: crypto.randomUUID(), seed: {
  providers: [{ id: provider, name: "batch-fixture", type: "ses", active: true }],
  templates: [{ id: "00000000-0000-4000-8000-000000000078", name: "welcome", subject_template: "Hello {{name}}", text_template: "For {{email}}", html_template: null }],
} }); });
beforeEach(async () => { await stub.reset(); stub.applyEnv(); });
afterEach(() => stub.clearEnv());
afterAll(() => stub.stop());
async function batch(overrides: Record<string, unknown> = {}) {
  const server = new McpServer({ name: "batch-test", version: "1" });
  registerMiscOpsTools(server);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler(input: unknown): Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools;
  const result = await tools.batch_send!.handler({ recipients: [{ email: "one@example.test", vars: { name: "Ada" } }, { email: "two@example.test", vars: { name: "Lin" } }], template_name: "welcome", from_address: "ops@example.test", provider_id: provider, ...overrides });
  const text = result.content[0]!.text;
  return { result, body: text.startsWith("{") ? JSON.parse(text) : { error: text } };
}
test("MCP batch renders recipients, carries provider and replays stable sends", async () => {
  const first = await batch();
  expect(first.result.isError, JSON.stringify(first.body)).not.toBe(true);
  expect(first.body).toMatchObject({ total: 2, sent: 2, failed: 0, pending: 0 });
  expect(await stub.sendRequests()).toMatchObject([{ subject: "Hello Ada", text: "For one@example.test", provider_id: provider }, { subject: "Hello Lin", text: "For two@example.test", provider_id: provider }]);
  const second = await batch();
  expect(second.body.batch_id).toBe(first.body.batch_id);
  expect(await stub.sendStats()).toEqual({ providerCalls: 2 });
  expect(await stub.list("messages")).toHaveLength(2);
  const newBatch = await batch({ idempotency_key: crypto.randomUUID() });
  expect(newBatch.body.batch_id).not.toBe(first.body.batch_id);
  expect(await stub.sendStats()).toEqual({ providerCalls: 4 });
});
test("MCP batch validates all recipients before sending", async () => {
  for (const recipients of [[], [{ email: "ok@example.test" }, { email: "bad" }]]) {
    const { result } = await batch({ recipients });
    expect(result.isError).toBe(true);
    expect(await stub.sendRequests()).toEqual([]);
  }
});
test("MCP batch returns partial failures and honors the explicit suppression override", async () => {
  const { suppressContact } = await import("../../db/contacts.js");
  await suppressContact("two@example.test");
  const partial = await batch();
  expect(partial.result.isError).toBe(true);
  expect(partial.body).toMatchObject({ total: 2, sent: 1, failed: 1 });
  expect(partial.body.receipts).toHaveLength(1);
  expect(partial.body.errors).toHaveLength(1);
  const forced = await batch({ force: true });
  expect(forced.result.isError).not.toBe(true);
  expect(forced.body).toMatchObject({ total: 2, sent: 2, failed: 0 });
  expect((await stub.sendRequests()).slice(-2)).toMatchObject([{ allow_suppressed_recipients: true }, { allow_suppressed_recipients: true }]);
});


test("MCP batch never reports uncertain API sends as completed", async () => {
  await stub.setSendBehavior("post_send_warning");
  const uncertain = await batch();
  expect(uncertain.result.isError).toBe(true);
  expect(uncertain.body.sent).toBe(2); // Provider accepted both; receipt warnings prevent an all-clear result.
  expect(uncertain.body.receipts).toHaveLength(2);
  expect(uncertain.body.receipts.every((receipt: { warning?: string }) => Boolean(receipt.warning))).toBe(true);
});
