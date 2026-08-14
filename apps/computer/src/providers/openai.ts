import OpenAI from "openai";
import type { ComputerProvider, ModelResponse, Screenshot, DriverAction, Point } from "../types/index.js";

const DEFAULT_MODEL = "computer-use-preview";

/**
 * OpenAI CUA (Computer-Using Agent) provider.
 * Uses the computer-use-preview model via the Responses API.
 */
export class OpenAIProvider implements ComputerProvider {
  readonly name = "openai" as const;
  private client: OpenAI;
  private model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    this.client = new OpenAI({ apiKey: opts?.apiKey });
    this.model = opts?.model ?? DEFAULT_MODEL;
  }

  async analyze(params: {
    task: string;
    screenshot: Screenshot;
    history: ModelResponse[];
    systemPrompt?: string;
  }): Promise<ModelResponse> {
    const { task, screenshot, history, systemPrompt } = params;

    // Build the input for the responses API
    const input: any[] = [];

    if (systemPrompt) {
      input.push({
        role: "developer",
        content: systemPrompt,
      });
    }

    // Add the task
    input.push({
      role: "user",
      content: [
        {
          type: "input_text",
          text: task,
        },
        {
          type: "input_image",
          image_url: `data:image/png;base64,${screenshot.base64}`,
        },
      ],
    });

    // Add history as computer_call + results
    for (const step of history) {
      if (step.action && step.action.type !== "screenshot") {
        input.push({
          type: "computer_call",
          call_id: `call_${input.length}`,
          action: convertActionToOpenAIAction(step.action),
        });
        // Add a screenshot result
        input.push({
          type: "computer_call_output",
          call_id: `call_${input.length - 1}`,
          output: {
            type: "computer_screenshot",
            image_url: `data:image/png;base64,${screenshot.base64}`,
          },
        });
      }
    }

    try {
      const response = await this.client.responses.create({
        model: this.model,
        input,
        tools: [
          {
            type: "computer_use_preview",
            display_width: screenshot.size.width,
            display_height: screenshot.size.height,
            environment: "mac",
          } as any,
        ],
        truncation: "auto",
      } as any);

      return parseOpenAIResponse(response);
    } catch (err) {
      // Fallback: use chat completions with vision if responses API not available
      return this.fallbackAnalyze(params);
    }
  }

  /**
   * Fallback using chat completions with vision for models that don't support CUA.
   */
  private async fallbackAnalyze(params: {
    task: string;
    screenshot: Screenshot;
    history: ModelResponse[];
    systemPrompt?: string;
  }): Promise<ModelResponse> {
    const { task, screenshot, systemPrompt } = params;

    const response = await this.client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content: systemPrompt ?? buildFallbackSystemPrompt(screenshot),
        },
        {
          role: "user",
          content: [
            { type: "text", text: task },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${screenshot.base64}` },
            },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "computer_action",
            description: "Execute a computer action (click, type, key, scroll, etc.)",
            parameters: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["click", "type", "key", "scroll", "mouse_move", "done"] },
                x: { type: "number", description: "X coordinate for click/scroll/move" },
                y: { type: "number", description: "Y coordinate for click/scroll/move" },
                text: { type: "string", description: "Text to type or key to press" },
                button: { type: "string", enum: ["left", "right", "middle"] },
                scroll_direction: { type: "string", enum: ["up", "down"] },
              },
              required: ["action"],
            },
          },
        },
      ],
    });

    const message = response.choices[0]?.message;
    if (!message) {
      return { action: null, reasoning: "No response from model", done: true };
    }

    let reasoning = message.content ?? "";
    let action: DriverAction | null = null;
    let done = false;

    if (message.tool_calls?.length) {
      const call = message.tool_calls[0];
      const args = JSON.parse(call.function.arguments);
      const result = convertFallbackAction(args);
      action = result.action;
      done = result.done;
    }

    if (reasoning.includes("TASK_COMPLETE")) {
      done = true;
      action = null;
    }

    return {
      action,
      reasoning,
      done,
      usage: {
        input: response.usage?.prompt_tokens ?? 0,
        output: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}

function buildFallbackSystemPrompt(screenshot: Screenshot): string {
  return `You are a computer use agent controlling a Mac. You see screenshots and decide actions.

Screen: ${screenshot.size.width}x${screenshot.size.height}

Call the computer_action tool to interact. Use action "done" when the task is complete.
Be precise with coordinates — look at the screenshot carefully.`;
}

function convertActionToOpenAIAction(action: DriverAction): Record<string, any> {
  switch (action.type) {
    case "click":
      return {
        type: action.button === "right" ? "right_click" :
          (action.count ?? 1) >= 2 ? "double_click" : "click",
        x: action.point.x,
        y: action.point.y,
      };
    case "type":
      return { type: "type", text: action.text };
    case "key":
      return { type: "keypress", keys: action.keys.split("+") };
    case "scroll":
      return {
        type: "scroll",
        x: action.point.x,
        y: action.point.y,
        scroll_x: action.deltaX,
        scroll_y: action.deltaY,
      };
    case "mouse_move":
      return { type: "move", x: action.point.x, y: action.point.y };
    case "drag":
      return { type: "drag", start_x: action.from.x, start_y: action.from.y, end_x: action.to.x, end_y: action.to.y };
    default:
      return { type: "screenshot" };
  }
}

function parseOpenAIResponse(response: any): ModelResponse {
  let action: DriverAction | null = null;
  let reasoning = "";
  let done = false;

  const output = response.output ?? response.choices?.[0]?.message;
  if (!output) {
    return { action: null, reasoning: "No output", done: true };
  }

  // Handle responses API format
  if (Array.isArray(output)) {
    for (const item of output) {
      if (item.type === "text") {
        reasoning += item.text;
        if (item.text.includes("TASK_COMPLETE")) done = true;
      } else if (item.type === "computer_call") {
        action = convertOpenAICallToAction(item.action);
      }
    }
  }

  return {
    action: done ? null : action,
    reasoning,
    done,
    usage: {
      input: response.usage?.input_tokens ?? response.usage?.prompt_tokens ?? 0,
      output: response.usage?.output_tokens ?? response.usage?.completion_tokens ?? 0,
    },
  };
}

function convertOpenAICallToAction(action: Record<string, any>): DriverAction {
  switch (action.type) {
    case "click":
      return { type: "click", point: { x: action.x, y: action.y }, button: "left" };
    case "right_click":
      return { type: "click", point: { x: action.x, y: action.y }, button: "right" };
    case "double_click":
      return { type: "click", point: { x: action.x, y: action.y }, button: "left", count: 2 };
    case "type":
      return { type: "type", text: action.text };
    case "keypress":
      return { type: "key", keys: (action.keys ?? []).join("+") };
    case "scroll":
      return { type: "scroll", point: { x: action.x, y: action.y }, deltaX: action.scroll_x ?? 0, deltaY: action.scroll_y ?? 0 };
    case "move":
      return { type: "mouse_move", point: { x: action.x, y: action.y } };
    case "drag":
      return { type: "drag", from: { x: action.start_x, y: action.start_y }, to: { x: action.end_x, y: action.end_y } };
    case "screenshot":
      return { type: "screenshot" };
    default:
      return { type: "screenshot" };
  }
}

function convertFallbackAction(args: any): { action: DriverAction | null; done: boolean } {
  switch (args.action) {
    case "click":
      return { action: { type: "click", point: { x: args.x, y: args.y }, button: args.button ?? "left" }, done: false };
    case "type":
      return { action: { type: "type", text: args.text }, done: false };
    case "key":
      return { action: { type: "key", keys: args.text }, done: false };
    case "scroll":
      return { action: { type: "scroll", point: { x: args.x ?? 0, y: args.y ?? 0 }, deltaX: 0, deltaY: args.scroll_direction === "up" ? -3 : 3 }, done: false };
    case "mouse_move":
      return { action: { type: "mouse_move", point: { x: args.x, y: args.y } }, done: false };
    case "done":
      return { action: null, done: true };
    default:
      return { action: null, done: true };
  }
}

export function createOpenAIProvider(opts?: { apiKey?: string; model?: string }): ComputerProvider {
  return new OpenAIProvider(opts);
}
