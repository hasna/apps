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

interface AgentLoopOptions {
  client: Anthropic;
  page: Page;
  scenario: Scenario;
  screenshotter: Screenshotter;
  model: string;
  runId: string;
  maxTurns?: number;
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
  } = options;

  const systemPrompt = [
    "You are a QA testing agent. Test the following scenario by interacting with the browser.",
    "Use the provided tools to navigate, click, fill forms, and verify results.",
    "When done, call report_result with your findings.",
    "Be methodical: navigate to the target page first, then follow the test steps.",
    "If a step fails, try reasonable alternatives before reporting failure.",
    "Always report a final result — never leave a test incomplete.",
  ].join(" ");

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

      for (const toolBlock of toolUseBlocks) {
        stepNumber++;
        const toolInput = toolBlock.input as Record<string, unknown>;

        const execResult = await executeTool(
          page,
          screenshotter,
          toolBlock.name,
          toolInput,
          { runId, scenarioSlug, stepNumber },
        );

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
