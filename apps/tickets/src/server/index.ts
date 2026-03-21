#!/usr/bin/env bun
import { Hono } from "hono";
import { serve } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDatabase } from "../db/database.ts";
import { verifyApiKey } from "../lib/auth.ts";
import { AuthError } from "../types/index.ts";
import { createTicket, getTicketById, updateTicket, closeTicket, reopenTicket, assignTicket, listTickets, deleteTicket, bulkCreateTickets, bulkUpdateTickets, transitionTicket } from "../db/tickets.ts";
import { searchTickets, getSimilarTickets } from "../db/search.ts";
import { createComment, listComments, updateComment, deleteComment } from "../db/comments.ts";
import { createRelation, listRelations, deleteRelation } from "../db/relations.ts";
import { listActivity } from "../db/activity.ts";
import { createProject, getProjectById, getProjectBySlug, listProjects, updateProject, deleteProject, getProjectStats } from "../db/projects.ts";
import { createLabel, listLabels, updateLabel, deleteLabel } from "../db/labels.ts";
import { createMilestone, listMilestones, getMilestoneById, updateMilestone, closeMilestone } from "../db/milestones.ts";
import { registerAgent, getAgentById, getAgentByName, listAgents } from "../db/agents.ts";
import { createWebhook, listWebhooks, getWebhookById, deleteWebhook } from "../db/webhooks.ts";
import { createDomain, listDomains, verifyDomain, deleteDomain } from "../db/domains.ts";
import { domainMiddleware } from "./middleware/domain.ts";
import { processInboundEmail } from "../email/inbound.ts";
import type { ParsedEmail } from "../email/inbound.ts";
import { deliverWebhook } from "../lib/webhook-delivery.ts";
import { createApiKey, listApiKeys, revokeApiKey } from "../lib/auth.ts";
import type { TicketType, TicketStatus, Resolution, Priority, Severity, TicketSource, RelationType, WebhookEvent, AgentType } from "../types/index.ts";

const PORT = parseInt(process.env["PORT"] ?? "19428", 10);

export function createApp() {
  const app = new Hono();

  // ── Domain middleware ────────────────────────────────────────────────────
  app.use("*", domainMiddleware);

  // ── Auth middleware ──────────────────────────────────────────────────────
  app.use("/api/*", async (c, next) => {
    // Skip auth for public endpoints
    const skip = ["/api/health", "/api/email/inbound"];
    if (skip.some((s) => c.req.path.startsWith(s))) return next();

    const key = c.req.header("X-API-Key") ?? c.req.header("Authorization")?.replace(/^Bearer\s+/, "");
    if (!key) {
      return c.json({ data: null, error: { code: "UNAUTHORIZED", message: "API key required. Pass X-API-Key header." } }, 401);
    }
    try {
      const apiKey = await verifyApiKey(key);
      c.set("agentId", apiKey.agent_id);
    } catch {
      return c.json({ data: null, error: { code: "UNAUTHORIZED", message: "Invalid API key" } }, 401);
    }
    return next();
  });

  // ── Health ───────────────────────────────────────────────────────────────
  app.get("/api/health", (c) => c.json({ ok: true, version: "0.1.0" }));

  // ── Tickets ──────────────────────────────────────────────────────────────
  app.get("/api/tickets", (c) => {
    const q = c.req.query();
    const result = listTickets({
      project_id: q["project_id"], workspace_id: q["workspace_id"],
      status: q["status"] as TicketStatus | undefined,
      priority: q["priority"] as Priority | undefined,
      type: q["type"] as TicketType | undefined,
      assignee_id: q["assignee_id"], reporter_id: q["reporter_id"],
      milestone_id: q["milestone_id"], label: q["label"],
      is_ai_opened: q["is_ai_opened"] === "true" ? true : q["is_ai_opened"] === "false" ? false : undefined,
      sla_breached: q["sla_breached"] === "true" ? true : q["sla_breached"] === "false" ? false : undefined,
      source: q["source"] as TicketSource | undefined,
      created_after: q["created_after"], created_before: q["created_before"],
      search: q["search"] ?? q["q"],
      page: q["page"] ? parseInt(q["page"]) : undefined,
      per_page: q["per_page"] ? parseInt(q["per_page"]) : undefined,
      sort: q["sort"] as "created_at" | "updated_at" | "priority" | "status" | undefined,
      order: q["order"] as "asc" | "desc" | undefined,
    });
    return c.json({ data: result.tickets, meta: { total: result.total, page: parseInt(q["page"] ?? "1"), per_page: parseInt(q["per_page"] ?? "25") }, error: null });
  });

  app.post("/api/tickets", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    if (!body["project_id"]) return c.json({ data: null, error: { code: "VALIDATION_ERROR", message: "project_id is required" } }, 400);
    if (!body["title"]) return c.json({ data: null, error: { code: "VALIDATION_ERROR", message: "title is required" } }, 400);
    const ticket = createTicket({
      project_id: body["project_id"] as string,
      title: body["title"] as string,
      description: body["description"] as string | undefined,
      type: body["type"] as TicketType | undefined,
      priority: body["priority"] as Priority | undefined,
      severity: body["severity"] as Severity | undefined,
      reporter_id: body["reporter_id"] as string | undefined,
      assignee_id: body["assignee_id"] as string | undefined,
      milestone_id: body["milestone_id"] as string | undefined,
      labels: body["labels"] as string[] | undefined,
      source: (body["source"] as TicketSource | undefined) ?? "api",
      is_ai_opened: body["is_ai_opened"] as boolean | undefined,
      ai_confidence: body["ai_confidence"] as number | undefined,
      ai_reasoning: body["ai_reasoning"] as string | undefined,
      due_date: body["due_date"] as string | undefined,
      sla_minutes: body["sla_minutes"] as number | undefined,
    });
    return c.json({ data: ticket, error: null }, 201);
  });

  app.get("/api/tickets/search", (c) => {
    const q = c.req.query();
    const result = searchTickets(q["q"] ?? q["query"] ?? "", { project_id: q["project_id"], status: q["status"] as TicketStatus | undefined, per_page: q["limit"] ? parseInt(q["limit"]) : 20 });
    return c.json({ data: result.tickets, meta: { total: result.total }, error: null });
  });

  app.get("/api/tickets/similar", (c) => {
    const q = c.req.query();
    const results = getSimilarTickets(q["title"] ?? "", q["project_id"], q["limit"] ? parseInt(q["limit"]) : 5);
    return c.json({ data: results, error: null });
  });

  app.post("/api/tickets/batch", async (c) => {
    const body = await c.req.json<{ create?: Record<string, unknown>[]; update?: { id: string; status?: TicketStatus; priority?: Priority; assignee_id?: string }[] }>();
    const created = body.create ? bulkCreateTickets(body.create.map((t) => t as Parameters<typeof bulkCreateTickets>[0][0])) : [];
    const updated = body.update ? bulkUpdateTickets(body.update) : [];
    return c.json({ data: { created, updated }, error: null });
  });

  app.get("/api/tickets/:id", (c) => {
    const ticket = getTicketById(c.req.param("id"));
    return c.json({ data: ticket, error: null });
  });

  app.patch("/api/tickets/:id", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const ticket = updateTicket(c.req.param("id"), {
      title: body["title"] as string | undefined,
      description: body["description"] as string | undefined,
      type: body["type"] as TicketType | undefined,
      priority: body["priority"] as Priority | undefined,
      severity: body["severity"] as Severity | undefined,
      assignee_id: "assignee_id" in body ? body["assignee_id"] as string | null : undefined,
      milestone_id: "milestone_id" in body ? body["milestone_id"] as string | null : undefined,
      labels: body["labels"] as string[] | undefined,
      due_date: "due_date" in body ? body["due_date"] as string | null : undefined,
      version: body["version"] as number | undefined,
    });
    return c.json({ data: ticket, error: null });
  });

  app.delete("/api/tickets/:id", (c) => {
    deleteTicket(c.req.param("id"));
    return c.json({ data: null, error: null });
  });

  app.post("/api/tickets/:id/close", async (c) => {
    const body = await c.req.json<{ resolution: Resolution; duplicate_of?: string }>();
    const ticket = closeTicket(c.req.param("id"), { resolution: body.resolution, duplicate_of: body.duplicate_of });
    return c.json({ data: ticket, error: null });
  });

  app.post("/api/tickets/:id/reopen", (c) => {
    const ticket = reopenTicket(c.req.param("id"));
    return c.json({ data: ticket, error: null });
  });

  app.post("/api/tickets/:id/assign", async (c) => {
    const body = await c.req.json<{ assignee_id: string | null }>();
    const ticket = assignTicket(c.req.param("id"), body.assignee_id);
    return c.json({ data: ticket, error: null });
  });

  app.get("/api/tickets/:id/comments", (c) => {
    const ticket = getTicketById(c.req.param("id"));
    const comments = listComments(ticket.id, c.req.query("include_internal") !== "false");
    return c.json({ data: comments, error: null });
  });

  app.post("/api/tickets/:id/comments", async (c) => {
    const ticket = getTicketById(c.req.param("id"));
    const body = await c.req.json<Record<string, unknown>>();
    const comment = createComment({ ticket_id: ticket.id, content: body["content"] as string, author_id: body["author_id"] as string | undefined, is_internal: body["is_internal"] as boolean | undefined });
    return c.json({ data: comment, error: null }, 201);
  });

  app.patch("/api/tickets/:id/comments/:cid", async (c) => {
    const body = await c.req.json<{ content: string }>();
    const comment = updateComment(c.req.param("cid"), body.content);
    return c.json({ data: comment, error: null });
  });

  app.delete("/api/tickets/:id/comments/:cid", (c) => {
    deleteComment(c.req.param("cid"));
    return c.json({ data: null, error: null });
  });

  app.get("/api/tickets/:id/relations", (c) => {
    const relations = listRelations(c.req.param("id"));
    return c.json({ data: relations, error: null });
  });

  app.post("/api/tickets/:id/relations", async (c) => {
    const body = await c.req.json<{ related_ticket_id: string; relation_type: RelationType }>();
    const relation = createRelation(c.req.param("id"), body.related_ticket_id, body.relation_type);
    return c.json({ data: relation, error: null }, 201);
  });

  app.delete("/api/tickets/:id/relations/:rid", (c) => {
    deleteRelation(c.req.param("rid"));
    return c.json({ data: null, error: null });
  });

  app.get("/api/tickets/:id/activity", (c) => {
    const q = c.req.query();
    const result = listActivity(c.req.param("id"), { page: q["page"] ? parseInt(q["page"]) : undefined, per_page: q["per_page"] ? parseInt(q["per_page"]) : undefined });
    return c.json({ data: result.activity, meta: { total: result.total }, error: null });
  });

  // ── Projects ─────────────────────────────────────────────────────────────
  app.get("/api/projects", (c) => {
    return c.json({ data: listProjects(c.req.query("workspace_id")), error: null });
  });

  app.post("/api/projects", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const project = createProject({ name: body["name"] as string, workspace_id: body["workspace_id"] as string | undefined, description: body["description"] as string | undefined, icon: body["icon"] as string | undefined, is_public: body["is_public"] as boolean | undefined, ticket_prefix: body["ticket_prefix"] as string | undefined, slug: body["slug"] as string | undefined });
    return c.json({ data: project, error: null }, 201);
  });

  app.get("/api/projects/:id", (c) => {
    const project = getProjectById(c.req.param("id"));
    return c.json({ data: project, error: null });
  });

  app.patch("/api/projects/:id", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const project = updateProject(c.req.param("id"), { name: body["name"] as string | undefined, description: body["description"] as string | undefined, icon: body["icon"] as string | undefined, is_public: body["is_public"] as boolean | undefined });
    return c.json({ data: project, error: null });
  });

  app.delete("/api/projects/:id", (c) => {
    deleteProject(c.req.param("id"));
    return c.json({ data: null, error: null });
  });

  app.get("/api/projects/:id/stats", (c) => {
    return c.json({ data: getProjectStats(c.req.param("id")), error: null });
  });

  // Labels
  app.get("/api/projects/:id/labels", (c) => c.json({ data: listLabels(c.req.param("id")), error: null }));
  app.post("/api/projects/:id/labels", async (c) => {
    const body = await c.req.json<{ name: string; color?: string; description?: string }>();
    return c.json({ data: createLabel(c.req.param("id"), body.name, body.color, body.description), error: null }, 201);
  });
  app.patch("/api/projects/:id/labels/:lid", async (c) => {
    const body = await c.req.json<{ name?: string; color?: string; description?: string }>();
    return c.json({ data: updateLabel(c.req.param("lid"), body), error: null });
  });
  app.delete("/api/projects/:id/labels/:lid", (c) => { deleteLabel(c.req.param("lid")); return c.json({ data: null, error: null }); });

  // Milestones
  app.get("/api/projects/:id/milestones", (c) => {
    const status = c.req.query("status") as "open" | "closed" | undefined;
    return c.json({ data: listMilestones(c.req.param("id"), status), error: null });
  });
  app.post("/api/projects/:id/milestones", async (c) => {
    const body = await c.req.json<{ name: string; description?: string; due_date?: string }>();
    return c.json({ data: createMilestone(c.req.param("id"), body.name, body.description, body.due_date), error: null }, 201);
  });
  app.patch("/api/projects/:id/milestones/:mid", async (c) => {
    const body = await c.req.json<{ name?: string; description?: string; due_date?: string }>();
    return c.json({ data: updateMilestone(c.req.param("mid"), body), error: null });
  });
  app.post("/api/projects/:id/milestones/:mid/close", (c) => c.json({ data: closeMilestone(c.req.param("mid")), error: null }));

  // ── Agents ───────────────────────────────────────────────────────────────
  app.get("/api/agents", (c) => c.json({ data: listAgents(), error: null }));
  app.post("/api/agents", async (c) => {
    const body = await c.req.json<{ name: string; type?: AgentType; email?: string }>();
    return c.json({ data: registerAgent({ name: body.name, type: body.type, email: body.email }), error: null }, 201);
  });
  app.get("/api/agents/:id", (c) => {
    const agent = getAgentByName(c.req.param("id")) ?? getAgentById(c.req.param("id"));
    return c.json({ data: agent, error: null });
  });
  app.get("/api/agents/:id/tickets", (c) => {
    const result = listTickets({ assignee_id: c.req.param("id") });
    return c.json({ data: result.tickets, meta: { total: result.total }, error: null });
  });

  // ── Webhooks ─────────────────────────────────────────────────────────────
  app.get("/api/webhooks", (c) => {
    const q = c.req.query();
    return c.json({ data: listWebhooks({ project_id: q["project_id"], workspace_id: q["workspace_id"] }), error: null });
  });
  app.post("/api/webhooks", async (c) => {
    const body = await c.req.json<{ url: string; events: WebhookEvent[]; project_id?: string; workspace_id?: string; secret?: string }>();
    return c.json({ data: createWebhook(body.url, body.events, { project_id: body.project_id, workspace_id: body.workspace_id, secret: body.secret }), error: null }, 201);
  });
  app.delete("/api/webhooks/:id", (c) => { deleteWebhook(c.req.param("id")); return c.json({ data: null, error: null }); });
  app.post("/api/webhooks/:id/test", async (c) => {
    const webhook = getWebhookById(c.req.param("id"));
    const result = await deliverWebhook(webhook, "ticket.created", { test: true });
    return c.json({ data: result, error: null });
  });

  // ── Domains ──────────────────────────────────────────────────────────────
  app.get("/api/domains", (c) => c.json({ data: listDomains({ project_id: c.req.query("project_id"), workspace_id: c.req.query("workspace_id") }), error: null }));
  app.post("/api/domains", async (c) => {
    const body = await c.req.json<{ domain: string; project_id?: string; workspace_id?: string }>();
    return c.json({ data: createDomain(body.domain, { project_id: body.project_id, workspace_id: body.workspace_id }), error: null }, 201);
  });
  app.post("/api/domains/:id/verify", (c) => c.json({ data: verifyDomain(c.req.param("id")), error: null }));
  app.delete("/api/domains/:id", (c) => { deleteDomain(c.req.param("id")); return c.json({ data: null, error: null }); });

  // ── Auth / API Keys ───────────────────────────────────────────────────────
  app.get("/api/auth/keys", (c) => {
    const agentId = c.get("agentId") as string;
    return c.json({ data: listApiKeys(agentId), error: null });
  });
  app.post("/api/auth/keys", async (c) => {
    const agentId = c.get("agentId") as string;
    const body = await c.req.json<{ name: string; scopes?: string[] }>();
    const { apiKey, rawKey } = await createApiKey(agentId, body.name, body.scopes);
    return c.json({ data: { ...apiKey, raw_key: rawKey }, error: null }, 201);
  });
  app.delete("/api/auth/keys/:id", (c) => { revokeApiKey(c.req.param("id")); return c.json({ data: null, error: null }); });

  // ── Inbound email webhooks ────────────────────────────────────────────────
  // These are intentionally unauthenticated (called by SES/Resend, verified by signature)
  app.post("/api/email/inbound/ses", async (c) => {
    const body = await c.req.json<{ Type?: string; Message?: string; TopicArn?: string }>();
    // Handle SNS subscription confirmation
    if (body.Type === "SubscriptionConfirmation") {
      const sub = body as { SubscribeURL?: string };
      if (sub.SubscribeURL) await fetch(sub.SubscribeURL);
      return c.json({ ok: true });
    }
    // Parse SNS notification containing SES email data
    const message = body.Message ? JSON.parse(body.Message) as { mail?: { source?: string; destination?: string[]; commonHeaders?: { subject?: string[] } } } : body;
    const mail = message.mail ?? message;
    const email: ParsedEmail = {
      from: String((mail as { source?: string }).source ?? ""),
      to: ((mail as { destination?: string[] }).destination ?? []) as string[],
      subject: String(((mail as { commonHeaders?: { subject?: string[] } }).commonHeaders?.subject?.[0]) ?? ""),
    };
    const projectId = c.req.query("project_id") ?? "";
    if (!projectId) return c.json({ error: "project_id query param required" }, 400);
    const result = await processInboundEmail(email, projectId);
    return c.json({ data: result, error: null });
  });

  app.post("/api/email/inbound/resend", async (c) => {
    // Resend sends parsed email data directly
    const body = await c.req.json<{ from?: string; to?: string[]; subject?: string; text?: string; html?: string }>();
    const email: ParsedEmail = {
      from: body.from ?? "",
      to: body.to ?? [],
      subject: body.subject ?? "",
      text: body.text,
      html: body.html,
    };
    const projectId = c.req.query("project_id") ?? "";
    if (!projectId) return c.json({ error: "project_id query param required" }, 400);
    const result = await processInboundEmail(email, projectId);
    return c.json({ data: result, error: null });
  });

  app.post("/api/email/inbound/smtp", async (c) => {
    // Generic MIME parser endpoint (Mailgun, Postmark, etc. forward parsed fields)
    const body = await c.req.json<ParsedEmail>();
    const projectId = c.req.query("project_id") ?? "";
    if (!projectId) return c.json({ error: "project_id query param required" }, 400);
    const result = await processInboundEmail(body, projectId);
    return c.json({ data: result, error: null });
  });

  // ── SSE ──────────────────────────────────────────────────────────────────
  const sseClients = new Set<(event: string) => void>();

  app.get("/sse", (c) => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (event: string) => controller.enqueue(encoder.encode(event));
        send(": connected\n\n");
        sseClients.add(send);
        c.req.raw.signal.addEventListener("abort", () => sseClients.delete(send));
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  });

  // Expose broadcast for internal use
  (app as typeof app & { broadcast: (event: string, data: unknown) => void }).broadcast = (event: string, data: unknown) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const send of sseClients) send(msg);
  };

  // ── Error handler ─────────────────────────────────────────────────────────
  app.onError((err, c) => {
    const name = (err as { name?: string }).name ?? "";
    if (name === "NotFoundError") return c.json({ data: null, error: { code: "NOT_FOUND", message: err.message } }, 404);
    if (name === "ValidationError") return c.json({ data: null, error: { code: "VALIDATION_ERROR", message: err.message } }, 400);
    if (name === "VersionConflictError") return c.json({ data: null, error: { code: "VERSION_CONFLICT", message: err.message } }, 409);
    if (name === "InvalidTransitionError") return c.json({ data: null, error: { code: "INVALID_TRANSITION", message: err.message } }, 400);
    if (name === "AuthError") return c.json({ data: null, error: { code: "UNAUTHORIZED", message: err.message } }, 401);
    console.error("[server error]", err);
    return c.json({ data: null, error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500);
  });

  // ── Serve dashboard SPA ──────────────────────────────────────────────────
  app.get("*", (c) => {
    const dashboardDist = new URL("../../dashboard/dist", import.meta.url).pathname;
    const reqPath = c.req.path === "/" ? "/index.html" : c.req.path;
    const filePath = join(dashboardDist, reqPath);

    if (existsSync(filePath)) {
      const ext = filePath.split(".").pop() ?? "";
      const mime: Record<string, string> = { html: "text/html", js: "application/javascript", css: "text/css", svg: "image/svg+xml", json: "application/json" };
      return new Response(readFileSync(filePath), { headers: { "Content-Type": mime[ext] ?? "application/octet-stream" } });
    }

    const index = join(dashboardDist, "index.html");
    if (existsSync(index)) return new Response(readFileSync(index), { headers: { "Content-Type": "text/html" } });
    return c.json({ error: "Dashboard not built. Run: bun run build:dashboard" }, 404);
  });

  return app;
}

// Only start server when this file is the entrypoint
const app = createApp();
serve({ fetch: app.fetch, port: PORT });
console.log(`open-tickets server running on http://localhost:${PORT}`);

// Initialize DB and start background workers
getDatabase();
import("../lib/sla.ts").then(({ startSlaChecker }) => startSlaChecker()).catch(() => {});
