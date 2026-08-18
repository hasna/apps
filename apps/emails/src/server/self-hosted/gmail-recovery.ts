// Gmail source-mailbox recovery for legacy-inbound attachment payloads.
//
// Issue hasna/emails#52: migration 0007 backfilled a legacy Gmail-synced store
// into `messages` with attachment metadata (filename/content_type/size) but no
// payload bytes and no `inbound_message_sources` row, so the canonical S3
// replay path (`attachment-repair-canary`) cannot bind or repair them. The
// only remaining byte source is the source mailbox itself, keyed by the
// retained provider/message id.
//
// Two bounded surfaces, both new:
//
//   - `gmail-recovery-reconcile`: READ-ONLY census of the affected population,
//     aggregated by resolvability class, with an optional bounded exact-id
//     manifest. No payload bytes are ever read, emitted, or logged.
//   - `gmail-recovery-replay`: exact-id, attachment-only recovery. Dry-run is
//     the default and still fetches + parses the source so "would_replay" is
//     honest; `--apply` requires a reviewed dry-run sha256 gate. Fail-closed
//     when the Gmail source is not configured. No production execution here —
//     this module only defines the path; running it is an ops action.
//
// Privacy: reports carry identifiers and attachment counts only. Attachment
// payload bytes never appear in any output of this module.

import { createHash } from "node:crypto";
import { parseInboundMime } from "../../lib/inbound-mime.js";
import {
  MAX_ATTACHMENT_REPAIR_RAW_BYTES,
  contentState,
  replacementPayload,
  missingAttachmentPayloadCount,
} from "./attachment-repair.js";
import { getSelfHostedPool, closeSelfHostedPool } from "./env.js";
import { canonicalJson, EmailsSelfHostedStore } from "./store.js";
import type {
  LegacyInboundPayloadPage,
  LegacyInboundPayloadRow,
} from "./store.js";

export const GMAIL_SOURCE_BUCKET = "gmail";
export const GMAIL_RECOVERY_CONFIG_ENV = "EMAILS_GMAIL_ACCESS_TOKEN";
export const GMAIL_RECOVERY_ENDPOINT_ENV = "EMAILS_GMAIL_API_ENDPOINT";
export const DEFAULT_GMAIL_API_ENDPOINT = "https://gmail.googleapis.com";

export const MAX_GMAIL_RECOVERY_MANIFEST_ROWS = 5000;
export const DEFAULT_GMAIL_RECOVERY_MANIFEST_ROWS = 500;
export const MAX_GMAIL_RECOVERY_REPLAY_MESSAGES = 200;
export const DEFAULT_GMAIL_RECOVERY_REPLAY_MESSAGES = 25;
export const GMAIL_RECOVERY_SCAN_PAGE = 500;

export type LegacyPayloadKeyClass =
  | "gmail_message_id"
  | "gmail_history_id"
  | "s3_key_candidate"
  | "unresolvable";

const GMAIL_MESSAGE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const GMAIL_HISTORY_ID_RE = /^[0-9]{1,20}$/;
const BASE64URL_RAW_RE = /^[A-Za-z0-9_-]+$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * Classify which id can re-fetch a legacy message from the source mailbox.
 *
 * - `gmail_message_id`: provider_message_id is Gmail-message-id-shaped and
 *   can be passed to `users.messages.get` directly.
 * - `gmail_history_id`: provider_message_id is numeric — a Gmail HISTORY id,
 *   which `messages.get` cannot resolve. Recovery needs a history mapping the
 *   surviving state does not carry; the row stays explicitly unrecovered.
 * - `s3_key_candidate`: no usable provider id, but the stored `message_id`
 *   column is S3-object-key-shaped. The bytes may exist in the canonical
 *   bucket; verify the object and record provenance before replay.
 * - `unresolvable`: nothing retained can reach the source mailbox.
 */
export function classifyLegacyPayloadKey(
  providerMessageId: string | null,
  messageIdColumn: string | null,
): LegacyPayloadKeyClass {
  const provider = providerMessageId?.trim();
  if (provider) {
    if (GMAIL_HISTORY_ID_RE.test(provider)) return "gmail_history_id";
    if (GMAIL_MESSAGE_ID_RE.test(provider)) return "gmail_message_id";
  }
  if (messageIdColumn?.includes("/")) return "s3_key_candidate";
  return "unresolvable";
}

/** Terminal, classified failure of the Gmail source. */
export class GmailRecoverySourceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null = null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GmailRecoverySourceError";
  }
}

export interface GmailRecoveryConfig {
  accessToken: string;
  endpoint: string;
}

/** Resolve the Gmail recovery source configuration; null when unconfigured. */
export function resolveGmailRecoveryConfig(
  env: NodeJS.ProcessEnv,
): GmailRecoveryConfig | null {
  const accessToken = env[GMAIL_RECOVERY_CONFIG_ENV]?.trim();
  if (!accessToken) return null;
  return {
    accessToken,
    endpoint: env[GMAIL_RECOVERY_ENDPOINT_ENV]?.trim() || DEFAULT_GMAIL_API_ENDPOINT,
  };
}

export interface GmailRawMessageFetcher {
  (gmailId: string): Promise<Buffer>;
}

/**
 * Production Gmail adapter: `GET /gmail/v1/users/me/messages/{id}?format=raw`
 * returns the base64url-encoded RFC822 message. The response is bounded to
 * MAX_ATTACHMENT_REPAIR_RAW_BYTES and the token never appears in output.
 */
export function createGmailRawMessageFetcher(
  config: GmailRecoveryConfig,
): GmailRawMessageFetcher {
  return async (gmailId: string): Promise<Buffer> => {
    if (!gmailId) throw new GmailRecoverySourceError("empty gmail message id", null, false);
    const url = `${config.endpoint.replace(/\/+$/, "")}/gmail/v1/users/me/messages/${encodeURIComponent(gmailId)}?format=raw`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          Accept: "application/json",
        },
        redirect: "error",
      });
    } catch (error) {
      throw new GmailRecoverySourceError(
        error instanceof Error ? error.message : "gmail fetch failed",
        null,
        true,
      );
    }
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new GmailRecoverySourceError(
        `gmail fetch failed with HTTP ${response.status}`,
        response.status,
        retryable,
      );
    }
    const body = await response.text();
    if (body.length > MAX_ATTACHMENT_REPAIR_RAW_BYTES * 2) {
      throw new GmailRecoverySourceError(
        `gmail response exceeds the attachment recovery byte limit ${MAX_ATTACHMENT_REPAIR_RAW_BYTES}`,
        null,
        false,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new GmailRecoverySourceError("gmail response is not valid JSON", null, false);
    }
    const raw = parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)["raw"]
      : null;
    if (typeof raw !== "string" || !BASE64URL_RAW_RE.test(raw)) {
      throw new GmailRecoverySourceError("gmail response carries no raw RFC822 payload", null, false);
    }
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.byteLength === 0) {
      throw new GmailRecoverySourceError("gmail raw message is empty", null, false);
    }
    if (bytes.byteLength > MAX_ATTACHMENT_REPAIR_RAW_BYTES) {
      throw new GmailRecoverySourceError(
        `gmail raw message exceeds the attachment recovery byte limit ${MAX_ATTACHMENT_REPAIR_RAW_BYTES}`,
        null,
        false,
      );
    }
    return bytes;
  };
}

/** Narrow store surface the reconciler/replay need (kept testable). */
export interface GmailRecoveryStore {
  listLegacyInboundMissingPayloadBindings(
    cursor: { tenantId: string; messageId: string } | null,
    limit: number,
  ): Promise<LegacyInboundPayloadPage>;
  getLegacyInboundPayloadBindings(messageId: string): Promise<LegacyInboundPayloadRow[]>;
  replaceLegacyAttachmentPayloadAndProvenance(input: {
    tenantId: string;
    messageId: string;
    expectedAttachments: unknown[];
    replacementAttachments: unknown[];
    provenance: {
      bucket: string;
      objectKey: string;
      rawSha256: string;
      establishedVia: "gmail_replay";
    };
  }): Promise<boolean>;
}

export interface GmailRecoveryReconcileOptions {
  emitIds: boolean;
  limit: number;
}

export interface GmailRecoveryReconcileItem {
  tenant_id: string;
  message_id: string;
  provider_message_id: string | null;
  key_class: LegacyPayloadKeyClass;
  attachments: number;
}

export interface GmailRecoveryReconcileResult {
  scanned_messages: number;
  missing_payload_attachments: number;
  by_key_class: Record<LegacyPayloadKeyClass, number>;
  manifest: GmailRecoveryReconcileItem[];
  manifest_emitted: number;
}

function normalizeReconcileOptions(options: GmailRecoveryReconcileOptions): {
  emitIds: boolean;
  limit: number;
} {
  if (!Number.isSafeInteger(options.limit) || options.limit <= 0
    || options.limit > MAX_GMAIL_RECOVERY_MANIFEST_ROWS) {
    throw new RangeError(
      `manifest limit must be between 1 and ${MAX_GMAIL_RECOVERY_MANIFEST_ROWS}`,
    );
  }
  return { emitIds: options.emitIds === true, limit: options.limit };
}

/**
 * READ-ONLY census of every legacy-inbound message whose attachment rows carry
 * metadata but no payload bytes. Pages the store to exhaustion (each page
 * bounded), aggregates by resolvability class, and optionally emits a bounded
 * exact-id manifest. Payload bytes never pass through this function.
 */
export async function reconcileLegacyInboundMissingPayloads(
  store: GmailRecoveryStore,
  options: GmailRecoveryReconcileOptions,
): Promise<GmailRecoveryReconcileResult> {
  const { emitIds, limit } = normalizeReconcileOptions(options);
  const result: GmailRecoveryReconcileResult = {
    scanned_messages: 0,
    missing_payload_attachments: 0,
    by_key_class: {
      gmail_message_id: 0,
      gmail_history_id: 0,
      s3_key_candidate: 0,
      unresolvable: 0,
    },
    manifest: [],
    manifest_emitted: 0,
  };
  let cursor: { tenantId: string; messageId: string } | null = null;
  for (;;) {
    const page = await store.listLegacyInboundMissingPayloadBindings(cursor, GMAIL_RECOVERY_SCAN_PAGE);
    for (const row of page.rows) {
      result.scanned_messages += 1;
      const keyClass = classifyLegacyPayloadKey(row.provider_message_id, row.message_id_column);
      result.by_key_class[keyClass] += 1;
      result.missing_payload_attachments += missingAttachmentPayloadCount(row.attachments);
      if (emitIds && result.manifest.length < limit) {
        result.manifest.push({
          tenant_id: row.tenant_id,
          message_id: row.message_id,
          provider_message_id: row.provider_message_id,
          key_class: keyClass,
          attachments: row.attachments.length,
        });
      }
    }
    if (!page.has_more) break;
    const last = page.rows[page.rows.length - 1];
    if (!last) throw new Error("legacy payload page reported more rows without a last row");
    cursor = { tenantId: last.tenant_id, messageId: last.message_id };
  }
  result.manifest_emitted = emitIds ? result.manifest.length : 0;
  return result;
}

export type GmailRecoveryReplayItemStatus =
  | "would_replay"
  | "replayed"
  | "already_complete"
  | "metadata_mismatch"
  | "invalid_metadata"
  | "unresolvable_key"
  | "history_id_only"
  | "ambiguous"
  | "not_found"
  | "fetch_failed"
  | "byte_limit"
  | "parse_failed"
  | "concurrent_change"
  | "error";

export interface GmailRecoveryReplayItem {
  tenant_id: string;
  message_id: string;
  status: GmailRecoveryReplayItemStatus;
  attachments: number;
  reason?: string;
  /** Explicitly distinguishes retryable source failures from terminal states. */
  retryable?: boolean;
}

export interface GmailRecoveryReplayReport {
  mode: "dry-run" | "apply";
  limit: number;
  items: GmailRecoveryReplayItem[];
  result_sha256: string;
}

export interface GmailRecoveryReplayOptions {
  messageIds: string[];
  apply: boolean;
  reviewedDryRunSha256?: string;
  limit: number;
  fetchRawMessage: GmailRawMessageFetcher;
}

export function normalizeGmailRecoveryReplayMessageIds(
  values: readonly string[],
): string[] {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  const seen = new Set<string>();
  for (const messageId of normalized) {
    if (seen.has(messageId)) {
      throw new Error("gmail recovery rejects duplicate normalized message-id values");
    }
    seen.add(messageId);
  }
  return normalized;
}

export function validateGmailRecoveryReplayOptions(
  options: GmailRecoveryReplayOptions,
): { messageIds: string[]; limit: number; apply: boolean } {
  const messageIds = normalizeGmailRecoveryReplayMessageIds(options.messageIds);
  if (messageIds.length === 0) {
    throw new Error("gmail recovery replay requires at least one exact --message-id");
  }
  if (!Number.isSafeInteger(options.limit) || options.limit <= 0
    || options.limit > MAX_GMAIL_RECOVERY_REPLAY_MESSAGES) {
    throw new RangeError(
      `gmail recovery replay limit must be between 1 and ${MAX_GMAIL_RECOVERY_REPLAY_MESSAGES}`,
    );
  }
  if (options.apply === true) {
    if (!options.reviewedDryRunSha256 || !SHA256_RE.test(options.reviewedDryRunSha256)) {
      throw new Error("gmail recovery replay --apply requires --reviewed-dry-run-sha256 <hex>");
    }
  }
  return { messageIds, limit: options.limit, apply: options.apply === true };
}

function replayItem(
  binding: LegacyInboundPayloadRow,
  status: GmailRecoveryReplayItemStatus,
  extra: { reason?: string; retryable?: boolean } = {},
): GmailRecoveryReplayItem {
  return {
    tenant_id: binding.tenant_id,
    message_id: binding.message_id,
    status,
    attachments: binding.attachments.length,
    ...(extra.reason ? { reason: extra.reason } : {}),
    ...(extra.retryable === undefined ? {} : { retryable: extra.retryable }),
  };
}

function replayReportItems(report: GmailRecoveryReplayReport): GmailRecoveryReplayItem[] {
  return [...report.items]
    .sort((left, right) =>
      `${left.tenant_id}\0${left.message_id}`.localeCompare(`${right.tenant_id}\0${right.message_id}`));
}

/**
 * One exact-id legacy message: classify the retained key, fetch the raw
 * RFC822 from Gmail, verify attachment metadata shape, and (on apply) CAS the
 * payloads plus the immutable provenance row in one transaction.
 */
async function replayOneMessage(
  store: GmailRecoveryStore,
  fetchRawMessage: GmailRawMessageFetcher,
  binding: LegacyInboundPayloadRow,
  apply: boolean,
): Promise<GmailRecoveryReplayItem> {
  const state = contentState(binding.attachments);
  if (state === "complete") return replayItem(binding, "already_complete");
  if (state === "invalid") {
    return replayItem(binding, "invalid_metadata", {
      reason: "existing attachment metadata is invalid",
      retryable: false,
    });
  }
  const keyClass = classifyLegacyPayloadKey(binding.provider_message_id, binding.message_id_column);
  if (keyClass === "gmail_history_id") {
    return replayItem(binding, "history_id_only", {
      reason: "provider_message_id is a Gmail history id; messages.get cannot resolve it",
      retryable: false,
    });
  }
  if (keyClass === "s3_key_candidate") {
    return replayItem(binding, "unresolvable_key", {
      reason: "retained message_id is S3-key-shaped; verify the object and record provenance first",
      retryable: false,
    });
  }
  if (keyClass !== "gmail_message_id" || !binding.provider_message_id) {
    return replayItem(binding, "unresolvable_key", {
      reason: "no provider/message id can reach the source mailbox",
      retryable: false,
    });
  }
  const gmailId = binding.provider_message_id.trim();

  let raw: Buffer;
  try {
    raw = await fetchRawMessage(gmailId);
  } catch (error) {
    if (error instanceof GmailRecoverySourceError) {
      return replayItem(binding, "fetch_failed", {
        reason: error.message,
        retryable: error.retryable,
      });
    }
    return replayItem(binding, "fetch_failed", {
      reason: error instanceof Error ? error.message : "gmail fetch failed",
      retryable: true,
    });
  }
  if (raw.byteLength === 0) {
    return replayItem(binding, "error", { reason: "gmail raw message is empty", retryable: false });
  }
  if (raw.byteLength > MAX_ATTACHMENT_REPAIR_RAW_BYTES) {
    return replayItem(binding, "byte_limit", {
      reason: `gmail raw message exceeds the byte limit ${MAX_ATTACHMENT_REPAIR_RAW_BYTES}`,
      retryable: false,
    });
  }
  const rawSha256 = createHash("sha256").update(raw).digest("hex");
  let parsed: { attachments: unknown[] };
  try {
    parsed = await parseInboundMime(raw);
  } catch (error) {
    return replayItem(binding, "parse_failed", {
      reason: error instanceof Error ? error.message : "attachment MIME could not be parsed",
      retryable: false,
    });
  }
  const replacement = replacementPayload(binding.attachments, parsed.attachments);
  if (!replacement) {
    return replayItem(binding, "metadata_mismatch", {
      reason: "fetched attachment count/order/metadata does not match the stored row",
      retryable: false,
    });
  }
  if (!apply) return replayItem(binding, "would_replay");
  const updated = await store.replaceLegacyAttachmentPayloadAndProvenance({
    tenantId: binding.tenant_id,
    messageId: binding.message_id,
    expectedAttachments: binding.attachments,
    replacementAttachments: replacement,
    provenance: {
      bucket: GMAIL_SOURCE_BUCKET,
      objectKey: gmailId,
      rawSha256,
      establishedVia: "gmail_replay",
    },
  });
  return replayItem(binding, updated ? "replayed" : "concurrent_change");
}

/**
 * Bounded exact-id replay. Dry-run is the default and performs the full
 * fetch + parse so every "would_replay" is evidence-backed. `--apply` requires
 * the sha256 of a previously reviewed dry-run report for the SAME message set;
 * the dry-run is recomputed and the gate is checked before any write. A row
 * that cannot be resolved keeps its `content_available: false` — nothing is
 * ever fabricated.
 */
export async function replayLegacyInboundAttachments(
  store: GmailRecoveryStore,
  options: GmailRecoveryReplayOptions,
): Promise<GmailRecoveryReplayReport> {
  const { messageIds, limit, apply } = validateGmailRecoveryReplayOptions(options);
  const dryRunItems: GmailRecoveryReplayItem[] = [];
  for (const messageId of messageIds.slice(0, limit)) {
    const bindings = await store.getLegacyInboundPayloadBindings(messageId);
    if (bindings.length === 0) {
      dryRunItems.push({
        tenant_id: "unresolved",
        message_id: messageId,
        status: "not_found",
        attachments: 0,
        reason: "no legacy-inbound message matches this id",
        retryable: false,
      });
      continue;
    }
    if (bindings.length > 1) {
      for (const binding of bindings) {
        dryRunItems.push(replayItem(binding, "ambiguous", {
          reason: "multiple legacy-inbound rows match this id",
          retryable: false,
        }));
      }
      continue;
    }
    dryRunItems.push(await replayOneMessage(store, options.fetchRawMessage, bindings[0]!, false));
  }
  const sortedDryRun = [...dryRunItems]
    .sort((left, right) =>
      `${left.tenant_id}\0${left.message_id}`.localeCompare(`${right.tenant_id}\0${right.message_id}`));
  const dryRunSha256 = createHash("sha256").update(canonicalJson(sortedDryRun)).digest("hex");
  if (!apply) {
    return { mode: "dry-run", limit, items: sortedDryRun, result_sha256: dryRunSha256 };
  }
  if (options.reviewedDryRunSha256!.toLowerCase() !== dryRunSha256) {
    throw new Error("gmail recovery replay reviewed dry-run sha256 does not match the recomputed dry-run");
  }
  const applyItems: GmailRecoveryReplayItem[] = [];
  for (const messageId of messageIds.slice(0, limit)) {
    const bindings = await store.getLegacyInboundPayloadBindings(messageId);
    if (bindings.length === 0) continue;
    for (const binding of bindings) {
      applyItems.push(await replayOneMessage(store, options.fetchRawMessage, binding, true));
    }
  }
  const sortedApply = [...applyItems]
    .sort((left, right) =>
      `${left.tenant_id}\0${left.message_id}`.localeCompare(`${right.tenant_id}\0${right.message_id}`));
  return {
    mode: "apply",
    limit,
    items: sortedApply,
    result_sha256: createHash("sha256").update(canonicalJson(sortedApply)).digest("hex"),
  };
}

export interface GmailRecoveryReplaySucceededResult {
  report: GmailRecoveryReplayReport;
  dry_run_sha256: string;
}

export function gmailRecoveryReplaySucceeded(report: GmailRecoveryReplayReport): boolean {
  const allowed = report.mode === "apply"
    ? new Set<GmailRecoveryReplayItemStatus>(["replayed", "already_complete"])
    : new Set<GmailRecoveryReplayItemStatus>(["would_replay", "already_complete"]);
  const sorted = replayReportItems(report);
  const identities = sorted.map((item) => `${item.tenant_id}\0${item.message_id}`);
  return report.items.length > 0
    && new Set(identities).size === identities.length
    && report.items.every((item) => allowed.has(item.status));
}

/** Privacy-safe report: identifiers and statuses only, never payload bytes. */
export function redactedGmailRecoveryReport(report: GmailRecoveryReplayReport): Record<string, unknown> {
  return {
    mode: report.mode,
    limit: report.limit,
    result_sha256: report.result_sha256,
    items: replayReportItems(report).map((item) => ({
      tenant_id: item.tenant_id,
      message_id: item.message_id,
      status: item.status,
      attachments: item.attachments,
      ...(item.reason ? { reason: item.reason } : {}),
      ...(item.retryable === undefined ? {} : { retryable: item.retryable }),
    })),
  };
}

export function finalizeGmailRecoveryReplay(
  report: GmailRecoveryReplayReport,
  emit: (line: string) => void = (line) => console.log(line),
): GmailRecoveryReplayReport {
  emit(JSON.stringify(redactedGmailRecoveryReport(report)));
  if (!gmailRecoveryReplaySucceeded(report)) {
    throw new Error("gmail recovery replay did not complete successfully");
  }
  return report;
}

export interface GmailRecoveryReconcileCommandOptions {
  emitIds: boolean;
  limit: number;
}

/**
 * Operator command: read-only census of the legacy-inbound payload-missing
 * population. No Gmail configuration is required — the census reads stored
 * state only.
 */
export async function runGmailRecoveryReconcile(
  options: GmailRecoveryReconcileCommandOptions,
  emit: (line: string) => void = (line) => console.log(line),
): Promise<GmailRecoveryReconcileResult> {
  if (!process.env["HASNA_EMAILS_DATABASE_URL"]) {
    throw new Error("gmail recovery reconcile requires HASNA_EMAILS_DATABASE_URL");
  }
  const { client } = getSelfHostedPool();
  try {
    const store = new EmailsSelfHostedStore(client);
    const result = await reconcileLegacyInboundMissingPayloads(store, {
      emitIds: options.emitIds,
      limit: options.limit,
    });
    emit(JSON.stringify({
      scanned_messages: result.scanned_messages,
      missing_payload_attachments: result.missing_payload_attachments,
      by_key_class: result.by_key_class,
      manifest_emitted: result.manifest_emitted,
      ...(result.manifest_emitted > 0 ? { manifest: result.manifest } : {}),
    }));
    return result;
  } finally {
    await closeSelfHostedPool();
  }
}

export interface GmailRecoveryReplayCommandOptions {
  messageIds: string[];
  apply: boolean;
  reviewedDryRunSha256?: string;
  limit: number;
}

/**
 * Operator command: bounded exact-id replay from the Gmail source mailbox.
 * Fail-closed when EMAILS_GMAIL_ACCESS_TOKEN is not configured — running this
 * against production is an ops action and this module never does it.
 */
export async function runGmailRecoveryReplay(
  options: GmailRecoveryReplayCommandOptions,
  emit: (line: string) => void = (line) => console.log(line),
): Promise<GmailRecoveryReplayReport> {
  if (!process.env["HASNA_EMAILS_DATABASE_URL"]) {
    throw new Error("gmail recovery replay requires HASNA_EMAILS_DATABASE_URL");
  }
  const config = resolveGmailRecoveryConfig(process.env);
  if (!config) {
    throw new Error(
      `gmail recovery replay requires ${GMAIL_RECOVERY_CONFIG_ENV} as the source credential; ` +
      "provision it through the secrets path before running the replay",
    );
  }
  const fetchRawMessage = createGmailRawMessageFetcher(config);
  const { client } = getSelfHostedPool();
  try {
    const store = new EmailsSelfHostedStore(client);
    const report = await replayLegacyInboundAttachments(store, {
      messageIds: options.messageIds,
      apply: options.apply,
      reviewedDryRunSha256: options.reviewedDryRunSha256,
      limit: options.limit,
      fetchRawMessage,
    });
    return finalizeGmailRecoveryReplay(report, emit);
  } finally {
    await closeSelfHostedPool();
  }
}
