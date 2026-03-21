import { createTicket } from "../db/tickets.ts";
import { createComment } from "../db/comments.ts";
import { getTicketById } from "../db/tickets.ts";
import { resolveTicketId } from "../db/database.ts";
import { getDatabase } from "../db/database.ts";
import { generateReplyToken, verifyReplyToken } from "./reply-token.ts";
import type { TicketSource } from "../types/index.ts";

export interface ParsedEmail {
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
}

/**
 * Parse the To address to determine if this is:
 * - A new ticket: support@domain.com
 * - A reply: reply+TICKET-0042+TOKEN@domain.com
 */
export function parseToAddress(to: string): { type: "new" } | { type: "reply"; ticketId: string; token: string } {
  const match = /^reply\+([^+]+)\+([^@]+)@/.exec(to.toLowerCase());
  if (match) {
    return { type: "reply", ticketId: match[1]!, token: match[2]! };
  }
  return { type: "new" };
}

const getReplySecret = () => process.env["TICKETS_getReplySecret()"] ?? "dev-secret-change-in-production";

/**
 * Process an inbound email — either creates a new ticket or appends a comment.
 * Returns the ticket short_id that was created or updated.
 */
export async function processInboundEmail(
  email: ParsedEmail,
  projectId: string,
  source: TicketSource = "email",
  secretOverride?: string
): Promise<{ action: "created" | "commented"; short_id: string }> {
  const primaryTo = email.to[0] ?? "";
  const intent = parseToAddress(primaryTo);
  const secret = secretOverride ?? getReplySecret();

  if (intent.type === "reply") {
    const db = getDatabase();
    const ticketUUID = resolveTicketId(db, intent.ticketId);
    if (!ticketUUID) throw new Error(`Ticket not found: ${intent.ticketId}`);

    // Verify the reply token to prevent spoofing
    const valid = verifyReplyToken(intent.ticketId, email.from, intent.token, secret);
    if (!valid) throw new Error("Invalid reply token — possible spoofing attempt");

    const content = email.text ?? email.html ?? "(no content)";
    createComment({ ticket_id: ticketUUID, content: content.trim(), type: "comment" });

    const ticket = getTicketById(ticketUUID);
    return { action: "commented", short_id: ticket.short_id };
  }

  // New ticket
  const title = stripEmailSubjectPrefixes(email.subject ?? "No subject");
  const description = email.text ?? email.html ?? undefined;

  const ticket = createTicket({
    project_id: projectId,
    title: title.slice(0, 255),
    description,
    source,
    type: "question", // default for email-submitted tickets
  });

  return { action: "created", short_id: ticket.short_id };
}

/** Strip Re:, Fwd:, [Ticket-123] prefixes from email subjects */
function stripEmailSubjectPrefixes(subject: string): string {
  return subject
    .replace(/^(\s*(re|fwd|fw)\s*:\s*)+/gi, "")
    .replace(/^\s*\[[^\]]+\]\s*/, "")
    .trim() || "No subject";
}

/**
 * Generate the reply-to address for a ticket notification email.
 * e.g. reply+TST-0042+abc123@support.myapp.com
 */
export function buildReplyToAddress(ticketShortId: string, reporterEmail: string, fromDomain: string, secretOverride?: string): string {
  const token = generateReplyToken(ticketShortId, reporterEmail, secretOverride ?? getReplySecret());
  return `reply+${ticketShortId}+${token}@${fromDomain}`;
}
