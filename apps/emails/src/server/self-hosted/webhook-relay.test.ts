import { expect, test } from "bun:test";
import { createHmac, randomBytes } from "node:crypto";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { handleSelfHostedRequest, type SelfHostedServiceDeps } from "./service.js";
import { selfScopedStore, testAuthDeps } from "./auth/test-support.js";
import { providerWebhookRequest } from "./webhook-relay.js";
import { DEFAULT_TENANT_ID } from "./migrations.js";
import type { TypedQueryClient } from "../../storage-kit/index.js";
const signingSecret = crypto.randomUUID(), secret = randomBytes(32), apiKey = crypto.randomUUID();
function fixture() {
  const client = { query: async () => ({ rows: [], rowCount: 0 }), many: async () => [], get: async () => null, one: async () => ({}), execute: async () => {} } as TypedQueryClient;
  const store = selfScopedStore(client), calls: any[] = [], fetches: any[] = [];
  const state = { tenant: DEFAULT_TENANT_ID, unresolved: [] as string[], receipt: false, missingRaw: false, cdn: "https://cdn.resend.com/raw", fail: false, type: "resend" };
  const binding: any = { tenant_id: DEFAULT_TENANT_ID, provider_id: "provider", type: "resend", secret_env: "FIXTURE_WEBHOOK_SECRET", api_key_env: "FIXTURE_RECEIVING_KEY" };
  const env = { EMAILS_WEBHOOK_BINDINGS: JSON.stringify([binding]), FIXTURE_WEBHOOK_SECRET: `whsec_${secret.toString("base64")}`, FIXTURE_RECEIVING_KEY: apiKey };
  Object.assign(store, {
    resolveInboundRecipients: async (to: string[]) => ({ groups: [{ tenantId: state.tenant, recipients: to }], unresolved: state.unresolved }),
    getResource: async () => ({ id: "provider", type: state.type }),
    findRelayReceipt: async () => state.receipt ? { resourceId: "durable" } : null,
    recordRelayReceipt: async (...args: any[]) => { calls.push(args); },
    createRelayInbound: async (...args: any[]) => { if (state.fail) throw new Error("database unavailable"); calls.push(args); state.receipt = true; return { id: "durable", receiptRecorded: true }; },
    createRelayDelivery: async (...args: any[]) => { calls.push(args); return { id: "event", receiptRecorded: true }; },
  });
  const raw = "From: Sender <sender@example.net>\r\nSubject: Full content\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/html\r\n\r\n<p>Full body</p>\r\n--x\r\nContent-Type: image/png\r\nContent-ID: <cid-fixture>\r\nContent-Disposition: inline; filename=fixture.png\r\nContent-Transfer-Encoding: base64\r\n\r\nYWJj\r\n--x--\r\n";
  const deps = { client, store, verifier: verifyApiKey({ app: "emails", signingSecret, keyStatus: async () => "active" }), migrations: [], version: "fixture", ...testAuthDeps(client, signingSecret), env, webhookRelay: { fetch: async (url: any, init: any) => { fetches.push({ url: String(url), init }); return String(url).startsWith("https://api.resend.com/") ? Response.json({ id: "received-id", raw: state.missingRaw ? null : { download_url: state.cdn } }) : new Response(raw); } } } as unknown as SelfHostedServiceDeps;
  const request = (body: unknown = { type: "email.received", data: { email_id: "received-id", from: "sender@example.net", to: ["inbox@example.com"] } }, scopes = ["emails:*"], valid = true, route = "resend") => {
    const raw = JSON.stringify(body), id = "fixture-event", ts = String(Math.floor(Date.now() / 1000));
    const signature = `v1,${createHmac("sha256", secret).update(`${id}.${ts}.${raw}`).digest("base64")}`;
    return handleSelfHostedRequest(deps, new Request(`http://fixture/v1/webhooks/relay/${route}?provider_id=provider`, { method: "POST", headers: { "x-api-key": mintApiKey({ app: "emails", scopes, signingSecret }).token, "content-type": "application/json", "svix-id": id, "svix-timestamp": ts, "svix-signature": valid ? signature : "invalid" }, body: JSON.stringify({ raw_body_base64: Buffer.from(raw).toString("base64"), signature_headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": ts, "svix-signature": valid ? signature : "invalid" } }) }));
  };
  return { state, calls, fetches, deps, env, binding, request };
}
test("real Svix verification precedes receiving-content fetch; raw HTML and CID bytes persist before completion", async () => {
  const f = fixture(); const result = await f.request(); expect(result!.status).toBe(200); expect(await result!.json()).toMatchObject({ completed: true, id: "durable", provider_id: "provider" });
  expect(f.calls[0][2]).toMatchObject({ provider_id: "provider", to_addrs: ["inbox@example.com"], body_html: "<p>Full body</p>", attachments: [{ content_id: "cid-fixture", content_base64: "YWJj", size: 3 }] });
  expect(f.fetches[0].init.headers.Authorization).toBe(`Bearer ${apiKey}`); expect(f.fetches[1].init.headers).toBeUndefined(); expect(f.fetches.every(call => call.init.redirect === "error")).toBe(true);
  expect((await f.request())!.status).toBe(200); expect(f.fetches).toHaveLength(2); expect(f.calls).toHaveLength(1);
});
test("unsigned and foreign-tenant events do not fetch or persist, even with operator auth", async () => {
  const f = fixture(); expect((await f.request(undefined, undefined, false))!.status).toBe(401);
  f.state.tenant = "00000000-0000-0000-0000-000000000002"; expect((await f.request())!.status).toBe(403);
  expect(f.calls).toHaveLength(0); expect(f.fetches).toHaveLength(0);
});
test("ordinary reader/writer cannot relay or manufacture completion receipts", async () => {
  const f = fixture();
  for (const scopes of [["emails:read"], ["emails:write"]]) {
    expect((await f.request(undefined, scopes))!.status).toBe(403);
    const generic = await handleSelfHostedRequest(f.deps, new Request("http://fixture/v1/webhook-receipts", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": mintApiKey({ app: "emails", scopes, signingSecret }).token }, body: JSON.stringify({ provider: "relay:resend:provider", event_id: "forged", resource_id: "forged" }) }));
    expect(generic!.status).toBe(403);
  }
  expect(f.fetches).toHaveLength(0);
});
test("missing raw, untrusted CDN, unknown event and persistence failure never acknowledge completion", async () => {
  for (const mutate of [(f: any) => { f.state.missingRaw = true; }, (f: any) => { f.state.cdn = "https://127.0.0.1/raw"; }, (f: any) => { f.state.fail = true; }]) {
    const f = fixture(); mutate(f); const response = await f.request(); expect(response!.status).toBeGreaterThanOrEqual(400); expect(await response!.text()).not.toContain(apiKey);
  }
  const f = fixture(); expect((await f.request({ type: "unknown", data: {} }))!.status).toBe(422);
});
test("provider mismatch and malformed or unavailable server bindings fail before provider calls", async () => {
  const f = fixture(); expect((await f.request(undefined, undefined, true, "ses"))!.status).toBe(409);
  f.env.EMAILS_WEBHOOK_BINDINGS = JSON.stringify([{ ...f.binding, secret_env: "MISSING_SECRET" }]); expect((await f.request())!.status).toBe(503);
  f.env.EMAILS_WEBHOOK_BINDINGS = JSON.stringify([{ ...f.binding, tenant_id: "00000000-0000-0000-0000-000000000002" }]); expect((await f.request())!.status).toBe(404);
  expect(f.calls).toHaveLength(0); expect(f.fetches).toHaveLength(0);
});
test("SES uses exact bound topic, active source and tenant; confirms subscriptions only after provider response and durable receipt", async () => {
  const f = fixture(); f.state.type = "ses";
  const topic = "arn:aws:sns:us-east-1:123456789012:fixture";
  const source = { tenant_id: DEFAULT_TENANT_ID, source_id: "source", provider_id: "provider", bucket: "fixture-mail", prefix: "inbound/example.com/", domain: "example.com", region: "us-east-1", topic_arn: topic };
  f.env.EMAILS_WEBHOOK_BINDINGS = JSON.stringify([{ tenant_id: DEFAULT_TENANT_ID, provider_id: "provider", type: "ses", source_id: "source", topic_arn: topic }]);
  Object.assign(f.env, { EMAILS_INGEST_BINDINGS: JSON.stringify([source]) });
  Object.assign(f.deps.store, { getResource: async (_spec: any, id: string) => id === "provider" ? { type: "ses" } : { type: "s3", status: "active" }, getDomainByName: async () => ({ domain: "example.com" }) });
  let verification = false, confirmations = 0;
  f.deps.webhookRelay = { verifySns: async () => verification, fetch: (async () => { confirmations++; return new Response("OK"); }) as any };
  const body = { Type: "SubscriptionConfirmation", TopicArn: topic, MessageId: "sns-event", Message: "confirmation", SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription" };
  expect((await f.request(body, undefined, true, "ses"))!.status).toBe(401); expect(confirmations).toBe(0);
  verification = true;
  expect((await f.request({ ...body, TopicArn: topic + "-foreign" }, undefined, true, "ses"))!.status).toBe(401);
  const response = await f.request(body, undefined, true, "ses"); expect(response!.status).toBe(200); expect(await response!.json()).toMatchObject({ confirmed: true, completed: true }); expect(confirmations).toBe(1); expect(f.calls).toHaveLength(1);
  f.deps.webhookRelay.fetch = (async () => new Response("failed", { status: 500 })) as any;
  expect((await f.request(body, undefined, true, "ses"))!.status).toBe(502);
});
test("SES inbound reads only its bound S3 source and refuses acknowledgment when durable receipt recording fails", async () => {
  const f = fixture(); f.state.type = "ses";
  const topic = "arn:aws:sns:us-east-1:123456789012:fixture", key = "inbound/example.com/message";
  f.env.EMAILS_WEBHOOK_BINDINGS = JSON.stringify([{ tenant_id: DEFAULT_TENANT_ID, provider_id: "provider", type: "ses", source_id: "source", topic_arn: topic }]);
  Object.assign(f.env, { EMAILS_INGEST_BINDINGS: JSON.stringify([{ tenant_id: DEFAULT_TENANT_ID, source_id: "source", provider_id: "provider", bucket: "fixture-mail", prefix: "inbound/example.com/", domain: "example.com", region: "us-east-1", topic_arn: topic }]) });
  const inserted: any[] = [], fetched: string[] = [];
  Object.assign(f.deps.store, {
    getResource: async (_spec: any, id: string) => id === "provider" ? { type: "ses" } : { type: "s3", status: "active" }, getDomainByName: async () => ({ domain: "example.com" }),
    createInboundMessageWithProvenance: async (input: any) => { inserted.push(input); return { record: { id: "ses-durable", ...input }, inserted: true, provenance: "recorded" }; },
  });
  f.deps.webhookRelay = { verifySns: async () => true, fetchObject: async (bucket, object) => { fetched.push(`${bucket}/${object}`); return Buffer.from("From: sender@example.net\r\nSubject: SES body\r\n\r\nHello\r\n"); } };
  const body = { Type: "Notification", TopicArn: topic, MessageId: "sns-event", Message: JSON.stringify({ notificationType: "Received", mail: { messageId: "upstream", destination: ["inbox@example.com"] }, receipt: { recipients: ["inbox@example.com"], action: { type: "S3", bucketName: "untrusted-bucket", objectKey: key } } }) };
  const response = await f.request(body, undefined, true, "ses"); expect(response!.status).toBe(200); expect(await response!.json()).toMatchObject({ completed: true, synced: 1 });
  expect(fetched).toEqual([`fixture-mail/${key}`]); expect(inserted[0]).toMatchObject({ provider_id: "provider", body_text: "Hello\n", to_addrs: ["inbox@example.com"] });
  Object.assign(f.deps.store, { recordRelayReceipt: async () => { throw new Error("database failure"); } });
  expect((await f.request(body, undefined, true, "ses"))!.status).toBe(503);
});

test("SDK relay envelope preserves arbitrary bytes and rejects noncanonical, oversized or credential-bearing inputs", async () => {
  const raw = Buffer.from([0xff, 0, 13, 10, 0xc3, 0xa9]);
  const request = providerWebhookRequest("http://fixture/relay", { raw_body_base64: raw.toString("base64"), signature_headers: { "svix-id": "event" } });
  expect(Buffer.from(await request.arrayBuffer())).toEqual(raw);
  for (const envelope of [
    { raw_body_base64: "YWJj!", signature_headers: {} },
    { raw_body_base64: Buffer.alloc(1048577).toString("base64"), signature_headers: {} },
    { raw_body_base64: "", signature_headers: { authorization: "not-allowed" } },
    { raw_body_base64: "", signature_headers: { "svix-id": "bad\r\nheader" } },
  ]) expect(() => providerWebhookRequest("http://fixture/relay", envelope)).toThrow();
});
