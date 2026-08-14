import { enqueue } from "./queue.ts";
import { buildReplyToAddress } from "./inbound.ts";
import type { Ticket, Comment, Agent } from "../types/index.ts";
import type { WebhookEvent } from "../types/index.ts";

const FROM_EMAIL = process.env["TICKETS_FROM_EMAIL"] ?? process.env["SES_FROM_EMAIL"] ?? process.env["RESEND_FROM_EMAIL"] ?? "tickets@localhost";
const BASE_URL = process.env["TICKETS_BASE_URL"] ?? "http://localhost:19428";

function ticketUrl(shortId: string): string {
  return `${BASE_URL}/tickets/${shortId}`;
}

function fromDomain(): string {
  return FROM_EMAIL.split("@")[1] ?? "localhost";
}

export interface NotificationContext {
  ticket: Ticket;
  comment?: Comment;
  assignee?: Agent | null;
  reporter?: Agent | null;
  actor?: Agent | null;
}

/**
 * Dispatch email notification for a ticket event.
 * Fire-and-forget — enqueues to email_queue for async delivery.
 */
export function notify(event: WebhookEvent, ctx: NotificationContext): void {
  const { ticket } = ctx;
  const url = ticketUrl(ticket.short_id);
  const replyTo = ctx.reporter?.email
    ? buildReplyToAddress(ticket.short_id, ctx.reporter.email, fromDomain())
    : undefined;

  switch (event) {
    case "ticket.created": {
      if (!ctx.assignee?.email) return;
      enqueue({
        from: FROM_EMAIL,
        to: [ctx.assignee.email],
        replyTo,
        subject: `[${ticket.short_id}] ${ticket.title}`,
        text: `A new ${ticket.type} has been assigned to you.\n\n${ticket.title}\nPriority: ${ticket.priority}\n\nView: ${url}`,
        html: `<p>A new <strong>${ticket.type}</strong> has been assigned to you.</p><h3><a href="${url}">[${ticket.short_id}] ${ticket.title}</a></h3><p>Priority: <strong>${ticket.priority}</strong></p>`,
      });
      break;
    }

    case "ticket.assigned": {
      if (!ctx.assignee?.email) return;
      enqueue({
        from: FROM_EMAIL,
        to: [ctx.assignee.email],
        replyTo,
        subject: `[${ticket.short_id}] Assigned to you: ${ticket.title}`,
        text: `Ticket ${ticket.short_id} has been assigned to you.\n\n${ticket.title}\n\nView: ${url}`,
        html: `<p>Ticket has been assigned to you.</p><h3><a href="${url}">[${ticket.short_id}] ${ticket.title}</a></h3>`,
      });
      break;
    }

    case "comment.created": {
      const recipients = new Set<string>();
      if (ctx.reporter?.email) recipients.add(ctx.reporter.email);
      if (ctx.assignee?.email) recipients.add(ctx.assignee.email);
      if (recipients.size === 0) return;

      const comment = ctx.comment;
      if (!comment || comment.is_internal) return; // don't notify on internal notes

      enqueue({
        from: FROM_EMAIL,
        to: Array.from(recipients),
        replyTo,
        subject: `Re: [${ticket.short_id}] ${ticket.title}`,
        text: `New comment on ${ticket.short_id}:\n\n${comment.content}\n\nView: ${url}`,
        html: `<p>New comment on <a href="${url}">[${ticket.short_id}] ${ticket.title}</a>:</p><blockquote>${comment.content}</blockquote>`,
      });
      break;
    }

    case "ticket.closed":
    case "ticket.status_changed": {
      if (!ctx.reporter?.email) return;
      const isDone = ticket.status === "closed" || ticket.status === "resolved";
      if (!isDone) return; // only notify reporter on done states

      enqueue({
        from: FROM_EMAIL,
        to: [ctx.reporter.email],
        subject: `[${ticket.short_id}] ${ticket.status === "closed" ? "Closed" : "Resolved"}: ${ticket.title}`,
        text: `Your ticket has been ${ticket.status}.\n\n${ticket.title}${ticket.resolution ? `\nResolution: ${ticket.resolution}` : ""}\n\nView: ${url}`,
        html: `<p>Your ticket has been <strong>${ticket.status}</strong>.</p><h3><a href="${url}">[${ticket.short_id}] ${ticket.title}</a></h3>${ticket.resolution ? `<p>Resolution: <strong>${ticket.resolution}</strong></p>` : ""}`,
      });
      break;
    }

    default:
      break;
  }
}

/** SLA breach notification — sent to assignee + admins */
export function notifySlaBreached(ticket: Ticket, assigneeEmail?: string): void {
  const url = ticketUrl(ticket.short_id);
  const to: string[] = [];
  if (assigneeEmail) to.push(assigneeEmail);
  if (to.length === 0) return;

  enqueue({
    from: FROM_EMAIL,
    to,
    subject: `🚨 SLA Breached: [${ticket.short_id}] ${ticket.title}`,
    text: `SLA has been breached for ticket ${ticket.short_id}.\n\nExpected resolution: ${ticket.sla_minutes} minutes\n\n${ticket.title}\n\nView: ${url}`,
    html: `<p><strong>⚠️ SLA Breached</strong> — Ticket has exceeded its target resolution time.</p><h3><a href="${url}">[${ticket.short_id}] ${ticket.title}</a></h3><p>Expected: <strong>${ticket.sla_minutes} minutes</strong></p>`,
  });
}
