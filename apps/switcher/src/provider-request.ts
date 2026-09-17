/** Internal timing injection keeps streaming regressions fast without CLI knobs. */
export type ProviderRequestTiming = { idleTimeoutMs?: number };

/** Bound upstream inactivity, without charging downstream backpressure as idle. */
export function createProviderRequest(requestSignal: AbortSignal, abortSignal: AbortSignal, timing: ProviderRequestTiming = {}) {
  const idleTimeoutMs = timing.idleTimeoutMs ?? 240000;
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) throw new Error("Invalid provider idle timeout.");
  const idle = new AbortController();
  const signal = AbortSignal.any([requestSignal, abortSignal, idle.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined, finished = false, timedOut = false;
  const received = () => { clearTimeout(timer); timer = undefined; };
  const finish = () => { finished = true; received(); signal.removeEventListener("abort", finish); };
  const waiting = () => {
    if (finished || signal.aborted || timer !== undefined) return;
    timer = setTimeout(() => {
      timedOut = true;
      idle.abort(new DOMException("Provider response idle timeout", "TimeoutError"));
    }, idleTimeoutMs);
  };
  signal.addEventListener("abort", finish, { once: true });
  waiting(); // Covers connection establishment and the wait for response headers.
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    waiting();
    let onAbort!: () => void;
    try {
      if (signal.aborted) throw signal.reason;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      });
      return await Promise.race([operation(), aborted]);
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
      received();
    }
  };
  return {
    // Bun 1.3.14 implements timeout:false, although its pinned types omit it:
    // https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/runtime/webcore/fetch.zig#L551
    // The owned watchdog replaces Bun's independent socket idle timer.
    fetchOptions: { signal, timeout: false as const },
    run, finish, timedOut: () => timedOut,
  };
}

export type ProviderRequest = ReturnType<typeof createProviderRequest>;
