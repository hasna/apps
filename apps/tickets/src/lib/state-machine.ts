import { VALID_TRANSITIONS, InvalidTransitionError } from "../types/index.ts";
import type { TicketStatus } from "../types/index.ts";

/**
 * Returns true if transitioning from `from` to `to` is allowed.
 */
export function isValidTransition(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return false; // same-status "transition" is not a valid transition
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Throws InvalidTransitionError if the transition is not allowed.
 */
export function assertValidTransition(from: TicketStatus, to: TicketStatus): void {
  if (!isValidTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/**
 * Returns all statuses that can be transitioned to from a given status.
 */
export function getAllowedTransitions(from: TicketStatus): TicketStatus[] {
  return VALID_TRANSITIONS[from] ?? [];
}

/**
 * Returns true if a ticket in this status is considered "active" (not done).
 */
export function isActiveStatus(status: TicketStatus): boolean {
  return status === "open" || status === "in_progress" || status === "in_review";
}

/**
 * Returns true if a ticket in this status is considered "done".
 */
export function isDoneStatus(status: TicketStatus): boolean {
  return status === "resolved" || status === "closed";
}
