// @ts-nocheck
/**
 * Task resources tools for the MCP server.
 * Auto-extracted from src/mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listTasks, listProjects, listAgents, getTask, linkTaskToCommit, getTaskCommits, findTaskByCommit } from "../../tasks.js";

interface TaskResourcesContext {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table?: string) => string;
  formatError: (error: unknown) => string;
}

export function registerTaskResources(server: McpServer, ctx: TaskResourcesContext) {
  const { shouldRegisterTool, resolveId, formatError } = ctx;

  // === RESOURCES ===

  server.resource(
    "tasks",
    "todos://tasks",
    { description: "All active tasks", mimeType: "application/json" },
    async () => {
      const tasks = listTasks({ status: ["pending", "in_progress"] });
      return { contents: [{ uri: "todos://tasks", text: JSON.stringify(tasks, null, 2), mimeType: "application/json" }] };
    },
  );

  server.resource(
    "projects",
    "todos://projects",
    { description: "All registered projects", mimeType: "application/json" },
    async () => {
      const projects = listProjects();
      return { contents: [{ uri: "todos://projects", text: JSON.stringify(projects, null, 2), mimeType: "application/json" }] };
    },
  );

  server.resource(
    "agents",
    "todos://agents",
    { description: "All registered agents", mimeType: "application/json" },
    async () => {
      const agents = listAgents();
      return { contents: [{ uri: "todos://agents", text: JSON.stringify(agents, null, 2), mimeType: "application/json" }] };
    },
  );

  // === TASK FILES ===

  if (shouldRegisterTool("add_task_file")) {
    server.tool(
      "add_task_file",
      "Link a file path to a task. Tracks which files an agent is working on. Upserts if same task+path exists. Auto-detects conflicts with other in-progress tasks.",
      {
        task_id: z.string().describe("Task ID"),
        path: z.string().describe("File path (relative or absolute)"),
        paths: z.array(z.string()).optional().describe("Multiple file paths to add at once"),
        status: z.enum(["planned", "active", "modified", "reviewed", "removed"]).optional().describe("File status (default: active)"),
        agent_id: z.string().optional().describe("Agent working on this file"),
        note: z.string().optional().describe("Note about why this file is linked"),
      },
      async ({ task_id, path, paths: multiplePaths, status, agent_id, note }) => {
        try {
          const { addTaskFile, bulkAddTaskFiles, detectFileConflicts } = require("../db/task-files.js") as any;
          const resolvedId = resolveId(task_id);

          let addedFiles: any[];
          if (multiplePaths && multiplePaths.length > 0) {
            const allPaths = path ? [path, ...multiplePaths] : multiplePaths;
            addedFiles = bulkAddTaskFiles(resolvedId, allPaths, agent_id);
            const conflicts = detectFileConflicts(resolvedId, allPaths);
            if (conflicts.length > 0) {
              return {
                content: [{
                  type: "text" as const,
                  text: JSON.stringify({
                    added: addedFiles.length,
                    conflicts,
                    warning: `${conflicts.length} file(s) already claimed by other in-progress tasks`,
                  }, null, 2),
                }],
              };
            }
            return { content: [{ type: "text" as const, text: `${addedFiles.length} file(s) linked to task ${resolvedId.slice(0, 8)}` }] };
          }

          const file = addTaskFile({ task_id: resolvedId, path, status, agent_id, note });
          const conflicts = detectFileConflicts(resolvedId, [path]);
          if (conflicts.length > 0) {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  file,
                  conflicts,
                  warning: `${path} is already claimed by another in-progress task`,
                }, null, 2),
              }],
            };
          }
          return { content: [{ type: "text" as const, text: `${file.status} ${file.path} → task ${resolvedId.slice(0, 8)}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_task_files")) {
    server.tool(
      "list_task_files",
      "List all files linked to a task.",
      { task_id: z.string().describe("Task ID") },
      async ({ task_id }) => {
        try {
          const { listTaskFiles } = require("../db/task-files.js") as any;
          const resolvedId = resolveId(task_id);
          const files: any[] = listTaskFiles(resolvedId);
          if (files.length === 0) return { content: [{ type: "text" as const, text: "No files linked." }] };
          const lines = files.map((f: any) => `[${f.status}] ${f.path}${f.agent_id ? ` (${f.agent_id})` : ""}${f.note ? ` — ${f.note}` : ""}`);
          return { content: [{ type: "text" as const, text: `${files.length} file(s):\n${lines.join("\n")}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("find_tasks_by_file")) {
    server.tool(
      "find_tasks_by_file",
      "Find which tasks are linked to a specific file path. Shows who's working on what files.",
      { path: z.string().describe("File path to search for") },
      async ({ path }) => {
        try {
          const { findTasksByFile } = require("../db/task-files.js") as any;
          const files: any[] = findTasksByFile(path);
          if (files.length === 0) return { content: [{ type: "text" as const, text: `No tasks linked to ${path}` }] };
          const lines = files.map((f: any) => `${f.task_id.slice(0, 8)} [${f.status}]${f.agent_id ? ` (${f.agent_id})` : ""}`);
          return { content: [{ type: "text" as const, text: `${files.length} task(s) linked to ${path}:\n${lines.join("\n")}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_file_heat_map")) {
    server.tool(
      "get_file_heat_map",
      "Aggregate file edit frequency across all tasks and agents. Returns hottest files with edit count, unique agents, and last edit. Hot files = high coordination risk, good candidates for extra test coverage.",
      {
        limit: z.number().optional().describe("Max files to return (default: 20)"),
        project_id: z.string().optional().describe("Filter to a specific project"),
        min_edits: z.number().optional().describe("Minimum edit count to include (default: 1)"),
      },
      async ({ limit, project_id, min_edits }) => {
        try {
          const { getFileHeatMap } = require("../db/task-files.js") as any;
          const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
          const results = getFileHeatMap({ limit, project_id: resolvedProjectId, min_edits });
          return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("bulk_find_tasks_by_files")) {
    server.tool(
      "bulk_find_tasks_by_files",
      "Check multiple file paths at once for task/agent collisions. Returns per-path task list, in-progress count, and conflict flag.",
      {
        paths: z.array(z.string()).describe("Array of file paths to check"),
      },
      async ({ paths }) => {
        try {
          const { bulkFindTasksByFiles } = require("../db/task-files.js") as any;
          const results = bulkFindTasksByFiles(paths);
          return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_active_files")) {
    server.tool(
      "list_active_files",
      "Return all files linked to in-progress tasks across all agents — the bird's-eye view of what's being worked on right now.",
      {
        project_id: z.string().optional().describe("Filter by project"),
      },
      async ({ project_id }) => {
        try {
          const { listActiveFiles } = require("../db/task-files.js") as any;
          let files: any[] = listActiveFiles();
          if (project_id) {
            const pid = resolveId(project_id, "projects");
            const db = require("../db/database.js").getDatabase();
            files = db.query(`
              SELECT
                tf.path,
                tf.status AS file_status,
                tf.agent_id AS file_agent_id,
                tf.note,
                tf.updated_at,
                t.id AS task_id,
                t.short_id AS task_short_id,
                t.title AS task_title,
                t.status AS task_status,
                t.locked_by AS task_locked_by,
                t.locked_at AS task_locked_at,
                a.id AS agent_id,
                a.name AS agent_name
              FROM task_files tf
              JOIN tasks t ON tf.task_id = t.id
              LEFT JOIN agents a ON (tf.agent_id = a.id OR (tf.agent_id IS NULL AND t.assigned_to = a.id))
              WHERE t.status = 'in_progress'
                AND tf.status != 'removed'
                AND t.project_id = ?
              ORDER BY tf.updated_at DESC
            `).all(pid);
          }
          if (files.length === 0) {
            return { content: [{ type: "text" as const, text: "No active files — no in-progress tasks have linked files." }] };
          }
          return { content: [{ type: "text" as const, text: JSON.stringify(files, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === TASK COMMITS ===

  if (shouldRegisterTool("link_task_to_commit")) {
    server.tool(
      "link_task_to_commit",
      "Link a git commit SHA to a task. Creates an audit trail: task → commits. Upserts on same task+sha.",
      {
        task_id: z.string().describe("Task ID"),
        sha: z.string().describe("Git commit SHA (full or short)"),
        message: z.string().optional().describe("Commit message"),
        author: z.string().optional().describe("Commit author"),
        files_changed: z.array(z.string()).optional().describe("Files changed in this commit"),
        committed_at: z.string().optional().describe("ISO timestamp of commit"),
      },
      async ({ task_id, sha, message, author, files_changed, committed_at }) => {
        try {
          const resolvedId = resolveId(task_id);
          const commit = linkTaskToCommit({ task_id: resolvedId, sha, message, author, files_changed, committed_at });
          return { content: [{ type: "text" as const, text: JSON.stringify(commit, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("get_task_commits")) {
    server.tool(
      "get_task_commits",
      "Get all git commits linked to a task.",
      { task_id: z.string().describe("Task ID") },
      async ({ task_id }) => {
        try {
          const commits = getTaskCommits(resolveId(task_id));
          return { content: [{ type: "text" as const, text: JSON.stringify(commits, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("find_task_by_commit")) {
    server.tool(
      "find_task_by_commit",
      "Find which task a git commit SHA is linked to. Supports prefix matching.",
      { sha: z.string().describe("Git commit SHA (full or short prefix)") },
      async ({ sha }) => {
        try {
          const result = findTaskByCommit(sha);
          if (!result) return { content: [{ type: "text" as const, text: `No task linked to commit ${sha}` }] };
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  // === FILE LOCKS ===

  if (shouldRegisterTool("lock_file")) {
    server.tool(
      "lock_file",
      "Acquire an exclusive lock on a file path. Throws if another agent holds an active lock. Same agent re-locks refreshes the TTL.",
      {
        path: z.string().describe("File path to lock"),
        agent_id: z.string().describe("Agent acquiring the lock"),
        task_id: z.string().optional().describe("Task this lock is associated with"),
        ttl_seconds: z.number().optional().describe("Lock TTL in seconds (default: 1800 = 30 min)"),
      },
      async ({ path, agent_id, task_id, ttl_seconds }) => {
        try {
          const { lockFile } = require("../db/file-locks.js") as any;
          const lock = lockFile({ path, agent_id, task_id, ttl_seconds });
          return { content: [{ type: "text" as const, text: JSON.stringify(lock, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("unlock_file")) {
    server.tool(
      "unlock_file",
      "Release a file lock. Only the lock holder can release it. Returns true if released.",
      {
        path: z.string().describe("File path to unlock"),
        agent_id: z.string().describe("Agent releasing the lock (must be the lock holder)"),
      },
      async ({ path, agent_id }) => {
        try {
          const { unlockFile } = require("../db/file-locks.js") as any;
          const released = unlockFile(path, agent_id);
          return { content: [{ type: "text" as const, text: JSON.stringify({ released, path }) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("check_file_lock")) {
    server.tool(
      "check_file_lock",
      "Check who holds a lock on a file path. Returns null if unlocked or expired.",
      {
        path: z.string().describe("File path to check"),
      },
      async ({ path }) => {
        try {
          const { checkFileLock } = require("../db/file-locks.js") as any;
          const lock = checkFileLock(path);
          if (!lock) return { content: [{ type: "text" as const, text: JSON.stringify({ path, locked: false }) }] };
          return { content: [{ type: "text" as const, text: JSON.stringify({ path, locked: true, ...lock }) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_file_locks")) {
    server.tool(
      "list_file_locks",
      "List all active file locks. Optionally filter by agent_id.",
      {
        agent_id: z.string().optional().describe("Filter locks by agent"),
      },
      async ({ agent_id }) => {
        try {
          const { listFileLocks } = require("../db/file-locks.js") as any;
          const locks = listFileLocks(agent_id);
          return { content: [{ type: "text" as const, text: JSON.stringify(locks, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
