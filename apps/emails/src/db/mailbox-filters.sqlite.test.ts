import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import { storeInboundEmail } from "./inbound.sqlite.js";
import {
  applyMailboxFilter,
  createMailboxFilter,
  deleteMailboxFilter,
  getMailboxFilter,
  listMailboxFilters,
} from "./mailbox-filters.sqlite.js";

let inheritedProcessEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  inheritedProcessEnv = { ...process.env };
  process.env.EMAILS_DB_PATH = ":memory:";
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
