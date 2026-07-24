import type { Database } from "bun:sqlite";
import { logTaskChange } from "../db/audit.js";
import { getDatabase, now } from "../db/database.js";
import { getTask, listTasks, updateTask } from "../db/tasks.js";
import type { Task, TaskPriority, TaskStatus } from "../types/index.js";
import { loadConfig, saveConfig, type ReviewRoutingRuleConfig } from "./config.js";
import { databasePathFromDatabase } from "./event-emission-safety.js";
import { emitLocalEventHooksQuiet } from "./event-hooks.js";
import {
  getTaskReview,
  recordTaskReview,
  requestTaskReview,
  type TaskReview,
} from "./task-contracts.js";

export type ReviewQueueState = "requested" | "claimed" | "approved" | "changes_requested" | "returned" | "reopened";

export interface ReviewQueueHistoryEntry {
  state: ReviewQueueState;
  actor: string;
  note: string | null;
  at: string;
}

export interface ReviewQueueMetadata {
  schema_version: 1;
  state: ReviewQueueState;
  queue: string;
  requester: string | null;
  reviewer: string | null;
  claimed_by: string | null;
  reason: string | null;
  notes: string | null;
  changes_requested: string[];
  routing_rule: string | null;
  requested_at: string | null;
  claimed_at: string | null;
  decided_at: string | null;
  updated_at: string;
  history: ReviewQueueHistoryEntry[];
}

export interface ReviewQueueItem {
  task_id: string;
  short_id: string | null;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  project_id: string | null;
  assigned_to: string | null;
  tags: string[];
  queue: string;
  state: ReviewQueueState;
  requester: string | null;
  reviewer: string | null;
  claimed_by: string | null;
  reason: string | null;
  notes: string | null;
  changes_requested: string[];
  routing_rule: string | null;
  requested_at: string | null;
  claimed_at: string | null;
  decided_at: string | null;
  updated_at: string;
  review: TaskReview | null;
}

export interface ReviewQueueListOptions {
  queue?: string;
  state?: ReviewQueueState;
  reviewer?: string;
  requester?: string;
  project_id?: string;
  limit?: number;
}

export interface RequestReviewQueueInput {
  task_id: string;
  requester: string;
  reviewer?: string;
  queue?: string;
  reason?: string;
  notes?: string;
}

export interface ClaimReviewInput {
  task_id: string;
  reviewer: string;
  note?: string;
}

export interface DecideReviewInput {
  task_id: string;
  reviewer: string;
  note?: string;
  changes_requested?: string[];
}

export interface UpsertReviewRoutingRuleInput {
  name: string;
  queue?: string;
  reviewers?: string[];
  tags?: string[];
  priorities?: TaskPriority[];
  project_id?: string;
  enabled?: boolean;
}

const REVIEW_QUEUE_KEY = "_review_queue";
const DEFAULT_QUEUE = "default";
const STATES = new Set<ReviewQueueState>(["requested", "claimed", "approved", "changes_requested", "returned", "reopened"]);
const PRIORITIES = new Set<TaskPriority>(["low", "medium", "high", "critical"]);

function cleanList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))];
}

function cleanPriorityList(values: unknown): TaskPriority[] {
  return cleanList(values).filter((value): value is TaskPriority => PRIORITIES.has(value as TaskPriority));
}

function taskOrThrow(taskId: string, db?: Database): Task {
  const task = getTask(taskId, db);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return task;
}

function normalizeRule(input: UpsertReviewRoutingRuleInput, existing?: ReviewRoutingRuleConfig): ReviewRoutingRuleConfig {
  const timestamp = now();
  const name = input.name.trim();
  if (!name) throw new Error("Review routing rule name is required");
  return {
    name,
    enabled: input.enabled ?? existing?.enabled ?? true,
    queue: (input.queue ?? existing?.queue ?? DEFAULT_QUEUE).trim() || DEFAULT_QUEUE,
    reviewers: input.reviewers === undefined ? existing?.reviewers ?? [] : cleanList(input.reviewers),
    tags: input.tags === undefined ? existing?.tags ?? [] : cleanList(input.tags),
    priorities: input.priorities === undefined ? existing?.priorities ?? [] : cleanPriorityList(input.priorities),
    project_id: input.project_id ?? existing?.project_id ?? null,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
  };
}

function readQueue(task: Task): ReviewQueueMetadata | null {
  const raw = typeof task.metadata[REVIEW_QUEUE_KEY] === "object" && task.metadata[REVIEW_QUEUE_KEY] !== null
    ? task.metadata[REVIEW_QUEUE_KEY] as Record<string, unknown>
    : null;
  if (!raw) return null;
  const state = typeof raw.state === "string" && STATES.has(raw.state as ReviewQueueState)
    ? raw.state as ReviewQueueState
    : "requested";
  return {
    schema_version: 1,
    state,
    queue: typeof raw.queue === "string" && raw.queue.trim() ? raw.queue : DEFAULT_QUEUE,
    requester: typeof raw.requester === "string" ? raw.requester : null,
    reviewer: typeof raw.reviewer === "string" ? raw.reviewer : null,
    claimed_by: typeof raw.claimed_by === "string" ? raw.claimed_by : null,
    reason: typeof raw.reason === "string" ? raw.reason : null,
    notes: typeof raw.notes === "string" ? raw.notes : null,
    changes_requested: cleanList(raw.changes_requested),
    routing_rule: typeof raw.routing_rule === "string" ? raw.routing_rule : null,
    requested_at: typeof raw.requested_at === "string" ? raw.requested_at : null,
    claimed_at: typeof raw.claimed_at === "string" ? raw.claimed_at : null,
    decided_at: typeof raw.decided_at === "string" ? raw.decided_at : null,
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : now(),
    history: Array.isArray(raw.history)
      ? raw.history.map((entry) => {
        const item = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : {};
        const entryState = typeof item.state === "string" && STATES.has(item.state as ReviewQueueState)
          ? item.state as ReviewQueueState
          : state;
        return {
          state: entryState,
          actor: typeof item.actor === "string" ? item.actor : "unknown",
          note: typeof item.note === "string" ? item.note : null,
          at: typeof item.at === "string" ? item.at : now(),
        };
      })
      : [],
  };
}

function ruleMatches(rule: ReviewRoutingRuleConfig, task: Task): boolean {
  if (!rule.enabled) return false;
  if (rule.project_id && rule.project_id !== task.project_id) return false;
  if (rule.priorities.length > 0 && !rule.priorities.includes(task.priority)) return false;
  if (rule.tags.length > 0 && !rule.tags.some((tag) => task.tags.includes(tag))) return false;
  return true;
}

function routeForTask(task: Task): { queue: string; reviewer: string | null; rule: string | null } {
  const rules = listReviewRoutingRules().filter((rule) => ruleMatches(rule, task));
  const rule = rules[0];
  return {
    queue: rule?.queue ?? DEFAULT_QUEUE,
    reviewer: rule?.reviewers[0] ?? null,
    rule: rule?.name ?? null,
  };
}

function writeQueue(task: Task, queue: ReviewQueueMetadata, actor: string, action: string, db?: Database): ReviewQueueItem {
  const d = getDatabase(db);
  updateTask(task.id, {
    version: task.version,
    metadata: {
      ...task.metadata,
      [REVIEW_QUEUE_KEY]: queue,
    },
  }, d);
  logTaskChange(task.id, `review_queue.${action}`, "review_queue", null, JSON.stringify(queue), actor, d);
  emitLocalEventHooksQuiet({
    type: `review.${action}`,
    payload: { task_id: task.id, queue: queue.queue, state: queue.state, reviewer: queue.reviewer, claimed_by: queue.claimed_by },
    databasePath: databasePathFromDatabase(d),
  });
  return itemFromTask(taskOrThrow(task.id, d), queue, d);
}

function appendHistory(queue: ReviewQueueMetadata, state: ReviewQueueState, actor: string, note?: string): ReviewQueueHistoryEntry[] {
  return [...queue.history, { state, actor, note: note ?? null, at: now() }];
}

function itemFromTask(task: Task, queue: ReviewQueueMetadata, db?: Database): ReviewQueueItem {
  return {
    task_id: task.id,
    short_id: task.short_id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    project_id: task.project_id,
    assigned_to: task.assigned_to,
    tags: task.tags,
    queue: queue.queue,
    state: queue.state,
    requester: queue.requester,
    reviewer: queue.reviewer,
    claimed_by: queue.claimed_by,
    reason: queue.reason,
    notes: queue.notes,
    changes_requested: queue.changes_requested,
    routing_rule: queue.routing_rule,
    requested_at: queue.requested_at,
    claimed_at: queue.claimed_at,
    decided_at: queue.decided_at,
    updated_at: queue.updated_at,
    review: getTaskReview(task.id, db) ?? null,
  };
}

function derivedQueue(task: Task, db?: Database): ReviewQueueMetadata | null {
  const existing = readQueue(task);
  if (existing) return existing;
  const review = getTaskReview(task.id, db);
  if (review && review.state !== "none") {
    return {
      schema_version: 1,
      state: review.state === "changes_requested" ? "changes_requested" : review.state === "approved" ? "approved" : review.state === "reopened" ? "reopened" : "requested",
      queue: DEFAULT_QUEUE,
      requester: review.requester,
      reviewer: review.reviewer,
      claimed_by: null,
      reason: null,
      notes: review.notes,
      changes_requested: review.changes_requested,
      routing_rule: null,
      requested_at: review.requested_at,
      claimed_at: null,
      decided_at: review.reviewed_at,
      updated_at: review.reviewed_at ?? review.requested_at ?? task.updated_at,
      history: review.history.map((entry) => ({
        state: entry.state === "approved" ? "approved" : entry.state === "changes_requested" ? "changes_requested" : entry.state === "reopened" ? "reopened" : "requested",
        actor: entry.actor,
        note: entry.notes,
        at: entry.at,
      })),
    };
  }
  if (task.status === "completed" && task.requires_approval && !task.approved_by) {
    const route = routeForTask(task);
    return {
      schema_version: 1,
      state: "requested",
      queue: route.queue,
      requester: task.agent_id ?? task.assigned_to ?? null,
      reviewer: route.reviewer,
      claimed_by: null,
      reason: "completed task requires approval",
      notes: null,
      changes_requested: [],
      routing_rule: route.rule,
      requested_at: task.completed_at ?? task.updated_at,
      claimed_at: null,
      decided_at: null,
      updated_at: task.updated_at,
      history: [],
    };
  }
  if (task.status === "completed" && task.confidence !== null && task.confidence < 0.5) {
    const route = routeForTask(task);
    return {
      schema_version: 1,
      state: "requested",
      queue: route.queue,
      requester: task.agent_id ?? task.assigned_to ?? null,
      reviewer: route.reviewer,
      claimed_by: null,
      reason: `low completion confidence: ${task.confidence}`,
      notes: null,
      changes_requested: [],
      routing_rule: route.rule,
      requested_at: task.completed_at ?? task.updated_at,
      claimed_at: null,
      decided_at: null,
      updated_at: task.updated_at,
      history: [],
    };
  }
  return null;
}

export function listReviewRoutingRules(): ReviewRoutingRuleConfig[] {
  return Object.values(loadConfig().review_routing_rules ?? {})
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function upsertReviewRoutingRule(input: UpsertReviewRoutingRuleInput): ReviewRoutingRuleConfig {
  const config = loadConfig();
  const existing = config.review_routing_rules?.[input.name];
  const rule = normalizeRule(input, existing);
  saveConfig({
    ...config,
    review_routing_rules: {
      ...(config.review_routing_rules ?? {}),
      [rule.name]: rule,
    },
  });
  return rule;
}

export function removeReviewRoutingRule(name: string): boolean {
  const config = loadConfig();
  const rules = { ...(config.review_routing_rules ?? {}) };
  if (!rules[name]) return false;
  delete rules[name];
  saveConfig({ ...config, review_routing_rules: rules });
  return true;
}

export function requestReviewQueue(input: RequestReviewQueueInput, db?: Database): ReviewQueueItem {
  const d = getDatabase(db);
  const task = taskOrThrow(input.task_id, d);
  const route = routeForTask(task);
  requestTaskReview({
    task_id: task.id,
    requester: input.requester,
    reviewer: input.reviewer ?? route.reviewer ?? undefined,
    notes: input.notes ?? input.reason,
  }, d);
  const updatedTask = taskOrThrow(task.id, d);
  const timestamp = now();
  const previous = readQueue(updatedTask);
  const queue: ReviewQueueMetadata = {
    schema_version: 1,
    state: "requested",
    queue: input.queue ?? route.queue,
    requester: input.requester,
    reviewer: input.reviewer ?? route.reviewer,
    claimed_by: null,
    reason: input.reason ?? previous?.reason ?? null,
    notes: input.notes ?? previous?.notes ?? null,
    changes_requested: [],
    routing_rule: route.rule,
    requested_at: timestamp,
    claimed_at: null,
    decided_at: null,
    updated_at: timestamp,
    history: appendHistory(previous ?? {
      schema_version: 1,
      state: "requested",
      queue: input.queue ?? route.queue,
      requester: input.requester,
      reviewer: input.reviewer ?? route.reviewer,
      claimed_by: null,
      reason: null,
      notes: null,
      changes_requested: [],
      routing_rule: route.rule,
      requested_at: null,
      claimed_at: null,
      decided_at: null,
      updated_at: timestamp,
      history: [],
    }, "requested", input.requester, input.notes ?? input.reason),
  };
  return writeQueue(updatedTask, queue, input.requester, "requested", d);
}

export function claimReviewItem(input: ClaimReviewInput, db?: Database): ReviewQueueItem {
  const d = getDatabase(db);
  const task = taskOrThrow(input.task_id, d);
  const previous = derivedQueue(task, d);
  if (!previous) throw new Error(`Task is not in a review queue: ${task.id}`);
  const timestamp = now();
  const queue: ReviewQueueMetadata = {
    ...previous,
    state: "claimed",
    reviewer: input.reviewer,
    claimed_by: input.reviewer,
    claimed_at: timestamp,
    updated_at: timestamp,
    history: appendHistory(previous, "claimed", input.reviewer, input.note),
  };
  return writeQueue(task, queue, input.reviewer, "claimed", d);
}

export function approveReviewItem(input: DecideReviewInput, db?: Database): ReviewQueueItem {
  const d = getDatabase(db);
  const task = taskOrThrow(input.task_id, d);
  const previous = derivedQueue(task, d);
  if (!previous) throw new Error(`Task is not in a review queue: ${task.id}`);
  recordTaskReview({ task_id: task.id, state: "approved", reviewer: input.reviewer, notes: input.note }, d);
  const updatedTask = taskOrThrow(task.id, d);
  const timestamp = now();
  const queue: ReviewQueueMetadata = {
    ...previous,
    state: "approved",
    reviewer: input.reviewer,
    claimed_by: previous.claimed_by ?? input.reviewer,
    changes_requested: [],
    decided_at: timestamp,
    updated_at: timestamp,
    history: appendHistory(previous, "approved", input.reviewer, input.note),
  };
  return writeQueue(updatedTask, queue, input.reviewer, "approved", d);
}

export function returnReviewItem(input: DecideReviewInput, db?: Database): ReviewQueueItem {
  const d = getDatabase(db);
  const task = taskOrThrow(input.task_id, d);
  const previous = derivedQueue(task, d);
  if (!previous) throw new Error(`Task is not in a review queue: ${task.id}`);
  const changes = cleanList(input.changes_requested);
  recordTaskReview({
    task_id: task.id,
    state: "changes_requested",
    reviewer: input.reviewer,
    notes: input.note,
    changes_requested: changes,
  }, d);
  const updatedTask = taskOrThrow(task.id, d);
  const timestamp = now();
  const queue: ReviewQueueMetadata = {
    ...previous,
    state: "returned",
    reviewer: input.reviewer,
    claimed_by: previous.claimed_by ?? input.reviewer,
    changes_requested: changes,
    decided_at: timestamp,
    updated_at: timestamp,
    history: appendHistory(previous, "returned", input.reviewer, input.note),
  };
  return writeQueue(updatedTask, queue, input.reviewer, "returned", d);
}

export function reopenReviewItem(input: DecideReviewInput, db?: Database): ReviewQueueItem {
  const d = getDatabase(db);
  const task = taskOrThrow(input.task_id, d);
  const previous = derivedQueue(task, d);
  if (!previous) throw new Error(`Task is not in a review queue: ${task.id}`);
  recordTaskReview({ task_id: task.id, state: "reopened", reviewer: input.reviewer, notes: input.note }, d);
  const updatedTask = taskOrThrow(task.id, d);
  const timestamp = now();
  const queue: ReviewQueueMetadata = {
    ...previous,
    state: "reopened",
    reviewer: input.reviewer,
    claimed_by: null,
    changes_requested: [],
    decided_at: timestamp,
    updated_at: timestamp,
    history: appendHistory(previous, "reopened", input.reviewer, input.note),
  };
  return writeQueue(updatedTask, queue, input.reviewer, "reopened", d);
}

export function listReviewQueue(options: ReviewQueueListOptions = {}, db?: Database): ReviewQueueItem[] {
  const d = getDatabase(db);
  const tasks = listTasks({
    project_id: options.project_id,
    include_archived: false,
  }, d);
  const items = tasks.flatMap((task) => {
    const queue = derivedQueue(task, d);
    return queue ? [itemFromTask(task, queue, d)] : [];
  }).filter((item) => {
    if (options.queue && item.queue !== options.queue) return false;
    if (options.state && item.state !== options.state) return false;
    if (options.reviewer && item.reviewer !== options.reviewer && item.claimed_by !== options.reviewer) return false;
    if (options.requester && item.requester !== options.requester) return false;
    return true;
  });
  const activeFirst = items.sort((left, right) => {
    const stateRank: Record<ReviewQueueState, number> = {
      requested: 0,
      claimed: 1,
      returned: 2,
      changes_requested: 3,
      reopened: 4,
      approved: 5,
    };
    return stateRank[left.state] - stateRank[right.state] || right.updated_at.localeCompare(left.updated_at);
  });
  return options.limit ? activeFirst.slice(0, options.limit) : activeFirst;
}
