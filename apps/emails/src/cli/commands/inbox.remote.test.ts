import { describe, expect, it } from "bun:test";
import { formatMailboxSources, formatMailboxStatus } from "./inbox.remote.js";
import type { MailboxSourceSummary, MailboxStatusSummary } from "../../lib/mail-types.js";

// Renderer pins for the O15-00350 `countsComplete` contract — the same class
// of collapse the daemon renderer was pinned against (daemon.local.test.ts):
// the scan carries the lower-bound marker in the payload, and a formatter that
// drops it makes a truncated scan read as a confident exact total. The data
// side (a truncated scan producing countsComplete: false) is pinned separately
// in src/cli/tui/data.remote-scan.test.ts; these pins assert the rendered text.
describe("mailbox status/source formatters", () => {
  const source = (overrides: Partial<MailboxSourceSummary>): MailboxSourceSummary => ({
    id: "all",
    label: "Self-hosted Emails",
    kind: "all",
    badges: ["self_hosted"],
    counts: { inbox: 12, unread: 3, priority: 0, starred: 0, sent: 0, archived: 0, spam: 0, trash: 0 },
    countsComplete: true,
    total: 12,
    unread: 3,
    latestReceivedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  it("prints exact totals when the scan completed", () => {
    const out = formatMailboxSources([source({})]);
    expect(out).toContain("12 total, 3 unread");
    expect(out).not.toContain("≥");
  });

  it("prints lower bounds when the scan could not finish", () => {
    const out = formatMailboxSources([source({ countsComplete: false })]);
    expect(out).toContain("≥12 total, ≥3 unread");
  });

  it("prints exact folder counts when the scan completed", () => {
    const status: MailboxStatusSummary = {
      counts: { inbox: 12, unread: 3, priority: 0, starred: 0, sent: 0, archived: 0, spam: 0, trash: 0 },
      countsComplete: true,
      folders: [{ id: "inbox", folder: "inbox", label: "Inbox", count: 12 }],
    };
    const out = formatMailboxStatus(status);
    expect(out).toMatch(/Inbox\s+12/);
    expect(out).not.toContain("≥");
  });

  it("prints lower bounds for folder counts when the scan could not finish", () => {
    const status: MailboxStatusSummary = {
      counts: { inbox: 12, unread: 3, priority: 0, starred: 0, sent: 0, archived: 0, spam: 0, trash: 0 },
      countsComplete: false,
      folders: [{ id: "inbox", folder: "inbox", label: "Inbox", count: 12 }],
    };
    const out = formatMailboxStatus(status);
    expect(out).toMatch(/Inbox\s+≥12/);
  });
});
