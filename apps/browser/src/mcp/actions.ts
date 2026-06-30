// ─── Navigation + interaction tools ──────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerTool,
  z,
  json,
  err,
  errWithScreenshot,
  resolveSessionId,
  getSessionPage,
  getSession,
  renameSession,
  isBunSession,
  getSessionBunView,
  isAutoGallery,
  navigate,
  click,
  typeText,
  hover,
  scroll,
  selectOption,
  checkBox,
  uploadFile,
  goBack,
  goForward,
  reload,
  waitForSelector,
  pressKey,
  clickText,
  fillForm,
  waitForText,
  clickRef,
  typeRef,
  hoverRef,
  selectRef,
  checkRef,
  getTitle,
  getUrl,
  getConsoleLog,
  takeScreenshot,
  takeSnapshotFn,
  setLastSnapshot,
  logEvent,
} from "./helpers.js";
import { assertBrowserCapability } from "../lib/policy.js";
import {
  clearCachedSemanticActions,
  coerceModelAction,
  getCachedSemanticAction,
  getSemanticActionCacheScope,
  getSemanticPageMap,
  observeSemanticActions,
  runSemanticAction,
  validateSemanticPage,
  type SemanticAction,
  type SemanticActionCacheScope,
  type SemanticPageMap,
} from "../lib/semantic-actions.js";

export function register(server: McpServer) {

// ── Navigation Tools ──────────────────────────────────────────────────────────

registerTool(server,
  "browser_navigate",
  "Navigate to a URL. Auto-detects redirects, auto-names session, returns compact refs + thumbnail.",
  {
    session_id: z.string().optional(),
    url: z.string(),
    timeout: z.number().optional().default(30000),
    auto_snapshot: z.boolean().optional().default(true),
    auto_thumbnail: z.boolean().optional().default(true),
  },
  async ({ session_id, url, timeout, auto_snapshot, auto_thumbnail }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      // Bun.WebView fast path — sequential to avoid concurrent evaluate() errors
      if (isBunSession(sid)) {
        const bunView = getSessionBunView(sid)!;
        await bunView.goto(url, { timeout });
        // Extra settle time for page JS to finish (Bun.WebView evaluate is not re-entrant)
        await new Promise(r => setTimeout(r, 500));
      } else {
        await navigate(page, url, timeout);
      }
      clearCachedSemanticActions(sid);
      // Use property access for Bun (no evaluate call), page.title()/url() for Playwright
      const title = await getTitle(page);
      const current_url = await getUrl(page);

      // Redirect detection
      const redirected = current_url !== url && current_url !== url + "/" && url !== current_url.replace(/\/$/, "");
      let redirect_type: string | undefined;
      if (redirected) {
        try {
          const reqHost = new URL(url).hostname;
          const resHost = new URL(current_url).hostname;
          const reqPath = new URL(url).pathname;
          const resPath = new URL(current_url).pathname;
          if (reqHost !== resHost) redirect_type = "canonical";
          else if (resPath.match(/\/[a-z]{2}-[a-z]{2}\//)) redirect_type = "geo";
          else if (current_url.includes("login") || current_url.includes("signin")) redirect_type = "auth";
          else redirect_type = "unknown";
        } catch {}
      }

      // Auto-name session if it has no name
      try {
        const session = getSession(sid);
        if (!session.name) {
          const hostname = new URL(current_url).hostname;
          renameSession(sid, hostname);
        }
      } catch {}

      const result: Record<string, unknown> = {
        url,
        title,
        current_url,
        redirected,
        ...(redirect_type ? { redirect_type } : {}),
      };

      // For Bun.WebView: thumbnail and snapshot must be sequential (no concurrent evaluate())
      // For Playwright: they can run in parallel (but we keep sequential for simplicity)

      // Auto-thumbnail (small, token-efficient)
      if (auto_thumbnail) {
        try {
          const ss = await takeScreenshot(page, { maxWidth: 400, quality: 60, track: false, thumbnail: false });
          result.thumbnail_base64 = ss.base64.length > 50000 ? "" : ss.base64;
        } catch {}
      }

      // Auto-gallery: save screenshot to gallery on every navigation
      if (isAutoGallery(sid)) {
        try {
          const ss = await takeScreenshot(page, { maxWidth: 1280, quality: 70, thumbnail: true });
          const { createEntry } = await import("../db/gallery.js");
          createEntry({ session_id: sid, url: current_url, title, path: ss.path, thumbnail_path: ss.thumbnail_path, format: "webp", width: ss.width, height: ss.height, original_size_bytes: ss.original_size_bytes, compressed_size_bytes: ss.compressed_size_bytes, compression_ratio: ss.compression_ratio, tags: [], is_favorite: false });
        } catch {}
      }

      // Short settle for Bun before snapshot evaluate calls
      if (isBunSession(sid) && auto_snapshot) {
        await new Promise(r => setTimeout(r, 200));
      }

      // Auto-snapshot with compact refs (≤30 elements)
      if (auto_snapshot) {
        try {
          const snap = await takeSnapshotFn(page, sid);
          setLastSnapshot(sid, snap);
          const refEntries = Object.entries(snap.refs).slice(0, 30);
          result.snapshot_refs = refEntries
            .map(([ref, info]) => `${info.role}:${info.name.slice(0, 50)} [${ref}]`)
            .join(", ");
          result.interactive_count = snap.interactive_count;
          result.has_errors = getConsoleLog(sid, "error").length > 0;
        } catch {}
      }

      logEvent(sid, "navigate", { url, title, current_url });
      return json(result);
    } catch (e) { return errWithScreenshot(e, session_id); }
  }
);

registerTool(server,
  "browser_back",
  "Navigate back in browser history",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      await goBack(page);
      clearCachedSemanticActions(sid);
      return json({ url: page.url() });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_forward",
  "Navigate forward in browser history",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      await goForward(page);
      clearCachedSemanticActions(sid);
      return json({ url: page.url() });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_reload",
  "Reload the current page",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      await reload(page);
      clearCachedSemanticActions(sid);
      return json({ url: page.url() });
    } catch (e) { return err(e); }
  }
);

// ── Semantic Agent Tools ─────────────────────────────────────────────────────

registerTool(server,
  "browser_page_map",
  "Return a sanitized semantic page map: title, URL, interactive refs, forms, and visible text for agent planning.",
  {
    session_id: z.string().optional(),
    max_elements: z.number().optional().default(80),
    max_text_chars: z.number().optional().default(4000),
  },
  async ({ session_id, max_elements, max_text_chars }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const pageMap = await getSemanticPageMap(page, sid, { maxElements: max_elements, maxTextChars: max_text_chars });
      logEvent(sid, "page_map", { elements: pageMap.elements.length, forms: pageMap.forms.length });
      return json(pageMap);
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_observe",
  "Find structured page actions for an instruction. This does not execute; use browser_act with action_id or action.",
  {
    session_id: z.string().optional(),
    instruction: z.string(),
    max_actions: z.number().optional().default(8),
    max_elements: z.number().optional().default(80),
    use_model: z.boolean().optional().default(true),
    model: z.string().optional().default("fast"),
  },
  async ({ session_id, instruction, max_actions, max_elements, use_model, model }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const result = await observeSemanticActions(page, sid, instruction, {
        maxActions: max_actions,
        maxElements: max_elements,
        useModel: use_model,
        infer: { model },
      });
      logEvent(sid, "observe", { instruction, actions: result.actions.length, modelUsed: result.modelUsed });
      return json(result);
    } catch (e) { return err(e); }
  }
);

const semanticActionSchema = z.object({
  id: z.string(),
  kind: z.enum(["click", "fill", "select", "check", "hover"]),
  ref: z.string(),
  selector: z.string().optional(),
  label: z.string(),
  confidence: z.number(),
  risk: z.enum(["none", "navigation", "external_mutation", "sensitive"]),
  requiresApproval: z.boolean(),
  policyTags: z.array(z.string()).optional(),
  policyReason: z.string().optional(),
  reason: z.string().optional(),
  value: z.union([z.string(), z.boolean()]).optional(),
  preconditions: z.array(z.string()).optional(),
  postconditions: z.array(z.string()).optional(),
});

registerTool(server,
  "browser_act",
  "Execute a structured semantic action by action_id/action, or observe an instruction and execute the best action when risk policy allows.",
  {
    session_id: z.string().optional(),
    action_id: z.string().optional(),
    action: semanticActionSchema.optional(),
    instruction: z.string().optional(),
    value: z.union([z.string(), z.boolean()]).optional(),
    allow_risk: z.boolean().optional().default(false),
    screenshot: z.boolean().optional().default(false),
  },
  async ({ session_id, action_id, action, instruction, value, allow_risk, screenshot }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      let resolved = action as SemanticAction | undefined;
      let pageMap: SemanticPageMap | undefined;
      let scope: Required<SemanticActionCacheScope> | undefined;
      if (action || action_id) {
        const current = await getSemanticActionCacheScope(page, sid);
        pageMap = current.pageMap;
        scope = current.scope;
      }
      if (resolved && pageMap) {
        resolved = coerceModelAction(resolved, pageMap, instruction ?? resolved.label) ?? undefined;
      }
      if (!resolved && action_id && scope) resolved = getCachedSemanticAction(sid, action_id, scope) ?? undefined;
      if (!resolved && instruction) {
        const observed = await observeSemanticActions(page, sid, instruction, { maxActions: 1 });
        resolved = observed.actions[0];
      }
      if (!resolved) return err(new Error("Provide action, action_id from browser_observe, or instruction."));
      const result = await runSemanticAction(page, sid, resolved, { value, allowRisk: allow_risk });
      const output: Record<string, unknown> = { ...result };
      if (screenshot) {
        output.screenshot = await takeScreenshot(page, { maxWidth: 1280, quality: 70, track: false });
      }
      logEvent(sid, "act", { action: resolved.id, kind: resolved.kind, risk: resolved.risk });
      return json(output);
    } catch (e) { return errWithScreenshot(e, session_id); }
  }
);

registerTool(server,
  "browser_validate",
  "Validate a page assertion from sanitized page content and optional fast structured model reasoning.",
  {
    session_id: z.string().optional(),
    assertion: z.string(),
    use_model: z.boolean().optional().default(true),
    model: z.string().optional().default("fast"),
  },
  async ({ session_id, assertion, use_model, model }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const result = await validateSemanticPage(page, assertion, { useModel: use_model, infer: { model } });
      logEvent(sid, "validate", { assertion, ok: result.ok, confidence: result.confidence });
      return json(result);
    } catch (e) { return err(e); }
  }
);

// ── Interaction Tools ─────────────────────────────────────────────────────────

registerTool(server,
  "browser_click",
  "Click an element by ref (from snapshot) or CSS selector. Prefer ref for reliability. Self-healing auto-tries fallback selectors if element not found.",
  { session_id: z.string().optional(), selector: z.string().optional(), ref: z.string().optional(), button: z.enum(["left", "right", "middle"]).optional(), timeout: z.number().optional(), self_heal: z.boolean().optional().default(true).describe("Auto-try fallback selectors if element not found") },
  async ({ session_id, selector, ref, button, timeout, self_heal }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      if (ref) {
        await clickRef(page, sid, ref, { timeout });
        logEvent(sid, "click", { selector: ref, method: "ref" });
        return json({ clicked: ref, method: "ref" });
      }
      if (!selector) return err(new Error("Either ref or selector is required"));
      const healInfo = await click(page, selector, { button, timeout, selfHeal: self_heal });
      logEvent(sid, "click", { selector, method: healInfo.healed ? "healed" : "selector" });
      if (healInfo.healed) {
        return json({ clicked: selector, method: "healed", heal_method: healInfo.method, attempts: healInfo.attempts });
      }
      return json({ clicked: selector, method: "selector" });
    } catch (e) { return errWithScreenshot(e, session_id); }
  }
);

registerTool(server,
  "browser_type",
  "Type text into an element by ref or selector. Prefer ref. Self-healing auto-tries fallback selectors if element not found.",
  { session_id: z.string().optional(), selector: z.string().optional(), ref: z.string().optional(), text: z.string(), clear: z.boolean().optional().default(false), delay: z.number().optional(), self_heal: z.boolean().optional().default(true).describe("Auto-try fallback selectors if element not found") },
  async ({ session_id, selector, ref, text, clear, delay, self_heal }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      if (ref) {
        await typeRef(page, sid, ref, text, { clear, delay });
        logEvent(sid, "type", { selector: ref, text: text.slice(0, 100) });
        return json({ typed: text, ref, method: "ref" });
      }
      if (!selector) return err(new Error("Either ref or selector is required"));
      const healInfo = await typeText(page, selector, text, { clear, delay, selfHeal: self_heal });
      logEvent(sid, "type", { selector, text: text.slice(0, 100), method: healInfo.healed ? "healed" : "selector" });
      if (healInfo.healed) {
        return json({ typed: text, selector, method: "healed", heal_method: healInfo.method, attempts: healInfo.attempts });
      }
      return json({ typed: text, selector, method: "selector" });
    } catch (e) { return errWithScreenshot(e, session_id); }
  }
);

registerTool(server,
  "browser_hover",
  "Hover over an element by ref or selector",
  { session_id: z.string().optional(), selector: z.string().optional(), ref: z.string().optional() },
  async ({ session_id, selector, ref }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      if (ref) { await hoverRef(page, sid, ref); return json({ hovered: ref, method: "ref" }); }
      if (!selector) return err(new Error("Either ref or selector is required"));
      await hover(page, selector);
      return json({ hovered: selector, method: "selector" });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_scroll",
  "Scroll the page",
  { session_id: z.string().optional(), direction: z.enum(["up", "down", "left", "right"]).optional().default("down"), amount: z.number().optional().default(300) },
  async ({ session_id, direction, amount }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      await scroll(page, direction, amount);
      return json({ scrolled: direction, amount });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_select",
  "Select a dropdown option by ref or selector",
  { session_id: z.string().optional(), selector: z.string().optional(), ref: z.string().optional(), value: z.string() },
  async ({ session_id, selector, ref, value }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      if (ref) { const selected = await selectRef(page, sid, ref, value); return json({ selected, method: "ref" }); }
      if (!selector) return err(new Error("Either ref or selector is required"));
      const selected = await selectOption(page, selector, value);
      return json({ selected, method: "selector" });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_toggle",
  "Check or uncheck a checkbox by ref or selector",
  { session_id: z.string().optional(), selector: z.string().optional(), ref: z.string().optional(), checked: z.boolean() },
  async ({ session_id, selector, ref, checked }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      if (ref) { await checkRef(page, sid, ref, checked); return json({ checked, ref, method: "ref" }); }
      if (!selector) return err(new Error("Either ref or selector is required"));
      await checkBox(page, selector, checked);
      return json({ checked, selector, method: "selector" });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_upload",
  "Upload a file to an input element",
  { session_id: z.string().optional(), selector: z.string(), file_path: z.string(), approval_token: z.string().optional() },
  async ({ session_id, selector, file_path, approval_token }) => {
    try {
      assertBrowserCapability("file_upload", { approvalToken: approval_token });
      // Reject paths containing '..' or pointing outside the data directory
      if (file_path.includes("..")) {
        return err(new Error("File path must not contain '..'"));
      }
      const { existsSync } = await import("node:fs");
      if (!existsSync(file_path)) {
        return err(new Error(`File not found: ${file_path}`));
      }
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      await uploadFile(page, selector, file_path);
      return json({ uploaded: file_path, selector });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_press_key",
  "Press a keyboard key",
  { session_id: z.string().optional(), key: z.string() },
  async ({ session_id, key }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      await pressKey(page, key);
      return json({ pressed: key });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_wait",
  "Wait for a selector to appear",
  { session_id: z.string().optional(), selector: z.string(), state: z.enum(["attached", "detached", "visible", "hidden"]).optional(), timeout: z.number().optional() },
  async ({ session_id, selector, state, timeout }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      await waitForSelector(page, selector, { state, timeout });
      return json({ ready: selector });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_wait_for_navigation",
  "Wait for URL change after a click or action. Returns the new URL and title.",
  { session_id: z.string().optional(), timeout: z.number().optional().default(30000), url_pattern: z.string().optional() },
  async ({ session_id, timeout, url_pattern }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const start = Date.now();
      if (url_pattern) {
        await page.waitForURL(url_pattern, { timeout });
      } else {
        await page.waitForLoadState("domcontentloaded", { timeout });
      }
      return json({ url: page.url(), title: await getTitle(page), elapsed_ms: Date.now() - start });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_wait_for_idle",
  "Wait until no network requests are in-flight for a specified duration. Essential for SPAs that load data after navigation.",
  {
    session_id: z.string().optional(),
    idle_time: z.number().optional().default(2000).describe("How long (ms) network must be idle to consider page loaded"),
    timeout: z.number().optional().default(30000).describe("Max wait time (ms) before giving up"),
  },
  async ({ session_id, idle_time, timeout }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);

      const t0 = Date.now();
      let lastActivity = Date.now();
      let pending = 0;

      const onRequest = () => { pending++; lastActivity = Date.now(); };
      const onResponse = () => { pending = Math.max(0, pending - 1); if (pending === 0) lastActivity = Date.now(); };
      const onFailed = () => { pending = Math.max(0, pending - 1); if (pending === 0) lastActivity = Date.now(); };

      page.on("request", onRequest);
      page.on("response", onResponse);
      page.on("requestfailed", onFailed);

      try {
        await new Promise<void>((resolve, reject) => {
          const check = () => {
            const now = Date.now();
            if (now - t0 > timeout) {
              reject(new Error(`Timeout after ${timeout}ms (${pending} requests still pending)`));
              return;
            }
            if (pending === 0 && now - lastActivity >= idle_time) {
              resolve();
              return;
            }
            setTimeout(check, 100);
          };
          check();
        });
      } finally {
        page.removeListener("request", onRequest);
        page.removeListener("response", onResponse);
        page.removeListener("requestfailed", onFailed);
      }

      const waited_ms = Date.now() - t0;
      return json({ idle: true, waited_ms, pending_requests: 0 });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_wait_for_text",
  "Wait until specific text appears on the page",
  { session_id: z.string().optional(), text: z.string(), timeout: z.number().optional().default(10000), exact: z.boolean().optional().default(false) },
  async ({ session_id, text, timeout, exact }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const start = Date.now();
      await waitForText(page, text, { timeout, exact });
      return json({ found: true, elapsed_ms: Date.now() - start });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_click_text",
  "Click an element by its visible text content",
  { session_id: z.string().optional(), text: z.string(), exact: z.boolean().optional().default(false), timeout: z.number().optional() },
  async ({ session_id, text, exact, timeout }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      await clickText(page, text, { exact, timeout });
      return json({ clicked: text });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_fill_form",
  "Fill multiple form fields in one call. Fields map: { selector: value }. Handles text, checkboxes, selects. Self-healing auto-tries fallback selectors per field.",
  {
    session_id: z.string().optional(),
    fields: z.record(z.union([z.string(), z.boolean()])),
    submit_selector: z.string().optional(),
    self_heal: z.boolean().optional().default(true).describe("Auto-try fallback selectors if element not found"),
  },
  async ({ session_id, fields, submit_selector, self_heal }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const result = await fillForm(page, fields, submit_selector, self_heal);
      return json(result);
    } catch (e) { return errWithScreenshot(e, session_id); }
  }
);

registerTool(server,
  "browser_find_visual",
  "Find an element using AI vision when selectors and a11y refs fail. Returns coordinates only; use semantic refs/actions for execution.",
  {
    session_id: z.string().optional(),
    description: z.string().describe("Natural language description of the element to find (e.g. 'the blue Submit button', 'the search icon in the top right')"),
    model: z.string().optional().describe("Vision model to use (default: claude-sonnet-4-5-20250929)"),
  },
  async ({ session_id, description, model }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const { findElementByVision } = await import("../lib/vision-fallback.js");
      const result = await findElementByVision(page, description, { model });
      logEvent(sid, "vision_find", { query: description, ...result });
      return json(result);
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_scroll_to_element",
  "Scroll an element into view (by ref or selector) then optionally take a screenshot of it. Replaces scroll + wait + screenshot pattern.",
  {
    session_id: z.string().optional(),
    selector: z.string().optional(),
    ref: z.string().optional(),
    screenshot: z.boolean().optional().default(true),
    wait_ms: z.number().optional().default(200),
  },
  async ({ session_id, selector, ref, screenshot: doScreenshot, wait_ms }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      let locator;
      if (ref) {
        const { getRefLocator } = await import("../lib/snapshot.js");
        locator = getRefLocator(page, sid, ref);
      } else if (selector) {
        locator = page.locator(selector).first();
      } else {
        return err(new Error("Either ref or selector is required"));
      }

      await locator.scrollIntoViewIfNeeded();
      await new Promise((r) => setTimeout(r, wait_ms));

      const result: Record<string, unknown> = { scrolled: ref ?? selector };

      if (doScreenshot) {
        try {
          const ss = await takeScreenshot(page, { selector: selector, track: false });
          ss.url = page.url();
          if (ss.base64.length > 50000) {
            (ss as any).base64_truncated = true;
            ss.base64 = ss.thumbnail_base64 ?? "";
          }
          result.screenshot = ss;
        } catch {}
      }

      return json(result);
    } catch (e) { return err(e); }
  }
);

// ── Dialog Tools ──────────────────────────────────────────────────────────────

registerTool(server,
  "browser_handle_dialog",
  "Accept or dismiss a pending dialog (alert, confirm, prompt). Handles the oldest pending dialog.",
  { session_id: z.string().optional(), action: z.enum(["accept", "dismiss"]), prompt_text: z.string().optional() },
  async ({ session_id, action, prompt_text }) => {
    try {
      const sid = resolveSessionId(session_id);
      const { handleDialog } = await import("../lib/dialogs.js");
      const result = await handleDialog(sid, action, prompt_text);
      if (!result.handled) return err(new Error("No pending dialogs for this session"));
      return json(result);
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_get_dialogs",
  "Get all pending dialogs for a session",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const { getDialogs } = await import("../lib/dialogs.js");
      const dialogs = getDialogs(sid);
      return json({ dialogs, count: dialogs.length });
    } catch (e) { return err(e); }
  }
);

} // end register
