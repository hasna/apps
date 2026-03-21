/**
 * Synthetic scenario generator.
 *
 * Crawls a web app using a real browser, discovers interactive surfaces
 * (forms, buttons, nav, pages), and uses the configured AI provider to
 * synthesize test scenarios covering happy paths, edge cases, and error states.
 *
 * Provider-agnostic: uses createClientForModel / callOpenAICompatible
 * from ai-client.ts — works with Claude, GPT-4o, Gemini.
 */

import { launchBrowser, getPage, closeBrowser } from "./browser.js";
import { createClientForModel, callOpenAICompatible, detectProvider } from "./ai-client.js";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "./config.js";
import { AIClientError } from "../types/index.js";
import type { CreateScenarioInput, ScenarioPriority } from "../types/index.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeneratorOptions {
  url: string;
  persona?: string;          // persona description to bias scenario generation
  maxScenarios?: number;     // default 10
  maxPages?: number;         // pages to crawl, default 10
  focus?: string;            // e.g. "auth flows", "checkout", "settings"
  model?: string;            // any provider: claude, gpt-4o, gemini
  headed?: boolean;
  projectId?: string;
  save?: boolean;            // persist to DB if true
}

export interface GeneratedScenario extends CreateScenarioInput {
  generatedFrom?: string;    // URL the discovery was based on
}

export interface GeneratorResult {
  scenarios: GeneratedScenario[];
  pagesDiscovered: number;
  tokensUsed: number;
  provider: string;
  model: string;
}

// ─── Page Discovery ───────────────────────────────────────────────────────────

interface PageSurface {
  url: string;
  title: string;
  forms: Array<{ action: string; fields: string[] }>;
  buttons: string[];
  links: Array<{ text: string; href: string }>;
  headings: string[];
}

async function discoverPage(page: import("playwright").Page, url: string): Promise<PageSurface> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(500);

    return await page.evaluate((): PageSurface => {
      const loc = window.location;
      const baseUrl = `${loc.protocol}//${loc.host}`;

      // Forms
      const forms = Array.from(document.querySelectorAll("form")).slice(0, 5).map((form) => ({
        action: form.action || loc.href,
        fields: Array.from(form.querySelectorAll("input,textarea,select")).slice(0, 8)
          .map((el) => {
            const e = el as HTMLInputElement;
            return e.placeholder || e.name || e.type || e.tagName.toLowerCase();
          }).filter((s) => s && s !== "hidden"),
      }));

      // Buttons
      const buttons = Array.from(document.querySelectorAll("button,[role=button],[type=submit]"))
        .slice(0, 10).map((b) => (b as HTMLElement).innerText?.trim() || b.getAttribute("aria-label") || "")
        .filter((t) => t.length > 0 && t.length < 60);

      // Internal links
      const links = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => ({ text: (a as HTMLElement).innerText?.trim() || "", href: (a as HTMLAnchorElement).href }))
        .filter((l) => l.href.startsWith(baseUrl) && l.text.length > 0 && l.text.length < 60)
        .slice(0, 15);

      // Headings
      const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
        .slice(0, 8).map((h) => (h as HTMLElement).innerText?.trim() || "").filter((s) => s.length > 0);

      return {
        url: loc.href,
        title: document.title || "",
        forms, buttons, links, headings,
      };
    });
  } catch {
    return { url, title: "", forms: [], buttons: [], links: [], headings: [] };
  }
}

// ─── AI Synthesis ─────────────────────────────────────────────────────────────

const GENERATOR_SYSTEM = `You are a QA engineer generating test scenarios for a web application.
Given a description of the app's UI surfaces (pages, forms, buttons, links), generate comprehensive test scenarios.

Respond with a JSON array ONLY — no markdown, no explanation outside the JSON.

Each scenario:
{
  "name": "concise test name",
  "description": "what to test and verify",
  "steps": ["step 1", "step 2", "step 3"],
  "tags": ["category-tag"],
  "priority": "low|medium|high|critical",
  "targetPath": "/path/to/test"
}

Guidelines:
- Cover happy paths, edge cases, and error states
- Steps should be clear browser actions a QA agent can execute
- Tags: use auth, forms, navigation, crud, error-handling, search, etc.
- Priority: critical=auth/payment/core-feature, high=important-feature, medium=normal, low=nice-to-have`;

async function synthesizeScenarios(
  surfaces: PageSurface[],
  options: GeneratorOptions,
  config: ReturnType<typeof loadConfig>,
): Promise<{ scenarios: GeneratedScenario[]; tokensUsed: number; provider: string; model: string }> {
  const model = options.model ?? config.judgeModel ?? config.defaultModel;
  const provider = detectProvider(model);

  // Build the discovery summary
  const summary = surfaces.map((s) => {
    const parts = [`Page: ${s.url} — "${s.title}"`];
    if (s.headings.length) parts.push(`  Headings: ${s.headings.join(", ")}`);
    if (s.forms.length) parts.push(`  Forms: ${s.forms.map((f) => `[${f.fields.join(", ")}]`).join("; ")}`);
    if (s.buttons.length) parts.push(`  Buttons: ${s.buttons.join(", ")}`);
    if (s.links.length) parts.push(`  Links: ${s.links.map((l) => l.text).join(", ")}`);
    return parts.join("\n");
  }).join("\n\n");

  const focusClause = options.focus ? `Focus specifically on: ${options.focus}.` : "";
  const personaClause = options.persona ? `Generate scenarios from the perspective of: ${options.persona}.` : "";
  const countClause = `Generate exactly ${options.maxScenarios ?? 10} test scenarios.`;

  const prompt = `${countClause} ${focusClause} ${personaClause}

APP STRUCTURE:
${summary}`;

  let rawText = "";
  let tokensUsed = 0;

  if (provider === "openai" || provider === "google") {
    const baseUrl = provider === "openai"
      ? "https://api.openai.com/v1"
      : "https://generativelanguage.googleapis.com/v1beta/openai";
    const apiKey = provider === "openai"
      ? (process.env["OPENAI_API_KEY"] ?? "")
      : (process.env["GOOGLE_API_KEY"] ?? "");

    const resp = await callOpenAICompatible({
      baseUrl, apiKey, model,
      system: GENERATOR_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      tools: [],
      maxTokens: 4096,
    });
    tokensUsed = resp.usage.input_tokens + resp.usage.output_tokens;
    const textBlock = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
    rawText = textBlock?.text ?? "[]";
  } else {
    // Anthropic
    const apiKey = process.env["ANTHROPIC_API_KEY"] ?? config.anthropicApiKey ?? "";
    if (!apiKey) throw new AIClientError("No Anthropic API key. Set ANTHROPIC_API_KEY or configure judgeModel for a different provider.");
    const anthropic = new Anthropic({ apiKey });
    const resp = await anthropic.messages.create({
      model, max_tokens: 4096,
      system: GENERATOR_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    tokensUsed = resp.usage.input_tokens + resp.usage.output_tokens;
    const textBlock = resp.content.find((b) => b.type === "text") as { type: "text"; text: string } | undefined;
    rawText = textBlock?.text ?? "[]";
  }

  // Extract JSON array from response
  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return { scenarios: [], tokensUsed, provider, model };

  let parsed: unknown[];
  try {
    parsed = JSON.parse(jsonMatch[0]) as unknown[];
  } catch {
    return { scenarios: [], tokensUsed, provider, model };
  }

  const scenarios: GeneratedScenario[] = parsed
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null && typeof (s as Record<string, unknown>).name === "string")
    .map((s): GeneratedScenario => ({
      name: String(s.name ?? ""),
      description: String(s.description ?? ""),
      steps: Array.isArray(s.steps) ? s.steps.map(String) : [],
      tags: Array.isArray(s.tags) ? s.tags.map(String) : ["generated"],
      priority: (["low", "medium", "high", "critical"].includes(String(s.priority)) ? s.priority : "medium") as ScenarioPriority,
      targetPath: s.targetPath ? String(s.targetPath) : undefined,
      projectId: options.projectId,
      generatedFrom: surfaces[0]?.url ?? options.url,
    }));

  return { scenarios: scenarios.slice(0, options.maxScenarios ?? 10), tokensUsed, provider, model };
}

// ─── Main Generator ───────────────────────────────────────────────────────────

export async function generateScenarios(options: GeneratorOptions): Promise<GeneratorResult> {
  const config = loadConfig();
  const browser = await launchBrowser({ headless: !options.headed });

  try {
    const page = await getPage(browser, {});
    const visited = new Set<string>();
    const queue: string[] = [options.url];
    const surfaces: PageSurface[] = [];
    const maxPages = options.maxPages ?? 10;

    // BFS crawl up to maxPages
    while (queue.length > 0 && surfaces.length < maxPages) {
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);

      const surface = await discoverPage(page, url);
      surfaces.push(surface);

      // Enqueue same-origin links
      const baseHost = new URL(options.url).host;
      for (const link of surface.links) {
        try {
          const linkHost = new URL(link.href).host;
          if (linkHost === baseHost && !visited.has(link.href) && surfaces.length + queue.length < maxPages * 2) {
            queue.push(link.href);
          }
        } catch { /* invalid URL */ }
      }
    }

    const { scenarios, tokensUsed, provider, model } = await synthesizeScenarios(surfaces, options, config);

    // Optionally persist to DB
    if (options.save && scenarios.length > 0) {
      const { createScenario } = await import("../db/scenarios.js");
      for (const scenario of scenarios) {
        try { createScenario(scenario); } catch { /* skip duplicates */ }
      }
    }

    return {
      scenarios,
      pagesDiscovered: surfaces.length,
      tokensUsed,
      provider,
      model,
    };
  } finally {
    await closeBrowser(browser);
  }
}
