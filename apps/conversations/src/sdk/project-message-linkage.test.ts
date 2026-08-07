import { describe, expect, test } from "bun:test";
import { ConversationsClient } from "./index.js";

describe("generated SDK project-message linkage contract", () => {
  test("sends exact guarded apply and rollback bodies to the stable routes", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const client = new ConversationsClient({
      baseUrl: "https://conversations.example.invalid",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(input),
          method: String(init?.method),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });

    await client.applyChannelProjectMessageLinkage("Dubai Fraud", {
      project_id: "1217f372-08e4-4217-aaf0-1ace5232982f",
      apply: true,
      expected_revision: "revision-one",
      idempotency_key: "apply-one",
    });
    await client.rollbackChannelProjectMessageLinkage({
      receipt_id: "receipt-one",
      expected_revision: "revision-two",
      idempotency_key: "rollback-one",
      apply: false,
    });

    expect(new URL(calls[0].url).pathname).toBe("/v1/channels/Dubai%20Fraud/project-message-linkage");
    expect(calls[0]).toMatchObject({
      method: "POST",
      body: {
        project_id: "1217f372-08e4-4217-aaf0-1ace5232982f",
        apply: true,
        expected_revision: "revision-one",
        idempotency_key: "apply-one",
      },
    });
    expect(new URL(calls[1].url).pathname).toBe("/v1/channels/project-message-linkage/rollback");
    expect(calls[1]).toMatchObject({
      method: "POST",
      body: {
        receipt_id: "receipt-one",
        expected_revision: "revision-two",
        idempotency_key: "rollback-one",
        apply: false,
      },
    });
  });
});
