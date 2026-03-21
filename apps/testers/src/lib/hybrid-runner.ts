/**
 * Hybrid test runner — mix AI-driven steps with deterministic Playwright steps.
 *
 * Usage example (in a .ts script file):
 *
 *   import type { HybridScenario } from "@hasnaxyz/testers/lib/hybrid-runner";
 *   export const scenarios: HybridScenario[] = [
 *     {
 *       name: "Login flow",
 *       steps: [
 *         { type: "navigate", url: "/login" },
 *         { type: "fill", selector: "#email", value: "test@example.com" },
 *         { type: "fill", selector: "#password", value: "secret" },
 *         { type: "click", selector: "button[type=submit]" },
 *         { type: "ai", instruction: "Verify the dashboard loaded and the user is logged in" },
 *         { type: "ai_verify", assertion: "The page shows a welcome message with the user's name" },
 *       ],
 *     },
 *   ];
 */

import type { Page, Browser } from "playwright";
import { launchBrowser, getPage, closeBrowser } from "./browser.js";
import { Screenshotter } from "./screenshotter.js";
import { createClientForModel, runAgentLoop, resolveModel } from "./ai-client.js";
import { loadConfig } from "./config.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type HybridStepType =
  | "navigate"
  | "click"
  | "fill"
  | "wait"
  | "wait_for"
  | "screenshot"
  | "assert_text"
  | "assert_visible"
  | "ai"
  | "ai_verify";

export interface NavigateStep { type: "navigate"; url: string }
export interface ClickStep { type: "click"; selector: string }
export interface FillStep { type: "fill"; selector: string; value: string }
export interface WaitStep { type: "wait"; ms: number }
export interface WaitForStep { type: "wait_for"; selector: string; timeoutMs?: number }
export interface ScreenshotStep { type: "screenshot"; label?: string }
export interface AssertTextStep { type: "assert_text"; selector: string; expected: string; contains?: boolean }
export interface AssertVisibleStep { type: "assert_visible"; selector: string; visible?: boolean }

/** AI-driven step — the agent browser-tests using the instruction as the scenario description */
export interface AiStep {
  type: "ai";
  instruction: string;
  maxTurns?: number;
  model?: string;
}

/** AI verification step — the agent judges whether the current page state matches the assertion */
export interface AiVerifyStep {
  type: "ai_verify";
  assertion: string;
  model?: string;
}

export type HybridStep =
  | NavigateStep
  | ClickStep
  | FillStep
  | WaitStep
  | WaitForStep
  | ScreenshotStep
  | AssertTextStep
  | AssertVisibleStep
  | AiStep
  | AiVerifyStep;

export interface HybridScenario {
  name: string;
  steps: HybridStep[];
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export interface HybridStepResult {
  stepIndex: number;
  type: HybridStepType;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  error?: string;
  reasoning?: string;
}

export interface HybridRunResult {
  scenarioName: string;
  status: "passed" | "failed" | "error";
  stepResults: HybridStepResult[];
  durationMs: number;
  error?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function runDeterministicStep(page: Page, step: HybridStep, baseUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    switch (step.type) {
      case "navigate": {
        const url = step.url.startsWith("http") ? step.url : `${baseUrl.replace(/\/$/, "")}${step.url}`;
        await page.goto(url, { timeout: 30000 });
        return { ok: true };
      }
      case "click":
        await page.click(step.selector, { timeout: 10000 });
        return { ok: true };
      case "fill":
        await page.fill(step.selector, step.value, { timeout: 10000 });
        return { ok: true };
      case "wait":
        await new Promise((r) => setTimeout(r, step.ms));
        return { ok: true };
      case "wait_for":
        await page.waitForSelector(step.selector, { timeout: step.timeoutMs ?? 10000 });
        return { ok: true };
      case "screenshot":
        await page.screenshot({ fullPage: false });
        return { ok: true };
      case "assert_text": {
        const text = await page.locator(step.selector).textContent({ timeout: 5000 });
        const actual = text ?? "";
        const ok = step.contains
          ? actual.includes(step.expected)
          : actual.trim() === step.expected.trim();
        if (!ok) return { ok: false, error: `Expected "${step.expected}", got "${actual}"` };
        return { ok: true };
      }
      case "assert_visible": {
        const shouldBeVisible = step.visible !== false;
        const count = await page.locator(step.selector).count();
        const isVisible = count > 0;
        if (shouldBeVisible && !isVisible) return { ok: false, error: `Expected ${step.selector} to be visible` };
        if (!shouldBeVisible && isVisible) return { ok: false, error: `Expected ${step.selector} to be hidden` };
        return { ok: true };
      }
      default:
        return { ok: true };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Main Runner ─────────────────────────────────────────────────────────────

export async function runHybridScenario(
  scenario: HybridScenario,
  options?: { baseUrl?: string; apiKey?: string; screenshotDir?: string }
): Promise<HybridRunResult> {
  const config = loadConfig();
  const baseUrl = scenario.baseUrl ?? options?.baseUrl ?? "http://localhost:3000";
  const startTime = Date.now();
  const stepResults: HybridStepResult[] = [];

  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await launchBrowser({ headless: true });
    page = await getPage(browser, { viewport: config.browser.viewport });

    const screenshotter = new Screenshotter({ baseDir: options?.screenshotDir ?? config.screenshots.dir });

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i]!;
      const stepStart = Date.now();

      if (step.type === "ai" || step.type === "ai_verify") {
        // AI-driven step
        const model = resolveModel(step.model ?? scenario.model ?? config.defaultModel);
        const client = createClientForModel(model, options?.apiKey ?? config.anthropicApiKey);

        const instruction = step.type === "ai_verify"
          ? `Verify the following assertion about the current page state: "${step.assertion}". Do NOT navigate. Just inspect the page and call report_result with pass or fail.`
          : step.instruction;

        // Build a minimal synthetic scenario for the agent loop
        const syntheticScenario = {
          id: `hybrid-step-${i}`,
          shortId: `hs-${i}`,
          name: `${scenario.name} — step ${i + 1}`,
          description: instruction,
          steps: [instruction],
          tags: [],
          priority: "medium" as const,
          model,
          timeoutMs: scenario.timeoutMs ?? 60000,
          targetPath: null,
          requiresAuth: false,
          authConfig: null,
          metadata: null,
          assertions: [],
          personaId: null,
          scenarioType: "browser" as const,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        try {
          const agentResult = await runAgentLoop({
            client,
            page,
            scenario: syntheticScenario,
            screenshotter,
            model,
            runId: `hybrid-${Date.now()}`,
            maxTurns: (step as AiStep).maxTurns ?? 15,
          });

          stepResults.push({
            stepIndex: i,
            type: step.type,
            status: agentResult.status === "passed" ? "passed" : "failed",
            durationMs: Date.now() - stepStart,
            reasoning: agentResult.reasoning,
            error: agentResult.status !== "passed" ? agentResult.reasoning : undefined,
          });

          if (agentResult.status !== "passed") {
            return {
              scenarioName: scenario.name,
              status: "failed",
              stepResults,
              durationMs: Date.now() - startTime,
              error: `Step ${i + 1} (ai): ${agentResult.reasoning}`,
            };
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          stepResults.push({ stepIndex: i, type: step.type, status: "failed", durationMs: Date.now() - stepStart, error: msg });
          return { scenarioName: scenario.name, status: "failed", stepResults, durationMs: Date.now() - startTime, error: msg };
        }
      } else {
        // Deterministic step
        const result = await runDeterministicStep(page, step, baseUrl);
        stepResults.push({
          stepIndex: i,
          type: step.type as HybridStepType,
          status: result.ok ? "passed" : "failed",
          durationMs: Date.now() - stepStart,
          error: result.error,
        });

        if (!result.ok) {
          return {
            scenarioName: scenario.name,
            status: "failed",
            stepResults,
            durationMs: Date.now() - startTime,
            error: `Step ${i + 1} (${step.type}): ${result.error}`,
          };
        }
      }
    }

    return { scenarioName: scenario.name, status: "passed", stepResults, durationMs: Date.now() - startTime };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { scenarioName: scenario.name, status: "error", stepResults, durationMs: Date.now() - startTime, error: msg };
  } finally {
    if (browser) await closeBrowser(browser);
  }
}
