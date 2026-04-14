/**
 * HTTP route handlers for the Todos dashboard API.
 * All route logic is here — utility functions remain in serve.ts.
 */

import {
  createTask,
  getTask,
  listTasks,
  updateTask,
  deleteTask,
  startTask,
  completeTask,
  getStaleTasks,
  getStatus,
  getNextTask,
  getActiveWork,
  getTasksChangedSince,
  getTaskStats,
  failTask,
  claimNextTask,
} from "../db/tasks.js";
import { listProjects, createProject, deleteProject } from "../db/projects.js";
import { listAgents, registerAgent, isAgentConflict, getOrgChart, getDirectReports, updateAgent, deleteAgent } from "../db/agents.js";
import { createPlan, getPlan, listPlans, updatePlan, deletePlan } from "../db/plans.js";
import { getDatabase } from "../db/database.js";
import { listOrgs, createOrg, updateOrg, deleteOrg } from "../db/orgs.js";
import { getRecentActivity, getTaskHistory } from "../db/audit.js";
import { listWebhooks, createWebhook, deleteWebhook } from "../db/webhooks.js";
import { listTemplates, createTemplate, deleteTemplate } from "../db/templates.js";
import { listComments, logProgress } from "../db/comments.js";
import type { Task } from "../types/index.js";
import { join, resolve, sep } from "path";

// Re-export utilities from serve.ts
export {
  json,
  taskToSummary,
  SECURITY_HEADERS,
  MIME_TYPES,
  serveStaticFile,
} from "./serve.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FilteredClient {
  controller: ReadableStreamDefaultController;
  agentId?: string;
  projectId?: string;
  events?: Set<string>;
}

export interface RouteContext {
  port: number;
  sseClients: Set<ReadableStreamDefaultController>;
  filteredSseClients: Set<FilteredClient>;
  broadcastEvent: (event: { type: string; task_id?: string; action: string; agent_id?: string | null; project_id?: string | null }) => void;
  dashboardExists: boolean;
  dashboardDir: string;
  apiKey: string | null;
}

// ── Route Handlers ──────────────────────────────────────────────────────────

export function handleSseEvents(_req: Request, url: URL, ctx: RouteContext): Response | null {
  const agentId = url.searchParams.get("agent_id") || undefined;
  const projectId = url.searchParams.get("project_id") || undefined;
  if (agentId || projectId) {
    const client: FilteredClient = { controller: null as any, agentId, projectId, events: undefined };
    const stream = new ReadableStream({
      start(controller) {
        client.controller = controller;
        ctx.filteredSseClients.add(client);
        controller.enqueue(`data: ${JSON.stringify({ type: "connected", agent_id: agentId, project_id: projectId, timestamp: new Date().toISOString() })}\n\n`);
      },
      cancel() { ctx.filteredSseClients.delete(client); },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": `http://localhost:${ctx.port}`,
        "Vary": "Origin",
      },
    });
  }
  // Unfiltered dashboard SSE
  const stream = new ReadableStream({
    start(controller) {
      ctx.sseClients.add(controller);
      controller.enqueue(`data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`);
    },
    cancel(controller) {
      ctx.sseClients.delete(controller);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": `http://localhost:${ctx.port}`,
    },
  });
}

export function handleTasksStream(_req: Request, url: URL, ctx: RouteContext): Response | null {
  const agentId = url.searchParams.get("agent_id") || undefined;
  const projectId = url.searchParams.get("project_id") || undefined;
  const eventsParam = url.searchParams.get("events");
  const eventFilter = eventsParam ? new Set(eventsParam.split(",").map(e => e.trim())) : undefined;
  const client: FilteredClient = { controller: null as any, agentId, projectId, events: eventFilter };
  const stream = new ReadableStream({
    start(controller) {
      client.controller = controller;
      ctx.filteredSseClients.add(client);
      controller.enqueue(`: connected\n\ndata: ${JSON.stringify({ type: "connected", agent_id: agentId, timestamp: new Date().toISOString() })}\n\n`);
    },
    cancel() { ctx.filteredSseClients.delete(client); },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": `http://localhost:${ctx.port}`,
      "Vary": "Origin",
    },
  });
}

export function handleHealth(_ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  const all = listTasks({ limit: 10000 });
  const stale = all.filter(t => t.status === "in_progress" && new Date(t.updated_at).getTime() < Date.now() - 30 * 60 * 1000);
  const overdue = all.filter(t => t.recurrence_rule && t.status === "pending" && t.due_at && t.due_at < new Date().toISOString());
  return json({ status: stale.length === 0 && overdue.length === 0 ? "ok" : "warn", tasks: all.length, stale: stale.length, overdue_recurring: overdue.length, timestamp: new Date().toISOString() });
}

export function handleStats(_ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  const all = listTasks({ limit: 10000 });
  const projects = listProjects();
  const agents = listAgents();
  const staleItems = getStaleTasks(30);
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
  });
}

export async function handleListTasks(_req: Request, url: URL, _ctx: RouteContext, json: (data: unknown, status?: number) => Response, taskToSummary: (task: Task, fields?: string[]) => unknown): Promise<Response> {
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
  return json(tasks.map(t => taskToSummary(t, fields)));
}

export async function handleCreateTask(req: Request, ctx: RouteContext, json: (data: unknown, status?: number) => Response, taskToSummary: (task: Task, fields?: string[]) => unknown): Promise<Response> {
  try {
    const body = await req.json() as { title: string; description?: string; priority?: string; project_id?: string };
    if (!body.title) return json({ error: "Missing 'title'" }, 400);
    const task = createTask({
      title: body.title,
      description: body.description,
      priority: body.priority as Task["priority"] | undefined,
      project_id: body.project_id,
    });
    ctx.broadcastEvent({ type: "task", task_id: task.id, action: "created", agent_id: task.agent_id, project_id: task.project_id });
    return json(taskToSummary(task), 201);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed to create task" }, 500);
  }
}

export function handleTasksExport(_req: Request, url: URL, _ctx: RouteContext, _json: (data: unknown, status?: number) => Response, taskToSummary: (task: Task, fields?: string[]) => unknown): Response {
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
      },
    });
  }

  return new Response(JSON.stringify(summaries, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": "attachment; filename=tasks.json",
    },
  });
}

export async function handleTasksBulk(req: Request, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Promise<Response> {
  try {
    const body = await req.json() as { ids: string[]; action: "complete" | "start" | "delete" };
    if (!body.ids?.length || !body.action) return json({ error: "Missing ids or action" }, 400);
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
    return json({ results, succeeded: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed" }, 500);
  }
}

export function handleTasksStatus(_req: Request, url: URL, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  try {
    const projectId = url.searchParams.get("project_id") || undefined;
    const agentId = url.searchParams.get("agent_id") || undefined;
    const status = getStatus(projectId ? { project_id: projectId } : undefined, agentId);
    return json(status);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed" }, 500);
  }
}

export function handleTasksNext(_req: Request, url: URL, _ctx: RouteContext, json: (data: unknown, status?: number) => Response, taskToSummary: (task: Task, fields?: string[]) => unknown): Response {
  try {
    const projectId = url.searchParams.get("project_id") || undefined;
    const agentId = url.searchParams.get("agent_id") || undefined;
    const task = getNextTask(agentId, projectId ? { project_id: projectId } : undefined);
    return json({ task: task ? taskToSummary(task) : null });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed" }, 500);
  }
}

export function handleTasksActive(_req: Request, url: URL, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  try {
    const projectId = url.searchParams.get("project_id") || undefined;
    const work = getActiveWork(projectId ? { project_id: projectId } : undefined);
    return json({ active: work, count: work.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed" }, 500);
  }
}

export function handleTasksStale(_req: Request, url: URL, _ctx: RouteContext, json: (data: unknown, status?: number) => Response, taskToSummary: (task: Task, fields?: string[]) => unknown): Response {
  try {
    const projectId = url.searchParams.get("project_id") || undefined;
    const minutes = parseInt(url.searchParams.get("minutes") || "30", 10);
    const tasks = getStaleTasks(minutes, projectId ? { project_id: projectId } : undefined);
    return json({ tasks: tasks.map(t => taskToSummary(t)), count: tasks.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed" }, 500);
  }
}

export function handleTasksChanged(_req: Request, url: URL, _ctx: RouteContext, json: (data: unknown, status?: number) => Response, taskToSummary: (task: Task, fields?: string[]) => unknown): Response {
  try {
    const since = url.searchParams.get("since");
    if (!since) return json({ error: "since parameter required (ISO date string)" }, 400);
    const projectId = url.searchParams.get("project_id") || undefined;
    const tasks = getTasksChangedSince(since, projectId ? { project_id: projectId } : undefined);
    return json({ tasks: tasks.map(t => taskToSummary(t)), count: tasks.length, since });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed" }, 500);
  }
}

export function handleTasksContext(_req: Request, url: URL, _ctx: RouteContext, json: (data: unknown, status?: number) => Response, taskToSummary: (task: Task, fields?: string[]) => unknown): Response {
  const agentId = url.searchParams.get("agent_id") || undefined;
  const projectId = url.searchParams.get("project_id") || undefined;
  const format = url.searchParams.get("format") || "text";
  const filters = projectId ? { project_id: projectId } : undefined;
  const status = getStatus(filters, agentId);
  const next = getNextTask(agentId, filters);
  if (format === "json") {
    return json({ status, next_task: next ? taskToSummary(next) : null });
  }
  const lines: string[] = [];
  lines.push(`Tasks: ${status.pending} pending | ${status.in_progress} active | ${status.completed} done`);
  if (status.stale_count > 0) lines.push(`${status.stale_count} stale tasks stuck in-progress`);
  if (status.overdue_recurring > 0) lines.push(`${status.overdue_recurring} overdue recurring tasks`);
  if (status.active_work.length > 0) {
    lines.push(`Active: ${status.active_work.slice(0, 3).map(w => `${w.short_id || w.id.slice(0, 8)} (${w.assigned_to || '?'})`).join(", ")}`);
  }
  if (next) lines.push(`Next up: ${next.short_id || next.id.slice(0, 8)} [${next.priority}] ${next.title}`);
  const text = lines.join("\n");
  return new Response(text, { headers: { "Content-Type": "text/plain" } });
}

export function handleTaskAttachments(id: string, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  const task = getTask(id);
  if (!task) return json({ error: "Task not found" }, 404);
  const evidence = (task.metadata as any)?._evidence || {};
  const attachmentIds: string[] = evidence.attachments || [];
  return json({ task_id: id, short_id: task.short_id, attachment_ids: attachmentIds, count: attachmentIds.length, files_changed: evidence.files_changed, commit_hash: evidence.commit_hash, notes: evidence.notes });
}

export async function handleTaskProgress(id: string, req: Request, method: string, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Promise<Response | null> {
  const task = getTask(id);
  if (!task) return json({ error: "Task not found" }, 404);
  if (method === "GET") {
    const all = listComments(id);
    const progress = all.filter((c: any) => c.type === "progress");
    const latest = progress[progress.length - 1] || null;
    return json({ task_id: id, progress_entries: progress, latest, count: progress.length });
  }
  if (method === "POST") {
    try {
      const body = await req.json() as { message: string; pct_complete?: number; agent_id?: string };
      if (!body.message) return json({ error: "message required" }, 400);
      const comment = logProgress(id, body.message, body.pct_complete, body.agent_id);
      return json(comment, 201);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Failed to log progress" }, 500);
    }
  }
  return null;
}

export function handleGetTask(id: string, _ctx: RouteContext, json: (data: unknown, status?: number) => Response, taskToSummary: (task: Task, fields?: string[]) => unknown): Response {
  const task = getTask(id);
  if (!task) return json({ error: "Task not found" }, 404);
  return json(taskToSummary(task));
}

export async function handlePatchTask(id: string, req: Request, _ctx: RouteContext, json: (data: unknown, status?: number) => Response, taskToSummary: (task: Task, fields?: string[]) => unknown): Promise<Response> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const task = getTask(id);
    if (!task) return json({ error: "Task not found" }, 404);
    const ALLOWED = new Set(["title", "description", "status", "priority", "assigned_to", "plan_id", "task_list_id", "tags", "metadata", "due_at", "estimated_minutes", "task_type"]);
    const safeBody: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (ALLOWED.has(key)) safeBody[key] = value;
    }
    const updated = updateTask(id, {
      ...safeBody,
      version: task.version,
    } as Parameters<typeof updateTask>[1]);
    return json(taskToSummary(updated));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed to update task" }, 500);
  }
}

export function handleDeleteTask(id: string, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  const deleted = deleteTask(id);
  if (!deleted) return json({ error: "Task not found" }, 404);
  return json({ success: true });
}

export function handleStartTask(id: string, ctx: RouteContext, json: (data: unknown, status?: number) => Response, taskToSummary: (task: Task, fields?: string[]) => unknown): Response {
  try {
    const task = startTask(id, "dashboard");
    ctx.broadcastEvent({ type: "task", task_id: task.id, action: "started", agent_id: "dashboard", project_id: task.project_id });
    return json(taskToSummary(task));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed to start task" }, 500);
  }
}

export async function handleFailTask(id: string, req: Request, ctx: RouteContext, json: (data: unknown, status?: number) => Response, taskToSummary: (task: Task, fields?: string[]) => unknown): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({})) as { reason?: string; agent_id?: string; retry?: boolean; error_code?: string };
    const result = failTask(id, body.agent_id, body.reason, { retry: body.retry, error_code: body.error_code });
    ctx.broadcastEvent({ type: "task", task_id: id, action: "failed", agent_id: body.agent_id || null, project_id: result.task.project_id });
    return json({ task: taskToSummary(result.task), retry_task: result.retryTask ? taskToSummary(result.retryTask) : null });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed to fail task" }, 500);
  }
}

export function handleCompleteTask(id: string, ctx: RouteContext, json: (data: unknown, status?: number) => Response, taskToSummary: (task: Task, fields?: string[]) => unknown): Response {
  try {
    const task = completeTask(id, "dashboard");
    ctx.broadcastEvent({ type: "task", task_id: task.id, action: "completed", agent_id: "dashboard", project_id: task.project_id });
    return json(taskToSummary(task));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed to complete task" }, 500);
  }
}

export function handleListProjects(url: URL, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  const pFieldsParam = url.searchParams.get("fields");
  const pFields = pFieldsParam ? pFieldsParam.split(",").map(f => f.trim()).filter(Boolean) : undefined;
  const projects = listProjects();
  return json(pFields ? projects.map(p => Object.fromEntries(pFields.map(f => [f, (p as any)[f] ?? null]))) : projects);
}

export async function handleCreateProject(req: Request, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Promise<Response> {
  try {
    const body = await req.json() as { name: string; path: string; description?: string };
    if (!body.name || !body.path) return json({ error: "Missing name or path" }, 400);
    const project = createProject({ name: body.name, path: body.path, description: body.description });
    return json(project, 201);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed to create project" }, 500);
  }
}

export function handleDeleteProject(id: string, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  const deleted = deleteProject(id);
  if (!deleted) return json({ error: "Project not found" }, 404);
  return json({ success: true });
}

export async function handleAgentMe(_req: Request, url: URL, _ctx: RouteContext, json: (data: unknown, status?: number) => Response, taskToSummary: (task: Task, fields?: string[]) => unknown): Promise<Response> {
  const name = url.searchParams.get("name");
  if (!name) return json({ error: "Missing name param" }, 400);
  const agentResult = registerAgent({ name });
  if (isAgentConflict(agentResult)) return json({ error: agentResult.message, conflict: true }, 409);
  const agent = agentResult;
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
  });
}

export function handleAgentQueue(agentId: string, _ctx: RouteContext, json: (data: unknown, status?: number) => Response, taskToSummary: (task: Task, fields?: string[]) => unknown): Response {
  const pending = listTasks({ status: "pending" as any });
  const queue = pending.filter(t =>
    t.assigned_to === agentId || t.agent_id === agentId || (!t.assigned_to && !t.locked_by)
  );
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  queue.sort((a, b) => (order[a.priority] ?? 4) - (order[b.priority] ?? 4) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return json(queue.map(t => taskToSummary(t)));
}

export async function handleClaimTask(req: Request, _ctx: RouteContext, json: (data: unknown, status?: number) => Response, taskToSummary: (task: Task, fields?: string[]) => unknown): Promise<Response> {
  try {
    const body = await req.json() as { agent_id?: string; project_id?: string };
    const agentId = body.agent_id || "anonymous";
    const task = claimNextTask(agentId, body.project_id ? { project_id: body.project_id } : undefined);
    return json({ task: task ? taskToSummary(task) : null });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed to claim" }, 500);
  }
}

export function handleListOrgs(_ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  return json(listOrgs());
}

export async function handleCreateOrg(req: Request, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Promise<Response> {
  try {
    const body = await req.json() as { name: string; description?: string };
    if (!body.name) return json({ error: "Missing name" }, 400);
    return json(createOrg(body), 201);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed" }, 500);
  }
}

export async function handleUpdateOrg(id: string, req: Request, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Promise<Response> {
  try {
    const body = await req.json() as Record<string, unknown>;
    return json(updateOrg(id, body as any));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed" }, 500);
  }
}

export function handleDeleteOrg(id: string, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  const deleted = deleteOrg(id);
  return json(deleted ? { success: true } : { error: "Not found" }, deleted ? 200 : 404);
}

export function handleOrgChart(_ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  return json(getOrgChart());
}

export function handleAgentTeam(agentId: string, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  return json(getDirectReports(decodeURIComponent(agentId)));
}

export function handleListAgents(url: URL, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  const aFieldsParam = url.searchParams.get("fields");
  const aFields = aFieldsParam ? aFieldsParam.split(",").map(f => f.trim()).filter(Boolean) : undefined;
  const agents = listAgents();
  return json(aFields ? agents.map(a => Object.fromEntries(aFields.map(f => [f, (a as any)[f] ?? null]))) : agents);
}

export async function handleRegisterAgent(req: Request, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Promise<Response> {
  try {
    const body = await req.json() as { name: string; description?: string };
    if (!body.name) return json({ error: "Missing name" }, 400);
    const result = registerAgent({ name: body.name, description: body.description, session_id: (body as any).session_id, working_dir: (body as any).working_dir });
    if (isAgentConflict(result)) return json({ error: result.message, conflict: true }, 409);
    return json(result, 201);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed to register agent" }, 500);
  }
}

export async function handleUpdateAgent(id: string, req: Request, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Promise<Response> {
  try {
    const body = await req.json() as { name?: string; description?: string; role?: string };
    const agent = updateAgent(id, body);
    return json(agent);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed to update agent" }, 500);
  }
}

export function handleDeleteAgent(id: string, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  const deleted = deleteAgent(id);
  if (!deleted) return json({ error: "Agent not found" }, 404);
  return json({ success: true });
}

export async function handleBulkDeleteAgents(req: Request, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Promise<Response> {
  try {
    const body = await req.json() as { ids: string[]; action: "delete" };
    if (!body.ids?.length || body.action !== "delete") return json({ error: "Missing ids or invalid action" }, 400);
    let succeeded = 0;
    for (const id of body.ids) { if (deleteAgent(id)) succeeded++; }
    return json({ succeeded, failed: body.ids.length - succeeded });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed" }, 500);
  }
}

export async function handleBulkDeleteProjects(req: Request, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Promise<Response> {
  try {
    const body = await req.json() as { ids: string[]; action: "delete" };
    if (!body.ids?.length || body.action !== "delete") return json({ error: "Missing ids or invalid action" }, 400);
    let succeeded = 0;
    for (const id of body.ids) { if (deleteProject(id)) succeeded++; }
    return json({ succeeded, failed: body.ids.length - succeeded });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed" }, 500);
  }
}

export function handleDoctor(_ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  const issues: { severity: string; type: string; message: string; count?: number }[] = [];
  const staleItems = getStaleTasks(30);
  if (staleItems.length > 0) issues.push({ severity: "warn", type: "stale_tasks", message: `${staleItems.length} tasks stuck in_progress >30min`, count: staleItems.length });
  const withParent = getDatabase().query("SELECT COUNT(*) as c FROM tasks t WHERE t.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks p WHERE p.id = t.parent_id)").get() as { c: number };
  if (withParent.c > 0) issues.push({ severity: "error", type: "orphaned_parents", message: `${withParent.c} tasks reference non-existent parent IDs`, count: withParent.c });
  if (issues.length === 0) issues.push({ severity: "info", type: "healthy", message: "No issues found" });
  return json({ ok: !issues.some(i => i.severity === "error"), issues });
}

export function handleReport(_req: Request, url: URL, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  const days = parseInt(url.searchParams.get("days") || "7", 10);
  const projectId = url.searchParams.get("project_id") || undefined;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const filters = projectId ? { project_id: projectId } : undefined;
  const changed = getTasksChangedSince(since, filters);
  const all = listTasks(filters || {});
  const stats = getTaskStats(filters);
  const completed = changed.filter((t: any) => t.status === "completed");
  const failed = changed.filter((t: any) => t.status === "failed");
  const byDay: Record<string, number> = {};
  for (const t of changed) { const day = t.updated_at.slice(0, 10); byDay[day] = (byDay[day] || 0) + 1; }
  const completionRate = changed.length > 0 ? Math.round((completed.length / changed.length) * 100) : 0;
  return json({ days, period_since: since, total: all.length, stats, changed: changed.length, completed: completed.length, failed: failed.length, completion_rate: completionRate, by_day: byDay });
}

export function handleActivity(_req: Request, url: URL, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  return json(getRecentActivity(limit));
}

export function handleTaskHistory(id: string, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  return json(getTaskHistory(id));
}

export function handleListWebhooks(_ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  return json(listWebhooks());
}

export async function handleCreateWebhook(req: Request, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Promise<Response> {
  try {
    const body = await req.json() as { url: string; events?: string[]; secret?: string };
    if (!body.url) return json({ error: "Missing url" }, 400);
    return json(createWebhook(body), 201);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed" }, 500);
  }
}

export function handleDeleteWebhook(id: string, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  const deleted = deleteWebhook(id);
  return json(deleted ? { success: true } : { error: "Not found" }, deleted ? 200 : 404);
}

export function handleListTemplates(_ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  return json(listTemplates());
}

export async function handleCreateTemplate(req: Request, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Promise<Response> {
  try {
    const body = await req.json() as { name: string; title_pattern: string; description?: string; priority?: string; tags?: string[] };
    if (!body.name || !body.title_pattern) return json({ error: "Missing name or title_pattern" }, 400);
    return json(createTemplate(body as any), 201);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed" }, 500);
  }
}

export function handleDeleteTemplate(id: string, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  const deleted = deleteTemplate(id);
  return json(deleted ? { success: true } : { error: "Not found" }, deleted ? 200 : 404);
}

export function handleListPlans(url: URL, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  const projectId = url.searchParams.get("project_id") || undefined;
  const plans = listPlans(projectId);
  return json(plans);
}

export async function handleCreatePlan(req: Request, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Promise<Response> {
  try {
    const body = await req.json() as { name: string; description?: string; project_id?: string; task_list_id?: string; agent_id?: string; status?: string };
    if (!body.name) return json({ error: "Missing 'name'" }, 400);
    const plan = createPlan({
      name: body.name,
      description: body.description,
      project_id: body.project_id,
      task_list_id: body.task_list_id,
      agent_id: body.agent_id,
      status: body.status as any,
    });
    return json(plan, 201);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed to create plan" }, 500);
  }
}

export async function handleBulkDeletePlans(req: Request, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Promise<Response> {
  try {
    const body = await req.json() as { ids: string[]; action: "delete" };
    if (!body.ids?.length || body.action !== "delete") return json({ error: "Missing ids or invalid action" }, 400);
    let succeeded = 0;
    for (const id of body.ids) { if (deletePlan(id)) succeeded++; }
    return json({ succeeded, failed: body.ids.length - succeeded });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed" }, 500);
  }
}

export function handleGetPlan(id: string, _ctx: RouteContext, json: (data: unknown, status?: number) => Response, taskToSummary: (task: Task, fields?: string[]) => unknown): Response {
  const plan = getPlan(id);
  if (!plan) return json({ error: "Plan not found" }, 404);
  const tasks = listTasks({ plan_id: id });
  return json({ ...plan, tasks: tasks.map(t => taskToSummary(t)) });
}

export async function handleUpdatePlan(id: string, req: Request, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Promise<Response> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const plan = updatePlan(id, body as any);
    return json(plan);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Failed to update plan" }, 500);
  }
}

export function handleDeletePlan(id: string, _ctx: RouteContext, json: (data: unknown, status?: number) => Response): Response {
  const deleted = deletePlan(id);
  if (!deleted) return json({ error: "Plan not found" }, 404);
  return json({ success: true });
}

export function handleStaticFiles(path: string, method: string, ctx: RouteContext, json: (data: unknown, status?: number) => Response, serveStaticFile: (filePath: string) => Response | null): Response | null {
  if (!ctx.dashboardExists || (method !== "GET" && method !== "HEAD")) return null;
  if (path !== "/") {
    const filePath = join(ctx.dashboardDir, path);
    const resolvedFile = resolve(filePath);
    const resolvedBase = resolve(ctx.dashboardDir);
    if (!resolvedFile.startsWith(resolvedBase + sep) && resolvedFile !== resolvedBase) {
      return json({ error: "Forbidden" }, 403);
    }
    const res = serveStaticFile(filePath);
    if (res) return res;
  }
  const indexPath = join(ctx.dashboardDir, "index.html");
  const res = serveStaticFile(indexPath);
  if (res) return res;
  return null;
}
