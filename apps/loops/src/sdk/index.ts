import type { CreateLoopInput, Goal, GoalRun, Loop, LoopRun, LoopStatus, RunStatus } from "../types.js";
import { advanceLoop, executeClaimedRun, manualRunScheduledFor, shouldAdvanceManualRun, tick } from "../lib/scheduler.js";
import { Store } from "../lib/store.js";
import { mergeLoopLabels, normalizeLoopLabels, removeLoopLabels } from "../lib/labels.js";
export { runGoal } from "../lib/goal/runner.js";

export interface LoopsClientOptions {
  store?: Store;
  runnerId?: string;
}

export interface ListLoopsOptions {
  status?: LoopStatus;
  label?: string;
  labels?: string[];
  limit?: number;
}

export interface ListRunsOptions {
  loopId?: string;
  status?: RunStatus;
  label?: string;
  labels?: string[];
  limit?: number;
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

  list(opts: ListLoopsOptions = {}): Loop[] {
    return this.store.listLoops(opts);
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

  setLabels(idOrName: string, labels: string[]): Loop {
    const loop = this.get(idOrName);
    return this.store.updateLoop(loop.id, { labels: normalizeLoopLabels(labels) });
  }

  addLabels(idOrName: string, labels: string[]): Loop {
    const loop = this.get(idOrName);
    return this.store.updateLoop(loop.id, { labels: mergeLoopLabels(loop.labels, labels) });
  }

  removeLabels(idOrName: string, labels: string[]): Loop {
    const loop = this.get(idOrName);
    return this.store.updateLoop(loop.id, { labels: removeLoopLabels(loop.labels, labels) });
  }

  delete(idOrName: string): boolean {
    return this.store.deleteLoop(idOrName);
  }

  runs(loopIdOrOpts?: string | ListRunsOptions, opts: Omit<ListRunsOptions, "loopId"> = {}): LoopRun[] {
    if (typeof loopIdOrOpts === "string" || loopIdOrOpts === undefined) {
      return this.store.listRuns({ ...opts, loopId: loopIdOrOpts });
    }
    return this.store.listRuns(loopIdOrOpts);
  }

  goal(idOrName: string): { goal?: Goal; runs: GoalRun[] } {
    const goal = this.store.getGoal(idOrName) ?? this.store.findGoalByLoop(idOrName) ?? this.store.findGoalByRunId(idOrName);
    return {
      goal,
      runs: goal ? this.store.listGoalRuns({ goalId: goal.goalId }) : [],
    };
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
