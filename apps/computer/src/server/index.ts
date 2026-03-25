#!/usr/bin/env bun
import { runTask } from "../agent/loop.js";
import { captureScreenshot } from "../drivers/mac/screenshot.js";
import { executeAction } from "../drivers/mac/input.js";
import { listSessions, getSession, getActionLogs, deleteSession, getStats } from "../db/index.js";
import type { Provider, DriverAction } from "../types/index.js";

const PORT = parseInt(process.env.COMPUTER_PORT ?? "19450");

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // CORS
    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

    try {
      // POST /run — run a task
      if (method === "POST" && path === "/run") {
        const body = (await req.json()) as Record<string, any>;
        const session = await runTask({
          task: body.task as string,
          provider: (body.provider ?? "anthropic") as Provider,
          model: body.model as string | undefined,
          maxSteps: (body.max_steps as number) ?? 50,
          saveScreenshots: (body.save_screenshots as boolean) ?? false,
        });
        return Response.json(session, { headers: corsHeaders });
      }

      // GET /screenshot — take a screenshot
      if (method === "GET" && path === "/screenshot") {
        const ss = await captureScreenshot();
        return Response.json(
          { size: ss.size, base64: ss.base64, timestamp: ss.timestamp },
          { headers: corsHeaders }
        );
      }

      // POST /action — execute a single action
      if (method === "POST" && path === "/action") {
        const action = (await req.json()) as DriverAction;
        const result = await executeAction(action);
        return Response.json(result, { headers: corsHeaders });
      }

      // GET /sessions — list sessions
      if (method === "GET" && path === "/sessions") {
        const limit = parseInt(url.searchParams.get("limit") ?? "20");
        const status = url.searchParams.get("status") ?? undefined;
        const sessions = listSessions({ limit, status: status as any });
        return Response.json(sessions, { headers: corsHeaders });
      }

      // GET /sessions/:id — get session detail
      if (method === "GET" && path.startsWith("/sessions/")) {
        const id = path.replace("/sessions/", "");
        const session = getSession(id);
        if (!session) return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
        const logs = getActionLogs(id);
        return Response.json({ session, action_logs: logs }, { headers: corsHeaders });
      }

      // DELETE /sessions/:id — delete session
      if (method === "DELETE" && path.startsWith("/sessions/")) {
        const id = path.replace("/sessions/", "");
        const deleted = deleteSession(id);
        return Response.json({ deleted }, { headers: corsHeaders });
      }

      // GET /stats
      if (method === "GET" && path === "/stats") {
        return Response.json(getStats(), { headers: corsHeaders });
      }

      // GET /health
      if (method === "GET" && (path === "/health" || path === "/")) {
        return Response.json(
          { status: "ok", name: "computer", version: "0.1.0", port: PORT },
          { headers: corsHeaders }
        );
      }

      return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message }, { status: 500, headers: corsHeaders });
    }
  },
});

console.log(`computer-serve running on http://localhost:${PORT}`);
