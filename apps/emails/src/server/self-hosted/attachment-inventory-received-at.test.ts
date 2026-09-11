// The attachment inventory's `received_at` is never null (BUG-0053), asserted on the
// PostgreSQL arm hermetically.
//
// WHY THIS FILE EXISTS SEPARATELY from the Postgres integration run, the same reason
// message-received-at.test.ts does: the integration suite only executes when a database
// is reachable, so a property of the mapper cannot rest on it alone. The defect is a
// property of `mapAttachmentInventoryRow` and of the row shape it is handed, so a fake
// query client reproduces it without a server.
//
// THE DEFECT. BUG-0043 ruled that a read record's `received_at` is the instant the row is
// ORDERED by, never the raw column: an outbound row stores no `received_at` — nothing was
// received — while every list is ordered by `sort_ts` = COALESCE(received_at, created_at).
// That rule was applied to the message-record mappers and to the SQLite stream, and the
// attachment-inventory projection was left as the odd one out. Its SQL still selected the
// raw column, and the mapper still answered `toIso(row["received_at"])` with no fallback,
// so an outbound message carrying attachment metadata answered `received_at: null` through
// the inventory even though the cursor it was emitted under was cut from a real instant.
// A consumer anchoring a window filter on `received_at` over that surface dropped those
// rows silently — the identical failure mode, on an adjacent surface, with no error to
// notice. The mapper now reports the instant the scan is ordered by.

import { describe, expect, test } from "bun:test";
import type { TypedQueryClient } from "../../storage-kit/index.js";
import { EmailsSelfHostedStore } from "./store.js";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const CREATED_AT = "2026-01-05T08:00:00.000Z";
const STORED_RECEIVED_AT = "2026-01-03T07:30:00.000Z";

/**
 * A row shaped like the attachment-inventory projection: `messages` expanded by a lateral
 * `jsonb_array_elements … WITH ORDINALITY`. `received_at` is null unless a caller says
 * otherwise, because that is the shape an outbound row is stored in.
 */
function inventoryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    message_id: "11111111-1111-4111-8111-111111111111",
    attachment_index: 0,
    filename: "invoice.pdf",
    filename_is_string: true,
    content_type: "application/pdf",
    content_type_is_string: true,
    size_raw: "128",
    sha256: null,
    content_available: false,
    direction: "outbound",
    received_at: null,
    created_at: CREATED_AT,
    cursor_ts: "2026-01-05T08:00:00.000000Z",
    ...overrides,
  };
}

/** The real store over a fake client that answers the inventory read with `row`. */
function storeReturning(row: Record<string, unknown>): EmailsSelfHostedStore {
  const client: TypedQueryClient = {
    async query(sql, params) {
      const rows = (await client.many(sql, params)) as never[];
      return { rows, rowCount: rows.length };
    },
    async many<T>(sql: string): Promise<T[]> {
      // The inventory query's FROM target is `messages`, aliased `m`.
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

describe("an outbound inventory row's received_at is its effective timestamp (BUG-0053)", () => {
  test("a row stored with a null received_at reads back timestamped by created_at, not null", async () => {
    const page = await storeReturning(inventoryRow()).listAttachments({ limit: 10 });

    expect(page.items.length).toBe(1);
    // The property the defect violated. `null` is what every received_at-anchored window
    // dropped silently; it must never be what this read answers.
    expect(page.items[0]!.received_at).not.toBeNull();
    expect(page.items[0]!.received_at).toBe(CREATED_AT);
    // And the direction the defect was reported through: outbound.
    expect(page.items[0]!.direction).toBe("outbound");
  });

  test("a stored received_at is never overwritten by the fallback", async () => {
    // The fallback is a floor, not a replacement: a row that carries a real instant keeps
    // it, so the fix cannot re-date an imported or inbound attachment.
    const page = await storeReturning(inventoryRow({ received_at: STORED_RECEIVED_AT })).listAttachments({
      limit: 10,
    });

    expect(page.items[0]!.received_at).toBe(STORED_RECEIVED_AT);
  });

  test("an inbound row with a null received_at is timestamped too", async () => {
    // The rule is per ROW, not per direction: a row whose stored instant is missing is
    // still ordered by created_at, so that is what the inventory reports.
    const page = await storeReturning(inventoryRow({ direction: "inbound" })).listAttachments({ limit: 10 });

    expect(page.items[0]!.direction).toBe("inbound");
    expect(page.items[0]!.received_at).toBe(CREATED_AT);
  });
});
