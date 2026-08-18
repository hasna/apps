import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { sendMessage } from "./messages";
import { createChannel } from "./channels";
import { closeDb, getDb } from "./db";
import { pinStoreToDb, restoreStoreEnv } from "./store/isolated-test-env.js";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { WORK_STATUS_CHANNEL } from "./work-status-envelope";

/**
 * Write-time regression tests for the work-status lifecycle stream
 * (global-work-status-lifecycle).
 *
 * Measured on the live stream (2026-08-17 audit, 1235 messages): (a) 96
 * same-state consecutive duplicate transition pairs for the same task_id, e.g.
 * task 3f8f212c START at 19:12:36Z and again 19:13:33Z, and task 4b291c5c
 * BLOCKED at 21:11:06Z and 21:11:30Z (distinct event_ids); (b) 8 malformed
 * events — an entire JSON document as the message, an empty event_id, invalid
 * state values (CONTINUE, literal STATE, IN_PROGRESS, PENDING, PROGRESS), and
 * an extra `outcome=` field with a missing claim.
 *
 * The send path MUST fail with a reason rather than let any of these shapes
 * reach the stream: the lifecycle rule mandates one event per real transition
 * and an exact first-line envelope, and any consumer deriving state from the
 * stream double-counts the duplicates and chokes on the malformed lines.
 */

const TEST_DB = join(tmpdir(), `556e6366-work-status-guard-${Date.now()}-${process.pid}.db`);

const EVENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TASK_ID = "12345678-1234-4234-8234-123456789abc";
const OTHER_TASK_ID = "22345678-1234-4234-8234-123456789abc";
const SESSION_ID = "a1b2c3d4-e5f6-47a8-9b0c-1d2e3f4a5b6c";
const CLAIM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function envelope(
  state = "START",
  taskId = TASK_ID,
  eventId = EVENT_ID,
  at = new Date().toISOString(),
): string {
  return [
    state,
    `event_id=${eventId}`,
    `task_id=${taskId}`,
    "scope=todos:open-todos",
    "agent=station01-tmux-watchdog",
    `session=${SESSION_ID}`,
    `at=${at}`,
    `claim=${CLAIM_ID}`,
    "evidence=-",
  ].join(" ");
}

function workStatusMessageCount(): number {
  const row = getDb().prepare(
    "SELECT COUNT(*) AS n FROM messages WHERE channel = ?",
  ).get(WORK_STATUS_CHANNEL) as { n: number };
  return row.n;
}

beforeEach(() => {
  pinStoreToDb(TEST_DB);
  closeDb();
  createChannel(WORK_STATUS_CHANNEL, "fixture");
  createChannel("general", "fixture");
});

afterEach(() => {
  closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TEST_DB + suffix); } catch { /* already gone */ }
  }
  restoreStoreEnv();
});

describe("work-status write-time envelope guard", () => {
  test("a valid lifecycle envelope is accepted and stored", () => {
    const line = envelope("START");
    const msg = sendMessage({
      from: "station01-tmux-watchdog",
      to: WORK_STATUS_CHANNEL,
      channel: WORK_STATUS_CHANNEL,
      content: `${line}\nclaiming the task now`,
    });
    expect(msg.content.startsWith("START event_id=")).toBe(true);
    expect(workStatusMessageCount()).toBe(1);
  });

  test("all five lifecycle states are accepted", () => {
    const states: Array<[string, string]> = [
      ["START", "32345678-1234-4234-8234-123456789abc"],
      ["BLOCKED", "42345678-1234-4234-8234-123456789abc"],
      ["RESUMED", "52345678-1234-4234-8234-123456789abc"],
      ["DONE", "62345678-1234-4234-8234-123456789abc"],
      ["CANCELLED", "72345678-1234-4234-8234-123456789abc"],
    ];
    for (const [state, taskId] of states) {
      sendMessage({
        from: "station01-tmux-watchdog",
        to: WORK_STATUS_CHANNEL,
        channel: WORK_STATUS_CHANNEL,
        content: envelope(state, taskId),
      });
    }
    expect(workStatusMessageCount()).toBe(5);
  });

  // (b) — malformed first lines measured on the live stream. Each must be
  // rejected AT WRITE TIME with a reason, and must leave the stream untouched.
  const malformedFirstLines: Array<[string, string]> = [
    [
      "an entire JSON document as the message (id 701771, agent-chief-finance)",
      JSON.stringify({ event: "DONE", task_id: TASK_ID }),
    ],
    [
      "empty event_id (id 702774, agent-chief-staff)",
      `START event_id= task_id=${TASK_ID} scope=todos:open-todos agent=station01-tmux-watchdog session=${SESSION_ID} at=2026-08-17T10:00:00Z claim=${CLAIM_ID} evidence=-`,
    ],
    [
      "literal template word STATE as the state (ids 685044, 684554)",
      `STATE event_id=${EVENT_ID} task_id=${TASK_ID} scope=todos:open-todos agent=station01-tmux-watchdog session=${SESSION_ID} at=2026-08-17T10:00:00Z claim=${CLAIM_ID} evidence=-`,
    ],
    [
      "CONTINUE is not a lifecycle state (id 686051)",
      `CONTINUE event_id=${EVENT_ID} task_id=${TASK_ID} scope=todos:open-todos agent=station01-tmux-watchdog session=${SESSION_ID} at=2026-08-17T10:00:00Z claim=${CLAIM_ID} evidence=-`,
    ],
    [
      "IN_PROGRESS is not a lifecycle state (id 684083)",
      `IN_PROGRESS event_id=${EVENT_ID} task_id=${TASK_ID} scope=todos:open-todos agent=station01-tmux-watchdog session=${SESSION_ID} at=2026-08-17T10:00:00Z claim=${CLAIM_ID} evidence=-`,
    ],
    [
      "PENDING is not a lifecycle state (id 683838)",
      `PENDING event_id=${EVENT_ID} task_id=${TASK_ID} scope=todos:open-todos agent=station01-tmux-watchdog session=${SESSION_ID} at=2026-08-17T10:00:00Z claim=${CLAIM_ID} evidence=-`,
    ],
    [
      "PROGRESS is not a lifecycle state (id 683694)",
      `PROGRESS event_id=${EVENT_ID} task_id=${TASK_ID} scope=todos:open-todos agent=station01-tmux-watchdog session=${SESSION_ID} at=2026-08-17T10:00:00Z claim=${CLAIM_ID} evidence=-`,
    ],
    [
      "extra outcome= field with missing claim (id 683973)",
      `DONE event_id=${EVENT_ID} task_id=${TASK_ID} scope=todos:open-todos agent=station01-tmux-watchdog session=${SESSION_ID} at=2026-08-17T10:00:00Z outcome=success evidence=-`,
    ],
    [
      "retired [WORKLOG] prefix",
      `[WORKLOG] ${envelope("START")}`,
    ],
    [
      "free-form prose first line",
      "blocker cleared, resuming the migration now",
    ],
  ];

  for (const [name, firstLine] of malformedFirstLines) {
    test(`${name} is rejected and nothing is written`, () => {
      expect(() =>
        sendMessage({
          from: "station01-tmux-watchdog",
          to: WORK_STATUS_CHANNEL,
          channel: WORK_STATUS_CHANNEL,
          content: firstLine,
        }),
      ).toThrow();
      expect(workStatusMessageCount()).toBe(0);
    });
  }

  test("the rejection names the lifecycle envelope as the reason", () => {
    expect(() =>
      sendMessage({
        from: "station01-tmux-watchdog",
        to: WORK_STATUS_CHANNEL,
        channel: WORK_STATUS_CHANNEL,
        content: "prose is not an envelope",
      }),
    ).toThrow(/work-status lifecycle/i);
  });

  test("work-status rejections never reflect sensitive caller values", () => {
    // A sensitive value in the content is rejected (by the content-safety
    // scan, which runs before the envelope check on this path), and neither
    // rejection may echo the value back in the error. Synthetic
    // detector-positive value (slack-shaped): matches the content-safety
    // redaction patterns, not the staged-secrets scanner's detectors.
    const leak = "xoxb-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    try {
      sendMessage({
        from: "station01-tmux-watchdog",
        to: WORK_STATUS_CHANNEL,
        channel: WORK_STATUS_CHANNEL,
        content: `START event_id=${leak} task_id=${TASK_ID} scope=todos:open-todos agent=station01-tmux-watchdog session=${SESSION_ID} at=2026-08-17T10:00:00Z claim=${CLAIM_ID} evidence=-`,
      });
      throw new Error("expected the work-status send to be rejected");
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(leak);
    }
  });

  test("the guard is scoped to the work-status channel: prose on other channels still sends", () => {
    const msg = sendMessage({
      from: "station01-tmux-watchdog",
      to: "general",
      channel: "general",
      content: "ordinary prose is fine here",
    });
    expect(msg.channel).toBe("general");
  });

  test("a reply to a work-status message is commentary and is not envelope-checked", () => {
    const parent = sendMessage({
      from: "station01-tmux-watchdog",
      to: WORK_STATUS_CHANNEL,
      channel: WORK_STATUS_CHANNEL,
      content: envelope("BLOCKED"),
    });
    expect(parent.id).toBe(1);
    const reply = sendMessage({
      from: "station01-tmux-watchdog",
      to: WORK_STATUS_CHANNEL,
      channel: WORK_STATUS_CHANNEL,
      content: "why is this blocked?",
      reply_to: parent.id,
      reply_to_uuid: parent.uuid,
    });
    expect(reply.reply_to).toBe(parent.id);
    expect(workStatusMessageCount()).toBe(2);
  });
});

describe("work-status write-time duplicate-transition guard", () => {
  test("the same state for the same task within the window is rejected (START double-fire)", () => {
    sendMessage({
      from: "station01-tmux-watchdog",
      to: WORK_STATUS_CHANNEL,
      channel: WORK_STATUS_CHANNEL,
      content: envelope("START", TASK_ID, EVENT_ID),
    });
    expect(() =>
      sendMessage({
        from: "station01-tmux-watchdog",
        to: WORK_STATUS_CHANNEL,
        channel: WORK_STATUS_CHANNEL,
        content: envelope("START", TASK_ID, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"),
      }),
    ).toThrow(/duplicate/i);
    expect(workStatusMessageCount()).toBe(1);
  });

  test("the same state for the same task within the window is rejected for BLOCKED too", () => {
    sendMessage({
      from: "station01-tmux-watchdog",
      to: WORK_STATUS_CHANNEL,
      channel: WORK_STATUS_CHANNEL,
      content: envelope("BLOCKED", TASK_ID, EVENT_ID),
    });
    expect(() =>
      sendMessage({
        from: "station01-tmux-watchdog",
        to: WORK_STATUS_CHANNEL,
        channel: WORK_STATUS_CHANNEL,
        content: envelope("BLOCKED", TASK_ID, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"),
      }),
    ).toThrow(/duplicate/i);
    expect(workStatusMessageCount()).toBe(1);
  });

  test("a different state for the same task within the window is a real transition and is accepted", () => {
    sendMessage({
      from: "station01-tmux-watchdog",
      to: WORK_STATUS_CHANNEL,
      channel: WORK_STATUS_CHANNEL,
      content: envelope("START", TASK_ID, EVENT_ID),
    });
    sendMessage({
      from: "station01-tmux-watchdog",
      to: WORK_STATUS_CHANNEL,
      channel: WORK_STATUS_CHANNEL,
      content: envelope("BLOCKED", TASK_ID, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"),
    });
    expect(workStatusMessageCount()).toBe(2);
  });

  test("BLOCKED then RESUMED then a second BLOCKED is not a duplicate (state changed in between)", () => {
    sendMessage({
      from: "station01-tmux-watchdog",
      to: WORK_STATUS_CHANNEL,
      channel: WORK_STATUS_CHANNEL,
      content: envelope("BLOCKED", TASK_ID, EVENT_ID),
    });
    sendMessage({
      from: "station01-tmux-watchdog",
      to: WORK_STATUS_CHANNEL,
      channel: WORK_STATUS_CHANNEL,
      content: envelope("RESUMED", TASK_ID, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"),
    });
    sendMessage({
      from: "station01-tmux-watchdog",
      to: WORK_STATUS_CHANNEL,
      channel: WORK_STATUS_CHANNEL,
      content: envelope("BLOCKED", TASK_ID, "cccccccc-dddd-4eee-8fff-000000000001"),
    });
    expect(workStatusMessageCount()).toBe(3);
  });

  test("the same state for a DIFFERENT task within the window is accepted", () => {
    sendMessage({
      from: "station01-tmux-watchdog",
      to: WORK_STATUS_CHANNEL,
      channel: WORK_STATUS_CHANNEL,
      content: envelope("START", TASK_ID, EVENT_ID),
    });
    sendMessage({
      from: "station01-tmux-watchdog",
      to: WORK_STATUS_CHANNEL,
      channel: WORK_STATUS_CHANNEL,
      content: envelope("START", OTHER_TASK_ID, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"),
    });
    expect(workStatusMessageCount()).toBe(2);
  });

  test("the same state for the same task OUTSIDE the window is a real re-assertion and is accepted", () => {
    // Seed the previous event with a created_at older than the dedupe window.
    const oldAt = new Date(Date.now() - 120_000).toISOString().replace("Z", "");
    getDb().prepare(
      `INSERT INTO messages (session_id, from_agent, to_agent, channel, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      `channel:${WORK_STATUS_CHANNEL}`,
      "station01-tmux-watchdog",
      WORK_STATUS_CHANNEL,
      WORK_STATUS_CHANNEL,
      envelope("DONE", TASK_ID, EVENT_ID, new Date(Date.now() - 120_000).toISOString()),
      oldAt,
    );

    const msg = sendMessage({
      from: "station01-tmux-watchdog",
      to: WORK_STATUS_CHANNEL,
      channel: WORK_STATUS_CHANNEL,
      content: envelope("DONE", TASK_ID, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"),
    });
    expect(msg.channel).toBe(WORK_STATUS_CHANNEL);
    expect(workStatusMessageCount()).toBe(2);
  });

  test("a duplicate rejection names the previously recorded event", () => {
    sendMessage({
      from: "station01-tmux-watchdog",
      to: WORK_STATUS_CHANNEL,
      channel: WORK_STATUS_CHANNEL,
      content: envelope("START", TASK_ID, EVENT_ID),
    });
    expect(() =>
      sendMessage({
        from: "station01-tmux-watchdog",
        to: WORK_STATUS_CHANNEL,
        channel: WORK_STATUS_CHANNEL,
        content: envelope("START", TASK_ID, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"),
      }),
    ).toThrow(new RegExp(`event_id ${EVENT_ID}`));
  });
});
