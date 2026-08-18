import {
  TodosTaskSubtreeTransferError,
  type TodosTaskSubtreeTransferAuthority,
  type TodosTaskSubtreeTransferHttpClientOptions,
} from "./types.js";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;
const REQUEST_BYTES = 2 * 1024 * 1024;
const RESPONSE_BYTES = 8 * 1024 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function status(error: TodosTaskSubtreeTransferError): number {
  switch (error.code) {
    case "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT":
    case "TODOS_TASK_SUBTREE_TRANSFER_FOREIGN_REFERENCE":
    case "TODOS_TASK_SUBTREE_TRANSFER_HIERARCHY_CYCLE":
      return 400;
    case "TODOS_TASK_SUBTREE_TRANSFER_RECEIPT_NOT_FOUND":
    case "TODOS_TASK_SUBTREE_TRANSFER_NOT_FOUND":
      return 404;
    case "TODOS_TASK_SUBTREE_TRANSFER_ATOMICITY_UNAVAILABLE":
      return 503;
    default:
      return 409;
  }
}

async function boundedText(
  message: Request | Response,
  limit: number,
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
        throw new TodosTaskSubtreeTransferError(
          "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
          "Task-subtree-transfer HTTP body exceeds the byte bound",
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function readBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > REQUEST_BYTES) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
      "Task-subtree-transfer request exceeds the byte bound",
    );
  }
  const text = await boundedText(request, REQUEST_BYTES);
  try {
    return JSON.parse(text);
  } catch {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
      "Invalid JSON body",
    );
  }
}

export async function handleTodosTaskSubtreeTransferHttpRequest(
  request: Request,
  url: URL,
  authority: TodosTaskSubtreeTransferAuthority,
  basePath = "/v1/task-subtree-transfer",
): Promise<Response | null> {
  if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) return null;
  const action = url.pathname.slice(basePath.length).split("/").filter(Boolean).join("/");
  try {
    if ((action === "" || action === "capability") && request.method === "GET") {
      return json({ capability: await authority.capability() });
    }
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
    if (action === "inspect") return json({ inspection: await authority.inspect(await readBody(request)) });
    if (action === "apply") return json({ result: await authority.apply(await readBody(request)) }, 201);
    if (action === "rollback") return json({ result: await authority.rollback(await readBody(request)) }, 201);
    if (action === "read-exact") {
      const input = await readBody(request) as { receipt_id?: unknown };
      if (!input || typeof input.receipt_id !== "string") {
        throw new TodosTaskSubtreeTransferError(
          "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
          "receipt_id is required",
        );
      }
      return json({ result: await authority.readExact(input.receipt_id) });
    }
    return json({ error: "unknown task-subtree-transfer route" }, 404);
  } catch (cause) {
    if (cause instanceof TodosTaskSubtreeTransferError) {
      return json({
        error: cause.message,
        code: cause.code,
        details: cause.details,
        authoritative: true,
      }, status(cause));
    }
    return json({ error: "internal task-subtree-transfer error" }, 500);
  }
}

export class TodosTaskSubtreeTransferHttpClient implements TodosTaskSubtreeTransferAuthority {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly headers: Record<string, string>;

  constructor(options: TodosTaskSubtreeTransferHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.headers = {
      ...options.headers,
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      "Content-Type": "application/json",
    };
  }

  private async request<T>(action: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/task-subtree-transfer${action}`, {
      ...init,
      headers: { ...this.headers, ...(init.headers ?? {}) },
    });
    const text = await boundedText(response, RESPONSE_BYTES);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new TodosTaskSubtreeTransferError(
        "TODOS_TASK_SUBTREE_TRANSFER_HTTP_ERROR",
        `Task-subtree-transfer HTTP ${response.status} returned invalid JSON`,
      );
    }
    if (!response.ok) {
      throw new TodosTaskSubtreeTransferError(
        typeof payload.code === "string"
          ? payload.code as TodosTaskSubtreeTransferError["code"]
          : "TODOS_TASK_SUBTREE_TRANSFER_HTTP_ERROR",
        typeof payload.error === "string"
          ? payload.error
          : `Task-subtree-transfer HTTP ${response.status}`,
        payload.details && typeof payload.details === "object"
          ? payload.details as Record<string, unknown>
          : {},
      );
    }
    return payload as T;
  }

  async capability() {
    return (await this.request<{ capability: Awaited<ReturnType<TodosTaskSubtreeTransferAuthority["capability"]>> }>("/capability")).capability;
  }

  async inspect(input: unknown) {
    return (await this.request<{ inspection: Awaited<ReturnType<TodosTaskSubtreeTransferAuthority["inspect"]>> }>(
      "/inspect",
      { method: "POST", body: JSON.stringify(input) },
    )).inspection;
  }

  async apply(input: unknown) {
    return (await this.request<{ result: Awaited<ReturnType<TodosTaskSubtreeTransferAuthority["apply"]>> }>(
      "/apply",
      { method: "POST", body: JSON.stringify(input) },
    )).result;
  }

  async readExact(receiptId: string) {
    return (await this.request<{ result: Awaited<ReturnType<TodosTaskSubtreeTransferAuthority["readExact"]>> }>(
      "/read-exact",
      { method: "POST", body: JSON.stringify({ receipt_id: receiptId }) },
    )).result;
  }

  async rollback(input: unknown) {
    return (await this.request<{ result: Awaited<ReturnType<TodosTaskSubtreeTransferAuthority["rollback"]>> }>(
      "/rollback",
      { method: "POST", body: JSON.stringify(input) },
    )).result;
  }
}

export function createTodosTaskSubtreeTransferHttpClient(
  options: TodosTaskSubtreeTransferHttpClientOptions,
): TodosTaskSubtreeTransferAuthority {
  return new TodosTaskSubtreeTransferHttpClient(options);
}
