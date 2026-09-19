import type { Command } from "commander";
import chalk from "chalk";
import { basename, resolve } from "node:path";
import { getDatabase, resolvePartialId } from "../../db/database.js";
import { ensureProject, getProject, getProjectByPath, slugify } from "../../db/projects.js";
import {
  createTask,
  countTasks,
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
  handoffStaleTaskLock,
} from "../../db/tasks.js";
import { getTaskList, getTaskListBySlug } from "../../db/task-lists.js";
import { decodeCommentCursor, pageComments } from "../../lib/comment-cursor.js";
import {
  getTodosCloudClient,
  cloudListTasks,
  cloudCountTasks,
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
  cloudHandoffStaleTaskLock,
  cloudTaskHistory,
  cloudUpsertTaskByFingerprint,
  cloudResolveProjectRef,
  cloudResolveTaskList,
  cloudResolveTaskListRef,
  cloudResolvePlan,
  cloudListAgents,
  cloudListTaskRefs,
} from "../cloud-router.js";
import type { CloudTaskGitRef, CloudTaskRelations } from "../cloud-router.js";
import type { Task, TaskPriority, TaskStatus } from "../../types/index.js";
import { canonicalAgentRef, resolveCreatorIdentity, resolveWritableIdentity } from "../../lib/creator-identity.js";
import { formatExpiredLock, lockDisplayState } from "../../lib/lock-display.js";
import { parseTagList, resolveBulkTags, resolveTagArgument } from "../../lib/bulk-tags.js";
import { resolveClaimIdentity } from "../claim-guard.js";
import { resolveValidatedAssignee } from "../assignee-guard.js";
import { loadAssigneeContext } from "../../lib/assignee-context.js";
import { describeAssigneeFilter } from "../../lib/assignee-validation.js";
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
import { normalizeExactTaskId } from "../../lib/stale-lock-handoff.js";

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

function printTaskCreatedReceipt(task: Task): void {
  console.log(chalk.green(`Task created: ${escapeTerminalControls(task.id)}`));
  console.log(formatTaskLine(task));
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
 * Git refs for a remote task's detail view.
 *
 * Ref-specific commands fail closed when the authority cannot prove the
 * contract. Task detail is broader than that optional projection, so preserve
 * the task and mark the ref population unverified with `null` instead of
 * misreporting an empty list or sinking `show`/`inspect` during a mixed-version
 * server rollout.
 */
async function cloudDetailGitRefs(
  cloud: Parameters<typeof cloudListTaskRefs>[0],
  id: string,
): Promise<CloudTaskGitRef[] | null> {
  try {
    return await cloudListTaskRefs(cloud, id);
  } catch (e) {
    console.error(chalk.dim(`Warning: could not verify task git refs: ${e instanceof Error ? e.message : String(e)}`));
    return null;
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
 * Warn from the task the owning authority actually persisted.
 *
 * The HTTP authority may supply creator attribution from its authenticated
 * principal even when the CLI process has no writable identity. Evaluating this
 * before create therefore made stderr claim `created_by` would be null while the
 * authoritative returned task — and JSON stdout in the same invocation — said
 * `created_by: "fleet"`.
 *
 * Owner and author are independent: an authority-attributed task can still be
 * ownerless, while an explicitly assigned or deliberately unassigned task can
 * still be unattributable. Keep each warning accurate to the returned row.
 */
function warnTaskRouting(
  task: Pick<Task, "assigned_to" | "created_by">,
  deliberatelyUnassigned: boolean,
): void {
  const ownerless = !task.assigned_to && !deliberatelyUnassigned;
  const unattributable = !task.created_by;
  if (ownerless && unattributable) {
    console.error(chalk.yellow(
      "Warning: task is ownerless and unattributable — export TODOS_AGENT_ID=<name> for this session, or pass --agent/--assign <agent> or --unassigned.",
    ));
    return;
  }
  if (ownerless) {
    console.error(chalk.yellow(
      "Warning: task is ownerless — export TODOS_AGENT_ID=<name> for this session, or pass --agent/--assign <agent> or --unassigned.",
    ));
    return;
  }
  if (unattributable) {
    console.error(chalk.yellow(
      "Warning: task is unattributable — created_by will be recorded as null. Export TODOS_AGENT_ID=<name> for this session, or pass --agent <agent>, to record who filed it.",
    ));
  }
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

/** Default bounded page for `todos list`; omission must never become exhaustion. */
const DEFAULT_LIST_PAGE_LIMIT = 50;
const MAX_LIST_PAGE_LIMIT = 50;
const LIST_EXHAUST_PAGE_SIZE = 500;
const MAX_LIST_ALL_ROWS = 5_000;
const MAX_LIST_PAGE_BYTES = 65_536;
const MAX_LIST_ALL_BYTES = 1_048_576;

interface CloudTaskPageOptions {
  limit: number;
  offset: number;
  cursor?: string;
  snapshot?: string;
}

interface AuthorityTaskPage {
  tasks: Task[];
  count: number;
  total: number | null;
  requested_limit: number;
  limit: number;
  server_cap: number | null;
  offset: number;
  consumed: number;
  has_more: boolean | null;
  next_offset: number | null;
  next_cursor: string | null;
  snapshot: string | null;
  complete: boolean | null;
  composed: boolean;
}

interface TaskListPageEnvelope extends Omit<AuthorityTaskPage, "tasks"> {
  tasks: Task[];
  all: boolean;
  byte_limited: boolean;
  max_bytes: number;
  byte_length: number;
}

function positiveSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function nonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Serialize with an exact self-reported byte length (the digit count can change once). */
function serializeTaskListEnvelope(envelope: TaskListPageEnvelope): string {
  let text = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    text = `${JSON.stringify(envelope, null, 2)}\n`;
    const length = Buffer.byteLength(text);
    if (envelope.byte_length === length) return text;
    envelope.byte_length = length;
  }
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

function compactTaskListLine(task: Task): string {
  const id = task.short_id || task.id.slice(0, 8);
  const assigned = task.assigned_to ? ` ${escapeTerminalControls(task.assigned_to)}` : "";
  return `${escapeTerminalControls(id)} ${task.status} ${task.priority} ${escapeTerminalControls(task.title)}${assigned}`;
}

function cloudTaskListQuery(
  filter: Record<string, unknown>,
  options: CloudTaskPageOptions,
): Record<string, string | number> {
  const query: Record<string, string | number> = { limit: options.limit };
  if (!options.cursor) query["offset"] = options.offset;
  if (options.cursor) query["cursor"] = options.cursor;
  if (options.snapshot) query["snapshot"] = options.snapshot;
  const status = filter["status"];
  if (status !== undefined) query["status"] = Array.isArray(status) ? status.join(",") : String(status);
  const priority = filter["priority"];
  if (priority !== undefined) query["priority"] = Array.isArray(priority) ? priority.join(",") : String(priority);
  for (const key of ["project_id", "task_list_id", "assigned_to", "created_by", "not_created_by"] as const) {
    const value = filter[key];
    if (typeof value === "string") query[key] = value;
  }
  const tags = filter["tags"];
  if (Array.isArray(tags) && tags.length > 0) query["tags"] = tags.join(",");
  return query;
}

function parseAuthorityTaskPage(
  raw: unknown,
  fallback: Task[],
  requestedLimit: number,
  requestedOffset: number,
): AuthorityTaskPage {
  const envelope = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const tasks = Array.isArray(envelope["tasks"]) ? envelope["tasks"] as Task[] : fallback;
  const total = nonNegativeSafeInteger(envelope["total"]);
  const serverLimit = positiveSafeInteger(envelope["limit"]);
  const serverCap = positiveSafeInteger(envelope["cap"]);
  const limit = serverLimit ?? serverCap ?? requestedLimit;
  const offset = nonNegativeSafeInteger(envelope["offset"]) ?? requestedOffset;
  const consumed = tasks.length;
  const rawHasMore = envelope["has_more"];
  const hasMore = typeof rawHasMore === "boolean"
    ? rawHasMore
    : total !== null
      ? offset + consumed < total
      : null;
  const rawNextOffset = nonNegativeSafeInteger(envelope["next_offset"]);
  const nextOffset = rawNextOffset !== null
    ? rawNextOffset
    : hasMore === false
      ? null
      : consumed > 0
        ? offset + consumed
        : null;
  const nextCursor = typeof envelope["next_cursor"] === "string" && envelope["next_cursor"]
    ? envelope["next_cursor"]
    : null;
  const snapshot = typeof envelope["snapshot"] === "string" && envelope["snapshot"]
    ? envelope["snapshot"]
    : null;
  const rawComplete = envelope["complete"];
  const complete = typeof rawComplete === "boolean"
    ? rawComplete
    : total !== null && hasMore !== null
      ? !hasMore
      : null;
  return {
    tasks,
    count: consumed,
    total,
    requested_limit: requestedLimit,
    limit,
    server_cap: serverCap ?? (serverLimit !== null && serverLimit < requestedLimit ? serverLimit : null),
    offset,
    consumed,
    has_more: hasMore,
    next_offset: nextOffset,
    next_cursor: nextCursor,
    snapshot,
    complete,
    composed: false,
  };
}

function compareTaskListOrder(a: Task, b: Task): number {
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4)
    || String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
    || a.id.localeCompare(b.id);
}

const taskListTagsCapabilityCache = new Map<string, Promise<boolean>>();

async function requireTaskListTagsCapability(
  cloud: NonNullable<ReturnType<typeof getTodosCloudClient>>,
): Promise<void> {
  let capability = taskListTagsCapabilityCache.get(cloud.baseUrl);
  if (!capability) {
    capability = cloud.transport.get<unknown>("/openapi.json").then((document) => {
      const paths = document && typeof document === "object" && !Array.isArray(document)
        ? (document as Record<string, unknown>)["paths"]
        : null;
      const tasksPath = paths && typeof paths === "object" && !Array.isArray(paths)
        ? (paths as Record<string, unknown>)["/v1/tasks"]
        : null;
      const get = tasksPath && typeof tasksPath === "object" && !Array.isArray(tasksPath)
        ? (tasksPath as Record<string, unknown>)["get"]
        : null;
      const parameters = get && typeof get === "object" && !Array.isArray(get)
        ? (get as Record<string, unknown>)["parameters"]
        : null;
      return Array.isArray(parameters) && parameters.some((parameter) =>
        parameter && typeof parameter === "object" &&
        (parameter as Record<string, unknown>)["name"] === "tags");
    });
    taskListTagsCapabilityCache.set(cloud.baseUrl, capability);
  }
  if (!(await capability)) {
    throw new Error(
      `REMOTE_TAGS_FILTER_UNSUPPORTED: configured Todos authority ${cloud.baseUrl} does not advertise the tags ` +
      "query param on GET /v1/tasks; no unfiltered task read was issued",
    );
  }
}

async function requestCloudTaskPage(
  cloud: NonNullable<ReturnType<typeof getTodosCloudClient>>,
  filter: Record<string, unknown>,
  options: CloudTaskPageOptions,
): Promise<AuthorityTaskPage> {
  if (Array.isArray(filter["tags"]) && filter["tags"].length > 0) await requireTaskListTagsCapability(cloud);
  const result = await cloud.list<Task>("tasks", { query: cloudTaskListQuery(filter, options) });
  return parseAuthorityTaskPage(result.raw, result.items, options.limit, options.offset);
}

/**
 * Current authorities understand comma-separated status filters in one snapshot.
 * A predecessor returned an empty 200 response for that query, so only that empty
 * shape falls back to scalar pages. Independent scalar responses can never prove a
 * shared snapshot; `complete` therefore stays unknown, and duplicate totals are
 * deduped only when every scalar page is itself complete.
 */
async function requestCloudTaskSelection(
  cloud: NonNullable<ReturnType<typeof getTodosCloudClient>>,
  filter: Record<string, unknown>,
  options: CloudTaskPageOptions,
): Promise<AuthorityTaskPage> {
  const statuses = Array.isArray(filter["status"]) ? filter["status"] as string[] : null;
  if (!statuses || statuses.length <= 1 || options.cursor) {
    return requestCloudTaskPage(cloud, filter, options);
  }
  if (statuses.length === 0) {
    const { status: _status, ...rest } = filter;
    return requestCloudTaskPage(cloud, rest, options);
  }
  const combined = await requestCloudTaskPage(cloud, filter, options);
  if (combined.tasks.length > 0 || (combined.total !== null && combined.total > 0)) return combined;

  const { status: _status, ...rest } = filter;
  const windowEnd = options.offset + options.limit;
  const pages = await Promise.all(statuses.map((status) =>
    requestCloudTaskPage(cloud, { ...rest, status }, { limit: windowEnd, offset: 0 })));
  const seen = new Set<string>();
  let duplicate = false;
  const union = pages.flatMap((page) => page.tasks).filter((task) => {
    if (seen.has(task.id)) { duplicate = true; return false; }
    seen.add(task.id);
    return true;
  });
  union.sort(compareTaskListOrder);
  const tasks = union.slice(options.offset, windowEnd);
  const totalsKnown = pages.every((page) => page.total !== null);
  const pagesComplete = pages.every((page) => page.complete === true);
  const total = totalsKnown
    ? duplicate
      ? pagesComplete ? union.length : null
      : pages.reduce((sum, page) => sum + (page.total ?? 0), 0)
    : null;
  const hasMore = total !== null
    ? options.offset + tasks.length < total
    : pages.some((page) => page.has_more === true)
      ? true
      : null;
  return {
    tasks,
    count: tasks.length,
    total,
    requested_limit: options.limit,
    limit: options.limit,
    server_cap: null,
    offset: options.offset,
    consumed: tasks.length,
    has_more: hasMore,
    next_offset: hasMore === false ? null : tasks.length > 0 ? options.offset + tasks.length : null,
    next_cursor: null,
    snapshot: null,
    complete: null,
    composed: true,
  };
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

/**
 * Comment paging for `show`/`inspect`.
 *
 * The detail payload has always carried `comments_page.next_cursor` alongside
 * `pagination_supported: true`, and nothing could spend that cursor — so every
 * comment older than the newest page was unreachable from the CLI (measured on
 * a 125-comment task where 25 comments could not be read by any verb). These
 * flags are that missing consumer.
 *
 * Ordering, measured rather than assumed: a page is the NEWEST `limit` comments
 * in ASCENDING display order, so the newest comment is the LAST element and is
 * reachable with no flags at all. `--comments-cursor` walks toward OLDER pages.
 */
const DEFAULT_CLI_COMMENT_PAGE = 100;
const MAX_CLI_COMMENT_PAGE = 500;

interface CommentPageFlags {
  commentsLimit?: string;
  commentsCursor?: string;
}

interface ResolvedCommentPage {
  /** Passed straight to the cloud reader; empty when no flag was given. */
  request: { limit?: number; cursor?: string };
  /** True when the caller asked for a page, so local output gains comments_page. */
  requested: boolean;
  limit: number;
  before?: { created_at: string; id: string };
}

function commentPageOptions(opts: CommentPageFlags): ResolvedCommentPage {
  const requested = opts.commentsLimit !== undefined || opts.commentsCursor !== undefined;
  let limit = DEFAULT_CLI_COMMENT_PAGE;
  if (opts.commentsLimit !== undefined) {
    const parsed = Number(opts.commentsLimit);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_CLI_COMMENT_PAGE) {
      handleError(new Error(`--comments-limit must be an integer between 1 and ${MAX_CLI_COMMENT_PAGE}`));
    }
    limit = parsed;
  }
  let before: { created_at: string; id: string } | undefined;
  if (opts.commentsCursor !== undefined) {
    try {
      before = decodeCommentCursor(opts.commentsCursor);
    } catch {
      handleError(new Error(
        "--comments-cursor is not a valid comment cursor; pass the value from comments_page.next_cursor",
      ));
    }
  }
  return {
    request: {
      ...(opts.commentsLimit !== undefined ? { limit } : {}),
      ...(opts.commentsCursor !== undefined ? { cursor: opts.commentsCursor } : {}),
    },
    requested,
    limit,
    ...(before ? { before } : {}),
  };
}

/**
 * Apply the same bounded page to a local (SQLite) task read. Without a flag the
 * local shape is left exactly as it was — the complete history and no
 * `comments_page` — so existing local consumers see no change.
 */
function applyLocalCommentPage<T extends { comments: Array<{ id: string; created_at: string }> } | null>(
  task: T,
  page: ResolvedCommentPage,
): T {
  if (!task || !page.requested) return task;
  const paged = pageComments(task.comments, {
    limit: page.limit,
    ...(page.before ? { before: page.before } : {}),
  });
  return {
    ...task,
    comments: paged.comments,
    comments_page: {
      count: paged.count,
      limit: paged.limit,
      has_more: paged.has_more,
      next_cursor: paged.next_cursor,
      pagination_supported: true,
    },
  };
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
  parentRef?: string;
  clearParent?: boolean;
}

/** The subset of an update patch that re-parents a task. */
interface ReparentPatch {
  project_id?: string;
  task_list_id?: string | null;
  parent_id?: string | null;
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
  const parentId = opts.parentRef
    ? await resolveTaskIdForCommand(opts.parentRef, cloud)
    : opts.clearParent
      ? null
      : undefined;
  const scope = targetProjectId ?? current.project_id ?? undefined;
  let taskListId: string | null | undefined;
  if (opts.listRef) taskListId = await cloudResolveTaskListRef(cloud, opts.listRef, scope);
  else if (opts.clearList) taskListId = null;
  else if (targetProjectId && targetProjectId !== current.project_id) taskListId = null;
  const patch: ReparentPatch = {};
  if (targetProjectId !== undefined) patch.project_id = targetProjectId;
  if (taskListId !== undefined) patch.task_list_id = taskListId;
  if (parentId !== undefined) patch.parent_id = parentId;
  return patch;
}

/**
 * Apply a remote task update and prove that its re-parent fields persisted.
 *
 * A PATCH response is an acknowledgement, not authoritative storage evidence:
 * an older/mismatched authority can return 200 while retaining the previous
 * task_list_id. Both `move` and `update` use this gate so neither JSON nor human
 * output reports success from that stale response. Verification is deliberately
 * limited to the relationship fields this command owns.
 */
async function cloudUpdateTaskWithVerifiedReparent(
  cloud: NonNullable<ReturnType<typeof getTodosCloudClient>>,
  taskId: string,
  updatePatch: Record<string, unknown>,
  reparent: ReparentPatch,
): Promise<Task> {
  const acknowledged = await cloudUpdateTask(cloud, taskId, updatePatch);
  if (
    reparent.project_id === undefined
    && reparent.task_list_id === undefined
    && reparent.parent_id === undefined
  ) {
    return acknowledged;
  }

  const persisted = await cloudGetTask(cloud, taskId);
  if (!persisted) {
    throw new Error(
      `TASK_REPARENT_PERSISTENCE_UNVERIFIED: PATCH /v1/tasks/${taskId} was acknowledged, ` +
      "but the authoritative read-back did not return the task.",
    );
  }

  const mismatches: string[] = [];
  if (reparent.project_id !== undefined && persisted.project_id !== reparent.project_id) {
    mismatches.push(`project_id expected ${reparent.project_id}, received ${persisted.project_id ?? "null"}`);
  }
  if (
    reparent.task_list_id !== undefined &&
    (persisted.task_list_id ?? null) !== reparent.task_list_id
  ) {
    mismatches.push(
      `task_list_id expected ${reparent.task_list_id ?? "null"}, received ${persisted.task_list_id ?? "null"}`,
    );
  }
  if (
    reparent.parent_id !== undefined
    && (persisted.parent_id ?? null) !== reparent.parent_id
  ) {
    mismatches.push(
      `parent_id expected ${reparent.parent_id ?? "null"}, received ${persisted.parent_id ?? "null"}`,
    );
  }
  if (mismatches.length > 0) {
    throw new Error(
      `TASK_REPARENT_PERSISTENCE_UNVERIFIED: PATCH /v1/tasks/${taskId} was acknowledged, ` +
      `but authoritative read-back disagreed (${mismatches.join("; ")}).`,
    );
  }

  return persisted;
}

/** Local-SQLite equivalent of {@link computeCloudReparent}. */
function computeLocalReparent(current: { project_id: string | null }, opts: ReparentOptions): ReparentPatch {
  const targetProjectId = opts.projectRef ? resolveProjectIdOrSlug(opts.projectRef) : undefined;
  const parentId = opts.parentRef
    ? resolveTaskId(opts.parentRef)
    : opts.clearParent
      ? null
      : undefined;
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
  if (parentId !== undefined) patch.parent_id = parentId;
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
      //
      // `router` is the ONLY identity this command writes anywhere, into BOTH
      // created_by and the two ROUTING columns (assigned_to, agent_id): only
      // `--agent`/`--created-by` and TODOS_AGENT_ID, which travel with the
      // process and cannot be handed to two concurrent sessions by accident.
      //
      // created_by used to take the wider `resolveCreatorIdentity` instead —
      // the identity file, which is keyed on $HOME and shared by every agent
      // session on the station, so it names the box, not the caller — on the
      // theory that provenance is lower-stakes than routing and a station-wide
      // guess was better than none. That theory is falsified: measured live on
      // station01 2026-08-03/04, `todos list --created-by <name> --json`
      // returned 489 rows a different agent had actually filed (todos task
      // 9090972e). A wrong created_by is exactly the "believed name" #142
      // already refused for assigned_to/agent_id — stamping the shared file
      // into `assigned_to` and `agent_id` is what queued one agent's work onto
      // another, 43+ rows on station01 on 2026-07-31. created_by now gets the
      // same treatment: unattributable (null) rather than a plausible guess.
      //
      // `resolveCreatorIdentity` stays available for DISPLAY (the --inbox
      // filter below reads it to show what is on disk) — it must just never be
      // WRITTEN into a task, which is the whole point of `isProcessBoundSource`
      // in lib/creator-identity.ts.
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
          // sets HASNA_TODOS_API_URL + HASNA_TODOS_API_KEY. So a create that
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
          const taskInput = {
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
            created_by: router.agent_id || undefined,
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
          };
          task = await cloudCreateTask(
            cloud,
            taskInput,
            opts.createdBy && router.agent_id
              ? { expectedCreatedBy: router.agent_id }
              : undefined,
          );
        } catch (e) {
          handleError(e);
        }
        warnTaskRouting(task, Boolean(opts.unassigned));
        if (globalOpts.json) {
          output(task, true);
        } else {
          printTaskCreatedReceipt(task);
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
          created_by: router.agent_id || undefined,
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

      warnTaskRouting(task, Boolean(opts.unassigned));
      if (globalOpts.json) {
        output(task, true);
      } else {
        printTaskCreatedReceipt(task);
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
    .option("--plan <id>", "Assign to a plan")
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
          const plan = opts.plan
            ? await cloudResolvePlan(cloud, opts.plan, projectId)
            : null;
          if (opts.plan && !plan) {
            throw new Error(`Could not resolve plan ID or slug: ${opts.plan}`);
          }
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
            plan_id: plan?.id,
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
      const planId = opts.plan ? resolvePlanId(opts.plan) : undefined;
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
          plan_id: planId,
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
    .option("--limit <n>", `Max tasks to return (default ${DEFAULT_LIST_PAGE_LIMIT}; >${MAX_LIST_PAGE_LIMIT} requires --all)`)
    .option("--offset <n>", "Skip this many matching tasks; continue from next_offset")
    .option("--cursor <cursor>", "Opaque authority cursor from next_cursor; preferred when available")
    .action(async (opts) => {
      const globalOpts = program.opts();
      // Fail closed on an EMPTY project filter value (I38-00523): an
      // explicitly supplied `--project ""` / `--project-name ""` used to be
      // falsy and silently dropped, returning the FULL population with rc=0.
      // An empty filter is a usage error, not a "no filter" signal.
      if (typeof globalOpts.project === "string" && globalOpts.project.trim() === "") {
        handleError(new Error("--project requires a non-empty project reference (id, path, slug, or name)"));
      }
      if (typeof opts.projectName === "string" && opts.projectName.trim() === "") {
        handleError(new Error("--project-name requires a non-empty project name"));
      }
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
      // This answers "did the caller ask to scope by assignee at all", which is needed
      // before `--inbox` can resolve an identity below, so it necessarily reads `opts`
      // rather than the resolved `assignedFilter`. It uses the same truthiness rule as
      // the resolution, so the two agree on every combination, empty strings included.
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
        const resolvedTaskList = await cloudResolveTaskList(cloud, opts.list, projectId);
        filter["task_list_id"] = resolvedTaskList.id;
        // A legacy authority may ignore task_list_id while still honoring
        // project_id. Preserve the resolved list's owning project as a bounded
        // compatibility scope, then enforce the exact list locally. An explicit
        // project was already passed into the resolver and any mismatch failed
        // before this command can issue a task read.
        if (!projectId && resolvedTaskList.project_id) {
          filter["project_id"] = resolvedTaskList.project_id;
        }
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
      // THREE flags write `assigned_to`, in sequence: `--assigned`, then `--inbox`,
      // then `--agent-name`. They are resolved ONCE, here, into a single value that
      // the query and the warning at the foot of this action both read. Deriving the
      // warning's own answer from `opts` a second time is what let the two disagree
      // about what had been asked, and when they disagreed the warning won the
      // operator's attention while the query won the result.
      //
      // `assignedWasTyped` records whether the surviving reference is one the OPERATOR
      // typed. `--inbox` substitutes an identity from the resolver, which cannot be
      // mistyped and which the caller never spelled, so the "did you mean another
      // name" warning has nothing to say about it. Both variables are written at the
      // same site as the value, so neither can drift from it.
      let assignedFilter: string | undefined;
      let assignedWasTyped = false;
      if (opts.assigned) {
        assignedFilter = opts.assigned;
        assignedWasTyped = true;
      }
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
        assignedFilter = me.agent_id;
        assignedWasTyped = false;
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
        assignedFilter = opts.agentName;
        assignedWasTyped = true;
      }
      // The only write of this key. `--assigned ""` and `--agent-name ""` are falsy
      // above and so leave the dimension unfiltered — the warning below reads the same
      // variable and therefore reports on exactly that, rather than on a value the
      // query dropped.
      if (assignedFilter !== undefined) filter["assigned_to"] = assignedFilter;

      // Start the roster fetch HERE rather than at the warning site below, so it
      // overlaps the task query instead of adding to it.
      //
      // This is a cost decision backed by measurement, not a style preference.
      // On station01, 2026-08-07, against the cloud store: the roster is 825,714
      // bytes and takes 2.58-3.62s, while `list --assigned` itself takes
      // 3.27-4.57s. Awaiting the roster serially after the query would very
      // nearly DOUBLE the wall time of the single most-run command on this fleet
      // — every agent finds its work with `todos list --assigned <me>`. Kicked
      // off here it is already resolved (or nearly) by the time the query
      // returns, so the added latency is ~0 and the added cost is one request on
      // exactly the calls that need it.
      //
      // Gated on `assignedWasTyped` for the same reason the warnings are: a bare
      // `todos list` and the identity `--inbox` resolves never needed a roster,
      // and must not start paying for one.
      //
      // The `.catch` is attached IMMEDIATELY and not left to the await below:
      // an unawaited rejection between here and there is an unhandled rejection,
      // which on Bun is fatal. Degrading to an empty roster is the same failure
      // mode `loadAssigneeContext` already defines, and it suppresses both
      // warnings rather than emitting a false one.
      const rosterPromise = assignedWasTyped && assignedFilter
        ? loadAssigneeContext(() => (cloud ? cloudListAgents(cloud) : listAgents()), true)
            .catch(() => ({ agents: [], seats: new Set<string>(), allowSeat: true, degraded: true }))
        : undefined;
      if (opts.recurring) filter["has_recurrence"] = true;

      let explicitLimit: number | undefined;
      if (opts.limit !== undefined) {
        const parsed = Number.parseInt(String(opts.limit), 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          handleError(new Error(`Invalid --limit value: ${opts.limit}. Must be a positive integer.`));
        }
        explicitLimit = parsed;
      }
      if (explicitLimit !== undefined && (!Number.isSafeInteger(explicitLimit) || explicitLimit < 1)) {
        handleError(new Error("--limit must be a positive safe integer"));
      }
      if (!opts.all && explicitLimit !== undefined && explicitLimit > MAX_LIST_PAGE_LIMIT) {
        handleError(new Error(
          `--limit above ${MAX_LIST_PAGE_LIMIT} requires explicit --all; use --offset/next_offset for token-efficient pages`,
        ));
      }
      if (explicitLimit !== undefined && explicitLimit > MAX_LIST_ALL_ROWS) {
        handleError(new Error(`--limit cannot exceed the ${MAX_LIST_ALL_ROWS}-row hard ceiling`));
      }
      if (opts.cursor !== undefined && opts.offset !== undefined) {
        handleError(new Error("Pass --cursor or --offset, not both"));
      }
      if (opts.cursor !== undefined && (typeof opts.cursor !== "string" || !opts.cursor || opts.cursor.length > 1_024)) {
        handleError(new Error("--cursor must be a non-empty authority cursor of at most 1024 characters"));
      }
      const requestedOffset = parseIntOption(opts.offset, "--offset") ?? 0;
      if (!Number.isSafeInteger(requestedOffset) || requestedOffset < 0) {
        handleError(new Error("--offset must be a non-negative safe integer"));
      }
      const requestedLimit = explicitLimit ?? DEFAULT_LIST_PAGE_LIMIT;
      const exhaustAll = Boolean(
        opts.all && explicitLimit === undefined && opts.offset === undefined && opts.cursor === undefined,
      );
      const exhaustForTransform = Boolean(
        opts.all && opts.offset === undefined && opts.cursor === undefined &&
        (opts.sort || opts.dueToday || opts.overdue),
      );
      const readWholeSet = exhaustAll || exhaustForTransform;
      const creatorFilterActive = Boolean(filter["created_by"] || filter["not_created_by"]);
      const taskListFilterActive = Boolean(cloud && filter["task_list_id"]);
      const baseFilter = { ...filter };

      let page: AuthorityTaskPage;
      let directCloudPageRequest: CloudTaskPageOptions | null = null;
      if (cloud) {
        if (!readWholeSet) {
          directCloudPageRequest = {
            limit: requestedLimit,
            offset: requestedOffset,
            ...(opts.cursor ? { cursor: opts.cursor } : {}),
          };
          page = await requestCloudTaskSelection(cloud, baseFilter, directCloudPageRequest);
        } else {
          const collected: Task[] = [];
          const seen = new Set<string>();
          const totals = new Set<number>();
          const snapshots = new Set<string>();
          let snapshotPages = 0;
          let currentOffset = 0;
          let currentCursor: string | undefined;
          let last: AuthorityTaskPage | null = null;
          let pageCount = 0;
          while (true) {
            const current = await requestCloudTaskSelection(cloud, baseFilter, {
              limit: LIST_EXHAUST_PAGE_SIZE,
              offset: currentOffset,
              ...(currentCursor ? { cursor: currentCursor } : {}),
            });
            pageCount++;
            last = current;
            if (current.total !== null) totals.add(current.total);
            if (current.snapshot) { snapshots.add(current.snapshot); snapshotPages++; }
            for (const task of current.tasks) {
              if (seen.has(task.id)) continue;
              seen.add(task.id);
              collected.push(task);
              if (collected.length > MAX_LIST_ALL_ROWS) {
                handleError(new Error(
                  `Refusing --all: result exceeds the ${MAX_LIST_ALL_ROWS}-row hard ceiling; ` +
                  "narrow the query and continue with --offset or --cursor.",
                ));
              }
            }
            const prettyBytes = Buffer.byteLength(`${JSON.stringify(redactBroadTasks(collected), null, 2)}\n`);
            if (prettyBytes > MAX_LIST_ALL_BYTES) {
              handleError(new Error(
                `Refusing --all: pretty JSON response exceeds the ${MAX_LIST_ALL_BYTES}-byte hard ceiling; ` +
                "use paginated output with --limit/--offset or narrow the query.",
              ));
            }
            if (current.has_more !== true) break;
            if (current.next_cursor) {
              if (current.next_cursor === currentCursor) {
                handleError(new Error("REMOTE_API_INCOMPATIBLE: task cursor pagination did not advance"));
              }
              currentCursor = current.next_cursor;
              currentOffset = current.next_offset ?? current.offset + current.consumed;
            } else if (current.next_offset !== null && current.next_offset > currentOffset) {
              currentOffset = current.next_offset;
            } else {
              handleError(new Error("REMOTE_API_INCOMPATIBLE: task pagination reported more rows without a progressing continuation"));
            }
          }
          const consistentTotal = totals.size === 1 ? [...totals][0]! : null;
          const snapshotConsistent = pageCount === 1 || (snapshots.size === 1 && snapshotPages === pageCount);
          page = {
            tasks: collected,
            count: collected.length,
            total: consistentTotal,
            requested_limit: LIST_EXHAUST_PAGE_SIZE,
            limit: last?.limit ?? LIST_EXHAUST_PAGE_SIZE,
            server_cap: last?.server_cap ?? null,
            offset: 0,
            consumed: last ? last.offset + last.consumed : 0,
            has_more: last?.has_more ?? null,
            next_offset: last?.next_offset ?? (last?.has_more === null && last ? last.offset + last.consumed : null),
            next_cursor: last?.next_cursor ?? null,
            snapshot: snapshotConsistent ? last?.snapshot ?? null : null,
            complete: pageCount === 1
              ? last?.complete ?? null
              : snapshotConsistent && last?.complete === true
                ? true
                : null,
            composed: pageCount > 1 || Boolean(last?.composed),
          };
        }
      } else {
        if (opts.cursor) handleError(new Error("--cursor requires the hosted authority; local SQLite supports --offset only"));
        const localTotal = countTasks(baseFilter as Parameters<typeof countTasks>[0]);
        const localLimit = readWholeSet ? Math.min(Math.max(localTotal, 1), MAX_LIST_ALL_ROWS + 1) : requestedLimit;
        const localOffset = readWholeSet ? 0 : requestedOffset;
        const localTasks = listTasks(
          { ...baseFilter, limit: localLimit, offset: localOffset } as Parameters<typeof listTasks>[0],
        );
        if (readWholeSet && localTasks.length > MAX_LIST_ALL_ROWS) {
          handleError(new Error(`Refusing --all: result exceeds the ${MAX_LIST_ALL_ROWS}-row hard ceiling`));
        }
        const hasMore = localOffset + localTasks.length < localTotal;
        page = {
          tasks: localTasks,
          count: localTasks.length,
          total: localTotal,
          requested_limit: readWholeSet ? localLimit : requestedLimit,
          limit: readWholeSet ? localLimit : requestedLimit,
          server_cap: null,
          offset: localOffset,
          consumed: localTasks.length,
          has_more: hasMore,
          next_offset: hasMore ? localOffset + localTasks.length : null,
          next_cursor: null,
          snapshot: null,
          complete: !hasMore,
          composed: false,
        };
      }

      let warnedMissingCreator = false;
      const applyClientNarrowing = (source: Task[]): { rows: Task[]; narrowed: boolean } => {
        let rows = source;
        let narrowed = false;
        if (cloud && creatorFilterActive) {
          if (!warnedMissingCreator && rows.length > 0 && rows.every((t) => !("created_by" in (t as object)))) {
            warnedMissingCreator = true;
            console.error(chalk.yellow(
              "Warning: this server does not record task authorship, so the creator filter matched nothing to exclude.\n" +
              "         Results are unfiltered. The API needs upgrading past the release that added created_by.",
            ));
          }
          const before = rows.length;
          const wantCreatedBy = filter["created_by"] as string | undefined;
          const excludeCreatedBy = filter["not_created_by"] as string | undefined;
          rows = rows.filter((t) => {
            const raw = (t as { created_by?: string | null }).created_by ?? null;
            const author = raw === null ? null : canonicalAgentRef(raw);
            if (wantCreatedBy && author !== canonicalAgentRef(wantCreatedBy)) return false;
            if (excludeCreatedBy && author !== null && author === canonicalAgentRef(excludeCreatedBy)) return false;
            return true;
          });
          narrowed ||= rows.length !== before;
        }
        if (taskListFilterActive) {
          const before = rows.length;
          const taskListId = filter["task_list_id"] as string;
          rows = rows.filter((task) => task.task_list_id === taskListId);
          narrowed ||= rows.length !== before;
        }
        if (opts.dueToday) {
          const before = rows.length;
          const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
          rows = rows.filter(t => t.due_at && t.due_at <= todayEnd.toISOString());
          narrowed ||= rows.length !== before;
        }
        if (opts.overdue) {
          const before = rows.length;
          const now = new Date().toISOString();
          rows = rows.filter(t => t.due_at && t.due_at < now && t.status !== "completed");
          narrowed ||= rows.length !== before;
        }
        return { rows, narrowed };
      };

      const firstNarrowed = applyClientNarrowing(page.tasks);
      let tasks = firstNarrowed.rows;
      let narrowedClientSide = firstNarrowed.narrowed;

      // A predecessor may ignore creator/task-list predicates. Fill the requested
      // output page by walking its own authoritative continuation; never issue a
      // separate total/probe request and never advance by the filtered row count.
      if (cloud && !readWholeSet && narrowedClientSide && tasks.length < requestedLimit) {
        const outputIds = new Set(tasks.map((task) => task.id));
        let last = page;
        let pagesRead = 1;
        const snapshots = new Set<string>();
        let snapshotPages = 0;
        if (page.snapshot) { snapshots.add(page.snapshot); snapshotPages++; }
        while (tasks.length < requestedLimit && last.has_more === true) {
          const remaining = requestedLimit - tasks.length;
          const nextOptions = last.next_cursor
            ? { limit: remaining, offset: last.next_offset ?? last.offset + last.consumed, cursor: last.next_cursor }
            : last.next_offset !== null
              ? { limit: remaining, offset: last.next_offset }
              : null;
          if (!nextOptions || nextOptions.offset <= last.offset) {
            handleError(new Error("REMOTE_API_INCOMPATIBLE: filtered task pagination did not provide a progressing continuation"));
          }
          const next = await requestCloudTaskSelection(cloud, baseFilter, nextOptions);
          pagesRead++;
          if (next.snapshot) { snapshots.add(next.snapshot); snapshotPages++; }
          const narrowed = applyClientNarrowing(next.tasks);
          narrowedClientSide ||= narrowed.narrowed;
          for (const task of narrowed.rows) {
            if (outputIds.has(task.id)) continue;
            outputIds.add(task.id);
            tasks.push(task);
          }
          page.consumed += next.consumed;
          last = next;
          if (next.consumed === 0 && next.has_more === true) {
            handleError(new Error("REMOTE_API_INCOMPATIBLE: filtered task pagination stalled"));
          }
        }
        if (pagesRead > 1) {
          page.has_more = last.has_more;
          page.next_offset = last.next_offset;
          page.next_cursor = last.next_cursor;
          page.server_cap = last.server_cap;
          page.limit = last.limit;
          page.composed = true;
          const snapshotConsistent = snapshots.size === 1 && snapshotPages === pagesRead;
          page.snapshot = snapshotConsistent ? last.snapshot : null;
          page.complete = snapshotConsistent && last.complete === true ? true : null;
          page.total = page.complete === true ? tasks.length : null;
        }
      }

      let outputCapped = false;
      if (!readWholeSet && tasks.length > requestedLimit) {
        const fullFilteredCount = tasks.length;
        let consumedPrefix = 0;
        let visible = 0;
        for (const rawTask of page.tasks) {
          consumedPrefix++;
          if (applyClientNarrowing([rawTask]).rows.length > 0) visible++;
          if (visible >= requestedLimit) break;
        }
        tasks = tasks.slice(0, requestedLimit);
        outputCapped = true;
        page.total = page.complete === true && !page.composed ? fullFilteredCount : null;
        page.has_more = true;
        page.complete = false;
        page.next_cursor = null;
        page.next_offset = page.offset + consumedPrefix;
        page.consumed = consumedPrefix;
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
      if (exhaustForTransform && explicitLimit !== undefined && tasks.length > explicitLimit) {
        const fullCount = tasks.length;
        tasks = tasks.slice(0, explicitLimit);
        page.total = fullCount;
        page.has_more = true;
        page.next_offset = explicitLimit;
        page.next_cursor = null;
        page.complete = false;
      }
      if (narrowedClientSide && page.composed) {
        page.total = null;
        page.complete = null;
      } else if (narrowedClientSide && !outputCapped) {
        if (page.complete === true) {
          page.total = tasks.length;
          page.has_more = false;
          page.next_offset = null;
        } else {
          page.total = null;
          page.complete = null;
        }
      }
      page.tasks = tasks;
      page.count = tasks.length;

      // Byte fitting may need to ask the authority for a smaller page. Retain the
      // exact request start and the unmodified authority page only while the rows
      // are still a direct page in authority order. A composed/filter-filled/sorted
      // page has no single cursor boundary that can be shortened safely.
      const byteTrimAuthoritySource = cloud && directCloudPageRequest && !readWholeSet &&
        !narrowedClientSide && !outputCapped && !page.composed && !opts.sort
        ? {
            request: { ...directCloudPageRequest },
            page: { ...page, tasks: [...page.tasks] },
          }
        : null;

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
      // AMENDED (todos 0cbf512c). This previously read "the roster is consulted
      // ONLY when the result is empty ... so a query that returns rows pays
      // nothing". That is no longer true: a NON-empty result is exactly where the
      // ambiguous-name partial hides, so the roster is now consulted whenever
      // `--assigned`/`--agent-name` was TYPED. The hot-path cost that sentence was
      // protecting is preserved by a different mechanism — the fetch is kicked off
      // where the filter is read, in parallel with the query, rather than awaited
      // after it. A bare `todos list` still pays nothing, because the gate is
      // `assignedWasTyped`.
      //
      // `loadAssigneeContext` is TTL-cached and degrades silently when the roster
      // cannot be fetched, in which case EVERY name reads as unregistered and BOTH
      // warnings are suppressed rather than asserting something false about a name
      // that may be perfectly valid.
      // This names `assignedFilter` — the SAME variable the query filtered on, resolved
      // once where the flags are read. It is deliberately not re-derived from `opts`
      // here: a second derivation is free to disagree with the first, and did.
      // `opts.agentName ?? opts.assigned` got both directions wrong at once, because
      // `??` and the truthiness guards above answer differently on an empty string and
      // neither of them accounts for `--inbox` at all:
      //
      //   --assigned bogus --inbox     query: my identity   warned about: 'bogus'
      //   --agent-name "" --assigned x query: 'x'           warned about: nothing ("" is
      //                                                     not nullish, so it resolved
      //                                                     to "" and fell out of the
      //                                                     guard below)
      //
      // `assignedWasTyped` is the other half. An unregistered reference is worth
      // reporting because the operator may have mistyped it; the identity `--inbox`
      // resolves was never typed, so the same message would be false about how it got
      // there. Suppressing it there can only ever remove a warning, never add one, so
      // it cannot regress the registered-but-idle silence this warning depends on.
      // The EMPTY case above and the PARTIAL case below are two different false
      // readings of the same filter, and an ambiguous reference can produce EITHER:
      // literal-only matching may return some name-stored rows, or none when every
      // matching task was stored under an agent id. Classify ambiguity before
      // looking at result length so the empty form cannot masquerade as a genuinely
      // idle registered agent.
      //
      // PARTIAL (todos task 0cbf512c) is the newer of the two and the harder to
      // notice. An ambiguous name — one occupying 2+ agent rows — is resolved to
      // literal-only matching by BOTH storage engines, deliberately, rather than
      // picking a row at random. That is correct; being silent about it was not.
      // Measured live on 0.15.6: `--assigned fabricius` returned 182 rows and 0
      // bytes of stderr while `--assigned 01d4cc12` returned 190, the missing 8
      // being rows whose `assigned_to` holds a raw agent id. A complete answer
      // and a truncated one were indistinguishable at the call site.
      //
      // WARNS and never refuses, for the same reason the empty-result warning
      // does: this is the query every agent runs to find its own work, and
      // scripts consume it. It also goes to STDERR specifically so that
      // `--json` stdout stays a clean parseable array.
      if (rosterPromise && assignedFilter) {
        try {
          const roster = await rosterPromise;
          if (!roster.degraded) {
            const notice = describeAssigneeFilter(assignedFilter, { agents: roster.agents });
            if (notice.kind === "ambiguous") {
              console.error(chalk.yellow(`Warning: ${notice.message}`));
            } else if (tasks.length === 0) {
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
          }
        } catch {
          // Advisory only. A roster lookup must never turn a working list into a
          // failure, and the result below is still reported either way.
        }
      }

      const fmt = opts.format || (globalOpts.json ? "json" : "table");
      let outputTasks = redactBroadTasks(tasks);
      const maxBytes = opts.all ? MAX_LIST_ALL_BYTES : MAX_LIST_PAGE_BYTES;
      let byteLimited = false;
      if (page.has_more !== false && outputTasks.length > 0 && opts.format !== "json" && fmt !== "compact") {
        const continuation = page.next_cursor
          ? `--cursor ${page.next_cursor}`
          : page.next_offset !== null
            ? `--offset ${page.next_offset}`
            : "the authority-provided continuation";
        console.error(chalk.yellow(
          `Warning: this is a bounded or snapshot-unknown page. Continue with ${continuation}, ` +
          "or use --format json/compact for pagination metadata.",
        ));
      }

      const buildEnvelope = (
        pageValue: AuthorityTaskPage = page,
        taskValue: Task[] = outputTasks,
        limited = byteLimited,
      ): TaskListPageEnvelope => ({
        ...pageValue,
        tasks: taskValue,
        count: taskValue.length,
        all: exhaustAll,
        byte_limited: limited,
        max_bytes: maxBytes,
        byte_length: 0,
      });

      const previewTrimmedPage = (count: number): AuthorityTaskPage => ({
        ...page,
        tasks: page.tasks.slice(0, count),
        count,
        consumed: count,
        has_more: true,
        next_offset: page.offset + count,
        complete: false,
      });

      const largestFittingPrefix = (
        render: (pageValue: AuthorityTaskPage, taskValue: Task[], limited: boolean) => string,
      ): number => {
        for (let count = outputTasks.length - 1; count >= 1; count--) {
          const candidateTasks = outputTasks.slice(0, count);
          if (Buffer.byteLength(render(previewTrimmedPage(count), candidateTasks, true)) <= MAX_LIST_PAGE_BYTES) {
            return count;
          }
        }
        return 0;
      };

      const applyByteLimitedPrefix = async (count: number): Promise<void> => {
        if (count < 1) {
          handleError(new Error(
            `A single task plus pagination metadata exceeds the ${MAX_LIST_PAGE_BYTES}-byte page ceiling; ` +
            "narrow the query or use a less verbose output format.",
          ));
        }
        byteLimited = true;

        if (byteTrimAuthoritySource) {
          const source = byteTrimAuthoritySource;
          const refetched = await requestCloudTaskSelection(cloud!, baseFilter, {
            ...source.request,
            limit: count,
            ...(source.page.snapshot ? { snapshot: source.page.snapshot } : {}),
          });
          const mismatch = (detail: string): never => handleError(new Error(
            "REMOTE_API_INCOMPATIBLE: authority could not reproduce the byte-limited task page " +
            `from its original cursor/snapshot (${detail}); refusing an unsafe continuation`,
          ));

          if (refetched.composed) mismatch("the smaller response was composed from independent pages");
          if (refetched.tasks.length < 1 || refetched.tasks.length > count) {
            mismatch(`requested ${count} rows but received ${refetched.tasks.length}`);
          }
          if (refetched.offset !== source.page.offset) {
            mismatch(`offset changed from ${source.page.offset} to ${refetched.offset}`);
          }
          if (source.page.snapshot && refetched.snapshot !== source.page.snapshot) {
            mismatch(`snapshot changed from ${source.page.snapshot} to ${refetched.snapshot ?? "null"}`);
          }
          if (source.page.total !== null && refetched.total !== source.page.total) {
            mismatch(`total changed from ${source.page.total} to ${refetched.total ?? "null"}`);
          }
          for (let index = 0; index < refetched.tasks.length; index++) {
            if (refetched.tasks[index]?.id !== source.page.tasks[index]?.id) {
              mismatch(`task prefix changed at row ${index}`);
            }
          }

          const shortened = refetched.tasks.length < source.page.tasks.length;
          if (shortened) {
            if (refetched.has_more === false) mismatch("smaller response claimed there is no continuation");
            if (source.page.snapshot || source.page.next_cursor || source.request.cursor) {
              if (!refetched.next_cursor) mismatch("smaller snapshot/cursor page omitted next_cursor");
              if (refetched.next_cursor === source.request.cursor) mismatch("next_cursor did not advance");
              if (source.page.next_cursor && refetched.next_cursor === source.page.next_cursor) {
                mismatch("smaller page retained the original full-page next_cursor");
              }
            } else if (refetched.next_offset === null || refetched.next_offset <= refetched.offset) {
              mismatch("smaller offset page omitted a progressing continuation");
            }
            if (refetched.next_offset !== null && refetched.next_offset !== refetched.offset + refetched.consumed) {
              mismatch(
                `next_offset ${refetched.next_offset} does not match offset ${refetched.offset} + consumed ${refetched.consumed}`,
              );
            }
            // The original page proves that additional rows exist after this exact
            // reproduced prefix, even when a legacy envelope leaves has_more null.
            refetched.has_more = true;
            refetched.complete = false;
          }

          // requested_limit describes the caller's request. `limit` and `consumed`
          // describe the smaller authority page that can actually be emitted;
          // keep an advertised cap separately when it is larger than this retry.
          refetched.requested_limit = source.page.requested_limit;
          if (shortened) refetched.limit = Math.min(refetched.limit, refetched.consumed);
          page = refetched;
          outputTasks = redactBroadTasks(refetched.tasks);
          return;
        }

        // Local and legacy offset-only pages have no authority cursor to preserve.
        // Advance by exactly the emitted prefix and make `consumed` agree with it.
        // Never silently downgrade a cursor/snapshot page to this offset path.
        if (page.snapshot || page.next_cursor || directCloudPageRequest?.cursor) {
          handleError(new Error(
            "REMOTE_API_INCOMPATIBLE: cannot byte-limit a composed or transformed cursor/snapshot page " +
            "without losing its exact continuation; narrow the query or lower --limit.",
          ));
        }
        page = previewTrimmedPage(count);
        page.next_cursor = null;
        outputTasks = outputTasks.slice(0, count);
      };

      if (fmt === "json") {
        // Keep the long-standing global --json bare-array contract. Explicit
        // --format json is the additive authority-envelope surface. Both
        // spellings now share the same byte-fitting path; only the outer shape
        // differs for compatibility.
        if (opts.format !== "json") {
          const renderLegacyJson = (
            _pageValue: AuthorityTaskPage,
            taskValue: Task[],
            _limited: boolean,
          ): string => `${JSON.stringify(taskValue, null, 2)}\n`;
          let text = renderLegacyJson(page, outputTasks, byteLimited);
          if (exhaustAll && Buffer.byteLength(text) > MAX_LIST_ALL_BYTES) {
            handleError(new Error(
              `Refusing --all: pretty JSON response exceeds the ${MAX_LIST_ALL_BYTES}-byte hard ceiling; ` +
              "use paginated output with --limit/--offset or narrow the query.",
            ));
          }
          while (!exhaustAll && Buffer.byteLength(text) > MAX_LIST_PAGE_BYTES && outputTasks.length > 0) {
            await applyByteLimitedPrefix(largestFittingPrefix(renderLegacyJson));
            text = renderLegacyJson(page, outputTasks, byteLimited);
          }
          if (Buffer.byteLength(text) > maxBytes) {
            handleError(new Error(`Task list output exceeds the ${maxBytes}-byte output ceiling`));
          }
          process.stdout.write(text);
          return;
        }
        const renderJsonPage = (
          pageValue: AuthorityTaskPage,
          taskValue: Task[],
          limited: boolean,
        ): string => serializeTaskListEnvelope(buildEnvelope(pageValue, taskValue, limited));
        let text = renderJsonPage(page, outputTasks, byteLimited);
        if (exhaustAll && Buffer.byteLength(text) > MAX_LIST_ALL_BYTES) {
          handleError(new Error(
            `Refusing --all: formatted response exceeds the ${MAX_LIST_ALL_BYTES}-byte hard ceiling; ` +
            "use paginated output with --limit/--offset or narrow the query.",
          ));
        }
        while (!exhaustAll && Buffer.byteLength(text) > MAX_LIST_PAGE_BYTES && outputTasks.length > 0) {
          await applyByteLimitedPrefix(largestFittingPrefix(renderJsonPage));
          text = renderJsonPage(page, outputTasks, byteLimited);
        }
        if (Buffer.byteLength(text) > maxBytes) {
          handleError(new Error(`Task list metadata alone exceeds the ${maxBytes}-byte output ceiling`));
        }
        process.stdout.write(text);
        return;
      }

      if (fmt === "compact") {
        // Preserve the legacy scripting contract: an empty compact list is zero bytes.
        if (outputTasks.length === 0) {
          process.stdout.write("");
          return;
        }
        const renderCompactPage = (
          pageValue: AuthorityTaskPage,
          taskValue: Task[],
        ): string => {
          const lines = taskValue.map(compactTaskListLine);
          const footer =
            `# page count=${lines.length} total=${pageValue.total ?? "unknown"} requested_limit=${pageValue.requested_limit} ` +
            `limit=${pageValue.limit} offset=${pageValue.offset} has_more=${pageValue.has_more ?? "unknown"} ` +
            `next_offset=${pageValue.next_offset ?? "null"} next_cursor=${pageValue.next_cursor ?? "null"} ` +
            `complete=${pageValue.complete ?? "unknown"}`;
          return [...lines, footer].join("\n") + "\n";
        };
        let text = renderCompactPage(page, outputTasks);
        if (exhaustAll && Buffer.byteLength(text) > MAX_LIST_ALL_BYTES) {
          handleError(new Error(
            `Refusing --all: compact response exceeds the ${MAX_LIST_ALL_BYTES}-byte hard ceiling; ` +
            "use --limit/--offset or narrow the query.",
          ));
        }
        while (!exhaustAll && Buffer.byteLength(text) > MAX_LIST_PAGE_BYTES && outputTasks.length > 0) {
          await applyByteLimitedPrefix(largestFittingPrefix((pageValue, taskValue) =>
            renderCompactPage(pageValue, taskValue)));
          text = renderCompactPage(page, outputTasks);
        }
        process.stdout.write(text);
        return;
      }

      if (outputTasks.length === 0) {
        if (fmt === "csv") process.stdout.write("");
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

      const totalLabel = page.total === null ? "unknown total," : `of ${page.total}`;
      console.log(chalk.bold(`${outputTasks.length} ${totalLabel} task(s):\n`));
      for (const t of outputTasks) console.log(formatTaskLine(t));
      if (page.has_more !== false) {
        if (page.next_cursor) console.log(chalk.dim(`\nContinue with: todos list --cursor ${page.next_cursor}`));
        else if (page.next_offset !== null) console.log(chalk.dim(`\nContinue with: todos list --limit ${requestedLimit} --offset ${page.next_offset}`));
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
      const taskFilter = projectId ? { project_id: projectId } : {};
      let counts: Record<string, number>;
      if (cloud) {
        // Count against the authority's SQL-side `total` via BOUNDED reads, never
        // an O(all-tasks) download (task 5e5ed4d1): the unbounded /v1/tasks shape
        // carried the whole population (~64k rows / ~154 MB) and timed the client
        // out, while a `limit=1` page returns fast and still reports the full
        // match count. cloudCountTasks falls back to the unbounded list only when
        // a legacy authority omits `total`, preserving pre-fix behaviour there.
        const [total, pending, in_progress, completed, failed, cancelled] = await Promise.all([
          cloudCountTasks(cloud, taskFilter),
          cloudCountTasks(cloud, { ...taskFilter, status: "pending" } as never),
          cloudCountTasks(cloud, { ...taskFilter, status: "in_progress" } as never),
          cloudCountTasks(cloud, { ...taskFilter, status: "completed" } as never),
          cloudCountTasks(cloud, { ...taskFilter, status: "failed" } as never),
          cloudCountTasks(cloud, { ...taskFilter, status: "cancelled" } as never),
        ]);
        counts = { total, pending, in_progress, completed, failed, cancelled };
      } else {
        const all = listTasks(taskFilter);
        counts = { total: all.length };
        for (const t of all) counts[t.status] = (counts[t.status] || 0) + 1;
      }

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
    .option("--comments-limit <n>", `Comments per page, 1-${MAX_CLI_COMMENT_PAGE} (default ${DEFAULT_CLI_COMMENT_PAGE})`)
    .option("--comments-cursor <cursor>", "Read the next OLDER page; pass comments_page.next_cursor")
    .action(async (id: string, opts: CommentPageFlags) => {
      const globalOpts = program.opts();
      // `todos show` resolves a task by id and never consumes the global
      // --project option. Fail closed instead of silently ignoring it
      // (I38-00523): the flag used to be dropped with rc=0, which read as a
      // scoped lookup that never happened.
      if (globalOpts.project !== undefined) {
        handleError(new Error("`todos show` does not support a --project filter: it resolves a task by id. Scope a lookup with `todos list --project <ref>`."));
      }
      const page = commentPageOptions(opts);
      const cloud = getTodosCloudClient();
      let task: any;
      if (cloud) {
        const remote = await cloudGetTask(cloud, await resolveTaskIdForCommand(id, cloud));
        const [commentPage, relations, gitRefs] = remote
          ? await Promise.all([
              cloudListComments(cloud, remote.id, page.request),
              cloudDetailRelations(cloud, remote.id),
              cloudDetailGitRefs(cloud, remote.id),
            ])
          : [null, null, null];
        task = remote
          ? {
              subtasks: [], ...remote, tags: remote.tags ?? [],
              dependencies: relations!.dependencies,
              blocked_by: relations!.blocked_by,
              blocks: relations!.blocks,
              git_refs: gitRefs!,
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
        task = applyLocalCommentPage(getTaskWithRelations(resolvedId), page);
        if (task) {
          const { getTaskGitRefs } = await import("../../db/task-commits.js");
          task.git_refs = getTaskGitRefs(resolvedId);
        }
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
    .option("--comments-limit <n>", `Comments per page, 1-${MAX_CLI_COMMENT_PAGE} (default ${DEFAULT_CLI_COMMENT_PAGE})`)
    .option("--comments-cursor <cursor>", "Read the next OLDER page; pass comments_page.next_cursor")
    .action(async (id: string | undefined, opts: CommentPageFlags) => {
      const globalOpts = program.opts();
      const page = commentPageOptions(opts);
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
        const [commentPage, relations, gitRefs] = remote
          ? await Promise.all([
              cloudListComments(cloud, remote.id, page.request),
              cloudDetailRelations(cloud, remote.id),
              cloudDetailGitRefs(cloud, remote.id),
            ])
          : [null, null, null];
        task = remote
          ? {
              subtasks: [], checklist: [], ...remote, tags: remote.tags ?? [],
              dependencies: relations!.dependencies,
              blocked_by: relations!.blocked_by,
              blocks: relations!.blocks,
              git_refs: gitRefs!,
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
        task = applyLocalCommentPage(getTaskWithRelations(resolvedId), page);
      }
      if (!task) { handleError(new Error(`Task not found: ${id || resolvedId}`)); }

      if (globalOpts.json && !cloud) {
        const { listTaskFiles } = await import("../../db/task-files.js");
        const { getTaskCommits, getTaskGitRefs } = await import("../../db/task-commits.js");
        try { (task as any).files = listTaskFiles(task.id); } catch (e) { console.error(chalk.dim(`Warning: could not load task files: ${e instanceof Error ? e.message : String(e)}`)); }
        try { (task as any).commits = getTaskCommits(task.id); } catch (e) { console.error(chalk.dim(`Warning: could not load task commits: ${e instanceof Error ? e.message : String(e)}`)); }
        try { (task as any).git_refs = getTaskGitRefs(task.id); } catch (e) { console.error(chalk.dim(`Warning: could not load task git refs: ${e instanceof Error ? e.message : String(e)}`)); }
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
    .option("--parent <id>", "Repair the parent task (existing task ID or unique reference)")
    .option("--clear-parent", "Detach from its parent (reset parent_id to null)")
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
      if (opts.parent && opts.clearParent) {
        handleError(new Error("Use either --parent or --clear-parent, not both."));
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
            parentRef: opts.parent,
            clearParent: opts.clearParent,
          });
          const updatePatch = {
            version: reparent.parent_id !== undefined ? current.version : undefined,
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
          };
          task = await cloudUpdateTaskWithVerifiedReparent(cloud, currentId, updatePatch, reparent);
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
        parentRef: opts.parent,
        clearParent: opts.clearParent,
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
          task = await cloudUpdateTaskWithVerifiedReparent(
            cloud,
            currentId,
            reparent as Record<string, unknown>,
            reparent,
          );
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

  // stale-lock-handoff
  program
    .command("stale-lock-handoff <id>")
    .description("Atomically transfer one exact stale lock by holder and locked_at version")
    .requiredOption("--expected-holder <agent>", "Exact current locked_by value")
    .requiredOption("--expected-lock-version <timestamp>", "Exact current locked_at value (canonical UTC)")
    .requiredOption("--stale-after-seconds <seconds>", "Required lock age threshold; no default")
    .requiredOption("--new-holder <agent>", "New holder; must match the authenticated/--agent identity")
    .requiredOption("--reason <text>", "Non-empty audit reason")
    .action(async (
      id: string,
      opts: {
        expectedHolder: string;
        expectedLockVersion: string;
        staleAfterSeconds: string;
        newHolder: string;
        reason: string;
      },
    ) => {
      const globalOpts = program.opts();
      const taskId = normalizeExactTaskId(id);
      const actor = resolveClaimIdentity("handoff a stale lock on", globalOpts.agent);
      const staleAfterSeconds = Number(opts.staleAfterSeconds);
      const cloud = getTodosCloudClient();
      let receipt;
      try {
        receipt = cloud
          ? await cloudHandoffStaleTaskLock(cloud, {
              task_id: taskId,
              expected_holder: opts.expectedHolder,
              expected_lock_version: opts.expectedLockVersion,
              stale_after_seconds: staleAfterSeconds,
              new_holder: opts.newHolder,
              reason: opts.reason,
            })
          : handoffStaleTaskLock({
              task_id: taskId,
              actor,
              expected_holder: opts.expectedHolder,
              expected_lock_version: opts.expectedLockVersion,
              stale_after_seconds: staleAfterSeconds,
              new_holder: opts.newHolder,
              reason: opts.reason,
            });
      } catch (e) {
        handleError(e);
      }

      if (globalOpts.json) {
        output({ receipt }, true);
        return;
      }
      console.log(chalk.green(`Stale lock transferred on task ${escapeTerminalControls(receipt.task_id)}.`));
      console.log(
        `  ${escapeTerminalControls(receipt.previous_holder)} @ ${escapeTerminalControls(receipt.previous_lock_version)}`,
      );
      console.log(
        `  -> ${escapeTerminalControls(receipt.new_holder)} @ ${escapeTerminalControls(receipt.new_lock_version)}`,
      );
      console.log(
        `  stale after ${receipt.stale_after_seconds}s (cutoff ${escapeTerminalControls(receipt.stale_cutoff)})`,
      );
      console.log(`  receipt ${escapeTerminalControls(receipt.receipt_id)}`);
      console.log(`  reason ${escapeTerminalControls(receipt.reason)}`);
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
    .description("Bulk operation on multiple tasks (done, start, delete, plan/move-plan, tag, untag)")
    .option("--plan <id>", "Plan ID for the plan/move-plan action")
    .option("--clear-plan", "Remove plan assignment for the plan/move-plan action")
    .option("--tag <tags>", "Comma-separated tags for the tag/untag action")
    .option("--tags <tags>", "Comma-separated tags for the tag/untag action (alias for --tag)")
    .action(async (action: string, ids: string[], opts: { plan?: string; clearPlan?: boolean; tag?: string; tags?: string }) => {
      const globalOpts = program.opts();
      const results: { id: string; success: boolean; error?: string }[] = [];
      const cloud = getTodosCloudClient();
      const isPlanAction = action === "plan" || action === "move-plan";
      const isTagAction = action === "tag" || action === "untag";
      if (isPlanAction && Boolean(opts.plan) === Boolean(opts.clearPlan)) {
        handleError(new Error("Use exactly one of --plan or --clear-plan with bulk plan."));
      }
      const knownActions = new Set(["done", "complete", "start", "delete", "plan", "move-plan", "tag", "untag"]);
      if (!knownActions.has(action)) {
        handleError(new Error(`Unknown action: ${action}. Use: done, start, delete, plan (alias: move-plan), tag, untag`));
      }
      // Resolved once, before either loop. An empty tag set is refused rather
      // than applied: a bulk run with nothing to apply would report success for
      // every id and read as a completed backfill.
      const tagArgument = resolveTagArgument(opts.tag, opts.tags);
      if (isTagAction && !tagArgument.ok) {
        handleError(new Error(
          `--tag and --tags name different tag sets (--tag "${tagArgument.conflict.tag}" vs --tags "${tagArgument.conflict.tags}"). ` +
          "They are aliases; pass one, or pass the same set to both.",
        ));
      }
      const bulkTags = isTagAction && tagArgument.ok ? parseTagList(tagArgument.raw) : [];
      if (isTagAction && bulkTags.length === 0) {
        handleError(new Error(
          `bulk ${action} needs --tag. Example: todos bulk ${action} <ids...> --tag directive:k_msd4cz8t_ste6f4`,
        ));
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
            } else if (isTagAction) {
              const current = await cloudGetTask(cloud, resolvedId);
              if (!current) throw new Error(`Task not found: ${rawId}`);
              const resolution = resolveBulkTags(current.tags, action, bulkTags);
              // Skip the PATCH when the row already satisfies the request, so a
              // re-run after a partial failure does not bump row versions or
              // write audit noise for rows that were already correct.
              if (resolution.changed) {
                await cloudUpdateTask(cloud, resolvedId, { version: current.version, tags: resolution.tags });
              }
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
          } else if (isTagAction) {
            const current = getTask(resolvedId);
            if (!current) {
              throw new Error(`Task not found: ${rawId}`);
            }
            const resolution = resolveBulkTags(current.tags, action, bulkTags);
            if (resolution.changed) {
              updateTask(resolvedId, { version: current.version, tags: resolution.tags });
            }
            results.push({ id: resolvedId, success: true });
          } else if (isPlanAction) {
            const current = getTask(resolvedId);
            if (!current) {
              throw new Error(`Task not found: ${rawId}`);
            }
            updateTask(resolvedId, { version: current.version, plan_id: planId });
            results.push({ id: resolvedId, success: true });
          } else {
            handleError(new Error(`Unknown action: ${action}. Use: done, start, delete, plan (alias: move-plan), tag, untag`));
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
