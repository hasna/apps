/**
 * Cloud storage resolver for @hasna/conversations (Hasna Service Contract v1).
 *
 * When the client-flip contract resolves to `cloud-http` — i.e. mode is
 * cloud/self_hosted AND `HASNA_CONVERSATIONS_API_URL` +
 * `HASNA_CONVERSATIONS_API_KEY` are set — the routed message reads/writes below
 * go to `https://conversations.hasna.xyz/v1` with the bearer key instead of the
 * local SQLite store. Otherwise they fall through to the local implementation in
 * `messages.ts`.
 *
 * The fleet flip (`@hasna/machines`) writes only the two API URL + key vars, so
 * — to make that activate cloud — we imply `self_hosted` when both are present
 * and no explicit mode is set. An explicit `HASNA_CONVERSATIONS_STORAGE_MODE=
 * local` (or `_MODE`) still forces the local store, and unsetting the URL/key
 * reverts to local. Never a DSN on the client.
 *
 * SAFETY: conversations is a coordination store. This wiring is OFF by default
 * (local) and fully reversible; it does not change the fleet default. It never
 * logs or distributes the API key (the key lives only inside the HTTP transport).
 */

import { resolveStorageClient, type HasnaStorageClient } from "@hasna/contracts/client/storage";
import type { Channel, Message, SendMessageOptions } from "../types.js";
import {
  sendMessage as localSendMessage,
  getMessageById as localGetMessageById,
  deleteMessage as localDeleteMessage,
} from "./messages.js";
import { createChannel as localCreateChannel } from "./channels.js";

const APP = "conversations";
const RESOURCE = "messages";

type Env = Record<string, string | undefined>;

/**
 * Duck-typed check for a `HasnaHttpError` with a given status. We avoid
 * `instanceof` because the @hasna/contracts client subpaths are bundled
 * separately, so the error class thrown by the storage client's transport is
 * not identity-equal to the one exported from `@hasna/contracts/client`.
 */
function isHttpStatus(error: unknown, status: number): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { name?: string }).name === "HasnaHttpError" &&
      (error as { status?: number }).status === status,
  );
}

function errorStatus(error: unknown): number | null {
  return error && typeof error === "object" && typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : null;
}

function errorBody(error: unknown): unknown {
  if (!error || typeof error !== "object") return null;
  const candidate = error as Record<string, unknown>;
  return candidate.body ?? candidate.data ?? candidate.responseBody ?? null;
}

function textField(body: unknown, field: string): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatCloudError(action: string, error: unknown): Error {
  const status = errorStatus(error);
  const body = errorBody(error);
  const detail = [
    textField(body, "error"),
    textField(body, "field") ? `field=${textField(body, "field")}` : null,
    textField(body, "reason"),
    textField(body, "hint") ? `hint: ${textField(body, "hint")}` : null,
  ].filter(Boolean).join("; ");
  const message = status
    ? `${action} failed with HTTP ${status}${detail ? `: ${detail}` : ""}`
    : `${action} failed${detail ? `: ${detail}` : `: ${(error as Error)?.message ?? String(error)}`}`;
  return new Error(message);
}

function normalizeCloudChannel(row: Partial<Channel>): Channel {
  return {
    name: row.name ?? "",
    description: row.description ?? null,
    topic: row.topic ?? null,
    project_id: row.project_id ?? null,
    created_by: row.created_by ?? "",
    created_at: row.created_at ?? "",
    archived_at: row.archived_at ?? null,
    metadata: row.metadata ?? null,
    tags: row.tags ?? [],
  };
}

/**
 * Return an env in which `self_hosted` is implied when the API url + key are
 * present but no explicit storage mode is set. Leaves an explicit mode
 * (including `local`) untouched, so the flip stays reversible. A command-level
 * SQLite DB path is treated as an explicit local override; otherwise local CLI
 * test/dev commands can accidentally write to cloud when cloud credentials are
 * exported globally.
 */
export function conversationsCloudEnv(env: Env = process.env): Env {
  if (env.HASNA_CONVERSATIONS_DB_PATH || env.CONVERSATIONS_DB_PATH) {
    return { ...env, HASNA_CONVERSATIONS_STORAGE_MODE: "local" };
  }
  const url = env.HASNA_CONVERSATIONS_API_URL ?? env.CONVERSATIONS_API_URL;
  const key = env.HASNA_CONVERSATIONS_API_KEY ?? env.CONVERSATIONS_API_KEY;
  const mode = env.HASNA_CONVERSATIONS_STORAGE_MODE ?? env.HASNA_CONVERSATIONS_MODE;
  if (url && key && !mode) {
    return { ...env, HASNA_CONVERSATIONS_STORAGE_MODE: "self_hosted" };
  }
  return env;
}

/** Resolve the cloud HTTP client, or `null` when the app should use local. */
export function resolveConversationsCloud(env: Env = process.env): HasnaStorageClient | null {
  const resolved = resolveStorageClient(APP, conversationsCloudEnv(env));
  return resolved.transport === "cloud-http" ? resolved.client : null;
}

/** True when reads/writes are routed to the cloud API. */
export function isCloudMode(env: Env = process.env): boolean {
  return resolveConversationsCloud(env) !== null;
}

// ── Routed message CRUD ──────────────────────────────────────────────────────

export async function sendMessage(opts: SendMessageOptions, env: Env = process.env): Promise<Message> {
  const client = resolveConversationsCloud(env);
  if (!client) return localSendMessage(opts);
  const body = await client.create<{ message: Message }>(RESOURCE, {
    from: opts.from,
    to: opts.to,
    content: opts.content,
    channel: opts.channel,
    project_id: opts.project_id,
    session_id: opts.session_id,
    priority: opts.priority,
    blocking: opts.blocking === true,
  });
  return body.message;
}

export async function createChannel(
  name: string,
  createdBy: string,
  options?: { description?: string; topic?: string; project_id?: string; metadata?: Record<string, unknown>; tags?: string[] },
  env: Env = process.env,
): Promise<Channel> {
  const client = resolveConversationsCloud(env);
  if (!client) return localCreateChannel(name, createdBy, options);
  try {
    const body = await client.create<{ channel: Partial<Channel> }>("channels", {
      name,
      created_by: createdBy,
      description: options?.description,
      topic: options?.topic,
      project_id: options?.project_id,
      metadata: options?.metadata,
      tags: options?.tags,
    });
    return normalizeCloudChannel(body.channel);
  } catch (error) {
    throw formatCloudError("Cloud channel create", error);
  }
}

export async function getMessageById(id: number, env: Env = process.env): Promise<Message | null> {
  const client = resolveConversationsCloud(env);
  if (!client) return localGetMessageById(id);
  const body = await client.get<{ message: Message }>(RESOURCE, String(id));
  return body ? body.message : null;
}

export async function deleteMessage(id: number, agent: string, env: Env = process.env): Promise<boolean> {
  const client = resolveConversationsCloud(env);
  if (!client) return localDeleteMessage(id, agent);
  // The server requires `from` to match the sender and returns 404 when the
  // message is absent or not the caller's — surface that as `false`.
  try {
    await client.transport.del(`/${RESOURCE}/${encodeURIComponent(String(id))}`, undefined, {
      query: { from: agent },
    });
    return true;
  } catch (error) {
    if (isHttpStatus(error, 404)) return false;
    throw error;
  }
}
