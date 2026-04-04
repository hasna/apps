import type { Page, BrowserContext } from "playwright";

/**
 * Device presets for mobile/responsive testing.
 */
export const DEVICE_PRESETS: Record<string, { viewport: { width: number; height: number }; userAgent: string; deviceScaleFactor?: number }> = {
  // Mobile phones
  "iphone-se": { viewport: { width: 375, height: 667 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1", deviceScaleFactor: 2 },
  "iphone-14": { viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1", deviceScaleFactor: 3 },
  "iphone-14-pro-max": { viewport: { width: 430, height: 932 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1", deviceScaleFactor: 3 },
  "pixel-7": { viewport: { width: 412, height: 915 }, userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36", deviceScaleFactor: 2.625 },
  "samsung-s23": { viewport: { width: 360, height: 780 }, userAgent: "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36", deviceScaleFactor: 3 },

  // Tablets
  "ipad": { viewport: { width: 768, height: 1024 }, userAgent: "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1", deviceScaleFactor: 2 },
  "ipad-pro": { viewport: { width: 1024, height: 1366 }, userAgent: "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1", deviceScaleFactor: 2 },
  "pixel-tablet": { viewport: { width: 912, height: 1368 }, userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36", deviceScaleFactor: 2 },

  // Desktop
  "desktop": { viewport: { width: 1280, height: 720 }, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36" },
  "desktop-wide": { viewport: { width: 1920, height: 1080 }, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36" },
  "desktop-large": { viewport: { width: 2560, height: 1440 }, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36" },

  // Common breakpoints
  "mobile": { viewport: { width: 375, height: 667 }, userAgent: "" },
  "tablet": { viewport: { width: 768, height: 1024 }, userAgent: "" },
  "laptop": { viewport: { width: 1366, height: 768 }, userAgent: "" },
};

export type DevicePreset = keyof typeof DEVICE_PRESETS;

/**
 * Resize the browser viewport to a specific device preset.
 */
export async function setDevicePreset(page: Page, deviceName: string): Promise<void> {
  const preset = DEVICE_PRESETS[deviceName];
  if (!preset) {
    throw new Error(`Unknown device preset: "${deviceName}". Available: ${Object.keys(DEVICE_PRESETS).join(", ")}`);
  }

  const context = page.context();
  await context.setViewportSize(preset.viewport);

  if (preset.userAgent) {
    // Note: user agent can only be set at context creation time in Playwright.
    // We set a meta tag-based override via initScript instead.
    await context.addInitScript((ua) => {
      Object.defineProperty(navigator, "userAgent", { get: () => ua });
    }, preset.userAgent);
  }

  if (preset.deviceScaleFactor) {
    await context.addInitScript((factor) => {
      Object.defineProperty(window, "devicePixelRatio", { value: factor, configurable: true });
    }, preset.deviceScaleFactor);
  }

  // Reload the page to apply UA/device changes
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
}

/**
 * Resize the viewport to custom dimensions.
 */
export async function setViewport(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
}

/**
 * Capture screenshots at multiple breakpoints for responsive testing.
 */
export async function captureResponsiveScreenshots(
  page: Page,
  breakpoints: { name: string; width: number; height: number }[],
): Promise<Array<{ name: string; width: number; height: number; screenshot: Buffer }>> {
  const results: Array<{ name: string; width: number; height: number; screenshot: Buffer }> = [];

  for (const bp of breakpoints) {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    // Wait for layout to settle
    await page.waitForTimeout(500);
    const screenshot = await page.screenshot();
    results.push({ name: bp.name, width: bp.width, height: bp.height, screenshot });
  }

  return results;
}

/**
 * Check if the current viewport is mobile (width < 768).
 */
export function isMobileViewport(page: Page): boolean {
  return page.viewportSize()?.width != null && page.viewportSize()!.width < 768;
}

/**
 * Get a list of all available device preset names.
 */
export function listDevicePresets(): string[] {
  return Object.keys(DEVICE_PRESETS);
}
