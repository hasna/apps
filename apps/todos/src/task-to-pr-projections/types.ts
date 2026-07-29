import type { TaskToPrProjection } from "@hasna/contracts/todos";

export type { TaskToPrProjection } from "@hasna/contracts/todos";

export interface TaskToPrProjectionScope {
  sourceGroupId?: string | null;
  projectId?: string | null;
  taskListId?: string | null;
  planId?: string | null;
  agentId?: string | null;
  status?: string | null;
}

export interface TaskToPrProjectionListOptions {
  cursor?: string | null;
  limit?: number;
  projectId?: string | null;
  taskListId?: string | null;
  planId?: string | null;
  agentId?: string | null;
  status?: string | null;
  changedAfter?: string | null;
}

export interface TaskToPrProjectionPage {
  items: TaskToPrProjection[];
  count: number;
  nextCursor: string | null;
}

export interface TaskToPrProjectionWriteResult {
  projection: TaskToPrProjection;
  changed: boolean;
  replayed: boolean;
}

export interface TaskToPrProjectionRebuildInput {
  taskRefs: string[];
  expectedManifestDigest: string;
}

export interface TaskToPrProjectionMutationReceipt {
  operationId: "todos.task_to_pr_projection.rebuild";
  resourceId: string;
  changed: boolean;
  replayed: boolean;
  version: number | null;
}

export interface TaskToPrProjectionRebuildResult {
  receipts: TaskToPrProjectionMutationReceipt[];
}

export type TaskToPrProjectionSuccess<T> = {
  ok: true;
  data: T;
  requestId: string;
};

