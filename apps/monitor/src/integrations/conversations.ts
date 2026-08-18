/**
 * conversations integration — native adapter over the package-owned SDK.
 *
 * Uses `ConversationsClient.sendMessage` from `@hasna/conversations/sdk`
 * (the exact published package surface; no direct HTTP, no invented API).
 *
 * Outcome contract (MON-V2-07):
 * - a successful post records the returned message pointer (id + uuid);
 * - a confirmed server error (ApiError) is a failed outcome, not ambiguous;
 * - an unknown outcome (transport error, timeout) is reconciled by the stable
 *   effect key BEFORE retrying: if the message already landed, its pointer is
 *   recorded and nothing is resent; only a reconcile that proves absence
 *   permits a retry, and the retry reuses the same effect key.
 *
 * Message format: ⚠️ [machine] | [severity] | [check_name]: [message]
 */

import { createHash } from "node:crypto";
import { ApiError, ConversationsClient } from "@hasna/conversations/sdk";
import type { AlertRow } from "../db/schema.js";
import type { FleetHealthReport } from "../report.js";
import { formatFleetHealthReportText } from "../report.js";
import type { ConversationsIntegrationConfig } from "./index.js";

const DEFAULT_BASE_URL = "http://localhost:3001";
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 2;

export interface ConversationsSendOptions {
  /** Channel (or space) name to post to. */
  channelId: string;
  /** Base URL of the conversations API. Default: env HASNA_MONITOR_CONVERSATIONS_API_URL, then localhost:3001. */
  baseUrl?: string;
  /** API key for the conversations API. Resolved from env HASNA_MONITOR_CONVERSATIONS_API_KEY when absent; never stored or logged. */
  apiKey?: string;
  /** Sender identity; when absent the server derives it from the authenticated principal. */
  from?: string;
  /** Stable idempotency key; derived deterministically from (channelId, content) when absent. */
  effectKey?: string;
  /** Injectable client for tests; otherwise constructed from the config/env. */
  client?: ConversationsClient;
  /** Per-attempt timeout. Default 5000ms. */
  timeoutMs?: number;
  /** Max send attempts, each preceded by reconcile when the prior outcome was unknown. Default 2. */
  maxAttempts?: number;
}

export type ConversationsPostResult =
  | {
      status: "delivered";
      messageId: number;
      messageUuid: string;
      reconciled: false;
      attempts: number;
    }
  | {
      status: "reconciled";
      messageId: number;
      messageUuid: string;
      reconciled: true;
      attempts: number;
    }
  | { status: "failed"; error: string; attempts: number };

function severityEmoji(severity: AlertRow["severity"]): string {
  switch (severity) {
    case "critical":
      return "🔴";
    case "warn":
      return "⚠️";
    default:
      return "ℹ️";
  }
}

function formatAlertMessage(alert: AlertRow): string {
  const emoji = severityEmoji(alert.severity);
  const ts = new Date(alert.triggered_at * 1000).toISOString();
  return (
    `${emoji} ${alert.machine_id} | ${alert.severity.toUpperCase()} | ${alert.check_name}: ${alert.message}` +
    `\n_Triggered at ${ts}_`
  );
}

/**
 * Derive a deterministic canonical UUID v5-style effect key from the channel
 * and content, so retries and reconcile probes use one stable identity. The
 * server only accepts canonical UUIDs (version 1-5, variant 8/9/a/b).
 */
export function deriveEffectKey(channelId: string, content: string): string {
  const digest = createHash("sha256")
    .update(`${channelId}\n${content}`)
    .digest();
  const bytes = digest.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx
  const hex = Buffer.from(bytes).toString("hex");
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}

/** Resolve the SDK client from explicit config or the HASNA_MONITOR_ env namespace. */
export function createConversationsClient(
  options: Pick<ConversationsSendOptions, "baseUrl" | "apiKey">
): ConversationsClient {
  const baseUrl =
    options.baseUrl ??
    process.env.HASNA_MONITOR_CONVERSATIONS_API_URL ??
    DEFAULT_BASE_URL;
  const apiKey = options.apiKey ?? process.env.HASNA_MONITOR_CONVERSATIONS_API_KEY;
  return new ConversationsClient({ baseUrl, apiKey });
}

/** Extract {id, uuid} from a /v1 message payload ({message: {...}} or bare row). */
function parseMessagePointer(payload: unknown): { id: number; uuid: string } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const message = (record["message"] ?? record) as Record<string, unknown>;
  if (!message || typeof message !== "object") return null;
  const id = Number(message["id"]);
  const uuid = typeof message["uuid"] === "string" ? (message["uuid"] as string) : "";
  if (!Number.isInteger(id) || id <= 0 || !uuid) return null;
  return { id, uuid };
}

/**
 * Post a message to the configured conversations channel through the
 * package-owned SDK. Unknown outcomes are reconciled by the stable effect key
 * before any retry; only a reconcile that proves the message absent allows a
 * retry, and the retry reuses the same effect key.
 */
export async function sendConversationMessage(
  message: string,
  options: ConversationsSendOptions
): Promise<ConversationsPostResult> {
  const channelId = options.channelId;
  const client = options.client ?? createConversationsClient(options);
  const effectKey =
    options.effectKey ?? deriveEffectKey(channelId, message);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  let lastError = "unknown";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // A call-back as each attempt must carry the SAME stable effect key, so a
    // landed-but-unacknowledged post is found by reconcile instead of resubmitted.
    let sendError: unknown;
    try {
      const body = await client.sendMessage(
        {
          uuid: effectKey,
          ...(options.from ? { from: options.from } : {}),
          // The SDK body type requires `to`; for a channel post the server
          // derives the recipient from `channel` and ignores `to` (the legacy
          // integration used the same channel-shaped message).
          to: channelId,
          channel: channelId,
          content: message,
        },
        { signal: AbortSignal.timeout(timeoutMs) }
      );
      const pointer = parseMessagePointer(body);
      if (pointer) {
        return {
          status: "delivered",
          messageId: pointer.id,
          messageUuid: pointer.uuid,
          reconciled: false,
          attempts: attempt,
        };
      }
      // The server responded but the pointer is unparseable: the outcome is
      // ambiguous (a 2xx without a pointer). Reconcile rather than resend.
      sendError = new Error("response carried no parseable message pointer");
    } catch (error) {
      sendError = error;
    }

    if (sendError instanceof ApiError) {
      // The server answered — a confirmed failure, not an unknown outcome.
      return {
        status: "failed",
        error: sendError.message,
        attempts: attempt,
      };
    }
    lastError = sendError instanceof Error ? sendError.message : String(sendError);

    // Unknown outcome: reconcile by the stable effect key before any retry.
    let reconcileError: unknown;
    try {
      const found = await client.getMessageByUuid(effectKey, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      const pointer = parseMessagePointer(found);
      if (pointer) {
        return {
          status: "reconciled",
          messageId: pointer.id,
          messageUuid: pointer.uuid,
          reconciled: true,
          attempts: attempt,
        };
      }
      reconcileError = new Error("reconcile returned no parseable message pointer");
    } catch (error) {
      reconcileError = error;
    }

    if (reconcileError instanceof ApiError && reconcileError.status === 404) {
      // Reconcile proves the message is absent: the retry is safe and the
      // effect key keeps the resend idempotent.
      continue;
    }
    // The reconcile probe itself is ambiguous (or returned an unparseable
    // pointer): retrying could duplicate a landed message, so fail closed.
    return {
      status: "failed",
      error:
        reconcileError instanceof Error
          ? reconcileError.message
          : String(reconcileError),
      attempts: attempt,
    };
  }

  return { status: "failed", error: lastError, attempts: maxAttempts };
}

export interface LegacyPostOptions {
  /** Injectable client for tests. */
  client?: ConversationsClient;
}

/**
 * Post a message to the configured conversations space (legacy surface).
 * Throws on a confirmed failure so existing non-fatal callers keep their catch.
 */
export async function postMessageToSpace(
  message: string,
  config: ConversationsIntegrationConfig,
  options: LegacyPostOptions = {}
): Promise<void> {
  const result = await sendConversationMessage(message, {
    channelId: config.space_id,
    baseUrl: config.base_url,
    client: options.client,
  });
  if (result.status === "failed") {
    throw new Error(`conversations post failed: ${result.error}`);
  }
}

/**
 * Post an alert message to the configured conversations space.
 */
export async function postAlertToSpace(
  alert: AlertRow,
  config: ConversationsIntegrationConfig
): Promise<void> {
  await postMessageToSpace(formatAlertMessage(alert), config);
  console.error(
    `[monitor:integrations:conversations] posted alert for ${alert.machine_id}/${alert.check_name} to space '${config.space_id}'`
  );
}

export async function postReportToSpace(
  report: FleetHealthReport,
  config: ConversationsIntegrationConfig
): Promise<void> {
  await postMessageToSpace(formatFleetHealthReportText(report), config);
  console.error(
    `[monitor:integrations:conversations] posted ${report.period} fleet report to space '${config.space_id}'`
  );
}
