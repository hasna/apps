#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createTicket, getTicketById, updateTicket, closeTicket, reopenTicket, assignTicket, listTickets, bulkCreateTickets, bulkUpdateTickets, transitionTicket } from "../db/tickets.ts";
import { searchTickets, getSimilarTickets } from "../db/search.ts";
import { createComment, listComments, updateComment, deleteComment } from "../db/comments.ts";
import { createProject, getProjectById, listProjects, updateProject, getProjectStats } from "../db/projects.ts";
import { createLabel, listLabels, deleteLabel } from "../db/labels.ts";
import { createMilestone, listMilestones, closeMilestone } from "../db/milestones.ts";
import { registerAgent, getAgentByName, listAgents, heartbeatAgent } from "../db/agents.ts";
import { createRelation, listRelations, deleteRelation } from "../db/relations.ts";
import { listActivity } from "../db/activity.ts";
import type { TicketType, TicketStatus, Resolution, Priority, Severity, TicketSource, RelationType } from "../types/index.ts";

const server = new Server(
  { name: "open-tickets", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {} } }
);

// ── Tool definitions ─────────────────────────────────────────────────────────

const tools = [
  // Ticket core
  {
    name: "create_ticket",
    description: "Open a new ticket",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project ID or slug" },
        title: { type: "string", description: "Ticket title (max 255 chars)" },
        description: { type: "string", description: "Markdown description" },
        type: { type: "string", enum: ["bug", "feature", "question", "incident", "improvement", "task"] },
        priority: { type: "string", enum: ["none", "low", "medium", "high", "critical"] },
        severity: { type: "string", enum: ["minor", "moderate", "major", "critical", "blocker"] },
        assignee_id: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        source: { type: "string", enum: ["web", "api", "mcp", "cli", "email", "webhook"] },
        is_ai_opened: { type: "boolean" },
        ai_confidence: { type: "number", minimum: 0, maximum: 1 },
        ai_reasoning: { type: "string" },
      },
      required: ["project_id", "title"],
    },
  },
  {
    name: "get_ticket",
    description: "Get a ticket by ID or short ID (e.g. API-0042)",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "Ticket UUID or short ID (API-0042)" } },
      required: ["id"],
    },
  },
  {
    name: "update_ticket",
    description: "Update ticket fields",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        type: { type: "string", enum: ["bug", "feature", "question", "incident", "improvement", "task"] },
        priority: { type: "string", enum: ["none", "low", "medium", "high", "critical"] },
        severity: { type: "string", enum: ["minor", "moderate", "major", "critical", "blocker"] },
        assignee_id: { type: "string" },
        milestone_id: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        due_date: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "close_ticket",
    description: "Close a ticket with a resolution",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        resolution: { type: "string", enum: ["fixed", "wont_fix", "duplicate", "invalid", "by_design"] },
        duplicate_of: { type: "string", description: "Short ID of the original ticket if duplicate" },
      },
      required: ["id", "resolution"],
    },
  },
  {
    name: "reopen_ticket",
    description: "Reopen a closed or resolved ticket",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "assign_ticket",
    description: "Assign a ticket to an agent",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        assignee_id: { type: "string", description: "Agent ID or name (null to unassign)" },
      },
      required: ["id"],
    },
  },
  {
    name: "set_priority",
    description: "Set ticket priority",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        priority: { type: "string", enum: ["none", "low", "medium", "high", "critical"] },
      },
      required: ["id", "priority"],
    },
  },
  {
    name: "set_severity",
    description: "Set ticket severity",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        severity: { type: "string", enum: ["minor", "moderate", "major", "critical", "blocker"] },
      },
      required: ["id", "severity"],
    },
  },
  {
    name: "list_tickets",
    description: "List tickets with optional filters",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string" },
        status: { type: "string", enum: ["open", "in_progress", "in_review", "resolved", "closed"] },
        priority: { type: "string", enum: ["none", "low", "medium", "high", "critical"] },
        type: { type: "string", enum: ["bug", "feature", "question", "incident", "improvement", "task"] },
        assignee_id: { type: "string" },
        label: { type: "string" },
        sla_breached: { type: "boolean" },
        page: { type: "number" },
        per_page: { type: "number" },
        sort: { type: "string", enum: ["created_at", "updated_at", "priority", "status"] },
        order: { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
  {
    name: "search_tickets",
    description: "Full-text search across ticket titles and descriptions",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string" },
        project_id: { type: "string" },
        status: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_similar_tickets",
    description: "Find tickets similar to a given title — use before creating to detect duplicates",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        project_id: { type: "string" },
        limit: { type: "number" },
      },
      required: ["title"],
    },
  },
  {
    name: "set_milestone",
    description: "Assign a ticket to a milestone",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        milestone_id: { type: "string" },
      },
      required: ["id", "milestone_id"],
    },
  },
  {
    name: "add_label",
    description: "Add a label to a ticket",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" }, label: { type: "string" } },
      required: ["id", "label"],
    },
  },
  {
    name: "remove_label",
    description: "Remove a label from a ticket",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" }, label: { type: "string" } },
      required: ["id", "label"],
    },
  },
  {
    name: "link_tickets",
    description: "Create a relation between two tickets",
    inputSchema: {
      type: "object" as const,
      properties: {
        ticket_id: { type: "string" },
        related_ticket_id: { type: "string" },
        relation_type: { type: "string", enum: ["blocks", "blocked_by", "duplicates", "relates_to", "caused_by"] },
      },
      required: ["ticket_id", "related_ticket_id", "relation_type"],
    },
  },
  {
    name: "unlink_tickets",
    description: "Remove a relation between tickets",
    inputSchema: {
      type: "object" as const,
      properties: { relation_id: { type: "string" } },
      required: ["relation_id"],
    },
  },
  // Comments
  {
    name: "add_comment",
    description: "Add a comment to a ticket",
    inputSchema: {
      type: "object" as const,
      properties: {
        ticket_id: { type: "string" },
        content: { type: "string" },
        author_id: { type: "string" },
        is_internal: { type: "boolean", description: "Internal note (not visible to reporter)" },
      },
      required: ["ticket_id", "content"],
    },
  },
  {
    name: "get_comments",
    description: "List all comments on a ticket",
    inputSchema: {
      type: "object" as const,
      properties: {
        ticket_id: { type: "string" },
        include_internal: { type: "boolean" },
      },
      required: ["ticket_id"],
    },
  },
  {
    name: "update_comment",
    description: "Edit a comment",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" }, content: { type: "string" } },
      required: ["id", "content"],
    },
  },
  {
    name: "delete_comment",
    description: "Delete a comment",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "suggest_resolution",
    description: "AI agent posts a resolution suggestion as an internal note",
    inputSchema: {
      type: "object" as const,
      properties: {
        ticket_id: { type: "string" },
        suggestion: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        author_id: { type: "string" },
      },
      required: ["ticket_id", "suggestion"],
    },
  },
  // Projects
  {
    name: "create_project",
    description: "Create a new project",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        ticket_prefix: { type: "string" },
        is_public: { type: "boolean" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_project",
    description: "Get project details",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "list_projects",
    description: "List all projects",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_project_stats",
    description: "Get ticket counts by status for a project",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  // Labels
  {
    name: "create_label",
    description: "Create a label for a project",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string" },
        name: { type: "string" },
        color: { type: "string", description: "Hex color e.g. #f59e0b" },
        description: { type: "string" },
      },
      required: ["project_id", "name"],
    },
  },
  {
    name: "list_labels",
    description: "List labels for a project",
    inputSchema: {
      type: "object" as const,
      properties: { project_id: { type: "string" } },
      required: ["project_id"],
    },
  },
  // Milestones
  {
    name: "create_milestone",
    description: "Create a milestone",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        due_date: { type: "string", description: "ISO date YYYY-MM-DD" },
      },
      required: ["project_id", "name"],
    },
  },
  {
    name: "list_milestones",
    description: "List milestones for a project",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string" },
        status: { type: "string", enum: ["open", "closed"] },
      },
      required: ["project_id"],
    },
  },
  {
    name: "close_milestone",
    description: "Close a milestone",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  // Agents
  {
    name: "register_agent",
    description: "Register an agent identity (idempotent by name)",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        type: { type: "string", enum: ["human", "ai_agent"] },
        email: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_agent",
    description: "Get an agent by name",
    inputSchema: {
      type: "object" as const,
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "list_agents",
    description: "List all registered agents",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "heartbeat",
    description: "Update last_seen_at to signal agent is active",
    inputSchema: {
      type: "object" as const,
      properties: { agent_id: { type: "string" } },
      required: ["agent_id"],
    },
  },
  {
    name: "set_focus",
    description: "Set active project context for this agent session",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent_id: { type: "string" },
        project_id: { type: "string" },
      },
      required: ["agent_id"],
    },
  },
  {
    name: "get_my_tickets",
    description: "Get tickets assigned to a specific agent",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent_id: { type: "string" },
        status: { type: "string", enum: ["open", "in_progress", "in_review", "resolved", "closed"] },
      },
      required: ["agent_id"],
    },
  },
  // Bulk
  {
    name: "bulk_create_tickets",
    description: "Create multiple tickets at once",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string" },
        tickets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              type: { type: "string" },
              priority: { type: "string" },
              description: { type: "string" },
            },
            required: ["title"],
          },
        },
      },
      required: ["project_id", "tickets"],
    },
  },
  {
    name: "bulk_update_tickets",
    description: "Update status/priority/assignee for multiple tickets",
    inputSchema: {
      type: "object" as const,
      properties: {
        updates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              status: { type: "string" },
              priority: { type: "string" },
              assignee_id: { type: "string" },
            },
            required: ["id"],
          },
        },
      },
      required: ["updates"],
    },
  },
  // Analytics
  {
    name: "get_stats",
    description: "Get workspace-wide or project-level ticket stats",
    inputSchema: {
      type: "object" as const,
      properties: { project_id: { type: "string" } },
    },
  },
  {
    name: "get_ticket_activity",
    description: "Get full activity/audit log for a ticket",
    inputSchema: {
      type: "object" as const,
      properties: {
        ticket_id: { type: "string" },
        page: { type: "number" },
        per_page: { type: "number" },
      },
      required: ["ticket_id"],
    },
  },
  {
    name: "get_open_tickets",
    description: "Get all open tickets, optionally scoped to a project",
    inputSchema: {
      type: "object" as const,
      properties: { project_id: { type: "string" }, per_page: { type: "number" } },
    },
  },
  {
    name: "get_overdue_tickets",
    description: "Get tickets that have breached their SLA",
    inputSchema: {
      type: "object" as const,
      properties: { project_id: { type: "string" } },
    },
  },
  {
    name: "get_unassigned_tickets",
    description: "Get open tickets with no assignee",
    inputSchema: {
      type: "object" as const,
      properties: { project_id: { type: "string" } },
    },
  },
  // Bootstrap
  {
    name: "bootstrap",
    description: "Initialize a workspace with a project and default labels",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspace_name: { type: "string" },
        project_name: { type: "string" },
        ticket_prefix: { type: "string" },
      },
      required: ["project_name"],
    },
  },
  // Feedback
  {
    name: "send_feedback",
    description: "Send feedback about this service",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: { type: "string", description: "Feedback message" },
        email: { type: "string", description: "Contact email (optional)" },
        category: { type: "string", enum: ["bug", "feature", "general"], description: "Feedback category" },
      },
      required: ["message"],
    },
  },
];

// ── Tool handler ─────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    const result = await handleTool(name, args as Record<string, unknown>);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

async function handleTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "create_ticket": {
      return createTicket({
        project_id: args["project_id"] as string,
        title: args["title"] as string,
        description: args["description"] as string | undefined,
        type: args["type"] as TicketType | undefined,
        priority: args["priority"] as Priority | undefined,
        severity: args["severity"] as Severity | undefined,
        assignee_id: args["assignee_id"] as string | undefined,
        labels: args["labels"] as string[] | undefined,
        source: (args["source"] as TicketSource | undefined) ?? "mcp",
        is_ai_opened: args["is_ai_opened"] as boolean | undefined,
        ai_confidence: args["ai_confidence"] as number | undefined,
        ai_reasoning: args["ai_reasoning"] as string | undefined,
      });
    }
    case "get_ticket": return getTicketById(args["id"] as string);
    case "update_ticket": {
      const { id, ...rest } = args;
      return updateTicket(id as string, rest as Parameters<typeof updateTicket>[1]);
    }
    case "close_ticket":
      return closeTicket(args["id"] as string, {
        resolution: args["resolution"] as Resolution,
        duplicate_of: args["duplicate_of"] as string | undefined,
      });
    case "reopen_ticket": return reopenTicket(args["id"] as string);
    case "assign_ticket": return assignTicket(args["id"] as string, args["assignee_id"] as string | null);
    case "set_priority": return updateTicket(args["id"] as string, { priority: args["priority"] as Priority });
    case "set_severity": return updateTicket(args["id"] as string, { severity: args["severity"] as Severity });
    case "set_milestone": return updateTicket(args["id"] as string, { milestone_id: args["milestone_id"] as string });
    case "add_label": {
      const ticket = await getTicketById(args["id"] as string);
      const labels = [...ticket.labels, args["label"] as string].filter((l, i, a) => a.indexOf(l) === i);
      return updateTicket(ticket.id, { labels });
    }
    case "remove_label": {
      const ticket = getTicketById(args["id"] as string);
      const labels = (ticket as Awaited<ReturnType<typeof getTicketById>>).labels.filter((l) => l !== args["label"]);
      return updateTicket((ticket as Awaited<ReturnType<typeof getTicketById>>).id, { labels });
    }
    case "link_tickets":
      return createRelation(args["ticket_id"] as string, args["related_ticket_id"] as string, args["relation_type"] as RelationType);
    case "unlink_tickets": return deleteRelation(args["relation_id"] as string);
    case "list_tickets": {
      const { project_id, status, priority, type, assignee_id, label, sla_breached, page, per_page, sort, order } = args;
      return listTickets({ project_id: project_id as string | undefined, status: status as TicketStatus | undefined, priority: priority as Priority | undefined, type: type as TicketType | undefined, assignee_id: assignee_id as string | undefined, label: label as string | undefined, sla_breached: sla_breached as boolean | undefined, page: page as number | undefined, per_page: per_page as number | undefined, sort: sort as "created_at" | "updated_at" | "priority" | "status" | undefined, order: order as "asc" | "desc" | undefined });
    }
    case "search_tickets": {
      const { query, project_id, status, limit } = args;
      return searchTickets(query as string, { project_id: project_id as string | undefined, status: status as TicketStatus | undefined, per_page: (limit as number | undefined) ?? 20 });
    }
    case "get_similar_tickets":
      return getSimilarTickets(args["title"] as string, args["project_id"] as string | undefined, (args["limit"] as number | undefined) ?? 5);
    case "add_comment":
      return createComment({ ticket_id: args["ticket_id"] as string, content: args["content"] as string, author_id: args["author_id"] as string | undefined, is_internal: args["is_internal"] as boolean | undefined, type: "comment" });
    case "get_comments":
      return listComments(args["ticket_id"] as string, args["include_internal"] as boolean ?? true);
    case "update_comment":
      return updateComment(args["id"] as string, args["content"] as string);
    case "delete_comment":
      return deleteComment(args["id"] as string);
    case "suggest_resolution":
      return createComment({ ticket_id: args["ticket_id"] as string, content: `**AI Suggestion** (confidence: ${((args["confidence"] as number | undefined) ?? 0) * 100}%)\n\n${args["suggestion"] as string}`, author_id: args["author_id"] as string | undefined, is_internal: true, type: "ai_suggestion", metadata: { confidence: args["confidence"] ?? null } });
    case "create_project":
      return createProject({ name: args["name"] as string, description: args["description"] as string | undefined, ticket_prefix: args["ticket_prefix"] as string | undefined, is_public: args["is_public"] as boolean | undefined });
    case "get_project": return getProjectById(args["id"] as string);
    case "list_projects": return listProjects();
    case "get_project_stats": return getProjectStats(args["id"] as string);
    case "create_label":
      return createLabel(args["project_id"] as string, args["name"] as string, args["color"] as string | undefined, args["description"] as string | undefined);
    case "list_labels": return listLabels(args["project_id"] as string);
    case "create_milestone":
      return createMilestone(args["project_id"] as string, args["name"] as string, args["description"] as string | undefined, args["due_date"] as string | undefined);
    case "list_milestones":
      return listMilestones(args["project_id"] as string, args["status"] as "open" | "closed" | undefined);
    case "close_milestone": return closeMilestone(args["id"] as string);
    case "register_agent":
      return registerAgent({ name: args["name"] as string, type: args["type"] as "human" | "ai_agent" | undefined, email: args["email"] as string | undefined });
    case "get_agent": return getAgentByName(args["name"] as string);
    case "list_agents": return listAgents();
    case "heartbeat": {
      const agent = heartbeatAgent(args["agent_id"] as string);
      if (!agent) throw new Error(`Agent not found: ${args["agent_id"]}`);
      return { id: agent.id, name: agent.name, last_seen_at: agent.last_seen_at };
    }
    case "set_focus":
      return { ok: true, agent_id: args["agent_id"], project_id: args["project_id"] ?? null };
    case "get_my_tickets":
      return listTickets({ assignee_id: args["agent_id"] as string, status: args["status"] as TicketStatus | undefined });
    case "bulk_create_tickets": {
      const items = (args["tickets"] as Array<Record<string, unknown>>).map((t) => ({ ...t, project_id: args["project_id"] as string } as Parameters<typeof bulkCreateTickets>[0][0]));
      return bulkCreateTickets(items);
    }
    case "bulk_update_tickets":
      return bulkUpdateTickets(args["updates"] as Parameters<typeof bulkUpdateTickets>[0]);
    case "get_stats":
      return args["project_id"] ? getProjectStats(args["project_id"] as string) : { message: "Pass project_id for project stats" };
    case "get_ticket_activity":
      return listActivity(args["ticket_id"] as string, { page: args["page"] as number | undefined, per_page: args["per_page"] as number | undefined });
    case "get_open_tickets":
      return listTickets({ status: "open", project_id: args["project_id"] as string | undefined, per_page: (args["per_page"] as number | undefined) ?? 50 });
    case "get_overdue_tickets":
      return listTickets({ sla_breached: true, project_id: args["project_id"] as string | undefined });
    case "get_unassigned_tickets":
      return listTickets({ status: "open", project_id: args["project_id"] as string | undefined }).then
        ? listTickets({ status: "open", project_id: args["project_id"] as string | undefined })
        : listTickets({ status: "open", project_id: args["project_id"] as string | undefined });
    case "bootstrap": {
      const project = createProject({ name: args["project_name"] as string, ticket_prefix: args["ticket_prefix"] as string | undefined });
      createLabel(project.id, "bug", "#ef4444");
      createLabel(project.id, "feature", "#3b82f6");
      createLabel(project.id, "question", "#8b5cf6");
      createLabel(project.id, "urgent", "#f97316");
      createLabel(project.id, "wontfix", "#6b7280");
      return { project, message: "Bootstrapped with default labels" };
    }
    case "send_feedback": {
      const db = (await import("../db/database.ts")).getDatabase();
      const pkg = await import("../../package.json");
      db.run("INSERT INTO feedback (id, message, email, category, version) VALUES (?, ?, ?, ?, ?)", [
        crypto.randomUUID().replace(/-/g, "").slice(0, 32),
        args["message"] as string,
        (args["email"] as string) || null,
        (args["category"] as string) || "general",
        pkg.version ?? null,
      ]);
      return { message: "Feedback saved. Thank you!" };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Resources ────────────────────────────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: "tickets://projects", name: "Projects", description: "All projects", mimeType: "application/json" },
    { uri: "tickets://tickets", name: "Open Tickets", description: "Currently open tickets", mimeType: "application/json" },
    { uri: "tickets://labels", name: "Labels", description: "All labels", mimeType: "application/json" },
    { uri: "tickets://agents", name: "Agents", description: "Registered agents", mimeType: "application/json" },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  let data: unknown;

  if (uri === "tickets://projects") data = listProjects();
  else if (uri === "tickets://tickets") data = listTickets({ status: "open", per_page: 50 });
  else if (uri === "tickets://agents") data = listAgents();
  else data = { error: "Unknown resource" };

  return {
    contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
  };
});

// ── Main ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
