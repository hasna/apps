import type { Loop } from "../types.js";
import { DEFAULT_OVERDUE_GRACE_MS } from "./health.js";

/**
 * BUG 96c837b0 — the silent lease-without-execution state.
 *
 * The hosted control plane is scheduler-only: a loop executes only when a
 * `loops-runner` polls POST /v1/runners/claim. `runnerMatchesLoop` gates a
 * machine-pinned loop to a runner whose id equals the machine id, so a pinned
 * loop with no runner serving its machine (and a machine-less loop with no
 * runner at all) stays active and due forever with zero runs recorded and no
 * error anywhere. The only observable state is a healthy-looking active loop
 * whose slots keep passing unclaimed.
 *
 * This classifier surfaces that state on the loop's own record. It never
 * changes scheduling — it only reports what is measurable: an active,
 * non-archived loop whose scheduled slot has passed, that has never been
 * claimed (zero run rows ever), and that has existed past the same overdue
 * grace the health report already uses for unclaimed slots.
 *
 * A run row exists if and only if a runner claimed the loop (claims create
 * run rows before execution), so `hasRuns === false` for a loop that passed
 * its due slot is exactly "no eligible runner served it".
 */

export type LoopExecutionState = "ok" | "unserved";

export interface LoopExecutionStatus {
  state: LoopExecutionState;
  /** Present exactly when `state` is not "ok". Carries the measured facts. */
  reason?: string;
}

export function classifyLoopExecutionStaleness(
  loop: Loop,
  opts: { now: Date; hasRuns: boolean; graceMs?: number },
): LoopExecutionStatus {
  const graceMs = opts.graceMs ?? DEFAULT_OVERDUE_GRACE_MS;
  if (loop.status !== "active") return { state: "ok" };
  if (loop.archivedAt !== undefined) return { state: "ok" };
  if (loop.nextRunAt === undefined) return { state: "ok" };
  const nowMs = opts.now.getTime();
  if (new Date(loop.nextRunAt).getTime() > nowMs) return { state: "ok" }; // slot not due yet
  if (opts.hasRuns) return { state: "ok" }; // claimed at least once: a runner served it
  if (nowMs - new Date(loop.createdAt).getTime() < graceMs) {
    return { state: "ok" }; // inside the first-slot window; a runner may legitimately not have polled yet
  }
  const machineId = loop.machine?.id;
  const reason = machineId
    ? `loop is pinned to machine ${machineId} and its scheduled slot has passed with zero runs recorded; ` +
      `no runner for that machine has claimed it — run a 'loops runner' on ${machineId} or the loop will never execute`
    : "loop is due with zero runs recorded since creation; no runner has claimed it — " +
      "deploy a hosted 'loops runner' or the loop will never execute";
  return { state: "unserved", reason };
}
