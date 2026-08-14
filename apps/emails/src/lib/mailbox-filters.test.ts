import { describe, expect, it } from "bun:test";
import {
  MailboxFilterInputError,
  normalizeMailboxFilterCriteria,
  normalizeMailboxFilterInput,
  normalizeMailboxFilterName,
} from "./mailbox-filters.js";

describe("saved mailbox filter normalization", () => {
  it("uses one bounded key for whitespace, case, and underscore variants", () => {
    expect(normalizeMailboxFilterName("  Needs_Review  ")).toBe("needs-review");
    expect(normalizeMailboxFilterName("Needs Review")).toBe("needs-review");
    expect(normalizeMailboxFilterName("x".repeat(100))).toHaveLength(64);
  });

  it("normalizes criteria and stores dates as inclusive ISO bounds", () => {
    expect(normalizeMailboxFilterInput({
      name: "Unread support",
      mailbox: "INBOX",
      criteria: {
        search: "  Invoice ",
        from: " Billing@Example.COM ",
        since: "2026-01-01",
        until: "2026-01-31T23:59:59Z",
        unread: true,
      },
    })).toMatchObject({
      normalized_name: "unread-support",
      mailbox: "inbox",
      criteria: {
        search: "invoice",
        from: "billing@example.com",
        unread: true,
        since: "2026-01-01T00:00:00.000Z",
        until: "2026-01-31T23:59:59.000Z",
      },
    });
  });

  it("rejects contradictory flags, invalid dates, and folders", () => {
    expect(() => normalizeMailboxFilterInput({ name: "bad", mailbox: "inbox", criteria: { read: true, unread: true } }))
      .toThrow(MailboxFilterInputError);
    expect(() => normalizeMailboxFilterInput({ name: "bad", mailbox: "inbox", criteria: { since: "not-a-date" } }))
      .toThrow(MailboxFilterInputError);
    expect(() => normalizeMailboxFilterInput({ name: "bad", mailbox: "not-a-folder" }))
      .toThrow(MailboxFilterInputError);
    expect(() => normalizeMailboxFilterCriteria({ since: "2026-02-01", until: "2026-01-01" }))
      .toThrow(/before or equal/);
  });
});
