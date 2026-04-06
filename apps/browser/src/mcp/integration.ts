// ─── Integration, watch, and advanced meta tools ─────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  z,
  json,
  err,
  resolveSessionId,
  getSessionPage,
  navigate,
  click,
  typeText,
  scroll,
  waitForSelector,
  getText,
  getLinks,
  takeScreenshot,
  takeSnapshotFn,
  watchPage,
  getWatchChanges,
  stopWatch,
  logEvent,
} from "./helpers.js";

export function registerIntegrationAndMeta(server: McpServer) {

// ── Watch ─────────────────────────────────────────────────────────────────────

const activeWatchHandles = new Map<string, ReturnType<typeof watchPage>>();

server.tool(
  "browser_watch_start",
  "Start watching a page for DOM changes",
  { session_id: z.string().optional(), selector: z.string().optional(), interval_ms: z.number().optional().default(500), max_changes: z.number().optional().default(50) },
  async ({ session_id, selector, interval_ms, max_changes }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const handle = watchPage(page, { selector, intervalMs: interval_ms, maxChanges: max_changes });
      activeWatchHandles.set(handle.id, handle);
      return json({ watch_id: handle.id });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_watch_get_changes",
  "Get DOM changes captured by a watch",
  { watch_id: z.string() },
  async ({ watch_id }) => {
    try {
      const changes = getWatchChanges(watch_id);
      return json({ changes, count: changes.length });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_watch_stop",
  "Stop a DOM change watcher",
  { watch_id: z.string() },
  async ({ watch_id }) => {
    try {
      stopWatch(watch_id);
      activeWatchHandles.delete(watch_id);
      return json({ stopped: true });
    } catch (e) { return err(e); }
  }
);

// ── open-* Integration Tools ──────────────────────────────────────────────────

server.tool(
  "browser_secrets_login",
  "Login to a service using credentials from open-secrets vault or ~/.secrets.",
  { session_id: z.string().optional(), service: z.string(), login_url: z.string().optional(), save_profile: z.boolean().optional().default(true) },
  async ({ session_id, service, login_url, save_profile }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const { getCredentials, loginWithCredentials } = await import("../lib/auth.js");
      const creds = await getCredentials(service);
      if (!creds) return err(new Error(`No credentials found for '${service}'. Add them: secrets set ${service}_email yourlogin && secrets set ${service}_password yourpass`));
      const result = await loginWithCredentials(page as any, creds, {
        loginUrl: login_url,
        saveProfile: save_profile ? service : undefined,
      });
      return json(result);
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_remember",
  "Store page facts in open-mementos for future recall.",
  { session_id: z.string().optional(), facts: z.record(z.unknown()), tags: z.array(z.string()).optional() },
  async ({ session_id, facts, tags }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const { rememberPage } = await import("../lib/page-memory.js");
      const url = page.url();
      await rememberPage(url, facts, tags);
      return json({ remembered: true, url, facts_count: Object.keys(facts).length });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_recall",
  "Retrieve cached page facts from open-mementos.",
  { url: z.string(), max_age_hours: z.number().optional().default(24) },
  async ({ url, max_age_hours }) => {
    try {
      const { recallPage } = await import("../lib/page-memory.js");
      const memory = await recallPage(url, max_age_hours);
      return json({ found: !!memory, memory });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_session_announce",
  "Announce to other agents via open-conversations what this session is browsing.",
  { session_id: z.string().optional(), message: z.string().optional() },
  async ({ session_id, message }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const { announceNavigation } = await import("../lib/coordination.js");
      const url = page.url();
      await announceNavigation(url, sid);
      return json({ announced: true, url, message });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_check_navigation",
  "Check if another agent is already scraping this URL.",
  { url: z.string() },
  async ({ url }) => {
    try {
      const { checkDuplicate } = await import("../lib/coordination.js");
      return json(await checkDuplicate(url));
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_task_queue",
  "Queue a browser task in open-todos for agents to pick up.",
  { title: z.string(), description: z.string(), url: z.string().optional(), priority: z.enum(["low", "medium", "high", "critical"]).optional().default("medium") },
  async ({ title, description, url, priority }) => {
    try {
      const { queueBrowserTask } = await import("../lib/task-queue.js");
      return json(await queueBrowserTask({ title, description, url, priority }));
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_task_list",
  "List pending browser tasks from open-todos.",
  { status: z.enum(["pending", "in_progress"]).optional() },
  async ({ status }) => {
    try {
      const { getBrowserTasks } = await import("../lib/task-queue.js");
      const tasks = await getBrowserTasks(status);
      return json({ tasks, count: tasks.length });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_task_complete",
  "Mark a browser task as completed with extracted result data.",
  { task_id: z.string(), result: z.record(z.unknown()) },
  async ({ task_id, result }) => {
    try {
      const { completeBrowserTask } = await import("../lib/task-queue.js");
      await completeBrowserTask(task_id, result);
      return json({ completed: task_id });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_skill_run",
  "Run a pre-built browser skill (login, extract-pricing, monitor-price, etc.).",
  { session_id: z.string().optional(), skill: z.string(), params: z.record(z.unknown()).optional().default({}) },
  async ({ session_id, skill, params }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const { runBrowserSkill } = await import("../lib/skills-runner.js");
      return json(await runBrowserSkill(skill, params, page as any));
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_skill_list",
  "List available browser skills.",
  {},
  async () => {
    try {
      const { listBuiltInSkills } = await import("../lib/skills-runner.js");
      return json({ skills: listBuiltInSkills() });
    } catch (e) { return err(e); }
  }
);

// ── browser_batch ─────────────────────────────────────────────────────────────

server.tool(
  "browser_batch",
  "Execute multiple browser actions in one call. Returns final snapshot.",
  {
    session_id: z.string().optional(),
    actions: z.array(z.object({
      tool: z.string(),
      args: z.record(z.unknown()).optional().default({}),
    })),
  },
  async ({ session_id, actions }) => {
    try {
      const results: Array<{ tool: string; success: boolean; result?: unknown; error?: string }> = [];
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const t0 = Date.now();

      for (const action of actions) {
        try {
          const toolName = action.tool.replace(/^browser_/, "");
          const args = { session_id: sid, ...(action.args as Record<string, unknown>) } as any;

          switch (toolName) {
            case "navigate":
              await navigate(page, (action.args as any).url as string);
              results.push({ tool: action.tool, success: true, result: { url: page.url() } });
              break;
            case "click":
              if (args.ref) { const { clickRef } = await import("../lib/actions.js"); await clickRef(page as any, sid, args.ref as string); }
              else if (args.selector) await page.click(args.selector as string);
              results.push({ tool: action.tool, success: true });
              break;
            case "type":
              if (args.ref && args.text) { const { typeRef } = await import("../lib/actions.js"); await typeRef(page as any, sid, args.ref as string, args.text as string); }
              else if (args.selector && args.text) await page.fill(args.selector as string, args.text as string);
              results.push({ tool: action.tool, success: true });
              break;
            case "fill_form":
              if (args.fields) { const { fillForm } = await import("../lib/actions.js"); const r = await fillForm(page as any, args.fields as any); results.push({ tool: action.tool, success: true, result: r }); }
              break;
            case "scroll":
              await scroll(page, ((args.direction as string) ?? "down") as "up" | "down" | "left" | "right", (args.amount as number) ?? 300);
              results.push({ tool: action.tool, success: true });
              break;
            case "wait":
              if (args.selector) await waitForSelector(page, args.selector as string, { timeout: args.timeout as number });
              else await new Promise(r => setTimeout(r, (args.ms as number) ?? 500));
              results.push({ tool: action.tool, success: true });
              break;
            case "evaluate":
              const evalResult = await page.evaluate(args.script as string);
              results.push({ tool: action.tool, success: true, result: evalResult });
              break;
            case "screenshot":
              const ss = await takeScreenshot(page, { maxWidth: 1280, track: false });
              results.push({ tool: action.tool, success: true, result: { path: ss.path, size_bytes: ss.size_bytes } });
              break;
            default:
              results.push({ tool: action.tool, success: false, error: `Unknown batch action: ${toolName}` });
          }
        } catch (e) {
          results.push({ tool: action.tool, success: false, error: e instanceof Error ? e.message : String(e) });
        }
      }

      let final_snapshot: Record<string, unknown> = {};
      try {
        const snap = await takeSnapshotFn(page, sid);
        final_snapshot = {
          refs: Object.fromEntries(Object.entries(snap.refs).slice(0, 20)),
          interactive_count: snap.interactive_count,
        };
      } catch {}

      return json({
        results,
        succeeded: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        final_url: page.url(),
        final_snapshot,
        elapsed_ms: Date.now() - t0,
      });
    } catch (e) { return err(e); }
  }
);

// ── browser_parallel ──────────────────────────────────────────────────────────

server.tool(
  "browser_parallel",
  "Execute actions across multiple sessions in parallel.",
  {
    actions: z.array(z.object({
      session_id: z.string(),
      tool: z.string(),
      args: z.record(z.unknown()).optional().default({}),
    })),
    timeout: z.number().optional().default(30000),
  },
  async ({ actions, timeout }) => {
    try {
      const t0 = Date.now();

      const promises = actions.map(async (action, index) => {
        try {
          const sid = action.session_id;
          const page = getSessionPage(sid);
          const args = action.args as Record<string, unknown>;
          const toolName = action.tool.replace(/^browser_/, "");

          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
          );

          const actionPromise = (async () => {
            switch (toolName) {
              case "navigate": {
                await navigate(page, args.url as string);
                const title = await page.title();
                return { url: page.url(), title };
              }
              case "screenshot": {
                const result = await takeScreenshot(page, {
                  maxWidth: (args.max_width as number) ?? 800,
                  quality: (args.quality as number) ?? 60,
                });
                return { path: result.path, size_bytes: result.size_bytes };
              }
              case "click": {
                if (args.selector) await click(page, args.selector as string);
                return { clicked: args.selector };
              }
              case "type": {
                if (args.selector && args.text) await typeText(page, args.selector as string, args.text as string);
                return { typed: args.text };
              }
              case "get_text": {
                const text = await getText(page);
                return { text: text.slice(0, 1000), length: text.length };
              }
              case "get_links": {
                const links = await getLinks(page);
                return { links, count: links.length };
              }
              case "snapshot": {
                const snap = await takeSnapshotFn(page, sid);
                return { interactive_count: snap.interactive_count, refs_count: Object.keys(snap.refs).length };
              }
              case "evaluate": {
                const result = await page.evaluate(args.expression as string);
                return { result };
              }
              default:
                return { error: `Unknown tool: ${action.tool}` };
            }
          })();

          const result = await Promise.race([actionPromise, timeoutPromise]);
          return { index, session_id: sid, tool: action.tool, success: true, result };
        } catch (e) {
          return { index, session_id: action.session_id, tool: action.tool, success: false, error: e instanceof Error ? e.message : String(e) };
        }
      });

      const results = await Promise.all(promises);
      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return json({ results, duration_ms: Date.now() - t0, succeeded, failed, total: actions.length });
    } catch (e) { return err(e); }
  }
);

// ── browser_pool_status ───────────────────────────────────────────────────────

server.tool(
  "browser_pool_status",
  "Get status of the pre-warmed browser session pool.",
  {},
  async () => {
    try {
      return json({ message: "Session pool not yet implemented in this version.", ready: 0, total: 0 });
    } catch (e) { return err(e); }
  }
);

// ── Cron & URL Watch ───────────────────────────────────────────────────────────

server.tool(
  "browser_cron_create",
  "Schedule a browser task to run automatically.",
  { schedule: z.string(), url: z.string().optional(), skill: z.string().optional(), extract: z.record(z.string()).optional(), name: z.string().optional() },
  async ({ schedule, url, skill, extract, name }) => {
    try {
      const { createCronJob } = await import("../lib/cron-manager.js");
      return json(createCronJob(schedule, { url, skill, extract }, name));
    } catch (e) { return err(e); }
  }
);

server.tool("browser_cron_list", "List scheduled browser cron jobs.", {},
  async () => { try { const { listCronJobs } = await import("../lib/cron-manager.js"); return json({ jobs: listCronJobs() }); } catch (e) { return err(e); } }
);

server.tool("browser_cron_delete", "Delete a cron job.", { id: z.string() },
  async ({ id }) => { try { const { deleteCronJob } = await import("../lib/cron-manager.js"); return json({ deleted: deleteCronJob(id) }); } catch (e) { return err(e); } }
);

server.tool("browser_cron_run_now", "Manually trigger a cron job.", { id: z.string() },
  async ({ id }) => { try { const { runCronJobNow } = await import("../lib/cron-manager.js"); return json(await runCronJobNow(id)); } catch (e) { return err(e); } }
);

server.tool("browser_cron_enable", "Enable/disable a cron job.", { id: z.string(), enabled: z.boolean() },
  async ({ id, enabled }) => { try { const { enableCronJob } = await import("../lib/cron-manager.js"); return json(enableCronJob(id, enabled)); } catch (e) { return err(e); } }
);

server.tool(
  "browser_watch_url",
  "Monitor a URL for content changes on a schedule.",
  { url: z.string(), schedule: z.string().optional().default("*/5 * * * *"), selector: z.string().optional(), name: z.string().optional() },
  async ({ url, schedule, selector, name }) => {
    try {
      const { createWatchJob } = await import("../lib/url-watcher.js");
      return json(createWatchJob(url, schedule, { name, selector }));
    } catch (e) { return err(e); }
  }
);

server.tool("browser_watch_list", "List URL watchers.", {},
  async () => { try { const { listWatchJobs } = await import("../lib/url-watcher.js"); return json({ watches: listWatchJobs() }); } catch (e) { return err(e); } }
);

server.tool("browser_watch_events", "Get change events from a watcher.", { watch_id: z.string(), limit: z.number().optional().default(20) },
  async ({ watch_id, limit }) => { try { const { getWatchEvents } = await import("../lib/url-watcher.js"); return json({ events: getWatchEvents(watch_id, limit) }); } catch (e) { return err(e); } }
);

server.tool("browser_watch_delete", "Delete a URL watcher.", { watch_id: z.string() },
  async ({ watch_id }) => { try { const { deleteWatchJob } = await import("../lib/url-watcher.js"); return json({ deleted: deleteWatchJob(watch_id) }); } catch (e) { return err(e); } }
);

// ── browser_task ──────────────────────────────────────────────────────────────

server.tool(
  "browser_task",
  "Execute a natural language browser task autonomously using Claude Haiku.",
  { session_id: z.string().optional(), task: z.string(), max_steps: z.number().optional().default(10), model: z.string().optional() },
  async ({ session_id, task, max_steps, model }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const { executeBrowserTask } = await import("../lib/ai-task.js");
      return json(await executeBrowserTask(page as any, task, { maxSteps: max_steps, model, sessionId: sid }));
    } catch (e) { return err(e); }
  }
);

}