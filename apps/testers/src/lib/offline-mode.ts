import type { Page, BrowserContext } from "playwright";

export type ThrottleProfile = {
  download: number; // bytes per second
  upload: number; // bytes per second
  latency: number; // ms
  label: string;
};

export const THROTTLE_PROFILES: Record<string, ThrottleProfile> = {
  "3g": { download: 1600000, upload: 768000, latency: 150, label: "3G" },
  "4g": { download: 9000000, upload: 9000000, latency: 40, label: "4G" },
  "slow-3g": { download: 500000, upload: 500000, latency: 400, label: "Slow 3G" },
  "fast-3g": { download: 1500000, upload: 750000, latency: 150, label: "Fast 3G" },
};

/**
 * Take the browser offline by aborting all network requests.
 */
export async function goOffline(context: BrowserContext): Promise<void> {
  await context.setOffline(true);
}

/**
 * Bring the browser back online.
 */
export async function goOnline(context: BrowserContext): Promise<void> {
  await context.setOffline(false);
}

/**
 * Test if a page handles offline state gracefully.
 * Returns true if the page showed an offline indicator.
 */
export async function testOfflineHandling(page: Page, timeout = 5000): Promise<boolean> {
  const context = page.context();
  await goOffline(context);

  // Wait a moment for the app to detect offline state
  await page.waitForTimeout(500);

  // Try to check for offline indicators
  try {
    const hasOfflineIndicator = await Promise.race([
      page.evaluate(() => {
        const body = document.body.textContent ?? "";
        return /offline|no.?connection|network error|you'?re offline/i.test(body);
      }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeout)),
    ]);

    await goOnline(context);
    return !!hasOfflineIndicator;
  } catch {
    await goOnline(context);
    return false;
  }
}

/**
 * Enable throttling via CDP (Chromium DevTools Protocol).
 * Only works with Chromium/Playwright.
 */
export async function enableThrottling(context: BrowserContext, profile: ThrottleProfile | keyof typeof THROTTLE_PROFILES): Promise<void> {
  const p = typeof profile === "string" ? THROTTLE_PROFILES[profile] : profile;
  if (!p) throw new Error(`Unknown throttle profile. Available: ${Object.keys(THROTTLE_PROFILES).join(", ")}`);

  const pages = context.pages();
  if (pages.length === 0) return;

  const cdpSession = await pages[0].context().newCDPSession(pages[0]);
  await cdpSession.send("Network.enable");
  await cdpSession.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: p.latency,
    downloadThroughput: p.download,
    uploadThroughput: p.upload,
  });
}

/**
 * Disable CDP-based throttling (re-enable normal network).
 */
export async function disableThrottling(context: BrowserContext): Promise<void> {
  const pages = context.pages();
  if (pages.length === 0) return;

  const cdpSession = await context.newCDPSession(pages[0]);
  await cdpSession.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1, // disabled
    uploadThroughput: -1,
  });
}
