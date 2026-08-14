/**
 * Regression: an EXPIRED lock must never render as a held one.
 *
 * Every claim path already gates on `isLockExpired` — `task-lifecycle.ts`,
 * `task-route-sources.ts` and `local-reports.ts` all skip a task whose lock has
 * lapsed — while every renderer printed a bare `locked_by`. So the scheduler
 * handed these tasks out while the display showed them owned, and readers
 * skipped work that was free. Measured at the time of the fix: 14 pending tasks
 * displaying `[locked:cli]` with locks 22.6h-102.5h old, and 2584 rows across
 * 303 holders carrying a stale lock.
 *
 * EVERY case below is a PAIR. The expired assertion alone is vacuous — a
 * renderer that dropped lock rendering entirely, or one handed a task with no
 * lock at all, would satisfy it. The fresh-lock positive control is what proves
 * the surface can still say "held", so that the expired assertion is evidence
 * about expiry rather than about the renderer being mute.
 */
import { describe, expect, test } from "bun:test";
import { LOCK_EXPIRY_MINUTES } from "../db/database.js";
import { formatTask, formatTaskDetail } from "../mcp/index.js";
import type { Task } from "../types/index.js";
import { lockDisplayState } from "../lib/lock-display.js";
import { formatTaskLine } from "./helpers.js";

const MINUTE_MS = 60 * 1000;

/** Well past the 30-minute window — the shape that was rendering as held. */
const STALE_AT = new Date(Date.now() - (LOCK_EXPIRY_MINUTES + 60) * MINUTE_MS).toISOString();
/** Comfortably inside the window — the positive control. */
const FRESH_AT = new Date(Date.now() - 1 * MINUTE_MS).toISOString();

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    short_id: "ec3690cc",
    project_id: null,
    parent_id: null,
    plan_id: null,
    task_list_id: null,
    // Deliberately avoids the word "expired": the detail positive control
    // asserts that word is ABSENT for a live lock, so a fixture carrying it
    // would fail for the wrong reason.
    title: "render a lapsed lock honestly",
    description: null,
    status: "pending",
    priority: "medium",
    agent_id: null,
    assigned_to: null,
    session_id: null,
    working_dir: null,
    tags: [],
    metadata: {},
    version: 1,
    locked_by: null,
    locked_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    due_at: null,
    estimated_minutes: null,
    actual_minutes: null,
    requires_approval: false,
    approved_by: null,
    approved_at: null,
    recurrence_rule: null,
    recurrence_parent_id: null,
    spawns_template_id: null,
    confidence: null,
    reason: null,
    spawned_from_session: null,
    assigned_by: null,
    created_by: null,
    assigned_from_project: null,
    task_type: null,
    cost_tokens: 0,
    cost_usd: 0,
    delegated_from: null,
    delegation_depth: 0,
    retry_count: 0,
    max_retries: 0,
    retry_after: null,
    sla_minutes: null,
    runner_id: null,
    runner_started_at: null,
    runner_completed_at: null,
    current_step: null,
    total_steps: null,
    ...over,
  };
}

const stale = () => makeTask({ locked_by: "cli", locked_at: STALE_AT });
const fresh = () => makeTask({ locked_by: "cli", locked_at: FRESH_AT });

/** Strip ANSI so assertions test the text, not whatever chalk decided about color. */
// eslint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\[[0-9;]*m/g, "");

describe("lockDisplayState", () => {
  test("a lapsed lock is expired, not held", () => {
    const s = lockDisplayState("cli", STALE_AT);
    expect(s.present).toBe(true);
    expect(s.held).toBe(false);
    expect(s.expired).toBe(true);
    expect(s.holder).toBe("cli");
  });

  // POSITIVE CONTROL for the whole predicate.
  test("a fresh lock is held", () => {
    const s = lockDisplayState("cli", FRESH_AT);
    expect(s.held).toBe(true);
    expect(s.expired).toBe(false);
  });

  test("no holder is neither held nor expired", () => {
    const s = lockDisplayState(null, null);
    expect(s.present).toBe(false);
    expect(s.held).toBe(false);
    expect(s.expired).toBe(false);
  });

  test("a holder with no timestamp cannot be shown as held", () => {
    // isLockExpired(null) is true and the claim path treats such a row as free.
    const s = lockDisplayState("cli", null);
    expect(s.held).toBe(false);
    expect(s.expired).toBe(true);
  });

  test("the boundary belongs to the held side", () => {
    const nowMs = Date.now();
    const exactly = new Date(nowMs - LOCK_EXPIRY_MINUTES * MINUTE_MS).toISOString();
    expect(lockDisplayState("cli", exactly, nowMs).held).toBe(true);
    const justPast = new Date(nowMs - LOCK_EXPIRY_MINUTES * MINUTE_MS - 1).toISOString();
    expect(lockDisplayState("cli", justPast, nowMs).held).toBe(false);
  });
});

describe("formatTaskLine (todos list)", () => {
  test("an expired lock renders NO live-lock indication", () => {
    expect(plain(formatTaskLine(stale()))).not.toContain("[locked:");
  });

  // POSITIVE CONTROL — without this, a renderer that never shows locks passes above.
  test("a fresh lock still renders as held", () => {
    expect(plain(formatTaskLine(fresh()))).toContain("[locked:cli]");
  });

  test("the rest of the line is untouched by the lock decision", () => {
    expect(plain(formatTaskLine(stale()))).toContain("render a lapsed lock honestly");
  });
});

describe("mcp formatTask (compact summary)", () => {
  test("an expired lock renders NO live-lock indication", () => {
    expect(formatTask(stale())).not.toContain("[locked:");
  });

  // POSITIVE CONTROL
  test("a fresh lock still renders as held", () => {
    expect(formatTask(fresh())).toContain("[locked:cli]");
  });
});

describe("mcp formatTaskDetail (get_task)", () => {
  test("an expired lock is labelled expired and never as 'Locked by'", () => {
    const out = formatTaskDetail(stale());
    expect(out).not.toContain("Locked by:");
    expect(out).toContain("expired");
    // Detail surfaces keep the holder for diagnosis; it just cannot read as live.
    expect(out).toContain("last held by cli");
  });

  // POSITIVE CONTROL
  test("a fresh lock still renders as 'Locked by'", () => {
    const out = formatTaskDetail(fresh());
    expect(out).toContain("Locked by: cli");
    expect(out).not.toContain("expired");
  });
});
