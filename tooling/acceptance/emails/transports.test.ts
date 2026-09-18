import { afterEach, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { FixtureTransports } from "./transports.ts";
import { assertNoProviderReplay, assertProviderAttempt, assertProviderRequest } from "./probe-assertions.ts";
import { loadImageAuth } from "./image-imports.ts";

const require = createRequire(new URL("../../../apps/emails/package.json", import.meta.url));
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand } = require("@aws-sdk/client-sqs");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { SESv2Client, SendEmailCommand } = require("@aws-sdk/client-sesv2");
const { Resend } = require("resend");
const active: Array<{ stop: () => void }> = [];
afterEach(() => { for (const fixture of active.splice(0)) fixture.stop(); });

function fixture() {
  const controlToken = crypto.randomUUID();
  const state = new FixtureTransports(controlToken, 100);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => state.fetch(request) });
  const endpoint = `http://127.0.0.1:${server.port}`;
  const credentials = { accessKeyId: "synthetic-only", secretAccessKey: crypto.randomUUID() };
  const config = { region: "us-east-1", endpoint, credentials, maxAttempts: 1 };
  const control = async (path: string, value?: unknown) => {
    const response = await fetch(endpoint + "/control/" + path, { method: value ? "POST" : "GET",
      headers: { authorization: `Bearer ${controlToken}`, "content-type": "application/json" },
      ...(value ? { body: JSON.stringify(value) } : {}) });
    expect(response.ok).toBe(true);
    return response.json() as Promise<any>;
  };
  active.push({ stop: () => { state.close(); server.stop(true); } });
  return { state, endpoint, config, control, queueUrl: endpoint + "/queue/synthetic" };
}

test("actual SQS SDK observes visibility, redelivery and deletion", async () => {
  const f = fixture(), client = new SQSClient(f.config);
  await f.control("enqueue", { body: JSON.stringify({ synthetic: true }) });
  const attrs = () => client.send(new GetQueueAttributesCommand({ QueueUrl: f.queueUrl, AttributeNames: ["ApproximateNumberOfMessages"] }));
  expect((await attrs()).Attributes.ApproximateNumberOfMessages).toBe("1");
  const first = await client.send(new ReceiveMessageCommand({ QueueUrl: f.queueUrl, MaxNumberOfMessages: 1 }));
  expect(first.Messages).toHaveLength(1);
  expect((await attrs()).Attributes.ApproximateNumberOfMessages).toBe("0");
  await Bun.sleep(120);
  const second = await client.send(new ReceiveMessageCommand({ QueueUrl: f.queueUrl }));
  expect(second.Messages[0].MessageId).toBe(first.Messages[0].MessageId);
  expect(second.Messages[0].ReceiptHandle).not.toBe(first.Messages[0].ReceiptHandle);
  await client.send(new DeleteMessageCommand({ QueueUrl: f.queueUrl, ReceiptHandle: second.Messages[0].ReceiptHandle }));
  expect(f.state.messages).toHaveLength(0);
  expect(f.state.events.filter(row => row.operation === "sqs.delete")).toHaveLength(1);
  client.destroy();
});

test("delete failure retains the message and real SDK reports rejection", async () => {
  const f = fixture(), client = new SQSClient(f.config);
  await f.control("enqueue", { body: "synthetic" });
  await f.control("mode", { deleteFailures: 1 });
  const response = await client.send(new ReceiveMessageCommand({ QueueUrl: f.queueUrl }));
  await expect(client.send(new DeleteMessageCommand({ QueueUrl: f.queueUrl, ReceiptHandle: response.Messages[0].ReceiptHandle }))).rejects.toBeDefined();
  expect(f.state.messages).toHaveLength(1);
  expect(f.state.events.at(-1)?.status).toBe(500);
  client.destroy();
});

test("actual S3 SDK sees immutable synthetic MIME, controlled failure and stall release", async () => {
  const f = fixture(), client = new S3Client({ ...f.config, forcePathStyle: true });
  await f.control("object", { path: "/synthetic/message.eml", raw: "From: sender@example.test\r\n\r\nsynthetic\r\n" });
  const read = () => client.send(new GetObjectCommand({ Bucket: "synthetic", Key: "message.eml" }));
  expect(await (await read()).Body.transformToString()).toContain("synthetic");
  await f.control("mode", { object: "fail" });
  await expect(read()).rejects.toBeDefined();
  await f.control("mode", { object: "stall" });
  let finished = false;
  const pending = read().then((result: any) => { finished = true; return result; });
  await Bun.sleep(30);
  expect(finished).toBe(false);
  await f.control("mode", { object: "normal" });
  expect(await (await pending).Body.transformToString()).toContain("synthetic");
  client.destroy();
});

test("actual SES SDK and Resend wire shape capture sends without forwarding", async () => {
  const f = fixture(), client = new SESv2Client(f.config);
  const result = await client.send(new SendEmailCommand({ FromEmailAddress: '"Synthetic Name" <sender@example.test>',
    Destination: { ToAddresses: ["recipient@example.test"] }, Content: { Simple: {
      Subject: { Data: "synthetic" }, Body: { Text: { Data: "body" } } } }, ReplyToAddresses: ["reply@example.test"] }));
  expect(result.MessageId).toMatch(/^ses-/);
  expect(f.state.sends[0]?.provider).toBe("ses");
  const response = await fetch(f.endpoint + "/emails", { method: "POST", body: JSON.stringify({
    from: '"Synthetic Name" <sender@example.test>', to: ["recipient@example.test"], reply_to: "reply@example.test" }) });
  const body = await response.json() as any;
  expect(body.id).toMatch(/^resend-/);
  const read = await fetch(f.endpoint + "/emails/" + body.id);
  expect((await read.json() as any).message_id).toContain("@fixture.test>");
  expect(f.state.sends).toHaveLength(2);
  client.destroy();
});

test("fixture control requires its ephemeral credential and unknown operations never forward", async () => {
  const f = fixture();
  expect((await fetch(f.endpoint + "/control/state")).status).toBe(401);
  expect((await fetch(f.endpoint + "/real-provider-or-cloud")).status).toBe(404);
  expect(f.state.events).toEqual([{ operation: "unexpected.request", status: 404 }]);
  expect(f.state.sends).toHaveLength(0);
});

test("actual SDK clients honor the runner's scoped endpoint environment", async () => {
  const f = fixture();
  const names = ["AWS_ENDPOINT_URL_SQS", "AWS_ENDPOINT_URL_S3", "AWS_ENDPOINT_URL_SESV2"];
  const before = names.map(name => process.env[name]);
  const { endpoint, ...config } = f.config;
  const clients: any[] = [];
  try {
    for (const name of names) process.env[name] = endpoint;
    const sqs = new SQSClient(config), s3 = new S3Client(config), ses = new SESv2Client(config);
    clients.push(sqs, s3, ses);
    expect((await sqs.send(new GetQueueAttributesCommand({ QueueUrl: f.queueUrl, AttributeNames: ["ApproximateNumberOfMessages"] }))).Attributes.ApproximateNumberOfMessages).toBe("0");
    await f.control("object", { path: "/synthetic/object", raw: "synthetic" });
    expect(await (await s3.send(new GetObjectCommand({ Bucket: "synthetic", Key: "object" }))).Body.transformToString()).toBe("synthetic");
    expect((await ses.send(new SendEmailCommand({ FromEmailAddress: "sender@example.test", Destination: { ToAddresses: ["recipient@example.test"] },
      Content: { Simple: { Subject: { Data: "synthetic" }, Body: { Text: { Data: "body" } } } } }))).MessageId).toMatch(/^ses-/);
  } finally {
    for (const client of clients) client.destroy();
    names.forEach((name, index) => { if (before[index] === undefined) delete process.env[name]; else process.env[name] = before[index]; });
  }
});

test("idempotency evidence refuses an extra send with a different ID or an uncertain attempt", () => {
  const before = { sends: [{ id: "original" }], events: [{ operation: "ses.send" }] };
  expect(() => assertNoProviderReplay(before, { sends: [{ id: "original" }], events: [...before.events, { operation: "sqs.attributes" }] })).not.toThrow();
  expect(() => assertNoProviderReplay(before, { sends: [...before.sends, { id: "different" }], events: [...before.events, { operation: "ses.send" }] })).toThrow("PROVIDER_DUPLICATE_SEND");
  expect(() => assertNoProviderReplay(before, { sends: before.sends, events: [...before.events, { operation: "resend.send" }] })).toThrow("PROVIDER_DUPLICATE_SEND");
});

test("SES evidence requires actual unique MIME headers and the exact recipient envelope", () => {
  const headers = ['From: "Synthetic Sender" <sender@a.example.test>', 'Reply-To: "Reply Desk" <reply@a.example.test>',
    "In-Reply-To: <parent@external.test>", "References: <root@external.test> <parent@external.test>"].join("\r\n");
  const wire = (raw: string) => ({ FromEmailAddress: '"Synthetic Sender" <sender@a.example.test>', Destination: { ToAddresses: ["recipient@external.test"] },
    Content: { Raw: { Data: Buffer.from(raw).toString("base64") } } });
  expect(() => assertProviderRequest("ses", wire(headers+"\r\n\r\nbody"))).not.toThrow();
  expect(() => assertProviderRequest("ses", wire("Subject: untrusted\r\n\r\n"+headers))).toThrow("PROVIDER_HEADER_VALUE");
  expect(() => assertProviderRequest("ses", wire(headers+'\r\nfRoM: "Synthetic Sender" <sender@a.example.test>\r\n\r\nbody'))).toThrow("PROVIDER_HEADER_VALUE");
  const extra = wire(headers+"\r\n\r\nbody");
  extra.Destination.ToAddresses.push("other@external.test");
  expect(() => assertProviderRequest("ses", extra)).toThrow("PROVIDER_ENVELOPE");
});

test("provider failure proof requires an actual matching failed attempt with no accepted send", async () => {
  const f = fixture();
  const before = await f.control("state");
  expect(() => assertProviderAttempt(before, before, "resend", 400)).toThrow("PROVIDER_ATTEMPT_MISSING");
  await f.control("mode", { send: "reject" });
  const body = { from: '"Synthetic Sender" <sender@a.example.test>', to: ["recipient@external.test"], reply_to: '"Reply Desk" <reply@a.example.test>',
    headers: { "In-Reply-To": "<parent@external.test>", References: "<root@external.test> <parent@external.test>" } };
  expect((await fetch(f.endpoint+"/emails", { method: "POST", body: JSON.stringify(body) })).status).toBe(400);
  const after = await f.control("state");
  expect(() => assertProviderAttempt(before, after, "resend", 400)).not.toThrow();
  expect(() => assertProviderAttempt(before, { ...after, sends: [{ id: "unexpected-success" }] }, "resend", 400)).toThrow("PROVIDER_ATTEMPT_RESULT");
  after.attempts[0].body.to = ["other@external.test"];
  expect(() => assertProviderAttempt(before, after, "resend", 400)).toThrow("PROVIDER_ATTEMPT_RESULT");
});

test("real Resend SDK exposes numeric rejection status only when its JSON contract supplies it", async () => {
  const f = fixture();
  const client = new Resend("synthetic-only", { baseUrl: f.endpoint });
  const payload = { from: "sender@example.test", to: ["recipient@example.test"], subject: "synthetic", text: "body" };
  await f.control("mode", { send: "reject" });
  const rejected = await client.emails.send(payload);
  expect(rejected.error.statusCode).toBe(400);
  await f.control("mode", { send: "unproven" });
  const unproven = await client.emails.send(payload);
  expect(unproven.error.statusCode).toBeUndefined();
  expect(unproven.error.name).toBe("validation_error");
  expect(f.state.sends).toHaveLength(0);
  await f.control("mode", { send: "missing-receipt" });
  const missing = await client.emails.send(payload);
  expect(missing.error).toBeNull();
  expect(missing.data.id).toBeUndefined();
  expect(f.state.sends).toHaveLength(1);
});

test("image bootstrap loads published auth through its import-only export condition", async () => {
  // The same package intentionally cannot be loaded using require's condition.
  expect(() => require("@hasna/contracts/auth")).toThrow();
  const auth = await loadImageAuth(new URL("../../../apps/emails", import.meta.url).pathname);
  expect(typeof auth.ApiKeyStore).toBe("function");
  expect(typeof auth.mintApiKey).toBe("function");
});
