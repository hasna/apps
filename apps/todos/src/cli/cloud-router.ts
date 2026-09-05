/**
 * Authenticated `/v1` routing for the Hasna Todos CLI.
 *
 * The client seam has exactly two transports: the local SQLite file or the
 * hosted HTTP `/v1` authority. Selecting the http transport requires the
 * canonical API URL and API key; with neither present the CLI FAILS CLOSED
 * unless the local SQLite file is selected by the EXPLICIT opt-in
 * (HASNA_TODOS_LOCAL=1 or TODOS_LOCAL=1) — there is no implicit default to
 * local storage and no silent fallback. Validating the authority happens
 * before a local-capable command module can run. This is the repo-owned REST
 * contract; it has no dependency on a private SaaS API or database connection
 * string, and the client never opens Postgres directly.
 */
import {
  clientTransportEnvKeys,
  resolveClientTransport,
  type ClientTransportResolution,
  type ResolveClientTransportOptions,
} from "@hasna/contracts/client";
import { resolveStorageClient, type HasnaStorageClient } from "@hasna/contracts/client/storage";
import { randomUUID } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import type { Agent, CreatePlanInput, CreateTaskListInput, CreateTemplateInput, Plan, PlanComment, PlanProjectLinkResult, PlanProjectLinkRollbackResult, Project, ProjectTaskListEnsureResult, ProjectTaskListRollbackResult, RegisterAgentInput, StaleLockHandoffReceipt, Task, TaskComment, TaskDependency, TaskFilter, TaskHistory, TaskList, TaskTemplate, TemplateWithTasks, UpdatePlanInput, UpdateTaskListInput } from "../types/index.js";
import { isBlockingDependencyStatus } from "../types/index.js";
import type { TodosTaskFailureResult, UpdateTemplateInput } from "../storage/interfaces.js";
import { redactEvidenceText } from "../lib/redaction.js";
import { changedSinceStampNewer } from "../lib/instant-compare.js";
import type { IntegrityReport, IntegrityTaskRow } from "../lib/integrity.js";
import {
  PLAN_PROJECT_LINK_SCHEMA_VERSION,
  assertPlanProjectLinkResponse,
  assertPlanProjectLinkRollbackResponse,
  normalizePlanProjectLinkIdempotencyKey,
} from "../lib/plan-project-link-contract.js";
import type { PrGroupEventListOptions, PrGroupEventPage, PrGroupStateView } from "../pr-groups/types.js";
import { parsePrGroupEventPage, parsePrGroupStateView } from "../pr-groups/http-client.js";
import type {
  TodosTaskManifestApplyResult,
  TodosTaskManifestBindingLookupRequest,
  TodosTaskManifestBindingLookupResult,
  TodosTaskManifestCapability,
  TodosTaskManifestCompensateRequest,
  TodosTaskManifestCompensationResult,
} from "../task-manifest/index.js";
import type {
  TodosTaskSubtreeTransferCapability,
  TodosTaskSubtreeTransferInspection,
  TodosTaskSubtreeTransferResult,
} from "../task-subtree-transfer/index.js";
import type {
  TodosProjectRegistrationCapability,
  TodosProjectRegistrationInverseVerification,
  TodosProjectRegistrationLookupRequest,
  TodosProjectRegistrationLookupResult,
  TodosProjectRegistrationReceipt,
  TodosProjectRegistrationRecord,
  TodosProjectRegistrationRequest,
  TodosProjectRegistrationResourceKind,
  TodosPriorRegistrationAdoptionValidation,
  TodosPriorRegistrationAdoptionValidationRequest,
  TodosProjectResourcePage,
  TodosProjectResourcePageRequest,
} from "../project-registration/index.js";
import {
  assertTodosPriorRegistrationAdoptionValidationEnvelope,
} from "../project-registration/adoption-validation.js";
import { assertTodosProjectResourcePage } from "../project-registration/page-validation.js";
import {
  TODOS_LOCAL_OPT_IN_ENV_KEYS,
  isTodosLocalOptIn,
  selectsTodosLocalStore,
  todosResolverInputs,
} from "../lib/local-opt-in.js";

type Env = Record<string, string | undefined>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The OSS client seam has exactly TWO implementations (owner directive
 * 2026-07-29, knowledge k_ms3e6v41_zbe7m8): the local SQLite file or the hosted
 * HTTP `/v1` authority. The client never opens Postgres directly.
 *
 * CREDENTIALS ARE NOT RESOLVED HERE ANY MORE. Since the 2026-09-04 adoption
 * ruling (hasna/apps#1720, and #1668 / #1690 / #1613 / #1599) every hosted
 * Hasna CLI resolves its credential and its service authority through the ONE
 * resolver in `@hasna/contracts/client`, so this module contributes no tier of
 * its own. The chain, resolved fresh on every call:
 *
 *   1. an explicit argument      — `credentials.apiKey` / `credentials.profile`
 *   2. a deliberate env pointer  — `HASNA_TODOS_API_KEY_OVERRIDE`, `HASNA_PROFILE`,
 *                                  `HASNA_TODOS_API_KEY_REF`
 *   3. the macOS Keychain        — generic-password `hasna.credentials.todos.api-key`,
 *                                  account `HASNA_STATION`, else `hostname -s`, else `USER`
 *   4. disk                      — `~/.hasna/todos/config/credentials`, owner-only
 *                                  0400/0600 (`HASNA_HOME` / `HASNA_CONFIG_HOME` move the root)
 *   5. `HASNA_TODOS_API_KEY`     — a legitimate tier below disk, no deprecation notice
 *
 * and the authority follows `HASNA_TODOS_API_URL`, then the Keychain `api-url`
 * item, then the credentials file, and finally defaults to the fleet gateway
 * `https://api.hasna.com/todos` (the client appends `/v1`). The legacy
 * unprefixed `TODOS_*` spellings survive only as the resolver's silent alias
 * fallback for one release; the canonical `HASNA_TODOS_*` names are the
 * documented ones and are what every message here names.
 *
 * Retired locations — `~/.hasna/fleet-env/`, `~/.hasna/cloud/`,
 * `~/.config/hasna/` — are inputs nowhere, and no `*_MODE` / `*_STORAGE_MODE`
 * variable is read: the transport is decided by what RESOLVES, never by a mode
 * word.
 *
 * FAIL LOUD. Hosted mode with no credential exits non-zero with one clear line;
 * there is no SQLite fallback and no local-fallback event. The on-box SQLite
 * file is reachable ONLY through the deliberate unhosted opt-in
 * `HASNA_TODOS_LOCAL=1` (alias `TODOS_LOCAL=1`).
 *
 * THE OPT-IN IS ANSWERED SECOND, AND THAT ORDER IS LOAD-BEARING IN BOTH
 * DIRECTIONS. An environment that CONFIGURES a Todos authority or credential
 * outranks the opt-in: a run with the API pair set goes hosted (and a
 * half-configured pair fails loudly) rather than quietly serving a different
 * dataset because a stale `HASNA_TODOS_LOCAL` was lying around. But when the
 * environment configures nothing, the opt-in is answered WITHOUT calling the
 * resolver at all — no Keychain item and no credential file is read — and that
 * is what lets `@hasna/todos/testing` still promise that a scrubbed test
 * environment physically cannot reach the shared store, now that a credential
 * can arrive from somewhere an env dictionary cannot blank.
 */
export type TodosCliTransport = "sqlite" | "http";

export { TODOS_LOCAL_OPT_IN_ENV_KEYS, isTodosLocalOptIn };

/** Tier-1 credential inputs and Keychain-tier controls, forwarded verbatim. */
export type TodosCredentialOptions = NonNullable<ResolveClientTransportOptions["credentials"]>;

export interface TodosClientResolveOptions {
  /** `--api-key` / `--profile`, and the injectable `security` runner tests use. */
  credentials?: TodosCredentialOptions;
}

const COMPLETION_EVIDENCE_FIELDS = [
  "attachment_ids",
  "files_changed",
  "test_results",
  "commit_hash",
  "notes",
  "confidence",
] as const;

export interface CloudTaskCompletionInput {
  agent_id?: string;
  attachment_ids?: string[];
  files_changed?: string[];
  test_results?: string;
  commit_hash?: string;
  notes?: string;
  confidence?: number;
}

export interface CloudTaskCreateVerification {
  expectedCreatedBy?: string;
}

const completionCapabilityCache = new Map<string, Promise<ReadonlySet<string>>>();
const retryCapabilityCache = new Map<string, Promise<boolean>>();
const taskCreatorCapabilityCache = new Map<string, Promise<boolean>>();
const gitRefCapabilityCache = new Map<string, Promise<ReadonlySet<RemoteGitRefCapability>>>();
const remoteCommandCapabilityCache =
  new Map<string, Promise<ReadonlySet<TodosRemoteCommandCapability>>>();

type RemoteGitRefCapability = "task-read" | "task-write" | "reverse-read";
export type TodosRemoteCommandCapability = "stale-lock-handoff";

export interface TodosRemoteAuthorityConfigStatus {
  selected: boolean;
  ok: boolean;
  transport: string;
  api_url_configured: boolean;
  api_key_configured: boolean;
  /** WHERE the authority came from: an env key NAME, a Keychain item reference, a file PATH, or "default". */
  api_url_source: string | null;
  /** WHERE the credential came from: an env key NAME, a Keychain item reference, or a file PATH. Never a value. */
  api_key_source: string | null;
  /** Which tier of the @hasna/contracts chain supplied the credential. */
  api_key_tier: string | null;
  v1_base_url: string | null;
  issues: string[];
  local_fallback: false;
}

export interface TodosCliTransportResolution {
  /** Canonical transport the environment resolved to (`sqlite` | `http`). */
  transport: TodosCliTransport;
  selected: boolean;
  /**
   * What selected the transport: `"local-opt-in"` for the deliberate unhosted
   * store, else `"<api key source>+<api url source>"` as the contracts resolver
   * reported them (env key NAMES, a Keychain item reference, a file path, or
   * `"default"` for the fleet gateway). Never a credential value.
   */
  source: string;
  /** The contracts resolution for the http transport; null for sqlite. It never carries the key. */
  authority: ClientTransportResolution | null;
}

/**
 * The gateway addresses every app as `https://api.hasna.com/<app>/v1`, and the
 * app origins answer at `<origin>/v1`. Those are the only two shapes a Todos
 * authority can have, so a resolved `/v1` base whose prefix is neither empty
 * nor a single non-reserved app segment is a misconfiguration — `/api/v1`,
 * `…/todos/v1/v1` and `…/v1/tasks` all reach a route that does not exist and
 * would otherwise surface as an opaque 404 on the first real request.
 *
 * `@hasna/contracts` validates the scheme, authority, userinfo, query, fragment
 * and loopback-http rules; this is the one Todos-specific rule left, and it is
 * applied to the RESOLVED base so it covers every tier, not just the env one.
 */
function assertTodosAuthorityShape(v1BaseUrl: string): void {
  const url = new URL(v1BaseUrl);
  const segments = url.pathname.split("/").filter(Boolean);
  const prefix = segments.slice(0, -1); // the trailing "v1" is guaranteed by toV1BaseUrl
  const reserved = new Set(["api", "v1"]);
  const shapeOk =
    prefix.length === 0 || (prefix.length === 1 && !reserved.has(prefix[0]!.toLowerCase()));
  if (!shapeOk) {
    throw new Error(
      "REMOTE_API_URL_INVALID: the resolved Todos authority " +
        `${v1BaseUrl} must be an authority root, /v1, or <app>[/v1], not /api/v1 or another path; ` +
        "local SQLite fallback is disabled",
    );
  }
}

/**
 * Re-throw a `@hasna/contracts` resolution failure as the Todos CLI's own
 * fail-closed diagnostic, preserving the resolver's message (which names every
 * tier it consulted) behind the stable `REMOTE_API_*` code callers match on.
 * Nothing here ever returns a client or a local store: every arm throws.
 */
function rethrowAuthorityFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  if (name === "CredentialResolutionError" || name === "CredentialFileUnsafeError") {
    throw new Error(
      `REMOTE_API_CREDENTIAL_INVALID: ${message} There is no local fallback: ` +
        "local SQLite is opt-in only (HASNA_TODOS_LOCAL=1) and is disabled by default — failing closed",
      { cause: error },
    );
  }
  if (/no API key could be resolved/.test(message)) {
    if (/is not set and no API key could be resolved/.test(message)) {
      throw new Error(
        "REMOTE_API_CONFIG_MISSING: no Todos credential resolved from the Keychain item " +
          `hasna.credentials.todos.api-key, ~/.hasna/todos/config/credentials, or HASNA_TODOS_API_KEY. ${message} ` +
          "There is no local fallback: local SQLite is opt-in only (HASNA_TODOS_LOCAL=1, alias TODOS_LOCAL=1) " +
          "and is disabled by default — failing closed instead of serving the local store",
        { cause: error },
      );
    }
    throw new Error(
      "REMOTE_API_KEY_MISSING: remote Todos storage requires HASNA_TODOS_API_KEY, the Keychain item " +
        `hasna.credentials.todos.api-key, or ~/.hasna/todos/config/credentials. ${message} ` +
        "There is no local fallback: local SQLite is opt-in only (HASNA_TODOS_LOCAL=1) and is disabled by default — failing closed",
      { cause: error },
    );
  }
  throw new Error(
    `REMOTE_API_URL_INVALID: ${message} local SQLite fallback is disabled`,
    { cause: error },
  );
}

/**
 * Resolve the CLI transport. The deliberate unhosted opt-in is answered first
 * and WITHOUT consulting the resolver; otherwise `@hasna/contracts` resolves
 * the credential and the authority, and any failure to do so is a throw — the
 * client never defaults to the on-box SQLite file (owner ruling 2026-09-04,
 * hasna/apps#1613: the old `todos-local-fallback` stderr notice and the silent
 * rc-0 local read it papered over are both gone, not replaced).
 */
export function resolveTodosCliTransport(
  env: Env = process.env as Env,
  options: TodosClientResolveOptions = {},
): TodosCliTransportResolution {
  if (selectsTodosLocalStore(env)) {
    return { transport: "sqlite", selected: false, source: "local-opt-in", authority: null };
  }
  let authority: ClientTransportResolution;
  // Normalising blanks hands the resolver a copy, and a copy is not the ambient
  // environment its Keychain tier gates on — so the gate travels with the env
  // as `keychain.enabled` rather than being silently lost (see
  // `todosResolverInputs`).
  const resolverInputs = todosResolverInputs(env, options.credentials);
  try {
    authority = resolveClientTransport("todos", resolverInputs.env, {
      credentials: resolverInputs.credentials,
    });
  } catch (error) {
    rethrowAuthorityFailure(error);
  }
  assertTodosAuthorityShape(authority.baseUrl);
  return {
    transport: "http",
    selected: true,
    source: `${authority.apiKeySource ?? authority.apiKeyTier}+${authority.apiUrlSource ?? "default"}`,
    authority,
  };
}

export function getTodosRemoteAuthorityConfigStatus(
  env: Env = process.env as Env,
  options: TodosClientResolveOptions = {},
): TodosRemoteAuthorityConfigStatus {
  let resolution: TodosCliTransportResolution;
  try {
    resolution = resolveTodosCliTransport(env, options);
  } catch (error) {
    const issue = error instanceof Error ? error.message : String(error);
    // A refused configuration still has to SAY WHICH HALF it has. The flags are
    // read from the environment alone here, deliberately: the resolver already
    // refused, so re-running its Keychain and filesystem tiers to decorate a
    // failure would spend the machine's credential stores on a diagnostic — and
    // the message already names every tier it consulted.
    const envKeys = clientTransportEnvKeys("todos");
    const declared = (keys: readonly string[]) => keys.some((key) => (env[key] ?? "").trim() !== "");
    return {
      selected: true,
      ok: false,
      transport: "invalid",
      api_url_configured: declared(envKeys.apiUrlKeys),
      api_key_configured: declared(envKeys.apiKeyKeys),
      api_url_source: null,
      api_key_source: null,
      api_key_tier: null,
      v1_base_url: null,
      issues: [issue],
      local_fallback: false,
    };
  }
  if (!resolution.selected) {
    return {
      selected: false,
      ok: true,
      transport: resolution.transport,
      api_url_configured: false,
      api_key_configured: false,
      api_url_source: null,
      api_key_source: null,
      api_key_tier: null,
      v1_base_url: null,
      issues: [],
      local_fallback: false,
    };
  }

  const authority = resolution.authority!;
  return {
    selected: true,
    ok: true,
    transport: resolution.transport,
    // The default fleet gateway is a resolved authority, not a configured one:
    // an operator reading this line must be able to tell "I pointed this at a
    // URL" apart from "the gateway default applied".
    api_url_configured: authority.apiUrlSource !== null && authority.apiUrlSource !== "default",
    api_key_configured: authority.apiKeyPresent,
    api_url_source: authority.apiUrlSource,
    api_key_source: authority.apiKeySource,
    api_key_tier: authority.apiKeyTier,
    v1_base_url: authority.baseUrl,
    issues: [],
    local_fallback: false,
  };
}

function classifyRemoteRequestError(baseUrl: string, route: string, error: unknown): never {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  if (status === 401) {
    throw new Error(
      `REMOTE_API_UNAUTHORIZED: configured Todos authority ${baseUrl} rejected HASNA_TODOS_API_KEY for ${route}; ` +
        "local SQLite fallback is disabled",
      { cause: error },
    );
  }
  if (status === 403) {
    throw new Error(
      `REMOTE_API_FORBIDDEN: configured Todos authority ${baseUrl} denied ${route}; local SQLite fallback is disabled`,
      { cause: error },
    );
  }
  if (status === 409) {
    const body = error && typeof error === "object" ? (error as { body?: unknown }).body : undefined;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const remoteError = body as { error?: unknown; code?: unknown };
      if (remoteError.code === "TASK_NOT_STARTABLE" && typeof remoteError.error === "string" && remoteError.error.length > 0) {
        throw new Error(`${remoteError.code}: ${remoteError.error}`, { cause: error });
      }
    }
    throw error;
  }
  if (typeof status === "number" && status >= 300 && status < 400) {
    throw new Error(
      `REMOTE_API_REDIRECT_REJECTED: configured Todos authority ${baseUrl} redirected ${route}; ` +
        "authenticated redirects are disabled to prevent credential leakage",
      { cause: error },
    );
  }
  if (typeof status === "number" && status >= 500) {
    throw new Error(
      `REMOTE_API_UNAVAILABLE: configured Todos authority ${baseUrl} returned HTTP ${status} for ${route}; ` +
        "local SQLite fallback is disabled",
      { cause: error },
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  if ((error instanceof Error && error.name === "AbortError") || /abort|timed?\s*out/i.test(message)) {
    // A read that times out on /v1/tasks is almost always the UNBOUNDED shape:
    // the hosted authority answers bounded /v1/tasks reads in ~1 s but takes
    // O(rows) — minutes on a 64k+ task table — to materialise the full set, so
    // it outlasts every client timeout. Name that class instead of letting the
    // timeout read as API-down (task 5e5ed4d1).
    const unboundedNote = route === "/tasks"
      ? "; this is likely an UNBOUNDED task read timing out (bounded task reads from this authority return in ~1 s) — retry with a bounded/count-specific shape such as todos list --limit; local SQLite fallback is disabled"
      : "; local SQLite fallback is disabled";
    throw new Error(
      `REMOTE_API_TIMEOUT: configured Todos authority ${baseUrl} timed out for ${route}${unboundedNote}`,
      { cause: error },
    );
  }
  if (status === undefined) {
    throw new Error(
      `REMOTE_API_UNREACHABLE: configured Todos authority ${baseUrl} could not be reached for ${route}; ` +
        "local SQLite fallback is disabled",
      { cause: error },
    );
  }
  throw error;
}

/**
 * Hard per-request bound for every authenticated `/v1` call (task 9b050845).
 *
 * Measured defect: `todos count` on a stalled /tasks endpoint hung past 120
 * seconds and then reported REMOTE_API_UNREACHABLE, while the authority was
 * reachable (curl connected in 0.18s). The contracts transport's own 30s
 * timer is consumed by two retries of a timeout-shaped failure (90s+), and a
 * fetch that ignores the abort — or a response that sends headers and then
 * never completes its body, which the transport reads with an unbounded
 * `response.text()` — holds the CLI for minutes before a network-level error
 * with no status is classified as "could not be reached".
 *
 * Every remote request is therefore race-bounded to a single finite budget:
 * the injected signal aborts the transport's controller (which marks the
 * timeout NON-retryable there), the race rejects with an AbortError even if
 * the underlying fetch ignores the abort, and the existing classifier maps
 * that AbortError to REMOTE_API_TIMEOUT — "the authority is slow", the
 * distinction this fix exists to make — instead of REMOTE_API_UNREACHABLE.
 */
const REMOTE_REQUEST_TIMEOUT_MS = 10_000;

function withBoundedRemoteRequest<T>(
  options: { signal?: AbortSignal } | undefined,
  requestTimeoutMs: number,
  run: (options: { signal: AbortSignal }) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const onBaseAbort = () => controller.abort();
  if (options?.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", onBaseAbort, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DOMException(
        `Todos remote request exceeded the ${requestTimeoutMs}ms bounded request timeout`,
        "AbortError",
      ));
    }, requestTimeoutMs);
  });
  const attempt = run({ ...options, signal: controller.signal });
  // The race settles the caller; a late settle of the underlying attempt must
  // never surface as an unhandled rejection after the deadline already
  // reported, and the transport's own timer is aligned to the same budget so
  // no stray handle outlives the request.
  attempt.catch(() => {});
  return Promise.race([attempt, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onBaseAbort);
  });
}

function protectRemoteClient(client: HasnaStorageClient, requestTimeoutMs: number): HasnaStorageClient {
  const baseUrl = remoteAuthorityBase(client);
  const protect = async <T>(route: string, request: () => Promise<T>): Promise<T> => {
    try {
      return await request();
    } catch (error) {
      return classifyRemoteRequestError(baseUrl, route, error);
    }
  };
  const bounded = <T>(
    options: { signal?: AbortSignal } | undefined,
    run: (options: { signal: AbortSignal }) => Promise<T>,
  ): Promise<T> => withBoundedRemoteRequest(options, requestTimeoutMs, run);
  const transport = client.transport;
  const protectedTransport = {
    baseUrl: transport.baseUrl,
    request: <T = unknown>(method: string, path: string, body?: unknown, options?: Parameters<typeof transport.request>[3]) =>
      protect(path, () => bounded(options, (opts) => transport.request<T>(method, path, body, opts))),
    get: <T = unknown>(path: string, options?: Parameters<typeof transport.get>[1]) =>
      protect(path, () => bounded(options, (opts) => transport.get<T>(path, opts))),
    post: <T = unknown>(path: string, body?: unknown, options?: Parameters<typeof transport.post>[2]) =>
      protect(path, () => bounded(options, (opts) => transport.post<T>(path, body, opts))),
    put: <T = unknown>(path: string, body?: unknown, options?: Parameters<typeof transport.put>[2]) =>
      protect(path, () => bounded(options, (opts) => transport.put<T>(path, body, opts))),
    patch: <T = unknown>(path: string, body?: unknown, options?: Parameters<typeof transport.patch>[2]) =>
      protect(path, () => bounded(options, (opts) => transport.patch<T>(path, body, opts))),
    del: <T = unknown>(path: string, body?: unknown, options?: Parameters<typeof transport.del>[2]) =>
      protect(path, () => bounded(options, (opts) => transport.del<T>(path, body, opts))),
  };
  return {
    name: client.name,
    baseUrl: client.baseUrl,
    transport: protectedTransport,
    list: (resource, options) => protect(`/${resource}`, () => bounded(options, (opts) => client.list(resource, opts))),
    get: (resource, id, options) => protect(`/${resource}/${encodeURIComponent(id)}`, () => bounded(options, (opts) => client.get(resource, id, opts))),
    create: (resource, body, options) => protect(`/${resource}`, () => bounded(options, (opts) => client.create(resource, body, opts))),
    update: (resource, id, patch, options) => protect(`/${resource}/${encodeURIComponent(id)}`, () => bounded(options, (opts) => client.update(resource, id, patch, opts))),
    delete: (resource, id, options) => protect(`/${resource}/${encodeURIComponent(id)}`, () => bounded(options, (opts) => client.delete(resource, id, opts))),
  };
}

function remoteAuthorityBase(client: HasnaStorageClient): string {
  return client.baseUrl.replace(/\/v1\/?$/, "");
}

async function requiredRemoteRoute<T>(
  client: HasnaStorageClient,
  route: string,
  request: () => Promise<T>,
  recognized404Codes: readonly string[] = [],
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
    if (status === 404 || status === 405) {
      const body = error && typeof error === "object" ? (error as { body?: unknown }).body : undefined;
      const code = body && typeof body === "object" && !Array.isArray(body)
        ? (body as { code?: unknown }).code
        : undefined;
      if (typeof code === "string" && recognized404Codes.includes(code)) throw error;
      throw new Error(
        `REMOTE_API_INCOMPATIBLE: configured Todos authority ${remoteAuthorityBase(client)} does not expose ${route}; ` +
          "deploy the @hasna/todos /v1 server contract before retrying; local SQLite fallback is disabled",
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Resolve the Todos HTTP storage client. Returns a ready client when the
 * @hasna/contracts chain resolves a credential (and, with it, an authority —
 * the fleet gateway when nothing configures one), or `null` for the on-box
 * SQLite store, which is reachable ONLY under the deliberate unhosted opt-in.
 * Every other outcome THROWS: no credential, an unusable credential file, or
 * an authority the Todos routes cannot live under. There is no silent local
 * default and no local-fallback event (fail closed, hasna/apps#1613). Callers
 * that are local-first by design must pre-check {@link isTodosLocalOptIn} or
 * wrap this in a try/catch.
 */
export function getTodosCloudClient(
  env: Env = process.env as Env,
  requestTimeoutMs: number = REMOTE_REQUEST_TIMEOUT_MS,
  options: TodosClientResolveOptions = {},
): HasnaStorageClient | null {
  // ONE pass through the chain, not two. The unhosted opt-in is the only path
  // that returns null and it is answered from the env dictionary alone — no
  // Keychain item and no credential file is read for it — so asking
  // `resolveTodosCliTransport` first would only re-run the whole chain that
  // `resolveStorageClient` is about to run: on darwin that is a second pair of
  // `/usr/bin/security` spawns (four per client, measured) and a second chance
  // to prompt, before a single request goes out. The refusals that made the
  // pre-check look load-bearing are re-created exactly where they were: the
  // contracts failures still come back through `rethrowAuthorityFailure` as the
  // CLI's REMOTE_API_* errors, and the authority shape is still asserted before
  // the client is handed to a caller.
  if (selectsTodosLocalStore(env)) return null;
  const storageInputs = todosResolverInputs(env, options.credentials);
  let resolved: ReturnType<typeof resolveStorageClient>;
  try {
    resolved = resolveStorageClient("todos", storageInputs.env, {
      fetchImpl: (input, init) => globalThis.fetch(input, { ...init, redirect: "manual" }),
      // Align the transport's own per-request timer with the CLI's bounded
      // request budget so no request can outlive the deadline (task 9b050845).
      timeoutMs: requestTimeoutMs,
      credentials: storageInputs.credentials,
    });
  } catch (error) {
    rethrowAuthorityFailure(error);
  }
  assertTodosAuthorityShape(resolved.client.baseUrl);
  // `cloud-http` is the pinned @hasna/contracts generation's transport name;
  // `http` is the post-removal generation's. Both mean "authenticated /v1".
  // The installed typings declare one transport name or the other depending on
  // which @hasna/contracts generation is resolved (workspace vs published), so
  // both arms compare a widened string; either generation constructs the
  // client alongside its http transport name.
  const transportName: string = resolved.transport;
  if (transportName === "cloud-http" || transportName === "http") {
    return protectRemoteClient(resolved.client!, requestTimeoutMs);
  }
  return null;
}

/** True when the CLI should route task reads/writes to the cloud API. */
export function isCloudRouting(env: Env = process.env as Env): boolean {
  return getTodosCloudClient(env) !== null;
}

/** Backward-compatible test hook; authority clients are never process-cached. */
export function resetTodosCloudClient(): void {
  // Only protocol capabilities are cached, keyed by authority rather than credentials.
  completionCapabilityCache.clear();
  retryCapabilityCache.clear();
  taskCreatorCapabilityCache.clear();
  listTagsCapabilityCache.clear();
  gitRefCapabilityCache.clear();
  remoteCommandCapabilityCache.clear();
}

function assertRemotePrGroupView(value: unknown, route: string): PrGroupStateView {
  try {
    return parsePrGroupStateView(value, "remote", route);
  } catch (error) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} did not return a complete closed authoritative remote projection; ` +
        "local SQLite fallback is disabled",
      { cause: error },
    );
  }
}

function assertRemoteProjectRegistrationLookup(
  value: unknown,
  request: TodosProjectRegistrationLookupRequest,
  route: string,
): TodosProjectRegistrationLookupResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned a non-object receipt lookup envelope; ` +
        "local SQLite fallback is disabled",
    );
  }
  const envelope = value as Record<string, unknown>;
  const receipt = envelope["receipt"];
  const control = envelope["response_control"];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || !control || typeof control !== "object" || Array.isArray(control)) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned an incomplete receipt lookup envelope; ` +
        "local SQLite fallback is disabled",
    );
  }
  const receiptRecord = receipt as Record<string, unknown>;
  const controlRecord = control as Record<string, unknown>;
  const identityMatches =
    typeof receiptRecord["receipt_id"] === "string"
    && receiptRecord["authority"] === request.authority
    && receiptRecord["route"] === request.authority_route
    && receiptRecord["package_version"] === request.package_version
    && receiptRecord["authority_id"] === request.authority_id
    && receiptRecord["tenant_id"] === request.tenant_id
    && receiptRecord["corpus_id"] === request.corpus_id
    && receiptRecord["operation_id"] === request.operation_id
    && receiptRecord["step_id"] === request.step_id
    && receiptRecord["resource_kind"] === request.resource_kind
    && receiptRecord["direction"] === request.direction
    && receiptRecord["idempotency_key"] === request.idempotency_key
    && (request.target_id === undefined || receiptRecord["target_id"] === request.target_id);
  const responseBytes = controlRecord["response_bytes"];
  const elapsedMs = controlRecord["elapsed_ms"];
  const boundsMatch =
    controlRecord["complete"] === true
    && controlRecord["truncated"] === false
    && controlRecord["response_byte_limit"] === request.response_byte_limit
    && controlRecord["time_budget_ms"] === request.time_budget_ms
    && Number.isSafeInteger(responseBytes)
    && Number(responseBytes) >= 0
    && Number(responseBytes) <= request.response_byte_limit
    && Number.isSafeInteger(elapsedMs)
    && Number(elapsedMs) >= 0
    && Number(elapsedMs) <= request.time_budget_ms;
  if (!identityMatches || !boundsMatch) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned a receipt or response bound for a different identity; ` +
        "local SQLite fallback is disabled",
    );
  }
  return value as TodosProjectRegistrationLookupResult;
}

/** Read one immutable historical registration receipt through authenticated `/v1`. */
export async function cloudLookupProjectRegistrationReceipt(
  client: HasnaStorageClient,
  request: TodosProjectRegistrationLookupRequest,
): Promise<TodosProjectRegistrationLookupResult> {
  const route = "/v1/project-registration/receipts/lookup";
  const raw = await requiredRemoteRoute(
    client,
    route,
    () => client.transport.post<unknown>(
      "/project-registration/receipts/lookup",
      request as unknown as Record<string, unknown>,
    ),
    ["TODOS_PROJECT_REGISTRATION_RECEIPT_NOT_FOUND"],
  );
  return assertRemoteProjectRegistrationLookup(raw, request, route);
}

/** Read an authoritative remote PR-group projection without local fallback. */
export async function cloudGetPrGroup(client: HasnaStorageClient, groupId: string): Promise<PrGroupStateView> {
  const route = `/v1/pr-groups/${encodeURIComponent(groupId)}`;
  const raw = await requiredRemoteRoute(client, route, () =>
    client.transport.get<unknown>(`/pr-groups/${encodeURIComponent(groupId)}`));
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      Object.keys(raw).length !== 1 || !("view" in raw)) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned a non-authoritative response envelope; ` +
        "local SQLite fallback is disabled",
    );
  }
  const view = (raw as { view: unknown }).view;
  const authoritative = assertRemotePrGroupView(view, route);
  if (authoritative.group?.id !== groupId) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned a different PR-group identity; ` +
        "local SQLite fallback is disabled",
    );
  }
  return authoritative;
}

/** Read a bounded authoritative remote PR-group event page without local fallback. */
export async function cloudPrGroupEvents(
  client: HasnaStorageClient,
  groupId: string,
  options: PrGroupEventListOptions = {},
): Promise<PrGroupEventPage> {
  const route = `/v1/pr-groups/${encodeURIComponent(groupId)}/events`;
  const raw = await requiredRemoteRoute(client, route, () =>
    client.transport.get<unknown>(`/pr-groups/${encodeURIComponent(groupId)}/events`, {
      query: {
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        ...(options.after_sequence !== undefined ? { after_sequence: options.after_sequence } : {}),
      },
    }));
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      Object.keys(raw).length !== 1 || !("history" in raw)) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned a non-authoritative response envelope; ` +
        "local SQLite fallback is disabled",
    );
  }
  try {
    return parsePrGroupEventPage((raw as { history: unknown }).history, "remote", route, groupId);
  } catch (error) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} did not return a complete closed authoritative remote event page; ` +
        "local SQLite fallback is disabled",
      { cause: error },
    );
  }
}

function unwrapTaskManifestEnvelope<T>(
  raw: unknown,
  key: "capability" | "result" | "delivered",
  route: string,
): T {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !(key in raw)) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned a non-authoritative task-manifest response envelope; ` +
        "local SQLite fallback is disabled",
    );
  }
  return (raw as Record<typeof key, T>)[key];
}

function unwrapTaskSubtreeTransferEnvelope<T>(
  raw: unknown,
  key: "capability" | "inspection" | "result",
  route: string,
): T {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !(key in raw)) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned a non-authoritative task-subtree-transfer response envelope; ` +
        "local SQLite fallback is disabled",
    );
  }
  return (raw as Record<typeof key, T>)[key];
}

function unwrapProjectRegistrationEnvelope<T>(
  raw: unknown,
  key: "capability" | "receipt" | "record" | "verification" | "page" | "validation",
  route: string,
): T {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !(key in raw)) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned a non-authoritative project-registration response envelope; ` +
        "local SQLite fallback is disabled",
    );
  }
  return (raw as Record<typeof key, T>)[key];
}

export async function cloudProjectRegistrationCapability(
  client: HasnaStorageClient,
): Promise<TodosProjectRegistrationCapability> {
  const route = "/v1/project-registration/capability";
  return unwrapProjectRegistrationEnvelope(
    await requiredRemoteRoute(client, route, () =>
      client.transport.get<unknown>("/project-registration/capability")),
    "capability",
    route,
  );
}

export async function cloudCreateProjectRegistration(
  client: HasnaStorageClient,
  input: TodosProjectRegistrationRequest,
): Promise<TodosProjectRegistrationReceipt> {
  const route = "/v1/project-registration/create";
  return unwrapProjectRegistrationEnvelope(
    await requiredRemoteRoute(client, route, () =>
      client.transport.post<unknown>("/project-registration/create", input)),
    "receipt",
    route,
  );
}

export async function cloudReadExactProjectRegistration(
  client: HasnaStorageClient,
  input: {
    resource_kind: TodosProjectRegistrationResourceKind;
    target_id: string;
    response_byte_limit: number;
    time_budget_ms: number;
  },
): Promise<TodosProjectRegistrationRecord> {
  const route = "/v1/project-registration/read-exact";
  return unwrapProjectRegistrationEnvelope(
    await requiredRemoteRoute(client, route, () =>
      client.transport.post<unknown>("/project-registration/read-exact", input)),
    "record",
    route,
  );
}

export async function cloudValidatePriorRegistrationAdoption(
  client: HasnaStorageClient,
  input: TodosPriorRegistrationAdoptionValidationRequest,
): Promise<TodosPriorRegistrationAdoptionValidation> {
  const route = "/v1/project-registration/validate-prior-adoption";
  const raw = await requiredRemoteRoute(client, route, () =>
    client.transport.post<unknown>("/project-registration/validate-prior-adoption", input));
  try {
    return assertTodosPriorRegistrationAdoptionValidationEnvelope(raw, input);
  } catch (error) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned an invalid prior-adoption validation proof; ` +
        "local SQLite fallback is disabled",
      { cause: error },
    );
  }
}

export async function cloudCompensateProjectRegistration(
  client: HasnaStorageClient,
  input: TodosProjectRegistrationRequest,
): Promise<TodosProjectRegistrationReceipt> {
  const route = "/v1/project-registration/compensate";
  return unwrapProjectRegistrationEnvelope(
    await requiredRemoteRoute(client, route, () =>
      client.transport.post<unknown>("/project-registration/compensate", input)),
    "receipt",
    route,
  );
}

export async function cloudVerifyInverseProjectRegistration(
  client: HasnaStorageClient,
  input: TodosProjectRegistrationRequest,
): Promise<TodosProjectRegistrationInverseVerification> {
  const route = "/v1/project-registration/verify-inverse";
  return unwrapProjectRegistrationEnvelope(
    await requiredRemoteRoute(client, route, () =>
      client.transport.post<unknown>("/project-registration/verify-inverse", input)),
    "verification",
    route,
  );
}

export async function cloudListProjectResources(
  client: HasnaStorageClient,
  input: TodosProjectResourcePageRequest,
): Promise<TodosProjectResourcePage> {
  const route = "/v1/project-registration/resources";
  const page = unwrapProjectRegistrationEnvelope<unknown>(
    await requiredRemoteRoute(client, route, () =>
      client.transport.get<unknown>("/project-registration/resources", {
        query: {
          source_project_id: input.source_project_id,
          limit: input.limit,
          include_anchors: input.include_anchors === true ? "true" : "false",
          ...(input.cursor ? { cursor: input.cursor } : {}),
        },
      })),
    "page",
    route,
  );
  try {
    return assertTodosProjectResourcePage(page, input);
  } catch (error) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned an invalid project-resource page for the requested identity; ` +
        "local SQLite fallback is disabled",
      { cause: error },
    );
  }
}

export async function cloudTaskManifestCapability(
  client: HasnaStorageClient,
): Promise<TodosTaskManifestCapability> {
  const route = "/v1/task-manifest/capability";
  return unwrapTaskManifestEnvelope(
    await requiredRemoteRoute(client, route, () =>
      client.transport.get<unknown>("/task-manifest/capability")),
    "capability",
    route,
  );
}

export async function cloudApplyTaskManifest(
  client: HasnaStorageClient,
  input: unknown,
): Promise<TodosTaskManifestApplyResult> {
  const route = "/v1/task-manifest/apply";
  return unwrapTaskManifestEnvelope(
    await requiredRemoteRoute(client, route, () =>
      client.transport.post<unknown>("/task-manifest/apply", input)),
    "result",
    route,
  );
}

export async function cloudReadExactTaskManifest(
  client: HasnaStorageClient,
  receiptId: string,
): Promise<TodosTaskManifestApplyResult> {
  const route = "/v1/task-manifest/read-exact";
  return unwrapTaskManifestEnvelope(
    await requiredRemoteRoute(client, route, () =>
      client.transport.post<unknown>("/task-manifest/read-exact", { receipt_id: receiptId })),
    "result",
    route,
  );
}

export async function cloudLookupTaskManifestBinding(
  client: HasnaStorageClient,
  input: TodosTaskManifestBindingLookupRequest,
): Promise<TodosTaskManifestBindingLookupResult> {
  const route = "/v1/task-manifest/bindings/lookup";
  return unwrapTaskManifestEnvelope(
    await requiredRemoteRoute(client, route, () =>
      client.transport.post<unknown>("/task-manifest/bindings/lookup", input)),
    "result",
    route,
  );
}

export async function cloudCompensateTaskManifest(
  client: HasnaStorageClient,
  input: TodosTaskManifestCompensateRequest,
): Promise<TodosTaskManifestCompensationResult> {
  const route = "/v1/task-manifest/compensate";
  return unwrapTaskManifestEnvelope(
    await requiredRemoteRoute(client, route, () =>
      client.transport.post<unknown>("/task-manifest/compensate", input)),
    "result",
    route,
  );
}

export async function cloudMarkTaskManifestOutboxDelivered(
  client: HasnaStorageClient,
  outboxId: string,
): Promise<void> {
  const route = "/v1/task-manifest/outbox/delivered";
  const delivered = unwrapTaskManifestEnvelope(
    await requiredRemoteRoute(client, route, () =>
      client.transport.post<unknown>("/task-manifest/outbox/delivered", { outbox_id: outboxId })),
    "delivered",
    route,
  );
  if (delivered !== true) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} did not confirm task-manifest outbox delivery; ` +
        "local SQLite fallback is disabled",
    );
  }
}

export async function cloudTaskSubtreeTransferCapability(
  client: HasnaStorageClient,
): Promise<TodosTaskSubtreeTransferCapability> {
  const route = "/v1/task-subtree-transfer/capability";
  return unwrapTaskSubtreeTransferEnvelope(
    await requiredRemoteRoute(client, route, () =>
      client.transport.get<unknown>("/task-subtree-transfer/capability")),
    "capability",
    route,
  );
}

export async function cloudInspectTaskSubtreeTransfer(
  client: HasnaStorageClient,
  input: unknown,
): Promise<TodosTaskSubtreeTransferInspection> {
  const route = "/v1/task-subtree-transfer/inspect";
  return unwrapTaskSubtreeTransferEnvelope(
    await requiredRemoteRoute(client, route, () =>
      client.transport.post<unknown>("/task-subtree-transfer/inspect", input)),
    "inspection",
    route,
  );
}

export async function cloudApplyTaskSubtreeTransfer(
  client: HasnaStorageClient,
  input: unknown,
): Promise<TodosTaskSubtreeTransferResult> {
  const route = "/v1/task-subtree-transfer/apply";
  return unwrapTaskSubtreeTransferEnvelope(
    await requiredRemoteRoute(client, route, () =>
      client.transport.post<unknown>("/task-subtree-transfer/apply", input)),
    "result",
    route,
  );
}

export async function cloudReadExactTaskSubtreeTransfer(
  client: HasnaStorageClient,
  receiptId: string,
): Promise<TodosTaskSubtreeTransferResult> {
  const route = "/v1/task-subtree-transfer/read-exact";
  return unwrapTaskSubtreeTransferEnvelope(
    await requiredRemoteRoute(client, route, () =>
      client.transport.post<unknown>("/task-subtree-transfer/read-exact", { receipt_id: receiptId })),
    "result",
    route,
  );
}

export async function cloudRollbackTaskSubtreeTransfer(
  client: HasnaStorageClient,
  input: unknown,
): Promise<TodosTaskSubtreeTransferResult> {
  const route = "/v1/task-subtree-transfer/rollback";
  return unwrapTaskSubtreeTransferEnvelope(
    await requiredRemoteRoute(client, route, () =>
      client.transport.post<unknown>("/task-subtree-transfer/rollback", input)),
    "result",
    route,
  );
}

/** Unwrap the `{ task }` envelope the todos `/v1` API returns for single tasks. */
function unwrapTask(raw: unknown): Task {
  if (raw && typeof raw === "object" && "task" in (raw as Record<string, unknown>)) {
    return (raw as { task: Task }).task;
  }
  return raw as Task;
}

/** Map a local TaskFilter onto the query params the `/v1/tasks` list route honors. */
function toListQuery(filter: TaskFilter = {}): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  if (filter.query) query["q"] = filter.query;
  if (filter.status) query["status"] = Array.isArray(filter.status) ? filter.status.join(",") : filter.status;
  if (filter.priority) query["priority"] = Array.isArray(filter.priority) ? filter.priority.join(",") : filter.priority;
  if (filter.project_id) query["project_id"] = filter.project_id;
  if (filter.parent_id !== undefined) query["parent_id"] = filter.parent_id ?? "";
  if (filter.include_subtasks !== undefined) query["include_subtasks"] = filter.include_subtasks ? "true" : "false";
  if (filter.plan_id) query["plan_id"] = filter.plan_id;
  if (filter.task_list_id) query["task_list_id"] = filter.task_list_id;
  if (filter.assigned_to) query["assigned_to"] = filter.assigned_to;
  if (filter.agent_id) query["agent_id"] = filter.agent_id;
  if (filter.tags?.length) query["tags"] = filter.tags.join(",");
  if (typeof filter.limit === "number") query["limit"] = filter.limit;
  if (typeof filter.offset === "number") query["offset"] = filter.offset;
  return query;
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
function priorityRank(priority?: string | null): number {
  return PRIORITY_RANK[priority ?? ""] ?? 4;
}

/** The authoritative remote task order before limit/offset are applied. */
function compareCloudTaskOrder(a: Task, b: Task): number {
  return priorityRank(a.priority) - priorityRank(b.priority)
    || b.created_at.localeCompare(a.created_at)
    || a.id.localeCompare(b.id);
}

const listTagsCapabilityCache = new Map<string, Promise<boolean>>();

/** Whether this authority's `GET /v1/tasks` advertises the `tags` query param. */
async function fetchListTagsCapability(client: HasnaStorageClient): Promise<boolean> {
  const document = await requiredRemoteRoute(client, "/v1/openapi.json", () =>
    client.transport.get<unknown>("/openapi.json"));
  if (!document || typeof document !== "object" || Array.isArray(document)) return false;
  const paths = (document as Record<string, unknown>)["paths"];
  const tasksPath = paths && typeof paths === "object" && !Array.isArray(paths)
    ? (paths as Record<string, unknown>)["/v1/tasks"]
    : undefined;
  const get = tasksPath && typeof tasksPath === "object" && !Array.isArray(tasksPath)
    ? (tasksPath as Record<string, unknown>)["get"]
    : undefined;
  const parameters = get && typeof get === "object" && !Array.isArray(get)
    ? (get as Record<string, unknown>)["parameters"]
    : undefined;
  return Array.isArray(parameters) &&
    parameters.some((parameter) =>
      parameter && typeof parameter === "object" &&
      (parameter as Record<string, unknown>)["name"] === "tags");
}

/**
 * Fail closed when a tags filter is requested against an authority that
 * predates server-side tags filtering. An authority that does not parse the
 * `tags` query param would silently return the UNFILTERED task list — worse
 * than a refusal — so the capability is preflighted against the authority's
 * own OpenAPI contract (task 90c0b178).
 */
async function requireTagsFilterCapability(client: HasnaStorageClient): Promise<void> {
  const authority = remoteAuthorityBase(client);
  let capability = listTagsCapabilityCache.get(authority);
  if (!capability) {
    capability = fetchListTagsCapability(client);
    listTagsCapabilityCache.set(authority, capability);
  }
  if (!(await capability)) {
    throw new Error(
      `REMOTE_TAGS_FILTER_UNSUPPORTED: configured Todos authority ${authority} does not advertise the tags ` +
        "query param on GET /v1/tasks; deploy the current @hasna/todos /v1 server to filter by tag; " +
        "no unfiltered task read was issued",
    );
  }
}

interface CloudTaskPage {
  tasks: Task[];
  total?: number;
}

function parseCloudTaskTotal(raw: unknown): number | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const total = (raw as { total?: unknown }).total;
  return typeof total === "number" && Number.isSafeInteger(total) && total >= 0
    ? total
    : undefined;
}

async function requestRawCloudTaskPage(
  client: HasnaStorageClient,
  filter: TaskFilter,
): Promise<CloudTaskPage> {
  const res = await requiredRemoteRoute(client, "/v1/tasks", () =>
    client.list<Task>("tasks", { query: toListQuery(filter) }));
  const envelope = res.raw as { tasks?: Task[] } | undefined;
  return {
    tasks: Array.isArray(envelope?.tasks) ? envelope!.tasks : res.items,
    total: parseCloudTaskTotal(res.raw),
  };
}

function cloudPlanTaskListError(planId: string, detail: string): Error {
  return new Error(
    `REMOTE_PLAN_TASK_LIST_INCOMPLETE: hosted authority returned an incomplete task set for plan ${planId}; ` +
      `${detail}; refusing an incomplete plan result`,
  );
}

function appendExactPlanTaskPage(
  target: Task[],
  seen: Set<string>,
  page: Task[],
  planId: string,
): void {
  for (const task of page) {
    if (task.plan_id !== planId) {
      throw cloudPlanTaskListError(planId, `response includes task ${task.id} from plan ${task.plan_id ?? "null"}`);
    }
    if (seen.has(task.id)) {
      throw cloudPlanTaskListError(planId, `pagination repeats task id ${task.id}`);
    }
    seen.add(task.id);
    target.push(task);
  }
}

/**
 * Read every task in one hosted plan, including subtasks.
 *
 * The authority may cap an unbounded-looking `/v1/tasks` response while still
 * reporting the full filtered `total`. Plan show has no user pagination surface,
 * so returning that first page would present a plausible but incomplete plan.
 * Follow the authority total to exhaustion and fail closed if the population
 * changes, stalls, repeats a row, or widens beyond the requested plan.
 */
export async function cloudListPlanTasks(client: HasnaStorageClient, planId: string): Promise<Task[]> {
  const filter: TaskFilter = { plan_id: planId, include_subtasks: true };
  const firstPage = await requestRawCloudTaskPage(client, filter);
  const tasks: Task[] = [];
  const seen = new Set<string>();
  appendExactPlanTaskPage(tasks, seen, firstPage.tasks, planId);

  // Authorities predating the `total` envelope returned the complete filtered
  // set in one response. Preserve that compatibility; current authorities expose
  // `total`, which makes a truncated result detectable and exhaustible.
  if (firstPage.total === undefined) return tasks;
  const total = firstPage.total;
  if (tasks.length > total) {
    throw cloudPlanTaskListError(planId, `first page contains ${tasks.length} rows but reports total ${total}`);
  }

  while (tasks.length < total) {
    const page = await requestRawCloudTaskPage(client, { ...filter, offset: tasks.length });
    if (page.total !== total) {
      throw cloudPlanTaskListError(planId, `pagination total changed from ${total} to ${String(page.total)}`);
    }
    if (page.tasks.length === 0 || tasks.length + page.tasks.length > total) {
      throw cloudPlanTaskListError(planId, "pagination did not make bounded progress toward the reported total");
    }
    appendExactPlanTaskPage(tasks, seen, page.tasks, planId);
  }

  return tasks;
}

function cloudTaskListFilterError(
  code:
    | "REMOTE_TASK_LIST_FILTER_UNSUPPORTED"
    | "REMOTE_TASK_LIST_FILTER_INCOMPLETE",
  taskListId: string,
  detail: string,
): Error {
  return new Error(
    `${code}: hosted authority returned rows outside requested task_list_id ${taskListId}; ${detail}; refusing an incomplete exact-list result`,
  );
}

async function requestCloudTaskPage(client: HasnaStorageClient, filter: TaskFilter): Promise<Task[]> {
  const firstPage = await requestRawCloudTaskPage(client, filter);
  const tasks = firstPage.tasks;
  // Older hosted authorities can accept task_list_id in the query while still
  // returning an unfiltered page. Enforce the exact UUID locally so a successful
  // HTTP response can never widen a task-list-scoped read.
  if (filter.task_list_id === undefined) return tasks;

  const taskListId = filter.task_list_id;
  if (tasks.every((task) => task.task_list_id === taskListId)) return tasks;

  const scanLimit = filter.limit;
  const startOffset = filter.offset ?? 0;
  if (
    startOffset !== 0 ||
    scanLimit === undefined ||
    !Number.isSafeInteger(scanLimit) ||
    scanLimit <= 0 ||
    firstPage.total === undefined
  ) {
    throw cloudTaskListFilterError(
      "REMOTE_TASK_LIST_FILTER_UNSUPPORTED",
      taskListId,
      "the response does not provide complete bounded total/offset pagination evidence",
    );
  }

  const total = firstPage.total;
  if (total > scanLimit) {
    throw cloudTaskListFilterError(
      "REMOTE_TASK_LIST_FILTER_INCOMPLETE",
      taskListId,
      `reported total ${total} exceeds bounded scan limit ${scanLimit}`,
    );
  }
  if (tasks.length > total) {
    throw cloudTaskListFilterError(
      "REMOTE_TASK_LIST_FILTER_UNSUPPORTED",
      taskListId,
      `the first page contains ${tasks.length} rows but reports total ${total}`,
    );
  }

  const seenTaskIds = new Set<string>();
  for (const task of tasks) {
    if (seenTaskIds.has(task.id)) {
      throw cloudTaskListFilterError(
        "REMOTE_TASK_LIST_FILTER_UNSUPPORTED",
        taskListId,
        `the first page repeats task id ${task.id}`,
      );
    }
    seenTaskIds.add(task.id);
  }

  while (tasks.length < total) {
    const remaining = total - tasks.length;
    const page = await requestRawCloudTaskPage(client, {
      ...filter,
      offset: tasks.length,
      limit: Math.min(scanLimit - tasks.length, remaining),
    });
    if (page.total !== total) {
      throw cloudTaskListFilterError(
        "REMOTE_TASK_LIST_FILTER_UNSUPPORTED",
        taskListId,
        `pagination total changed from ${total} to ${String(page.total)}`,
      );
    }
    if (page.tasks.length === 0 || tasks.length + page.tasks.length > total) {
      throw cloudTaskListFilterError(
        "REMOTE_TASK_LIST_FILTER_UNSUPPORTED",
        taskListId,
        "pagination did not make bounded progress toward the reported total",
      );
    }
    for (const task of page.tasks) {
      if (seenTaskIds.has(task.id)) {
        throw cloudTaskListFilterError(
          "REMOTE_TASK_LIST_FILTER_UNSUPPORTED",
          taskListId,
          `pagination repeats task id ${task.id}`,
        );
      }
      seenTaskIds.add(task.id);
    }
    tasks.push(...page.tasks);
  }

  return tasks.filter((task) => task.task_list_id === taskListId);
}

/** List tasks from the cloud (`GET /v1/tasks`). Returns the `tasks` array. */
export async function cloudListTasks(client: HasnaStorageClient, filter: TaskFilter = {}): Promise<Task[]> {
  if (filter.tags?.length) await requireTagsFilterCapability(client);

  const statuses = Array.isArray(filter.status) ? filter.status : undefined;
  if (!statuses) return requestCloudTaskPage(client, filter);
  if (statuses.length === 0) {
    const { status: _status, ...unfiltered } = filter;
    return requestCloudTaskPage(client, unfiltered);
  }
  if (statuses.length === 1) {
    return requestCloudTaskPage(client, { ...filter, status: statuses[0] });
  }

  // The deployed authority can return HTTP 200, valid JSON, and an empty task
  // array for `status=pending,in_progress` while each scalar status returns real
  // rows. Never let that silent contract mismatch turn an active queue into an
  // authoritative-looking empty one. Scalar enum filters are the shared contract,
  // so compose the array as bounded scalar reads and take the global window last.
  const { status: _status, limit, offset, ...baseFilter } = filter;
  const start = offset ?? 0;
  const windowEnd = typeof limit === "number" ? start + limit : undefined;
  const pages = await Promise.all(statuses.map((status) =>
    requestCloudTaskPage(client, {
      ...baseFilter,
      status,
      ...(windowEnd === undefined ? {} : { limit: windowEnd }),
    })));

  const seen = new Set<string>();
  const union = pages.flat().filter((task) => {
    if (seen.has(task.id)) return false;
    seen.add(task.id);
    return true;
  });
  union.sort(compareCloudTaskOrder);
  return union.slice(start, windowEnd);
}

/**
 * Resolve an exact UUID, an exact short id, or a unique task-id prefix to a
 * canonical task UUID over `/v1` in a SINGLE bounded request. Full UUIDs
 * short-circuit with no round trip. Every other reference is resolved
 * SERVER-SIDE via `GET /v1/tasks/:ref` (an indexed short_id / id-prefix lookup),
 * so the CLI never pages the entire task set to expand a short reference — the
 * O(all-tasks) client-side download that hung on large shared datasets. A 409
 * from the authority means the prefix is ambiguous; a miss means the task is
 * absent (or the authority predates short-reference resolution, in which case
 * deploy the current `@hasna/todos` `/v1` server). No local fallback is used.
 */
export async function cloudResolveTaskRef(client: HasnaStorageClient, ref: string): Promise<string> {
  const input = ref.trim().toLowerCase();
  if (!input) throw new Error("Task reference must not be empty");
  if (UUID_RE.test(input)) return input;

  let task: Task | null;
  try {
    task = await cloudGetTask(client, input);
  } catch (error) {
    const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
    if (status === 409) {
      const body = error && typeof error === "object" ? (error as { body?: unknown }).body : undefined;
      const authorityMessage = body && typeof body === "object" && !Array.isArray(body)
        ? (body as { error?: unknown }).error
        : undefined;
      throw new Error(
        typeof authorityMessage === "string" && authorityMessage.trim()
          ? authorityMessage
          : `Task reference is ambiguous: "${ref}"`,
      );
    }
    throw error;
  }

  // Defend against a server returning an unrelated task: the resolved task must
  // actually carry the requested short_id or start with the requested id prefix.
  if (
    task &&
    typeof task.id === "string" &&
    (task.short_id?.toLowerCase() === input || task.id.toLowerCase().startsWith(input))
  ) {
    return task.id;
  }

  // The authority DID answer with a task, it just carries neither the requested
  // short_id nor the requested id prefix. That is a response mismatch, not an
  // unresolved reference, so it must not borrow the diagnosis below.
  if (task) {
    throw new Error(
      `Task not found: ${ref} — the authority returned a task carrying neither this short id ` +
        "nor this id prefix, so the reference was not resolved.",
    );
  }

  // Nothing came back. A 404 on a short reference is returned BOTH by an authority
  // that has no such task AND by an authority that does not implement server-side
  // short-reference resolution at all — the latter answers every short id and id
  // prefix identically. The response cannot distinguish them, so this message must
  // not assert absence. Reading a bare "Task not found" as absence is how a live row
  // gets recorded as deleted, which is the defect this text fixes (task 0deeffb7):
  // `todos show A9-00143` said not-found while the same row returned rc=0 by UUID.
  // A full task UUID short-circuits at the top of this function and never lands here.
  throw new Error(
    `Task not found: ${ref} — the authority resolved no task for this short reference. ` +
      "That is not proof the task is absent: an authority predating server-side " +
      "short-reference resolution answers EVERY short id and id prefix with the same 404. " +
      "Retry with the full task UUID to tell the two apart, or deploy the current " +
      "@hasna/todos /v1 server.",
  );
}

/** Fetch one task by id (`GET /v1/tasks/:id`); `null` on 404. */
export async function cloudGetTask(client: HasnaStorageClient, id: string): Promise<Task | null> {
  const raw = await client.get<unknown>("tasks", id);
  return raw == null ? null : unwrapTask(raw);
}

/** Create a task (`POST /v1/tasks`). */
export async function cloudCreateTask(
  client: HasnaStorageClient,
  input: Record<string, unknown>,
  verification: CloudTaskCreateVerification = {},
): Promise<Task> {
  const expectedParentId = typeof input["parent_id"] === "string" ? input["parent_id"] : null;
  const expectedPlanId = typeof input["plan_id"] === "string" ? input["plan_id"] : null;
  const expectedCreatedBy = typeof verification.expectedCreatedBy === "string"
    && verification.expectedCreatedBy.trim()
    ? verification.expectedCreatedBy
    : null;
  if (expectedCreatedBy !== null) {
    await requireTaskCreatorCapability(client);
  }
  const created = unwrapTask(await requiredRemoteRoute(
    client,
    "/v1/tasks",
    // The /v1 task route does not yet implement Idempotency-Key replay
    // deduplication. Any transient/error response after a store write can
    // therefore replay one logical create into multiple tasks.
    () => client.transport.post<unknown>("/tasks", input, {
      // Keep the generic storage client's create semantics while using the same
      // /v1-relative transport as the known-good hosted fingerprint upsert.
      idempotencyKey: randomUUID(),
      retry: false,
    }),
    ["PARENT_TASK_NOT_FOUND"],
  ));
  if (!created || typeof created.id !== "string" || !created.id.trim()) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: configured Todos authority ${remoteAuthorityBase(client)} returned a task create ` +
        "response without a stored task id; no success row or local SQLite fallback is permitted",
    );
  }

  // A POST response is an acknowledgement, not proof that the configured
  // authority made the task readable. Current servers verify this before 201;
  // the client readback preserves that contract against older authorities too.
  // Read the exact id back before any CLI/MCP caller is allowed to print success,
  // and return that stored row rather than the optimistic POST body.
  const persisted = await cloudGetTask(client, created.id);
  if (
    !persisted
    || persisted.id !== created.id
    || (persisted.parent_id ?? null) !== expectedParentId
    || (persisted.plan_id ?? null) !== expectedPlanId
    || (expectedCreatedBy !== null && persisted.created_by !== expectedCreatedBy)
  ) {
    const creatorDetail = expectedCreatedBy === null
      ? ""
      : ` and explicit created_by=${JSON.stringify(expectedCreatedBy)} ` +
        `(readback ${JSON.stringify(persisted?.created_by ?? null)})`;
    throw new Error(
      `TASK_CREATE_PERSISTENCE_UNVERIFIED: configured Todos authority ${remoteAuthorityBase(client)} accepted ` +
        `POST /v1/tasks but authoritative GET /v1/tasks/${encodeURIComponent(created.id)} did not return the same ` +
        `stored task id, parent_id, and plan_id ` +
        `(requested plan_id=${JSON.stringify(expectedPlanId)}, readback=${JSON.stringify(persisted?.plan_id ?? null)})` +
        `${creatorDetail}; no success row or local SQLite fallback is permitted`,
    );
  }
  return persisted;
}

/** Update a task (`PATCH /v1/tasks/:id`). */
export async function cloudUpdateTask(client: HasnaStorageClient, id: string, patch: Record<string, unknown>): Promise<Task> {
  return unwrapTask(await client.transport.patch<unknown>(`/tasks/${encodeURIComponent(id)}`, patch));
}

/** Delete a task (`DELETE /v1/tasks/:id`); resolves for 2xx and 404. */
export async function cloudDeleteTask(client: HasnaStorageClient, id: string): Promise<boolean> {
  try {
    await client.transport.del(`/tasks/${encodeURIComponent(id)}`);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && (error as { status?: unknown }).status === 404) return false;
    throw error;
  }
}

function unwrapTemplate(raw: unknown): TemplateWithTasks {
  if (raw && typeof raw === "object" && "template" in (raw as Record<string, unknown>)) {
    return (raw as { template: TemplateWithTasks }).template;
  }
  return raw as TemplateWithTasks;
}

/** List reusable templates from the authenticated cloud authority. */
export async function cloudListTemplates(client: HasnaStorageClient, projectId?: string): Promise<TaskTemplate[]> {
  const result = await requiredRemoteRoute(client, "/v1/templates", () =>
    client.list<TaskTemplate>("templates", { query: projectId ? { project_id: projectId } : undefined }));
  const envelope = result.raw as { templates?: TaskTemplate[] } | undefined;
  return Array.isArray(envelope?.templates) ? envelope.templates : result.items;
}

/** Create a reusable template, including its ordered checklist steps, remotely. */
export async function cloudCreateTemplate(client: HasnaStorageClient, input: CreateTemplateInput): Promise<TemplateWithTasks> {
  return unwrapTemplate(await requiredRemoteRoute(client, "/v1/templates", () =>
    client.create<unknown>("templates", input)));
}

/** Fetch a reusable template with its ordered checklist steps; null on 404. */
export async function cloudGetTemplate(client: HasnaStorageClient, id: string): Promise<TemplateWithTasks | null> {
  try {
    return unwrapTemplate(await client.get<unknown>("templates", id));
  } catch (error) {
    if (error && typeof error === "object" && (error as { status?: unknown }).status === 404) return null;
    throw error;
  }
}

/** Update one reusable template remotely; checklist-step changes require a fresh import. */
export async function cloudUpdateTemplate(
  client: HasnaStorageClient,
  id: string,
  patch: UpdateTemplateInput,
): Promise<TemplateWithTasks | null> {
  try {
    return unwrapTemplate(await client.update<unknown>("templates", id, patch));
  } catch (error) {
    if (error && typeof error === "object" && (error as { status?: unknown }).status === 404) return null;
    throw error;
  }
}

/** Delete a reusable template remotely; no local fallback. */
export async function cloudDeleteTemplate(client: HasnaStorageClient, id: string): Promise<boolean> {
  try {
    await client.transport.del(`/templates/${encodeURIComponent(id)}`);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && (error as { status?: unknown }).status === 404) return false;
    throw error;
  }
}

/** Run a task lifecycle action (`POST /v1/tasks/:id/{start|complete|fail|claim}`). */
export async function cloudTaskAction(
  client: HasnaStorageClient,
  id: string,
  action: "start" | "complete" | "fail" | "claim",
  body: Record<string, unknown> = {},
): Promise<Task> {
  const raw = await client.transport.post<unknown>(`/tasks/${encodeURIComponent(id)}/${action}`, body);
  return unwrapTask(raw);
}

export interface CloudTaskFailureInput {
  agent_id?: string;
  reason?: string;
  retry?: boolean;
}

function isRemoteTaskIdentity(value: unknown): value is { id: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const id = (value as Record<string, unknown>)["id"];
  return typeof id === "string" && id.length > 0;
}

/** Fail a task through `/v1` and preserve the lifecycle result, including an optional retry task. */
export async function cloudFailTask(
  client: HasnaStorageClient,
  id: string,
  body: CloudTaskFailureInput = {},
): Promise<TodosTaskFailureResult> {
  const route = `/v1/tasks/${encodeURIComponent(id)}/fail`;
  if (body.retry === true) await requireRetryCapability(client);
  const raw = await requiredRemoteRoute(client, route, () =>
    client.transport.post<unknown>(`/tasks/${encodeURIComponent(id)}/fail`, body as Record<string, unknown>));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`REMOTE_API_INCOMPATIBLE: ${route} returned an invalid failure response envelope`);
  }
  const result = (raw as Record<string, unknown>)["result"];
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`REMOTE_API_INCOMPATIBLE: ${route} did not return result.task`);
  }
  const task = (result as Record<string, unknown>)["task"];
  const retryTask = (result as Record<string, unknown>)["retryTask"];
  if (!isRemoteTaskIdentity(task) ||
      (body.retry === true && !isRemoteTaskIdentity(retryTask)) ||
      (body.retry !== true && retryTask !== undefined && !isRemoteTaskIdentity(retryTask))) {
    throw new Error(`REMOTE_API_INCOMPATIBLE: ${route} returned an invalid failure result`);
  }
  return result as unknown as TodosTaskFailureResult;
}

function resolveOpenApiSchema(document: unknown, schema: unknown): Record<string, unknown> | null {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  const value = schema as Record<string, unknown>;
  if (typeof value["$ref"] !== "string") return value;
  const reference = value["$ref"] as string;
  if (!reference.startsWith("#/")) return null;
  let current: unknown = document;
  for (const segment of reference.slice(2).split("/")) {
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : null;
}

function openApiSchemaProperty(
  document: unknown,
  schemaName: string,
  propertyName: string,
): Record<string, unknown> | null {
  const schema = resolveOpenApiSchema(document, {
    $ref: `#/components/schemas/${schemaName}`,
  });
  const properties = schema?.["properties"];
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return null;
  const property = (properties as Record<string, unknown>)[propertyName];
  return property && typeof property === "object" && !Array.isArray(property)
    ? property as Record<string, unknown>
    : null;
}

async function fetchTaskCreatorCapability(client: HasnaStorageClient): Promise<boolean> {
  const document = await requiredRemoteRoute(client, "/v1/openapi.json", () =>
    client.transport.get<unknown>("/openapi.json"));
  const inputProperty = openApiSchemaProperty(document, "CreateTaskInput", "created_by");
  const outputProperty = openApiSchemaProperty(document, "Task", "created_by");
  return inputProperty?.["type"] === "string"
    && outputProperty?.["type"] === "string"
    && outputProperty?.["nullable"] === true;
}

async function requireTaskCreatorCapability(client: HasnaStorageClient): Promise<void> {
  const authority = remoteAuthorityBase(client);
  let capability = taskCreatorCapabilityCache.get(authority);
  if (!capability) {
    capability = fetchTaskCreatorCapability(client);
    taskCreatorCapabilityCache.set(authority, capability);
  }
  if (!(await capability)) {
    throw new Error(
      `REMOTE_CREATED_BY_UNSUPPORTED: configured Todos authority ${authority} does not advertise created_by ` +
        "on both CreateTaskInput and Task in /v1/openapi.json; no task mutation was sent; deploy a compatible " +
        "@hasna/todos /v1 server before retrying; local SQLite fallback is disabled",
    );
  }
}

async function fetchRetryCapability(client: HasnaStorageClient): Promise<boolean> {
  const document = await requiredRemoteRoute(client, "/v1/openapi.json", () =>
    client.transport.get<unknown>("/openapi.json"));
  if (!document || typeof document !== "object" || Array.isArray(document)) return false;
  const doc = document as Record<string, unknown>;
  const paths = doc["paths"];
  const failPath = paths && typeof paths === "object" && !Array.isArray(paths)
    ? (paths as Record<string, unknown>)["/v1/tasks/{id}/fail"]
    : undefined;
  const post = failPath && typeof failPath === "object" && !Array.isArray(failPath)
    ? (failPath as Record<string, unknown>)["post"]
    : undefined;
  const requestBody = post && typeof post === "object" && !Array.isArray(post)
    ? (post as Record<string, unknown>)["requestBody"]
    : undefined;
  const content = requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
    ? (requestBody as Record<string, unknown>)["content"]
    : undefined;
  const jsonContent = content && typeof content === "object" && !Array.isArray(content)
    ? (content as Record<string, unknown>)["application/json"]
    : undefined;
  const schema = jsonContent && typeof jsonContent === "object" && !Array.isArray(jsonContent)
    ? (jsonContent as Record<string, unknown>)["schema"]
    : undefined;
  const resolved = resolveOpenApiSchema(document, schema);
  const properties = resolved?.["properties"];
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return false;
  const retry = (properties as Record<string, unknown>)["retry"];
  return !!retry && typeof retry === "object" && !Array.isArray(retry) &&
    (retry as Record<string, unknown>)["type"] === "boolean";
}

async function requireRetryCapability(client: HasnaStorageClient): Promise<void> {
  const authority = remoteAuthorityBase(client);
  let capability = retryCapabilityCache.get(authority);
  if (!capability) {
    capability = fetchRetryCapability(client);
    retryCapabilityCache.set(authority, capability);
  }
  if (!(await capability)) {
    throw new Error(
      `REMOTE_RETRY_UNSUPPORTED: configured Todos authority ${authority} does not advertise retry in the ` +
        "application/json request schema for POST /v1/tasks/{id}/fail; no failure mutation was sent; " +
        "deploy a compatible @hasna/todos /v1 server before retrying; local SQLite fallback is disabled",
    );
  }
}

async function fetchCompletionCapabilities(client: HasnaStorageClient): Promise<ReadonlySet<string>> {
  const document = await requiredRemoteRoute(client, "/v1/openapi.json", () =>
    client.transport.get<unknown>("/openapi.json"));
  if (!document || typeof document !== "object" || Array.isArray(document)) return new Set();
  const doc = document as Record<string, unknown>;
  const paths = doc["paths"];
  const completePath = paths && typeof paths === "object" && !Array.isArray(paths)
    ? (paths as Record<string, unknown>)["/v1/tasks/{id}/complete"]
    : undefined;
  const post = completePath && typeof completePath === "object" && !Array.isArray(completePath)
    ? (completePath as Record<string, unknown>)["post"]
    : undefined;
  const requestBody = post && typeof post === "object" && !Array.isArray(post)
    ? (post as Record<string, unknown>)["requestBody"]
    : undefined;
  const content = requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
    ? (requestBody as Record<string, unknown>)["content"]
    : undefined;
  const jsonContent = content && typeof content === "object" && !Array.isArray(content)
    ? (content as Record<string, unknown>)["application/json"]
    : undefined;
  const schema = jsonContent && typeof jsonContent === "object" && !Array.isArray(jsonContent)
    ? (jsonContent as Record<string, unknown>)["schema"]
    : undefined;
  const resolved = resolveOpenApiSchema(document, schema);
  const properties = resolved?.["properties"];
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return new Set();
  return new Set(Object.keys(properties as Record<string, unknown>));
}

async function requireCompletionCapabilities(
  client: HasnaStorageClient,
  body: CloudTaskCompletionInput,
): Promise<void> {
  const requested = COMPLETION_EVIDENCE_FIELDS.filter((field) => body[field] !== undefined);
  if (requested.length === 0) return;
  const authority = remoteAuthorityBase(client);
  let capability = completionCapabilityCache.get(authority);
  if (!capability) {
    capability = fetchCompletionCapabilities(client);
    completionCapabilityCache.set(authority, capability);
  }
  const supported = await capability;
  const missing = requested.filter((field) => !supported.has(field));
  if (missing.length > 0) {
    throw new Error(
      `REMOTE_COMPLETION_EVIDENCE_UNSUPPORTED: configured Todos authority ${authority} does not advertise ` +
        `${missing.join(", ")} in POST /v1/tasks/{id}/complete; no completion mutation was sent`,
    );
  }
}

/** Complete a task, preflighting evidence-bearing bodies against this authority's OpenAPI contract. */
export async function cloudCompleteTask(
  client: HasnaStorageClient,
  id: string,
  body: CloudTaskCompletionInput = {},
): Promise<Task> {
  await requireCompletionCapabilities(client, body);
  return cloudTaskAction(client, id, "complete", body as Record<string, unknown>);
}

/** Queue status summary from the cloud (`GET /v1/stats`). */
export interface CloudStats {
  tasks: number;
  tasks_all?: number;
  subtasks?: number;
  projects?: number;
  [key: string]: unknown;
}

/**
 * Fetch the cloud queue summary (`GET /v1/stats`). Used by the MCP `get_status`
 * tool so a flipped machine reports the shared cloud totals rather than its
 * local SQLite island.
 */
export async function cloudGetStats(client: HasnaStorageClient): Promise<CloudStats> {
  const raw = await requiredRemoteRoute(client, "/v1/stats", () =>
    client.transport.get<unknown>("/stats"));
  return (raw ?? {}) as CloudStats;
}

/**
 * HTTP status of an error that means "this authority does not expose the route"
 * (404) or "the backing store cannot answer it" (501), unwrapping the classified
 * wrapper `protectRemoteClient` puts around transport errors. Anything else is a
 * real failure and must keep propagating — a diagnostic that swallowed errors
 * would be the same lie in a new place.
 */
function remoteRouteMissingStatus(error: unknown): number | null {
  for (let current: unknown = error, depth = 0; current && depth < 3; depth++) {
    const status = typeof current === "object" ? (current as { status?: unknown }).status : undefined;
    if (status === 404 || status === 501) return status;
    if (current instanceof Error && /HTTP (404|501)\b/.test(current.message)) {
      return Number(/HTTP (404|501)\b/.exec(current.message)![1]);
    }
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
  return null;
}

/**
 * Referential-integrity report from the authority (`GET /v1/integrity`).
 *
 * Returns `null` — NOT an empty/clean report — when the authority predates the
 * route (404) or its storage backend cannot answer it (501), so the caller reports
 * those conditions as UNVERIFIED instead of healthy.
 */
export async function cloudGetIntegrityReport(client: HasnaStorageClient): Promise<IntegrityReport | null> {
  try {
    const raw = await client.transport.get<unknown>("/integrity");
    const envelope = (raw ?? {}) as { integrity?: IntegrityReport };
    const report = envelope.integrity ?? (raw as IntegrityReport | null);
    if (!report || typeof report !== "object" || !Array.isArray((report as IntegrityReport).conditions)) {
      throw new Error(
        "REMOTE_API_INCOMPATIBLE: GET /v1/integrity did not return a condition breakdown; " +
          "local SQLite fallback is disabled",
      );
    }
    return report;
  } catch (error) {
    if (remoteRouteMissingStatus(error) !== null) return null;
    throw error;
  }
}

/** Outcome of a paged client-side task scan over `/v1/tasks`. */
export interface CloudTaskScan {
  /** True only when every task row the authority reported was seen. */
  complete: boolean;
  reason?: string;
  scanned: number;
  total: number | null;
  pages: number;
  rows: IntegrityTaskRow[];
}

/**
 * Page every task over `/v1/tasks` and project each row down to the fields the
 * integrity conditions need.
 *
 * This is the TRANSITIONAL path for an authority that has no `/v1/integrity`
 * aggregate: `/v1/tasks` cannot express `project_id IS NULL` (the filter only
 * binds when truthy), so the only honest client-side alternative to a server-side
 * COUNT is to look at every row. It is opt-in (`doctor --scan-tasks`) because it
 * costs one request per page, and it is READ-ONLY.
 *
 * Bounded and never optimistic: rows are deduped by id (the list order is
 * priority/recency, so a concurrent write can shift a row between pages), a short
 * page ends the walk, and finishing with fewer rows than the authority's own
 * `total` marks the scan INCOMPLETE rather than reporting a partial count as truth.
 */
export async function cloudScanTaskRows(
  client: HasnaStorageClient,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<CloudTaskScan> {
  const pageSize = Math.max(1, Math.min(1_000, options.pageSize ?? 1_000));
  const maxPages = Math.max(1, options.maxPages ?? 2_000);
  const seen = new Set<string>();
  const rows: IntegrityTaskRow[] = [];
  let total: number | null = null;
  let pages = 0;
  let offset = 0;
  let reason: string | undefined;

  while (pages < maxPages) {
    const res = await requiredRemoteRoute(client, "/v1/tasks", () =>
      client.list<Task>("tasks", { query: { limit: pageSize, offset, include_subtasks: "true" } }));
    const envelope = res.raw as { tasks?: Task[]; total?: number } | undefined;
    const page = Array.isArray(envelope?.tasks) ? envelope!.tasks : res.items;
    if (typeof envelope?.total === "number") total = envelope.total;
    pages++;
    for (const task of page) {
      const id = typeof task?.id === "string" ? task.id : null;
      if (id !== null) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      rows.push({
        project_id: task?.project_id ?? null,
        task_list_id: task?.task_list_id ?? null,
        status: task?.status ?? null,
      });
    }
    if (page.length < pageSize) break;
    offset += page.length;
  }
  if (pages >= maxPages) reason = `scan stopped at the ${maxPages}-page cap`;
  else if (total !== null && rows.length < total) {
    reason = `scan saw ${rows.length} of ${total} tasks the authority reported (the dataset changed mid-scan)`;
  }
  return { complete: reason === undefined, ...(reason ? { reason } : {}), scanned: rows.length, total, pages, rows };
}

/** List registered agents from the cloud (`GET /v1/agents`). */
export async function cloudListAgents(client: HasnaStorageClient): Promise<Agent[]> {
  const res = await client.list<Agent>("agents");
  const envelope = res.raw as { agents?: Agent[] } | undefined;
  return Array.isArray(envelope?.agents) ? envelope!.agents : res.items;
}

/** List projects from the cloud (`GET /v1/projects`). */
export async function cloudListProjects(client: HasnaStorageClient): Promise<Project[]> {
  const res = await requiredRemoteRoute(client, "/v1/projects", () => client.list<Project>("projects"));
  const envelope = res.raw as { projects?: Project[] } | undefined;
  return Array.isArray(envelope?.projects) ? envelope!.projects : res.items;
}

function unwrapProject(raw: unknown): Project {
  if (raw && typeof raw === "object" && "project" in (raw as Record<string, unknown>)) {
    return (raw as { project: Project }).project;
  }
  return raw as Project;
}

async function cloudGetProjectById(client: HasnaStorageClient, id: string): Promise<Project | null> {
  const raw = await client.get<unknown>("projects", id);
  return raw == null ? null : unwrapProject(raw);
}

export async function cloudCreateProject(
  client: HasnaStorageClient,
  input: Record<string, unknown>,
): Promise<Project> {
  return unwrapProject(await requiredRemoteRoute(client, "/v1/projects", () => client.create("projects", input)));
}

function cloudProjectSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function cloudProjectPathBasename(value: string): string {
  return value.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? value;
}

function uniqueProjectMatches(projects: Project[], predicate: (project: Project) => boolean): Project[] {
  return [...new Map(projects.filter(predicate).map((project) => [project.id, project])).values()];
}

/**
 * Resolve a cloud project UUID, unique UUID prefix, exact name/path, or canonical slug.
 *
 * A miss throws one of two DISTINGUISHABLE errors (see 7a50aa8c): a UUID-shaped
 * reference that matches nothing is a genuine id-lookup miss and stays terse; a
 * name/path/slug reference that matches nothing only proves it is absent from
 * todos's own registry, and the error says so rather than reading as proof the
 * project was never created anywhere.
 */
function resolveCloudProjectRef(projects: Project[], ref: string): string {
  const input = ref.trim();
  const normalizedRef = input.toLowerCase();
  const pathLike = input.startsWith(".") || input.includes("/") || input.includes("\\");
  const normalizedPath = pathLike ? resolvePath(input) : undefined;
  const slug = cloudProjectSlug(pathLike ? cloudProjectPathBasename(input) : input);
  const matchGroups = [
    uniqueProjectMatches(projects, (project) => project.id.toLowerCase() === normalizedRef),
    uniqueProjectMatches(
      projects,
      (project) => project.path === input ||
        (normalizedPath !== undefined && resolvePath(project.path) === normalizedPath),
    ),
    uniqueProjectMatches(projects, (project) => project.name.toLowerCase() === normalizedRef),
    uniqueProjectMatches(
      projects,
      (project) => project.task_list_id === input ||
        cloudProjectSlug(project.name) === slug ||
        cloudProjectSlug(cloudProjectPathBasename(project.path)) === slug,
    ),
    uniqueProjectMatches(projects, (project) => project.id.toLowerCase().startsWith(normalizedRef)),
  ];

  for (const matches of matchGroups) {
    if (matches.length === 1) return matches[0]!.id;
    if (matches.length > 1) throw new Error(`Project reference is ambiguous: "${input}"`);
  }

  // A UUID (or a hex-only id prefix, the shape the last match group above
  // resolves) is unambiguously an ID LOOKUP: it never matched a name, path, or
  // slug, and it never will. "Project not found" is the whole truth there.
  //
  // Anything else fell through every name/path/slug match group above without
  // matching, i.e. it went through THE SLUG PATH. That failure is NOT the same
  // fact: this only proves the reference is absent from todos's OWN project
  // registry. A slug or id that is real in a different system — for example a
  // Hasna Projects CLI workspace, whose canonical "wks_..." id and slug are
  // never auto-linked into a todos project — produced the byte-identical
  // message here, which reads as "this has never been created" and invites a
  // caller to create a duplicate project. Say what was actually checked.
  if (UUID_RE.test(input) || /^[0-9a-f]{4,}$/i.test(input)) {
    throw new Error(`Project not found: "${input}"`);
  }
  throw new Error(
    `Project not found: "${input}" — no project in todos's own project registry matches this ` +
      `name, path, or slug. This does not know about projects registered elsewhere (for example ` +
      `a Hasna Projects CLI workspace) — resolve it there first (e.g. "projects show ${input} ` +
      `--json") and pass the resulting id or task-list slug, or run "todos projects create" to ` +
      `register it here. Do not assume "${input}" has never been created.`,
  );
}

export async function cloudResolveProjectRef(client: HasnaStorageClient, ref: string): Promise<string> {
  return resolveCloudProjectRef(await cloudListProjects(client), ref);
}

export async function cloudResolveProject(client: HasnaStorageClient, ref: string): Promise<Project> {
  const projects = await cloudListProjects(client);
  const id = resolveCloudProjectRef(projects, ref);
  return projects.find((project) => project.id === id)!;
}

/** Update one cloud project by exact UUID (`PATCH /v1/projects/:id`). */
export async function cloudUpdateProject(
  client: HasnaStorageClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<Project> {
  const raw = await client.update<unknown>("projects", id, patch);
  if (raw && typeof raw === "object" && "project" in (raw as Record<string, unknown>)) {
    return (raw as { project: Project }).project;
  }
  return raw as Project;
}

/** Delete one cloud project (`DELETE /v1/projects/:id`). */
export async function cloudDeleteProject(client: HasnaStorageClient, id: string): Promise<boolean> {
  try {
    await client.transport.del<unknown>(`/projects/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error && typeof error === "object" && (error as { status?: unknown }).status === 404) return false;
    throw error;
  }
  return true;
}

/** Plan a non-mutating repair of an existing project's declared task list. */
export async function cloudPlanProjectTaskListEnsure(
  client: HasnaStorageClient,
  projectId: string,
): Promise<ProjectTaskListEnsureResult> {
  return requiredRemoteRoute(
    client,
    "/v1/projects/:id/task-list/ensure",
    () => client.transport.get<ProjectTaskListEnsureResult>(
      `/projects/${encodeURIComponent(projectId)}/task-list/ensure`,
    ),
    ["PROJECT_NOT_FOUND"],
  );
}

/** Apply an exact-revision, idempotent repair of a project's declared task list. */
export async function cloudApplyProjectTaskListEnsure(
  client: HasnaStorageClient,
  projectId: string,
  input: { expected_project_revision: string; idempotency_key?: string },
): Promise<ProjectTaskListEnsureResult> {
  return requiredRemoteRoute(
    client,
    "/v1/projects/:id/task-list/ensure",
    () => client.transport.post<ProjectTaskListEnsureResult>(
      `/projects/${encodeURIComponent(projectId)}/task-list/ensure`,
      input,
    ),
    ["PROJECT_NOT_FOUND"],
  );
}

/** Conditionally remove an unchanged list owned by an accepted ensure receipt. */
export async function cloudRollbackProjectTaskListEnsure(
  client: HasnaStorageClient,
  projectId: string,
  input: { receipt_id: string; expected_task_list_revision: string },
): Promise<ProjectTaskListRollbackResult> {
  return requiredRemoteRoute(
    client,
    "/v1/projects/:id/task-list/rollback",
    () => client.transport.post<ProjectTaskListRollbackResult>(
      `/projects/${encodeURIComponent(projectId)}/task-list/rollback`,
      input,
    ),
    ["PROJECT_NOT_FOUND", "PROJECT_TASK_LIST_RECEIPT_NOT_FOUND"],
  );
}

/** Plan a non-mutating link of one existing plan and all its tasks to a project. */
export async function cloudPlanPlanProjectLink(
  client: HasnaStorageClient,
  planId: string,
  projectId: string,
): Promise<PlanProjectLinkResult> {
  const route = `/v1/plans/${encodeURIComponent(planId)}/project-link`;
  const response = await requiredRemoteRoute(
    client,
    "/v1/plans/:id/project-link",
    () => client.transport.get<unknown>(
      `/plans/${encodeURIComponent(planId)}/project-link`,
      { query: { project_id: projectId } },
    ),
    ["PLAN_PROJECT_LINK_PLAN_NOT_FOUND", "PLAN_PROJECT_LINK_PROJECT_NOT_FOUND"],
  );
  try {
    return assertPlanProjectLinkResponse(response, { mode: "plan", plan_id: planId, project_id: projectId });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned an invalid ${PLAN_PROJECT_LINK_SCHEMA_VERSION} plan response: ` +
        `${reason}; local SQLite fallback is disabled`,
      { cause: error },
    );
  }
}

/** Atomically link one existing plan and all its tasks to a project. */
export async function cloudApplyPlanProjectLink(
  client: HasnaStorageClient,
  planId: string,
  projectId: string,
  input: {
    expected_plan_revision: string;
    expected_project_revision: string;
    idempotency_key: string;
  },
): Promise<PlanProjectLinkResult> {
  const route = `/v1/plans/${encodeURIComponent(planId)}/project-link`;
  const normalizedInput = {
    ...input,
    idempotency_key: normalizePlanProjectLinkIdempotencyKey(input.idempotency_key),
  };
  const response = await requiredRemoteRoute(
    client,
    "/v1/plans/:id/project-link",
    () => client.transport.post<unknown>(
      `/plans/${encodeURIComponent(planId)}/project-link`,
      { project_id: projectId, ...normalizedInput },
    ),
    ["PLAN_PROJECT_LINK_PLAN_NOT_FOUND", "PLAN_PROJECT_LINK_PROJECT_NOT_FOUND"],
  );
  try {
    return assertPlanProjectLinkResponse(response, {
      mode: "apply",
      plan_id: planId,
      project_id: projectId,
      idempotency_key: normalizedInput.idempotency_key,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned an invalid ${PLAN_PROJECT_LINK_SCHEMA_VERSION} apply response: ` +
        `${reason}; local SQLite fallback is disabled`,
      { cause: error },
    );
  }
}

/** Roll back an accepted plan/project link receipt at the exact current revision. */
export async function cloudRollbackPlanProjectLink(
  client: HasnaStorageClient,
  planId: string,
  projectId: string,
  input: { receipt_id: string; expected_plan_revision: string },
): Promise<PlanProjectLinkRollbackResult> {
  const route = `/v1/plans/${encodeURIComponent(planId)}/project-link/rollback`;
  const response = await requiredRemoteRoute(
    client,
    "/v1/plans/:id/project-link/rollback",
    () => client.transport.post<unknown>(
      `/plans/${encodeURIComponent(planId)}/project-link/rollback`,
      { project_id: projectId, ...input },
    ),
    [
      "PLAN_PROJECT_LINK_PLAN_NOT_FOUND",
      "PLAN_PROJECT_LINK_PROJECT_NOT_FOUND",
      "PLAN_PROJECT_LINK_RECEIPT_NOT_FOUND",
    ],
  );
  try {
    return assertPlanProjectLinkRollbackResponse(response, {
      plan_id: planId,
      receipt_id: input.receipt_id,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned an invalid ${PLAN_PROJECT_LINK_SCHEMA_VERSION} rollback response: ` +
        `${reason}; local SQLite fallback is disabled`,
      { cause: error },
    );
  }
}

/** List plans from the cloud (`GET /v1/plans`), optionally scoped to a project. */
export async function cloudListPlans(client: HasnaStorageClient, projectId?: string): Promise<Plan[]> {
  const query = projectId ? { project_id: projectId } : {};
  const res = await requiredRemoteRoute(client, "/v1/plans", () => client.list<Plan>("plans", { query }));
  const envelope = res.raw as { plans?: Plan[] } | undefined;
  return Array.isArray(envelope?.plans) ? envelope!.plans : res.items;
}

function unwrapPlan(raw: unknown): Plan {
  if (raw && typeof raw === "object" && "plan" in (raw as Record<string, unknown>)) {
    return (raw as { plan: Plan }).plan;
  }
  return raw as Plan;
}

async function cloudGetPlanById(client: HasnaStorageClient, id: string): Promise<Plan | null> {
  const raw = await client.get<unknown>("plans", id);
  return raw ? unwrapPlan(raw) : null;
}

function isUnavailablePlanPatchRoute(error: unknown): boolean {
  if (!error || typeof error !== "object" || (error as { status?: unknown }).status !== 404) return false;
  const body = (error as { body?: unknown }).body;
  const remoteMessage = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { error?: unknown }).error
    : undefined;
  return remoteMessage === "unknown /v1 resource: plans";
}

function isExactPlanCompletionPatch(patch: UpdatePlanInput): boolean {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  return entries.length === 1 && entries[0]?.[0] === "status" && entries[0]?.[1] === "completed";
}

const PLAN_COMPLETION_PROTECTED_FIELDS = [
  "id",
  "slug",
  "project_id",
  "task_list_id",
  "agent_id",
  "name",
  "description",
  "created_at",
  "machine_id",
  "synced_at",
] as const satisfies ReadonlyArray<keyof Plan>;

/** Create one cloud plan (`POST /v1/plans`). */
export async function cloudCreatePlan(client: HasnaStorageClient, input: CreatePlanInput): Promise<Plan> {
  return unwrapPlan(await requiredRemoteRoute(client, "/v1/plans", () =>
    client.create<unknown>("plans", input as unknown as Record<string, unknown>)));
}

/** Update one cloud plan (`PATCH /v1/plans/:id`). */
export async function cloudUpdatePlan(client: HasnaStorageClient, id: string, patch: UpdatePlanInput): Promise<Plan> {
  try {
    return unwrapPlan(await client.update<unknown>("plans", id, patch as unknown as Record<string, unknown>));
  } catch (error) {
    if (!isExactPlanCompletionPatch(patch) || !isUnavailablePlanPatchRoute(error)) throw error;

    // Some deployed authorities can read plans but predate the generic plan
    // PATCH route. `/v1/import` is the authenticated compatibility route those
    // authorities already expose, but a full plan snapshot is unsafe: Plan has
    // no version and equal-clock imports can overwrite concurrent field edits.
    // Ask the server for a status-only revision CAS instead. Legacy servers that
    // do not implement this operation reject the empty snapshot and fail closed.
    const existing = await cloudGetPlanById(client, id);
    if (!existing) throw error;
    if (existing.status === "completed") return existing;
    const imported = await requiredRemoteRoute(client, "/v1/import", () =>
      client.transport.post<unknown>("/import", {
        source: "postgres",
        planCompletions: [{
          id,
          expected_updated_at: existing.updated_at,
          status: "completed",
        }],
      }));
    const envelope = imported && typeof imported === "object" && !Array.isArray(imported)
      ? imported as {
        received?: unknown;
        result?: { errors?: unknown };
        planCompletions?: Array<{
          id?: unknown;
          status?: unknown;
          expected_updated_at?: unknown;
          result_updated_at?: unknown;
          applied?: unknown;
        }>;
      }
      : null;
    const completion = envelope?.planCompletions?.[0];
    if (
      envelope?.received !== 1
      || !envelope.result
      || !Array.isArray(envelope.result.errors)
      || envelope.result.errors.length > 0
      || envelope.planCompletions?.length !== 1
      || completion?.id !== id
      || completion.status !== "completed"
      || completion.expected_updated_at !== existing.updated_at
      || typeof completion.result_updated_at !== "string"
      || typeof completion.applied !== "boolean"
    ) {
      throw new Error(
        "REMOTE_API_INCOMPATIBLE: /v1/import did not confirm one atomic plan completion; " +
          "local SQLite fallback is disabled",
      );
    }

    const persisted = await cloudGetPlanById(client, id);
    if (!persisted) {
      throw new Error(
        `REMOTE_API_INCOMPATIBLE: /v1/import acknowledged plan completion ${id} but authoritative readback returned no plan; ` +
          "local SQLite fallback is disabled",
      );
    }
    if (persisted.status !== "completed" || persisted.updated_at !== completion.result_updated_at) {
      throw new Error(
        `REMOTE_API_INCOMPATIBLE: /v1/import completion readback did not match its receipt for plan ${id}; ` +
          "local SQLite fallback is disabled",
      );
    }
    for (const key of PLAN_COMPLETION_PROTECTED_FIELDS) {
      if (persisted[key] !== existing[key]) {
        throw new Error(
          `REMOTE_PLAN_COMPLETION_CONFLICT: /v1/import completion changed protected plan field ${key}; ` +
            "local SQLite fallback is disabled",
        );
      }
    }
    return persisted;
  }
}

/** Delete one cloud plan (`DELETE /v1/plans/:id`). */
export async function cloudDeletePlan(client: HasnaStorageClient, id: string): Promise<boolean> {
  try {
    await client.transport.del<unknown>(`/plans/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && (error as { status?: unknown }).status === 404) {
      return false;
    }
    throw error;
  }
  return true;
}

/**
 * Add a comment to a task in the cloud (`POST /v1/tasks/:id/comments`). The server
 * validates that the task exists and returns 404 (surfaced as a thrown error by the
 * transport) when it does not — so a comment on a missing cloud task fails loudly
 * instead of silently succeeding.
 */
export async function cloudAddComment(
  client: HasnaStorageClient,
  taskId: string,
  input: { content: string; agent_id?: string; session_id?: string; type?: string; progress_pct?: number },
): Promise<TaskComment> {
  const raw = await client.transport.post<unknown>(`/tasks/${encodeURIComponent(taskId)}/comments`, input);
  const comment = raw && typeof raw === "object" && "comment" in (raw as Record<string, unknown>)
    ? (raw as { comment: unknown }).comment
    : raw;
  const normalized = normalizeTaskComment(comment);
  if (!normalized) throw new Error("Invalid cloud comment response");
  return redactComment(normalized);
}

/**
 * Add a plan-row comment through `/v1/plans/:id/comments` (todos task
 * 04ee08fd). Plans previously had no comment surface, so commenting on a plan
 * 404'd with "task not found" and plan-level outcomes could not be recorded on
 * the plan row.
 */
export async function cloudAddPlanComment(
  client: HasnaStorageClient,
  planId: string,
  input: { content: string; agent_id?: string; session_id?: string; type?: string; progress_pct?: number },
): Promise<PlanComment> {
  const raw = await client.transport.post<unknown>(`/plans/${encodeURIComponent(planId)}/comments`, input);
  const comment = raw && typeof raw === "object" && "comment" in (raw as Record<string, unknown>)
    ? (raw as { comment: unknown }).comment
    : raw;
  const normalized = normalizePlanComment(comment);
  if (!normalized) throw new Error("Invalid cloud plan comment response");
  return { ...normalized, content: redactEvidenceText(normalized.content) };
}

/**
 * True when a transport failure means "this route does not exist on the
 * authority", as opposed to a genuine server/network failure. Detected from
 * the `HasnaHttpError` status (typed `.status`) or its message, walking the
 * cause chain because remote classification wraps transport errors in a
 * wrapper that carries the original as `.cause`.
 */
function isPlanCommentsRouteAbsent(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ((current as { status?: unknown }).status === 404) return true;
    const message = (current as { message?: unknown }).message;
    if (typeof message === "string" && message.includes("404")) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** List plan comments through `/v1/plans/:id/comments`. */
export async function cloudListPlanComments(
  client: HasnaStorageClient,
  planId: string,
): Promise<PlanComment[]> {
  // Direct transport path: `client.get(resource, id)` builds the path via
  // entityPath, which encodeURIComponent's the WHOLE id — a "/comments" suffix
  // would be encoded into %2F and never reach the plan comment route.
  let raw: unknown;
  try {
    raw = await client.transport.get<unknown>(`/plans/${encodeURIComponent(planId)}/comments`);
  } catch (error) {
    // The comments list is an ADDITIVE surface on the plan row. A hosted API
    // that predates /v1/plans/:id/comments answers 404, and `plans --show`
    // must keep working against it (two-backend contract: the CLI works
    // against the local store AND the hosted API, old and new). Degrade to an
    // empty list — the same shape the local path returns for a plan with no
    // comments — instead of failing the whole command. Any OTHER failure
    // (5xx, network, auth) still surfaces. The WRITE path (cloudAddPlanComment)
    // stays strict: commenting on a plan genuinely requires the new route.
    if (!isPlanCommentsRouteAbsent(error)) throw error;
    return [];
  }
  const comments = raw && typeof raw === "object" && Array.isArray((raw as { comments?: unknown }).comments)
    ? (raw as { comments: unknown[] }).comments
    : Array.isArray(raw) ? raw : [];
  return comments
    .map(normalizePlanComment)
    .filter((comment): comment is PlanComment => comment !== null)
    .map((comment) => ({ ...comment, content: redactEvidenceText(comment.content) }));
}

export interface CloudCommentPage {
  /** Oldest-to-newest comments within this bounded page. */
  comments: TaskComment[];
  /** Number of comments in this page, not the total comment count. */
  count: number;
  /** True when an older page is available through `next_cursor`. */
  has_more: boolean;
  /** Opaque cursor for the next (older) page. */
  next_cursor: string | null;
  /** Maximum number of comments requested from the server. */
  limit: number;
  /** False only while talking to a predecessor server without cursor metadata. */
  pagination_supported: boolean;
}

export interface CloudCommentPageOptions {
  limit?: number;
  cursor?: string;
}

/**
 * List one bounded page of persisted comments for a cloud task. The first page
 * contains the newest comments while preserving oldest-to-newest display order;
 * `next_cursor` walks toward older comments. Callers must surface `has_more`
 * rather than silently implying that this page is the complete history.
 */
export async function cloudListComments(
  client: HasnaStorageClient,
  taskId: string,
  options: CloudCommentPageOptions = {},
): Promise<CloudCommentPage> {
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Cloud comment limit must be an integer between 1 and 500");
  }
  if (options.cursor !== undefined &&
      (typeof options.cursor !== "string" || !options.cursor || options.cursor.length > 1_024)) {
    throw new Error("Cloud comment cursor must be a non-empty string");
  }
  let raw: unknown;
  try {
    raw = await client.transport.get<unknown>(`/tasks/${encodeURIComponent(taskId)}/comments`, {
      query: { limit, ...(options.cursor ? { cursor: options.cursor } : {}) },
    });
  } catch (error) {
    const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
    if (status === 404 || status === 405) {
      throw new Error(
        "Cloud task comments require a compatible @hasna/todos server; deploy the server endpoint before this CLI.",
        { cause: error },
      );
    }
    throw error;
  }

  const envelope = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as { comments?: unknown; count?: unknown; has_more?: unknown; next_cursor?: unknown })
    : null;
  const candidate = Array.isArray(raw) ? raw : envelope?.comments;
  if (!Array.isArray(candidate)) {
    throw new Error("Invalid cloud comments response");
  }
  // Normalize every comment into the canonical shape. A comment is rejected only
  // when its immutable identity/content fields (id, task_id, content, created_at)
  // are missing or mistyped — a genuinely malformed response. Optional metadata
  // (agent_id, session_id, type, progress_pct) is defaulted to null/"comment",
  // mirroring the server's own `?? null` / `?? "comment"` write-side defaulting,
  // so a single legacy or predecessor-version comment row that predates one of
  // those columns cannot fail-close the entire task read (e.g. `inspect --agent`,
  // which resolves a long-lived in-progress task that accumulated such rows).
  const parsed: TaskComment[] = candidate.map((item) => {
    const comment = normalizeTaskComment(item);
    if (!comment) throw new Error("Invalid cloud comments response");
    return redactComment(comment);
  });
  if (envelope?.count !== undefined &&
      (!Number.isSafeInteger(envelope.count) || (envelope.count as number) < 0 || envelope.count !== parsed.length)) {
    throw new Error("Invalid cloud comments response count");
  }
  const hasHasMore = envelope ? Object.prototype.hasOwnProperty.call(envelope, "has_more") : false;
  const hasNextCursor = envelope ? Object.prototype.hasOwnProperty.call(envelope, "next_cursor") : false;
  if (hasHasMore !== hasNextCursor) throw new Error("Invalid cloud comments pagination response");
  const paginationSupported = hasHasMore && hasNextCursor;

  if (!paginationSupported) {
    const comments = parsed.slice(-limit);
    return {
      comments,
      count: comments.length,
      has_more: parsed.length > limit,
      next_cursor: null,
      limit,
      pagination_supported: false,
    };
  }
  if (parsed.length > limit) throw new Error("Invalid cloud comments response: page exceeds requested limit");

  const hasMore = envelope!.has_more;
  const nextCursor = envelope!.next_cursor;
  if (typeof hasMore !== "boolean" || (nextCursor !== null && (typeof nextCursor !== "string" || !nextCursor))) {
    throw new Error("Invalid cloud comments pagination response");
  }
  if ((hasMore && nextCursor === null) || (!hasMore && nextCursor !== null)) {
    throw new Error("Invalid cloud comments pagination response");
  }
  return {
    comments: parsed,
    count: parsed.length,
    has_more: hasMore,
    next_cursor: nextCursor,
    limit,
    pagination_supported: true,
  };
}

/**
 * Coerce an untrusted server payload into the canonical {@link TaskComment}
 * shape, or return `null` when it is genuinely malformed. The immutable
 * identity/content fields (`id`, `task_id`, `content`, `created_at`) are
 * required and must be strings — their absence means the response is corrupt.
 * The optional metadata fields are tolerant by design: a missing, null, or
 * wrong-typed `agent_id`/`session_id`/`progress_pct` collapses to `null` and an
 * absent/unknown `type` collapses to `"comment"`, matching the server's own
 * write-side defaulting. This keeps the reader from fail-closing an entire task
 * read because one legacy or predecessor-version comment row omitted a column
 * that was added later. Content is left untouched here and redacted by callers.
 */
function normalizeTaskComment(value: unknown): TaskComment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const comment = value as Record<string, unknown>;
  if (typeof comment["id"] !== "string"
    || typeof comment["task_id"] !== "string"
    || typeof comment["content"] !== "string"
    || typeof comment["created_at"] !== "string") {
    return null;
  }
  const type = comment["type"];
  return {
    id: comment["id"],
    task_id: comment["task_id"],
    agent_id: typeof comment["agent_id"] === "string" ? comment["agent_id"] : null,
    session_id: typeof comment["session_id"] === "string" ? comment["session_id"] : null,
    content: comment["content"],
    type: type === "progress" || type === "note" ? type : "comment",
    progress_pct: typeof comment["progress_pct"] === "number" ? comment["progress_pct"] : null,
    created_at: comment["created_at"],
  };
}

/** The plan-row analogue of normalizeTaskComment (todos task 04ee08fd). */
function normalizePlanComment(value: unknown): PlanComment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const comment = value as Record<string, unknown>;
  if (typeof comment["id"] !== "string"
    || typeof comment["plan_id"] !== "string"
    || typeof comment["content"] !== "string"
    || typeof comment["created_at"] !== "string") {
    return null;
  }
  const type = comment["type"];
  return {
    id: comment["id"],
    plan_id: comment["plan_id"],
    agent_id: typeof comment["agent_id"] === "string" ? comment["agent_id"] : null,
    session_id: typeof comment["session_id"] === "string" ? comment["session_id"] : null,
    content: comment["content"],
    type: type === "progress" || type === "note" ? type : "comment",
    progress_pct: typeof comment["progress_pct"] === "number" ? comment["progress_pct"] : null,
    created_at: comment["created_at"],
  };
}

function redactComment(comment: TaskComment): TaskComment {
  return { ...comment, content: redactEvidenceText(comment.content) };
}

/**
 * Per-task audit trail (`GET /v1/tasks/:id/history`). The CLI `history` command
 * read this machine's LOCAL sqlite, so a flipped machine reported "No history" for
 * a cloud task whose trail lives in the shared dataset. Requires the
 * `/v1/tasks/:id/history` server route (ECS redeploy).
 */
export async function cloudTaskHistory(client: HasnaStorageClient, taskId: string): Promise<TaskHistory[]> {
  const raw = await client.transport.get<unknown>(`/tasks/${encodeURIComponent(taskId)}/history`);
  const envelope = (raw ?? {}) as { history?: TaskHistory[] };
  if (Array.isArray(envelope.history)) return envelope.history;
  return Array.isArray(raw) ? (raw as TaskHistory[]) : [];
}

/** Result of an idempotent fingerprint upsert (`POST /v1/tasks/upsert`). */
export interface CloudUpsertTaskResult {
  task: Task;
  created: boolean;
}

/**
 * Idempotent create-or-update a task by stable fingerprint on the SHARED dataset
 * (`POST /v1/tasks/upsert`). Fixes the split-brain write where `task upsert` wrote
 * to this machine's LOCAL sqlite (absent from the cloud /v1 API). Requires the
 * `/v1/tasks/upsert` server route (ECS redeploy).
 */
export async function cloudUpsertTaskByFingerprint(
  client: HasnaStorageClient,
  input: Record<string, unknown> & { fingerprint: string; title: string },
): Promise<CloudUpsertTaskResult> {
  const raw = await requiredRemoteRoute(client, "/v1/tasks/upsert", () =>
    client.transport.post<unknown>("/tasks/upsert", input));
  const envelope = (raw ?? {}) as { task?: unknown; created?: boolean };
  return {
    task: unwrapTask(envelope.task ?? raw),
    created: Boolean(envelope.created),
  };
}

/**
 * Count tasks matching a filter. The `/v1/tasks` list response now returns a
 * SQL-side `total` (full match count, independent of limit/offset), so we ask for
 * a single row and read `total` instead of pulling the whole result set into the
 * client (which previously loaded every matching task over HTTP just to count).
 */
export async function cloudCountTasks(client: HasnaStorageClient, filter: TaskFilter = {}): Promise<number> {
  const { limit: _drop, offset: _o, ...rest } = filter;
  if (rest.tags?.length) await requireTagsFilterCapability(client);
  const res = await requiredRemoteRoute(client, "/v1/tasks", () =>
    client.list<Task>("tasks", { query: { ...toListQuery(rest), limit: 1 } }));
  const envelope = res.raw as { total?: number; count?: number; tasks?: Task[] } | undefined;
  if (typeof envelope?.total === "number") return envelope.total;
  // Fallback for older servers without `total`: list everything and count.
  const tasks = await cloudListTasks(client, rest);
  return tasks.length;
}

/**
 * Register (or renew) an agent in the shared cloud roster (`POST /v1/agents`).
 * This is the fix for the agent-identity misroute: `todos init` and the MCP
 * `register_agent` tool historically wrote the agent to LOCAL sqlite even on a
 * flipped machine, so the cloud `/v1/agents` roster never saw it. Routing through
 * here writes the agent to the shared dataset with the bearer key. A name that is
 * already actively held by another session comes back as HTTP 409, which the
 * transport throws — surfaced to the caller as a conflict error (parity with the
 * local conflict path) rather than a silent duplicate.
 */
export async function cloudRegisterAgent(client: HasnaStorageClient, input: RegisterAgentInput): Promise<Agent> {
  const raw = await client.transport.post<unknown>("/agents", input as unknown as Record<string, unknown>);
  if (raw && typeof raw === "object" && "agent" in (raw as Record<string, unknown>)) {
    return (raw as { agent: Agent }).agent;
  }
  return raw as Agent;
}

/**
 * Refresh an agent's `last_seen_at` in the shared cloud roster
 * (`POST /v1/agents/:id/heartbeat`). Resolves by id OR name server-side. Returns
 * `null` when the agent does not exist in the cloud roster. This is the fix for
 * the heartbeat misroute: the CLI/MCP used to read LOCAL sqlite and 404 a
 * cloud-only agent ("Agent not found") on a flipped machine.
 */
export async function cloudHeartbeatAgent(client: HasnaStorageClient, idOrName: string): Promise<Agent | null> {
  const raw = await client.transport.post<unknown>(`/agents/${encodeURIComponent(idOrName)}/heartbeat`, {});
  if (raw && typeof raw === "object" && "agent" in (raw as Record<string, unknown>)) {
    return (raw as { agent: Agent }).agent;
  }
  return (raw as Agent) ?? null;
}

/** Result of a cloud agent release (`POST /v1/agents/:id/release`). */
export interface CloudReleaseResult {
  agent: Agent | null;
  released: boolean;
}

/**
 * Release/logout an agent in the shared cloud roster (`POST /v1/agents/:id/release`).
 * Clears the agent's session binding so the name is immediately available. When
 * `sessionId` is provided the server only releases on a match (else HTTP 409,
 * surfaced as a thrown error by the transport).
 */
export async function cloudReleaseAgent(
  client: HasnaStorageClient,
  idOrName: string,
  sessionId?: string,
): Promise<CloudReleaseResult> {
  const raw = await client.transport.post<unknown>(
    `/agents/${encodeURIComponent(idOrName)}/release`,
    sessionId ? { session_id: sessionId } : {},
  );
  const env = (raw ?? {}) as { agent?: Agent; released?: boolean };
  return { agent: env.agent ?? null, released: env.released !== false };
}

/** A git commit link stored in the cloud. */
export interface CloudTaskCommit {
  id: string;
  task_id: string;
  sha: string;
  message: string | null;
  author: string | null;
  files_changed: string[] | null;
  created_at: string;
}

/**
 * Link a git commit to a cloud task (`POST /v1/tasks/:id/commits`). The previous
 * local path wrote the row to this machine's sqlite where the cloud task does not
 * exist, tripping a FOREIGN KEY constraint; routing to the shared store attaches
 * it to the real task.
 */
export async function cloudLinkCommit(
  client: HasnaStorageClient,
  taskId: string,
  input: { sha: string; message?: string; author?: string; files_changed?: string[] },
): Promise<CloudTaskCommit> {
  const raw = await client.transport.post<unknown>(`/tasks/${encodeURIComponent(taskId)}/commits`, input);
  if (raw && typeof raw === "object" && "commit" in (raw as Record<string, unknown>)) {
    return (raw as { commit: CloudTaskCommit }).commit;
  }
  return raw as CloudTaskCommit;
}

/** Find the task that explains a commit SHA (`GET /v1/commits/:sha`); `null` if none. */
export async function cloudFindCommit(client: HasnaStorageClient, sha: string): Promise<CloudTaskCommit | null> {
  const raw = await client.transport.get<unknown>(`/commits/${encodeURIComponent(sha)}`);
  const env = (raw ?? {}) as { commit?: CloudTaskCommit | null };
  return env.commit ?? null;
}

/** A git branch/PR ref link stored in the cloud. */
export interface CloudTaskGitRef {
  id: string;
  task_id: string;
  ref_type: "branch" | "pull_request";
  name: string;
  url: string | null;
  provider: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function parseCloudTaskGitRef(value: unknown, route: string): CloudTaskGitRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned a non-object git ref; local SQLite fallback is disabled`,
    );
  }
  const ref = value as Record<string, unknown>;
  const requiredStrings = ["id", "task_id", "name", "created_at", "updated_at"] as const;
  if (requiredStrings.some((field) => typeof ref[field] !== "string" || !(ref[field] as string).trim())) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned an incomplete git ref identity; local SQLite fallback is disabled`,
    );
  }
  if (ref["ref_type"] !== "branch" && ref["ref_type"] !== "pull_request") {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned an invalid git ref type; local SQLite fallback is disabled`,
    );
  }
  for (const field of ["url", "provider"] as const) {
    if (ref[field] !== null && typeof ref[field] !== "string") {
      throw new Error(
        `REMOTE_API_INCOMPATIBLE: ${route} returned an invalid git ref ${field}; local SQLite fallback is disabled`,
      );
    }
  }
  if (!ref["metadata"] || typeof ref["metadata"] !== "object" || Array.isArray(ref["metadata"])) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned invalid git ref metadata; local SQLite fallback is disabled`,
    );
  }
  return ref as unknown as CloudTaskGitRef;
}

function parseCloudTaskGitRefEnvelope(raw: unknown, route: string): CloudTaskGitRef[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned a non-object git ref envelope; local SQLite fallback is disabled`,
    );
  }
  const envelope = raw as Record<string, unknown>;
  if (!Array.isArray(envelope["refs"]) ||
      !Number.isSafeInteger(envelope["count"]) ||
      envelope["count"] !== envelope["refs"].length) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned an incomplete git ref envelope; local SQLite fallback is disabled`,
    );
  }
  return envelope["refs"].map((ref) => parseCloudTaskGitRef(ref, route));
}

function openApiHasOperation(
  document: unknown,
  path: string,
  method: "get" | "post",
): boolean {
  if (!document || typeof document !== "object" || Array.isArray(document)) return false;
  const paths = (document as Record<string, unknown>)["paths"];
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) return false;
  const route = (paths as Record<string, unknown>)[path];
  return Boolean(route && typeof route === "object" && !Array.isArray(route) &&
    (route as Record<string, unknown>)[method] &&
    typeof (route as Record<string, unknown>)[method] === "object");
}

async function fetchTodosRemoteCommandCapabilities(
  client: HasnaStorageClient,
): Promise<ReadonlySet<TodosRemoteCommandCapability>> {
  const document = await requiredRemoteRoute(client, "/v1/openapi.json", () =>
    client.transport.get<unknown>("/openapi.json"));
  const supported = new Set<TodosRemoteCommandCapability>();
  if (openApiHasOperation(document, "/v1/tasks/{id}/stale-lock-handoff", "post")) {
    supported.add("stale-lock-handoff");
  }
  return supported;
}

/**
 * Commands whose remote executability depends on the deployed authority
 * version. The result is cached per authority, never per credential.
 */
export async function getTodosRemoteCommandCapabilities(
  client: HasnaStorageClient,
): Promise<ReadonlySet<TodosRemoteCommandCapability>> {
  const authority = remoteAuthorityBase(client);
  let capabilities = remoteCommandCapabilityCache.get(authority);
  if (!capabilities) {
    capabilities = fetchTodosRemoteCommandCapabilities(client);
    remoteCommandCapabilityCache.set(authority, capabilities);
  }
  return capabilities;
}

async function requireStaleLockHandoffCapability(
  client: HasnaStorageClient,
): Promise<void> {
  const authority = remoteAuthorityBase(client);
  const capabilities = await getTodosRemoteCommandCapabilities(client);
  if (!capabilities.has("stale-lock-handoff")) {
    throw new Error(
      `REMOTE_STALE_LOCK_HANDOFF_UNSUPPORTED: configured Todos authority ${authority} does not advertise ` +
        "POST /v1/tasks/{id}/stale-lock-handoff; no lock mutation was sent; deploy a compatible " +
        "@hasna/todos /v1 server before retrying; local SQLite fallback is disabled",
    );
  }
}

async function fetchGitRefCapabilities(client: HasnaStorageClient): Promise<ReadonlySet<RemoteGitRefCapability>> {
  const document = await requiredRemoteRoute(client, "/v1/openapi.json", () =>
    client.transport.get<unknown>("/openapi.json"));
  const supported = new Set<RemoteGitRefCapability>();
  if (openApiHasOperation(document, "/v1/tasks/{id}/refs", "get")) supported.add("task-read");
  if (openApiHasOperation(document, "/v1/tasks/{id}/refs", "post")) supported.add("task-write");
  if (openApiHasOperation(document, "/v1/refs/{ref}", "get")) supported.add("reverse-read");
  return supported;
}

async function requireGitRefCapabilities(
  client: HasnaStorageClient,
  required: readonly RemoteGitRefCapability[],
): Promise<void> {
  const authority = remoteAuthorityBase(client);
  let capabilities = gitRefCapabilityCache.get(authority);
  if (!capabilities) {
    capabilities = fetchGitRefCapabilities(client);
    gitRefCapabilityCache.set(authority, capabilities);
  }
  const supported = await capabilities;
  const missing = required.filter((capability) => !supported.has(capability));
  if (missing.length > 0) {
    throw new Error(
      `REMOTE_GIT_REF_UNSUPPORTED: configured Todos authority ${authority} does not advertise the complete git-ref ` +
        `contract (${missing.join(", ")} missing); deploy the current @hasna/todos /v1 server before retrying; ` +
        "no ref mutation or local SQLite fallback was attempted",
    );
  }
}

function sameCloudTaskGitRef(
  ref: CloudTaskGitRef,
  expected: Pick<CloudTaskGitRef, "id" | "task_id" | "ref_type" | "name">,
): boolean {
  return ref.id === expected.id &&
    ref.task_id === expected.task_id &&
    ref.ref_type === expected.ref_type &&
    ref.name === expected.name;
}

/** List git refs linked to one cloud task (`GET /v1/tasks/:id/refs`). */
export async function cloudListTaskRefs(
  client: HasnaStorageClient,
  taskId: string,
): Promise<CloudTaskGitRef[]> {
  await requireGitRefCapabilities(client, ["task-read"]);
  const route = `/v1/tasks/${encodeURIComponent(taskId)}/refs`;
  const raw = await requiredRemoteRoute(client, route, () =>
    client.transport.get<unknown>(`/tasks/${encodeURIComponent(taskId)}/refs`));
  return parseCloudTaskGitRefEnvelope(raw, route);
}

/**
 * Link a git branch or pull request to a cloud task (`POST /v1/tasks/:id/refs`).
 *
 * A successful POST body is not authoritative proof: the command only returns
 * after both the task-scoped and reverse-lookup reads return the exact created
 * row. This prevents a mixed-version or non-persisting authority from producing
 * a green `Linked ...` line for data no caller can read back.
 */
export async function cloudLinkRef(
  client: HasnaStorageClient,
  taskId: string,
  input: { ref_type: "branch" | "pull_request"; name: string; url?: string; provider?: string; metadata?: Record<string, unknown> },
): Promise<CloudTaskGitRef> {
  await requireGitRefCapabilities(client, ["task-read", "task-write", "reverse-read"]);
  const route = `/v1/tasks/${encodeURIComponent(taskId)}/refs`;
  const raw = await requiredRemoteRoute(client, route, () =>
    client.transport.post<unknown>(`/tasks/${encodeURIComponent(taskId)}/refs`, input));
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      Object.keys(raw).length !== 1 || !("ref" in raw)) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned a non-authoritative git ref response envelope; ` +
        "local SQLite fallback is disabled",
    );
  }
  const linked = parseCloudTaskGitRef((raw as { ref: unknown }).ref, route);
  if (linked.task_id !== taskId || linked.ref_type !== input.ref_type || linked.name !== input.name) {
    throw new Error(
      `REMOTE_API_INCOMPATIBLE: ${route} returned a different git ref identity; local SQLite fallback is disabled`,
    );
  }
  const [taskRefs, reverseRefs] = await Promise.all([
    cloudListTaskRefs(client, taskId),
    cloudFindRefs(client, input.name),
  ]);
  if (!taskRefs.some((ref) => sameCloudTaskGitRef(ref, linked)) ||
      !reverseRefs.some((ref) => sameCloudTaskGitRef(ref, linked))) {
    throw new Error(
      `REMOTE_REF_PERSISTENCE_UNVERIFIED: configured Todos authority ${remoteAuthorityBase(client)} accepted ${route} ` +
        "but authoritative task and reverse readback did not return the linked ref; no success line or local SQLite " +
        "fallback is permitted",
    );
  }
  return linked;
}

/** Find every task linked to a branch/PR ref by name (`GET /v1/refs/:ref`). */
export async function cloudFindRefs(client: HasnaStorageClient, ref: string): Promise<CloudTaskGitRef[]> {
  await requireGitRefCapabilities(client, ["reverse-read"]);
  const route = `/v1/refs/${encodeURIComponent(ref)}`;
  const raw = await requiredRemoteRoute(client, route, () =>
    client.transport.get<unknown>(`/refs/${encodeURIComponent(ref)}`));
  return parseCloudTaskGitRefEnvelope(raw, route);
}

/**
 * Fetch one plan by id (`GET /v1/plans/:id`); `null` on 404. Also resolves a
 * partial id / slug / name by first checking `/v1/plans` — the `plans --show`
 * path historically resolved the ref against LOCAL sqlite (which does not carry
 * cloud plans), so it could not open a plan its own cloud `plans` list returned.
 */
export async function cloudResolvePlan(client: HasnaStorageClient, ref: string, projectId?: string): Promise<Plan | null> {
  const normalizedRef = ref.toLowerCase();
  if (UUID_RE.test(ref)) {
    const direct = await client.get<unknown>("plans", normalizedRef);
    if (direct) {
      const plan = unwrapPlan(direct);
      if (!projectId || plan.project_id === projectId) return plan;
    }
  }
  const plans = await cloudListPlans(client, projectId);
  const matchGroups = [
    plans.filter((plan) => plan.id.toLowerCase() === normalizedRef),
    plans.filter((plan) => plan.slug === ref),
    plans.filter((plan) => plan.name === ref),
    plans.filter((plan) => plan.id.toLowerCase().startsWith(normalizedRef)),
  ];
  for (const matches of matchGroups) {
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) throw new Error(`Plan reference is ambiguous: "${ref}"`);
  }
  return null;
}

/** Result of a cloud lock/unlock action (mirrors the local `LockResult` shape). */
export interface CloudLockResult {
  success: boolean;
  locked_by?: string;
  locked_at?: string;
  expires_at?: string;
  error?: string;
}

/**
 * Acquire an exclusive lock on a cloud task (`POST /v1/tasks/:id/lock`). Locking is
 * a task-field operation (`locked_by`/`locked_at`) resolved server-side against the
 * shared dataset so a flipped machine coordinates on the SAME lock as every other
 * agent — the previous local-sqlite lookup 404'd cloud tasks ("Task not found").
 */
export async function cloudLockTask(client: HasnaStorageClient, id: string, agentId: string): Promise<CloudLockResult> {
  const raw = await client.transport.post<unknown>(`/tasks/${encodeURIComponent(id)}/lock`, { agent_id: agentId });
  if (raw && typeof raw === "object" && "result" in (raw as Record<string, unknown>)) {
    return (raw as { result: CloudLockResult }).result;
  }
  return (raw ?? { success: true }) as CloudLockResult;
}

/** Release a lock on a cloud task (`POST /v1/tasks/:id/unlock`). */
export async function cloudUnlockTask(
  client: HasnaStorageClient,
  id: string,
  agentId?: string,
  force = false,
): Promise<boolean> {
  const raw = await client.transport.post<unknown>(
    `/tasks/${encodeURIComponent(id)}/unlock`,
    { ...(agentId ? { agent_id: agentId } : {}), ...(force ? { force: true } : {}) },
  );
  if (raw && typeof raw === "object" && "success" in (raw as Record<string, unknown>)) {
    return Boolean((raw as { success: unknown }).success);
  }
  return true;
}

/** Exact remote CAS (`POST /v1/tasks/:id/stale-lock-handoff`). */
export async function cloudHandoffStaleTaskLock(
  client: HasnaStorageClient,
  input: {
    task_id: string;
    expected_holder: string;
    expected_lock_version: string;
    stale_after_seconds: number;
    new_holder: string;
    reason: string;
  },
): Promise<StaleLockHandoffReceipt> {
  await requireStaleLockHandoffCapability(client);
  const raw = await client.transport.post<unknown>(
    `/tasks/${encodeURIComponent(input.task_id)}/stale-lock-handoff`,
    {
      expected_holder: input.expected_holder,
      expected_lock_version: input.expected_lock_version,
      stale_after_seconds: input.stale_after_seconds,
      new_holder: input.new_holder,
      reason: input.reason,
    },
  );
  if (raw && typeof raw === "object" && "receipt" in (raw as Record<string, unknown>)) {
    return (raw as { receipt: StaleLockHandoffReceipt }).receipt;
  }
  throw new Error("STALE_LOCK_HANDOFF_RECEIPT_MISSING: remote response did not include receipt");
}

/**
 * A task's dependency edges from the cloud (`GET /v1/tasks/:id/dependencies`),
 * normalized to the corrected orientation: `dependencies` are the OUTGOING
 * edges (this task depends on their `depends_on`), `blocks` are the INCOMING
 * edges (their `task_id` depends on this task).
 *
 * WIRE COMPATIBILITY (regression 4599ef37): the deployed authority still sends
 * the incoming edges under the legacy field name `blocked_by` — old clients in
 * the fleet render that field as `Blocks:`, so the server payload cannot be
 * renamed out from under them. A newer server may additionally send `blocks`
 * with the same contents; this reader prefers it and falls back to the legacy
 * name.
 */
export interface CloudTaskDependencies {
  dependencies: TaskDependency[];
  blocks: TaskDependency[];
}

/** List a cloud task's dependency edges (`GET /v1/tasks/:id/dependencies`). */
export async function cloudGetDependencies(client: HasnaStorageClient, id: string): Promise<CloudTaskDependencies> {
  const raw = await client.transport.get<unknown>(`/tasks/${encodeURIComponent(id)}/dependencies`);
  const env = (raw ?? {}) as { dependencies?: TaskDependency[]; blocks?: TaskDependency[]; blocked_by?: TaskDependency[] };
  return { dependencies: env.dependencies ?? [], blocks: env.blocks ?? env.blocked_by ?? [] };
}

/**
 * A remote task's dependency neighbours, hydrated into full task rows so the
 * detail renderers can print title/status and compute the blocker warning.
 * Same orientation as the local `getTaskWithRelations` (every name means what
 * it says — regression 4599ef37):
 *   - `dependencies` are upstream (this task depends on them);
 *   - `blocked_by` is the incomplete subset of `dependencies` — what blocks
 *     this task right now;
 *   - `blocks` are downstream (they depend on this task).
 */
export interface CloudTaskRelations {
  dependencies: Task[];
  blocked_by: Task[];
  blocks: Task[];
}

/** Parallel task-row lookups used while hydrating dependency edges. */
const RELATION_HYDRATION_CONCURRENCY = 6;

/**
 * Stand-in row for a dependency edge whose target task cannot be read (deleted,
 * archived out of the caller's scope, or cross-project). Keeping the edge
 * visible — instead of dropping it — means a partially-readable graph never
 * silently erases the relations that ARE readable. `status` stays `pending`
 * (the union has no `unknown` member) so an unresolved edge is counted as an
 * unfinished blocker rather than being optimistically treated as done.
 */
function unresolvedRelatedTask(id: string): Task {
  const now = new Date(0).toISOString();
  return {
    id,
    short_id: null,
    project_id: null,
    parent_id: null,
    plan_id: null,
    task_list_id: null,
    title: `(unavailable task ${id.slice(0, 8)})`,
    description: null,
    status: "pending",
    priority: "medium",
    agent_id: null,
    assigned_to: null,
    session_id: null,
    working_dir: null,
    tags: [],
    metadata: { unresolved: true },
    version: 0,
    locked_by: null,
    locked_at: null,
    created_at: now,
    updated_at: now,
    started_at: null,
    completed_at: null,
    due_at: null,
    estimated_minutes: null,
    actual_minutes: null,
    requires_approval: false,
    approved_by: null,
    approved_at: null,
    recurrence_rule: null,
    recurrence_parent_id: null,
    spawns_template_id: null,
    confidence: null,
    reason: null,
    spawned_from_session: null,
    assigned_by: null,
    created_by: null,
    assigned_from_project: null,
    task_type: null,
    cost_tokens: 0,
    cost_usd: 0,
    delegated_from: null,
    delegation_depth: 0,
    retry_count: 0,
    max_retries: 0,
    retry_after: null,
    sla_minutes: null,
    runner_id: null,
    runner_started_at: null,
    runner_completed_at: null,
    current_step: null,
    total_steps: null,
  };
}

/**
 * Hydrate a remote task's dependency graph for the detail views.
 *
 * The `/v1` task row endpoint deliberately returns no relation graphs, so
 * `show`/`inspect` used to render `dependencies: []` / `blocked_by: []` even
 * when `deps <id>` listed persisted edges — hiding that a remote task was
 * blocked (issue #58). This reads the edges from the dependency endpoint and
 * resolves each referenced id to a task row (deduplicated across both
 * directions, bounded concurrency) so remote detail output matches local mode.
 */
export async function cloudGetTaskRelations(client: HasnaStorageClient, id: string): Promise<CloudTaskRelations> {
  const edges = await cloudGetDependencies(client, id);
  const upstream = dedupe(edges.dependencies.map((edge) => edge.depends_on));
  const downstream = dedupe(edges.blocks.map((edge) => edge.task_id));
  const wanted = dedupe([...upstream, ...downstream]).filter((ref) => ref !== id);
  const rows = new Map<string, Task>();

  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(RELATION_HYDRATION_CONCURRENCY, wanted.length) },
    async () => {
      for (let index = cursor++; index < wanted.length; index = cursor++) {
        const ref = wanted[index]!;
        try {
          const task = await cloudGetTask(client, ref);
          if (task) rows.set(ref, task);
        } catch {
          // A single unreadable neighbour must not fail the whole detail view;
          // it degrades to the unresolved placeholder below.
        }
      }
    },
  );
  await Promise.all(workers);

  const materialize = (ref: string): Task => rows.get(ref) ?? unresolvedRelatedTask(ref);
  const dependencies = upstream.map(materialize);
  // An unresolved prerequisite keeps status "pending" (see
  // unresolvedRelatedTask), so it counts as blocking rather than being
  // optimistically treated as done.
  const blocked_by = dependencies.filter((dep) => isBlockingDependencyStatus(dep.status));
  return { dependencies, blocked_by, blocks: downstream.map(materialize) };
}

function dedupe(ids: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

/** Add a dependency edge to a cloud task (`POST /v1/tasks/:id/dependencies`). */
export async function cloudAddDependency(client: HasnaStorageClient, id: string, dependsOn: string): Promise<TaskDependency> {
  const raw = await client.transport.post<unknown>(`/tasks/${encodeURIComponent(id)}/dependencies`, { depends_on: dependsOn });
  if (raw && typeof raw === "object" && "dependency" in (raw as Record<string, unknown>)) {
    return (raw as { dependency: TaskDependency }).dependency;
  }
  return raw as TaskDependency;
}

/** Remove a dependency edge from a cloud task (`DELETE /v1/tasks/:id/dependencies/:dep`). */
export async function cloudRemoveDependency(client: HasnaStorageClient, id: string, dependsOn: string): Promise<boolean> {
  const raw = await client.transport.del<unknown>(
    `/tasks/${encodeURIComponent(id)}/dependencies/${encodeURIComponent(dependsOn)}`,
  );
  if (raw && typeof raw === "object" && "removed" in (raw as Record<string, unknown>)) {
    return Boolean((raw as { removed: unknown }).removed);
  }
  return true;
}

/** A verification record returned by the cloud. */
export interface CloudTaskVerification {
  id: string;
  task_id: string;
  command: string;
  status: "passed" | "failed" | "unknown";
  output_summary: string | null;
  artifact_path: string | null;
  agent_id: string | null;
  run_at: string;
  created_at: string;
}

/**
 * Record a verification command + result against a cloud task
 * (`POST /v1/tasks/:id/verifications`). The previous local path wrote the row to
 * this machine's sqlite where the cloud task does not exist, tripping a FOREIGN
 * KEY constraint; routing to the shared store attaches it to the real task.
 */
export async function cloudRecordVerification(
  client: HasnaStorageClient,
  id: string,
  input: { command: string; status?: string; output_summary?: string; artifact_path?: string; agent_id?: string },
): Promise<CloudTaskVerification> {
  const raw = await client.transport.post<unknown>(`/tasks/${encodeURIComponent(id)}/verifications`, input);
  if (raw && typeof raw === "object" && "verification" in (raw as Record<string, unknown>)) {
    return (raw as { verification: CloudTaskVerification }).verification;
  }
  return raw as CloudTaskVerification;
}

// ───────────────────────────────────────────────────────────────────────────
// Read/analytics routing (B2 continued)
//
// The query/reporting commands (`active`, `stale`, `overdue`, `sla`, `sprint`,
// `blocked`, `ready`, `next`, `priorities`, `week`, `today`, `yesterday`,
// `summary`, `report`, `recap`, `standup`, `log`, `burndown`, `lists`, `agent`,
// `mine`) historically read this machine's LOCAL sqlite even on a flipped
// machine, so an http-routed box reported its private island instead of the
// shared cloud dataset. The helpers below re-derive each of those views from the
// cloud `/v1` API so a flipped machine reports the SAME numbers as every other
// agent. Analytics that the local `db/*` helpers compute in SQL are recomputed
// client-side over the cloud task set (parity with the local full-scan
// behaviour); the few that need data the task list does not carry (activity
// history, task lists, dependency edges, the priority-ranked "next" pick) route
// to dedicated `/v1` endpoints.
// ───────────────────────────────────────────────────────────────────────────

/** All non-terminal tasks (pending + in_progress) — the "active" working set. */
export async function cloudActiveTasks(client: HasnaStorageClient, filter: TaskFilter = {}): Promise<Task[]> {
  const [pending, inProgress] = await Promise.all([
    cloudListTasks(client, { ...filter, status: "pending" as never }),
    cloudListTasks(client, { ...filter, status: "in_progress" as never }),
  ]);
  return [...pending, ...inProgress];
}

/** In-progress tasks, priority- then recency-sorted (parity with `getActiveWork`). */
export async function cloudActiveWork(client: HasnaStorageClient, filter: TaskFilter = {}): Promise<Task[]> {
  const tasks = await cloudListTasks(client, { ...filter, status: "in_progress" as never });
  return tasks.sort(
    (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
  );
}

/** In-progress tasks whose last update (or lock) is older than `minutes` (parity with `getStaleTasks`). */
export async function cloudStaleTasks(client: HasnaStorageClient, minutes: number, filter: TaskFilter = {}): Promise<Task[]> {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const tasks = await cloudListTasks(client, { ...filter, status: "in_progress" as never });
  return tasks
    .filter((t) => (t.updated_at ?? "") < cutoff || (t.locked_at != null && t.locked_at < cutoff))
    .sort((a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? ""));
}

/** Non-terminal tasks past their due date (parity with `getOverdueTasks`). */
export async function cloudOverdueTasks(client: HasnaStorageClient, projectId?: string, at: Date = new Date()): Promise<Task[]> {
  const nowStr = at.toISOString();
  const filter: TaskFilter = projectId ? ({ project_id: projectId } as TaskFilter) : {};
  const active = await cloudActiveTasks(client, filter);
  return active
    .filter((t) => !t.archived_at && t.due_at != null && t.due_at < nowStr)
    .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
}

export interface CloudEscalatedTask {
  task: Task;
  reasons: Array<"overdue" | "sla_breached">;
  breached_at: string;
}

/** Overdue or SLA-breached non-terminal tasks (parity with `getEscalatedTasks`). */
export async function cloudEscalatedTasks(
  client: HasnaStorageClient,
  opts: { project_id?: string; agent_id?: string } = {},
  at: Date = new Date(),
): Promise<CloudEscalatedTask[]> {
  const nowMs = at.getTime();
  const filter: TaskFilter = {};
  if (opts.project_id) (filter as TaskFilter).project_id = opts.project_id;
  // Alias-resolved (task 84c77210) — pushed into the server-side `filter`
  // rather than compared client-side against the raw `assigned_to` value.
  // The server (Postgres adapter, fixed in PR #160) already resolves
  // `assigned_to` to every alias form; a client-side `t.assigned_to ===
  // opts.agent_id` here would silently re-narrow to one form after the
  // server had already done the alias-widening.
  if (opts.agent_id) (filter as TaskFilter).assigned_to = opts.agent_id;
  const active = await cloudActiveTasks(client, filter);
  return active
    .filter((t) => !t.archived_at)
    .map((task) => {
      const reasons: CloudEscalatedTask["reasons"] = [];
      const breachedTimes: number[] = [];
      if (task.due_at) {
        const dueMs = new Date(task.due_at).getTime();
        if (Number.isFinite(dueMs) && dueMs < nowMs) {
          reasons.push("overdue");
          breachedTimes.push(dueMs);
        }
      }
      if (task.sla_minutes != null) {
        const startMs = new Date(task.started_at ?? task.created_at).getTime();
        const breachedMs = startMs + task.sla_minutes * 60_000;
        if (Number.isFinite(breachedMs) && breachedMs < nowMs) {
          reasons.push("sla_breached");
          breachedTimes.push(breachedMs);
        }
      }
      if (reasons.length === 0) return null;
      return { task, reasons, breached_at: new Date(Math.min(...breachedTimes)).toISOString() } satisfies CloudEscalatedTask;
    })
    .filter((item): item is CloudEscalatedTask => item !== null)
    .sort((a, b) => (a.task.due_at ?? "").localeCompare(b.task.due_at ?? "") || a.task.created_at.localeCompare(b.task.created_at));
}

/** Tasks updated since `since` (parity with `getTasksChangedSince`). */
export async function cloudChangedSince(client: HasnaStorageClient, since: string, filter: TaskFilter = {}): Promise<Task[]> {
  const tasks = await cloudListTasks(client, filter);
  return tasks
    .filter((t) => changedSinceStampNewer(t.updated_at ?? "", since))
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
}

export interface CloudTaskStats {
  total: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  completion_rate: number;
  by_agent: Record<string, number>;
}

/** Task counts grouped by status/priority/agent (parity with `getTaskStats`). */
export async function cloudTaskStats(client: HasnaStorageClient, filter: TaskFilter = {}): Promise<CloudTaskStats> {
  const tasks = await cloudListTasks(client, filter);
  const by_status: Record<string, number> = {};
  const by_priority: Record<string, number> = {};
  const by_agent: Record<string, number> = {};
  for (const t of tasks) {
    by_status[t.status] = (by_status[t.status] ?? 0) + 1;
    by_priority[t.priority] = (by_priority[t.priority] ?? 0) + 1;
    const agent = t.assigned_to ?? t.agent_id ?? "unassigned";
    by_agent[agent] = (by_agent[agent] ?? 0) + 1;
  }
  const completed = by_status["completed"] ?? 0;
  return {
    total: tasks.length,
    by_status,
    by_priority,
    by_agent,
    completion_rate: tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0,
  };
}

/**
 * Recent task-history entries (`GET /v1/activity`). Powers `log` and `burndown`.
 * Requires the `/v1/activity` server route (ECS redeploy).
 */
export async function cloudRecentActivity(client: HasnaStorageClient, limit = 50): Promise<TaskHistory[]> {
  const raw = await client.transport.get<unknown>("/activity", { query: { limit } });
  const envelope = (raw ?? {}) as { activity?: TaskHistory[]; entries?: TaskHistory[] };
  if (Array.isArray(envelope.activity)) return envelope.activity;
  if (Array.isArray(envelope.entries)) return envelope.entries;
  return Array.isArray(raw) ? (raw as TaskHistory[]) : [];
}

/**
 * Task lists (`GET /v1/task-lists`). Powers `lists`. Requires the
 * `/v1/task-lists` server route (ECS redeploy).
 */
export async function cloudListTaskLists(client: HasnaStorageClient, projectId?: string): Promise<TaskList[]> {
  const query = projectId ? { project_id: projectId } : {};
  const raw = await requiredRemoteRoute(client, "/v1/task-lists", () =>
    client.transport.get<unknown>("/task-lists", { query }));
  const envelope = (raw ?? {}) as { task_lists?: TaskList[]; taskLists?: TaskList[] };
  if (Array.isArray(envelope.task_lists)) return envelope.task_lists;
  if (Array.isArray(envelope.taskLists)) return envelope.taskLists;
  return Array.isArray(raw) ? (raw as TaskList[]) : [];
}

function unwrapTaskList(raw: unknown): TaskList {
  if (raw && typeof raw === "object" && "task_list" in (raw as Record<string, unknown>)) {
    return (raw as { task_list: TaskList }).task_list;
  }
  return raw as TaskList;
}

export async function cloudGetTaskList(client: HasnaStorageClient, id: string): Promise<TaskList | null> {
  const raw = await client.get<unknown>("task-lists", id);
  return raw == null ? null : unwrapTaskList(raw);
}

function resolveTaskListFromCandidates(lists: TaskList[], input: string): TaskList | null {
  const normalizedIdRef = input.toLowerCase();
  const matchGroups = [
    lists.filter((list) => list.id.toLowerCase() === normalizedIdRef),
    lists.filter((list) => list.slug === input),
    lists.filter((list) => list.id.toLowerCase().startsWith(normalizedIdRef)),
  ];
  for (const matches of matchGroups) {
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new Error(`Task list reference is ambiguous: "${input}"`);
    }
  }
  return null;
}

async function legacyProjectTaskLists(
  client: HasnaStorageClient,
  projectId: string,
): Promise<TaskList[]> {
  const project = await cloudGetProjectById(client, projectId);
  if (!project?.task_list_id) return [];
  return (await cloudListTaskLists(client)).filter(
    (list) => list.project_id == null && list.slug === project.task_list_id,
  );
}

/**
 * Resolve a cloud task-list UUID, unique UUID prefix, or project-scoped slug
 * without discarding its owning project. Exact-list reads use that project as
 * a compatibility bound when an older authority ignores task_list_id.
 */
export async function cloudResolveTaskList(
  client: HasnaStorageClient,
  ref: string,
  projectId?: string,
): Promise<TaskList> {
  const input = ref.trim();
  const normalizedIdRef = input.toLowerCase();
  if (UUID_RE.test(input)) {
    const direct = await cloudGetTaskList(client, normalizedIdRef);
    if (direct?.id?.toLowerCase() === normalizedIdRef) {
      if (!projectId || direct.project_id === projectId) return direct;
      if (direct.project_id == null) {
        const project = await cloudGetProjectById(client, projectId);
        if (project?.task_list_id === direct.slug) return direct;
      }
      throw new Error(`Task list not found: "${input}"`);
    }
  }

  const scopedMatch = resolveTaskListFromCandidates(
    await cloudListTaskLists(client, projectId),
    input,
  );
  if (scopedMatch && (!projectId || scopedMatch.project_id === projectId)) {
    return scopedMatch;
  }

  // Legacy projects can own a globally stored task-list row: the canonical link
  // is `project.task_list_id === task_list.slug` while the row itself carries
  // `project_id: null`. A project-filtered list hides that row before UUID/slug
  // matching, which made `lists --show <uuid>` succeed while add/update --list
  // rejected the same resolvable list. Follow only that explicit canonical link;
  // never treat an arbitrary global list as belonging to every project.
  if (projectId) {
    const legacyMatch = resolveTaskListFromCandidates(
      await legacyProjectTaskLists(client, projectId),
      input,
    );
    if (legacyMatch) return legacyMatch;
  }

  throw new Error(`Task list not found: "${input}"`);
}

/** Resolve only the canonical task-list UUID for create/update callers. */
export async function cloudResolveTaskListRef(
  client: HasnaStorageClient,
  ref: string,
  projectId?: string,
): Promise<string> {
  const input = ref.trim();
  // Preserve the no-read fast path for callers that only need an already
  // canonical unscoped UUID. Exact-list reads call cloudResolveTaskList above
  // because they also need the owning project compatibility scope.
  if (UUID_RE.test(input) && !projectId) return input.toLowerCase();
  return (await cloudResolveTaskList(client, ref, projectId)).id;
}

/** Create a task list in the cloud (`POST /v1/task-lists`). */
export async function cloudCreateTaskList(
  client: HasnaStorageClient,
  input: CreateTaskListInput,
): Promise<TaskList> {
  return unwrapTaskList(await requiredRemoteRoute(client, "/v1/task-lists", () =>
    client.transport.post<unknown>("/task-lists", input as unknown as Record<string, unknown>)));
}

/**
 * Resolve a task-list reference for `lists --update` (hasna/apps#260).
 *
 * An EXPLICIT `--project` on `--update` is a REBIND: the source list may live
 * outside the destination project. The resolution order matters for both
 * directions:
 *
 * - UUID sources are globally unambiguous, so they resolve unscoped directly —
 *   the destination scope can neither shadow nor reject them.
 * - Slug sources resolve scoped-first within the destination (base behaviour:
 *   slugs are unique inside a project, so an in-scope update with `--project`
 *   context resolves to the right list even when another project shares the
 *   slug). Only a CONFIRMED scoped miss ("Task list not found") falls back to
 *   unscoped, so an unbound or other-scope source can still be rebound.
 *
 * Transport, authorization, and ambiguity errors propagate — a scoped HTTP
 * 500 or 401 must never fall back to unscoped, where it could resolve a
 * different project's list and mutate the wrong target.
 */
export async function cloudResolveTaskListForUpdate(
  client: HasnaStorageClient,
  ref: string,
  projectId: string | undefined,
  explicitProject: boolean,
): Promise<string> {
  if (!explicitProject) return cloudResolveTaskListRef(client, ref, projectId ?? undefined);
  const trimmed = ref.trim();
  if (UUID_RE.test(trimmed.toLowerCase())) {
    return cloudResolveTaskListRef(client, ref, undefined);
  }
  try {
    return await cloudResolveTaskListRef(client, ref, projectId ?? undefined);
  } catch (error) {
    if (error instanceof Error && /^Task list not found: /.test(error.message)) {
      return cloudResolveTaskListRef(client, ref, undefined);
    }
    throw error;
  }
}

/** Update one cloud task list by exact UUID (`PATCH /v1/task-lists/:id`). */
export async function cloudUpdateTaskList(
  client: HasnaStorageClient,
  id: string,
  patch: UpdateTaskListInput,
): Promise<TaskList> {
  return unwrapTaskList(await client.update<unknown>("task-lists", id, patch as unknown as Record<string, unknown>));
}

/** Rename a cloud project through the server's atomic cascade operation. */
export async function cloudRenameProject(
  client: HasnaStorageClient,
  ref: string,
  newSlug: string,
  name?: string,
): Promise<{ project: Project; task_lists_updated: number }> {
  return requiredRemoteRoute(
    client,
    "/v1/projects/:id/rename",
    async () => {
      const id = await cloudResolveProjectRef(client, ref);
      const normalizedSlug = cloudProjectSlug(newSlug);
      if (!normalizedSlug) throw new Error("Invalid slug — must be non-empty kebab-case");
      return client.transport.post<{ project: Project; task_lists_updated: number }>(
        `/projects/${encodeURIComponent(id)}/rename`,
        { new_slug: normalizedSlug, ...(name !== undefined ? { name } : {}) },
      );
    },
  );
}

/** Delete a task list in the cloud (`DELETE /v1/task-lists/:id`). */
export async function cloudDeleteTaskList(client: HasnaStorageClient, id: string): Promise<boolean> {
  try {
    await client.transport.del(`/task-lists/${encodeURIComponent(id)}`);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && (error as { status?: unknown }).status === 404) return false;
    throw error;
  }
}

/**
 * The single best pending task to work on next (`GET /v1/next`) — the server
 * applies the same agent-affinity + priority ranking + blocked-exclusion as the
 * local `getNextTask`. Powers `next`. Requires the `/v1/next` route (ECS redeploy).
 */
export async function cloudNextTask(
  client: HasnaStorageClient,
  agent?: string,
  filters?: { project_id?: string; task_list_id?: string; plan_id?: string },
): Promise<Task | null> {
  const query: Record<string, string> = {};
  if (agent) query["agent"] = agent;
  if (filters?.project_id) query["project_id"] = filters.project_id;
  if (filters?.task_list_id) query["task_list_id"] = filters.task_list_id;
  if (filters?.plan_id) query["plan_id"] = filters.plan_id;
  const raw = await requiredRemoteRoute(client, "/v1/next", () =>
    client.transport.get<unknown>("/next", { query }));
  if (raw == null) return null;
  const task = unwrapTask(raw);
  return task && (task as Task).id ? task : null;
}

/** Atomically claim the shared queue's next task (`POST /v1/tasks/next/claim`). */
export async function cloudClaimNext(client: HasnaStorageClient, agentId: string): Promise<Task | null> {
  const raw = await requiredRemoteRoute(client, "/v1/tasks/next/claim", () =>
    client.transport.post<unknown>("/tasks/next/claim", { agent_id: agentId }));
  if (raw == null) return null;
  const task = unwrapTask(raw);
  return task && (task as Task).id ? task : null;
}

/**
 * Every dependency edge in the shared dataset (`GET /v1/dependencies`). Edges are
 * far fewer than tasks, so this stays cheap even on the full cloud set. Powers the
 * blocked/ready/sprint/recap dependency analytics. Requires the `/v1/dependencies`
 * route (ECS redeploy).
 */
export async function cloudAllDependencies(client: HasnaStorageClient): Promise<TaskDependency[]> {
  const raw = await client.transport.get<unknown>("/dependencies");
  const envelope = (raw ?? {}) as { dependencies?: TaskDependency[] };
  if (Array.isArray(envelope.dependencies)) return envelope.dependencies;
  return Array.isArray(raw) ? (raw as TaskDependency[]) : [];
}

/** Fetch a set of tasks by id via bounded parallel `GET /v1/tasks/:id`. */
export async function cloudGetTasksByIds(client: HasnaStorageClient, ids: readonly string[]): Promise<Map<string, Task>> {
  const unique = Array.from(new Set(ids));
  const map = new Map<string, Task>();
  const CONCURRENCY = 8;
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const batch = unique.slice(i, i + CONCURRENCY);
    const tasks = await Promise.all(batch.map((id) => cloudGetTask(client, id)));
    for (const task of tasks) if (task && task.id) map.set(task.id, task);
  }
  return map;
}

/**
 * For each candidate task, its incomplete blocking dependencies (parity with
 * `getBlockingDeps`): the tasks it depends on whose status is not `completed`.
 */
export async function cloudBlockingDepsMap(
  client: HasnaStorageClient,
  candidates: readonly Task[],
): Promise<Map<string, Task[]>> {
  const result = new Map<string, Task[]>();
  if (candidates.length === 0) return result;
  const edges = await cloudAllDependencies(client);
  const dependsByTask = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edge.task_id || !edge.depends_on) continue;
    const arr = dependsByTask.get(edge.task_id) ?? [];
    arr.push(edge.depends_on);
    dependsByTask.set(edge.task_id, arr);
  }
  const candidateIds = new Set(candidates.map((t) => t.id));
  const blockerIds = new Set<string>();
  for (const id of candidateIds) for (const dep of dependsByTask.get(id) ?? []) blockerIds.add(dep);
  const blockers = await cloudGetTasksByIds(client, Array.from(blockerIds));
  for (const task of candidates) {
    const deps = dependsByTask.get(task.id) ?? [];
    const incomplete = deps
      .map((depId) => blockers.get(depId))
      .filter((b): b is Task => b != null && b.status !== "completed");
    if (incomplete.length > 0) result.set(task.id, incomplete);
  }
  return result;
}

export interface CloudRecapSummary {
  hours: number;
  since: string;
  completed: Array<Task & { duration_minutes: number | null }>;
  created: Task[];
  in_progress: Task[];
  blocked: Task[];
  stale: Task[];
  agents: { name: string; completed_count: number; in_progress_count: number; last_seen_at: string }[];
}

/**
 * The `recap`/`standup` summary computed over the shared cloud dataset (parity
 * with `getRecap`): completed/created in the window, current in-progress, blocked
 * (incomplete deps), stale, and per-agent activity. Uses `/v1/dependencies` for
 * the blocked set and `/v1/agents` for the roster.
 */
export async function cloudRecap(client: HasnaStorageClient, hours: number, projectId?: string): Promise<CloudRecapSummary> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const staleWindow = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const filter: TaskFilter = projectId ? ({ project_id: projectId } as TaskFilter) : {};
  const [all, agents] = await Promise.all([cloudListTasks(client, filter), cloudListAgents(client)]);

  const completed = all
    .filter((t) => t.status === "completed" && t.completed_at != null && t.completed_at > since)
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
    .map((t) => ({
      ...t,
      duration_minutes:
        t.started_at && t.completed_at
          ? Math.round((new Date(t.completed_at).getTime() - new Date(t.started_at).getTime()) / 60000)
          : null,
    }));
  const created = all.filter((t) => t.created_at > since).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const in_progress = all
    .filter((t) => t.status === "in_progress")
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  const stale = in_progress
    .filter((t) => (t.updated_at ?? "") < staleWindow)
    .sort((a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? ""));

  const pending = all.filter((t) => t.status === "pending");
  const blockedMap = await cloudBlockingDepsMap(client, pending);
  const blocked = pending.filter((t) => blockedMap.has(t.id));

  const sinceMs = new Date(since).getTime();
  const agentSummaries = agents
    .map((agent) => {
      // Alias-resolved (task 84c77210): `assigned_to` holds an agent id from
      // one write path and a resolved name from another — see database.ts
      // for the root cause. No server round-trip is needed here: `agent`
      // already carries both `id` and `name` from the same `agents` fetch,
      // so match `t.assigned_to` against either, case-insensitively.
      const assignedName = agent.name?.toLowerCase();
      const owned = all.filter((t) => {
        const assignedTo = t.assigned_to?.toLowerCase();
        return assignedTo === agent.id.toLowerCase() || (assignedName && assignedTo === assignedName) || t.agent_id === agent.id;
      });
      return {
        name: agent.name,
        completed_count: owned.filter((t) => t.status === "completed" && t.completed_at != null && t.completed_at > since).length,
        in_progress_count: owned.filter((t) => t.status === "in_progress").length,
        last_seen_at: agent.last_seen_at,
      };
    })
    .filter((a) => a.last_seen_at != null && new Date(a.last_seen_at).getTime() > sinceMs)
    .sort((a, b) => b.completed_count - a.completed_count);

  return { hours, since, completed, created, in_progress, blocked, stale, agents: agentSummaries };
}

export interface CloudTimelineEntry {
  id: string;
  source: string;
  event_type: string;
  entity_type: "task";
  entity_id: string;
  task_id: string;
  project_id: string | null;
  plan_id: string | null;
  run_id: string | null;
  agent_id: string | null;
  created_at: string;
  title: string;
  message: string | null;
  metadata: Record<string, unknown>;
}

export interface CloudTimelinePage {
  entries: CloudTimelineEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface CloudTimelineOptions {
  entity_type?: "task" | "run" | "project" | "plan";
  entity_id?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
}

/**
 * A cloud activity timeline built from the shared task-history ledger
 * (`GET /v1/activity`). The shared cloud dataset only carries task history (not the
 * local run-ledger / project / plan sources), so `entity_type` filters other than
 * `task` return no rows — a documented degradation from the richer local timeline.
 */
export async function cloudTimeline(client: HasnaStorageClient, options: CloudTimelineOptions = {}): Promise<CloudTimelinePage> {
  const activity = await cloudRecentActivity(client, 5000);
  let entries: CloudTimelineEntry[] = activity.map((h) => ({
    id: h.id,
    source: "task_history",
    event_type: h.action,
    entity_type: "task" as const,
    entity_id: h.task_id,
    task_id: h.task_id,
    project_id: null,
    plan_id: null,
    run_id: null,
    agent_id: h.agent_id ?? null,
    created_at: h.created_at,
    title: "",
    message: h.field
      ? `${h.field}: ${h.old_value ?? ""}${h.new_value != null ? ` -> ${h.new_value}` : ""}`.trim()
      : null,
    metadata: {},
  }));
  if (options.entity_type && options.entity_type !== "task") {
    entries = [];
  } else if (options.entity_type === "task" && options.entity_id) {
    entries = entries.filter((e) => e.task_id === options.entity_id);
  }
  if (options.since) entries = entries.filter((e) => e.created_at >= options.since!);
  if (options.until) entries = entries.filter((e) => e.created_at <= options.until!);
  entries.sort((a, b) => (options.order === "asc" ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
  const total = entries.length;
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 50;
  return { entries: entries.slice(offset, offset + limit), total, limit, offset };
}
