// The seam's `received_at` on a read record is never null (BUG-0043), asserted on the
// PostgreSQL arm hermetically.
//
// WHY THIS FILE EXISTS SEPARATELY from the Postgres integration run, the same reason
// message-record-route.test.ts does: the integration suite only executes when a database
// is reachable, so a property of the mapper cannot rest on it alone. The defect is a
// property of `mapMessageRow` and of the row shape it is handed, so a fake query client
// reproduces it without a server.
//
// THE DEFECT. An outbound row stores no `received_at` — nothing was received — and the
// column every list is ordered by, `sort_ts`, is `COALESCE(received_at, created_at)` by
// construction (migration 0019). The record handed the raw column instead, so
// `GET /v1/messages?folder=sent` answered null for every sent message while the row's own
// ordering key said otherwise. A caller windowing on `received_at` could not tell
// "outside the window" from "no timestamp": 13,526 rows came back in window of which
// 805 sent rows were all out of it, and the re-run with `COALESCE(received_at, created_at)`
// answered 12,721 with 21 sent — a silent miscount in both directions, with no error to
// notice. The mapper now reports the instant the row is ordered by.

import { describe, expect, test } from "bun:test";
import type { TypedQueryClient } from "../../storage-kit/index.js";
import { EmailsSelfHostedStore } from "./store.js";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const CREATED_AT = "2026-01-05T08:00:00.000Z";
const STORED_RECEIVED_AT = "2026-01-03T07:30:00.000Z";

/**
 * A row shaped like `messages`, with the columns the record and list projections select
 * (MESSAGE_COLUMNS / MESSAGE_LIST_COLUMNS). `received_at` is null unless a caller says
 * otherwise, because that is the shape an outbound row is stored in.
 */
function messageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    direction: "outbound",
    from_addr: "sender@example.test",
    to_addrs: ["recipient@example.test"],
    cc_addrs: [],
    subject: "sent without a received_at",
    body_text: null,
    body_html: null,
    status: "sent",
    provider_id: null,
    tags: null,
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
    idempotency_key: null,
    send_payload_hash: null,
    send_state: "sent",
    send_started_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    snippet: "sent without a received_at",
    attachment_count: 0,
    policy_denial: null,
    cursor_ts: "2026-01-05T08:00:00.000000Z",
    ...overrides,
  };
}

/** The real store over a fake client that answers every `messages` read with `row`. */
function storeReturning(row: Record<string, unknown>): EmailsSelfHostedStore {
  const client: TypedQueryClient = {
    async query(sql, params) {
      const rows = (await client.many(sql, params)) as never[];
      return { rows, rowCount: rows.length };
    },
    async many<T>(sql: string): Promise<T[]> {
      return (sql.includes("FROM messages") ? [row] : []) as unknown as T[];
    },
    async get<T>(sql: string): Promise<T | null> {
      return (sql.includes("FROM messages") ? row : null) as unknown as T;
    },
    async one<T>(): Promise<T> {
      return row as unknown as T;
    },
    async execute() {},
  };
  return new EmailsSelfHostedStore(client, { allowUnsafeTestTransactions: true }).forTenant(TENANT_ID);
}

describe("an outbound record's received_at is its effective timestamp (BUG-0043)", () => {
  test("a row stored with a null received_at reads back timestamped by created_at, not null", async () => {
    const record = await storeReturning(messageRow()).getMessage("11111111-1111-4111-8111-111111111111");

    expect(record).not.toBeNull();
    // The property the defect violated. `null` is what every received_at-anchored window
    // dropped silently; it must never be what this read answers.
    expect(record!.received_at).not.toBeNull();
    expect(record!.received_at).toBe(record!.created_at);
    expect(record!.received_at).toBe(CREATED_AT);
  });

  test("the sent-folder LIST answers the same non-null timestamp as the record", async () => {
    const page = await storeReturning(messageRow()).listMessages({ folder: "sent", limit: 50 });

    expect(page.items.length).toBe(1);
    expect(page.items[0]!.received_at).not.toBeNull();
    expect(page.items[0]!.received_at).toBe(CREATED_AT);
  });

  test("a stored received_at is never overwritten by the fallback", async () => {
    // The fallback is a floor, not a replacement: a row that carries a real instant keeps
    // it, so the fix cannot re-date an imported or inbound message.
    const record = await storeReturning(messageRow({ received_at: STORED_RECEIVED_AT })).getMessage(
      "11111111-1111-4111-8111-111111111111",
    );

    expect(record!.received_at).toBe(STORED_RECEIVED_AT);
  });

  test("an inbound row with a null received_at is timestamped too", async () => {
    // The record-level rule is per ROW, not per direction: a row whose stored instant is
    // missing is still ordered by created_at, so that is what the record reports.
    const record = await storeReturning(messageRow({ direction: "inbound" })).getMessage(
      "11111111-1111-4111-8111-111111111111",
    );

    expect(record!.direction).toBe("inbound");
    expect(record!.received_at).toBe(record!.created_at);
  });
});
