/**
 * conversations integration — native adapter over the package-owned SDK.
 *
 * Uses `ConversationsClient.sendMessage` from `@hasna/conversations/sdk`
 * (the exact published package surface; no direct HTTP, no invented API).
 *
 * Outcome contract (MON-V2-07):
 * - the sender identity (`from`) is REQUIRED and always sent. The hosted /v1
 *   server rejects a write without a sender ("from, to (or channel), and
 *   content are required", apps/conversations/src/server/api.ts), and the
 *   SDK's degraded write-confirmation fallback requires the returned
 *   `from_agent` to match the submitted `from`. `from` resolves from the
 *   explicit option, then the app namespace (HASNA_MONITOR_CONVERSATIONS_FROM),
 *   then the default "monitor".
 * - idempotency is resolved BEFORE posting, against the adapter's own effect
 *   ledger. The hosted service (conversations.hasna.xyz, a different
 *   codebase) drops caller UUIDs, mints its own, and has no
 *   /v1/messages/by-uuid route (apps/conversations CHANGELOG 0.5.25), so the
 *   server-side unique-uuid insert cannot deduplicate hosted writes. The
 *   ledger keys a delivered pointer by the stable effect key (derived from
 *   channel + from + content) and returns it without a second POST when the
 *   same effect is submitted again. The ledger is process-lifetime and
 *   bounded; across restarts the local surface is still deduplicated by the
 *   server's unique-uuid insert, and the hosted surface has no server-side
 *   dedup — that residual is documented, not hidden.
 * - a confirmed server error (ApiError) is reconciled by the stable effect
 *   key BEFORE it is reported as a failure: a repeated identical post (or a
 *   racing retry) can be refused by the server's unique-uuid insert while the
 *   message is already landed, and that is an idempotent success, not a
 *   failure. Only when the effect-key lookup cannot find the row does the
 *   confirmed failure stand.
 * - an unknown outcome (transport error, timeout) is reconciled by the stable
 *   effect key BEFORE retrying: if the message already landed, its pointer is
 *   recorded and nothing is resent; only a reconcile that PROVES absence
 *   permits a retry, and the retry reuses the same effect key. A 404 alone
 *   does not prove absence — the hosted service has no /v1/messages/by-uuid
 *   route and answers every such probe with a generic "Not found" 404 that is
 *   indistinguishable by status from a row-miss (apps/conversations CHANGELOG
 *   0.5.25). Only the by-uuid route's own row-miss signal
 *   ({"error":"Message not found"}) proves the row is absent; any other 404
 *   fails closed.
 * - the client resolves baseUrl/apiKey from the explicit options, then the
 *   app namespace (HASNA_MONITOR_CONVERSATIONS_*), then the conversations
 *   package contract (HASNA_CONVERSATIONS_API_URL / HASNA_CONVERSATIONS_API_KEY),
 *   so a deployment configured per the package contract authenticates.
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
/** Sender identity used when none is configured; the hosted /v1 server rejects writes without a sender. */
const DEFAULT_FROM = "monitor";

/**
 * Bounded, process-lifetime effect ledger. Keys a delivered message pointer by
 * its stable effect key so a repeated identical send resolves WITHOUT a second
 * POST — the only dedup mechanism that works against the hosted service, which
 * drops caller UUIDs and cannot be queried by them (CHANGELOG 0.5.25). FIFO
 * eviction at the cap; the same effect resubmitted after eviction is a fresh
 * send (the local server's unique-uuid insert still deduplicates it).
 */
const EFFECT_LEDGER_CAP = 256;
interface LedgerEntry {
  messageId: number;
  messageUuid: string;
  recordedAt: number;
}
const effectLedger = new Map<string, LedgerEntry>();

function recordEffectLedger(effectKey: string, entry: LedgerEntry): void {
  effectLedger.set(effectKey, entry);
  while (effectLedger.size > EFFECT_LEDGER_CAP) {
    const oldest = effectLedger.keys().next();
    if (oldest.done) break;
    effectLedger.delete(oldest.value);
  }
}

function resolveEffectLedger(effectKey: string): LedgerEntry | null {
  return effectLedger.get(effectKey) ?? null;
}

/** Reset the effect ledger (test isolation). */
export function resetEffectLedgerForTests(): void {
  effectLedger.clear();
}

export interface ConversationsSendOptions {
  /** Channel (or space) name to post to. */
  channelId: string;
  /** Base URL of the conversations API. Default: env HASNA_MONITOR_CONVERSATIONS_API_URL, then the package contract HASNA_CONVERSATIONS_API_URL, then localhost:3001. */
  baseUrl?: string;
  /** API key for the conversations API. Resolved from env HASNA_MONITOR_CONVERSATIONS_API_KEY, then the package contract HASNA_CONVERSATIONS_API_KEY, when absent; never stored or logged. */
  apiKey?: string;
  /** Sender identity, REQUIRED by the hosted /v1 server. Resolved from this option, then HASNA_MONITOR_CONVERSATIONS_FROM, then the default "monitor". */
  from?: string;
  /** Stable idempotency key; derived deterministically from (channelId, from, content) when absent. Resolved against the effect ledger before any POST. */
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
 * Derive a deterministic canonical UUID v5-style effect key from the channel,
 * sender and content, so retries, the effect ledger and reconcile probes use
 * one stable identity. The server only accepts canonical UUIDs (version 1-5,
 * variant 8/9/a/b). `from` participates so two senders never share an effect.
 */
export function deriveEffectKey(channelId: string, from: string, content: string): string {
  const digest = createHash("sha256")
    .update(`${channelId}\n${from}\n${content}`)
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

/**
 * Resolve the SDK client from explicit config, then the app-specific
 * HASNA_MONITOR_ env namespace, then the conversations package contract
 * (HASNA_CONVERSATIONS_API_URL / HASNA_CONVERSATIONS_API_KEY) so a deployment
 * configured per the package contract authenticates against /v1.
 */
export function createConversationsClient(
  options: Pick<ConversationsSendOptions, "baseUrl" | "apiKey"> & {
    /** Injectable fetch for tests; the SDK client defaults to global fetch. */
    fetch?: typeof fetch;
  }
): ConversationsClient {
  const baseUrl =
    options.baseUrl ??
    process.env.HASNA_MONITOR_CONVERSATIONS_API_URL ??
    process.env.HASNA_CONVERSATIONS_API_URL ??
    DEFAULT_BASE_URL;
  const apiKey =
    options.apiKey ??
    process.env.HASNA_MONITOR_CONVERSATIONS_API_KEY ??
    process.env.HASNA_CONVERSATIONS_API_KEY;
  return new ConversationsClient({ baseUrl, apiKey, ...(options.fetch ? { fetch: options.fetch } : {}) });
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
 * True only for the by-uuid route's OWN row-miss signal: a 404 whose body
 * error is "Message not found". This repo's server answers a row-miss on the
 * existing route that way; the hosted service has no such route and answers
 * every by-uuid probe with a generic {"error":"Not found"} (apps/conversations
 * CHANGELOG 0.5.25). A status alone cannot tell a missing route from a missing
 * row, so only this body proves the message is absent.
 */
function isRowMissNotFound(error: ApiError): boolean {
  if (error.status !== 404) return false;
  const body = error.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  return (body as Record<string, unknown>)["error"] === "Message not found";
}

/**
 * Look up the message by the stable effect key. Returns the pointer only when
 * the row is parseable AND carries the effect key itself — a server that mints
 * its own uuid (or cannot answer the by-uuid probe at all) cannot prove the
 * row landed, so its response is treated as "not provably landed".
 */
async function reconcileByEffectKey(
  client: ConversationsClient,
  effectKey: string,
  timeoutMs: number
): Promise<{ id: number; uuid: string } | null> {
  const found = await client.getMessageByUuid(effectKey, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  const pointer = parseMessagePointer(found);
  if (pointer && pointer.uuid.toLowerCase() === effectKey.toLowerCase()) {
    return pointer;
  }
  return null;
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
  // `from` is REQUIRED by the hosted /v1 server; resolve it from the option,
  // then the app namespace, then the default, and always send it.
  const from =
    options.from ??
    process.env.HASNA_MONITOR_CONVERSATIONS_FROM ??
    DEFAULT_FROM;
  const effectKey =
    options.effectKey ?? deriveEffectKey(channelId, from, message);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  // Resolve the effect key against the ledger BEFORE posting. A previously
  // delivered (or reconciled) pointer for this exact effect returns without a
  // second POST — the dedup that works even against the hosted service, which
  // drops caller UUIDs and cannot be queried back by them (CHANGELOG 0.5.25).
  const prior = resolveEffectLedger(effectKey);
  if (prior) {
    return {
      status: "reconciled",
      messageId: prior.messageId,
      messageUuid: prior.messageUuid,
      reconciled: true,
      attempts: 0,
    };
  }

  let lastError = "unknown";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // A call-back as each attempt must carry the SAME stable effect key, so a
    // landed-but-unacknowledged post is found by reconcile instead of resubmitted.
    let sendError: unknown;
    try {
      const body = await client.sendMessage(
        {
          uuid: effectKey,
          from,
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
        recordEffectLedger(effectKey, {
          messageId: pointer.id,
          messageUuid: pointer.uuid,
          recordedAt: Date.now(),
        });
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
      // The server answered — a confirmed failure. But a repeated identical
      // post (or a racing retry of one) can be refused by the server's
      // unique-uuid insert while the message is already landed: the adapter
      // must look up the existing message before reporting a failure. If the
      // effect key resolves to a row, the earlier attempt delivered it — an
      // idempotent success, never a resend. Only a lookup that cannot find
      // the row keeps the confirmed failure.
      let duplicate: { id: number; uuid: string } | null = null;
      try {
        duplicate = await reconcileByEffectKey(client, effectKey, timeoutMs);
      } catch {
        // The probe itself is ambiguous; the confirmed POST failure is the
        // evidence, and nothing was resent.
      }
      if (duplicate) {
        recordEffectLedger(effectKey, {
          messageId: duplicate.id,
          messageUuid: duplicate.uuid,
          recordedAt: Date.now(),
        });
        return {
          status: "reconciled",
          messageId: duplicate.id,
          messageUuid: duplicate.uuid,
          reconciled: true,
          attempts: attempt,
        };
      }
      return {
        status: "failed",
        error: sendError.message,
        attempts: attempt,
      };
    }
    lastError = sendError instanceof Error ? sendError.message : String(sendError);

    // Unknown outcome: reconcile by the stable effect key before any retry.
    let reconcileError: unknown;
    let found: { id: number; uuid: string } | null = null;
    try {
      found = await reconcileByEffectKey(client, effectKey, timeoutMs);
    } catch (error) {
      reconcileError = error;
    }
    if (found) {
      recordEffectLedger(effectKey, {
        messageId: found.id,
        messageUuid: found.uuid,
        recordedAt: Date.now(),
      });
      return {
        status: "reconciled",
        messageId: found.id,
        messageUuid: found.uuid,
        reconciled: true,
        attempts: attempt,
      };
    }
    if (reconcileError instanceof ApiError && isRowMissNotFound(reconcileError)) {
      // The by-uuid route answered that the row is absent: the retry is safe
      // and the effect key keeps the resend idempotent.
      continue;
    }
    // The reconcile probe is ambiguous — a generic 404 (the hosted service has
    // no by-uuid route), a transport error, or a response that is not the
    // effect-key row. Retrying could duplicate a landed message, so fail
    // closed.
    return {
      status: "failed",
      error:
        reconcileError instanceof Error
          ? reconcileError.message
          : reconcileError !== undefined
            ? String(reconcileError)
            : "reconcile returned no parseable message pointer",
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
    apiKey: config.api_key,
    from: config.from,
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
