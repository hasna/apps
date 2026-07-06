import type { AnnouncementCampaign, RenderedMessage, ShortenedLink } from "../../types.js";

/**
 * Conversations channel message (markdown, suitable for
 * `conversations send-to-channel` style delivery).
 */
export function renderConversations(campaign: AnnouncementCampaign, links: ShortenedLink[]): RenderedMessage {
  const highlights = campaign.changelog?.highlights ?? [];
  const lines = [
    `## ${campaign.title}`,
    "",
    `Release: \`${campaign.release.package}@${campaign.release.version}\` (${campaign.release.gitSha.slice(0, 7)})`,
  ];
  if (campaign.summary) lines.push("", campaign.summary);
  if (highlights.length) {
    lines.push("", "Highlights:", ...highlights.map((item) => `- ${item}`));
  }
  if (links.length) {
    lines.push("", ...links.map((link) => `- [${link.label}](${link.shortUrl})`));
  }
  return {
    channel: "conversations",
    format: "markdown",
    subject: campaign.title,
    body: lines.join("\n"),
    links,
  };
}
