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
  cloudGetTaskRelations,
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
  cloudListAgents,
} from "../cloud-router.js";
import type { CloudTaskRelations } from "../cloud-router.js";
import type { TaskPriority, TaskStatus } from "../../types/index.js";
import { canonicalAgentRef, resolveCreatorIdentity, resolveWritableIdentity } from "../../lib/creator-identity.js";
import { formatExpiredLock, lockDisplayState } from "../../lib/lock-display.js";
import { resolveClaimIdentity } from "../claim-guard.js";
import { resolveValidatedAssignee } from "../assignee-guard.js";
import { loadAssigneeContext } from "../../lib/assignee-context.js";
import { listAgents } from "../../db/agents.js";
import {
  formatTaskLine,
  resolveTaskId,
  resolveTaskIdForCommand,
  autoProject,
  handleError,
  output,
  parseEnumFlag,
  parseEnumFlagList,
  statusColors,
  priorityColors,
  TASK_PRIORITY_FLAG,
  TASK_STATUS_FLAG,
} from "../helpers.js";
import { redactBroadTasks } from "../output-redaction.js";

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
 * Dependency graph for a remote task's detail view.
 *
 * `show`/`inspect` must never be sunk by the relation read: a server that
 * predates the dependency route (404) or a backend that does not implement it
 * (501) simply has no edges to show, and any other failure degrades to empty
 * arrays with a warning on stderr rather than losing the whole task.
 */
async function cloudDetailRelations(
  cloud: Parameters<typeof cloudGetTaskRelations>[0],
  id: string,
): Promise<CloudTaskRelations> {
  try {
    return await cloudGetTaskRelations(cloud, id);
  } catch (e) {
    const status = (e as { status?: unknown } | null)?.status;
    if (status !== 404 && status !== 501) {
      console.error(chalk.dim(`Warning: could not load task dependencies: ${e instanceof Error ? e.message : String(e)}`));
    }
    return { dependencies: [], blocked_by: [], blocks: [] };
  }
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
  handleError(new Error(`Project not found: ${input}`));
}

/**
 * Read `--project` as a REFERENCE, tolerating commander's `--no-project` negation.
 *
 * Declaring `--no-project` alongside `--project <id>` makes commander store the
 * boolean `false` under the same `project` key. Every existing reader here does
 * `opts.project || globalOpts.project`, which coerces that `false` away
 * correctly — but only by accident. These two helpers make the distinction
 * explicit so a later edit cannot reintroduce a `false` leaking into a resolver
 * that expects a string.
 */
function projectRefFromOpts(opts: { project?: unknown }, globalOpts: { project?: unknown }): string | undefined {
  const own = typeof opts.project === "string" ? opts.project : undefined;
  const global = typeof globalOpts.project === "string" ? globalOpts.project : undefined;
  return own || global;
}

/** True only when the caller passed `--no-project`, i.e. the omission is deliberate. */
function projectOptOut(opts: { project?: unknown }): boolean {
  return opts.project === false;
}

/**
 * Warn when a task is about to be filed with no project.
 *
 * MEASURED 2026-08-03 on the hosted store: 578 of 3231 pending rows (17.9%) carry
 * project_id NULL, and 93 of the 283 created in the previous 24h (32.9%) — the
 * INFLOW is nearly double the stock. Such a row appears in no per-seat list and
 * no drain reaches it, including the censuses that measured the problem.
 *
 * This WARNS rather than rejects, deliberately. A third of live creations omit the
 * project, so rejecting would take the CLI every agent files work through offline
 * for a third of its traffic — worse than the condition it treats. The line names
 * BOTH remedies because a caller with genuinely no project needs a reachable
 * action, or it learns to scroll past the warning; `--no-project` mirrors the
 * `--unassigned` flag this same command already ships for the identical shape of
 * problem on the assignee field.
 *
 * One line, not two, for the reason the ownerless warning inside `add` gives: a
 * warning people scroll past is a warning that does not work. It goes to stderr,
 * so `--json` stdout stays machine-parseable — asserted in the regression test,
 * because every agent on the fleet parses that stdout.
 */
function warnMissingProject(resolvedProjectId: string | undefined, optedOut: boolean): void {
  if (resolvedProjectId || optedOut) return;
  console.error(chalk.yellow(
    "Warning: task filed with no project — it will not appear in any project list, per-seat report, or drain. " +
    "Pass --project <id-or-slug>, or --no-project if filing it globally is deliberate.",
  ));
}

/**
 * Validate and normalize a status value, rejecting unknowns before the DB does.
 *
 * Write flags take exactly one status, so a comma list is rejected rather than
 * silently reduced to its first element.
 */
function parseStatus(value: string | undefined): TaskStatus | undefined {
  if (!value) return undefined;
  return parseEnumFlagList(value, { ...TASK_STATUS_FLAG, allowList: false })?.[0];
}

/**
 * Ceiling on rows a single `todos list` will pull from a REMOTE authority.
 *
 * `GET /v1/tasks` applies no default limit (`src/server/routes.ts` passes
 * `limit: limitParam ? parseInt(limitParam, 10) : undefined`) and exposes no `sort`
 * parameter, so ordering cannot be delegated to the authority. A correct `--sort`
 * therefore needs the whole matching set — which is precisely the O(all-tasks)
 * download this repository has already paid for once, on a fleet with thousands of
 * open tasks.
 *
 * A ceiling resolves the two requirements that were treated as exclusive: the client
 * asks for a bounded page, and when that page comes back full it SAYS the result may
 * be drawn from a truncated scan rather than returning a plausible window in silence.
 *
 * 10,000 matches the bounded scan `handleExportTasks` already uses in
 * `src/server/routes.ts`, so this is the repository's existing convention rather than
 * a new number. `TODOS_LIST_SCAN_LIMIT` overrides it for a genuinely larger store.
 */
const DEFAULT_LIST_SCAN_LIMIT = 10_000;

/** Resolved scan ceiling; a malformed override falls back rather than sending NaN. */
function listScanLimit(): number {
  const raw = process.env["TODOS_LIST_SCAN_LIMIT"];
  if (raw === undefined || raw.trim() === "") return DEFAULT_LIST_SCAN_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_LIST_SCAN_LIMIT;
}

/** Parse an integer option, rejecting non-numeric input instead of storing NaN. */
function parseIntOption(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) {
    handleError(new Error(`${flag} must be a number`));
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
    handleError(new Error(`Could not resolve plan ID: ${input}`));
  }
  return id;
}

/**
 * Validate a priority value. The allowed list comes from `TASK_PRIORITIES`; it used
 * to be re-typed into the error string, so the message could drift from the real
 * vocabulary.
 */
function parsePriority(value: string | undefined): TaskPriority | undefined {
  if (!value) return undefined;
  return parseEnumFlagList(value, { ...TASK_PRIORITY_FLAG, allowList: false })?.[0];
}

function parseJsonObject(value: string | undefined, flag: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    handleError(new Error(`${flag} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    handleError(new Error(`${flag} must be a JSON object`));
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

interface ReparentOptions {
  projectRef?: string;
  listRef?: string;
  clearList?: boolean;
}

/** The subset of an update patch that re-parents a task. */
interface ReparentPatch {
  project_id?: string;
  task_list_id?: string | null;
}

/**
 * Compute the {project_id, task_list_id} patch that re-parents a task against the
 * remote /v1 authority. A `--to-list` reference is resolved inside the *target*
 * project (not the task's current one) so a cross-project move can name a list
 * that lives in the destination. Because task lists are project-scoped, changing
 * the project detaches the task from its old list unless a new one is named.
 */
async function computeCloudReparent(
  cloud: NonNullable<ReturnType<typeof getTodosCloudClient>>,
  current: { project_id: string | null },
  opts: ReparentOptions,
): Promise<ReparentPatch> {
  const targetProjectId = opts.projectRef ? await cloudResolveProjectRef(cloud, opts.projectRef) : undefined;
  const scope = targetProjectId ?? current.project_id ?? undefined;
  let taskListId: string | null | undefined;
  if (opts.listRef) taskListId = await cloudResolveTaskListRef(cloud, opts.listRef, scope);
  else if (opts.clearList) taskListId = null;
  else if (targetProjectId && targetProjectId !== current.project_id) taskListId = null;
  const patch: ReparentPatch = {};
  if (targetProjectId !== undefined) patch.project_id = targetProjectId;
  if (taskListId !== undefined) patch.task_list_id = taskListId;
  return patch;
}

/** Local-SQLite equivalent of {@link computeCloudReparent}. */
function computeLocalReparent(current: { project_id: string | null }, opts: ReparentOptions): ReparentPatch {
  const targetProjectId = opts.projectRef ? resolveProjectIdOrSlug(opts.projectRef) : undefined;
  const scope = targetProjectId ?? current.project_id ?? null;
  let taskListId: string | null | undefined;
  if (opts.listRef) {
    const resolved = resolveTaskListRef(opts.listRef, scope);
    if ("error" in resolved) {
      handleError(new Error(resolved.error));
    }
    taskListId = resolved.id;
  } else if (opts.clearList) {
    taskListId = null;
  } else if (targetProjectId && targetProjectId !== current.project_id) {
    taskListId = null;
  }
  const patch: ReparentPatch = {};
  if (targetProjectId !== undefined) patch.project_id = targetProjectId;
  if (taskListId !== undefined) patch.task_list_id = taskListId;
  return patch;
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
    .option("--no-project", "Deliberately file this task with no project (silences the orphan warning)")
    .option("--unassigned", "Deliberately file this task with no assignee")
    .option("--assign-seat", "Allow --assign to name a durable seat (a seat queue has no session watching it)")
    .option("--created-by <agent>", "Record a different filer than the resolved agent identity")
    .action(async (title: string, opts) => {
      const globalOpts = program.opts();
      opts.tags = opts.tags || opts.tag;
      opts.list = opts.list || opts.taskList;

      // Who is FILING this task. `todos init` now persists the identity, so a
      // registered session no longer has to re-supply --agent on every command —
      // that omission is why creator attribution was empty on 92% of rows.
      // `creator` may come from the identity file, which is keyed on $HOME and is
      // therefore shared by every agent session on the station — it names the box,
      // not the caller. It still supplies `created_by`, which is provenance and is
      // documented write-once.
      //
      // `router` is the narrower one, and the two ROUTING columns take it instead:
      // only `--agent` and TODOS_AGENT_ID, which travel with the process and cannot
      // be handed to two concurrent sessions by accident. Stamping the shared file
      // into `assigned_to` and `agent_id` is what queued one agent's work onto
      // another — 43+ rows on station01 on 2026-07-31, one of them this fix's own
      // tracking task.
      const creator = resolveCreatorIdentity(opts.createdBy || globalOpts.agent);
      const router = resolveWritableIdentity(opts.createdBy || globalOpts.agent);
      // Part 2: an unassigned task must be DELIBERATE. Left alone, `todos add`
      // produced an ownerless row silently, so the filer read "filed and
      // announced, therefore routed" while no seat was ever queued.
      // An EXPLICIT --assign is validated against the agent roster before it
      // reaches the store: unvalidated, it accepted a seat (= nobody), a name
      // no agent owns, and a name several agents share. See
      // `lib/assignee-validation.ts`.
      const requestedAssign = opts.assign
        ? await resolveValidatedAssignee(
            opts.assign,
            Boolean(opts.assignSeat),
            // `add` takes the assignee via the `--assign <agent>` FLAG.
            (v) => `--assign ${v} --assign-seat`,
          )
        : undefined;
      const assignee: string | undefined = requestedAssign || (opts.unassigned ? undefined : router.agent_id || undefined);
      if (!assignee && !opts.unassigned) {
        // One line, not two: this fires on every add from an unregistered caller,
        // and a warning people scroll past is a warning that does not work.
        console.error(chalk.yellow(
          "Warning: task is ownerless and unattributable — export TODOS_AGENT_ID=<name> for this session, or pass --agent/--assign <agent> or --unassigned.",
        ));
      }

      // http authority routing: create straight against <app-host>/v1.
      const cloud = getTodosCloudClient();
      if (cloud) {
        let task;
        try {
          const cloudProjectRef = projectRefFromOpts(opts, globalOpts);
          const cloudProjectId = cloudProjectRef
            ? await cloudResolveProjectRef(cloud, cloudProjectRef)
            : undefined;
          // This branch had no fallback at all while the local branch below falls
          // through to `autoProject`, and the fleet runs THIS one — every station
          // sets HASNA_TODOS_API_URL/_API_KEY/_STORAGE_MODE. So a create that
          // omitted --project stored NULL silently, which is the whole orphan
          // inflow. Deliberately still no git-root inference here: see the
          // working_dir note below for why that decision is not yet measurable.
          warnMissingProject(cloudProjectId, projectOptOut(opts));
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
            assigned_to: assignee,
            status: parseStatus(opts.status),
            task_list_id: cloudTaskListId,
            agent_id: globalOpts.agent || router.agent_id || undefined,
            created_by: creator.agent_id || undefined,
            session_id: globalOpts.session,
            project_id: cloudProjectId,
            // Parity with the local branch, which has always sent process.cwd().
            // Omitting it here is why 96.5% of orphans have working_dir NULL — and
            // why 91.1% of NON-orphans do too, since every cloud row lost it
            // regardless of project. cwd is the only signal that could justify
            // inferring a project later, so dropping it made that decision
            // unmeasurable on real traffic. This is what starts collecting it.
            working_dir: process.cwd(),
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
      const explicitProject = projectRefFromOpts(opts, globalOpts);
      const projectId = explicitProject
        ? resolveProjectIdOrSlug(explicitProject)
        : (projectOptOut(opts) ? undefined : autoProject(globalOpts));
      // autoProject can still return undefined — outside a git repo, under /tmp,
      // or with TODOS_AUTO_PROJECT=false — so the local branch produces orphans
      // too, just far less often than cloud did. Same warning, same opt-out.
      warnMissingProject(projectId, projectOptOut(opts));
      opts.tags = opts.tags || opts.tag;
      opts.list = opts.list || opts.taskList;
      const taskListId = opts.list ? (() => {
        const db = getDatabase();
        const id = resolvePartialId(db, "task_lists", opts.list);
        if (!id) {
          handleError(new Error(`Could not resolve task list ID: ${opts.list}`));
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
          assigned_to: assignee,
          status: parseStatus(opts.status),
          task_list_id: taskListId,
          agent_id: globalOpts.agent || router.agent_id || undefined,
          created_by: creator.agent_id || undefined,
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
    .option("--assign-seat", "Allow --assign to name a durable seat (a seat queue has no session watching it)")
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
      // Same validation as `add` and `update`: an upsert is a create path too,
      // and a loop-driven one, so an unvalidated assignee here mints the same
      // bad rows on every run rather than once.
      if (opts.assign) {
        opts.assign = await resolveValidatedAssignee(
          opts.assign,
          Boolean(opts.assignSeat),
          // `task upsert` also takes the assignee via the `--assign <agent>` FLAG.
          (v) => `--assign ${v} --assign-seat`,
        );
      }
      const explicitProject = opts.project || globalOpts.project;
      // http authority routing: dedupe-and-upsert on the SHARED dataset. The
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
          handleError(new Error(`Could not resolve task list ID: ${opts.list}`));
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
    .option("--created-by <agent>", "Filter by the agent who FILED the task")
    .option("--not-created-by <agent>", "Exclude tasks filed by this agent")
    .option("--inbox", "Work assigned to my identity that a DIFFERENT agent filed")
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
      // http authority routing: skip local-store detection and resolve explicit
      // project/list filters against the shared API before listing tasks.
      const cloud = getTodosCloudClient();
      const cloudProjectRef = globalOpts.project || opts.projectName;
      const projectId = cloud && cloudProjectRef
        ? await cloudResolveProjectRef(cloud, cloudProjectRef)
        : cloud
          ? undefined
          : autoProject(globalOpts);
      // --inbox is an assigned filter too. Omitting it here would auto-scope the
      // inbox to the cwd's project and silently hide work assigned to me elsewhere.
      const hasAssignedFilter = Boolean(opts.assigned || opts.agentName || opts.inbox);
      const hasExplicitProjectFilter = Boolean(globalOpts.project || opts.projectName);
      const allowedSortFields = new Set(["updated", "created", "priority", "status"]);
      if (opts.sort && !allowedSortFields.has(opts.sort)) {
        handleError(new Error(`Invalid --sort value: ${opts.sort}. Allowed values: updated, created, priority, status.`));
      }
      const allowedFormats = new Set(["table", "compact", "csv", "json"]);
      if (opts.format && !allowedFormats.has(opts.format)) {
        handleError(new Error(`Invalid --format value: ${opts.format}. Allowed values: table, compact, csv, json.`));
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
          handleError(new Error(`Could not resolve task list ID: ${opts.list}`));
        }
        filter["task_list_id"] = listId;
      }
      // A status/priority outside the vocabulary is rejected here, BEFORE it can
      // reach the store. Unvalidated it matched nothing and the command printed
      // "No tasks found." with exit 0, which reads as "there is no work" — the
      // defect that made `--status open` hide 27 real tasks. Same mechanism and
      // message shape as the `--sort`/`--format` checks above.
      //
      // The guard tests PRESENCE, not truthiness. `if (opts.status)` let an empty
      // string past the validator, and the two flags then failed differently and
      // silently: `--status ""` fell through to the default branch below and applied
      // `pending,in_progress` (measured: 2 rows on a 3-row fixture, byte-identical to
      // passing no flag, while `-a` returned 3), and `--priority ""` set no key at
      // all so that dimension went unfiltered. Both exit 0 with a plausible count.
      // `--status "$STATUS"` with the variable unset is how it arrives in practice.
      if (opts.status !== undefined) {
        filter["status"] = parseEnumFlag(opts.status, TASK_STATUS_FLAG);
      } else if (!opts.all) {
        filter["status"] = ["pending", "in_progress"];
      }
      // `--priority` accepts a comma list too: `TaskFilter.priority` is
      // `TaskPriority | TaskPriority[]`, but the raw string used to be forwarded
      // whole, so `--priority high,critical` matched a literal "high,critical".
      if (opts.priority !== undefined) filter["priority"] = parseEnumFlag(opts.priority, TASK_PRIORITY_FLAG);
      if (opts.assigned) filter["assigned_to"] = opts.assigned;
      // A hand-typed `--created-by Cassius` never goes through the identity resolver,
      // so canonicalise it here too. Both backends also compare case-insensitively —
      // this is the cheap half, that is the one that reaches rows written before the
      // resolver was canonicalising at all.
      if (opts.createdBy) filter["created_by"] = canonicalAgentRef(opts.createdBy);
      if (opts.notCreatedBy) filter["not_created_by"] = canonicalAgentRef(opts.notCreatedBy);
      // --inbox is the query operating rule 29 mandates and the store could not
      // answer until created_by existed: assigned to me, filed by someone else.
      if (opts.inbox) {
        const me = resolveCreatorIdentity(program.opts().agent);
        if (!me.agent_id) {
          console.error(chalk.red("--inbox needs an agent identity. Run `todos init <name>` or pass --agent <id>."));
          process.exit(1);
        }
        filter["assigned_to"] = me.agent_id;
        filter["not_created_by"] = me.agent_id;
      }
      if (opts.tags) filter["tags"] = opts.tags.split(",").map((t: string) => t.trim());
      if (opts.projectName && !cloud) {
        const { listProjects } = require("../../db/projects.js") as any;
        const projects = listProjects();
        const match = projects.find((p: any) => p.name.toLowerCase().includes(opts.projectName.toLowerCase()));
        if (match) {
          filter["project_id"] = match.id;
        } else {
          handleError(new Error(`No project matching: ${opts.projectName}`));
        }
      }
      if (opts.agentName) {
        filter["assigned_to"] = opts.agentName;
      }
      if (opts.recurring) filter["has_recurrence"] = true;
      if (opts.limit !== undefined) {
        const parsedLimit = Number.parseInt(String(opts.limit), 10);
        if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
          handleError(new Error(`Invalid --limit value: ${opts.limit}. Must be a positive integer.`));
        }
        filter["limit"] = parsedLimit;
      }

      const creatorFilterActive = Boolean(filter["created_by"] || filter["not_created_by"]);
      // A server that predates created_by IGNORES these query params and returns an
      // unfiltered list at 200 — measured against the deployed 0.13.0 API, which
      // drops created_by entirely. So the client must enforce the filter itself.
      //
      // But enforcing it AFTER the server applied `limit` reads a truncated page and
      // then shrinks it further: `--inbox --limit 20` could return 3 rows, or none,
      // while the real inbox was larger, with nothing to indicate it. So when the
      // creator filter is client-enforced, the limit is withheld from the request and
      // applied here instead — filter first, then truncate, which is the order the
      // SQL does it in.
      //
      // The same reasoning governs every other step that changes WHICH rows or in
      // WHAT ORDER after the query has run, so the rule is generalised rather than
      // special-cased per flag:
      //
      //   --sort            reorders. Storage orders by `priority_rank, created_at
      //                     DESC`, never by the requested field, so a limit applied
      //                     in storage draws the window from the WRONG ordering.
      //                     `--sort updated --limit 2` returned the 2 highest-
      //                     priority rows ordered by update time while reading as
      //                     "the 2 most recently updated" — the row actually
      //                     updated last was absent, at exit 0, with no indication.
      //   --due-today       narrow. Applied to a truncated page they shrink it
      //   --overdue         further, so `--overdue --limit 20` could return 3 while
      //                     the real overdue set was larger.
      //
      // In each case the limit is withheld from the query and applied last, below.
      // This is not a new cost: every one of these steps ALREADY reads the whole
      // matching set when no limit is given, so withholding the limit alongside one
      // of them fetches no more than the same command without `--limit` does.
      const requestedLimit = filter["limit"] as number | undefined;
      const reordersAfterQuery = Boolean(opts.sort);
      const narrowsAfterQuery = Boolean(opts.dueToday) || Boolean(opts.overdue) || (creatorFilterActive && cloud);
      const withholdLimit = requestedLimit !== undefined && (reordersAfterQuery || narrowsAfterQuery);

      // Withholding the caller's limit fixed the ordering defect and removed the only
      // BOUND on the request with it: `/v1/tasks` has no default limit, so `--sort
      // updated --limit 2` asked the authority for every matching row and materialised
      // it client-side. Measured against a recording stub: the outgoing query was
      // `status=pending,in_progress` with no limit, where the same command without
      // `--sort` sent `...&limit=2`. Silently discarding a caller's resource bound is
      // the same silent-success class this command exists to remove.
      //
      // So the limit is REPLACED rather than dropped. A scan ceiling is used instead of
      // the caller's own limit because a correct global sort genuinely needs more rows
      // than the caller asked to see, and the authority cannot sort — there is no
      // `sort` query param to delegate to. The ceiling is raised to the caller's limit
      // when that is larger, so `--limit 50000` is never answered with fewer rows than
      // it asked for.
      //
      // This also bounds the case that carried no limit at all (`todos list --sort
      // updated`), which was unbounded before this change and is the same download.
      // That is a deliberate widening of the fix: leaving it unbounded would have
      // repaired the symptom the review named while the mechanism stayed live.
      //
      // LOCAL is deliberately left unbounded. The cost being controlled here is a
      // network fetch of an entire shared task set; a local SQLite read of the same
      // rows is already what `--sort` does on any store, and capping it would trade
      // correctness for no meaningful saving.
      const scanCeiling = cloud && (withholdLimit || requestedLimit === undefined)
        ? Math.max(requestedLimit ?? 0, listScanLimit())
        : undefined;

      const serverFilter = (() => {
        const base = withholdLimit
          ? (() => { const { limit: _dropped, ...rest } = filter; return rest; })()
          : filter;
        return scanCeiling === undefined ? base : { ...base, limit: scanCeiling };
      })();

      let tasks = cloud ? await cloudListTasks(cloud, serverFilter as any) : listTasks(serverFilter as any);

      // A full page cannot be distinguished from a set that happens to end exactly at
      // the ceiling, so the ambiguous case warns too — the alternative is staying quiet
      // in precisely the case where the answer may be wrong. Sorting and narrowing
      // below then run over a set that is NOT the whole matching set, which is exactly
      // the "window drawn from the wrong rows" failure the ordering fix removed, so it
      // is reported rather than absorbed.
      if (scanCeiling !== undefined && tasks.length >= scanCeiling) {
        console.error(chalk.yellow(
          `Warning: this query reached its ${scanCeiling}-row scan limit, so the rows below were\n` +
          `         selected from a truncated set and may not be the true result.\n` +
          `         Narrow it (--project, --status, --assigned) or raise TODOS_LIST_SCAN_LIMIT.`,
        ));
      }
      if (cloud && creatorFilterActive) {
        // Enforcing the filter is not the same as the filter being USEFUL. A server
        // that predates created_by omits the key entirely, so every row reads as
        // unattributed and the filter — correctly, per the NULL rule below — excludes
        // nothing. Measured against the deployed 0.13.0 API: `--inbox` returned the
        // caller's own filing alongside everyone else's. Silently handing back an
        // unfiltered inbox is the failure this flag exists to prevent, so say so.
        // A row where the key is PRESENT and null is genuinely unattributed and is
        // not a server-capability problem — only a missing key indicates the latter.
        if (tasks.length > 0 && tasks.every((t) => !("created_by" in (t as object)))) {
          console.error(chalk.yellow(
            "Warning: this server does not record task authorship, so the creator filter matched nothing to exclude.\n" +
            "         Results are unfiltered. The API needs upgrading past the release that added created_by.",
          ));
        }
        const wantCreatedBy = filter["created_by"] as string | undefined;
        const excludeCreatedBy = filter["not_created_by"] as string | undefined;
        tasks = tasks.filter((t) => {
          const raw = (t as { created_by?: string | null }).created_by ?? null;
          // Case-insensitive, matching the SQL on both backends — a row stored before
          // write-time canonicalisation carries whatever case it was written with.
          const author = raw === null ? null : canonicalAgentRef(raw);
          if (wantCreatedBy && author !== canonicalAgentRef(wantCreatedBy)) return false;
          // NULL author is unattributable, not "someone else" — keep it.
          if (excludeCreatedBy && author !== null && author === canonicalAgentRef(excludeCreatedBy)) return false;
          return true;
        });
      }
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

      // The window is taken LAST, once the set and its order are final. When the
      // limit was left on the query this is a no-op — storage already truncated.
      if (withholdLimit && requestedLimit !== undefined) tasks = tasks.slice(0, requestedLimit);

      // `--assigned` fails open the same way an out-of-vocabulary status did, but
      // it is a REFERENCE rather than a closed vocabulary, so the remedy differs.
      //
      // An unresolvable assignee returns an empty set at exit 0, and "this agent
      // has no work" is then indistinguishable from "no agent by that name" — the
      // shape that has a coordinator stand down while holding real work. A typo is
      // likelier here than in a status, because agent names on this fleet are not
      // stable: the same seat has answered to different names, and duplicates exist
      // at different casings.
      //
      // This WARNS and never refuses, matching `lib/assignee-validation.ts`, which
      // deliberately admits an unregistered assignee on the write path because
      // routing work to an agent that registers later is legitimate. On the read
      // path the case for admitting it is stronger still: operating rule 21 has
      // agents release their identity at session end, so querying a past agent's
      // queue is ordinary and must keep working. Refusing would break more than it
      // fixes, and would be a worse regression than the defect.
      //
      // The roster is consulted ONLY when the result is empty — the sole case where
      // the answer is ambiguous — so a query that returns rows pays nothing, and no
      // request is added to the hot path. `loadAssigneeContext` is TTL-cached and
      // degrades silently when the roster cannot be fetched, in which case EVERY
      // name reads as unregistered and the warning is suppressed rather than
      // asserting something false about a name that may be perfectly valid.
      // Must name the reference the QUERY actually used, not the first one the caller
      // typed. `--agent-name` overwrites `filter.assigned_to` above, so with both flags
      // present `opts.assigned ?? opts.agentName` validated the value that was
      // discarded — reporting a name the empty result had nothing to do with, and
      // staying silent about a mistyped `--agent-name`. Precedence here mirrors the
      // assignment order above.
      const assignedFilter: string | undefined = opts.agentName ?? opts.assigned;
      if (assignedFilter && tasks.length === 0) {
        try {
          const roster = await loadAssigneeContext(
            () => (cloud ? cloudListAgents(cloud) : listAgents()),
            true,
          );
          if (!roster.degraded) {
            const target = canonicalAgentRef(assignedFilter);
            const known = roster.agents.some(
              (a) => canonicalAgentRef(a.name) === target || canonicalAgentRef(a.id) === target,
            );
            if (!known) {
              console.error(chalk.yellow(
                `Warning: no agent named '${assignedFilter}' is registered, so this empty result may be a\n` +
                `         mistyped name rather than an empty queue. Check with 'todos agents'.`,
              ));
            }
          }
        } catch {
          // Advisory only. A roster lookup must never turn a working list into a
          // failure, and the empty result below is still reported either way.
        }
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
        // The /v1 API returns the task row without relation graphs, so the
        // dependency edges are read separately and hydrated into task rows —
        // otherwise remote detail views claim a task has no dependencies while
        // `deps <id>` lists them (issue #58).
        const relations = remote ? await cloudDetailRelations(cloud, remote.id) : null;
        task = remote
          ? {
              subtasks: [], ...remote, tags: remote.tags ?? [],
              dependencies: relations!.dependencies,
              blocked_by: relations!.blocked_by,
              blocks: relations!.blocks,
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
        handleError(new Error(`Task not found: ${id}`));
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
      const showLock = lockDisplayState(task.locked_by, task.locked_at);
      if (showLock.held) console.log(`  ${chalk.dim("Locked:")}   ${showLock.holder} (at ${showLock.lockedAt})`);
      else if (showLock.expired) console.log(`  ${chalk.dim("Lock:")}     ${chalk.dim(formatExpiredLock(showLock))}`);
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

      if (task.blocks.length > 0) {
        console.log(chalk.bold(`\n  Blocks (${task.blocks.length}):`));
        for (const b of task.blocks) {
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
      if (!resolvedId) { handleError(new Error("No task ID given and no active task found. Pass an ID or use --agent.")); }

      let task: any;
      if (cloud) {
        const remote = await cloudGetTask(cloud, resolvedId);
        const commentPage = remote ? await cloudListComments(cloud, remote.id) : null;
        // The /v1 API returns the task row without relation graphs, so the
        // dependency edges are read separately and hydrated into task rows —
        // otherwise `inspect` never prints the BLOCKED warning for a remote
        // task whose upstream work is unfinished (issue #58).
        const relations = remote ? await cloudDetailRelations(cloud, remote.id) : null;
        task = remote
          ? {
              subtasks: [], checklist: [], ...remote, tags: remote.tags ?? [],
              dependencies: relations!.dependencies,
              blocked_by: relations!.blocked_by,
              blocks: relations!.blocks,
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
      if (!task) { handleError(new Error(`Task not found: ${id || resolvedId}`)); }

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
      const inspectLock = lockDisplayState(task.locked_by, task.locked_at);
      if (inspectLock.held) console.log(`  ${chalk.dim("Locked by:")} ${inspectLock.holder}`);
      else if (inspectLock.expired) console.log(`  ${chalk.dim("Lock:")}      ${chalk.dim(formatExpiredLock(inspectLock))}`);
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

      if (task.blocks.length > 0) {
        console.log(chalk.bold(`\n  Blocks (${task.blocks.length}):`));
        for (const b of task.blocks) console.log(`    ${formatTaskLine(b)}`);
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
      // http authority routing: read the SHARED audit trail. The local path read
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
    .option("--assign-seat", "Allow --assign to name a durable seat (a seat queue has no session watching it)")
    .option("--set-agent <agent>", "Repair the agent_id stamped on this row (use \"\" to clear it as unattributable)")
    .option("--tags <tags>", "New tags (comma-separated)")
    .option("--tag <tags>", "New tags (alias for --tags)")
    .option("--list <id>", "Move to a task list (UUID authoritative; project-scoped slug accepted)")
    .option("--task-list <id>", "Move to a task list (alias for --list)")
    .option("--clear-list", "Detach from its task list (reset task_list_id to null)")
    .option("--project <id>", "Re-parent the task to another project (by ID, slug, or path); see also `todos move`")
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
      // Reassignment is validated on the same terms as the initial assignment:
      // this is the path that quietly moved a task onto another session's live
      // agent at rc=0. See `lib/assignee-validation.ts`.
      if (opts.assign) {
        opts.assign = await resolveValidatedAssignee(
          opts.assign,
          Boolean(opts.assignSeat),
          // `update <id>` also takes the assignee via the `--assign <agent>` FLAG.
          (v) => `--assign ${v} --assign-seat`,
        );
      }

      // http authority routing: PATCH straight against <app-host>/v1.
      const cloud = getTodosCloudClient();
      if (cloud) {
        let task;
        try {
          const currentId = await resolveTaskIdForCommand(id, cloud);
          const current = await cloudGetTask(cloud, currentId);
          if (!current) throw new Error(`Task not found: ${id}`);
          const plan = opts.plan ? await cloudResolvePlan(cloud, opts.plan, current.project_id ?? undefined) : null;
          if (opts.plan && !plan) throw new Error(`Plan not found: ${opts.plan}`);
          const reparent = await computeCloudReparent(cloud, current, {
            projectRef: opts.project || globalOpts.project,
            listRef: opts.list,
            clearList: opts.clearList,
          });
          task = await cloudUpdateTask(cloud, currentId, {
            title: opts.title,
            description: opts.description,
            status: parseStatus(opts.status),
            priority: parsePriority(opts.priority),
            assigned_to: opts.assign,
            agent_id: opts.setAgent !== undefined ? (opts.setAgent === "" ? null : canonicalAgentRef(opts.setAgent)) : undefined,
            tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
            plan_id: plan?.id ?? (opts.clearPlan ? null : undefined),
            ...reparent,
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
        handleError(new Error(`Task not found: ${id}`));
      }
      const reparent = computeLocalReparent(current, {
        projectRef: opts.project || globalOpts.project,
        listRef: opts.list,
        clearList: opts.clearList,
      });
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
          agent_id: opts.setAgent !== undefined ? (opts.setAgent === "" ? null : canonicalAgentRef(opts.setAgent)) : undefined,
          tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
          plan_id: planId,
          ...reparent,
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

  // move — re-parent a task to another project/task-list while preserving its id + history
  program
    .command("move <id>")
    .description("Move a task to another project and/or task list (keeps its id and history)")
    .option("--to-project <id>", "Destination project (by ID, slug, or path)")
    .option("--to-list <id>", "Destination task list (UUID authoritative; slug resolved in the destination project)")
    .option("--clear-list", "Detach from its task list (reset task_list_id to null)")
    .action(async (id: string, opts) => {
      const globalOpts = program.opts();
      // `--to-project` is primary; fall back to the global `--project` so
      // `todos move <id> --project <ref>` also works.
      const projectRef: string | undefined = opts.toProject ?? globalOpts.project;
      const listRef: string | undefined = opts.toList;
      if (!projectRef && !listRef && !opts.clearList) {
        handleError(new Error("Nothing to move: pass --to-project, --to-list, or --clear-list."));
      }
      if (listRef && opts.clearList) {
        handleError(new Error("Use either --to-list or --clear-list, not both."));
      }

      const cloud = getTodosCloudClient();
      if (cloud) {
        let task;
        try {
          const currentId = await resolveTaskIdForCommand(id, cloud);
          const current = await cloudGetTask(cloud, currentId);
          if (!current) throw new Error(`Task not found: ${id}`);
          const reparent = await computeCloudReparent(cloud, current, {
            projectRef,
            listRef,
            clearList: opts.clearList,
          });
          if (reparent.project_id === undefined && reparent.task_list_id === undefined) {
            throw new Error("Nothing to move: the task is already in the requested project/list.");
          }
          task = await cloudUpdateTask(cloud, currentId, reparent as Record<string, unknown>);
        } catch (e) {
          handleError(e);
        }
        if (globalOpts.json) {
          output(task, true);
        } else {
          console.log(chalk.green("Task moved:"));
          console.log(formatTaskLine(task));
        }
        return;
      }

      const resolvedId = resolveTaskId(id);
      const current = getTask(resolvedId);
      if (!current) {
        handleError(new Error(`Task not found: ${id}`));
      }
      const reparent = computeLocalReparent(current, { projectRef, listRef, clearList: opts.clearList });
      if (reparent.project_id === undefined && reparent.task_list_id === undefined) {
        handleError(new Error("Nothing to move: the task is already in the requested project/list."));
      }
      let task;
      try {
        task = updateTask(resolvedId, { version: current.version, ...reparent });
      } catch (e) {
        handleError(e);
      }
      if (globalOpts.json) {
        output(task, true);
      } else {
        console.log(chalk.green("Task moved:"));
        console.log(formatTaskLine(task));
      }
    });

  // done
  program
    .command("done <id>")
    // `complete` mirrors the MCP `complete_task` verb, which the agent rule
    // corpus tells agents to use; without it they hit an unknown-command error.
    .alias("complete")
    .description("Mark a task as completed (alias: complete)")
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
          handleError(new Error("--confidence must be a number between 0.0 and 1.0"));
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
        const resolvedId = await resolveTaskIdForCommand(id, cloud);
        const agentId = resolveClaimIdentity("complete", globalOpts.agent);
        let task;
        try {
          task = await cloudCompleteTask(cloud, resolvedId, {
            agent_id: agentId,
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
      const agentId = resolveClaimIdentity("complete", globalOpts.agent);
      let task;
      try {
        task = completeTask(resolvedId, agentId, undefined, completionOptions);
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
        // http authority routing: resolve and approve the task on the SHARED
        // dataset. The local path read this machine's sqlite and 404'd
        // ("Task not found") a task that lives only in the cloud.
        const cloud = getTodosCloudClient();
        if (cloud) {
          const cloudId = await resolveTaskIdForCommand(id, cloud);
          const task = await cloudGetTask(cloud, cloudId);
          if (!task) { handleError(new Error(`Task not found: ${id}`)); }
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
        if (!task) { handleError(new Error(`Task not found: ${id}`)); }

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
      const cloud = getTodosCloudClient();
      let task;
      // The task REFERENCE is resolved before the claim identity, and the order is
      // load-bearing rather than incidental. An ambiguous short id must keep
      // failing closed with its candidate project IDs — the diagnostic every other
      // mutating verb reports — instead of being masked by an identity refusal.
      // Resolving identity first regressed exactly that case while `done`,
      // `update` and `comment` continued to report it, which is the kind of
      // silent inconsistency that makes a safety diagnostic untrustworthy.
      if (cloud) {
        const cloudResolvedId = await resolveTaskIdForCommand(id, cloud);
        const agentId = resolveClaimIdentity("start", globalOpts.agent);
        try {
          task = await cloudTaskAction(cloud, cloudResolvedId, "start", { agent_id: agentId });
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
      const agentId = resolveClaimIdentity("start", globalOpts.agent);
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
      const cloud = getTodosCloudClient();
      // Reference before identity, for the same reason as `start` above: an
      // ambiguous or unknown id must report its own error rather than an
      // identity refusal.
      const resolvedId = cloud ? await resolveTaskIdForCommand(id, cloud) : resolveTaskId(id);
      const agentId = resolveClaimIdentity("lock", globalOpts.agent);
      let result;
      try {
        // http authority routing: lock on the SHARED dataset so every agent
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
        handleError(new Error(`Lock failed: ${result.error}`));
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
      const agentId = resolveClaimIdentity("unlock", globalOpts.agent);
      try {
        if (cloud) await cloudUnlockTask(cloud, resolvedId, agentId);
        else unlockTask(resolvedId, agentId);
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
        handleError(new Error("Task not found."));
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
          handleError(new Error("Task not found."));
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
        handleError(new Error("Task not found."));
      }
    });

  // bulk
  program
    .command("bulk <action> <ids...>")
    .description("Bulk operation on multiple tasks (done, start, delete, plan/move-plan)")
    .option("--plan <id>", "Plan ID for the plan/move-plan action")
    .option("--clear-plan", "Remove plan assignment for the plan/move-plan action")
    .action(async (action: string, ids: string[], opts: { plan?: string; clearPlan?: boolean }) => {
      const globalOpts = program.opts();
      const results: { id: string; success: boolean; error?: string }[] = [];
      const cloud = getTodosCloudClient();
      const isPlanAction = action === "plan" || action === "move-plan";
      if (isPlanAction && Boolean(opts.plan) === Boolean(opts.clearPlan)) {
        handleError(new Error("Use exactly one of --plan or --clear-plan with bulk plan."));
      }
      const knownActions = new Set(["done", "complete", "start", "delete", "plan", "move-plan"]);
      if (!knownActions.has(action)) {
        handleError(new Error(`Unknown action: ${action}. Use: done, start, delete, plan (alias: move-plan)`));
      }
      // Resolved ONCE, before either loop: `bulk start` is still a claim, and a
      // missing identity is a property of the session rather than of any one row.
      // Refusing per-row would report N identical failures for a single cause —
      // and the per-id `catch` below turns exceptions into row results, so a
      // refusal raised inside it would be recorded as a partial success.
      const bulkClaimAgentId = action === "start" ? resolveClaimIdentity("start", globalOpts.agent) : undefined;

      // http authority routing: run each op against the SHARED dataset. The local
      // path resolved ids against this machine's sqlite — `bulk done` threw
      // "Task not found" for valid cloud task ids (while `bulk delete` silently
      // no-op'd), a split-brain read.
      if (cloud) {
        // Plan refs must resolve against the shared dataset too: the local
        // `resolvePlanId` reads this machine's sqlite, which is unavailable (and
        // wrong) under remote authority. Resolve once, up front, so an unknown
        // plan fails closed before any task is mutated — same contract as the
        // local path below.
        let cloudPlanId: string | null | undefined;
        if (isPlanAction) {
          if (opts.plan) {
            try {
              // Scope a non-UUID plan ref (slug/name) to `--project` when the
              // caller gave one, exactly like `add --plan`, so the same
              // reference resolves the same way across commands.
              const projectScope = globalOpts.project
                ? await cloudResolveProjectRef(cloud, globalOpts.project)
                : undefined;
              const plan = await cloudResolvePlan(cloud, opts.plan, projectScope);
              if (!plan) throw new Error(`Could not resolve plan ID: ${opts.plan}`);
              cloudPlanId = plan.id;
            } catch (e) {
              handleError(e);
            }
          } else {
            cloudPlanId = null;
          }
        }
        for (const rawId of ids) {
          try {
            const resolvedId = await resolveTaskIdForCommand(rawId, cloud);
            if (action === "done" || action === "complete") {
              await cloudCompleteTask(cloud, resolvedId, { ...(globalOpts.agent ? { agent_id: globalOpts.agent } : {}) });
            } else if (action === "start") {
              await cloudTaskAction(cloud, resolvedId, "start", { agent_id: bulkClaimAgentId! });
            } else if (action === "delete") {
              await cloudDeleteTask(cloud, resolvedId);
            } else {
              const current = await cloudGetTask(cloud, resolvedId);
              if (!current) throw new Error(`Task not found: ${rawId}`);
              await cloudUpdateTask(cloud, resolvedId, { version: current.version, plan_id: cloudPlanId });
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

      const planId = isPlanAction
        ? opts.plan ? resolvePlanId(opts.plan) : null
        : undefined;

      for (const rawId of ids) {
        try {
          const resolvedId = resolveTaskId(rawId);
          if (action === "done" || action === "complete") {
            completeTask(resolvedId, globalOpts.agent);
            results.push({ id: resolvedId, success: true });
          } else if (action === "start") {
            startTask(resolvedId, bulkClaimAgentId!);
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
            handleError(new Error(`Unknown action: ${action}. Use: done, start, delete, plan (alias: move-plan)`));
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
