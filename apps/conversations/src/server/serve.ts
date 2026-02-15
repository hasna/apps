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
import { join } from "path";
import { existsSync } from "fs";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
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

export function startDashboardServer(port = 3456) {
  // Resolve dashboard dist directory
  const dashboardDist = join(import.meta.dir, "../../dashboard/dist");
  const hasDist = existsSync(dashboardDist);

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // ---- API Routes ----
      if (path === "/api/status") {
        return jsonResponse(getStatus());
      }

      if (path === "/api/messages" && req.method === "GET") {
        const limit = parseInt(url.searchParams.get("limit") || "50");
        const session = url.searchParams.get("session") || undefined;
        const channel = url.searchParams.get("channel") || undefined;
        const from = url.searchParams.get("from") || undefined;
        const to = url.searchParams.get("to") || undefined;
        const messages = readMessages({ session_id: session, channel, from, to, limit });
        // Return newest first for the dashboard
        return jsonResponse(messages.reverse());
      }

      if (path === "/api/messages" && req.method === "POST") {
        try {
          const text = await req.text();
          const body = JSON.parse(text) as { from: string; to: string; content: string; channel?: string; priority?: string };
          const msg = sendMessage({
            from: body.from,
            to: body.to,
            content: body.content,
            channel: body.channel,
            priority: body.priority as any,
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
        try {
          const text = await req.text();
          const body = JSON.parse(text) as { name: string; created_by: string; description?: string };
          const ch = createChannel(body.name, body.created_by, body.description);
          return jsonResponse(ch);
        } catch (e: any) {
          return jsonResponse({ error: e.message }, 400);
        }
      }

      // ---- Static files (dashboard) ----
      if (hasDist) {
        let filePath = join(dashboardDist, path === "/" ? "index.html" : path);
        let file = Bun.file(filePath);
        if (await file.exists()) return new Response(file);

        // SPA fallback
        file = Bun.file(join(dashboardDist, "index.html"));
        if (await file.exists()) return new Response(file);
      }

      return new Response("Not Found", { status: 404 });
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
  const port = parseInt(process.env.PORT || "3456");
  startDashboardServer(port);
}
