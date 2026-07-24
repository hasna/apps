// @ts-nocheck
/**
 * Task advanced tools for the MCP server.
 * Auto-extracted from src/mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Task } from "../../types/index.js";
import { compactJson, compactStatus, compactTask, truncateText } from "../token-utils.js";
import { getTodosCloudClient, cloudGetStats, cloudGetTask, cloudCountTasks, cloudAddComment } from "../../cli/cloud-router.js";

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

  function getDependencyContext(taskId: string) {
    const { getTaskDependencies, getTaskDependents, getTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
    const upstream = getTaskDependencies(taskId).map((dep: any) => {
      const dependency = getTask(dep.depends_on);
      return {
        direction: "upstream",
        task_id: dep.depends_on,
        status: dependency?.status || "unknown",
      };
    });
    const downstream = getTaskDependents(taskId).map((dep: any) => {
      const dependent = getTask(dep.task_id);
      return {
        direction: "downstream",
        task_id: dep.task_id,
        status: dependent?.status || "unknown",
      };
    });
    return [...upstream, ...downstream];
  }

  // === STATUS / CONTEXT ===

  if (shouldRegisterTool("get_status")) {
    server.tool(
      "get_status",
      "Get queue status summary, or pass task_id for a task's detailed status.",
      {
        task_id: z.string().optional().describe("Task ID for task-specific status"),
        project_id: z.string().optional().describe("Filter summary by project"),
        task_list_id: z.string().optional().describe("Filter summary by task list"),
        agent_id: z.string().optional().describe("Agent for next-task affinity"),
        explain_blocked: z.boolean().optional().describe("Include blocked task explanations in summary"),
        detail: z.enum(["compact", "full"]).optional().describe("Response detail (default: compact)"),
        comment_limit: z.number().optional().describe("Max recent comments for task status (default: 5)"),
        file_limit: z.number().optional().describe("Max files for task status (default: 10)"),
      },
      async ({ task_id, project_id, task_list_id, agent_id, explain_blocked, detail, comment_limit, file_limit }) => {
        try {
          const cloud = getTodosCloudClient();
          if (!task_id) {
            if (cloud) {
              // self_hosted cloud routing: queue summary from <app-host>/v1.
              const baseFilter: Record<string, unknown> = {};
              if (project_id) baseFilter.project_id = project_id;
              if (task_list_id) baseFilter.task_list_id = task_list_id;
              const stats = await cloudGetStats(cloud);
              const [pending, in_progress, completed, failed] = await Promise.all([
                cloudCountTasks(cloud, { ...baseFilter, status: "pending" } as any),
                cloudCountTasks(cloud, { ...baseFilter, status: "in_progress" } as any),
                cloudCountTasks(cloud, { ...baseFilter, status: "completed" } as any),
                cloudCountTasks(cloud, { ...baseFilter, status: "failed" } as any),
              ]);
              const total = pending + in_progress + completed + failed;
              const cloudStatus = {
                source: "cloud",
                total: (stats.tasks as number) ?? total,
                projects: stats.projects ?? null,
                by_status: { pending, in_progress, completed, failed },
              };
              return { content: [{ type: "text" as const, text: JSON.stringify(cloudStatus, null, detail === "full" ? 2 : 0) }] };
            }
            const { getStatus } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
            const filters: Record<string, string> = {};
            if (project_id) filters.project_id = resolveId(project_id, "projects");
            if (task_list_id) filters.task_list_id = resolveId(task_list_id, "task_lists");
            const status = getStatus(filters, agent_id, { explain_blocked });
            return { content: [{ type: "text" as const, text: detail === "full" ? JSON.stringify(status, null, 2) : compactJson(compactStatus(status)) }] };
          }

          if (cloud) {
            const task = await cloudGetTask(cloud, task_id);
            if (!task) throw new Error(`Task not found: ${task_id}`);
            return { content: [{ type: "text" as const, text: compactJson({ source: "cloud", task: compactTask(task, 160) }) }] };
          }
          const resolvedId = resolveId(task_id);
          const { getTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const task = getTask(resolvedId);
          if (!task) throw new Error(`Task not found: ${task_id}`);
          const { listComments } = require("../../db/comments.js") as typeof import("../../db/comments.js");
          const { listTaskFiles } = require("../../db/task-files.js") as any;
          const [deps, comments, files] = await Promise.all([
            Promise.resolve(getDependencyContext(resolvedId)),
            Promise.resolve(listComments(resolvedId)),
            Promise.resolve(listTaskFiles(resolvedId)),
          ]);
          if (detail !== "full") {
            const commentsShown = comments.slice(-(comment_limit || 5));
            const filesShown = files.slice(0, file_limit || 10);
            return {
              content: [{
                type: "text" as const,
                text: compactJson({
                  task: compactTask(task, 160),
                  dependencies: {
                    count: deps.length,
                    items: deps.slice(0, 10).map((d: any) => ({ direction: d.direction, task_id: d.task_id, status: d.status })),
                    omitted: Math.max(0, deps.length - 10),
                  },
                  comments: {
                    count: comments.length,
                    recent: commentsShown.map((c: any) => ({
                      agent_id: c.agent_id || null,
                      created_at: c.created_at,
                      content: truncateText(c.content, 120),
                    })),
                    omitted: Math.max(0, comments.length - commentsShown.length),
                  },
                  files: {
                    count: files.length,
                    items: filesShown.map((f: any) => ({ status: f.status, path: f.path })),
                    omitted: Math.max(0, files.length - filesShown.length),
                  },
                }),
              }],
            };
          }
          const lines = [
            `Status: ${task.status} | Priority: ${task.priority}`,
            task.assigned_to ? `Assigned: ${task.assigned_to}` : "Unassigned",
            task.due_at ? `Due: ${task.due_at}` : null,
            task.confidence != null ? `Confidence: ${task.confidence}` : null,
            deps.length > 0 ? `\nDependencies (${deps.length}):` : null,
            ...deps.map((d: any) => `  [${d.direction}] ${d.task_id.slice(0,8)} (${d.status})`),
            comments.length > 0 ? `\nComments (${comments.length}):` : null,
            ...comments.map((c: any) => `  [${c.agent_id || "?"}] ${c.created_at?.slice(0,16)}: ${c.content.slice(0,80)}`),
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
      "Get compact context for a task by default: details, dependencies, relationships, comments, files, commits, and watchers. Pass detail=full for all data.",
      {
        task_id: z.string().describe("Task ID"),
        detail: z.enum(["compact", "full"]).optional().describe("Response detail (default: compact)"),
        comment_limit: z.number().optional().describe("Max recent comments in compact mode (default: 5)"),
        file_limit: z.number().optional().describe("Max files in compact mode (default: 10)"),
        commit_limit: z.number().optional().describe("Max commits in compact mode (default: 10)"),
        max_description_chars: z.number().optional().describe("Max description chars in compact mode (default: 240)"),
      },
      async ({ task_id, detail, comment_limit, file_limit, commit_limit, max_description_chars }) => {
        try {
          const resolvedId = resolveId(task_id);
          const { getTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const task = getTask(resolvedId);
          if (!task) throw new Error(`Task not found: ${task_id}`);
          const { getTaskRelationships } = require("../../db/task-relationships.js") as typeof import("../../db/task-relationships.js");
          const { listComments } = require("../../db/comments.js") as typeof import("../../db/comments.js");
          const { listTaskFiles } = require("../../db/task-files.js") as any;
          const { getTaskCommits } = require("../../db/task-commits.js") as typeof import("../../db/task-commits.js");
          const { getTaskWatchers } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const [deps, rels, comments, files, commits, watchers] = await Promise.all([
            Promise.resolve(getDependencyContext(resolvedId)),
            Promise.resolve(getTaskRelationships(resolvedId)),
            Promise.resolve(listComments(resolvedId)),
            Promise.resolve(listTaskFiles(resolvedId)),
            Promise.resolve(getTaskCommits(resolvedId)),
            Promise.resolve(getTaskWatchers(resolvedId)),
          ]);
          if (detail !== "full") {
            const commentsShown = comments.slice(-(comment_limit || 5));
            const filesShown = files.slice(0, file_limit || 10);
            const commitsShown = commits.slice(0, commit_limit || 10);
            return {
              content: [{
                type: "text" as const,
                text: compactJson({
                  task: compactTask(task, max_description_chars || 240),
                  dependencies: {
                    count: deps.length,
                    items: deps.slice(0, 10).map((d: any) => ({ direction: d.direction, task_id: d.task_id, status: d.status })),
                    omitted: Math.max(0, deps.length - 10),
                  },
                  relationships: {
                    count: rels.length,
                    items: rels.slice(0, 10).map((r: any) => ({
                      source_task_id: r.source_task_id,
                      relationship_type: r.relationship_type,
                      target_task_id: r.target_task_id,
                    })),
                    omitted: Math.max(0, rels.length - 10),
                  },
                  comments: {
                    count: comments.length,
                    recent: commentsShown.map((c: any) => ({
                      agent_id: c.agent_id || null,
                      created_at: c.created_at,
                      content: truncateText(c.content, 160),
                    })),
                    omitted: Math.max(0, comments.length - commentsShown.length),
                  },
                  files: {
                    count: files.length,
                    items: filesShown.map((f: any) => ({ status: f.status, path: f.path })),
                    omitted: Math.max(0, files.length - filesShown.length),
                  },
                  commits: {
                    count: commits.length,
                    items: commitsShown.map((c: any) => ({ sha: c.sha, message: truncateText(c.message || "(no message)", 120) })),
                    omitted: Math.max(0, commits.length - commitsShown.length),
                  },
                  watchers: { count: watchers.length },
                  metadata_keys: task.metadata ? Object.keys(task.metadata) : [],
                }),
              }],
            };
          }
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
            task.due_at ? `Due: ${task.due_at}` : null,
            task.completed_at ? `Completed: ${task.completed_at}` : null,
            deps.length > 0 ? `\n--- Dependencies (${deps.length}) ---` : null,
            ...deps.map((d: any) => `  [${d.direction}] ${d.task_id.slice(0,8)} (${d.status})`),
            rels.length > 0 ? `\n--- Relationships (${rels.length}) ---` : null,
            ...rels.map((r: any) => `  ${r.source_task_id.slice(0,8)} --[${r.relationship_type}]--> ${r.target_task_id.slice(0,8)}`),
            comments.length > 0 ? `\n--- Comments (${comments.length}) ---` : null,
            ...comments.map((c: any) => `  [${c.agent_id || "?"}] ${c.created_at?.slice(0,16)}: ${c.content.slice(0,120)}`),
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

  if (shouldRegisterTool("build_agent_context_pack")) {
    server.tool(
      "build_agent_context_pack",
      "Build a deterministic local agent context pack for Codex, Claude Code, Takumi, or generic agents. Returns JSON or Markdown and never calls hosted services.",
      {
        task_id: z.string().describe("Task ID"),
        profile: z.enum(["codex", "claude", "takumi", "generic"]).optional().describe("Target agent profile"),
        format: z.enum(["json", "markdown"]).optional().describe("Output format (default: json)"),
        run_id: z.string().optional().describe("Limit run evidence to a specific run ID or prefix"),
        agent_id: z.string().optional().describe("Agent building the pack"),
        comment_limit: z.number().optional(),
        file_limit: z.number().optional(),
        verification_limit: z.number().optional(),
        run_limit: z.number().optional(),
        dependency_limit: z.number().optional(),
        plan_task_limit: z.number().optional(),
        max_text_chars: z.number().optional(),
        summary_char_limit: z.number().optional(),
        token_budget: z.number().optional().describe("Approximate token budget for local context pruning"),
        include_sections: z.array(z.string()).optional().describe("Context sections to include before budgeting"),
        exclude_sections: z.array(z.string()).optional().describe("Context sections to omit before budgeting"),
        compact: z.boolean().optional().describe("Render compact Markdown or minified JSON"),
        stale_after_hours: z.number().optional(),
      },
      async ({ task_id, profile, format, run_id, agent_id, comment_limit, file_limit, verification_limit, run_limit, dependency_limit, plan_task_limit, max_text_chars, summary_char_limit, token_budget, include_sections, exclude_sections, compact, stale_after_hours }) => {
        try {
          const resolvedId = resolveId(task_id);
          const { createAgentContextPack, renderAgentContextPack } = require("../../lib/context-packs.js") as typeof import("../../lib/context-packs.js");
          const pack = createAgentContextPack({
            task_id: resolvedId,
            profile,
            run_id,
            agent_id,
            comment_limit,
            file_limit,
            verification_limit,
            run_limit,
            dependency_limit,
            plan_task_limit,
            max_text_chars,
            summary_char_limit,
            token_budget,
            include_sections,
            exclude_sections,
            compact,
            stale_after_hours,
          });
          const text = renderAgentContextPack(pack, format || "json", Boolean(compact));
          return { content: [{ type: "text" as const, text }] };
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
          const { startTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolvedId = resolveId(task_id);
          const focus = ctx.getAgentFocus(agent_id || "");
          const effectiveAgent = focus ? focus.agent_id : agent_id || "mcp";
          const task = startTask(resolvedId, effectiveAgent);
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
          const { getTask, updateTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolvedId = resolveId(task_id);
          const current = getTask(resolvedId);
          if (!current) throw new Error(`Task not found: ${task_id}`);
          const task = updateTask(resolvedId, { status: "pending", assigned_to: null, version: current.version });
          return { content: [{ type: "text" as const, text: formatTask(task) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("set_task_contract")) {
    server.tool(
      "set_task_contract",
      "Set local task acceptance criteria, required verification commands, expected artifacts, relevant files, risk, and done definition.",
      {
        task_id: z.string().describe("Task ID"),
        acceptance_criteria: z.array(z.string()).optional(),
        verification_commands: z.array(z.string()).optional(),
        expected_artifacts: z.array(z.string()).optional(),
        relevant_files: z.array(z.string()).optional(),
        risk_level: z.enum(["low", "medium", "high", "critical"]).optional(),
        done_definition: z.array(z.string()).optional(),
      },
      async (input) => {
        try {
          const { setTaskContract } = require("../../lib/task-contracts.js") as typeof import("../../lib/task-contracts.js");
          const result = setTaskContract({ ...input, task_id: resolveId(input.task_id) });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_task_contract")) {
    server.tool(
      "get_task_contract",
      "Get local task contract and review state.",
      { task_id: z.string().describe("Task ID") },
      async ({ task_id }) => {
        try {
          const resolvedId = resolveId(task_id);
          const { getTaskContract, getTaskReview } = require("../../lib/task-contracts.js") as typeof import("../../lib/task-contracts.js");
          return { content: [{ type: "text" as const, text: JSON.stringify({ contract: getTaskContract(resolvedId), review: getTaskReview(resolvedId) }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("request_task_review")) {
    server.tool(
      "request_task_review",
      "Request local review for a task.",
      {
        task_id: z.string().describe("Task ID"),
        requester: z.string().describe("Requester agent or user"),
        reviewer: z.string().optional().describe("Reviewer agent or user"),
        notes: z.string().optional().describe("Review notes"),
      },
      async (input) => {
        try {
          const { requestTaskReview } = require("../../lib/task-contracts.js") as typeof import("../../lib/task-contracts.js");
          const review = requestTaskReview({ ...input, task_id: resolveId(input.task_id) });
          return { content: [{ type: "text" as const, text: JSON.stringify(review, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("record_task_review")) {
    server.tool(
      "record_task_review",
      "Record local task review approval, requested changes, or reopen state.",
      {
        task_id: z.string().describe("Task ID"),
        state: z.enum(["approved", "changes_requested", "reopened"]).describe("Review state"),
        reviewer: z.string().describe("Reviewer agent or user"),
        notes: z.string().optional().describe("Review notes"),
        changes_requested: z.array(z.string()).optional().describe("Requested changes"),
      },
      async (input) => {
        try {
          const { recordTaskReview } = require("../../lib/task-contracts.js") as typeof import("../../lib/task-contracts.js");
          const review = recordTaskReview({ ...input, task_id: resolveId(input.task_id) });
          return { content: [{ type: "text" as const, text: JSON.stringify(review, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("check_task_done_contract")) {
    server.tool(
      "check_task_done_contract",
      "Check whether local task status, verification evidence, artifacts, and review state satisfy the task contract.",
      { task_id: z.string().describe("Task ID") },
      async ({ task_id }) => {
        try {
          const { checkTaskDoneContract } = require("../../lib/task-contracts.js") as typeof import("../../lib/task-contracts.js");
          const result = checkTaskDoneContract(resolveId(task_id));
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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
          const updated = updateTask(resolvedId, { estimated_minutes: currentEstimate + minutes, version: task.version });
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
          // self_hosted cloud routing: comment straight against <app-host>/v1.
          // Skip local id-resolution (it hits local SQLite and 404s cloud-only
          // tasks); pass the id through so the cloud dataset is authoritative. The
          // server 404s a genuinely missing task, surfaced as isError below.
          const cloud = getTodosCloudClient();
          if (cloud) {
            await cloudAddComment(cloud, task_id, { content: body, agent_id: author });
            return { content: [{ type: "text" as const, text: `Comment added to ${task_id.slice(0,8)}` }] };
          }
          const { addComment } = require("../../db/comments.js") as typeof import("../../db/comments.js");
          const resolvedId = resolveId(task_id);
          const resolvedAuthor = author ? resolveId(author, "agents") : undefined;
          addComment({ task_id: resolvedId, content: body, agent_id: resolvedAuthor });
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
      "List recent comments for a task. Compact by default; pass detail=full for all comment text.",
      {
        task_id: z.string().describe("Task ID"),
        detail: z.enum(["compact", "full"]).optional().describe("Response detail (default: compact)"),
        limit: z.number().optional().describe("Max recent comments in compact mode (default: 20)"),
      },
      async ({ task_id, detail, limit }) => {
        try {
          const { listComments } = require("../../db/comments.js") as typeof import("../../db/comments.js");
          const comments = listComments(resolveId(task_id));
          if (comments.length === 0) return { content: [{ type: "text" as const, text: "No comments." }] };
          const shown = detail === "full" ? comments : comments.slice(-(limit || 20));
          const lines = shown.map(c => `[${c.agent_id || "?"}] ${c.created_at?.slice(0,16)}: ${detail === "full" ? c.content : truncateText(c.content, 180)}`);
          if (shown.length < comments.length) lines.unshift(`Showing ${shown.length} of ${comments.length} comments (${comments.length - shown.length} older omitted).`);
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
        status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
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

}
