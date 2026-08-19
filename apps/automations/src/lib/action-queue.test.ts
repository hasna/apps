import { describe, expect, test } from "bun:test";
import {
  QUEUE_ENTRY_STATUSES,
  QUEUE_ENTRY_TERMINAL_STATUSES,
  assertQueueEntryStatus,
  isTerminalQueueEntryStatus,
} from "./action-queue.js";
import type {
  ActionQueueApprovalDecisionStatus,
  ActionQueueApprovalMode,
} from "./action-queue.js";

// agent-authored (SOL consult bounded: capacity refusal + wall-time exhaustion)

describe("queue entry status vocabulary", () => {
  test("exposes the full lifecycle in admission-first order", () => {
    expect(QUEUE_ENTRY_STATUSES).toEqual([
      "admitted",
      "waiting_approval",
      "leased",
      "succeeded",
      "failed",
      "dead",
      "cancelled",
    ]);
  });

  test("names exactly the four terminal statuses as the terminal set", () => {
    expect(QUEUE_ENTRY_TERMINAL_STATUSES).toEqual(["succeeded", "failed", "dead", "cancelled"]);
  });

  test("assertQueueEntryStatus accepts every vocabulary member and returns it", () => {
    for (const status of QUEUE_ENTRY_STATUSES) {
      expect(assertQueueEntryStatus(status)).toBe(status);
    }
  });

  test("assertQueueEntryStatus rejects unknown statuses with the vocabulary message", () => {
    expect(() => assertQueueEntryStatus("enqueued")).toThrow("unsupported queue entry status: enqueued");
    expect(() => assertQueueEntryStatus("retrying")).toThrow("unsupported queue entry status: retrying");
    expect(() => assertQueueEntryStatus("")).toThrow("unsupported queue entry status: ");
    expect(() => assertQueueEntryStatus("LEASED")).toThrow("unsupported queue entry status: LEASED");
  });

  test("isTerminalQueueEntryStatus is true only for terminal members", () => {
    for (const status of QUEUE_ENTRY_TERMINAL_STATUSES) {
      expect(isTerminalQueueEntryStatus(status)).toBe(true);
    }
    expect(isTerminalQueueEntryStatus("admitted")).toBe(false);
    expect(isTerminalQueueEntryStatus("waiting_approval")).toBe(false);
    expect(isTerminalQueueEntryStatus("leased")).toBe(false);
  });
});

describe("approval vocabulary widening (contracts-alignment)", () => {
  const hasNeverMode: "never" extends ActionQueueApprovalMode ? true : false = true;
  const hasPreviewMode: "preview" extends ActionQueueApprovalMode ? true : false = true;
  const hasStepUpMode: "step-up" extends ActionQueueApprovalMode ? true : false = true;
  const hasExpiredDecision: "expired" extends ActionQueueApprovalDecisionStatus ? true : false = true;
  const hasCancelledDecision: "cancelled" extends ActionQueueApprovalDecisionStatus ? true : false = true;

  test("approval mode admits the operator-only never/preview/step-up widenings", () => {
    expect(hasNeverMode).toBe(true);
    expect(hasPreviewMode).toBe(true);
    expect(hasStepUpMode).toBe(true);
  });

  test("approval decision status admits the expired and cancelled widenings", () => {
    expect(hasExpiredDecision).toBe(true);
    expect(hasCancelledDecision).toBe(true);
  });
});
