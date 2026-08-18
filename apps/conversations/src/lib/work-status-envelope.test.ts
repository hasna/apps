import { describe, expect, test } from "bun:test";
import {
  WORK_STATUS_CHANNEL,
  WORK_STATUS_STATES,
  parseWorkStatusEvent,
  workStatusEnvelopeViolation,
} from "./work-status-envelope";

/**
 * Regression tests for the work-status lifecycle envelope (global-work-status-lifecycle).
 *
 * Every defect class measured on the live stream (2026-08-17 audit, 1235 messages,
 * 26 schema-violating events from at least 7 seats) has a negative control here, so
 * a future regression of the validator fails closed on the exact shapes that broke
 * the stream.
 */

const EVENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TASK_ID = "12345678-1234-4234-8234-123456789abc";
const SESSION_ID = "a1b2c3d4-e5f6-47a8-9b0c-1d2e3f4a5b6c";
const CLAIM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function validEnvelope(
  state = "START",
  overrides: Record<string, string | undefined> = {},
  omitted: string[] = [],
): string {
  const fields: Record<string, string | undefined> = {
    event_id: EVENT_ID,
    task_id: TASK_ID,
    scope: "todos:open-todos",
    agent: "station01-tmux-watchdog",
    session: SESSION_ID,
    at: "2026-08-17T10:00:00Z",
    claim: CLAIM_ID,
    evidence: "-",
    ...overrides,
  };
  const entries = Object.entries(fields).filter(
    ([key, value]) => !omitted.includes(key) && value !== undefined,
  );
  return [state, ...entries.map(([key, value]) => `${key}=${value}`)].join(" ");
}

describe("work-status envelope — positive controls", () => {
  test("all five lifecycle states parse with every required field extracted", () => {
    for (const state of WORK_STATUS_STATES) {
      const parsed = parseWorkStatusEvent(validEnvelope(state));
      expect(parsed, `state ${state} must parse`).not.toBeNull();
      expect(parsed?.state).toBe(state);
      expect(parsed?.event_id).toBe(EVENT_ID);
      expect(parsed?.task_id).toBe(TASK_ID);
      expect(parsed?.scope).toBe("todos:open-todos");
      expect(parsed?.agent).toBe("station01-tmux-watchdog");
      expect(parsed?.session).toBe(SESSION_ID);
      expect(parsed?.at).toBe("2026-08-17T10:00:00Z");
      expect(parsed?.claim).toBe(CLAIM_ID);
      expect(parsed?.evidence).toBe("-");
    }
  });

  test("dash is permitted for claim and evidence only", () => {
    const withDashes = validEnvelope("BLOCKED", { claim: "-", evidence: "-" });
    expect(workStatusEnvelopeViolation(withDashes)).toBeNull();
  });

  test("fractional-seconds timestamp parses", () => {
    const fractional = validEnvelope("DONE", { at: "2026-08-17T10:00:00.123Z" });
    expect(workStatusEnvelopeViolation(fractional)).toBeNull();
  });

  test("a body on later lines does not invalidate the envelope", () => {
    const withBody = `${validEnvelope("RESUMED")}\nblocker cleared; two plain sentences max`;
    expect(workStatusEnvelopeViolation(withBody.split(/\r?\n/, 1)[0] ?? "")).toBeNull();
  });
});

describe("work-status envelope — first-line violations measured on the live stream", () => {
  const prefixViolations: Array<[string, string]> = [
    ["[WORKLOG] prefixed START", `[WORKLOG] ${validEnvelope("START")}`],
    ["bare [WORKLOG] reuse of retired name", "[WORKLOG] START open-todos ddd8d624"],
    ["STATE used as a literal state", validEnvelope("STATE")],
    ["STATE literal with real state in body", `STATE ${validEnvelope("DONE")}`],
    ["PROGRESS is not a lifecycle state", validEnvelope("PROGRESS")],
    ["PENDING is not a lifecycle state", validEnvelope("PENDING")],
    ["IN_PROGRESS is not a lifecycle state", validEnvelope("IN_PROGRESS")],
    ["CONTINUE is not a lifecycle state", validEnvelope("CONTINUE")],
    ["[work-status] prefixed", `[work-status] ${validEnvelope("START")}`],
    ["[LIVE-TEST] prefixed", `[LIVE-TEST] ${validEnvelope("START")}`],
    ["free-form prose first line", "blocker cleared, resuming the migration now"],
    ["JSON object envelope instead of first-line format", `{"state":"START","event_id":"${EVENT_ID}"}`],
  ];

  for (const [name, line] of prefixViolations) {
    test(`${name} is rejected`, () => {
      expect(workStatusEnvelopeViolation(line)).not.toBeNull();
      expect(parseWorkStatusEvent(line)).toBeNull();
    });
  }

  test("lowercase state is rejected", () => {
    expect(workStatusEnvelopeViolation(validEnvelope("start"))).not.toBeNull();
  });
});

describe("work-status envelope — field-level violations measured on the live stream", () => {
  const fieldViolations: Array<[string, string]> = [
    ["empty event_id", validEnvelope("START", { event_id: "" })],
    [
      "fabricated placeholder event_id (1111-4111-8111-111111111111)",
      validEnvelope("START", { event_id: "11111111-1111-4111-8111-111111111111" }),
    ],
    ["zero-filled placeholder event_id", validEnvelope("START", { event_id: "00000000-0000-4000-8000-000000000000" })],
    ["event_id not a UUID", validEnvelope("START", { event_id: "not-a-uuid" })],
    ["event_id too short", validEnvelope("START", { event_id: "1111-4111-8111-111111111111" })],
    ["session is a dash", validEnvelope("START", { session: "-" })],
    ["session not a UUID", validEnvelope("START", { session: "session-abc" })],
    ["missing claim field", validEnvelope("START", {}, ["claim"])],
    ["missing evidence field", validEnvelope("START", {}, ["evidence"])],
    ["missing event_id field entirely", validEnvelope("START", {}, ["event_id"])],
    ["missing task_id field entirely", validEnvelope("START", {}, ["task_id"])],
    ["missing session field entirely", validEnvelope("START", {}, ["session"])],
    ["task_id not a UUID", validEnvelope("START", { task_id: "todos-123" })],
    ["empty scope", validEnvelope("START", { scope: "" })],
    ["scope with empty kind half (scope=:)", validEnvelope("START", { scope: ":" })],
    ["scope with empty stable-id half", validEnvelope("START", { scope: "todos:" })],
    ["scope with whitespace", validEnvelope("START", { scope: "todos: open-todos" })],
    ["empty agent", validEnvelope("START", { agent: "" })],
    ["at not RFC3339Z (no Z designator)", validEnvelope("START", { at: "2026-08-17T10:00:00" })],
    ["at not RFC3339Z (garbage)", validEnvelope("START", { at: "yesterday" })],
    ["at not RFC3339Z (offset instead of Z)", validEnvelope("START", { at: "2026-08-17T10:00:00+02:00" })],
    ["extra unknown field", `${validEnvelope("START")} priority=high`],
    ["duplicated event_id field", validEnvelope("START", { event_id: `${EVENT_ID} ${EVENT_ID}` })],
    ["empty first line", ""],
  ];

  for (const [name, line] of fieldViolations) {
    test(`${name} is rejected`, () => {
      expect(workStatusEnvelopeViolation(line), name).not.toBeNull();
      expect(parseWorkStatusEvent(line)).toBeNull();
    });
  }

  test("violation reason names the offending field", () => {
    const reason = workStatusEnvelopeViolation(validEnvelope("START", { session: "-" }));
    expect(reason).toContain("session");
  });
});

describe("work-status channel constant", () => {
  test("names the canonical channel the validator guards", () => {
    expect(WORK_STATUS_CHANNEL).toBe("work-status");
  });
});
