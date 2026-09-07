/**
 * ./sdk — the client surface of @hasna/messages.
 *
 * ONE transport resolver, the shared @hasna/contracts client chain
 * (hasna/apps#1720): CLI, MCP server and ./sdk all resolve their credential
 * and their authority through it, per request, fresh. A key rotation heals a
 * long-lived process without a rebuild; the on-box SQLite store is reachable
 * ONLY under the explicit `HASNA_MESSAGES_LOCAL=1` opt-in, never by a missing
 * credential — see ./resolve.ts for the five tiers and the fail-closed rule.
 *
 * The server (messages-serve) owns the SQLite/PostgreSQL backend; the client
 * never opens Postgres directly.
 *
 * messages-serve supports a trusted localhost mode with no API key
 * configured; a client therefore sends the key when one was resolved and the
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
import {
  MESSAGES_API_KEY_ENV,
  MESSAGES_API_URL_ENV,
  MESSAGES_DATABASE_URL_ENV,
  MESSAGES_SQLITE_PATH_ENV,
  resolveMessagesClientTransport,
  resolveMessagesCredential,
  stripV1FromApiUrl,
} from "./resolve.js";
import { toV1BaseUrl } from "@hasna/contracts/client";
import type {
  MessagesClientEnv,
  MessagesClientResolveOptions,
  MessagesCredentialProvider,
  MessagesKeychainTierOptions,
  MessagesResolvedCredential,
} from "./client-types.js";

export {
  MESSAGES_API_URL_ENV_KEYS,
  MESSAGES_API_KEY_ENV_KEYS,
  MESSAGES_API_URL_ENV,
  MESSAGES_API_KEY_ENV,
  MESSAGES_DATABASE_URL_ENV,
  MESSAGES_SQLITE_PATH_ENV,
  MESSAGES_DEFAULT_API_URL,
  MESSAGES_LOCAL_OPT_IN_ENV_KEYS,
  isMessagesLocalOptIn,
  hasMessagesEnvAuthorityIntent,
  selectsMessagesLocalStore,
  resolveMessagesClientTransport,
  resolveMessagesCredential,
  messagesAuthorityEnvKeys,
  messagesResolverEnv,
  messagesResolverInputs,
  messagesUnconfiguredError,
  messagesLocalModeNotice,
  resetMessagesLocalModeNotice,
} from "./resolve.js";
export type {
  MessagesClientEnv,
  MessagesClientResolveOptions,
  MessagesClientTransport,
  MessagesClientTransportReport,
  MessagesCredentialProvider,
  MessagesCredentialTier,
  MessagesKeychainCommandResult,
  MessagesKeychainCommandRunner,
  MessagesKeychainTierOptions,
  MessagesResolvedCredential,
} from "./client-types.js";

/** The route prefix every messages-serve route lives under. */
export const MESSAGES_API_VERSION_PREFIX = "/v1";

/**
 * Resolve a configured base URL to the authority-plus-path root the client
 * appends `/v1/...` to, and to the canonical `/v1` root that status surfaces
 * print (hasna/apps#1588).
 *
 * The OLD in-package implementation is gone: this is the shared
 * `@hasna/contracts` normaliser (`toV1BaseUrl`), the same one every hosted
 * Hasna client uses. It preserves the path prefix, refuses userinfo, query
 * and fragment data, and restricts plain HTTP to exact loopback authorities.
 */
export function resolveMessagesApiBase(rawBaseUrl: string): { baseUrl: string; apiUrl: string } {
  const apiUrl = toV1BaseUrl(rawBaseUrl);
  return { baseUrl: stripV1FromApiUrl(apiUrl), apiUrl };
}

export interface MessagesClientOptions {
  /** Base URL of messages-serve, e.g. https://messages.example.com */
  baseUrl: string;
  /**
   * API key, sent as the `x-api-key` header.
   *
   * Prefer a {@link MessagesCredentialProvider} for a long-lived client: the
   * client calls it fresh for every request, so a key rotation heals without
   * a rebuild. A plain string is a deliberate pin and is never re-resolved.
   * Omitted means NO key is ever attached — the constructor never consults
   * the machine's ambient credential stores.
   */
  apiKey?: string | MessagesCredentialProvider;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
}

export class MessagesClient {
  private readonly baseUrl: string;
  private readonly resolvedApiUrl: string;
  private readonly apiKey?: string | MessagesCredentialProvider;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MessagesClientOptions) {
    const resolved = resolveMessagesApiBase(options.baseUrl);
    this.baseUrl = resolved.baseUrl;
    this.resolvedApiUrl = resolved.apiUrl;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
  }

  /**
   * The resolved `/v1` authority this client talks to — the value status and
   * whoami surfaces print (hasna/apps#1588). Never a bare origin, never the
   * raw configured base.
   */
  get apiUrl(): string {
    return this.resolvedApiUrl;
  }

  /** The key this client would send RIGHT NOW, re-resolved per call. Never logged. */
  private currentApiKey(): string | null {
    if (this.apiKey === undefined) return null;
    if (typeof this.apiKey === "string") return this.apiKey;
    const resolved = this.apiKey();
    return resolved.apiKey;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const apiKey = this.currentApiKey();
    if (apiKey) headers["x-api-key"] = apiKey;
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

export interface MessagesClientFromEnvOverrides {
  /** Tier 1: an explicit authority pin. No ambient credential is attached without `apiKey`. */
  baseUrl?: string;
  /** Tier 1: an explicit credential pin. Never re-resolved. */
  apiKey?: string;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Tier 3: Keychain controls — a fake `security` runner in tests, an opt-out on CI. */
  keychain?: MessagesKeychainTierOptions;
}

/**
 * Build a MessagesClient from the environment through the shared
 * @hasna/contracts resolver.
 *
 * The credential is resolved fresh on EVERY request (a per-request provider),
 * so a long-lived client picks up a rotation without a rebuild. The authority
 * is fixed for the life of the client: a credential written for one authority
 * is never sent to another.
 *
 * An explicit `baseUrl` pins the authority, and with it the credential
 * (#1794): without an explicit `apiKey` the ambient chain is NEVER consulted,
 * so a client pointed at a caller-chosen authority attaches no fleet key.
 *
 * THROWS when hosted configuration fails to resolve a credential. Returns
 * null ONLY when the explicit local opt-in (HASNA_MESSAGES_LOCAL=1) selects
 * the on-box store and nothing configures a hosted authority.
 */
export function createMessagesClient(
  env: MessagesClientEnv = process.env,
  overrides: MessagesClientFromEnvOverrides = {},
): MessagesClient | null {
  const resolveOptions: MessagesClientResolveOptions = {
    ...(overrides.baseUrl !== undefined ? { baseUrl: overrides.baseUrl } : {}),
    ...(overrides.apiKey !== undefined ? { apiKey: overrides.apiKey } : {}),
    ...(overrides.keychain ? { credentials: { keychain: overrides.keychain } } : {}),
  };
  const report = resolveMessagesClientTransport(env, resolveOptions);
  if (report.transport === "local") return null;
  const baseUrl = stripV1FromApiUrl(report.baseUrl!);

  // An explicit apiKey is a deliberate pin and is never re-resolved.
  if (overrides.apiKey !== undefined) {
    return new MessagesClient({ baseUrl, apiKey: overrides.apiKey, fetch: overrides.fetch });
  }
  // A pinned authority with no pinned key: NO ambient credential applies
  // (#1794). The chain is never consulted for the credential again.
  if (overrides.baseUrl !== undefined) {
    return new MessagesClient({ baseUrl, fetch: overrides.fetch });
  }

  // Otherwise the chain resolved a credential (the transport report throws
  // when none exists) and the client re-resolves it on EVERY request, so a
  // rotation heals mid-flight. A transient re-resolution failure keeps the
  // constructed credential rather than breaking a working client.
  const constructed = resolveMessagesCredential(env, resolveOptions);
  const provider = (): MessagesResolvedCredential => {
    const fresh = resolveMessagesCredential(env, resolveOptions) ?? constructed;
    if (!fresh) {
      throw new Error(
        "messages: the hosted transport resolved, but no credential value could be resolved for this request.",
      );
    }
    return fresh;
  };
  return new MessagesClient({ baseUrl, apiKey: provider, fetch: overrides.fetch });
}

/**
 * Resolve the client store from the environment. `http` returns the HTTP
 * client; `local` returns a local MessagesService over a local SQLite store
 * (the on-box backend) — selected ONLY by the explicit HASNA_MESSAGES_LOCAL=1
 * opt-in, never by a missing API URL, and announced once on stderr. Callers
 * dispatch on `transport`; any other outcome throws.
 */
export function resolveMessagesClientStore(
  env: MessagesClientEnv = process.env,
  overrides: MessagesClientFromEnvOverrides = {},
): { transport: "http"; client: MessagesClient } | { transport: "local"; service: MessagesService } {
  const resolveOptions: MessagesClientResolveOptions = {
    ...(overrides.baseUrl !== undefined ? { baseUrl: overrides.baseUrl } : {}),
    ...(overrides.apiKey !== undefined ? { apiKey: overrides.apiKey } : {}),
    ...(overrides.keychain ? { credentials: { keychain: overrides.keychain } } : {}),
  };
  const report = resolveMessagesClientTransport(env, resolveOptions);
  if (report.transport === "local") {
    const sqlitePath = env[MESSAGES_SQLITE_PATH_ENV];
    return { transport: "local", service: new MessagesService(new SqliteMessagesStore(sqlitePath)) };
  }
  const client = createMessagesClient(env, overrides);
  if (!client) throw new Error("HTTP transport resolved but no client could be created");
  return { transport: "http", client };
}

export {
  MessagesService,
  threadKeyFor,
  newThreadId,
  SqliteMessagesStore,
};
export type { MessagesStore } from "../service";