import type { Page } from "playwright";

export interface BatchAction {
  /** Unique identifier for this action within the batch */
  id: string;
  /** Type of browser action to perform */
  type: "click" | "type" | "fill" | "press" | "scroll" | "evaluate" | "screenshot" | "wait";
  /** CSS selector target (not needed for scroll/evaluate/screenshot) */
  selector?: string;
  /** Text/value to type or fill */
  value?: string;
  /** Key to press (for type=press) */
  key?: string;
  /** Scroll amount in pixels (for type=scroll) */
  scrollAmount?: number;
  /** JS to evaluate (for type=evaluate) */
  script?: string;
  /** Timeout for this action in ms */
  timeout?: number;
}

export interface BatchActionResult {
  id: string;
  status: "passed" | "failed" | "timeout";
  durationMs: number;
  error?: string;
  value?: unknown; // for evaluate results
  screenshotBuffer?: Buffer; // for screenshot results
}

/**
 * Execute multiple browser actions in parallel on the same page.
 * This speeds up multi-step tests that have independent actions
 * (e.g., filling multiple form fields simultaneously).
 *
 * Returns results for all actions, including failures (does not throw).
 */
export async function batchActions(
  page: Page,
  actions: BatchAction[],
): Promise<BatchActionResult[]> {
  const results = await Promise.allSettled(
    actions.map(async (action): Promise<BatchActionResult> => {
      const start = Date.now();
      const timeout = action.timeout ?? 10000;

      try {
        const result = await executeWithTimeout(page, action, timeout);
        return {
          id: action.id,
          status: "passed",
          durationMs: Date.now() - start,
          value: result,
        };
      } catch (err) {
        return {
          id: action.id,
          status: "failed",
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : {
          id: "unknown",
          status: "failed" as const,
          durationMs: 0,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        },
  );
}

/**
 * Execute a single batch action with timeout.
 */
async function executeWithTimeout(
  page: Page,
  action: BatchAction,
  timeout: number,
): Promise<unknown> {
  return await Promise.race([
    executeAction(page, action),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Action '${action.id}' timed out after ${timeout}ms`)), timeout),
    ),
  ]);
}

async function executeAction(page: Page, action: BatchAction): Promise<unknown> {
  switch (action.type) {
    case "click":
      if (!action.selector) throw new Error(`Action '${action.id}': selector is required for click`);
      await page.locator(action.selector).first().click({ timeout: action.timeout });
      return;

    case "type":
      if (!action.selector) throw new Error(`Action '${action.id}': selector is required for type`);
      await page.locator(action.selector).first().pressSequentially(action.value ?? "", { timeout: action.timeout });
      return;

    case "fill":
      if (!action.selector) throw new Error(`Action '${action.id}': selector is required for fill`);
      await page.locator(action.selector).first().fill(action.value ?? "", { timeout: action.timeout });
      return;

    case "press":
      if (!action.key) throw new Error(`Action '${action.id}': key is required for press`);
      if (action.selector) {
        await page.locator(action.selector).first().press(action.key, { timeout: action.timeout });
      } else {
        await page.keyboard.press(action.key);
      }
      return;

    case "scroll":
      if (action.selector) {
        await page.locator(action.selector).first().scrollIntoViewIfNeeded({ timeout: action.timeout });
      } else {
        const amount = action.scrollAmount ?? 500;
        await page.evaluate((n) => window.scrollBy(0, n), amount);
      }
      return;

    case "evaluate":
      if (!action.script) throw new Error(`Action '${action.id}': script is required for evaluate`);
      return await page.evaluate(action.script);

    case "screenshot":
      return await page.screenshot();

    case "wait":
      if (action.selector) {
        await page.locator(action.selector).first().waitFor({ state: "visible", timeout: action.timeout });
      } else {
        await page.waitForTimeout(action.timeout);
      }
      return;

    default:
      throw new Error(`Action '${action.id}': unknown type '${(action as BatchAction).type}'`);
  }
}

/**
 * Check if any action in the batch failed.
 */
export function hasBatchFailures(results: BatchActionResult[]): boolean {
  return results.some((r) => r.status !== "passed");
}

/**
 * Format batch results as a summary string.
 */
export function formatBatchResults(results: BatchActionResult[]): string {
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed");
  const timedOut = results.filter((r) => r.status === "timeout");
  const totalTime = results.reduce((sum, r) => sum + r.durationMs, 0);

  const lines = [`Batch: ${passed}/${results.length} passed (${totalTime}ms total)`];
  for (const r of failed) {
    lines.push(`  FAIL [${r.id}]: ${r.error}`);
  }
  for (const r of timedOut) {
    lines.push(`  TIMEOUT [${r.id}]: ${r.error}`);
  }
  return lines.join("\n");
}
