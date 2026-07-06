// ---------------------------------------------------------------------------
// Engagement half — clearly separated from the delivery pipeline.
//
// `announce report <campaignId>` aggregates engagement from adapter
// interfaces (mailery events, analytics, shortlink clicks). Only mock
// adapters ship today; real adapters are follow-ups.
// ---------------------------------------------------------------------------

import type {
  AnalyticsEngagementAdapter,
  ChannelEngagement,
  DeliveryChannel,
  EngagementReport,
  LedgerEntry,
  MaileryEngagementAdapter,
  MaileryEngagementEvent,
  ShortlinkClicksAdapter,
} from "../types.js";
import { DeliveryLedger } from "./ledger.js";

export interface EngagementSources {
  mailery?: MaileryEngagementAdapter;
  analytics?: AnalyticsEngagementAdapter;
  shortlinkClicks?: ShortlinkClicksAdapter;
}

export interface AggregateEngagementOptions extends EngagementSources {
  ledger?: DeliveryLedger;
  now?: Date;
}

function emptyChannel(channel: DeliveryChannel): ChannelEngagement {
  return { channel, sent: 0 };
}

/**
 * Aggregate one campaign's engagement: ledger sends per channel, mailery
 * opens/clicks/bounces for the email channel, shortlink clicks per slug,
 * and attributed site visits when an analytics adapter is provided.
 */
export async function aggregateEngagement(
  campaignId: string,
  options: AggregateEngagementOptions = {},
): Promise<EngagementReport> {
  const ledger = options.ledger ?? new DeliveryLedger();
  const entries = await ledger.list(campaignId);
  if (entries.length === 0) throw new Error(`No ledger entries for campaign: ${campaignId}`);

  const byChannel = new Map<DeliveryChannel, ChannelEngagement>();
  const latest = new Map<DeliveryChannel, LedgerEntry>();
  for (const entry of entries) latest.set(entry.channel, entry);
  for (const [channel, entry] of latest) {
    const engagement = byChannel.get(channel) ?? emptyChannel(channel);
    if (entry.status === "sent") engagement.sent += 1;
    byChannel.set(channel, engagement);
  }

  if (options.mailery && byChannel.has("email")) {
    const events: MaileryEngagementEvent[] = await options.mailery.listEvents(campaignId);
    const email = byChannel.get("email")!;
    email.delivered = events.filter((event) => event.kind === "delivered").length;
    email.opens = events.filter((event) => event.kind === "open").length;
    email.clicks = events.filter((event) => event.kind === "click").length;
    email.bounces = events.filter((event) => event.kind === "bounce").length;
    email.unsubscribes = events.filter((event) => event.kind === "unsubscribe").length;
  }

  const slugs = new Set<string>();
  for (const entry of entries) {
    // Slugs are not stored on ledger entries; shortlink click aggregation is
    // keyed by campaign convention: adapters receive the campaignId-scoped
    // slug list from the caller in real integrations. The mock convention
    // uses `<campaignId>:<channel>` keys.
    slugs.add(`${entry.campaignId}:${entry.channel}`);
  }
  const shortlinks: Array<{ slug: string; clicks: number }> = [];
  if (options.shortlinkClicks) {
    for (const slug of slugs) {
      shortlinks.push({ slug, clicks: await options.shortlinkClicks.clicks(slug) });
    }
  }

  const visits = options.analytics ? await options.analytics.campaignVisits(campaignId) : undefined;

  const channels = [...byChannel.values()];
  const totals = {
    sent: channels.reduce((sum, channel) => sum + channel.sent, 0),
    opens: channels.reduce((sum, channel) => sum + (channel.opens ?? 0), 0),
    clicks:
      channels.reduce((sum, channel) => sum + (channel.clicks ?? 0), 0) +
      shortlinks.reduce((sum, link) => sum + link.clicks, 0),
  };

  return {
    campaignId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    channels,
    shortlinks,
    visits,
    totals,
  };
}

// ---------------------------------------------------------------------------
// Mock engagement adapters (tests + `announce report --mock`)
// ---------------------------------------------------------------------------

export class MockMaileryEngagementAdapter implements MaileryEngagementAdapter {
  constructor(private readonly events: MaileryEngagementEvent[] = []) {}

  async listEvents(campaignId: string): Promise<MaileryEngagementEvent[]> {
    return this.events.filter((event) => event.campaignId === campaignId);
  }
}

export class MockAnalyticsEngagementAdapter implements AnalyticsEngagementAdapter {
  constructor(private readonly result: { visits: number; uniqueVisitors: number } = { visits: 0, uniqueVisitors: 0 }) {}

  async campaignVisits(): Promise<{ visits: number; uniqueVisitors: number }> {
    return this.result;
  }
}

export class MockShortlinkClicksAdapter implements ShortlinkClicksAdapter {
  constructor(private readonly clickMap: Record<string, number> = {}) {}

  async clicks(slug: string): Promise<number> {
    return this.clickMap[slug] ?? 0;
  }
}
