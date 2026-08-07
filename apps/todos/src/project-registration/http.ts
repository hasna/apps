import {
  TodosProjectRegistrationError,
  type TodosProjectRegistrationAuthority,
  type TodosProjectRegistrationCapability,
  type TodosProjectRegistrationHttpClientOptions,
  type TodosProjectRegistrationInverseVerification,
  type TodosProjectRegistrationLookupRequest,
  type TodosProjectRegistrationLookupResult,
  type TodosProjectRegistrationReceipt,
  type TodosProjectRegistrationRecord,
  type TodosProjectRegistrationRequest,
  type TodosProjectRegistrationResourceKind,
} from "./types.js";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorStatus(error: TodosProjectRegistrationError): number {
  switch (error.code) {
    case "TODOS_PROJECT_REGISTRATION_INVALID_INPUT":
    case "TODOS_PROJECT_REGISTRATION_INVALID_BOUNDS":
    case "TODOS_PROJECT_REGISTRATION_CAPABILITY_MISMATCH":
    case "TODOS_PROJECT_REGISTRATION_DIGEST_MISMATCH":
    case "TODOS_PROJECT_REGISTRATION_IDEMPOTENCY_MISMATCH":
    case "TODOS_PROJECT_REGISTRATION_EXACT_ID_REQUIRED":
      return 400;
    case "TODOS_PROJECT_REGISTRATION_RECEIPT_NOT_FOUND":
    case "TODOS_PROJECT_REGISTRATION_RECORD_NOT_FOUND":
    case "TODOS_PROJECT_REGISTRATION_ACCEPTED_RECEIPT_NOT_FOUND":
      return 404;
    case "TODOS_PROJECT_REGISTRATION_RESPONSE_TOO_LARGE":
      return 413;
    case "TODOS_PROJECT_REGISTRATION_TIME_BUDGET_EXCEEDED":
      return 408;
    case "TODOS_PROJECT_REGISTRATION_ATOMICITY_UNAVAILABLE":
      return 503;
    default:
      return 409;
  }
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await req.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function handleTodosProjectRegistrationHttpRequest(
  req: Request,
  url: URL,
  authority: TodosProjectRegistrationAuthority,
  basePath: "/v1/project-registration" | "/api/project-registration" =
    "/v1/project-registration",
): Promise<Response | null> {
  const path = url.pathname;
  if (path !== basePath && !path.startsWith(`${basePath}/`)) return null;
  const action = path.slice(basePath.length).split("/").filter(Boolean).join("/");
  const method = req.method.toUpperCase();

  try {
    if ((action === "" || action === "capability") && method === "GET") {
      return json({ capability: await authority.capability() });
    }
    if (method !== "POST") return json({ error: "method not allowed" }, 405);
    const body = await readJson(req);
    if (!body) {
      return json({
        error: "invalid JSON body",
        code: "TODOS_PROJECT_REGISTRATION_INVALID_INPUT",
      }, 400);
    }
    if (action === "create") {
      return json({
        receipt: await authority.create(body as unknown as TodosProjectRegistrationRequest),
      }, 201);
    }
    if (action === "receipts/lookup") {
      return json(await authority.lookupReceipt(
        body as unknown as TodosProjectRegistrationLookupRequest,
      ));
    }
    if (action === "read-exact") {
      return json({
        record: await authority.readExact(body as unknown as {
          resource_kind: TodosProjectRegistrationResourceKind;
          target_id: string;
          target: unknown;
          response_byte_limit: number;
          time_budget_ms: number;
        }),
      });
    }
    if (action === "compensate") {
      return json({
        receipt: await authority.compensate(
          body as unknown as TodosProjectRegistrationRequest,
        ),
      }, 201);
    }
    if (action === "verify-inverse") {
      return json({
        verification: await authority.verifyInverse(
          body as unknown as TodosProjectRegistrationRequest,
        ),
      });
    }
    return json({
      error: "unknown Todos project-registration route",
      code: "TODOS_PROJECT_REGISTRATION_RECEIPT_NOT_FOUND",
    }, 404);
  } catch (cause) {
    if (cause instanceof TodosProjectRegistrationError) {
      return json({
        error: cause.message,
        code: cause.code,
        details: cause.details,
        authoritative: true,
      }, errorStatus(cause));
    }
    return json({
      error: cause instanceof Error ? cause.message : "internal registration error",
      code: "TODOS_PROJECT_REGISTRATION_ATOMICITY_UNAVAILABLE",
    }, 500);
  }
}

function withoutTarget<T extends { target?: unknown }>(value: T): Omit<T, "target"> {
  const { target: _target, ...serializable } = value;
  return serializable;
}

export class TodosProjectRegistrationHttpClient
implements TodosProjectRegistrationAuthority {
  readonly authority = "todos" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly headers: Record<string, string>;

  constructor(options: TodosProjectRegistrationHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.headers = {
      ...options.headers,
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    action: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/project-registration${action}`,
      {
        ...init,
        headers: { ...this.headers, ...(init.headers ?? {}) },
      },
    );
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      throw new TodosProjectRegistrationError(
        typeof body["code"] === "string"
          ? body["code"] as TodosProjectRegistrationError["code"]
          : "TODOS_PROJECT_REGISTRATION_ATOMICITY_UNAVAILABLE",
        typeof body["error"] === "string"
          ? body["error"]
          : `Todos project registration HTTP ${response.status}`,
        body["details"] && typeof body["details"] === "object"
          ? body["details"] as Record<string, unknown>
          : {},
      );
    }
    return body as T;
  }

  async capability(): Promise<TodosProjectRegistrationCapability> {
    const body = await this.request<{ capability: TodosProjectRegistrationCapability }>(
      "/capability",
    );
    return body.capability;
  }

  async create(
    request: TodosProjectRegistrationRequest,
  ): Promise<TodosProjectRegistrationReceipt> {
    const body = await this.request<{ receipt: TodosProjectRegistrationReceipt }>(
      "/create",
      { method: "POST", body: JSON.stringify(withoutTarget(request)) },
    );
    return body.receipt;
  }

  async readExact(request: {
    resource_kind: TodosProjectRegistrationResourceKind;
    target_id: string;
    target: unknown;
    response_byte_limit: number;
    time_budget_ms: number;
  }): Promise<TodosProjectRegistrationRecord> {
    const body = await this.request<{ record: TodosProjectRegistrationRecord }>(
      "/read-exact",
      { method: "POST", body: JSON.stringify(withoutTarget(request)) },
    );
    return body.record;
  }

  async lookupReceipt(
    request: TodosProjectRegistrationLookupRequest,
  ): Promise<TodosProjectRegistrationLookupResult> {
    return this.request<TodosProjectRegistrationLookupResult>(
      "/receipts/lookup",
      { method: "POST", body: JSON.stringify(request) },
    );
  }

  async compensate(
    request: TodosProjectRegistrationRequest,
  ): Promise<TodosProjectRegistrationReceipt> {
    const body = await this.request<{ receipt: TodosProjectRegistrationReceipt }>(
      "/compensate",
      { method: "POST", body: JSON.stringify(withoutTarget(request)) },
    );
    return body.receipt;
  }

  async verifyInverse(
    request: TodosProjectRegistrationRequest,
  ): Promise<TodosProjectRegistrationInverseVerification> {
    const body = await this.request<{
      verification: TodosProjectRegistrationInverseVerification;
    }>("/verify-inverse", {
      method: "POST",
      body: JSON.stringify(withoutTarget(request)),
    });
    return body.verification;
  }
}

export function createTodosProjectRegistrationHttpClient(
  options: TodosProjectRegistrationHttpClientOptions,
): TodosProjectRegistrationAuthority {
  return new TodosProjectRegistrationHttpClient(options);
}
