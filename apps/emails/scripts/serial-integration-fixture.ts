// Test-only coordination for cases that reset the same disposable SQL schema.
// Bun times out its waiter without cancelling the callback's pending queries.
export const MIGRATION_CASE_TIMEOUT_MS = 30_000;
export const MIGRATION_DRAIN_TIMEOUT_MS = 10_000;

export function createSerialIntegrationFixture(drainTimeoutMs = MIGRATION_DRAIN_TIMEOUT_MS) {
  if (!Number.isFinite(drainTimeoutMs) || drainTimeoutMs <= 0) throw new Error("Invalid fixture drain deadline");
  let pending: Promise<void> | undefined;
  let poisoned = false;
  return {
    run(work: () => Promise<void>): Promise<void> {
      if (poisoned || pending) throw new Error("Previous integration callback has not safely drained; refusing another schema reset");
      const result = Promise.resolve().then(work);
      // Observe a late rejection even after Bun has timed out its own waiter.
      // The original promise is returned unchanged, so ordinary failures fail.
      const settled = result.then(() => {}, () => {});
      pending = settled;
      void settled.then(() => { if (pending === settled) pending = undefined; });
      return result;
    },
    async drain(): Promise<void> {
      if (!pending) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([pending, new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            poisoned = true;
            reject(new Error("Integration callback exceeded the drain deadline; further schema resets are disabled"));
          }, drainTimeoutMs);
        })]);
      } finally { clearTimeout(timer); }
    },
  };
}
