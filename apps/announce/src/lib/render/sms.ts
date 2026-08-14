import type { AnnouncementCampaign, RenderedMessage, ShortenedLink } from "../../types.js";

export const SMS_MAX_LENGTH = 320;

/**
 * Short-form SMS message: headline + one shortlink, hard-capped at
 * {@link SMS_MAX_LENGTH} characters.
 */
export function renderSms(campaign: AnnouncementCampaign, links: ShortenedLink[]): RenderedMessage {
  const primaryLink = links[0];
  const suffix = primaryLink ? ` ${primaryLink.shortUrl}` : "";
  const budget = SMS_MAX_LENGTH - suffix.length;
  let headline = `${campaign.title} (${campaign.release.version})`;
  if (headline.length > budget) {
    headline = `${headline.slice(0, Math.max(0, budget - 1))}…`;
  }
  return {
    channel: "sms",
    format: "text",
    body: `${headline}${suffix}`,
    links: primaryLink ? [primaryLink] : [],
  };
}
