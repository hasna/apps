/**
 * Task tools: create, read, list, update, complete, delete tasks,
 * subtasks, dependencies, comments, activity.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createTask,
  getTask,
  listTasks,
  startTask,
  completeTask,
  cancelTask,
  blockTask,
  unblockTask,
  reopenTask,
  assignTask,
  setTaskPriority,
  addComment,
  getComments,
  getSubtasks,
  getTaskTree,
  addDependency,
  removeDependency,
  getDependencies,
  getDependents,
  getTaskActivity,
  deleteTask,
  getDueTasks,
  getTaskSummary,
  searchTasks,
} from "../../lib/tasks.js";
import { resolveIdentity } from "../../lib/identity.js";

export function registerTaskTools(server: McpServer): void {

  // ---- Create Task ----
  server.registerTool("create_task", {
    description: "Create a new task with optional assignee, priority, parent (subtask), dependencies, tags, and metadata.",
    inputSchema: {
      subject: z.string(),
      description: z.string().optional(),
      reporter: z.string().optional(),
      assignee: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      project_id: z.string().optional(),
      channel: z.string().optional(),
      parent_id: z.coerce.number().optional(),
      depends_on: z.array(z.coerce.number()).optional(),
      tags: z.array(z.string()).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      due_at: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    if (!args.reporter) {
      try { args.reporter = resolveIdentity(undefined); } catch { args.reporter = "unknown"; }
    }
    const task = createTask({
      subject: args.subject,
      description: args.description,
      reporter: args.reporter,
      assignee: args.assignee,
      priority: args.priority,
      project_id: args.project_id,
      channel: args.channel,
      parent_id: args.parent_id,
      depends_on: args.depends_on,
      tags: args.tags,
      metadata: args.metadata,
      due_at: args.due_at,
    });
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- Get Task ----
  server.registerTool("get_task", {
    description: "Get a task by id or uuid. Returns enriched TaskInfo with subtask count, comment count, dependency count, and blocker info.",
    inputSchema: {
      id: z.coerce.number().optional(),
      uuid: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const lookup = args.id ?? args.uuid;
    if (!lookup) return { content: [{ type: "text", text: "id or uuid required" }], isError: true };
    const task = getTask(lookup);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${lookup}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- List Tasks ----
  server.registerTool("list_tasks", {
    description: "List tasks with optional filters. Default: 50 tasks, sorted by priority then date. Use 'tags' for AND-matching multiple tags. Use 'metadata' to filter by metadata key/value pairs.",
    inputSchema: {
      status: z.enum(["pending", "in_progress", "completed", "cancelled", "blocked"]).optional(),
      assignee: z.string().optional(),
      reporter: z.string().optional(),
      project_id: z.string().optional(),
      channel: z.string().optional(),
      parent_id: z.coerce.number().nullable().optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      tag: z.string().optional(),
      tags: z.array(z.string()).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      limit: z.coerce.number().optional(),
      offset: z.coerce.number().optional(),
      include_archived: z.coerce.boolean().optional(),
    },
  }, async (args: Record<string, any>) => {
    const tasks = listTasks(args);
    return { content: [{ type: "text", text: JSON.stringify({ tasks, count: tasks.length }) }] };
  });

  // ---- Start Task ----
  server.registerTool("start_task", {
    description: "Mark a task as in_progress. Fails if any dependency is not completed.",
    inputSchema: {
      id: z.coerce.number(),
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const task = startTask(args.id, agent);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${args.id}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- Complete Task ----
  server.registerTool("complete_task", {
    description: "Mark a task as completed. Auto-unblocks any dependent tasks that now have all dependencies completed.",
    inputSchema: {
      id: z.coerce.number(),
      agent: z.string().optional(),
      evidence: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const task = completeTask(args.id, agent, args.evidence ? { evidence: args.evidence } : undefined);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${args.id}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- Cancel Task ----
  server.registerTool("cancel_task", {
    description: "Cancel a task with optional reason.",
    inputSchema: {
      id: z.coerce.number(),
      agent: z.string().optional(),
      reason: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const task = cancelTask(args.id, agent, args.reason ? { reason: args.reason } : undefined);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${args.id}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- Block Task ----
  server.registerTool("block_task", {
    description: "Manually block a task with optional reason.",
    inputSchema: {
      id: z.coerce.number(),
      agent: z.string().optional(),
      reason: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const task = blockTask(args.id, agent, args.reason ? { reason: args.reason } : undefined);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${args.id}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- Unblock Task ----
  server.registerTool("unblock_task", {
    description: "Unblock a task. Sets to 'pending' if all dependencies are completed, otherwise stays 'blocked'.",
    inputSchema: {
      id: z.coerce.number(),
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const task = unblockTask(args.id, agent);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${args.id}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- Reopen Task ----
  server.registerTool("reopen_task", {
    description: "Reopen a completed or cancelled task back to pending. Re-checks dependencies.",
    inputSchema: {
      id: z.coerce.number(),
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const task = reopenTask(args.id, agent);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${args.id}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- Assign Task ----
  server.registerTool("assign_task", {
    description: "Assign a task to an agent.",
    inputSchema: {
      id: z.coerce.number(),
      assignee: z.string(),
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const task = assignTask(args.id, args.assignee, agent);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${args.id}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- Set Task Priority ----
  server.registerTool("set_task_priority", {
    description: "Change a task's priority: low, medium, high, critical.",
    inputSchema: {
      id: z.coerce.number(),
      priority: z.enum(["low", "medium", "high", "critical"]),
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const task = setTaskPriority(args.id, args.priority, agent);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${args.id}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- Delete Task ----
  server.registerTool("delete_task", {
    description: "Delete a task. Fails if subtasks still reference it.",
    inputSchema: {
      id: z.coerce.number(),
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const deleted = deleteTask(args.id, agent);
    return { content: [{ type: "text", text: JSON.stringify({ deleted, id: args.id }) }] };
  });

  // ---- Add Comment ----
  server.registerTool("add_comment", {
    description: "Add a comment to a task.",
    inputSchema: {
      task_id: z.coerce.number(),
      content: z.string(),
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const comment = addComment(args.task_id, agent, args.content);
    return { content: [{ type: "text", text: JSON.stringify(comment) }] };
  });

  // ---- Get Comments ----
  server.registerTool("get_comments", {
    description: "Get all comments on a task, ordered by creation time.",
    inputSchema: {
      task_id: z.coerce.number(),
    },
  }, async (args: Record<string, any>) => {
    const comments = getComments(args.task_id);
    return { content: [{ type: "text", text: JSON.stringify({ comments, count: comments.length }) }] };
  });

  // ---- Get Subtasks ----
  server.registerTool("get_subtasks", {
    description: "Get direct children (subtasks) of a parent task.",
    inputSchema: {
      parent_id: z.coerce.number(),
    },
  }, async (args: Record<string, any>) => {
    const subtasks = getSubtasks(args.parent_id);
    return { content: [{ type: "text", text: JSON.stringify({ subtasks, count: subtasks.length }) }] };
  });

  // ---- Get Task Tree ----
  server.registerTool("get_task_tree", {
    description: "Get a task with its full subtask tree (recursive, max depth 5).",
    inputSchema: {
      parent_id: z.coerce.number(),
      max_depth: z.coerce.number().optional(),
    },
  }, async (args: Record<string, any>) => {
    const tree = getTaskTree(args.parent_id, args.max_depth ?? 5);
    return { content: [{ type: "text", text: JSON.stringify(tree) }] };
  });

  // ---- Add Dependency ----
  server.registerTool("add_dependency", {
    description: "Add a dependency: task_id depends on depends_on_id. Prevents circular dependencies. Auto-blocks if dependency not completed.",
    inputSchema: {
      task_id: z.coerce.number(),
      depends_on_id: z.coerce.number(),
    },
  }, async (args: Record<string, any>) => {
    addDependency(args.task_id, args.depends_on_id);
    return { content: [{ type: "text", text: `Task #${args.task_id} now depends on #${args.depends_on_id}` }] };
  });

  // ---- Remove Dependency ----
  server.registerTool("remove_dependency", {
    description: "Remove a dependency between two tasks.",
    inputSchema: {
      task_id: z.coerce.number(),
      depends_on_id: z.coerce.number(),
    },
  }, async (args: Record<string, any>) => {
    removeDependency(args.task_id, args.depends_on_id);
    return { content: [{ type: "text", text: `Removed dependency: #${args.task_id} no longer depends on #${args.depends_on_id}` }] };
  });

  // ---- Get Dependencies ----
  server.registerTool("get_dependencies", {
    description: "Get tasks that this task depends on (what must be completed first).",
    inputSchema: {
      task_id: z.coerce.number(),
    },
  }, async (args: Record<string, any>) => {
    const deps = getDependencies(args.task_id);
    return { content: [{ type: "text", text: JSON.stringify({ dependencies: deps, count: deps.length }) }] };
  });

  // ---- Get Dependents ----
  server.registerTool("get_dependents", {
    description: "Get tasks that depend on this task (what is blocked by this).",
    inputSchema: {
      task_id: z.coerce.number(),
    },
  }, async (args: Record<string, any>) => {
    const deps = getDependents(args.task_id);
    return { content: [{ type: "text", text: JSON.stringify({ dependents: deps, count: deps.length }) }] };
  });

  // ---- Get Task Activity ----
  server.registerTool("get_task_activity", {
    description: "Get activity log for a task: status changes, comments, dependency changes.",
    inputSchema: {
      task_id: z.coerce.number(),
      limit: z.coerce.number().optional(),
    },
  }, async (args: Record<string, any>) => {
    const activity = getTaskActivity(args.task_id, args.limit ?? 50);
    return { content: [{ type: "text", text: JSON.stringify({ activity, count: activity.length }) }] };
  });

  // ---- Get Due Tasks ----
  server.registerTool("get_due_tasks", {
    description: "Get tasks with approaching or past due dates. Returns tasks that are overdue, due today, or due within the specified window (default 24h). Ordered by due_at ascending. Excludes completed and cancelled tasks.",
    inputSchema: {
      window_hours: z.coerce.number().optional(),
    },
  }, async (args: Record<string, any>) => {
    const due = getDueTasks({ window_hours: args.window_hours });
    return { content: [{ type: "text", text: JSON.stringify({ tasks: due, count: due.length }) }] };
  });

  // ---- Get Task Summary ----
  server.registerTool("get_task_summary", {
    description: "Get a structured summary of a task including progress metrics, recent activity, blockers, and dependents. Returns subtask progress, dependency progress, completion percentage, and recent activity log.",
    inputSchema: {
      id: z.coerce.number().optional(),
      uuid: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const lookup = args.id ?? args.uuid;
    if (!lookup) return { content: [{ type: "text", text: "id or uuid required" }], isError: true };
    const summary = getTaskSummary(lookup);
    if (!summary) return { content: [{ type: "text", text: `Task not found: ${lookup}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(summary) }] };
  });

  // ---- Search Tasks ----
  server.registerTool("search_tasks", {
    description: "Search tasks using full-text search on subject, description, and tags. Supports phrase queries (quoted) and prefix matching. Optional filters: status, assignee, project_id, channel, priority. Use sort='relevance' (default) or 'recent'.",
    inputSchema: {
      query: z.string(),
      status: z.enum(["pending", "in_progress", "completed", "cancelled", "blocked"]).optional(),
      assignee: z.string().optional(),
      project_id: z.string().optional(),
      channel: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      limit: z.coerce.number().optional(),
      sort: z.enum(["relevance", "recent"]).optional(),
      include_archived: z.coerce.boolean().optional(),
    },
  }, async (args: Record<string, any>) => {
    const results = searchTasks({ query: args.query, ...args });
    return { content: [{ type: "text", text: JSON.stringify({ tasks: results, count: results.length }) }] };
  });
}
