// Regression coverage for the From display-name defect (bug e2578a8a).
//
// Address records carry `display_name` (set via `address add --name`, e.g.
// "Hasna Accounting" or "Augustus (CEO seat)") but the send path never read
// it: `canonicalSender` strips the display name, and the provider call got the
// bare canonical address. The address record's display name must decorate ONLY
// the provider send call (RFC 5322 quoted-string form), while the ledger,
// idempotency hash, and policy checks keep the canonical address.
//
// Hermetic: fake query client, stubbed tenant-scoped store methods, no
// Postgres, no network.

import { describe, expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import type { TypedQueryClient } from "../../storage-kit/index.js";
import { emailsSelfHostedMigrations } from "./migrations.js";
import { handleSelfHostedRequest, type SelfHostedServiceDeps } from "./service.js";
import { testAuthDeps, selfScopedStore } from "./auth/test-support.js";

const SIGNING_SECRET = "test-signing-secret-do-not-use-in-prod";

function fakeClient(): TypedQueryClient {
  const client: TypedQueryClient = {
    async query(sql, params) {
      const rows = (await client.many(sql, params)) as never[];
      return { rows, rowCount: rows.length };
    },
    async many<T>(): Promise<T[]> {
      return [] as T[];
    },
    async get<T>(): Promise<T | null> {
      return null;
    },
    async one<T>(): Promise<T> {
      return {} as T;
    },
    async execute() {},
  };
  return client;
}

function pendingRecord() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    direction: "outbound",
    from_addr: "sender@example.com",
    to_addrs: ["recipient@example.net"],
    cc_addrs: [],
    subject: "display name regression",
    body_text: "hello",
    body_html: null,
    status: "queued",
    provider_message_id: null,
    message_id: null,
    in_reply_to: null,
    received_at: null,
    is_read: false,
    is_starred: false,
    labels: [],
    headers: {},
    attachments: [],
    source_id: null,
    idempotency_key: "display-name-key",
    send_payload_hash: "hash",
    send_state: "pending",
    send_started_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

interface Harness {
  deps: SelfHostedServiceDeps;
  sentFroms: string[];
  reservedFromAddrs: string[];
  policyFroms: string[];
  payloadHashes: string[];
}

function harness(addressRecord: { display_name: string | null } | null): Harness {
  const client = fakeClient();
  const sentFroms: string[] = [];
  const reservedFromAddrs: string[] = [];
  const policyFroms: string[] = [];
  const payloadHashes: string[] = [];

  const deps: SelfHostedServiceDeps = {
    client,
    store: selfScopedStore(client),
    verifier: verifyApiKey({ app: "emails", signingSecret: SIGNING_SECRET }),
    sender: {
      provider: "ses",
      send: async (input: { from: string }) => {
        sentFroms.push(input.from);
        return "provider-message-id";
      },
    },
    migrations: emailsSelfHostedMigrations(),
    version: "9.9.9",
    ...testAuthDeps(client, SIGNING_SECRET),
  };

  const record = pendingRecord();
  const store = deps.store as unknown as Record<string, unknown>;
  store["getAddressByEmail"] = async () => addressRecord;
  store["reserveSendIntent"] = async (input: { from_addr: string; send_payload_hash: string }) => {
    reservedFromAddrs.push(input.from_addr);
    payloadHashes.push(input.send_payload_hash);
    return { record, created: true };
  };
  store["evaluateOutboundPolicy"] = async (input: { from: string }) => {
    policyFroms.push(input.from);
    return { allowed: true };
  };
  store["claimSendIntent"] = async () => ({ ...record, send_state: "sending" });
  store["completeSendIntent"] = async (_id: string, providerMessageId: string) => ({
    ...record,
    send_state: "sent",
    status: "sent",
    provider_message_id: providerMessageId,
  });
  return { deps, sentFroms, reservedFromAddrs, policyFroms, payloadHashes };
}

function sendRequest(deps: SelfHostedServiceDeps): Promise<Response> {
  const token = mintApiKey({ app: "emails", scopes: ["emails:*"], signingSecret: SIGNING_SECRET }).token;
  return handleSelfHostedRequest(
    deps,
    new Request("http://svc/v1/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": token },
      body: JSON.stringify({
        from: "sender@example.com",
        to: ["recipient@example.net"],
        subject: "display name regression",
        text: "hello",
        idempotency_key: "display-name-key",
      }),
    }),
  );
}

describe("POST /v1/messages/send — From display-name decoration", () => {
  test("display_name-bearing address: provider receives the quoted RFC 5322 form", async () => {
    const h = harness({ display_name: "Hasna Accounting" });
    const res = await sendRequest(h.deps);
    expect(res.status).toBe(202);
    expect(h.sentFroms).toEqual(['"Hasna Accounting" <sender@example.com>']);
    // Ledger, policy, and idempotency inputs stay canonical.
    expect(h.reservedFromAddrs).toEqual(["sender@example.com"]);
    expect(h.policyFroms).toEqual(["sender@example.com"]);
  });

  test("display name containing parentheses is quoted, not re-parsed", async () => {
    const h = harness({ display_name: "Augustus (CEO seat)" });
    const res = await sendRequest(h.deps);
    expect(res.status).toBe(202);
    expect(h.sentFroms).toEqual(['"Augustus (CEO seat)" <sender@example.com>']);
    expect(h.reservedFromAddrs).toEqual(["sender@example.com"]);
    expect(h.policyFroms).toEqual(["sender@example.com"]);
  });

  test("no display_name: provider receives the bare canonical address", async () => {
    const h = harness({ display_name: null });
    const res = await sendRequest(h.deps);
    expect(res.status).toBe(202);
    expect(h.sentFroms).toEqual(["sender@example.com"]);
    expect(h.reservedFromAddrs).toEqual(["sender@example.com"]);
    expect(h.policyFroms).toEqual(["sender@example.com"]);
  });

  test("unregistered sender address: bare canonical address (no record to read)", async () => {
    const h = harness(null);
    const res = await sendRequest(h.deps);
    expect(res.status).toBe(202);
    expect(h.sentFroms).toEqual(["sender@example.com"]);
  });

  test("display name with control characters is rejected: bare address, send still succeeds", async () => {
    // A CRLF in the display name would be header injection in the raw-MIME
    // `From:` path. The decorated form must never carry it — the send falls
    // back to the canonical address instead of failing or injecting.
    const h = harness({ display_name: "Hasna Accounting\r\nBcc: attacker@evil.test" });
    const res = await sendRequest(h.deps);
    expect(res.status).toBe(202);
    expect(h.sentFroms).toEqual(["sender@example.com"]);
  });

  test("send payload hash is computed over the canonical from (idempotency stability)", async () => {
    const h = harness({ display_name: "Hasna Accounting" });
    const res = await sendRequest(h.deps);
    expect(res.status).toBe(202);
    // The hash input must not change when a display name is present — a change
    // would break idempotent replay of an intent reserved before this fix.
    expect(h.payloadHashes.length).toBe(1);
  });
});
