import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventEnvelope } from "@hasna/events";
import { composeAnnouncementCampaign } from "./compose.js";
import { deliverCampaign } from "./deliver.js";
import { DeliveryLedger } from "./ledger.js";
import { MockShortlinkAdapter } from "./shortlinks.js";
import type { AnnouncementSentData } from "../events.js";
import type { DeliveryAdapter, ReleaseRecord } from "../types.js";

const release: ReleaseRecord = {
  appId: "open-todos",
  package: "@hasna/todos",
  version: "1.2.3",
  gitSha: "abc1234",
  publishedAt: "2026-07-06T09:00:00.000Z",
  publishPath: "ci",
  changelogRef: { kind: "document", id: "open-todos@1.2.3", uri: "https://example.com/changelog" },
  evidenceRefs: [{ id: "ev-1" }],
};

function tempLedger(): DeliveryLedger {
  return new DeliveryLedger({ dataDir: mkdtempSync(join(tmpdir(), "announce-test-")) });
}

function makeCampaign(overrides: { scheduledAt?: string } = {}) {
  return composeAnnouncementCampaign({
    release,
    highlights: ["Faster sync"],
    audience: { audienceId: "developers" },
    channels: ["email", "telegram", "sms"],
    campaignId: "camp-test-1",
    scheduledAt: overrides.scheduledAt,
  });
}

describe("deliverCampaign --dry-run", () => {
  it("renders every channel and writes the ledger as simulated without sending", async () => {
    const ledger = tempLedger();
    const events: EventEnvelope<AnnouncementSentData>[] = [];
    let adapterCalled = false;
    const adapter: DeliveryAdapter = {
      channel: "email",
      deliver: async () => {
        adapterCalled = true;
        return { ok: true };
      },
    };

    const result = await deliverCampaign(makeCampaign(), {
      dryRun: true,
      ledger,
      adapters: { email: adapter },
      shortlinks: new MockShortlinkAdapter(),
      eventSink: async (event) => {
        events.push(event);
      },
    });

    expect(result.dryRun).toBe(true);
    expect(result.queued).toBe(false);
    expect(result.rendered.map((message) => message.channel)).toEqual(["email", "telegram", "sms"]);
    expect(result.entries).toHaveLength(3);
    for (const entry of result.entries) {
      expect(entry.simulated).toBe(true);
      expect(entry.status).toBe("sent");
      expect(entry.detail).toContain("dry-run");
    }
    // Nothing was sent and no event was emitted.
    expect(adapterCalled).toBe(false);
    expect(events).toHaveLength(0);
    expect(result.event).toBeUndefined();

    // Ledger persisted the simulated entries.
    const stored = await ledger.list("camp-test-1");
    expect(stored).toHaveLength(3);
    expect(stored.every((entry) => entry.simulated)).toBe(true);
  });

  it("builds a valid hasna.announcement.v1 document from a dry-run ledger", async () => {
    const ledger = tempLedger();
    const campaign = makeCampaign();
    await deliverCampaign(campaign, { dryRun: true, ledger, shortlinks: new MockShortlinkAdapter() });
    const doc = await ledger.toAnnouncementDocument(campaign);
    expect(doc.schema).toBe("hasna.announcement.v1");
    expect(doc.metadata?.simulated).toBe(true);
    expect(doc.channels).toHaveLength(3);
    expect(doc.releaseRef?.kind).toBe("release");
    // Canonical package locator coupling: sourcePackage AND externalId.
    expect(doc.releaseRef?.sourcePackage).toBe("@hasna/todos");
    expect(doc.releaseRef?.externalId).toBe("@hasna/todos@1.2.3");
    expect(doc.audienceRef.kind).toBe("audience");
    // sms/conversations map to "other" in the contract channel enum.
    expect(doc.channels.map((channel) => channel.channel).sort()).toEqual(["email", "other", "telegram"]);
  });
});

describe("deliverCampaign scheduling", () => {
  it("queues instead of sending when scheduledAt is in the future", async () => {
    const ledger = tempLedger();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = await deliverCampaign(makeCampaign({ scheduledAt: future }), {
      ledger,
      shortlinks: new MockShortlinkAdapter(),
    });
    expect(result.queued).toBe(true);
    expect(result.rendered).toHaveLength(0);
    expect(result.entries.every((entry) => entry.status === "queued")).toBe(true);
    expect(result.event).toBeUndefined();
  });

  it("sends a scheduled campaign with force", async () => {
    const ledger = tempLedger();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = await deliverCampaign(makeCampaign({ scheduledAt: future }), {
      ledger,
      dryRun: true,
      force: true,
      shortlinks: new MockShortlinkAdapter(),
    });
    expect(result.queued).toBe(false);
    expect(result.entries).toHaveLength(3);
  });

  it("sends once scheduledAt has passed", async () => {
    const ledger = tempLedger();
    const past = new Date(Date.now() - 1000).toISOString();
    const result = await deliverCampaign(makeCampaign({ scheduledAt: past }), {
      ledger,
      dryRun: true,
      shortlinks: new MockShortlinkAdapter(),
    });
    expect(result.queued).toBe(false);
  });
});

describe("deliverCampaign real sends (mock adapters)", () => {
  it("records sent/failed per channel and emits announcement.sent for sent channels", async () => {
    const ledger = tempLedger();
    const events: EventEnvelope<AnnouncementSentData>[] = [];
    const emailAdapter: DeliveryAdapter = {
      channel: "email",
      deliver: async () => ({ ok: true, externalId: "mail-1" }),
    };
    const telegramAdapter: DeliveryAdapter = {
      channel: "telegram",
      deliver: async () => {
        throw new Error("bridge unavailable");
      },
    };

    const result = await deliverCampaign(makeCampaign(), {
      ledger,
      adapters: { email: emailAdapter, telegram: telegramAdapter },
      shortlinks: new MockShortlinkAdapter(),
      eventSink: async (event) => {
        events.push(event);
      },
    });

    const byChannel = Object.fromEntries(result.entries.map((entry) => [entry.channel, entry]));
    expect(byChannel.email!.status).toBe("sent");
    expect(byChannel.email!.externalId).toBe("mail-1");
    expect(byChannel.email!.simulated).toBe(false);
    expect(byChannel.telegram!.status).toBe("failed");
    expect(byChannel.telegram!.detail).toContain("bridge unavailable");
    // No sms adapter configured.
    expect(byChannel.sms!.status).toBe("failed");
    expect(byChannel.sms!.detail).toContain("no delivery adapter");

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("announcement.sent");
    expect(events[0]!.source).toBe("hasna.announce");
    expect(events[0]!.data.campaignId).toBe("camp-test-1");
    expect(events[0]!.data.channels).toEqual(["email"]);
    expect(events[0]!.data.releaseId).toBe("@hasna/todos@1.2.3");
  });

  it("never uses mock go.hasna.example shortlinks for real sends when no shortlink adapter is passed", async () => {
    const ledger = tempLedger();
    const delivered: string[] = [];
    const emailAdapter: DeliveryAdapter = {
      channel: "email",
      deliver: async (message) => {
        delivered.push(message.body);
        return { ok: true };
      },
    };

    const result = await deliverCampaign(makeCampaign(), {
      ledger,
      adapters: { email: emailAdapter },
      eventSink: async () => {},
      // No `shortlinks` option on purpose: a real send must not default to
      // the mock adapter whose links do not resolve.
    });

    expect(result.dryRun).toBe(false);
    expect(delivered.length).toBeGreaterThan(0);
    for (const message of result.rendered) {
      for (const link of message.links) {
        expect(link.shortUrl).not.toContain("go.hasna.example");
      }
    }
    for (const body of delivered) {
      expect(body).not.toContain("go.hasna.example");
    }
  });

  it("persists shortlink slugs on sent ledger entries for engagement reporting", async () => {
    const ledger = tempLedger();
    const shortlinks = new MockShortlinkAdapter();
    const emailAdapter: DeliveryAdapter = {
      channel: "email",
      deliver: async () => ({ ok: true }),
    };
    const result = await deliverCampaign(makeCampaign(), {
      ledger,
      adapters: { email: emailAdapter },
      shortlinks,
      eventSink: async () => {},
    });
    const email = result.entries.find((entry) => entry.channel === "email")!;
    expect(email.status).toBe("sent");
    expect(email.slugs?.length).toBeGreaterThan(0);
    const rendered = result.rendered.find((message) => message.channel === "email")!;
    expect(email.slugs).toEqual(rendered.links.map((link) => link.slug));
  });
});
