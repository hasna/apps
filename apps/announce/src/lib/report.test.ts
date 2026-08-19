// Agent-authored (TEST-GAP protocol): the gpt-5.6-sol consult terminated twice without delivering a spec (session died mid-audit; resume timed out), so the additions to this file carry no SOL attribution.
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

  it("aggregates clicks against the slugs persisted on ledger entries, not the pseudo-slug fallback", async () => {
    const ledger = new DeliveryLedger({ dataDir: mkdtempSync(join(tmpdir(), "announce-report-slugs-")) });
    const at = new Date().toISOString();
    await ledger.append({
      campaignId: "c2",
      appId: "a",
      channel: "email",
      status: "sent",
      deliveredAt: at,
      slugs: ["aaa11111", "bbb22222"],
    });
    await ledger.append({
      campaignId: "c2",
      appId: "a",
      channel: "telegram",
      status: "sent",
      deliveredAt: at,
      slugs: ["ccc33333"],
    });
    const report = await aggregateEngagement("c2", {
      ledger,
      shortlinkClicks: new MockShortlinkClicksAdapter({
        aaa11111: 7,
        bbb22222: 2,
        ccc33333: 1,
        // The pseudo-slug key must NOT be consulted while real slugs exist.
        "c2:email": 999,
        "c2:telegram": 999,
      }),
    });
    expect(report.shortlinks.map((link) => link.slug).sort()).toEqual(["aaa11111", "bbb22222", "ccc33333"]);
    expect(report.totals.clicks).toBe(10);
  });

  it("uses the pseudo-slug fallback only when no ledger entry carries slugs", async () => {
    // A legacy ledger written before slug persistence must still report
    // deterministic per-channel keys.
    const ledger = await seededLedger();
    const report = await aggregateEngagement("c1", {
      ledger,
      shortlinkClicks: new MockShortlinkClicksAdapter({ "c1:email": 4, "c1:telegram": 2 }),
    });
    expect(report.shortlinks).toEqual([
      { slug: "c1:email", clicks: 4 },
      { slug: "c1:telegram", clicks: 2 },
      { slug: "c1:sms", clicks: 0 },
    ]);
  });

  it("counts unsubscribe events and stamps generatedAt from the injected clock", async () => {
    const ledger = await seededLedger();
    const at = new Date().toISOString();
    const now = new Date("2026-07-06T12:00:00.000Z");
    const report = await aggregateEngagement("c1", {
      ledger,
      mailery: new MockMaileryEngagementAdapter([
        { campaignId: "c1", kind: "delivered", at },
        { campaignId: "c1", kind: "bounce", at },
        { campaignId: "c1", kind: "unsubscribe", at },
        { campaignId: "c1", kind: "complaint", at },
      ]),
      now,
    });
    const email = report.channels.find((channel) => channel.channel === "email")!;
    expect(email.bounces).toBe(1);
    expect(email.unsubscribes).toBe(1);
    expect(report.generatedAt).toBe("2026-07-06T12:00:00.000Z");
    // A complaint event maps to no engagement field today — it is not counted
    // anywhere, while opens/clicks are explicitly zeroed by the adapter.
    expect(email.opens).toBe(0);
    expect(email.clicks).toBe(0);
    expect(report.totals.opens).toBe(0);
  });
});
