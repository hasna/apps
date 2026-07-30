/**
 * Task tools: create, read, list, update, complete, delete tasks,
 * subtasks, dependencies, comments, activity.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { registerMcpTool } from "../tool-compat.js";
import { getStore } from "../../lib/store/index.js";
import { identityFor } from "../identity.js";
import { previewText, summarizeTask } from "../../lib/compact-output.js";
import { compactQueriedTasks, jsonText, resolveMcpWindow } from "../compact.js";
import type { TaskInfo } from "../../types.js";

function compactComments(comments: Array<{ id: number; task_id: number; agent: string; content: string; created_at: string }>) {
  return comments.map((comment) => ({
    id: comment.id,
    task_id: comment.task_id,
    agent: comment.agent,
    created_at: comment.created_at,
    preview: previewText(comment.content),
    truncated: previewText(comment.content) !== comment.content.replace(/\s+/g, " ").trim(),
  }));
}

type TaskTreeNode = TaskInfo & { children: TaskTreeNode[] };
type CompactTaskTreeNode = ReturnType<typeof summarizeTask> & { children: CompactTaskTreeNode[] };

function compactTaskTree(node: TaskTreeNode): CompactTaskTreeNode {
  return {
    ...summarizeTask(node),
    children: (node.children ?? []).map((child) => compactTaskTree(child)),
  };
}

export function registerTaskTools(server: McpServer): void {
  // Bound to this connection: see ../identity.ts.
  const resolveIdentity = identityFor(server);

  // ---- Create Task ----
  registerMcpTool(server, "create_task", {
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
      // No try/catch: this catch used to be unreachable, because identity
      // resolution could not fail. Now that it can, swallowing it would make
      // create_task the one write that never refuses — seeding the task
      // registry with an unattributable reporter instead of telling the caller
      // to declare who it is.
      args.reporter = resolveIdentity(undefined);
    }
    const task = await getStore().createTask({
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
  registerMcpTool(server, "get_task", {
    description: "Get a task by id or uuid. Returns enriched TaskInfo with subtask count, comment count, dependency count, and blocker info.",
    inputSchema: {
      id: z.coerce.number().optional(),
      uuid: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const lookup = args.id ?? args.uuid;
    if (!lookup) return { content: [{ type: "text", text: "id or uuid required" }], isError: true };
    const task = await getStore().getTask(lookup);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${lookup}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- List Tasks ----
  registerMcpTool(server, "list_tasks", {
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
      cursor: z.coerce.number().optional().describe("Alias for offset"),
      include_archived: z.coerce.boolean().optional(),
      verbose: z.coerce.boolean().optional().describe("Return full raw task records instead of compact summaries"),
    },
  }, async (args: Record<string, any>) => {
    const window = resolveMcpWindow(args);
    const verbose = args.verbose === true;
    const tasks = await getStore().listTasks({
      ...args,
      limit: verbose ? args.limit : window.limit + 1,
      offset: verbose ? (args.offset ?? args.cursor) : window.offset,
    });
    return {
      content: [{
        type: "text",
        text: jsonText(verbose ? { tasks, count: tasks.length, compact: false } : compactQueriedTasks(tasks, args)),
      }],
    };
  });

  // ---- Start Task ----
  registerMcpTool(server, "start_task", {
    description: "Mark a task as in_progress. Fails if any dependency is not completed.",
    inputSchema: {
      id: z.coerce.number(),
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const task = await getStore().startTask(args.id, agent);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${args.id}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- Complete Task ----
  registerMcpTool(server, "complete_task", {
    description: "Mark a task as completed. Auto-unblocks any dependent tasks that now have all dependencies completed.",
    inputSchema: {
      id: z.coerce.number(),
      agent: z.string().optional(),
      evidence: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const task = await getStore().completeTask(args.id, agent, args.evidence ? { evidence: args.evidence } : undefined);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${args.id}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- Cancel Task ----
  registerMcpTool(server, "cancel_task", {
    description: "Cancel a task with optional reason.",
    inputSchema: {
      id: z.coerce.number(),
      agent: z.string().optional(),
      reason: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const task = await getStore().cancelTask(args.id, agent, args.reason ? { reason: args.reason } : undefined);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${args.id}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- Block Task ----
  registerMcpTool(server, "block_task", {
    description: "Manually block a task with optional reason.",
    inputSchema: {
      id: z.coerce.number(),
      agent: z.string().optional(),
      reason: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const task = await getStore().blockTask(args.id, agent, args.reason ? { reason: args.reason } : undefined);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${args.id}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- Unblock Task ----
  registerMcpTool(server, "unblock_task", {
    description: "Unblock a task. Sets to 'pending' if all dependencies are completed, otherwise stays 'blocked'.",
    inputSchema: {
      id: z.coerce.number(),
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const task = await getStore().unblockTask(args.id, agent);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${args.id}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- Reopen Task ----
  registerMcpTool(server, "reopen_task", {
    description: "Reopen a completed or cancelled task back to pending. Re-checks dependencies.",
    inputSchema: {
      id: z.coerce.number(),
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const task = await getStore().reopenTask(args.id, agent);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${args.id}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- Assign Task ----
  registerMcpTool(server, "assign_task", {
    description: "Assign a task to an agent.",
    inputSchema: {
      id: z.coerce.number(),
      assignee: z.string(),
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const task = await getStore().assignTask(args.id, args.assignee, agent);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${args.id}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- Set Task Priority ----
  registerMcpTool(server, "set_task_priority", {
    description: "Change a task's priority: low, medium, high, critical.",
    inputSchema: {
      id: z.coerce.number(),
      priority: z.enum(["low", "medium", "high", "critical"]),
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const task = await getStore().setTaskPriority(args.id, args.priority, agent);
    if (!task) return { content: [{ type: "text", text: `Task not found: ${args.id}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  });

  // ---- Delete Task ----
  registerMcpTool(server, "delete_task", {
    description: "Delete a task. Fails if subtasks still reference it.",
    inputSchema: {
      id: z.coerce.number(),
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const deleted = await getStore().deleteTask(args.id, agent);
    return { content: [{ type: "text", text: JSON.stringify({ deleted, id: args.id }) }] };
  });

  // ---- Add Comment ----
  registerMcpTool(server, "add_comment", {
    description: "Add a comment to a task.",
    inputSchema: {
      task_id: z.coerce.number(),
      content: z.string(),
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = args.agent ? args.agent : resolveIdentity(undefined);
    const comment = await getStore().addTaskComment(args.task_id, agent, args.content);
    return { content: [{ type: "text", text: JSON.stringify(comment) }] };
  });

  // ---- Get Comments ----
  registerMcpTool(server, "get_comments", {
    description: "Get all comments on a task, ordered by creation time.",
    inputSchema: {
      task_id: z.coerce.number(),
      limit: z.coerce.number().optional(),
      cursor: z.coerce.number().optional(),
      verbose: z.coerce.boolean().optional().describe("Return full raw comments instead of previews"),
    },
  }, async (args: Record<string, any>) => {
    const comments = await getStore().getTaskComments(args.task_id);
    if (args.verbose) return { content: [{ type: "text", text: jsonText({ comments, count: comments.length, compact: false }) }] };
    const window = resolveMcpWindow(args);
    const page = comments.slice(window.offset, window.offset + window.limit);
    const hasMore = window.offset + window.limit < comments.length;
    return {
      content: [{
        type: "text",
        text: jsonText({
          comments: compactComments(page),
          count: page.length,
          total: comments.length,
          limit: window.limit,
          cursor: window.offset,
          next_cursor: hasMore ? window.offset + page.length : null,
          has_more: hasMore,
          compact: true,
          hint: "Use verbose:true for full comment bodies.",
        }),
      }],
    };
  });

  // ---- Get Subtasks ----
  registerMcpTool(server, "get_subtasks", {
    description: "Get direct children (subtasks) of a parent task.",
    inputSchema: {
      parent_id: z.coerce.number(),
    },
  }, async (args: Record<string, any>) => {
    const subtasks = await getStore().getSubtasks(args.parent_id);
    return { content: [{ type: "text", text: JSON.stringify({ subtasks, count: subtasks.length }) }] };
  });

  // ---- Get Task Tree ----
  registerMcpTool(server, "get_task_tree", {
    description: "Get a task with its full subtask tree (recursive, max depth 5).",
    inputSchema: {
      parent_id: z.coerce.number(),
      max_depth: z.coerce.number().optional(),
      verbose: z.coerce.boolean().optional().describe("Return full raw recursive task tree"),
    },
  }, async (args: Record<string, any>) => {
    const tree = await getStore().getTaskTree(args.parent_id, args.max_depth ?? 5);
    return {
      content: [{
        type: "text",
        text: jsonText(args.verbose ? tree : {
          tree: compactTaskTree(tree as TaskTreeNode),
          compact: true,
          hint: "Use verbose:true for full task tree records.",
        }),
      }],
    };
  });

  // ---- Add Dependency ----
  registerMcpTool(server, "add_dependency", {
    description: "Add a dependency: task_id depends on depends_on_id. Prevents circular dependencies. Auto-blocks if dependency not completed.",
    inputSchema: {
      task_id: z.coerce.number(),
      depends_on_id: z.coerce.number(),
    },
  }, async (args: Record<string, any>) => {
    await getStore().addDependency(args.task_id, args.depends_on_id);
    return { content: [{ type: "text", text: `Task #${args.task_id} now depends on #${args.depends_on_id}` }] };
  });

  // ---- Remove Dependency ----
  registerMcpTool(server, "remove_dependency", {
    description: "Remove a dependency between two tasks.",
    inputSchema: {
      task_id: z.coerce.number(),
      depends_on_id: z.coerce.number(),
    },
  }, async (args: Record<string, any>) => {
    await getStore().removeDependency(args.task_id, args.depends_on_id);
    return { content: [{ type: "text", text: `Removed dependency: #${args.task_id} no longer depends on #${args.depends_on_id}` }] };
  });

  // ---- Get Dependencies ----
  registerMcpTool(server, "get_dependencies", {
    description: "Get tasks that this task depends on (what must be completed first).",
    inputSchema: {
      task_id: z.coerce.number(),
    },
  }, async (args: Record<string, any>) => {
    const deps = await getStore().getDependencies(args.task_id);
    return { content: [{ type: "text", text: JSON.stringify({ dependencies: deps, count: deps.length }) }] };
  });

  // ---- Get Dependents ----
  registerMcpTool(server, "get_dependents", {
    description: "Get tasks that depend on this task (what is blocked by this).",
    inputSchema: {
      task_id: z.coerce.number(),
    },
  }, async (args: Record<string, any>) => {
    const deps = await getStore().getDependents(args.task_id);
    return { content: [{ type: "text", text: JSON.stringify({ dependents: deps, count: deps.length }) }] };
  });

  // ---- Get Task Activity ----
  registerMcpTool(server, "get_task_activity", {
    description: "Get activity log for a task: status changes, comments, dependency changes.",
    inputSchema: {
      task_id: z.coerce.number(),
      limit: z.coerce.number().optional(),
    },
  }, async (args: Record<string, any>) => {
    const activity = await getStore().getTaskActivity(args.task_id, args.limit ?? 50);
    return { content: [{ type: "text", text: JSON.stringify({ activity, count: activity.length }) }] };
  });

  // ---- Get Due Tasks ----
  registerMcpTool(server, "get_due_tasks", {
    description: "Get tasks with approaching or past due dates. Returns tasks that are overdue, due today, or due within the specified window (default 24h). Ordered by due_at ascending. Excludes completed and cancelled tasks.",
    inputSchema: {
      window_hours: z.coerce.number().optional(),
    },
  }, async (args: Record<string, any>) => {
    const due = await getStore().getDueTasks({ window_hours: args.window_hours });
    return { content: [{ type: "text", text: JSON.stringify({ tasks: due, count: due.length }) }] };
  });

  // ---- Get Task Summary ----
  registerMcpTool(server, "get_task_summary", {
    description: "Get a structured summary of a task including progress metrics, recent activity, blockers, and dependents. Returns subtask progress, dependency progress, completion percentage, and recent activity log.",
    inputSchema: {
      id: z.coerce.number().optional(),
      uuid: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const lookup = args.id ?? args.uuid;
    if (!lookup) return { content: [{ type: "text", text: "id or uuid required" }], isError: true };
    const summary = await getStore().getTaskSummary(lookup);
    if (!summary) return { content: [{ type: "text", text: `Task not found: ${lookup}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(summary) }] };
  });

  // ---- Search Tasks ----
  registerMcpTool(server, "search_tasks", {
    description: "Search tasks using full-text search on subject, description, and tags. Supports phrase queries (quoted) and prefix matching. Optional filters: status, assignee, project_id, channel, priority. Use sort='relevance' (default) or 'recent'.",
    inputSchema: {
      query: z.string(),
      status: z.enum(["pending", "in_progress", "completed", "cancelled", "blocked"]).optional(),
      assignee: z.string().optional(),
      project_id: z.string().optional(),
      channel: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      limit: z.coerce.number().optional(),
      cursor: z.coerce.number().optional(),
      sort: z.enum(["relevance", "recent"]).optional(),
      include_archived: z.coerce.boolean().optional(),
      verbose: z.coerce.boolean().optional().describe("Return full raw task records instead of compact summaries"),
    },
  }, async (args: Record<string, any>) => {
    const window = resolveMcpWindow(args);
    const verbose = args.verbose === true;
    const results = await getStore().searchTasks({
      query: args.query,
      ...args,
      limit: verbose ? args.limit : window.limit + 1,
      offset: verbose ? args.cursor : window.offset,
    });
    return {
      content: [{
        type: "text",
        text: jsonText(verbose ? { tasks: results, count: results.length, compact: false } : compactQueriedTasks(results, args)),
      }],
    };
  });
}
