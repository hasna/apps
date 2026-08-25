// MailDataSource — the read/write seam the TUI/CLI/MCP sit behind.
//
// There are exactly two fail-closed backends:
//   • SqliteMailDataSource — local SQLite, with no network/Postgres dependency.
//   • SelfHostedMailDataSource — authenticated operator-owned /v1 HTTP API.
//
// The seam speaks the client's existing domain language (TuiMessage / Folder /
// MailboxCounts / MessageBody / …) so callers stay independent of the backend.

import { getEmailsMode, type EmailsMode } from "./mode.js";
import { getDatabase, resolvePartialIdOrThrow } from "../db/database.js";
import { sqlEmailAddress } from "../db/email-address-sql.js";
import { SelfHostedMailDataSource, resolveSelfHostedMailDataSource } from "./self-hosted-mail-data-source.js";
import {
  addInboundLabelSummary,
  clearInboundEmails,
  deleteInboundEmail,
  getInboundAttachmentPaths,
  getInboundEmailSummary,
  type InboundEmailSummary,
  listInboundInsertionSummariesPage,
  removeInboundLabelSummary,
  setInboundArchivedFlag,
  setInboundReadFlag,
  setInboundStarredFlag,
} from "../db/inbound.local.js";
import {
  getConversation as localGetConversation,
  getConversationBodies as localGetConversationBodies,
  getMessageBody as localGetMessageBody,
  listLabelSummaries as localListLabelSummaries,
  listMailbox as localListMailbox,
  listMailboxSources as localListMailboxSources,
  listMailboxStatus as localListMailboxStatus,
  mailboxCounts as localMailboxCounts,
  sendComposed as localSendComposed,
} from "../cli/tui/data.local.js";
import {
  applyMailboxFilter as localApplyMailboxFilter,
  createMailboxFilter as localCreateMailboxFilter,
  deleteMailboxFilter as localDeleteMailboxFilter,
  getMailboxFilter as localGetMailboxFilter,
  listMailboxFilters as localListMailboxFilters,
  updateMailboxFilter as localUpdateMailboxFilter,
} from "../db/mailbox-filters.local.js";
import { MailboxFilterNotFoundError, type MailboxFilter, type MailboxFilterInput } from "./mailbox-filters.js";
import { listPrioritySenderRulesLocal } from "../db/priority-senders.js";
import { priorityRuleMatchesSender } from "./priority-senders.js";
import type {
  AttachmentPath,
  ConversationBodyOptions,
  LabelSummary,
  ListLabelSummaryOptions,
  ListMailboxSourcesOptions,
  Mailbox,
  MailboxCounts,
  MailboxListOptions,
  MailboxSource,
  MailboxSourceSummary,
  MailboxStatusOptions,
  MailboxStatusSummary,
  MessageBody,
  TuiMessage,
  TuiThreadBody,
  TuiThreadMessage,
  UnreadByAddressRow,
  ComposeInput,
} from "./mail-types.js";
import type {
  VerificationCodeCandidateOptions,
  VerificationCodeEmail,
  VerificationCodeMatch,
} from "./verification-code.js";
// The FACADE, not an arm: the verification-code family has one implementation and its
// candidate read goes through the store seam.
import { findVerificationCode, listVerificationCodeCandidates } from "./verification-code.js";
import {
  decodeAttachmentPayload,
  normalizeAttachmentByteLimit,
  type AttachmentContent,
} from "./attachment-download.js";
import { constants as fsConstants } from "node:fs";
import { open as openFile } from "node:fs/promises";
import { basename } from "node:path";

// ── seam-level DTOs (backend-agnostic) ───────────────────────────────────────

export type MailDataSourceMode = EmailsMode;

export interface MailInsertionsQuery {
  /**
   * Inclusive lower bound on the message's received timestamp.
   *
   * This is an insert-only inventory scan, not a mutation feed: edits and
   * deletions are intentionally not represented.
   */
  receivedSince?: string;
  limit?: number;
  /**
   * Continuation cursor from a prior MailInsertionsPage.cursor. Pass it back
   * with the same `receivedSince` value to resume the same inventory walk.
   */
  cursor?: string;
}

export interface MailInsertionsPage {
  /** Explicit discriminator preventing this page from being treated as general sync. */
  semantics: "insert_only";
  /** Messages observed in this insert-only inventory window. */
  insertions: TuiMessage[];
  /** Continuation cursor if the inventory walk has more rows (else null). */
  cursor: string | null;
}

export interface MailBulkInput {
  action: string;
  ids?: string[];
  mailbox?: Mailbox;
  source?: MailboxSource;
  label?: string;
  cursor?: string;
}

export interface MailBulkResult {
  action: string;
  affected: number;
  matched: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface MailboxFilterApplyResult {
  filter: Pick<MailboxFilter, "name" | "criteria">;
  items: TuiMessage[];
  limit: number;
  offset: number;
  truncated: boolean;
}

/** A base64 inline attachment for local/provider or bounded self-hosted send. */
export interface MailSendAttachment {
  filename: string;
  /** base64-encoded content. */
  content: string;
  content_type: string;
}

export interface MailSendInput {
  from?: string;
  /** Comma-separated recipient list. */
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  /**
   * Explicit HTML body. When set it is used verbatim as the HTML part (e.g. the CLI's
   * `--html`); otherwise `body` is markdown-rendered unless `markdown === false`.
   */
  html?: string;
  markdown?: boolean;
  /** local outbound provider id; self-hosted resolves the sender server-side. */
  providerId?: string;
  /** sending mailbox id (else resolved from `from`). */
  mailboxId?: string;
  /** Message id to reply to (threading). */
  replyToId?: string;
  /** Reply-To header address(es), comma-separated. */
  replyTo?: string;
  /** File attachments. Self-hosted JSON send enforces its documented caps. */
  attachments?: MailSendAttachment[];
  /** ISO-8601 schedule time. Self-hosted send rejects this (no server-side scheduling). */
  scheduledAt?: string;
  /** Stable caller-provided key used to make self-hosted sends retry-safe. */
  idempotencyKey?: string;
  /**
   * RFC 8058 one-click unsubscribe target: local providers inject the
   * List-Unsubscribe / List-Unsubscribe-Post header pair. The self-hosted send
   * contract cannot carry it, so that backend REFUSES rather than mailing
   * without the headers.
   */
  unsubscribeUrl?: string;
  /**
   * Explicit per-send suppression override (the CLI's `--force`). The local
   * backend checks suppression in the caller; the self-hosted client transmits
   * it as `allow_suppressed_recipients`, which the server honors only for
   * tenant-wide send authority.
   */
  allowSuppressedRecipients?: boolean;
}

export interface MailSendResult {
  id: string;
  messageId: string;
  /**
   * The same idempotent send is already being processed. The caller must not
   * report delivery and must not retry with a different key.
   */
  inProgress?: true;
  /**
   * Set when the message WAS sent but a post-send step failed (e.g. ledger
   * finalization). The send succeeded and must not be retried; the warning
   * tells the operator what still needs attention.
   */
  warning?: string;
}

/** Scope for a clear (bulk delete): local optionally scopes by provider. */
export interface MailClearFilter {
  /** Local provider filter; self-hosted resolves this to a mailbox-id scope. */
  providerId?: string;
  /** Folder scope (defaults to inbox). */
  mailbox?: Mailbox;
  /** Mailbox/source scope. */
  source?: MailboxSource;
}

export interface MailClearResult {
  cleared: number;
}

export interface MailDataSource {
  readonly mode: MailDataSourceMode;

  /**
   * Resolve a possibly-partial id to a full id in the selected backend only.
   */
  resolveId(id: string): Promise<string>;

  // reads
  listMailbox(mailbox: Mailbox, opts?: MailboxListOptions): Promise<TuiMessage[]>;
  // countsComplete travels with the counts (O15-00350): when the self-hosted
  // scan could not prove it reached the end of the table, every count is a
  // lower bound and every consumer (TUI sidebar, CLI formatters) must render
  // it as one. Dropping the marker here is how a truncated scan becomes a
  // confident exact total.
  mailboxCounts(opts?: { source?: MailboxSource }): Promise<MailboxCounts & { countsComplete: boolean }>;
  /**
   * Per-recipient unread inbox counts (`inbox unread-count --by-address`).
   * Same predicate on both backends: count each inbound message once per `to`
   * recipient, excluding sent/read/archived only. Covers every parsed
   * recipient address, not just registered ones.
   */
  unreadByAddress(opts?: { limit?: number; offset?: number }): Promise<UnreadByAddressRow[]>;
  listMailboxStatus(opts?: MailboxStatusOptions): Promise<MailboxStatusSummary>;
  listMailboxSources(opts?: ListMailboxSourcesOptions): Promise<MailboxSourceSummary[]>;
  listMailboxFilters(options?: { limit?: number; offset?: number }): Promise<MailboxFilter[]>;
  getMailboxFilter(identifier: string): Promise<MailboxFilter | null>;
  createMailboxFilter(input: MailboxFilterInput): Promise<MailboxFilter>;
  updateMailboxFilter(identifier: string, input: Partial<MailboxFilterInput>): Promise<MailboxFilter>;
  deleteMailboxFilter(identifier: string): Promise<void>;
  applyMailboxFilter(identifier: string, options?: { limit?: number; offset?: number }): Promise<MailboxFilterApplyResult>;
  getMessage(id: string): Promise<TuiMessage | null>;
  getMessageBody(msg: TuiMessage): Promise<MessageBody | null>;
  /**
   * Fetch a message AND its body from a SINGLE underlying row read. `read` needs
   * both, so this collapses getMessage()+getMessageBody() into one round-trip. The
   * `id` may be a short id prefix (the server resolves it). Returns null when no
   * message matches (a clean not-found).
   */
  getMessageWithBody(id: string): Promise<{ msg: TuiMessage; body: MessageBody } | null>;
  getConversation(msg: TuiMessage): Promise<TuiThreadMessage[]>;
  getConversationBodies(msg: TuiMessage, opts?: ConversationBodyOptions): Promise<TuiThreadBody[]>;
  getAttachmentPaths(id: string): Promise<AttachmentPath[]>;
  getAttachmentContent(id: string, index: number, opts?: { maxBytes?: number }): Promise<AttachmentContent>;
  listLabelSummaries(opts?: ListLabelSummaryOptions): Promise<LabelSummary[]>;
  verificationCandidates(address: string, opts?: VerificationCodeCandidateOptions): Promise<VerificationCodeEmail[]>;
  findLatest(address: string, opts?: VerificationCodeCandidateOptions & { from?: string; subject?: string }): Promise<VerificationCodeMatch<VerificationCodeEmail> | null>;
  /**
   * List message insertions by received timestamp.
   *
   * This deliberately cannot be used as a general cache-sync contract:
   * updates and tombstones are not available from the current backing stores.
   */
  listInsertionsSince(opts?: MailInsertionsQuery): Promise<MailInsertionsPage>;

  // writes
  setRead(id: string, read: boolean): Promise<void>;
  setArchived(id: string, archived: boolean): Promise<void>;
  setStarred(id: string, starred: boolean): Promise<void>;
  addLabel(id: string, label: string): Promise<string[]>;
  removeLabel(id: string, label: string): Promise<string[]>;
  deleteMessage(id: string): Promise<void>;
  bulk(input: MailBulkInput): Promise<MailBulkResult>;
  send(input: MailSendInput): Promise<MailSendResult>;
  clear(filter?: MailClearFilter): Promise<MailClearResult>;
}

// ── local SQLite backend ────────────────────────────────────────────────────

function summaryToTuiMessage(summary: InboundEmailSummary): TuiMessage {
  const labels = summary.label_ids ?? [];
  const isPriority = !summary.is_sent && priorityRuleMatchesSender(summary.from_address, listPrioritySenderRulesLocal());
  return {
    kind: summary.is_sent ? "sent" : "inbound",
    id: summary.id,
    from: summary.from_address,
    to: (summary.to_addresses ?? []).join(", "),
    subject: summary.subject || "(no subject)",
    date: summary.received_at,
    is_read: summary.is_sent ? true : Boolean(summary.is_read),
    is_starred: Boolean(summary.is_starred),
    labels,
    snippet: "",
    thread_id: summary.thread_id ?? null,
    provider_thread_id: summary.provider_thread_id ?? null,
    attachments: summary.attachments?.length ?? 0,
    sentByMe: summary.is_sent || labels.some((label) => label.trim().toLowerCase() === "sent"),
    is_priority: isPriority,
  };
}

function localUnreadByAddress(opts?: { limit?: number; offset?: number }): UnreadByAddressRow[] {
  const db = getDatabase();
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const recipientSql = sqlEmailAddress("r.address");
  const rows = db.query(
    `SELECT address, unread
       FROM (
         SELECT ${recipientSql} AS address, COUNT(*) AS unread
           FROM inbound_emails e
           JOIN inbound_recipients r ON r.inbound_email_id = e.id
          WHERE e.is_sent = 0
            AND e.is_read = 0
            AND e.is_archived = 0
          GROUP BY ${recipientSql}
       )
      WHERE instr(address, '@') > 1
      ORDER BY unread DESC, address ASC
      LIMIT ? OFFSET ?`,
  ).all(limit, offset) as Array<{ address: string; unread: unknown }>;
  return rows
    .map((row) => ({ address: row.address, unread: Number(row.unread) || 0 }))
    .filter((row) => row.unread > 0);
}

const LOCAL_BULK_MAX = 1000;
type LocalFlagSetter = (id: string) => void;
const LOCAL_BULK_FLAG_ACTIONS: Record<string, LocalFlagSetter> = {
  markRead: (id) => { setInboundReadFlag(id, true); },
  markUnread: (id) => { setInboundReadFlag(id, false); },
  star: (id) => { setInboundStarredFlag(id, true); },
  unstar: (id) => { setInboundStarredFlag(id, false); },
  archive: (id) => { setInboundArchivedFlag(id, true); },
  unarchive: (id) => { setInboundArchivedFlag(id, false); },
  delete: (id) => { deleteInboundEmail(id); },
};

export class SqliteMailDataSource implements MailDataSource {
  readonly mode = "local" as const;

  async resolveId(id: string): Promise<string> {
    return resolvePartialIdOrThrow(getDatabase(), "inbound_emails", id);
  }

  async listMailbox(mailbox: Mailbox, opts?: MailboxListOptions): Promise<TuiMessage[]> {
    return localListMailbox(mailbox, opts);
  }

  async mailboxCounts(opts?: { source?: MailboxSource }): Promise<MailboxCounts & { countsComplete: boolean }> {
    return localMailboxCounts(opts);
  }

  async unreadByAddress(opts?: { limit?: number; offset?: number }): Promise<UnreadByAddressRow[]> {
    return localUnreadByAddress(opts);
  }

  async listMailboxStatus(opts?: MailboxStatusOptions): Promise<MailboxStatusSummary> {
    return localListMailboxStatus(opts);
  }

  async listMailboxSources(opts?: ListMailboxSourcesOptions): Promise<MailboxSourceSummary[]> {
    return localListMailboxSources(opts);
  }

  async listMailboxFilters(options?: { limit?: number; offset?: number }): Promise<MailboxFilter[]> {
    return localListMailboxFilters(options);
  }

  async getMailboxFilter(identifier: string): Promise<MailboxFilter | null> {
    return localGetMailboxFilter(identifier);
  }

  async createMailboxFilter(input: MailboxFilterInput): Promise<MailboxFilter> {
    return localCreateMailboxFilter(input);
  }

  async updateMailboxFilter(identifier: string, input: Partial<MailboxFilterInput>): Promise<MailboxFilter> {
    return localUpdateMailboxFilter(identifier, input);
  }

  async deleteMailboxFilter(identifier: string): Promise<void> {
    localDeleteMailboxFilter(identifier);
  }

  async applyMailboxFilter(identifier: string, options?: { limit?: number; offset?: number }): Promise<MailboxFilterApplyResult> {
    const filter = localGetMailboxFilter(identifier);
    if (!filter) throw new MailboxFilterNotFoundError(identifier);
    return localApplyMailboxFilter(filter, options);
  }

  async getMessage(id: string): Promise<TuiMessage | null> {
    const summary = getInboundEmailSummary(id);
    return summary ? summaryToTuiMessage(summary) : null;
  }

  async getMessageBody(msg: TuiMessage): Promise<MessageBody | null> {
    return localGetMessageBody(msg);
  }

  async getMessageWithBody(id: string): Promise<{ msg: TuiMessage; body: MessageBody } | null> {
    const msg = await this.getMessage(id);
    if (!msg) return null;
    const body = await this.getMessageBody(msg);
    return body ? { msg, body } : null;
  }

  async getConversation(msg: TuiMessage): Promise<TuiThreadMessage[]> {
    return localGetConversation(msg);
  }

  async getConversationBodies(msg: TuiMessage, opts?: ConversationBodyOptions): Promise<TuiThreadBody[]> {
    return localGetConversationBodies(msg, undefined, opts);
  }

  async getAttachmentPaths(id: string): Promise<AttachmentPath[]> {
    return getInboundAttachmentPaths(id) ?? [];
  }

  async getAttachmentContent(id: string, index: number, opts?: { maxBytes?: number }): Promise<AttachmentContent> {
    const limit = normalizeAttachmentByteLimit(opts?.maxBytes);
    if (!Number.isSafeInteger(index) || index < 0) throw new Error("attachment index must be a non-negative integer");
    const msg = await this.getMessage(id);
    if (!msg) return { state: "not_found", index };
    const body = await this.getMessageBody(msg);
    const metadata = body?.attachments[index];
    if (!metadata) return { state: "not_found", index };
    const paths = await this.getAttachmentPaths(id);
    const unavailable = () => decodeAttachmentPayload(
      { code: "attachment_content_unavailable", attachment: metadata },
      index,
      limit,
    );
    const indexed = paths.filter((entry) => entry.index === index);
    let path: string | undefined;
    if (indexed.length > 0) {
      if (indexed.length !== 1) return unavailable();
      const candidate = indexed[0]!;
      if (candidate.filename !== metadata.filename
        || candidate.content_type !== metadata.content_type
        || candidate.size !== metadata.size) {
        return unavailable();
      }
      path = candidate.local_path;
    } else {
      const legacySanitize = (filename: string) => filename.replace(/[/\\?%*:|"<>]/g, "_");
      const targetAliases = new Set([metadata.filename, legacySanitize(metadata.filename)]);
      const matchingMetadata = body!.attachments.filter((entry) => {
        const aliases = [entry.filename, legacySanitize(entry.filename)];
        return aliases.some((alias) => targetAliases.has(alias));
      });
      const legacyPaths = paths.filter((entry) => {
        if (entry.index !== undefined) return false;
        const aliases = [
          entry.filename,
          entry.local_path ? basename(entry.local_path) : undefined,
          entry.s3_url ? basename(entry.s3_url) : undefined,
        ].filter((alias): alias is string => typeof alias === "string");
        return aliases.some((alias) => targetAliases.has(alias));
      });
      if (matchingMetadata.length !== 1 || matchingMetadata[0] !== metadata || legacyPaths.length !== 1) {
        return unavailable();
      }
      const candidate = legacyPaths[0]!;
      if ((candidate.content_type && candidate.content_type !== metadata.content_type)
        || candidate.size !== metadata.size) {
        return unavailable();
      }
      path = candidate.local_path;
    }
    if (!path) {
      return unavailable();
    }
    const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
    const file = await openFile(path, fsConstants.O_RDONLY | noFollow);
    let data: Buffer;
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error("attachment path is not a regular file");
      if (stat.size > limit) throw new Error(`attachment exceeds byte limit ${limit}`);
      data = await file.readFile();
    } finally {
      await file.close();
    }
    return decodeAttachmentPayload({
      attachment: {
        filename: metadata.filename,
        content_type: metadata.content_type,
        // Preserve the authenticated/stored declaration so the strict decoder
        // detects a file that drifted after metadata was recorded.
        size: metadata.size,
        content_base64: data.toString("base64"),
      },
    }, index, limit);
  }

  async listLabelSummaries(opts?: ListLabelSummaryOptions): Promise<LabelSummary[]> {
    return localListLabelSummaries(opts);
  }

  async verificationCandidates(address: string, opts?: VerificationCodeCandidateOptions): Promise<VerificationCodeEmail[]> {
    return listVerificationCodeCandidates(address, opts);
  }

  async findLatest(address: string, opts?: VerificationCodeCandidateOptions & { from?: string; subject?: string }): Promise<VerificationCodeMatch<VerificationCodeEmail> | null> {
    const candidates = await this.verificationCandidates(address, opts);
    return findVerificationCode(candidates, { from: opts?.from, subject: opts?.subject });
  }

  async listInsertionsSince(opts?: MailInsertionsQuery): Promise<MailInsertionsPage> {
    const page = listInboundInsertionSummariesPage({
      receivedSince: opts?.receivedSince,
      limit: opts?.limit,
      cursor: opts?.cursor,
    });
    return {
      semantics: "insert_only",
      insertions: page.items.map(summaryToTuiMessage),
      cursor: page.cursor,
    };
  }

  async setRead(id: string, read: boolean): Promise<void> { setInboundReadFlag(id, read); }
  async setArchived(id: string, archived: boolean): Promise<void> { setInboundArchivedFlag(id, archived); }
  async setStarred(id: string, starred: boolean): Promise<void> { setInboundStarredFlag(id, starred); }
  async addLabel(id: string, label: string): Promise<string[]> { return addInboundLabelSummary(id, label).label_ids; }
  async removeLabel(id: string, label: string): Promise<string[]> { return removeInboundLabelSummary(id, label).label_ids; }
  async deleteMessage(id: string): Promise<void> { deleteInboundEmail(id); }

  async bulk(input: MailBulkInput): Promise<MailBulkResult> {
    const setter = Object.hasOwn(LOCAL_BULK_FLAG_ACTIONS, input.action)
      ? LOCAL_BULK_FLAG_ACTIONS[input.action]
      : undefined;
    if (!setter) throw new Error(`unsupported local bulk action '${input.action}'`);
    const ids = input.ids?.length
      ? input.ids.slice(0, LOCAL_BULK_MAX)
      : (await this.listMailbox(input.mailbox ?? "inbox", { source: input.source, limit: LOCAL_BULK_MAX })).map((row) => row.id);
    let affected = 0;
    for (const id of ids) {
      try { setter(id); affected += 1; } catch { /* row disappeared between list and write */ }
    }
    return { action: input.action, affected, matched: ids.length, hasMore: false, nextCursor: null };
  }

  async send(input: MailSendInput): Promise<MailSendResult> {
    if (input.scheduledAt) {
      throw new Error("Scheduled sends must use the local schedule command; immediate mail-data-source send does not enqueue jobs.");
    }
    let replyTo: TuiMessage | undefined;
    if (input.replyToId) replyTo = (await this.getMessage(input.replyToId)) ?? undefined;
    const compose: ComposeInput = {
      from: input.from ?? "",
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      replyToAddress: input.replyTo,
      subject: input.subject,
      body: input.body,
      html: input.html,
      attachments: input.attachments,
      idempotencyKey: input.idempotencyKey,
      providerId: input.providerId,
      unsubscribeUrl: input.unsubscribeUrl,
      markdown: input.markdown,
      replyTo,
    };
    return localSendComposed(compose);
  }

  async clear(filter?: MailClearFilter): Promise<MailClearResult> {
    return { cleared: clearInboundEmails(filter?.providerId) };
  }
}

// ── resolver (memoized per process) ───────────────────────────────────────────

export interface ResolveMailDataSourceOptions {
  mode?: MailDataSourceMode;
  selfHosted?: SelfHostedMailDataSource;
}

let memoized: { mode: MailDataSourceMode; source: MailDataSource } | null = null;

/**
 * Resolve exactly one process-wide backend. Self-hosted never falls through to
 * SQLite; local never consults URL/API-key configuration.
 */
export function resolveMailDataSource(opts: ResolveMailDataSourceOptions = {}): MailDataSource {
  const override = Boolean(opts.mode || opts.selfHosted);
  const mode = opts.mode ?? getEmailsMode();
  if (!override && memoized?.mode === mode) {
    return memoized.source;
  }
  let source: MailDataSource;
  if (mode === "self_hosted") {
    const selfHosted = opts.selfHosted ?? resolveSelfHostedMailDataSource();
    if (!selfHosted) {
      throw new Error(
        "Emails self-hosted mode requires EMAILS_SELF_HOSTED_URL and EMAILS_SELF_HOSTED_API_KEY " +
          "(or EMAILS_CLIENT_ENV_SECRET). No hosted endpoint is inferred.",
      );
    }
    source = selfHosted;
  } else {
    source = new SqliteMailDataSource();
  }
  if (!override) memoized = { mode, source };
  return source;
}

/** Clear the memoized data source (tests / after a mode change). */
export function resetMailDataSource(): void {
  memoized = null;
}
