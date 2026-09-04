/**
 * ./sdk — the client surface of @hasna/messages.
 *
 * One transport resolver, two connections: the server HTTP API selected by
 * HASNA_MESSAGES_API_URL (+ HASNA_MESSAGES_API_KEY), or the on-box local
 * store (a local SQLite file) — reachable ONLY through the explicit opt-in
 * HASNA_MESSAGES_LOCAL=1. A missing API URL is never a silent local-data
 * selection: the resolver fails closed with an error naming the required
 * env. The client never opens Postgres directly — the server (messages-serve)
 * owns the SQLite/PostgreSQL backend.
 *
 * messages-serve supports a trusted localhost mode with no API key
 * configured; the client therefore sends the key when one is present and the
 * server is the authority on whether one is required. The key is never
 * logged, returned, or embedded in errors.
 */
import type {
  Agent,
  DeliveredMessage,
  Message,
  MessageDeliveryReport,
  SendResult,
  Thread,
  ThreadSummary,
} from "../types";
import { MessagesService, threadKeyFor, newThreadId } from "../service";
import { SqliteMessagesStore } from "../server/sqlite-store";

export const MESSAGES_API_URL_ENV = "HASNA_MESSAGES_API_URL";
export const MESSAGES_API_KEY_ENV = "HASNA_MESSAGES_API_KEY";
export const MESSAGES_DATABASE_URL_ENV = "HASNA_MESSAGES_DATABASE_URL";
export const MESSAGES_SQLITE_PATH_ENV = "HASNA_MESSAGES_SQLITE_PATH";

/**
 * Explicit local-mode opt-in. The client surfaces NEVER default to the on-box
 * SQLite store when the fleet API env is missing; HASNA_MESSAGES_LOCAL=1 is
 * the only way to select local mode. Value `1`/`true`/`yes` opts in; `0`,
 * `false`, `no`, `off` and blank are all treated as absent.
 */
export const MESSAGES_LOCAL_MODE_ENV = "HASNA_MESSAGES_LOCAL";

export const MESSAGES_CLIENT_TRANSPORTS = ["http", "local"] as const;
export type MessagesClientTransport = (typeof MESSAGES_CLIENT_TRANSPORTS)[number];

export function isPresent(env: Record<string, string | undefined>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(env, key) && (env[key] ?? "").trim().length > 0;
}

/** True when the explicit local-mode opt-in env is set to a truthy value. */
export function isLocalModeOptIn(env: Record<string, string | undefined>): boolean {
  const raw = env[MESSAGES_LOCAL_MODE_ENV];
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  return !(value === "" || value === "0" || value === "false" || value === "no" || value === "off");
}

/** The fail-closed error: actionable, names the required env and the opt-in. */
export function messagesTransportMisconfiguredError(): Error {
  return new Error(
    `${MESSAGES_API_URL_ENV} is not set; refusing to fall back to a local store. ` +
      `Set ${MESSAGES_API_URL_ENV} (and ${MESSAGES_API_KEY_ENV}) to reach the messages fleet API, ` +
      `or set ${MESSAGES_LOCAL_MODE_ENV}=1 to explicitly run in local SQLite mode.`,
  );
}

export interface MessagesClientTransportReport {
  transport: MessagesClientTransport;
  apiUrlPresent: boolean;
  apiKeyPresent: boolean;
}

/**
 * Resolve the client connection. `HASNA_MESSAGES_API_URL` present -> HTTP;
 * absent but `HASNA_MESSAGES_LOCAL=1` (explicit opt-in) -> local store;
 * absent both -> THROWS: a missing URL never silently selects local data.
 * The key is optional because messages-serve supports a trusted localhost
 * no-key mode; when the server requires a key it returns 401.
 */
export function resolveMessagesClientTransport(env: Record<string, string | undefined> = process.env): MessagesClientTransportReport {
  const apiUrlPresent = isPresent(env, MESSAGES_API_URL_ENV);
  const apiKeyPresent = isPresent(env, MESSAGES_API_KEY_ENV);
  if (apiUrlPresent) {
    return { transport: "http", apiUrlPresent, apiKeyPresent };
  }
  if (isLocalModeOptIn(env)) {
    return { transport: "local", apiUrlPresent: false, apiKeyPresent };
  }
  throw messagesTransportMisconfiguredError();
}

export interface MessagesClientOptions {
  /** Base URL of messages-serve, e.g. https://messages.example.com */
  baseUrl: string;
  /** API key, sent as the `x-api-key` header. Optional for local-only servers. */
  apiKey?: string;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
}

export class MessagesClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MessagesClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      throw new Error(data.error ?? `messages API ${res.status}`);
    }
    return data;
  }

  // --- identity ---
  registerAgent(name: string, displayName?: string): Promise<{ agent: Agent }> {
    return this.request("POST", "/v1/auth/register", { name, display_name: displayName ?? null });
  }

  listAgents(): Promise<{ agents: Agent[] }> {
    return this.request("GET", "/v1/agents");
  }

  // --- messaging ---
  send(from: string, to: string, content: string, replyTo?: string): Promise<SendResult> {
    return this.request<SendResult>("POST", "/v1/messages", {
      from,
      to,
      content,
      reply_to: replyTo ?? null,
    });
  }

  /** Drain the agent's inbox: transitions stored -> delivered and returns them. */
  receive(agent: string): Promise<{ messages: DeliveredMessage[] }> {
    return this.request("GET", `/v1/messages/receive?agent=${encodeURIComponent(agent)}`);
  }

  /** Per-message per-recipient delivery state for a thread. */
  deliveryStatus(threadId: string): Promise<{ deliveries: MessageDeliveryReport[] }> {
    return this.request("GET", `/v1/messages/delivery?thread=${encodeURIComponent(threadId)}`);
  }

  // --- threads ---
  threads(agent: string, openOnly = true): Promise<{ threads: ThreadSummary[] }> {
    const q = openOnly ? "" : "&open_only=0";
    return this.request("GET", `/v1/threads?agent=${encodeURIComponent(agent)}${q}`);
  }

  thread(threadId: string, agent: string): Promise<{ thread: Thread; messages: Array<{ message: Message; delivery: unknown }>; unread_count: number }> {
    return this.request("GET", `/v1/threads/${encodeURIComponent(threadId)}?agent=${encodeURIComponent(agent)}`);
  }

  threadMessages(threadId: string, limit?: number): Promise<{ messages: Message[] }> {
    const q = limit ? `?limit=${limit}` : "";
    return this.request("GET", `/v1/threads/${encodeURIComponent(threadId)}/messages${q}`);
  }

  threadUnread(threadId: string, agent: string): Promise<{ unread_count: number }> {
    return this.request("GET", `/v1/threads/${encodeURIComponent(threadId)}/unread?agent=${encodeURIComponent(agent)}`);
  }

  closeThread(threadId: string, agent: string): Promise<{ thread: Thread }> {
    return this.request("POST", `/v1/threads/${encodeURIComponent(threadId)}/close`, { agent });
  }

  reopenThread(threadId: string, agent: string): Promise<{ thread: Thread }> {
    return this.request("POST", `/v1/threads/${encodeURIComponent(threadId)}/reopen`, { agent });
  }

  unread(agent: string): Promise<{ threads: ThreadSummary[]; total: number }> {
    return this.request("GET", `/v1/unread?agent=${encodeURIComponent(agent)}`);
  }

  markRead(threadId: string, agent: string): Promise<{ ok: true }> {
    return this.request("POST", `/v1/threads/${encodeURIComponent(threadId)}/read`, { agent });
  }

  markMessageRead(messageId: string, agent: string): Promise<{ ok: true }> {
    return this.request("POST", `/v1/messages/${encodeURIComponent(messageId)}/read`, { agent });
  }
}

/** Create a MessagesClient from the environment (HASNA_MESSAGES_API_URL). */
export function createMessagesClient(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): MessagesClient | null {
  const report = resolveMessagesClientTransport(env);
  if (report.transport !== "http") return null;
  const apiUrl = env[MESSAGES_API_URL_ENV]!.trim();
  const apiKey = report.apiKeyPresent ? env[MESSAGES_API_KEY_ENV]!.trim() : undefined;
  return new MessagesClient({ baseUrl: apiUrl, apiKey, fetch: fetchImpl });
}

/**
 * Resolve the client store from the environment. `http` returns the HTTP
 * client; `local` returns a local MessagesService over a local SQLite store
 * (the on-box backend) — selected only by the explicit HASNA_MESSAGES_LOCAL=1
 * opt-in, never by a missing API URL. Callers dispatch on `transport`.
 */
export function resolveMessagesClientStore(
  env: Record<string, string | undefined> = process.env,
): { transport: "http"; client: MessagesClient } | { transport: "local"; service: MessagesService } {
  const report = resolveMessagesClientTransport(env);
  if (report.transport === "http") {
    return { transport: "http", client: createMessagesClient(env)! };
  }
  const sqlitePath = env[MESSAGES_SQLITE_PATH_ENV];
  return { transport: "local", service: new MessagesService(new SqliteMessagesStore(sqlitePath)) };
}

export {
  MessagesService,
  threadKeyFor,
  newThreadId,
  SqliteMessagesStore,
};
export type { MessagesStore } from "../service";
