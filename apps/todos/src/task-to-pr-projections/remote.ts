import {
  TODOS_CONTRACT_DIGEST,
  TODOS_OPERATION_MANIFEST_DIGEST,
  TODOS_REQUEST_SCHEMA_IDS,
  TODOS_REQUEST_SCHEMAS,
  TODOS_RESPONSE_SCHEMA_IDS,
  TODOS_RESPONSE_SCHEMAS,
  type TaskToPrProjection,
} from "@hasna/contracts/todos";
import { TodosV1Client } from "../sdk/v1.generated.js";
import { getTodosRemoteAuthorityConfigStatus } from "../cli/cloud-router.js";
import type {
  TaskToPrProjectionListOptions,
  TaskToPrProjectionPage,
} from "./types.js";

type Env = Record<string, string | undefined>;

function requestId(): string {
  return `todos-projection-${crypto.randomUUID()}`;
}

function authorityId(env: Env, baseUrl: string): string {
  const configured = env["HASNA_TODOS_AUTHORITY_ID"]?.trim().toLowerCase();
  const candidate = configured || new URL(baseUrl).hostname.toLowerCase();
  if (!/^[a-z][a-z0-9.-]*$/.test(candidate)) {
    throw new Error(
      "REMOTE_AUTHORITY_ID_INVALID: HASNA_TODOS_AUTHORITY_ID must match ^[a-z][a-z0-9.-]*$; " +
        "local SQLite fallback is disabled",
    );
  }
  return candidate;
}

function contractHeaders(
  operationId: "todos.task_to_pr_projection.list" | "todos.task_to_pr_projection.get",
  authority: string,
): Record<string, string> {
  return {
    "X-Todos-Mode": "cloud",
    "X-Todos-Authority-Id": authority,
    "X-Todos-Contract-Digest": TODOS_CONTRACT_DIGEST,
    "X-Todos-Manifest-Digest": TODOS_OPERATION_MANIFEST_DIGEST,
    "X-Todos-Operation-Id": operationId,
    "X-Todos-Request-Id": requestId(),
  };
}

function invalidResponse(route: string, cause?: unknown): never {
  throw new Error(
    `REMOTE_API_INCOMPATIBLE: ${route} returned a response outside @hasna/contracts; ` +
      "local SQLite fallback is disabled",
    cause === undefined ? undefined : { cause },
  );
}

function unwrapResult<T extends { ok: boolean }>(value: T, route: string): Extract<T, { ok: true }>["data"] {
  if (!value.ok) {
    const failure = value as T & { error?: { code?: string; message?: string } };
    throw new Error(
      `REMOTE_API_${failure.error?.code ?? "ERROR"}: ${failure.error?.message ?? `${route} failed`}; ` +
        "local SQLite fallback is disabled",
    );
  }
  return (value as Extract<T, { ok: true }>).data;
}

export class TaskToPrProjectionCloudReader {
  constructor(
    private readonly client: TodosV1Client,
    private readonly authority: string,
  ) {}

  async list(options: TaskToPrProjectionListOptions = {}): Promise<TaskToPrProjectionPage> {
    const request = TODOS_REQUEST_SCHEMAS[TODOS_REQUEST_SCHEMA_IDS.list].parse({
      cursor: options.cursor ?? null,
      limit: options.limit ?? 100,
      projectId: options.projectId ?? null,
      taskListId: options.taskListId ?? null,
      planId: options.planId ?? null,
      agentId: options.agentId ?? null,
      status: options.status ?? null,
      changedAfter: options.changedAfter ?? null,
    });
    const route = "/v1/task-to-pr-projections";
    const raw = await this.client.listTaskToPrProjections(request, {
      headers: contractHeaders("todos.task_to_pr_projection.list", this.authority),
      redirect: "manual",
    });
    const parsed = TODOS_RESPONSE_SCHEMAS[TODOS_RESPONSE_SCHEMA_IDS.projectionPage].safeParse(raw);
    if (!parsed.success) return invalidResponse(route, parsed.error);
    return unwrapResult(parsed.data, route);
  }

  async get(ref: string): Promise<TaskToPrProjection> {
    const request = TODOS_REQUEST_SCHEMAS[TODOS_REQUEST_SCHEMA_IDS.ref].parse({ ref });
    const route = `/v1/task-to-pr-projections/${encodeURIComponent(request.ref)}`;
    const raw = await this.client.getTaskToPrProjection(request.ref, {
      headers: contractHeaders("todos.task_to_pr_projection.get", this.authority),
      redirect: "manual",
    });
    const parsed = TODOS_RESPONSE_SCHEMAS[TODOS_RESPONSE_SCHEMA_IDS.projection].safeParse(raw);
    if (!parsed.success) return invalidResponse(route, parsed.error);
    return unwrapResult(parsed.data, route);
  }
}

export function createTaskToPrProjectionCloudReader(
  env: Env = process.env as Env,
): TaskToPrProjectionCloudReader | null {
  const status = getTodosRemoteAuthorityConfigStatus(env);
  if (!status.selected) return null;
  if (!status.ok || !status.v1_base_url) {
    throw new Error(status.issues[0] ?? "REMOTE_API_UNAVAILABLE: cloud authority is invalid");
  }
  const apiKey = env["HASNA_TODOS_API_KEY"]?.trim();
  if (!apiKey) {
    throw new Error("REMOTE_API_KEY_MISSING: remote projection reads require HASNA_TODOS_API_KEY");
  }
  const baseUrl = status.v1_base_url.replace(/\/v1$/, "");
  const client = new TodosV1Client({
    baseUrl,
    headers: { Authorization: `Bearer ${apiKey}` },
    fetch: (input, init) => globalThis.fetch(input, { ...init, redirect: "manual" }),
  });
  return new TaskToPrProjectionCloudReader(client, authorityId(env, baseUrl));
}
