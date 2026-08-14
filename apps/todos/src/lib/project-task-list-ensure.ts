import { createHash } from "node:crypto";
import { ResourceConflictError } from "../types/index.js";
import type {
  Project,
  ProjectTaskListEnsureReceipt,
  ProjectTaskListEnsureResult,
  ProjectTaskListRollbackResult,
  TaskList,
} from "../types/index.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";

export const PROJECT_TASK_LIST_ENSURE_SCHEMA_VERSION =
  "todos.project-task-list-ensure.v1" as const;
const RECEIPT_METADATA_KEY = "todos_project_task_list_ensure";

interface StoredEnsureMarker {
  schema_version: typeof PROJECT_TASK_LIST_ENSURE_SCHEMA_VERSION;
  receipt_id: string;
  idempotency_key: string;
  project_id: string;
  slug: string;
  result_digest: string;
  created_at: string;
}

export type ProjectTaskListEnsureErrorCode =
  | "PROJECT_NOT_FOUND"
  | "PROJECT_TASK_LIST_NOT_DECLARED"
  | "PROJECT_REVISION_CONFLICT"
  | "TASK_LIST_SCOPE_COLLISION"
  | "PROJECT_TASK_LIST_IDEMPOTENCY_KEY_INVALID"
  | "PROJECT_TASK_LIST_IDEMPOTENCY_CONFLICT"
  | "PROJECT_TASK_LIST_RECEIPT_NOT_FOUND"
  | "PROJECT_TASK_LIST_ROLLBACK_CONFLICT"
  | "PROJECT_TASK_LIST_ROLLBACK_HAS_DEPENDENTS";

export class ProjectTaskListEnsureError extends Error {
  constructor(
    readonly code: ProjectTaskListEnsureErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ProjectTaskListEnsureError";
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function deriveIdempotencyKey(projectId: string, slug: string): string {
  return `ptlk_${digest({ project_id: projectId, slug }).slice(0, 48)}`;
}

function normalizeIdempotencyKey(value: string | undefined, projectId: string, slug: string): string {
  const key = value?.trim() || deriveIdempotencyKey(projectId, slug);
  if (key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new ProjectTaskListEnsureError(
      "PROJECT_TASK_LIST_IDEMPOTENCY_KEY_INVALID",
      "idempotency_key must be 8-128 ASCII letters, digits, dots, underscores, colons, or hyphens",
    );
  }
  return key;
}

function receiptId(projectId: string, slug: string, idempotencyKey: string): string {
  return `ptlr_${digest({ project_id: projectId, slug, idempotency_key: idempotencyKey }).slice(0, 48)}`;
}

function semanticListDigest(list: Pick<TaskList, "project_id" | "slug" | "name" | "description" | "metadata">): string {
  const metadata = { ...(list.metadata ?? {}) };
  delete metadata[RECEIPT_METADATA_KEY];
  return digest({
    project_id: list.project_id,
    slug: list.slug,
    name: list.name,
    description: list.description,
    metadata,
  });
}

function storedMarker(list: TaskList): StoredEnsureMarker | null {
  const value = list.metadata?.[RECEIPT_METADATA_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const marker = value as Record<string, unknown>;
  if (
    marker.schema_version !== PROJECT_TASK_LIST_ENSURE_SCHEMA_VERSION
    || typeof marker.receipt_id !== "string"
    || typeof marker.idempotency_key !== "string"
    || typeof marker.project_id !== "string"
    || typeof marker.slug !== "string"
    || typeof marker.result_digest !== "string"
    || typeof marker.created_at !== "string"
  ) return null;
  return marker as unknown as StoredEnsureMarker;
}

function receiptFor(
  store: TodosStorageAdapter,
  project: Project,
  list: TaskList,
  idempotencyKey: string,
): ProjectTaskListEnsureReceipt {
  const marker = storedMarker(list);
  const owned = marker?.project_id === project.id && marker.slug === list.slug;
  if (owned && marker.idempotency_key !== idempotencyKey) {
    throw new ProjectTaskListEnsureError(
      "PROJECT_TASK_LIST_IDEMPOTENCY_CONFLICT",
      "The operation-owned task list was created under a different idempotency key",
      {
        project_id: project.id,
        task_list_id: list.id,
        receipt_id: marker.receipt_id,
      },
    );
  }
  return {
    schema_version: PROJECT_TASK_LIST_ENSURE_SCHEMA_VERSION,
    receipt_id: owned
      ? marker.receipt_id
      : `ptlr_existing_${digest({ project_id: project.id, task_list_id: list.id }).slice(0, 39)}`,
    idempotency_key: owned ? marker.idempotency_key : idempotencyKey,
    project_id: project.id,
    task_list_id: list.id,
    slug: list.slug,
    created_by_operation: owned,
    result_revision: list.updated_at,
    result_digest: owned ? marker!.result_digest : semanticListDigest(list),
    rollback_supported: Boolean(
      owned
      && semanticListDigest(list) === marker!.result_digest
      && store.taskLists.deleteIfUnchangedAndUnused,
    ),
    created_at: owned ? marker.created_at : list.created_at,
  };
}

async function exactProjectState(
  store: TodosStorageAdapter,
  projectId: string,
): Promise<{ project: Project; scoped: TaskList | null; globalCollision: TaskList | null }> {
  const project = await store.projects.get(projectId);
  if (!project) {
    throw new ProjectTaskListEnsureError(
      "PROJECT_NOT_FOUND",
      `Project not found: ${projectId}`,
      { project_id: projectId },
    );
  }
  const slug = project.task_list_id?.trim();
  if (!slug) {
    throw new ProjectTaskListEnsureError(
      "PROJECT_TASK_LIST_NOT_DECLARED",
      "Project does not declare a canonical task_list_id slug",
      { project_id: project.id },
    );
  }
  const all = await store.taskLists.list();
  const scopedMatches = all.filter((list) => list.project_id === project.id && list.slug === slug);
  if (scopedMatches.length > 1) {
    throw new ProjectTaskListEnsureError(
      "TASK_LIST_SCOPE_COLLISION",
      "More than one task list matches the project's exact id and declared slug",
      { project_id: project.id, slug, task_list_ids: scopedMatches.map((list) => list.id) },
    );
  }
  const globalMatches = all.filter((list) => list.project_id === null && list.slug === slug);
  if (globalMatches.length > 0 && scopedMatches.length === 0) {
    throw new ProjectTaskListEnsureError(
      "TASK_LIST_SCOPE_COLLISION",
      "A legacy global task list already owns the declared slug; refusing to create a second locator",
      { project_id: project.id, slug, task_list_ids: globalMatches.map((list) => list.id) },
    );
  }
  return { project, scoped: scopedMatches[0] ?? null, globalCollision: globalMatches[0] ?? null };
}

export async function planProjectTaskListEnsure(
  store: TodosStorageAdapter,
  projectId: string,
): Promise<ProjectTaskListEnsureResult> {
  const { project, scoped } = await exactProjectState(store, projectId);
  return {
    mode: "plan",
    action: scoped ? "already_present" : "would_create",
    project,
    task_list: scoped,
    receipt: null,
  };
}

export async function applyProjectTaskListEnsure(
  store: TodosStorageAdapter,
  projectId: string,
  options: { expected_project_revision: string; idempotency_key?: string },
): Promise<ProjectTaskListEnsureResult> {
  const state = await exactProjectState(store, projectId);
  const { project } = state;
  if (project.updated_at !== options.expected_project_revision) {
    throw new ProjectTaskListEnsureError(
      "PROJECT_REVISION_CONFLICT",
      "Project changed after the ensure plan; fetch a fresh plan before applying",
      {
        project_id: project.id,
        expected_project_revision: options.expected_project_revision,
        current_project_revision: project.updated_at,
      },
    );
  }
  const slug = project.task_list_id!;
  const idempotencyKey = normalizeIdempotencyKey(options.idempotency_key, project.id, slug);
  if (state.scoped) {
    return {
      mode: "apply",
      action: "already_present",
      project,
      task_list: state.scoped,
      receipt: receiptFor(store, project, state.scoped, idempotencyKey),
    };
  }

  const marker: StoredEnsureMarker = {
    schema_version: PROJECT_TASK_LIST_ENSURE_SCHEMA_VERSION,
    receipt_id: receiptId(project.id, slug, idempotencyKey),
    idempotency_key: idempotencyKey,
    project_id: project.id,
    slug,
    result_digest: semanticListDigest({
      project_id: project.id,
      slug,
      name: project.name,
      description: null,
      metadata: {},
    }),
    created_at: new Date().toISOString(),
  };

  let list: TaskList;
  try {
    list = await store.taskLists.create({
      name: project.name,
      slug,
      project_id: project.id,
      metadata: { [RECEIPT_METADATA_KEY]: marker },
    });
  } catch (error) {
    if (!(error instanceof ResourceConflictError)) throw error;
    const raced = await exactProjectState(store, projectId);
    if (!raced.scoped) throw error;
    if (
      raced.project.updated_at !== options.expected_project_revision
      || raced.project.task_list_id !== slug
    ) {
      throw new ProjectTaskListEnsureError(
        "PROJECT_REVISION_CONFLICT",
        "Project changed while the task list was being created; fetch a fresh plan before retrying",
        {
          project_id: raced.project.id,
          expected_project_revision: options.expected_project_revision,
          current_project_revision: raced.project.updated_at,
        },
      );
    }
    return {
      mode: "apply",
      action: "already_present",
      project: raced.project,
      task_list: raced.scoped,
      receipt: receiptFor(store, raced.project, raced.scoped, idempotencyKey),
    };
  }

  const projectReadback = await store.projects.get(project.id);
  if (
    !projectReadback
    || projectReadback.updated_at !== options.expected_project_revision
    || projectReadback.task_list_id !== slug
  ) {
    let compensated = false;
    const unchanged = await store.taskLists.get(list.id);
    const unchangedMarker = unchanged ? storedMarker(unchanged) : null;
    if (
      unchanged
      && unchangedMarker?.receipt_id === marker.receipt_id
      && semanticListDigest(unchanged) === marker.result_digest
      && store.taskLists.deleteIfUnchangedAndUnused
    ) {
      const deletion = await store.taskLists.deleteIfUnchangedAndUnused(list.id, {
        project_id: unchanged.project_id,
        slug: unchanged.slug,
        name: unchanged.name,
        description: unchanged.description,
        metadata: unchanged.metadata,
        updated_at: unchanged.updated_at,
      });
      compensated = deletion.status === "deleted";
    }
    throw new ProjectTaskListEnsureError(
      "PROJECT_REVISION_CONFLICT",
      compensated
        ? "Project changed while the task list was being created; the new list was rolled back"
        : "Project changed while the task list was being created; the new list was retained because safe conditional rollback could not be proven",
      { project_id: project.id, task_list_id: list.id, compensated },
    );
  }

  const readback = await store.taskLists.get(list.id);
  if (!readback || readback.project_id !== project.id || readback.slug !== slug) {
    throw new ProjectTaskListEnsureError(
      "TASK_LIST_SCOPE_COLLISION",
      "Task-list create did not preserve the exact project id and declared slug",
      { project_id: project.id, task_list_id: list.id, slug },
    );
  }
  return {
    mode: "apply",
    action: "created",
    project: projectReadback,
    task_list: readback,
    receipt: receiptFor(store, projectReadback, readback, idempotencyKey),
  };
}

export async function rollbackProjectTaskListEnsure(
  store: TodosStorageAdapter,
  projectId: string,
  options: { receipt_id: string; expected_task_list_revision: string },
): Promise<ProjectTaskListRollbackResult> {
  const conditionalDelete = store.taskLists.deleteIfUnchangedAndUnused;
  if (!conditionalDelete) {
    throw new ProjectTaskListEnsureError(
      "PROJECT_TASK_LIST_ROLLBACK_CONFLICT",
      "This storage backend cannot guarantee atomic conditional rollback; refusing to delete",
      { project_id: projectId, receipt_id: options.receipt_id },
    );
  }
  const project = await store.projects.get(projectId);
  if (!project) {
    throw new ProjectTaskListEnsureError("PROJECT_NOT_FOUND", `Project not found: ${projectId}`);
  }
  const candidates = (await store.taskLists.list(project.id)).filter((list) =>
    storedMarker(list)?.receipt_id === options.receipt_id
  );
  if (candidates.length !== 1) {
    throw new ProjectTaskListEnsureError(
      "PROJECT_TASK_LIST_RECEIPT_NOT_FOUND",
      "No exact operation-owned task list matches this rollback receipt",
      { project_id: project.id, receipt_id: options.receipt_id },
    );
  }
  const list = candidates[0]!;
  const marker = storedMarker(list)!;
  if (
    marker.project_id !== project.id
    || marker.slug !== list.slug
    || list.project_id !== project.id
    || list.updated_at !== options.expected_task_list_revision
    || semanticListDigest(list) !== marker.result_digest
  ) {
    throw new ProjectTaskListEnsureError(
      "PROJECT_TASK_LIST_ROLLBACK_CONFLICT",
      "The operation-owned task list drifted; refusing conditional rollback",
      { project_id: project.id, task_list_id: list.id, receipt_id: options.receipt_id },
    );
  }
  const deletion = await conditionalDelete.call(store.taskLists, list.id, {
    project_id: list.project_id,
    slug: list.slug,
    name: list.name,
    description: list.description,
    metadata: list.metadata,
    updated_at: list.updated_at,
  });
  if (deletion.status === "has_dependents") {
    throw new ProjectTaskListEnsureError(
      "PROJECT_TASK_LIST_ROLLBACK_HAS_DEPENDENTS",
      "The operation-owned task list has dependents; refusing conditional rollback",
      {
        task_list_id: list.id,
        task_dependents: deletion.task_dependents,
        plan_dependents: deletion.plan_dependents,
      },
    );
  }
  if (deletion.status !== "deleted" || await store.taskLists.get(list.id)) {
    throw new ProjectTaskListEnsureError(
      "PROJECT_TASK_LIST_ROLLBACK_CONFLICT",
      "Conditional rollback did not remove the exact task list",
      { task_list_id: list.id },
    );
  }
  return {
    schema_version: PROJECT_TASK_LIST_ENSURE_SCHEMA_VERSION,
    action: "removed",
    project_id: project.id,
    task_list_id: list.id,
    accepted_receipt_id: options.receipt_id,
    rollback_receipt_id: `ptlr_inverse_${digest({ accepted_receipt_id: options.receipt_id }).slice(0, 38)}`,
    removed_at: new Date().toISOString(),
  };
}
