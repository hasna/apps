import { chromium, type BrowserContext } from "playwright";
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

// ─── Auth Flow Recording & Replay ─────────────────────────────────────────────

export interface AuthRecordingOptions {
  email: string;
  password: string;
  loginUrl: string;
  emailSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  waitForUrl?: string | RegExp;
  timeoutMs?: number;
}

export interface SavedAuthState {
  cookies: { name: string; value: string; domain: string; path: string }[];
  localStorage: { origin: string; entries: { name: string; value: string }[] }[];
  loginUrl: string;
  recordedAt: string;
}

/**
 * Navigate to login, fill credentials, and capture auth state (cookies + localStorage).
 * Returns the saved auth state for replay in future test runs.
 */
export async function recordAuthFlow(
  loginUrl: string,
  options: AuthRecordingOptions,
): Promise<SavedAuthState> {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const emailSelector = options.emailSelector ?? 'input[name="email"], input[type="email"], #email';
  const passwordSelector = options.passwordSelector ?? 'input[name="password"], input[type="password"], #password';
  const submitSelector = options.submitSelector ?? 'button[type="submit"], input[type="submit"]';

  try {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs ?? 30000 });

    // Fill credentials
    await page.fill(emailSelector, options.email);
    await page.fill(passwordSelector, options.password);
    await page.click(submitSelector);

    // Wait for navigation or timeout
    if (options.waitForUrl) {
      await page.waitForURL(options.waitForUrl, { timeout: options.timeoutMs ?? 30000 });
    } else {
      await page.waitForLoadState("networkidle", { timeout: options.timeoutMs ?? 30000 });
    }

    // Capture cookies
    const cookies = await context.cookies();
    const formattedCookies = cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain || "",
      path: c.path || "/",
    }));

    // Capture localStorage from all frames
    const frames = page.frames();
    const localStorageEntries: SavedAuthState["localStorage"] = [];
    for (const frame of frames) {
      try {
        const origin = frame.url();
        if (origin && origin !== "about:blank") {
          const entries = await frame.evaluate(() => {
            const items: { name: string; value: string }[] = [];
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key) items.push({ name: key, value: localStorage.getItem(key) || "" });
            }
            return items;
          });
          if (entries.length > 0) {
            localStorageEntries.push({ origin, entries });
          }
        }
      } catch {
        // Frame might be cross-origin or not ready
      }
    }

    return {
      cookies: formattedCookies,
      localStorage: localStorageEntries,
      loginUrl,
      recordedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close();
  }
}

/**
 * Restore a previously saved auth state into a browser context.
 * Injects cookies and localStorage so the page is already authenticated.
 */
export async function replayAuthState(
  context: BrowserContext,
  authState: SavedAuthState,
): Promise<void> {
  // Restore cookies
  for (const cookie of authState.cookies) {
    try {
      await context.addCookies([{
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: -1,
      }]);
    } catch {
      // Cookie set failed — skip
    }
  }

  // Restore localStorage on first page load
  const page = await context.newPage();
  // Navigate to the login URL origin first to set same-origin localStorage
  const origin = new URL(authState.loginUrl).origin;
  await page.goto(`${origin}/about:blank`, { waitUntil: "domcontentloaded" }).catch(() => {});

  for (const entry of authState.localStorage) {
    try {
      await page.evaluate((items) => {
        for (const item of items) {
          localStorage.setItem(item.name, item.value);
        }
      }, entry.entries);
    } catch {
      // localStorage access failed — skip
    }
  }

  await page.close();
}

/**
 * Convert saved auth state into a scenario with auth metadata.
 */
export function authStateToScenarioMetadata(
  authState: SavedAuthState,
  name: string,
  projectId?: string,
): ReturnType<typeof createScenario> {
  return createScenario({
    name,
    description: `Authenticated test scenario from recorded auth state at ${authState.loginUrl}`,
    steps: [`Navigate to authenticated session`],
    tags: ["auth", "recorded"],
    requiresAuth: true,
    authConfig: { loginPath: new URL(authState.loginUrl).pathname },
    metadata: { authState: JSON.parse(JSON.stringify(authState)) },
    projectId,
  });
}
