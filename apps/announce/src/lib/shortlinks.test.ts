import { describe, expect, it } from "bun:test";
import {
  MockShortlinkAdapter,
  NoopShortlinkAdapter,
  shortenLinks,
  type ShortlinkAdapter,
} from "./shortlinks.js";

describe("MockShortlinkAdapter", () => {
  it("normalizes trailing slashes without changing an explicit path prefix", async () => {
    const adapter = new MockShortlinkAdapter("https://links.example/releases///");

    const result = await adapter.shorten("https://example.com/changelog", {
      campaignId: "campaign-1",
      channel: "email",
    });

    expect(result.shortUrl).toBe(`https://links.example/releases/${result.slug}`);
    expect(result.shortUrl).not.toContain("//" + result.slug);
  });

  it("is deterministic for the same campaign, channel, and URL", async () => {
    const adapter = new MockShortlinkAdapter();
    const options = { campaignId: "campaign-1", channel: "email", label: "First" };

    const first = await adapter.shorten("https://example.com/release", options);
    const second = await adapter.shorten("https://example.com/release", {
      ...options,
      label: "Renamed",
    });

    expect(first).toEqual(second);
    expect(first.slug).toMatch(/^[0-9a-f]{8}$/);
  });

  it("separates attribution dimensions while recording every call", async () => {
    const adapter = new MockShortlinkAdapter();
    const url = "https://example.com/release";

    const email = await adapter.shorten(url, { campaignId: "campaign-1", channel: "email" });
    const sms = await adapter.shorten(url, { campaignId: "campaign-1", channel: "sms" });
    const otherCampaign = await adapter.shorten(url, {
      campaignId: "campaign-2",
      channel: "email",
    });

    expect(new Set([email.slug, sms.slug, otherCampaign.slug]).size).toBe(3);
    expect(adapter.calls).toEqual([
      { url, options: { campaignId: "campaign-1", channel: "email" } },
      { url, options: { campaignId: "campaign-1", channel: "sms" } },
      { url, options: { campaignId: "campaign-2", channel: "email" } },
    ]);
  });
});

describe("NoopShortlinkAdapter", () => {
  it("preserves the original URL and uses an empty slug", async () => {
    const adapter = new NoopShortlinkAdapter();
    const url = "https://example.com/release?source=announce#details";

    await expect(adapter.shorten(url)).resolves.toEqual({ shortUrl: url, slug: "" });
  });
});

describe("shortenLinks", () => {
  it("preserves input order and forwards each label without mutating input", async () => {
    const links = [
      { label: "Changelog", url: "https://example.com/changelog" },
      { label: "Package", url: "https://example.com/package" },
    ];
    const original = structuredClone(links);
    const adapter = new MockShortlinkAdapter();

    const result = await shortenLinks(links, adapter, {
      campaignId: "campaign-1",
      channel: "telegram",
    });

    expect(result.map((link) => link.label)).toEqual(["Changelog", "Package"]);
    expect(result.map((link) => link.originalUrl)).toEqual(links.map((link) => link.url));
    expect(adapter.calls.map((call) => call.options?.label)).toEqual(["Changelog", "Package"]);
    expect(links).toEqual(original);
  });

  it("returns an empty result without calling the adapter", async () => {
    let calls = 0;
    const adapter: ShortlinkAdapter = {
      async shorten(url) {
        calls += 1;
        return { shortUrl: url, slug: "unused" };
      },
    };

    await expect(shortenLinks([], adapter)).resolves.toEqual([]);
    expect(calls).toBe(0);
  });

  it("stops at the first adapter failure and does not emit a partial result", async () => {
    const visited: string[] = [];
    const adapter: ShortlinkAdapter = {
      async shorten(url) {
        visited.push(url);
        if (url.endsWith("/second")) throw new Error("adapter unavailable");
        return { shortUrl: `${url}/short`, slug: "slug" };
      },
    };
    const links = [
      { label: "First", url: "https://example.com/first" },
      { label: "Second", url: "https://example.com/second" },
      { label: "Third", url: "https://example.com/third" },
    ];

    await expect(shortenLinks(links, adapter)).rejects.toThrow("adapter unavailable");
    expect(visited).toEqual(["https://example.com/first", "https://example.com/second"]);
  });
});
