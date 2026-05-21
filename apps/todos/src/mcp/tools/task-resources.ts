// @ts-nocheck
/**
 * Task resources tools for the MCP server.
 * Auto-extracted from src/mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listTasks, getTask } from "../../db/tasks.js";
import { listProjects } from "../../db/projects.js";
import { listAgents } from "../../db/agents.js";
import {
  addTaskVerification,
  findTasksByGitRef,
  findTaskByCommit,
  getTaskGitRefs,
  getTaskTraceability,
  getTaskCommits,
  linkTaskGitRef,
  linkTaskToCommit,
} from "../../db/task-commits.js";
import {
  addTaskRunArtifact,
  addTaskRunCommand,
  addTaskRunEvent,
  addTaskRunFile,
  finishTaskRun,
  getTaskRunLedger,
  listTaskRuns,
  startTaskRun,
  verifyTaskRunArtifacts,
} from "../../db/task-runs.js";
import {
  cancelAgentRunDispatch,
  listAgentRunAdapters,
  listAgentRunQueue,
  queueAgentRun,
  removeAgentRunAdapter,
  retryAgentRunDispatch,
  runNextAgentDispatch,
  upsertAgentRunAdapter,
} from "../../lib/agent-run-dispatcher.js";
import {
  discoverVerificationProviderCapabilities,
  listVerificationProviders,
  removeVerificationProvider,
  runVerificationProvider,
  upsertVerificationProvider,
} from "../../lib/verification-providers.js";
import { createInboxItem, getInboxItem, listInboxItems } from "../../db/inbox.js";

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
          const { addTaskFile, bulkAddTaskFiles, detectFileConflicts } = require("../../db/task-files.js") as any;
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
          const { listTaskFiles } = require("../../db/task-files.js") as any;
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
          const { findTasksByFile } = require("../../db/task-files.js") as any;
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
          const { getFileHeatMap } = require("../../db/task-files.js") as any;
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
          const { bulkFindTasksByFiles } = require("../../db/task-files.js") as any;
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
          const { listActiveFiles } = require("../../db/task-files.js") as any;
          let files: any[] = listActiveFiles();
          if (project_id) {
            const pid = resolveId(project_id, "projects");
            const db = require("../../db/database.js").getDatabase();
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

  if (shouldRegisterTool("link_task_git_ref")) {
    server.tool(
      "link_task_git_ref",
      "Link a local git branch or pull request to a task. Upserts on task, ref_type, and name.",
      {
        task_id: z.string().describe("Task ID"),
        ref_type: z.enum(["branch", "pull_request"]).describe("Git ref type"),
        name: z.string().describe("Branch name, PR number, or PR label"),
        url: z.string().optional().describe("Optional remote URL for the branch or pull request"),
        provider: z.string().optional().describe("Provider name, e.g. git or github"),
        metadata: z.record(z.unknown()).optional().describe("Additional local metadata"),
      },
      async ({ task_id, ref_type, name, url, provider, metadata }) => {
        try {
          const resolvedId = resolveId(task_id);
          const ref = linkTaskGitRef({ task_id: resolvedId, ref_type, name, url, provider, metadata });
          return { content: [{ type: "text" as const, text: JSON.stringify(ref, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("get_task_git_refs")) {
    server.tool(
      "get_task_git_refs",
      "Get branches and pull requests linked to a task.",
      { task_id: z.string().describe("Task ID") },
      async ({ task_id }) => {
        try {
          const refs = getTaskGitRefs(resolveId(task_id));
          return { content: [{ type: "text" as const, text: JSON.stringify(refs, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("find_tasks_by_git_ref")) {
    server.tool(
      "find_tasks_by_git_ref",
      "Find tasks linked to a branch name, PR number, or PR URL.",
      { ref: z.string().describe("Branch name, PR number, or PR URL substring") },
      async ({ ref }) => {
        try {
          const refs = findTasksByGitRef(ref);
          return { content: [{ type: "text" as const, text: JSON.stringify(refs, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("add_task_verification")) {
    server.tool(
      "add_task_verification",
      "Record a local verification command, status, summary, and optional artifact path for a task.",
      {
        task_id: z.string().describe("Task ID"),
        command: z.string().describe("Verification command that was run"),
        status: z.enum(["passed", "failed", "unknown"]).optional().describe("Verification result"),
        output_summary: z.string().optional().describe("Short command output summary"),
        artifact_path: z.string().optional().describe("Optional local artifact or log path"),
        agent_id: z.string().optional().describe("Agent that ran the verification"),
        run_at: z.string().optional().describe("ISO timestamp when the command was run"),
      },
      async ({ task_id, command, status, output_summary, artifact_path, agent_id, run_at }) => {
        try {
          const verification = addTaskVerification({
            task_id: resolveId(task_id),
            command,
            status,
            output_summary,
            artifact_path,
            agent_id,
            run_at,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(verification, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("set_verification_provider")) {
    server.tool(
      "set_verification_provider",
      "Create or update an optional local verification provider adapter. Providers are local-only and do not call cloud services unless the configured command does so.",
      {
        name: z.string(),
        kind: z.enum(["command", "testbox", "ci_log", "browser", "script"]),
        command: z.string().optional(),
        cwd: z.string().optional(),
        env: z.record(z.string()).optional(),
        capabilities: z.array(z.string()).optional(),
        retry: z.object({ attempts: z.number().optional(), backoff_ms: z.number().optional() }).optional(),
        timeout_ms: z.number().optional(),
      },
      async (input) => {
        try {
          const provider = upsertVerificationProvider(input);
          return { content: [{ type: "text" as const, text: JSON.stringify(provider, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("list_verification_providers")) {
    server.tool("list_verification_providers", "List configured local verification provider adapters.", {}, async () => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(listVerificationProviders(), null, 2) }] };
      } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
    });
  }

  if (shouldRegisterTool("get_verification_provider_capabilities")) {
    server.tool(
      "get_verification_provider_capabilities",
      "Describe a local verification provider's deterministic capabilities.",
      { name: z.string() },
      async ({ name }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify(discoverVerificationProviderCapabilities(name), null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("remove_verification_provider")) {
    server.tool(
      "remove_verification_provider",
      "Remove a configured local verification provider.",
      { name: z.string() },
      async ({ name }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify({ removed: removeVerificationProvider(name) }, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("run_verification_provider")) {
    server.tool(
      "run_verification_provider",
      "Run a local verification provider and optionally record task verification evidence.",
      {
        name: z.string(),
        task_id: z.string().optional(),
        agent_id: z.string().optional(),
        command: z.string().optional(),
        cwd: z.string().optional(),
        env: z.record(z.string()).optional(),
        log_text: z.string().optional(),
        log_path: z.string().optional(),
        url: z.string().optional(),
        artifact_path: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
      },
      async (input) => {
        try {
          const result = await runVerificationProvider({
            ...input,
            task_id: input.task_id ? resolveId(input.task_id) : undefined,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("get_task_traceability")) {
    server.tool(
      "get_task_traceability",
      "Get local git commits, branches, pull requests, and verification commands linked to a task.",
      { task_id: z.string().describe("Task ID") },
      async ({ task_id }) => {
        try {
          const trace = getTaskTraceability(resolveId(task_id));
          return { content: [{ type: "text" as const, text: JSON.stringify(trace, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("start_task_run")) {
    server.tool(
      "start_task_run",
      "Start a local run ledger entry for a task. Optionally claims the task for the agent. Never uploads artifacts or calls hosted APIs.",
      {
        task_id: z.string().describe("Task ID"),
        agent_id: z.string().optional().describe("Agent starting the run"),
        title: z.string().optional().describe("Run title"),
        summary: z.string().optional().describe("Run summary"),
        metadata: z.record(z.unknown()).optional().describe("Additional local metadata"),
        claim: z.boolean().optional().describe("Claim/start the task before recording the run"),
      },
      async ({ task_id, agent_id, title, summary, metadata, claim }) => {
        try {
          const run = startTaskRun({ task_id: resolveId(task_id), agent_id, title, summary, metadata, claim });
          return { content: [{ type: "text" as const, text: JSON.stringify(run, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("list_task_runs")) {
    server.tool(
      "list_task_runs",
      "List local run ledger entries, optionally scoped to a task.",
      { task_id: z.string().optional().describe("Optional task ID") },
      async ({ task_id }) => {
        try {
          const runs = listTaskRuns(task_id ? resolveId(task_id) : undefined);
          return { content: [{ type: "text" as const, text: JSON.stringify(runs, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("add_task_run_event")) {
    server.tool(
      "add_task_run_event",
      "Record a local run event such as progress, comment, claim, command, file, artifact, completed, failed, or cancelled.",
      {
        run_id: z.string().describe("Run ID or prefix"),
        event_type: z.enum(["started", "progress", "claim", "comment", "command", "file", "artifact", "completed", "failed", "cancelled"]),
        message: z.string().optional().describe("Event message"),
        data: z.record(z.unknown()).optional().describe("Additional local event data"),
        agent_id: z.string().optional().describe("Agent recording the event"),
      },
      async ({ run_id, event_type, message, data, agent_id }) => {
        try {
          const event = addTaskRunEvent({ run_id, event_type, message, data, agent_id });
          return { content: [{ type: "text" as const, text: JSON.stringify(event, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("add_task_run_command")) {
    server.tool(
      "add_task_run_command",
      "Record local command/test evidence for a run and mirror it into task verification evidence.",
      {
        run_id: z.string().describe("Run ID or prefix"),
        command: z.string().describe("Command that was run"),
        status: z.enum(["passed", "failed", "unknown"]).optional().describe("Command result"),
        exit_code: z.number().optional().describe("Process exit code"),
        output_summary: z.string().optional().describe("Short output summary"),
        artifact_path: z.string().optional().describe("Optional local artifact or log path"),
        agent_id: z.string().optional().describe("Agent that ran the command"),
      },
      async ({ run_id, command, status, exit_code, output_summary, artifact_path, agent_id }) => {
        try {
          const evidence = addTaskRunCommand({ run_id, command, status, exit_code, output_summary, artifact_path, agent_id });
          return { content: [{ type: "text" as const, text: JSON.stringify(evidence, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("add_task_run_file")) {
    server.tool(
      "add_task_run_file",
      "Record a file touched by a local run and link it to the task.",
      {
        run_id: z.string().describe("Run ID or prefix"),
        path: z.string().describe("File path"),
        status: z.enum(["planned", "active", "modified", "reviewed", "removed"]).optional().describe("File status"),
        note: z.string().optional().describe("Why the file was touched"),
        agent_id: z.string().optional().describe("Agent touching the file"),
      },
      async ({ run_id, path, status, note, agent_id }) => {
        try {
          const file = addTaskRunFile({ run_id, path, status, note, agent_id });
          return { content: [{ type: "text" as const, text: JSON.stringify(file, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("add_task_run_artifact")) {
    server.tool(
      "add_task_run_artifact",
      "Record a local artifact for a run in the content-addressed store, or metadata only when content is unavailable.",
      {
        run_id: z.string().describe("Run ID or prefix"),
        path: z.string().describe("Local artifact path"),
        artifact_type: z.string().optional().describe("Artifact type, e.g. log, screenshot, report"),
        description: z.string().optional().describe("Artifact description"),
        size_bytes: z.number().optional().describe("Artifact size in bytes"),
        sha256: z.string().optional().describe("SHA-256 checksum"),
        metadata: z.record(z.unknown()).optional().describe("Additional local metadata"),
        store_content: z.boolean().optional().describe("Copy local file content into the content-addressed store. true fails if the file is missing; false records metadata only."),
        retention_days: z.number().optional().describe("Retention period for stored content metadata"),
        agent_id: z.string().optional().describe("Agent adding the artifact"),
      },
      async ({ run_id, path, artifact_type, description, size_bytes, sha256, metadata, store_content, retention_days, agent_id }) => {
        try {
          const artifact = addTaskRunArtifact({ run_id, path, artifact_type, description, size_bytes, sha256, metadata, store_content, retention_days, agent_id });
          return { content: [{ type: "text" as const, text: JSON.stringify(artifact, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("verify_task_run_artifacts")) {
    server.tool(
      "verify_task_run_artifacts",
      "Verify locally stored run artifact content against recorded checksums.",
      {
        run_id: z.string().describe("Run ID or prefix"),
      },
      async ({ run_id }) => {
        try {
          const reports = verifyTaskRunArtifacts(run_id);
          return { content: [{ type: "text" as const, text: JSON.stringify(reports, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("finish_task_run")) {
    server.tool(
      "finish_task_run",
      "Finish a local run ledger entry as completed, failed, or cancelled.",
      {
        run_id: z.string().describe("Run ID or prefix"),
        status: z.enum(["completed", "failed", "cancelled"]).describe("Final run status"),
        summary: z.string().optional().describe("Final summary"),
        agent_id: z.string().optional().describe("Agent finishing the run"),
      },
      async ({ run_id, status, summary, agent_id }) => {
        try {
          const run = finishTaskRun({ run_id, status, summary, agent_id });
          return { content: [{ type: "text" as const, text: JSON.stringify(run, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("get_task_run_ledger")) {
    server.tool(
      "get_task_run_ledger",
      "Get a local run ledger with events, commands, files, and artifact metadata.",
      { run_id: z.string().describe("Run ID or prefix") },
      async ({ run_id }) => {
        try {
          const ledger = getTaskRunLedger(run_id);
          return { content: [{ type: "text" as const, text: JSON.stringify(ledger, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("set_agent_run_adapter")) {
    server.tool(
      "set_agent_run_adapter",
      "Create or update a local agent run adapter command. Supports {task_id}, {run_id}, and {agent_id} placeholders.",
      {
        name: z.string(),
        command: z.string(),
        sandbox: z.string().optional(),
        cwd: z.string().optional(),
        env: z.record(z.string()).optional(),
      },
      async (input) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify(upsertAgentRunAdapter(input), null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("list_agent_run_adapters")) {
    server.tool("list_agent_run_adapters", "List configured local agent run adapters.", {}, async () => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(listAgentRunAdapters(), null, 2) }] };
      } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
    });
  }

  if (shouldRegisterTool("remove_agent_run_adapter")) {
    server.tool(
      "remove_agent_run_adapter",
      "Remove a configured local agent run adapter.",
      { name: z.string() },
      async ({ name }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify({ removed: removeAgentRunAdapter(name) }, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("queue_agent_run")) {
    server.tool(
      "queue_agent_run",
      "Queue a local agent run for a task and attach a run ledger ID. Does not call hosted runners.",
      {
        task_id: z.string(),
        agent_id: z.string().optional(),
        adapter: z.string().optional(),
        command: z.string().optional(),
        sandbox: z.string().optional(),
        cwd: z.string().optional(),
        title: z.string().optional(),
        summary: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
        claim: z.boolean().optional(),
      },
      async ({ task_id, ...input }) => {
        try {
          const queued = queueAgentRun({ ...input, task_id: resolveId(task_id) });
          return { content: [{ type: "text" as const, text: JSON.stringify(queued, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("list_agent_run_queue")) {
    server.tool("list_agent_run_queue", "List local agent run dispatch queue entries.", {}, async () => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(listAgentRunQueue(), null, 2) }] };
      } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
    });
  }

  if (shouldRegisterTool("run_next_agent_dispatch")) {
    server.tool(
      "run_next_agent_dispatch",
      "Run the next queued local agent dispatch, optionally as a dry-run.",
      {
        adapter: z.string().optional(),
        dry_run: z.boolean().optional(),
      },
      async (input) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify(await runNextAgentDispatch(input), null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("cancel_agent_run_dispatch")) {
    server.tool(
      "cancel_agent_run_dispatch",
      "Cancel a queued or running local agent dispatch.",
      { run_id: z.string() },
      async ({ run_id }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify(cancelAgentRunDispatch(run_id), null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("retry_agent_run_dispatch")) {
    server.tool(
      "retry_agent_run_dispatch",
      "Queue a retry for a previous local agent dispatch.",
      { run_id: z.string() },
      async ({ run_id }) => {
        try {
          return { content: [{ type: "text" as const, text: JSON.stringify(retryAgentRunDispatch(run_id), null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("create_inbox_item")) {
    server.tool(
      "create_inbox_item",
      "Capture a local inbox item from pasted errors, CI logs, git context, files, or GitHub issue URLs. Creates a linked task by default.",
      {
        body: z.string().describe("Captured text, log, pasted failure, git context, or URL"),
        title: z.string().optional().describe("Optional title"),
        source_type: z.enum(["pasted_error", "ci_log", "git_context", "github_issue", "file", "other"]).optional().describe("Source type"),
        source_name: z.string().optional().describe("Human-readable source name"),
        source_url: z.string().optional().describe("Source URL"),
        metadata: z.record(z.unknown()).optional().describe("Additional local metadata"),
        project_id: z.string().optional().describe("Optional project ID"),
        priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Linked task priority"),
        tags: z.array(z.string()).optional().describe("Extra linked task tags"),
        create_task: z.boolean().optional().describe("Whether to create a linked task (default true)"),
      },
      async ({ body, title, source_type, source_name, source_url, metadata, project_id, priority, tags, create_task }) => {
        try {
          const result = createInboxItem({
            body,
            title,
            source_type,
            source_name,
            source_url,
            metadata,
            project_id,
            priority,
            tags,
            create_task,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("list_inbox_items")) {
    server.tool(
      "list_inbox_items",
      "List local inbox intake items.",
      {
        status: z.enum(["new", "triaged", "ignored"]).optional().describe("Optional status filter"),
        source_type: z.enum(["pasted_error", "ci_log", "git_context", "github_issue", "file", "other"]).optional().describe("Optional source type filter"),
        limit: z.number().optional().describe("Max rows"),
      },
      async ({ status, source_type, limit }) => {
        try {
          const items = listInboxItems({ status, source_type, limit });
          return { content: [{ type: "text" as const, text: JSON.stringify(items, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("get_inbox_item")) {
    server.tool(
      "get_inbox_item",
      "Get one local inbox intake item by ID or prefix.",
      { id: z.string().describe("Inbox item ID or prefix") },
      async ({ id }) => {
        try {
          const item = getInboxItem(id);
          return { content: [{ type: "text" as const, text: JSON.stringify(item, null, 2) }] };
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
          const { lockFile } = require("../../db/file-locks.js") as any;
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
          const { unlockFile } = require("../../db/file-locks.js") as any;
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
          const { checkFileLock } = require("../../db/file-locks.js") as any;
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
          const { listFileLocks } = require("../../db/file-locks.js") as any;
          const locks = listFileLocks(agent_id);
          return { content: [{ type: "text" as const, text: JSON.stringify(locks, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
