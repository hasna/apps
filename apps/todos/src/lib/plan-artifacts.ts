import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDatabase, resolvePartialId } from "../db/database.js";
import { getProject, getProjectByPath, listProjects, slugify } from "../db/projects.js";
import { listTasks } from "../db/tasks.js";
import type { Plan, Project, Task } from "../types/index.js";

export const PLAN_MARKDOWN_SCHEMA = "hasna.todos.plan/v1";

export interface PlanArtifactPaths {
  project_id: string;
  project_root: string;
  directory: string;
  file_path: string;
}

export interface ResolvePlanArtifactPathInput {
  project_id?: string | null;
  project_ref?: string | null;
  plan_id?: string | null;
  plan_slug?: string | null;
  db?: Database;
}

export interface PlanArtifactTaskReference {
  task_id: string;
  title: string;
  status: Task["status"];
  priority: Task["priority"];
}

export interface PlanArtifactMetadata {
  schema: typeof PLAN_MARKDOWN_SCHEMA;
  plan_id: string;
  plan_slug: string | null;
  project_id: string;
  task_list_id: string | null;
  agent_id: string | null;
  stable_id: string;
  name: string;
  status: Plan["status"];
  created_at: string;
  updated_at: string;
  artifact_updated_at: string;
}

export interface PlanArtifactSnapshot {
  metadata: PlanArtifactMetadata;
  task_references: PlanArtifactTaskReference[];
  body: string;
}

export interface PlanArtifactReadResult extends PlanArtifactSnapshot {
  path: string;
  markdown: string;
}

export interface PlanArtifactConflict {
  field: string;
  database: string | null;
  artifact: string | null;
}

export interface PlanArtifactInspection {
  path: string;
  exists: boolean;
  parse_error: string | null;
  metadata: PlanArtifactMetadata | null;
  task_references: PlanArtifactTaskReference[];
  conflicts: PlanArtifactConflict[];
}

export interface WritePlanArtifactResult {
  path: string;
  snapshot: PlanArtifactSnapshot;
}

function assertSafePathSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error(`Invalid ${label} for plan artifact path`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error(`Invalid ${label} for plan artifact path`);
  }
  return trimmed;
}

function frontmatterScalar(value: string | null): string {
  return JSON.stringify(value);
}

function parseFrontmatterScalar(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed === null || typeof parsed === "string") return parsed;
  } catch {}
  return trimmed.replace(/^["']|["']$/g, "") || null;
}

function markdownEscape(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "").trim();
}

function markdownLine(text: string): string {
  return markdownEscape(text).replace(/\s+/g, " ").trim();
}

function projectSlugMatches(project: Project, ref: string): boolean {
  const normalized = slugify(ref);
  return Boolean(normalized) && (project.task_list_id === normalized || slugify(project.name) === normalized);
}

function planArtifactSlug(plan: Pick<Plan, "name" | "slug">): string {
  return slugify(plan.slug || plan.name) || "plan";
}

export function planArtifactFileName(plan: Pick<Plan, "id" | "name" | "slug">): string {
  const id8 = assertSafePathSegment(plan.id.slice(0, 8), "plan id");
  return `${planArtifactSlug(plan)}--${id8}.md`;
}

export function resolvePlanArtifactProject(input: ResolvePlanArtifactPathInput): Project {
  const db = getDatabase(input.db);
  const ref = input.project_id || input.project_ref;
  if (!ref) throw new Error("Plan artifacts require a project id or project reference");

  const byPath = getProjectByPath(resolve(ref), db);
  if (byPath) return byPath;

  const resolvedId = resolvePartialId(db, "projects", ref);
  if (resolvedId) {
    const project = getProject(resolvedId, db);
    if (project) return project;
  }

  const project = listProjects(db).find((candidate) => projectSlugMatches(candidate, ref));
  if (project) return project;

  throw new Error(`Project not found for plan artifacts: ${ref}`);
}

export function resolvePlanArtifactPaths(input: ResolvePlanArtifactPathInput): PlanArtifactPaths {
  const project = resolvePlanArtifactProject(input);
  const projectId = assertSafePathSegment(project.id, "project id");
  const projectRoot = resolve(project.path);
  const directory = join(projectRoot, ".hasna", "todos", "plans", projectId);
  const planId = input.plan_id ? assertSafePathSegment(input.plan_id, "plan id") : null;
  const planSlug = input.plan_slug ? assertSafePathSegment(slugify(input.plan_slug), "plan slug") : null;
  const fileName = planId ? (planSlug ? `${planSlug}--${planId.slice(0, 8)}.md` : `${planId}.md`) : null;
  return {
    project_id: project.id,
    project_root: projectRoot,
    directory,
    file_path: fileName ? join(directory, fileName) : directory,
  };
}

function resolvePlanArtifactCandidatePaths(plan: Plan, db: Database): { primary: PlanArtifactPaths; legacy: PlanArtifactPaths } {
  return {
    primary: resolvePlanArtifactPaths({
      project_id: plan.project_id,
      plan_id: plan.id,
      plan_slug: planArtifactSlug(plan),
      db,
    }),
    legacy: resolvePlanArtifactPaths({ project_id: plan.project_id, plan_id: plan.id, db }),
  };
}

export function buildPlanArtifactSnapshot(
  plan: Plan,
  tasks: Task[] = [],
  artifactUpdatedAt = new Date().toISOString(),
): PlanArtifactSnapshot {
  if (!plan.project_id) throw new Error("Plan artifacts require a project-scoped plan");
  const taskReferences = tasks.map((task) => ({
    task_id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
  }));
  const body = renderPlanArtifactBody(plan, taskReferences);
  return {
    metadata: {
      schema: PLAN_MARKDOWN_SCHEMA,
      plan_id: plan.id,
      plan_slug: plan.slug ?? null,
      project_id: plan.project_id,
      task_list_id: plan.task_list_id ?? null,
      agent_id: plan.agent_id ?? null,
      stable_id: plan.id,
      name: plan.name,
      status: plan.status,
      created_at: plan.created_at,
      updated_at: plan.updated_at,
      artifact_updated_at: artifactUpdatedAt,
    },
    task_references: taskReferences,
    body,
  };
}

function renderPlanArtifactBody(plan: Plan, tasks: PlanArtifactTaskReference[]): string {
  const lines = [`# ${markdownLine(plan.name) || plan.id}`, ""];
  if (plan.description?.trim()) {
    lines.push(markdownEscape(plan.description), "");
  }
  lines.push("## Tasks", "");
  if (tasks.length === 0) {
    lines.push("_No tasks are currently attached to this plan._", "");
  } else {
    for (const task of tasks) {
      const check = task.status === "completed" ? "x" : " ";
      lines.push(`- [${check}] ${markdownLine(task.title) || task.task_id}`);
      lines.push(`  <!-- todos: task_id=${task.task_id} status=${task.status} priority=${task.priority} -->`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function renderPlanArtifactMarkdown(snapshot: PlanArtifactSnapshot): string {
  const metadata = snapshot.metadata;
  const lines = [
    "---",
    `schema: ${frontmatterScalar(metadata.schema)}`,
    `plan_id: ${frontmatterScalar(metadata.plan_id)}`,
    `plan_slug: ${frontmatterScalar(metadata.plan_slug)}`,
    `project_id: ${frontmatterScalar(metadata.project_id)}`,
    `task_list_id: ${frontmatterScalar(metadata.task_list_id)}`,
    `agent_id: ${frontmatterScalar(metadata.agent_id)}`,
    `stable_id: ${frontmatterScalar(metadata.stable_id)}`,
    `name: ${frontmatterScalar(metadata.name)}`,
    `status: ${frontmatterScalar(metadata.status)}`,
    `created_at: ${frontmatterScalar(metadata.created_at)}`,
    `updated_at: ${frontmatterScalar(metadata.updated_at)}`,
    `artifact_updated_at: ${frontmatterScalar(metadata.artifact_updated_at)}`,
    "---",
    "",
    snapshot.body,
  ];
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

export function parsePlanArtifactMarkdown(markdown: string): PlanArtifactSnapshot {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error("Invalid plan artifact: missing frontmatter");
  const rawMetadata: Record<string, string | null> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);
    rawMetadata[key] = parseFrontmatterScalar(value);
  }
  if (rawMetadata.schema !== PLAN_MARKDOWN_SCHEMA) {
    throw new Error(`Unsupported plan artifact schema: ${rawMetadata.schema ?? "unknown"}`);
  }
  const required = ["plan_id", "project_id", "stable_id", "name", "status", "created_at", "updated_at", "artifact_updated_at"];
  for (const key of required) {
    if (!rawMetadata[key]) throw new Error(`Invalid plan artifact: missing ${key}`);
  }
  const body = match[2] ?? "";
  return {
    metadata: {
      schema: PLAN_MARKDOWN_SCHEMA,
      plan_id: rawMetadata.plan_id!,
      plan_slug: rawMetadata.plan_slug ?? null,
      project_id: rawMetadata.project_id!,
      task_list_id: rawMetadata.task_list_id ?? null,
      agent_id: rawMetadata.agent_id ?? null,
      stable_id: rawMetadata.stable_id!,
      name: rawMetadata.name!,
      status: rawMetadata.status! as Plan["status"],
      created_at: rawMetadata.created_at!,
      updated_at: rawMetadata.updated_at!,
      artifact_updated_at: rawMetadata.artifact_updated_at!,
    },
    task_references: parseTaskReferences(body),
    body,
  };
}

function parseTaskReferences(body: string): PlanArtifactTaskReference[] {
  const references: PlanArtifactTaskReference[] = [];
  const taskLine = /^\s*-\s+\[[ xX]\]\s+(.+)$/;
  const metadataLine = /<!--\s*todos:\s*task_id=([A-Za-z0-9._-]+)\s+status=([A-Za-z_]+)\s+priority=([A-Za-z_]+)\s*-->/;
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const titleMatch = lines[index]!.match(taskLine);
    if (!titleMatch) continue;
    const metadataMatch = lines[index + 1]?.match(metadataLine);
    if (!metadataMatch) continue;
    references.push({
      task_id: metadataMatch[1]!,
      title: titleMatch[1]!.trim(),
      status: metadataMatch[2]! as Task["status"],
      priority: metadataMatch[3]! as Task["priority"],
    });
  }
  return references;
}

export function writePlanArtifact(plan: Plan, db?: Database): WritePlanArtifactResult | null {
  if (!plan.project_id) return null;
  const d = getDatabase(db);
  const tasks = listTasks({ plan_id: plan.id, include_archived: true }, d);
  const paths = resolvePlanArtifactCandidatePaths(plan, d).primary;
  const snapshot = buildPlanArtifactSnapshot(plan, tasks);
  mkdirSync(paths.directory, { recursive: true });
  writeFileSync(paths.file_path, renderPlanArtifactMarkdown(snapshot), "utf8");
  return { path: paths.file_path, snapshot };
}

export function readPlanArtifact(plan: Plan, db?: Database): PlanArtifactReadResult | null {
  if (!plan.project_id) return null;
  const d = getDatabase(db);
  const paths = resolvePlanArtifactCandidatePaths(plan, d);
  const path = existsSync(paths.primary.file_path)
    ? paths.primary.file_path
    : existsSync(paths.legacy.file_path)
      ? paths.legacy.file_path
      : null;
  if (!path) return null;
  const markdown = readFileSync(path, "utf8");
  return {
    path,
    markdown,
    ...parsePlanArtifactMarkdown(markdown),
  };
}

export function inspectPlanArtifact(plan: Plan, db?: Database): PlanArtifactInspection | null {
  if (!plan.project_id) return null;
  const d = getDatabase(db);
  const paths = resolvePlanArtifactCandidatePaths(plan, d);
  const path = existsSync(paths.primary.file_path)
    ? paths.primary.file_path
    : existsSync(paths.legacy.file_path)
      ? paths.legacy.file_path
      : null;
  if (!path) {
    return {
      path: paths.primary.file_path,
      exists: false,
      parse_error: null,
      metadata: null,
      task_references: [],
      conflicts: [],
    };
  }

  try {
    const artifact = parsePlanArtifactMarkdown(readFileSync(path, "utf8"));
    return {
      path,
      exists: true,
      parse_error: null,
      metadata: artifact.metadata,
      task_references: artifact.task_references,
      conflicts: comparePlanArtifact(plan, artifact, listTasks({ plan_id: plan.id, include_archived: true }, d)),
    };
  } catch (error) {
    return {
      path,
      exists: true,
      parse_error: error instanceof Error ? error.message : String(error),
      metadata: null,
      task_references: [],
      conflicts: [],
    };
  }
}

function comparePlanArtifact(plan: Plan, artifact: PlanArtifactSnapshot, tasks: Task[]): PlanArtifactConflict[] {
  const conflicts: PlanArtifactConflict[] = [];
  compare("plan_id", plan.id, artifact.metadata.plan_id, conflicts);
  if (artifact.metadata.plan_slug !== null) {
    compare("plan_slug", plan.slug ?? null, artifact.metadata.plan_slug, conflicts);
  }
  compare("project_id", plan.project_id ?? null, artifact.metadata.project_id, conflicts);
  compare("name", plan.name, artifact.metadata.name, conflicts);
  compare("status", plan.status, artifact.metadata.status, conflicts);
  compare("updated_at", plan.updated_at, artifact.metadata.updated_at, conflicts);

  const dbTaskIds = tasks.map((task) => task.id).sort();
  const artifactTaskIds = artifact.task_references.map((task) => task.task_id).sort();
  if (dbTaskIds.join(",") !== artifactTaskIds.join(",")) {
    conflicts.push({
      field: "task_references",
      database: dbTaskIds.join(",") || null,
      artifact: artifactTaskIds.join(",") || null,
    });
  }

  return conflicts;
}

function compare(field: string, database: string | null, artifact: string | null, conflicts: PlanArtifactConflict[]): void {
  if ((database ?? null) !== (artifact ?? null)) {
    conflicts.push({ field, database: database ?? null, artifact: artifact ?? null });
  }
}
