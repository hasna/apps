import { expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import {
  handleSelfHostedRequest,
  type SelfHostedServiceDeps,
} from "./service.js";
import { selfScopedStore, testAuthDeps } from "./auth/test-support.js";
import type { TypedQueryClient } from "../../storage-kit/index.js";
import type { ForwardingClaim } from "./forwarding.js";
const signingSecret = crypto.randomUUID();
function fixture() {
  const client = {
    query: async () => ({ rows: [], rowCount: 0 }),
    many: async () => [],
    get: async () => null,
    one: async () => ({}),
    execute: async () => {},
  } as TypedQueryClient;
  const store = selfScopedStore(client);
  const calls: any[] = [],
    finished: any[] = [],
    reservations: any[] = [];
  let claims = 0,
    writes = 0,
    delivered = false;
  const claim: ForwardingClaim = {
    rule_id: "rule-fixture",
    message_id: "inbound-fixture",
    lease: crypto.randomUUID(),
    snapshot: {
      rule: {
        source_address: "source@example.com",
        target_address: "target@example.com",
        mode: "app-copy",
      },
      message: {
        from_addr: "original@example.com",
        subject: "Fixture",
        body_text: "",
        body_html: "<p>Original &lt;script&gt;</p>",
        attachments: [{ filename: "invoice.txt", content_type: "text/plain", size: 7, content_base64: Buffer.from("invoice").toString("base64") }],
        headers: {},
      },
      options: {},
    },
  };
  const record = {
    id: "outbound-fixture",
    send_state: "pending",
    status: "pending",
    headers: {},
    from_addr: "source@example.com",
    to_addrs: ["target@example.com"],
    subject: "Fixture",
    attachments: [],
  };
  Object.assign(store, {
    claimForwarding: async () => {
      claims++;
      return [claim];
    },
    finishForwarding: async (...args: any[]) => {
      finished.push(args);
      return true;
    },
    createResource: async () => {
      writes++;
      return {};
    },
    updateResource: async () => {
      writes++;
      return {};
    },
    deleteResource: async () => {
      writes++;
      return true;
    },
    reserveSendIntent: async (input: any) => {
      reservations.push(input);
      return {
        record: delivered
          ? { ...record, send_state: "sent", provider_message_id: "proof" }
          : record,
        created: !delivered,
      };
    },
    evaluateOutboundPolicy: async () => ({ allowed: true }),
    claimSendIntent: async () => ({ ...record, send_state: "sending" }),
    getAddressByEmail: async () => null,
    completeSendIntent: async () => {
      delivered = true;
      return {
        ...record,
        send_state: "sent",
        status: "sent",
        provider_message_id: "proof",
      };
    },
  });
  const sender = {
    provider: "resend" as const,
    send: async (input: any) => {
      calls.push(input);
      return "proof";
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
    resolveSender: () => sender,
    migrations: [],
    version: "fixture",
    ...testAuthDeps(client, signingSecret),
  } as SelfHostedServiceDeps;
  return {
    deps,
    calls,
    finished,
    reservations,
    counts: () => ({ claims, writes }),
  };
}
function request(
  path: string,
  body: unknown = {},
  scopes = ["emails:*"],
  method = "POST",
) {
  return new Request(`http://fixture/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": mintApiKey({ app: "emails", scopes, signingSecret }).token,
    },
    ...(method !== "DELETE" ? { body: JSON.stringify(body) } : {}),
  });
}
test("forwarding runs the actual authenticated send handler and replays its durable 202 receipt once", async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) {
    const response = await handleSelfHostedRequest(
      f.deps,
      request("forwarding/run"),
    );
    expect(response!.status).toBe(200);
    expect(await response!.json()).toMatchObject({
      attempted: 1,
      sent: 1,
      pending: 0,
    });
  }
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toMatchObject({
    from: "source@example.com",
    to: ["target@example.com"],
    headers: {
      "X-Hasna-Forwarded-For": "source@example.com",
      "X-Hasna-Inbound-Id": "inbound-fixture",
      "Auto-Submitted": "auto-generated",
    },
  });
  expect(f.calls[0].html).toContain("&lt;script&gt;");
  expect(f.calls[0].attachments).toEqual([{ filename: "invoice.txt", content_type: "text/plain", content: Buffer.from("invoice").toString("base64") }]);
  expect(f.reservations.map((r) => r.idempotency_key)).toEqual([
    "forward:rule-fixture:inbound-fixture",
    "forward:rule-fixture:inbound-fixture",
  ]);
  expect(f.reservations[0].send_payload_hash).toBe(
    f.reservations[1].send_payload_hash,
  );
  expect(f.finished.map((row) => row[1])).toEqual(["sent", "sent"]);
});
test("nonoperators cannot create, edit, delete, or run automatic forwarding through either alias", async () => {
  const f = fixture();
  for (const route of ["forwarding"]) {
    for (const [path, method] of [
      [route, "POST"],
      [`${route}/fixture`, "PATCH"],
      [`${route}/fixture`, "PUT"],
      [`${route}/fixture`, "DELETE"],
      [`${route}/run`, "POST"],
    ]) {
      const response = await handleSelfHostedRequest(
        f.deps,
        request(path!, {}, ["emails:write"], method),
      );
      expect(response!.status).toBe(403);
    }
  }
  expect(
    (await handleSelfHostedRequest(
      f.deps,
      request("forwarding-rules/run", {}, ["emails:write"]),
    ))!.status,
  ).toBe(403);
  expect(f.counts()).toEqual({ claims: 0, writes: 0 });
  expect(f.calls).toEqual([]);
});
test("external send fields cannot inject the internal forwarding headers", async () => {
  const f = fixture();
  const response = await handleSelfHostedRequest(
    f.deps,
    request("messages/send", {
      from: "source@example.com",
      to: ["target@example.com"],
      subject: "Fixture",
      text: "Body",
      idempotency_key: "external",
      headers: { "X-Hasna-Forwarded-For": "forged", Bcc: "hidden@example.com" },
    }),
  );
  expect(response!.status).toBe(202);
  expect(f.calls[0].headers).toBeUndefined();
});
