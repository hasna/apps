import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import { storeInboundEmail } from "./inbound.local.js";
import {
  applyMailboxFilter,
  createMailboxFilter,
  deleteMailboxFilter,
  getMailboxFilter,
  listMailboxFilters,
  updateMailboxFilter,
} from "./mailbox-filters.local.js";

let inheritedProcessEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  inheritedProcessEnv = { ...process.env };
  process.env.EMAILS_DB_PATH = ":memory:";
  process.env["HASNA_EMAILS_LOCAL"] = "1";
  resetDatabase();
});

afterEach(() => {
  closeDatabase();
  for (const key of Object.keys(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(inheritedProcessEnv, key)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, inheritedProcessEnv);
});

function seed(subject: string, receivedAt: string, unread = false) {
  const message = storeInboundEmail({
    provider_id: null,
    message_id: `<${crypto.randomUUID()}@example.test>`,
    in_reply_to_email_id: null,
    from_address: unread ? "support@example.test" : "other@example.test",
    to_addresses: ["owner@example.test"],
    cc_addresses: [],
    subject,
    text_body: subject,
    html_body: null,
    attachments: [],
    attachment_paths: [],
    headers: {},
    raw_size: subject.length,
    received_at: receivedAt,
  }, getDatabase());
  if (unread) return message;
  getDatabase().run("UPDATE inbound_emails SET is_read = 1 WHERE id = ?", [message.id]);
  return message;
}

function seedRaw(overrides: Partial<Parameters<typeof storeInboundEmail>[0]> & { subject: string }) {
  return storeInboundEmail({
    provider_id: null,
    message_id: `<${crypto.randomUUID()}@example.test>`,
    in_reply_to_email_id: null,
    from_address: "other@example.test",
    to_addresses: ["owner@example.test"],
    cc_addresses: [],
    text_body: overrides.subject,
    html_body: null,
    attachments: [],
    attachment_paths: [],
    headers: {},
    raw_size: overrides.subject.length,
    received_at: "2026-01-02T00:00:00.000Z",
    ...overrides,
  }, getDatabase());
}

describe("local saved mailbox filters", () => {
  it("persists canonical criteria, rejects normalized duplicate names, and removes by name", () => {
    const filter = createMailboxFilter({
      name: "Needs_Review",
      mailbox: "inbox",
      criteria: { from: " SUPPORT@EXAMPLE.TEST ", unread: true },
    });
    expect(filter.normalized_name).toBe("needs-review");
    expect(filter.criteria).toEqual({ from: "support@example.test", unread: true });
    expect(() => createMailboxFilter({ name: "needs review", mailbox: "inbox" })).toThrow(/already exists/);
    expect(getMailboxFilter("needs review")?.id).toBe(filter.id);
    expect(listMailboxFilters()).toHaveLength(1);
    deleteMailboxFilter("needs review");
    expect(getMailboxFilter(filter.id)).toBeNull();
  });

  it("returns only matching rows even when the newest row is a non-match", () => {
    seed("newer non-match", "2026-01-03T00:00:00.000Z", false);
    const match = seed("older match", "2026-01-02T00:00:00.000Z", true);
    const filter = createMailboxFilter({ name: "Unread", mailbox: "inbox", criteria: { unread: true } });
    const result = applyMailboxFilter(filter, { limit: 1, offset: 0 });
    expect(result.items.map((item) => item.id)).toEqual([match.id]);
    expect(result.truncated).toBe(false);
  });

  it("matches LIKE metacharacters in criteria values literally, like the self-hosted store", () => {
    const literal = seedRaw({ subject: "sale", from_address: "100%_off@example.test", to_addresses: ["owner@example.test"] });
    seedRaw({ subject: "sale", from_address: "100xoff@example.test", to_addresses: ["owner@example.test"] });
    seedRaw({ subject: "sale", from_address: "100%off@example.test", to_addresses: ["owner@example.test"] });

    const filter = createMailboxFilter({ name: "Sale", mailbox: "inbox", criteria: { from: "100%_off@example.test" } });
    const result = applyMailboxFilter(filter, { limit: 10 });
    expect(result.items.map((item) => item.id)).toEqual([literal.id]);

    const subjectFilter = createMailboxFilter({ name: "Subject", mailbox: "inbox", criteria: { subject: "50%_done" } });
    const subjectMatch = seedRaw({ subject: "50%_done", from_address: "a@example.test" });
    seedRaw({ subject: "50%done", from_address: "b@example.test" });
    const subjectResult = applyMailboxFilter(subjectFilter, { limit: 10 });
    expect(subjectResult.items.map((item) => item.id)).toEqual([subjectMatch.id]);
  });

  it("matches the to criterion by exact recipient address, never a partial address", () => {
    const exact = seedRaw({ subject: "exact recipient", from_address: "sender@example.test", to_addresses: ["owner@example.test"] });
    seedRaw({ subject: "other recipient", from_address: "sender@example.test", to_addresses: ["team@example.test"] });

    const exactFilter = createMailboxFilter({ name: "To exact", mailbox: "inbox", criteria: { to: "owner@example.test" } });
    expect(applyMailboxFilter(exactFilter, { limit: 10 }).items.map((item) => item.id)).toEqual([exact.id]);

    const partialFilter = createMailboxFilter({ name: "To partial", mailbox: "inbox", criteria: { to: "owner@exampl" } });
    expect(applyMailboxFilter(partialFilter, { limit: 10 }).items).toHaveLength(0);

    const domainFilter = createMailboxFilter({ name: "To domain", mailbox: "inbox", criteria: { to: "example.test" } });
    expect(applyMailboxFilter(domainFilter, { limit: 10 }).items).toHaveLength(0);
  });

  it("matches the address criterion by exact sender or exact recipient, never a partial address", () => {
    const recipientHit = seedRaw({ subject: "recipient hit", from_address: "sender@example.test", to_addresses: ["owner@example.test"], received_at: "2026-01-05T00:00:00.000Z" });
    const senderHit = seedRaw({ subject: "sender hit", from_address: "owner@example.test", to_addresses: ["someone@example.test"], received_at: "2026-01-04T00:00:00.000Z" });
    seedRaw({ subject: "unrelated", from_address: "other@example.test", to_addresses: ["x@example.test"], received_at: "2026-01-03T00:00:00.000Z" });

    const recipientFilter = createMailboxFilter({ name: "Addr recipient", mailbox: "inbox", criteria: { address: "owner@example.test" } });
    expect(applyMailboxFilter(recipientFilter, { limit: 10 }).items.map((item) => item.id)).toEqual([recipientHit.id, senderHit.id]);

    const partialFilter = createMailboxFilter({ name: "Addr partial", mailbox: "inbox", criteria: { address: "owner@exampl" } });
    expect(applyMailboxFilter(partialFilter, { limit: 10 }).items).toHaveLength(0);

    const domainFilter = createMailboxFilter({ name: "Addr domain", mailbox: "inbox", criteria: { address: "xample.test" } });
    expect(applyMailboxFilter(domainFilter, { limit: 10 }).items).toHaveLength(0);
  });
});

describe("local saved mailbox filter actions + enabled/order (FR-0001)", () => {
  function inboundState(id: string) {
    const row = getDatabase().query(
      "SELECT is_read, is_archived FROM inbound_emails WHERE id = ?",
    ).get(id) as { is_read: number; is_archived: number } | null;
    const labels = getDatabase().query(
      "SELECT label FROM inbound_labels WHERE inbound_email_id = ? ORDER BY label",
    ).all(id) as Array<{ label: string }>;
    return row ? { is_read: row.is_read === 1, is_archived: row.is_archived === 1, labels: labels.map((l) => l.label) } : null;
  }

  it("persists actions, enabled, and order and round-trips them through CRUD", () => {
    const created = createMailboxFilter({
      name: "Invoice archive",
      mailbox: "inbox",
      criteria: { from: "billing@example.com" },
      actions: { add_labels: ["Invoices", "invoices"], archive: true, mark_read: false },
      enabled: true,
      order: 2,
    });
    expect(created.actions).toEqual({ add_labels: ["invoices"], archive: true, mark_read: false });
    expect(created.enabled).toBe(true);
    expect(created.order).toBe(2);
    expect(getMailboxFilter(created.id)).toMatchObject({
      actions: { add_labels: ["invoices"], archive: true, mark_read: false },
      enabled: true,
      order: 2,
    });

    const list = listMailboxFilters();
    expect(list.find((f) => f.id === created.id)).toMatchObject({ enabled: true, order: 2 });

    // An older filter without the new fields comes back with safe defaults.
    getDatabase().run(
      "UPDATE mailbox_filters SET actions_json = '{}', enabled = 0, \"order\" = 0 WHERE id = ?",
      [created.id],
    );
    expect(getMailboxFilter(created.id)).toMatchObject({ actions: { add_labels: [], archive: false, mark_read: false }, enabled: false, order: 0 });
  });

  it("PATCH replaces top-level action members (the whole label list) and preserves omitted new fields", () => {
    const filter = createMailboxFilter({
      name: "Merge",
      mailbox: "inbox",
      enabled: true,
      order: 5,
      actions: { add_labels: ["invoices"], archive: true },
    });
    const patched = updateMailboxFilter(filter.id, { actions: { add_labels: ["receipts"], mark_read: true } });
    expect(patched.actions).toEqual({ add_labels: ["receipts"], archive: true, mark_read: true });
    expect(patched.enabled).toBe(true);
    expect(patched.order).toBe(5);
  });

  it("PUT replaces criteria and actions wholesale, normalizing omitted members", () => {
    const filter = createMailboxFilter({
      name: "Replace",
      mailbox: "inbox",
      actions: { add_labels: ["invoices"], archive: true, mark_read: true },
      enabled: true,
    });
    const replaced = updateMailboxFilter(filter.id, {
      name: "Replace",
      mailbox: "inbox",
      criteria: { from: "new@example.com" },
      actions: { add_labels: ["receipts"] },
    }, { replaceCriteria: true });
    expect(replaced.criteria).toEqual({ from: "new@example.com" });
    expect(replaced.actions).toEqual({ add_labels: ["receipts"], archive: false, mark_read: false });
    expect(replaced.enabled).toBe(true);
  });

  it("backfills the complete matching set and reports counts, including repeat runs", () => {
    const one = seedRaw({ subject: "invoice 1", from_address: "support@example.test", received_at: "2026-01-02T00:00:00.000Z" });
    const two = seedRaw({ subject: "invoice 2", from_address: "support@example.test", received_at: "2026-01-03T00:00:00.000Z" });
    seedRaw({ subject: "other mail", from_address: "other@example.test", received_at: "2026-01-04T00:00:00.000Z" }); // sender does not match
    const filter = createMailboxFilter({
      name: "Backfill",
      mailbox: "inbox",
      criteria: { from: "support@example.test", unread: true },
      actions: { add_labels: ["Invoices"], archive: true, mark_read: true },
      enabled: true,
    });
    const run = applyMailboxFilter(filter, { mutate: true, limit: 1 });
    expect(run).toMatchObject({ mutate: true, offset: 0, items: [], matched: 2, updated: 2, unchanged: 0 });
    expect(inboundState(one.id)).toEqual({ is_read: true, is_archived: true, labels: ["invoices"] });
    expect(inboundState(two.id)).toEqual({ is_read: true, is_archived: true, labels: ["invoices"] });
  });

  it("reapplying already-satisfied actions reports no updates", () => {
    const one = seedRaw({ subject: "notice 1", from_address: "support@example.test", received_at: "2026-01-02T00:00:00.000Z" });
    const two = seedRaw({ subject: "notice 2", from_address: "support@example.test", received_at: "2026-01-03T00:00:00.000Z" });
    const filter = createMailboxFilter({
      name: "Idempotent",
      mailbox: "inbox",
      criteria: { from: "support@example.test" },
      actions: { add_labels: ["notices"], mark_read: true },
      enabled: true,
    });
    expect(applyMailboxFilter(filter, { mutate: true })).toMatchObject({ matched: 2, updated: 2, unchanged: 0 });
    // Marking read does not evict the rows from inbox, so the second run still
    // matches them but every action is already satisfied.
    expect(applyMailboxFilter(filter, { mutate: true })).toMatchObject({ matched: 2, updated: 0, unchanged: 2 });
  });

  it("refuses a disabled filter and a nonzero offset in mutate mode", () => {
    const disabled = createMailboxFilter({ name: "Disabled", mailbox: "inbox", criteria: { unread: true }, actions: { archive: true }, enabled: false });
    expect(() => applyMailboxFilter(disabled, { mutate: true })).toThrow(/disabled/);

    const enabled = createMailboxFilter({ name: "Enabled", mailbox: "inbox", criteria: {}, actions: { archive: true }, enabled: true });
    expect(() => applyMailboxFilter(enabled, { mutate: true, offset: 1 })).toThrow(/offset must be 0/);
  });

  it("rolls back rather than acting on the immutable legacy sent ledger", () => {
    getDatabase().run("INSERT INTO providers (id, name, type, active) VALUES ('seed-provider', 'seed', 'resend', 1)");
    getDatabase().run(
      `INSERT INTO emails (id, provider_id, from_address, subject, status, sent_at)
       VALUES ('legacy-sent-1', 'seed-provider', 'owner@example.test', 'old send', 'sent', '2026-01-01T00:00:00.000Z')`,
    );
    const filter = createMailboxFilter({
      name: "Sent backfill",
      mailbox: "sent",
      criteria: {},
      actions: { archive: true },
      enabled: true,
    });
    expect(() => applyMailboxFilter(filter, { mutate: true })).toThrow(/cannot store read, archive, spam, trash or label state/);
  });

  it("leaves list-only apply returning mailbox rows unchanged", () => {
    seed("hello", "2026-01-02T00:00:00.000Z", true);
    const filter = createMailboxFilter({ name: "List", mailbox: "inbox", criteria: { unread: true }, actions: { archive: true }, enabled: true });
    const result = applyMailboxFilter(filter, { limit: 10 });
    expect(result).not.toHaveProperty("mutate");
    expect(result).not.toHaveProperty("matched");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });
});
