import { canonicalSender } from "./email-address.js";

/** A single bounded RFC Message-ID; opaque provider/ledger IDs are not accepted. */
export function canonicalRfcMessageId(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 900 || /[^\x20-\x7e]/.test(value)) return null;
  const text = value.trim();
  const id = text.startsWith("<") && text.endsWith(">") ? text.slice(1, -1) : text;
  // RFC 5322 modern msg-id grammar: dot-atom-text / no-fold-literal.
  const atom = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/;
  const at = id.indexOf("@");
  if (id.length > 898 || at <= 0) return null;
  const left = id.slice(0, at), right = id.slice(at + 1);
  return atom.test(left) && (atom.test(right) || /^\[[\x21-\x5a\x5e-\x7e]*\]$/.test(right)) ? `<${id}>` : null;
}

/** Duplicate names or non-text values are ambiguous and cannot supply a header. */
export function replyHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return undefined;
  const entries = Object.entries(headers).filter(([key]) => key.toLowerCase() === name.toLowerCase());
  if (entries.length !== 1 || typeof entries[0]![1] !== "string") return undefined;
  return entries[0]![1] as string;
}

/** Parse mailbox lists without splitting a quoted display name at its comma. */
export function replyMailboxes(value: unknown): string[] | null {
  if (typeof value !== "string" || !value.trim() || value.length > 8192 || /[\r\n\x00-\x1f\x7f]/.test(value)) return null;
  const parts: string[] = []; let start = 0, quoted = false, escaped = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && c === "\\") { escaped = true; continue; }
    if (c === '"') quoted = !quoted;
    if (!quoted && c === ",") { parts.push(value.slice(start, i)); start = i + 1; }
  }
  if (quoted || escaped) return null;
  parts.push(value.slice(start));
  if (parts.length > 100) return null;
  const addresses = parts.map(canonicalSender);
  return addresses.some(address => address === null) ? null : [...new Set(addresses as string[])];
}

export class ReplyHeaderError extends Error {
  constructor(readonly reason: string, readonly status: number, message: string) { super(message); }
}

export interface ReplyParent {
  direction: string;
  from_addr: string;
  to_addrs: string[];
  cc_addrs: string[];
  subject: string | null;
  message_id: string | null;
  in_reply_to: string | null;
  headers: Record<string, unknown>;
}

/** Absence is allowed; present ambiguous or malformed evidence must not disappear. */
function parentHeader(headers: Record<string, unknown>, name: string, reason: string): string | undefined {
  const entries = Object.entries(headers).filter(([key]) => key.toLowerCase() === name);
  if (!entries.length) return undefined;
  if (entries.length !== 1 || typeof entries[0]![1] !== "string" || !(entries[0]![1] as string).trim()) {
    throw new ReplyHeaderError(reason, 409, "The parent has ambiguous or malformed transport headers.");
  }
  return entries[0]![1] as string;
}

function parentReferences(value: string | null | undefined): string[] | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 900 || /[\r\n\x00-\x1f\x7f]/.test(value)) {
    throw new ReplyHeaderError("reply_parent_references_invalid", 409, "The parent's References header is malformed or exceeds the supported bound.");
  }
  const refs = value.trim().split(/\s+/).map(canonicalRfcMessageId);
  if (refs.some(value => value === null)) throw new ReplyHeaderError("reply_parent_references_invalid", 409, "The parent's References header is malformed or exceeds the supported bound.");
  return refs as string[];
}

/** Derive transport-owned headers only from a scoped, authorized parent record. */
export function deriveReplyHeaders(parent: ReplyParent, from: string, subject: string): Record<string, string> {
  const participants = parent.direction === "outbound" ? [parent.from_addr] : [...parent.to_addrs, ...parent.cc_addrs];
  if (!participants.some(address => canonicalSender(address) === from)) throw new ReplyHeaderError("reply_sender_mismatch", 403, "The sender is not an authorized participant of the reply parent.");
  const normalizeSubject = (value: string) => value.replace(/^(?:\s*re\s*:\s*)+/i, "").trim();
  if (normalizeSubject(subject) !== normalizeSubject(parent.subject ?? "")) throw new ReplyHeaderError("reply_subject_mismatch", 400, "A reply must retain the parent's subject, with an optional Re: prefix.");
  const rawHeaderId = parentHeader(parent.headers, "message-id", "reply_parent_identity_invalid");
  const headerId = canonicalRfcMessageId(rawHeaderId);
  if (rawHeaderId !== undefined && !headerId) throw new ReplyHeaderError("reply_parent_identity_invalid", 409, "The parent has a malformed RFC Message-ID header.");
  const references = parentReferences(parentHeader(parent.headers, "references", "reply_parent_references_invalid"));
  const headerReply = parentReferences(parentHeader(parent.headers, "in-reply-to", "reply_parent_references_invalid"));
  const recordReply = parentReferences(parent.in_reply_to);
  const recordId = canonicalRfcMessageId(parent.message_id);
  if (headerId && recordId && headerId !== recordId) throw new ReplyHeaderError("reply_parent_identity_conflict", 409, "The parent has conflicting RFC Message-ID evidence.");
  const id = headerId ?? recordId;
  if (!id) throw new ReplyHeaderError("reply_parent_message_id_unavailable", 409, "The parent's actual RFC Message-ID is unavailable; wait for provider evidence or ingest the original message before replying.");
  const refs = references ?? recordReply ?? headerReply ?? [];
  const chain = [...new Set([...refs, id])].join(" ");
  if (chain.length > 900) throw new ReplyHeaderError("reply_parent_references_invalid", 409, "The reply's References header exceeds the supported bound.");
  return { "In-Reply-To": id, References: chain };
}
