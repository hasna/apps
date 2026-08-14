import { existsSync, writeFileSync } from "node:fs";

/**
 * Shared deadline-based polling and process-kill verification helpers for the
 * test suite. Test-only: nothing in src/ production code may import this file.
 */

export interface WaitUntilOptions {
  /** Total time to wait before failing (default 5s). */
  timeoutMs?: number;
  /** Poll interval (default 5ms). */
  intervalMs?: number;
  /** Included in the timeout error to identify the stuck condition. */
  label?: string;
}

/**
 * Poll `check` until it returns a truthy value, with a hard deadline.
 * Returns the first truthy value; throws once the deadline passes so a stuck
 * condition fails the test instead of silently falling through.
 */
export async function waitUntil<T>(
  check: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  opts: WaitUntilOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const intervalMs = opts.intervalMs ?? 5;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= deadline) {
      throw new Error(`waitUntil timed out after ${timeoutMs}ms${opts.label ? `: ${opts.label}` : ""}`);
    }
    await Bun.sleep(intervalMs);
  }
}

/**
 * Shell command that blocks until `gate` exists, then writes `text` to
 * `marker`. Replaces fixed `sleep N; printf ...` fixtures: the child stays
 * alive (blocked on the gate) for exactly as long as the test needs, and a
 * kill can be proven by opening the gate and observing that the marker never
 * appears (see {@link expectMarkerNeverWritten}).
 */
export function gatedWriteCommand(gate: string, marker: string, opts: { text?: string; append?: boolean } = {}): string {
  const redirect = opts.append ? ">>" : ">";
  return `while [ ! -f ${JSON.stringify(gate)} ]; do sleep 0.02; done; printf %s ${JSON.stringify(opts.text ?? "late")} ${redirect} ${JSON.stringify(marker)}`;
}

/** Open a {@link gatedWriteCommand} gate so a still-alive child can finish. */
export function openGate(gate: string): void {
  writeFileSync(gate, "go");
}

/**
 * Prove a gated child process was killed: open the gate and verify the marker
 * still does not appear. A surviving child polls the gate every 20ms, so the
 * default 250ms settle window gives it >10x the time it would need to write.
 */
export async function expectMarkerNeverWritten(gate: string, marker: string, settleMs = 250): Promise<void> {
  openGate(gate);
  await Bun.sleep(settleMs);
  if (existsSync(marker)) {
    throw new Error(`expected killed child to never write marker, but ${marker} exists`);
  }
}
