/**
 * HTTP server for the Todos dashboard.
 * Serves the Vite-built React/shadcn dashboard from dashboard/dist/.
 * Provides REST API endpoints for task management.
 */

import { existsSync } from "fs";
import { join, dirname, extname } from "path";
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

function taskToSummary(task: Task) {
  return {
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
  };
}

export async function startServer(port: number, options?: { open?: boolean }): Promise<void> {
  const shouldOpen = options?.open ?? true;

  // Initialize database
  getDatabase();

  const dashboardDir = resolveDashboardDir();
  const dashboardExists = existsSync(dashboardDir);

  if (!dashboardExists) {
    console.error(`\nDashboard not found at: ${dashboardDir}`);
    console.error(`Run this to build it:\n`);
    console.error(`  cd dashboard && bun install && bun run build\n`);
  }

  const server = Bun.serve({
    port,
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

      // ── API: Stats ──
      if (path === "/api/stats" && method === "GET") {
        const all = listTasks({ limit: 10000 });
        const projects = listProjects();
        const agents = listAgents();
        return json({
          total_tasks: all.length,
          pending: all.filter((t) => t.status === "pending").length,
          in_progress: all.filter((t) => t.status === "in_progress").length,
          completed: all.filter((t) => t.status === "completed").length,
          failed: all.filter((t) => t.status === "failed").length,
          cancelled: all.filter((t) => t.status === "cancelled").length,
          projects: projects.length,
          agents: agents.length,
        }, 200, port);
      }

      // ── API: List tasks ──
      if (path === "/api/tasks" && method === "GET") {
        const status = url.searchParams.get("status") || undefined;
        const projectId = url.searchParams.get("project_id") || undefined;
        const limitParam = url.searchParams.get("limit");
        const tasks = listTasks({
          status: status as Task["status"] | undefined,
          project_id: projectId,
          limit: limitParam ? parseInt(limitParam, 10) : undefined,
        });
        return json(tasks.map(taskToSummary), 200, port);
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
        const summaries = tasks.map(taskToSummary);

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

      // ── API: Single task operations ──
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
          return json(taskToSummary(task), 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to start task" }, 500, port);
        }
      }

      // ── API: Complete task ──
      const completeMatch = path.match(/^\/api\/tasks\/([^/]+)\/complete$/);
      if (completeMatch && method === "POST") {
        const id = completeMatch[1]!;
        try {
          const task = completeTask(id, "dashboard");
          return json(taskToSummary(task), 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to complete task" }, 500, port);
        }
      }

      // ── API: Projects ──
      if (path === "/api/projects" && method === "GET") {
        return json(listProjects(), 200, port);
      }

      // ── API: Agents ──
      if (path === "/api/agents" && method === "GET") {
        return json(listAgents(), 200, port);
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

      // ── Static Files (Vite dashboard) ──
      if (dashboardExists && (method === "GET" || method === "HEAD")) {
        if (path !== "/") {
          const filePath = join(dashboardDir, path);
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
