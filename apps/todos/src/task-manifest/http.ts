import {
  TodosTaskManifestError,
  type TodosTaskManifestApplyResult,
  type TodosTaskManifestAuthority,
  type TodosTaskManifestCapability,
  type TodosTaskManifestCompensateRequest,
  type TodosTaskManifestCompensationResult,
  type TodosTaskManifestHttpClientOptions,
} from "./types.js";
import { TODOS_TASK_MANIFEST_BOUNDS } from "./schema.js";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function status(error: TodosTaskManifestError): number {
  switch (error.code) {
    case "TODOS_TASK_MANIFEST_INVALID_INPUT":
    case "TODOS_TASK_MANIFEST_BOUNDS_EXCEEDED":
    case "TODOS_TASK_MANIFEST_FOREIGN_REFERENCE": return 400;
    case "TODOS_TASK_MANIFEST_RECEIPT_NOT_FOUND": return 404;
    case "TODOS_TASK_MANIFEST_ATOMICITY_UNAVAILABLE": return 503;
    default: return 409;
  }
}

async function body(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > TODOS_TASK_MANIFEST_BOUNDS.request_bytes) {
    throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_BOUNDS_EXCEEDED", "Task-manifest HTTP body exceeds the request bound");
  }
  const text = await boundedText(request, TODOS_TASK_MANIFEST_BOUNDS.request_bytes, "request");
  try { return JSON.parse(text); } catch {
    throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_INVALID_INPUT", "Invalid JSON body");
  }
}

async function boundedText(
  message: Request | Response,
  limit: number,
  label: "request" | "response",
): Promise<string> {
  if (!message.body) return "";
  const reader = message.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new TodosTaskManifestError(
          "TODOS_TASK_MANIFEST_BOUNDS_EXCEEDED",
          `Task-manifest HTTP ${label} exceeds the byte bound`,
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function handleTodosTaskManifestHttpRequest(
  request: Request,
  url: URL,
  authority: TodosTaskManifestAuthority,
  basePath = "/v1/task-manifest",
): Promise<Response | null> {
  if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) return null;
  const action = url.pathname.slice(basePath.length).split("/").filter(Boolean).join("/");
  try {
    if ((action === "" || action === "capability") && request.method === "GET") {
      return json({ capability: await authority.capability() });
    }
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
    if (action === "apply") return json({ result: await authority.apply(await body(request)) }, 201);
    if (action === "read-exact") {
      const input = await body(request) as { receipt_id?: unknown };
      if (!input || typeof input.receipt_id !== "string") {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_INVALID_INPUT", "receipt_id is required");
      }
      return json({ result: await authority.readExact(input.receipt_id) });
    }
    if (action === "compensate") {
      return json({ result: await authority.compensate(await body(request) as TodosTaskManifestCompensateRequest) }, 201);
    }
    if (action === "outbox/delivered") {
      const input = await body(request) as { outbox_id?: unknown };
      if (!input || typeof input.outbox_id !== "string") {
        throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_INVALID_INPUT", "outbox_id is required");
      }
      await authority.markOutboxDelivered(input.outbox_id);
      return json({ delivered: true });
    }
    return json({ error: "unknown task-manifest route" }, 404);
  } catch (cause) {
    if (cause instanceof TodosTaskManifestError) {
      return json({ error: cause.message, code: cause.code, details: cause.details, authoritative: true }, status(cause));
    }
    return json({ error: cause instanceof Error ? cause.message : "task-manifest error" }, 500);
  }
}

export class TodosTaskManifestHttpClient implements TodosTaskManifestAuthority {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly headers: Record<string, string>;

  constructor(options: TodosTaskManifestHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.headers = {
      ...options.headers,
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      "Content-Type": "application/json",
    };
  }

  private async request<T>(action: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/task-manifest${action}`, {
      ...init,
      headers: { ...this.headers, ...(init.headers ?? {}) },
    });
    const responseText = await boundedText(response, TODOS_TASK_MANIFEST_BOUNDS.response_bytes, "response");
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      throw new TodosTaskManifestError(
        "TODOS_TASK_MANIFEST_HTTP_ERROR",
        `Task-manifest HTTP ${response.status} returned invalid JSON`,
      );
    }
    if (!response.ok) {
      throw new TodosTaskManifestError(
        typeof payload["code"] === "string" ? payload["code"] as TodosTaskManifestError["code"] : "TODOS_TASK_MANIFEST_HTTP_ERROR",
        typeof payload["error"] === "string" ? payload["error"] : `Task-manifest HTTP ${response.status}`,
        payload["details"] && typeof payload["details"] === "object" ? payload["details"] as Record<string, unknown> : {},
      );
    }
    return payload as T;
  }

  async capability(): Promise<TodosTaskManifestCapability> {
    return (await this.request<{ capability: TodosTaskManifestCapability }>("/capability")).capability;
  }

  async apply(input: unknown): Promise<TodosTaskManifestApplyResult> {
    return (await this.request<{ result: TodosTaskManifestApplyResult }>("/apply", { method: "POST", body: JSON.stringify(input) })).result;
  }

  async readExact(receiptId: string): Promise<TodosTaskManifestApplyResult> {
    return (await this.request<{ result: TodosTaskManifestApplyResult }>("/read-exact", { method: "POST", body: JSON.stringify({ receipt_id: receiptId }) })).result;
  }

  async markOutboxDelivered(outboxId: string): Promise<void> {
    await this.request<{ delivered: true }>("/outbox/delivered", { method: "POST", body: JSON.stringify({ outbox_id: outboxId }) });
  }

  async compensate(input: TodosTaskManifestCompensateRequest): Promise<TodosTaskManifestCompensationResult> {
    return (await this.request<{ result: TodosTaskManifestCompensationResult }>("/compensate", { method: "POST", body: JSON.stringify(input) })).result;
  }
}

export function createTodosTaskManifestHttpClient(options: TodosTaskManifestHttpClientOptions): TodosTaskManifestAuthority {
  return new TodosTaskManifestHttpClient(options);
}
