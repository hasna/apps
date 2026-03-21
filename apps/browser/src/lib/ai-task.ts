/**
 * browser_task — natural language to auto-executed browser flow via Haiku.
 * "Find the Pro tier monthly price" → navigates, reads, returns the answer.
 */

import type { Page } from "playwright";
import Anthropic from "@anthropic-ai/sdk";

export interface TaskResult {
  success: boolean;
  result: unknown;
  steps_taken: number;
  steps: Array<{ tool: string; args: Record<string, unknown>; outcome: string }>;
  cost_estimate: number;
  error?: string;
}

const SYSTEM_PROMPT = `You are a browser automation agent. Given a task and the current page state, decide which browser actions to take.

Return a JSON array of at most 3 actions to execute next:
[{"tool": "navigate|click|type|scroll|evaluate|done", "args": {...}, "reason": "..."}]

Use "done" when the task is complete with {"result": "the answer"}.
Keep actions simple and focused. Prefer evaluate for data extraction.`;

export async function executeBrowserTask(
  page: Page,
  task: string,
  opts?: { maxSteps?: number; model?: string; sessionId?: string }
): Promise<TaskResult> {
  const maxSteps = opts?.maxSteps ?? 10;
  const model = opts?.model ?? "claude-haiku-4-5-20251001";
  const steps: TaskResult["steps"] = [];
  let totalTokens = 0;

  const client = new Anthropic();

  for (let step = 0; step < maxSteps; step++) {
    // Get current page state
    let pageState = "";
    try {
      const { takeSnapshot } = await import("./snapshot.js");
      const snap = await takeSnapshot(page, opts?.sessionId);
      const url = page.url?.() ?? await page.evaluate("location.href") as string;
      const title = await page.evaluate("document.title") as string;
      pageState = `URL: ${url}\nTitle: ${title}\nInteractive elements:\n${snap.tree.slice(0, 2000)}`;
    } catch {
      pageState = `URL: ${page.url?.() ?? "unknown"}`;
    }

    // Ask Haiku what to do
    const response = await client.messages.create({
      model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Task: ${task}\n\nCurrent page state:\n${pageState}\n\nSteps taken so far: ${steps.length}\n\nWhat actions should I take next? Return JSON array.`,
      }],
    });

    totalTokens += (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    let actions: Array<{ tool: string; args: Record<string, unknown>; reason?: string }> = [];
    try {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) actions = JSON.parse(match[0]);
    } catch {
      return { success: false, result: null, steps_taken: steps.length, steps, cost_estimate: totalTokens / 1000 * 0.00025, error: "Failed to parse Haiku response" };
    }

    // Execute each action
    for (const action of actions) {
      let outcome = "ok";
      try {
        switch (action.tool) {
          case "done":
            const result = action.args?.result ?? action.args;
            return { success: true, result, steps_taken: steps.length + 1, steps: [...steps, { tool: "done", args: action.args, outcome: "completed" }], cost_estimate: totalTokens / 1000 * 0.00025 };

          case "navigate":
            if (action.args?.url) await page.goto(action.args.url as string, { waitUntil: "domcontentloaded" } as any);
            break;

          case "click":
            if (action.args?.selector) await page.click(action.args.selector as string);
            else if (action.args?.text) {
              const { clickText } = await import("./actions.js");
              await clickText(page as any, action.args.text as string);
            }
            break;

          case "type":
            if (action.args?.selector && action.args?.text) await page.fill(action.args.selector as string, action.args.text as string);
            break;

          case "scroll":
            await page.evaluate(`window.scrollBy(0, ${action.args?.amount ?? 500})`);
            break;

          case "evaluate":
            const evalResult = await page.evaluate(action.args?.script as string ?? "null");
            outcome = JSON.stringify(evalResult).slice(0, 200);
            break;

          default:
            outcome = `unknown action: ${action.tool}`;
        }
      } catch (err) {
        outcome = `error: ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`;
      }

      steps.push({ tool: action.tool, args: action.args, outcome });
    }

    // Short pause between steps
    await new Promise(r => setTimeout(r, 300));
  }

  return { success: false, result: null, steps_taken: steps.length, steps, cost_estimate: totalTokens / 1000 * 0.00025, error: `Reached max steps (${maxSteps}) without completing task` };
}
