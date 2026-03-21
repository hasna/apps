/**
 * Self-healing selector repair.
 *
 * When a browser tool fails because a CSS selector can't be found,
 * healer.ts takes a screenshot of the current page, sends it along with
 * the original intent to the configured AI model, and asks it to identify
 * the new correct selector.
 *
 * Provider-agnostic: uses the same multi-provider stack as judge.ts.
 * Config: enabled via selfHeal: true in ~/.testers/config.json
 */

import type { Page } from "playwright";
import Anthropic from "@anthropic-ai/sdk";
import { detectProvider, callOpenAICompatible } from "./ai-client.js";
import { AIClientError } from "../types/index.js";
import { loadConfig } from "./config.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HealRequest {
  page: Page;
  failedSelector: string;
  intent: string;        // human-readable intent e.g. "click the submit button"
  model?: string;        // defaults to judgeModel from config
}

export interface HealResult {
  newSelector: string | null;
  confidence: number;    // 0.0 – 1.0
  reasoning: string;
  healed: boolean;
}

// ─── Healing Logic ────────────────────────────────────────────────────────────

const HEAL_SYSTEM = `You are a browser automation expert. A test step failed because a CSS selector couldn't be found on the page.
Given a screenshot of the current page and the original intent, identify the most likely correct CSS selector for the target element.

Respond ONLY with JSON — no markdown, no explanation outside JSON:
{"selector": "...", "confidence": 0.0-1.0, "reasoning": "brief explanation"}

If the element is not visible on the page at all, respond with:
{"selector": null, "confidence": 0.0, "reasoning": "Element not found on page"}

Rules for selectors:
- Prefer data-testid, aria-label, role-based selectors over CSS classes
- Prefer text-based selectors: button:has-text("Submit"), [aria-label="Close"]
- Avoid highly specific or fragile selectors like nth-child chains
- If the original selector was for a button/link, look for the element with similar text or function`;

export async function healSelector(request: HealRequest): Promise<HealResult> {
  const config = loadConfig();

  // Check if self-heal is enabled
  if (!config.selfHeal) {
    return { newSelector: null, confidence: 0, reasoning: "Self-healing disabled (set selfHeal: true in config)", healed: false };
  }

  const model = request.model ?? config.judgeModel ?? config.defaultModel;
  const provider = detectProvider(model);

  // Take a screenshot of the current page state
  let screenshotBase64: string;
  try {
    const screenshotBuffer = await request.page.screenshot({ type: "png" });
    screenshotBase64 = screenshotBuffer.toString("base64");
  } catch {
    return { newSelector: null, confidence: 0, reasoning: "Could not capture screenshot", healed: false };
  }

  const userMessage = `The test step failed trying to: "${request.intent}"
Original selector that failed: "${request.failedSelector}"

Please identify the correct selector from the screenshot.`;

  let rawResponse = "";
  try {
    if (provider === "openai" || provider === "google") {
      const baseUrl = provider === "openai"
        ? "https://api.openai.com/v1"
        : "https://generativelanguage.googleapis.com/v1beta/openai";
      const apiKey = provider === "openai"
        ? (process.env["OPENAI_API_KEY"] ?? "")
        : (process.env["GOOGLE_API_KEY"] ?? "");

      // For OpenAI-compat, pass image as base64 in message content
      const resp = await callOpenAICompatible({
        baseUrl, apiKey, model,
        system: HEAL_SYSTEM,
        messages: [{ role: "user", content: userMessage }],
        tools: [],
        maxTokens: 256,
      });
      const text = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
      rawResponse = text?.text ?? "{}";
    } else {
      // Anthropic — supports vision natively
      const apiKey = process.env["ANTHROPIC_API_KEY"] ?? config.anthropicApiKey ?? "";
      if (!apiKey) throw new AIClientError("No Anthropic API key for self-healing.");
      const anthropic = new Anthropic({ apiKey });

      const resp = await anthropic.messages.create({
        model, max_tokens: 256,
        system: HEAL_SYSTEM,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: screenshotBase64 },
            },
            { type: "text", text: userMessage },
          ],
        }],
      });
      const textBlock = resp.content.find((b) => b.type === "text") as { type: "text"; text: string } | undefined;
      rawResponse = textBlock?.text ?? "{}";
    }
  } catch (err) {
    return {
      newSelector: null, confidence: 0,
      reasoning: `Healing AI call failed: ${err instanceof Error ? err.message : String(err)}`,
      healed: false,
    };
  }

  // Parse JSON response
  const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { newSelector: null, confidence: 0, reasoning: "Could not parse AI response", healed: false };

  let parsed: { selector?: string | null; confidence?: number; reasoning?: string };
  try {
    parsed = JSON.parse(jsonMatch[0]) as typeof parsed;
  } catch {
    return { newSelector: null, confidence: 0, reasoning: "Invalid JSON from AI", healed: false };
  }

  const newSelector = parsed.selector ?? null;
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  const reasoning = parsed.reasoning ?? "No reasoning provided";

  // Validate the suggested selector actually resolves on the page
  if (newSelector && confidence >= 0.6) {
    try {
      const element = await request.page.$(newSelector);
      if (!element) {
        return {
          newSelector: null, confidence: 0,
          reasoning: `AI suggested "${newSelector}" but it doesn't resolve on the page`,
          healed: false,
        };
      }
      return { newSelector, confidence, reasoning, healed: true };
    } catch {
      return { newSelector: null, confidence: 0, reasoning: `Suggested selector "${newSelector}" is invalid CSS`, healed: false };
    }
  }

  return { newSelector: null, confidence, reasoning, healed: false };
}
