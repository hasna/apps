// ─── Network, storage, performance, console tools ────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { clampLimit, compactList, truncateText } from "./compact.js";
import {
  registerTool,
  z,
  json,
  err,
  resolveSessionId,
  getSessionPage,
  enableNetworkLogging,
  addInterceptRule,
  startHAR,
  networkLogCleanup,
  consoleCaptureCleanup,
  harCaptures,
  enableConsoleCapture,
  getNetworkLog,
  getConsoleLog,
  getPerformanceMetrics,
  getCookies,
  setCookie,
  clearCookies,
  getLocalStorage,
  setLocalStorage,
  getSessionStorage,
  setSessionStorage,
  saveToDownloads,
  logEvent,
  saveProfile,
  loadProfile,
  applyProfile,
  listProfilesFn,
  deleteProfile,
} from "./helpers.js";

export function register(server: McpServer) {

// ── Storage Tools ─────────────────────────────────────────────────────────────

registerTool(server,
  "browser_cookies_get",
  "Get cookies from the current session. Compact by default; set verbose=true for full cookie values.",
  { session_id: z.string().optional(), name: z.string().optional(), domain: z.string().optional(), limit: z.number().optional().default(25), offset: z.number().optional().default(0), verbose: z.boolean().optional().default(false) },
  async ({ session_id, name, domain, limit, offset, verbose }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const cookies = await getCookies(page, { name, domain });
      if (verbose) {
        const page = compactList(cookies, limit, (cookie) => cookie, { offset });
        return json({ cookies: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(cookies, limit, (cookie) => ({
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
        has_value: !!cookie.value,
      }), {
        offset,
        hint: "Set verbose=true to include full cookie values.",
      });
      return json({ cookies: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_cookies_set",
  "Set a cookie in the current session",
  {
    session_id: z.string().optional(),
    name: z.string(),
    value: z.string(),
    domain: z.string().optional(),
    path: z.string().optional().default("/"),
    expires: z.number().optional(),
    http_only: z.boolean().optional().default(false),
    secure: z.boolean().optional().default(false),
  },
  async ({ session_id, name, value, domain, path, expires, http_only, secure }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      await setCookie(page, {
        name, value,
        domain: domain ?? new URL(page.url()).hostname,
        path: path ?? "/",
        expires: expires ?? -1,
        httpOnly: http_only,
        secure,
        sameSite: "Lax",
      });
      return json({ set: name });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_cookies_clear",
  "Clear cookies from the current session",
  { session_id: z.string().optional(), name: z.string().optional(), domain: z.string().optional() },
  async ({ session_id, name, domain }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      await clearCookies(page, name || domain ? { name, domain } : undefined);
      return json({ cleared: true });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_storage_get",
  "Get localStorage or sessionStorage values",
  { session_id: z.string().optional(), key: z.string().optional(), storage_type: z.enum(["local", "session"]).optional().default("local") },
  async ({ session_id, key, storage_type }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const value = storage_type === "session"
        ? await getSessionStorage(page, key)
        : await getLocalStorage(page, key);
      return json({ value });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_storage_set",
  "Set a localStorage or sessionStorage value",
  { session_id: z.string().optional(), key: z.string(), value: z.string(), storage_type: z.enum(["local", "session"]).optional().default("local") },
  async ({ session_id, key, value, storage_type }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      if (storage_type === "session") {
        await setSessionStorage(page, key, value);
      } else {
        await setLocalStorage(page, key, value);
      }
      return json({ set: key });
    } catch (e) { return err(e); }
  }
);

// ── Network Tools ─────────────────────────────────────────────────────────────

registerTool(server,
  "browser_network_log",
  "Get captured network requests for a session. Compact by default; set verbose=true for headers/bodies.",
  { session_id: z.string().optional(), limit: z.number().optional().default(50), offset: z.number().optional().default(0), verbose: z.boolean().optional().default(false) },
  async ({ session_id, limit, offset, verbose }) => {
    try {
      const sid = resolveSessionId(session_id);
      // Start logging if not already
      if (!networkLogCleanup.has(sid)) {
        const page = getSessionPage(sid);
        const cleanup = enableNetworkLogging(page, sid);
        networkLogCleanup.set(sid, cleanup);
      }
      const log = getNetworkLog(sid);
      if (verbose) {
        const page = compactList(log, limit, (request) => request, { offset });
        return json({ requests: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(log, limit, (request) => ({
        id: request.id,
        method: request.method,
        url: truncateText(request.url, 180),
        status_code: request.status_code,
        resource_type: request.resource_type,
        duration_ms: request.duration_ms,
        body_size: request.body_size,
        timestamp: request.timestamp,
      }), {
        offset,
        hint: "Set verbose=true for headers/bodies or use browser_har_stop with include_har=true for a full HAR.",
      });
      return json({ requests: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_network_intercept",
  "Add a network interception rule",
  {
    session_id: z.string().optional(),
    pattern: z.string(),
    action: z.enum(["block", "modify", "log"]),
    response_status: z.number().optional(),
    response_body: z.string().optional(),
  },
  async ({ session_id, pattern, action, response_status, response_body }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      await addInterceptRule(page, {
        pattern,
        action,
        response: response_status != null && response_body != null
          ? { status: response_status, body: response_body }
          : undefined,
      });
      return json({ intercepting: pattern, action });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_har_start",
  "Start HAR capture for a session",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const capture = startHAR(page);
      harCaptures.set(sid, capture);
      return json({ started: true });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_har_stop",
  "Stop HAR capture. Saves HAR to downloads and omits full HAR unless include_har=true.",
  { session_id: z.string().optional(), include_har: z.boolean().optional().default(false) },
  async ({ session_id, include_har }) => {
    try {
      const sid = resolveSessionId(session_id);
      const capture = harCaptures.get(sid);
      if (!capture) return err(new Error("No active HAR capture for this session"));
      const har = capture.stop();
      harCaptures.delete(sid);
      // Auto-save HAR to downloads
      let download_id: string | undefined;
      try {
        const harBuf = Buffer.from(JSON.stringify(har, null, 2));
        const dl = saveToDownloads(harBuf, `capture-${Date.now()}.har`, { sessionId: sid, type: "har" });
        download_id = dl.id;
      } catch { /* non-fatal */ }
      return json({
        entry_count: har.log.entries.length,
        download_id,
        har: include_har ? har : undefined,
        hint: include_har ? undefined : "Full HAR omitted by default. Set include_har=true or fetch the saved download for the full payload.",
      });
    } catch (e) { return err(e); }
  }
);

// ── Response Intercept Tools ──────────────────────────────────────────────────

registerTool(server,
  "browser_intercept_response",
  "Intercept and modify API responses for testing. Mock data, simulate errors, add latency.",
  {
    session_id: z.string().optional(),
    url_pattern: z.string().describe("URL pattern to intercept (e.g. '**/api/users*')"),
    action: z.enum(["mock", "delay", "error"]).describe("What to do with matched requests"),
    mock_body: z.string().optional().describe("Response body for mock action"),
    mock_content_type: z.string().optional().default("application/json"),
    status_code: z.number().optional().default(200).describe("HTTP status code (for mock/error)"),
    delay_ms: z.number().optional().default(3000).describe("Delay in ms (for delay action)"),
  },
  async ({ session_id, url_pattern, action, mock_body, mock_content_type, status_code, delay_ms }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);

      await page.route(url_pattern, async (route) => {
        if (action === "mock") {
          await route.fulfill({
            status: status_code,
            contentType: mock_content_type,
            body: mock_body ?? "{}",
          });
        } else if (action === "error") {
          await route.fulfill({
            status: status_code ?? 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Intercepted error", status: status_code }),
          });
        } else if (action === "delay") {
          await new Promise(r => setTimeout(r, delay_ms));
          await route.continue();
        }
      });

      logEvent(sid, "intercept_set", { url_pattern, action, status_code });
      return json({ intercepted: true, url_pattern, action });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_intercept_clear",
  "Remove all response intercepts from a session",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      await page.unrouteAll({ behavior: "ignoreErrors" });
      return json({ cleared: true });
    } catch (e) { return err(e); }
  }
);

// ── Performance Tools ─────────────────────────────────────────────────────────

registerTool(server,
  "browser_performance",
  "Get performance metrics for the current page",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const metrics = await getPerformanceMetrics(page);
      return json({ metrics });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_detect_env",
  "Detect if the current page is running in production, development, staging, or local environment. Analyzes URL, meta tags, source maps, analytics SDKs, and more.",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const { detectEnvironment } = await import("../lib/env-detector.js");
      const result = await detectEnvironment(page);
      return json(result);
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_performance_deep",
  "Deep performance analysis: Web Vitals, resource breakdown by type, largest resources, third-party scripts with categories, DOM complexity, memory usage.",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const { getDeepPerformance } = await import("../lib/deep-performance.js");
      const result = await getDeepPerformance(page);
      return json(result);
    } catch (e) { return err(e); }
  }
);

// ── Accessibility Tools ───────────────────────────────────────────────────────

registerTool(server,
  "browser_accessibility_audit",
  "Run accessibility audit on the page. Injects axe-core and returns violations grouped by severity (critical, serious, moderate, minor).",
  { session_id: z.string().optional(), selector: z.string().optional().describe("Scope audit to a specific element") },
  async ({ session_id, selector }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);

      // Inject axe-core
      await page.evaluate(`
        if (!window.axe) {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
          document.head.appendChild(script);
          await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = reject;
          });
        }
      `);

      // Small wait for axe to initialize
      await new Promise(r => setTimeout(r, 500));

      // Run audit
      const results = await page.evaluate((sel) => {
        const opts: any = {};
        if (sel) opts.include = [sel];
        return (window as any).axe.run(opts.include ? { include: [sel] } : document).then((r: any) => ({
          violations: r.violations.map((v: any) => ({
            id: v.id,
            impact: v.impact,
            description: v.description,
            help: v.help,
            helpUrl: v.helpUrl,
            nodes_count: v.nodes.length,
            selectors: v.nodes.slice(0, 3).map((n: any) => n.target?.[0] ?? ""),
          })),
          passes: r.passes.length,
          violations_count: r.violations.length,
          incomplete: r.incomplete.length,
        }));
      }, selector);

      // Group by impact
      const byImpact: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
      for (const v of (results as any).violations) {
        byImpact[v.impact] = (byImpact[v.impact] || 0) + 1;
      }

      return json({ ...results, by_impact: byImpact, score: Math.max(0, 100 - (results as any).violations_count * 5) });
    } catch (e) { return err(e); }
  }
);

// ── Console Tools ─────────────────────────────────────────────────────────────

registerTool(server,
  "browser_console_log",
  "Get captured console messages for a session. Compact by default; set verbose=true for full messages.",
  { session_id: z.string().optional(), level: z.enum(["log", "warn", "error", "debug", "info"]).optional(), limit: z.number().optional().default(50), offset: z.number().optional().default(0), verbose: z.boolean().optional().default(false) },
  async ({ session_id, level, limit, offset, verbose }) => {
    try {
      const sid = resolveSessionId(session_id);
      if (!consoleCaptureCleanup.has(sid)) {
        const page = getSessionPage(sid);
        const cleanup = enableConsoleCapture(page, sid);
        consoleCaptureCleanup.set(sid, cleanup);
      }
      const messages = getConsoleLog(sid, level as import("../types/index.js").ConsoleLevel | undefined);
      if (verbose) {
        const page = compactList(messages, limit, (message) => message, { offset });
        return json({ messages: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(messages, limit, (message) => ({
        id: message.id,
        level: message.level,
        message: truncateText(message.message, 240),
        source: truncateText(message.source, 120) || undefined,
        timestamp: message.timestamp,
      }), {
        offset,
        hint: "Set verbose=true for full console messages.",
      });
      return json({ messages: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_has_errors",
  "Quick check: does the session have any console errors?",
  { session_id: z.string().optional(), limit: z.number().optional().default(5), verbose: z.boolean().optional().default(false) },
  async ({ session_id, limit, verbose }) => {
    try {
      const rowLimit = clampLimit(limit, 5);
      const sid = resolveSessionId(session_id);
      const errors = getConsoleLog(sid, "error");
      const sample = verbose ? errors : errors.slice(0, rowLimit).map((error) => ({
        id: error.id,
        level: error.level,
        message: truncateText(error.message, 240),
        timestamp: error.timestamp,
      }));
      return json({ has_errors: errors.length > 0, error_count: errors.length, errors: sample, limit: rowLimit, truncated: !verbose && errors.length > rowLimit, hint: !verbose && errors.length > rowLimit ? "Set verbose=true or a larger limit for more errors." : undefined });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_clear_errors",
  "Clear console error log for a session",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const { clearConsoleLog } = await import("../db/console-log.js");
      clearConsoleLog(sid);
      return json({ cleared: true });
    } catch (e) { return err(e); }
  }
);

// ── Profile Tools ─────────────────────────────────────────────────────────────

registerTool(server,
  "browser_profile_save",
  "Save cookies + localStorage from the current session as a named profile",
  { session_id: z.string().optional(), name: z.string() },
  async ({ session_id, name }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const info = await saveProfile(page, name);
      return json(info);
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_profile_load",
  "Load a saved profile and apply cookies + localStorage to the current session",
  { session_id: z.string().optional().optional(), name: z.string() },
  async ({ session_id, name }) => {
    try {
      const profileData = loadProfile(name);
      if (session_id) {
        const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
        const applied = await applyProfile(page, profileData);
        return json({ ...applied, profile: name });
      }
      return json({ profile: name, cookies: profileData.cookies.length, storage_keys: Object.keys(profileData.localStorage).length });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_profile_list",
  "List saved browser profiles. Compact by default; set verbose=true for full metadata.",
  { limit: z.number().optional().default(25), offset: z.number().optional().default(0), verbose: z.boolean().optional().default(false) },
  async ({ limit, offset, verbose }) => {
    try {
      const profiles = listProfilesFn();
      if (verbose) {
        const page = compactList(profiles, limit, (profile) => profile, { offset });
        return json({ profiles: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(profiles, limit, (profile: any) => ({
        name: profile.name,
        domain: profile.domain,
        cookies: profile.cookies_count ?? profile.cookies?.length,
        storage_keys: profile.storage_keys ?? (profile.localStorage ? Object.keys(profile.localStorage).length : undefined),
        updated_at: profile.updated_at ?? profile.modified,
      }), {
        offset,
        hint: "Set verbose=true for full profile metadata.",
      });
      return json({ profiles: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_profile_delete",
  "Delete a saved browser profile",
  { name: z.string() },
  async ({ name }) => {
    try {
      const deleted = deleteProfile(name);
      if (!deleted) return err(new Error(`Profile not found: ${name}`));
      return json({ deleted: name });
    } catch (e) { return err(e); }
  }
);

// ── Performance Budget ────────────────────────────────────────────────────────

registerTool(server,
  "browser_performance_budget",
  "Check page performance against a budget. Set thresholds for LCP, FCP, CLS, TTFB, DOM complete, and load event. Returns pass/fail per metric with actual values.",
  {
    session_id: z.string().optional(),
    lcp_ms: z.number().optional().describe("Largest Contentful Paint budget in ms (good: <2500)"),
    fcp_ms: z.number().optional().describe("First Contentful Paint budget in ms (good: <1800)"),
    cls: z.number().optional().describe("Cumulative Layout Shift budget (good: <0.1)"),
    ttfb_ms: z.number().optional().describe("Time to First Byte budget in ms (good: <800)"),
    dom_complete_ms: z.number().optional().describe("DOM complete budget in ms"),
    load_event_ms: z.number().optional().describe("Load event budget in ms"),
    js_heap_mb: z.number().optional().describe("JS heap size budget in MB"),
  },
  async ({ session_id, lcp_ms, fcp_ms, cls, ttfb_ms, dom_complete_ms, load_event_ms, js_heap_mb }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const metrics = await getPerformanceMetrics(page);

      const checks: Array<{ metric: string; budget: number; actual: number | undefined; passed: boolean }> = [];
      let allPassed = true;

      const check = (name: string, budget: number | undefined, actual: number | undefined) => {
        if (budget === undefined) return;
        const passed = actual !== undefined && actual <= budget;
        if (!passed) allPassed = false;
        checks.push({ metric: name, budget, actual, passed });
      };

      check("lcp", lcp_ms, metrics.lcp);
      check("fcp", fcp_ms, metrics.fcp);
      check("cls", cls, metrics.cls);
      check("ttfb", ttfb_ms, metrics.ttfb);
      check("dom_complete", dom_complete_ms, metrics.dom_complete);
      check("load_event", load_event_ms, metrics.load_event);
      if (js_heap_mb !== undefined && metrics.js_heap_size_used !== undefined) {
        const heapMb = metrics.js_heap_size_used / (1024 * 1024);
        const passed = heapMb <= js_heap_mb;
        if (!passed) allPassed = false;
        checks.push({ metric: "js_heap_mb", budget: js_heap_mb, actual: Math.round(heapMb * 100) / 100, passed });
      }

      return json({
        passed: allPassed,
        checks,
        metrics,
        url: page.url(),
      });
    } catch (e) { return err(e); }
  }
);

} // end register
