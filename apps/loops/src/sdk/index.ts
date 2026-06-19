import type { CreateLoopInput, Loop, LoopRun } from "../types.js";
import { executeLoopTarget } from "../lib/workflow-runner.js";
import { tick } from "../lib/scheduler.js";
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
    const scheduledFor = new Date().toISOString();
    const claim = this.store.claimRun(loop, scheduledFor, this.runnerId);
    if (!claim) throw new Error(`could not claim manual run for ${idOrName}`);
    const result = await executeLoopTarget(this.store, loop, claim.run);
    return this.store.finalizeRun(claim.run.id, {
      status: result.status,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      error: result.error,
      pid: result.pid,
    }, {
      claimedBy: claim.run.claimedBy,
    });
  }

  close(): void {
    if (this.ownStore) this.store.close();
  }
}

export function loops(opts: LoopsClientOptions = {}): LoopsClient {
  return new LoopsClient(opts);
}
