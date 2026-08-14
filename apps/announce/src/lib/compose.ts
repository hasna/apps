import { randomUUID } from "node:crypto";
import { parseReleaseRecord } from "../contracts.js";
import type {
  AnnouncementCampaign,
  CampaignAudience,
  CampaignLink,
  ChangelogSummary,
  DeliveryChannel,
  JsonObject,
  ReleaseRecord,
  ResourcePointer,
} from "../types.js";
import { DELIVERY_CHANNELS } from "../types.js";

export interface ComposeCampaignInput {
  release: ReleaseRecord;
  /** Changelog pointer; taken from `release.changelogRef` when omitted. */
  changelogRef?: ResourcePointer;
  /** Optional bullet highlights pulled from the changelog entry. */
  highlights?: string[];
  audience: CampaignAudience;
  channels: DeliveryChannel[];
  campaignId?: string;
  title?: string;
  summary?: string;
  /** Extra links beyond the derived release/changelog links. */
  links?: CampaignLink[];
  scheduledAt?: string;
  now?: Date;
  metadata?: JsonObject;
}

export function assertDeliveryChannels(channels: string[]): asserts channels is DeliveryChannel[] {
  for (const channel of channels) {
    if (!(DELIVERY_CHANNELS as readonly string[]).includes(channel)) {
      throw new Error(`Unsupported delivery channel: ${channel} (expected one of ${DELIVERY_CHANNELS.join(", ")})`);
    }
  }
}

function derivedLinks(release: ReleaseRecord, changelogRef?: ResourcePointer): CampaignLink[] {
  const links: CampaignLink[] = [];
  if (changelogRef?.uri) links.push({ label: "Changelog", url: changelogRef.uri });
  links.push({
    label: "Package",
    url: `https://www.npmjs.com/package/${release.package}/v/${release.version}`,
  });
  return links;
}

/**
 * Compose an announcement campaign from a `hasna.release.v1`-shaped release
 * record plus a changelog ref. Pure: no I/O, no delivery.
 */
export function composeAnnouncementCampaign(input: ComposeCampaignInput): AnnouncementCampaign {
  const release = parseReleaseRecord(input.release);
  if (!input.channels.length) throw new Error("At least one delivery channel is required");
  assertDeliveryChannels(input.channels);
  if (!input.audience.audienceId?.trim()) throw new Error("audience.audienceId is required");
  const changelogRef = input.changelogRef ?? release.changelogRef;
  if (input.scheduledAt && Number.isNaN(new Date(input.scheduledAt).getTime())) {
    throw new Error(`Invalid scheduledAt datetime: ${input.scheduledAt}`);
  }
  const changelog: ChangelogSummary | undefined = changelogRef
    ? { ref: changelogRef, highlights: input.highlights }
    : undefined;
  const now = (input.now ?? new Date()).toISOString();
  return {
    campaignId: input.campaignId ?? `camp-${release.appId}-${release.version}-${randomUUID().slice(0, 8)}`,
    appId: release.appId,
    release,
    changelog,
    audience: { audienceId: input.audience.audienceId.trim(), name: input.audience.name },
    channels: [...new Set(input.channels)],
    title: input.title ?? `${release.appId} ${release.version} released`,
    summary: input.summary,
    links: [...derivedLinks(release, changelogRef), ...(input.links ?? [])],
    scheduledAt: input.scheduledAt ? new Date(input.scheduledAt).toISOString() : undefined,
    createdAt: now,
    metadata: input.metadata,
  };
}
