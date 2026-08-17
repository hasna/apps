/**
 * Write-time enforcement for the `work-status` lifecycle stream.
 *
 * The fleet schema (global-work-status-lifecycle) requires every tracked work
 * item to emit at most ONE event per real lifecycle transition, and requires
 * the first line of every message in the `work-status` channel to use this
 * exact finite shape:
 *
 *   STATE event_id=<uuid> task_id=<full-task-uuid> scope=<kind:stable-id>
 *         agent=<registered-name> session=<session-uuid> at=<RFC3339Z>
 *         claim=<stable-claim-id-or-dash> evidence=<stable-pointer-or-dash>
 *
 * Measured violations (2026-08-17 census of all 1235 channel messages):
 *  - 96 same-state consecutive duplicate transitions for one task_id with
 *    distinct event_ids (START 36, BLOCKED 26, DONE 16, RESUMED 14,
 *    CANCELLED 4), e.g. task START at 19:12:36Z and again at 19:13:33Z;
 *  - an entire JSON document used as the first line;
 *  - an empty `event_id=` value;
 *  - invalid state tokens (CONTINUE, the literal template word STATE,
 *    IN_PROGRESS, PENDING, PROGRESS);
 *  - an extra `outcome=` field alongside a missing `claim=` field.
 *
 * This module rejects those classes at write time, in both the SQLite path
 * (src/lib/messages.ts) and the Postgres server path (src/server/api.ts), so
 * any consumer that derives state from the stream can trust its shape. It
 * holds no storage dependency, mirroring the unknownChannelMessage precedent:
 * a guard present on only one backend is absent exactly where it matters.
 *
 * Plain prose in the channel is not an event and is NOT rejected — the guard
 * only fires on lines that claim to be lifecycle events (a first token that
 * names a state, any `key=` field of the schema, or a JSON document) and on
 * consecutive duplicate transitions.
 */

export const WORK_STATUS_CHANNEL = "work-status";

export const WORK_STATUS_STATES = ["START", "BLOCKED", "RESUMED", "DONE", "CANCELLED"] as const;

export type WorkStatusState = (typeof WORK_STATUS_STATES)[number];

export const WORK_STATUS_FIELDS = [
  "event_id",
  "task_id",
  "scope",
  "agent",
  "session",
  "at",
  "claim",
  "evidence",
] as const;

/**
 * Window within which a re-emission of the SAME state for the SAME task is a
 * duplicate. The measured duplicate pairs sit seconds to ~a minute apart;
 * five minutes is wide enough to catch the class while still allowing a
 * genuinely new same-state transition (which per the lifecycle semantics
 * requires an intervening different state anyway).
 */
export const WORK_STATUS_DEDUPE_WINDOW_MS = 5 * 60_000;

export class WorkStatusSchemaError extends Error {
  constructor(message: string) {
    super(`Work-status lifecycle schema violation: ${message}`);
    this.name = "WorkStatusSchemaError";
  }
}

export interface WorkStatusEvent {
  state: WorkStatusState;
  event_id: string;
  task_id: string;
  scope: string;
  agent: string;
  session: string;
  at: string;
  atMs: number;
  claim: string;
  evidence: string;
}

const VALUE_RE = /^[^\s=]{1,128}$/;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function isJsonDocument(firstToken: string): boolean {
  return firstToken.startsWith("{") || firstToken.startsWith("[");
}

function isJsonObject(firstLine: string): boolean {
  const trimmed = firstLine.trim();
  if (!isJsonDocument(trimmed)) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === "object";
  } catch {
    return false;
  }
}

function eventLineAttempt(firstLine: string): boolean {
  if (isJsonDocument(firstLine)) return true;
  const firstToken = firstLine.split(/\s+/, 1)[0] ?? "";
  if ((WORK_STATUS_STATES as readonly string[]).includes(firstToken)) return true;
  return /\bevent_id=/.test(firstLine) || /\btask_id=/.test(firstLine);
}

/**
 * Parse and validate the first line of a `work-status` message.
 *
 * Returns the parsed event when the line is a well-formed lifecycle event.
 * Returns null when the first line is plain prose with no event markers — the
 * guard deliberately leaves non-event messages alone.
 * Throws WorkStatusSchemaError when the first line CLAIMS to be an event (a
 * state token, a schema key, or a JSON document) but does not satisfy the
 * exact finite schema.
 */
export function parseWorkStatusEvent(content: string): WorkStatusEvent | null {
  const firstLine = (content ?? "").split(/\r?\n/, 1)[0] ?? "";
  const trimmed = firstLine.trim();
  if (!trimmed) return null;
  if (!eventLineAttempt(trimmed)) return null;

  if (isJsonObject(trimmed)) {
    throw new WorkStatusSchemaError(
      `first line is a JSON document, not the lifecycle-schema line. ` +
        `The first line must be "STATE event_id=<uuid> task_id=<uuid> scope=<kind:stable-id> ` +
        `agent=<name> session=<uuid> at=<RFC3339Z> claim=<...> evidence=<...>".`,
    );
  }

  const tokens = trimmed.split(/\s+/);
  // The schema line leads with the bare state token, e.g.
  // "START event_id=..."; the state is never a `state=` field.
  const state = tokens[0] ?? "";
  if (state.includes("=")) {
    throw new WorkStatusSchemaError(
      `first token "${state}" must be the bare state (one of ${WORK_STATUS_STATES.join(", ")}), ` +
        `followed by the key=value fields.`,
    );
  }
  if (!(WORK_STATUS_STATES as readonly string[]).includes(state)) {
    throw new WorkStatusSchemaError(
      `invalid state "${state || "(missing)"}" (must be one of ${WORK_STATUS_STATES.join(", ")}).`,
    );
  }

  const fields = new Map<string, string>();
  for (const token of tokens.slice(1)) {
    const eq = token.indexOf("=");
    if (eq < 1) {
      throw new WorkStatusSchemaError(
        `token "${token}" is not a key=value field. The first line must be ` +
          `"STATE event_id=<uuid> task_id=<uuid> scope=<kind:stable-id> agent=<name> ` +
          `session=<uuid> at=<RFC3339Z> claim=<...> evidence=<...>".`,
      );
    }
    const key = token.slice(0, eq);
    const value = token.slice(eq + 1);
    if (fields.has(key)) {
      throw new WorkStatusSchemaError(`field "${key}" appears more than once on the first line.`);
    }
    fields.set(key, value);
  }

  const missing = WORK_STATUS_FIELDS.filter((field) => !fields.has(field));
  if (missing.length > 0) {
    throw new WorkStatusSchemaError(
      `missing required field${missing.length > 1 ? "s" : ""} ${missing.join(", ")}. ` +
        `All of ${WORK_STATUS_FIELDS.join(", ")} are required.`,
    );
  }

  const extra = [...fields.keys()].filter((key) => !(WORK_STATUS_FIELDS as readonly string[]).includes(key));
  if (extra.length > 0) {
    throw new WorkStatusSchemaError(
      `unexpected field${extra.length > 1 ? "s" : ""} ${extra.join(", ")}; ` +
        `allowed fields are ${WORK_STATUS_FIELDS.join(", ")}.`,
    );
  }

  const fieldValue = (key: string): string => {
    const value = fields.get(key) ?? "";
    if (value === "-") return value;
    if (!VALUE_RE.test(value)) {
      throw new WorkStatusSchemaError(
        `field "${key}" has an invalid value; expected a single non-empty token, got "${value}".`,
      );
    }
    return value;
  };

  const eventId = fieldValue("event_id");
  const taskId = fieldValue("task_id");
  const scope = fieldValue("scope");
  const agent = fieldValue("agent");
  const session = fieldValue("session");
  const claim = fieldValue("claim");
  const evidence = fieldValue("evidence");

  const at = fields.get("at") ?? "";
  if (!RFC3339_RE.test(at)) {
    throw new WorkStatusSchemaError(`field "at" is not RFC3339 ("${at}").`);
  }
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs)) {
    throw new WorkStatusSchemaError(`field "at" is not a parseable timestamp ("${at}").`);
  }

  return { state: state as WorkStatusState, event_id: eventId, task_id: taskId, scope, agent, session, at, atMs, claim, evidence };
}

/**
 * Write-time gate shared by the SQLite path (src/lib/messages.ts) and the
 * Postgres server path (src/server/api.ts).
 *
 * When `channelName` is the work-status channel this validates the message's
 * first line against the exact lifecycle schema and rejects duplicate
 * same-state transitions. `recentChannelContents` must supply the most recent
 * messages of the channel, newest first, so the dedupe check can find the
 * previous event for the same task_id. Any other channel is untouched.
 */
export function enforceWorkStatusEventWrite(
  channelName: string | null,
  content: string,
  recentChannelContents: () => Iterable<string>,
): void {
  if (channelName !== WORK_STATUS_CHANNEL) return;
  const event = parseWorkStatusEvent(content);
  if (!event) return;
  for (const previousContent of recentChannelContents()) {
    let previous: WorkStatusEvent | null;
    try {
      previous = parseWorkStatusEvent(previousContent);
    } catch {
      // An earlier malformed line cannot carry a duplicate transition; keep
      // scanning for the previous well-formed event of this task.
      continue;
    }
    if (previous && previous.task_id === event.task_id) {
      assertNotDuplicateWorkStatusTransition(previous, event);
      break;
    }
  }
}
/**
 * Dedupe check: the lifecycle mandate allows ONE event per real transition, so
 * a same-state event for the same task_id recorded shortly after the previous
 * one for that task is a duplicate (distinct event_ids notwithstanding).
 * The check only fires against the MOST RECENT event for the same task — an
 * intervening different state makes the new same-state emission a genuinely
 * new transition.
 */
export function assertNotDuplicateWorkStatusTransition(previous: WorkStatusEvent, current: WorkStatusEvent): void {
  if (previous.task_id !== current.task_id) return;
  if (previous.state !== current.state) return;
  if (Math.abs(current.atMs - previous.atMs) > WORK_STATUS_DEDUPE_WINDOW_MS) return;
  throw new WorkStatusSchemaError(
    `duplicate ${current.state} event for task ${current.task_id}: a ${previous.state} event for the ` +
      `same task was already recorded at ${previous.at} (event_id=${previous.event_id}); the lifecycle ` +
      `schema allows one event per real transition.`,
  );
}
