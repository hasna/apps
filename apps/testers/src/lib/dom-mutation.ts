import type { Page } from "playwright";

export interface MutationEvent {
  type: "added" | "removed" | "changed";
  selector: string;
  tagName?: string;
  text?: string;
  previousValue?: string;
  currentValue?: string;
  timestamp: number;
  attribute?: string;
}

export interface MutationOptions {
  /** Subtree to watch (default: "body") */
  rootSelector?: string;
  /** Watch for childList changes */
  childList?: boolean;
  /** Watch for attribute changes */
  attributes?: boolean;
  /** Watch for character data changes */
  characterData?: boolean;
  /** Track text changes on specific attributes */
  attributeFilter?: string[];
}

/**
 * Detect DOM mutations during test execution.
 * Returns a function that retrieves accumulated mutation events.
 * Useful for verifying that async UI updates actually happened.
 */
export function watchMutations(page: Page, options?: MutationOptions): () => Promise<MutationEvent[]> {
  const opts = {
    rootSelector: options?.rootSelector ?? "body",
    childList: options?.childList ?? true,
    attributes: options?.attributes ?? true,
    characterData: options?.characterData ?? true,
    attributeFilter: options?.attributeFilter,
  };

  // Inject the mutation observer into the page
  page.evaluate(
    ({ childList, attributes, characterData, attributeFilter, rootSelector }) => {
      const events: MutationEvent[] = [];

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "childList") {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === 1) {
                const el = node as Element;
                events.push({
                  type: "added",
                  selector: buildSelector(el),
                  tagName: el.tagName.toLowerCase(),
                  text: el.textContent?.slice(0, 200) ?? "",
                  timestamp: Date.now(),
                });
              }
            }
            for (const node of mutation.removedNodes) {
              if (node.nodeType === 1) {
                const el = node as Element;
                events.push({
                  type: "removed",
                  selector: buildSelector(el),
                  tagName: el.tagName.toLowerCase(),
                  timestamp: Date.now(),
                });
              }
            }
          }

          if (mutation.type === "attributes" && mutation.target.nodeType === 1) {
            const el = mutation.target as Element;
            events.push({
              type: "changed",
              selector: buildSelector(el),
              tagName: el.tagName.toLowerCase(),
              attribute: mutation.attributeName ?? undefined,
              previousValue: mutation.oldValue ?? undefined,
              currentValue: el.getAttribute(mutation.attributeName ?? "") ?? undefined,
              timestamp: Date.now(),
            });
          }

          if (mutation.type === "characterData") {
            const parent = mutation.target.parentElement;
            if (parent) {
              events.push({
                type: "changed",
                selector: buildSelector(parent),
                tagName: parent.tagName.toLowerCase(),
                previousValue: mutation.oldValue ?? undefined,
                currentValue: parent.textContent ?? undefined,
                timestamp: Date.now(),
              });
            }
          }
        }
      });

      const root = document.querySelector(rootSelector) ?? document.body;
      observer.observe(root, {
        childList,
        attributes,
        characterData,
        subtree: true,
        attributeOldValue: true,
        attributeFilter: attributeFilter ?? undefined,
        characterDataOldValue: true,
      });

      // Store events on window for retrieval
      (window as unknown as Record<string, unknown>).__mutationEvents = events;
    },
    opts,
  );

  return async () => {
    return (await page.evaluate(() =>
      (window as unknown as Record<string, unknown>).__mutationEvents as MutationEvent[],
    )) ?? [];
  };
}

/**
 * Wait for a specific DOM mutation to occur (element added).
 * Useful as a replacement for arbitrary sleep delays.
 */
export async function waitForElement(page: Page, selector: string, timeout = 5000): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { state: "attached", timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a specific element to be removed from the DOM.
 */
export async function waitForElementRemoved(page: Page, selector: string, timeout = 5000): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { state: "detached", timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for text content to appear on the page.
 */
export async function waitForText(page: Page, text: string, timeout = 5000): Promise<boolean> {
  try {
    await page.waitForFunction(
      (t) => document.body.textContent?.includes(t) ?? false,
      text,
      { timeout },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Snapshot the current DOM structure for comparison.
 * Returns a compacted HTML string of the body.
 */
export async function snapshotDOM(page: Page): Promise<string> {
  return await page.evaluate(() => {
    // Remove script/style tags and whitespace for cleaner snapshots
    const clone = document.body.cloneNode(true) as HTMLElement;
    const scripts = clone.querySelectorAll("script, style, noscript");
    scripts.forEach((s) => s.remove());
    return clone.outerHTML.replace(/\s+/g, " ").trim();
  });
}

/**
 * Compare two DOM snapshots and return a list of differences.
 */
export function compareSnapshots(before: string, after: string): string[] {
  const beforeEls = extractElements(before);
  const afterEls = extractElements(after);

  const changes: string[] = [];

  for (const [key, el] of Object.entries(afterEls)) {
    if (!beforeEls[key]) {
      changes.push(`Added: ${el}`);
    }
  }

  for (const [key, el] of Object.entries(beforeEls)) {
    if (!afterEls[key]) {
      changes.push(`Removed: ${el}`);
    } else if (beforeEls[key] !== afterEls[key]) {
      changes.push(`Changed: ${el}`);
    }
  }

  return changes;
}

export function extractElements(html: string): Record<string, string> {
  const els: Record<string, string> = {};
  const tagRegex = /<([a-z][a-z0-9]*)\s*[^>]*?(?:id="([^"]*)"|class="([^"]*)")?[^>]*>/gi;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const tag = match[1];
    const id = match[2];
    const cls = match[3];
    const key = id ? `#${id}` : cls ? `${tag}.${cls.split(" ")[0]}` : tag;
    els[key] = match[0];
  }
  return els;
}

/**
 * Build a CSS selector for a given element (best-effort).
 */
function buildSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  if (el.className && typeof el.className === "string") {
    const firstClass = el.className.trim().split(/\s+/)[0];
    if (firstClass) return `${el.tagName.toLowerCase()}.${firstClass}`;
  }
  return el.tagName.toLowerCase();
}
