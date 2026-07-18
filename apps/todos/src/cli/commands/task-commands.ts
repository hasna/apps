import type { Command } from "commander";
import chalk from "chalk";
import { basename, resolve } from "node:path";
import { getDatabase, resolvePartialId } from "../../db/database.js";
import { ensureProject, getProject, getProjectByPath, slugify } from "../../db/projects.js";
import {
  createTask,
  getTask,
  getTaskWithRelations,
  listTasks,
  updateTask,
  upsertTaskByFingerprint,
  deleteTask,
  startTask,
  completeTask,
  lockTask,
  unlockTask,
} from "../../db/tasks.js";
import { getTaskList, getTaskListBySlug } from "../../db/task-lists.js";
import {
  getTodosCloudClient,
  cloudListTasks,
  cloudGetTask,
  cloudListComments,
  cloudCreateTask,
  cloudUpdateTask,
  cloudDeleteTask,
  cloudTaskAction,
  cloudCompleteTask,
  cloudLockTask,
  cloudUnlockTask,
  cloudTaskHistory,
  cloudUpsertTaskByFingerprint,
  cloudResolveProjectRef,
  cloudResolveTaskListRef,
  cloudResolvePlan,
} from "../cloud-router.js";
import type { TaskPriority, TaskStatus } from "../../types/index.js";
import {
  formatTaskLine,
  resolveTaskId,
  resolveTaskIdForCommand,
  normalizeStatus,
  autoProject,
  handleError,
  output,
  statusColors,
  priorityColors,
} from "../helpers.js";
import { redactBroadTasks } from "../output-redaction.js";
import { TASK_PRIORITIES, TASK_STATUSES } from "../../types/index.js";

/** Render untrusted text without allowing terminal control sequences to execute. */
export function escapeTerminalControls(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, (character) => {
    const code = character.charCodeAt(0);
    if (code === 0x0a) return "\\n";
    if (code === 0x0d) return "\\r";
    if (code === 0x09) return "\\t";
    return `\\x${code.toString(16).padStart(2, "0")}`;
  });
}

function formatHumanComment(comment: { agent_id?: string | null; created_at: string; content: string }): string {
  const agent = comment.agent_id
    ? chalk.cyan(`[${escapeTerminalControls(comment.agent_id)}] `)
    : "";
  return `    ${agent}${chalk.dim(escapeTerminalControls(comment.created_at))}: ${escapeTerminalControls(comment.content)}`;
}

/**
 * Resolve a project by path, exact/partial ID, exact name, task list ID, slug,
 * and only then a name substring. Exact matches must win over substring matches
 * (mirrors helpers.resolveExplicitProject) so a query like "web" never resolves
 * to an unrelated project such as "web-admin" when a project literally named
 * "web" exists. A path-like reference is auto-created when unregistered.
 */
function resolveProjectIdOrSlug(input: string): string {
  const db = getDatabase();
  // Registered path (create it when path-like but unregistered)
  if (isPathLike(input)) {
    const projectPath = resolve(input);
    const byPath = getProjectByPath(projectPath, db);
    return (byPath ?? ensureProject(basename(projectPath), projectPath, db)).id;
  }
  const byPath = getProjectByPath(resolve(input), db);
  if (byPath) return byPath.id;
  // Exact or partial ID
  const byId = getProject(input, db);
  if (byId) return byId.id;
  const partial = resolvePartialId(db, "projects", input);
  if (partial) return partial;
  // Exact name or task list ID
  const exact = db.query(
    "SELECT id FROM projects WHERE lower(name) = lower(?) OR task_list_id = ? ORDER BY name LIMIT 1",
  ).get(input, input) as { id: string } | undefined;
  if (exact) return exact.id;
  // Slug match
  const inputSlug = slugify(input);
  if (inputSlug) {
    const all = db.query("SELECT id, name FROM projects ORDER BY name").all() as { id: string; name: string }[];
    const bySlug = all.find((p) => slugify(p.name) === inputSlug);
    if (bySlug) return bySlug.id;
  }
  // Name substring last
  const row = db.query("SELECT id FROM projects WHERE name LIKE ? ORDER BY name LIMIT 1").get(`%${input}%`) as { id: string } | undefined;
  if (row) return row.id;
  console.error(chalk.red(`Project not found: ${input}`));
  process.exit(1);
}

/** Validate and normalize a status value, rejecting unknowns before the DB does. */
function parseStatus(value: string | undefined): TaskStatus | undefined {
  if (!value) return undefined;
  const normalized = normalizeStatus(value);
  if (!(TASK_STATUSES as readonly string[]).includes(normalized)) {
    console.error(chalk.red(`--status must be one of: ${TASK_STATUSES.join(", ")}`));
    process.exit(1);
  }
  return normalized as TaskStatus;
}

/** Parse an integer option, rejecting non-numeric input instead of storing NaN. */
function parseIntOption(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) {
    console.error(chalk.red(`${flag} must be a number`));
    process.exit(1);
  }
  return n;
}

function isPathLike(input: string): boolean {
  return input.startsWith(".") || input.includes("/") || input.includes("\\");
}

function resolvePlanId(input: string): string {
  const db = getDatabase();
  const id = resolvePartialId(db, "plans", input);
  if (!id) {
    console.error(chalk.red(`Could not resolve plan ID: ${input}`));
    process.exit(1);
  }
  return id;
}

function parsePriority(value: string | undefined): TaskPriority | undefined {
  if (!value) return undefined;
  if (!(TASK_PRIORITIES as readonly string[]).includes(value)) {
    console.error(chalk.red("--priority must be one of: low, medium, high, critical"));
    process.exit(1);
  }
  return value as TaskPriority;
}

function parseJsonObject(value: string | undefined, flag: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    console.error(chalk.red(`${flag} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error(chalk.red(`${flag} must be a JSON object`));
    process.exit(1);
  }
  return parsed as Record<string, unknown>;
}

function parseJsonValue(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function pointerOption(value: string | undefined, clear: boolean): string | null | undefined {
  if (value !== undefined) return value;
  return clear ? null : undefined;
}

function parseTags(value: string | undefined): string[] | undefined {
  return value ? value.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined;
}

function buildExpectationMetadata(opts: Record<string, unknown>): Record<string, unknown> {
  const metadata = parseJsonObject(opts["metadataJson"] as string | undefined, "--metadata-json") ?? {};
  const expectationId = opts["expectationId"];
  const expectationFingerprint = opts["expectationFingerprint"];
  const evidencePaths = opts["evidencePaths"];
  const originLoopId = opts["originLoopId"];
  const originRunId = opts["originRunId"];
  const expected = opts["expected"];
  const observed = opts["observed"];
  const acceptance = opts["acceptance"];
  if (expectationId !== undefined) metadata["expectation_id"] = expectationId;
  if (expectationFingerprint !== undefined) metadata["expectation_fingerprint"] = expectationFingerprint;
  if (evidencePaths !== undefined) metadata["evidence_paths"] = String(evidencePaths).split(",").map((path) => path.trim()).filter(Boolean);
  if (originLoopId !== undefined) metadata["origin_loop_id"] = originLoopId;
  if (originRunId !== undefined) metadata["origin_run_id"] = originRunId;
  if (expected !== undefined) metadata["expected"] = parseJsonValue(String(expected));
  if (observed !== undefined) metadata["observed"] = parseJsonValue(String(observed));
  if (acceptance !== undefined) metadata["acceptance"] = parseJsonValue(String(acceptance));
  return metadata;
}

/**
 * Resolve a `--list` reference to a canonical task-list UUID. UUID linkage is
 * authoritative: an exact UUID, then a unique partial UUID, then a project-scoped
 * slug. Returns the canonical `.id` so slug/partial input always persists as a
 * UUID. Returns `{ error }` for unresolvable or ambiguous input rather than
 * silently succeeding.
 */
function resolveTaskListRef(ref: string, projectId: string | null): { id: string } | { error: string } {
  const db = getDatabase();
  const exact = getTaskList(ref, db);
  if (exact) return { id: exact.id };
  const partial = resolvePartialId(db, "task_lists", ref);
  if (partial) return { id: partial };
  const bySlug = getTaskListBySlug(ref, projectId ?? undefined, db);
  if (bySlug) return { id: bySlug.id };
  return { error: `Could not resolve task list "${ref}" to a UUID${projectId ? " within the task's project" : ""}. Pass an exact task-list UUID.` };
}

export function registerTaskCommands(program: Command) {
  // add
  program
    .command("add <title>")
    .description("Create a new task")
    .option("-d, --description <text>", "Task description")
    .option("-p, --priority <level>", "Priority: low, medium, high, critical")
    .option("--parent <id>", "Parent task ID")
    .option("-t, --tags <tags>", "Comma-separated tags")
    .option("--tag <tags>", "Comma-separated tags (alias for --tags)")
    .option("--plan <id>", "Assign to a plan")
    .option("--assign <agent>", "Assign to agent")
    .option("--status <status>", "Initial status")
    .option("--list <id>", "Task list ID")
    .option("--task-list <id>", "Task list ID (alias for --list)")
    .option("--estimated <minutes>", "Estimated time in minutes")
    .option("--sla-minutes <minutes>", "SLA minutes before unfinished work is escalated")
    .option("--sla <minutes>", "Alias for --sla-minutes")
    .option("--approval", "Require approval before completion")
    .option("--recurrence <rule>", "Recurrence rule, e.g. 'every day', 'every weekday', 'every 2 weeks'")
    .option("--due <date>", "Due date (ISO string or YYYY-MM-DD)")
    .option("--reason <text>", "Why this task exists")
    .option("--project <id>", "Assign to project by ID or slug (overrides auto-detect)")
    .action(async (title: string, opts) => {
      const globalOpts = program.opts();
      opts.tags = opts.tags || opts.tag;
      opts.list = opts.list || opts.taskList;

      // self_hosted cloud routing: create straight against <app>.hasna.xyz/v1.
      const cloud = getTodosCloudClient();
      if (cloud) {
        let task;
        try {
          const cloudProjectRef = opts.project || globalOpts.project;
          const cloudProjectId = cloudProjectRef
            ? await cloudResolveProjectRef(cloud, cloudProjectRef)
            : undefined;
          const cloudTaskListId = opts.list
            ? await cloudResolveTaskListRef(cloud, opts.list, cloudProjectId)
            : undefined;
          if (opts.list && !cloudTaskListId) {
            throw new Error(`Could not resolve task list ID or slug: ${opts.list}`);
          }
          const cloudPlan = opts.plan
            ? await cloudResolvePlan(cloud, opts.plan, cloudProjectId)
            : null;
          if (opts.plan && !cloudPlan) {
            throw new Error(`Could not resolve plan ID or slug: ${opts.plan}`);
          }
          task = await cloudCreateTask(cloud, {
            title,
            description: opts.description,
            priority: parsePriority(opts.priority),
            parent_id: opts.parent ? await resolveTaskIdForCommand(opts.parent, cloud) : undefined,
            tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
            plan_id: cloudPlan?.id,
            assigned_to: opts.assign,
            status: parseStatus(opts.status),
            task_list_id: cloudTaskListId,
            agent_id: globalOpts.agent,
            session_id: globalOpts.session,
            project_id: cloudProjectId,
            estimated_minutes: opts.estimated !== undefined ? parseIntOption(opts.estimated, "--estimated") : undefined,
            sla_minutes: opts.slaMinutes !== undefined || opts.sla !== undefined ? parseIntOption(opts.slaMinutes ?? opts.sla, "--sla-minutes") : undefined,
            requires_approval: opts.approval || undefined,
            recurrence_rule: opts.recurrence,
            due_at: opts.due ? (opts.due.length === 10 ? opts.due + "T00:00:00.000Z" : opts.due) : undefined,
            reason: opts.reason,
          });
        } catch (e) {
          handleError(e);
        }
        if (globalOpts.json) {
          output(task, true);
        } else {
          console.log(chalk.green("Task created:"));
          console.log(formatTaskLine(task));
        }
        return;
      }

      // `--project` can land on either the command opts or the global program
      // opts depending on its position; commander routes it to globalOpts when a
      // global --project option exists. Honor both (matches the list/audit
      // commands) so `todos add … --project <id>` actually assigns the project.
      const explicitProject = opts.project || globalOpts.project;
      const projectId = explicitProject
        ? resolveProjectIdOrSlug(explicitProject)
        : autoProject(globalOpts);
      opts.tags = opts.tags || opts.tag;
      opts.list = opts.list || opts.taskList;
      const taskListId = opts.list ? (() => {
        const db = getDatabase();
        const id = resolvePartialId(db, "task_lists", opts.list);
        if (!id) {
          console.error(chalk.red(`Could not resolve task list ID: ${opts.list}`));
          process.exit(1);
        }
        return id;
      })() : undefined;
      let task;
      try {
        task = createTask({
          title,
          description: opts.description,
          priority: parsePriority(opts.priority),
          parent_id: opts.parent ? resolveTaskId(opts.parent) : undefined,
          tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
          plan_id: opts.plan ? resolvePlanId(opts.plan) : undefined,
          assigned_to: opts.assign,
          status: parseStatus(opts.status),
          task_list_id: taskListId,
          agent_id: globalOpts.agent,
          session_id: globalOpts.session,
          project_id: projectId,
          working_dir: process.cwd(),
          estimated_minutes: parseIntOption(opts.estimated, "--estimated"),
          sla_minutes: opts.slaMinutes !== undefined || opts.sla !== undefined ? parseIntOption(opts.slaMinutes ?? opts.sla, "--sla-minutes") : undefined,
          requires_approval: opts.approval || false,
          recurrence_rule: opts.recurrence,
          due_at: opts.due ? (opts.due.length === 10 ? opts.due + "T00:00:00.000Z" : opts.due) : undefined,
          reason: opts.reason,
        });
      } catch (e) {
        handleError(e);
      }

      if (globalOpts.json) {
        output(task, true);
      } else {
        console.log(chalk.green("Task created:"));
        console.log(formatTaskLine(task));
      }
    });

  const task = program
    .command("task")
    .description("Task subcommands for deterministic automation");

  task
    .command("upsert")
    .description("Create or update a task by stable metadata fingerprint")
    .requiredOption("--fingerprint <key>", "Stable dedupe fingerprint")
    .requiredOption("--title <text>", "Task title")
    .option("-d, --description <text>", "Task description")
    .option("-p, --priority <level>", "Priority: low, medium, high, critical")
    .option("-s, --status <status>", "Task status")
    .option("--list <id>", "Task list ID")
    .option("--task-list <id>", "Task list ID (alias for --list)")
    .option("-t, --tags <tags>", "Comma-separated tags")
    .option("--tag <tags>", "Comma-separated tags (alias for --tags)")
    .option("--metadata-json <json>", "JSON object merged into task metadata")
    .option("--working-dir <path>", "Working directory to store on create/update")
    .option("--project <id>", "Assign to project by ID, slug, or path")
    .option("--assign <agent>", "Assign to agent")
    .option("--expectation-id <id>", "Expectation metadata ID")
    .option("--expectation-fingerprint <key>", "Expectation metadata fingerprint")
    .option("--evidence-paths <paths>", "Comma-separated evidence paths")
    .option("--origin-loop-id <id>", "Origin loop ID")
    .option("--origin-run-id <id>", "Origin run ID")
    .option("--expected <json-or-text>", "Expected value metadata")
    .option("--observed <json-or-text>", "Observed value metadata")
    .option("--acceptance <json-or-text>", "Acceptance metadata")
    .action(async (opts) => {
      const globalOpts = program.opts();
      opts.tags = opts.tags || opts.tag;
      opts.list = opts.list || opts.taskList;
      const explicitProject = opts.project || globalOpts.project;
      // self_hosted cloud routing: dedupe-and-upsert on the SHARED dataset. The
      // local path wrote the task to this machine's sqlite by fingerprint, so on a
      // flipped machine the row never reached the cloud /v1 API (a split-brain write).
      const cloud = getTodosCloudClient();
      if (cloud) {
        let cloudResult;
        try {
          const projectId = explicitProject
            ? await cloudResolveProjectRef(cloud, explicitProject)
            : undefined;
          const taskListId = opts.list
            ? await cloudResolveTaskListRef(cloud, opts.list, projectId)
            : undefined;
          cloudResult = await cloudUpsertTaskByFingerprint(cloud, {
            fingerprint: opts.fingerprint,
            title: opts.title,
            description: opts.description,
            priority: parsePriority(opts.priority),
            status: parseStatus(opts.status),
            task_list_id: taskListId,
            tags: parseTags(opts.tags),
            metadata: buildExpectationMetadata(opts),
            working_dir: opts.workingDir ? resolve(opts.workingDir) : process.cwd(),
            project_id: projectId,
            assigned_to: opts.assign,
          });
        } catch (e) {
          handleError(e);
        }
        if (globalOpts.json) {
          output(cloudResult, true);
        } else {
          console.log(chalk.green(cloudResult.created ? "Task created:" : "Task updated:"));
          console.log(formatTaskLine(cloudResult.task));
        }
        return;
      }
      const projectId = explicitProject
        ? resolveProjectIdOrSlug(explicitProject)
        : autoProject(globalOpts);
      const taskListId = opts.list ? (() => {
        const db = getDatabase();
        const id = resolvePartialId(db, "task_lists", opts.list);
        if (!id) {
          console.error(chalk.red(`Could not resolve task list ID: ${opts.list}`));
          process.exit(1);
        }
        return id;
      })() : undefined;
      let result;
      try {
        result = upsertTaskByFingerprint({
          fingerprint: opts.fingerprint,
          title: opts.title,
          description: opts.description,
          priority: parsePriority(opts.priority),
          status: parseStatus(opts.status),
          task_list_id: taskListId,
          tags: parseTags(opts.tags),
          metadata: buildExpectationMetadata(opts),
          working_dir: opts.workingDir ? resolve(opts.workingDir) : process.cwd(),
          project_id: projectId,
          assigned_to: opts.assign,
          agent_id: globalOpts.agent,
          session_id: globalOpts.session,
        });
      } catch (e) {
        handleError(e);
      }

      if (globalOpts.json) {
        output(result, true);
      } else {
        console.log(chalk.green(result.created ? "Task created:" : "Task updated:"));
        console.log(formatTaskLine(result.task));
      }
    });

  task
    .command("route-state <id>")
    .description("Show deterministic routing eligibility and workflow pointers for a task")
    .option("--verify-project-root", "Filesystem-check the resolved project root and surface missing_project_root before admission")
    .action(async (id: string, opts) => {
      const globalOpts = program.opts();
      const resolvedId = resolveTaskId(id);
      const { getTaskRouteState } = await import("../../lib/task-routing.js");
      let state;
      try {
        state = getTaskRouteState(resolvedId, undefined, { verifyProjectRoot: Boolean(opts.verifyProjectRoot) });
      } catch (e) {
        handleError(e);
      }

      if (globalOpts.json) {
        output(state, true);
        return;
      }

      console.log(chalk.bold("Task route state"));
      console.log(`  ${chalk.dim("Task:")}       ${state.task_short_id || state.task_id.slice(0, 8)}`);
      console.log(`  ${chalk.dim("Eligible:")}   ${state.eligible ? chalk.green("yes") : chalk.yellow("no")}`);
      console.log(`  ${chalk.dim("Class:")}      ${state.route_class}`);
      console.log(`  ${chalk.dim("Reasons:")}    ${state.reasons.length > 0 ? state.reasons.join(", ") : "none"}`);
      console.log(`  ${chalk.dim("Route:")}      ${state.route.concurrency_key}`);
      if (state.evidence.owner) {
        console.log(`  ${chalk.dim("Owner:")}      ${state.evidence.owner}${state.evidence.stale ? chalk.yellow(" (stale)") : ""}`);
      }
      if (state.pointers.current_workflow_invocation_id) {
        console.log(`  ${chalk.dim("Invocation:")} ${state.pointers.current_workflow_invocation_id}`);
      }
      if (state.pointers.current_run_id) {
        console.log(`  ${chalk.dim("Run:")}        ${state.pointers.current_run_id}`);
      }
      if (state.pointers.latest_manifest_path) {
        console.log(`  ${chalk.dim("Manifest:")}   ${state.pointers.latest_manifest_path}`);
      }
    });

  task
    .command("workflow-pointers <id>")
    .description("Update OpenLoops workflow invocation/run artifact pointers on a task")
    .option("--invocation <id>", "Current workflow invocation ID")
    .option("--run <id>", "Current workflow run ID")
    .option("--manifest <path>", "Latest run manifest path")
    .option("--evaluation <path>", "Latest evaluator artifact path")
    .option("--state <state>", "Human-visible workflow state")
    .option("--actor <agent>", "Agent or workflow updating the pointers")
    .option("--clear", "Clear all workflow pointers before applying explicit pointer values")
    .option("--clear-invocation", "Clear current workflow invocation ID")
    .option("--clear-run", "Clear current workflow run ID")
    .option("--clear-manifest", "Clear latest run manifest path")
    .option("--clear-evaluation", "Clear latest evaluator artifact path")
    .option("--clear-state", "Clear human-visible workflow state")
    .action(async (id: string, opts) => {
      const globalOpts = program.opts();
      const resolvedId = resolveTaskId(id);
      const { getTaskRouteState, setTaskWorkflowPointers } = await import("../../lib/task-routing.js");
      let taskResult;
      try {
        taskResult = setTaskWorkflowPointers(resolvedId, {
          current_workflow_invocation_id: pointerOption(opts.invocation, Boolean(opts.clear || opts.clearInvocation)),
          current_run_id: pointerOption(opts.run, Boolean(opts.clear || opts.clearRun)),
          latest_manifest_path: pointerOption(opts.manifest, Boolean(opts.clear || opts.clearManifest)),
          latest_evaluation_path: pointerOption(opts.evaluation, Boolean(opts.clear || opts.clearEvaluation)),
          workflow_state: pointerOption(opts.state, Boolean(opts.clear || opts.clearState)),
          actor: opts.actor || globalOpts.agent || "cli",
        });
      } catch (e) {
        handleError(e);
      }
      const state = getTaskRouteState(taskResult.id);

      if (globalOpts.json) {
        output({ task: taskResult, route_state: state }, true);
        return;
      }

      console.log(chalk.green("Workflow pointers updated:"));
      console.log(formatTaskLine(taskResult));
      if (state.pointers.latest_manifest_path) {
        console.log(`  ${chalk.dim("Manifest:")} ${state.pointers.latest_manifest_path}`);
      }
    });

  // list
  program
    .command("list")
    .description("List tasks")
    .option("-s, --status <status>", "Filter by status")
    .option("-p, --priority <priority>", "Filter by priority")
    .option("--assigned <agent>", "Filter by assigned agent")
    .option("--tags <tags>", "Filter by tags (comma-separated)")
    .option("--tag <tags>", "Filter by tags (alias for --tags)")
    .option("-a, --all", "Show all tasks (including completed/cancelled)")
    .option("--list <ref>", "Filter by task list UUID, unique UUID prefix, or project-scoped slug")
    .option("--task-list <ref>", "Filter by task list UUID, unique UUID prefix, or project-scoped slug (alias for --list)")
    .option("--project-name <name>", "Filter by project name")
    .option("--agent-name <name>", "Filter by agent name/assigned")
    .option("--sort <field>", "Sort by: updated, created, priority, status")
    .option("--format <fmt>", "Output format: table (default), compact, csv, json")
    .option("--due-today", "Only tasks due today or earlier")
    .option("--overdue", "Only overdue tasks (past due_at)")
    .option("--recurring", "Only recurring tasks")
    .option("--limit <n>", "Max tasks to return")
    .action(async (opts) => {
      const globalOpts = program.opts();
      opts.tags = opts.tags || opts.tag;
      opts.list = opts.list || opts.taskList;
      // self_hosted cloud routing: skip local-store detection and resolve explicit
      // project/list filters against the shared API before listing tasks.
      const cloud = getTodosCloudClient();
      const cloudProjectRef = globalOpts.project || opts.projectName;
      const projectId = cloud && cloudProjectRef
        ? await cloudResolveProjectRef(cloud, cloudProjectRef)
        : cloud
          ? undefined
          : autoProject(globalOpts);
      const hasAssignedFilter = Boolean(opts.assigned || opts.agentName);
      const hasExplicitProjectFilter = Boolean(globalOpts.project || opts.projectName);
      const allowedSortFields = new Set(["updated", "created", "priority", "status"]);
      if (opts.sort && !allowedSortFields.has(opts.sort)) {
        console.error(chalk.red(`Invalid --sort value: ${opts.sort}. Allowed values: updated, created, priority, status.`));
        process.exit(1);
      }
      const allowedFormats = new Set(["table", "compact", "csv", "json"]);
      if (opts.format && !allowedFormats.has(opts.format)) {
        console.error(chalk.red(`Invalid --format value: ${opts.format}. Allowed values: table, compact, csv, json.`));
        process.exit(1);
      }

      const filter: Record<string, unknown> = {};
      if (projectId && !(hasAssignedFilter && !hasExplicitProjectFilter)) {
        filter["project_id"] = projectId;
      }
      if (opts.list && cloud) {
        filter["task_list_id"] = await cloudResolveTaskListRef(cloud, opts.list, projectId);
      } else if (opts.list) {
        const db = getDatabase();
        const listId = resolvePartialId(db, "task_lists", opts.list);
        if (!listId) {
          console.error(chalk.red(`Could not resolve task list ID: ${opts.list}`));
          process.exit(1);
        }
        filter["task_list_id"] = listId;
      }
      if (opts.status) {
        filter["status"] = opts.status.includes(",")
          ? opts.status.split(",").map((s: string) => normalizeStatus(s.trim()))
          : normalizeStatus(opts.status);
      } else if (!opts.all) {
        filter["status"] = ["pending", "in_progress"];
      }
      if (opts.priority) filter["priority"] = opts.priority;
      if (opts.assigned) filter["assigned_to"] = opts.assigned;
      if (opts.tags) filter["tags"] = opts.tags.split(",").map((t: string) => t.trim());
      if (opts.projectName && !cloud) {
        const { listProjects } = require("../../db/projects.js") as any;
        const projects = listProjects();
        const match = projects.find((p: any) => p.name.toLowerCase().includes(opts.projectName.toLowerCase()));
        if (match) {
          filter["project_id"] = match.id;
        } else {
          console.error(chalk.red(`No project matching: ${opts.projectName}`));
          process.exit(1);
        }
      }
      if (opts.agentName) {
        filter["assigned_to"] = opts.agentName;
      }
      if (opts.recurring) filter["has_recurrence"] = true;
      if (opts.limit !== undefined) {
        const parsedLimit = Number.parseInt(String(opts.limit), 10);
        if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
          console.error(chalk.red(`Invalid --limit value: ${opts.limit}. Must be a positive integer.`));
          process.exit(1);
        }
        filter["limit"] = parsedLimit;
      }

      let tasks = cloud ? await cloudListTasks(cloud, filter as any) : listTasks(filter as any);
      if (opts.dueToday) {
        const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
        tasks = tasks.filter(t => t.due_at && t.due_at <= todayEnd.toISOString());
      }
      if (opts.overdue) {
        const now = new Date().toISOString();
        tasks = tasks.filter(t => t.due_at && t.due_at < now && t.status !== "completed");
      }
      if (opts.sort) {
        const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        tasks.sort((a: any, b: any) => {
          if (opts.sort === "updated") return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
          if (opts.sort === "created") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          if (opts.sort === "priority") return (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4);
          if (opts.sort === "status") return a.status.localeCompare(b.status);
          return 0;
        });
      }

      const fmt = opts.format || (globalOpts.json ? "json" : "table");
      const outputTasks = redactBroadTasks(tasks);

      if (fmt === "json") {
        output(outputTasks, true);
        return;
      }

      if (outputTasks.length === 0) {
        if (fmt === "compact" || fmt === "csv") process.stdout.write("");
        else console.log(chalk.dim("No tasks found."));
        return;
      }

      if (fmt === "csv") {
        const headers = "id,short_id,title,status,priority,assigned_to,updated_at";
        const rows = outputTasks.map((t: any) => [
          t.id, t.short_id || "", t.title.replace(/,/g, ";"), t.status, t.priority, t.assigned_to || "", t.updated_at,
        ].join(","));
        console.log([headers, ...rows].join("\n"));
        return;
      }

      if (fmt === "compact") {
        for (const t of outputTasks) {
          const id = t.short_id || t.id.slice(0, 8);
          const assigned = t.assigned_to ? ` ${t.assigned_to}` : "";
          process.stdout.write(`${id} ${t.status} ${t.priority} ${t.title}${assigned}\n`);
        }
        return;
      }

      console.log(chalk.bold(`${outputTasks.length} task(s):\n`));
      for (const t of outputTasks) {
        console.log(formatTaskLine(t));
      }
    });

  // count
  program
    .command("count")
    .description("Show task count by status")
    .action(async () => {
      const globalOpts = program.opts();
      const cloud = getTodosCloudClient();
      const projectId = cloud
        ? (globalOpts.project ? await cloudResolveProjectRef(cloud, globalOpts.project) : undefined)
        : autoProject(globalOpts);
      const all = cloud
        ? await cloudListTasks(cloud, projectId ? { project_id: projectId } : {})
        : listTasks({ project_id: projectId });
      const counts: Record<string, number> = { total: all.length };
      for (const t of all) counts[t.status] = (counts[t.status] || 0) + 1;

      if (globalOpts.json) {
        output(counts, true);
      } else {
        const parts = [
          `total: ${chalk.bold(String(counts.total))}`,
          `pending: ${chalk.yellow(String(counts["pending"] || 0))}`,
          `in_progress: ${chalk.blue(String(counts["in_progress"] || 0))}`,
          `completed: ${chalk.green(String(counts["completed"] || 0))}`,
          `failed: ${chalk.red(String(counts["failed"] || 0))}`,
          `cancelled: ${chalk.gray(String(counts["cancelled"] || 0))}`,
        ];
        console.log(parts.join("  "));
      }
    });

  // show
  program
    .command("show <id>")
    .description("Show full task details")
    .action(async (id: string) => {
      const globalOpts = program.opts();
      const cloud = getTodosCloudClient();
      let task: any;
      if (cloud) {
        const remote = await cloudGetTask(cloud, await resolveTaskIdForCommand(id, cloud));
        const commentPage = remote ? await cloudListComments(cloud, remote.id) : null;
        // The /v1 API returns the task row without relation graphs; default the
        // relation arrays so the detail renderer below never touches undefined.
        task = remote
          ? {
              subtasks: [], dependencies: [], blocked_by: [], ...remote, tags: remote.tags ?? [],
              comments: commentPage!.comments,
              comments_page: {
                count: commentPage!.count,
                limit: commentPage!.limit,
                has_more: commentPage!.has_more,
                next_cursor: commentPage!.next_cursor,
                pagination_supported: commentPage!.pagination_supported,
              },
            }
          : null;
      } else {
        const resolvedId = resolveTaskId(id);
        task = getTaskWithRelations(resolvedId);
      }

      if (!task) {
        console.error(chalk.red(`Task not found: ${id}`));
        process.exit(1);
      }

      if (globalOpts.json) {
        output(task, true);
        return;
      }

      console.log(chalk.bold("Task Details:\n"));
      console.log(`  ${chalk.dim("ID:")}       ${task.id}`);
      console.log(`  ${chalk.dim("Title:")}    ${task.title}`);
      console.log(`  ${chalk.dim("Status:")}   ${(statusColors[task.status] || chalk.white)(task.status)}`);
      console.log(`  ${chalk.dim("Priority:")} ${(priorityColors[task.priority] || chalk.white)(task.priority)}`);
      if (task.description) console.log(`  ${chalk.dim("Desc:")}     ${task.description}`);
      if (task.assigned_to) console.log(`  ${chalk.dim("Assigned:")} ${task.assigned_to}`);
      if (task.agent_id) console.log(`  ${chalk.dim("Agent:")}    ${task.agent_id}`);
      if (task.session_id) console.log(`  ${chalk.dim("Session:")}  ${task.session_id}`);
      if (task.locked_by) console.log(`  ${chalk.dim("Locked:")}   ${task.locked_by} (at ${task.locked_at})`);
      if (task.requires_approval) {
        const approvalStatus = task.approved_by ? chalk.green(`approved by ${task.approved_by}`) : chalk.yellow("pending approval");
        console.log(`  ${chalk.dim("Approval:")} ${approvalStatus}`);
      }
      if (task.estimated_minutes) console.log(`  ${chalk.dim("Estimate:")} ${task.estimated_minutes} minutes`);
      if (task.sla_minutes) console.log(`  ${chalk.dim("SLA:")}      ${task.sla_minutes} minutes`);
      if (task.due_at) console.log(`  ${chalk.dim("Due:")}      ${task.due_at}`);
      if (task.recurrence_rule) console.log(`  ${chalk.dim("Repeats:")}  ${task.recurrence_rule}`);
      if (task.project_id) console.log(`  ${chalk.dim("Project:")}  ${task.project_id}`);
      if (task.plan_id) console.log(`  ${chalk.dim("Plan:")}     ${task.plan_id}`);
      if (task.working_dir) console.log(`  ${chalk.dim("WorkDir:")}  ${task.working_dir}`);
      if (task.parent) console.log(`  ${chalk.dim("Parent:")}   ${task.parent.id.slice(0, 8)} | ${task.parent.title}`);
      if (task.tags.length > 0) console.log(`  ${chalk.dim("Tags:")}     ${task.tags.join(", ")}`);
      console.log(`  ${chalk.dim("Version:")}  ${task.version}`);
      console.log(`  ${chalk.dim("Created:")}  ${task.created_at}`);
      if (task.started_at) console.log(`  ${chalk.dim("Started:")}  ${task.started_at}`);
      if (task.completed_at) {
        console.log(`  ${chalk.dim("Done:")}     ${task.completed_at}`);
        if (task.started_at) {
          const dur = Math.round((new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()) / 60000);
          console.log(`  ${chalk.dim("Duration:")} ${dur}m`);
        }
      }

      if (task.subtasks.length > 0) {
        console.log(chalk.bold(`\n  Subtasks (${task.subtasks.length}):`));
        for (const st of task.subtasks) {
          console.log(`    ${formatTaskLine(st)}`);
        }
      }

      if (task.dependencies.length > 0) {
        console.log(chalk.bold(`\n  Depends on (${task.dependencies.length}):`));
        for (const dep of task.dependencies) {
          console.log(`    ${formatTaskLine(dep)}`);
        }
      }

      if (task.blocked_by.length > 0) {
        console.log(chalk.bold(`\n  Blocks (${task.blocked_by.length}):`));
        for (const b of task.blocked_by) {
          console.log(`    ${formatTaskLine(b)}`);
        }
      }

      if (task.comments.length > 0) {
        const suffix = task.comments_page?.has_more
          ? task.comments_page.pagination_supported
            ? ", newer page shown; older comments available"
            : ", newer comments shown; older comments omitted until the server is upgraded"
          : "";
        console.log(chalk.bold(`\n  Comments (${task.comments.length}${suffix}):`));
        for (const c of task.comments) {
          console.log(formatHumanComment(c));
        }
      }
    });

  // inspect
  program
    .command("inspect [id]")
    .description("Full orientation for a task — details, description, dependencies, blocker, files, commits, comments. If no ID given, shows current in-progress task for --agent.")
    .action(async (id?: string) => {
      const globalOpts = program.opts();
      const cloud = getTodosCloudClient();
      let resolvedId = id ? await resolveTaskIdForCommand(id, cloud) : null;

      if (!resolvedId && globalOpts.agent && !cloud) {
        const { listTasks: lt } = await import("../../db/tasks.js");
        const active = lt({ status: "in_progress", assigned_to: globalOpts.agent! });
        if (active.length > 0) resolvedId = active[0]!.id;
      }

      if (!resolvedId && cloud && globalOpts.agent) {
        // Cloud mode: find the agent's current in-progress task from the shared store.
        const active = await cloudListTasks(cloud, { status: "in_progress", assigned_to: globalOpts.agent, limit: 1 } as never);
        if (active.length > 0) resolvedId = active[0]!.id;
      }
      if (!resolvedId) { console.error(chalk.red("No task ID given and no active task found. Pass an ID or use --agent.")); process.exit(1); }

      let task: any;
      if (cloud) {
        const remote = await cloudGetTask(cloud, resolvedId);
        const commentPage = remote ? await cloudListComments(cloud, remote.id) : null;
        // The /v1 API returns the task row without relation graphs; default the
        // relation arrays so the detail renderer below never touches undefined.
        task = remote
          ? {
              subtasks: [], dependencies: [], blocked_by: [], checklist: [], ...remote, tags: remote.tags ?? [],
              comments: commentPage!.comments,
              comments_page: {
                count: commentPage!.count,
                limit: commentPage!.limit,
                has_more: commentPage!.has_more,
                next_cursor: commentPage!.next_cursor,
                pagination_supported: commentPage!.pagination_supported,
              },
            }
          : null;
      } else {
        task = getTaskWithRelations(resolvedId);
      }
      if (!task) { console.error(chalk.red(`Task not found: ${id || resolvedId}`)); process.exit(1); }

      if (globalOpts.json && !cloud) {
        const { listTaskFiles } = await import("../../db/task-files.js");
        const { getTaskCommits } = await import("../../db/task-commits.js");
        try { (task as any).files = listTaskFiles(task.id); } catch (e) { console.error(chalk.dim(`Warning: could not load task files: ${e instanceof Error ? e.message : String(e)}`)); }
        try { (task as any).commits = getTaskCommits(task.id); } catch (e) { console.error(chalk.dim(`Warning: could not load task commits: ${e instanceof Error ? e.message : String(e)}`)); }
        output(task, true);
        return;
      }
      if (globalOpts.json) {
        output(task, true);
        return;
      }

      const sid = task.short_id || task.id.slice(0, 8);
      const statusColor = statusColors[task.status] || chalk.white;
      const prioColor = priorityColors[task.priority] || chalk.white;
      console.log(chalk.bold(`\n${chalk.cyan(sid)} ${statusColor(task.status)} ${prioColor(task.priority)} ${task.title}\n`));

      if (task.description) {
        console.log(chalk.dim("Description:"));
        console.log(`  ${task.description}\n`);
      }

      if (task.assigned_to) console.log(`  ${chalk.dim("Assigned:")}  ${task.assigned_to}`);
      if (task.locked_by) console.log(`  ${chalk.dim("Locked by:")} ${task.locked_by}`);
      if (task.project_id) console.log(`  ${chalk.dim("Project:")}   ${task.project_id}`);
      if (task.plan_id) console.log(`  ${chalk.dim("Plan:")}      ${task.plan_id}`);
      if (task.started_at) console.log(`  ${chalk.dim("Started:")}   ${task.started_at}`);
      if (task.completed_at) {
        console.log(`  ${chalk.dim("Completed:")} ${task.completed_at}`);
        if (task.started_at) {
          const dur = Math.round((new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()) / 60000);
          console.log(`  ${chalk.dim("Duration:")}  ${dur}m`);
        }
      }
      if (task.estimated_minutes) console.log(`  ${chalk.dim("Estimate:")}  ${task.estimated_minutes}m`);
      if (task.tags.length > 0) console.log(`  ${chalk.dim("Tags:")}      ${task.tags.join(", ")}`);

      const unfinishedDeps = task.dependencies.filter((d: any) => d.status !== "completed" && d.status !== "cancelled");
      if (task.dependencies.length > 0) {
        console.log(chalk.bold(`\n  Depends on (${task.dependencies.length}):`));
        for (const dep of task.dependencies) {
          const blocked = dep.status !== "completed" && dep.status !== "cancelled";
          const icon = blocked ? chalk.red("✗") : chalk.green("✓");
          console.log(`    ${icon} ${formatTaskLine(dep)}`);
        }
      }
      if (unfinishedDeps.length > 0) {
        console.log(chalk.red(`\n  BLOCKED by ${unfinishedDeps.length} unfinished dep(s)`));
      }

      if (task.blocked_by.length > 0) {
        console.log(chalk.bold(`\n  Blocks (${task.blocked_by.length}):`));
        for (const b of task.blocked_by) console.log(`    ${formatTaskLine(b)}`);
      }

      if (task.subtasks.length > 0) {
        console.log(chalk.bold(`\n  Subtasks (${task.subtasks.length}):`));
        for (const st of task.subtasks) console.log(`    ${formatTaskLine(st)}`);
      }

      // Files
      if (!cloud) {
        try {
          const { listTaskFiles } = await import("../../db/task-files.js");
          const files = listTaskFiles(task.id);
          if (files.length > 0) {
            console.log(chalk.bold(`\n  Files (${files.length}):`));
            for (const f of files) console.log(`    ${chalk.dim(f.status || "file")} ${f.path}`);
          }
        } catch (e) {
          console.error(chalk.dim(`Warning: could not load task files: ${e instanceof Error ? e.message : String(e)}`));
        }
      }

      // Commits
      if (!cloud) {
        try {
          const { getTaskCommits } = await import("../../db/task-commits.js");
          const commits = getTaskCommits(task.id);
          if (commits.length > 0) {
            console.log(chalk.bold(`\n  Commits (${commits.length}):`));
            for (const c of commits) console.log(`    ${chalk.yellow(c.sha.slice(0, 7))} ${c.message || ""}`);
          }
        } catch (e) {
          console.error(chalk.dim(`Warning: could not load task commits: ${e instanceof Error ? e.message : String(e)}`));
        }
      }

      if (task.comments.length > 0) {
        const suffix = task.comments_page?.has_more
          ? task.comments_page.pagination_supported
            ? ", newer page shown; older comments available"
            : ", newer comments shown; older comments omitted until the server is upgraded"
          : "";
        console.log(chalk.bold(`\n  Comments (${task.comments.length}${suffix}):`));
        for (const c of task.comments) {
          console.log(formatHumanComment(c));
        }
      }

      if (task.checklist && task.checklist.length > 0) {
        const done = task.checklist.filter((c: any) => c.checked).length;
        console.log(chalk.bold(`\n  Checklist (${done}/${task.checklist.length}):`));
        for (const item of task.checklist) {
          const icon = (item as any).checked ? chalk.green("☑") : chalk.dim("☐");
          console.log(`    ${icon} ${(item as any).text || (item as any).title}`);
        }
      }

      console.log();
    });

  // history
  program
    .command("history <id>")
    .description("Show change history for a task (audit log)")
    .action(async (id: string) => {
      const globalOpts = program.opts();
      // self_hosted cloud routing: read the SHARED audit trail. The local path read
      // this machine's sqlite and reported "No history" for a cloud task.
      const cloud = getTodosCloudClient();
      const resolvedId = await resolveTaskIdForCommand(id, cloud);
      let history;
      if (cloud) {
        try {
          history = await cloudTaskHistory(cloud, resolvedId);
        } catch (e) {
          handleError(e);
        }
      } else {
        const { getTaskHistory } = await import("../../db/audit.js");
        history = getTaskHistory(resolvedId);
      }

      if (globalOpts.json) {
        output(history, true);
        return;
      }

      if (history.length === 0) {
        console.log(chalk.dim("No history for this task."));
        return;
      }

      console.log(chalk.bold(`${history.length} change(s):\n`));
      for (const h of history) {
        const agent = h.agent_id ? chalk.cyan(` by ${h.agent_id}`) : "";
        const field = h.field ? chalk.yellow(` ${h.field}`) : "";
        const change = h.old_value && h.new_value ? ` ${chalk.red(h.old_value)} → ${chalk.green(h.new_value)}` : h.new_value ? ` → ${chalk.green(h.new_value)}` : "";
        console.log(`  ${chalk.dim(h.created_at)} ${chalk.bold(h.action)}${field}${change}${agent}`);
      }
    });

  // update
  program
    .command("update <id>")
    .description("Update a task")
    .option("--title <text>", "New title")
    .option("-d, --description <text>", "New description")
    .option("-s, --status <status>", "New status")
    .option("-p, --priority <priority>", "New priority")
    .option("--assign <agent>", "Assign to agent")
    .option("--tags <tags>", "New tags (comma-separated)")
    .option("--tag <tags>", "New tags (alias for --tags)")
    .option("--list <id>", "Move to a task list (UUID authoritative; project-scoped slug accepted)")
    .option("--task-list <id>", "Move to a task list (alias for --list)")
    .option("--clear-list", "Detach from its task list (reset task_list_id to null)")
    .option("--working-dir <path>", "Repair the task's working_dir to a specific path (routing metadata)")
    .option("--clear-working-dir", "Reset the task's working_dir to null (undo path for routing repairs)")
    .option("--plan <id>", "Move to a plan")
    .option("--clear-plan", "Remove from its current plan")
    .option("--estimated <minutes>", "Estimated time in minutes")
    .option("--sla-minutes <minutes>", "SLA minutes before unfinished work is escalated")
    .option("--sla <minutes>", "Alias for --sla-minutes")
    .option("--due <date>", "Due date (ISO string or YYYY-MM-DD), empty to clear")
    .option("--recurrence <rule>", "Recurrence rule, empty to clear")
    .option("--approval", "Require approval before completion")
    .option("--clear-approval", "Remove the approval requirement")
    .action(async (id: string, opts) => {
      const globalOpts = program.opts();
      opts.tags = opts.tags || opts.tag;
      opts.list = opts.list || opts.taskList;

      if (opts.plan && opts.clearPlan) {
        handleError(new Error("Use either --plan or --clear-plan, not both."));
      }
      if (opts.approval && opts.clearApproval) {
        handleError(new Error("Use either --approval or --clear-approval, not both."));
      }
      if (opts.list && opts.clearList) {
        handleError(new Error("Use either --list or --clear-list, not both."));
      }
      if (opts.workingDir !== undefined && opts.clearWorkingDir) {
        handleError(new Error("Use either --working-dir or --clear-working-dir, not both."));
      }

      // self_hosted cloud routing: PATCH straight against <app>.hasna.xyz/v1.
      const cloud = getTodosCloudClient();
      if (cloud) {
        let task;
        try {
          const currentId = await resolveTaskIdForCommand(id, cloud);
          const current = await cloudGetTask(cloud, currentId);
          if (!current) throw new Error(`Task not found: ${id}`);
          const plan = opts.plan ? await cloudResolvePlan(cloud, opts.plan, current.project_id ?? undefined) : null;
          if (opts.plan && !plan) throw new Error(`Plan not found: ${opts.plan}`);
          const taskListId = opts.list
            ? await cloudResolveTaskListRef(cloud, opts.list, current.project_id ?? undefined)
            : opts.clearList
              ? null
              : undefined;
          task = await cloudUpdateTask(cloud, currentId, {
            title: opts.title,
            description: opts.description,
            status: parseStatus(opts.status),
            priority: parsePriority(opts.priority),
            assigned_to: opts.assign,
            tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
            plan_id: plan?.id ?? (opts.clearPlan ? null : undefined),
            task_list_id: taskListId,
            working_dir: opts.workingDir ? resolve(opts.workingDir) : opts.clearWorkingDir ? null : undefined,
            estimated_minutes: opts.estimated !== undefined ? parseIntOption(opts.estimated, "--estimated") : undefined,
            sla_minutes: opts.slaMinutes !== undefined || opts.sla !== undefined ? parseIntOption(opts.slaMinutes ?? opts.sla, "--sla-minutes") : undefined,
            due_at: opts.due !== undefined ? (opts.due === "" ? null : opts.due.length === 10 ? opts.due + "T00:00:00.000Z" : opts.due) : undefined,
            recurrence_rule: opts.recurrence !== undefined ? (opts.recurrence === "" ? null : opts.recurrence) : undefined,
            requires_approval: opts.clearApproval ? false : (opts.approval !== undefined ? true : undefined),
          });
        } catch (e) {
          handleError(e);
        }
        if (globalOpts.json) {
          output(task, true);
        } else {
          console.log(chalk.green("Task updated:"));
          console.log(formatTaskLine(task));
        }
        return;
      }

      const resolvedId = resolveTaskId(id);
      const current = getTask(resolvedId);
      if (!current) {
        console.error(chalk.red(`Task not found: ${id}`));
        process.exit(1);
      }
      const taskListId = opts.list ? (() => {
        const resolved = resolveTaskListRef(opts.list, current.project_id);
        if ("error" in resolved) {
          console.error(chalk.red(resolved.error));
          process.exit(1);
        }
        return resolved.id;
      })() : opts.clearList ? null : undefined;
      const planId = opts.plan ? resolvePlanId(opts.plan) : opts.clearPlan ? null : undefined;

      let task;
      try {
        task = updateTask(resolvedId, {
          version: current.version,
          title: opts.title,
          description: opts.description,
          status: parseStatus(opts.status),
          priority: parsePriority(opts.priority),
          assigned_to: opts.assign,
          tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
          plan_id: planId,
          task_list_id: taskListId,
          working_dir: opts.workingDir ? resolve(opts.workingDir) : opts.clearWorkingDir ? null : undefined,
          estimated_minutes: opts.estimated !== undefined ? parseIntOption(opts.estimated, "--estimated") : undefined,
          sla_minutes: opts.slaMinutes !== undefined || opts.sla !== undefined ? parseIntOption(opts.slaMinutes ?? opts.sla, "--sla-minutes") : undefined,
          due_at: opts.due !== undefined ? (opts.due === "" ? null : opts.due.length === 10 ? opts.due + "T00:00:00.000Z" : opts.due) : undefined,
          recurrence_rule: opts.recurrence !== undefined ? (opts.recurrence === "" ? null : opts.recurrence) : undefined,
          requires_approval: opts.clearApproval ? false : (opts.approval !== undefined ? true : undefined),
        });
      } catch (e) {
        handleError(e);
      }

      if (globalOpts.json) {
        output(task, true);
      } else {
        console.log(chalk.green("Task updated:"));
        console.log(formatTaskLine(task));
      }
    });

  // done
  program
    .command("done <id>")
    .description("Mark a task as completed")
    .option("--attach-ids <ids>", "Comma-separated @hasna/attachments IDs to link as evidence")
    .option("--files-changed <files>", "Comma-separated list of files changed")
    .option("--test-results <results>", "Test results summary")
    .option("--commit-hash <hash>", "Git commit hash")
    .option("--notes <notes>", "Completion notes")
    .option("--confidence <0-1>", "Agent's confidence 0.0-1.0 that the task is fully complete (default: 1.0, <0.7 flagged for review)")
    .action(async (id: string, opts: { attachIds?: string; filesChanged?: string; testResults?: string; commitHash?: string; notes?: string; confidence?: string }) => {
      const globalOpts = program.opts();
      const attachmentIds = opts.attachIds ? opts.attachIds.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      const filesChanged = opts.filesChanged ? opts.filesChanged.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      let confidence: number | undefined;
      if (opts.confidence !== undefined) {
        confidence = Number(opts.confidence);
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
          console.error(chalk.red("--confidence must be a number between 0.0 and 1.0"));
          process.exit(1);
        }
      }
      const completionOptions = {
        ...(attachmentIds?.length ? { attachment_ids: attachmentIds } : {}),
        ...(filesChanged?.length ? { files_changed: filesChanged } : {}),
        ...(opts.testResults !== undefined ? { test_results: opts.testResults } : {}),
        ...(opts.commitHash !== undefined ? { commit_hash: opts.commitHash } : {}),
        ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
        ...(confidence !== undefined ? { confidence } : {}),
      };
      const cloud = getTodosCloudClient();
      if (cloud) {
        let task;
        try {
          task = await cloudCompleteTask(cloud, await resolveTaskIdForCommand(id, cloud), {
            ...(globalOpts.agent ? { agent_id: globalOpts.agent } : {}),
            ...completionOptions,
          });
        } catch (e) {
          handleError(e);
        }
        if (globalOpts.json) {
          output(task, true);
        } else {
          console.log(chalk.green("Task completed:"));
          console.log(formatTaskLine(task));
        }
        return;
      }
      const resolvedId = resolveTaskId(id);
      let task;
      try {
        task = completeTask(resolvedId, globalOpts.agent, undefined, completionOptions);
      } catch (e) {
        handleError(e);
      }

      if (globalOpts.json) {
        output(task, true);
      } else {
        console.log(chalk.green("Task completed:"));
        console.log(formatTaskLine(task));
      }
    });

  // approve
  program
    .command("approve <id>")
    .description("Approve a task that requires approval")
    .action(async (id: string) => {
      const globalOpts = program.opts();
      const approver = globalOpts.agent || "cli";
      try {
        // self_hosted cloud routing: resolve and approve the task on the SHARED
        // dataset. The local path read this machine's sqlite and 404'd
        // ("Task not found") a task that lives only in the cloud.
        const cloud = getTodosCloudClient();
        if (cloud) {
          const cloudId = await resolveTaskIdForCommand(id, cloud);
          const task = await cloudGetTask(cloud, cloudId);
          if (!task) { console.error(chalk.red(`Task not found: ${id}`)); process.exit(1); }
          if (!task.requires_approval) { console.log(chalk.yellow("This task does not require approval.")); return; }
          if (task.approved_by) { console.log(chalk.yellow(`Already approved by ${task.approved_by}.`)); return; }
          const updated = await cloudUpdateTask(cloud, cloudId, { approved_by: approver, version: task.version });
          if (globalOpts.json) { output(updated, true); }
          else {
            console.log(chalk.green(`Task approved by ${approver}:`));
            console.log(formatTaskLine(updated));
          }
          return;
        }

        const resolvedId = resolveTaskId(id);
        const task = getTask(resolvedId);
        if (!task) { console.error(chalk.red(`Task not found: ${id}`)); process.exit(1); }

        if (!task.requires_approval) {
          console.log(chalk.yellow("This task does not require approval."));
          return;
        }
        if (task.approved_by) {
          console.log(chalk.yellow(`Already approved by ${task.approved_by}.`));
          return;
        }

        const updated = updateTask(resolvedId, { approved_by: approver, version: task.version });
        if (globalOpts.json) {
          output(updated, true);
        } else {
          console.log(chalk.green(`Task approved by ${approver}:`));
          console.log(formatTaskLine(updated));
        }
      } catch (e) {
        handleError(e);
      }
    });

  // start
  program
    .command("start <id>")
    .description("Claim, lock, and start a task")
    .action(async (id: string) => {
      const globalOpts = program.opts();
      const agentId = globalOpts.agent || "cli";
      const cloud = getTodosCloudClient();
      let task;
      if (cloud) {
        try {
          task = await cloudTaskAction(cloud, await resolveTaskIdForCommand(id, cloud), "start", { agent_id: agentId });
        } catch (e) {
          handleError(e);
        }
        if (globalOpts.json) {
          output(task, true);
        } else {
          console.log(chalk.green(`Task started by ${agentId}:`));
          console.log(formatTaskLine(task));
        }
        return;
      }
      const resolvedId = resolveTaskId(id);
      try {
        task = startTask(resolvedId, agentId);
      } catch (e) {
        handleError(e);
      }

      if (globalOpts.json) {
        output(task, true);
      } else {
        console.log(chalk.green(`Task started by ${agentId}:`));
        console.log(formatTaskLine(task));
      }
    });

  // lock
  program
    .command("lock <id>")
    .description("Acquire exclusive lock on a task")
    .action(async (id: string) => {
      const globalOpts = program.opts();
      const agentId = globalOpts.agent || "cli";
      const cloud = getTodosCloudClient();
      const resolvedId = cloud ? await resolveTaskIdForCommand(id, cloud) : resolveTaskId(id);
      let result;
      try {
        // self_hosted cloud routing: lock on the SHARED dataset so every agent
        // coordinates on the same lock. Local lookup 404'd cloud tasks before.
        result = cloud ? await cloudLockTask(cloud, resolvedId, agentId) : lockTask(resolvedId, agentId);
      } catch (e) {
        handleError(e);
      }

      if (globalOpts.json) {
        output(result, true);
      } else if (result.success) {
        console.log(chalk.green(`Lock acquired by ${agentId}`));
      } else {
        console.error(chalk.red(`Lock failed: ${result.error}`));
        process.exit(1);
      }
    });

  // unlock
  program
    .command("unlock <id>")
    .description("Release lock on a task")
    .action(async (id: string) => {
      const globalOpts = program.opts();
      const cloud = getTodosCloudClient();
      const resolvedId = cloud ? await resolveTaskIdForCommand(id, cloud) : resolveTaskId(id);
      try {
        if (cloud) await cloudUnlockTask(cloud, resolvedId, globalOpts.agent, !globalOpts.agent);
        else unlockTask(resolvedId, globalOpts.agent);
      } catch (e) {
        handleError(e);
      }

      if (globalOpts.json) {
        output({ success: true }, true);
      } else {
        console.log(chalk.green("Lock released."));
      }
    });

  // delete
  program
    .command("delete <id>")
    .description("Delete a task")
    .action(async (id: string) => {
      const globalOpts = program.opts();
      const cloud = getTodosCloudClient();
      const deleted = cloud ? await cloudDeleteTask(cloud, await resolveTaskIdForCommand(id, cloud)) : deleteTask(resolveTaskId(id));

      if (globalOpts.json) {
        output({ deleted }, true);
        if (!deleted) process.exitCode = 1;
      } else if (deleted) {
        console.log(chalk.green("Task deleted."));
      } else {
        console.error(chalk.red("Task not found."));
        process.exit(1);
      }
    });

  // remove
  program
    .command("remove <id>")
    .description("Remove/delete a task (alias for delete)")
    .action(async (id: string) => {
      const globalOpts = program.opts();
      const cloud = getTodosCloudClient();
      if (cloud) {
        const deleted = await cloudDeleteTask(cloud, await resolveTaskIdForCommand(id, cloud));
        if (globalOpts.json) {
          output({ deleted }, true);
          if (!deleted) process.exitCode = 1;
        } else if (deleted) {
          console.log(chalk.green("Task removed."));
        } else {
          console.error(chalk.red("Task not found."));
          process.exit(1);
        }
        return;
      }
      const resolvedId = resolveTaskId(id);
      const deleted = deleteTask(resolvedId);
      if (globalOpts.json) {
        output({ deleted }, true);
      } else if (deleted) {
        console.log(chalk.green("Task removed."));
      } else {
        console.error(chalk.red("Task not found."));
        process.exit(1);
      }
    });

  // bulk
  program
    .command("bulk <action> <ids...>")
    .description("Bulk operation on multiple tasks (done, start, delete, plan)")
    .option("--plan <id>", "Plan ID for the plan/move-plan action")
    .option("--clear-plan", "Remove plan assignment for the plan/move-plan action")
    .action(async (action: string, ids: string[], opts: { plan?: string; clearPlan?: boolean }) => {
      const globalOpts = program.opts();
      const results: { id: string; success: boolean; error?: string }[] = [];
      const cloud = getTodosCloudClient();
      const isPlanAction = action === "plan" || action === "move-plan";
      if (isPlanAction && Boolean(opts.plan) === Boolean(opts.clearPlan)) {
        console.error(chalk.red("Use exactly one of --plan or --clear-plan with bulk plan."));
        process.exit(1);
      }
      const planId = isPlanAction
        ? opts.plan ? resolvePlanId(opts.plan) : null
        : undefined;
      const knownActions = new Set(["done", "complete", "start", "delete", "plan", "move-plan"]);
      if (!knownActions.has(action)) {
        console.error(chalk.red(`Unknown action: ${action}. Use: done, start, delete, plan`));
        process.exit(1);
      }

      // self_hosted cloud routing: run each op against the SHARED dataset. The local
      // path resolved ids against this machine's sqlite — `bulk done` threw
      // "Task not found" for valid cloud task ids (while `bulk delete` silently
      // no-op'd), a split-brain read.
      if (cloud) {
        for (const rawId of ids) {
          try {
            const resolvedId = await resolveTaskIdForCommand(rawId, cloud);
            if (action === "done" || action === "complete") {
              await cloudCompleteTask(cloud, resolvedId, { ...(globalOpts.agent ? { agent_id: globalOpts.agent } : {}) });
            } else if (action === "start") {
              await cloudTaskAction(cloud, resolvedId, "start", { agent_id: globalOpts.agent || "cli" });
            } else if (action === "delete") {
              await cloudDeleteTask(cloud, resolvedId);
            } else {
              const current = await cloudGetTask(cloud, resolvedId);
              if (!current) throw new Error(`Task not found: ${rawId}`);
              await cloudUpdateTask(cloud, resolvedId, { version: current.version, plan_id: planId });
            }
            results.push({ id: resolvedId, success: true });
          } catch (e) {
            results.push({ id: rawId, success: false, error: e instanceof Error ? e.message : String(e) });
          }
        }
        const succeededCloud = results.filter(r => r.success).length;
        const failedCloud = results.filter(r => !r.success).length;
        if (globalOpts.json) {
          output({ results, succeeded: succeededCloud, failed: failedCloud }, true);
        } else {
          console.log(chalk.green(`${action}: ${succeededCloud} succeeded, ${failedCloud} failed`));
          for (const r of results.filter(r => !r.success)) {
            console.log(chalk.red(`  ${r.id}: ${r.error}`));
          }
        }
        return;
      }

      for (const rawId of ids) {
        try {
          const resolvedId = resolveTaskId(rawId);
          if (action === "done" || action === "complete") {
            completeTask(resolvedId, globalOpts.agent);
            results.push({ id: resolvedId, success: true });
          } else if (action === "start") {
            startTask(resolvedId, globalOpts.agent || "cli");
            results.push({ id: resolvedId, success: true });
          } else if (action === "delete") {
            deleteTask(resolvedId);
            results.push({ id: resolvedId, success: true });
          } else if (isPlanAction) {
            const current = getTask(resolvedId);
            if (!current) {
              throw new Error(`Task not found: ${rawId}`);
            }
            updateTask(resolvedId, { version: current.version, plan_id: planId });
            results.push({ id: resolvedId, success: true });
          } else {
            console.error(chalk.red(`Unknown action: ${action}. Use: done, start, delete, plan`));
            process.exit(1);
          }
        } catch (e) {
          results.push({ id: rawId, success: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      if (globalOpts.json) {
        output({ results, succeeded, failed }, true);
      } else {
        console.log(chalk.green(`${action}: ${succeeded} succeeded, ${failed} failed`));
        for (const r of results.filter(r => !r.success)) {
          console.log(chalk.red(`  ${r.id}: ${r.error}`));
        }
      }
    });
}
