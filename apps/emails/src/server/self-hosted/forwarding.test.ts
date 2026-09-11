import { expect, test } from "bun:test";
import {
  normalizeForwardingOptions,
  normalizeForwardingRule,
  runForwardingBatch,
  type ForwardingClaim,
} from "./forwarding.js";
const claim = (): ForwardingClaim => ({
  rule_id: "rule",
  message_id: "message",
  lease: "lease",
  snapshot: {
    rule: {
      source_address: "source@example.test",
      target_address: "target@example.test",
      mode: "app-copy",
      provider_id: "bound-provider",
    },
    message: {
      from_addr: "original@example.test",
      subject: "<script>title</script>",
      body_text: "<script>alert(1)</script>&",
      headers: {},
      received_at: "2026-01-01",
    },
    options: {},
  },
});
test("forwards a quoted copy through the normal send callback with stable identity and loop headers", async () => {
  const finished: unknown[] = [],
    calls: unknown[] = [];
  const result = await runForwardingBatch(
    {
      claimForwarding: async () => [claim()],
      finishForwarding: async (...args) => {
        finished.push(args);
        return true;
      },
    },
    async (body, headers) => {
      calls.push({ body, headers });
      return Response.json(
        {
          sent: true,
          message: {
            id: "sent-message",
            send_state: "sent",
            provider_message_id: "proof",
          },
        },
        { status: 202 },
      );
    },
  );
  expect(result).toMatchObject({ sent: 1, pending: 0 });
  expect(calls[0]).toMatchObject({
    body: {
      idempotency_key: "forward:rule:message",
      provider_id: "bound-provider",
      to: ["target@example.test"],
    },
    headers: {
      "X-Hasna-Forwarded-For": "source@example.test",
      "Auto-Submitted": "auto-generated",
    },
  });
  const body = (calls[0] as { body: { html: string } }).body;
  expect(body.html).toContain("&lt;script&gt;");
  expect(body.html).not.toContain("<script>");
  expect(finished).toHaveLength(1);
});
test("lost acknowledgement, uncertain outcomes and lease loss never report a sent copy", async () => {
  for (const outcome of [
    "transport",
    "uncertain",
    "lease",
    "ledger",
  ] as const) {
    let finishes = 0;
    const keys: unknown[] = [];
    const store = {
      claimForwarding: async () => [claim()],
      finishForwarding: async () => {
        finishes++;
        if (outcome === "ledger")
          throw new Error("sensitive provider detail never reflected");
        return false;
      },
    };
    const send = async (body: Record<string, unknown>) => {
      keys.push(body.idempotency_key);
      if (outcome === "transport")
        throw new Error("sensitive provider detail never reflected");
      return outcome === "uncertain"
        ? Response.json(
            {
              sent: null,
              reconciliation_required: true,
              message: { send_state: "uncertain" },
            },
            { status: 502 },
          )
        : Response.json(
            {
              sent: true,
              message: {
                id: "sent-message",
                send_state: "sent",
                provider_message_id: "proof",
              },
            },
            { status: 202 },
          );
    };
    const result = await runForwardingBatch(store, send);
    await runForwardingBatch(store, send);
    expect(result).toMatchObject({ sent: 0, pending: 1 });
    expect(keys[0]).toBe(keys[1]);
    expect(JSON.stringify(result)).not.toContain("sensitive provider detail");
    expect(finishes).toBe(outcome === "lease" || outcome === "ledger" ? 2 : 0);
  }
});
test("forwarded and automated mail is terminally skipped before provider I/O", async () => {
  for (const headers of [
    { "x-hasna-forwarded-for": "other" },
    { "X-Hasna-Inbound-Id": "old" },
    { "Auto-Submitted": "auto-generated" },
  ]) {
    const input = claim();
    input.snapshot.message.headers = headers;
    const result = await runForwardingBatch(
      {
        claimForwarding: async () => [input],
        finishForwarding: async () => true,
      },
      async () => {
        throw new Error("must not send");
      },
    );
    expect(result).toMatchObject({ skipped: 1, pending: 0 });
  }
});
test("forwarding rule and run selectors reject invalid or unsupported data", () => {
  expect(
    normalizeForwardingRule(
      {
        source_address: "Source@Example.test",
        target_address: "other@example.test",
      },
      true,
    ),
  ).toMatchObject({ source_address: "source@example.test", enabled: true });
  expect(() =>
    normalizeForwardingRule(
      {
        source_address: "same@example.test",
        target_address: "same@example.test",
      },
      true,
    ),
  ).toThrow("must differ");
  expect(() => normalizeForwardingOptions({ provider_id: " " })).toThrow(
    "nonempty",
  );
  expect(() => normalizeForwardingOptions({ limit: 0 })).toThrow("integer");
  expect(() => normalizeForwardingRule({ enabled: "false" }, false)).toThrow(
    "boolean",
  );
});

test("HTML-only forwarding preserves visible content and stored attachments", async () => {
  const input = claim();
  input.snapshot.message.body_text = " ";
  input.snapshot.message.body_html = '<p>Invoice &amp; receipt</p><script>do not copy</script>';
  input.snapshot.message.attachments = [{ filename: "invoice.txt", content_type: "text/plain", size: 7, content_base64: Buffer.from("invoice").toString("base64") }];
  let sent: Record<string, unknown> | undefined;
  const result = await runForwardingBatch({ claimForwarding: async () => [input], finishForwarding: async () => true }, async body => {
    sent = body;
    return Response.json({ sent: true, message: { id: "copy", send_state: "sent", provider_message_id: "proof" } }, { status: 202 });
  });
  expect(result.sent).toBe(1);
  expect(sent!.text).toContain("Invoice & receipt");
  expect(sent!.html).toContain("Invoice &amp; receipt");
  expect(sent!.text).not.toContain("do not copy");
  expect(sent!.attachments).toEqual([{ filename: "invoice.txt", content_type: "text/plain", content: Buffer.from("invoice").toString("base64") }]);
});

test("missing, malformed and excessive attachments refuse forwarding before I/O", async () => {
  for (const attachments of [
    [{ filename: "missing.txt", content_type: "text/plain", size: 1 }],
    [{ filename: "invalid.txt", content_type: "text/plain", size: 1, content_base64: "not base64" }],
    Array.from({ length: 6 }, () => ({ filename: "extra.txt", content_type: "text/plain", size: 1, content_base64: "YQ==" })),
    [{ forwarding_content_oversize: true }],
    [{ filename: "oversize.txt", content_type: "text/plain", size: 11 * 1024 * 1024, content_base64: "YQ==" }],
  ]) {
    const input = claim();
    input.snapshot.message.attachments = attachments;
    let calls = 0;
    const result = await runForwardingBatch({ claimForwarding: async () => [input], finishForwarding: async () => true }, async () => { calls++; throw new Error("must not send"); });
    expect(calls).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.items[0]!.error).toContain("Forwarding");
  }
});

test("unknown successful HTTP receipts remain pending until reconciled", async () => {
  let finishes = 0;
  const result = await runForwardingBatch({ claimForwarding: async () => [claim()], finishForwarding: async () => { finishes++; return true; } }, async () => Response.json({ message: { id: "unknown" } }));
  expect(result.pending).toBe(1);
  expect(finishes).toBe(0);
});


test("total attachment byte cap refuses otherwise valid files before a forwarding send", async () => {
  const input = claim();
  const content = Buffer.alloc(8 * 1024 * 1024).toString("base64");
  input.snapshot.message.attachments = Array.from({length:3}, () => ({filename:"large.bin",content_type:"application/octet-stream",size:8*1024*1024,content_base64:content}));
  let sent = false;
  const result = await runForwardingBatch({claimForwarding:async()=>[input],finishForwarding:async()=>true},async()=>{sent=true;throw new Error("must not send");});
  expect(sent).toBe(false);
  expect(result.failed).toBe(1);
  expect(result.items[0]!.error).toContain("send limits");
});
