// @ts-nocheck
/**
 * Task advanced tools for the MCP server.
 * Auto-extracted from src/mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Task } from "../../types/index.js";

interface TaskAdvContext {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table?: string) => string;
  formatError: (error: unknown) => string;
  formatTask: (task: Task) => string;
  formatTaskDetail: (task: Task, maxDescriptionChars?: number) => string;
  getAgentFocus: (agentId: string) => { agent_id: string; project_id?: string } | undefined;
}

export function registerTaskAdvTools(server: McpServer, ctx: TaskAdvContext) {
  const { shouldRegisterTool, resolveId, formatError, formatTask, formatTaskDetail } = ctx;

  // === STATUS / CONTEXT ===

  if (shouldRegisterTool("get_status")) {
    server.tool(
      "get_status",
      "Get a task's current status including blockers, dependencies, comments, and assignee.",
      {
        task_id: z.string().describe("Task ID"),
      },
      async ({ task_id }) => {
        try {
          const resolvedId = resolveId(task_id);
          const { getTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const task = getTask(resolvedId);
          if (!task) throw new Error(`Task not found: ${task_id}`);
          const { getTaskDependencies } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const { listComments } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const { listTaskFiles } = require("../../db/task-files.js") as any;
          const [deps, comments, files] = await Promise.all([
            Promise.resolve(getTaskDependencies(resolvedId, "both")),
            Promise.resolve(listComments(resolvedId)),
            Promise.resolve(listTaskFiles(resolvedId)),
          ]);
          const lines = [
            `Status: ${task.status} | Priority: ${task.priority}`,
            task.assigned_to ? `Assigned: ${task.assigned_to}` : "Unassigned",
            task.deadline ? `Deadline: ${task.deadline}` : null,
            task.confidence != null ? `Confidence: ${task.confidence}` : null,
            deps.length > 0 ? `\nDependencies (${deps.length}):` : null,
            ...deps.map((d: any) => `  [${d.direction}] ${d.task_id.slice(0,8)} (${d.status})`),
            comments.length > 0 ? `\nComments (${comments.length}):` : null,
            ...comments.map((c: any) => `  [${c.author || "?"}] ${c.created_at?.slice(0,16)}: ${c.body.slice(0,80)}`),
            files.length > 0 ? `\nFiles (${files.length}):` : null,
            ...files.map((f: any) => `  ${f.status} ${f.path}`),
          ].filter(Boolean);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("task_context")) {
    server.tool(
      "task_context",
      "Get full context for a task: details, dependencies, relationships, comments, files, commits, time logs, and watchers.",
      {
        task_id: z.string().describe("Task ID"),
      },
      async ({ task_id }) => {
        try {
          const resolvedId = resolveId(task_id);
          const { getTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const task = getTask(resolvedId);
          if (!task) throw new Error(`Task not found: ${task_id}`);
          const { getTaskDependencies } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const { getTaskRelationships } = require("../../db/task-relationships.js") as typeof import("../../db/task-relationships.js");
          const { listComments } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const { listTaskFiles } = require("../../db/task-files.js") as any;
          const { getTaskCommits } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const { getTaskWatchers } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const [deps, rels, comments, files, commits, watchers] = await Promise.all([
            Promise.resolve(getTaskDependencies(resolvedId, "both")),
            Promise.resolve(getTaskRelationships(resolvedId)),
            Promise.resolve(listComments(resolvedId)),
            Promise.resolve(listTaskFiles(resolvedId)),
            Promise.resolve(getTaskCommits(resolvedId)),
            Promise.resolve(getTaskWatchers(resolvedId)),
          ]);
          const lines = [
            `== ${task.title} ====================`,
            `ID:       ${task.id}`,
            `Status:   ${task.status} | Priority: ${task.priority}`,
            task.short_id ? `Short ID: ${task.short_id}` : null,
            task.assigned_to ? `Assigned: ${task.assigned_to}` : null,
            task.project_id ? `Project:  ${task.project_id}` : null,
            task.depends_on?.length ? `Depends:  ${task.depends_on.join(", ")}` : null,
            task.tags?.length ? `Tags:     ${task.tags.join(", ")}` : null,
            task.created_at ? `Created:  ${task.created_at}` : null,
            task.updated_at ? `Updated:  ${task.updated_at}` : null,
            task.deadline ? `Deadline: ${task.deadline}` : null,
            task.completed_at ? `Completed: ${task.completed_at}` : null,
            deps.length > 0 ? `\n--- Dependencies (${deps.length}) ---` : null,
            ...deps.map((d: any) => `  [${d.direction}] ${d.task_id.slice(0,8)} (${d.status})`),
            rels.length > 0 ? `\n--- Relationships (${rels.length}) ---` : null,
            ...rels.map((r: any) => `  ${r.source_task_id.slice(0,8)} --[${r.relationship_type}]--> ${r.target_task_id.slice(0,8)}`),
            comments.length > 0 ? `\n--- Comments (${comments.length}) ---` : null,
            ...comments.map((c: any) => `  [${c.author || "?"}] ${c.created_at?.slice(0,16)}: ${c.body.slice(0,120)}`),
            files.length > 0 ? `\n--- Files (${files.length}) ---` : null,
            ...files.map((f: any) => `  [${f.status}] ${f.path}`),
            commits.length > 0 ? `\n--- Commits (${commits.length}) ---` : null,
            ...commits.map((c: any) => `  ${c.sha.slice(0,8)}: ${c.message || "(no message)"}`),
            watchers.length > 0 ? `\n--- Watchers (${watchers.length}) ---` : null,
            ...watchers.map((w: any) => `  ${w.agent_id}`),
            task.description ? `\n--- Description ---\n${task.description}` : null,
            task.metadata && Object.keys(task.metadata).length > 0 ? `\n--- Metadata ---\n${JSON.stringify(task.metadata, null, 2)}` : null,
          ].filter(Boolean);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === STANDUP ===

  if (shouldRegisterTool("standup")) {
    server.tool(
      "standup",
      "Get a standup report: in-progress tasks, completed yesterday, and blockers for an agent.",
      {
        agent_id: z.string().optional().describe("Agent ID (defaults to context agent)"),
        project_id: z.string().optional().describe("Filter by project"),
      },
      async ({ agent_id, project_id }) => {
        try {
          const { listTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const focus = ctx.getAgentFocus(agent_id || "");
          const effectiveAgentId = focus ? focus.agent_id : agent_id || "";
          const effectiveProjectId = focus?.project_id || project_id;

          const inProgress = listTasks({
            assigned_to: effectiveAgentId,
            status: "in_progress",
            project_id: effectiveProjectId ? resolveId(effectiveProjectId, "projects") : undefined,
          }, undefined) as Task[];

          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().slice(0, 10);

          const completed = listTasks({
            assigned_to: effectiveAgentId,
            status: "completed",
            project_id: effectiveProjectId ? resolveId(effectiveProjectId, "projects") : undefined,
            limit: 20,
          }, undefined) as Task[];
          const completedYesterday = completed.filter(t => t.completed_at && t.completed_at.startsWith(yesterdayStr));

          const { getBlockedTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const blocked = getBlockedTasks(effectiveProjectId ? resolveId(effectiveProjectId, "projects") : undefined)
            .filter((t: any) => t.assigned_to === effectiveAgentId);

          const lines = [
            `Standup for ${effectiveAgentId} (${effectiveProjectId ? `project: ${effectiveProjectId.slice(0,8)}` : "all projects"})`,
            inProgress.length > 0 ? `\nIn Progress (${inProgress.length}):` : "\nNo tasks in progress.",
            ...inProgress.map(t => `  - ${t.title} (${t.id.slice(0,8)})`),
            completedYesterday.length > 0 ? `\nCompleted Yesterday (${completedYesterday.length}):` : "\nNo tasks completed yesterday.",
            ...completedYesterday.map(t => `  - ${t.title} (${t.id.slice(0,8)})`),
            blocked.length > 0 ? `\nBlocked (${blocked.length}):` : "\nNo blocked tasks.",
            ...blocked.map(t => `  - ${t.title} (${t.id.slice(0,8)})`),
          ].filter(Boolean);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === BACKWARD COMPATIBILITY aliases ===

  if (shouldRegisterTool("claim_task")) {
    server.tool(
      "claim_task",
      "Alias for start_task — mark a task as in_progress and assign it to the calling agent.",
      {
        task_id: z.string().describe("Task ID"),
        agent_id: z.string().optional().describe("Agent claiming (defaults to context)"),
      },
      async ({ task_id, agent_id }) => {
        try {
          const { updateTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolvedId = resolveId(task_id);
          const focus = ctx.getAgentFocus(agent_id || "");
          const effectiveAgent = focus ? focus.agent_id : agent_id || "";
          const task = updateTask(resolvedId, { status: "in_progress", assigned_to: effectiveAgent });
          return { content: [{ type: "text" as const, text: formatTask(task) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("release_task")) {
    server.tool(
      "release_task",
      "Unassign a task and mark it pending.",
      {
        task_id: z.string().describe("Task ID"),
      },
      async ({ task_id }) => {
        try {
          const { updateTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const task = updateTask(resolveId(task_id), { status: "pending", assigned_to: null });
          return { content: [{ type: "text" as const, text: formatTask(task) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("extend_task")) {
    server.tool(
      "extend_task",
      "Add more time to a task's estimate.",
      {
        task_id: z.string().describe("Task ID"),
        minutes: z.number().describe("Additional minutes to add to estimate"),
      },
      async ({ task_id, minutes }) => {
        try {
          const { getTask, updateTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolvedId = resolveId(task_id);
          const task = getTask(resolvedId);
          if (!task) throw new Error(`Task not found: ${task_id}`);
          const currentEstimate = task.estimated_minutes || 0;
          const updated = updateTask(resolvedId, { estimated_minutes: currentEstimate + minutes });
          return { content: [{ type: "text" as const, text: `Estimate updated: ${currentEstimate} → ${updated.estimated_minutes} min (+${minutes})` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("add_comment")) {
    server.tool(
      "add_comment",
      "Alias for create_comment.",
      {
        task_id: z.string().describe("Task ID"),
        body: z.string().describe("Comment body"),
        author: z.string().optional().describe("Author agent ID or name"),
      },
      async ({ task_id, body, author }) => {
        try {
          const { createComment } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolvedId = resolveId(task_id);
          const resolvedAuthor = author ? resolveId(author, "agents") : undefined;
          createComment({ task_id: resolvedId, body, author: resolvedAuthor });
          return { content: [{ type: "text" as const, text: `Comment added to ${task_id.slice(0,8)}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_comments")) {
    server.tool(
      "get_comments",
      "Alias for list_comments.",
      {
        task_id: z.string().describe("Task ID"),
      },
      async ({ task_id }) => {
        try {
          const { listComments } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const comments = listComments(resolveId(task_id));
          if (comments.length === 0) return { content: [{ type: "text" as const, text: "No comments." }] };
          const lines = comments.map(c => `[${c.author || "?"}] ${c.created_at?.slice(0,16)}: ${c.body}`);
          return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_my_tasks")) {
    server.tool(
      "list_my_tasks",
      "Alias for get_my_tasks.",
      {
        agent_id: z.string().optional().describe("Agent ID (defaults to context agent)"),
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
        project_id: z.string().optional().describe("Filter by project"),
        limit: z.number().optional(),
      },
      async ({ agent_id, status, project_id, limit }) => {
        try {
          const { listTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const focus = ctx.getAgentFocus(agent_id || "");
          const effectiveAgentId = focus ? focus.agent_id : agent_id || "";
          const effectiveProjectId = focus?.project_id || project_id;
          const tasks = listTasks({
            assigned_to: effectiveAgentId,
            status,
            project_id: effectiveProjectId ? resolveId(effectiveProjectId, "projects") : undefined,
            limit: limit || 50,
          }, undefined) as Task[];
          if (tasks.length === 0) return { content: [{ type: "text" as const, text: "No tasks found." }] };
          const lines = tasks.map(formatTask);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_agents")) {
    server.tool(
      "list_agents",
      "List all registered agents.",
      {
        project_id: z.string().optional().describe("Filter by project"),
        role: z.string().optional().describe("Filter by global role"),
        capabilities: z.array(z.string()).optional().describe("Filter by capabilities"),
      },
      async ({ project_id, role, capabilities }) => {
        try {
          const { listAgents } = require("../../db/agents.js") as typeof import("../../db/agents.js");
          const resolved: Record<string, unknown> = {};
          if (project_id) resolved.project_id = resolveId(project_id, "projects");
          if (role) resolved.role = role;
          if (capabilities) resolved.capabilities = capabilities;
          const agents = listAgents(resolved as Parameters<typeof listAgents>[0]);
          if (agents.length === 0) return { content: [{ type: "text" as const, text: "No agents found." }] };
          const lines = agents.map(a => `● ${a.name} [${a.role || "no role"}]${a.capabilities?.length ? ` caps:[${a.capabilities.join(",")}]` : ""}`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_agent")) {
    server.tool(
      "get_agent",
      "Get full details for an agent.",
      {
        agent_id: z.string().describe("Agent ID or name"),
      },
      async ({ agent_id }) => {
        try {
          const { getAgentByName, getAgent } = require("../../db/agents.js") as typeof import("../../db/agents.js");
          const resolvedId = resolveId(agent_id, "agents");
          const agent = agent_id.includes("@") || !resolvedId.startsWith("agent_")
            ? getAgentByName(agent_id)
            : getAgent(resolvedId);
          if (!agent) return { content: [{ type: "text" as const, text: `Agent not found: ${agent_id}` }], isError: true };
          const lines = [
            `ID:          ${agent.id}`,
            `Name:        ${agent.name}`,
            agent.email ? `Email:       ${agent.email}` : null,
            agent.title ? `Title:       ${agent.title}` : null,
            agent.role ? `Role:        ${agent.role}` : null,
            agent.capabilities?.length ? `Capabilities: ${agent.capabilities.join(", ")}` : null,
            agent.last_seen_at ? `Last Seen:   ${agent.last_seen_at}` : null,
          ].filter(Boolean);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_agent")) {
    server.tool(
      "update_agent",
      "Update an agent's fields.",
      {
        agent_id: z.string().describe("Agent ID or name"),
        name: z.string().optional(),
        email: z.string().optional(),
        title: z.string().optional(),
        role: z.string().optional(),
        capabilities: z.array(z.string()).optional(),
      },
      async ({ agent_id, ...updates }) => {
        try {
          const { getAgentByName, updateAgent } = require("../../db/agents.js") as typeof import("../../db/agents.js");
          const resolvedId = resolveId(agent_id, "agents");
          const agent = agent_id.includes("@") || !resolvedId.startsWith("agent_")
            ? getAgentByName(agent_id)
            : { id: resolvedId };
          updateAgent(agent.id, updates as Parameters<typeof updateAgent>[1]);
          return { content: [{ type: "text" as const, text: `Agent ${agent.id.slice(0,8)} updated.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_agent")) {
    server.tool(
      "delete_agent",
      "Deregister an agent.",
      {
        agent_id: z.string().describe("Agent ID or name"),
      },
      async ({ agent_id }) => {
        try {
          const { getAgentByName, deleteAgent } = require("../../db/agents.js") as typeof import("../../db/agents.js");
          const resolvedId = resolveId(agent_id, "agents");
          const agent = agent_id.includes("@") || !resolvedId.startsWith("agent_")
            ? getAgentByName(agent_id)
            : { id: resolvedId };
          if (!agent) return { content: [{ type: "text" as const, text: `Agent not found: ${agent_id}` }], isError: true };
          deleteAgent(agent.id);
          return { content: [{ type: "text" as const, text: `Agent ${agent_id} deleted.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("register_agent")) {
    server.tool(
      "register_agent",
      "Register a new agent.",
      {
        name: z.string().describe("Agent name"),
        email: z.string().optional(),
        title: z.string().optional(),
        role: z.string().optional(),
        capabilities: z.array(z.string()).optional(),
      },
      async ({ name, email, title, role, capabilities }) => {
        try {
          const { registerAgent } = require("../../db/agents.js") as typeof import("../../db/agents.js");
          const agent = registerAgent({ name, email, title, role, capabilities });
          return { content: [{ type: "text" as const, text: `Agent registered: ${agent.name} (${agent.id})` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("heartbeat")) {
    server.tool(
      "heartbeat",
      "Agent heartbeat — updates last_seen_at timestamp.",
      {
        agent_id: z.string().describe("Agent ID"),
        status: z.string().optional().describe("Current status message"),
      },
      async ({ agent_id, status }) => {
        try {
          const { heartbeat } = require("../../db/agents.js") as typeof import("../../db/agents.js");
          heartbeat(resolveId(agent_id, "agents"), status);
          return { content: [{ type: "text" as const, text: "Heartbeat received." }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
