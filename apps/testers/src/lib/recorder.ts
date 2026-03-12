import { chromium } from "playwright";
import type { CreateScenarioInput } from "../types/index.js";
import { createScenario } from "../db/scenarios.js";

export interface RecordedAction {
  type: "navigate" | "click" | "fill" | "select" | "press" | "scroll";
  selector?: string;
  value?: string;
  url?: string;
  key?: string;
  timestamp: number;
}

export interface RecordingResult {
  actions: RecordedAction[];
  url: string;
  duration: number;
}

export async function recordSession(
  url: string,
  options?: { timeout?: number },
): Promise<RecordingResult> {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const actions: RecordedAction[] = [];
  const startTime = Date.now();
  const timeout = options?.timeout ?? 300_000; // 5 minutes default

  // Record navigation
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      actions.push({ type: "navigate", url: frame.url(), timestamp: Date.now() - startTime });
    }
  });

  // Inject recording script into page
  await page.addInitScript(() => {
    document.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const selector = buildSelector(target);
      window.postMessage({ __testers_action: "click", selector }, "*");
    }, true);

    document.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      const selector = buildSelector(target);
      window.postMessage({ __testers_action: "fill", selector, value: target.value }, "*");
    }, true);

    document.addEventListener("change", (e) => {
      const target = e.target as HTMLSelectElement;
      if (target.tagName === "SELECT") {
        const selector = buildSelector(target);
        window.postMessage({ __testers_action: "select", selector, value: target.value }, "*");
      }
    }, true);

    document.addEventListener("keydown", (e) => {
      if (["Enter", "Tab", "Escape"].includes(e.key)) {
        window.postMessage({ __testers_action: "press", key: e.key }, "*");
      }
    }, true);

    function buildSelector(el: HTMLElement): string {
      if (el.id) return `#${el.id}`;
      if (el.getAttribute("data-testid")) return `[data-testid="${el.getAttribute("data-testid")}"]`;
      if (el.getAttribute("name")) return `${el.tagName.toLowerCase()}[name="${el.getAttribute("name")}"]`;
      if (el.getAttribute("aria-label")) return `[aria-label="${el.getAttribute("aria-label")}"]`;
      if (el.className && typeof el.className === "string") {
        const classes = el.className.trim().split(/\s+/).slice(0, 2).join(".");
        if (classes) return `${el.tagName.toLowerCase()}.${classes}`;
      }
      // Fallback: text content
      const text = el.textContent?.trim().slice(0, 30);
      if (text) return `text="${text}"`;
      return el.tagName.toLowerCase();
    }
  });


  // Capture actions via page.evaluate polling
  const pollInterval = setInterval(async () => {
    try {
      const newActions = await page.evaluate(() => {
        const collected = (window as unknown as { __testers_collected?: Array<Record<string, string>> }).__testers_collected ?? [];
        (window as unknown as { __testers_collected: never[] }).__testers_collected = [];
        return collected;
      });
      for (const a of newActions) {
        actions.push({
          type: a["type"] as RecordedAction["type"],
          selector: a["selector"],
          value: a["value"],
          key: a["key"],
          timestamp: Date.now() - startTime,
        });
      }
    } catch {
      // Page might be navigating
    }
  }, 500);

  // Also use page.on to capture actions via exposed function
  await page.exposeFunction("__testersRecord", (action: RecordedAction) => {
    actions.push({ ...action, timestamp: Date.now() - startTime });
  });

  await page.addInitScript(() => {
    window.addEventListener("message", (e) => {
      if (e.data?.__testers_action) {
        const { __testers_action, ...rest } = e.data;
        (window as unknown as { __testersRecord: (a: Record<string, string>) => void }).__testersRecord({ type: __testers_action, ...rest });
      }
    });
  });

  // Navigate to the URL
  await page.goto(url);
  actions.push({ type: "navigate", url, timestamp: 0 });

  console.log(`\n  Recording started. Interact with the browser.`);
  console.log(`  Close the browser window or wait ${timeout / 1000}s to stop.\n`);

  // Wait for browser to close or timeout
  await Promise.race([
    page.waitForEvent("close").catch(() => {}),
    context.waitForEvent("close").catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, timeout)),
  ]);

  clearInterval(pollInterval);

  try { await browser.close(); } catch { /* already closed */ }

  return {
    actions,
    url,
    duration: Date.now() - startTime,
  };
}

export function actionsToScenarioInput(
  recording: RecordingResult,
  name: string,
  projectId?: string,
): CreateScenarioInput {
  const steps: string[] = [];
  const seenFills = new Map<string, string>(); // Deduplicate rapid input events

  for (const action of recording.actions) {
    switch (action.type) {
      case "navigate":
        if (action.url) steps.push(`Navigate to ${action.url}`);
        break;
      case "click":
        if (action.selector) steps.push(`Click ${action.selector}`);
        break;
      case "fill":
        if (action.selector && action.value) {
          seenFills.set(action.selector, action.value);
        }
        break;
      case "select":
        if (action.selector && action.value) steps.push(`Select "${action.value}" in ${action.selector}`);
        break;
      case "press":
        if (action.key) steps.push(`Press ${action.key}`);
        break;
    }
  }

  // Add fill actions (deduplicated — only final value per field)
  for (const [selector, value] of seenFills) {
    steps.push(`Fill ${selector} with "${value}"`);
  }

  return {
    name,
    description: `Recorded session on ${recording.url} (${(recording.duration / 1000).toFixed(0)}s, ${recording.actions.length} actions)`,
    steps,
    tags: ["recorded"],
    projectId,
  };
}

export async function recordAndSave(
  url: string,
  name: string,
  projectId?: string,
): Promise<{ recording: RecordingResult; scenario: ReturnType<typeof createScenario> }> {
  const recording = await recordSession(url);
  const input = actionsToScenarioInput(recording, name, projectId);
  const scenario = createScenario(input);
  return { recording, scenario };
}
