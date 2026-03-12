#!/usr/bin/env bun
/**
 * Dashboard API server.
 * Serves the built dashboard static files and API routes.
 *
 * Usage:
 *   conversations dashboard          # Start dashboard server
 */

import { readMessages, sendMessage, markRead, searchMessages, exportMessages, deleteMessage, editMessage, pinMessage, unpinMessage, getPinnedMessages } from "../lib/messages.js";
import { listSessions, getSession } from "../lib/sessions.js";
import { listSpaces, getSpace, createSpace, updateSpace, archiveSpace, unarchiveSpace, joinSpace, leaveSpace, getSpaceMembers } from "../lib/spaces.js";
import { listProjects, getProject, getProjectByName, createProject, updateProject, deleteProject } from "../lib/projects.js";
import { getDb, getDbPath } from "../lib/db.js";
import { listAgents } from "../lib/presence.js";
import { join, resolve, sep } from "path";
import { existsSync } from "fs";

function securityHeaders(base?: HeadersInit): Headers {
  const headers = new Headers(base);
  if (!headers.has("X-Content-Type-Options")) headers.set("X-Content-Type-Options", "nosniff");
  if (!headers.has("X-Frame-Options")) headers.set("X-Frame-Options", "DENY");
  if (!headers.has("Referrer-Policy")) headers.set("Referrer-Policy", "no-referrer");
  if (!headers.has("Permissions-Policy")) {
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  }
  if (!headers.has("Cross-Origin-Resource-Policy")) {
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
  }
  if (!headers.has("Content-Security-Policy")) {
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'"
    );
  }
  return headers;
}

/**
 * Filter object fields based on ?fields= query param.
 * Usage: /api/messages?fields=id,from_agent,content
 */
function applyFields<T>(data: T, fields?: string | null): unknown {
  if (!fields) return data;
  const keys = fields.split(",").map(s => s.trim()).filter(Boolean);
  if (!keys.length) return data;
  if (Array.isArray(data)) {
    return data.map(item => {
      if (item && typeof item === "object") {
        const out: Record<string, unknown> = {};
        for (const k of keys) if (k in item) out[k] = (item as Record<string, unknown>)[k];
        return out;
      }
      return item;
    });
  }
  if (data && typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (k in (data as object)) out[k] = (data as Record<string, unknown>)[k];
    return out;
  }
  return data;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: securityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    }),
  });
}

function getStatus() {
  const db = getDb();
  const dbPath = getDbPath();
  const totalMessages = (db.prepare("SELECT COUNT(*) as count FROM messages").get() as { count: number }).count;
  const totalSessions = (db.prepare("SELECT COUNT(DISTINCT session_id) as count FROM messages").get() as { count: number }).count;
  const totalUnread = (db.prepare("SELECT COUNT(*) as count FROM messages WHERE read_at IS NULL").get() as { count: number }).count;
  const totalSpaces = (db.prepare("SELECT COUNT(*) as count FROM spaces").get() as { count: number }).count;
  const totalProjects = (db.prepare("SELECT COUNT(*) as count FROM projects").get() as { count: number }).count;

  return {
    db_path: dbPath,
    total_messages: totalMessages,
    total_sessions: totalSessions,
    total_spaces: totalSpaces,
    total_projects: totalProjects,
    unread_messages: totalUnread,
  };
}

function normalizeHost(value: unknown): string {
  const host = typeof value === "string" ? value.trim() : "";
  return host.length > 0 ? host : "127.0.0.1";
}

function normalizePort(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? parseInt(value, 10) : value;
  if (!Number.isFinite(parsed)) return fallback;
  const port = parsed as number;
  if (port < 0 || port > 65535) return fallback;
  return port;
}

function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  if (origin === "null") return false;
  return origin === new URL(req.url).origin;
}

export function startDashboardServer(port = 0, host?: string) {
  const resolvedPort = normalizePort(port, 0);
  const resolvedHost = normalizeHost(host ?? process.env.CONVERSATIONS_DASHBOARD_HOST);
  // Resolve dashboard dist directory
  const dashboardDist = join(import.meta.dir, "../../dashboard/dist");
  const hasDist = existsSync(dashboardDist);

  const server = Bun.serve({
    port: resolvedPort,
    hostname: resolvedHost,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // ---- API Routes ----
      if (path === "/api/status") {
        return jsonResponse(getStatus());
      }

      if (path === "/api/messages" && req.method === "GET") {
        const rawLimit = url.searchParams.get("limit");
        let limit = parseInt(rawLimit || "50", 10);
        if (!Number.isFinite(limit) || limit <= 0) limit = 50;
        if (limit > 500) limit = 500;
        const session = url.searchParams.get("session") || undefined;
        const space = url.searchParams.get("space") || undefined;
        const from = url.searchParams.get("from") || undefined;
        const to = url.searchParams.get("to") || undefined;
        const compact = url.searchParams.get("compact") === "true";
        const messages = readMessages({ session_id: session, space, from, to, limit, order: "desc", compact });
        return jsonResponse(applyFields(messages, url.searchParams.get("fields")));
      }

      if (path === "/api/messages" && req.method === "POST") {
        if (!isSameOrigin(req)) {
          return jsonResponse({ error: "Invalid origin" }, 403);
        }
        try {
          const text = await req.text();
          const body = JSON.parse(text) as { from?: string; to?: string; content?: string; space?: string; priority?: string };
          const from = typeof body.from === "string" ? body.from.trim() : "";
          const to = typeof body.to === "string" ? body.to.trim() : "";
          const content = typeof body.content === "string" ? body.content.trim() : "";
          const space = typeof body.space === "string" ? body.space.trim() : undefined;
          const priority = typeof body.priority === "string" ? body.priority.trim().toLowerCase() : undefined;

          if (!from || !to || !content) {
            return jsonResponse({ error: "from, to, and content are required" }, 400);
          }
          if (priority && !["low", "normal", "high", "urgent"].includes(priority)) {
            return jsonResponse({ error: "Invalid priority" }, 400);
          }
          const msg = sendMessage({
            from,
            to,
            content,
            space,
            priority: priority as any,
          });
          return jsonResponse(msg);
        } catch (e: any) {
          return jsonResponse({ error: e.message }, 400);
        }
      }

      if (path === "/api/messages/search" && req.method === "GET") {
        const q = url.searchParams.get("q") || "";
        if (!q.trim()) {
          return jsonResponse({ error: "Query parameter 'q' is required" }, 400);
        }
        const rawLimit = url.searchParams.get("limit");
        let limit = parseInt(rawLimit || "50", 10);
        if (!Number.isFinite(limit) || limit <= 0) limit = 50;
        if (limit > 500) limit = 500;
        const space = url.searchParams.get("space") || undefined;
        const from = url.searchParams.get("from") || undefined;
        const to = url.searchParams.get("to") || undefined;
        const messages = searchMessages({ query: q.trim(), space, from, to, limit });
        return jsonResponse(messages);
      }

      if (path === "/api/export" && req.method === "GET") {
        const space = url.searchParams.get("space") || undefined;
        const session = url.searchParams.get("session") || undefined;
        const from = url.searchParams.get("from") || undefined;
        const since = url.searchParams.get("since") || undefined;
        const until = url.searchParams.get("until") || undefined;
        const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
        const result = exportMessages({ space, session_id: session, from, since, until, format });

        if (format === "csv") {
          return new Response(result, {
            status: 200,
            headers: securityHeaders({
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": "attachment; filename=\"messages.csv\"",
              "Cache-Control": "no-store",
            }),
          });
        }
        return jsonResponse(JSON.parse(result));
      }

      if (path === "/api/messages/pinned" && req.method === "GET") {
        const space = url.searchParams.get("space") || undefined;
        const session_id = url.searchParams.get("session_id") || undefined;
        const rawLimit = url.searchParams.get("limit");
        let limit: number | undefined;
        if (rawLimit) {
          limit = parseInt(rawLimit, 10);
          if (!Number.isFinite(limit) || limit <= 0) limit = 50;
          if (limit > 500) limit = 500;
        }
        const messages = getPinnedMessages({ space, session_id, limit });
        return jsonResponse(messages);
      }

      // Message pin/unpin by ID: /api/messages/:id/pin
      const pinMatch = path.match(/^\/api\/messages\/(\d+)\/pin$/);
      if (pinMatch) {
        const messageId = parseInt(pinMatch[1], 10);
        if (req.method === "POST") {
          if (!isSameOrigin(req)) {
            return jsonResponse({ error: "Invalid origin" }, 403);
          }
          const msg = pinMessage(messageId);
          if (!msg) return jsonResponse({ error: "Message not found" }, 404);
          return jsonResponse(msg);
        }
        if (req.method === "DELETE") {
          if (!isSameOrigin(req)) {
            return jsonResponse({ error: "Invalid origin" }, 403);
          }
          const msg = unpinMessage(messageId);
          if (!msg) return jsonResponse({ error: "Message not found" }, 404);
          return jsonResponse(msg);
        }
      }

      // Message delete/edit by ID: /api/messages/:id
      const messageMatch = path.match(/^\/api\/messages\/(\d+)$/);
      if (messageMatch) {
        const messageId = parseInt(messageMatch[1], 10);
        if (req.method === "DELETE") {
          if (!isSameOrigin(req)) {
            return jsonResponse({ error: "Invalid origin" }, 403);
          }
          const from = url.searchParams.get("from") || "";
          if (!from) {
            return jsonResponse({ error: "'from' query parameter is required" }, 400);
          }
          const deleted = deleteMessage(messageId, from);
          if (!deleted) return jsonResponse({ error: "Message not found or not your message" }, 404);
          return jsonResponse({ id: messageId, deleted: true });
        }
        if (req.method === "PUT") {
          if (!isSameOrigin(req)) {
            return jsonResponse({ error: "Invalid origin" }, 403);
          }
          try {
            const text = await req.text();
            const body = JSON.parse(text) as { content?: string; from?: string };
            const content = typeof body.content === "string" ? body.content.trim() : "";
            const from = typeof body.from === "string" ? body.from.trim() : "";
            if (!content || !from) {
              return jsonResponse({ error: "content and from are required" }, 400);
            }
            const msg = editMessage(messageId, from, content);
            if (!msg) return jsonResponse({ error: "Message not found or not your message" }, 404);
            return jsonResponse(msg);
          } catch (e: any) {
            return jsonResponse({ error: e.message }, 400);
          }
        }
      }

      if (path === "/api/sessions") {
        const agent = url.searchParams.get("agent") || undefined;
        return jsonResponse(applyFields(listSessions(agent), url.searchParams.get("fields")));
      }

      if (path === "/api/spaces" && req.method === "GET") {
        const projectId = url.searchParams.get("project_id") || undefined;
        const includeArchived = url.searchParams.get("include_archived") === "true";
        const listOpts: { project_id?: string; include_archived?: boolean } = {};
        if (projectId) listOpts.project_id = projectId;
        if (includeArchived) listOpts.include_archived = true;
        return jsonResponse(applyFields(listSpaces(Object.keys(listOpts).length > 0 ? listOpts : undefined), url.searchParams.get("fields")));
      }

      if (path === "/api/spaces" && req.method === "POST") {
        if (!isSameOrigin(req)) {
          return jsonResponse({ error: "Invalid origin" }, 403);
        }
        try {
          const text = await req.text();
          const body = JSON.parse(text) as { name?: string; created_by?: string; description?: string; parent_id?: string; project_id?: string };
          const name = typeof body.name === "string" ? body.name.trim() : "";
          const createdBy = typeof body.created_by === "string" ? body.created_by.trim() : "";
          const description = typeof body.description === "string" ? body.description.trim() : undefined;
          const parent_id = typeof body.parent_id === "string" ? body.parent_id.trim() : undefined;
          const project_id = typeof body.project_id === "string" ? body.project_id.trim() : undefined;
          if (!name || !createdBy) {
            return jsonResponse({ error: "name and created_by are required" }, 400);
          }
          const sp = createSpace(name, createdBy, { description, parent_id, project_id });
          return jsonResponse(sp);
        } catch (e: any) {
          return jsonResponse({ error: e.message }, 400);
        }
      }

      // Space update/archive/unarchive by name
      const spaceArchiveMatch = path.match(/^\/api\/spaces\/([^/]+)\/archive$/);
      if (spaceArchiveMatch && req.method === "POST") {
        if (!isSameOrigin(req)) {
          return jsonResponse({ error: "Invalid origin" }, 403);
        }
        try {
          const sp = archiveSpace(decodeURIComponent(spaceArchiveMatch[1]));
          return jsonResponse(sp);
        } catch (e: any) {
          return jsonResponse({ error: e.message }, 400);
        }
      }

      const spaceUnarchiveMatch = path.match(/^\/api\/spaces\/([^/]+)\/unarchive$/);
      if (spaceUnarchiveMatch && req.method === "POST") {
        if (!isSameOrigin(req)) {
          return jsonResponse({ error: "Invalid origin" }, 403);
        }
        try {
          const sp = unarchiveSpace(decodeURIComponent(spaceUnarchiveMatch[1]));
          return jsonResponse(sp);
        } catch (e: any) {
          return jsonResponse({ error: e.message }, 400);
        }
      }

      const spaceMatch = path.match(/^\/api\/spaces\/([^/]+)$/);
      if (spaceMatch) {
        const spaceName = decodeURIComponent(spaceMatch[1]);
        if (req.method === "GET") {
          const sp = getSpace(spaceName);
          if (!sp) return jsonResponse({ error: "Space not found" }, 404);
          return jsonResponse(sp);
        }
        if (req.method === "PUT") {
          if (!isSameOrigin(req)) {
            return jsonResponse({ error: "Invalid origin" }, 403);
          }
          try {
            const text = await req.text();
            const body = JSON.parse(text) as { description?: string; parent_id?: string | null; project_id?: string | null };
            const updates: { description?: string; parent_id?: string | null; project_id?: string | null } = {};
            if (body.description !== undefined) updates.description = body.description;
            if (body.parent_id !== undefined) updates.parent_id = body.parent_id;
            if (body.project_id !== undefined) updates.project_id = body.project_id;
            const sp = updateSpace(spaceName, updates);
            return jsonResponse(sp);
          } catch (e: any) {
            return jsonResponse({ error: e.message }, 400);
          }
        }
      }

      if (path === "/api/projects" && req.method === "GET") {
        const status = url.searchParams.get("status") as "active" | "archived" | null;
        return jsonResponse(applyFields(listProjects(status ? { status } : undefined), url.searchParams.get("fields")));
      }

      if (path === "/api/projects" && req.method === "POST") {
        if (!isSameOrigin(req)) {
          return jsonResponse({ error: "Invalid origin" }, 403);
        }
        try {
          const text = await req.text();
          const body = JSON.parse(text) as {
            name?: string; created_by?: string; description?: string;
            path?: string; repository?: string; tags?: string[]; metadata?: Record<string, unknown>;
            settings?: Record<string, unknown>;
          };
          const name = typeof body.name === "string" ? body.name.trim() : "";
          const createdBy = typeof body.created_by === "string" ? body.created_by.trim() : "";
          if (!name || !createdBy) {
            return jsonResponse({ error: "name and created_by are required" }, 400);
          }
          const project = createProject({
            name,
            created_by: createdBy,
            description: body.description,
            path: body.path,
            repository: body.repository,
            tags: body.tags,
            metadata: body.metadata,
            settings: body.settings,
          });
          return jsonResponse(project);
        } catch (e: any) {
          return jsonResponse({ error: e.message }, 400);
        }
      }

      // Project update/delete by ID
      const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
      if (projectMatch) {
        const projectId = projectMatch[1];
        if (req.method === "GET") {
          let project = getProject(projectId);
          if (!project) project = getProjectByName(projectId);
          if (!project) return jsonResponse({ error: "Project not found" }, 404);
          return jsonResponse(project);
        }
        if (req.method === "PUT") {
          if (!isSameOrigin(req)) {
            return jsonResponse({ error: "Invalid origin" }, 403);
          }
          try {
            const text = await req.text();
            const body = JSON.parse(text);
            const project = updateProject(projectId, body);
            return jsonResponse(project);
          } catch (e: any) {
            return jsonResponse({ error: e.message }, 400);
          }
        }
        if (req.method === "DELETE") {
          if (!isSameOrigin(req)) {
            return jsonResponse({ error: "Invalid origin" }, 403);
          }
          try {
            const deleted = deleteProject(projectId);
            if (!deleted) return jsonResponse({ error: "Project not found" }, 404);
            return jsonResponse({ id: projectId, deleted: true });
          } catch (e: any) {
            return jsonResponse({ error: e.message }, 400);
          }
        }
      }

      if (path === "/api/agents" && req.method === "GET") {
        const onlineOnly = url.searchParams.get("online_only") === "true";
        const agents = listAgents({ online_only: onlineOnly });
        return jsonResponse(applyFields(agents, url.searchParams.get("fields")));
      }

      if (path === "/api/version" && req.method === "GET") {
        try {
          const pkg = await import("../../package.json");
          const current = pkg.version;
          const res = await fetch("https://registry.npmjs.org/@hasna/conversations/latest");
          const data = await res.json() as { version: string };
          const latest = data.version;
          return jsonResponse({ current, latest, updateAvailable: current !== latest });
        } catch (e: any) {
          return jsonResponse({ error: e.message }, 500);
        }
      }

      if (path === "/api/update" && req.method === "POST") {
        if (!isSameOrigin(req)) {
          return jsonResponse({ error: "Invalid origin" }, 403);
        }
        try {
          const pkg = await import("../../package.json");
          const current = pkg.version;
          const res = await fetch("https://registry.npmjs.org/@hasna/conversations/latest");
          const data = await res.json() as { version: string };
          const latest = data.version;

          if (current === latest) {
            return jsonResponse({ current, latest, status: "up-to-date" });
          }

          const proc = Bun.spawn(["bun", "install", "-g", `@hasna/conversations@${latest}`], {
            stdout: "pipe",
            stderr: "pipe",
          });
          const exitCode = await proc.exited;
          const stdout = await new Response(proc.stdout).text();
          const stderr = await new Response(proc.stderr).text();

          if (exitCode === 0) {
            return jsonResponse({ current, latest, status: "updated", stdout });
          } else {
            return jsonResponse({ current, latest, status: "failed", exitCode, stderr }, 500);
          }
        } catch (e: any) {
          return jsonResponse({ error: e.message }, 500);
        }
      }

      // ---- Static files (dashboard) ----
      if (hasDist) {
        const baseDir = resolve(dashboardDist);
        const safePath = (path === "/" ? "index.html" : path.replace(/^\/+/, ""));
        const filePath = resolve(baseDir, safePath);
        if (!filePath.startsWith(baseDir + sep)) {
          return new Response("Not Found", { status: 404 });
        }

        let file = Bun.file(filePath);
        if (await file.exists()) {
          const headers = securityHeaders();
          if (file.type) headers.set("Content-Type", file.type);
          return new Response(file, { headers });
        }

        // SPA fallback
        file = Bun.file(join(dashboardDist, "index.html"));
        if (await file.exists()) {
          const headers = securityHeaders();
          if (file.type) headers.set("Content-Type", file.type);
          return new Response(file, { headers });
        }
      }

      return new Response("Not Found", {
        status: 404,
        headers: securityHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
      });
    },
  });

  console.log(`Dashboard running at http://localhost:${server.port}`);
  return server;
}

// If run directly
const isDirectRun = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("serve.ts") ||
  process.argv[1]?.endsWith("serve.js");

if (isDirectRun) {
  const port = normalizePort(process.env.PORT, 0);
  startDashboardServer(port);
}
