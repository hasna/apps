import {
  TODOS_CAPABILITY_MANIFEST,
  TODOS_CONTRACT_DIGEST,
  TODOS_CONTRACT_VERSION,
  TODOS_MANIFEST_VERSION,
  TodosAuthorityHandshakeSchema,
  TodosModeSchema,
  createTodosAuthorityHandshake,
  type TodosAuthorityHandshake,
  type TodosMode,
} from "@hasna/contracts/todos";

export type TodosTopology = "embedded" | "customer_server" | "platform";
export type TodosAuthorityOwner = "customer" | "hasna";
export type TodosAuthorityTransport = "sqlite" | "http";
export type TodosAuthorityEnv = Record<string, string | undefined>;

export const TODOS_AUTHORITY_ENV = {
  mode: "HASNA_TODOS_MODE",
  topology: "HASNA_TODOS_TOPOLOGY",
  authorityId: "HASNA_TODOS_AUTHORITY_ID",
  apiUrl: "HASNA_TODOS_API_URL",
  apiKey: "HASNA_TODOS_API_KEY",
} as const;

/** Environment selectors retired by the local|cloud authority cutover. */
export const RETIRED_TODOS_AUTHORITY_ENV = [
  "HASNA_TODOS_STORAGE_MODE",
  "TODOS_STORAGE_MODE",
  "TODOS_MODE",
  "TODOS_URL",
  "TODOS_API_URL",
] as const;

export interface ResolvedTodosAuthority {
  mode: TodosMode;
  topology: TodosTopology;
  owner: TodosAuthorityOwner;
  transport: TodosAuthorityTransport;
  authorityId: string | null;
  apiBaseUrl: string | null;
  apiKey: string | null;
}

export type TodosAuthorityErrorCode =
  | "TODOS_INVALID_MODE"
  | "TODOS_INVALID_INPUT"
  | "TODOS_AUTHORITY_MISMATCH"
  | "TODOS_AUTHORITY_UNAVAILABLE"
  | "TODOS_AUTHENTICATION_FAILED";

export class TodosAuthorityError extends Error {
  constructor(
    readonly code: TodosAuthorityErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message}`, options);
    this.name = "TodosAuthorityError";
  }
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseMode(value: string | undefined): TodosMode {
  if (value === undefined) return "local";
  const parsed = TodosModeSchema.safeParse(value);
  if (!parsed.success) {
    throw new TodosAuthorityError(
      "TODOS_INVALID_MODE",
      `${TODOS_AUTHORITY_ENV.mode} must be exactly local or cloud`,
    );
  }
  return parsed.data;
}

function parseTopology(mode: TodosMode, value: string | undefined): TodosTopology {
  const topology = value === undefined ? (mode === "local" ? "embedded" : "platform") : value;
  if (topology !== "embedded" && topology !== "customer_server" && topology !== "platform") {
    throw new TodosAuthorityError(
      "TODOS_INVALID_INPUT",
      `${TODOS_AUTHORITY_ENV.topology} must be exactly embedded, customer_server, or platform`,
    );
  }
  if (mode === "cloud" && topology !== "platform") {
    throw new TodosAuthorityError(
      "TODOS_AUTHORITY_MISMATCH",
      "cloud mode is owned by the Hasna platform and requires topology=platform",
    );
  }
  if (mode === "local" && topology === "platform") {
    throw new TodosAuthorityError(
      "TODOS_AUTHORITY_MISMATCH",
      "local mode requires topology=embedded or topology=customer_server",
    );
  }
  return topology;
}

function normalizeAuthorityUrl(raw: string, mode: TodosMode): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TodosAuthorityError("TODOS_INVALID_INPUT", `${TODOS_AUTHORITY_ENV.apiUrl} must be an absolute URL`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TodosAuthorityError(
      "TODOS_INVALID_INPUT",
      `${TODOS_AUTHORITY_ENV.apiUrl} must not contain credentials, a query, or a fragment`,
    );
  }
  if (url.pathname !== "/" && url.pathname !== "/v1" && url.pathname !== "/v1/") {
    throw new TodosAuthorityError(
      "TODOS_INVALID_INPUT",
      `${TODOS_AUTHORITY_ENV.apiUrl} must be an authority root or end in /v1`,
    );
  }
  const loopback = url.hostname === "localhost" || url.hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (mode === "cloud" && url.protocol !== "https:") {
    throw new TodosAuthorityError("TODOS_INVALID_INPUT", "cloud mode requires the platform HTTPS data plane");
  }
  if (mode === "local" && url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new TodosAuthorityError(
      "TODOS_INVALID_INPUT",
      "a customer server must use HTTPS, except for an exact loopback development endpoint",
    );
  }
  return `${url.origin}/v1`;
}

/**
 * Resolve one authority without aliases, compatibility tokens, or URL/key/DSN
 * inference. This function is intentionally side-effect free and must run before
 * a CLI, MCP, SDK, or server imports mutation handlers.
 */
export function resolveTodosAuthority(
  env: TodosAuthorityEnv = process.env as TodosAuthorityEnv,
): ResolvedTodosAuthority {
  const retired = RETIRED_TODOS_AUTHORITY_ENV.find((name) => env[name] !== undefined);
  if (retired) {
    throw new TodosAuthorityError(
      "TODOS_INVALID_INPUT",
      `${retired} is retired; configure only ${TODOS_AUTHORITY_ENV.mode} and ${TODOS_AUTHORITY_ENV.topology}`,
    );
  }

  const mode = parseMode(env[TODOS_AUTHORITY_ENV.mode]);
  const topology = parseTopology(mode, env[TODOS_AUTHORITY_ENV.topology]);
  const authorityId = clean(env[TODOS_AUTHORITY_ENV.authorityId]);
  const rawUrl = clean(env[TODOS_AUTHORITY_ENV.apiUrl]);
  const apiKey = clean(env[TODOS_AUTHORITY_ENV.apiKey]);

  if (topology === "embedded") {
    if (rawUrl || apiKey) {
      throw new TodosAuthorityError(
        "TODOS_AUTHORITY_MISMATCH",
        "embedded local mode cannot be combined with HTTP authority credentials",
      );
    }
    return {
      mode,
      topology,
      owner: "customer",
      transport: "sqlite",
      authorityId,
      apiBaseUrl: null,
      apiKey: null,
    };
  }

  if (!rawUrl) {
    throw new TodosAuthorityError("TODOS_INVALID_INPUT", `${TODOS_AUTHORITY_ENV.apiUrl} is required for ${topology}`);
  }
  if (!apiKey) {
    throw new TodosAuthorityError("TODOS_AUTHENTICATION_FAILED", `${TODOS_AUTHORITY_ENV.apiKey} is required for ${topology}`);
  }

  return {
    mode,
    topology,
    owner: mode === "cloud" ? "hasna" : "customer",
    transport: "http",
    authorityId,
    apiBaseUrl: normalizeAuthorityUrl(rawUrl, mode),
    apiKey,
  };
}

export function createLocalTodosAuthorityHandshake(
  authorityId: string,
  issuedAt = new Date().toISOString(),
): TodosAuthorityHandshake {
  return createTodosAuthorityHandshake({
    mode: "local",
    authority: { id: authorityId, kind: "local_installation", endpoint: null },
    issuedAt,
  });
}

export function assertTodosAuthorityHandshake(
  value: unknown,
  expected: ResolvedTodosAuthority,
): TodosAuthorityHandshake {
  const parsed = TodosAuthorityHandshakeSchema.safeParse(value);
  if (!parsed.success) {
    throw new TodosAuthorityError("TODOS_AUTHORITY_MISMATCH", "authority returned an invalid Todos handshake");
  }
  const handshake = parsed.data;
  if (handshake.mode !== expected.mode) {
    throw new TodosAuthorityError(
      "TODOS_AUTHORITY_MISMATCH",
      `configured mode=${expected.mode} but authority reported mode=${handshake.mode}`,
    );
  }
  const expectedKind = expected.owner === "hasna" ? "cloud_tenant" : "local_installation";
  if (handshake.authority.kind !== expectedKind) {
    throw new TodosAuthorityError(
      "TODOS_AUTHORITY_MISMATCH",
      `configured owner=${expected.owner} but authority reported kind=${handshake.authority.kind}`,
    );
  }
  if (expected.authorityId && handshake.authority.id !== expected.authorityId) {
    throw new TodosAuthorityError(
      "TODOS_AUTHORITY_MISMATCH",
      `configured authority id ${expected.authorityId} does not match ${handshake.authority.id}`,
    );
  }
  if (handshake.contractVersion !== TODOS_CONTRACT_VERSION || handshake.contractDigest !== TODOS_CONTRACT_DIGEST ||
      handshake.manifestVersion !== TODOS_MANIFEST_VERSION ||
      handshake.manifestDigest !== TODOS_CAPABILITY_MANIFEST.manifestDigest) {
    throw new TodosAuthorityError(
      "TODOS_AUTHORITY_MISMATCH",
      "authority contract or capability manifest does not match this client",
    );
  }
  return handshake;
}

export async function fetchTodosAuthorityHandshake(
  authority: ResolvedTodosAuthority,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<TodosAuthorityHandshake> {
  if (authority.transport !== "http" || !authority.apiBaseUrl || !authority.apiKey) {
    throw new TodosAuthorityError("TODOS_AUTHORITY_MISMATCH", "an HTTP authority handshake was requested for embedded mode");
  }
  let response: Response;
  try {
    response = await fetchImpl(`${authority.apiBaseUrl}/authority`, {
      method: "GET",
      headers: {
        "x-api-key": authority.apiKey,
        Authorization: `Bearer ${authority.apiKey}`,
      },
      redirect: "manual",
    });
  } catch (error) {
    throw new TodosAuthorityError("TODOS_AUTHORITY_UNAVAILABLE", "authority handshake could not be reached", { cause: error });
  }
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? "TODOS_AUTHENTICATION_FAILED"
      : "TODOS_AUTHORITY_UNAVAILABLE";
    throw new TodosAuthorityError(code, `authority handshake returned HTTP ${response.status}`);
  }
  const body = await response.json() as unknown;
  const handshake = body && typeof body === "object" && "data" in body
    ? (body as { data: unknown }).data
    : body;
  return assertTodosAuthorityHandshake(handshake, authority);
}
