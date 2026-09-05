import type { Command } from "commander";
import chalk from "chalk";
import { readFileSync, statSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { getDatabase, resolvePartialId } from "../../db/database.js";
import {
  createProject,
  deleteProject,
  listProjects,
  getProjectByPath,
  renameProject,
  updateProject,
} from "../../db/projects.js";
import { addComment } from "../../db/comments.js";
import { addPlanComment } from "../../db/plan-comments.js";
import { getPlan, resolvePlanRefDetailed } from "../../db/plans.js";
import { getTask } from "../../db/tasks.js";
import { getTodosCloudClient, cloudAddComment, cloudAddPlanComment, cloudApplyProjectTaskListEnsure, cloudCreateProject, cloudDeleteProject, cloudListProjects, cloudListTasks, cloudPlanProjectTaskListEnsure, cloudResolvePlan, cloudResolveProject, cloudResolveProjectRef, cloudRollbackProjectTaskListEnsure, cloudUpdateProject, cloudAddDependency, cloudRemoveDependency, cloudGetDependencies, cloudGetTaskRelations, cloudRenameProject } from "../cloud-router.js";
import { resolveWritableIdentity } from "../../lib/creator-identity.js";
import { env } from "../../lib/env.js";
import {
  buildProjectDependencyGraph,
  buildTaskDependencyEdges,
  getProjectDependencyGraph,
  getTaskDependencyEdges,
  type DependencyEdge,
  type ProjectDependencyGraph,
} from "../../lib/dependency-graph.js";
import type { PlanComment, Task, TaskComment } from "../../types/index.js";
import { TaskNotFoundError } from "../../types/index.js";
import { searchTasks } from "../../lib/search.js";
import {
  deleteSearchView,
  listSearchViews,
  runSavedSearch,
  runSearchView,
  saveSearchView,
  SAVED_SEARCH_SCOPES,
  type SavedSearchFilters,
  type SavedSearchScope,
} from "../../lib/saved-search-views.js";
import { defaultSyncAgents, syncWithAgent, syncWithAgents } from "../../lib/sync.js";
import { getAgentTaskListId } from "../../lib/config.js";
import { autoProject, autoDetectProject, handleError, output, outputRecord, formatTaskLine, parseEnumFlag, parseEnumFlagList, resolveExplicitProject, resolveTaskId, resolveTaskIdForCommand, TASK_PRIORITY_FLAG, TASK_STATUS_FLAG } from "../helpers.js";
import { redactBroadOutput, redactBroadTasks } from "../output-redaction.js";

/** Full UUID shape used by the comment target resolver (task vs plan). */
const COMMENT_TARGET_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { createLocalSqliteTodosStorageAdapter } from "../../storage/local-sqlite.js";
import {
  applyProjectTaskListEnsure,
  planProjectTaskListEnsure,
  rollbackProjectTaskListEnsure,
} from "../../lib/project-task-list-ensure.js";

function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/**
 * `--scope` vocabulary, taken from `SAVED_SEARCH_SCOPES`. `normalizeScope` silently
 * falls back to "tasks" for anything it does not recognise, so a mistyped
 * `--scope projekts` used to search tasks and report those results as if they were
 * the requested scope. Validating the flag first turns that into a non-zero error.
 */
const SEARCH_SCOPE_FLAG = {
  name: "--scope",
  vocabulary: SAVED_SEARCH_SCOPES,
  normalize: (value: string) => value.toLowerCase().trim(),
  allowList: false,
} as const;

/**
 * `todos export --format` vocabulary, including the documented spelling variants
 * the action already accepts. An unrecognised value used to fall through the
 * markdown branch and silently emit JSON, so `--format mardown` produced a
 * plausible-looking export in the wrong format with exit 0.
 */
const EXPORT_FORMATS = ["json", "md", "markdown", "todos.md", "todos-md", "bridge"] as const;
const EXPORT_FORMAT_FLAG = {
  name: "--format",
  vocabulary: EXPORT_FORMATS,
  normalize: (value: string) => value.toLowerCase().trim(),
  allowList: false,
} as const;

/** The resolved cloud/self-hosted client, when a remote authority is selected. */
type CloudClient = NonNullable<ReturnType<typeof getTodosCloudClient>>;

/** Bounded concurrency for per-task edge reads while assembling a cloud graph. */
const CLOUD_GRAPH_EDGE_CONCURRENCY = 6;

/**
 * True unless the row is the `unresolved` placeholder `cloudGetTaskRelations`
 * synthesizes for an edge whose target task cannot be read. Dropping these
 * keeps the cloud per-task edge read identical to local (whose SQL JOIN already
 * omits dangling edges) instead of leaking a synthetic "pending" node.
 */
function isResolvedTask(task: Task): boolean {
  const metadata = task.metadata as Record<string, unknown> | null | undefined;
  return !(metadata && metadata["unresolved"] === true);
}

/**
 * Assemble the whole-project dependency graph from a hosted /v1 authority.
 * The cloud API exposes edges per task, so nodes come from one list call and
 * the adjacency list is gathered from each task's dependency edges (bounded
 * concurrency). A single unreadable task degrades to a missing node/edge rather
 * than failing the whole read, mirroring `cloudGetTaskRelations`.
 */
async function buildCloudProjectDependencyGraph(
  cloud: CloudClient,
  projectId: string | null,
): Promise<ProjectDependencyGraph> {
  const tasks = await cloudListTasks(cloud, {
    ...(projectId ? { project_id: projectId } : {}),
    include_subtasks: true,
  });
  const edges: DependencyEdge[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(CLOUD_GRAPH_EDGE_CONCURRENCY, tasks.length) },
    async () => {
      for (let index = cursor++; index < tasks.length; index = cursor++) {
        const task = tasks[index]!;
        try {
          const deps = await cloudGetDependencies(cloud, task.id);
          for (const edge of deps.dependencies) {
            const key = `${edge.task_id}|${edge.depends_on}`;
            if (seen.has(key)) continue;
            seen.add(key);
            edges.push({ task_id: edge.task_id, depends_on: edge.depends_on });
          }
        } catch {
          // A single unreadable task must not fail the whole-project read.
        }
      }
    },
  );
  await Promise.all(workers);
  return buildProjectDependencyGraph(projectId, tasks, edges);
}

/** Human rendering for the whole-project graph (JSON is the primary surface). */
function printProjectDependencyGraph(graph: ProjectDependencyGraph): void {
  if (graph.nodes.length === 0) {
    console.log(chalk.dim("No tasks in scope."));
    return;
  }
  console.log(chalk.bold(`Dependency graph: ${graph.nodes.length} task(s), ${graph.edges.length} edge(s)`));
  if (graph.cycles.length > 0) {
    console.log(chalk.red(`  ${graph.cycles.length} cycle(s) detected`));
  }
  for (const edge of graph.edges) {
    console.log(`  ${chalk.cyan(edge.task_id.slice(0, 8))} depends on ${chalk.cyan(edge.depends_on.slice(0, 8))}`);
  }
}

function splitList(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  const values = Array.isArray(value) ? value : [value];
  const items = values.flatMap((item) => item.split(",").map((part) => part.trim()).filter(Boolean));
  return items.length > 0 ? items : undefined;
}

function parseJsonObjectOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {}
  throw new Error(`${label} must be a JSON object`);
}

function countProjectTasks(projectId: string): { total: number; incomplete: number } {
  const db = getDatabase();
  return db.query(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END), 0) AS incomplete
     FROM tasks
     WHERE project_id = ?`,
  ).get(projectId) as { total: number; incomplete: number };
}

function countTasksForDeregistration(tasks: readonly Task[]): { total: number; incomplete: number } {
  return {
    total: tasks.length,
    incomplete: tasks.filter((task) => task.status !== "completed" && task.status !== "cancelled").length,
  };
}

function pathIsWithinPrefix(projectPath: string, prefix: string): boolean {
  const normalizedPath = resolve(projectPath);
  const normalizedPrefix = resolve(prefix);
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}${sep}`);
}

/**
 * Returns the rows whose path is the requested path under a different letter
 * case — the project-side mirror of findCaseVariantRows (agent names, task
 * 1170f87b). Path-casing drift (/home/hasna/workspace vs /home/hasna/Workspace
 * vs /Users/hasna/Workspace) is the measured root cause of duplicate project
 * rows (todos 1dcb9e66): 132 of 182 duplicate-name groups span machines with
 * differing paths in exactly this shape. `resolve()` has already normalised
 * `.`/`..` and trailing slashes at the call sites, so case is the remaining
 * drift dimension this guard closes.
 * An EXACT path match is the ordinary restart path and returns [].
 */
export function findCaseVariantProjectPaths<T extends { id: string; path: string }>(
  projects: readonly T[],
  requestedPath: string,
): T[] {
  const raw = requestedPath.trim();
  if (!raw) return [];
  const folded = raw.toLowerCase();
  if (projects.some((project) => project.path === raw)) return [];
  return projects.filter((project) => project.path.toLowerCase() === folded);
}

function describePathCollisions<T extends { id: string; path: string; name?: string | null }>(
  variants: readonly T[],
): string {
  return variants
    .map((v) => `${v.name ?? v.id} (${v.id}) at ${v.path}`)
    .join("; ");
}

function resolveTaskListFilter(input: string | undefined, projectId?: string): string | undefined {
  if (!input) return undefined;
  const db = getDatabase();
  const id = input.length >= 36
    ? db.query("SELECT id FROM task_lists WHERE id = ?").get(input) as { id: string } | null
    : null;
  if (id) return id.id;

  if (input.length < 36) {
    const partialIds = db.query("SELECT id FROM task_lists WHERE id LIKE ?").all(`${input}%`) as { id: string }[];
    if (partialIds.length === 1) return partialIds[0]!.id;
    if (partialIds.length > 1) {
      throw new Error(`Ambiguous task list ID: ${input}`);
    }
  }

  if (projectId) {
    const projectSlug = db.query(
      "SELECT id FROM task_lists WHERE project_id = ? AND slug = ?",
    ).get(projectId, input) as { id: string } | null;
    if (projectSlug) return projectSlug.id;

    const standaloneSlug = db.query(
      "SELECT id FROM task_lists WHERE project_id IS NULL AND slug = ?",
    ).get(input) as { id: string } | null;
    if (standaloneSlug) return standaloneSlug.id;

    const otherProjectSlugs = db.query(
      "SELECT id FROM task_lists WHERE slug = ? LIMIT 2",
    ).all(input) as { id: string }[];
    if (otherProjectSlugs.length > 0) {
      throw new Error(`Task list slug "${input}" does not belong to the selected project`);
    }
  } else {
    const slugMatches = db.query("SELECT id FROM task_lists WHERE slug = ?").all(input) as { id: string }[];
    if (slugMatches.length === 1) return slugMatches[0]!.id;
    if (slugMatches.length > 1) {
      throw new Error(`Ambiguous task list slug: ${input}. Use --project or the task list ID.`);
    }
  }

  throw new Error(`Could not resolve task list ID: ${input}`);
}

function buildSearchFilters(query: string | undefined, opts: any, projectId?: string): SavedSearchFilters {
  const filterPatch = parseJsonObjectOption(opts.filter, "--filter");
  const customFields = parseJsonObjectOption(opts.fieldCustom, "--field-custom");
  const labels = splitList(opts.fieldLabel);
  const tags = splitList(opts.tag);
  // Validated against TASK_STATUSES / TASK_PRIORITIES before they can reach the
  // search filter. Unvalidated they matched nothing and `search` printed
  // `No tasks matching "<query>".` with exit 0 — the same silent empty result the
  // `list --status open` incident produced.
  const filters: SavedSearchFilters = {
    query: query || opts.query,
    project_id: opts.allProjects ? undefined : projectId,
    status: parseEnumFlagList(opts.status, TASK_STATUS_FLAG),
    priority: parseEnumFlagList(opts.priority, TASK_PRIORITY_FLAG),
    assigned_to: opts.assigned,
    agent_id: opts.agentId,
    task_list_id: filterPatch?.task_list_id === undefined
      ? resolveTaskListFilter(opts.taskList, projectId)
      : undefined,
    plan_id: opts.plan,
    task_id: opts.task,
    tags,
    created_after: opts.createdAfter,
    updated_after: opts.since || opts.updatedAfter,
    has_dependencies: opts.hasDeps ? true : undefined,
    is_blocked: opts.blocked ? true : undefined,
    depends_on: opts.dependsOn,
    blocks: opts.blocks,
    limit: opts.limit ? Number(opts.limit) : undefined,
    local_fields: labels || opts.fieldOwner || opts.fieldArea || opts.fieldSeverity || customFields
      ? {
        labels,
        owner: opts.fieldOwner,
        area: opts.fieldArea,
        severity: opts.fieldSeverity,
        custom: customFields,
      }
      : undefined,
    ...filterPatch,
  };
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined)) as SavedSearchFilters;
}

export function registerProjectCommands(program: Command) {
  program
    .command("project-bootstrap [path]")
    .description("Discover a local workspace and initialize project task state")
    .option("--name <name>", "Project display name")
    .option("--task-list <slug>", "Default task list slug")
    .option("--route-enabled", "Mark the default task list as eligible for OpenLoops task-created routing")
    .option("--dry-run", "Show discovery without writing local state")
    .action(async (inputPath: string | undefined, opts) => {
      const globalOpts = program.opts();
      try {
        const { bootstrapProject } = await import("../../lib/project-bootstrap.js");
        const result = bootstrapProject({
          path: inputPath || globalOpts.project || process.cwd(),
          name: opts.name,
          taskListSlug: opts.taskList,
          routeEnabled: Boolean(opts.routeEnabled),
          dryRun: opts.dryRun,
        });

        if (globalOpts.json) {
          output(result, true);
          return;
        }

        console.log(chalk.bold("Project bootstrap"));
        console.log(`  ${chalk.dim("Path:")}       ${result.discovery.projectPath}`);
        console.log(`  ${chalk.dim("Name:")}       ${result.discovery.projectName}`);
        if (result.discovery.gitRoot) console.log(`  ${chalk.dim("Git root:")}   ${result.discovery.gitRoot}`);
        if (result.discovery.workspaceRoot) console.log(`  ${chalk.dim("Workspace:")}  ${result.discovery.workspaceRoot}`);
        if (result.dryRun) {
          console.log(chalk.dim("  Dry-run: no local state was changed."));
          return;
        }
        if (result.project) console.log(`  ${chalk.dim("Project:")}    ${result.project.id.slice(0, 8)} ${result.created.project ? "(created)" : "(existing)"}`);
        if (result.taskList) console.log(`  ${chalk.dim("Task list:")}  ${result.taskList.slug} ${result.created.taskList ? "(created)" : "(existing)"}`);
        if (result.taskList?.metadata.route_enabled === true) console.log(`  ${chalk.dim("Routing:")}    route-enabled`);
        if (result.created.sources.length > 0) {
          console.log(`  ${chalk.dim("Sources:")}    ${result.created.sources.join(", ")}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  // ── comment target resolution (task first, plan fallback) ──
  // `todos comment <plan-id>` previously 404'd with "task not found": the verb
  // only resolved task references and only wrote task comments, so plan-level
  // outcomes could not be recorded on the plan row (todos task 04ee08fd,
  // measured by multiple skills-plan lanes 2026-08-18). Task comments keep
  // their exact prior behavior — task resolution first, and in cloud mode the
  // task route is tried before any plan lookup so existing task flows get zero
  // extra round-trips. Only a task-not-found outcome falls through to the plan
  // surface.
  interface CommentTargetWrite {
    content: string;
    progressPct?: number;
    agent_id?: string;
    session_id?: string;
  }

  async function addCommentToTarget(
    cloud: ReturnType<typeof getTodosCloudClient>,
    id: string,
    input: CommentTargetWrite,
  ): Promise<TaskComment | PlanComment> {
    if (!cloud) {
      const target = resolveLocalCommentTarget(id);
      if (!target) throw new TaskNotFoundError(id);
      if (target.kind === "plan") {
        if (input.progressPct !== undefined) {
          throw new Error("--pct is not supported on plan comments; progress percentages are task-scoped.");
        }
        return addPlanComment({
          plan_id: target.id,
          content: input.content,
          agent_id: input.agent_id,
          session_id: input.session_id,
        });
      }
      return addComment({
        task_id: target.id,
        content: input.content,
        agent_id: input.agent_id,
        session_id: input.session_id,
        ...(input.progressPct !== undefined ? { type: "progress", progress_pct: input.progressPct } : {}),
      });
    }

    // Cloud mode: task path first. A full UUID is passed straight to the task
    // comment route (zero detour for tasks); a short ref resolves over /v1.
    let resolvedId: string;
    try {
      resolvedId = await resolveTaskIdForCommand(id, cloud);
    } catch (taskRefError) {
      const plan = await cloudResolvePlan(cloud, id);
      if (!plan) throw taskRefError;
      return writeCloudPlanComment(cloud, plan.id, input);
    }
    try {
      return await cloudAddComment(cloud, resolvedId, {
        content: input.content,
        agent_id: input.agent_id,
        session_id: input.session_id,
        ...(input.progressPct !== undefined ? { type: "progress", progress_pct: input.progressPct } : {}),
      });
    } catch (taskCommentError) {
      // The measured defect: POST /tasks/:id/comments answers 404 "task not
      // found" for a plan id. That exact outcome falls back to the plan row;
      // anything else (auth, 5xx, validation) is rethrown unchanged.
      if (!isTaskNotFoundStatus(taskCommentError)) throw taskCommentError;
      const plan = await cloudResolvePlan(cloud, id);
      if (!plan) throw taskCommentError;
      return writeCloudPlanComment(cloud, plan.id, input);
    }
  }

  async function writeCloudPlanComment(
    cloud: NonNullable<ReturnType<typeof getTodosCloudClient>>,
    planId: string,
    input: CommentTargetWrite,
  ): Promise<PlanComment> {
    if (input.progressPct !== undefined) {
      throw new Error("--pct is not supported on plan comments; progress percentages are task-scoped.");
    }
    return cloudAddPlanComment(cloud, planId, {
      content: input.content,
      agent_id: input.agent_id,
      session_id: input.session_id,
    });
  }

  /**
   * Local task-or-plan resolution that does NOT exit the process. The shared
   * `resolveTaskId` helper calls handleError (process.exit) on an unresolvable
   * short ref, which would make plan slugs unreachable; this mirrors its rules
   * but returns null so the caller can fall back to the plan surface.
   */
  function resolveLocalCommentTarget(id: string): { kind: "task" | "plan"; id: string } | null {
    const raw = (id ?? "").trim();
    if (!raw) return null;
    const db = getDatabase();
    if (COMMENT_TARGET_UUID_RE.test(raw)) {
      const lower = raw.toLowerCase();
      if (getTask(lower, db)) return { kind: "task", id: lower };
      if (getPlan(lower, db)) return { kind: "plan", id: lower };
      return null;
    }
    let taskId: string | null = null;
    let taskError: unknown;
    try {
      taskId = resolvePartialId(db, "tasks", raw);
    } catch (error) {
      taskError = error;
    }
    if (taskId) return { kind: "task", id: taskId };
    const planRef = resolvePlanRefDetailed(raw, db);
    if (planRef.id) return { kind: "plan", id: planRef.id };
    if (taskError) throw taskError;
    return null;
  }

  function isTaskNotFoundStatus(error: unknown): boolean {
    return Boolean(
      error && typeof error === "object" && (error as { status?: unknown }).status === 404,
    );
  }

  // comment (aliased as log-progress so documented progress commands work)
  program
    .command("comment <id> [text]")
    .alias("log-progress")
    .description("Add a comment to a task (alias: log-progress, for recording intermediate progress)")
    .option("--file <path>", "Read comment text from a UTF-8 file")
    .option("--pct <percent>", "Progress percentage (0-100) to record alongside the note")
    .action(async (id: string, text: string | undefined, opts: { file?: string; pct?: string }) => {
      const hasPositionalContent = text !== undefined;
      const hasFileContent = opts.file !== undefined;
      if (hasPositionalContent === hasFileContent) {
        handleError(new Error("Provide exactly one comment content source: positional text or --file <path>, not both."));
      }

      let content: string;
      if (opts.file !== undefined) {
        const commentFilePath = resolve(opts.file);
        let isRegularFile = false;
        try {
          isRegularFile = statSync(commentFilePath).isFile();
        } catch (error) {
          handleError(new Error(`Unable to read comment file "${opts.file}".`, { cause: error }));
        }
        if (!isRegularFile) {
          handleError(new Error(`Comment file "${opts.file}" must be a regular file.`));
        }
        try {
          content = readFileSync(commentFilePath, "utf8");
        } catch (error) {
          handleError(new Error(`Unable to read comment file "${opts.file}".`, { cause: error }));
        }
      } else {
        content = text!;
      }
      if (!content.trim()) {
        handleError(new Error("Comment content must not be empty."));
      }

      const globalOpts = program.opts();
      const cloud = getTodosCloudClient();
      let progressPct: number | undefined;
      if (opts.pct !== undefined) {
        const pct = parseInt(opts.pct, 10);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          handleError(new Error("--pct must be a number between 0 and 100"));
        }
        content = `[progress ${pct}%] ${content}`;
        progressPct = pct;
      }
      // Bare `globalOpts.agent` used to be the only source checked here, so
      // TODOS_AGENT_ID / HASNA_TODOS_AGENT_ID — the documented per-session escape
      // hatch that `add`, `start`, and `done` all honour via resolveWritableIdentity
      // — was silently invisible to this one command (todos task 39b4255b). This
      // mirrors task-commands.ts's `add`: an explicit --agent keeps its original
      // casing, and falls back to the resolver's canonicalised value (env only —
      // never the station-shared identity.json file, which is not process-bound).
      const router = resolveWritableIdentity(globalOpts.agent);
      const agentId = globalOpts.agent || router.agent_id || undefined;
      try {
        const comment = await addCommentToTarget(cloud, id, {
          content,
          progressPct,
          agent_id: agentId,
          session_id: globalOpts.session,
        });

        if (globalOpts.json) {
          output(comment, true);
        } else {
          console.log(chalk.green("Comment added."));
        }
      } catch (e) {
        handleError(e);
      }
    });

  // search
  program
    .command("search <query>")
    .description("Search local tasks, or run/save a cross-entity search view")
    .option("--status <status>", "Filter by status")
    .option("--priority <p>", "Filter by priority")
    .option("--assigned <agent>", "Filter by assigned agent")
    .option("--agent-id <agent>", "Filter by creator/run/comment agent")
    .option("--task-list <id>", "Filter by task list")
    .option("--plan <id>", "Filter by plan")
    .option("--task <id>", "Filter runs/comments by task")
    .option("--tag <tag>", "Filter by task tag (repeatable or comma-separated)", collectOption, [])
    .option("--field-label <label>", "Filter by local field label (repeatable or comma-separated)", collectOption, [])
    .option("--field-owner <owner>", "Filter by local field owner")
    .option("--field-area <area>", "Filter by local field area")
    .option("--field-severity <severity>", "Filter by local field severity")
    .option("--field-custom <json>", "Filter by local custom fields as JSON")
    .option("--since <date>", "Only tasks updated after this date (ISO)")
    .option("--created-after <date>", "Only records created after this date (ISO)")
    .option("--blocked", "Only blocked tasks (incomplete dependencies)")
    .option("--has-deps", "Only tasks with dependencies")
    .option("--depends-on <id>", "Only tasks that depend on a task")
    .option("--blocks <id>", "Only tasks that block a task")
    .option("--scope <scope>", "Search scope: tasks, projects, plans, runs, comments, all", "tasks")
    .option("--limit <n>", "Maximum results", "100")
    .option("--filter <json>", "Merge an advanced saved-search filter JSON object")
    .option("--save-as <name>", "Save this search as a named view")
    .option("--description <text>", "Saved view description")
    .option("--all-projects", "Do not auto-scope the search to the current project")
    .action(async (query: string, opts) => {
      const globalOpts = program.opts();
      try {
        // http authority routing: the local FTS5 index (searchTasks) only sees
        // the local SQLite file, which is empty when the http transport is selected.
        // Route task search through the shared `/v1/tasks?q=` API so it runs the
        // Postgres tsvector/trigram path instead of returning nothing.
        const cloud = getTodosCloudClient();
        const projectId = opts.allProjects
          ? undefined
          : cloud
            ? undefined
            : autoProject(globalOpts);
        const scope = (parseEnumFlag(opts.scope, SEARCH_SCOPE_FLAG) ?? "tasks") as SavedSearchScope;
        const searchOpts = buildSearchFilters(query, opts, projectId);
        if (opts.saveAs) {
          const view = saveSearchView({
            name: opts.saveAs,
            description: opts.description,
            scope,
            filters: searchOpts,
          });
          output(view, Boolean(globalOpts.json));
          if (!globalOpts.json) console.log(chalk.green(`Saved view ${view.name}.`));
          return;
        }
        if (cloud) {
          if (scope !== "tasks") {
            console.error(chalk.red(`Cross-entity search scope "${scope}" is not supported against a hosted /v1 authority; only --scope tasks is available.`));
            process.exit(1);
          }
          const tasks = await cloudListTasks(cloud, {
            query,
            ...(searchOpts.project_id ? { project_id: searchOpts.project_id } : {}),
            ...(searchOpts.status ? { status: searchOpts.status as never } : {}),
            ...(searchOpts.priority ? { priority: searchOpts.priority as never } : {}),
            ...(searchOpts.assigned_to ? { assigned_to: searchOpts.assigned_to } : {}),
            ...(searchOpts.agent_id ? { agent_id: searchOpts.agent_id } : {}),
            ...(searchOpts.task_list_id ? { task_list_id: searchOpts.task_list_id } : {}),
            ...(searchOpts.plan_id ? { plan_id: searchOpts.plan_id } : {}),
            ...(searchOpts.tags?.length ? { tags: searchOpts.tags } : {}),
            ...(typeof searchOpts.limit === "number" ? { limit: searchOpts.limit } : {}),
          });
          const outputTasks = redactBroadTasks(tasks);
          if (globalOpts.json) {
            output(outputTasks, true);
            return;
          }
          if (outputTasks.length === 0) {
            console.log(chalk.dim(`No tasks matching "${query}".`));
            return;
          }
          console.log(chalk.bold(`${outputTasks.length} result(s) for "${query}":\n`));
          for (const t of outputTasks) {
            console.log(formatTaskLine(t));
          }
          return;
        }
        if (scope !== "tasks") {
          const result = runSavedSearch(searchOpts, scope);
          if (globalOpts.json) {
            output(redactBroadOutput(result), true);
            return;
          }
          if (result.count === 0) {
            console.log(chalk.dim(`No ${scope} results matching "${query}".`));
            return;
          }
          console.log(chalk.bold(`${result.count} ${scope} result(s) for "${query}":\n`));
          for (const item of result.results) {
            const entity = redactBroadOutput(item.entity as any);
            console.log(`${chalk.cyan(item.entity_type)} ${entity.id?.slice?.(0, 8) || ""} ${entity.name || entity.title || entity.content || entity.summary || ""}`);
          }
          return;
        }
        const tasks = runSavedSearch(searchOpts, "tasks").results.map((item) => item.entity as ReturnType<typeof searchTasks>[number]);
        const outputTasks = redactBroadTasks(tasks);

        if (globalOpts.json) {
          output(outputTasks, true);
          return;
        }

        if (outputTasks.length === 0) {
          console.log(chalk.dim(`No tasks matching "${query}".`));
          return;
        }

        console.log(chalk.bold(`${outputTasks.length} result(s) for "${query}":\n`));
        for (const t of outputTasks) {
          console.log(formatTaskLine(t));
        }
      } catch (e) {
        handleError(e);
      }
    });

  const views = program
    .command("views")
    .description("Manage local saved search views");

  views
    .command("save <name>")
    .description("Save a local search view")
    .option("--query <query>", "Search query")
    .option("--scope <scope>", "Search scope: tasks, projects, plans, runs, comments, all", "tasks")
    .option("--description <text>", "Description")
    .option("--status <status>", "Filter by status")
    .option("--priority <p>", "Filter by priority")
    .option("--assigned <agent>", "Filter by assigned agent")
    .option("--agent-id <agent>", "Filter by creator/run/comment agent")
    .option("--task-list <id>", "Filter by task list")
    .option("--plan <id>", "Filter by plan")
    .option("--task <id>", "Filter runs/comments by task")
    .option("--tag <tag>", "Filter by task tag (repeatable or comma-separated)", collectOption, [])
    .option("--field-label <label>", "Filter by local field label (repeatable or comma-separated)", collectOption, [])
    .option("--field-owner <owner>", "Filter by local field owner")
    .option("--field-area <area>", "Filter by local field area")
    .option("--field-severity <severity>", "Filter by local field severity")
    .option("--field-custom <json>", "Filter by local custom fields as JSON")
    .option("--since <date>", "Only records updated after this date (ISO)")
    .option("--created-after <date>", "Only records created after this date (ISO)")
    .option("--blocked", "Only blocked tasks")
    .option("--has-deps", "Only tasks with dependencies")
    .option("--depends-on <id>", "Only tasks that depend on a task")
    .option("--blocks <id>", "Only tasks that block a task")
    .option("--limit <n>", "Maximum results", "100")
    .option("--filter <json>", "Merge an advanced saved-search filter JSON object")
    .option("--all-projects", "Do not auto-scope the view to the current project")
    .action((name: string, opts) => {
      const globalOpts = program.opts();
      try {
        const projectId = opts.allProjects ? undefined : autoProject(globalOpts);
        const view = saveSearchView({
          name,
          description: opts.description,
          scope: (parseEnumFlag(opts.scope, SEARCH_SCOPE_FLAG) ?? "tasks") as SavedSearchScope,
          filters: buildSearchFilters(opts.query, opts, projectId),
        });
        output(view, Boolean(globalOpts.json));
        if (!globalOpts.json) console.log(chalk.green(`Saved view ${view.name}.`));
      } catch (e) {
        handleError(e);
      }
    });

  views
    .command("list")
    .description("List local saved search views")
    .option("--scope <scope>", "Filter by scope")
    .action((opts) => {
      const globalOpts = program.opts();
      try {
        const rows = listSearchViews(parseEnumFlag(opts.scope, SEARCH_SCOPE_FLAG) as SavedSearchScope | undefined);
        output(rows, Boolean(globalOpts.json));
        if (!globalOpts.json) {
          if (rows.length === 0) {
            console.log(chalk.dim("No saved search views."));
            return;
          }
          for (const row of rows) console.log(`${chalk.cyan(row.name)} ${chalk.dim(`[${row.scope}]`)} ${JSON.stringify(row.filters)}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  views
    .command("run <name>")
    .description("Run a local saved search view")
    .action((name: string) => {
      const globalOpts = program.opts();
      try {
        const result = runSearchView(name);
        if (globalOpts.json) {
          output(redactBroadOutput(result), true);
          return;
        }
        console.log(chalk.bold(`${result.count} result(s) for view "${result.view?.name || name}":\n`));
        for (const item of result.results) {
          if (item.entity_type === "tasks") {
            console.log(formatTaskLine(redactBroadOutput(item.entity as any)));
            continue;
          }
          const entity = redactBroadOutput(item.entity as any);
          console.log(`${chalk.cyan(item.entity_type)} ${entity.id?.slice?.(0, 8) || ""} ${entity.name || entity.title || entity.content || entity.summary || ""}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  views
    .command("delete <name>")
    .description("Delete a local saved search view")
    .action((name: string) => {
      const globalOpts = program.opts();
      try {
        const deleted = deleteSearchView(name);
        output({ deleted }, Boolean(globalOpts.json));
        if (!globalOpts.json) console.log(deleted ? chalk.green(`Deleted view ${name}.`) : chalk.dim(`View not found: ${name}`));
      } catch (e) {
        handleError(e);
      }
    });

  // deps
  program
    .command("deps [id]")
    .description("Read or manage task dependencies. With no id, --project reads the whole-project dependency graph")
    .option("--needs <dep-id>", "Add dependency (this task needs dep-id)")
    .option("--remove <dep-id>", "Remove dependency")
    .option("--graph", "Show the dependency graph instead of direct edges")
    .option("--direction <direction>", "Graph direction: up, down, or both", "both")
    .option("--project <ref>", "With no id: read the whole-project graph (project id, slug, name, or path)")
    .action(async (id: string | undefined, opts) => {
      const globalOpts = program.opts();
      const cloud = getTodosCloudClient();

      // Whole-project dependency graph in one read — `todos deps --project <ref>
      // --json` (or, inside a registered repo, `todos deps` against the
      // auto-detected project). Emits a versioned adjacency list + cycles so a
      // scheduler can order a batch without one `deps <id>` call per task.
      if (!id) {
        // A mutating or direction-scoped flag with no id is a forgotten
        // argument, not a whole-project request. `--graph` is deliberately
        // allowed here because the whole-project read already returns a graph.
        // Fail loudly (commander used to reject this as a missing required
        // argument) rather than silently ignoring a write or scoped traversal.
        if (opts.needs || opts.remove || opts.direction !== "both") {
          handleError(new Error("A task id is required with --needs, --remove, or --direction."));
        }
        const projectRef = opts.project ?? globalOpts.project;
        if (cloud) {
          // Fail closed: a bulk read must be scoped to a project. There is no
          // cwd-based project to auto-detect against a shared authority, and
          // crawling every task in the dataset is never the intent.
          if (!projectRef) {
            handleError(new Error("deps needs a task id, or --project <ref> to read a whole-project graph."));
          }
          const projectId = await cloudResolveProjectRef(cloud, projectRef);
          const graph = await buildCloudProjectDependencyGraph(cloud, projectId);
          if (globalOpts.json) { output(graph, true); return; }
          printProjectDependencyGraph(graph);
          return;
        }
        const resolvedProjectId = projectRef ? resolveExplicitProject(projectRef).id : autoProject(globalOpts);
        if (!resolvedProjectId) {
          handleError(new Error("deps needs a task id, or --project <ref> to read a whole-project graph."));
        }
        const graph = getProjectDependencyGraph({ project_id: resolvedProjectId });
        if (globalOpts.json) { output(graph, true); return; }
        printProjectDependencyGraph(graph);
        return;
      }

      // http authority routing: dependency edges live on the SHARED dataset.
      // The previous path read LOCAL sqlite and 404'd cloud tasks. The recursive
      // `--graph` view is a local-only concept; in cloud mode we show the flat
      // dependency/blocked-by edges instead.
      if (cloud) {
        const cloudId = await resolveTaskIdForCommand(id, cloud);
        if (opts.needs) {
          try {
            const dep = await cloudAddDependency(cloud, cloudId, await resolveTaskIdForCommand(opts.needs, cloud));
            if (globalOpts.json) output(dep, true);
            else console.log(chalk.green("Dependency added."));
          } catch (e) { handleError(e); }
          return;
        }
        if (opts.remove) {
          const removed = await cloudRemoveDependency(cloud, cloudId, await resolveTaskIdForCommand(opts.remove, cloud));
          if (globalOpts.json) output({ removed }, true);
          else console.log(removed ? chalk.green("Dependency removed.") : chalk.red("Dependency not found."));
          return;
        }
        if (globalOpts.json) {
          // Hydrate the remote edges into nodes with status so the JSON read
          // carries ids + status (the bare edge payload has neither) and
          // matches the local shape exactly. Edges whose target row is
          // unreadable are DROPPED — mirroring the local SQL JOIN, which omits
          // dangling edges — rather than emitting the `unresolved` placeholder
          // (a synthetic "pending" node a scheduler would mistake for a real
          // task). The edge read fires first (staying on
          // `/v1/tasks/:id/dependencies`); `short_id` is null rather than
          // spending an extra round trip on the root task row.
          const relations = await cloudGetTaskRelations(cloud, cloudId);
          output(
            buildTaskDependencyEdges(
              { id: cloudId, short_id: null },
              relations.dependencies.filter(isResolvedTask),
              relations.blocks.filter(isResolvedTask),
            ),
            true,
          );
          return;
        }
        const edges = await cloudGetDependencies(cloud, cloudId);
        if (edges.dependencies.length > 0) {
          console.log(chalk.bold("Depends on:"));
          for (const dep of edges.dependencies) console.log(`  ${chalk.cyan(dep.depends_on)}`);
        }
        if (edges.blocks.length > 0) {
          console.log(chalk.bold("Blocks:"));
          for (const b of edges.blocks) console.log(`  ${chalk.cyan(b.task_id)}`);
        }
        if (edges.dependencies.length === 0 && edges.blocks.length === 0) {
          console.log(chalk.dim("No dependencies."));
        }
        return;
      }

      const { addDependency, removeDependency, getTaskGraph, getTaskWithRelations } = await import("../../db/tasks.js");
      const resolvedId = resolveTaskId(id);

      if (opts.needs) {
        const depId = resolveTaskId(opts.needs);
        try {
          addDependency(resolvedId, depId);
        } catch (e) {
          handleError(new Error(e instanceof Error ? e.message : String(e)));
        }
        if (globalOpts.json) {
          output({ task_id: resolvedId, depends_on: depId }, true);
        } else {
          console.log(chalk.green("Dependency added."));
        }
      } else if (opts.remove) {
        const depId = resolveTaskId(opts.remove);
        const removed = removeDependency(resolvedId, depId);
        if (globalOpts.json) {
          output({ removed }, true);
        } else {
          console.log(removed ? chalk.green("Dependency removed.") : chalk.red("Dependency not found."));
        }
      } else if (opts.graph) {
        const direction = opts.direction === "up" || opts.direction === "down" || opts.direction === "both"
          ? opts.direction
          : "both";
        const graph = getTaskGraph(resolvedId, direction);
        if (globalOpts.json) {
          output(graph, true);
          return;
        }

        const printNode = (node: typeof graph, depth: number, edge: "root" | "depends on" | "blocks") => {
          const indent = "  ".repeat(depth);
          const marker = edge === "root" ? "" : `${edge}: `;
          const blocked = node.task.is_blocked ? chalk.red(" blocked") : "";
          console.log(`${indent}${marker}${chalk.cyan(node.task.short_id || node.task.id.slice(0, 8))} ${node.task.title}${chalk.dim(` [${node.task.status}]`)}${blocked}`);
          for (const dep of node.depends_on) printNode(dep, depth + 1, "depends on");
          for (const dependent of node.blocks) printNode(dependent, depth + 1, "blocks");
        };

        printNode(graph, 0, "root");
      } else if (globalOpts.json) {
        // Machine-readable edge read via the single canonical reader, so the
        // JSON path and the exported library helper cannot drift apart.
        const edges = getTaskDependencyEdges(resolvedId);
        if (!edges) handleError(new Error("Task not found."));
        output(edges, true);
        return;
      } else {
        // Show dependencies (human)
        const task = getTaskWithRelations(resolvedId);
        if (!task) {
          handleError(new Error("Task not found."));
        }

        if (task.dependencies.length > 0) {
          console.log(chalk.bold("Depends on:"));
          for (const dep of task.dependencies) {
            console.log(`  ${formatTaskLine(dep)}`);
          }
        }
        if (task.blocks.length > 0) {
          console.log(chalk.bold("Blocks:"));
          for (const b of task.blocks) {
            console.log(`  ${formatTaskLine(b)}`);
          }
        }
        if (task.dependencies.length === 0 && task.blocks.length === 0) {
          console.log(chalk.dim("No dependencies."));
        }
      }
    });

  // projects
  program
    .command("projects")
    .description("List and manage projects")
    .option("--add <path>", "Register a project by path")
    .option("--show <project>", "Resolve and show a project")
    .option("--update <project>", "Update a project's name, path, or description")
    .option("--deregister <project>", "Deregister a project without deleting its tasks; refuses projects with incomplete tasks")
    .option("--path-prefix <prefix>", "Require deregistered project path to start with this prefix")
    .option("--dry-run", "Show what would change without modifying local state")
    .option("--name <name>", "Project name (with --add)")
    .option("--path <path>", "Project path (with --update)")
    .option("--description <text>", "Project description (with --add or --update)")
    .option("--task-list-id <id>", "Custom task list ID (with --add)")
    .option("--parent <project>", "Parent project (id, path, task-list slug, or name) to create a sub-project under (with --add)")
    .option("--ensure-task-list <project>", "Plan or apply creation of an existing project's declared task list")
    .option("--rollback-task-list <project>", "Conditionally roll back a task list created by --ensure-task-list")
    .option("--apply", "Apply --ensure-task-list or --rollback-task-list; ensure plans by default")
    .option("--idempotency-key <key>", "Stable idempotency key for --ensure-task-list --apply")
    .option("--receipt <id>", "Accepted ensure receipt for --rollback-task-list --apply")
    .action(async (opts) => {
      const globalOpts = program.opts();
      // The `projects` verb has no project filter: a project cannot scope the
      // project list. The global --project option used to be silently ignored
      // (rc=0, unfiltered output) — fail closed (I38-00523).
      if (globalOpts.project !== undefined) {
        handleError(new Error("`todos projects` does not support a --project filter: a project cannot scope the project list. Use `todos projects --show <ref>` or `todos list --project <ref>`."));
      }
      const cloud = getTodosCloudClient();

      if (opts.ensureTaskList && opts.rollbackTaskList) {
        handleError(new Error("Choose either --ensure-task-list or --rollback-task-list, not both"));
      }
      if (opts.apply && !opts.ensureTaskList && !opts.rollbackTaskList) {
        handleError(new Error("projects --apply requires --ensure-task-list or --rollback-task-list"));
      }
      if (opts.dryRun && opts.apply && (opts.ensureTaskList || opts.rollbackTaskList)) {
        handleError(new Error("Choose either --dry-run or --apply, not both"));
      }

      if (opts.ensureTaskList) {
        const project = cloud
          ? await cloudResolveProject(cloud, opts.ensureTaskList)
          : resolveExplicitProject(opts.ensureTaskList);
        const store = cloud ? null : createLocalSqliteTodosStorageAdapter({ db: getDatabase() });
        const plan = cloud
          ? await cloudPlanProjectTaskListEnsure(cloud, project.id)
          : await planProjectTaskListEnsure(store!, project.id);
        const result = opts.apply
          ? cloud
            ? await cloudApplyProjectTaskListEnsure(cloud, project.id, {
              expected_project_revision: plan.project.updated_at,
              ...(opts.idempotencyKey ? { idempotency_key: opts.idempotencyKey } : {}),
            })
            : await applyProjectTaskListEnsure(store!, project.id, {
              expected_project_revision: plan.project.updated_at,
              ...(opts.idempotencyKey ? { idempotency_key: opts.idempotencyKey } : {}),
            })
          : plan;
        if (globalOpts.json) {
          output(result, true);
        } else {
          const list = result.task_list
            ? `${result.task_list.slug} (${result.task_list.id})`
            : result.project.task_list_id;
          console.log(chalk.green(`${result.mode === "plan" ? "Task-list plan" : "Task-list ensure"}: ${result.action}`));
          console.log(chalk.dim(`  Project: ${result.project.name} (${result.project.id})`));
          console.log(chalk.dim(`  Task list: ${list}`));
          if (result.receipt) console.log(chalk.dim(`  Receipt: ${result.receipt.receipt_id}`));
        }
        return;
      }

      if (opts.rollbackTaskList) {
        if (!opts.apply) {
          handleError(new Error("projects --rollback-task-list requires --apply"));
        }
        if (!opts.receipt) {
          handleError(new Error("projects --rollback-task-list requires --receipt"));
        }
        const project = cloud
          ? await cloudResolveProject(cloud, opts.rollbackTaskList)
          : resolveExplicitProject(opts.rollbackTaskList);
        const store = cloud ? null : createLocalSqliteTodosStorageAdapter({ db: getDatabase() });
        const plan = cloud
          ? await cloudPlanProjectTaskListEnsure(cloud, project.id)
          : await planProjectTaskListEnsure(store!, project.id);
        if (!plan.task_list) {
          handleError(new Error("The project has no exact declared task list to roll back"));
        }
        const input = {
          receipt_id: opts.receipt,
          expected_task_list_revision: plan.task_list!.updated_at,
        };
        const result = cloud
          ? await cloudRollbackProjectTaskListEnsure(cloud, project.id, input)
          : await rollbackProjectTaskListEnsure(store!, project.id, input);
        if (globalOpts.json) {
          output(result, true);
        } else {
          console.log(chalk.green(`Task-list rollback: ${result.action}`));
          console.log(chalk.dim(`  Project: ${result.project_id}`));
          console.log(chalk.dim(`  Removed task list: ${result.task_list_id}`));
          console.log(chalk.dim(`  Rollback receipt: ${result.rollback_receipt_id}`));
        }
        return;
      }

      if (opts.show) {
        const project = cloud ? await cloudResolveProject(cloud, opts.show) : resolveExplicitProject(opts.show);
        // outputRecord, not output: `output` prints only under --json, so this
        // read used to exit 0 with completely empty stdout in human mode.
        outputRecord(project, Boolean(globalOpts.json), "Project:");
        return;
      }

      if (opts.update) {
        const patch = {
          ...(opts.name !== undefined ? { name: opts.name } : {}),
          ...(opts.path !== undefined ? { path: resolve(opts.path) } : {}),
          ...(opts.description !== undefined ? { description: opts.description } : {}),
        };
        if (Object.keys(patch).length === 0) {
          handleError(new Error("projects --update requires --name, --path, or --description"));
        }
        const current = cloud ? await cloudResolveProject(cloud, opts.update) : resolveExplicitProject(opts.update);
        if (patch.path !== undefined) {
          // Path-casing drift mints duplicate project rows (todos 1dcb9e66):
          // refuse to move a project onto another row's path under a different
          // letter case, so --update cannot CREATE the collision --add now refuses.
          const allProjects = cloud ? await cloudListProjects(cloud) : listProjects();
          const variants = findCaseVariantProjectPaths(
            allProjects.filter((project) => project.id !== current.id),
            patch.path,
          );
          if (variants.length > 0) {
            handleError(new Error(
              `Refusing to update ${current.name} path to ${patch.path}: it is a letter-case variant of an existing project (${describePathCollisions(variants)}). Path-casing drift is how duplicate project rows are minted; use the existing project's exact path instead.`,
            ));
          }
        }
        const project = cloud
          ? await cloudUpdateProject(cloud, current.id, patch)
          : updateProject(current.id, patch);
        // A successful mutation must say so: this printed nothing at all in human
        // mode, so the operator had no signal the write had landed.
        outputRecord(project, Boolean(globalOpts.json), "Project updated:");
        return;
      }

      if (opts.deregister) {
        const project = cloud ? await cloudResolveProject(cloud, opts.deregister) : resolveExplicitProject(opts.deregister);
        const counts = cloud
          ? countTasksForDeregistration(await cloudListTasks(cloud, { project_id: project.id, include_subtasks: true }))
          : countProjectTasks(project.id);

        if (opts.pathPrefix && !pathIsWithinPrefix(project.path, opts.pathPrefix)) {
          handleError(new Error(`Refusing to deregister ${project.name}: path ${project.path} is not within ${opts.pathPrefix}`));
        }

        if (counts.incomplete > 0) {
          handleError(new Error(`Refusing to deregister ${project.name}: ${counts.incomplete} incomplete task(s) remain`));
        }

        const result = {
          action: opts.dryRun ? "would_deregister" : "deregistered",
          project_id: project.id,
          name: project.name,
          path: project.path,
          total_tasks: counts.total,
          incomplete_tasks: counts.incomplete,
          tasks_preserved: true,
        };

        if (!opts.dryRun) {
          if (cloud) await cloudDeleteProject(cloud, project.id);
          else deleteProject(project.id);
        }

        if (globalOpts.json) {
          output(result, true);
        } else {
          console.log(chalk.green(`${opts.dryRun ? "Would deregister" : "Project deregistered"}: ${project.name} (${project.path})`));
          console.log(chalk.dim(`  Tasks preserved: ${counts.total}`));
        }
        return;
      }

      if (opts.add) {
        const projectPath = resolve(opts.add);
        const name = opts.name || basename(projectPath);
        let parentId: string | undefined;
        if (opts.parent !== undefined) {
          const parent = cloud ? await cloudResolveProject(cloud, opts.parent) : resolveExplicitProject(opts.parent);
          parentId = parent.id;
        }
        const allProjects = cloud ? await cloudListProjects(cloud) : listProjects();
        const existing = cloud
          ? allProjects.find((project) => project.path === projectPath)
          : getProjectByPath(projectPath);
        let project;
        if (existing) {
          project = existing;
          if (opts.parent !== undefined && existing.parent_id !== parentId) {
            if (cloud) project = await cloudUpdateProject(cloud, existing.id, { parent_id: parentId });
            else project = updateProject(existing.id, { parent_id: parentId });
          }
          if (opts.taskListId) {
            if (cloud && existing.task_list_id !== opts.taskListId) {
              handleError(new Error("Remote project task-list slug changes require project-rename"));
            }
            if (!cloud) project = renameProject(existing.id, { new_slug: opts.taskListId }).project;
          }
        } else {
          // Path-casing drift minted the duplicate platform-nopen rows (todos
          // 1dcb9e66): /home/hasna/workspace vs /home/hasna/Workspace vs
          // /Users/hasna/Workspace all registered as distinct projects because
          // the lookup above matched exact strings only. Refuse to mint a row
          // whose path is an existing row's path under a different letter case,
          // and name the collision so registration converges on one project.
          const variants = findCaseVariantProjectPaths(allProjects, projectPath);
          if (variants.length > 0) {
            handleError(new Error(
              `Refusing to register ${projectPath}: this path is a letter-case variant of an existing project (${describePathCollisions(variants)}). Path-casing drift is how duplicate project rows are minted; use \`todos projects --update <id> --path <path>\` to correct the existing row's path instead.`,
            ));
          }
          const input = { name, path: projectPath, description: opts.description, task_list_id: opts.taskListId, parent_id: parentId };
          project = cloud ? await cloudCreateProject(cloud, input) : createProject(input);
        }
        // Auto-register machine-local path
        if (!cloud) {
          try {
            const { setMachineLocalPath } = await import("../../db/projects.js");
            setMachineLocalPath(project.id, projectPath);
          } catch {
            console.log(chalk.dim("  (machine path auto-register skipped)"));
          }
        }

        if (globalOpts.json) {
          output(project, true);
        } else {
          console.log(chalk.green(`Project registered: ${project.name} (${project.path})`));
          if (project.task_list_id) console.log(chalk.dim(`  Task list: ${project.task_list_id}`));
          if (parentId) console.log(chalk.dim(`  Parent: ${parentId}`));
        }
        return;
      }

      const projects = cloud ? await cloudListProjects(cloud) : listProjects();
      if (globalOpts.json) {
        output(projects, true);
        return;
      }

      if (projects.length === 0) {
        console.log(chalk.dim("No projects registered."));
        return;
      }

      console.log(chalk.bold(`${projects.length} project(s):\n`));
      for (const p of projects) {
        const taskList = p.task_list_id ? chalk.cyan(` [${p.task_list_id}]`) : "";
        console.log(`${chalk.dim(p.id.slice(0, 8))} ${chalk.bold(p.name)} ${chalk.dim(p.path)}${taskList}${p.description ? ` - ${p.description}` : ""}`);
      }
    });

  program
    .command("project-panel")
    .description("Emit a contract-valid project dashboard panel for todos")
    .option("--project <project>", "Project path, id, task-list slug, or name. Defaults to the detected project")
    .option("--limit <n>", "Maximum panel items/resources", "20")
    .option("--contract", "Emit hasna.project_panel.v1 contract JSON")
    .option("-j, --json", "Output JSON")
    .action(async (opts: { project?: string; limit?: string; contract?: boolean; json?: boolean }) => {
      try {
        const globalOpts = program.opts();
        const project = opts.project ? resolveExplicitProject(opts.project) : autoDetectProject(globalOpts);
        if (!project) {
          handleError(new Error("Project not found: provide --project or run inside a registered project"));
        }

        const { createTodosProjectPanel } = await import("../../lib/project-panel.js");
        const limit = opts.limit ? Number(opts.limit) : 20;
        const panel = createTodosProjectPanel(project.id, { limit });
        if (opts.json || opts.contract || globalOpts.json) {
          output(panel, true);
          return;
        }

        console.log(chalk.bold(`${panel.title}: ${project.name}`));
        console.log(panel.summary ?? chalk.dim("No summary."));
        for (const metric of panel.metrics) {
          console.log(`${chalk.dim(metric.id)} ${metric.value}${metric.unit ?? ""}`);
        }
      } catch (error) {
        handleError(error);
      }
    });

  // project rename
  program
    .command("project-rename <id-or-slug> <new-slug>")
    .description("Rename a project slug. Cascades to matching task lists. Task prefixes (e.g. APP-00001) are unchanged.")
    .option("--name <name>", "Also update the project display name")
    .option("-j, --json", "Output as JSON")
    .action(async (idOrSlug: string, newSlug: string, opts) => {
      const globalOpts = program.opts();
      const useJson = opts.json || globalOpts.json;
      try {
        const cloud = getTodosCloudClient();
        let result;
        if (cloud) {
          result = await cloudRenameProject(cloud, idOrSlug, newSlug, opts.name);
        } else {
          const db = getDatabase();
          // Try resolve by ID first, then by task_list_id slug
          let resolvedId = resolvePartialId(db, "projects", idOrSlug);
          if (!resolvedId) {
            const bySlug = db.query("SELECT id FROM projects WHERE task_list_id = ?").get(idOrSlug) as { id: string } | null;
            resolvedId = bySlug?.id ?? null;
          }
          if (!resolvedId) {
            handleError(new Error(`Project not found: ${idOrSlug}`));
          }
          result = renameProject(resolvedId, { name: opts.name, new_slug: newSlug });
        }
        if (useJson) {
          output({ project: result.project, task_lists_updated: result.task_lists_updated }, true);
        } else {
          console.log(chalk.green(`Project renamed: ${result.project.name} (slug: ${result.project.task_list_id})`));
          if (result.task_lists_updated > 0) {
            console.log(chalk.dim(`  Updated ${result.task_lists_updated} task list slug(s).`));
          }
        }
      } catch (e) {
        handleError(new Error(e instanceof Error ? e.message : String(e)));
      }
    });

  // projects path — machine-local path overrides
  const projectsPathCmd = program
    .command("projects-path")
    .description("Manage machine-local path overrides for projects");

  projectsPathCmd
    .command("set <project-id> <path>")
    .description("Set the local path for a project on this machine")
    .option("-j, --json", "Output as JSON")
    .action(async (projectId: string, projectPath: string, opts) => {
      const globalOpts = program.opts();
      const useJson = opts.json || globalOpts.json;
      try {
        const { setMachineLocalPath } = await import("../../db/projects.js");
        const db = getDatabase();
        const resolved = resolvePartialId(db, "projects", projectId);
        if (!resolved) { handleError(new Error(`Project not found: ${projectId}`)); }
        const entry = setMachineLocalPath(resolved, resolve(projectPath));
        if (useJson) { output(entry, true); }
        else { console.log(chalk.green(`Local path set: ${entry.path} (machine: ${entry.machine_id.slice(0, 8)})`)); }
      } catch (e) {
        handleError(new Error(e instanceof Error ? e.message : String(e)));
      }
    });

  projectsPathCmd
    .command("list <project-id>")
    .description("List all machine path overrides for a project")
    .option("-j, --json", "Output as JSON")
    .action(async (projectId: string, opts) => {
      const globalOpts = program.opts();
      const useJson = opts.json || globalOpts.json;
      try {
        const { listMachineLocalPaths } = await import("../../db/projects.js");
        const db = getDatabase();
        const resolved = resolvePartialId(db, "projects", projectId);
        if (!resolved) { handleError(new Error(`Project not found: ${projectId}`)); }
        const paths = listMachineLocalPaths(resolved);
        if (useJson) { output(paths, true); return; }
        if (paths.length === 0) { console.log(chalk.dim("No machine path overrides.")); return; }
        for (const p of paths) {
          console.log(`${chalk.dim(p.machine_id.slice(0, 8))} ${p.path}  ${chalk.dim(p.updated_at)}`);
        }
      } catch (e) {
        handleError(new Error(e instanceof Error ? e.message : String(e)));
      }
    });

  projectsPathCmd
    .command("remove <project-id>")
    .description("Remove the local path override for a project on this machine")
    .option("--machine <id>", "Machine ID to remove override for (default: this machine)")
    .action(async (projectId: string, opts) => {
      try {
        const { removeMachineLocalPath } = await import("../../db/projects.js");
        const db = getDatabase();
        const resolved = resolvePartialId(db, "projects", projectId);
        if (!resolved) { handleError(new Error(`Project not found: ${projectId}`)); }
        const removed = removeMachineLocalPath(resolved, opts.machine);
        if (removed) { console.log(chalk.green("Machine path override removed.")); }
        else { console.log(chalk.dim("No override found to remove.")); }
      } catch (e) {
        handleError(new Error(e instanceof Error ? e.message : String(e)));
      }
    });

  // extract
  program
    .command("extract <path>")
    .description("Extract TODO/FIXME/HACK/BUG/XXX/NOTE comments from source files and create tasks")
    .option("--dry-run", "Show extracted comments without creating tasks")
    .option("--pattern <tags>", "Comma-separated tags to look for (default: TODO,FIXME,HACK,XXX,BUG,NOTE)")
    .option("-t, --tags <tags>", "Extra comma-separated tags to add to created tasks")
    .option("--assign <agent>", "Assign extracted tasks to an agent")
    .option("--list <id>", "Task list ID")
    .option("--ext <extensions>", "Comma-separated file extensions to scan (e.g. ts,py,go)")
    .option("--exclude <patterns>", "Comma-separated gitignore-style path patterns to skip")
    .option("--no-gitignore", "Do not read .gitignore from the scanned root")
    .option("--index", "Include a local source index in JSON output")
    .action(async (scanPath: string, opts) => {
      try {
        const globalOpts = program.opts();
        const projectId = autoProject(globalOpts);
        const { extractTodos, EXTRACT_TAGS } = await import("../../lib/extract.js");
        const patterns = opts.pattern
          ? opts.pattern.split(",").map((t: string) => t.trim().toUpperCase()) as typeof EXTRACT_TAGS[number][]
          : undefined;
        const taskListId = opts.list ? resolveTaskListId(opts.list) : undefined;
        const result = extractTodos({
          path: resolve(scanPath),
          patterns,
          project_id: projectId,
          task_list_id: taskListId,
          tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
          assigned_to: opts.assign,
          agent_id: globalOpts.agent,
          dry_run: opts.dryRun,
          extensions: opts.ext ? opts.ext.split(",").map((e: string) => e.trim()) : undefined,
          exclude: splitList(opts.exclude),
          respect_gitignore: opts.gitignore !== false,
          include_index: Boolean(opts.index),
        });

        if (globalOpts.json) {
          console.log(JSON.stringify(opts.dryRun ? {
            comments: result.comments,
            index: result.index,
          } : {
            tasks_created: result.tasks.length,
            skipped: result.skipped,
            comments: result.comments.length,
            index: result.index,
          }, null, 2));
        } else if (opts.dryRun) {
          console.log(chalk.cyan(`Found ${result.comments.length} comment(s):\n`));
          for (const c of result.comments) {
            const symbol = c.symbol ? chalk.gray(` in ${c.symbol_kind || "symbol"} ${c.symbol}`) : "";
            console.log(`  ${chalk.yellow(`[${c.tag}]`)} ${c.message}${symbol}`);
            console.log(`    ${chalk.gray(`${c.file}:${c.line}`)}`);
          }
          if (result.index) {
            console.log(chalk.gray(`\nIndexed ${result.index.files.length} file(s), ${result.index.total_symbols} symbol(s).`));
          }
        } else {
          console.log(chalk.green(`Created ${result.tasks.length} task(s)`));
          if (result.skipped > 0) {
            console.log(chalk.gray(`Skipped ${result.skipped} duplicate(s)`));
          }
          console.log(chalk.gray(`Total comments found: ${result.comments.length}`));
          if (result.index) {
            console.log(chalk.gray(`Indexed ${result.index.files.length} file(s), ${result.index.total_symbols} symbol(s).`));
          }
          for (const t of result.tasks) {
            console.log(formatTaskLine(t));
          }
        }
      } catch (e) {
        handleError(e);
      }
    });

  program
    .command("extract-watch <path>")
    .description("Poll a local source tree for TODO/FIXME/HACK/BUG/XXX/NOTE comments and create tasks")
    .option("--dry-run", "Show extracted comments without creating tasks")
    .option("--once", "Run a single watcher scan and exit", true)
    .option("--max-runs <n>", "Maximum watcher scans before exiting")
    .option("--interval <ms>", "Polling interval in milliseconds", "2000")
    .option("--pattern <tags>", "Comma-separated tags to look for")
    .option("-t, --tags <tags>", "Extra comma-separated tags to add to created tasks")
    .option("--assign <agent>", "Assign extracted tasks to an agent")
    .option("--list <id>", "Task list ID")
    .option("--ext <extensions>", "Comma-separated file extensions to scan")
    .option("--exclude <patterns>", "Comma-separated gitignore-style path patterns to skip")
    .option("--no-gitignore", "Do not read .gitignore from the watched root")
    .action(async (scanPath: string, opts) => {
      try {
        const globalOpts = program.opts();
        const projectId = autoProject(globalOpts);
        const { watchSourceTodos, EXTRACT_TAGS } = await import("../../lib/extract.js");
        const patterns = opts.pattern
          ? opts.pattern.split(",").map((t: string) => t.trim().toUpperCase()) as typeof EXTRACT_TAGS[number][]
          : undefined;
        const taskListId = opts.list ? resolveTaskListId(opts.list) : undefined;
        const maxRuns = opts.maxRuns ? parseInt(opts.maxRuns, 10) : 1;
        const result = await watchSourceTodos({
          path: resolve(scanPath),
          patterns,
          project_id: projectId,
          task_list_id: taskListId,
          tags: splitList(opts.tags),
          assigned_to: opts.assign,
          agent_id: globalOpts.agent,
          dry_run: opts.dryRun,
          extensions: splitList(opts.ext),
          exclude: splitList(opts.exclude),
          respect_gitignore: opts.gitignore !== false,
          include_index: true,
          once: opts.once !== false,
          max_runs: maxRuns,
          interval_ms: parseInt(opts.interval, 10),
        });

        if (globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        for (const run of result.runs) {
          console.log(chalk.cyan(`Watcher run ${run.run}: ${run.result.comments.length} comment(s), ${run.changed_files.length} changed file(s)`));
          if (!opts.dryRun) {
            console.log(chalk.green(`Created ${run.result.tasks.length} task(s), skipped ${run.result.skipped} duplicate(s)`));
          }
        }
      } catch (e) {
        handleError(e);
      }
    });

  // export
  program
    .command("export")
    .description("Export tasks")
    .option("-f, --format <format>", "Format: json, md, todos.md, or bridge", "json")
    .option("-o, --output <path>", "Write export output to a file")
    .option("--encrypt", "Encrypt bridge exports with a local encryption profile")
    .option("--encryption-profile <name>", "Encryption profile name", "default")
    .option("--allow-plaintext-sensitive", "Deprecated; bridge exports are redacted unless --encrypt is used")
    .action(async (opts) => {
      const { listTasks } = await import("../../db/tasks.js");
      const globalOpts = program.opts();
      // Validate before any branch: an unknown format used to reach the final
      // `else` and emit JSON regardless of what was asked for.
      opts.format = parseEnumFlag(opts.format, EXPORT_FORMAT_FLAG) ?? "json";
      const projectId = autoProject(globalOpts);
      const writeOutput = async (content: string) => {
        if (opts.output) {
          const { writeFileSync } = await import("node:fs");
          writeFileSync(resolve(opts.output), content.endsWith("\n") ? content : `${content}\n`);
        } else {
          console.log(content);
        }
      };

      if (opts.format === "bridge") {
        const { createLocalBridgeBundle } = await import("../../lib/local-bridge.js");
        const { createEncryptedBridgeBundle } = await import("../../lib/local-encryption.js");
        const { emitLocalEventHooksQuiet } = await import("../../lib/event-hooks.js");
        const bundle = createLocalBridgeBundle({
          project_id: projectId ?? undefined,
          redaction: opts.encrypt ? "unsafe_plaintext" : "redacted",
        });
        const exported = opts.encrypt
          ? createEncryptedBridgeBundle(bundle, { profile: opts.encryptionProfile })
          : bundle;
        const json = JSON.stringify(exported, null, 2);
        await writeOutput(json);
        emitLocalEventHooksQuiet({ type: "export.finished", payload: { format: "bridge", encrypted: Boolean(opts.encrypt), project_id: projectId, output: opts.output ? resolve(opts.output) : null, stats: bundle.stats } });
        if (!opts.encrypt && !opts.allowPlaintextSensitive) {
          console.error(chalk.dim("Bridge export redacted sensitive fields. Use --encrypt for an encrypted local bundle when a lossless legacy snapshot is required."));
        }
        if (opts.output && !globalOpts.json) {
          console.log(chalk.green(`${opts.encrypt ? "Encrypted bridge export" : "Bridge export"} written to ${resolve(opts.output)}`));
        }
        return;
      }

      const tasks = listTasks(projectId ? { project_id: projectId } : {});
      const exportedCount = tasks.length;
      if (["md", "markdown", "todos.md", "todos-md"].includes(opts.format)) {
        const { exportTodosMarkdown } = await import("../../lib/todos-md.js");
        await writeOutput(exportTodosMarkdown({ project_id: projectId ?? undefined }));
      } else {
        await writeOutput(JSON.stringify(tasks, null, 2));
      }
      const { emitLocalEventHooksQuiet } = await import("../../lib/event-hooks.js");
      emitLocalEventHooksQuiet({ type: "export.finished", payload: { format: opts.format, project_id: projectId, output: opts.output ? resolve(opts.output) : null, count: exportedCount } });
    });

  program
    .command("bridge-import <file>")
    .description("Dry-run or apply a local hasna/todos bridge export bundle")
    .option("--apply", "Apply the import. Defaults to dry-run.")
    .option("--decrypt", "Decrypt an encrypted bridge export before importing")
    .option("--resolve-conflicts", "Safely merge existing local tasks by filling blank fields, unioning tags, and recording unresolved divergences")
    .action(async (file: string, opts) => {
      const globalOpts = program.opts();
      try {
        const { readFileSync } = await import("node:fs");
        const { importLocalBridgeBundle } = await import("../../lib/local-bridge.js");
        const { decryptBridgeBundle, isEncryptedBridgeBundle } = await import("../../lib/local-encryption.js");
        const parsed = JSON.parse(readFileSync(resolve(file), "utf-8"));
        const bundle = isEncryptedBridgeBundle(parsed)
          ? (opts.decrypt ? decryptBridgeBundle(parsed) : (() => { throw new Error("Bridge bundle is encrypted. Re-run with --decrypt and the configured key environment variable set."); })())
          : parsed;
        const result = importLocalBridgeBundle(bundle, { dryRun: !opts.apply, conflictStrategy: opts.resolveConflicts ? "safe_merge" : "skip" });
        const { emitLocalEventHooksQuiet } = await import("../../lib/event-hooks.js");
        emitLocalEventHooksQuiet({ type: "import.finished", payload: { file: resolve(file), dry_run: result.dry_run, ok: result.ok, inserted: result.inserted, skipped: result.skipped, conflicts: result.conflicts.length, issues: result.issues.length } });
        if (globalOpts.json) {
          output(result, true);
          return;
        }
        const mode = result.dry_run ? "Dry-run" : "Import";
        console.log(chalk.bold(`${mode} ${result.ok ? "ready" : "has issues"}`));
        for (const [key, count] of Object.entries(result.inserted)) {
          if (count > 0) console.log(`  ${key}: ${count}`);
        }
        for (const [key, count] of Object.entries(result.merged)) {
          if (count > 0) console.log(`  ${key} merged: ${count}`);
        }
        if (result.conflicts.length > 0) {
          console.log(chalk.yellow(`  conflicts: ${result.conflicts.length}`));
        }
        for (const issue of result.issues) {
          console.error(chalk.red(`  ${issue}`));
        }
      } catch (e) {
        handleError(e);
      }
    });

  program
    .command("todos-md-import <file>")
    .alias("markdown-import")
    .alias("import-md")
    .description("Dry-run or apply a local todos.md Markdown import")
    .option("--apply", "Apply the import. Defaults to dry-run.")
    .option("--resolve-conflicts", "Safely merge embedded bridge task conflicts while preserving local divergent fields")
    .action(async (file: string, opts) => {
      const globalOpts = program.opts();
      try {
        const { readFileSync } = await import("node:fs");
        const { importTodosMarkdown } = await import("../../lib/todos-md.js");
        const result = importTodosMarkdown(readFileSync(resolve(file), "utf-8"), { dryRun: !opts.apply, conflictStrategy: opts.resolveConflicts ? "safe_merge" : "skip" });
        const { emitLocalEventHooksQuiet } = await import("../../lib/event-hooks.js");
        emitLocalEventHooksQuiet({ type: "import.finished", payload: { file: resolve(file), format: "todos.md", dry_run: result.dry_run, ok: result.ok, inserted: result.inserted, skipped: result.skipped, issues: result.issues.length } });
        if (globalOpts.json) {
          output(result, true);
          return;
        }
        const mode = result.dry_run ? "Dry-run" : "Import";
        console.log(chalk.bold(`${mode} ${result.ok ? "ready" : "has issues"}`));
        console.log(`  mode: ${result.mode}`);
        for (const [key, count] of Object.entries(result.inserted)) {
          if (count > 0) console.log(`  ${key}: ${count}`);
        }
        for (const [key, count] of Object.entries(result.merged)) {
          if (count > 0) console.log(`  ${key} merged: ${count}`);
        }
        for (const issue of result.issues) {
          console.error(chalk.red(`  ${issue}`));
        }
      } catch (e) {
        handleError(e);
      }
    });

  // sync
  program
    .command("sync")
    .description("Sync tasks with an agent task list (Claude uses native task list; others use JSON lists)")
    .option("--task-list <id>", "Task list ID (Claude auto-detects from CLAUDE_CODE_TASK_LIST_ID or CLAUDE_CODE_SESSION_ID)")
    .option("--agent <name>", "Agent/provider to sync (default: claude)")
    .option("--all", "Sync across all configured agents (TODOS_SYNC_AGENTS or default: claude,codex,gemini)")
    .option("--push", "One-way: push SQLite tasks to agent task list")
    .option("--pull", "One-way: pull agent task list into SQLite")
    .option("--prefer <side>", "Conflict strategy: local or remote", "remote")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const project = autoDetectProject(globalOpts);
      const projectId = project?.id;
      const direction = opts.push && !opts.pull ? "push" : opts.pull && !opts.push ? "pull" : "both";

      let result;
      const prefer = (opts.prefer as string | undefined) === "local" ? "local" : "remote";

      if (opts.all) {
        const agents = defaultSyncAgents();
        result = syncWithAgents(
          agents,
          (agent) => resolveTaskListForAgent(agent, opts.taskList, project?.task_list_id),
          projectId,
          direction,
          { prefer },
        );
      } else {
        const agent = (opts.agent as string | undefined) || "claude";
        const taskListId = resolveTaskListForAgent(agent, opts.taskList, project?.task_list_id);
        if (!taskListId) {
          handleError(new Error(`Could not detect task list ID for ${agent}. Use --task-list <id> or set appropriate env vars.`));
        }
        result = syncWithAgent(agent, taskListId, projectId, direction, { prefer });
      }

      if (globalOpts.json) {
        output(result, true);
        return;
      }

      if (result.pulled > 0) console.log(chalk.green(`Pulled ${result.pulled} task(s).`));
      if (result.pushed > 0) console.log(chalk.green(`Pushed ${result.pushed} task(s).`));
      if (result.pulled === 0 && result.pushed === 0 && result.errors.length === 0) {
        console.log(chalk.dim("Nothing to sync."));
      }
      for (const err of result.errors) {
        console.error(chalk.red(`  Error: ${err}`));
      }
    });
}

// Helper from original index.tsx
function resolveTaskListForAgent(agent: string, explicit?: string, projectTaskListId?: string | null): string | null {
  if (explicit) return explicit;
  const normalized = agent.trim().toLowerCase();
  if (normalized === "claude" || normalized === "claude-code" || normalized === "claude_code") {
    return env.claudeTaskList()
      || process.env["CLAUDE_CODE_TASK_LIST_ID"]
      || process.env["CLAUDE_CODE_SESSION_ID"]
      || getAgentTaskListId(normalized)
      || projectTaskListId
      || null;
  }
  const key = `TODOS_${normalized.toUpperCase()}_TASK_LIST`;
  return process.env[key]
    || env.taskListId()
    || getAgentTaskListId(normalized)
    || "default";
}

function resolveTaskListId(partialId: string): string {
  const db = getDatabase();
  const id = resolvePartialId(db, "task_lists", partialId);
  if (!id) {
    handleError(new Error(`Could not resolve task list ID: ${partialId}`));
  }
  return id;
}
