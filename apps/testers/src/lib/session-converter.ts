import { readFileSync } from "node:fs";
import { extname } from "node:path";

export type SessionFormat = "rrweb" | "har" | "testers";

export interface SessionEvent {
  type: "navigate" | "click" | "input" | "scroll" | "network";
  timestamp: number;
  url?: string;
  selector?: string;
  value?: string;
  networkUrl?: string;
  networkMethod?: string;
}

export interface ConvertedScenario {
  name: string;
  description: string;
  steps: string[];
  tags: string[];
  targetPath?: string;
}

// ─── rrweb parsing ────────────────────────────────────────────────────────────
// rrweb event types: 4 = meta (navigate), 3 = incremental snapshot
// IncrementalSource: 2 = mousemove (skip), 1 = mutation (skip), 5 = mouseInteraction (click), 9 = input

interface RrwebEvent {
  type: number;
  timestamp: number;
  data?: {
    source?: number;
    type?: number;      // mouseInteraction type: 2 = click
    id?: number;
    x?: number;
    y?: number;
    text?: string;
    isChecked?: boolean;
    href?: string;
    url?: string;
  };
}

export function parseRrwebSession(events: unknown[]): SessionEvent[] {
  const result: SessionEvent[] = [];
  let lastUrl: string | undefined;

  for (const raw of events) {
    const event = raw as RrwebEvent;
    if (!event || typeof event.type !== "number") continue;

    // Type 4 = meta (navigate / URL change)
    if (event.type === 4) {
      const url = event.data?.href ?? event.data?.url;
      if (url && url !== lastUrl) {
        lastUrl = url;
        result.push({
          type: "navigate",
          timestamp: event.timestamp,
          url,
        });
      }
      continue;
    }

    // Type 3 = incremental snapshot
    if (event.type === 3 && event.data) {
      const source = event.data.source;

      // Source 5 = mouseInteraction (click when type === 2)
      if (source === 5 && event.data.type === 2) {
        result.push({
          type: "click",
          timestamp: event.timestamp,
          selector: event.data.id ? `[data-rrweb-id="${event.data.id}"]` : undefined,
        });
        continue;
      }

      // Source 9 = input
      if (source === 9) {
        result.push({
          type: "input",
          timestamp: event.timestamp,
          selector: event.data.id ? `[data-rrweb-id="${event.data.id}"]` : undefined,
          value: event.data.text,
        });
        continue;
      }

      // Source 2 = mousemove — skip
      // Source 1 = mutation — skip
    }
  }

  return result;
}

// ─── HAR parsing ──────────────────────────────────────────────────────────────

interface HarEntry {
  request: {
    method: string;
    url: string;
  };
  startedDateTime: string;
}

interface HarFile {
  log?: {
    entries?: HarEntry[];
  };
}

export function parseHarSession(har: unknown): SessionEvent[] {
  const result: SessionEvent[] = [];
  const harFile = har as HarFile;
  const entries = harFile?.log?.entries ?? [];

  let lastOrigin: string | undefined;
  let lastNavUrl: string | undefined;

  for (const entry of entries) {
    if (!entry?.request?.url) continue;

    const method = entry.request.method?.toUpperCase() ?? "GET";
    const url = entry.request.url;
    const timestamp = entry.startedDateTime ? new Date(entry.startedDateTime).getTime() : Date.now();

    try {
      const parsed = new URL(url);
      const origin = parsed.origin;

      // Detect same-origin navigation requests (GET to HTML pages)
      if (method === "GET") {
        if (!lastOrigin) lastOrigin = origin;

        if (origin === lastOrigin) {
          // Filter out API calls and static assets
          const isAsset = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map|json)(\?|$)/i.test(parsed.pathname);
          if (!isAsset) {
            const navUrl = parsed.pathname + parsed.search;
            if (navUrl !== lastNavUrl) {
              lastNavUrl = navUrl;
              result.push({
                type: "navigate",
                timestamp,
                url,
              });
            }
          }
        }
      }

      // Track all network requests
      result.push({
        type: "network",
        timestamp,
        networkUrl: url,
        networkMethod: method,
      });
    } catch {
      // Invalid URL — skip
    }
  }

  return result;
}

// ─── Session → Scenario conversion ───────────────────────────────────────────

function eventsToSteps(events: SessionEvent[]): string[] {
  const steps: string[] = [];

  for (const event of events) {
    switch (event.type) {
      case "navigate":
        if (event.url) {
          steps.push(`Navigate to ${event.url}`);
        }
        break;
      case "click":
        if (event.selector) {
          steps.push(`Click element ${event.selector}`);
        } else {
          steps.push("Click on element");
        }
        break;
      case "input":
        if (event.selector && event.value !== undefined) {
          steps.push(`Fill ${event.selector} with "${event.value}"`);
        } else if (event.selector) {
          steps.push(`Type into ${event.selector}`);
        } else {
          steps.push("Type into input field");
        }
        break;
      case "scroll":
        steps.push("Scroll page");
        break;
      case "network":
        // Skip network events from step generation
        break;
    }
  }

  // Deduplicate consecutive identical steps
  return steps.filter((step, i) => step !== steps[i - 1]);
}

function extractTargetPath(events: SessionEvent[]): string | undefined {
  const navEvent = events.find((e) => e.type === "navigate" && e.url);
  if (!navEvent?.url) return undefined;
  try {
    const parsed = new URL(navEvent.url);
    return parsed.pathname;
  } catch {
    return undefined;
  }
}

export async function convertSessionToScenario(
  events: SessionEvent[],
  options?: {
    name?: string;
    model?: string;
  }
): Promise<ConvertedScenario> {
  const name = options?.name ?? `Recorded session ${new Date().toISOString().slice(0, 10)}`;
  const targetPath = extractTargetPath(events);

  let steps: string[];

  // Try AI synthesis if model provided and API key available
  if (options?.model && (process.env["ANTHROPIC_API_KEY"] || process.env["OPENAI_API_KEY"] || process.env["GOOGLE_API_KEY"])) {
    try {
      const { callOpenAICompatible, detectProvider } = await import("./ai-client.js");
      const model = options.model;
      const provider = detectProvider(model);
      const condensed = events
        .filter((e) => e.type !== "network")
        .map((e) => `[${e.type}] ${e.url ?? e.selector ?? e.value ?? ""}`)
        .slice(0, 100)
        .join("\n");

      const prompt = `Convert these recorded browser session events into clear, human-readable test scenario steps. Each step should be a single action. Output ONLY the steps, one per line, no numbering, no extra text.\n\nEvents:\n${condensed}`;

      let rawText = "";
      if (provider === "openai" || provider === "google") {
        const baseUrl = provider === "openai" ? "https://api.openai.com/v1" : "https://generativelanguage.googleapis.com/v1beta/openai";
        const apiKey = provider === "openai" ? (process.env["OPENAI_API_KEY"] ?? "") : (process.env["GOOGLE_API_KEY"] ?? "");
        const resp = await callOpenAICompatible({ baseUrl, apiKey, model, system: "You are a QA engineer.", messages: [{ role: "user", content: prompt }], tools: [], maxTokens: 1024 });
        const block = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
        rawText = block?.text ?? "";
      } else {
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        const anthropic = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] ?? "" });
        const resp = await anthropic.messages.create({ model, max_tokens: 1024, messages: [{ role: "user", content: prompt }] });
        const block = resp.content.find((b) => b.type === "text") as { type: "text"; text: string } | undefined;
        rawText = block?.text ?? "";
      }

      const aiSteps = rawText.split("\n").map((s) => s.trim()).filter(Boolean);
      if (aiSteps.length > 0) {
        steps = aiSteps;
      } else {
        steps = eventsToSteps(events);
      }
    } catch {
      steps = eventsToSteps(events);
    }
  } else {
    steps = eventsToSteps(events);
  }

  const tags = ["recorded", "session"];
  if (targetPath) tags.push("navigation");

  return {
    name,
    description: `Recorded session with ${events.filter((e) => e.type !== "network").length} interactions`,
    steps,
    tags,
    targetPath,
  };
}

export async function convertSessionFile(
  filePath: string,
  format: SessionFormat,
  options?: {
    name?: string;
    model?: string;
  }
): Promise<ConvertedScenario> {
  const raw = readFileSync(filePath, "utf-8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse session file as JSON: ${filePath}`);
  }

  let events: SessionEvent[];

  if (format === "rrweb") {
    if (!Array.isArray(parsed)) {
      throw new Error("rrweb session file must be a JSON array of events");
    }
    events = parseRrwebSession(parsed as unknown[]);
  } else if (format === "har") {
    events = parseHarSession(parsed);
  } else if (format === "testers") {
    // Native testers format: array of SessionEvent objects
    if (!Array.isArray(parsed)) {
      throw new Error("testers session file must be a JSON array of events");
    }
    events = parsed as SessionEvent[];
  } else {
    throw new Error(`Unknown format: ${format}`);
  }

  if (events.length === 0) {
    throw new Error(`No events found in session file (format: ${format})`);
  }

  const name = options?.name ?? filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "Recorded session";

  return convertSessionToScenario(events, { ...options, name });
}

export function detectSessionFormat(filePath: string): SessionFormat {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".har") return "har";
  // Try to read the first bytes to detect rrweb
  try {
    const content = readFileSync(filePath, "utf-8").trim();
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed[0]?.type !== undefined && typeof parsed[0]?.timestamp === "number") {
      return "rrweb";
    }
    if ((parsed as Record<string, unknown>)?.log !== undefined) {
      return "har";
    }
  } catch {
    // ignore
  }
  return "testers";
}
