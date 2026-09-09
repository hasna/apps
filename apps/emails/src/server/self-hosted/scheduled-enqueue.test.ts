import { expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import {
  handleSelfHostedRequest,
  type SelfHostedServiceDeps,
} from "./service.js";
import { selfScopedStore, testAuthDeps } from "./auth/test-support.js";
import type { TypedQueryClient } from "../../storage-kit/index.js";
const signingSecret = crypto.randomUUID();
const client = {
  query: async () => ({ rows: [], rowCount: 0 }),
  many: async () => [],
  get: async () => null,
  one: async () => ({}),
  execute: async () => {},
} as TypedQueryClient;
function fixture() {
  let sends = 0;
  const enqueued: any[] = [];
  const store = selfScopedStore(client);
  Object.assign(store, {
    getResource: async () => ({
      id: "provider-fixture",
      type: "sandbox",
      active: true,
    }),
    enqueueScheduled: async (input: any) => {
      if (Date.parse(input.scheduledAt) <= Date.now())
        throw new RangeError("Scheduled time must be in the future");
      enqueued.push(input);
      return {
        id: "queue-fixture",
        status: "pending",
        scheduled_at: input.scheduledAt,
        created: true,
      };
    },
    reserveSendIntent: async () => {
      throw new Error("Enqueue must not reserve or send now");
    },
  });
  const sender = {
    provider: "sandbox" as const,
    send: async () => {
      sends++;
      return "not-called";
    },
  };
  const deps = {
    client,
    store,
    verifier: verifyApiKey({
      app: "emails",
      signingSecret,
      keyStatus: async () => "active",
    }),
    sender,
    resolveSender: async () => sender,
    migrations: [],
    version: "fixture",
    ...testAuthDeps(client, signingSecret),
  } as SelfHostedServiceDeps;
  return { deps, enqueued, sends: () => sends };
}
const future = () => new Date(Date.now() + 3600000).toISOString();
const base = () => ({
  from: "sender@example.com",
  to: ["recipient@example.com"],
  subject: "Fixture",
  text: "Body",
  scheduled_at: future(),
  idempotency_key: "enqueue-fixture",
});
function request(body: unknown, scopes = ["emails:*"]) {
  return new Request("http://fixture/v1/scheduled/enqueue", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": mintApiKey({ app: "emails", scopes, signingSecret }).token,
    },
    body: JSON.stringify(body),
  });
}
test("enqueue validates through send contract, preserves all options and never calls provider", async () => {
  const f = fixture();
  const response = await handleSelfHostedRequest(
    f.deps,
    request({
      ...base(),
      cc: ["copy@example.com"],
      bcc: ["blind@example.com"],
      reply_to: "reply@example.com",
      provider_id: "provider-fixture",
      unsubscribe_url: "https://example.com/unsubscribe",
      allow_suppressed_recipients: true,
      attachments: [
        {
          filename: "fixture.txt",
          content: Buffer.from("fixture").toString("base64"),
          content_type: "text/plain",
        },
      ],
    }),
  );
  expect(response!.status).toBe(201);
  expect(f.sends()).toBe(0);
  expect(f.enqueued).toHaveLength(1);
  expect(f.enqueued[0].payload).toMatchObject({
    cc: ["copy@example.com"],
    bcc: ["blind@example.com"],
    reply_to: "reply@example.com",
    provider_id: "provider-fixture",
    unsubscribe_url: "https://example.com/unsubscribe",
    allow_suppressed_recipients: true,
  });
});
test("past time, invalid attachments and nonoperator principals never enqueue", async () => {
  const f = fixture();
  for (const body of [
    { ...base(), scheduled_at: "2001-01-01T00:00:00Z" },
    { ...base(), scheduled_at: "invalid" },
    { ...base(), attachments: [{ filename: "bad", content: "not base64" }] },
  ])
    expect((await handleSelfHostedRequest(f.deps, request(body)))!.status).toBe(
      400,
    );
  expect(
    (await handleSelfHostedRequest(f.deps, request(base(), ["emails:write"])))!
      .status,
  ).toBe(403);
  expect(f.enqueued).toHaveLength(0);
  expect(f.sends()).toBe(0);
});

test("scheduler completes the actual send route durable 202 receipt in one run", async () => {
  const { runScheduledBatch } = await import("./scheduler.js");
  const f = fixture();
  let sent = 0;
  const finishes: unknown[][] = [];
  const record = {
    id: "message-fixture",
    send_state: "pending",
    status: "pending",
    headers: {},
    from_addr: "sender@example.com",
    to_addrs: ["recipient@example.com"],
    subject: "Fixture",
    attachments: [],
  };
  Object.assign(f.deps.store, {
    reserveSendIntent: async () => ({ record, created: true }),
    evaluateOutboundPolicy: async () => ({ allowed: true }),
    claimSendIntent: async () => ({ ...record, send_state: "sending" }),
    getAddressByEmail: async () => null,
    completeSendIntent: async () => ({
      ...record,
      send_state: "sent",
      status: "sent",
      provider_message_id: "provider-fixture",
    }),
  });
  f.deps.sender.send = async () => {
    sent++;
    return "provider-fixture";
  };
  const result = await runScheduledBatch(
    {
      claimDueScheduled: async () => [
        {
          id: "schedule-fixture",
          from_address: "sender@example.com",
          to_addresses: ["recipient@example.com"],
          subject: "Fixture",
          text_body: "Body",
          updated_at: new Date().toISOString(),
          send_options: {
            unsubscribe_url: "https://example.com/unsubscribe",
            allow_suppressed_recipients: true,
          },
        },
      ],
      getScheduledTemplate: async () => null,
      finishScheduled: async (...args) => {
        finishes.push(args);
        return true;
      },
    },
    async (body) => {
      const req = request(body);
      const response = await handleSelfHostedRequest(
        f.deps,
        new Request("http://fixture/v1/messages/send", req),
      );
      expect(response!.status).toBe(202);
      return response!;
    },
  );
  expect(sent).toBe(1);
  expect(result.scheduled).toMatchObject({ sent: 1, pending: 0, failed: 0 });
  expect(finishes[0]?.[2]).toBe("sent");
});

test("sequence worker advances through the real authenticated send handler durable202", async () => {
  const { runSequenceBatch } = await import("./sequence-worker.js");
  const f = fixture();
  let sends = 0;
  let advanced = false;
  const record = {
    id: "sequence-message",
    send_state: "pending",
    status: "pending",
    headers: {},
    attachments: [],
  };
  Object.assign(f.deps.store, {
    reserveSendIntent: async () => ({ record, created: true }),
    evaluateOutboundPolicy: async () => ({ allowed: true }),
    claimSendIntent: async () => ({ ...record, send_state: "sending" }),
    getAddressByEmail: async () => null,
    completeSendIntent: async () => ({
      ...record,
      send_state: "sent",
      status: "sent",
      provider_message_id: "fixture-proof",
    }),
  });
  f.deps.sender.send = async () => {
    sends++;
    return "fixture-proof";
  };
  const row = {
    id: "enrollment",
    current_step: 0,
    execution_lease: new Date().toISOString(),
  };
  const worker = {
    claim: async () => [row],
    isCurrent: async () => true,
    prepare: async () => ({
      id: "sequence:enrollment:0",
      from_address: "sender@example.com",
      to_addresses: ["recipient@example.com"],
      subject: "Fixture",
      text_body: "Body",
      next_delay_hours: null,
    }),
    finish: async (_row: unknown, _snapshot: unknown, outcome: string) => {
      advanced = outcome === "sent";
      return true;
    },
  };
  const result = await runSequenceBatch(worker as never, async (body) => {
    const response = await handleSelfHostedRequest(
      f.deps,
      new Request("http://fixture/v1/messages/send", request(body)),
    );
    expect(response!.status).toBe(202);
    return response!;
  });
  expect(sends).toBe(1);
  expect(advanced).toBe(true);
  expect(result.sequences).toMatchObject({ sent: 1, pending: 0, failed: 0 });
});
