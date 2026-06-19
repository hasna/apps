import type { CreateLoopInput, Loop, LoopRun } from "../types.js";
import { advanceLoop, executeClaimedRun, manualRunScheduledFor, shouldAdvanceManualRun, tick } from "../lib/scheduler.js";
import { Store } from "../lib/store.js";

export interface LoopsClientOptions {
  store?: Store;
  runnerId?: string;
}

export class LoopsClient {
  readonly store: Store;
  private readonly ownStore: boolean;
  private readonly runnerId: string;

  constructor(opts: LoopsClientOptions = {}) {
    this.store = opts.store ?? new Store();
    this.ownStore = !opts.store;
    this.runnerId = opts.runnerId ?? `sdk:${process.pid}`;
  }

  create(input: CreateLoopInput): Loop {
    return this.store.createLoop(input);
  }

  list(): Loop[] {
    return this.store.listLoops();
  }

  get(idOrName: string): Loop {
    return this.store.requireLoop(idOrName);
  }

  pause(idOrName: string): Loop {
    const loop = this.get(idOrName);
    return this.store.updateLoop(loop.id, { status: "paused" });
  }

  resume(idOrName: string): Loop {
    const loop = this.get(idOrName);
    return this.store.updateLoop(loop.id, { status: "active" });
  }

  stop(idOrName: string): Loop {
    const loop = this.get(idOrName);
    return this.store.updateLoop(loop.id, { status: "stopped", nextRunAt: undefined });
  }

  delete(idOrName: string): boolean {
    return this.store.deleteLoop(idOrName);
  }

  runs(loopId?: string): LoopRun[] {
    return this.store.listRuns({ loopId });
  }

  async tick(): Promise<Awaited<ReturnType<typeof tick>>> {
    return tick({ store: this.store, runnerId: this.runnerId });
  }

  async runNow(idOrName: string): Promise<LoopRun> {
    const loop = this.get(idOrName);
    const now = new Date();
    let scheduledFor = manualRunScheduledFor(loop, now);
    let shouldAdvance = shouldAdvanceManualRun(loop, scheduledFor, now);
    let claim = this.store.claimRun(loop, scheduledFor, this.runnerId, now);
    if (!claim && shouldAdvance) {
      const existing = this.store.getRunBySlot(loop.id, scheduledFor);
      if (existing && existing.status !== "running") {
        scheduledFor = now.toISOString();
        shouldAdvance = false;
        claim = this.store.claimRun(loop, scheduledFor, this.runnerId, now);
      }
    }
    if (!claim) throw new Error(`could not claim manual run for ${idOrName}`);
    const run = await executeClaimedRun({ store: this.store, runnerId: this.runnerId, loop: claim.loop, run: claim.run });
    if (shouldAdvance) {
      advanceLoop(this.store, claim.loop, run, new Date(run.finishedAt ?? new Date()), run.status === "succeeded");
    }
    return run;
  }

  close(): void {
    if (this.ownStore) this.store.close();
  }
}

export function loops(opts: LoopsClientOptions = {}): LoopsClient {
  return new LoopsClient(opts);
}
