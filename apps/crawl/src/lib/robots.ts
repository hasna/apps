// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedRobots {
  isAllowed: (url: string) => boolean;
  crawlDelay: number;
  sitemaps: string[];
}

interface RulesEntry {
  userAgents: string[];
  disallow: string[];
  allow: string[];
  crawlDelay: number;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const cache = new Map<string, ParsedRobots>();

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseRobotsTxt(
  text: string,
  requestingUserAgent: string
): ParsedRobots {
  const sitemaps: string[] = [];
  const entries: RulesEntry[] = [];
  let currentEntry: RulesEntry | null = null;
  let globalCrawlDelay = 0;

  const ua = requestingUserAgent.toLowerCase().split("/")[0]?.trim() ?? "*";

  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip comments and empty lines
    if (!line || line.startsWith("#")) {
      // End of block when empty line encountered and we have an entry
      if (!line && currentEntry) {
        entries.push(currentEntry);
        currentEntry = null;
      }
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === "user-agent") {
      if (!currentEntry) {
        currentEntry = { userAgents: [], disallow: [], allow: [], crawlDelay: 0 };
      }
      currentEntry.userAgents.push(value.toLowerCase());
    } else if (field === "disallow") {
      if (currentEntry) currentEntry.disallow.push(value);
    } else if (field === "allow") {
      if (currentEntry) currentEntry.allow.push(value);
    } else if (field === "crawl-delay") {
      const delay = parseFloat(value);
      if (!isNaN(delay)) {
        if (currentEntry) {
          currentEntry.crawlDelay = delay * 1000; // convert to ms
        } else {
          globalCrawlDelay = delay * 1000;
        }
      }
    } else if (field === "sitemap") {
      if (value) sitemaps.push(value);
    }
  }

  // Flush last entry
  if (currentEntry) {
    entries.push(currentEntry);
  }

  // Find applicable rules: prefer exact ua match, fall back to wildcard
  const matchingEntries = entries.filter(
    (e) =>
      e.userAgents.includes(ua) ||
      e.userAgents.includes("*")
  );

  // Sort so specific matches come before wildcards
  matchingEntries.sort((a, b) => {
    const aSpecific = a.userAgents.includes(ua) ? 1 : 0;
    const bSpecific = b.userAgents.includes(ua) ? 1 : 0;
    return bSpecific - aSpecific;
  });

  // Merge rules: specific user-agent wins over wildcard
  const disallowRules: string[] = [];
  const allowRules: string[] = [];
  let crawlDelay = globalCrawlDelay;

  for (const entry of matchingEntries) {
    disallowRules.push(...entry.disallow);
    allowRules.push(...entry.allow);
    if (entry.crawlDelay > 0) crawlDelay = entry.crawlDelay;
  }

  function pathMatches(pattern: string, urlPath: string): boolean {
    if (!pattern) return false;

    // Escape regex special chars except * and $
    const escaped = pattern
      .replace(/[.+?^{}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");

    const regex = new RegExp(`^${escaped}`);
    return regex.test(urlPath);
  }

  function isAllowed(url: string): boolean {
    let urlPath = "/";
    try {
      urlPath = new URL(url).pathname;
    } catch {
      urlPath = url;
    }

    // Find most specific matching rule (longest pattern wins)
    let bestLength = -1;
    let bestAllowed = true;

    for (const pattern of disallowRules) {
      if (pathMatches(pattern, urlPath)) {
        if (pattern.length > bestLength) {
          bestLength = pattern.length;
          bestAllowed = false;
        }
      }
    }

    for (const pattern of allowRules) {
      if (pathMatches(pattern, urlPath)) {
        if (pattern.length > bestLength) {
          bestLength = pattern.length;
          bestAllowed = true;
        }
      }
    }

    // If no rules matched, allow
    return bestAllowed;
  }

  return { isAllowed, crawlDelay, sitemaps };
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

export async function fetchRobotsTxt(
  domain: string,
  userAgent = "open-crawl"
): Promise<ParsedRobots> {
  const cacheKey = `${domain}:${userAgent}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const urls = [
    `https://${domain}/robots.txt`,
    `http://${domain}/robots.txt`,
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) continue;

      const text = await response.text();
      const parsed = parseRobotsTxt(text, userAgent);
      cache.set(cacheKey, parsed);
      return parsed;
    } catch {
      // Try next URL
    }
  }

  // Fallback: allow everything
  const fallback: ParsedRobots = {
    isAllowed: () => true,
    crawlDelay: 0,
    sitemaps: [],
  };
  cache.set(cacheKey, fallback);
  return fallback;
}
