/**
 * Work-status lifecycle envelope validator.
 *
 * The single `work-status` Conversations channel is an append-only lifecycle event
 * stream (global-work-status-lifecycle): every event's FIRST LINE must be the exact
 * machine-parseable envelope
 *
 *   STATE event_id=<uuid> task_id=<full-task-uuid> scope=<kind:stable-id>
 *         agent=<registered-name> session=<session-uuid> at=<RFC3339Z>
 *         claim=<stable-claim-id-or-dash> evidence=<stable-pointer-or-dash>
 *
 * with STATE one of START | BLOCKED | RESUMED | DONE | CANCELLED, and all eight
 * fields present exactly once. An optional body of one or two plain-language
 * sentences may follow on later lines and is not part of the envelope.
 *
 * Measured on the live stream (2026-08-17): 26 schema-violating events from at
 * least 7 seats — retired [WORKLOG]/[LIVE-TEST] prefixes, prose first lines, a
 * JSON object envelope, fabricated placeholder event_ids, empty event_id, dash
 * in the session slot, missing claim/evidence fields. This module is the
 * write-time guard that makes those shapes unreachable through the CLI send
 * path, and the parser for any consumer that needs to read the stream.
 */

export const WORK_STATUS_CHANNEL = "work-status";

/**
 * Window within which a repeated lifecycle event for the same task is treated
 * as a duplicate emission rather than a real transition. Measured on the live
 * stream (2026-08-17): duplicate START pairs as close as 57s apart and BLOCKED
 * pairs 24s apart, each with a fresh event_id. A task cannot legitimately
 * re-enter the same lifecycle state within a minute, so a same-state re-post
 * for the same task inside this window is a producer double-fire, and the
 * stream's "one event per real transition" invariant (global-work-status-lifecycle)
 * is enforced by refusing it. Shared by every write surface (CLI/MCP, local
 * store, and the hosted /v1 server path) so the windows cannot drift apart.
 */
export const WORK_STATUS_DUPLICATE_WINDOW_MS = 60_000;

export function firstLineOf(content: string): string {
  return content.split(/\r?\n/, 1)[0] ?? "";
}

export const WORK_STATUS_STATES = ["START", "BLOCKED", "RESUMED", "DONE", "CANCELLED"] as const;
export type WorkStatusState = (typeof WORK_STATUS_STATES)[number];

export interface WorkStatusEvent {
  state: WorkStatusState;
  event_id: string;
  task_id: string;
  scope: string;
  agent: string;
  session: string;
  at: string;
  claim: string;
  evidence: string;
}

const WORK_STATUS_FIELDS = ["event_id", "task_id", "scope", "agent", "session", "at", "claim", "evidence"] as const;

/**
 * A well-formed full UUID: 8-4-4-4-12 hex, version nibble 1-8, RFC-4122 variant.
 * Deliberately accepts any version (v1..v8, including v7 timestamps) rather than
 * v4 only, so legitimate IDs are never false-rejected; the placeholder check
 * below handles the fabricated-shape class separately.
 */
const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** RFC 3339 UTC with the mandatory Z designator (schema literal `RFC3339Z`). */
const RFC3339_UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/;

/**
 * A fabricated placeholder UUID: every hex digit identical once the fixed
 * version (position 12) and variant (position 16) nibbles are masked out.
 * Real random UUIDs never look like 11111111-1111-4111-8111-111111111111;
 * measured on the stream as 5 fabricated event_ids sharing that shape.
 */
function isFabricatedPlaceholderUuid(value: string): boolean {
  const hex = value.replace(/-/g, "");
  if (hex.length !== 32) return false;
  const significant = [...hex].filter((_char, index) => index !== 12 && index !== 16);
  return new Set(significant).size === 1;
}

function isUuid(value: string): boolean {
  return FULL_UUID.test(value) && !isFabricatedPlaceholderUuid(value);
}

/**
 * Return a human-readable reason the first line violates the work-status
 * lifecycle envelope, or null when it is a valid envelope.
 *
 * Order-insensitive over the eight fields (so reordering stays machine-parseable)
 * but exact in the field SET: every field exactly once, no extras, no duplicates,
 * no empties.
 */
export function workStatusEnvelopeViolation(firstLine: string): string | null {
  const trimmed = firstLine.trim();
  if (!trimmed) {
    return "the first line is empty; the lifecycle envelope is required on line 1";
  }

  const tokens = trimmed.split(/\s+/);
  const stateToken = tokens[0]!;
  if (!(WORK_STATUS_STATES as readonly string[]).includes(stateToken)) {
    return `first token "${stateToken}" is not one of the five lifecycle states ` +
      `(START|BLOCKED|RESUMED|DONE|CANCELLED)`;
  }

  if (tokens.length < 9) {
    return `envelope is missing required fields: exactly event_id task_id scope agent session at claim evidence must follow the state`;
  }

  const seen = new Set<string>();
  const values = new Map<string, string>();
  for (const token of tokens.slice(1)) {
    const eq = token.indexOf("=");
    if (eq <= 0) {
      return `token "${token}" is not a key=value envelope field`;
    }
    const key = token.slice(0, eq);
    const value = token.slice(eq + 1);
    if (!(WORK_STATUS_FIELDS as readonly string[]).includes(key)) {
      return `unknown envelope field "${key}"; the exact schema has exactly eight fields`;
    }
    if (seen.has(key)) {
      return `duplicated envelope field "${key}"; each field appears exactly once`;
    }
    seen.add(key);
    values.set(key, value);
  }

  if (seen.size !== WORK_STATUS_FIELDS.length) {
    const missing = WORK_STATUS_FIELDS.filter((field) => !seen.has(field));
    return `envelope is missing required field(s): ${missing.join(", ")}`;
  }

  const eventId = values.get("event_id") ?? "";
  if (!eventId) {
    return "event_id is empty; a fresh UUID must be minted for every event";
  }
  if (!isUuid(eventId)) {
    return `event_id "${eventId}" is not a well-formed full UUID (fabricated placeholder shapes are rejected)`;
  }

  const taskId = values.get("task_id") ?? "";
  if (!taskId) {
    return "task_id is empty; the full task UUID is required";
  }
  if (!isUuid(taskId)) {
    return `task_id "${taskId}" is not a well-formed full task UUID`;
  }

  const scope = values.get("scope") ?? "";
  if (!scope) {
    return "scope is empty; use the <kind:stable-id> form (e.g. todos:open-todos)";
  }
  if (!scope.includes(":")) {
    return `scope "${scope}" is not the <kind:stable-id> form (e.g. todos:open-todos)`;
  }

  const agent = values.get("agent") ?? "";
  if (!agent) {
    return "agent is empty; the registered agent name is required";
  }

  const session = values.get("session") ?? "";
  if (!session) {
    return "session is empty; the session UUID is required";
  }
  if (!isUuid(session)) {
    return `session "${session}" is not a well-formed session UUID (the dash is permitted only for claim and evidence)`;
  }

  const at = values.get("at") ?? "";
  if (!at) {
    return "at is empty; the RFC3339 UTC timestamp is required";
  }
  if (!RFC3339_UTC.test(at) || Number.isNaN(Date.parse(at))) {
    return `at "${at}" is not an RFC3339 UTC timestamp (e.g. 2026-08-17T10:00:00Z)`;
  }

  const claim = values.get("claim") ?? "";
  if (!claim) {
    return "claim is empty; use a stable claim id or a dash";
  }

  const evidence = values.get("evidence") ?? "";
  if (!evidence) {
    return "evidence is empty; use a stable pointer or a dash";
  }

  return null;
}

/**
 * Parse a valid work-status lifecycle envelope from its first line.
 * Returns null when the line violates the schema (see workStatusEnvelopeViolation
 * for the reason).
 */
export function parseWorkStatusEvent(firstLine: string): WorkStatusEvent | null {
  if (workStatusEnvelopeViolation(firstLine) !== null) {
    return null;
  }
  const tokens = firstLine.trim().split(/\s+/);
  const fields = new Map<string, string>();
  for (const token of tokens.slice(1)) {
    const eq = token.indexOf("=");
    fields.set(token.slice(0, eq), token.slice(eq + 1));
  }
  return {
    state: tokens[0] as WorkStatusState,
    event_id: fields.get("event_id") ?? "",
    task_id: fields.get("task_id") ?? "",
    scope: fields.get("scope") ?? "",
    agent: fields.get("agent") ?? "",
    session: fields.get("session") ?? "",
    at: fields.get("at") ?? "",
    claim: fields.get("claim") ?? "",
    evidence: fields.get("evidence") ?? "",
  };
}

/**
 * Return the duplicate-transition violation, or null when the event is a real
 * transition. `recentContentsNewestFirst` is the task stream's recent rows
 * (channel = work-status, reply_to IS NULL, created_at within the dedupe
 * window) ordered newest first; only the task's MOST RECENT event decides, so
 * BLOCKED -> RESUMED -> BLOCKED is a real sequence and is not deduped: the
 * measured defect is consecutive same-state pairs, and a same-state row that
 * an intervening different state broke is a genuine re-entry, not a re-post.
 *
 * The decision logic lives here once and is shared by every write surface
 * (the local sendMessage path and the hosted /v1 server handler), so a guard
 * present on only one backend can never be the state of the world again.
 */
export function duplicateWorkStatusTransitionViolation(
  recentContentsNewestFirst: readonly string[],
  event: WorkStatusEvent,
): string | null {
  for (const content of recentContentsNewestFirst) {
    const prior = parseWorkStatusEvent(firstLineOf(content));
    if (prior === null) continue;
    if (prior.task_id !== event.task_id) continue;
    // Newest-first: the first same-task row is that task's most recent event.
    if (prior.state === event.state) {
      return `work-status duplicate transition: ${event.state} for task ${event.task_id} already recorded ` +
        `(event_id ${prior.event_id} at ${prior.at}); one event per real transition`;
    }
    return null;
  }
  return null;
}
