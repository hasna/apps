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
