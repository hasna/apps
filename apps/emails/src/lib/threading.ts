/**
 * Email threading helpers — PURE. RFC 5322 Message-ID generation and the
 * In-Reply-To / References chain that groups a conversation.
 *
 * Threading rule (RFC 5322 §3.6.4): a reply's In-Reply-To is the PARENT's
 * Message-ID; its References is the parent's References PLUS the parent's
 * Message-ID (the full ancestry), so deep threads chain back to the root.
 */

export function generateMessageId(domain: string, localPart?: string): string {
  const id = localPart ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `<${id}@${domain}>`;
}

export interface ParentRef {
  message_id: string;
  references: string[];
}

export interface ThreadingHeaders {
  inReplyTo: string;
  references: string[];
  inReplyToHeader: string;
  referencesHeader: string;
}

export function buildThreadingHeaders(parent: ParentRef): ThreadingHeaders {
  const references = [...parent.references];
  if (!references.includes(parent.message_id)) references.push(parent.message_id);
  return {
    inReplyTo: parent.message_id,
    references,
    inReplyToHeader: parent.message_id,
    referencesHeader: references.join(" "),
  };
}

export function parseReferences(header: string | undefined | null): string[] {
  if (!header) return [];
  // Prefer extracting <...> Message-IDs (robust to space/comma separators).
  const matches = header.match(/<[^>]+>/g);
  if (matches) return matches;
  return header.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Normalize an RFC 5322 Message-ID to its angle-bracketed form. Idempotent:
 * `<a@b>`, `a@b` and `  <a@b> ` all normalize to `<a@b>`; an empty/blank value
 * normalizes to `""` (never `<>`).
 */
export function normalizeMessageId(value: string): string {
  const bare = value.trim().replace(/^</, "").replace(/>$/, "").trim();
  return bare ? `<${bare}>` : "";
}

export interface ReplyThreading {
  /** The PARENT's Message-ID, or null for a message that starts a thread. */
  in_reply_to: string | null;
  /** Full ancestry chain (oldest→newest) of Message-IDs, deduplicated. */
  references: string[];
  /** RFC 5322 headers to transmit; `Message-ID` is present whenever one was given. */
  headers: Record<string, string>;
}

/**
 * Derive the RFC 5322 threading headers for an outbound message.
 *
 * `ownMessageId` is THIS message's Message-ID. The caller must generate it
 * DETERMINISTICALLY (from the idempotency key) rather than at random: an
 * idempotent replay of the same send has to reproduce the same headers, or the
 * stored `send_payload_hash` no longer matches and a legitimate retry is
 * refused as an idempotency-key conflict.
 *
 * `parentReferences` and `parentMessageId` come from the resolved parent;
 * `extraReferences` are caller-supplied Message-IDs naming ancestors the
 * parent's own chain may omit. Duplicates are dropped and order preserved, with
 * the parent's Message-ID last — RFC 5322 §3.6.4 requires the References chain
 * to be the parent's chain followed by the parent's own Message-ID.
 */
export function deriveReplyThreading(input: {
  ownMessageId: string;
  parentMessageId?: string | null;
  parentReferences?: readonly string[];
  extraReferences?: readonly string[];
}): ReplyThreading {
  const inReplyTo = input.parentMessageId ? normalizeMessageId(input.parentMessageId) : "";
  const references: string[] = [];
  const push = (value: string): void => {
    const normalized = normalizeMessageId(value);
    if (normalized && !references.includes(normalized)) references.push(normalized);
  };
  for (const ref of input.parentReferences ?? []) push(ref);
  for (const ref of input.extraReferences ?? []) push(ref);
  if (inReplyTo) push(inReplyTo);

  const headers: Record<string, string> = {};
  const ownMessageId = input.ownMessageId ? normalizeMessageId(input.ownMessageId) : "";
  if (ownMessageId) headers["Message-ID"] = ownMessageId;
  if (inReplyTo) headers["In-Reply-To"] = inReplyTo;
  if (references.length) headers["References"] = references.join(" ");

  return { in_reply_to: inReplyTo || null, references, headers };
}
