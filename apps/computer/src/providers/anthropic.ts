import Anthropic from "@anthropic-ai/sdk";
import type { ComputerProvider, ModelResponse, Screenshot, DriverAction, Point } from "../types/index.js";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250514";
const BETA_HEADER = "computer-use-2025-01-24";

/**
 * Anthropic computer use provider.
 * Uses the computer_20250124 tool type with Claude models.
 */
export class AnthropicProvider implements ComputerProvider {
  readonly name = "anthropic" as const;
  private client: Anthropic;
  private model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    this.client = new Anthropic({ apiKey: opts?.apiKey });
    this.model = opts?.model ?? DEFAULT_MODEL;
  }

  async analyze(params: {
    task: string;
    screenshot: Screenshot;
    history: ModelResponse[];
    systemPrompt?: string;
  }): Promise<ModelResponse> {
    const { task, screenshot, history, systemPrompt } = params;

    // Build messages from history
    const messages: Anthropic.MessageParam[] = [];

    // First message: task + initial screenshot
    if (history.length === 0) {
      messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: task,
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: screenshot.base64,
            },
          },
        ],
      });
    } else {
      // Reconstruct conversation from history
      messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: task,
          },
        ],
      });

      for (const step of history) {
        // Assistant's action
        if (step.action) {
          messages.push({
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: `action_${messages.length}`,
                name: "computer",
                input: convertActionToAnthropicInput(step.action),
              },
            ],
          });

          // Tool result with screenshot
          messages.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: `action_${messages.length - 1}`,
                content: [
                  {
                    type: "text",
                    text: "Action executed successfully.",
                  },
                ],
              },
            ],
          });
        }
      }

      // Add current screenshot
      messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: "Here is the current screen state. What should I do next to complete the task? If the task is complete, say TASK_COMPLETE.",
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: screenshot.base64,
            },
          },
        ],
      });
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt ?? buildSystemPrompt(screenshot),
      messages,
      tools: [
        {
          type: "computer_20250124" as any,
          name: "computer",
          display_width_px: screenshot.size.width,
          display_height_px: screenshot.size.height,
          display_number: 1,
        } as any,
      ],
      betas: [BETA_HEADER],
    } as any);

    return parseAnthropicResponse(response);
  }
}

function buildSystemPrompt(screenshot: Screenshot): string {
  return `You are a computer use agent. You can see the user's screen and control their mouse and keyboard to complete tasks.

Screen resolution: ${screenshot.size.width}x${screenshot.size.height}

Rules:
- Look at the screenshot carefully before deciding on an action
- Click precisely on UI elements — count pixels carefully
- After each action, wait for the UI to update before deciding the next action
- If you cannot complete the task, explain why
- When the task is complete, respond with TASK_COMPLETE in your text
- Be efficient — take the most direct path to completing the task
- If something goes wrong, try an alternative approach`;
}

export function convertActionToAnthropicInput(action: DriverAction): Record<string, any> {
  switch (action.type) {
    case "click":
      const clickType = action.button === "right" ? "right_click" :
        (action.count ?? 1) >= 2 ? "double_click" : "left_click";
      return { action: clickType, coordinate: [action.point.x, action.point.y] };
    case "type":
      return { action: "type", text: action.text };
    case "key":
      return { action: "key", text: action.keys };
    case "scroll":
      return { action: "scroll", coordinate: [action.point.x, action.point.y], direction: action.deltaY > 0 ? "down" : "up", amount: Math.abs(action.deltaY) };
    case "mouse_move":
      return { action: "mouse_move", coordinate: [action.point.x, action.point.y] };
    case "screenshot":
      return { action: "screenshot" };
    default:
      return { action: "screenshot" };
  }
}

export function parseAnthropicResponse(response: Anthropic.Message): ModelResponse {
  let action: DriverAction | null = null;
  let reasoning = "";
  let done = false;

  for (const block of response.content) {
    if (block.type === "text") {
      reasoning += block.text;
      if (block.text.includes("TASK_COMPLETE")) {
        done = true;
      }
    } else if (block.type === "tool_use" && block.name === "computer") {
      action = convertAnthropicInputToAction(block.input as Record<string, any>);
    }
  }

  return {
    action: done ? null : action,
    reasoning,
    done,
    usage: {
      input: response.usage?.input_tokens ?? 0,
      output: response.usage?.output_tokens ?? 0,
    },
  };
}

export function convertAnthropicInputToAction(input: Record<string, any>): DriverAction {
  const actionType = input.action as string;
  const coord = input.coordinate as [number, number] | undefined;
  const point: Point | undefined = coord ? { x: coord[0], y: coord[1] } : undefined;

  switch (actionType) {
    case "left_click":
      return { type: "click", point: point!, button: "left" };
    case "right_click":
      return { type: "click", point: point!, button: "right" };
    case "double_click":
      return { type: "click", point: point!, button: "left", count: 2 };
    case "triple_click":
      return { type: "click", point: point!, button: "left", count: 3 };
    case "middle_click":
      return { type: "click", point: point!, button: "middle" };
    case "type":
      return { type: "type", text: input.text };
    case "key":
      return { type: "key", keys: input.text };
    case "scroll":
      const amount = input.amount ?? 3;
      const dy = input.direction === "down" ? amount : -amount;
      return { type: "scroll", point: point!, deltaX: 0, deltaY: dy };
    case "mouse_move":
      return { type: "mouse_move", point: point! };
    case "left_click_drag":
      return { type: "drag", from: point!, to: { x: input.end_coordinate?.[0] ?? point!.x, y: input.end_coordinate?.[1] ?? point!.y } };
    case "screenshot":
      return { type: "screenshot" };
    case "wait":
      return { type: "wait", ms: (input.duration ?? 1) * 1000 };
    default:
      return { type: "screenshot" };
  }
}

export function createAnthropicProvider(opts?: { apiKey?: string; model?: string }): ComputerProvider {
  return new AnthropicProvider(opts);
}
