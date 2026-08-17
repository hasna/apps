import { describe, test, expect } from "bun:test";
import {
  assertNotDuplicateWorkStatusTransition,
  parseWorkStatusEvent,
  WorkStatusSchemaError,
  WORK_STATUS_DEDUPE_WINDOW_MS,
} from "./work-status-schema";

const NOW = "2026-08-17T12:00:00.000Z";

function validEvent(state = "START", overrides: Record<string, string> = {}): string {
  const fields = {
    event_id: "78b747e6",
    task_id: "3f8f212c",
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
      expect(parsed!.task_id).toBe("3f8f212c");
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

  test("rejects an entire JSON document as the first line", () => {
    // id=701771, agent-chief-finance
    const json = `{"event":"DONE","task_id":"3f8f212c","at":"${NOW}"}`;
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
    expect(() => parseWorkStatusEvent("START event_id=abc task_id=123")).toThrow(
      /missing required field/,
    );
  });

  test("rejects a first token that is a key=value field instead of the bare state", () => {
    expect(() => parseWorkStatusEvent("state=START event_id=abc task_id=123")).toThrow(
      /must be the bare state/,
    );
  });

  test("rejects a duplicate field on the first line", () => {
    const line = `${validEvent()} task_id=other-task`;
    expect(() => parseWorkStatusEvent(line)).toThrow(/appears more than once/);
  });

  test("rejects an unparseable at= timestamp", () => {
    expect(() => parseWorkStatusEvent(validEvent("START", { at: "not-a-time" }))).toThrow(
      /not RFC3339/,
    );
  });
});

describe("assertNotDuplicateWorkStatusTransition — one event per real transition", () => {
  test("rejects the same state for the same task within the dedupe window", () => {
    // task 3f8f212c START at 19:12:36Z and again at 19:13:33Z
    const first = parseWorkStatusEvent(validEvent("START", { at: "2026-08-14T19:12:36.000Z" }))!;
    const second = parseWorkStatusEvent(validEvent("START", { at: "2026-08-14T19:13:33.000Z" }))!;
    expect(() => assertNotDuplicateWorkStatusTransition(first, second)).toThrow(
      /duplicate START event for task 3f8f212c/,
    );
  });

  test("rejects BLOCKED re-emission 24 seconds later (id 702003/702004)", () => {
    const first = parseWorkStatusEvent(validEvent("BLOCKED", { at: "2026-08-14T21:11:06.000Z" }))!;
    const second = parseWorkStatusEvent(validEvent("BLOCKED", { at: "2026-08-14T21:11:30.000Z" }))!;
    expect(() => assertNotDuplicateWorkStatusTransition(first, second)).toThrow(
      /duplicate BLOCKED event for task 3f8f212c/,
    );
  });

  test("allows a different state for the same task", () => {
    const blocked = parseWorkStatusEvent(validEvent("BLOCKED", { at: NOW }))!;
    const resumed = parseWorkStatusEvent(validEvent("RESUMED", { at: NOW }))!;
    expect(() => assertNotDuplicateWorkStatusTransition(blocked, resumed)).not.toThrow();
  });

  test("allows the same state after the dedupe window", () => {
    const first = parseWorkStatusEvent(validEvent("BLOCKED", { at: "2026-08-14T21:11:06.000Z" }))!;
    const later = parseWorkStatusEvent(
      validEvent("BLOCKED", {
        at: new Date(Date.parse("2026-08-14T21:11:06.000Z") + WORK_STATUS_DEDUPE_WINDOW_MS + 1).toISOString(),
      }),
    )!;
    expect(() => assertNotDuplicateWorkStatusTransition(first, later)).not.toThrow();
  });

  test("allows the same state for a different task", () => {
    const first = parseWorkStatusEvent(validEvent("START", { at: NOW }))!;
    const other = parseWorkStatusEvent(validEvent("START", { task_id: "4b291c5c", at: NOW }))!;
    expect(() => assertNotDuplicateWorkStatusTransition(first, other)).not.toThrow();
  });

  test("allows a same-state re-emission after an intervening different state", () => {
    const firstBlocked = parseWorkStatusEvent(validEvent("BLOCKED", { at: NOW }))!;
    const resumed = parseWorkStatusEvent(validEvent("RESUMED", { at: "2026-08-17T12:01:00.000Z" }))!;
    const reBlocked = parseWorkStatusEvent(validEvent("BLOCKED", { at: "2026-08-17T12:02:00.000Z" }))!;
    expect(() => assertNotDuplicateWorkStatusTransition(firstBlocked, resumed)).not.toThrow();
    // The dedupe check fires against the most recent event for the task —
    // here that is RESUMED, so the new BLOCKED is a genuinely new transition.
    expect(() => assertNotDuplicateWorkStatusTransition(resumed, reBlocked)).not.toThrow();
  });
});
