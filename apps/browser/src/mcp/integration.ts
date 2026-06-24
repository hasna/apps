// ─── Integration, watch, and advanced meta tools ─────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { clampLimit, compactList, truncateText } from "./compact.js";
import {
  registerTool,
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

registerTool(server,
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

registerTool(server,
  "browser_watch_get_changes",
  "Get DOM changes captured by a watch",
  { watch_id: z.string(), limit: z.number().optional().default(50), offset: z.number().optional().default(0), verbose: z.boolean().optional().default(false) },
  async ({ watch_id, limit, offset, verbose }) => {
    try {
      const changes = getWatchChanges(watch_id);
      if (verbose) {
        const page = compactList(changes, limit, (change: any) => change, { offset });
        return json({ changes: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(changes, limit, (change: any) => ({
        type: change.type,
        selector: truncateText(change.selector, 120) || undefined,
        text: truncateText(change.text, 160) || undefined,
        timestamp: change.timestamp,
      }), {
        offset,
        hint: "Set verbose=true for full DOM change records.",
      });
      return json({ changes: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
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

registerTool(server,
  "browser_secrets_login",
  "Login to a service using credentials from open-secrets vault or ~/.secrets.",
  { session_id: z.string().optional(), service: z.string(), login_url: z.string().optional(), save_profile: z.boolean().optional().default(true) },
  async ({ session_id, service, login_url, save_profile }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const { lookupCredentials, loginWithCredentials } = await import("../lib/auth.js");
      const { credential: creds, method } = await lookupCredentials(service);
      if (!creds) return err(new Error(`No credentials found for '${service}'. Add them: secrets set ${service}_email yourlogin && secrets set ${service}_password yourpass`));
      const result = await loginWithCredentials(page as any, creds, {
        loginUrl: login_url,
        saveProfile: save_profile ? service : undefined,
        method,
      });
      return json(result);
    } catch (e) { return err(e); }
  }
);

registerTool(server,
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

registerTool(server,
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

registerTool(server,
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

registerTool(server,
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

registerTool(server,
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

registerTool(server,
  "browser_task_list",
  "List pending browser tasks from open-todos. Compact by default; set verbose=true for full task records.",
  { status: z.enum(["pending", "in_progress"]).optional(), limit: z.number().optional().default(25), offset: z.number().optional().default(0), verbose: z.boolean().optional().default(false) },
  async ({ status, limit, offset, verbose }) => {
    try {
      const { getBrowserTasks } = await import("../lib/task-queue.js");
      const tasks = await getBrowserTasks(status);
      if (verbose) {
        const page = compactList(tasks, limit, (task: any) => task, { offset });
        return json({ tasks: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(tasks, limit, (task: any) => ({
        id: task.id,
        title: truncateText(task.title, 120),
        status: task.status,
        priority: task.priority,
        url: truncateText(task.url, 140) || undefined,
        created_at: task.created_at,
      }), {
        offset,
        hint: "Set verbose=true for full task records.",
      });
      return json({ tasks: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
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

registerTool(server,
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

registerTool(server,
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

registerTool(server,
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

registerTool(server,
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

      const promises = actions.map(async (
        action: { session_id: string; tool: string; args?: Record<string, unknown> },
        index: number,
      ) => {
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

registerTool(server,
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

registerTool(server,
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

registerTool(server, "browser_cron_list", "List scheduled browser cron jobs. Compact by default; set verbose=true for full records.",
  { limit: z.number().optional().default(25), offset: z.number().optional().default(0), verbose: z.boolean().optional().default(false) },
  async ({ limit, offset, verbose }) => {
    try {
      const { listCronJobs } = await import("../lib/cron-manager.js");
      const jobs = listCronJobs();
      if (verbose) {
        const page = compactList(jobs, limit, (job: any) => job, { offset });
        return json({ jobs: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(jobs, limit, (job: any) => ({
        id: job.id,
        name: truncateText(job.name, 120) || undefined,
        schedule: job.schedule,
        enabled: job.enabled,
        next_run_at: job.next_run_at,
      }), {
        offset,
        hint: "Set verbose=true for full cron job records.",
      });
      return json({ jobs: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server, "browser_cron_delete", "Delete a cron job.", { id: z.string() },
  async ({ id }) => { try { const { deleteCronJob } = await import("../lib/cron-manager.js"); return json({ deleted: deleteCronJob(id) }); } catch (e) { return err(e); } }
);

registerTool(server, "browser_cron_run_now", "Manually trigger a cron job.", { id: z.string() },
  async ({ id }) => { try { const { runCronJobNow } = await import("../lib/cron-manager.js"); return json(await runCronJobNow(id)); } catch (e) { return err(e); } }
);

registerTool(server, "browser_cron_enable", "Enable/disable a cron job.", { id: z.string(), enabled: z.boolean() },
  async ({ id, enabled }) => { try { const { enableCronJob } = await import("../lib/cron-manager.js"); return json(enableCronJob(id, enabled)); } catch (e) { return err(e); } }
);

registerTool(server,
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

registerTool(server, "browser_watch_list", "List URL watchers. Compact by default; set verbose=true for full records.",
  { limit: z.number().optional().default(25), offset: z.number().optional().default(0), verbose: z.boolean().optional().default(false) },
  async ({ limit, offset, verbose }) => {
    try {
      const { listWatchJobs } = await import("../lib/url-watcher.js");
      const watches = listWatchJobs();
      if (verbose) {
        const page = compactList(watches, limit, (watch: any) => watch, { offset });
        return json({ watches: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(watches, limit, (watch: any) => ({
        id: watch.id,
        name: truncateText(watch.name, 120) || undefined,
        url: truncateText(watch.url, 140),
        schedule: watch.schedule,
        selector: truncateText(watch.selector, 120) || undefined,
        enabled: watch.enabled,
      }), {
        offset,
        hint: "Set verbose=true for full watch records.",
      });
      return json({ watches: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server, "browser_watch_events", "Get change events from a watcher. Compact by default; set verbose=true for full event records.", { watch_id: z.string(), limit: z.number().optional().default(20), verbose: z.boolean().optional().default(false) },
  async ({ watch_id, limit, verbose }) => {
    try {
      const rowLimit = clampLimit(limit, 20);
      const { getWatchEvents } = await import("../lib/url-watcher.js");
      const events = getWatchEvents(watch_id, rowLimit);
      if (verbose) return json({ events, count: events.length, limit: rowLimit });
      return json({
        events: events.map((event: any) => ({
          id: event.id,
          changed: event.changed,
          changed_percent: event.changed_percent,
          screenshot_path: event.screenshot_path,
          created_at: event.created_at,
          summary: truncateText(event.summary, 180) || undefined,
        })),
        count: events.length,
        limit: rowLimit,
        hint: "Set verbose=true for full watch event records.",
      });
    } catch (e) { return err(e); }
  }
);

registerTool(server, "browser_watch_delete", "Delete a URL watcher.", { watch_id: z.string() },
  async ({ watch_id }) => { try { const { deleteWatchJob } = await import("../lib/url-watcher.js"); return json({ deleted: deleteWatchJob(watch_id) }); } catch (e) { return err(e); } }
);

// ── browser_task ──────────────────────────────────────────────────────────────

registerTool(server,
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
