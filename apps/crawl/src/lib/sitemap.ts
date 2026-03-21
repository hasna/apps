// ─── Types ────────────────────────────────────────────────────────────────────

export interface SitemapEntry {
  url: string;
  lastmod: string | null;
  changefreq: string | null;
  priority: number | null;
}

// ─── XML parsing helpers ──────────────────────────────────────────────────────

function getTagValues(xml: string, tag: string): string[] {
  const values: string[] = [];
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\/${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(xml)) !== null) {
    const val = m[1]?.trim() ?? "";
    if (val) values.push(val);
  }
  return values;
}

function getTagValue(xml: string, tag: string): string | null {
  const values = getTagValues(xml, tag);
  return values[0] ?? null;
}

function isGzipped(contentType: string): boolean {
  return (
    contentType.includes("gzip") ||
    contentType.includes("x-gzip") ||
    contentType.includes("application/x-gzip")
  );
}

// ─── Sitemap parser ───────────────────────────────────────────────────────────

function parseSitemapXml(xml: string): {
  entries: SitemapEntry[];
  sitemapUrls: string[];
} {
  const entries: SitemapEntry[] = [];
  const sitemapUrls: string[] = [];

  // Detect sitemap index
  const isSitemapIndex = /<sitemapindex/i.test(xml);

  if (isSitemapIndex) {
    // Extract referenced sitemap URLs
    const sitemapBlocks = xml.match(/<sitemap>[\s\S]*?<\/sitemap>/gi) ?? [];
    for (const block of sitemapBlocks) {
      const loc = getTagValue(block, "loc");
      if (loc) sitemapUrls.push(loc);
    }
    return { entries, sitemapUrls };
  }

  // Regular sitemap
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/gi) ?? [];
  for (const block of urlBlocks) {
    const loc = getTagValue(block, "loc");
    if (!loc) continue;

    const lastmod = getTagValue(block, "lastmod");
    const changefreq = getTagValue(block, "changefreq");
    const priorityRaw = getTagValue(block, "priority");
    const priority =
      priorityRaw !== null ? parseFloat(priorityRaw) : null;

    entries.push({
      url: loc,
      lastmod,
      changefreq,
      priority: priority !== null && !isNaN(priority) ? priority : null,
    });
  }

  return { entries, sitemapUrls };
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

async function fetchSitemapUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "open-crawl/1.0",
        Accept: "application/xml,text/xml,*/*",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";

    if (isGzipped(contentType)) {
      // Bun supports DecompressionStream for gzip
      const buffer = await response.arrayBuffer();
      try {
        const ds = new DecompressionStream("gzip");
        const writer = ds.writable.getWriter();
        const reader = ds.readable.getReader();
        writer.write(new Uint8Array(buffer));
        writer.close();

        const chunks: Uint8Array[] = [];
        let done = false;
        while (!done) {
          const result = await reader.read();
          done = result.done;
          if (result.value) chunks.push(result.value);
        }

        const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return new TextDecoder().decode(merged);
      } catch {
        // Fall back to raw
        return new TextDecoder().decode(buffer);
      }
    }

    return await response.text();
  } catch {
    return null;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchSitemap(
  url: string
): Promise<SitemapEntry[]> {
  const MAX_URLS = 10_000;
  const MAX_DEPTH = 5;

  const allEntries: SitemapEntry[] = [];
  const visited = new Set<string>();

  async function fetchRecursive(
    sitemapUrl: string,
    depth: number
  ): Promise<void> {
    if (depth > MAX_DEPTH) return;
    if (visited.has(sitemapUrl)) return;
    if (allEntries.length >= MAX_URLS) return;

    visited.add(sitemapUrl);

    const xml = await fetchSitemapUrl(sitemapUrl);
    if (!xml) return;

    const { entries, sitemapUrls } = parseSitemapXml(xml);

    // Add URL entries up to the cap
    for (const entry of entries) {
      if (allEntries.length >= MAX_URLS) break;
      allEntries.push(entry);
    }

    // Recursively fetch referenced sitemaps
    for (const childUrl of sitemapUrls) {
      if (allEntries.length >= MAX_URLS) break;
      await fetchRecursive(childUrl, depth + 1);
    }
  }

  await fetchRecursive(url, 0);
  return allEntries;
}
