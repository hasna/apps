import type { AnnouncementCampaign, RenderedMessage, ShortenedLink } from "../../types.js";

function escapeMarkdown(value: string): string {
  return value.replace(/([_*[\]()`])/g, "\\$1");
}

/**
 * Telegram channel post for the open-bridge broadcast surface
 * (Markdown, compact, links at the bottom).
 */
export function renderTelegram(campaign: AnnouncementCampaign, links: ShortenedLink[]): RenderedMessage {
  const highlights = campaign.changelog?.highlights ?? [];
  const lines = [
    `*${escapeMarkdown(campaign.title)}*`,
    "",
    `\`${campaign.release.package}@${campaign.release.version}\``,
  ];
  if (campaign.summary) lines.push("", escapeMarkdown(campaign.summary));
  if (highlights.length) {
    lines.push("", ...highlights.map((item) => `• ${escapeMarkdown(item)}`));
  }
  if (links.length) {
    lines.push("", ...links.map((link) => `[${escapeMarkdown(link.label)}](${link.shortUrl})`));
  }
  return {
    channel: "telegram",
    format: "markdown",
    body: lines.join("\n"),
    links,
  };
}
