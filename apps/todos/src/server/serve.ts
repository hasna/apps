/**
 * HTTP server for the Todos dashboard.
 * Serves the Vite-built React/shadcn dashboard from dashboard/dist/.
 * Provides REST API endpoints for task management.
 */

import { existsSync } from "fs";
import { join, dirname, extname, resolve, sep } from "path";
import { fileURLToPath } from "url";
import {
  createTask,
  getTask,
  listTasks,
  updateTask,
  deleteTask,
  startTask,
  completeTask,
} from "../db/tasks.js";
import { listProjects } from "../db/projects.js";
import { listAgents } from "../db/agents.js";
import { createPlan, getPlan, listPlans, updatePlan, deletePlan } from "../db/plans.js";
import { getDatabase } from "../db/database.js";
import type { Task } from "../types/index.js";

// Resolve the dashboard dist directory — check multiple locations
function resolveDashboardDir(): string {
  const candidates: string[] = [];

  try {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(scriptDir, "..", "dashboard", "dist"));
    candidates.push(join(scriptDir, "..", "..", "dashboard", "dist"));
  } catch {
    // import.meta.url may not resolve in all contexts
  }

  if (process.argv[1]) {
    const mainDir = dirname(process.argv[1]);
    candidates.push(join(mainDir, "..", "dashboard", "dist"));
    candidates.push(join(mainDir, "..", "..", "dashboard", "dist"));
  }

  candidates.push(join(process.cwd(), "dashboard", "dist"));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return join(process.cwd(), "dashboard", "dist");
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function json(data: unknown, status = 200, port?: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": port ? `http://localhost:${port}` : "*",
      ...SECURITY_HEADERS,
    },
  });
}

function serveStaticFile(filePath: string): Response | null {
  if (!existsSync(filePath)) return null;

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": contentType },
  });
}

function taskToSummary(task: Task, fields?: string[]) {
  const full = {
    id: task.id,
    short_id: task.short_id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    project_id: task.project_id,
    plan_id: task.plan_id,
    task_list_id: task.task_list_id,
    agent_id: task.agent_id,
    assigned_to: task.assigned_to,
    locked_by: task.locked_by,
    tags: task.tags,
    version: task.version,
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: task.completed_at,
    due_at: task.due_at,
    recurrence_rule: task.recurrence_rule,
  };
  if (!fields || fields.length === 0) return full;
  return Object.fromEntries(fields.map(f => [f, (full as Record<string, unknown>)[f] ?? null]));
}

export async function startServer(port: number, options?: { open?: boolean; host?: string }): Promise<void> {
  const shouldOpen = options?.open ?? true;

  // Initialize database
  getDatabase();

  // SSE event stream — clients subscribe to /api/events
  const sseClients = new Set<ReadableStreamDefaultController>();

  // Filtered SSE clients for /api/tasks/stream
  interface FilteredClient {
    controller: ReadableStreamDefaultController;
    agentId?: string;
    projectId?: string;
    events?: Set<string>;
  }
  const filteredSseClients = new Set<FilteredClient>();

  function broadcastEvent(event: { type: string; task_id?: string; action: string; agent_id?: string | null }) {
    const data = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
    // Broadcast to dashboard clients
    for (const controller of sseClients) {
      try { controller.enqueue(`data: ${data}\n\n`); }
      catch { sseClients.delete(controller); }
    }
    // Broadcast to filtered agent stream clients
    const eventName = `task.${event.action}`;
    for (const client of filteredSseClients) {
      if (client.events && !client.events.has(eventName) && !client.events.has("*")) continue;
      if (client.agentId && event.agent_id !== client.agentId) continue;
      try { client.controller.enqueue(`event: ${eventName}\ndata: ${data}\n\n`); }
      catch { filteredSseClients.delete(client); }
    }
  }

  const dashboardDir = resolveDashboardDir();
  const dashboardExists = existsSync(dashboardDir);

  if (!dashboardExists) {
    console.error(`\nDashboard not found at: ${dashboardDir}`);
    console.error(`Run this to build it:\n`);
    console.error(`  cd dashboard && bun install && bun run build\n`);
  }

  const hostname = options?.host || "127.0.0.1";
  const server = Bun.serve({
    port,
    hostname,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // ── CORS ──
      if (method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": `http://localhost:${port}`,
            "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // ── SSE Event Stream ──
      if (path === "/api/events" && method === "GET") {
        const stream = new ReadableStream({
          start(controller) {
            sseClients.add(controller);
            controller.enqueue(`data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`);
          },
          cancel(controller) {
            sseClients.delete(controller);
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": `http://localhost:${port}`,
          },
        });
      }

      // ── SSE Agent Task Stream ──
      if (path === "/api/tasks/stream" && method === "GET") {
        const agentId = url.searchParams.get("agent_id") || undefined;
        const projectId = url.searchParams.get("project_id") || undefined;
        const eventsParam = url.searchParams.get("events");
        const eventFilter = eventsParam ? new Set(eventsParam.split(",").map(e => e.trim())) : undefined;
        const client: FilteredClient = { controller: null as any, agentId, projectId, events: eventFilter };
        const stream = new ReadableStream({
          start(controller) {
            client.controller = controller;
            filteredSseClients.add(client);
            controller.enqueue(`: connected\n\ndata: ${JSON.stringify({ type: "connected", agent_id: agentId, timestamp: new Date().toISOString() })}\n\n`);
          },
          cancel() { filteredSseClients.delete(client); },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // ── API: Health ──
      if (path === "/api/health" && method === "GET") {
        const all = listTasks({ limit: 10000 });
        const stale = all.filter(t => t.status === "in_progress" && new Date(t.updated_at).getTime() < Date.now() - 30 * 60 * 1000);
        const overdue = all.filter(t => t.recurrence_rule && t.status === "pending" && t.due_at && t.due_at < new Date().toISOString());
        return json({ status: stale.length === 0 && overdue.length === 0 ? "ok" : "warn", tasks: all.length, stale: stale.length, overdue_recurring: overdue.length, timestamp: new Date().toISOString() }, 200, port);
      }

      // ── API: Stats ──
      if (path === "/api/stats" && method === "GET") {
        const all = listTasks({ limit: 10000 });
        const projects = listProjects();
        const agents = listAgents();
        const { getStaleTasks: getStaleForStats } = await import("../db/tasks.js");
        const staleItems = getStaleForStats(30);
        const nowStr = new Date().toISOString();
        const overdueRecurring = all.filter(t => t.recurrence_rule && t.status === "pending" && t.due_at && t.due_at < nowStr).length;
        const recurringTasks = all.filter(t => t.recurrence_rule).length;
        return json({
          total_tasks: all.length,
          pending: all.filter((t) => t.status === "pending").length,
          in_progress: all.filter((t) => t.status === "in_progress").length,
          completed: all.filter((t) => t.status === "completed").length,
          failed: all.filter((t) => t.status === "failed").length,
          cancelled: all.filter((t) => t.status === "cancelled").length,
          projects: projects.length,
          agents: agents.length,
          stale_count: staleItems.length,
          overdue_recurring: overdueRecurring,
          recurring_tasks: recurringTasks,
        }, 200, port);
      }

      // ── API: List tasks ──
      if (path === "/api/tasks" && method === "GET") {
        const status = url.searchParams.get("status") || undefined;
        const projectId = url.searchParams.get("project_id") || undefined;
        const sessionId = url.searchParams.get("session_id") || undefined;
        const agentId = url.searchParams.get("agent_id") || undefined;
        const limitParam = url.searchParams.get("limit");
        const offsetParam = url.searchParams.get("offset");
        const fieldsParam = url.searchParams.get("fields");
        const fields = fieldsParam ? fieldsParam.split(",").map(f => f.trim()).filter(Boolean) : undefined;
        const tasks = listTasks({
          status: status as Task["status"] | undefined,
          project_id: projectId,
          session_id: sessionId,
          agent_id: agentId,
          limit: limitParam ? parseInt(limitParam, 10) : undefined,
          offset: offsetParam ? parseInt(offsetParam, 10) : undefined,
        });
        return json(tasks.map(t => taskToSummary(t, fields)), 200, port);
      }

      // ── API: Create task ──
      if (path === "/api/tasks" && method === "POST") {
        try {
          const body = await req.json() as { title: string; description?: string; priority?: string; project_id?: string };
          if (!body.title) return json({ error: "Missing 'title'" }, 400, port);
          const task = createTask({
            title: body.title,
            description: body.description,
            priority: body.priority as Task["priority"] | undefined,
            project_id: body.project_id,
          });
          broadcastEvent({ type: "task", task_id: task.id, action: "created", agent_id: task.agent_id });
          return json(taskToSummary(task), 201, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to create task" }, 500, port);
        }
      }

      // ── API: Export tasks ──
      if (path === "/api/tasks/export" && method === "GET") {
        const format = url.searchParams.get("format") || "json";
        const status = url.searchParams.get("status") || undefined;
        const projectId = url.searchParams.get("project_id") || undefined;
        const tasks = listTasks({ status: status as any, project_id: projectId, limit: 10000 });
        const summaries = tasks.map(t => taskToSummary(t));

        if (format === "csv") {
          const headers = ["id","short_id","title","status","priority","project_id","assigned_to","agent_id","created_at","updated_at","completed_at","due_at"];
          const rows = summaries.map(t => headers.map(h => {
            const val = (t as any)[h];
            if (val === null || val === undefined) return "";
            const str = String(val);
            return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str.replace(/"/g, '""')}"` : str;
          }).join(","));
          const csv = [headers.join(","), ...rows].join("\n");
          return new Response(csv, {
            headers: {
              "Content-Type": "text/csv",
              "Content-Disposition": "attachment; filename=tasks.csv",
              ...SECURITY_HEADERS,
            },
          });
        }

        return new Response(JSON.stringify(summaries, null, 2), {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": "attachment; filename=tasks.json",
            ...SECURITY_HEADERS,
          },
        });
      }

      // ── API: Bulk operations ──
      if (path === "/api/tasks/bulk" && method === "POST") {
        try {
          const body = await req.json() as { ids: string[]; action: "complete" | "start" | "delete" };
          if (!body.ids?.length || !body.action) return json({ error: "Missing ids or action" }, 400, port);
          const results: { id: string; success: boolean; error?: string }[] = [];
          for (const id of body.ids) {
            try {
              if (body.action === "delete") {
                deleteTask(id);
                results.push({ id, success: true });
              } else if (body.action === "start") {
                startTask(id, "dashboard");
                results.push({ id, success: true });
              } else if (body.action === "complete") {
                completeTask(id, "dashboard");
                results.push({ id, success: true });
              }
            } catch (e) {
              results.push({ id, success: false, error: e instanceof Error ? e.message : "Failed" });
            }
          }
          return json({ results, succeeded: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      // ── API: Task status summary ──
      if (path === "/api/tasks/status" && method === "GET") {
        try {
          const projectId = url.searchParams.get("project_id") || undefined;
          const agentId = url.searchParams.get("agent_id") || undefined;
          const { getStatus } = await import("../db/tasks.js");
          const status = getStatus(projectId ? { project_id: projectId } : undefined, agentId);
          return json(status, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      // ── API: Next task ──
      if (path === "/api/tasks/next" && method === "GET") {
        try {
          const projectId = url.searchParams.get("project_id") || undefined;
          const agentId = url.searchParams.get("agent_id") || undefined;
          const { getNextTask } = await import("../db/tasks.js");
          const task = getNextTask(agentId, projectId ? { project_id: projectId } : undefined);
          return json({ task: task ? taskToSummary(task) : null }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      // ── API: Active work ──
      if (path === "/api/tasks/active" && method === "GET") {
        try {
          const projectId = url.searchParams.get("project_id") || undefined;
          const { getActiveWork } = await import("../db/tasks.js");
          const work = getActiveWork(projectId ? { project_id: projectId } : undefined);
          return json({ active: work, count: work.length }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      // ── API: Stale tasks ──
      if (path === "/api/tasks/stale" && method === "GET") {
        try {
          const projectId = url.searchParams.get("project_id") || undefined;
          const minutes = parseInt(url.searchParams.get("minutes") || "30", 10);
          const { getStaleTasks } = await import("../db/tasks.js");
          const tasks = getStaleTasks(minutes, projectId ? { project_id: projectId } : undefined);
          return json({ tasks: tasks.map(t => taskToSummary(t)), count: tasks.length }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      // ── API: Changed tasks ──
      if (path === "/api/tasks/changed" && method === "GET") {
        try {
          const since = url.searchParams.get("since");
          if (!since) return json({ error: "since parameter required (ISO date string)" }, 400, port);
          const projectId = url.searchParams.get("project_id") || undefined;
          const { getTasksChangedSince } = await import("../db/tasks.js");
          const tasks = getTasksChangedSince(since, projectId ? { project_id: projectId } : undefined);
          return json({ tasks: tasks.map(t => taskToSummary(t)), count: tasks.length, since }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      // ── API: Task Context (for agent prompt injection) ──
      if (path === "/api/tasks/context" && method === "GET") {
        const agentId = url.searchParams.get("agent_id") || undefined;
        const projectId = url.searchParams.get("project_id") || undefined;
        const format = url.searchParams.get("format") || "text"; // text | compact | json
        const { getStatus, getNextTask } = await import("../db/tasks.js");
        const filters = projectId ? { project_id: projectId } : undefined;
        const status = getStatus(filters, agentId);
        const next = getNextTask(agentId, filters);
        if (format === "json") {
          return json({ status, next_task: next ? taskToSummary(next) : null }, 200, port);
        }
        // Text format for prompt injection
        const lines = [];
        lines.push(`Tasks: ${status.pending} pending | ${status.in_progress} active | ${status.completed} done`);
        if (status.stale_count > 0) lines.push(`⚠ ${status.stale_count} stale tasks stuck in-progress`);
        if (status.overdue_recurring > 0) lines.push(`🔁 ${status.overdue_recurring} overdue recurring tasks`);
        if (status.active_work.length > 0) {
          lines.push(`Active: ${status.active_work.slice(0, 3).map(w => `${w.short_id || w.id.slice(0, 8)} (${w.assigned_to || '?'})`).join(", ")}`);
        }
        if (next) lines.push(`Next up: ${next.short_id || next.id.slice(0, 8)} [${next.priority}] ${next.title}`);
        const text = lines.join("\n");
        return new Response(text, { headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" } });
      }

      // ── API: Task attachments ──
      const attachmentsMatch = path.match(/^\/api\/tasks\/([^/]+)\/attachments$/);
      if (attachmentsMatch && method === "GET") {
        const id = attachmentsMatch[1]!;
        const task = getTask(id);
        if (!task) return json({ error: "Task not found" }, 404, port);
        const evidence = (task.metadata as any)?._evidence || {};
        const attachmentIds: string[] = evidence.attachments || [];
        return json({ task_id: id, short_id: task.short_id, attachment_ids: attachmentIds, count: attachmentIds.length, files_changed: evidence.files_changed, commit_hash: evidence.commit_hash, notes: evidence.notes }, 200, port);
      }

      // ── API: Single task operations ──
      // /api/tasks/:id/progress — GET (read) and POST (log)
      const progressMatch = path.match(/^\/api\/tasks\/([^/]+)\/progress$/);
      if (progressMatch) {
        const id = progressMatch[1]!;
        const task = getTask(id);
        if (!task) return json({ error: "Task not found" }, 404, port);
        if (method === "GET") {
          const { listComments } = await import("../db/comments.js");
          const all = listComments(id);
          const progress = all.filter((c: any) => c.type === "progress");
          const latest = progress[progress.length - 1] || null;
          return json({ task_id: id, progress_entries: progress, latest, count: progress.length }, 200, port);
        }
        if (method === "POST") {
          try {
            const body = await req.json() as { message: string; pct_complete?: number; agent_id?: string };
            if (!body.message) return json({ error: "message required" }, 400, port);
            const { logProgress } = await import("../db/comments.js");
            const comment = logProgress(id, body.message, body.pct_complete, body.agent_id);
            return json(comment, 201, port);
          } catch (e) {
            return json({ error: e instanceof Error ? e.message : "Failed to log progress" }, 500, port);
          }
        }
      }

      const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskMatch) {
        const id = taskMatch[1]!;

        // GET /api/tasks/:id
        if (method === "GET") {
          const task = getTask(id);
          if (!task) return json({ error: "Task not found" }, 404, port);
          return json(taskToSummary(task), 200, port);
        }

        // PATCH /api/tasks/:id
        if (method === "PATCH") {
          try {
            const body = await req.json() as Record<string, unknown>;
            const task = getTask(id);
            if (!task) return json({ error: "Task not found" }, 404, port);
            const updated = updateTask(id, {
              ...body,
              version: task.version,
            } as Parameters<typeof updateTask>[1]);
            return json(taskToSummary(updated), 200, port);
          } catch (e) {
            return json({ error: e instanceof Error ? e.message : "Failed to update task" }, 500, port);
          }
        }

        // DELETE /api/tasks/:id
        if (method === "DELETE") {
          const deleted = deleteTask(id);
          if (!deleted) return json({ error: "Task not found" }, 404, port);
          return json({ success: true }, 200, port);
        }
      }

      // ── API: Start task ──
      const startMatch = path.match(/^\/api\/tasks\/([^/]+)\/start$/);
      if (startMatch && method === "POST") {
        const id = startMatch[1]!;
        try {
          const task = startTask(id, "dashboard");
          broadcastEvent({ type: "task", task_id: task.id, action: "started", agent_id: "dashboard" });
          return json(taskToSummary(task), 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to start task" }, 500, port);
        }
      }

      // ── API: Fail task ──
      const failMatch = path.match(/^\/api\/tasks\/([^/]+)\/fail$/);
      if (failMatch && method === "POST") {
        const id = failMatch[1]!;
        try {
          const body = await req.json().catch(() => ({})) as { reason?: string; agent_id?: string; retry?: boolean; error_code?: string };
          const { failTask } = await import("../db/tasks.js");
          const result = failTask(id, body.agent_id, body.reason, { retry: body.retry, error_code: body.error_code });
          broadcastEvent({ type: "task", task_id: id, action: "failed", agent_id: body.agent_id || null });
          return json({ task: taskToSummary(result.task), retry_task: result.retryTask ? taskToSummary(result.retryTask) : null }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to fail task" }, 500, port);
        }
      }

      // ── API: Complete task ──
      const completeMatch = path.match(/^\/api\/tasks\/([^/]+)\/complete$/);
      if (completeMatch && method === "POST") {
        const id = completeMatch[1]!;
        try {
          const task = completeTask(id, "dashboard");
          broadcastEvent({ type: "task", task_id: task.id, action: "completed", agent_id: "dashboard" });
          return json(taskToSummary(task), 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to complete task" }, 500, port);
        }
      }

      // ── API: Projects ──
      if (path === "/api/projects" && method === "GET") {
        const pFieldsParam = url.searchParams.get("fields");
        const pFields = pFieldsParam ? pFieldsParam.split(",").map(f => f.trim()).filter(Boolean) : undefined;
        const projects = listProjects();
        return json(pFields ? projects.map(p => Object.fromEntries(pFields.map(f => [f, (p as any)[f] ?? null]))) : projects, 200, port);
      }

      // ── API: Agent discovery ──
      if (path === "/api/agents/me" && method === "GET") {
        const name = url.searchParams.get("name");
        if (!name) return json({ error: "Missing name param" }, 400, port);
        const { registerAgent } = await import("../db/agents.js");
        const agent = registerAgent({ name });
        const tasks = listTasks({ assigned_to: name });
        const agentIdTasks = listTasks({ agent_id: agent.id });
        const allTasks = [...tasks, ...agentIdTasks.filter(t => !tasks.some(tt => tt.id === t.id))];
        const pending = allTasks.filter(t => t.status === "pending");
        const inProgress = allTasks.filter(t => t.status === "in_progress");
        const completed = allTasks.filter(t => t.status === "completed");
        return json({
          agent,
          pending_tasks: pending.map(t => taskToSummary(t)),
          in_progress_tasks: inProgress.map(t => taskToSummary(t)),
          stats: {
            total: allTasks.length,
            pending: pending.length,
            in_progress: inProgress.length,
            completed: completed.length,
            completion_rate: allTasks.length > 0 ? Math.round((completed.length / allTasks.length) * 100) : 0,
          },
        }, 200, port);
      }

      // ── API: Agent task queue ──
      const queueMatch = path.match(/^\/api\/agents\/([^/]+)\/queue$/);
      if (queueMatch && method === "GET") {
        const agentId = decodeURIComponent(queueMatch[1]!);
        const pending = listTasks({ status: "pending" as any });
        // Tasks assigned to this agent or unassigned
        const queue = pending.filter(t =>
          t.assigned_to === agentId || t.agent_id === agentId || (!t.assigned_to && !t.locked_by)
        );
        // Sort: critical > high > medium > low, then by created_at
        const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        queue.sort((a, b) => (order[a.priority] ?? 4) - (order[b.priority] ?? 4) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        return json(queue.map(t => taskToSummary(t)), 200, port);
      }

      // ── API: Claim next task ──
      if (path === "/api/tasks/claim" && method === "POST") {
        try {
          const body = await req.json() as { agent_id?: string; project_id?: string };
          const agentId = body.agent_id || "anonymous";
          const { claimNextTask } = await import("../db/tasks.js");
          const task = claimNextTask(agentId, body.project_id ? { project_id: body.project_id } : undefined);
          return json({ task: task ? taskToSummary(task) : null }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to claim" }, 500, port);
        }
      }

      // ── API: Orgs ──
      if (path === "/api/orgs" && method === "GET") {
        const { listOrgs } = await import("../db/orgs.js");
        return json(listOrgs(), 200, port);
      }
      if (path === "/api/orgs" && method === "POST") {
        try {
          const body = await req.json() as { name: string; description?: string };
          if (!body.name) return json({ error: "Missing name" }, 400, port);
          const { createOrg } = await import("../db/orgs.js");
          return json(createOrg(body), 201, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }
      const orgMatch = path.match(/^\/api\/orgs\/([^/]+)$/);
      if (orgMatch && method === "PATCH") {
        try {
          const body = await req.json() as Record<string, unknown>;
          const { updateOrg } = await import("../db/orgs.js");
          return json(updateOrg(orgMatch[1]!, body as any), 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }
      if (orgMatch && method === "DELETE") {
        const { deleteOrg } = await import("../db/orgs.js");
        const deleted = deleteOrg(orgMatch[1]!);
        return json(deleted ? { success: true } : { error: "Not found" }, deleted ? 200 : 404, port);
      }

      // ── API: Org chart ──
      if (path === "/api/org" && method === "GET") {
        const { getOrgChart } = await import("../db/agents.js");
        return json(getOrgChart(), 200, port);
      }

      // ── API: Agent team (direct reports) ──
      const teamMatch = path.match(/^\/api\/agents\/([^/]+)\/team$/);
      if (teamMatch && method === "GET") {
        const agentId = decodeURIComponent(teamMatch[1]!);
        const { getDirectReports } = await import("../db/agents.js");
        return json(getDirectReports(agentId), 200, port);
      }

      // ── API: Agents ──
      if (path === "/api/agents" && method === "GET") {
        const aFieldsParam = url.searchParams.get("fields");
        const aFields = aFieldsParam ? aFieldsParam.split(",").map(f => f.trim()).filter(Boolean) : undefined;
        const agents = listAgents();
        return json(aFields ? agents.map(a => Object.fromEntries(aFields.map(f => [f, (a as any)[f] ?? null]))) : agents, 200, port);
      }

      // ── API: Create project ──
      if (path === "/api/projects" && method === "POST") {
        try {
          const body = await req.json() as { name: string; path: string; description?: string };
          if (!body.name || !body.path) return json({ error: "Missing name or path" }, 400, port);
          const { createProject } = await import("../db/projects.js");
          const project = createProject({ name: body.name, path: body.path, description: body.description });
          return json(project, 201, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to create project" }, 500, port);
        }
      }

      // ── API: Delete project ──
      const projectDeleteMatch = path.match(/^\/api\/projects\/([^/]+)$/);
      if (projectDeleteMatch && method === "DELETE") {
        const id = projectDeleteMatch[1]!;
        const { deleteProject } = await import("../db/projects.js");
        const deleted = deleteProject(id);
        if (!deleted) return json({ error: "Project not found" }, 404, port);
        return json({ success: true }, 200, port);
      }

      // ── API: Register agent ──
      if (path === "/api/agents" && method === "POST") {
        try {
          const body = await req.json() as { name: string; description?: string };
          if (!body.name) return json({ error: "Missing name" }, 400, port);
          const { registerAgent } = await import("../db/agents.js");
          const agent = registerAgent({ name: body.name, description: body.description });
          return json(agent, 201, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to register agent" }, 500, port);
        }
      }

      // ── API: Update/Delete agent ──
      const agentMatch = path.match(/^\/api\/agents\/([^/]+)$/);
      if (agentMatch && method === "PATCH") {
        const id = agentMatch[1]!;
        try {
          const body = await req.json() as { name?: string; description?: string; role?: string };
          const { updateAgent } = await import("../db/agents.js");
          const agent = updateAgent(id, body);
          return json(agent, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to update agent" }, 500, port);
        }
      }
      if (agentMatch && method === "DELETE") {
        const id = agentMatch[1]!;
        const { deleteAgent } = await import("../db/agents.js");
        const deleted = deleteAgent(id);
        if (!deleted) return json({ error: "Agent not found" }, 404, port);
        return json({ success: true }, 200, port);
      }

      // ── API: Bulk delete agents ──
      if (path === "/api/agents/bulk" && method === "POST") {
        try {
          const body = await req.json() as { ids: string[]; action: "delete" };
          if (!body.ids?.length || body.action !== "delete") return json({ error: "Missing ids or invalid action" }, 400, port);
          const { deleteAgent } = await import("../db/agents.js");
          let succeeded = 0;
          for (const id of body.ids) { if (deleteAgent(id)) succeeded++; }
          return json({ succeeded, failed: body.ids.length - succeeded }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      // ── API: Bulk delete projects ──
      if (path === "/api/projects/bulk" && method === "POST") {
        try {
          const body = await req.json() as { ids: string[]; action: "delete" };
          if (!body.ids?.length || body.action !== "delete") return json({ error: "Missing ids or invalid action" }, 400, port);
          const { deleteProject } = await import("../db/projects.js");
          let succeeded = 0;
          for (const id of body.ids) { if (deleteProject(id)) succeeded++; }
          return json({ succeeded, failed: body.ids.length - succeeded }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      // ── API: Activity feed (audit log) ──
      // ── API: Doctor ──
      if (path === "/api/doctor" && method === "GET") {
        const issues: { severity: string; type: string; message: string; count?: number }[] = [];
        const { getStaleTasks: getStaleDiag } = await import("../db/tasks.js");
        const staleItems = getStaleDiag(30);
        if (staleItems.length > 0) issues.push({ severity: "warn", type: "stale_tasks", message: `${staleItems.length} tasks stuck in_progress >30min`, count: staleItems.length });
        // Check orphaned parents
        const withParent = getDatabase().query("SELECT COUNT(*) as c FROM tasks t WHERE t.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks p WHERE p.id = t.parent_id)").get() as { c: number };
        if (withParent.c > 0) issues.push({ severity: "error", type: "orphaned_parents", message: `${withParent.c} tasks reference non-existent parent IDs`, count: withParent.c });
        if (issues.length === 0) issues.push({ severity: "info", type: "healthy", message: "No issues found" });
        return json({ ok: !issues.some(i => i.severity === "error"), issues }, 200, port);
      }

      // ── API: Report ──
      if (path === "/api/report" && method === "GET") {
        const days = parseInt(url.searchParams.get("days") || "7", 10);
        const projectId = url.searchParams.get("project_id") || undefined;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const { getTasksChangedSince, getTaskStats } = await import("../db/tasks.js");
        const filters = projectId ? { project_id: projectId } : undefined;
        const changed = getTasksChangedSince(since, filters);
        const all = listTasks(filters || {});
        const stats = getTaskStats(filters);
        const completed = changed.filter((t: any) => t.status === "completed");
        const failed = changed.filter((t: any) => t.status === "failed");
        const byDay: Record<string, number> = {};
        for (const t of changed) { const day = t.updated_at.slice(0, 10); byDay[day] = (byDay[day] || 0) + 1; }
        const completionRate = changed.length > 0 ? Math.round((completed.length / changed.length) * 100) : 0;
        return json({ days, period_since: since, total: all.length, stats, changed: changed.length, completed: completed.length, failed: failed.length, completion_rate: completionRate, by_day: byDay }, 200, port);
      }

      if (path === "/api/activity" && method === "GET") {
        const limit = parseInt(url.searchParams.get("limit") || "50", 10);
        const { getRecentActivity } = await import("../db/audit.js");
        return json(getRecentActivity(limit), 200, port);
      }

      // ── API: Task history ──
      const historyMatch = path.match(/^\/api\/tasks\/([^/]+)\/history$/);
      if (historyMatch && method === "GET") {
        const id = historyMatch[1]!;
        const { getTaskHistory } = await import("../db/audit.js");
        return json(getTaskHistory(id), 200, port);
      }

      // ── API: Webhooks ──
      if (path === "/api/webhooks" && method === "GET") {
        const { listWebhooks } = await import("../db/webhooks.js");
        return json(listWebhooks(), 200, port);
      }
      if (path === "/api/webhooks" && method === "POST") {
        try {
          const body = await req.json() as { url: string; events?: string[]; secret?: string };
          if (!body.url) return json({ error: "Missing url" }, 400, port);
          const { createWebhook } = await import("../db/webhooks.js");
          return json(createWebhook(body), 201, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }
      const webhookMatch = path.match(/^\/api\/webhooks\/([^/]+)$/);
      if (webhookMatch && method === "DELETE") {
        const { deleteWebhook } = await import("../db/webhooks.js");
        const deleted = deleteWebhook(webhookMatch[1]!);
        return json(deleted ? { success: true } : { error: "Not found" }, deleted ? 200 : 404, port);
      }

      // ── API: Templates ──
      if (path === "/api/templates" && method === "GET") {
        const { listTemplates } = await import("../db/templates.js");
        return json(listTemplates(), 200, port);
      }
      if (path === "/api/templates" && method === "POST") {
        try {
          const body = await req.json() as { name: string; title_pattern: string; description?: string; priority?: string; tags?: string[] };
          if (!body.name || !body.title_pattern) return json({ error: "Missing name or title_pattern" }, 400, port);
          const { createTemplate } = await import("../db/templates.js");
          return json(createTemplate(body as any), 201, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }
      const templateMatch = path.match(/^\/api\/templates\/([^/]+)$/);
      if (templateMatch && method === "DELETE") {
        const { deleteTemplate } = await import("../db/templates.js");
        const deleted = deleteTemplate(templateMatch[1]!);
        return json(deleted ? { success: true } : { error: "Not found" }, deleted ? 200 : 404, port);
      }

      // ── API: List plans ──
      if (path === "/api/plans" && method === "GET") {
        const projectId = url.searchParams.get("project_id") || undefined;
        const plans = listPlans(projectId);
        return json(plans, 200, port);
      }

      // ── API: Create plan ──
      if (path === "/api/plans" && method === "POST") {
        try {
          const body = await req.json() as { name: string; description?: string; project_id?: string; task_list_id?: string; agent_id?: string; status?: string };
          if (!body.name) return json({ error: "Missing 'name'" }, 400, port);
          const plan = createPlan({
            name: body.name,
            description: body.description,
            project_id: body.project_id,
            task_list_id: body.task_list_id,
            agent_id: body.agent_id,
            status: body.status as any,
          });
          return json(plan, 201, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to create plan" }, 500, port);
        }
      }

      // ── API: Bulk delete plans ──
      if (path === "/api/plans/bulk" && method === "POST") {
        try {
          const body = await req.json() as { ids: string[]; action: "delete" };
          if (!body.ids?.length || body.action !== "delete") return json({ error: "Missing ids or invalid action" }, 400, port);
          let succeeded = 0;
          for (const id of body.ids) { if (deletePlan(id)) succeeded++; }
          return json({ succeeded, failed: body.ids.length - succeeded }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      // ── API: Single plan operations ──
      const planMatch = path.match(/^\/api\/plans\/([^/]+)$/);
      if (planMatch) {
        const id = planMatch[1]!;

        if (method === "GET") {
          const plan = getPlan(id);
          if (!plan) return json({ error: "Plan not found" }, 404, port);
          const tasks = listTasks({ plan_id: id });
          return json({ ...plan, tasks: tasks.map(t => taskToSummary(t)) }, 200, port);
        }

        if (method === "PATCH") {
          try {
            const body = await req.json() as Record<string, unknown>;
            const plan = updatePlan(id, body as any);
            return json(plan, 200, port);
          } catch (e) {
            return json({ error: e instanceof Error ? e.message : "Failed to update plan" }, 500, port);
          }
        }

        if (method === "DELETE") {
          const deleted = deletePlan(id);
          if (!deleted) return json({ error: "Plan not found" }, 404, port);
          return json({ success: true }, 200, port);
        }
      }

      // ── Static Files (Vite dashboard) ──
      if (dashboardExists && (method === "GET" || method === "HEAD")) {
        if (path !== "/") {
          // Prevent path traversal: resolved path must stay within dashboardDir
          const filePath = join(dashboardDir, path);
          const resolvedFile = resolve(filePath);
          const resolvedBase = resolve(dashboardDir);
          if (!resolvedFile.startsWith(resolvedBase + sep) && resolvedFile !== resolvedBase) {
            return json({ error: "Forbidden" }, 403, port);
          }
          const res = serveStaticFile(filePath);
          if (res) return res;
        }

        // SPA fallback
        const indexPath = join(dashboardDir, "index.html");
        const res = serveStaticFile(indexPath);
        if (res) return res;
      }

      return json({ error: "Not found" }, 404, port);
    },
  });

  // Graceful shutdown
  const shutdown = () => {
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const serverUrl = `http://localhost:${port}`;
  console.log(`Todos Dashboard running at ${serverUrl}`);

  if (shouldOpen) {
    try {
      const { exec } = await import("child_process");
      const openCmd = process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
      exec(`${openCmd} ${serverUrl}`);
    } catch {
      // Silently ignore if we can't open browser
    }
  }
}
