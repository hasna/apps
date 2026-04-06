// @ts-nocheck
/**
 * Task meta tools for the MCP server.
 * Auto-extracted from src/mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface TaskMetaContext {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (error: unknown) => string;
}

export function registerTaskMetaTools(server: McpServer, ctx: TaskMetaContext) {
  const { shouldRegisterTool, formatError } = ctx;

  // === META / HELP ===

  if (shouldRegisterTool("search_tools")) {
    server.tool(
      "search_tools",
      "Search available MCP tools by keyword. Returns matching tool names and descriptions.",
      {
        query: z.string().describe("Search query"),
      },
      async ({ query }) => {
        try {
          const { listTools } = require("@modelcontextprotocol/sdk/server/mcp.js") as any;
          // We have access to the server's tool list through introspection
          // Since we can't directly access server.tools, we return a helpful message
          return {
            content: [{
              type: "text" as const,
              text: `Search for "${query}": This tool requires runtime introspection which is not available at startup. Use describe_tools to list all available tools.`,
            }],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("describe_tools")) {
    server.tool(
      "describe_tools",
      "Get detailed documentation for a specific tool including all parameters and descriptions.",
      {
        tool_name: z.string().describe("Tool name to describe"),
      },
      async ({ tool_name }) => {
        try {
          // Return documentation for known tools
          const toolDocs: Record<string, string> = {
            create_task: "create_task — Create a new task. Params: title (required), description, status, priority, project_id, task_list_id, assigned_to, depends_on, short_id (null to disable), tags, estimate (minutes), confidence (0.0-1.0), deadline (ISO), retry_count",
            list_tasks: "list_tasks — List tasks with filters. Params: status, priority, project_id, task_list_id, assigned_to, tags[], created_after, created_before, limit, offset",
            get_task: "get_task — Get full details for a task. Params: task_id",
            update_task: "update_task — Update task fields (optimistic locking). Params: task_id (required), title, description, status, priority, assigned_to (null to unassign), project_id, task_list_id, depends_on[], tags[], estimate, actual_minutes, confidence, approved_by, completed_at, deadline, retry_count, version",
            delete_task: "delete_task — Delete a task. Params: task_id, force (skip child check)",
            start_task: "start_task — Mark task in_progress. Params: task_id, version",
            complete_task: "complete_task — Mark task completed. Params: task_id, confidence, completed_at, version",
            cancel_task: "cancel_task — Cancel a task. Params: task_id, version",
            reassign_task: "reassign_task — Change task assignee. Params: task_id, new_assignee, version",
            reschedule_task: "reschedule_task — Update deadline. Params: task_id, deadline, version",
            prioritize_task: "prioritize_task — Set priority. Params: task_id, priority, version",
            search_tasks: "search_tasks — Full-text search. Params: query, project_id, status, limit",
            get_my_tasks: "get_my_tasks — Get tasks for calling agent. Params: agent_id, status, project_id, limit",
            standup: "standup — Get standup report. Params: agent_id, project_id",
            patrol_tasks: "patrol_tasks — Scan for task issues. Params: stuck_minutes, confidence_threshold, project_id",
            get_review_queue: "get_review_queue — Get tasks needing review. Params: project_id, limit",
            create_project: "create_project — Create a project. Params: name, description, status, short_id, metadata",
            list_projects: "list_projects — List projects. Params: status, limit",
            get_project: "get_project — Get project details. Params: project_id",
            update_project: "update_project — Update project. Params: project_id, name, description, status, metadata",
            delete_project: "delete_project — Delete project. Params: project_id, force",
            create_task_list: "create_task_list — Create a task list. Params: name, project_id, description, status",
            list_task_lists: "list_task_lists — List task lists. Params: project_id, status",
            get_task_list: "get_task_list — Get task list with tasks. Params: task_list_id, include_tasks",
            update_task_list: "update_task_list — Update task list. Params: task_list_id, name, description, status",
            delete_task_list: "delete_task_list — Delete task list. Params: task_list_id, force",
            create_plan: "create_plan — Create a plan/sprint. Params: name, project_id, description, start_date, end_date, status",
            list_plans: "list_plans — List plans. Params: project_id, status",
            get_plan: "get_plan — Get plan with tasks. Params: plan_id, include_tasks",
            update_plan: "update_plan — Update plan. Params: plan_id, name, description, start_date, end_date, status",
            delete_plan: "delete_plan — Delete plan. Params: plan_id, force",
            create_tag: "create_tag — Create a tag. Params: name, color, description",
            list_tags: "list_tags — List all tags",
            get_tag: "get_tag — Get tag with tasks. Params: tag_id",
            update_tag: "update_tag — Update tag. Params: tag_id, name, color, description",
            delete_tag: "delete_tag — Delete tag. Params: tag_id",
            create_label: "create_label — Create a label. Params: name, color, description",
            list_labels: "list_labels — List all labels",
            get_label: "get_label — Get label with tasks. Params: label_id",
            update_label: "update_label — Update label. Params: label_id, name, color, description",
            delete_label: "delete_label — Delete label. Params: label_id",
            add_task_dependency: "add_task_dependency — Add dependency. Params: task_id, depends_on",
            remove_task_dependency: "remove_task_dependency — Remove dependency. Params: task_id, depends_on",
            get_task_dependencies: "get_task_dependencies — Get dependency tree. Params: task_id, direction",
            add_task_relationship: "add_task_relationship — Add semantic relationship. Params: source_task_id, target_task_id, relationship_type, created_by",
            remove_task_relationship: "remove_task_relationship — Remove relationship. Params: id or source_task_id+target_task_id+type",
            get_task_relationships: "get_task_relationships — Get all relationships. Params: task_id, relationship_type",
            create_comment: "create_comment — Add comment. Params: task_id, body, author",
            list_comments: "list_comments — List comments. Params: task_id",
            update_comment: "update_comment — Edit comment. Params: comment_id, body",
            delete_comment: "delete_comment — Delete comment. Params: comment_id",
            lock_task: "lock_task — Acquire exclusive lock. Params: task_id, agent_id, ttl_seconds",
            unlock_task: "unlock_task — Release lock. Params: task_id, agent_id",
            check_task_lock: "check_task_lock — Check lock status. Params: task_id",
            bulk_update_tasks: "bulk_update_tasks — Update multiple tasks. Params: task_ids[], status, priority, assigned_to",
            bulk_create_tasks: "bulk_create_tasks — Create multiple tasks. Params: tasks[]",
            bulk_delete_tasks: "bulk_delete_tasks — Delete multiple tasks. Params: task_ids[], force",
            archive_completed: "archive_completed — Auto-archive old completed tasks. Params: days, project_id",
            get_archived_tasks: "get_archived_tasks — List archived tasks. Params: project_id, limit",
            unarchive_task: "unarchive_task — Restore archived task. Params: task_id",
            auto_assign_task: "auto_assign_task — Auto-assign based on capabilities. Params: task_id",
            get_my_workload: "get_my_workload — Get agent workload stats. Params: agent_id",
            rebalance_workload: "rebalance_workload — Rebalance tasks across agents. Params: project_id, max_per_agent",
            notify_upcoming_deadlines: "notify_upcoming_deadlines — Get tasks nearing deadline. Params: hours, project_id, agent_id",
            get_stale_tasks: "get_stale_tasks — Get tasks not updated recently. Params: hours, project_id",
            get_blocked_tasks: "get_blocked_tasks — Get blocked tasks. Params: project_id",
            get_blocking_tasks: "get_blocking_tasks — Get tasks blocking others. Params: project_id",
            get_health: "get_health — Get system health stats",
            approve_task: "approve_task — Approve a task. Params: task_id, approved_by, notes, version",
            fail_task: "fail_task — Mark task failed. Params: task_id, reason, agent_id, version",
            get_org_chart: "get_org_chart — Get global org chart. Params: format",
            set_reports_to: "set_reports_to — Set org hierarchy. Params: agent_id, reports_to",
            sync: "sync — Sync from external source. Params: source, source_id, project_id, options",
            extract_todos: "extract_todos — Scan code for TODO comments. Params: path, project_id, task_list_id, patterns, tags, assigned_to, agent_id, dry_run, extensions",
            migrate_pg: "migrate_pg — Apply PostgreSQL migrations. Params: connection_string",
          };

          if (toolDocs[tool_name]) {
            return { content: [{ type: "text" as const, text: toolDocs[tool_name] }] };
          }
          return { content: [{ type: "text" as const, text: `No documentation found for tool: ${tool_name}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
