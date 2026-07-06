import type { AnnouncementCampaign, RenderedMessage, ShortenedLink } from "../../types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Mailery-compatible HTML email template (inline styles, single column,
 * text alternative included in `textBody`).
 */
export function renderEmail(campaign: AnnouncementCampaign, links: ShortenedLink[]): RenderedMessage {
  const highlights = campaign.changelog?.highlights ?? [];
  const highlightsHtml = highlights.length
    ? `<ul style="margin:16px 0;padding-left:20px;color:#333;">${highlights
        .map((item) => `<li style="margin:4px 0;">${escapeHtml(item)}</li>`)
        .join("")}</ul>`
    : "";
  const linksHtml = links
    .map(
      (link) =>
        `<p style="margin:8px 0;"><a href="${escapeHtml(link.shortUrl)}" style="color:#1a6ef5;">${escapeHtml(link.label)}</a></p>`,
    )
    .join("");
  const summaryHtml = campaign.summary
    ? `<p style="margin:16px 0;color:#333;line-height:1.5;">${escapeHtml(campaign.summary)}</p>`
    : "";

  const body = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f6f8;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;padding:32px;">
            <tr><td>
              <h1 style="margin:0 0 8px;font-size:22px;color:#111;">${escapeHtml(campaign.title)}</h1>
              <p style="margin:0 0 16px;color:#666;font-size:13px;">${escapeHtml(campaign.release.package)} ${escapeHtml(campaign.release.version)}</p>
              ${summaryHtml}
              ${highlightsHtml}
              ${linksHtml}
              <p style="margin:24px 0 0;color:#999;font-size:12px;">You are receiving this because you are in the ${escapeHtml(campaign.audience.name ?? campaign.audience.audienceId)} audience.</p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textLines = [
    campaign.title,
    `${campaign.release.package} ${campaign.release.version}`,
    "",
    ...(campaign.summary ? [campaign.summary, ""] : []),
    ...highlights.map((item) => `- ${item}`),
    ...(highlights.length ? [""] : []),
    ...links.map((link) => `${link.label}: ${link.shortUrl}`),
  ];

  return {
    channel: "email",
    format: "html",
    subject: campaign.title,
    body,
    textBody: textLines.join("\n"),
    links,
  };
}
