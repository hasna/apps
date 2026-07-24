import type { Database, SQLQueryBindings } from "bun:sqlite";
import type {
  BoardCard,
  BoardLane,
  BoardLaneSnapshot,
  BoardScope,
  BoardSnapshot,
  Plan,
  Task,
  TaskBoard,
  TaskBoardRow,
  TaskStatus,
} from "../types/index.js";
import { getDatabase, now, resolvePartialId, uuid } from "./database.js";
import { listPlans, updatePlan } from "./plans.js";
import { getTask, listTasks, updateTask } from "./task-crud.js";

export interface CreateTaskBoardInput {
  name: string;
  scope?: BoardScope;
  project_id?: string;
  task_list_id?: string;
  plan_id?: string;
  agent_id?: string;
  lanes?: BoardLane[];
  filters?: Record<string, unknown>;
}

export interface UpdateTaskBoardInput {
  name?: string;
  project_id?: string | null;
  task_list_id?: string | null;
  plan_id?: string | null;
  agent_id?: string | null;
  lanes?: BoardLane[];
  filters?: Record<string, unknown>;
}

export interface TaskBoardQuery {
  scope?: BoardScope;
  project_id?: string;
  task_list_id?: string;
  plan_id?: string;
  agent_id?: string;
  limit?: number;
}

export interface MoveBoardCardInput {
  board_id: string;
  card_id: string;
  lane_id?: string;
  status?: string;
}

export interface TaskBoardBundle {
  kind: "hasna.todos.task-board";
  schemaVersion: 1;
  exportedAt: string;
  boards: TaskBoard[];
}

const TASK_LANES: BoardLane[] = [
  { id: "ready", name: "Ready", statuses: ["pending"], wip_limit: null, position: 0 },
  { id: "doing", name: "Doing", statuses: ["in_progress"], wip_limit: 3, position: 1 },
  { id: "review", name: "Review", statuses: ["failed"], wip_limit: 5, position: 2 },
  { id: "done", name: "Done", statuses: ["completed"], wip_limit: null, position: 3 },
  { id: "cancelled", name: "Cancelled", statuses: ["cancelled"], wip_limit: null, position: 4 },
];

const PLAN_LANES: BoardLane[] = [
  { id: "active", name: "Active", statuses: ["active"], wip_limit: 3, position: 0 },
  { id: "completed", name: "Completed", statuses: ["completed"], wip_limit: null, position: 1 },
  { id: "archived", name: "Archived", statuses: ["archived"], wip_limit: null, position: 2 },
];

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function defaultLanes(scope: BoardScope): BoardLane[] {
  return (scope === "plans" ? PLAN_LANES : TASK_LANES).map((lane) => ({ ...lane, statuses: [...lane.statuses] }));
}

function normalizeLanes(scope: BoardScope, lanes?: BoardLane[]): BoardLane[] {
  const source = lanes && lanes.length > 0 ? lanes : defaultLanes(scope);
  return source
    .map((lane, index) => ({
      id: lane.id || lane.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `lane-${index + 1}`,
      name: lane.name || lane.id || `Lane ${index + 1}`,
      statuses: Array.from(new Set((lane.statuses || []).map(String).filter(Boolean))),
      wip_limit: lane.wip_limit === undefined ? null : lane.wip_limit,
      position: lane.position ?? index,
    }))
    .filter((lane) => lane.statuses.length > 0)
    .sort((a, b) => a.position - b.position);
}

function rowToTaskBoard(row: TaskBoardRow): TaskBoard {
  return {
    ...row,
    lanes: normalizeLanes(row.scope, parseJsonArray<BoardLane>(row.lanes)),
    filters: parseJsonObject(row.filters),
  };
}

function maybeFilter<T>(value: unknown): T | undefined {
  return value === undefined || value === null || value === "" ? undefined : value as T;
}

export function createTaskBoard(input: CreateTaskBoardInput, db?: Database): TaskBoard {
  const d = getDatabase(db);
  const id = uuid();
  const timestamp = now();
  const scope = input.scope || "tasks";
  const lanes = normalizeLanes(scope, input.lanes);
  d.run(
    `INSERT INTO task_boards (id, name, scope, project_id, task_list_id, plan_id, agent_id, lanes, filters, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      scope,
      input.project_id || null,
      input.task_list_id || null,
      input.plan_id || null,
      input.agent_id || null,
      JSON.stringify(lanes),
      JSON.stringify(input.filters || {}),
      timestamp,
      timestamp,
    ],
  );
  return getTaskBoard(id, d)!;
}

export function getTaskBoard(idOrName: string, db?: Database): TaskBoard | null {
  const d = getDatabase(db);
  const row = d
    .query("SELECT * FROM task_boards WHERE id = ? OR name = ?")
    .get(idOrName, idOrName) as TaskBoardRow | null;
  return row ? rowToTaskBoard(row) : null;
}

export function listTaskBoards(query: TaskBoardQuery = {}, db?: Database): TaskBoard[] {
  const d = getDatabase(db);
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (query.scope) { conditions.push("scope = ?"); params.push(query.scope); }
  if (query.project_id) { conditions.push("project_id = ?"); params.push(query.project_id); }
  if (query.task_list_id) { conditions.push("task_list_id = ?"); params.push(query.task_list_id); }
  if (query.plan_id) { conditions.push("plan_id = ?"); params.push(query.plan_id); }
  if (query.agent_id) { conditions.push("agent_id = ?"); params.push(query.agent_id); }
  let sql = "SELECT * FROM task_boards";
  if (conditions.length > 0) sql += ` WHERE ${conditions.join(" AND ")}`;
  sql += " ORDER BY updated_at DESC, name";
  if (query.limit) { sql += " LIMIT ?"; params.push(query.limit); }
  return (d.query(sql).all(...params) as TaskBoardRow[]).map(rowToTaskBoard);
}

export function updateTaskBoard(idOrName: string, input: UpdateTaskBoardInput, db?: Database): TaskBoard {
  const d = getDatabase(db);
  const board = getTaskBoard(idOrName, d);
  if (!board) throw new Error(`Board not found: ${idOrName}`);
  const sets: string[] = ["updated_at = ?"];
  const params: SQLQueryBindings[] = [now()];
  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.project_id !== undefined) { sets.push("project_id = ?"); params.push(input.project_id); }
  if (input.task_list_id !== undefined) { sets.push("task_list_id = ?"); params.push(input.task_list_id); }
  if (input.plan_id !== undefined) { sets.push("plan_id = ?"); params.push(input.plan_id); }
  if (input.agent_id !== undefined) { sets.push("agent_id = ?"); params.push(input.agent_id); }
  if (input.lanes !== undefined) { sets.push("lanes = ?"); params.push(JSON.stringify(normalizeLanes(board.scope, input.lanes))); }
  if (input.filters !== undefined) { sets.push("filters = ?"); params.push(JSON.stringify(input.filters)); }
  params.push(board.id);
  d.run(`UPDATE task_boards SET ${sets.join(", ")} WHERE id = ?`, params);
  return getTaskBoard(board.id, d)!;
}

export function deleteTaskBoard(idOrName: string, db?: Database): boolean {
  const d = getDatabase(db);
  const board = getTaskBoard(idOrName, d);
  if (!board) return false;
  return d.run("DELETE FROM task_boards WHERE id = ?", [board.id]).changes > 0;
}

function incompleteDependencyCount(taskId: string, db: Database): number {
  const row = db
    .query(`SELECT COUNT(*) as count
      FROM task_dependencies td
      JOIN tasks dep ON dep.id = td.depends_on
      WHERE td.task_id = ? AND dep.status NOT IN ('completed', 'cancelled')`)
    .get(taskId) as { count: number };
  return row.count;
}

function taskToCard(task: Task, db: Database): BoardCard {
  const blockedCount = incompleteDependencyCount(task.id, db);
  const blocked = blockedCount > 0;
  const badges: string[] = [task.priority];
  if (blocked) badges.push("blocked");
  if (!blocked && task.status === "pending") badges.push("ready");
  if (task.assigned_to) badges.push(`@${task.assigned_to}`);
  if (task.due_at && Date.parse(task.due_at) < Date.now() && !["completed", "cancelled", "failed"].includes(task.status)) {
    badges.push("overdue");
  }
  return {
    id: task.id,
    short_id: task.short_id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    project_id: task.project_id,
    plan_id: task.plan_id,
    task_list_id: task.task_list_id,
    assigned_to: task.assigned_to,
    blocked,
    ready: !blocked && task.status === "pending",
    badges,
    updated_at: task.updated_at,
  };
}

function planTaskStats(planId: string, db: Database): { total: number; active: number; blocked: number; ready: number } {
  const tasks = listTasks({ plan_id: planId, include_archived: true }, db);
  let blocked = 0;
  let ready = 0;
  for (const task of tasks) {
    const isBlocked = incompleteDependencyCount(task.id, db) > 0;
    if (isBlocked) blocked++;
    if (!isBlocked && task.status === "pending") ready++;
  }
  return {
    total: tasks.length,
    active: tasks.filter((task) => !["completed", "cancelled", "failed"].includes(task.status)).length,
    blocked,
    ready,
  };
}

function planToCard(plan: Plan, db: Database): BoardCard {
  const stats = planTaskStats(plan.id, db);
  const badges = [`tasks:${stats.total}`, `active:${stats.active}`];
  if (stats.blocked > 0) badges.push(`blocked:${stats.blocked}`);
  if (stats.ready > 0) badges.push(`ready:${stats.ready}`);
  return {
    id: plan.id,
    short_id: null,
    title: plan.name,
    status: plan.status,
    priority: null,
    project_id: plan.project_id,
    plan_id: plan.id,
    task_list_id: plan.task_list_id,
    assigned_to: plan.agent_id,
    blocked: stats.blocked > 0,
    ready: stats.ready > 0,
    badges,
    updated_at: plan.updated_at,
  };
}

function filteredTasks(board: TaskBoard, db: Database): Task[] {
  const filters = board.filters;
  return listTasks({
    project_id: board.project_id || maybeFilter<string>(filters.project_id),
    task_list_id: board.task_list_id || maybeFilter<string>(filters.task_list_id),
    plan_id: board.plan_id || maybeFilter<string>(filters.plan_id),
    assigned_to: board.agent_id || maybeFilter<string>(filters.assigned_to),
    agent_id: maybeFilter<string>(filters.agent_id),
    priority: maybeFilter<Task["priority"] | Task["priority"][]>(filters.priority),
    tags: Array.isArray(filters.tags) ? filters.tags.map(String) : undefined,
    task_type: maybeFilter<string | string[]>(filters.task_type),
    include_archived: Boolean(filters.include_archived),
  }, db);
}

function filteredPlans(board: TaskBoard, db: Database): Plan[] {
  return listPlans(board.project_id || undefined, db)
    .filter((plan) => !board.task_list_id || plan.task_list_id === board.task_list_id)
    .filter((plan) => !board.agent_id || plan.agent_id === board.agent_id);
}

function buildLaneSnapshots(board: TaskBoard, cards: BoardCard[]): BoardLaneSnapshot[] {
  return board.lanes.map((lane) => {
    const laneCards = cards.filter((card) => lane.statuses.includes(card.status));
    return {
      lane,
      count: laneCards.length,
      wip_limit: lane.wip_limit,
      wip_exceeded: lane.wip_limit !== null && laneCards.length > lane.wip_limit,
      cards: laneCards,
    };
  });
}

export function buildTaskBoardSnapshot(idOrBoard: string | TaskBoard, db?: Database): BoardSnapshot {
  const d = getDatabase(db);
  const board = typeof idOrBoard === "string" ? getTaskBoard(idOrBoard, d) : idOrBoard;
  if (!board) throw new Error(`Board not found: ${idOrBoard}`);
  const cards = board.scope === "plans"
    ? filteredPlans(board, d).map((plan) => planToCard(plan, d))
    : filteredTasks(board, d).map((task) => taskToCard(task, d));
  const lanes = buildLaneSnapshots(board, cards);
  return {
    board,
    generated_at: now(),
    lanes,
    totals: {
      cards: cards.length,
      blocked: cards.filter((card) => card.blocked).length,
      ready: cards.filter((card) => card.ready).length,
      wip_exceeded_lanes: lanes.filter((lane) => lane.wip_exceeded).length,
    },
    keyboard: {
      move_left: "h",
      move_right: "l",
      move_up: "k",
      move_down: "j",
      open: "enter",
      quit: "q",
    },
  };
}

export function moveBoardCard(input: MoveBoardCardInput, db?: Database): BoardCard {
  const d = getDatabase(db);
  const board = getTaskBoard(input.board_id, d);
  if (!board) throw new Error(`Board not found: ${input.board_id}`);
  const lane = input.lane_id ? board.lanes.find((candidate) => candidate.id === input.lane_id || candidate.name === input.lane_id) : null;
  const status = input.status || lane?.statuses[0];
  if (!status) throw new Error("Target lane or status is required");
  if (board.scope === "plans") {
    const planId = resolvePartialId(d, "plans", input.card_id) || input.card_id;
    const plan = updatePlan(planId, { status: status as Plan["status"] }, d);
    return planToCard(plan, d);
  }
  const taskId = resolvePartialId(d, "tasks", input.card_id) || input.card_id;
  const task = getTask(taskId, d);
  if (!task) throw new Error(`Task not found: ${input.card_id}`);
  const updated = updateTask(task.id, { status: status as TaskStatus, version: task.version }, d);
  return taskToCard(updated, d);
}

export function renderTaskBoard(snapshot: BoardSnapshot): string {
  const lines = [
    `${snapshot.board.name} (${snapshot.board.scope})`,
    `cards:${snapshot.totals.cards} ready:${snapshot.totals.ready} blocked:${snapshot.totals.blocked} wip_exceeded:${snapshot.totals.wip_exceeded_lanes}`,
    `keys: ${snapshot.keyboard.move_left}/${snapshot.keyboard.move_right} lane, ${snapshot.keyboard.move_up}/${snapshot.keyboard.move_down} card, ${snapshot.keyboard.open} open, ${snapshot.keyboard.quit} quit`,
    "",
  ];
  for (const lane of snapshot.lanes) {
    const limit = lane.wip_limit === null ? "" : ` / ${lane.wip_limit}`;
    const marker = lane.wip_exceeded ? " !" : "";
    lines.push(`${lane.lane.name} (${lane.count}${limit})${marker}`);
    for (const card of lane.cards) {
      const id = card.short_id || card.id.slice(0, 8);
      lines.push(`  ${id} ${card.title} [${card.badges.join(", ")}]`);
    }
    if (lane.cards.length === 0) lines.push("  (empty)");
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function exportTaskBoardBundle(idOrName?: string, db?: Database): TaskBoardBundle {
  const d = getDatabase(db);
  const boards = idOrName ? [getTaskBoard(idOrName, d)].filter(Boolean) as TaskBoard[] : listTaskBoards({}, d);
  return {
    kind: "hasna.todos.task-board",
    schemaVersion: 1,
    exportedAt: now(),
    boards,
  };
}

export function importTaskBoardBundle(bundle: TaskBoardBundle, db?: Database): { inserted: number; updated: number; skipped: number } {
  const d = getDatabase(db);
  if (bundle.kind !== "hasna.todos.task-board" || bundle.schemaVersion !== 1 || !Array.isArray(bundle.boards)) {
    throw new Error("Invalid task board bundle");
  }
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const board of bundle.boards) {
    const existing = getTaskBoard(board.id, d) || getTaskBoard(board.name, d);
    if (existing) {
      updateTaskBoard(existing.id, {
        name: board.name,
        project_id: board.project_id,
        task_list_id: board.task_list_id,
        plan_id: board.plan_id,
        agent_id: board.agent_id,
        lanes: board.lanes,
        filters: board.filters,
      }, d);
      updated++;
    } else if (board.name && board.scope) {
      createTaskBoard({
        name: board.name,
        scope: board.scope,
        project_id: board.project_id || undefined,
        task_list_id: board.task_list_id || undefined,
        plan_id: board.plan_id || undefined,
        agent_id: board.agent_id || undefined,
        lanes: board.lanes,
        filters: board.filters,
      }, d);
      inserted++;
    } else {
      skipped++;
    }
  }
  return { inserted, updated, skipped };
}
