import Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import type { Screenshotter } from "./screenshotter.js";
import { MODEL_MAP, AIClientError } from "../types/index.js";
import type { ModelPreset, Scenario } from "../types/index.js";
import {
  click as browserClick,
  fill as browserFill,
  clickRef,
  typeRef,
  fillRef,
  selectRef,
  checkRef,
  hoverRef,
  getPageInfo,
  elementExists,
  getText,
  getUrl,
  getTitle,
  extractTable,
  getAriaSnapshot,
  crawl as browserCrawl,
  addInterceptRule,
  clearInterceptRules,
  startHAR,
  getPerformanceMetrics,
  startCoverage,
} from "@hasna/browser";

type HARCapture = Awaited<ReturnType<typeof startHAR>>;
type CoverageSession = Awaited<ReturnType<typeof startCoverage>>;

async function takeSnapshot(page: Page, _sessionId?: string) {
  const tree = await getAriaSnapshot(page);
  return {
    tree,
    snapshot: tree,
    refs: [] as Array<{ ref: string; role: string; name?: string }>,
    interactive_count: 0,
  };
}

async function extractStructuredData(page: Page) {
  return getPageInfo(page);
}

// ─── Session state for HAR capture and coverage ─────────────────────────────
const activeHARs = new Map<string, HARCapture>();
const activeCoverage = new Map<string, CoverageSession>();

// ─── Model Resolution ───────────────────────────────────────────────────────

/**
 * Resolves a model preset key (quick/thorough/deep) to its full model ID.
 * If the input doesn't match a preset, returns it as-is.
 */
export function resolveModel(nameOrPreset: string): string {
  if (nameOrPreset in MODEL_MAP) {
    return MODEL_MAP[nameOrPreset as ModelPreset];
  }
  return nameOrPreset;
}

// ─── Browser Tool Definitions ───────────────────────────────────────────────

export const BROWSER_TOOLS: Anthropic.Tool[] = [
  {
    name: "navigate",
    description: "Navigate the browser to a specific URL.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "The URL to navigate to." },
      },
      required: ["url"],
    },
  },
  {
    name: "click",
    description: "Click on an element matching the given CSS selector.",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the element to click.",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "fill",
    description: "Fill an input field with the given value.",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the input field.",
        },
        value: {
          type: "string",
          description: "The value to fill into the input.",
        },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "select_option",
    description: "Select an option from a dropdown/select element.",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the select element.",
        },
        value: {
          type: "string",
          description: "The value of the option to select.",
        },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "screenshot",
    description: "Take a screenshot of the current page state.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_text",
    description: "Get the text content of an element matching the selector.",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the element.",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "get_url",
    description: "Get the current page URL.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "wait_for",
    description: "Wait for an element matching the selector to appear on the page.",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector to wait for.",
        },
        timeout: {
          type: "number",
          description: "Maximum time to wait in milliseconds (default: 10000).",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "go_back",
    description: "Navigate back to the previous page.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "press_key",
    description: "Press a keyboard key (e.g., Enter, Tab, Escape, ArrowDown).",
    input_schema: {
      type: "object" as const,
      properties: {
        key: {
          type: "string",
          description: "The key to press (e.g., 'Enter', 'Tab', 'Escape').",
        },
      },
      required: ["key"],
    },
  },
  {
    name: "assert_visible",
    description:
      "Assert that an element matching the selector is visible on the page. Returns 'true' or 'false'.",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the element to check.",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "assert_text",
    description:
      "Assert that the given text is visible somewhere on the page. Returns 'true' or 'false'.",
    input_schema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description: "The text to search for on the page.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "scroll",
    description:
      "Scroll the page up or down by a given amount of pixels.",
    input_schema: {
      type: "object" as const,
      properties: {
        direction: {
          type: "string",
          enum: ["up", "down"],
          description: "Direction to scroll.",
        },
        amount: {
          type: "number",
          description:
            "Number of pixels to scroll (default: 500).",
        },
      },
      required: ["direction"],
    },
  },
  {
    name: "get_page_html",
    description:
      "Get simplified HTML of the page body content, truncated to 8000 characters.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_elements",
    description:
      "List elements matching a CSS selector with their text, tag name, and key attributes (max 20 results).",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector to match elements.",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "wait_for_navigation",
    description:
      "Wait for page navigation/load to complete (network idle).",
    input_schema: {
      type: "object" as const,
      properties: {
        timeout: {
          type: "number",
          description:
            "Maximum time to wait in milliseconds (default: 10000).",
        },
      },
      required: [],
    },
  },
  {
    name: "get_page_title",
    description: "Get the document title of the current page.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "count_elements",
    description: "Count the number of elements matching a CSS selector.",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector to count matching elements.",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "hover",
    description: "Hover over an element matching the given CSS selector.",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the element to hover over.",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "check",
    description: "Check a checkbox matching the given CSS selector.",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the checkbox to check.",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "uncheck",
    description: "Uncheck a checkbox matching the given CSS selector.",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the checkbox to uncheck.",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "report_result",
    description:
      "Report the final test result. Call this when you have completed testing the scenario. This MUST be the last tool you call.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["passed", "failed"],
          description: "Whether the test scenario passed or failed.",
        },
        reasoning: {
          type: "string",
          description:
            "Detailed explanation of why the test passed or failed, including any issues found.",
        },
      },
      required: ["status", "reasoning"],
    },
  },
  // ─── Ref-based tools (snapshot→ref→act workflow) ────────────────────────────
  {
    name: "browser_snapshot",
    description: "Take an ARIA accessibility snapshot of the current page. Returns a tree of interactive elements with refs (e.g. @e0, @e1) that can be used with browser_*_ref tools. Use this before interacting with elements to discover their refs.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "browser_click_ref",
    description: "Click an element by its snapshot ref (e.g. @e0). More reliable than CSS selectors because it uses ARIA role-based resolution.",
    input_schema: {
      type: "object" as const,
      properties: {
        ref: { type: "string", description: "Element ref from snapshot (e.g. @e0)." },
      },
      required: ["ref"],
    },
  },
  {
    name: "browser_type_ref",
    description: "Type text into an element by its snapshot ref. Optionally clears existing text first.",
    input_schema: {
      type: "object" as const,
      properties: {
        ref: { type: "string", description: "Element ref from snapshot (e.g. @e0)." },
        text: { type: "string", description: "Text to type." },
        clear: { type: "boolean", description: "Clear existing text before typing (default: false)." },
      },
      required: ["ref", "text"],
    },
  },
  {
    name: "browser_fill_ref",
    description: "Fill an input element by its snapshot ref. Replaces existing content.",
    input_schema: {
      type: "object" as const,
      properties: {
        ref: { type: "string", description: "Element ref from snapshot (e.g. @e0)." },
        value: { type: "string", description: "Value to fill." },
      },
      required: ["ref", "value"],
    },
  },
  {
    name: "browser_select_ref",
    description: "Select an option in a dropdown element by its snapshot ref.",
    input_schema: {
      type: "object" as const,
      properties: {
        ref: { type: "string", description: "Element ref from snapshot (e.g. @e0)." },
        value: { type: "string", description: "Option value to select." },
      },
      required: ["ref", "value"],
    },
  },
  {
    name: "browser_check_ref",
    description: "Check or uncheck a checkbox/radio element by its snapshot ref.",
    input_schema: {
      type: "object" as const,
      properties: {
        ref: { type: "string", description: "Element ref from snapshot (e.g. @e0)." },
        checked: { type: "boolean", description: "True to check, false to uncheck." },
      },
      required: ["ref", "checked"],
    },
  },
  {
    name: "browser_hover_ref",
    description: "Hover over an element by its snapshot ref.",
    input_schema: {
      type: "object" as const,
      properties: {
        ref: { type: "string", description: "Element ref from snapshot (e.g. @e0)." },
      },
      required: ["ref"],
    },
  },
  {
    name: "browser_check",
    description: "Get a comprehensive page orientation: page info (URL, title, meta, link/image/form counts, console errors, viewport) plus an ARIA accessibility snapshot with interactive element refs. Use this to understand the current page state before testing.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "browser_assert",
    description: "Run an assertion against the current page state. Supports: element_exists (check selector exists/visible), text_contains (check page text includes substring), url_matches (check URL matches pattern), title_contains (check page title includes substring). Returns pass/fail with details.",
    input_schema: {
      type: "object" as const,
      properties: {
        assertion: {
          type: "string",
          enum: ["element_exists", "text_contains", "url_matches", "title_contains"],
          description: "The type of assertion to run.",
        },
        selector: {
          type: "string",
          description: "CSS selector (required for element_exists).",
        },
        expected: {
          type: "string",
          description: "Expected value (text substring, URL pattern, or title substring).",
        },
        visible: {
          type: "boolean",
          description: "For element_exists: also require the element to be visible (default true).",
        },
      },
      required: ["assertion"],
    },
  },
  {
    name: "browser_extract",
    description: "Extract structured data from the current page. Modes: 'structured' (tables, lists, JSON-LD, OpenGraph, meta), 'table' (a specific HTML table), 'text' (page or element text), 'aria' (accessibility snapshot). Returns extracted data as JSON.",
    input_schema: {
      type: "object" as const,
      properties: {
        mode: {
          type: "string",
          enum: ["structured", "table", "text", "aria"],
          description: "Extraction mode: 'structured' for auto-detected tables/lists/metadata, 'table' for a specific table selector, 'text' for page/element text, 'aria' for accessibility tree.",
        },
        selector: {
          type: "string",
          description: "CSS selector for targeted extraction (required for 'table' mode, optional for 'text').",
        },
      },
      required: ["mode"],
    },
  },
  {
    name: "browser_crawl",
    description: "Crawl a website starting from a URL. Discovers linked pages within the same domain, up to a configurable depth. Returns a list of found URLs with their status codes and titles.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "Starting URL to crawl from.",
        },
        maxDepth: {
          type: "number",
          description: "Maximum crawl depth (default 2).",
        },
        maxPages: {
          type: "number",
          description: "Maximum number of pages to visit (default 20).",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_intercept",
    description: "Intercept network requests on the current page. Actions: 'block' (block matching requests), 'modify' (rewrite response), 'log' (log matching requests), 'clear' (remove all rules), 'har_start' (start HAR recording), 'har_stop' (stop and return HAR).",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["block", "modify", "log", "clear", "har_start", "har_stop"],
          description: "Intercept action to perform.",
        },
        pattern: {
          type: "string",
          description: "URL pattern to match (required for block/modify/log).",
        },
        response: {
          type: "object",
          description: "Custom response for 'modify' action.",
          properties: {
            status: { type: "number" },
            body: { type: "string" },
            headers: { type: "object" },
          },
        },
      },
      required: ["action"],
    },
  },
  {
    name: "browser_performance",
    description: "Measure page performance. Modes: 'metrics' (Web Vitals: FCP, LCP, CLS, TTFB), 'deep' (full resource breakdown, third-party analysis, DOM complexity, main thread blocking, memory), 'coverage_start' (start JS/CSS coverage), 'coverage_stop' (stop and report unused code).",
    input_schema: {
      type: "object" as const,
      properties: {
        mode: {
          type: "string",
          enum: ["metrics", "deep", "coverage_start", "coverage_stop"],
          description: "Performance measurement mode.",
        },
      },
      required: ["mode"],
    },
  },
  {
    name: "browser_a11y",
    description: "Run an accessibility audit on the current page using the ARIA accessibility tree. Detects missing labels, roles, focus issues, and other common a11y problems. Returns a list of issues with severity and element details.",
    input_schema: {
      type: "object" as const,
      properties: {
        level: {
          type: "string",
          enum: ["A", "AA", "AAA"],
          description: "WCAG conformance level to check against (default AA).",
        },
      },
    },
  },
];

// ─── Tool Execution ─────────────────────────────────────────────────────────

interface ToolContext {
  runId: string;
  scenarioSlug: string;
  stepNumber: number;
  sessionId: string;
  a11y?: boolean | { level?: "A" | "AA" | "AAA" };
}

interface ScreenshotResult {
  filePath: string;
  width: number;
  height: number;
  timestamp: string;
  description: string | null;
  pageUrl: string | null;
  thumbnailPath: string | null;
}

interface ToolExecutionResult {
  result: string;
  screenshot?: ScreenshotResult;
}

/**
 * Executes a single browser tool action against the Playwright page.
 * Returns the result string and an optional screenshot capture.
 */
export async function executeTool(
  page: Page,
  screenshotter: Screenshotter,
  toolName: string,
  toolInput: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  try {
    switch (toolName) {
      case "navigate": {
        const url = toolInput.url as string;
        await page.goto(url, { waitUntil: "domcontentloaded" });
        const screenshot = await screenshotter.capture(page, {
          runId: context.runId,
          scenarioSlug: context.scenarioSlug,
          stepNumber: context.stepNumber,
          action: "navigate",
        });

        // Optional a11y scan after navigation
        let a11yNote = "";
        if (context.a11y) {
          try {
            const { scanPageA11y } = await import("./scanners/a11y.js");
            const level = typeof context.a11y === "object" ? (context.a11y.level ?? "AA") : "AA";
            const violations = await scanPageA11y(page, { wcagLevel: level as "A" | "AA" | "AAA" });
            if (violations.length > 0) {
              const critical = violations.filter((v) => v.impact === "critical").length;
              const serious = violations.filter((v) => v.impact === "serious").length;
              a11yNote = ` [a11y: ${violations.length} violations — ${critical} critical, ${serious} serious]`;
            }
          } catch { /* a11y scan is non-blocking */ }
        }

        return {
          result: `Navigated to ${url}${a11yNote}`,
          screenshot,
        };
      }

      case "click": {
        const selector = toolInput.selector as string;
        try {
          const healResult = await browserClick(page, selector, { selfHeal: true });
          const screenshot = await screenshotter.capture(page, {
            runId: context.runId,
            scenarioSlug: context.scenarioSlug,
            stepNumber: context.stepNumber,
            action: "click",
          });
          const healNote = healResult.healed ? ` [self-healed via ${healResult.method}]` : "";
          return {
            result: `Clicked element: ${selector}${healNote}`,
            screenshot,
          };
        } catch (clickErr) {
          // Programmatic self-heal failed — fall back to AI healer
          const errMsg = clickErr instanceof Error ? clickErr.message : String(clickErr);
          if (errMsg.includes("not found") || errMsg.includes("No element") || errMsg.includes("waiting for selector")) {
            const { healSelector } = await import("./healer.js").catch(() => ({ healSelector: null }));
            if (healSelector) {
              const heal = await healSelector({ page, failedSelector: selector, intent: `click the element matching "${selector}"` });
              if (heal.healed && heal.newSelector) {
                await page.click(heal.newSelector);
                const screenshot = await screenshotter.capture(page, { runId: context.runId, scenarioSlug: context.scenarioSlug, stepNumber: context.stepNumber, action: "click" });
                return { result: `Clicked element: ${heal.newSelector} [AI-healed from "${selector}" — ${heal.reasoning}]`, screenshot };
              }
            }
          }
          throw clickErr;
        }
      }

      case "fill": {
        const selector = toolInput.selector as string;
        const value = toolInput.value as string;
        try {
          const healResult = await browserFill(page, selector, value, undefined, true);
          const healNote = healResult.healed ? ` [self-healed via ${healResult.method}]` : "";
          return {
            result: `Filled "${selector}" with value${healNote}`,
          };
        } catch (fillErr) {
          // Programmatic self-heal failed — fall back to AI healer
          const errMsg = fillErr instanceof Error ? fillErr.message : String(fillErr);
          if (errMsg.includes("not found") || errMsg.includes("No element") || errMsg.includes("waiting for selector")) {
            const { healSelector } = await import("./healer.js").catch(() => ({ healSelector: null }));
            if (healSelector) {
              const heal = await healSelector({ page, failedSelector: selector, intent: `fill the input field "${selector}" with "${value}"` });
              if (heal.healed && heal.newSelector) {
                await page.fill(heal.newSelector, value);
                return { result: `Filled "${heal.newSelector}" with value [AI-healed from "${selector}"]` };
              }
            }
          }
          throw fillErr;
        }
      }

      case "select_option": {
        const selector = toolInput.selector as string;
        const value = toolInput.value as string;
        await page.selectOption(selector, value);
        return {
          result: `Selected option "${value}" in ${selector}`,
        };
      }

      case "screenshot": {
        const screenshot = await screenshotter.capture(page, {
          runId: context.runId,
          scenarioSlug: context.scenarioSlug,
          stepNumber: context.stepNumber,
          action: "screenshot",
        });
        return {
          result: "Screenshot captured",
          screenshot,
        };
      }

      case "get_text": {
        const selector = toolInput.selector as string;
        const text = await page.locator(selector).textContent();
        return {
          result: text ?? "(no text content)",
        };
      }

      case "get_url": {
        return {
          result: page.url(),
        };
      }

      case "wait_for": {
        const selector = toolInput.selector as string;
        const timeout =
          typeof toolInput.timeout === "number" ? toolInput.timeout : 10_000;
        await page.waitForSelector(selector, { timeout });
        return {
          result: `Element "${selector}" appeared`,
        };
      }

      case "go_back": {
        await page.goBack();
        return {
          result: "Navigated back",
        };
      }

      case "press_key": {
        const key = toolInput.key as string;
        await page.keyboard.press(key);
        return {
          result: `Pressed key: ${key}`,
        };
      }

      case "assert_visible": {
        const selector = toolInput.selector as string;
        try {
          const visible = await page.locator(selector).isVisible();
          return { result: visible ? "true" : "false" };
        } catch {
          return { result: "false" };
        }
      }

      case "assert_text": {
        const text = toolInput.text as string;
        try {
          const bodyText = await page.locator("body").textContent();
          const found = bodyText ? bodyText.includes(text) : false;
          return { result: found ? "true" : "false" };
        } catch {
          return { result: "false" };
        }
      }

      case "scroll": {
        const direction = toolInput.direction as string;
        const amount =
          typeof toolInput.amount === "number" ? toolInput.amount : 500;
        const scrollY = direction === "down" ? amount : -amount;
        await page.evaluate((y: number) => window.scrollBy(0, y), scrollY);
        const screenshot = await screenshotter.capture(page, {
          runId: context.runId,
          scenarioSlug: context.scenarioSlug,
          stepNumber: context.stepNumber,
          action: "scroll",
        });
        return {
          result: `Scrolled ${direction} by ${amount}px`,
          screenshot,
        };
      }

      case "get_page_html": {
        const html = await page.evaluate(() => document.body.innerHTML);
        const truncated = html.length > 8000 ? html.slice(0, 8000) + "..." : html;
        return {
          result: truncated,
        };
      }

      case "get_elements": {
        const selector = toolInput.selector as string;
        const allElements = await page.locator(selector).all();
        const elements = allElements.slice(0, 20);
        const results: string[] = [];
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i]!;
          const tagName = await el.evaluate((e: Element) => e.tagName.toLowerCase());
          const textContent = (await el.textContent()) ?? "";
          const trimmedText = textContent.trim().slice(0, 100);
          const id = await el.getAttribute("id");
          const className = await el.getAttribute("class");
          const href = await el.getAttribute("href");
          const type = await el.getAttribute("type");
          const placeholder = await el.getAttribute("placeholder");
          const ariaLabel = await el.getAttribute("aria-label");
          const attrs: string[] = [];
          if (id) attrs.push(`id="${id}"`);
          if (className) attrs.push(`class="${className}"`);
          if (href) attrs.push(`href="${href}"`);
          if (type) attrs.push(`type="${type}"`);
          if (placeholder) attrs.push(`placeholder="${placeholder}"`);
          if (ariaLabel) attrs.push(`aria-label="${ariaLabel}"`);
          results.push(
            `[${i}] <${tagName}${attrs.length ? " " + attrs.join(" ") : ""}> ${trimmedText}`
          );
        }
        return {
          result: results.length > 0
            ? results.join("\n")
            : `No elements found matching "${selector}"`,
        };
      }

      case "wait_for_navigation": {
        const timeout =
          typeof toolInput.timeout === "number" ? toolInput.timeout : 10_000;
        await page.waitForLoadState("networkidle", { timeout });
        return {
          result: "Navigation/load completed",
        };
      }

      case "get_page_title": {
        const title = await page.title();
        return {
          result: title || "(no title)",
        };
      }

      case "count_elements": {
        const selector = toolInput.selector as string;
        const count = await page.locator(selector).count();
        return {
          result: `${count} element(s) matching "${selector}"`,
        };
      }

      case "hover": {
        const selector = toolInput.selector as string;
        await page.hover(selector);
        const screenshot = await screenshotter.capture(page, {
          runId: context.runId,
          scenarioSlug: context.scenarioSlug,
          stepNumber: context.stepNumber,
          action: "hover",
        });
        return {
          result: `Hovered over: ${selector}`,
          screenshot,
        };
      }

      case "check": {
        const selector = toolInput.selector as string;
        await page.check(selector);
        return {
          result: `Checked checkbox: ${selector}`,
        };
      }

      case "uncheck": {
        const selector = toolInput.selector as string;
        await page.uncheck(selector);
        return {
          result: `Unchecked checkbox: ${selector}`,
        };
      }

      case "report_result": {
        const status = toolInput.status as string;
        const reasoning = toolInput.reasoning as string;
        return {
          result: `Test ${status}: ${reasoning}`,
        };
      }

      case "browser_snapshot": {
        const snapshot = await takeSnapshot(page, context.sessionId);
        return {
          result: snapshot.tree,
        };
      }

      case "browser_click_ref": {
        const ref = toolInput.ref as string;
        // Auto-snapshot: refresh refs before acting so stale refs get updated
        await takeSnapshot(page, context.sessionId);
        await clickRef(page, context.sessionId, ref);
        const screenshot = await screenshotter.capture(page, {
          runId: context.runId,
          scenarioSlug: context.scenarioSlug,
          stepNumber: context.stepNumber,
          action: "click_ref",
        });
        return {
          result: `Clicked ref: ${ref}`,
          screenshot,
        };
      }

      case "browser_type_ref": {
        const ref = toolInput.ref as string;
        const text = toolInput.text as string;
        const clear = toolInput.clear as boolean | undefined;
        await takeSnapshot(page, context.sessionId);
        await typeRef(page, context.sessionId, ref, text, { clear: clear ?? true });
        return {
          result: `Typed into ref ${ref}: "${text}"`,
        };
      }

      case "browser_fill_ref": {
        const ref = toolInput.ref as string;
        const value = toolInput.value as string;
        await takeSnapshot(page, context.sessionId);
        await fillRef(page, context.sessionId, ref, value);
        return {
          result: `Filled ref ${ref} with value`,
        };
      }

      case "browser_select_ref": {
        const ref = toolInput.ref as string;
        const value = toolInput.value as string;
        await takeSnapshot(page, context.sessionId);
        const selected = await selectRef(page, context.sessionId, ref, value);
        return {
          result: `Selected "${selected.join(", ")}" in ref ${ref}`,
        };
      }

      case "browser_check_ref": {
        const ref = toolInput.ref as string;
        const checked = toolInput.checked as boolean;
        await takeSnapshot(page, context.sessionId);
        await checkRef(page, context.sessionId, ref, checked);
        return {
          result: `${checked ? "Checked" : "Unchecked"} ref: ${ref}`,
        };
      }

      case "browser_hover_ref": {
        const ref = toolInput.ref as string;
        await takeSnapshot(page, context.sessionId);
        await hoverRef(page, context.sessionId, ref);
        const screenshot = await screenshotter.capture(page, {
          runId: context.runId,
          scenarioSlug: context.scenarioSlug,
          stepNumber: context.stepNumber,
          action: "hover_ref",
        });
        return {
          result: `Hovered ref: ${ref}`,
          screenshot,
        };
      }

      case "browser_check": {
        const [info, snapshot] = await Promise.all([
          getPageInfo(page),
          takeSnapshot(page, context.sessionId),
        ]);
        const parts = [
          `URL: ${info.url}`,
          `Title: ${info.title}`,
          info.meta_description ? `Description: ${info.meta_description}` : null,
          `Links: ${info.links_count} | Images: ${info.images_count} | Forms: ${info.forms_count}`,
          `Text length: ${info.text_length} | Console errors: ${info.has_console_errors}`,
          `Viewport: ${info.viewport.width}x${info.viewport.height}`,
          ``,
          `Interactive elements: ${snapshot.interactive_count}`,
          ``,
          snapshot.tree,
        ].filter(Boolean);
        return { result: parts.join("\n") };
      }

      case "browser_assert": {
        const assertionType = toolInput.assertion_type as string;
        const selector = toolInput.selector as string | undefined;
        const expected = toolInput.expected as string | undefined;

        switch (assertionType) {
          case "element_exists": {
            if (!selector) return { result: "Error: selector required for element_exists assertion" };
            const result = await elementExists(page, selector);
            const pass = result.exists;
            return { result: pass ? `PASS: element "${selector}" exists (${result.count} match${result.count !== 1 ? "es" : ""}, visible: ${result.visible})` : `FAIL: element "${selector}" not found` };
          }
          case "text_contains": {
            const text = selector ? await getText(page, selector) : await getText(page);
            const pass = expected !== undefined && text.includes(expected);
            return { result: pass ? `PASS: text contains "${expected}"` : `FAIL: text does not contain "${expected}". Found: "${text.slice(0, 200)}"` };
          }
          case "url_matches": {
            const url = await getUrl(page);
            const pattern = expected ?? "";
            const pass = new RegExp(pattern).test(url);
            return { result: pass ? `PASS: URL matches /${pattern}/` : `FAIL: URL "${url}" does not match /${pattern}/` };
          }
          case "title_contains": {
            const title = await getTitle(page);
            const pass = expected !== undefined && title.includes(expected);
            return { result: pass ? `PASS: title contains "${expected}"` : `FAIL: title "${title}" does not contain "${expected}"` };
          }
          default:
            return { result: `Unknown assertion type: ${assertionType}` };
        }
      }

      case "browser_extract": {
        const mode = toolInput.mode as string;
        const selector = toolInput.selector as string | undefined;

        switch (mode) {
          case "structured": {
            const data = await extractStructuredData(page);
            return { result: JSON.stringify(data, null, 2) };
          }
          case "table": {
            if (!selector) return { result: "Error: selector required for table extraction" };
            const rows = await extractTable(page, selector);
            return { result: JSON.stringify(rows, null, 2) };
          }
          case "text": {
            const text = selector ? await getText(page, selector) : await getText(page);
            return { result: text };
          }
          case "aria": {
            const aria = await getAriaSnapshot(page);
            return { result: aria };
          }
          default:
            return { result: `Unknown extract mode: ${mode}` };
        }
      }

      case "browser_crawl": {
        const url = toolInput.url as string;
        const maxDepth = (toolInput.max_depth as number) ?? 2;
        const maxPages = (toolInput.max_pages as number) ?? 20;
        const result = await browserCrawl(url, { maxDepth, maxPages });
        return { result: JSON.stringify(result, null, 2) };
      }

      case "browser_intercept": {
        const action = toolInput.action as string;
        const pattern = toolInput.pattern as string | undefined;
        const statusCode = toolInput.status_code as number | undefined;
        const body = toolInput.body as string | undefined;
        const sessionId = context.sessionId ?? "default";

        switch (action) {
          case "block": {
            if (!pattern) return { result: "Error: pattern required for block action" };
            await addInterceptRule(page, { pattern, action: "block" });
            return { result: `Blocked requests matching: ${pattern}` };
          }
          case "modify": {
            if (!pattern) return { result: "Error: pattern required for modify action" };
            await addInterceptRule(page, { pattern, action: "modify", response: { status: statusCode ?? 200, body: body ?? "" } });
            return { result: `Modified requests matching: ${pattern} → status ${statusCode ?? 200}` };
          }
          case "log": {
            if (!pattern) return { result: "Error: pattern required for log action" };
            await addInterceptRule(page, { pattern, action: "log" });
            return { result: `Logging requests matching: ${pattern}` };
          }
          case "clear": {
            await clearInterceptRules(page);
            return { result: "Cleared all intercept rules" };
          }
          case "har_start": {
            const harCapture = startHAR(page);
            activeHARs.set(sessionId, harCapture);
            return { result: "HAR capture started" };
          }
          case "har_stop": {
            const harCapture = activeHARs.get(sessionId);
            if (!harCapture) return { result: "Error: no active HAR capture for this session" };
            const har = harCapture.stop();
            activeHARs.delete(sessionId);
            const entryCount = har.log.entries.length;
            return { result: `HAR capture stopped: ${entryCount} entries captured\n${JSON.stringify(har, null, 2)}` };
          }
          default:
            return { result: `Unknown intercept action: ${action}` };
        }
      }

      case "browser_performance": {
        const mode = toolInput.mode as string;
        const sessionId = context.sessionId ?? "default";

        switch (mode) {
          case "metrics": {
            const metrics = await getPerformanceMetrics(page);
            return { result: JSON.stringify(metrics, null, 2) };
          }
          case "deep": {
            const deep = await getPerformanceMetrics(page);
            return { result: JSON.stringify(deep, null, 2) };
          }
          case "coverage_start": {
            const session = await startCoverage(page);
            activeCoverage.set(sessionId, session);
            return { result: "Coverage tracking started" };
          }
          case "coverage_stop": {
            const session = activeCoverage.get(sessionId);
            if (!session) return { result: "Error: no active coverage session" };
            const result = await session.stop();
            activeCoverage.delete(sessionId);
            return { result: JSON.stringify(result, null, 2) };
          }
          default:
            return { result: `Unknown performance mode: ${mode}` };
        }
      }

      case "browser_a11y": {
        const level = (toolInput.level as string) ?? "AA";
        const snapshot = await page.evaluate(() => {
          function readRole(el: Element): string {
            return el.getAttribute("role") ?? el.tagName.toLowerCase();
          }

          function readName(el: Element): string {
            const labelledBy = el.getAttribute("aria-labelledby");
            if (labelledBy) {
              const labelledText = labelledBy
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent?.trim())
                .filter(Boolean)
                .join(" ");
              if (labelledText) return labelledText;
            }
            return el.getAttribute("aria-label") ?? el.getAttribute("alt") ?? el.textContent?.trim() ?? "";
          }

          function walk(el: Element): { role: string; name: string; children: ReturnType<typeof walk>[] } {
            return {
              role: readRole(el),
              name: readName(el),
              children: Array.from(el.children).map((child) => walk(child)),
            };
          }

          return document.body ? walk(document.body) : null;
        });
        if (!snapshot) return { result: "Error: could not capture accessibility tree" };

        const issues: string[] = [];
        const checkNode = (node: any, path: string[] = []): void => {
          const label = node.name ?? "";
          const role = node.role ?? "";
          const nodePath = [...path, `${role}${label ? ` "${label}"` : ""}`];

          // WCAG A: images must have alt text (role=img with no name)
          if (role === "img" && !label) {
            issues.push(`[A] Image missing alt text at ${nodePath.join(" > ")}`);
          }
          // WCAG A: interactive elements need accessible names
          if (["button", "link", "textbox", "checkbox", "radio", "combobox", "menuitem"].includes(role) && !label) {
            issues.push(`[A] ${role} missing accessible name at ${nodePath.join(" > ")}`);
          }
          // WCAG AA: form fields need labels
          if (["textbox", "combobox", "slider", "spinbutton"].includes(role) && !label) {
            issues.push(`[AA] Form field (${role}) missing label at ${nodePath.join(" > ")}`);
          }
          // WCAG AAA: headings should have content
          if (role.startsWith("heading") && !label) {
            issues.push(`[AAA] Empty heading at ${nodePath.join(" > ")}`);
          }

          for (const child of node.children ?? []) {
            checkNode(child, nodePath);
          }
        };
        checkNode(snapshot);

        const maxLevel = level === "A" ? 0 : level === "AA" ? 1 : 2;
        const levelMap: Record<number, string[]> = { 0: ["A"], 1: ["A", "AA"], 2: ["A", "AA", "AAA"] };
        const applicable = levelMap[maxLevel] ?? ["A", "AA"];
        const filtered = issues.filter((i) => applicable.some((l) => i.includes(`[${l}]`)));

        const summary = filtered.length === 0
          ? `No a11y issues found at WCAG ${level} level`
          : `${filtered.length} a11y issue${filtered.length > 1 ? "s" : ""} found at WCAG ${level} level:\n${filtered.join("\n")}`;
        return { result: summary };
      }

      default:
        return { result: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { result: `Error executing ${toolName}: ${message}` };
  }
}

// ─── Agent Loop ─────────────────────────────────────────────────────────────

export type StepEventHandler = (event: {
  type: "tool_call" | "tool_result" | "thinking";
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  thinking?: string;
  stepNumber: number;
}) => void;

interface AgentLoopOptions {
  client: Anthropic | OpenAICompatConfig;
  page: Page;
  scenario: Scenario;
  screenshotter: Screenshotter;
  model: string;
  runId: string;
  sessionId?: string;
  baseUrl?: string;
  maxTurns?: number;
  onStep?: StepEventHandler;
  persona?: {
    name: string;
    role: string;
    description: string;
    instructions: string;
    traits: string[];
    goals: string[];
    behaviors?: string[];
    painPoints?: string[];
  } | null;
  a11y?: boolean | { level?: "A" | "AA" | "AAA" };
}

interface AgentLoopResult {
  status: "passed" | "failed" | "error";
  reasoning: string;
  stepsCompleted: number;
  tokensUsed: number;
  screenshots: Array<{
    filePath: string;
    width: number;
    height: number;
    timestamp: string;
    action: string;
    stepNumber: number;
    description: string | null;
    pageUrl: string | null;
    thumbnailPath: string | null;
  }>;
}

function resolveStartUrl(baseUrl: string, targetPath: string): string {
  try {
    return new URL(targetPath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
  } catch {
    return `${baseUrl.replace(/\/+$/, "")}/${targetPath.replace(/^\/+/, "")}`;
  }
}

export function buildScenarioUserMessage(scenario: Scenario, baseUrl?: string): string {
  const userParts: string[] = [
    `**Scenario:** ${scenario.name}`,
    `**Description:** ${scenario.description}`,
  ];

  if (baseUrl) {
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
    userParts.push(`**Base URL:** ${normalizedBaseUrl}`);
    if (scenario.targetPath) {
      userParts.push(`**Start URL:** ${resolveStartUrl(normalizedBaseUrl, scenario.targetPath)}`);
    }
    userParts.push(
      "**Navigation Boundary:** Treat the Base URL as the application under test. Resolve relative paths and in-app navigation against this origin. Do not navigate to another host unless a step explicitly includes an absolute external URL.",
    );
  }

  if (scenario.targetPath) {
    userParts.push(`**Target Path:** ${scenario.targetPath}`);
  }

  if (scenario.steps.length > 0) {
    userParts.push("**Steps:**");
    for (let i = 0; i < scenario.steps.length; i++) {
      userParts.push(`${i + 1}. ${scenario.steps[i]}`);
    }
  }

  return userParts.join("\n");
}

/**
 * Runs the AI agent loop: sends the scenario to Claude, processes tool calls,
 * executes browser actions, and collects results until the agent reports
 * a final result or the turn limit is reached.
 */
export async function runAgentLoop(
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const {
    client,
    page,
    scenario,
    screenshotter,
    model,
    runId,
    sessionId,
    baseUrl,
    maxTurns = 30,
    onStep,
    persona,
    a11y,
  } = options;

  const personaSection = persona ? [
    "",
    "## Your Testing Persona",
    `You are acting as: **${persona.role}** (${persona.name})`,
    persona.description ? persona.description : "",
    persona.instructions ? `\nInstructions: ${persona.instructions}` : "",
    persona.traits.length > 0 ? `Traits: ${persona.traits.join(", ")}` : "",
    persona.goals.length > 0 ? `Goals: ${persona.goals.join("; ")}` : "",
    persona.behaviors && persona.behaviors.length > 0 ? `Behaviors: ${persona.behaviors.join("; ")}` : "",
    persona.painPoints && persona.painPoints.length > 0 ? `Pain points: ${persona.painPoints.join("; ")}` : "",
    "",
    "Stay in character throughout the test. Your observations, choices, and priorities should reflect this persona.",
  ].filter(Boolean).join("\n") : "";

  const systemPrompt = [
    "You are an expert QA testing agent. Your job is to thoroughly test web application scenarios.",
    "You have browser tools to navigate, interact with, and inspect web pages.",
    "",
    "Strategy (snapshot → ref → act):",
    "1. Navigate to the target page, then call browser_snapshot to get an accessibility tree with element refs (@e0, @e1, ...)",
    "2. Use ref-based tools (browser_click_ref, browser_type_ref, browser_fill_ref, etc.) to interact with elements by their ref IDs — this is more reliable than CSS selectors",
    "3. After actions that change page state, call browser_snapshot again to see the updated tree",
    "4. Use wait_for or wait_for_navigation after actions that trigger page loads",
    "5. Take screenshots after every meaningful state change",
    "6. Use assert_text and assert_visible to verify expected outcomes",
    "7. When done testing, call report_result with detailed pass/fail reasoning",
    "",
    "When to use CSS-selector tools vs ref-based tools:",
    "- Prefer ref-based tools (browser_click_ref, etc.) — they resolve via the accessibility snapshot and self-heal on DOM changes",
    "- Use CSS-selector tools (click, fill) only when you need to target elements by a known stable selector",
    "- Both click and fill have built-in self-healing: if the selector breaks, they try alternative strategies automatically",
    "- If built-in healing fails, the AI healer kicks in as a deeper fallback",
    "",
    "Tips:",
    "- Call browser_snapshot before interacting — it gives you the current refs and interactive element count",
    "- If a click triggers navigation, use wait_for_navigation after",
    "- For forms, fill all fields before submitting",
    "- Check for error messages after form submissions",
    "- Verify both positive and negative states",
  ].join("\n") + personaSection;

  const userMessage = buildScenarioUserMessage(scenario, baseUrl);

  const screenshots: AgentLoopResult["screenshots"] = [];
  let tokensUsed = 0;
  let stepNumber = 0;

  // Slugify scenario name for file paths
  const scenarioSlug = scenario.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // Build conversation messages
  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  // Determine if we're using a non-Anthropic provider
  const isOpenAICompat = "provider" in client;

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      // Every 5 turns, reinforce persona to prevent drift
      if (persona && turn > 0 && turn % 5 === 0) {
        messages = [
          ...messages,
          {
            role: "user" as const,
            content: `[Reminder: You are ${persona.name} — ${persona.role}. Traits: ${persona.traits.join(", ")}. Stay in character.]`,
          },
        ];
      }

      // Call the appropriate provider — unified dispatch, no per-turn branching
      const response = isOpenAICompat
        ? await callOpenAICompatible({
            baseUrl: (client as OpenAICompatConfig).baseUrl,
            apiKey: (client as OpenAICompatConfig).apiKey,
            model,
            system: systemPrompt,
            messages,
            tools: BROWSER_TOOLS,
          })
        : await (client as Anthropic).messages.create({
            model,
            max_tokens: 4096,
            system: systemPrompt,
            tools: BROWSER_TOOLS,
            messages,
          });

      // Track token usage
      if (response.usage) {
        tokensUsed += response.usage.input_tokens + response.usage.output_tokens;
      }

      // Check for report_result in tool_use blocks or end_turn stop reason
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ContentBlock & { type: "tool_use" } =>
          block.type === "tool_use",
      );

      // If no tool calls and stop reason is end_turn, the agent is done without reporting
      if (toolUseBlocks.length === 0 && response.stop_reason === "end_turn") {
        // Extract any text from the response as reasoning
        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === "text",
        );
        const textReasoning = textBlocks.map((b) => b.text).join("\n");
        return {
          status: "error",
          reasoning:
            textReasoning ||
            "Agent ended without calling report_result",
          stepsCompleted: stepNumber,
          tokensUsed,
          screenshots,
        };
      }

      // Process each tool call
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      // Emit AI thinking from text blocks
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );
      if (textBlocks.length > 0 && onStep) {
        const thinking = textBlocks.map((b) => b.text).join("\n");
        onStep({ type: "thinking", thinking, stepNumber });
      }

      for (const toolBlock of toolUseBlocks) {
        stepNumber++;
        const toolInput = toolBlock.input as Record<string, unknown>;

        // Emit tool call event
        if (onStep) {
          onStep({ type: "tool_call", toolName: toolBlock.name, toolInput, stepNumber });
        }

        const execResult = await executeTool(
          page,
          screenshotter,
          toolBlock.name,
          toolInput,
          { runId, scenarioSlug, stepNumber, sessionId: sessionId ?? runId, a11y },
        );

        // Emit tool result event
        if (onStep) {
          onStep({ type: "tool_result", toolName: toolBlock.name, toolResult: execResult.result, stepNumber });
        }

        // Collect screenshots
        if (execResult.screenshot) {
          screenshots.push({
            ...execResult.screenshot,
            action: toolBlock.name,
            stepNumber,
          });
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolBlock.id,
          content: execResult.result,
        });

        // Check if this was the report_result tool — extract final status
        if (toolBlock.name === "report_result") {
          const status = toolInput.status as "passed" | "failed";
          const reasoning = toolInput.reasoning as string;
          return {
            status,
            reasoning,
            stepsCompleted: stepNumber,
            tokensUsed,
            screenshots,
          };
        }
      }

      // Append assistant response and tool results to conversation
      messages = [
        ...messages,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults },
      ];
    }

    // Max turns reached without a final report
    return {
      status: "error",
      reasoning: `Agent reached maximum turn limit (${maxTurns}) without reporting a result`,
      stepsCompleted: stepNumber,
      tokensUsed,
      screenshots,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AIClientError(`Agent loop failed: ${message}`);
  }
}

// ─── Client Factory ─────────────────────────────────────────────────────────

/**
 * Detects the AI provider from a model name.
 * - "gpt-*" or "o1-*" / "o3-*" → openai
 * - "gemini-*" → google
 * - everything else → anthropic (default)
 */
export function detectProvider(model: string): "anthropic" | "openai" | "google" | "cerebras" {
  if (model.startsWith("gpt-") || /^o\d/.test(model)) return "openai";
  if (model.startsWith("gemini-")) return "google";
  // Cerebras: llama-* or qwen-* models, or explicit cerebras env key set
  if (model.startsWith("llama-") || model.startsWith("qwen-") || model.includes("cerebras")) return "cerebras";
  return "anthropic";
}

/**
 * Creates an Anthropic client instance. Uses the provided API key,
 * or falls back to the ANTHROPIC_API_KEY environment variable.
 */
export function createClient(apiKey?: string): Anthropic {
  const key = apiKey ?? process.env["ANTHROPIC_API_KEY"];
  if (!key) {
    throw new AIClientError(
      "No Anthropic API key provided. Set ANTHROPIC_API_KEY or pass it explicitly.",
    );
  }
  return new Anthropic({ apiKey: key });
}

// ─── OpenAI-compatible adapter ──────────────────────────────────────────────
// Used for both OpenAI (api.openai.com) and Google Gemini (OpenAI-compat endpoint).
// Translates Anthropic-style tool definitions and responses to/from OpenAI format.

function anthropicToolsToOpenAI(tools: Anthropic.Tool[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/**
 * Calls an OpenAI-compatible chat completions endpoint and returns a
 * response shaped like an Anthropic message (content blocks).
 */
export async function callOpenAICompatible(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  maxTokens?: number;
}): Promise<{ content: Anthropic.ContentBlock[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number } }> {
  const { baseUrl, apiKey, model, system, messages, tools, maxTokens = 4096 } = options;

  // Convert message history (Anthropic format → OpenAI format)
  const oaiMessages: unknown[] = [{ role: "system", content: system }];
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      oaiMessages.push({ role: msg.role, content: msg.content });
    } else if (Array.isArray(msg.content)) {
      // Handle tool results and text blocks
      for (const block of msg.content as Anthropic.ContentBlockParam[]) {
        if (block.type === "text") {
          oaiMessages.push({ role: msg.role, content: (block as Anthropic.TextBlockParam).text });
        } else if (block.type === "tool_use") {
          const tb = block as Anthropic.ToolUseBlockParam;
          oaiMessages.push({
            role: "assistant",
            content: null,
            tool_calls: [{ id: tb.id, type: "function", function: { name: tb.name, arguments: JSON.stringify(tb.input) } }],
          });
        } else if (block.type === "tool_result") {
          const trb = block as Anthropic.ToolResultBlockParam;
          const resultContent = typeof trb.content === "string" ? trb.content : JSON.stringify(trb.content);
          oaiMessages.push({ role: "tool", tool_call_id: trb.tool_use_id, content: resultContent });
        }
      }
    }
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: oaiMessages, tools: anthropicToolsToOpenAI(tools), max_tokens: maxTokens }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new AIClientError(`OpenAI-compatible API error ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json() as OpenAIResponse;
  const choice = data.choices[0];
  if (!choice) throw new AIClientError("No choices in OpenAI response");

  // Convert back to Anthropic content block format
  const content: Anthropic.ContentBlock[] = [];
  if (choice.message.content) {
    content.push({ type: "text", text: choice.message.content } as Anthropic.TextBlock);
  }
  for (const tc of choice.message.tool_calls ?? []) {
    content.push({
      type: "tool_use",
      id: tc.id,
      name: tc.function.name,
      input: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
    } as unknown as Anthropic.ContentBlock);
  }

  const stopReason = choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn";
  const usage = { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 };

  return { content, stop_reason: stopReason, usage };
}

/**
 * Creates the right client/config for a given model. Returns either an Anthropic
 * client or a config object for the OpenAI-compatible path.
 */
// ─── Unified AgentLLMClient ─────────────────────────────────────────────────
// Single interface for all providers — no if/else branching in the agent loop.

export type OpenAICompatConfig = { provider: "openai" | "google" | "cerebras"; baseUrl: string; apiKey: string };

export function createClientForModel(model: string, apiKey?: string): Anthropic | OpenAICompatConfig {
  const provider = detectProvider(model);
  if (provider === "openai") {
    const key = apiKey ?? process.env["OPENAI_API_KEY"];
    if (!key) throw new AIClientError("No OpenAI API key. Set OPENAI_API_KEY or pass it explicitly.");
    return { provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: key };
  }
  if (provider === "google") {
    const key = apiKey ?? process.env["GOOGLE_API_KEY"];
    if (!key) throw new AIClientError("No Google API key. Set GOOGLE_API_KEY or pass it explicitly.");
    return { provider: "google", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: key };
  }
  if (provider === "cerebras") {
    const key = apiKey ?? process.env["CEREBRAS_API_KEY"];
    if (!key) throw new AIClientError("No Cerebras API key. Set CEREBRAS_API_KEY or pass it explicitly.");
    return { provider: "cerebras", baseUrl: "https://api.cerebras.ai/v1", apiKey: key };
  }
  return createClient(apiKey);
}
