#!/usr/bin/env bun
/**
 * Dashboard API server.
 * Serves the built dashboard static files and API routes.
 *
 * Usage:
 *   conversations dashboard          # Start dashboard server
 */

import { readMessages, sendMessage, markRead } from "../lib/messages.js";
import { listSessions, getSession } from "../lib/sessions.js";
import { listChannels, getChannel, createChannel, joinChannel, leaveChannel, getChannelMembers } from "../lib/channels.js";
import { getDb, getDbPath } from "../lib/db.js";
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
  const totalChannels = (db.prepare("SELECT COUNT(*) as count FROM channels").get() as { count: number }).count;

  return {
    db_path: dbPath,
    total_messages: totalMessages,
    total_sessions: totalSessions,
    total_channels: totalChannels,
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

export function startDashboardServer(port = 3456, host?: string) {
  const resolvedPort = normalizePort(port, 3456);
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
        const channel = url.searchParams.get("channel") || undefined;
        const from = url.searchParams.get("from") || undefined;
        const to = url.searchParams.get("to") || undefined;
        const messages = readMessages({ session_id: session, channel, from, to, limit, order: "desc" });
        // Return newest first for the dashboard
        return jsonResponse(messages);
      }

      if (path === "/api/messages" && req.method === "POST") {
        if (!isSameOrigin(req)) {
          return jsonResponse({ error: "Invalid origin" }, 403);
        }
        try {
          const text = await req.text();
          const body = JSON.parse(text) as { from?: string; to?: string; content?: string; channel?: string; priority?: string };
          const from = typeof body.from === "string" ? body.from.trim() : "";
          const to = typeof body.to === "string" ? body.to.trim() : "";
          const content = typeof body.content === "string" ? body.content.trim() : "";
          const channel = typeof body.channel === "string" ? body.channel.trim() : undefined;
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
            channel,
            priority: priority as any,
          });
          return jsonResponse(msg);
        } catch (e: any) {
          return jsonResponse({ error: e.message }, 400);
        }
      }

      if (path === "/api/sessions") {
        const agent = url.searchParams.get("agent") || undefined;
        return jsonResponse(listSessions(agent));
      }

      if (path === "/api/channels" && req.method === "GET") {
        return jsonResponse(listChannels());
      }

      if (path === "/api/channels" && req.method === "POST") {
        if (!isSameOrigin(req)) {
          return jsonResponse({ error: "Invalid origin" }, 403);
        }
        try {
          const text = await req.text();
          const body = JSON.parse(text) as { name?: string; created_by?: string; description?: string };
          const name = typeof body.name === "string" ? body.name.trim() : "";
          const createdBy = typeof body.created_by === "string" ? body.created_by.trim() : "";
          const description = typeof body.description === "string" ? body.description.trim() : undefined;
          if (!name || !createdBy) {
            return jsonResponse({ error: "name and created_by are required" }, 400);
          }
          const ch = createChannel(name, createdBy, description);
          return jsonResponse(ch);
        } catch (e: any) {
          return jsonResponse({ error: e.message }, 400);
        }
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
  const port = normalizePort(process.env.PORT, 3456);
  startDashboardServer(port);
}
