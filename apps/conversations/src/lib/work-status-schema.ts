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
 * only fires on lines that CLAIM to be lifecycle events (a JSON document, any
 * schema `key=` field, or a bare state token FOLLOWED BY at least one
 * key=value field — a prose line that merely starts with a state word such as
 * "DONE — deployment complete" is left alone) and on consecutive duplicate
 * transitions. The `at` value must be strict RFC3339 with a `Z` suffix and a
 * real calendar date; identifiers follow the documented formats (event_id,
 * task_id and session are UUIDs; scope is kind:stable-id).
 *
 * The stream is append-only: the write-time gate is the only writer, and the
 * edit/delete paths (SQLite messages.ts editMessage/deleteMessage, server
 * api.ts message PATCH/DELETE) refuse to touch rows in this channel so the
 * event history and its dedupe anchor can never be rewritten or removed.
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
 *
 * The window is measured from WRITE time (`now`), never from the
 * user-supplied `at` values: an event's claimed timestamp is writer-controlled
 * and an immediate duplicate could otherwise backdate or forwarddate itself
 * past the window.
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
/**
 * Full UUID: 8-4-4-4-12 LOWERCASE hex, as the schema documents for <uuid>
 * fields. Lowercase-only is deliberate: the parsed identifiers feed
 * case-sensitive identity comparisons and SQL LIKE lookups on both backends,
 * and a case-insensitive match would let one UUID written in two casings
 * bypass the same-task duplicate check.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** <kind>:<stable-id> — the fleet's own example is `todos:691ea5e4`. */
const SCOPE_RE = /^[a-z0-9]+:[a-zA-Z0-9_-]{1,96}$/;
/** Strict RFC3339 with a mandatory `Z` suffix. */
const RFC3339Z_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?Z$/;

/**
 * A LIKE pattern that matches the stored serialized `task_id=<id>` marker for
 * one task. task_id is validated as a lowercase full UUID, so no LIKE
 * metacharacters (%, _, \) can appear in the interpolated value; this stays a
 * plain literal match against the marker.
 */
export function workStatusTaskLikePattern(taskId: string): string {
  return `%task_id=${taskId}%`;
}

/**
 * Parse a stored message timestamp into epoch ms. The SQLite store writes
 * UTC wall-clock timestamps without a zone suffix
 * (strftime('%Y-%m-%dT%H:%M:%f','now')), which a bare Date.parse would read
 * as LOCAL time; the codebase convention (parsePresenceTimestamp) appends
 * `Z`. Postgres timestamptz values are returned by the pg driver as Date
 * objects and pass through their epoch ms directly; zone-suffixed strings
 * parse unchanged.
 *
 * A value that is neither a Date nor a string is unreadable and yields 0,
 * which the caller treats as "no usable stored time" — never as a time the
 * dedupe window can fire against.
 */
export function parseStoredWriteTime(value: unknown): number {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  let raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return 0;
  if (!/Z$|[+-]\d{2}:?\d{2}$/.test(raw)) raw = `${raw}Z`;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

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
  if ((WORK_STATUS_STATES as readonly string[]).includes(firstToken)) {
    // A bare state word opens legitimate prose ("DONE — deployment
    // complete"). Only treat the line as an event attempt when it also
    // carries at least one key=value field.
    return /[^\s=]+=/.test(firstLine);
  }
  return /\bevent_id=/.test(firstLine) || /\btask_id=/.test(firstLine);
}

/**
 * Parse and validate the first line of a `work-status` message.
 *
 * Returns the parsed event when the first line is a well-formed lifecycle
 * event. Returns null when the first line is plain prose with no event
 * markers — the guard deliberately leaves non-event messages alone.
 * Throws WorkStatusSchemaError when the first line CLAIMS to be an event (a
 * JSON document, any schema key= field, or a bare state token followed by at
 * least one key=value field) but does not satisfy the exact finite schema.
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

  const assertUuidField = (key: string, value: string, label: string): string => {
    if (!UUID_RE.test(value)) {
      throw new WorkStatusSchemaError(
        `field "${key}" must be a full LOWERCASE UUID (${label}), got "${value}".`,
      );
    }
    return value;
  };

  const eventId = assertUuidField("event_id", fieldValue("event_id"), "event_id=<uuid>");
  const taskId = assertUuidField("task_id", fieldValue("task_id"), "task_id=<full-task-uuid>");
  const scope = fieldValue("scope");
  if (!SCOPE_RE.test(scope)) {
    throw new WorkStatusSchemaError(
      `field "scope" must be <kind>:<stable-id> (e.g. todos:691ea5e4), got "${scope}".`,
    );
  }
  const agent = fieldValue("agent");
  const session = assertUuidField("session", fieldValue("session"), "session=<session-uuid>");
  const claim = fieldValue("claim");
  const evidence = fieldValue("evidence");

  const at = fields.get("at") ?? "";
  const atMs = parseStrictRfc3339Z(at);
  if (atMs === null) {
    throw new WorkStatusSchemaError(
      `field "at" must be a real RFC3339 timestamp with a Z suffix, e.g. 2026-08-17T12:00:00.000Z ("${at}").`,
    );
  }

  return { state: state as WorkStatusState, event_id: eventId, task_id: taskId, scope, agent, session, at, atMs, claim, evidence };
}

/**
 * Strict RFC3339-with-Z validation. Returns epoch ms, or null when the value
 * is not a real timestamp: wrong shape, no `Z` suffix, out-of-range
 * components, or an impossible calendar date (e.g. 2026-02-30, which
 * Date.parse silently normalizes to March 2 and which the round-trip check
 * rejects).
 */
export function parseStrictRfc3339Z(value: string): number | null {
  const match = RFC3339Z_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  // Round-trip check: the runtime normalizes impossible dates (Feb 30 ->
  // Mar 2); the parsed components must equal the input components.
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hour ||
    d.getUTCMinutes() !== minute ||
    d.getUTCSeconds() !== second
  ) {
    return null;
  }
  return ms;
}

/**
 * Write-time gate shared by the SQLite path (src/lib/messages.ts) and the
 * Postgres server path (src/server/api.ts).
 *
 * When `channelName` is the work-status channel this validates the message's
 * first line against the exact lifecycle schema and rejects duplicate
 * same-state transitions. `recentEntriesForTask` must supply the messages of
 * the channel that carry the marker of the given task_id, newest first, each
 * with its STORED write time (`writtenAtMs` from created_at — never the
 * writer-supplied `at` field), so the dedupe check can find the previous
 * event for that task without scanning the whole channel. The dedupe window
 * is measured from `now` (the current write) against the previous event's
 * STORED write time; a first event that backdates or forwarddates its own
 * `at` value cannot move the window. Any other channel is untouched.
 */
export interface WorkStatusRecentEntry {
  content: string;
  /** The message's STORED write time (created_at), in epoch ms. */
  writtenAtMs: number;
}

function checkWorkStatusDuplicates(
  recentEntries: Iterable<WorkStatusRecentEntry>,
  event: WorkStatusEvent,
  now: number,
): void {
  for (const entry of recentEntries) {
    let previous: WorkStatusEvent | null;
    try {
      previous = parseWorkStatusEvent(entry.content);
    } catch {
      // An earlier malformed line cannot carry a duplicate transition; keep
      // scanning for the previous well-formed event of this task.
      continue;
    }
    if (previous && previous.task_id === event.task_id) {
      assertNotDuplicateWorkStatusTransition(previous, event, entry.writtenAtMs, now);
      break;
    }
  }
}

export function enforceWorkStatusEventWrite(
  channelName: string | null,
  content: string,
  recentEntriesForTask: (taskId: string) => Iterable<WorkStatusRecentEntry>,
  now: number = Date.now(),
): void {
  if (channelName !== WORK_STATUS_CHANNEL) return;
  const event = parseWorkStatusEvent(content);
  if (!event) return;
  checkWorkStatusDuplicates(recentEntriesForTask(event.task_id), event, now);
}

/**
 * Async twin of `enforceWorkStatusEventWrite` for the Postgres server path,
 * whose query adapter is promise-based. Same gate, same semantics; the recent
 * entries lookup may await storage.
 */
export async function enforceWorkStatusEventWriteAsync(
  channelName: string | null,
  content: string,
  recentEntriesForTask: (taskId: string) => Promise<Iterable<WorkStatusRecentEntry>>,
  now: number = Date.now(),
): Promise<void> {
  if (channelName !== WORK_STATUS_CHANNEL) return;
  const event = parseWorkStatusEvent(content);
  if (!event) return;
  checkWorkStatusDuplicates(await recentEntriesForTask(event.task_id), event, now);
}
/**
 * Dedupe check: the lifecycle mandate allows ONE event per real transition, so
 * a same-state event for the same task_id written shortly after the previous
 * one for that task is a duplicate (distinct event_ids notwithstanding).
 * The check only fires against the MOST RECENT event for the same task — an
 * intervening different state makes the new same-state emission a genuinely
 * new transition. The window is anchored on the previous event's STORED write
 * time (`previousWrittenAtMs`, from created_at) against `now` (the current
 * write): if the previous event was STORED more than the window before the
 * current write, it is not recent and the emission is allowed. The writer-
 * supplied `at` values never enter the window computation, so neither a
 * backdated nor a forward-dated `at` can move the window.
 */
export function assertNotDuplicateWorkStatusTransition(
  previous: WorkStatusEvent,
  current: WorkStatusEvent,
  previousWrittenAtMs: number,
  now: number = Date.now(),
): void {
  if (previous.task_id !== current.task_id) return;
  if (previous.state !== current.state) return;
  if (Math.abs(now - previousWrittenAtMs) > WORK_STATUS_DEDUPE_WINDOW_MS) return;
  throw new WorkStatusSchemaError(
    `duplicate ${current.state} event for task ${current.task_id}: a ${previous.state} event for the ` +
      `same task was recorded recently at ${previous.at} (event_id=${previous.event_id}); the lifecycle ` +
      `schema allows one event per real transition.`,
  );
}

/**
 * Refuse edit/delete mutations on rows in the append-only work-status
 * stream. The lifecycle history and its dedupe anchor must never be rewritten
 * or removed; the write-time gate is the stream's only writer. Both SQLite
 * (editMessage/deleteMessage) and the server (message PATCH/DELETE) call this
 * after resolving the target row.
 */
export function assertWorkStatusNotAppendOnly(channel: string | null): void {
  if (channel === WORK_STATUS_CHANNEL) {
    throw new WorkStatusSchemaError(
      `the #${WORK_STATUS_CHANNEL} lifecycle stream is append-only; its events cannot be edited or deleted.`,
    );
  }
}
