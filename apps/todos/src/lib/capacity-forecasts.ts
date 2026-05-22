import type { Database } from "bun:sqlite";
import { listTasks } from "../db/tasks.js";
import { getTimeReport } from "../db/task-relations.js";
import type { Task } from "../types/index.js";
import {
  loadConfig,
  saveConfig,
  type LocalCapacityProfileConfig,
  type LocalCapacityStoreConfig,
} from "./config.js";

export type {
  LocalCapacityProfileConfig,
  LocalCapacityStoreConfig,
} from "./config.js";

export const LOCAL_CAPACITY_SCHEMA_VERSION = 1;

export type ForecastRiskFlag =
  | "missing_estimates"
  | "no_capacity"
  | "forecast_past_due"
  | "over_budget"
  | "open_tasks_overdue";

export interface UpsertCapacityProfileInput {
  agent_id: string;
  project_id?: string | null;
  minutes_per_day: number;
  working_days?: number[];
  effective_from?: string | null;
}

export interface CapacityProfileQuery {
  agent_id?: string;
  project_id?: string;
}

export interface PlanningForecastInput {
  project_id?: string;
  plan_id?: string;
  agent_id?: string;
  start_date?: string;
}

export interface PlanningForecastTask {
  task_id: string;
  title: string;
  status: string;
  project_id: string | null;
  plan_id: string | null;
  assigned_to: string | null;
  agent_id: string | null;
  due_at: string | null;
  estimated_minutes: number | null;
  actual_minutes: number | null;
  remaining_estimated_minutes: number;
  missing_estimate: boolean;
  overdue: boolean;
}

export interface PlanningForecast {
  schema_version: typeof LOCAL_CAPACITY_SCHEMA_VERSION;
  local_only: true;
  generated_at: string;
  filters: {
    project_id: string | null;
    plan_id: string | null;
    agent_id: string | null;
    start_date: string;
  };
  capacity_profiles: LocalCapacityProfileConfig[];
  capacity_minutes_per_day: number;
  task_count: number;
  open_task_count: number;
  completed_task_count: number;
  estimated_minutes: number;
  remaining_estimated_minutes: number;
  actual_minutes: number;
  logged_minutes: number;
  missing_estimate_count: number;
  overdue_open_task_count: number;
  forecast_work_days: number | null;
  forecast_completion_date: string | null;
  earliest_due_at: string | null;
  risk_flags: ForecastRiskFlag[];
  tasks: PlanningForecastTask[];
}

function timestamp(): string {
  return new Date().toISOString();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function cleanString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readStore(): LocalCapacityStoreConfig {
  const store = loadConfig().local_capacity;
  return { profiles: { ...(store?.profiles ?? {}) } };
}

function writeStore(store: LocalCapacityStoreConfig): void {
  const config = loadConfig();
  saveConfig({ ...config, local_capacity: store });
}

function profileKey(agentId: string, projectId?: string | null): string {
  return `${projectId || "global"}:${agentId}`;
}

function normalizeWorkingDays(days?: number[]): number[] {
  const normalized = [...new Set((days?.length ? days : [1, 2, 3, 4, 5])
    .map((day) => Math.floor(Number(day)))
    .filter((day) => day >= 0 && day <= 6))]
    .sort((left, right) => left - right);
  if (normalized.length === 0) throw new Error("working_days must include at least one day from 0 to 6");
  return normalized;
}

function assertMinutes(value: number): number {
  if (!Number.isFinite(value) || value < 1) throw new Error("minutes_per_day must be a positive integer");
  return Math.floor(value);
}

function matchesProfile(profile: LocalCapacityProfileConfig, query: CapacityProfileQuery): boolean {
  if (query.agent_id && profile.agent_id !== query.agent_id) return false;
  if (query.project_id && profile.project_id !== query.project_id) return false;
  return true;
}

function taskMatchesAgent(task: Task, agentId?: string): boolean {
  if (!agentId) return true;
  return task.assigned_to === agentId || task.agent_id === agentId;
}

function estimateRemaining(task: Task): number {
  if (task.status === "completed" || task.status === "cancelled") return 0;
  if (task.estimated_minutes == null) return 0;
  return Math.max(0, task.estimated_minutes - (task.actual_minutes ?? 0));
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function addWorkingDays(startDate: string, workDays: number, workingDays: number[]): string | null {
  if (workDays < 1) return startDate;
  const date = new Date(`${startDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  const working = new Set(workingDays);
  let remaining = workDays;
  while (remaining > 0) {
    const day = date.getUTCDay();
    if (working.has(day)) remaining -= 1;
    if (remaining > 0) date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

function uniqueWorkingDays(profiles: LocalCapacityProfileConfig[]): number[] {
  return normalizeWorkingDays(profiles.flatMap((profile) => profile.working_days));
}

export function upsertCapacityProfile(input: UpsertCapacityProfileInput): LocalCapacityProfileConfig {
  const agentId = input.agent_id.trim();
  if (!agentId) throw new Error("agent_id is required");
  const projectId = cleanString(input.project_id);
  const store = readStore();
  const key = profileKey(agentId, projectId);
  const existing = store.profiles[key];
  const now = timestamp();
  const profile: LocalCapacityProfileConfig = {
    id: existing?.id ?? key,
    agent_id: agentId,
    project_id: projectId,
    minutes_per_day: assertMinutes(input.minutes_per_day),
    working_days: normalizeWorkingDays(input.working_days),
    effective_from: cleanString(input.effective_from),
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  store.profiles[key] = profile;
  writeStore(store);
  return profile;
}

export function listCapacityProfiles(query: CapacityProfileQuery = {}): LocalCapacityProfileConfig[] {
  return Object.values(readStore().profiles)
    .filter((profile) => matchesProfile(profile, query))
    .sort((left, right) => (left.project_id ?? "").localeCompare(right.project_id ?? "") || left.agent_id.localeCompare(right.agent_id));
}

export function removeCapacityProfile(idOrAgent: string, projectId?: string | null): boolean {
  const store = readStore();
  const key = projectId !== undefined ? profileKey(idOrAgent, cleanString(projectId)) : undefined;
  const match = key && store.profiles[key]
    ? key
    : Object.entries(store.profiles).find(([, profile]) => profile.id === idOrAgent || profile.agent_id === idOrAgent)?.[0];
  if (!match) return false;
  delete store.profiles[match];
  writeStore(store);
  return true;
}

export function getPlanningForecast(input: PlanningForecastInput = {}, db?: Database): PlanningForecast {
  const startDate = input.start_date ? dateOnly(input.start_date) : todayIso();
  const tasks = listTasks({ project_id: input.project_id, plan_id: input.plan_id, limit: 10000 }, db)
    .filter((task) => taskMatchesAgent(task, input.agent_id));
  const reportByTask = new Map(getTimeReport({ project_id: input.project_id, plan_id: input.plan_id, agent_id: input.agent_id, include_open: true }, db).map((entry) => [entry.task_id, entry]));
  const profiles = listCapacityProfiles({ agent_id: input.agent_id, project_id: input.project_id });
  const globalProfiles = input.project_id ? listCapacityProfiles({ agent_id: input.agent_id }).filter((profile) => profile.project_id === null) : [];
  const capacityProfiles = profiles.length > 0 ? profiles : globalProfiles;
  const capacityMinutesPerDay = capacityProfiles.reduce((sum, profile) => sum + profile.minutes_per_day, 0);
  const forecastTasks: PlanningForecastTask[] = tasks.map((task) => {
    const report = reportByTask.get(task.id);
    const actual = report?.actual_minutes ?? task.actual_minutes;
    const due = task.due_at ? dateOnly(task.due_at) : null;
    return {
      task_id: task.id,
      title: task.title,
      status: task.status,
      project_id: task.project_id,
      plan_id: task.plan_id,
      assigned_to: task.assigned_to,
      agent_id: task.agent_id,
      due_at: due,
      estimated_minutes: task.estimated_minutes,
      actual_minutes: actual,
      remaining_estimated_minutes: estimateRemaining({ ...task, actual_minutes: actual }),
      missing_estimate: task.estimated_minutes == null && task.status !== "completed" && task.status !== "cancelled",
      overdue: Boolean(due && due < startDate && task.status !== "completed" && task.status !== "cancelled"),
    };
  });
  const estimatedMinutes = forecastTasks.reduce((sum, task) => sum + (task.estimated_minutes ?? 0), 0);
  const remainingEstimatedMinutes = forecastTasks.reduce((sum, task) => sum + task.remaining_estimated_minutes, 0);
  const actualMinutes = forecastTasks.reduce((sum, task) => sum + (task.actual_minutes ?? 0), 0);
  const loggedMinutes = [...reportByTask.values()].reduce((sum, entry) => sum + entry.logged_minutes, 0);
  const missingEstimateCount = forecastTasks.filter((task) => task.missing_estimate).length;
  const overdueOpenTaskCount = forecastTasks.filter((task) => task.overdue).length;
  const forecastWorkDays = capacityMinutesPerDay > 0 ? Math.ceil(remainingEstimatedMinutes / capacityMinutesPerDay) : null;
  const forecastCompletionDate = forecastWorkDays === null
    ? null
    : addWorkingDays(startDate, forecastWorkDays, uniqueWorkingDays(capacityProfiles));
  const dueDates = forecastTasks.map((task) => task.due_at).filter((value): value is string => Boolean(value)).sort();
  const earliestDueAt = dueDates[0] ?? null;
  const riskFlags: ForecastRiskFlag[] = [];
  if (missingEstimateCount > 0) riskFlags.push("missing_estimates");
  if (capacityMinutesPerDay === 0 && remainingEstimatedMinutes > 0) riskFlags.push("no_capacity");
  if (forecastCompletionDate && earliestDueAt && forecastCompletionDate > earliestDueAt) riskFlags.push("forecast_past_due");
  if (actualMinutes > estimatedMinutes && estimatedMinutes > 0) riskFlags.push("over_budget");
  if (overdueOpenTaskCount > 0) riskFlags.push("open_tasks_overdue");
  return {
    schema_version: LOCAL_CAPACITY_SCHEMA_VERSION,
    local_only: true,
    generated_at: timestamp(),
    filters: {
      project_id: input.project_id ?? null,
      plan_id: input.plan_id ?? null,
      agent_id: input.agent_id ?? null,
      start_date: startDate,
    },
    capacity_profiles: capacityProfiles,
    capacity_minutes_per_day: capacityMinutesPerDay,
    task_count: forecastTasks.length,
    open_task_count: forecastTasks.filter((task) => task.status !== "completed" && task.status !== "cancelled").length,
    completed_task_count: forecastTasks.filter((task) => task.status === "completed").length,
    estimated_minutes: estimatedMinutes,
    remaining_estimated_minutes: remainingEstimatedMinutes,
    actual_minutes: actualMinutes,
    logged_minutes: loggedMinutes,
    missing_estimate_count: missingEstimateCount,
    overdue_open_task_count: overdueOpenTaskCount,
    forecast_work_days: forecastWorkDays,
    forecast_completion_date: forecastCompletionDate,
    earliest_due_at: earliestDueAt,
    risk_flags: riskFlags,
    tasks: forecastTasks,
  };
}

export function renderPlanningForecastMarkdown(forecast: PlanningForecast): string {
  const lines = [
    "# Planning Forecast",
    "",
    `Tasks: ${forecast.completed_task_count}/${forecast.task_count} completed`,
    `Remaining estimate: ${forecast.remaining_estimated_minutes}m`,
    `Capacity: ${forecast.capacity_minutes_per_day}m/day`,
    `Forecast completion: ${forecast.forecast_completion_date ?? "unknown"}`,
    `Risks: ${forecast.risk_flags.length > 0 ? forecast.risk_flags.join(", ") : "none"}`,
    "",
    "## Tasks",
    "",
  ];
  if (forecast.tasks.length === 0) lines.push("- No tasks matched.");
  for (const task of forecast.tasks) {
    lines.push(`- ${task.status} ${task.title}: remaining ${task.remaining_estimated_minutes}m${task.due_at ? ` due ${task.due_at}` : ""}`);
  }
  return lines.join("\n");
}
