/** Canonical kebab-case slug normalization shared by local and Postgres paths. */
export function normalizeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function isCanonicalSlug(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && normalizeSlug(value) === value;
}

/** A missing/null project scope is standalone; a scoped task list needs a stable non-empty project id. */
export function isValidTaskListProjectScope(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || (typeof value === "string" && value.trim().length > 0);
}

export interface ProjectRoutingRecord {
  id: string;
  task_list_id?: unknown;
}

export interface TaskListRoutingRecord {
  id: string;
  slug?: unknown;
  project_id?: unknown;
}

/** Validate a live snapshot's routing fields and in-batch uniqueness before any destination write. */
export function validateSnapshotRoutingRecords(
  projects: readonly ProjectRoutingRecord[],
  taskLists: readonly TaskListRoutingRecord[],
): string[] {
  const errors: string[] = [];
  const projectSlugs = new Map<string, string>();
  const taskListSlugs = new Map<string | null, Map<string, string>>();

  for (const project of projects) {
    if (!isCanonicalSlug(project.task_list_id)) {
      errors.push(`project ${project.id}: task_list_id must be non-empty canonical kebab-case`);
      continue;
    }
    const existing = projectSlugs.get(project.task_list_id);
    if (projectSlugs.has(project.task_list_id)) {
      errors.push(`project ${project.id}: task_list_id duplicates project ${existing!}: ${project.task_list_id}`);
    } else {
      projectSlugs.set(project.task_list_id, project.id);
    }
  }

  for (const taskList of taskLists) {
    if (!isCanonicalSlug(taskList.slug)) {
      errors.push(`task list ${taskList.id}: slug must be non-empty canonical kebab-case`);
      continue;
    }
    if (!isValidTaskListProjectScope(taskList.project_id)) {
      errors.push(`task list ${taskList.id}: project_id must be null, missing, or a non-empty string`);
      continue;
    }
    const scope = taskList.project_id ?? null;
    const scopedSlugs = taskListSlugs.get(scope) ?? new Map<string, string>();
    const existing = scopedSlugs.get(taskList.slug);
    if (scopedSlugs.has(taskList.slug)) {
      errors.push(`task list ${taskList.id}: slug duplicates task list ${existing!} in the same scope: ${taskList.slug}`);
    } else {
      scopedSlugs.set(taskList.slug, taskList.id);
      taskListSlugs.set(scope, scopedSlugs);
    }
  }
  return errors;
}

/** Detect incoming routing records that would collide with a different live destination id. */
export function validateSnapshotRoutingDestinationConflicts(
  projects: readonly ProjectRoutingRecord[],
  taskLists: readonly TaskListRoutingRecord[],
  existingProjects: readonly ProjectRoutingRecord[],
  existingTaskLists: readonly TaskListRoutingRecord[],
): string[] {
  const errors: string[] = [];
  for (const project of projects) {
    const current = existingProjects.find((candidate) => candidate.id === project.id);
    if (current?.task_list_id === project.task_list_id) continue;
    const conflict = existingProjects.find((candidate) =>
      candidate.id !== project.id && candidate.task_list_id === project.task_list_id
    );
    if (conflict) {
      errors.push(`project ${project.id}: task_list_id conflicts with existing project ${conflict.id}: ${String(project.task_list_id)}`);
    }
  }
  for (const taskList of taskLists) {
    const projectId = taskList.project_id ?? null;
    const current = existingTaskLists.find((candidate) => candidate.id === taskList.id);
    if ((current?.project_id ?? null) === projectId && current?.slug === taskList.slug) continue;
    const conflict = existingTaskLists.find((candidate) =>
      candidate.id !== taskList.id &&
      (candidate.project_id ?? null) === projectId &&
      candidate.slug === taskList.slug
    );
    if (conflict) {
      errors.push(`task list ${taskList.id}: slug conflicts with existing task list ${conflict.id} in the same scope: ${String(taskList.slug)}`);
    }
  }
  return errors;
}
