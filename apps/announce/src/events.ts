import { EventsClient, createEvent } from "@hasna/events";
import type { EventEnvelope } from "@hasna/events";
import type { AnnouncementCampaign } from "./types.js";

// ---------------------------------------------------------------------------
// Vendored mirror of the distribution event catalog constants from
// `@hasna/events` branch feat/distribution-event-catalog (the `./catalog`
// export is not published yet). Keep the strings in sync with
// DISTRIBUTION_EVENT_TYPES / DISTRIBUTION_EVENT_CONTRACT_SCHEMAS.
// ---------------------------------------------------------------------------

export const ANNOUNCEMENT_SENT_EVENT_TYPE = "announcement.sent" as const;
export const ANNOUNCEMENT_SENT_CONTRACT_SCHEMA = "hasna.announcement.v1" as const;

export const EVENT_SOURCE = "hasna.announce" as const;

/** Mirror of `AnnouncementSentData` from the distribution event catalog (open extra keys allowed). */
export interface AnnouncementSentData extends Record<string, unknown> {
  campaignId: string;
  appId?: string;
  audienceId?: string;
  releaseId?: string;
  channels?: string[];
}

export type AnnouncementEventSink = (event: EventEnvelope<AnnouncementSentData>) => void | Promise<void>;

export function buildAnnouncementSentEvent(
  campaign: AnnouncementCampaign,
  options: { channels?: string[]; sentAt?: string } = {},
): EventEnvelope<AnnouncementSentData> {
  return createEvent<AnnouncementSentData>({
    source: EVENT_SOURCE,
    type: ANNOUNCEMENT_SENT_EVENT_TYPE,
    time: options.sentAt,
    subject: campaign.campaignId,
    data: {
      campaignId: campaign.campaignId,
      appId: campaign.appId,
      audienceId: campaign.audience.audienceId,
      releaseId: `${campaign.release.package}@${campaign.release.version}`,
      channels: options.channels ?? campaign.channels,
    },
    metadata: { contractSchema: ANNOUNCEMENT_SENT_CONTRACT_SCHEMA },
    dedupeKey: `${ANNOUNCEMENT_SENT_EVENT_TYPE}:${campaign.campaignId}`,
  });
}

/**
 * Default sink: append + deliver through `@hasna/events` (JSON store under
 * the events data dir). Failures are swallowed — event emission must never
 * break a delivery run.
 */
export function createDefaultEventSink(dataDir?: string): AnnouncementEventSink {
  return async (event) => {
    try {
      const client = new EventsClient({ dataDir });
      await client.emit(event);
    } catch {
      // Best effort only.
    }
  };
}
