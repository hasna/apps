/**
 * crawl_and_generate — zero-config test generation for any web app.
 *
 * Given any URL:
 * 1. Crawls the app with a headless browser to discover pages
 * 2. Visits each page, captures a screenshot + simplified HTML
 * 3. Sends both to Claude with a prompt to write test scenarios
 * 4. Creates the scenarios in the DB under the given project
 *
 * Works for any web app — no manual setup required.
 */

import { launchBrowser, getPage, closeBrowser } from "./browser.js";
import { createScenario } from "../db/scenarios.js";
import { createClient } from "./ai-client.js";
import { loadConfig } from "./config.js";
import { resolveModel } from "./ai-client.js";
import type { Browser } from "playwright";
import type Anthropic from "@anthropic-ai/sdk";

export interface CrawlAndGenerateOptions {
  url: string;
  projectId?: string;
  maxPages?: number;
  scenariosPerPage?: number;
  model?: string;
  apiKey?: string;
  headed?: boolean;
  skipPaths?: string[];   // paths to skip (e.g. ["/logout", "/admin"])
  tags?: string[];        // extra tags to add to generated scenarios
}

export interface GeneratedPage {
  path: string;
  title: string;
  scenariosCreated: number;
  scenarios: Array<{ id: string; shortId: string; name: string }>;
}

export interface CrawlAndGenerateResult {
  projectId: string | null;
  url: string;
  pagesDiscovered: number;
  pagesGenerated: number;
  totalScenariosCreated: number;
  pages: GeneratedPage[];
  skipped: string[];
}

// Paths that are never useful to generate scenarios for
const DEFAULT_SKIP_PATTERNS = [
  "/logout", "/sign-out", "/signout",
  "/static/", "/assets/", "/_next/", "/__/",
  "/favicon", "/robots.txt", "/sitemap",
  "#",
];

function shouldSkip(href: string, rootOrigin: string, skipPaths: string[]): boolean {
  try {
    const u = new URL(href);
    if (u.origin !== rootOrigin) return true; // external
    const path = u.pathname;
    const allSkip = [...DEFAULT_SKIP_PATTERNS, ...skipPaths];
    return allSkip.some((p) => path.startsWith(p) || path.includes(p));
  } catch {
    return true;
  }
}

function normaliseUrl(href: string): string {
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return href;
  }
}

async function getPageContext(
  browser: Browser,
  pageUrl: string,
  timeoutMs: number,
): Promise<{ title: string; path: string; html: string; screenshot: Buffer | null; links: string[] }> {
  const page = await getPage(browser, {});
  try {
    await page.goto(pageUrl, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
    // Small wait for JS-rendered content
    await page.waitForTimeout(800).catch(() => {});

    const [title, html, links, screenshot] = await Promise.all([
      page.title().catch(() => ""),
      page.evaluate(() => {
        // Get simplified HTML: body text + key landmarks
        const body = document.body;
        if (!body) return "";
        // Remove scripts, styles, svgs
        const clone = body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("script,style,svg,noscript,iframe").forEach((el) => el.remove());
        return clone.innerText?.slice(0, 3000) ?? clone.textContent?.slice(0, 3000) ?? "";
      }).catch(() => ""),
      page.evaluate((origin) =>
        Array.from(document.querySelectorAll("a[href]"))
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((h) => { try { return new URL(h).origin === origin; } catch { return false; } })
      , new URL(pageUrl).origin).catch(() => [] as string[]),
      page.screenshot({ fullPage: false }).catch(() => null),
    ]);

    return { title, path: new URL(pageUrl).pathname, html, screenshot, links };
  } finally {
    await page.close().catch(() => {});
  }
}

async function generateScenariosForPage(
  client: ReturnType<typeof createClient>,
  model: string,
  pageContext: { title: string; path: string; html: string; screenshot: Buffer | null },
  baseUrl: string,
  count: number,
): Promise<Array<{ name: string; description: string; steps: string[]; tags: string[]; priority: string }>> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const anthropicClient = client as InstanceType<typeof Anthropic>;

  const pageDesc = [
    `URL: ${baseUrl.replace(/\/$/, "")}${pageContext.path}`,
    `Title: ${pageContext.title || pageContext.path}`,
    pageContext.html ? `\nPage content (text):\n${pageContext.html.slice(0, 2000)}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `You are a QA engineer. Analyze this web page and write ${count} practical test scenarios.

${pageDesc}

Return ONLY a JSON array (no markdown, no explanation). Each scenario:
{
  "name": "short action-oriented name (e.g. 'User can log in with valid credentials')",
  "description": "what this test verifies",
  "steps": ["step 1", "step 2", "step 3"],
  "tags": ["tag1"],
  "priority": "low|medium|high|critical"
}

Rules:
- Focus on user flows, not implementation details
- Steps should be plain English instructions the browser agent can follow
- Vary priorities: 1 critical/high per page for the main flow, rest medium/low
- Keep steps concise (max 8 per scenario)
- Tags should reflect the page area (e.g. "auth", "dashboard", "settings", "checkout")`;

  const contentParts: Anthropic.ContentBlockParam[] = [
    ...(pageContext.screenshot ? [{
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: "image/png" as const,
        data: pageContext.screenshot.toString("base64"),
      },
    } satisfies Anthropic.ImageBlockParam] : []),
    { type: "text" as const, text: prompt } satisfies Anthropic.TextBlockParam,
  ];

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: contentParts }];

  try {
    const response = await anthropicClient.messages.create({
      model,
      max_tokens: 2048,
      messages,
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    // Extract JSON array from response
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]) as Array<{
      name: string;
      description?: string;
      steps?: string[];
      tags?: string[];
      priority?: string;
    }>;
    return parsed.map((s) => ({
      name: s.name ?? "Untitled scenario",
      description: s.description ?? "",
      steps: s.steps ?? [],
      tags: s.tags ?? [],
      priority: s.priority ?? "medium",
    }));
  } catch {
    return [];
  }
}

export async function crawlAndGenerate(options: CrawlAndGenerateOptions): Promise<CrawlAndGenerateResult> {
  const {
    url,
    projectId,
    maxPages = 20,
    scenariosPerPage = 3,
    headed = false,
    skipPaths = [],
    tags: extraTags = [],
  } = options;

  const config = loadConfig();
  const model = resolveModel(options.model ?? config.defaultModel ?? "thorough");
  const client = createClient(options.apiKey ?? config.anthropicApiKey);

  const rootOrigin = new URL(url).origin;
  const visited = new Set<string>();
  const queue: string[] = [url];
  const pageContexts: Array<{ title: string; path: string; html: string; screenshot: Buffer | null }> = [];
  const skipped: string[] = [];

  const browser = await launchBrowser({ headless: !headed });

  try {
    // Phase 1: Crawl to discover pages
    while (queue.length > 0 && visited.size < maxPages) {
      const pageUrl = queue.shift()!;
      const norm = normaliseUrl(pageUrl);
      if (visited.has(norm)) continue;
      if (shouldSkip(pageUrl, rootOrigin, skipPaths)) {
        skipped.push(pageUrl);
        continue;
      }
      visited.add(norm);

      try {
        const ctx = await getPageContext(browser, pageUrl, 15000);
        pageContexts.push(ctx);

        // Enqueue new internal links
        for (const link of ctx.links) {
          const normLink = normaliseUrl(link);
          if (!visited.has(normLink) && !shouldSkip(link, rootOrigin, skipPaths)) {
            queue.push(link);
          }
        }
      } catch {
        skipped.push(pageUrl);
      }
    }
  } finally {
    await closeBrowser(browser).catch(() => {});
  }

  // Phase 2: Generate scenarios for each discovered page
  const pages: GeneratedPage[] = [];
  let totalCreated = 0;

  for (const ctx of pageContexts) {
    const generated = await generateScenariosForPage(client, model, ctx, url, scenariosPerPage);

    const createdScenarios: Array<{ id: string; shortId: string; name: string }> = [];
    for (const s of generated) {
      try {
        const priority = (["low", "medium", "high", "critical"].includes(s.priority)
          ? s.priority
          : "medium") as "low" | "medium" | "high" | "critical";

        const scenario = createScenario({
          name: s.name,
          description: s.description,
          steps: s.steps,
          tags: [...(s.tags ?? []), ...extraTags, "generated"],
          priority,
          targetPath: ctx.path,
          projectId,
        });
        createdScenarios.push({ id: scenario.id, shortId: scenario.shortId, name: scenario.name });
        totalCreated++;
      } catch {
        // Skip duplicates or DB errors
      }
    }

    if (createdScenarios.length > 0) {
      pages.push({
        path: ctx.path,
        title: ctx.title,
        scenariosCreated: createdScenarios.length,
        scenarios: createdScenarios,
      });
    }
  }

  return {
    projectId: projectId ?? null,
    url,
    pagesDiscovered: pageContexts.length,
    pagesGenerated: pages.length,
    totalScenariosCreated: totalCreated,
    pages,
    skipped,
  };
}
