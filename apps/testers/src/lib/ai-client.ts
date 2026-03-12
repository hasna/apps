import Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import type { Screenshotter } from "./screenshotter.js";
import { MODEL_MAP, AIClientError } from "../types/index.js";
import type { ModelPreset, Scenario } from "../types/index.js";

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
];

// ─── Tool Execution ─────────────────────────────────────────────────────────

interface ToolContext {
  runId: string;
  scenarioSlug: string;
  stepNumber: number;
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
        return {
          result: `Navigated to ${url}`,
          screenshot,
        };
      }

      case "click": {
        const selector = toolInput.selector as string;
        await page.click(selector);
        const screenshot = await screenshotter.capture(page, {
          runId: context.runId,
          scenarioSlug: context.scenarioSlug,
          stepNumber: context.stepNumber,
          action: "click",
        });
        return {
          result: `Clicked element: ${selector}`,
          screenshot,
        };
      }

      case "fill": {
        const selector = toolInput.selector as string;
        const value = toolInput.value as string;
        await page.fill(selector, value);
        return {
          result: `Filled "${selector}" with value`,
        };
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
  client: Anthropic;
  page: Page;
  scenario: Scenario;
  screenshotter: Screenshotter;
  model: string;
  runId: string;
  maxTurns?: number;
  onStep?: StepEventHandler;
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
    maxTurns = 30,
    onStep,
  } = options;

  const systemPrompt = [
    "You are an expert QA testing agent. Your job is to thoroughly test web application scenarios.",
    "You have browser tools to navigate, interact with, and inspect web pages.",
    "",
    "Strategy:",
    "1. First navigate to the target page and take a screenshot to understand the layout",
    "2. If you can't find an element, use get_elements or get_page_html to discover selectors",
    "3. Use scroll to discover content below the fold",
    "4. Use wait_for or wait_for_navigation after actions that trigger page loads",
    "5. Take screenshots after every meaningful state change",
    "6. Use assert_text and assert_visible to verify expected outcomes",
    "7. When done testing, call report_result with detailed pass/fail reasoning",
    "",
    "Tips:",
    "- Try multiple selector strategies: by text, by role, by class, by id",
    "- If a click triggers navigation, use wait_for_navigation after",
    "- For forms, fill all fields before submitting",
    "- Check for error messages after form submissions",
    "- Verify both positive and negative states",
  ].join("\n");

  // Build the user message from the scenario
  const userParts: string[] = [
    `**Scenario:** ${scenario.name}`,
    `**Description:** ${scenario.description}`,
  ];

  if (scenario.targetPath) {
    userParts.push(`**Target Path:** ${scenario.targetPath}`);
  }

  if (scenario.steps.length > 0) {
    userParts.push("**Steps:**");
    for (let i = 0; i < scenario.steps.length; i++) {
      userParts.push(`${i + 1}. ${scenario.steps[i]}`);
    }
  }

  const userMessage = userParts.join("\n");

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

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await client.messages.create({
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
          { runId, scenarioSlug, stepNumber },
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
