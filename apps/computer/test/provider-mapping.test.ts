// Test-gap lane: agent-authored analysis (SOL consult refused — gpt-5.6-sol consult timed out twice within the 2x600s protocol bound; no answer delivered). Authored by Paulinus.
import { describe, expect, test } from "bun:test";
import {
  convertActionToOpenAIAction,
  convertFallbackAction,
  convertOpenAICallToAction,
  parseOpenAIResponse,
} from "../src/providers/openai.js";
import {
  convertActionToAnthropicInput,
  convertAnthropicInputToAction,
  parseAnthropicResponse,
} from "../src/providers/anthropic.js";
import type { DriverAction } from "../src/types/index.js";

describe("openai — DriverAction → wire action", () => {
  test("left click with count 1 becomes click", () => {
    expect(convertActionToOpenAIAction({ type: "click", point: { x: 10, y: 20 }, button: "left" })).toEqual({
      type: "click",
      x: 10,
      y: 20,
    });
  });

  test("right click becomes right_click", () => {
    expect(convertActionToOpenAIAction({ type: "click", point: { x: 1, y: 2 }, button: "right" })).toMatchObject({
      type: "right_click",
    });
  });

  test("double click (count >= 2) becomes double_click", () => {
    expect(convertActionToOpenAIAction({ type: "click", point: { x: 1, y: 2 }, count: 2 })).toMatchObject({
      type: "double_click",
    });
  });

  test("type passes text through", () => {
    expect(convertActionToOpenAIAction({ type: "type", text: "ls -la" })).toEqual({ type: "type", text: "ls -la" });
  });

  test("key splits modifiers into an array", () => {
    expect(convertActionToOpenAIAction({ type: "key", keys: "cmd+shift+a" })).toEqual({
      type: "keypress",
      keys: ["cmd", "shift", "a"],
    });
  });

  test("scroll carries both deltas", () => {
    expect(convertActionToOpenAIAction({ type: "scroll", point: { x: 5, y: 6 }, deltaX: 2, deltaY: -3 })).toEqual({
      type: "scroll",
      x: 5,
      y: 6,
      scroll_x: 2,
      scroll_y: -3,
    });
  });

  test("drag maps from/to to start/end", () => {
    expect(convertActionToOpenAIAction({ type: "drag", from: { x: 1, y: 2 }, to: { x: 3, y: 4 } })).toEqual({
      type: "drag",
      start_x: 1,
      start_y: 2,
      end_x: 3,
      end_y: 4,
    });
  });

  test("unsupported actions degrade to screenshot", () => {
    expect(convertActionToOpenAIAction({ type: "open_url", url: "https://x.example" })).toEqual({ type: "screenshot" });
  });
});

describe("openai — wire action → DriverAction", () => {
  test("click maps to left button", () => {
    expect(convertOpenAICallToAction({ type: "click", x: 1, y: 2 })).toEqual({
      type: "click",
      point: { x: 1, y: 2 },
      button: "left",
    });
  });

  test("right_click and double_click preserve button/count", () => {
    expect(convertOpenAICallToAction({ type: "right_click", x: 1, y: 2 })).toMatchObject({ button: "right" });
    expect(convertOpenAICallToAction({ type: "double_click", x: 1, y: 2 })).toMatchObject({ button: "left", count: 2 });
  });

  test("keypress joins keys back with +", () => {
    expect(convertOpenAICallToAction({ type: "keypress", keys: ["cmd", "c"] })).toEqual({
      type: "key",
      keys: "cmd+c",
    });
  });

  test("scroll defaults missing deltas to 0", () => {
    expect(convertOpenAICallToAction({ type: "scroll", x: 1, y: 2 })).toEqual({
      type: "scroll",
      point: { x: 1, y: 2 },
      deltaX: 0,
      deltaY: 0,
    });
  });

  test("drag maps start/end back to from/to", () => {
    expect(convertOpenAICallToAction({ type: "drag", start_x: 1, start_y: 2, end_x: 3, end_y: 4 })).toEqual({
      type: "drag",
      from: { x: 1, y: 2 },
      to: { x: 3, y: 4 },
    });
  });

  test("unknown wire actions degrade to screenshot", () => {
    expect(convertOpenAICallToAction({ type: "warp_drive" })).toEqual({ type: "screenshot" });
  });
});

describe("openai — parseOpenAIResponse (responses API)", () => {
  test("text with TASK_COMPLETE marks done and nulls the action", () => {
    const r = parseOpenAIResponse({
      output: [
        { type: "text", text: "All done TASK_COMPLETE" },
        { type: "computer_call", action: { type: "click", x: 1, y: 2 } },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    expect(r.done).toBe(true);
    expect(r.action).toBeNull();
    expect(r.usage).toEqual({ input: 10, output: 20 });
  });

  test("computer_call without TASK_COMPLETE produces an action", () => {
    const r = parseOpenAIResponse({
      output: [{ type: "computer_call", action: { type: "type", text: "hi" } }],
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    expect(r.done).toBe(false);
    expect(r.action).toEqual({ type: "type", text: "hi" });
  });

  test("chat-completions shape (output absent) yields an empty parse, not a crash", () => {
    // parseOpenAIResponse is only used on the responses-API path; a
    // chat-completions response has no output array, so it falls through to
    // the empty result with usage mapped from the chat fields.
    const r = parseOpenAIResponse({
      choices: [{ message: { content: "clicking" } }],
      usage: { prompt_tokens: 5, completion_tokens: 6 },
    });
    expect(r.reasoning).toBe("");
    expect(r.action).toBeNull();
    expect(r.done).toBe(false);
    expect(r.usage).toEqual({ input: 5, output: 6 });
  });

  test("missing output returns done with no action", () => {
    const r = parseOpenAIResponse({});
    expect(r.done).toBe(true);
    expect(r.action).toBeNull();
  });
});

describe("openai — fallback chat-completions action parsing", () => {
  test("done action", () => {
    expect(convertFallbackAction({ action: "done" })).toEqual({ action: null, done: true });
  });

  test("unknown action degrades to done", () => {
    expect(convertFallbackAction({ action: "self_destruct" })).toEqual({ action: null, done: true });
  });

  test("scroll up maps to negative deltaY", () => {
    expect(convertFallbackAction({ action: "scroll", scroll_direction: "up", x: 1, y: 2 })).toEqual({
      action: { type: "scroll", point: { x: 1, y: 2 }, deltaX: 0, deltaY: -3 },
      done: false,
    });
  });

  test("key uses text as the keys string", () => {
    expect(convertFallbackAction({ action: "key", text: "cmd+c" })).toEqual({
      action: { type: "key", keys: "cmd+c" },
      done: false,
    });
  });
});

describe("anthropic — DriverAction → tool input", () => {
  test("click button/count mapping", () => {
    expect(convertActionToAnthropicInput({ type: "click", point: { x: 10, y: 20 } })).toEqual({
      action: "left_click",
      coordinate: [10, 20],
    });
    expect(convertActionToAnthropicInput({ type: "click", point: { x: 1, y: 2 }, button: "right" })).toMatchObject({
      action: "right_click",
    });
    expect(convertActionToAnthropicInput({ type: "click", point: { x: 1, y: 2 }, count: 2 })).toMatchObject({
      action: "double_click",
    });
  });

  test("scroll direction derives from deltaY sign", () => {
    expect(convertActionToAnthropicInput({ type: "scroll", point: { x: 1, y: 2 }, deltaX: 0, deltaY: 5 })).toEqual({
      action: "scroll",
      coordinate: [1, 2],
      direction: "down",
      amount: 5,
    });
    expect(convertActionToAnthropicInput({ type: "scroll", point: { x: 1, y: 2 }, deltaX: 0, deltaY: -5 })).toEqual({
      action: "scroll",
      coordinate: [1, 2],
      direction: "up",
      amount: 5,
    });
  });

  test("key passes the combo text", () => {
    expect(convertActionToAnthropicInput({ type: "key", keys: "cmd+option+escape" })).toEqual({
      action: "key",
      text: "cmd+option+escape",
    });
  });
});

describe("anthropic — tool input → DriverAction", () => {
  test("click variants", () => {
    expect(convertAnthropicInputToAction({ action: "left_click", coordinate: [1, 2] })).toEqual({
      type: "click",
      point: { x: 1, y: 2 },
      button: "left",
    });
    expect(convertAnthropicInputToAction({ action: "triple_click", coordinate: [1, 2] })).toMatchObject({ count: 3 });
    expect(convertAnthropicInputToAction({ action: "middle_click", coordinate: [1, 2] })).toMatchObject({
      button: "middle",
    });
  });

  test("scroll default amount is 3 and direction maps to sign", () => {
    expect(convertAnthropicInputToAction({ action: "scroll", coordinate: [1, 2], direction: "down" })).toEqual({
      type: "scroll",
      point: { x: 1, y: 2 },
      deltaX: 0,
      deltaY: 3,
    });
    expect(convertAnthropicInputToAction({ action: "scroll", coordinate: [1, 2], direction: "up", amount: 7 })).toEqual({
      type: "scroll",
      point: { x: 1, y: 2 },
      deltaX: 0,
      deltaY: -7,
    });
  });

  test("left_click_drag falls back to the start point when end_coordinate is missing", () => {
    expect(convertAnthropicInputToAction({ action: "left_click_drag", coordinate: [5, 5] })).toEqual({
      type: "drag",
      from: { x: 5, y: 5 },
      to: { x: 5, y: 5 },
    });
    expect(convertAnthropicInputToAction({ action: "left_click_drag", coordinate: [5, 5], end_coordinate: [9, 9] })).toEqual({
      type: "drag",
      from: { x: 5, y: 5 },
      to: { x: 9, y: 9 },
    });
  });

  test("wait uses duration seconds with a 1s default", () => {
    expect(convertAnthropicInputToAction({ action: "wait", duration: 2 })).toEqual({ type: "wait", ms: 2000 });
    expect(convertAnthropicInputToAction({ action: "wait" })).toEqual({ type: "wait", ms: 1000 });
  });

  test("unknown tool input degrades to screenshot", () => {
    expect(convertAnthropicInputToAction({ action: "launch_missiles" })).toEqual({ type: "screenshot" });
  });
});

describe("anthropic — parseAnthropicResponse", () => {
  test("text + tool_use produces action and reasoning", () => {
    const r = parseAnthropicResponse({
      content: [
        { type: "text", text: "Clicking the button" },
        { type: "tool_use", name: "computer", input: { action: "left_click", coordinate: [1, 2] } },
      ],
      usage: { input_tokens: 3, output_tokens: 4 },
    } as any);
    expect(r.reasoning).toContain("Clicking");
    expect(r.action).toEqual({ type: "click", point: { x: 1, y: 2 }, button: "left" });
    expect(r.done).toBe(false);
    expect(r.usage).toEqual({ input: 3, output: 4 });
  });

  test("TASK_COMPLETE in text overrides any tool_use action", () => {
    const r = parseAnthropicResponse({
      content: [
        { type: "text", text: "Task complete TASK_COMPLETE" },
        { type: "tool_use", name: "computer", input: { action: "left_click", coordinate: [1, 2] } },
      ],
      usage: {},
    } as any);
    expect(r.done).toBe(true);
    expect(r.action).toBeNull();
  });

  test("non-computer tool_use is ignored", () => {
    const r = parseAnthropicResponse({
      content: [{ type: "tool_use", name: "web_search", input: { query: "x" } }],
      usage: {},
    } as any);
    expect(r.action).toBeNull();
  });
});
