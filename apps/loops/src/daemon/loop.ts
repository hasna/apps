export interface LoopOptions {
  tickFn: () => Promise<void> | void;
  intervalMs: number;
  shouldStop: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  onTickError?: (error: unknown) => void;
  sliceMs?: number;
}

export function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runLoop(opts: LoopOptions): Promise<void> {
  const sleep = opts.sleep ?? realSleep;
  const sliceMs = opts.sliceMs ?? 200;
  while (!opts.shouldStop()) {
    try {
      await opts.tickFn();
    } catch (err) {
      opts.onTickError?.(err);
    }
    let waited = 0;
    while (waited < opts.intervalMs && !opts.shouldStop()) {
      const chunk = Math.min(sliceMs, opts.intervalMs - waited);
      await sleep(chunk);
      waited += chunk;
    }
  }
}
