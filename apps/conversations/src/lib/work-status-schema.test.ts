import { describe, test, expect } from "bun:test";
import {
  assertNotDuplicateWorkStatusTransition,
  parseWorkStatusEvent,
  WorkStatusSchemaError,
  WORK_STATUS_DEDUPE_WINDOW_MS,
} from "./work-status-schema";

const NOW = "2026-08-17T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

const EVENT_ID = "8f3c7b1e-4d5a-4f2e-9a6b-2c4d5e6f7a8b";
const TASK_ID = "3f8f212c-9b2d-4c3e-8f4a-5b6c7d8e9f01";
const OTHER_TASK_ID = "4b291c5c-1a2b-3c4d-5e6f-7a8b9c0d1e2f";

function validEvent(state = "START", overrides: Record<string, string> = {}): string {
  const fields = {
    event_id: EVENT_ID,
    task_id: TASK_ID,
    scope: "todos:691ea5e4",
    agent: "agent-chief-engineering",
    session: "0f0c2a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01",
    at: NOW,
    claim: "clm_123",
    evidence: "-",
    ...overrides,
  };
  // The schema line leads with the bare state token, never a `state=` field.
  return [state, ...Object.entries(fields).map(([key, value]) => `${key}=${value}`)].join(" ");
}

describe("parseWorkStatusEvent — schema enforcement at write time", () => {
  test("accepts a well-formed event for every state", () => {
    for (const state of ["START", "BLOCKED", "RESUMED", "DONE", "CANCELLED"] as const) {
      const parsed = parseWorkStatusEvent(validEvent(state));
      expect(parsed).not.toBeNull();
      expect(parsed!.state).toBe(state);
      expect(parsed!.task_id).toBe(TASK_ID);
      expect(parsed!.atMs).toBe(Date.parse(NOW));
      expect(parsed!.claim).toBe("clm_123");
      expect(parsed!.evidence).toBe("-");
    }
  });

  test("accepts a body after the first line and ignores it", () => {
    const parsed = parseWorkStatusEvent(`${validEvent()}\nBlocked by vault rotation.`);
    expect(parsed).not.toBeNull();
    expect(parsed!.state).toBe("START");
  });

  test("passes plain prose through untouched (not an event)", () => {
    expect(parseWorkStatusEvent("thanks for the update")).toBeNull();
    expect(parseWorkStatusEvent("the migration is complete")).toBeNull();
  });

  test("passes prose that merely STARTS with a lifecycle token", () => {
    // A bare state word opens legitimate prose; without any key=value field
    // the line is not an event attempt and must not be rejected.
    expect(parseWorkStatusEvent("DONE — deployment complete")).toBeNull();
    expect(parseWorkStatusEvent("START working on the migration")).toBeNull();
    expect(parseWorkStatusEvent("BLOCKED: waiting on vault rotation")).toBeNull();
    expect(parseWorkStatusEvent("RESUMED")).toBeNull();
  });

  test("rejects an entire JSON document as the first line", () => {
    // id=701771, agent-chief-finance
    const json = `{"event":"DONE","task_id":"${TASK_ID}","at":"${NOW}"}`;
    expect(() => parseWorkStatusEvent(json)).toThrow(WorkStatusSchemaError);
    expect(() => parseWorkStatusEvent(json)).toThrow(/JSON document/);
  });

  test("rejects invalid state tokens observed in the stream", () => {
    // 686051 CONTINUE, 685044/684554 STATE, 684083 IN_PROGRESS,
    // 683838 PENDING, 683694 PROGRESS
    for (const badState of ["CONTINUE", "STATE", "IN_PROGRESS", "PENDING", "PROGRESS"]) {
      expect(() => parseWorkStatusEvent(validEvent(badState))).toThrow(
        new RegExp(`invalid state "${badState}"`),
      );
    }
  });

  test("rejects an empty event_id", () => {
    // id=702774, agent-chief-staff: "START event_id= task_id=..."
    expect(() => parseWorkStatusEvent(validEvent("START", { event_id: "" }))).toThrow(
      /invalid value/,
    );
  });

  test("rejects identifiers that are not full UUIDs", () => {
    // The schema documents event_id=<uuid>, task_id=<full-task-uuid>,
    // session=<session-uuid>; a single-character value is not one.
    expect(() => parseWorkStatusEvent(validEvent("START", { event_id: "x" }))).toThrow(
      /must be a full LOWERCASE UUID/,
    );
    expect(() => parseWorkStatusEvent(validEvent("START", { task_id: "x" }))).toThrow(
      /must be a full LOWERCASE UUID/,
    );
    expect(() => parseWorkStatusEvent(validEvent("START", { session: "x" }))).toThrow(
      /must be a full LOWERCASE UUID/,
    );
    // The old fixture shape (short ids) is not a UUID either.
    expect(() => parseWorkStatusEvent(validEvent("START", { event_id: "78b747e6" }))).toThrow(
      /must be a full LOWERCASE UUID/,
    );
  });

  test("rejects uppercase UUIDs so task identity cannot be casing-spoofed", () => {
    // The same UUID written in two casings must not resolve to two different
    // tasks (the dedupe compares task_ids case-sensitively and Postgres LIKE
    // is case-sensitive), so uppercase spellings are rejected at write time.
    expect(() =>
      parseWorkStatusEvent(validEvent("START", { task_id: TASK_ID.toUpperCase() })),
    ).toThrow(/must be a full LOWERCASE UUID/);
    expect(() =>
      parseWorkStatusEvent(validEvent("START", { event_id: EVENT_ID.toUpperCase() })),
    ).toThrow(/must be a full LOWERCASE UUID/);
  });

  test("rejects a scope that is not <kind>:<stable-id>", () => {
    expect(() => parseWorkStatusEvent(validEvent("START", { scope: "x" }))).toThrow(
      /must be <kind>:<stable-id>/,
    );
    expect(() => parseWorkStatusEvent(validEvent("START", { scope: "todos" }))).toThrow(
      /must be <kind>:<stable-id>/,
    );
  });

  test("rejects a missing claim= field", () => {
    // id=683973: DONE line with outcome= and no claim=
    const line = validEvent("DONE", { evidence: "-" });
    const withoutClaim = line.split(" ").filter((token) => !token.startsWith("claim=")).join(" ");
    expect(() => parseWorkStatusEvent(withoutClaim)).toThrow(/missing required field claim/);
  });

  test("rejects an extra outcome= field", () => {
    // id=683973: DONE line inserts an outcome= field
    const line = `${validEvent("DONE")} outcome=success`;
    expect(() => parseWorkStatusEvent(line)).toThrow(/unexpected field outcome/);
  });

  test("rejects a bare state with the schema fields missing", () => {
    expect(() => parseWorkStatusEvent(`START event_id=${EVENT_ID} task_id=${TASK_ID}`)).toThrow(
      /missing required field/,
    );
  });

  test("rejects a first token that is a key=value field instead of the bare state", () => {
    expect(() => parseWorkStatusEvent(`state=START event_id=${EVENT_ID} task_id=${TASK_ID}`)).toThrow(
      /must be the bare state/,
    );
  });

  test("rejects a duplicate field on the first line", () => {
    const line = `${validEvent()} task_id=${OTHER_TASK_ID}`;
    expect(() => parseWorkStatusEvent(line)).toThrow(/appears more than once/);
  });

  test("rejects an unparseable at= timestamp", () => {
    expect(() => parseWorkStatusEvent(validEvent("START", { at: "not-a-time" }))).toThrow(
      /must be a real RFC3339 timestamp with a Z suffix/,
    );
  });

  test("rejects at= values that are not RFC3339 with a Z suffix", () => {
    // No timezone: parsed as local time, not UTC.
    expect(() => parseWorkStatusEvent(validEvent("START", { at: "2026-08-17T12:00:00" }))).toThrow(
      /must be a real RFC3339 timestamp with a Z suffix/,
    );
    // Offset form instead of the documented Z suffix.
    expect(() => parseWorkStatusEvent(validEvent("START", { at: "2026-08-17T12:00:00+00:00" }))).toThrow(
      /must be a real RFC3339 timestamp with a Z suffix/,
    );
    // Impossible calendar date: Date.parse silently normalizes 2026-02-30 to
    // March 2; the round-trip check must reject it.
    expect(() => parseWorkStatusEvent(validEvent("START", { at: "2026-02-30T12:00:00Z" }))).toThrow(
      /must be a real RFC3339 timestamp with a Z suffix/,
    );
  });
});

describe("assertNotDuplicateWorkStatusTransition — one event per real transition", () => {
  test("rejects the same state for the same task within the dedupe window", () => {
    // task START at 19:12:36Z and again at 19:13:33Z; the previous event was
    // STORED shortly before the current write.
    const first = parseWorkStatusEvent(validEvent("START", { at: "2026-08-14T19:12:36.000Z" }))!;
    const second = parseWorkStatusEvent(validEvent("START", { at: "2026-08-14T19:13:33.000Z" }))!;
    expect(() =>
      assertNotDuplicateWorkStatusTransition(
        first, second,
        Date.parse("2026-08-14T19:13:00.000Z"),
        Date.parse("2026-08-14T19:13:33.000Z"),
      ),
    ).toThrow(/duplicate START event/);
  });

  test("rejects BLOCKED re-emission 24 seconds later (id 702003/702004)", () => {
    const first = parseWorkStatusEvent(validEvent("BLOCKED", { at: "2026-08-14T21:11:06.000Z" }))!;
    const second = parseWorkStatusEvent(validEvent("BLOCKED", { at: "2026-08-14T21:11:30.000Z" }))!;
    expect(() =>
      assertNotDuplicateWorkStatusTransition(
        first, second,
        Date.parse("2026-08-14T21:11:06.000Z"),
        Date.parse("2026-08-14T21:11:30.000Z"),
      ),
    ).toThrow(/duplicate BLOCKED event/);
  });

  test("rejects an immediate duplicate even when BOTH at= values are backdated", () => {
    // The window is anchored on the previous event's STORED write time and
    // the current write, never on the writer-supplied at values: a first
    // event that backdates its own claimed timestamp cannot move the window,
    // and a duplicate written now cannot escape by backdating either side.
    const first = parseWorkStatusEvent(validEvent("START", { at: "2026-08-17T11:55:00.000Z" }))!;
    const immediate = parseWorkStatusEvent(validEvent("START", { at: "2026-08-17T11:49:00.000Z" }))!;
    expect(() =>
      assertNotDuplicateWorkStatusTransition(
        first, immediate,
        Date.parse("2026-08-17T11:59:00.000Z"),
        NOW_MS,
      ),
    ).toThrow(/duplicate START event/);
  });

  test("allows a same-state emission when the previous event was STORED beyond the window", () => {
    // The previous event forward-dates its claimed at to be "recent" while it
    // was actually stored ten minutes ago — the stored write time decides.
    const first = parseWorkStatusEvent(validEvent("BLOCKED", { at: "2026-08-17T11:59:00.000Z" }))!;
    const now = parseWorkStatusEvent(validEvent("BLOCKED", { at: NOW }))!;
    expect(() =>
      assertNotDuplicateWorkStatusTransition(
        first, now,
        Date.parse("2026-08-17T11:50:00.000Z"),
        NOW_MS,
      ),
    ).not.toThrow();
  });

  test("allows a different state for the same task", () => {
    const blocked = parseWorkStatusEvent(validEvent("BLOCKED", { at: NOW }))!;
    const resumed = parseWorkStatusEvent(validEvent("RESUMED", { at: NOW }))!;
    expect(() => assertNotDuplicateWorkStatusTransition(blocked, resumed, NOW_MS, NOW_MS)).not.toThrow();
  });

  test("allows the same state after the dedupe window", () => {
    const first = parseWorkStatusEvent(validEvent("BLOCKED", { at: "2026-08-14T21:11:06.000Z" }))!;
    const later = parseWorkStatusEvent(
      validEvent("BLOCKED", {
        at: new Date(Date.parse("2026-08-14T21:11:06.000Z") + WORK_STATUS_DEDUPE_WINDOW_MS + 1).toISOString(),
      }),
    )!;
    // The previous event was STORED more than the window before the current
    // write, so the new same-state emission is a genuinely new transition.
    expect(() =>
      assertNotDuplicateWorkStatusTransition(
        first, later,
        Date.parse("2026-08-14T21:11:06.000Z"),
        Date.parse("2026-08-14T21:20:00.000Z"),
      ),
    ).not.toThrow();
  });

  test("allows the same state for a different task", () => {
    const first = parseWorkStatusEvent(validEvent("START", { at: NOW }))!;
    const other = parseWorkStatusEvent(validEvent("START", { task_id: OTHER_TASK_ID, at: NOW }))!;
    expect(() => assertNotDuplicateWorkStatusTransition(first, other, NOW_MS, NOW_MS)).not.toThrow();
  });

  test("allows a same-state re-emission after an intervening different state", () => {
    const firstBlocked = parseWorkStatusEvent(validEvent("BLOCKED", { at: NOW }))!;
    const resumed = parseWorkStatusEvent(validEvent("RESUMED", { at: "2026-08-17T12:01:00.000Z" }))!;
    const reBlocked = parseWorkStatusEvent(validEvent("BLOCKED", { at: "2026-08-17T12:02:00.000Z" }))!;
    expect(() => assertNotDuplicateWorkStatusTransition(firstBlocked, resumed, NOW_MS, NOW_MS)).not.toThrow();
    // The dedupe check fires against the most recent event for the task —
    // here that is RESUMED, so the new BLOCKED is a genuinely new transition.
    expect(() => assertNotDuplicateWorkStatusTransition(resumed, reBlocked, NOW_MS, NOW_MS)).not.toThrow();
  });
});
