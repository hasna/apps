import { describe, expect, it } from "bun:test";
import { composeAnnouncementCampaign } from "../compose.js";
import { MockShortlinkAdapter, shortenLinks } from "../shortlinks.js";
import { renderChannel, renderEmail, renderSms, renderTelegram, renderConversations } from "./index.js";
import type { ReleaseRecord, ShortenedLink } from "../../types.js";

const release: ReleaseRecord = {
  appId: "open-todos",
  package: "@hasna/todos",
  version: "1.2.3",
  gitSha: "abc1234def",
  publishedAt: "2026-07-06T09:00:00.000Z",
  publishPath: "ci",
  changelogRef: {
    kind: "document",
    id: "open-todos@1.2.3",
    uri: "https://github.com/hasna/open-todos/releases/tag/v1.2.3",
  },
  evidenceRefs: [{ id: "ev-1" }],
};

const campaign = composeAnnouncementCampaign({
  release,
  highlights: ["Faster sync", "New <CLI> flags & things"],
  summary: "A big release.",
  audience: { audienceId: "developers", name: "Developers" },
  channels: ["email", "telegram", "conversations", "sms"],
});

async function links(channel: string): Promise<ShortenedLink[]> {
  return shortenLinks(campaign.links, new MockShortlinkAdapter(), {
    campaignId: campaign.campaignId,
    channel,
  });
}

describe("renderers", () => {
  it("renders a mailery-compatible html email with text alternative", async () => {
    const message = renderEmail(campaign, await links("email"));
    expect(message.channel).toBe("email");
    expect(message.format).toBe("html");
    expect(message.subject).toBe(campaign.title);
    expect(message.body).toContain("<!doctype html>");
    expect(message.body).toContain("open-todos 1.2.3 released");
    // Html-escapes changelog highlights.
    expect(message.body).toContain("New &lt;CLI&gt; flags &amp; things");
    // Shortlink-wrapped URLs, not the originals.
    expect(message.body).toContain("https://go.hasna.example/");
    expect(message.body).not.toContain("https://www.npmjs.com/package/");
    expect(message.textBody).toContain("Changelog: https://go.hasna.example/");
  });

  it("renders a telegram broadcast post in markdown", async () => {
    const message = renderTelegram(campaign, await links("telegram"));
    expect(message.format).toBe("markdown");
    expect(message.body).toContain("`@hasna/todos@1.2.3`");
    expect(message.body).toContain("• Faster sync");
    expect(message.body).toMatch(/\[Changelog\]\(https:\/\/go\.hasna\.example\/[0-9a-f]{8}\)/);
  });

  it("renders a conversations channel message", async () => {
    const message = renderConversations(campaign, await links("conversations"));
    expect(message.body).toContain("## open-todos 1.2.3 released");
    expect(message.body).toContain("(abc1234)");
    expect(message.body).toContain("- Faster sync");
  });

  it("renders a short-form sms capped at 320 chars with one shortlink", async () => {
    const message = renderSms(campaign, await links("sms"));
    expect(message.format).toBe("text");
    expect(message.body.length).toBeLessThanOrEqual(320);
    expect(message.body).toContain("https://go.hasna.example/");
    expect(message.links).toHaveLength(1);
  });

  it("dispatches through renderChannel and shortens per channel", async () => {
    const emailLinks = await links("email");
    const telegramLinks = await links("telegram");
    // Same URL shortens to different slugs per channel (per-channel attribution).
    expect(emailLinks[0]!.slug).not.toBe(telegramLinks[0]!.slug);
    const message = renderChannel("telegram", campaign, telegramLinks);
    expect(message.channel).toBe("telegram");
  });
});
