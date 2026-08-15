import type { Database } from "bun:sqlite";
import { getTaskTraceability } from "../db/task-commits.js";
import { now } from "../db/database.js";
import { getTask, updateTask } from "../db/tasks.js";

export type TaskRiskLevel = "low" | "medium" | "high" | "critical";
export type TaskReviewState = "none" | "requested" | "approved" | "changes_requested" | "reopened";
export type RecordableTaskReviewState = Exclude<TaskReviewState, "none" | "requested">;

export interface SetTaskContractInput {
  task_id: string;
  acceptance_criteria?: string[];
  verification_commands?: string[];
  expected_artifacts?: string[];
  relevant_files?: string[];
  risk_level?: TaskRiskLevel;
  done_definition?: string[];
}

export interface TaskContract {
  task_id: string;
  acceptance_criteria: string[];
  verification_commands: string[];
  expected_artifacts: string[];
  relevant_files: string[];
  risk_level: TaskRiskLevel | null;
  done_definition: string[];
  updated_at: string;
}

export interface RequestTaskReviewInput {
  task_id: string;
  requester: string;
  reviewer?: string;
  notes?: string;
}

export interface RecordTaskReviewInput {
  task_id: string;
  state: RecordableTaskReviewState;
  reviewer: string;
  notes?: string;
  changes_requested?: string[];
}

export interface TaskReviewHistoryEntry {
  state: Exclude<TaskReviewState, "none">;
  actor: string;
  notes: string | null;
  changes_requested: string[];
  at: string;
}

export interface TaskReview {
  task_id: string;
  state: TaskReviewState;
  requester: string | null;
  reviewer: string | null;
  notes: string | null;
  changes_requested: string[];
  requested_at: string | null;
  reviewed_at: string | null;
  history: TaskReviewHistoryEntry[];
}

export interface TaskDoneContractResult {
  ok: boolean;
  task_id: string;
  missing: string[];
  contract: TaskContract;
  review: TaskReview;
  evidence: {
    task_status: string;
    acceptance_criteria: number;
    passed_verifications: string[];
    artifacts: string[];
    review_state: TaskReviewState;
  };
}

const CONTRACT_KEY = "_contract";
const REVIEW_KEY = "_review";
const RISK_LEVELS = new Set<TaskRiskLevel>(["low", "medium", "high", "critical"]);

function cleanList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))];
}

function cleanRisk(value: unknown): TaskRiskLevel | null {
  return typeof value === "string" && RISK_LEVELS.has(value as TaskRiskLevel) ? value as TaskRiskLevel : null;
}

function taskOrThrow(taskId: string, db?: Database) {
  const task = getTask(taskId, db);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return task;
}

function emptyContract(taskId: string): TaskContract {
  return {
    task_id: taskId,
    acceptance_criteria: [],
    verification_commands: [],
    expected_artifacts: [],
    relevant_files: [],
    risk_level: null,
    done_definition: [],
    updated_at: now(),
  };
}

function emptyReview(taskId: string): TaskReview {
  return {
    task_id: taskId,
    state: "none",
    requester: null,
    reviewer: null,
    notes: null,
    changes_requested: [],
    requested_at: null,
    reviewed_at: null,
    history: [],
  };
}

function readContract(taskId: string, metadata: Record<string, unknown>): TaskContract {
  const raw = typeof metadata[CONTRACT_KEY] === "object" && metadata[CONTRACT_KEY] !== null
    ? metadata[CONTRACT_KEY] as Record<string, unknown>
    : {};
  return {
    task_id: taskId,
    acceptance_criteria: cleanList(raw.acceptance_criteria ?? metadata.acceptance_criteria ?? metadata.acceptanceCriteria ?? metadata.criteria),
    verification_commands: cleanList(raw.verification_commands),
    expected_artifacts: cleanList(raw.expected_artifacts),
    relevant_files: cleanList(raw.relevant_files),
    risk_level: cleanRisk(raw.risk_level),
    done_definition: cleanList(raw.done_definition),
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : now(),
  };
}

function readReview(taskId: string, metadata: Record<string, unknown>): TaskReview {
  const raw = typeof metadata[REVIEW_KEY] === "object" && metadata[REVIEW_KEY] !== null
    ? metadata[REVIEW_KEY] as Record<string, unknown>
    : {};
  const state = typeof raw.state === "string" && ["requested", "approved", "changes_requested", "reopened"].includes(raw.state)
    ? raw.state as TaskReviewState
    : "none";
  const history = Array.isArray(raw.history)
    ? raw.history.map((entry) => {
      const item = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : {};
      return {
        state: typeof item.state === "string" && item.state !== "none" ? item.state as Exclude<TaskReviewState, "none"> : "requested",
        actor: typeof item.actor === "string" ? item.actor : "unknown",
        notes: typeof item.notes === "string" ? item.notes : null,
        changes_requested: cleanList(item.changes_requested),
        at: typeof item.at === "string" ? item.at : now(),
      };
    })
    : [];
  return {
    task_id: taskId,
    state,
    requester: typeof raw.requester === "string" ? raw.requester : null,
    reviewer: typeof raw.reviewer === "string" ? raw.reviewer : null,
    notes: typeof raw.notes === "string" ? raw.notes : null,
    changes_requested: cleanList(raw.changes_requested),
    requested_at: typeof raw.requested_at === "string" ? raw.requested_at : null,
    reviewed_at: typeof raw.reviewed_at === "string" ? raw.reviewed_at : null,
    history,
  };
}

function writeMetadata(taskId: string, metadata: Record<string, unknown>, db?: Database): void {
  const task = taskOrThrow(taskId, db);
  updateTask(taskId, { version: task.version, metadata }, db);
}

export function setTaskContract(input: SetTaskContractInput, db?: Database): TaskContract {
  const task = taskOrThrow(input.task_id, db);
  const current = readContract(task.id, task.metadata);
  const contract: TaskContract = {
    task_id: task.id,
    acceptance_criteria: input.acceptance_criteria === undefined ? current.acceptance_criteria : cleanList(input.acceptance_criteria),
    verification_commands: input.verification_commands === undefined ? current.verification_commands : cleanList(input.verification_commands),
    expected_artifacts: input.expected_artifacts === undefined ? current.expected_artifacts : cleanList(input.expected_artifacts),
    relevant_files: input.relevant_files === undefined ? current.relevant_files : cleanList(input.relevant_files),
    risk_level: input.risk_level === undefined ? current.risk_level : cleanRisk(input.risk_level),
    done_definition: input.done_definition === undefined ? current.done_definition : cleanList(input.done_definition),
    updated_at: now(),
  };
  const metadata = {
    ...task.metadata,
    acceptance_criteria: contract.acceptance_criteria,
    [CONTRACT_KEY]: contract,
  };
  writeMetadata(task.id, metadata, db);
  return contract;
}

export function getTaskContract(taskId: string, db?: Database): TaskContract | null {
  const task = getTask(taskId, db);
  if (!task) return null;
  const contract = readContract(task.id, task.metadata);
  return contract.acceptance_criteria.length > 0
    || contract.verification_commands.length > 0
    || contract.expected_artifacts.length > 0
    || contract.relevant_files.length > 0
    || contract.risk_level !== null
    || contract.done_definition.length > 0
    ? contract
    : null;
}

export function requestTaskReview(input: RequestTaskReviewInput, db?: Database): TaskReview {
  const task = taskOrThrow(input.task_id, db);
  const timestamp = now();
  const previous = readReview(task.id, task.metadata);
  const entry: TaskReviewHistoryEntry = {
    state: "requested",
    actor: input.requester,
    notes: input.notes ?? null,
    changes_requested: [],
    at: timestamp,
  };
  const review: TaskReview = {
    task_id: task.id,
    state: "requested",
    requester: input.requester,
    reviewer: input.reviewer ?? previous.reviewer,
    notes: input.notes ?? previous.notes,
    changes_requested: [],
    requested_at: timestamp,
    reviewed_at: null,
    history: [...previous.history, entry],
  };
  writeMetadata(task.id, { ...task.metadata, [REVIEW_KEY]: review }, db);
  return review;
}

export function recordTaskReview(input: RecordTaskReviewInput, db?: Database): TaskReview {
  const task = taskOrThrow(input.task_id, db);
  const timestamp = now();
  const previous = readReview(task.id, task.metadata);
  const changes = cleanList(input.changes_requested);
  const entry: TaskReviewHistoryEntry = {
    state: input.state,
    actor: input.reviewer,
    notes: input.notes ?? null,
    changes_requested: changes,
    at: timestamp,
  };
  const review: TaskReview = {
    task_id: task.id,
    state: input.state,
    requester: previous.requester,
    reviewer: input.reviewer,
    notes: input.notes ?? previous.notes,
    changes_requested: input.state === "changes_requested" ? changes : [],
    requested_at: previous.requested_at,
    reviewed_at: timestamp,
    history: [...previous.history, entry],
  };
  writeMetadata(task.id, { ...task.metadata, [REVIEW_KEY]: review }, db);
  return review;
}

export function getTaskReview(taskId: string, db?: Database): TaskReview | null {
  const task = getTask(taskId, db);
  if (!task) return null;
  const review = readReview(task.id, task.metadata);
  return review.state === "none" ? null : review;
}

export function checkTaskDoneContract(taskId: string, db?: Database): TaskDoneContractResult {
  const task = taskOrThrow(taskId, db);
  const contract = getTaskContract(task.id, db) ?? emptyContract(task.id);
  const review = getTaskReview(task.id, db) ?? emptyReview(task.id);
  const trace = getTaskTraceability(task.id, db);
  const passedVerifications = trace.verifications
    .filter((verification) => verification.status === "passed")
    .map((verification) => verification.command);
  const artifacts = trace.verifications
    .map((verification) => verification.artifact_path)
    .filter((artifact): artifact is string => typeof artifact === "string" && artifact.length > 0);
  const missing: string[] = [];

  if (task.status !== "completed") missing.push("task_status_completed");
  for (const command of contract.verification_commands) {
    if (!passedVerifications.includes(command)) missing.push(`passed_verification:${command}`);
  }
  for (const artifact of contract.expected_artifacts) {
    if (!artifacts.includes(artifact)) missing.push(`artifact:${artifact}`);
  }
  const hasExplicitReview = review.state !== "none" || contract.done_definition.some((item) => /review/i.test(item));
  const requiresReview = task.requires_approval || hasExplicitReview;
  if (hasExplicitReview) {
    if (review.state !== "approved") missing.push("review_approved");
  } else if (requiresReview && !task.approved_by) {
    missing.push("review_approved");
  }

  return {
    ok: missing.length === 0,
    task_id: task.id,
    missing,
    contract,
    review,
    evidence: {
      task_status: task.status,
      acceptance_criteria: contract.acceptance_criteria.length,
      passed_verifications: passedVerifications,
      artifacts,
      review_state: review.state,
    },
  };
}
