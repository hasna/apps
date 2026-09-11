import { describe, expect, it } from "bun:test";
import {
  MailboxFilterInputError,
  normalizeMailboxFilterActions,
  normalizeMailboxFilterApplyBody,
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

describe("mailbox filter actions normalization", () => {
  it("defaults every action member when omitted", () => {
    expect(normalizeMailboxFilterActions(undefined)).toEqual({ add_labels: [], archive: false, mark_read: false });
    expect(normalizeMailboxFilterActions({})).toEqual({ add_labels: [], archive: false, mark_read: false });
  });

  it("trims, lowercases, empties, and deduplicates labels (first occurrence wins)", () => {
    expect(normalizeMailboxFilterActions({ add_labels: ["  Invoices ", "INVOICES", "  ", "Follow_Up"] }))
      .toEqual({ add_labels: ["invoices", "follow_up"], archive: false, mark_read: false });
  });

  it("keeps strict booleans and refuses coercion", () => {
    expect(normalizeMailboxFilterActions({ archive: true, mark_read: true }).archive).toBe(true);
    expect(() => normalizeMailboxFilterActions({ archive: "true" })).toThrow(MailboxFilterInputError);
    expect(() => normalizeMailboxFilterActions({ mark_read: 1 })).toThrow(MailboxFilterInputError);
    expect(() => normalizeMailboxFilterActions({ add_labels: "invoices" })).toThrow(/array of strings/);
    expect(() => normalizeMailboxFilterActions({ add_labels: [1] })).toThrow(/entries must be strings/);
  });

  it("rejects a non-object actions block", () => {
    expect(() => normalizeMailboxFilterActions("archive")).toThrow(MailboxFilterInputError);
    expect(() => normalizeMailboxFilterActions(["archive"])).toThrow(/must be an object/);
  });

  it("normalizes enabled, order, and actions together with defaults for new filters", () => {
    expect(normalizeMailboxFilterInput({ name: "Archive invoices", mailbox: "inbox", criteria: { from: "a@b.co" } }))
      .toMatchObject({ enabled: false, order: 0, actions: { add_labels: [], archive: false, mark_read: false } });
    expect(normalizeMailboxFilterInput({
      name: "Archive invoices",
      mailbox: "inbox",
      enabled: true,
      order: 3,
      actions: { add_labels: ["Invoices"], archive: true },
    })).toMatchObject({ enabled: true, order: 3, actions: { add_labels: ["invoices"], archive: true, mark_read: false } });
  });

  it("bounds and type-checks order", () => {
    expect(() => normalizeMailboxFilterInput({ name: "x", mailbox: "inbox", order: -1 })).toThrow(/between 0 and/);
    expect(() => normalizeMailboxFilterInput({ name: "x", mailbox: "inbox", order: 1.5 })).toThrow(/integer/);
    expect(() => normalizeMailboxFilterInput({ name: "x", mailbox: "inbox", order: "1" })).toThrow(/integer/);
    expect(() => normalizeMailboxFilterInput({ name: "x", mailbox: "inbox", enabled: "yes" })).toThrow(MailboxFilterInputError);
  });

  it("normalizes the apply request body strictly", () => {
    expect(normalizeMailboxFilterApplyBody(undefined)).toEqual({ mutate: false });
    expect(normalizeMailboxFilterApplyBody({})).toEqual({ mutate: false });
    expect(normalizeMailboxFilterApplyBody({ mutate: false })).toEqual({ mutate: false });
    expect(normalizeMailboxFilterApplyBody({ mutate: true })).toEqual({ mutate: true });
    expect(() => normalizeMailboxFilterApplyBody({ mutate: "yes" })).toThrow(/must be boolean/);
    expect(() => normalizeMailboxFilterApplyBody("mutate")).toThrow(/JSON object/);
  });
});
