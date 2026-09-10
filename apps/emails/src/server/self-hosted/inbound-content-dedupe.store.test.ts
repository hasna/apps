// Store-level coverage for the inbound content fence (BUG-0050).
//
// The SES→S3 ingest fence keys on the S3 OBJECT. SES mints a fresh message id — and so
// a fresh archived object — for every recipient group it delivers to and for every
// redelivery, so one KPMG reply to Beep Media's payroll thread was archived as three
// objects and stored as three distinct, independently enumerable rows. These cases pin
// what `createInboundMessageWithProvenance` must now answer for the SECOND object of a
// message the tenant already holds: adopt the row, never insert a second one, and union
// the envelope recipients into it so no mailbox the tenant was routed for is lost.
//
// Uses a small purpose-built in-memory client that emulates ONLY the specific queries
// this method issues, so the real branching/merging logic is exercised without a live
// Postgres — the same shape as send-keys.store.test.ts.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { PoolQueryClient, TypedQueryClient } from "../../storage-kit/index.js";
import { EmailsSelfHostedStore, type MessageInput } from "./store.js";

const TENANT = "00000000-0000-0000-0000-000000000001";
const BUCKET = "emails-inbound-fixture";
const RFC_MESSAGE_ID = "<AM0P138MB0197CAD42D6553A78684E1B1D4BF2@AM0P138MB0197.EURP138.PROD.OUTLOOK.COM>";
const RECEIVED_AT = "2026-09-10T07:31:42.000Z";
const RAW_SHA256 = createHash("sha256").update("raw-object-bytes").digest("hex");

type Row = Record<string, unknown>;

/** The exact normalization the SQL does: `lower(btrim(value, '<>'))`. */
function canonicalHeaderId(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/^[<>]+|[<>]+$/g, "");
}

function identityClient() {
  const rows: Row[] = [];
  const lookups: string[] = [];
  let inserts = 0;

  const rowFromInsert = (p: readonly unknown[]): Row => ({
    id: p[0],
    direction: p[1],
    from_addr: p[2],
    to_addrs: JSON.parse(String(p[3])),
    cc_addrs: JSON.parse(String(p[4])),
    subject: p[5] ?? null,
    body_text: p[6] ?? null,
    body_html: p[7] ?? null,
    status: p[8],
    provider_message_id: p[9] ?? null,
    message_id: p[10] ?? null,
    in_reply_to: p[11] ?? null,
    received_at: p[12] ?? null,
    is_read: p[13] ?? false,
    is_starred: p[14] ?? false,
    labels: JSON.parse(String(p[15])),
    headers: JSON.parse(String(p[16])),
    attachments: JSON.parse(String(p[17])),
    source_id: p[18] ?? null,
    idempotency_key: p[19] ?? null,
    send_payload_hash: p[20] ?? null,
    send_state: p[21] ?? "none",
    send_started_at: p[22] ?? null,
    provider_id: p[23] ?? null,
    tags: p[24] === null || p[24] === undefined ? null : JSON.parse(String(p[24])),
    created_at: "2026-09-10T07:31:53.815Z",
    updated_at: "2026-09-10T07:31:53.815Z",
  });

  const client = {
    async query() { throw new Error("query() not emulated"); },
    async many() { return []; },
    async one<T>(sql: string, params: readonly unknown[] = []): Promise<T> {
      return (await this.get<T>(sql, params)) as unknown as T;
    },
    async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
      const p = params;
      if (/INSERT INTO messages/i.test(sql)) {
        const existing = rows.find((row) => row["source_id"] === p[18]);
        if (existing) return null as unknown as T;
        const row = rowFromInsert(p);
        rows.push(row);
        inserts += 1;
        return row as unknown as T;
      }
      if (/FROM messages[\s\S]*direction = 'inbound'[\s\S]*FOR UPDATE/i.test(sql)) {
        lookups.push(sql);
        const found = rows.find((row) =>
          row["direction"] === "inbound"
          && canonicalHeaderId((row["headers"] as Record<string, unknown> | undefined)?.["message-id"]) === String(p[1])
          && String(row["from_addr"] ?? "").toLowerCase() === String(p[2])
          && String(row["subject"] ?? "") === String(p[3])
          && String(row["received_at"] ?? "") === String(p[4] ?? ""));
        return (found ? { ...found } : null) as unknown as T | null;
      }
      if (/FROM messages[\s\S]*source_id = \$2/i.test(sql)) {
        const found = rows.find((row) => row["source_id"] === p[1] && row["id"] !== undefined);
        return (found ? { ...found } : null) as unknown as T | null;
      }
      if (/FROM messages WHERE id = \$1 AND tenant_id = \$2/i.test(sql)) {
        const found = rows.find((row) => row["id"] === p[0]);
        return (found ? { ...found } : null) as unknown as T | null;
      }
      if (/INSERT INTO inbound_message_sources/i.test(sql)) {
        return { tenant_id: TENANT, message_id: p[1], bucket: p[2], object_key: p[3], raw_sha256: p[4], established_via: p[5] } as unknown as T;
      }
      if (/FROM mailbox_filters/i.test(sql)) return null as unknown as T | null;
      throw new Error(`get() not emulated: ${sql}`);
    },
    async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
      if (/set_config|pg_advisory_xact_lock/i.test(sql)) return;
      if (/UPDATE messages SET to_addrs/i.test(sql)) {
        const row = rows.find((candidate) => candidate["id"] === params[2]);
        if (row) row["to_addrs"] = JSON.parse(String(params[0]));
        return;
      }
      if (/INSERT INTO inbound_message_sources/i.test(sql)) return;
      throw new Error(`execute() not emulated: ${sql}`);
    },
  } as unknown as TypedQueryClient & PoolQueryClient;

  return {
    client: {
      ...client,
      async transaction<T>(fn: (tx: TypedQueryClient) => Promise<T>): Promise<T> {
        return fn(client);
      },
    } as unknown as PoolQueryClient,
    rows,
    insertCount: () => inserts,
    lookups,
  };
}

function inboundInput(overrides: Partial<MessageInput> = {}): MessageInput {
  return {
    from_addr: '"Turlea, Alina" <alinaturlea@kpmg.com>',
    to_addrs: ["andrew@example.test"],
    subject: "RE: Beep Media SRL — Diana Hasna",
    direction: "inbound",
    status: "received",
    headers: { "message-id": RFC_MESSAGE_ID },
    received_at: RECEIVED_AT,
    source_id: "inbound/example.test/first-object",
    message_id: "inbound/example.test/first-object",
    ...overrides,
  };
}

const provenance = (objectKey: string) => ({ bucket: BUCKET, objectKey, rawSha256: RAW_SHA256, establishedVia: "normal_ingest" as const });

describe("createInboundMessageWithProvenance content fence", () => {
  test("a second object of one message adopts the row instead of inserting a duplicate", async () => {
    const { client, rows, insertCount } = identityClient();
    const store = new EmailsSelfHostedStore(client).forTenant(TENANT);

    const first = await store.createInboundMessageWithProvenance(
      inboundInput(),
      provenance("inbound/example.test/first-object"),
    );
    expect(first.inserted).toBe(true);
    expect(insertCount()).toBe(1);

    const second = await store.createInboundMessageWithProvenance(
      inboundInput({ source_id: "inbound/example.test/second-object", message_id: "inbound/example.test/second-object" }),
      provenance("inbound/example.test/second-object"),
    );

    expect(second.inserted).toBe(false);
    expect(second.provenance).toBe("existing_match");
    expect(second.record.id).toBe(first.record.id);
    expect(insertCount()).toBe(1);
    expect(rows).toHaveLength(1);
  });

  test("adopting a redelivery keeps every envelope recipient the tenant was routed for", async () => {
    const { client, rows } = identityClient();
    const store = new EmailsSelfHostedStore(client).forTenant(TENANT);

    const first = await store.createInboundMessageWithProvenance(
      inboundInput({ to_addrs: ["accounting@example.test", "payroll@example.test"] }),
      provenance("inbound/example.test/first-object"),
    );
    const second = await store.createInboundMessageWithProvenance(
      inboundInput({
        to_addrs: ["andrew@example.test"],
        source_id: "inbound/example.test/third-object",
        message_id: "inbound/example.test/third-object",
      }),
      provenance("inbound/example.test/third-object"),
    );

    expect(second.inserted).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.to_addrs).toEqual([
      "accounting@example.test",
      "payroll@example.test",
      "andrew@example.test",
    ]);
    expect(rows[0]?.["to_addrs"]).toEqual([
      "accounting@example.test",
      "payroll@example.test",
      "andrew@example.test",
    ]);
  });

  test("same Message-ID with different content is NOT collapsed", async () => {
    const { client, insertCount } = identityClient();
    const store = new EmailsSelfHostedStore(client).forTenant(TENANT);

    await store.createInboundMessageWithProvenance(inboundInput(), provenance("inbound/example.test/first-object"));
    const edited = await store.createInboundMessageWithProvenance(
      inboundInput({
        subject: "RE: Beep Media SRL — Diana Hasna (corrected)",
        source_id: "inbound/example.test/fourth-object",
        message_id: "inbound/example.test/fourth-object",
      }),
      provenance("inbound/example.test/fourth-object"),
    );

    expect(edited.inserted).toBe(true);
    expect(insertCount()).toBe(2);
  });

  test("mail with no Message-ID keeps the previous insert-only behaviour", async () => {
    const { client, insertCount, rows } = identityClient();
    const store = new EmailsSelfHostedStore(client).forTenant(TENANT);

    await store.createInboundMessageWithProvenance(
      inboundInput({
        headers: { subject: "no identity" },
        source_id: "inbound/example.test/fifth-object",
        message_id: "inbound/example.test/fifth-object",
      }),
      provenance("inbound/example.test/fifth-object"),
    );
    const again = await store.createInboundMessageWithProvenance(
      inboundInput({
        headers: { subject: "no identity" },
        source_id: "inbound/example.test/sixth-object",
        message_id: "inbound/example.test/sixth-object",
      }),
      provenance("inbound/example.test/sixth-object"),
    );

    expect(again.inserted).toBe(true);
    expect(insertCount()).toBe(2);
    expect(rows).toHaveLength(2);
  });

  test("a replay of the SAME object is still the source-key duplicate it always was", async () => {
    const { client, insertCount } = identityClient();
    const store = new EmailsSelfHostedStore(client).forTenant(TENANT);

    const first = await store.createInboundMessageWithProvenance(inboundInput(), provenance("inbound/example.test/first-object"));
    const replay = await store.createInboundMessageWithProvenance(inboundInput(), provenance("inbound/example.test/first-object"));

    expect(replay.inserted).toBe(false);
    expect(replay.record.id).toBe(first.record.id);
    expect(insertCount()).toBe(1);
  });

  test("the identity lookup keeps the clauses migration 0042's index needs to be used", async () => {
    const { client, lookups } = identityClient();
    const store = new EmailsSelfHostedStore(client).forTenant(TENANT);

    await store.createInboundMessageWithProvenance(inboundInput(), provenance("inbound/example.test/first-object"));

    expect(lookups).toHaveLength(1);
    const lookup = lookups[0]!;
    // A partial expression index is used only when the planner can prove its predicate
    // from the query's WHERE clause AND the compared expression matches, and neither is
    // visible in the row the query returns. Migration 0042's predicate is
    // `direction = 'inbound' AND headers->>'message-id' IS NOT NULL`, so this lookup must
    // carry BOTH of those tests (the planner cannot derive the `IS NOT NULL` from the
    // `COALESCE(...)` equality), and must compare the index's exact normalisation. Drop
    // or reword either half and the ingest still answers correctly, but silently reverts
    // to a Seq Scan plus Sort of the tenant's mail on every object — the cost 0042 exists
    // to prevent.
    expect(lookup).toContain("direction = 'inbound'");
    expect(lookup).toContain("headers->>'message-id' IS NOT NULL");
    expect(lookup).toContain("lower(btrim(COALESCE(headers->>'message-id', ''), '<>')) = $2");
  });
});

