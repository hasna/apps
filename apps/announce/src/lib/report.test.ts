import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliveryLedger } from "./ledger.js";
import {
  aggregateEngagement,
  MockAnalyticsEngagementAdapter,
  MockMaileryEngagementAdapter,
  MockShortlinkClicksAdapter,
} from "./report.js";

async function seededLedger(): Promise<DeliveryLedger> {
  const ledger = new DeliveryLedger({ dataDir: mkdtempSync(join(tmpdir(), "announce-report-")) });
  const at = new Date().toISOString();
  await ledger.append({ campaignId: "c1", appId: "a", channel: "email", status: "sent", deliveredAt: at });
  await ledger.append({ campaignId: "c1", appId: "a", channel: "telegram", status: "sent", deliveredAt: at });
  await ledger.append({ campaignId: "c1", appId: "a", channel: "sms", status: "failed", detail: "no adapter" });
  return ledger;
}

describe("aggregateEngagement", () => {
  it("aggregates ledger sends, mailery events, shortlink clicks, and visits", async () => {
    const ledger = await seededLedger();
    const at = new Date().toISOString();
    const report = await aggregateEngagement("c1", {
      ledger,
      mailery: new MockMaileryEngagementAdapter([
        { campaignId: "c1", kind: "delivered", at },
        { campaignId: "c1", kind: "open", at },
        { campaignId: "c1", kind: "open", at },
        { campaignId: "c1", kind: "click", at },
        { campaignId: "c2", kind: "open", at },
      ]),
      analytics: new MockAnalyticsEngagementAdapter({ visits: 42, uniqueVisitors: 30 }),
      shortlinkClicks: new MockShortlinkClicksAdapter({ "c1:email": 5, "c1:telegram": 3 }),
    });

    expect(report.campaignId).toBe("c1");
    const email = report.channels.find((channel) => channel.channel === "email")!;
    expect(email.sent).toBe(1);
    expect(email.delivered).toBe(1);
    expect(email.opens).toBe(2);
    expect(email.clicks).toBe(1);
    const sms = report.channels.find((channel) => channel.channel === "sms")!;
    expect(sms.sent).toBe(0);
    expect(report.visits).toEqual({ visits: 42, uniqueVisitors: 30 });
    expect(report.shortlinks.find((link) => link.slug === "c1:email")!.clicks).toBe(5);
    expect(report.totals.sent).toBe(2);
    expect(report.totals.opens).toBe(2);
    // channel clicks (1) + shortlink clicks (5 + 3 + 0)
    expect(report.totals.clicks).toBe(9);
  });

  it("works with only the ledger (no adapters)", async () => {
    const ledger = await seededLedger();
    const report = await aggregateEngagement("c1", { ledger });
    expect(report.totals.sent).toBe(2);
    expect(report.shortlinks).toHaveLength(0);
    expect(report.visits).toBeUndefined();
  });

  it("throws for unknown campaigns", async () => {
    const ledger = await seededLedger();
    await expect(aggregateEngagement("missing", { ledger })).rejects.toThrow(/No ledger entries/);
  });
});
