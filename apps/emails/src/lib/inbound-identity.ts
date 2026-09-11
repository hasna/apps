// Content identity for inbound mail: what makes two archived objects THE SAME message.
//
// The SES→S3 ingest path fences on the S3 OBJECT KEY, and that is a fence on the
// DELIVERY rather than on the message. SES mints a fresh message id — and therefore a
// fresh archived object — for each recipient group it delivers to, and it mints another
// one when it redelivers. One KPMG reply to Beep Media's payroll thread was archived
// three times that way (BUG-0050): `inbound/example.test/v0pg38…`, `…/tjr6rd…` and
// `…/hsncnl…`, three objects with distinct keys and byte-identical content, stored as
// three distinct, independently enumerable rows. A per-folder page enumeration then
// counts (and any mirror stores) the same real message three times, so "enumerated"
// stops equalling "distinct messages" — the reconciliation accuracy every project
// mirror depends on.
//
// The message's real identity is the RFC `Message-ID` header, and it is already parsed
// on every ingest (`parsed.rfc_message_id`, `parsed.headers["message-id"]`) and then
// thrown away. This module is the normalization that turns those parsed fields into the
// identity the store fences on, plus the recipient union a redelivery needs so that
// adopting a duplicate never drops an envelope recipient the tenant was routed.
//
// The identity DELIBERATELY includes from/subject/received_at beside the Message-ID.
// A Message-ID alone is not proof of sameness: broken senders and mailing lists reuse
// ids, and a resend with an edit keeps the id while changing the mail. Requiring the
// envelope-visible content to match as well means a collapse can only ever merge two
// copies of one message, never two messages.

import { flattenHeaders } from "./inbound-mime.js";

export interface InboundMessageIdentity {
  /** RFC `Message-ID`, lowercased and stripped of its angle brackets. */
  rfcMessageId: string;
  /** Lowercased sender, exactly as the duplicate lookup compares it. */
  fromAddr: string;
  /** Subject, or `""` for a message that has none. */
  subject: string;
  /** `Date` header as ISO 8601, or null. */
  receivedAt: string | null;
}

export interface InboundIdentityFields {
  headers?: unknown;
  from_addr?: string | null;
  subject?: string | null;
  received_at?: string | null;
}

/**
 * A COMPARABLE form of an RFC `Message-ID`: angle brackets stripped, trimmed,
 * lowercased. Returns null for an absent or empty value — a message with no
 * `Message-ID` has no content identity and is never collapsed onto another row.
 *
 * Case-folding is safe here and required for the comparison to hold: the store compares
 * against `messages.rfc_message_id`, the STORED GENERATED column migration 0043 derives
 * as `NULLIF(lower(btrim(COALESCE(headers->>'message-id', ''), '<>')), '')`, and the
 * local part of a Message-ID is case-sensitive in theory but generated as a single
 * token in practice.
 */
export function normalizeRfcMessageId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[<>]/g, "").trim().toLowerCase();
  return normalized || null;
}

/**
 * The content identity of an inbound message, or null when it has none (no usable
 * `Message-ID`). Null is the conservative answer: an unidentified message is inserted
 * as its own row, exactly as before this fence existed.
 */
export function inboundMessageIdentity(fields: InboundIdentityFields): InboundMessageIdentity | null {
  const headers = flattenHeaders(fields.headers ?? {});
  // `flattenHeaders` documents lowercased names and gets them from mailparser, but the
  // fence must not depend on the caller's spelling of the header: a raw map that spells
  // it `Message-ID` would otherwise read as "no identity" and silently stop deduping.
  let messageId: unknown = headers["message-id"];
  if (messageId === undefined) {
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === "message-id") {
        messageId = value;
        break;
      }
    }
  }
  const rfcMessageId = normalizeRfcMessageId(messageId);
  if (!rfcMessageId) return null;
  const subject = fields.subject === null || fields.subject === undefined ? "" : String(fields.subject);
  const receivedAt = fields.received_at === null || fields.received_at === undefined || fields.received_at === ""
    ? null
    : String(fields.received_at);
  return {
    rfcMessageId,
    fromAddr: String(fields.from_addr ?? "").trim().toLowerCase(),
    subject,
    receivedAt,
  };
}

/**
 * Union of the recipient lists of two deliveries of ONE message, in first-seen order.
 *
 * The canonical row keeps every recipient the tenant was routed for: when SES splits a
 * single message across objects by envelope recipient group, adopting the second object
 * must not make the first group's mailboxes disappear from the stored row.
 */
export function mergeRecipientLists(
  existing: readonly unknown[],
  incoming: readonly unknown[],
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of [...existing, ...incoming]) {
    const address = String(value ?? "").trim();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    merged.push(address);
  }
  return merged;
}
