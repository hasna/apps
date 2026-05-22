import type { Database } from "bun:sqlite";
import { getBlockingDeps } from "../db/task-lifecycle.js";
import { getTask, listTasks } from "../db/tasks.js";
import { getPlan, listPlans } from "../db/plans.js";
import { getTaskRun, listTaskRuns } from "../db/task-runs.js";
import type { Task, Plan } from "../types/index.js";
import {
  loadConfig,
  saveConfig,
  type LocalMilestoneConfig,
  type LocalMilestoneStatus,
  type LocalReleaseGroupConfig,
  type LocalRoadmapConfig,
  type LocalRoadmapStatus,
  type LocalRoadmapStoreConfig,
} from "./config.js";

export type {
  LocalMilestoneConfig,
  LocalMilestoneStatus,
  LocalReleaseGroupConfig,
  LocalRoadmapConfig,
  LocalRoadmapStatus,
  LocalRoadmapStoreConfig,
} from "./config.js";

export const LOCAL_ROADMAP_SCHEMA_VERSION = 1;

export interface CreateRoadmapInput {
  name: string;
  description?: string;
  project_id?: string;
  status?: LocalRoadmapStatus;
  owner?: string;
  agent_id?: string;
  release?: string;
}

export interface UpdateRoadmapInput {
  name?: string;
  description?: string | null;
  project_id?: string | null;
  status?: LocalRoadmapStatus;
  owner?: string | null;
  agent_id?: string | null;
  release?: string | null;
}

export interface CreateMilestoneInput {
  roadmap_id: string;
  title: string;
  description?: string;
  due_at?: string;
  status?: LocalMilestoneStatus;
  owner?: string;
  agent_id?: string;
  task_ids?: string[];
  plan_ids?: string[];
  run_ids?: string[];
  release?: string;
  tags?: string[];
}

export interface UpdateMilestoneInput {
  title?: string;
  description?: string | null;
  due_at?: string | null;
  status?: LocalMilestoneStatus;
  owner?: string | null;
  agent_id?: string | null;
  task_ids?: string[];
  plan_ids?: string[];
  run_ids?: string[];
  release?: string | null;
  tags?: string[];
}

export interface UpsertReleaseGroupInput {
  roadmap_id: string;
  name: string;
  version?: string;
  status?: LocalMilestoneStatus;
  milestone_ids?: string[];
  task_ids?: string[];
  plan_ids?: string[];
  run_ids?: string[];
  notes?: string;
}

export interface RoadmapProgressSummary {
  task_count: number;
  completed_count: number;
  in_progress_count: number;
  pending_count: number;
  blocked_count: number;
  plan_count: number;
  run_count: number;
  percent_complete: number;
  readiness: "empty" | "ready" | "blocked" | "in_progress" | "complete";
}

export interface MilestoneSummary extends LocalMilestoneConfig {
  tasks: Task[];
  plans: Plan[];
  runs: Array<NonNullable<ReturnType<typeof getTaskRun>>>;
  blockers: Array<{ task_id: string; blockers: Array<{ id: string; title: string; status: string }> }>;
  progress: RoadmapProgressSummary;
}

export interface RoadmapSummary extends LocalRoadmapConfig {
  milestones: MilestoneSummary[];
  releases: LocalReleaseGroupConfig[];
  progress: RoadmapProgressSummary;
}

export interface RoadmapBundle {
  schema_version: typeof LOCAL_ROADMAP_SCHEMA_VERSION;
  kind: "hasna.todos.roadmap-bundle";
  local_only: true;
  exported_at: string;
  roadmap: LocalRoadmapConfig;
  milestones: LocalMilestoneConfig[];
  releases: LocalReleaseGroupConfig[];
}

export interface ImportRoadmapBundleResult {
  applied: boolean;
  roadmap_id: string;
  milestones: number;
  releases: number;
}

function timestamp(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function cleanString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))];
}

function readStore(): LocalRoadmapStoreConfig {
  const store = loadConfig().local_roadmaps;
  return {
    roadmaps: { ...(store?.roadmaps ?? {}) },
    milestones: { ...(store?.milestones ?? {}) },
    releases: { ...(store?.releases ?? {}) },
  };
}

function writeStore(store: LocalRoadmapStoreConfig): void {
  const config = loadConfig();
  saveConfig({ ...config, local_roadmaps: store });
}

function assertRoadmap(id: string, store = readStore()): LocalRoadmapConfig {
  const roadmap = store.roadmaps[id];
  if (!roadmap) throw new Error(`Roadmap not found: ${id}`);
  return roadmap;
}

function resolveRoadmapId(idOrName: string, store = readStore()): string {
  if (store.roadmaps[idOrName]) return idOrName;
  const matches = Object.values(store.roadmaps).filter((roadmap) => roadmap.id.startsWith(idOrName) || roadmap.name === idOrName);
  if (matches.length === 0) throw new Error(`Roadmap not found: ${idOrName}`);
  if (matches.length > 1) throw new Error(`Roadmap ID is ambiguous: ${idOrName}`);
  return matches[0]!.id;
}

function resolveMilestoneId(idOrTitle: string, store = readStore()): string {
  if (store.milestones[idOrTitle]) return idOrTitle;
  const matches = Object.values(store.milestones).filter((milestone) => milestone.id.startsWith(idOrTitle) || milestone.title === idOrTitle);
  if (matches.length === 0) throw new Error(`Milestone not found: ${idOrTitle}`);
  if (matches.length > 1) throw new Error(`Milestone ID is ambiguous: ${idOrTitle}`);
  return matches[0]!.id;
}

function releaseKey(roadmapId: string, name: string): string {
  return `${roadmapId}:${name}`;
}

function isMilestone(value: LocalMilestoneConfig | undefined): value is LocalMilestoneConfig {
  return value !== undefined;
}

function taskIdsForRoadmap(roadmap: LocalRoadmapConfig, milestones: LocalMilestoneConfig[], releases: LocalReleaseGroupConfig[], db?: Database): string[] {
  return cleanList([
    ...milestones.flatMap((milestone) => milestone.task_ids),
    ...releases.flatMap((release) => release.task_ids),
    ...listTasks({ project_id: roadmap.project_id ?? undefined }, db).filter((task) => task.metadata["roadmap_id"] === roadmap.id).map((task) => task.id),
  ]);
}

function summarizeTasks(taskIds: string[], planIds: string[], runIds: string[], db?: Database): RoadmapProgressSummary {
  const tasks = taskIds.map((id) => getTask(id, db)).filter(Boolean) as Task[];
  const blocked = tasks.filter((task) => getBlockingDeps(task.id, db).length > 0);
  const completed = tasks.filter((task) => task.status === "completed");
  const inProgress = tasks.filter((task) => task.status === "in_progress");
  const pending = tasks.filter((task) => task.status === "pending");
  const taskCount = tasks.length;
  const percent = taskCount === 0 ? 0 : Math.round((completed.length / taskCount) * 100);
  return {
    task_count: taskCount,
    completed_count: completed.length,
    in_progress_count: inProgress.length,
    pending_count: pending.length,
    blocked_count: blocked.length,
    plan_count: planIds.length,
    run_count: runIds.length,
    percent_complete: percent,
    readiness: taskCount === 0
      ? "empty"
      : blocked.length > 0
        ? "blocked"
        : completed.length === taskCount
          ? "complete"
          : inProgress.length > 0
            ? "in_progress"
            : "ready",
  };
}

export function createRoadmap(input: CreateRoadmapInput): LocalRoadmapConfig {
  const name = input.name.trim();
  if (!name) throw new Error("Roadmap name is required");
  const store = readStore();
  const now = timestamp();
  const roadmap: LocalRoadmapConfig = {
    id: newId("roadmap"),
    name,
    description: cleanString(input.description),
    project_id: cleanString(input.project_id),
    status: input.status ?? "planned",
    owner: cleanString(input.owner),
    agent_id: cleanString(input.agent_id),
    release: cleanString(input.release),
    milestone_ids: [],
    created_at: now,
    updated_at: now,
  };
  store.roadmaps[roadmap.id] = roadmap;
  writeStore(store);
  return roadmap;
}

export function listRoadmaps(options: { project_id?: string; status?: LocalRoadmapStatus } = {}): LocalRoadmapConfig[] {
  return Object.values(readStore().roadmaps)
    .filter((roadmap) => !options.project_id || roadmap.project_id === options.project_id)
    .filter((roadmap) => !options.status || roadmap.status === options.status)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at) || left.name.localeCompare(right.name));
}

export function getRoadmap(idOrName: string): LocalRoadmapConfig | null {
  const store = readStore();
  try {
    return store.roadmaps[resolveRoadmapId(idOrName, store)] ?? null;
  } catch {
    return null;
  }
}

export function updateRoadmap(idOrName: string, input: UpdateRoadmapInput): LocalRoadmapConfig {
  const store = readStore();
  const id = resolveRoadmapId(idOrName, store);
  const existing = assertRoadmap(id, store);
  const updated: LocalRoadmapConfig = {
    ...existing,
    name: input.name?.trim() || existing.name,
    description: input.description === undefined ? existing.description : cleanString(input.description),
    project_id: input.project_id === undefined ? existing.project_id : cleanString(input.project_id),
    status: input.status ?? existing.status,
    owner: input.owner === undefined ? existing.owner : cleanString(input.owner),
    agent_id: input.agent_id === undefined ? existing.agent_id : cleanString(input.agent_id),
    release: input.release === undefined ? existing.release : cleanString(input.release),
    updated_at: timestamp(),
  };
  store.roadmaps[id] = updated;
  writeStore(store);
  return updated;
}

export function deleteRoadmap(idOrName: string): boolean {
  const store = readStore();
  const id = resolveRoadmapId(idOrName, store);
  if (!store.roadmaps[id]) return false;
  delete store.roadmaps[id];
  for (const milestone of Object.values(store.milestones)) {
    if (milestone.roadmap_id === id) delete store.milestones[milestone.id];
  }
  for (const key of Object.keys(store.releases)) {
    if (store.releases[key]?.roadmap_id === id) delete store.releases[key];
  }
  writeStore(store);
  return true;
}

export function createMilestone(input: CreateMilestoneInput): LocalMilestoneConfig {
  const store = readStore();
  const roadmapId = resolveRoadmapId(input.roadmap_id, store);
  const roadmap = assertRoadmap(roadmapId, store);
  const title = input.title.trim();
  if (!title) throw new Error("Milestone title is required");
  const now = timestamp();
  const milestone: LocalMilestoneConfig = {
    id: newId("milestone"),
    roadmap_id: roadmapId,
    title,
    description: cleanString(input.description),
    due_at: cleanString(input.due_at),
    status: input.status ?? "planned",
    owner: cleanString(input.owner),
    agent_id: cleanString(input.agent_id),
    task_ids: cleanList(input.task_ids),
    plan_ids: cleanList(input.plan_ids),
    run_ids: cleanList(input.run_ids),
    release: cleanString(input.release ?? roadmap.release ?? undefined),
    tags: cleanList(input.tags),
    created_at: now,
    updated_at: now,
  };
  store.milestones[milestone.id] = milestone;
  store.roadmaps[roadmapId] = { ...roadmap, milestone_ids: cleanList([...roadmap.milestone_ids, milestone.id]), updated_at: now };
  writeStore(store);
  return milestone;
}

export function listMilestones(options: { roadmap_id?: string; release?: string; status?: LocalMilestoneStatus } = {}): LocalMilestoneConfig[] {
  const store = readStore();
  const roadmapId = options.roadmap_id ? resolveRoadmapId(options.roadmap_id, store) : null;
  return Object.values(store.milestones)
    .filter((milestone) => !roadmapId || milestone.roadmap_id === roadmapId)
    .filter((milestone) => !options.release || milestone.release === options.release)
    .filter((milestone) => !options.status || milestone.status === options.status)
    .sort((left, right) => (left.due_at ?? "").localeCompare(right.due_at ?? "") || left.title.localeCompare(right.title));
}

export function updateMilestone(idOrTitle: string, input: UpdateMilestoneInput): LocalMilestoneConfig {
  const store = readStore();
  const id = resolveMilestoneId(idOrTitle, store);
  const existing = store.milestones[id];
  if (!existing) throw new Error(`Milestone not found: ${idOrTitle}`);
  const updated: LocalMilestoneConfig = {
    ...existing,
    title: input.title?.trim() || existing.title,
    description: input.description === undefined ? existing.description : cleanString(input.description),
    due_at: input.due_at === undefined ? existing.due_at : cleanString(input.due_at),
    status: input.status ?? existing.status,
    owner: input.owner === undefined ? existing.owner : cleanString(input.owner),
    agent_id: input.agent_id === undefined ? existing.agent_id : cleanString(input.agent_id),
    task_ids: input.task_ids === undefined ? existing.task_ids : cleanList(input.task_ids),
    plan_ids: input.plan_ids === undefined ? existing.plan_ids : cleanList(input.plan_ids),
    run_ids: input.run_ids === undefined ? existing.run_ids : cleanList(input.run_ids),
    release: input.release === undefined ? existing.release : cleanString(input.release),
    tags: input.tags === undefined ? existing.tags : cleanList(input.tags),
    updated_at: timestamp(),
  };
  store.milestones[id] = updated;
  writeStore(store);
  return updated;
}

export function deleteMilestone(idOrTitle: string): boolean {
  const store = readStore();
  const id = resolveMilestoneId(idOrTitle, store);
  const milestone = store.milestones[id];
  if (!milestone) return false;
  delete store.milestones[id];
  const roadmap = store.roadmaps[milestone.roadmap_id];
  if (roadmap) store.roadmaps[roadmap.id] = { ...roadmap, milestone_ids: roadmap.milestone_ids.filter((item) => item !== id), updated_at: timestamp() };
  for (const key of Object.keys(store.releases)) {
    const release = store.releases[key]!;
    if (release.milestone_ids.includes(id)) store.releases[key] = { ...release, milestone_ids: release.milestone_ids.filter((item) => item !== id), updated_at: timestamp() };
  }
  writeStore(store);
  return true;
}

export function upsertReleaseGroup(input: UpsertReleaseGroupInput): LocalReleaseGroupConfig {
  const store = readStore();
  const roadmapId = resolveRoadmapId(input.roadmap_id, store);
  const name = input.name.trim();
  if (!name) throw new Error("Release group name is required");
  const key = releaseKey(roadmapId, name);
  const existing = store.releases[key];
  const now = timestamp();
  const release: LocalReleaseGroupConfig = {
    name,
    version: input.version === undefined ? existing?.version ?? null : cleanString(input.version),
    roadmap_id: roadmapId,
    status: input.status ?? existing?.status ?? "planned",
    milestone_ids: input.milestone_ids === undefined ? existing?.milestone_ids ?? [] : cleanList(input.milestone_ids).map((id) => resolveMilestoneId(id, store)),
    task_ids: input.task_ids === undefined ? existing?.task_ids ?? [] : cleanList(input.task_ids),
    plan_ids: input.plan_ids === undefined ? existing?.plan_ids ?? [] : cleanList(input.plan_ids),
    run_ids: input.run_ids === undefined ? existing?.run_ids ?? [] : cleanList(input.run_ids),
    notes: input.notes === undefined ? existing?.notes ?? null : cleanString(input.notes),
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  store.releases[key] = release;
  writeStore(store);
  return release;
}

export function listReleaseGroups(roadmapId?: string): LocalReleaseGroupConfig[] {
  const store = readStore();
  const resolved = roadmapId ? resolveRoadmapId(roadmapId, store) : null;
  return Object.values(store.releases)
    .filter((release) => !resolved || release.roadmap_id === resolved)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function summarizeMilestone(idOrTitle: string, db?: Database): MilestoneSummary {
  const store = readStore();
  const id = resolveMilestoneId(idOrTitle, store);
  const milestone = store.milestones[id];
  if (!milestone) throw new Error(`Milestone not found: ${idOrTitle}`);
  const tasks = milestone.task_ids.map((taskId) => getTask(taskId, db)).filter(Boolean) as Task[];
  const plans = milestone.plan_ids.map((planId) => getPlan(planId, db)).filter(Boolean) as Plan[];
  const runs = milestone.run_ids.map((runId) => getTaskRun(runId, db)).filter(Boolean) as Array<NonNullable<ReturnType<typeof getTaskRun>>>;
  const blockers = tasks.map((task) => ({
    task_id: task.id,
    blockers: getBlockingDeps(task.id, db).map((blocker) => ({ id: blocker.id, title: blocker.title, status: blocker.status })),
  })).filter((item) => item.blockers.length > 0);
  return {
    ...milestone,
    tasks,
    plans,
    runs,
    blockers,
    progress: summarizeTasks(milestone.task_ids, milestone.plan_ids, milestone.run_ids, db),
  };
}

export function summarizeRoadmap(idOrName: string, db?: Database): RoadmapSummary {
  const store = readStore();
  const id = resolveRoadmapId(idOrName, store);
  const roadmap = assertRoadmap(id, store);
  const milestones = roadmap.milestone_ids
    .map((milestoneId) => store.milestones[milestoneId])
    .filter(isMilestone)
    .map((milestone) => summarizeMilestone(milestone.id, db));
  const releases = listReleaseGroups(roadmap.id);
  const taskIds = taskIdsForRoadmap(roadmap, milestones, releases, db);
  const planIds = cleanList([...milestones.flatMap((milestone) => milestone.plan_ids), ...releases.flatMap((release) => release.plan_ids), ...listPlans(roadmap.project_id ?? undefined, db).map((plan) => plan.id)]);
  const runIds = cleanList([...milestones.flatMap((milestone) => milestone.run_ids), ...releases.flatMap((release) => release.run_ids), ...taskIds.flatMap((taskId) => listTaskRuns(taskId, db).map((run) => run.id))]);
  return {
    ...roadmap,
    milestones,
    releases,
    progress: summarizeTasks(taskIds, planIds, runIds, db),
  };
}

export function exportRoadmapBundle(idOrName: string): RoadmapBundle {
  const store = readStore();
  const id = resolveRoadmapId(idOrName, store);
  const roadmap = assertRoadmap(id, store);
  return {
    schema_version: LOCAL_ROADMAP_SCHEMA_VERSION,
    kind: "hasna.todos.roadmap-bundle",
    local_only: true,
    exported_at: timestamp(),
    roadmap,
    milestones: roadmap.milestone_ids.map((milestoneId) => store.milestones[milestoneId]).filter(isMilestone),
    releases: listReleaseGroups(roadmap.id),
  };
}

export function importRoadmapBundle(bundle: RoadmapBundle, options: { apply?: boolean } = {}): ImportRoadmapBundleResult {
  if (bundle.kind !== "hasna.todos.roadmap-bundle" || bundle.schema_version !== LOCAL_ROADMAP_SCHEMA_VERSION) {
    throw new Error("Unsupported roadmap bundle");
  }
  if (!options.apply) {
    return { applied: false, roadmap_id: bundle.roadmap.id, milestones: bundle.milestones.length, releases: bundle.releases.length };
  }
  const store = readStore();
  store.roadmaps[bundle.roadmap.id] = bundle.roadmap;
  for (const milestone of bundle.milestones) store.milestones[milestone.id] = milestone;
  for (const release of bundle.releases) store.releases[releaseKey(release.roadmap_id, release.name)] = release;
  writeStore(store);
  return { applied: true, roadmap_id: bundle.roadmap.id, milestones: bundle.milestones.length, releases: bundle.releases.length };
}

export function renderRoadmapMarkdown(idOrName: string, db?: Database): string {
  const summary = summarizeRoadmap(idOrName, db);
  const lines = [
    `# ${summary.name}`,
    "",
    summary.description ?? "",
    "",
    `Status: ${summary.status}`,
    `Progress: ${summary.progress.completed_count}/${summary.progress.task_count} tasks (${summary.progress.percent_complete}%)`,
    `Readiness: ${summary.progress.readiness}`,
    "",
    "## Milestones",
    "",
  ];
  if (summary.milestones.length === 0) lines.push("- No milestones.");
  for (const milestone of summary.milestones) {
    lines.push(`- ${milestone.title} [${milestone.status}] due ${milestone.due_at ?? "unscheduled"}: ${milestone.progress.completed_count}/${milestone.progress.task_count} tasks, ${milestone.progress.blocked_count} blocked`);
  }
  lines.push("", "## Releases", "");
  if (summary.releases.length === 0) lines.push("- No release groups.");
  for (const release of summary.releases) {
    lines.push(`- ${release.name}${release.version ? ` ${release.version}` : ""} [${release.status}]`);
  }
  return lines.filter((line, index, arr) => !(line === "" && arr[index - 1] === "")).join("\n");
}
