// ── ApiStore: the HTTP API transport ─────────────────────────────────────────
//
// Implements {@link ConversationsStore} against the app's own `/v1` HTTP API with
// a bearer key. This is the single HTTP client code; only the URL/key differ
// (server-side tenancy). Every method here is a network
// call — there is NO local sqlite fallback (that was the split-brain bug). When a
// server endpoint is missing the call surfaces as a `HasnaHttpError`, never a
// silent local write.
//
// SAFETY: the bearer key lives only inside the transport; it is never logged,
// returned, or embedded in any value produced here.

import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import { randomUUID } from "crypto";
import type { ConversationsStore } from "./index.js";
import { normalizeChannelName } from "../channel-names.js";
import { loggableUrl } from "../loggable-url.js";
import { AGENT_LIST_ORDER, CHANNEL_LIST_ORDER, SEARCH_RECENT_ORDER, describeMessageOrder } from "../list-order.js";
import { normalizeExactIsoTimestamp, normalizeSince } from "../since.js";
import { resolveReadLimit, resolveReadWindow } from "../message-window.js";
import { parseProject } from "../projects.js";
import { assertNoSensitiveContent, attachSendRedaction } from "../content-safety.js";
import { normalizeEmoji } from "../reactions.js";
import { normalizeMessageUuid } from "../message-reference.js";
import { encodeAttachmentUploads, prepareAttachmentSources } from "../attachments.js";
import {
  AttachmentRetrievalError,
  attachmentNotFoundError,
  attachmentPermissionError,
  decodeAttachmentResponse,
  messageNotFoundError,
} from "../attachment-retrieval.js";
import {
  parseMessage,
  compactMessage,
  DEFAULT_SEARCH_LIMIT,
  resolveDigestMaxBytes,
  resolveDigestLimit,
  resolveDigestCursor,
  assembleDigest,
  type DigestNorm,
} from "../messages.js";
import {
  COLLECTION_DEFAULT_LIMIT,
  COLLECTION_MAX_TIMEOUT_MS,
  COLLECTION_MAX_MAX_BYTES,
  resolveCollectionLimit,
  resolveCollectionMaxBytes,
  resolveCollectionOffset,
  resolveCollectionPreviewBytes,
  resolveCollectionTimeoutMs,
  previewAsCompatibilityMessage,
} from "../message-previews.js";
import {
  resolveExportFormat,
  resolveIso8601Date,
  resolveAnalyticsLimit,
  resolvePresentString,
} from "../strict-query-values.js";
import type {
  ChannelNotificationPage,
  IncidentProjectionRecord,
  MessagePreview,
  MessagePreviewPage,
} from "../../types.js";

/**
 * The row ceiling the hosted `/messages` route clamps every read to.
 *
 * Mirrors `clampLimit(..., max = 500)` in `src/server/api.ts`. It lives here as
 * a named constant because the client must recognise the clamp to report it:
 * the server answers a `limit=3000` request with 500 rows and, on a server
 * older than the additive `has_more` field, says nothing about having done so.
 */
export const SERVER_SEARCH_MAX_ROWS = 500;

type Q = Record<string, string | number | boolean | undefined | null>;

function prune(q: Q): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

function strictOptionalString(value: unknown, name: string): string | undefined {
  return resolvePresentString(value, name);
}

function strictOptionalChannel(value: unknown, name: string): string | undefined {
  const normalized = resolvePresentString(value, name);
  return normalized === undefined ? undefined : normalizeChannelName(normalized);
}

function strictOptionalSince(value: unknown, name: string): string | undefined {
  const raw = resolvePresentString(value, name);
  return raw === undefined ? undefined : normalizeSince(raw);
}

/**
 * Case-insensitive compare of two identity strings, where BLANK NEVER MATCHES.
 *
 * The empty-vs-empty case is the one that matters: a plain `l === r` returns
 * true for two absent values, so a guard built on it would pass on nothing at
 * all rather than on a match. Every use below is an accept test, so an
 * unknown identity must fail it.
 */
function sameIdentity(a: unknown, b: unknown): boolean {
  const l = typeof a === "string" ? a.trim().toLowerCase() : "";
  const r = typeof b === "string" ? b.trim().toLowerCase() : "";
  if (!l || !r) return false;
  return l === r;
}

/**
 * Is `returned` the row this very `sendMessage` call submitted?
 *
 * Compares the routing identity the CALLER supplied — sender, recipient and
 * channel — because that is precisely what separates our row from the hazard
 * the caller-bound UUID exists to catch: a mention-notification DM fanned out
 * by the same write, which is addressed to a DIFFERENT agent and carries no
 * channel.
 *
 * It deliberately does NOT compare content. The server may legitimately store
 * a redacted body, and `attachSendRedaction` is the surface that reports that
 * divergence to the author; re-deriving it here would reject a correct write
 * for the wrong reason. (`describeSendRedaction` cannot help either — it
 * reports that two bodies DIFFER, not that the difference is a redaction, so
 * using it as an accept test would accept any difference at all.)
 *
 * STATE THE LIMIT, because this is an accept path: it proves the returned row
 * is addressed exactly as requested and carries a usable id. It does NOT prove
 * the row is not some other message with identical routing. That residual is
 * accepted only where the alternative is failing 100% of successful writes on
 * a server that cannot be asked — a certain, universal false failure traded
 * for a narrow ambiguity, and only after the authoritative UUID read-back has
 * already been tried and found unanswerable.
 */
function echoesSubmittedWrite(
  opts: { from?: string; to?: string; channel?: string | null },
  returned: { id?: unknown; from_agent?: unknown; to_agent?: unknown; channel?: unknown },
): boolean {
  // Without a usable id there is nothing to report, so there is nothing to accept.
  const id = Number(returned.id);
  if (!Number.isFinite(id) || id <= 0) return false;

  if (!sameIdentity(returned.from_agent, opts.from)) return false;

  const wantChannel = opts.channel ? normalizeChannelName(opts.channel) : "";
  const gotChannel = typeof returned.channel === "string" && returned.channel
    ? normalizeChannelName(returned.channel)
    : "";
  if (wantChannel !== gotChannel) return false;

  if (wantChannel) {
    // CHANNEL POST. The server OWNS the recipient field here and rewrites it to
    // the channel, whatever the caller passed. Measured on the deployed server:
    //     sent     to="silvanus" channel="scratch-d8f3f963"
    //     returned to_agent="scratch-d8f3f963"
    // and the CLI's own channel path passes `to: to || from`, i.e. the SENDER.
    // So insisting on `to_agent === opts.to` would reject every correct channel
    // send — which is exactly what an earlier revision of this function did,
    // caught only by running the real CLI against the real server rather than
    // by the unit fixture, which had been written with to == channel and so
    // could not fail. The channel plus the sender IS the identity here, and the
    // mention-notification DM this guard exists to reject carries NO channel,
    // so the channel comparison above already separates it.
    return sameIdentity(returned.to_agent, gotChannel) || sameIdentity(returned.to_agent, opts.to);
  }

  // DIRECT MESSAGE. No channel to discriminate on, so the recipient is the
  // discriminator — and it is precisely what tells our row apart from a
  // notification DM addressed to a mentioned third party.
  return sameIdentity(returned.to_agent, opts.to);
}

/** Duck-typed HasnaHttpError status check (class identity differs across bundles). */
function isHttpStatus(error: unknown, status: number): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { name?: string }).name === "HasnaHttpError" &&
      (error as { status?: number }).status === status,
  );
}

export class ApiStore implements ConversationsStore {
  readonly transport = "cloud-http" as const;
  constructor(private readonly client: HasnaStorageClient) {}

  /**
   * The ordering this client ASKS the server for, which is what a caller must
   * disclose. Note the divergence from LocalStore on `search`: the `/messages`
   * search path offers no relevance ranking, so this transport requests
   * `created_at DESC` and says so rather than repeating LocalStore's
   * "relevance". A CLI footer that hardcoded either one would be true on one
   * transport and a lie on the other, which is why the descriptor is asked of
   * the store.
   */
  describeListOrder: ConversationsStore["describeListOrder"] = (kind, opts) => {
    switch (kind) {
      case "messages": return describeMessageOrder(opts?.order);
      case "search": return SEARCH_RECENT_ORDER;
      case "channels": return CHANNEL_LIST_ORDER;
      case "agents": return AGENT_LIST_ORDER;
    }
  };

  private get t() {
    return this.client.transport;
  }

  private async get<T>(path: string, query?: Q): Promise<T> {
    return this.t.get<T>(path, query ? { query: prune(query) } : undefined);
  }
  private async getBounded<T>(path: string, query: Q, timeoutMs: number): Promise<T> {
    return this.t.get<T>(path, { query: prune(query), timeoutMs, retry: false });
  }
  private async post<T>(path: string, body?: unknown, query?: Q): Promise<T> {
    return this.t.post<T>(path, body, query ? { query: prune(query) } : undefined);
  }
  private async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.t.patch<T>(path, body);
  }
  private async del(path: string, query?: Q): Promise<void> {
    await this.t.del(path, undefined, query ? { query: prune(query) } : undefined);
  }
  private projectChannelRegistrationBody(
    request: Parameters<ConversationsStore["registerProjectChannel"]>[0],
  ): Record<string, unknown> {
    const { target, ...serializable } = request;
    return {
      ...serializable,
      // The owned path never crosses the HTTP boundary. Its digest is enough
      // to bind the caller's request context without exposing a filesystem
      // location to the service or receipt.
      target_digest: target.digest,
    };
  }

  // ── health ──────────────────────────────────────────────────────────────────
  // Hosted-API probe for `doctor`: an authenticated, cheap count round-trips the
  // /v1 API so a flipped client verifies reachability AND that its bearer key
  // works. The bearer key never leaves the transport.
  //
  // `baseUrl` IS NOT SAFE TO PRINT and this comment used to claim it was. It is
  // produced by `toV1BaseUrl`, which clears `search` and `hash` and re-emits
  // everything else — a strip-list — so it turns
  // `https://user:pw@host` into `https://user:pw@host/v1`, measured. `doctor`
  // therefore printed embedded basic-auth credentials to stdout on both the OK
  // and the failure path. `loggableUrl` is an allow-list and cannot carry a
  // component it did not copy.
  health: ConversationsStore["health"] = async () => {
    const where = loggableUrl(this.client.baseUrl) ?? "the configured API";
    try {
      await this.get<{ count?: number }>("/messages", { count: 1, limit: 1 });
      return [{ name: "Cloud API", ok: true, message: `OK — reachable at ${where}` }];
    } catch (e) {
      return [{ name: "Cloud API", ok: false, message: `Unreachable/unauthorized at ${where}: ${(e as Error).message}` }];
    }
  };

  // ── channels ────────────────────────────────────────────────────────────────
  createChannel: ConversationsStore["createChannel"] = async (name, createdBy, options) => {
    const body = await this.post<{ channel: unknown }>("/channels", { name, created_by: createdBy, ...(options ?? {}) });
    return body.channel as never;
  };
  listChannels: ConversationsStore["listChannels"] = async (options) => {
    const body = await this.get<{ channels?: unknown[] }>("/channels", {
      project_id: options?.project_id,
      include_archived: options?.include_archived ? true : undefined,
      tag: options?.tag,
    });
    return (body.channels ?? []) as never;
  };
  getChannel: ConversationsStore["getChannel"] = async (name) => {
    try {
      const body = await this.get<{ channel: unknown } | null>(`/channels/${encodeURIComponent(normalizeChannelName(name))}`);
      return (body?.channel ?? null) as never;
    } catch (e) {
      // The server 404s a missing channel; the LocalStore contract is null.
      if (isHttpStatus(e, 404)) return null as never;
      throw e;
    }
  };
  joinChannel: ConversationsStore["joinChannel"] = async (channelName, agent) => {
    const body = await this.post<{ joined?: boolean }>(`/channels/${encodeURIComponent(normalizeChannelName(channelName))}/members`, { agent });
    return Boolean(body?.joined) as never;
  };
  leaveChannel: ConversationsStore["leaveChannel"] = async (channelName, agent) => {
    try {
      await this.del(`/channels/${encodeURIComponent(normalizeChannelName(channelName))}/members/${encodeURIComponent(agent)}`);
      return true as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return false as never;
      throw e;
    }
  };
  getChannelMembers: ConversationsStore["getChannelMembers"] = async (channelName) => {
    const body = await this.get<{ members?: unknown[] }>(`/channels/${encodeURIComponent(normalizeChannelName(channelName))}/members`);
    return (body.members ?? []) as never;
  };
  getMemberChannels: ConversationsStore["getMemberChannels"] = async (agent) => {
    const body = await this.get<{ channels?: Array<Record<string, unknown>> }>("/channels/mine", { agent });
    return (body.channels ?? []).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      description: (r.description as string) ?? null,
      unread: Number(r.unread ?? 0),
    })) as never;
  };
  updateChannel: ConversationsStore["updateChannel"] = async (name, updates) => {
    const body = await this.patch<{ channel: unknown }>(`/channels/${encodeURIComponent(normalizeChannelName(name))}`, updates);
    return body.channel as never;
  };
  renameChannel: ConversationsStore["renameChannel"] = async (oldName, newName, opts) => {
    const body: Record<string, unknown> = { name: newName };
    if (opts?.reparent) body.reparent = true;
    const res = await this.patch<{ channel: unknown }>(
      `/channels/${encodeURIComponent(normalizeChannelName(oldName))}`,
      body,
    );
    return res.channel as never;
  };
  archiveChannel: ConversationsStore["archiveChannel"] = async (name) => {
    const body = await this.post<{ channel: unknown }>(`/channels/${encodeURIComponent(normalizeChannelName(name))}/archive`);
    return body.channel as never;
  };
  unarchiveChannel: ConversationsStore["unarchiveChannel"] = async (name) => {
    const body = await this.post<{ channel: unknown }>(`/channels/${encodeURIComponent(normalizeChannelName(name))}/unarchive`);
    return body.channel as never;
  };
  planChannelMerge: ConversationsStore["planChannelMerge"] = async (options) => {
    const body = await this.post<unknown>(
      `/channels/${encodeURIComponent(normalizeChannelName(options.destination_channel))}/merge`,
      {
        source_channel: options.source_channel,
        dry_run: true,
        archive_source: options.archive_source === true,
      },
    );
    return body as never;
  };
  applyChannelMerge: ConversationsStore["applyChannelMerge"] = async (options) => {
    const body = await this.post<unknown>(
      `/channels/${encodeURIComponent(normalizeChannelName(options.destination_channel))}/merge`,
      {
        source_channel: options.source_channel,
        dry_run: false,
        archive_source: options.archive_source === true,
        expected_revision: options.expected_revision,
        idempotency_key: options.idempotency_key,
      },
    );
    return body as never;
  };
  rollbackChannelMerge: ConversationsStore["rollbackChannelMerge"] = async () => {
    throw new Error("Channel merge rollback is a local-store operation; the hosted API exposes no rollback route.");
  };
  isChannelMember: ConversationsStore["isChannelMember"] = async (channelName, agent) => {
    const body = await this.get<{ member?: boolean }>(`/channels/${encodeURIComponent(normalizeChannelName(channelName))}/members/${encodeURIComponent(agent)}`);
    return Boolean(body?.member) as never;
  };

  // ── package-owned project channel registration authority ───────────────────
  projectChannelRegistrationCapability: ConversationsStore["projectChannelRegistrationCapability"] = async () => {
    return this.get("/project-registration/channels/capability") as never;
  };
  registerProjectChannel: ConversationsStore["registerProjectChannel"] = async (request) => {
    return this.post(
      request.operation_intent === "bind_existing"
        ? "/project-registration/channels/bind-existing"
        : request.operation_intent === "adopt_existing"
          ? "/project-registration/channels/adopt-existing"
          : "/project-registration/channels",
      this.projectChannelRegistrationBody(request),
    ) as never;
  };
  listProjectChannelRegistrationPage: ConversationsStore["listProjectChannelRegistrationPage"] = async (request) => {
    return this.get("/project-registration/channels", {
      project_id: request.project_id,
      cursor: request.cursor,
      collection_revision: request.collection_revision,
      max_items: request.max_items,
      response_byte_limit: request.response_byte_limit,
      time_budget_ms: request.time_budget_ms,
      call_limit: request.call_limit ?? 1,
    }) as never;
  };
  listProjectChannelMessagePage: ConversationsStore["listProjectChannelMessagePage"] = async (request) => {
    return this.get(
      `/project-registration/channels/${encodeURIComponent(request.target_id)}/messages`,
      {
        project_id: request.project_id,
        cursor: request.cursor,
        max_items: request.max_items,
        response_byte_limit: request.response_byte_limit,
        time_budget_ms: request.time_budget_ms,
        call_limit: request.call_limit ?? 1,
      },
    ) as never;
  };
  readProjectChannelRegistrationExact: ConversationsStore["readProjectChannelRegistrationExact"] = async (request) => {
    return this.get(
      `/project-registration/channels/${encodeURIComponent(request.target_id)}`,
      {
        resource_kind: request.resource_kind,
        target_selector: request.target_selector,
        target_digest: request.target.digest,
        response_byte_limit: request.response_byte_limit,
        time_budget_ms: request.time_budget_ms,
        call_limit: request.call_limit ?? 1,
      },
    ) as never;
  };
  lookupProjectChannelRegistrationReceipt: ConversationsStore["lookupProjectChannelRegistrationReceipt"] = async (request) => {
    return this.get("/project-registration/channels/receipts/terminal", {
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: request.resource_kind,
      direction: request.direction,
      authority: request.authority,
      authority_route: request.authority_route,
      package_version: request.package_version,
      authority_id: request.authority_id,
      tenant_id: request.tenant_id,
      corpus_id: request.corpus_id,
      target_selector: request.target_selector,
      idempotency_key: request.idempotency_key,
      request_digest: request.request_digest,
      precondition_digest: request.precondition_digest,
      precondition_kind: request.precondition_kind,
      target_id: request.target_id,
      max_items: request.max_items,
      response_byte_limit: request.response_byte_limit,
      time_budget_ms: request.time_budget_ms,
      call_limit: request.call_limit ?? 1,
    }) as never;
  };
  compensateProjectChannelRegistration: ConversationsStore["compensateProjectChannelRegistration"] = async (request) => {
    return this.post(
      "/project-registration/channels/inverse",
      this.projectChannelRegistrationBody(request),
    ) as never;
  };
  verifyProjectChannelRegistrationInverse: ConversationsStore["verifyProjectChannelRegistrationInverse"] = async (request) => {
    return this.post(
      "/project-registration/channels/inverse/verify",
      this.projectChannelRegistrationBody(request),
    ) as never;
  };

  // ── channel notifications ─────────────────────────────────────────────────────
  subscribeToChannelNotifications: ConversationsStore["subscribeToChannelNotifications"] = async (channel, agent, opts) => {
    const body = await this.post<{ subscription: unknown }>("/channel-notifications", { channel: normalizeChannelName(channel), agent, ...(opts ?? {}) });
    return body.subscription as never;
  };
  unsubscribeFromChannelNotifications: ConversationsStore["unsubscribeFromChannelNotifications"] = async (channel, agent) => {
    try {
      await this.del(`/channel-notifications/${encodeURIComponent(normalizeChannelName(channel))}/${encodeURIComponent(agent)}`);
      return true as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return false as never;
      throw e;
    }
  };
  listChannelNotificationSubscriptions: ConversationsStore["listChannelNotificationSubscriptions"] = async (agent) => {
    const body = await this.get<{ subscriptions?: unknown[] }>("/channel-notifications", { agent });
    return (body.subscriptions ?? []) as never;
  };
  getSubscribedChannels: ConversationsStore["getSubscribedChannels"] = async (agent) => {
    const body = await this.get<{ channels?: string[] }>("/channel-notifications/subscribed", { agent });
    return (body.channels ?? []) as never;
  };
  readChannelNotifications: ConversationsStore["readChannelNotifications"] = async (opts) => {
    const limit = resolveCollectionLimit(opts.limit);
    const cursor = resolveCollectionOffset(opts.cursor);
    const maxBytes = resolveCollectionMaxBytes(opts.max_bytes);
    const previewBytes = resolveCollectionPreviewBytes(opts.preview_bytes);
    const timeoutMs = resolveCollectionTimeoutMs(opts.timeout_ms);
    const page = await this.getBounded<ChannelNotificationPage>("/channel-notifications/inbox", {
      agent: resolvePresentString(opts.agent, "agent")!,
      channel: strictOptionalChannel(opts.channel, "channel"),
      unread_only: opts.unread_only ? true : undefined,
      limit,
      cursor,
      max_bytes: maxBytes,
      preview_bytes: previewBytes,
      timeout_ms: timeoutMs,
      since: strictOptionalSince(opts.since, "since"),
    }, timeoutMs);
    if (opts.mark_read && page.notifications.length > 0) {
      const markedRead = await this.markChannelNotificationsRead(opts.agent, page.notifications.map((row) => row.message_id));
      return {
        ...page,
        marked_read: markedRead,
        notifications: page.notifications.map((row) => ({ ...row, unread: false })),
      } as never;
    }
    return page as never;
  };
  markChannelNotificationsRead: ConversationsStore["markChannelNotificationsRead"] = async (agent, messageIds) => {
    const body = await this.post<{ marked?: number }>("/channel-notifications/read", { agent, message_ids: messageIds });
    return Number(body?.marked ?? 0) as never;
  };
  baselineChannelNotifications: ConversationsStore["baselineChannelNotifications"] = async (agent) => {
    const body = await this.post<{ marked?: number }>("/channel-notifications/baseline", { agent });
    return Number(body?.marked ?? 0) as never;
  };
  markAllChannelNotificationsRead: ConversationsStore["markAllChannelNotificationsRead"] = async (agent, channel) => {
    const body = await this.post<{ marked?: number }>("/channel-notifications/read-all", { agent, channel: channel ? normalizeChannelName(channel) : undefined });
    return Number(body?.marked ?? 0) as never;
  };

  // ── tasks ─────────────────────────────────────────────────────────────────────
  createTask: ConversationsStore["createTask"] = async (opts) => {
    const body = await this.post<{ task: unknown }>("/tasks", opts);
    return body.task as never;
  };
  getTask: ConversationsStore["getTask"] = async (idOrUuid) => {
    const body = await this.get<{ task: unknown } | null>(`/tasks/${encodeURIComponent(String(idOrUuid))}`);
    return (body?.task ?? null) as never;
  };
  listTasks: ConversationsStore["listTasks"] = async (opts) => {
    const o = opts ?? {};
    const body = await this.get<{ tasks?: unknown[] }>("/tasks", {
      status: o.status, assignee: o.assignee, reporter: o.reporter, project_id: o.project_id,
      channel: o.channel, priority: o.priority, tag: o.tag, limit: o.limit, offset: o.offset,
      include_archived: o.include_archived ? true : undefined,
      parent_id: o.parent_id === null ? "null" : o.parent_id,
    });
    return (body.tasks ?? []) as never;
  };
  private async taskAction(id: number | string, action: string, body?: unknown): Promise<unknown> {
    const res = await this.post<{ task: unknown } | null>(`/tasks/${encodeURIComponent(String(id))}/${action}`, body);
    return res?.task ?? null;
  }
  startTask: ConversationsStore["startTask"] = async (id, agent) => (await this.taskAction(id, "start", { agent })) as never;
  completeTask: ConversationsStore["completeTask"] = async (id, agent, opts) => (await this.taskAction(id, "complete", { agent, ...(opts ?? {}) })) as never;
  cancelTask: ConversationsStore["cancelTask"] = async (id, agent, opts) => (await this.taskAction(id, "cancel", { agent, ...(opts ?? {}) })) as never;
  blockTask: ConversationsStore["blockTask"] = async (id, agent, opts) => (await this.taskAction(id, "block", { agent, ...(opts ?? {}) })) as never;
  unblockTask: ConversationsStore["unblockTask"] = async (id, agent) => (await this.taskAction(id, "unblock", { agent })) as never;
  reopenTask: ConversationsStore["reopenTask"] = async (id, agent) => (await this.taskAction(id, "reopen", { agent })) as never;
  assignTask: ConversationsStore["assignTask"] = async (id, assignee, agent) => (await this.taskAction(id, "assign", { assignee, agent })) as never;
  setTaskPriority: ConversationsStore["setTaskPriority"] = async (id, priority, agent) => (await this.taskAction(id, "priority", { priority, agent })) as never;
  addTaskComment: ConversationsStore["addTaskComment"] = async (taskId, agent, content) => {
    const body = await this.post<{ comment: unknown }>(`/tasks/${encodeURIComponent(String(taskId))}/comments`, { agent, content });
    return body.comment as never;
  };
  getTaskComments: ConversationsStore["getTaskComments"] = async (taskId) => {
    const body = await this.get<{ comments?: unknown[] }>(`/tasks/${encodeURIComponent(String(taskId))}/comments`);
    return (body.comments ?? []) as never;
  };
  getSubtasks: ConversationsStore["getSubtasks"] = async (parentId) => {
    const body = await this.get<{ tasks?: unknown[] }>(`/tasks/${encodeURIComponent(String(parentId))}/subtasks`);
    return (body.tasks ?? []) as never;
  };
  getTaskTree: ConversationsStore["getTaskTree"] = async (parentId, maxDepth) => {
    const body = await this.get<{ tree: unknown }>(`/tasks/${encodeURIComponent(String(parentId))}/tree`, { max_depth: maxDepth });
    return body.tree as never;
  };
  addDependency: ConversationsStore["addDependency"] = async (taskId, dependsOnId) => {
    await this.post(`/tasks/${encodeURIComponent(String(taskId))}/dependencies`, { depends_on: dependsOnId });
    return undefined as never;
  };
  removeDependency: ConversationsStore["removeDependency"] = async (taskId, dependsOnId) => {
    await this.del(`/tasks/${encodeURIComponent(String(taskId))}/dependencies/${encodeURIComponent(String(dependsOnId))}`);
    return undefined as never;
  };
  getDependencies: ConversationsStore["getDependencies"] = async (taskId) => {
    const body = await this.get<{ tasks?: unknown[] }>(`/tasks/${encodeURIComponent(String(taskId))}/dependencies`);
    return (body.tasks ?? []) as never;
  };
  getDependents: ConversationsStore["getDependents"] = async (taskId) => {
    const body = await this.get<{ tasks?: unknown[] }>(`/tasks/${encodeURIComponent(String(taskId))}/dependents`);
    return (body.tasks ?? []) as never;
  };
  getTaskActivity: ConversationsStore["getTaskActivity"] = async (taskId, limit) => {
    const body = await this.get<{ activity?: unknown[] }>(`/tasks/${encodeURIComponent(String(taskId))}/activity`, { limit });
    return (body.activity ?? []) as never;
  };
  deleteTask: ConversationsStore["deleteTask"] = async (id, agent) => {
    try {
      await this.del(`/tasks/${encodeURIComponent(String(id))}`, { agent });
      return true as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return false as never;
      throw e;
    }
  };
  searchTasks: ConversationsStore["searchTasks"] = async (opts) => {
    const body = await this.get<{ tasks?: unknown[] }>("/tasks/search", {
      q: opts.query, status: opts.status, assignee: opts.assignee, project_id: opts.project_id,
      channel: opts.channel, priority: opts.priority, limit: opts.limit, offset: opts.offset,
      sort: opts.sort, include_archived: opts.include_archived ? true : undefined,
    });
    return (body.tasks ?? []) as never;
  };
  getDueTasks: ConversationsStore["getDueTasks"] = async (opts) => {
    const body = await this.get<{ tasks?: unknown[] }>("/tasks/due", opts as Q);
    return (body.tasks ?? []) as never;
  };
  getTaskSummary: ConversationsStore["getTaskSummary"] = async (idOrUuid) => {
    const body = await this.get<{ summary: unknown } | null>(`/tasks/${encodeURIComponent(String(idOrUuid))}/summary`);
    return (body?.summary ?? null) as never;
  };

  // ── locks ─────────────────────────────────────────────────────────────────────
  acquireLock: ConversationsStore["acquireLock"] = async (resourceType, resourceId, agentId, lockType, expiryMs) => {
    const body = await this.post<{ acquired: boolean; lock: unknown; held_by?: string }>("/locks", {
      resource_type: resourceType, resource_id: resourceId, agent_id: agentId, lock_type: lockType, expiry_ms: expiryMs,
    });
    return body as never;
  };
  bulkAcquireLock: ConversationsStore["bulkAcquireLock"] = async (resources, agentId) => {
    const body = await this.post<unknown>("/locks/bulk", { resources, agent_id: agentId });
    return body as never;
  };
  releaseLock: ConversationsStore["releaseLock"] = async (resourceType, resourceId, agentId) => {
    const body = await this.post<{ released?: boolean }>("/locks/release", { resource_type: resourceType, resource_id: resourceId, agent_id: agentId });
    return Boolean(body?.released) as never;
  };
  checkLock: ConversationsStore["checkLock"] = async (resourceType, resourceId) => {
    const body = await this.get<{ lock: unknown }>("/locks/check", { resource_type: resourceType, resource_id: resourceId });
    return (body?.lock ?? null) as never;
  };
  cleanExpiredLocks: ConversationsStore["cleanExpiredLocks"] = async () => {
    const body = await this.post<{ cleaned?: number }>("/locks/clean");
    return Number(body?.cleaned ?? 0) as never;
  };
  releaseStaleAgentLocks: ConversationsStore["releaseStaleAgentLocks"] = async () => {
    const body = await this.post<{ released?: number }>("/locks/release-stale");
    return Number(body?.released ?? 0) as never;
  };
  tryBulkAcquireLock: ConversationsStore["tryBulkAcquireLock"] = async (resources, agentId) => {
    const body = await this.post<unknown>("/locks/bulk", { resources, agent_id: agentId, try: true });
    return body as never;
  };
  listLocks: ConversationsStore["listLocks"] = async (opts) => {
    const body = await this.get<{ locks?: unknown[] }>("/locks", { resource_type: opts?.resource_type, agent_id: opts?.agent_id });
    return (body.locks ?? []) as never;
  };
  listLocksEnriched: ConversationsStore["listLocksEnriched"] = async (opts) => {
    const body = await this.get<{ locks?: unknown[] }>("/locks", { resource_type: opts?.resource_type, agent_id: opts?.agent_id, enriched: true });
    return (body.locks ?? []) as never;
  };

  // ── presence / agents ─────────────────────────────────────────────────────────
  registerAgent: ConversationsStore["registerAgent"] = async (name, sessionId, role, projectId, force) => {
    const body = await this.post<{ result: unknown }>("/agents", { name, session_id: sessionId, role, project_id: projectId, force });
    return body.result as never;
  };
  heartbeat: ConversationsStore["heartbeat"] = async (agent, status, metadata, sessionId, projectId) => {
    const body: Record<string, unknown> = { agent };
    if (status !== undefined) body.status = status;
    if (metadata !== undefined) body.metadata = metadata;
    if (sessionId !== undefined) body.session_id = sessionId;
    if (projectId !== undefined) body.project_id = projectId;
    await this.post("/agents/heartbeat", body);
    return undefined as never;
  };
  getPresence: ConversationsStore["getPresence"] = async (agent) => {
    const body = await this.get<{ presence: unknown } | null>(`/agents/${encodeURIComponent(agent)}`);
    return (body?.presence ?? null) as never;
  };
  listAgents: ConversationsStore["listAgents"] = async (opts) => {
    const body = await this.get<{ agents?: unknown[] }>("/agents", opts as Q);
    return (body.agents ?? []) as never;
  };
  reapStaleSingleTouch: ConversationsStore["reapStaleSingleTouch"] = async (opts) => {
    const body = await this.post<{ candidates?: number; reaped?: number; archived?: number; archiveTable?: string; agents?: string[] }>("/agents/reap-stale", {
      apply: opts?.apply === true,
      older_than_seconds: opts?.olderThanSeconds,
    });
    return {
      candidates: Number(body?.candidates ?? 0),
      reaped: Number(body?.reaped ?? 0),
      archived: Number(body?.archived ?? 0),
      archiveTable: body?.archiveTable ?? "agent_presence_reap_archive",
      agents: body?.agents ?? [],
    } as never;
  };
  removePresence: ConversationsStore["removePresence"] = async (agent) => {
    try {
      await this.del(`/agents/${encodeURIComponent(agent)}`);
      return true as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return false as never;
      throw e;
    }
  };
  renameAgent: ConversationsStore["renameAgent"] = async (oldName, newName) => {
    const body = await this.patch<{ renamed?: boolean }>(`/agents/${encodeURIComponent(oldName)}`, { name: newName });
    return Boolean(body?.renamed) as never;
  };
  setPresenceProject: ConversationsStore["setPresenceProject"] = async (agent, projectId) => {
    await this.patch(`/agents/${encodeURIComponent(agent)}`, { project_id: projectId });
    return undefined as never;
  };

  // ── projects ────────────────────────────────────────────────────────────────
  // Project rows come back raw from the API (tags/metadata/settings as JSON text).
  // Normalize through the shared `parseProject` so the hosted API returns the
  // identical contract as local — `tags` is always an array, never a raw
  // string/null (that mismatch crashed `project get`). `channel_count` is
  // surfaced as ProjectInfo when the server provides it, defaulting to 0.
  private static asProject(row: unknown): Record<string, unknown> {
    return parseProject((row ?? {}) as Record<string, unknown>) as unknown as Record<string, unknown>;
  }
  private static asProjectInfo(row: unknown): Record<string, unknown> {
    const r = (row ?? {}) as Record<string, unknown>;
    return { ...ApiStore.asProject(r), channel_count: Number(r.channel_count ?? 0) };
  }
  createProject: ConversationsStore["createProject"] = async (opts) => {
    const body = await this.post<{ project: unknown }>("/projects", opts);
    return ApiStore.asProject(body.project) as never;
  };
  listProjects: ConversationsStore["listProjects"] = async (opts) => {
    const body = await this.get<{ projects?: unknown[] }>("/projects", opts as Q);
    return (body.projects ?? []).map((p) => ApiStore.asProjectInfo(p)) as never;
  };
  getProject: ConversationsStore["getProject"] = async (id) => {
    try {
      const body = await this.get<{ project: unknown } | null>(`/projects/${encodeURIComponent(id)}`);
      return (body?.project ? ApiStore.asProjectInfo(body.project) : null) as never;
    } catch (e) {
      // The server 404s a missing project; the LocalStore contract is null.
      if (isHttpStatus(e, 404)) return null as never;
      throw e;
    }
  };
  getProjectByName: ConversationsStore["getProjectByName"] = async (name) => {
    const body = await this.get<{ project: unknown } | null>("/projects", { name, limit: 1 });
    const list = (body as { projects?: unknown[] } | null)?.projects;
    const row = (list && list[0]) ?? (body as { project?: unknown } | null)?.project ?? null;
    return (row ? ApiStore.asProjectInfo(row) : null) as never;
  };
  updateProject: ConversationsStore["updateProject"] = async (id, updates) => {
    const body = await this.patch<{ project: unknown }>(`/projects/${encodeURIComponent(id)}`, updates);
    return (body?.project ? ApiStore.asProject(body.project) : null) as never;
  };
  deleteProject: ConversationsStore["deleteProject"] = async (id) => {
    try {
      await this.del(`/projects/${encodeURIComponent(id)}`);
      return true as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return false as never;
      throw e;
    }
  };

  // ── reactions ────────────────────────────────────────────────────────────────
  addReaction: ConversationsStore["addReaction"] = async (messageId, agent, emoji) => {
    // Store-boundary content-safety gate: reject a credential-shaped emoji
    // client-side BEFORE it reaches the hosted route (the server enforces the
    // same assert; this keeps the failure local and the value out of the wire).
    assertNoSensitiveContent(normalizeEmoji(emoji), "Reaction emoji");
    const body = await this.post<{ toggled?: string; reaction?: unknown }>(`/messages/${encodeURIComponent(String(messageId))}/reactions`, { agent, emoji });
    return {
      toggled: body.toggled === "removed" ? "removed" : "added",
      reaction: body.reaction ?? null,
    } as never;
  };
  toggleReaction: ConversationsStore["toggleReaction"] = async (messageId, agent, emoji) => {
    assertNoSensitiveContent(normalizeEmoji(emoji), "Reaction emoji");
    const body = await this.post<{ toggled?: string; reaction?: unknown }>(`/messages/${encodeURIComponent(String(messageId))}/reactions`, { agent, emoji });
    return {
      toggled: body.toggled === "removed" ? "removed" : "added",
      reaction: body.reaction ?? null,
    } as never;
  };
  removeReaction: ConversationsStore["removeReaction"] = async (messageId, agent, emoji) => {
    try {
      await this.del(`/messages/${encodeURIComponent(String(messageId))}/reactions`, { agent, emoji });
      return true as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return false as never;
      throw e;
    }
  };
  getReactions: ConversationsStore["getReactions"] = async (messageId) => {
    const body = await this.get<{ reactions?: unknown[] }>(`/messages/${encodeURIComponent(String(messageId))}/reactions`);
    return (body.reactions ?? []) as never;
  };
  getReactionSummary: ConversationsStore["getReactionSummary"] = async (messageId) => {
    const body = await this.get<{ summary?: unknown[] }>(`/messages/${encodeURIComponent(String(messageId))}/reactions`, { summary: true });
    return (body.summary ?? []) as never;
  };

  // ── sessions ────────────────────────────────────────────────────────────────
  listSessions: ConversationsStore["listSessions"] = async (agent) => {
    const body = await this.get<{ sessions?: unknown[] }>("/sessions", { agent });
    return (body.sessions ?? []) as never;
  };
  getSession: ConversationsStore["getSession"] = async (sessionId) => {
    const body = await this.get<{ session: unknown } | null>(`/sessions/${encodeURIComponent(sessionId)}`);
    return (body?.session ?? null) as never;
  };
  getSessionActivity: ConversationsStore["getSessionActivity"] = async (sessionId) => {
    const body = await this.get<{ activity: unknown } | null>(`/sessions/${encodeURIComponent(sessionId)}/activity`);
    return (body?.activity ?? null) as never;
  };

  // ── topics ────────────────────────────────────────────────────────────────────
  getChannelTopics: ConversationsStore["getChannelTopics"] = async (channelName, opts) => {
    const body = await this.get<{ topics?: unknown[] }>(`/topics/channel/${encodeURIComponent(normalizeChannelName(channelName))}`, {
      limit: opts?.limit === undefined ? undefined : resolveAnalyticsLimit(opts.limit, "limit", 100),
      since: normalizeSince(opts?.since),
    });
    return (body.topics ?? []) as never;
  };
  getSessionTopics: ConversationsStore["getSessionTopics"] = async (sessionId, opts) => {
    const body = await this.get<{ topics?: unknown[] }>(`/topics/session/${encodeURIComponent(sessionId)}`, {
      limit: opts?.limit === undefined ? undefined : resolveAnalyticsLimit(opts.limit, "limit", 100),
    });
    return (body.topics ?? []) as never;
  };
  getTrendingTopics: ConversationsStore["getTrendingTopics"] = async (opts) => {
    const body = await this.get<{ topics?: unknown[] }>("/topics/trending", {
      project_id: opts?.project_id,
      hours: opts?.hours,
      top_n: opts?.top_n === undefined ? undefined : resolveAnalyticsLimit(opts.top_n, "top_n", 20),
    });
    return (body.topics ?? []) as never;
  };

  // ── graph ─────────────────────────────────────────────────────────────────────
  buildGraph: ConversationsStore["buildGraph"] = async () => {
    const body = await this.post<unknown>("/graph/build");
    return body as never;
  };
  getRelated: ConversationsStore["getRelated"] = async (entityType, entityId) => {
    const body = await this.get<{ related?: unknown[] }>("/graph/related", { entity_type: entityType, entity_id: entityId });
    return (body.related ?? []) as never;
  };
  getAgentNetwork: ConversationsStore["getAgentNetwork"] = async (agent) => {
    const body = await this.get<{ network: unknown }>(`/graph/network/${encodeURIComponent(agent)}`);
    return body.network as never;
  };
  getGraphStats: ConversationsStore["getGraphStats"] = async () => {
    const body = await this.get<unknown>("/graph/stats");
    return body as never;
  };

  // ── summary ───────────────────────────────────────────────────────────────────
  getConversationSummary: ConversationsStore["getConversationSummary"] = async (sessionOrChannel, opts) => {
    const body = await this.get<{ summary: unknown } | null>(`/summary/${encodeURIComponent(sessionOrChannel)}`, {
      ...(opts ?? {}),
      limit: opts?.limit === undefined ? undefined : resolveAnalyticsLimit(opts.limit, "limit", 50),
    } as Q);
    return (body?.summary ?? null) as never;
  };

  // ── hot ───────────────────────────────────────────────────────────────────────
  computeHotness: ConversationsStore["computeHotness"] = async (sessionId) => {
    const body = await this.get<{ session: unknown } | null>(`/hot/${encodeURIComponent(sessionId)}`);
    return (body?.session ?? null) as never;
  };
  listHotSessions: ConversationsStore["listHotSessions"] = async (opts) => {
    const body = await this.get<{ sessions?: unknown[] }>("/hot", opts as Q);
    return (body.sessions ?? []) as never;
  };

  // ── messages ────────────────────────────────────────────────────────────────
  planChannelProjectMessageLinkage: ConversationsStore["planChannelProjectMessageLinkage"] = async (options) => {
    return this.post(
      `/channels/${encodeURIComponent(normalizeChannelName(options.channel))}/project-message-linkage`,
      { project_id: options.project_id, apply: false },
    ) as never;
  };
  applyChannelProjectMessageLinkage: ConversationsStore["applyChannelProjectMessageLinkage"] = async (options) => {
    return this.post(
      `/channels/${encodeURIComponent(normalizeChannelName(options.channel))}/project-message-linkage`,
      {
        project_id: options.project_id,
        expected_revision: options.expected_revision,
        idempotency_key: options.idempotency_key,
        apply: true,
      },
    ) as never;
  };
  rollbackChannelProjectMessageLinkage: ConversationsStore["rollbackChannelProjectMessageLinkage"] = async (options) => {
    return this.post(
      "/channels/project-message-linkage/rollback",
      {
        receipt_id: options.receipt_id,
        expected_revision: options.expected_revision,
        idempotency_key: options.idempotency_key,
        apply: options.apply,
      },
    ) as never;
  };
  sendMessage: ConversationsStore["sendMessage"] = async (opts) => {
    if (opts.tenant_id !== undefined) {
      throw new Error("tenant_id is owned by the active storage context and cannot be supplied on a message write.");
    }
    const replyUuid = opts.reply_to_uuid === undefined
      ? null
      : normalizeMessageUuid(opts.reply_to_uuid);
    if (opts.reply_to !== undefined && !replyUuid) {
      throw new Error("reply_to requires reply_to_uuid so the parent identity is immutable.");
    }
    if (opts.reply_to_uuid !== undefined && !replyUuid) {
      throw new Error("reply_to_uuid must be a valid message UUID.");
    }
    const messageUuid = opts.uuid === undefined
      ? randomUUID()
      : normalizeMessageUuid(opts.uuid);
    if (!messageUuid) {
      throw new Error("Message uuid must be a valid UUID.");
    }
    const attachmentUploads = encodeAttachmentUploads(prepareAttachmentSources(opts.attachments));
    const body = await this.client.create<{ message: Record<string, unknown> }>("messages", {
      uuid: messageUuid,
      from: opts.from, to: opts.to, content: opts.content, channel: opts.channel,
      project_id: opts.project_id, session_id: opts.session_id, priority: opts.priority,
      working_dir: opts.working_dir,
      repository: opts.repository,
      branch: opts.branch,
      metadata: opts.metadata,
      blocking: opts.blocking === true,
      // This is an explicit field whitelist, so anything missing here is
      // silently dropped on the hosted-API path. reply_to was missing, which
      // unthreaded every reply sent through the API while the local
      // SQLite path (and its tests) stayed correct.
      reply_to: opts.reply_to ?? undefined,
      reply_to_uuid: replyUuid ?? undefined,
      attachments: attachmentUploads.length > 0 ? attachmentUploads : undefined,
    });
    const returned = parseMessage(body.message);
    if (returned.uuid === messageUuid) {
      return attachSendRedaction(opts.content, returned) as never;
    }

    // A send can fan out mention notification DMs before the response is
    // observed. Never trust a later mutable numeric id as the identity of the
    // row we wrote: read back by the caller-bound immutable UUID instead.
    const exact = await this.getMessageByUuid(messageUuid);
    if (exact) return attachSendRedaction(opts.content, exact) as never;

    // Nothing under our UUID — and that has TWO causes this transport cannot
    // tell apart, because `getMessageByUuid` maps every 404 to null and a
    // server with no `/messages/by-uuid` route answers with the SAME bare 404
    // as a genuine row-miss. Measured on the deployed server, 2026-08-05:
    //   /v1/messages/by-uuid/<uuid>  -> 404 {"error":"Not found"}       (no route)
    //   /v1/definitely-not-a-route   -> 404 {"error":"Not found"}       (no route)
    //   /v1/messages/999999999       -> 404 {"error":"Message not found"} (real miss)
    // That server also drops the caller `uuid` on create — it is absent from
    // the route's published request schema — mints its own, and returns OUR
    // row. So the strict check reported EVERY successful send as a failure.
    //
    // Treating "could not verify" as "did not write" is the expensive
    // direction: a caller's natural response is to re-send, on a shared
    // channel, where the retry reports the same false failure.
    //
    // So ask the one question still answerable: is the row the server DID
    // return the write we just submitted?
    if (echoesSubmittedWrite(opts, returned)) {
      // DISCLOSE THE DOWNGRADE rather than returning silently. Confirmation
      // fell from "the server handed back the row under the UUID we bound" to
      // "the row it handed back is routed the way we asked", which is a weaker
      // claim, and a caller that cannot tell the two apart cannot know which
      // guarantee its id carries. This mirrors how the same file already
      // handles a server-side row cap (`truncated`) instead of presenting a
      // degraded result as a complete one.
      //
      // It is also the only thing that will ever mark this path dead: once the
      // server serves `/messages/by-uuid`, the flag stops appearing, and its
      // absence is the signal that this fallback can be removed.
      return attachSendRedaction(opts.content, {
        ...returned,
        write_confirmation: {
          degraded: true,
          method: "routing-echo",
          message:
            "The server did not preserve the caller-bound message UUID and cannot be queried by UUID, " +
            "so this id was confirmed from the routing of the row it returned, not by reading the row back.",
        },
      }) as never;
    }

    throw new Error(
      `Message write returned UUID ${returned.uuid || "(missing)"} instead of ${messageUuid}, ` +
        `and the exact row could not be read back. Refusing to report a numeric message id.`
    );
  };
  getMessageById: ConversationsStore["getMessageById"] = async (id) => {
    const body = await this.client.get<{ message: Record<string, unknown> }>("messages", String(id));
    return (body ? parseMessage(body.message) : null) as never;
  };
  getMessageByUuid: ConversationsStore["getMessageByUuid"] = async (uuid) => {
    const normalized = normalizeMessageUuid(uuid);
    if (!normalized) return null as never;
    try {
      const body = await this.get<{ message: Record<string, unknown> }>(
        `/messages/by-uuid/${encodeURIComponent(normalized)}`
      );
      return (body ? parseMessage(body.message) : null) as never;
    } catch (e) {
      if (!isHttpStatus(e, 404)) throw e;
    }

    // Compatibility with server generations before `/messages/by-uuid/:uuid`.
    // Those servers already expose an exact `uuid` filter on the collection
    // route. Treat the returned rows as untrusted because an even older server
    // may ignore an unknown query parameter while still returning 200.
    try {
      const body = await this.get<{ messages?: Record<string, unknown>[] }>(
        "/messages",
        { uuid: normalized, limit: 2, order: "asc" },
      );
      const matches = (body.messages ?? [])
        .map(parseMessage)
        .filter((message) => message.uuid === normalized);
      if (matches.length > 1) {
        throw new Error(`Message UUID ${normalized} resolved to more than one row.`);
      }
      return (matches[0] ?? null) as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return null as never;
      throw e;
    }
  };
  getMessageAttachment: ConversationsStore["getMessageAttachment"] = async (messageId, name) => {
    try {
      const message = await this.getMessageById(messageId);
      if (!message) throw messageNotFoundError(messageId);
      const attachment = message.attachments?.find((candidate) => candidate.name === name);
      if (!attachment) throw attachmentNotFoundError(messageId, name);

      let response: unknown;
      try {
        response = await this.get(
          `/messages/${encodeURIComponent(String(messageId))}/attachments/${encodeURIComponent(name)}`,
          { encoding: "base64" },
        );
      } catch (error) {
        if (isHttpStatus(error, 401) || isHttpStatus(error, 403)) {
          throw attachmentPermissionError(messageId, name);
        }
        if (isHttpStatus(error, 404)) throw attachmentNotFoundError(messageId, name);
        throw error;
      }
      return decodeAttachmentResponse(response, messageId, attachment);
    } catch (error) {
      if (error instanceof AttachmentRetrievalError) throw error;
      if (isHttpStatus(error, 401) || isHttpStatus(error, 403)) {
        throw attachmentPermissionError(messageId, name);
      }
      throw error;
    }
  };
  deleteMessage: ConversationsStore["deleteMessage"] = async (id, agent) => {
    try {
      await this.del(`/messages/${encodeURIComponent(String(id))}`, { from: agent });
      return true as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return false as never;
      throw e;
    }
  };
  editMessage: ConversationsStore["editMessage"] = async (id, agent, newContent) => {
    try {
      const body = await this.client.update<{ message: Record<string, unknown> }>("messages", String(id), { from: agent, content: newContent });
      return (body ? attachSendRedaction(newContent, parseMessage(body.message)) : null) as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return null as never;
      throw e;
    }
  };
  readMessages: ConversationsStore["readMessages"] = async (opts) => {
    const o = opts ?? {};
    const since = strictOptionalSince(o.since, "since");
    const window = resolveReadWindow({ ...o, since });
    // Keep the legacy request shape intact: the server owns its collection
    // ceiling, while the response remains preview-only. This preserves the
    // current newest-window contract for callers that deliberately ask above
    // the server ceiling without weakening the bounded server implementation.
    const page = await this.getBounded<MessagePreviewPage>("/messages", {
      limit: o.latest ?? o.limit ?? COLLECTION_DEFAULT_LIMIT,
      cursor: resolveCollectionOffset(o.offset),
      order: window.select,
      session: strictOptionalString(o.session_id, "session_id"),
      from: strictOptionalString(o.from, "from"),
      to: strictOptionalString(o.to, "to"),
      channel: strictOptionalChannel(o.channel, "channel"),
      project_id: strictOptionalString(o.project_id, "project_id"),
      since,
      since_id: o.since_id,
      unread_only: o.unread_only ? true : undefined,
      threads_only: o.threads_only ? true : undefined,
      include_reply_counts: o.include_reply_counts ? true : undefined,
      mentions_only: strictOptionalString(o.mentions_only, "mentions_only"),
      max_bytes: COLLECTION_MAX_MAX_BYTES,
      preview_bytes: resolveCollectionPreviewBytes(o.max_content_length),
      timeout_ms: COLLECTION_MAX_TIMEOUT_MS,
      detail: "preview",
    }, COLLECTION_MAX_TIMEOUT_MS);
    const previews = window.reverse ? [...page.messages].reverse() : page.messages;
    return previews.map(previewAsCompatibilityMessage) as never;
  };
  readMessagePreviews: ConversationsStore["readMessagePreviews"] = async (opts = {}) => {
    const limit = resolveCollectionLimit(opts.limit);
    const cursor = resolveCollectionOffset(opts.offset);
    const maxBytes = resolveCollectionMaxBytes(opts.max_bytes);
    const previewBytes = resolveCollectionPreviewBytes(opts.preview_bytes ?? opts.max_content_length);
    const timeoutMs = resolveCollectionTimeoutMs(opts.timeout_ms);
    const since = strictOptionalSince(opts.since, "since");
    return await this.getBounded<MessagePreviewPage>("/messages", {
      limit,
      cursor,
      order: resolveReadWindow({ ...opts, since }).select,
      session: strictOptionalString(opts.session_id, "session_id"),
      from: strictOptionalString(opts.from, "from"),
      to: strictOptionalString(opts.to, "to"),
      channel: strictOptionalChannel(opts.channel, "channel"),
      project_id: strictOptionalString(opts.project_id, "project_id"),
      since,
      since_id: opts.since_id,
      unread_only: opts.unread_only ? true : undefined,
      threads_only: opts.threads_only ? true : undefined,
      include_reply_counts: opts.include_reply_counts ? true : undefined,
      mentions_only: strictOptionalString(opts.mentions_only, "mentions_only"),
      max_bytes: maxBytes,
      preview_bytes: previewBytes,
      timeout_ms: timeoutMs,
      detail: "preview",
    }, timeoutMs) as never;
  };
  readPinnedMessagePreviews: ConversationsStore["readPinnedMessagePreviews"] = async (opts = {}) => {
    const limit = resolveCollectionLimit(opts.limit);
    const cursor = resolveCollectionOffset(opts.offset);
    const maxBytes = resolveCollectionMaxBytes(opts.max_bytes);
    const previewBytes = resolveCollectionPreviewBytes(opts.preview_bytes ?? opts.max_content_length);
    const timeoutMs = resolveCollectionTimeoutMs(opts.timeout_ms);
    return await this.getBounded<MessagePreviewPage>("/messages/pinned", {
      channel: strictOptionalChannel(opts.channel, "channel"),
      session: strictOptionalString(opts.session_id, "session_id"),
      limit,
      cursor,
      max_bytes: maxBytes,
      preview_bytes: previewBytes,
      timeout_ms: timeoutMs,
      detail: "preview",
    }, timeoutMs) as never;
  };
  searchMessages: ConversationsStore["searchMessages"] = async (opts) => {
    const page = await this.searchMessagePreviews({ ...opts, max_bytes: COLLECTION_MAX_MAX_BYTES });
    return page.messages.map((preview) => ({
      ...previewAsCompatibilityMessage(preview),
      snippet: null,
      relevance_score: preview.relevance_score ?? 0,
    })) as never;
  };
  searchMessagePreviews: ConversationsStore["searchMessagePreviews"] = async (opts) => {
    const limit = resolveCollectionLimit(opts.limit);
    const cursor = resolveCollectionOffset(opts.offset);
    const maxBytes = resolveCollectionMaxBytes(opts.max_bytes);
    const previewBytes = resolveCollectionPreviewBytes(opts.preview_bytes ?? opts.snippet_length);
    const timeoutMs = resolveCollectionTimeoutMs(opts.timeout_ms);
    return await this.getBounded<MessagePreviewPage>("/messages", {
      q: resolvePresentString(opts.query, "q"),
      limit,
      cursor,
      order: "desc",
      channel: strictOptionalChannel(opts.channel, "channel"),
      from: strictOptionalString(opts.from, "from"),
      to: strictOptionalString(opts.to, "to"),
      since: opts.since === undefined ? undefined : normalizeExactIsoTimestamp(opts.since, "search since timestamp"),
      until: opts.until === undefined ? undefined : normalizeExactIsoTimestamp(opts.until, "search until timestamp"),
      max_bytes: maxBytes,
      preview_bytes: previewBytes,
      timeout_ms: timeoutMs,
      detail: "preview",
    }, timeoutMs) as never;
  };
  searchMessagesPage: ConversationsStore["searchMessagesPage"] = async (opts) => {
    const since = opts.since === undefined ? undefined : normalizeExactIsoTimestamp(opts.since, "search since timestamp");
    const requested = Number.isFinite(opts.limit) && (opts.limit as number) > 0
      ? Math.floor(opts.limit as number)
      : DEFAULT_SEARCH_LIMIT;
    const offset = Number.isFinite(opts.offset) && (opts.offset as number) > 0
      ? Math.floor(opts.offset as number)
      : 0;
    // Over-fetch one row so an exhausted page is distinguishable from a full
    // one. The server may clamp this back down; that case is handled below.
    const previewPage = await this.searchMessagePreviews({
      ...opts,
      since,
      limit: requested + 1,
      offset,
      max_bytes: COLLECTION_MAX_MAX_BYTES,
    });
    const rows = previewPage.messages.map((preview) => ({
      ...previewAsCompatibilityMessage(preview),
      snippet: null,
      relevance_score: preview.relevance_score ?? 0,
    }));

    // A server new enough to report truncation is authoritative — it can see
    // the population beyond its WIRE page, and the heuristic below cannot.
    // The client still owns the smaller caller page: it deliberately asked for
    // one probe row beyond `requested`. If that row came back, it proves there
    // is another caller page even when the server truthfully says its larger
    // wire page exhausted the population. Likewise, the server's next_offset
    // advances past every wire row, so use the number actually handed to the
    // caller or the trimmed probe row would be skipped forever.
    if (typeof previewPage.has_more === "boolean") {
      const clientHasProbeRow = rows.length > requested;
      const items = clientHasProbeRow ? rows.slice(0, requested) : rows;
      const hasMore = clientHasProbeRow || previewPage.has_more;
      return {
        items,
        has_more: hasMore,
        next_cursor: hasMore ? offset + items.length : null,
        effective_limit: Math.min(requested, SERVER_SEARCH_MAX_ROWS),
      } as never;
    }

    // Older server: infer. Two distinct shapes mean "there is more".
    if (rows.length > requested) {
      const items = rows.slice(0, requested);
      return { items, has_more: true, next_cursor: offset + items.length, effective_limit: requested } as never;
    }
    // The clamp. Asking for more than the server's ceiling returns exactly the
    // ceiling — FEWER rows than requested, which is the shape that normally
    // means "exhausted". This is the reported defect (todos 83852845), and it
    // is the one case where trusting the row count produces a false absence.
    //
    // Deliberately fails toward warning: a population of exactly the ceiling
    // is reported as truncated when it is not. Over-warning costs one wasted
    // page; under-warning publishes a wrong audit. A server that reports
    // has_more removes the ambiguity above.
    if (rows.length >= SERVER_SEARCH_MAX_ROWS && requested + 1 > SERVER_SEARCH_MAX_ROWS) {
      return {
        items: rows,
        has_more: true,
        next_cursor: offset + rows.length,
        effective_limit: SERVER_SEARCH_MAX_ROWS,
      } as never;
    }
    return { items: rows, has_more: false, next_cursor: null, effective_limit: requested } as never;
  };
  readDigest: ConversationsStore["readDigest"] = async (opts) => {
    const o = opts ?? {};
    const since = normalizeSince(o.since);
    const maxBytes = resolveDigestMaxBytes(o.max_bytes);
    const limit = resolveDigestLimit(o.limit);
    const cursor = resolveDigestCursor(o.cursor);
    const channel = o.channel ? normalizeChannelName(o.channel) : null;
    const baseFilter: Q = { channel: channel ?? undefined, session: o.session_id, to: o.to, since, since_id: cursor, project_id: o.project_id };
    const [totalAvailable, totalUnread] = await Promise.all([
      this.messageCount(o.unread_only ? { ...baseFilter, unread_only: true } : baseFilter),
      this.messageCount({ ...baseFilter, unread_only: true }),
    ]);
    const listRes = await this.get<{ messages?: Record<string, unknown>[] }>("/messages", { ...baseFilter, order: "asc", limit, unread_only: o.unread_only ? true : undefined });
    // The hosted `/messages` endpoint is preview-only. Convert its bounded
    // rows back to the legacy Message shape before digest assembly; parsing a
    // preview as a full row leaves `content` undefined and crashes snippet
    // normalization.
    const messages = (listRes?.messages ?? []).map((row) => previewAsCompatibilityMessage(row as unknown as MessagePreview));
    const norm: DigestNorm = { channel, session_id: o.session_id, to: o.to, since, cursor, maxBytes, limit };
    const assembly = assembleDigest(norm, { total_available: totalAvailable, total_unread: totalUnread }, messages, !!o.mark_read);
    let markedRead = 0;
    if (o.mark_read && assembly.markableEntries.length > 0) {
      markedRead = await this.markReadByIds(assembly.markableEntries.map((m) => m.id), o.reader);
    }
    return assembly.rebuild(markedRead) as never;
  };
  private async messageCount(query: Q): Promise<number> {
    const body = await this.get<{ count?: number }>("/messages", { ...query, count: 1 });
    return Number(body?.count ?? 0);
  }
  countMessages: ConversationsStore["countMessages"] = async (opts) => {
    const o = opts ?? {};
    return (await this.messageCount({
      session: o.session_id,
      from: o.from,
      to: o.to,
      channel: o.channel ? normalizeChannelName(o.channel) : undefined,
      project_id: o.project_id,
      since: normalizeSince(o.since),
      since_id: o.since_id,
      unread_only: o.unread_only ? true : undefined,
      blocking_only: o.blocking_only ? true : undefined,
    })) as never;
  };
  exportMessages: ConversationsStore["exportMessages"] = async (opts) => {
    const o = opts ?? {};
    const body = await this.post<{ artifact?: unknown }>("/messages/exports", {
      ...o,
      channel: strictOptionalChannel(o.channel, "channel"),
      session_id: strictOptionalString(o.session_id, "session_id"),
      from: strictOptionalString(o.from, "from"),
      since: strictOptionalSince(o.since, "since"),
      until: o.until === undefined ? undefined : resolveIso8601Date(o.until, "until"),
      format: resolveExportFormat(o.format),
    });
    if (!body?.artifact) throw new Error("Message export response did not include an artifact");
    return body.artifact as never;
  };
  getThreadReplies: ConversationsStore["getThreadReplies"] = async (messageId) => {
    const timeoutMs = resolveCollectionTimeoutMs(undefined);
    const body = await this.getBounded<MessagePreviewPage>(
      `/messages/${encodeURIComponent(String(messageId))}/replies`,
      { detail: "preview", timeout_ms: timeoutMs },
      timeoutMs,
    );
    return body.messages.map(previewAsCompatibilityMessage) as never;
  };
  listThreads: ConversationsStore["listThreads"] = async (opts) => {
    const timeoutMs = resolveCollectionTimeoutMs(opts.timeout_ms);
    const limit = resolveCollectionLimit(opts.limit ?? 50);
    const cursor = resolveCollectionOffset(opts.offset);
    const query: Q = {
      channel: normalizeChannelName(opts.channel),
      limit,
      cursor,
      detail: "preview",
      timeout_ms: timeoutMs,
    };
    if (opts.from) query.from = opts.from;
    // The server already builds each thread root as a full MessagePreview; the
    // client passes the thread summaries through unchanged.
    const body = await this.getBounded<{
      threads?: Array<Record<string, unknown>>;
      count?: number;
      has_more?: boolean;
      next_cursor?: number | null;
    }>("/threads", query, timeoutMs);
    return {
      threads: body.threads ?? [],
      count: Number(body.count ?? (body.threads ?? []).length),
    } as never;
  };
  getThreadExpand: ConversationsStore["getThreadExpand"] = async (messageRef) => {
    const body = await this.get<{ root?: Record<string, unknown>; replies?: Array<Record<string, unknown>>; thread_status?: string; reply_count?: number }>(
      `/threads/${encodeURIComponent(String(messageRef))}`,
    );
    return body as never;
  };
  setThreadStatus: ConversationsStore["setThreadStatus"] = async (messageRef, status) => {
    const body = await this.post<{ message?: Record<string, unknown> }>(
      `/threads/${encodeURIComponent(String(messageRef))}/status`,
      { status },
    );
    return body.message as never;
  };
  getThreadUnreadCount: ConversationsStore["getThreadUnreadCount"] = async (messageRef, agent) => {
    const body = await this.get<{ unread_count?: number }>(
      `/threads/${encodeURIComponent(String(messageRef))}/unread`,
      { agent },
    );
    return Number(body.unread_count ?? 0) as never;
  };
  getUnreadBlockers: ConversationsStore["getUnreadBlockers"] = async (agent, opts) => {
    const page = await this.getUnreadBlockerPreviews(agent, { ...opts, max_bytes: COLLECTION_MAX_MAX_BYTES });
    return page.messages.map(previewAsCompatibilityMessage) as never;
  };
  getUnreadBlockerPreviews: ConversationsStore["getUnreadBlockerPreviews"] = async (agent, opts = {}) => {
    const limit = resolveCollectionLimit(opts.limit);
    const cursor = resolveCollectionOffset(opts.offset);
    const maxBytes = resolveCollectionMaxBytes(opts.max_bytes);
    const previewBytes = resolveCollectionPreviewBytes(opts.preview_bytes);
    const timeoutMs = resolveCollectionTimeoutMs(opts.timeout_ms);
    return await this.getBounded<MessagePreviewPage>("/messages/blockers", {
      // The API key authorizes; the caller's byline is the identity that
      // scopes the read (task 1871c67f). The byline is forwarded
      // unconditionally — omitting it was the fleet-wide unscoped read.
      agent,
      limit,
      cursor,
      max_bytes: maxBytes,
      preview_bytes: previewBytes,
      timeout_ms: timeoutMs,
      detail: "preview",
    }, timeoutMs) as never;
  };
  readMentionPreviews: ConversationsStore["readMentionPreviews"] = async (agent, opts = {}) => {
    const limit = resolveCollectionLimit(opts.limit);
    const cursor = resolveCollectionOffset(opts.offset);
    const maxBytes = resolveCollectionMaxBytes(opts.max_bytes);
    const previewBytes = resolveCollectionPreviewBytes(opts.preview_bytes);
    const timeoutMs = resolveCollectionTimeoutMs(opts.timeout_ms);
    return await this.getBounded<MessagePreviewPage>("/messages/for-agent", {
      agent: resolvePresentString(agent, "agent")!,
      channel: strictOptionalChannel(opts.channel, "channel"),
      unread_only: opts.unread_only ? true : undefined,
      limit,
      cursor,
      max_bytes: maxBytes,
      preview_bytes: previewBytes,
      timeout_ms: timeoutMs,
      detail: "preview",
    }, timeoutMs) as never;
  };
  getMessagesForAgent: ConversationsStore["getMessagesForAgent"] = async (agent, opts) => {
    const page = await this.readMentionPreviews(agent, { ...opts, max_bytes: COLLECTION_MAX_MAX_BYTES });
    return page.messages.map((preview) => ({
      message: previewAsCompatibilityMessage(preview),
      mention_id: preview.mention_id ?? 0,
    })) as never;
  };
  getMessageReadStatus: ConversationsStore["getMessageReadStatus"] = async (messageId, channel) => {
    const body = await this.get<{ receipts?: unknown[]; unread_by?: string[] }>(`/messages/${encodeURIComponent(String(messageId))}/read-status`, { channel });
    return { receipts: body?.receipts ?? [], unread_by: body?.unread_by ?? [] } as never;
  };
  private async markReadCall(body: { ids?: number[]; reader?: string; all?: boolean; channel?: string; session?: string }): Promise<number> {
    const res = await this.post<{ marked?: number }>("/messages/read", body);
    return Number(res?.marked ?? 0);
  }
  markRead: ConversationsStore["markRead"] = async (ids, reader) => (ids.length === 0 ? 0 : await this.markReadCall({ ids, reader })) as never;
  markReadByIds: ConversationsStore["markReadByIds"] = async (ids, agent) => (ids.length === 0 ? 0 : await this.markReadCall({ ids, reader: agent })) as never;
  markAllRead: ConversationsStore["markAllRead"] = async (agent) => (await this.markReadCall({ all: true, reader: agent })) as never;
  markChannelRead: ConversationsStore["markChannelRead"] = async (channelName, reader) => (await this.markReadCall({ channel: normalizeChannelName(channelName), reader })) as never;
  markSessionRead: ConversationsStore["markSessionRead"] = async (sessionId, reader) => (await this.markReadCall({ session: sessionId, reader })) as never;
  markUnread: ConversationsStore["markUnread"] = async (messageId) => {
    const res = await this.post<{ marked_unread?: number }>("/messages/unread", { ids: [messageId] });
    return Number(res?.marked_unread ?? 0) as never;
  };
  markUnreadByIds: ConversationsStore["markUnreadByIds"] = async (ids) => {
    if (ids.length === 0) return 0 as never;
    const res = await this.post<{ marked_unread?: number }>("/messages/unread", { ids });
    return Number(res?.marked_unread ?? 0) as never;
  };
  markMentionsRead: ConversationsStore["markMentionsRead"] = async (agent, channel) => {
    const res = await this.post<{ marked?: number }>("/messages/read", { reader: agent, mentions_only: true, channel: channel ? normalizeChannelName(channel) : undefined });
    return Number(res?.marked ?? 0) as never;
  };
  // (agent, mentionIds) — matching messagesLib.markMentionsReadByIds. These two
  // parameters were previously NAMED in the opposite order, so positionally the
  // request went out as `{reader: <id array>, mention_ids: <agent name>}`: the
  // remote acknowledged nothing and reported a count for it.
  markMentionsReadByIds: ConversationsStore["markMentionsReadByIds"] = async (agent, mentionIds) => {
    if (mentionIds.length === 0) return 0 as never;
    const res = await this.post<{ marked?: number }>("/messages/read", { reader: agent, mention_ids: mentionIds });
    return Number(res?.marked ?? 0) as never;
  };
  listUnreadCounts: ConversationsStore["listUnreadCounts"] = async (agent) => {
    const res = await this.get<{ counts?: Array<Record<string, unknown>> }>("/messages/unread-counts", { agent });
    return (res?.counts ?? []).map((r) => ({ channel: String(r.channel), unread_count: Number(r.unread_count ?? 0), latest_message_at: (r.latest_message_at as string) ?? null })) as never;
  };
  listUnreadCountsWithMentions: ConversationsStore["listUnreadCountsWithMentions"] = async (agent) => {
    const res = await this.get<{ counts?: Array<Record<string, unknown>> }>("/messages/unread-counts", { agent, with_mentions: true });
    return (res?.counts ?? []) as never;
  };
  pinMessage: ConversationsStore["pinMessage"] = async (id) => {
    try {
      const body = await this.post<{ message: Record<string, unknown> }>(`/messages/${encodeURIComponent(String(id))}/pin`);
      return (body ? parseMessage(body.message) : null) as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return null as never;
      throw e;
    }
  };
  unpinMessage: ConversationsStore["unpinMessage"] = async (id) => {
    try {
      const body = await this.post<{ message: Record<string, unknown> }>(`/messages/${encodeURIComponent(String(id))}/unpin`);
      return (body ? parseMessage(body.message) : null) as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return null as never;
      throw e;
    }
  };
  getPinnedMessages: ConversationsStore["getPinnedMessages"] = async (opts) => {
    const res = await this.readPinnedMessagePreviews({
      channel: opts?.channel ? normalizeChannelName(opts.channel) : undefined,
      session_id: opts?.session_id,
      limit: opts?.limit,
      offset: opts?.offset,
      max_bytes: COLLECTION_MAX_MAX_BYTES,
    });
    return res.messages.map(previewAsCompatibilityMessage) as never;
  };
  recordReadReceipt: ConversationsStore["recordReadReceipt"] = async (messageId, agent) => {
    await this.markReadCall({ ids: [messageId], reader: agent });
    return undefined as never;
  };
  recordReadReceiptsBatch: ConversationsStore["recordReadReceiptsBatch"] = async (messageIds, agent) => {
    if (messageIds.length && agent) await this.markReadCall({ ids: messageIds, reader: agent });
    return undefined as never;
  };
  getReadReceipts: ConversationsStore["getReadReceipts"] = async (messageId) => {
    const res = await this.get<{ receipts?: unknown[] }>(`/messages/${encodeURIComponent(String(messageId))}/receipts`);
    return (res?.receipts ?? []) as never;
  };
  appendIncidentProjection: ConversationsStore["appendIncidentProjection"] = async (request) => {
    const body = await this.post<{ projection?: IncidentProjectionRecord }>("/incident-projections", request);
    if (!body?.projection) throw new Error("Incident projection response did not include a projection");
    return body.projection as never;
  };
  getIncidentProjection: ConversationsStore["getIncidentProjection"] = async (eventId) => {
    try {
      const body = await this.get<{ projection?: IncidentProjectionRecord }>(
        `/incident-projections/${encodeURIComponent(eventId)}`,
      );
      return (body?.projection ?? null) as never;
    } catch (error) {
      if (isHttpStatus(error, 404)) return null as never;
      throw error;
    }
  };
}
