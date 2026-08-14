import { createHash } from "node:crypto";
import type { CampaignLink, ShortenedLink } from "../types.js";

export interface ShortenOptions {
  campaignId?: string;
  channel?: string;
  label?: string;
}

/**
 * Adapter interface for shortlink providers. `@hasna/shortlinks` is wired in
 * automatically when installed (optional peer dependency); tests and dry-runs
 * use {@link MockShortlinkAdapter}.
 */
export interface ShortlinkAdapter {
  shorten(url: string, options?: ShortenOptions): Promise<{ shortUrl: string; slug: string }>;
}

/** Deterministic in-memory adapter for tests and dry-runs. */
export class MockShortlinkAdapter implements ShortlinkAdapter {
  readonly baseUrl: string;
  readonly calls: Array<{ url: string; options?: ShortenOptions }> = [];

  constructor(baseUrl = "https://go.hasna.example") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async shorten(url: string, options?: ShortenOptions): Promise<{ shortUrl: string; slug: string }> {
    this.calls.push({ url, options });
    const slug = createHash("sha256")
      .update(`${options?.campaignId ?? ""}:${options?.channel ?? ""}:${url}`)
      .digest("hex")
      .slice(0, 8);
    return { shortUrl: `${this.baseUrl}/${slug}`, slug };
  }
}

/** Pass-through adapter: original URLs, no shortening. */
export class NoopShortlinkAdapter implements ShortlinkAdapter {
  async shorten(url: string): Promise<{ shortUrl: string; slug: string }> {
    return { shortUrl: url, slug: "" };
  }
}

interface ShortlinksModuleLike {
  ShortlinksStore: new (dbPath?: string) => {
    createLink(input: {
      destinationUrl: string;
      title?: string;
      metadata?: Record<string, unknown>;
    }): { slug: string; short_url?: string; hostname: string };
    close(): void;
  };
}

/**
 * Real adapter backed by `@hasna/shortlinks` (loaded lazily so the package
 * stays an optional peer dependency). Throws when the package is not
 * installed or no shortlink domain is configured.
 */
export class ShortlinksPackageAdapter implements ShortlinkAdapter {
  private modulePromise: Promise<ShortlinksModuleLike> | null = null;

  private loadModule(): Promise<ShortlinksModuleLike> {
    if (!this.modulePromise) {
      const moduleName = "@hasna/shortlinks";
      this.modulePromise = import(moduleName) as Promise<ShortlinksModuleLike>;
    }
    return this.modulePromise;
  }

  async shorten(url: string, options?: ShortenOptions): Promise<{ shortUrl: string; slug: string }> {
    const { ShortlinksStore } = await this.loadModule();
    const store = new ShortlinksStore();
    try {
      const link = store.createLink({
        destinationUrl: url,
        title: options?.label,
        metadata: {
          campaignId: options?.campaignId,
          channel: options?.channel,
          sourcePackage: "@hasna/announce",
        },
      });
      return { shortUrl: link.short_url ?? `https://${link.hostname}/${link.slug}`, slug: link.slug };
    } finally {
      store.close();
    }
  }
}

/**
 * Resolve the best available adapter: `@hasna/shortlinks` when importable,
 * otherwise the pass-through adapter.
 */
export async function resolveShortlinkAdapter(): Promise<ShortlinkAdapter> {
  try {
    const adapter = new ShortlinksPackageAdapter();
    // Probe the import only; do not create links yet.
    await (adapter as unknown as { loadModule(): Promise<unknown> }).loadModule();
    return adapter;
  } catch {
    return new NoopShortlinkAdapter();
  }
}

/** Shorten every campaign link for one channel. */
export async function shortenLinks(
  links: CampaignLink[],
  adapter: ShortlinkAdapter,
  options: Omit<ShortenOptions, "label"> = {},
): Promise<ShortenedLink[]> {
  const shortened: ShortenedLink[] = [];
  for (const link of links) {
    const result = await adapter.shorten(link.url, { ...options, label: link.label });
    shortened.push({ label: link.label, originalUrl: link.url, shortUrl: result.shortUrl, slug: result.slug });
  }
  return shortened;
}
