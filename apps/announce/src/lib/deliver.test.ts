// Agent-authored (TEST-GAP protocol): the gpt-5.6-sol consult terminated twice without delivering a spec (session died mid-audit; resume timed out), so the additions to this file carry no SOL attribution.
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventEnvelope } from "@hasna/events";
import { composeAnnouncementCampaign } from "./compose.js";
import { deliverCampaign } from "./deliver.js";
import { DeliveryLedger } from "./ledger.js";
import { MockShortlinkAdapter } from "./shortlinks.js";
import type { AnnouncementSentData } from "../events.js";
import type { AnnouncementCampaign, DeliveryAdapter, ReleaseRecord } from "../types.js";

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

    // In the mono the optional peer @hasna/shortlinks resolves to the workspace
    // member, so a real send takes the real-adapter path (the noop fallback
    // only exists for absent packages). Give the real store an isolated
    // fixture domain; SHORTLINKS_HOME/DB must both be pointed at the fixture
    // or the store opens the ambient home DB and writes the real config.
    const dbDir = mkdtempSync(join(tmpdir(), "announce-shortlinks-"));
    const dbPath = join(dbDir, "shortlinks.db");
    const prevHome = process.env.SHORTLINKS_HOME;
    const prevDb = process.env.SHORTLINKS_DB;
    process.env.SHORTLINKS_HOME = dbDir;
    process.env.SHORTLINKS_DB = dbPath;
    try {
      const { ShortlinksStore } = await import("@hasna/shortlinks");
      const store = new ShortlinksStore(dbPath);
      store.addDomain({ hostname: "go.example", defaultDomain: true });
      store.close();

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
          expect(link.shortUrl).toContain("go.example");
        }
      }
      for (const body of delivered) {
        expect(body).not.toContain("go.hasna.example");
      }
    } finally {
      if (prevHome === undefined) delete process.env.SHORTLINKS_HOME;
      else process.env.SHORTLINKS_HOME = prevHome;
      if (prevDb === undefined) delete process.env.SHORTLINKS_DB;
      else process.env.SHORTLINKS_DB = prevDb;
      rmSync(dbDir, { recursive: true, force: true });
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

  it("records an adapter ok:false verdict as failed with its detail", async () => {
    const ledger = tempLedger();
    const adapter: DeliveryAdapter = {
      channel: "email",
      deliver: async () => ({ ok: false, detail: "recipient rejected" }),
    };
    const result = await deliverCampaign(makeCampaign(), {
      ledger,
      adapters: { email: adapter },
      shortlinks: new MockShortlinkAdapter(),
      eventSink: async () => {},
    });
    const email = result.entries.find((entry) => entry.channel === "email")!;
    expect(email.status).toBe("failed");
    expect(email.detail).toBe("recipient rejected");
    expect(result.event).toBeUndefined();
  });

  it("emits no announcement.sent event when every channel failed", async () => {
    const ledger = tempLedger();
    let sinkCalls = 0;
    const adapter: DeliveryAdapter = {
      channel: "email",
      deliver: async () => ({ ok: false, detail: "down" }),
    };
    const result = await deliverCampaign(makeCampaign(), {
      ledger,
      adapters: { email: adapter, telegram: adapter, sms: adapter },
      shortlinks: new MockShortlinkAdapter(),
      eventSink: async () => {
        sinkCalls += 1;
      },
    });
    expect(result.event).toBeUndefined();
    expect(sinkCalls).toBe(0);
    expect(result.entries.every((entry) => entry.status === "failed")).toBe(true);
  });

  it("leaves slugs undefined on ledger entries when the campaign has no links", async () => {
    // composeAnnouncementCampaign always derives at least the Package link, so
    // a link-less campaign is constructed directly to exercise the real
    // no-links path through the delivery pipeline.
    const ledger = tempLedger();
    const noLinksCampaign: AnnouncementCampaign = {
      campaignId: "camp-no-links",
      appId: "open-todos",
      release: {
        appId: "open-todos",
        package: "@hasna/todos",
        version: "1.2.3",
        gitSha: "abc1234",
        publishedAt: "2026-07-06T09:00:00.000Z",
        publishPath: "backfilled",
      },
      audience: { audienceId: "developers" },
      channels: ["email"],
      title: "open-todos 1.2.3 released",
      links: [],
      createdAt: "2026-07-06T09:00:00.000Z",
    };
    const adapter: DeliveryAdapter = {
      channel: "email",
      deliver: async () => ({ ok: true }),
    };
    const result = await deliverCampaign(noLinksCampaign, {
      ledger,
      adapters: { email: adapter },
      shortlinks: new MockShortlinkAdapter(),
      eventSink: async () => {},
    });
    const email = result.entries.find((entry) => entry.channel === "email")!;
    expect(email.slugs).toBeUndefined();
    // Engagement reporting falls back to the pseudo-slug convention here.
    expect(email.status).toBe("sent");
  });

  it("records the scheduling detail on queued entries", async () => {
    const ledger = tempLedger();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = await deliverCampaign(makeCampaign({ scheduledAt: future }), {
      ledger,
      shortlinks: new MockShortlinkAdapter(),
    });
    expect(result.entries.every((entry) => entry.detail === `scheduled for ${future}`)).toBe(true);
    expect(result.entries.every((entry) => entry.simulated === false)).toBe(true);
  });
});

describe("deliverCampaign event emission failure modes", () => {
  it("PINNED BEHAVIOR: a throwing custom event sink propagates after the ledger is already written", async () => {
    // The default sink swallows its own failures; a caller-supplied sink is
    // awaited bare, so its rejection fails the whole run. The ledger entries
    // for the sent channels are already persisted by then. This pins the
    // current semantics so a future "fix" (swallow sink errors) is a visible
    // behavior change rather than a silent one.
    const ledger = tempLedger();
    const emailAdapter: DeliveryAdapter = {
      channel: "email",
      deliver: async () => ({ ok: true, externalId: "mail-1" }),
    };
    await expect(
      deliverCampaign(makeCampaign(), {
        ledger,
        adapters: { email: emailAdapter },
        shortlinks: new MockShortlinkAdapter(),
        eventSink: async () => {
          throw new Error("event backend down");
        },
      }),
    ).rejects.toThrow("event backend down");
    const stored = await ledger.list("camp-test-1");
    expect(stored.some((entry) => entry.channel === "email" && entry.status === "sent")).toBe(true);
  });

  it("PINNED BEHAVIOR: real-send deliveredAt comes from the wall clock, not the injected now", async () => {
    // deliverCampaign uses `options.now` for `at` but stamps real-send
    // `deliveredAt` with a fresh `new Date()` — the injected clock does not
    // flow through to the delivery timestamp (dry-runs do use the injected
    // now). Pinned here because a deterministic delivery ledger is only
    // possible once this is consistent.
    const ledger = tempLedger();
    const injected = new Date("2026-07-06T09:00:00.000Z");
    const emailAdapter: DeliveryAdapter = {
      channel: "email",
      deliver: async () => ({ ok: true }),
    };
    const result = await deliverCampaign(makeCampaign(), {
      ledger,
      adapters: { email: emailAdapter },
      shortlinks: new MockShortlinkAdapter(),
      eventSink: async () => {},
      now: injected,
    });
    const email = result.entries.find((entry) => entry.channel === "email")!;
    expect(email.at).toBe("2026-07-06T09:00:00.000Z");
    expect(email.deliveredAt).toBeDefined();
    expect(email.deliveredAt).not.toBe("2026-07-06T09:00:00.000Z");
  });
});
