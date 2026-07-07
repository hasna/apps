import { buildAnnouncementSentEvent, createDefaultEventSink } from "../events.js";
import type { AnnouncementEventSink, AnnouncementSentData } from "../events.js";
import type { EventEnvelope } from "@hasna/events";
import type {
  AnnouncementCampaign,
  DeliveryAdapters,
  DeliveryChannel,
  LedgerEntry,
  RenderedMessage,
} from "../types.js";
import { DeliveryLedger } from "./ledger.js";
import { renderChannel } from "./render/index.js";
import { MockShortlinkAdapter, resolveShortlinkAdapter, shortenLinks } from "./shortlinks.js";
import type { ShortlinkAdapter } from "./shortlinks.js";

export interface DeliverCampaignOptions {
  adapters?: DeliveryAdapters;
  ledger?: DeliveryLedger;
  shortlinks?: ShortlinkAdapter;
  eventSink?: AnnouncementEventSink;
  /**
   * Render everything and write the ledger as simulated without sending.
   * No adapters are called and no `announcement.sent` event is emitted.
   */
  dryRun?: boolean;
  /** Send even when `scheduledAt` is still in the future. */
  force?: boolean;
  now?: Date;
}

export interface DeliveryRunResult {
  campaignId: string;
  dryRun: boolean;
  /** True when the campaign was queued because `scheduledAt` is in the future. */
  queued: boolean;
  rendered: RenderedMessage[];
  entries: LedgerEntry[];
  /** The emitted `announcement.sent` envelope (real sends only). */
  event?: EventEnvelope<AnnouncementSentData>;
}

/**
 * Delivery pipeline: scheduling gate → shortlink wrapping → per-channel
 * render → adapter delivery (or dry-run simulation) → ledger + event.
 */
export async function deliverCampaign(
  campaign: AnnouncementCampaign,
  options: DeliverCampaignOptions = {},
): Promise<DeliveryRunResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const dryRun = options.dryRun ?? false;
  const ledger = options.ledger ?? new DeliveryLedger();
  // Dry-runs default to the deterministic mock adapter; REAL sends must never
  // fall back to it (its go.hasna.example links do not resolve). Real sends
  // default to `@hasna/shortlinks` when installed, otherwise pass-through.
  const shortlinks =
    options.shortlinks ?? (dryRun ? new MockShortlinkAdapter() : await resolveShortlinkAdapter());
  const entries: LedgerEntry[] = [];
  const rendered: RenderedMessage[] = [];

  if (!options.force && campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > now.getTime()) {
    for (const channel of campaign.channels) {
      entries.push(
        await ledger.append({
          campaignId: campaign.campaignId,
          appId: campaign.appId,
          channel,
          status: "queued",
          simulated: dryRun,
          at: nowIso,
          detail: `scheduled for ${campaign.scheduledAt}`,
        }),
      );
    }
    return { campaignId: campaign.campaignId, dryRun, queued: true, rendered, entries };
  }

  const sentChannels: DeliveryChannel[] = [];

  for (const channel of campaign.channels) {
    const links = await shortenLinks(campaign.links, shortlinks, {
      campaignId: campaign.campaignId,
      channel,
    });
    const message = renderChannel(channel, campaign, links);
    rendered.push(message);
    const slugs = message.links.map((link) => link.slug).filter(Boolean);
    const entrySlugs = slugs.length > 0 ? slugs : undefined;

    if (dryRun) {
      entries.push(
        await ledger.append({
          campaignId: campaign.campaignId,
          appId: campaign.appId,
          channel,
          status: "sent",
          simulated: true,
          at: nowIso,
          deliveredAt: nowIso,
          detail: "dry-run: simulated delivery",
          renderedSubject: message.subject,
          renderedBytes: Buffer.byteLength(message.body, "utf8"),
          slugs: entrySlugs,
        }),
      );
      continue;
    }

    const adapter = options.adapters?.[channel];
    if (!adapter) {
      entries.push(
        await ledger.append({
          campaignId: campaign.campaignId,
          appId: campaign.appId,
          channel,
          status: "failed",
          at: nowIso,
          detail: `no delivery adapter configured for channel: ${channel}`,
          renderedSubject: message.subject,
        }),
      );
      continue;
    }

    try {
      const result = await adapter.deliver(message, campaign);
      if (result.ok) {
        sentChannels.push(channel);
        entries.push(
          await ledger.append({
            campaignId: campaign.campaignId,
            appId: campaign.appId,
            channel,
            status: "sent",
            at: nowIso,
            deliveredAt: new Date().toISOString(),
            externalId: result.externalId,
            detail: result.detail,
            renderedSubject: message.subject,
            renderedBytes: Buffer.byteLength(message.body, "utf8"),
            slugs: entrySlugs,
          }),
        );
      } else {
        entries.push(
          await ledger.append({
            campaignId: campaign.campaignId,
            appId: campaign.appId,
            channel,
            status: "failed",
            at: nowIso,
            detail: result.detail ?? "delivery adapter reported failure",
            renderedSubject: message.subject,
          }),
        );
      }
    } catch (error) {
      entries.push(
        await ledger.append({
          campaignId: campaign.campaignId,
          appId: campaign.appId,
          channel,
          status: "failed",
          at: nowIso,
          detail: error instanceof Error ? error.message : String(error),
          renderedSubject: message.subject,
        }),
      );
    }
  }

  let event: EventEnvelope<AnnouncementSentData> | undefined;
  if (!dryRun && sentChannels.length > 0) {
    event = buildAnnouncementSentEvent(campaign, { channels: sentChannels, sentAt: nowIso });
    const sink = options.eventSink ?? createDefaultEventSink();
    await sink(event);
  }

  return { campaignId: campaign.campaignId, dryRun, queued: false, rendered, entries, event };
}
