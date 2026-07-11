// ─── Session lifecycle + tab tools ───────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { compactList, truncateText } from "./compact.js";
import {
  registerTool,
  z,
  json,
  err,
  resolveSessionId,
  createSession,
  closeSession,
  getSession,
  listSessions,
  getSessionPage,
  getSessionByName,
  renameSession,
  setSessionPage,
  getTokenBudget,
  getActiveSessionForAgent,
  networkLogCleanup,
  consoleCaptureCleanup,
  harCaptures,
  logEvent,
  getTimeline,
  getNetworkLog,
  getConsoleLog,
  listEntries,
  newTab,
  listTabs,
  switchTab,
  closeTab,
  navigate,
} from "./helpers.js";
import type { BrowserEngine } from "./helpers.js";

export function register(server: McpServer) {

// ── Session Tools ─────────────────────────────────────────────────────────────

registerTool(server,
  "browser_session_create",
  `Create a new browser session. Returns a session object with an id you must pass to other tools.

ENGINES:
- "auto" (default): picks the best engine for your use case automatically
- "playwright": full browser automation — forms, SPAs, auth flows, multi-tab
- "cdp": Chrome DevTools Protocol — network monitoring, perf profiling, coverage
- "lightpanda": fast headless for static pages
- "bun": native Bun.WebView — fastest for screenshots and scraping
- "tui": terminal UI testing — launches a CLI/TUI app (Ink, Blessed, Bubbletea, etc.) via ttyd and connects Playwright to it. Pass the shell command as start_url (e.g. "htop", "bun run app.tsx"). All browser tools (screenshot, click, type, wait) work on the terminal. Use tui_theme to control dark/light appearance and tui_method to choose between buffer-based reads and DOM-row reads.
- "extension": explicit-only real Chrome session automation through a paired MV3 extension connected to browser-serve
- "kernel": explicit-only kernel.sh cloud sandbox attached through CDP

TIPS:
- If agent_id is set and already has an active session, returns the existing one (use force_new to override)
- If session_id is omitted on other tools, the single active session is auto-selected
- Use cdp_url to attach to an already-running Chrome instance
- For TUI sessions: start_url is the shell command to run, NOT a URL`,
  {
    engine: z.enum(["playwright", "cdp", "lightpanda", "bun", "tui", "extension", "kernel", "auto"]).optional().default("auto")
      .describe("Browser engine. Use 'tui' for terminal/CLI app testing — pass the command as start_url"),
    use_case: z.string().optional()
      .describe("Hint for auto engine selection: scrape, screenshot, form, auth, network, har, perf, terminal, tui"),
    project_id: z.string().optional(),
    agent_id: z.string().optional(),
    start_url: z.string().optional()
      .describe("URL to navigate to, OR for engine='tui': the shell command to run (e.g. 'htop', 'bun run app.tsx')"),
    headless: z.boolean().optional().default(true),
    viewport_width: z.number().optional().default(1280),
    viewport_height: z.number().optional().default(720),
    stealth: z.boolean().optional().default(false),
    auto_gallery: z.boolean().optional().default(false),
    storage_state: z.string().optional().describe("Name of saved storage state to load (restores cookies/auth from previous session)"),
    force_new: z.boolean().optional().default(false).describe("Force create a new session even if agent already has one"),
    tags: z.array(z.string()).optional(),
    cdp_url: z.string().optional().describe("Connect to existing Chrome via CDP (e.g. http://localhost:9222). Start Chrome with --remote-debugging-port=9222"),
    approval_token: z.string().optional().describe("Operator approval token for high-risk browser capabilities"),
    tui_theme: z.enum(["dark", "light", "system"]).optional().default("system")
      .describe("TUI engine only: terminal color theme. 'system' auto-detects OS dark/light mode. Choose 'light' for light backgrounds or 'dark' for dark backgrounds."),
    tui_font_size: z.number().optional().default(14)
      .describe("TUI engine only: terminal font size in pixels (default: 14). Larger = more readable screenshots, smaller = more content visible."),
    tui_method: z.enum(["buffer", "dom"]).optional().default("buffer")
      .describe("TUI engine only: how terminal state is read. 'buffer' reads xterm's internal buffer; 'dom' reads rendered DOM rows for a more structured browser-native view."),
    kernel_persistence_id: z.string().optional().describe("Kernel engine only: reusable Kernel profile/persistence name"),
    kernel_profile_id: z.string().optional().describe("Kernel engine only: reusable Kernel profile id"),
    kernel_profile_name: z.string().optional().describe("Kernel engine only: reusable Kernel profile name"),
    kernel_save_profile_changes: z.boolean().optional().default(true).describe("Kernel engine only: save profile changes when the Kernel browser is deleted or times out"),
    kernel_timeout_seconds: z.number().optional().describe("Kernel engine only: remote browser inactivity timeout"),
    kernel_project_id: z.string().optional().describe("Kernel engine only: Kernel project id"),
    kernel_base_url: z.string().optional().describe("Kernel engine only: custom Kernel API base URL"),
    kernel_request_timeout_ms: z.number().optional().describe("Kernel engine only: SDK request timeout in milliseconds"),
    kernel_proxy_id: z.string().optional().describe("Kernel engine only: Kernel proxy id"),
    kernel_gpu: z.boolean().optional().describe("Kernel engine only: enable GPU acceleration"),
    kernel_kiosk_mode: z.boolean().optional().describe("Kernel engine only: hide address bar and tabs in live view"),
    kernel_tags: z.record(z.string()).optional().describe("Kernel engine only: Kernel session tags"),
    kernel_telemetry: z.union([z.boolean(), z.record(z.unknown())]).optional().describe("Kernel engine only: Kernel telemetry config"),
    kernel_chrome_policy: z.record(z.unknown()).optional().describe("Kernel engine only: Chrome enterprise policy overrides"),
    kernel_env: z.record(z.string()).optional().describe("Kernel engine only: non-secret env values for sandbox creation"),
    kernel_env_secrets: z.record(z.string()).optional().describe("Kernel engine only: env var name -> @hasna/secrets key to inject at sandbox creation"),
    kernel_auth_mode: z.enum(["managed", "cdp_autofill", "auto", "off"]).optional().default("managed")
      .describe("Kernel engine only: managed auth keeps passwords out of model-visible page/tool results"),
  },
  async ({ engine, use_case, project_id, agent_id, start_url, headless, viewport_width, viewport_height, stealth, auto_gallery, storage_state, force_new, tags, cdp_url, approval_token, tui_theme, tui_font_size, tui_method, kernel_persistence_id, kernel_profile_id, kernel_profile_name, kernel_save_profile_changes, kernel_timeout_seconds, kernel_project_id, kernel_base_url, kernel_request_timeout_ms, kernel_proxy_id, kernel_gpu, kernel_kiosk_mode, kernel_tags, kernel_telemetry, kernel_chrome_policy, kernel_env, kernel_env_secrets, kernel_auth_mode }) => {
    try {
      // Auto-reuse: if agent already has an active session, return it
      if (agent_id && !force_new) {
        const existing = getActiveSessionForAgent(agent_id);
        if (existing) return json({ session: existing.session, reused: true });
      }
      const { session } = await createSession({
        engine: engine as BrowserEngine,
        useCase: use_case as import("../types/index.js").UseCase | undefined,
        projectId: project_id,
        agentId: agent_id,
        startUrl: start_url,
        headless,
        viewport: { width: viewport_width, height: viewport_height },
        stealth,
        autoGallery: auto_gallery,
        storageState: storage_state,
        cdpUrl: cdp_url,
        approvalToken: approval_token,
        tuiTheme: tui_theme as "dark" | "light" | "system" | undefined,
        tuiFontSize: tui_font_size,
        tuiMethod: tui_method as "buffer" | "dom" | undefined,
        kernelPersistenceId: kernel_persistence_id,
        kernelProfileId: kernel_profile_id,
        kernelProfileName: kernel_profile_name,
        kernelSaveProfileChanges: kernel_save_profile_changes,
        kernelTimeoutSeconds: kernel_timeout_seconds,
        kernelProjectId: kernel_project_id,
        kernelBaseUrl: kernel_base_url,
        kernelRequestTimeoutMs: kernel_request_timeout_ms,
        kernelProxyId: kernel_proxy_id,
        kernelGpu: kernel_gpu,
        kernelKioskMode: kernel_kiosk_mode,
        kernelTags: kernel_tags,
        kernelTelemetry: kernel_telemetry,
        kernelChromePolicy: kernel_chrome_policy,
        kernelEnv: kernel_env,
        kernelEnvSecrets: kernel_env_secrets,
        kernelAuthMode: kernel_auth_mode,
      });
      // Apply tags if provided
      if (tags?.length) {
        const { addSessionTag } = await import("../db/sessions.js");
        for (const tag of tags) addSessionTag(session.id, tag);
      }
      logEvent(session.id, "session_created", { engine: session.engine });
      return json({ session, reused: false });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_session_list",
  "List browser sessions. Compact by default; set verbose=true for full session records.",
  {
    status: z.enum(["active", "closed", "error"]).optional(),
    project_id: z.string().optional(),
    tag: z.string().optional(),
    limit: z.number().optional().default(25),
    offset: z.number().optional().default(0),
    verbose: z.boolean().optional().default(false),
  },
  async ({ status, project_id, tag, limit, offset, verbose }) => {
    try {
      const sessions = tag
        ? await (async () => {
          const { listSessionsByTag } = await import("../db/sessions.js");
          return listSessionsByTag(tag);
        })()
        : listSessions({ status, projectId: project_id });
      if (verbose) {
        const page = compactList(sessions, limit, (session) => session, { offset });
        return json({ sessions: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(sessions, limit, (session) => ({
        id: session.id,
        name: session.name,
        status: session.status,
        engine: session.engine,
        start_url: truncateText(session.start_url, 120) || undefined,
        created_at: session.created_at,
        closed_at: session.closed_at,
      }), {
        offset,
        hint: "Set verbose=true for full session records or call browser_session_stats for one session.",
      });
      return json({ sessions: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_session_close",
  "Close a browser session",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const session = await closeSession(sid);
      networkLogCleanup.get(sid)?.();
      consoleCaptureCleanup.get(sid)?.();
      networkLogCleanup.delete(sid);
      consoleCaptureCleanup.delete(sid);
      harCaptures.delete(sid);
      return json({ session });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_session_fork",
  "Fork a session: create a new session with the same auth state (cookies, storage) and URL as an existing one. Like git branch for browser sessions.",
  { source_session_id: z.string(), name: z.string().optional() },
  async ({ source_session_id, name }) => {
    try {
      const sourcePage = getSessionPage(source_session_id);
      const sourceUrl = sourcePage.url();

      // Save source state to a temp name
      const tempName = `_fork_${Date.now()}`;
      const { saveStateFromPage } = await import("../lib/storage-state.js");
      await saveStateFromPage(sourcePage, tempName);

      // Create new session with that state
      const { session, page } = await createSession({
        storageState: tempName,
        startUrl: sourceUrl,
        name: name ?? `fork-of-${source_session_id.slice(0, 8)}`,
      });

      // Clean up temp state
      const { deleteState } = await import("../lib/storage-state.js");
      deleteState(tempName);

      return json({ forked_session: session, source_url: sourceUrl });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_session_timeline",
  "Get chronological action log for a session",
  { session_id: z.string().optional(), limit: z.number().optional().default(50) },
  async ({ session_id, limit }) => {
    try {
      const sid = resolveSessionId(session_id);
      const events = getTimeline(sid, limit);
      return json({ events, count: events.length });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_session_get_by_name",
  "Get a session by its name",
  { name: z.string() },
  async ({ name }) => {
    try {
      const session = getSessionByName(name);
      if (!session) return err(new Error(`Session not found with name: ${name}`));
      return json({ session });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_session_rename",
  "Rename a browser session",
  { session_id: z.string().optional(), name: z.string() },
  async ({ session_id, name }) => {
    try {
      const sid = resolveSessionId(session_id);
      return json({ session: renameSession(sid, name) });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_session_lock",
  "Lock a session so only the specified agent can use it",
  { session_id: z.string().optional(), agent_id: z.string() },
  async ({ session_id, agent_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const { lockSession } = await import("../db/sessions.js");
      return json({ session: lockSession(sid, agent_id) });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_session_unlock",
  "Unlock a session",
  { session_id: z.string().optional(), agent_id: z.string().optional() },
  async ({ session_id, agent_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const { unlockSession } = await import("../db/sessions.js");
      return json({ session: unlockSession(sid, agent_id) });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_session_transfer",
  "Transfer session ownership to another agent",
  { session_id: z.string().optional(), to_agent_id: z.string() },
  async ({ session_id, to_agent_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const { transferSession } = await import("../db/sessions.js");
      return json({ session: transferSession(sid, to_agent_id) });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_session_tag",
  "Add a tag to a session for categorization (e.g. qa, scraping, monitoring)",
  { session_id: z.string().optional(), tag: z.string() },
  async ({ session_id, tag }) => {
    try {
      const sid = resolveSessionId(session_id);
      const { addSessionTag } = await import("../db/sessions.js");
      return json({ tags: addSessionTag(sid, tag) });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_session_untag",
  "Remove a tag from a session",
  { session_id: z.string().optional(), tag: z.string() },
  async ({ session_id, tag }) => {
    try {
      const sid = resolveSessionId(session_id);
      const { removeSessionTag } = await import("../db/sessions.js");
      return json({ tags: removeSessionTag(sid, tag) });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_session_save_state",
  "Save current session's auth state (cookies, localStorage) for reuse. Use after login to avoid re-authenticating.",
  { session_id: z.string().optional(), name: z.string().describe("Name for this state (e.g. 'github', 'gmail')") },
  async ({ session_id, name }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const { saveStateFromPage } = await import("../lib/storage-state.js");
      const path = await saveStateFromPage(page, name);
      return json({ saved: true, name, path });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_session_list_states",
  "List saved storage states (auth snapshots). Compact by default; set verbose=true for paths.",
  { limit: z.number().optional().default(25), offset: z.number().optional().default(0), verbose: z.boolean().optional().default(false) },
  async ({ limit, offset, verbose }) => {
    try {
      const { listStates } = await import("../lib/storage-state.js");
      const states = listStates();
      if (verbose) {
        const page = compactList(states, limit, (state) => state, { offset });
        return json({ states: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(states, limit, (state) => ({
        name: state.name,
        modified: state.modified,
      }), {
        offset,
        hint: "Set verbose=true to include storage-state file paths.",
      });
      return json({ states: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_session_delete_state",
  "Delete a saved storage state",
  { name: z.string() },
  async ({ name }) => {
    try {
      const { deleteState } = await import("../lib/storage-state.js");
      return json({ deleted: deleteState(name), name });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_session_stats",
  "Get session info and estimated token usage (based on network log, console log, and gallery entry sizes).",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const session = getSession(sid);
      const networkLog = getNetworkLog(sid);
      const consoleLog = getConsoleLog(sid);
      const galleryEntries = listEntries({ sessionId: sid, limit: 1000 });

      // Estimate token usage from data sizes (rough: 1 token ~ 4 chars)
      let totalChars = 0;
      for (const req of networkLog) {
        totalChars += (req.url?.length ?? 0)
          + (req.request_headers?.length ?? 0)
          + (req.response_headers?.length ?? 0)
          + (req.request_body?.length ?? 0);
      }
      for (const msg of consoleLog) {
        totalChars += (msg.message?.length ?? 0) + (msg.source?.length ?? 0);
      }
      for (const entry of galleryEntries) {
        totalChars += (entry.url?.length ?? 0)
          + (entry.title?.length ?? 0)
          + (entry.notes?.length ?? 0)
          + (entry.tags?.join(",").length ?? 0);
      }

      const estimatedTokens = Math.ceil(totalChars / 4);
      const tokenBudget = getTokenBudget(sid);

      return json({
        session,
        network_request_count: networkLog.length,
        console_message_count: consoleLog.length,
        gallery_entry_count: galleryEntries.length,
        estimated_tokens_used: estimatedTokens,
        token_budget: tokenBudget,
        data_size_chars: totalChars,
      });
    } catch (e) { return err(e); }
  }
);

// ── Tab Tools ─────────────────────────────────────────────────────────────────

registerTool(server,
  "browser_tab_new",
  "Open a new tab in the session's browser context, optionally navigating to a URL",
  { session_id: z.string().optional(), url: z.string().optional() },
  async ({ session_id, url }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const tab = await newTab(page, url);
      return json(tab);
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_tab_list",
  "List all open tabs in the session's browser context",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const tabs = await listTabs(page);
      return json({ tabs, count: tabs.length });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_tab_switch",
  "Switch to a different tab by index. Updates the session's active page.",
  { session_id: z.string().optional(), tab_id: z.number() },
  async ({ session_id, tab_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const result = await switchTab(page, tab_id);
      setSessionPage(sid, result.page);
      return json(result.tab);
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_tab_close",
  "Close a tab by index. Cannot close the last tab.",
  { session_id: z.string().optional(), tab_id: z.number() },
  async ({ session_id, tab_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      // Get context reference before closing (in case the active page is the one being closed)
      const context = page.context();
      const result = await closeTab(page, tab_id);
      const remainingPages = context.pages();
      const newActivePage = remainingPages[result.active_tab.index];
      if (newActivePage) {
        setSessionPage(sid, newActivePage);
      }
      return json(result);
    } catch (e) { return err(e); }
  }
);

} // end register
