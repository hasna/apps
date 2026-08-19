// Agent-authored (TEST-GAP protocol): the gpt-5.6-sol consult terminated twice without delivering a spec (session died mid-audit; resume timed out), so the additions to this file carry no SOL attribution.
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

  it("renderChannel fails loudly for a channel with no renderer", async () => {
    expect(() => renderChannel("carrier-pigeon" as never, campaign, [])).toThrow(/No renderer for channel/);
  });
});

describe("renderSms edge conditions", () => {
  const longTitleCampaign = composeAnnouncementCampaign({
    release,
    audience: { audienceId: "developers" },
    channels: ["sms"],
    title: "T".repeat(300),
  });
  // suffix " https://go.hasna.example/abcdef12" is 41 chars -> headline budget 279.
  const link = { label: "Package", originalUrl: "https://www.npmjs.com/package/x", shortUrl: "https://go.hasna.example/abcdef12", slug: "abcdef12" };

  it("truncates an over-budget headline with a single ellipsis and stays exactly within the cap", () => {
    const message = renderSms(longTitleCampaign, [link]);
    expect(message.body.length).toBe(320);
    expect(message.body.endsWith("… https://go.hasna.example/abcdef12")).toBe(true);
    // Exactly one ellipsis in the whole body.
    expect(message.body.match(/…/g)).toHaveLength(1);
  });

  it("does not truncate a headline that fits the budget exactly", () => {
    // suffix " https://go.hasna.example/abcdef12" is 34 chars -> budget 286.
    // headline = `${title} (1.2.3)` is 8 chars over the raw title, so a 278-char
    // title lands exactly on the 286-char budget.
    const title = "T".repeat(278);
    const campaign = composeAnnouncementCampaign({
      release,
      audience: { audienceId: "developers" },
      channels: ["sms"],
      title,
    });
    const message = renderSms(campaign, [link]);
    expect(message.body).toBe(`${title} (1.2.3) https://go.hasna.example/abcdef12`);
    expect(message.body.length).toBe(320);
    expect(message.body).not.toContain("…");
  });

  it("renders the bare headline when there are no links", () => {
    const message = renderSms(campaign, []);
    expect(message.body).toBe("open-todos 1.2.3 released (1.2.3)");
    expect(message.links).toEqual([]);
  });

  it("PINNED BEHAVIOR: the 320-char cap is breached when the link itself exceeds the budget", () => {
    // renderSms computes `budget = SMS_MAX_LENGTH - suffix.length` and clamps the
    // headline slice to >= 0, but never drops or truncates the link. A shortUrl
    // longer than 320 chars therefore produces a body longer than SMS_MAX_LENGTH.
    // This test pins the current behavior; enforcing the cap in the renderer is
    // a land-phase fix decision (drop the link vs hard-truncate the URL).
    const longUrl = `https://go.hasna.example/${"a".repeat(400)}`;
    const link = { label: "Package", originalUrl: "x", shortUrl: longUrl, slug: "s" };
    const message = renderSms(campaign, [link]);
    expect(message.body.length).toBeGreaterThan(320);
    expect(message.body).toBe(`… ${longUrl}`);
  });
});

describe("renderTelegram escaping", () => {
  const hostile = composeAnnouncementCampaign({
    release,
    audience: { audienceId: "developers" },
    channels: ["telegram"],
    title: "Release *_[`]( )_* and back\\slash",
    summary: "Summary with *stars* and _underscores_ and `code` and [brackets](parens)",
    highlights: ["Highlight with *bold* and _under_"],
  });

  it("escapes markdown-significant characters in title, summary, and highlights", () => {
    const message = renderTelegram(hostile, []);
    // Every special char must be backslash-escaped inside the bold title,
    // including the space-separated paren pair "( )".
    expect(message.body).toContain("\\*\\_\\[\\`\\]\\( \\)\\_\\*");
    expect(message.body).toContain("Summary with \\*stars\\* and \\_underscores\\_ and \\`code\\` and \\[brackets\\]\\(parens\\)");
    expect(message.body).toContain("Highlight with \\*bold\\* and \\_under\\_");
  });

  it("PINNED BEHAVIOR: backslash itself passes through unescaped", () => {
    // escapeMarkdown escapes `_ * [ ] ( ) ` and backticks but not backslash,
    // so a backslash in user content can still act as a markdown escape
    // character downstream. Pinned so a future hardening is a visible change.
    const message = renderTelegram(hostile, []);
    expect(message.body).toContain("and back\\slash");
  });

  it("escapes link labels but passes link URLs through verbatim", async () => {
    const message = renderTelegram(campaign, [
      { label: "Release *notes*", originalUrl: "https://example.com/a?x=1&y=2", shortUrl: "https://go.hasna.example/abc12345", slug: "abc12345" },
    ]);
    expect(message.body).toContain("[Release \\*notes\\*](https://go.hasna.example/abc12345)");
    expect(message.body).not.toContain("*notes*");
  });
});

describe("renderEmail escaping and optional sections", () => {
  it("escapes quotes and ampersands in titles, summaries, highlights, and link hrefs", async () => {
    const hostile = composeAnnouncementCampaign({
      release,
      audience: { audienceId: "developers", name: 'Dev "Core" & <Friends>' },
      channels: ["email"],
      title: 'Release "2.0" & <final>',
      summary: 'Summary with "quotes" & <angle>',
      highlights: ['Feature "A" & <B>'],
    });
    const message = renderEmail(hostile, [
      { label: 'Docs & "Guide"', originalUrl: "https://example.com/a?x=1&y=2", shortUrl: "https://go.hasna.example/abc12345", slug: "abc12345" },
    ]);
    expect(message.body).toContain("Release &quot;2.0&quot; &amp; &lt;final&gt;");
    expect(message.body).toContain("Summary with &quot;quotes&quot; &amp; &lt;angle&gt;");
    expect(message.body).toContain("Feature &quot;A&quot; &amp; &lt;B&gt;");
    // href is attribute-escaped: & and quotes cannot break out of the attribute.
    expect(message.body).toContain('href="https://go.hasna.example/abc12345"');
    expect(message.body).toContain("&lt;Friends&gt;");
    expect(message.body).not.toContain('"2.0" & <final>');
    // The plain-text alternative is deliberately NOT escaped — it is text, not markup.
    expect(message.textBody).toContain('Release "2.0" & <final>');
    expect(message.textBody).toContain("Feature \"A\" & <B>");
  });

  it("omits the highlights and summary sections entirely when absent", () => {
    const bare = composeAnnouncementCampaign({
      release,
      audience: { audienceId: "developers" },
      channels: ["email"],
    });
    const message = renderEmail(bare, []);
    expect(message.body).not.toContain("<ul");
    expect(message.body).not.toContain("line-height:1.5");
    // Audience name missing -> the audienceId is the fallback in the footer.
    expect(message.body).toContain("in the developers audience");
  });
});

describe("renderConversations edge conditions", () => {
  it("truncates the release sha to 7 characters and drops empty sections", () => {
    const longSha = composeAnnouncementCampaign({
      release: { ...release, gitSha: "a".repeat(40) },
      audience: { audienceId: "developers" },
      channels: ["conversations"],
    });
    const message = renderConversations(longSha, []);
    expect(message.body).toContain(`(${"a".repeat(7)})`);
    expect(message.body).not.toContain("Highlights:");
    expect(message.body).not.toContain("- [");
  });

  it("emits one markdown link line per shortened link", async () => {
    const message = renderConversations(campaign, [
      { label: "Changelog", originalUrl: "https://example.com/c", shortUrl: "https://go.hasna.example/abcdef12", slug: "abcdef12" },
      { label: "Package", originalUrl: "https://www.npmjs.com/package/x", shortUrl: "https://go.hasna.example/34567890", slug: "34567890" },
    ]);
    expect(message.body).toContain("- [Changelog](https://go.hasna.example/abcdef12)");
    expect(message.body).toContain("- [Package](https://go.hasna.example/34567890)");
  });
});
