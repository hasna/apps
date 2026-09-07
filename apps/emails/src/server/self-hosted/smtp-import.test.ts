import { expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { handleSelfHostedRequest, type SelfHostedServiceDeps } from "./service.js";
import { selfScopedStore, testAuthDeps } from "./auth/test-support.js";
import { DEFAULT_TENANT_ID } from "./migrations.js";
import type { TypedQueryClient } from "../../storage-kit/index.js";
const signingSecret = crypto.randomUUID();
const raw = Buffer.from("From: Sender <sender@example.net>\r\nTo: foreign@other.test\r\nSubject: SMTP fixture\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/html\r\n\r\n<p>Hello</p>\r\n--x\r\nContent-Type: image/png\r\nContent-Disposition: inline; filename=fixture.png\r\nContent-ID: <fixture-cid>\r\nContent-Transfer-Encoding: base64\r\n\r\nYWJj\r\n--x--\r\n");
function fixture() {
  const client = { query: async () => ({ rows: [], rowCount: 0 }), many: async () => [], get: async () => null, one: async () => ({}), execute: async () => {} } as TypedQueryClient;
  const store = selfScopedStore(client), calls: any[] = [];
  const state = { tenant: DEFAULT_TENANT_ID, unresolved: [] as string[], provider: true };
  Object.assign(store, {
    resolveInboundRecipients: async (to: string[]) => ({ groups: [{ tenantId: state.tenant, recipients: to }], unresolved: state.unresolved }),
    getResource: async () => state.provider ? { id: "provider" } : null,
    submitSmtpMessage: async (...args: any[]) => { calls.push(args); return { stored: true, id: "durable-id", duplicate: false }; },
  });
  const deps = { client, store, verifier: verifyApiKey({ app: "emails", signingSecret, keyStatus: async () => "active" }), migrations: [], version: "fixture", ...testAuthDeps(client, signingSecret), env: {} } as SelfHostedServiceDeps;
  const input = { transaction_id: crypto.randomUUID(), raw_base64: raw.toString("base64"), envelope: { from: "sender@example.net", to: ["inbox@example.com"] }, provider_id: "provider" };
  const request = (body: unknown = input, scopes = ["emails:*"], method = "POST", suffix = "") => handleSelfHostedRequest(deps, new Request(`http://fixture/v1/inbox/smtp${suffix}`, { method, headers: { "Content-Type": "application/json", "x-api-key": mintApiKey({ app: "emails", scopes, signingSecret }).token }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }));
  return { state, store, calls, input, request };
}
test("real handler parses MIME and CID bytes but uses the authenticated envelope, preserving provider provenance", async () => {
  const f = fixture();
  const response = await f.request(); expect(response!.status).toBe(201);
  expect(await response!.json()).toEqual({ stored: true, id: "durable-id", duplicate: false });
  expect(f.calls[0][0]).toMatchObject({ direction: "inbound", provider_id: "provider", to_addrs: ["inbox@example.com"], cc_addrs: [], body_html: "<p>Hello</p>", source_id: `smtp:${f.input.transaction_id}` });
  expect(f.calls[0][0].attachments[0]).toMatchObject({ content_id: "fixture-cid", content_base64: "YWJj", size: 3 });
  expect(f.calls[0][2]).toMatch(/^[0-9a-f]{64}$/);
});
test("reader and data writer cannot preflight or import; operator can preflight only a tenant provider", async () => {
  const f = fixture();
  for (const scopes of [["emails:read"], ["emails:write"]]) for (const method of ["GET", "POST"]) expect((await f.request(undefined, scopes, method))!.status).toBe(403);
  expect(f.calls).toHaveLength(0);
  expect((await f.request(undefined, undefined, "GET", "?provider_id=provider"))!.status).toBe(200);
  f.state.provider = false;
  expect((await f.request())!.status).toBe(404);
  expect((await f.request(undefined, undefined, "GET", "?provider_id="))!.status).toBe(400);
});
test("foreign or unresolved SMTP recipients fail before storage despite valid MIME headers", async () => {
  const f = fixture(); f.state.tenant = "00000000-0000-0000-0000-000000000002";
  expect((await f.request())!.status).toBe(403); f.state.tenant = DEFAULT_TENANT_ID; f.state.unresolved = ["missing@example.com"];
  expect((await f.request())!.status).toBe(403); expect(f.calls).toHaveLength(0);
});
test("rejects malformed base64, extra fields, oversized raw data and invalid envelope selectors before persistence", async () => {
  const f = fixture();
  for (const patch of [{ raw_base64: "YWJj!" }, { transaction_id: "bad" }, { tenant_id: "other" }, { envelope: { from: "bad\r\n", to: ["inbox@example.com"] } }, { envelope: { from: "", to: [] } }]) expect((await f.request({ ...f.input, ...patch }))!.status).toBe(400);
  expect((await f.request({ ...f.input, raw_base64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64") }))!.status).toBe(413);
  expect(f.calls).toHaveLength(0);
});
test("identity conflicts return 409 and no uncertain storage error becomes success", async () => {
  const f = fixture(); Object.assign(f.store, { submitSmtpMessage: async () => { throw new Error("SMTP transaction identity conflicts with the original content"); } });
  expect((await f.request())!.status).toBe(409);
});

test("empty DATA and a null reverse path remain valid SMTP imports", async () => {
  const f = fixture();
  expect((await f.request({ ...f.input, raw_base64: "", envelope: { from: "", to: ["inbox@example.com"] } }))!.status).toBe(201);
  expect(f.calls[0][0].from_addr).toBe("(unknown sender)");
});
