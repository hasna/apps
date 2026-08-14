/**
 * Deep performance metrics — resource breakdown, third-party analysis, DOM complexity.
 */

import type { Page } from "playwright";

export interface DeepPerformance {
  web_vitals: { fcp?: number; lcp?: number; cls?: number; ttfb?: number; inp?: number };
  resources: {
    total_transfer_bytes: number;
    total_resources: number;
    by_type: Record<string, { count: number; size_bytes: number }>;
    largest: Array<{ url: string; size_bytes: number; type: string }>;
  };
  third_party: Array<{ domain: string; scripts: number; total_bytes: number; category: string }>;
  dom: {
    node_count: number;
    max_depth: number;
    element_count: number;
    text_node_count: number;
  };
  main_thread: {
    long_tasks: number;
    total_blocking_ms: number;
  };
  memory: {
    js_heap_used_mb: number;
    js_heap_total_mb: number;
    js_heap_limit_mb: number;
  };
}

const THIRD_PARTY_CATEGORIES: Record<string, string> = {
  "google-analytics.com": "analytics", "googletagmanager.com": "analytics", "gtag": "analytics",
  "facebook.net": "social", "connect.facebook": "social",
  "stripe.com": "payment", "js.stripe.com": "payment",
  "sentry.io": "monitoring", "sentry-cdn": "monitoring",
  "posthog.com": "analytics", "ph.": "analytics",
  "intercom.io": "chat", "crisp.chat": "chat",
  "hotjar.com": "analytics", "clarity.ms": "analytics",
  "cdn.jsdelivr.net": "cdn", "cdnjs.cloudflare.com": "cdn", "unpkg.com": "cdn",
  "fonts.googleapis.com": "fonts", "fonts.gstatic.com": "fonts",
};

function categorizeThirdParty(domain: string): string {
  for (const [pattern, category] of Object.entries(THIRD_PARTY_CATEGORIES)) {
    if (domain.includes(pattern)) return category;
  }
  return "other";
}

export async function getDeepPerformance(page: Page): Promise<DeepPerformance> {
  return page.evaluate(() => {
    const perf = performance;
    const entries = perf.getEntriesByType("resource") as PerformanceResourceTiming[];
    const navEntry = perf.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const paintEntries = perf.getEntriesByType("paint");

    // Web Vitals
    const fcp = paintEntries.find(e => e.name === "first-contentful-paint")?.startTime;
    const ttfb = navEntry?.responseStart;
    const web_vitals: any = { fcp, ttfb };

    // Try to get LCP from PerformanceObserver entries
    try {
      const lcpEntries = perf.getEntriesByType("largest-contentful-paint") as any[];
      if (lcpEntries.length > 0) web_vitals.lcp = lcpEntries[lcpEntries.length - 1].startTime;
    } catch {}

    // Resources breakdown
    const byType: Record<string, { count: number; size_bytes: number }> = {};
    let totalBytes = 0;
    const resourceList: Array<{ url: string; size_bytes: number; type: string }> = [];
    const pageDomain = location.hostname;

    const thirdPartyMap = new Map<string, { scripts: number; total_bytes: number }>();

    for (const entry of entries) {
      const size = entry.transferSize || entry.encodedBodySize || 0;
      totalBytes += size;

      // Determine type from initiatorType
      let type = entry.initiatorType || "other";
      if (type === "xmlhttprequest" || type === "fetch") type = "xhr";
      if (type === "link" && entry.name.match(/\.css/)) type = "css";
      if (type === "img" || entry.name.match(/\.(png|jpg|jpeg|gif|svg|webp|avif|ico)/i)) type = "image";
      if (type === "script" || entry.name.match(/\.js/)) type = "script";
      if (entry.name.match(/\.(woff2?|ttf|otf|eot)/i)) type = "font";

      if (!byType[type]) byType[type] = { count: 0, size_bytes: 0 };
      byType[type].count++;
      byType[type].size_bytes += size;

      resourceList.push({ url: entry.name, size_bytes: size, type });

      // Third-party detection
      try {
        const domain = new URL(entry.name).hostname;
        if (domain !== pageDomain && !domain.endsWith(`.${pageDomain}`)) {
          if (!thirdPartyMap.has(domain)) thirdPartyMap.set(domain, { scripts: 0, total_bytes: 0 });
          const tp = thirdPartyMap.get(domain)!;
          tp.scripts++;
          tp.total_bytes += size;
        }
      } catch {}
    }

    // Largest resources
    resourceList.sort((a, b) => b.size_bytes - a.size_bytes);
    const largest = resourceList.slice(0, 10).map(r => ({
      url: r.url.length > 120 ? r.url.slice(0, 117) + "..." : r.url,
      size_bytes: r.size_bytes,
      type: r.type,
    }));

    // Third-party summary
    const third_party = Array.from(thirdPartyMap.entries())
      .map(([domain, data]) => ({ domain, ...data, category: "" }))
      .sort((a, b) => b.total_bytes - a.total_bytes)
      .slice(0, 15);

    // DOM complexity
    const allNodes = document.querySelectorAll("*");
    let maxDepth = 0;
    let textNodes = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ALL);
    let node: Node | null = walker.currentNode;
    while (node) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) textNodes++;
      let depth = 0;
      let parent = node.parentNode;
      while (parent) { depth++; parent = parent.parentNode; }
      if (depth > maxDepth) maxDepth = depth;
      node = walker.nextNode();
    }

    // Memory
    const mem = (performance as any).memory;
    const memory = {
      js_heap_used_mb: mem ? Math.round(mem.usedJSHeapSize / 1024 / 1024 * 100) / 100 : 0,
      js_heap_total_mb: mem ? Math.round(mem.totalJSHeapSize / 1024 / 1024 * 100) / 100 : 0,
      js_heap_limit_mb: mem ? Math.round(mem.jsHeapSizeLimit / 1024 / 1024 * 100) / 100 : 0,
    };

    return {
      web_vitals,
      resources: { total_transfer_bytes: totalBytes, total_resources: entries.length, by_type: byType, largest },
      third_party,
      dom: { node_count: document.all.length, max_depth: maxDepth, element_count: allNodes.length, text_node_count: textNodes },
      main_thread: { long_tasks: 0, total_blocking_ms: 0 },
      memory,
    };
  }).then(result => {
    // Add third-party categories server-side
    for (const tp of result.third_party) {
      tp.category = categorizeThirdParty(tp.domain);
    }
    return result;
  });
}
