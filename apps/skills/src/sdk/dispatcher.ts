/**
 * Dispatcher adapter seam: how admitted runs leave this process.
 *
 * The interface is the contract — submit a run, cancel a run. The ECS adapter is typed
 * now and not implemented: the launch machinery (task definitions, run-task calls,
 * fencing) is built by the sibling dispatcher implementation task on top of these
 * interfaces. Nothing in this module launches anything.
 */
import type { ServerRunRecord } from "../server/types.js";

/** Outcome of a dispatch attempt. */
export interface DispatchResult {
  accepted: boolean;
  /** Where the run was dispatched to, when known. */
  target?: string;
  /** Human-readable detail, credential-free. */
  detail?: string;
}

/** A dispatcher takes runs out of the queue and puts them in front of an executor. */
export interface Dispatcher {
  submit(run: ServerRunRecord): Promise<DispatchResult>;
  cancel(runId: string): Promise<DispatchResult>;
}

/** Raised by adapters whose launch machinery is not implemented yet. */
export class DispatcherNotImplementedError extends Error {
  constructor(adapter: string, capability: string) {
    super(
      `${adapter} does not implement ${capability} yet — the launch machinery is built by the sibling dispatcher task.`,
    );
    this.name = "DispatcherNotImplementedError";
  }
}

/**
 * ECS launch adapter.
 *
 * Typed against the Dispatcher interface; the run-task launch machinery is a sibling
 * implementation task. Until then every call fails closed with a typed error rather
 * than pretending a run left the process.
 */
export class EcsDispatcher implements Dispatcher {
  async submit(_run: ServerRunRecord): Promise<DispatchResult> {
    throw new DispatcherNotImplementedError("EcsDispatcher", "submit");
  }

  async cancel(_runId: string): Promise<DispatchResult> {
    throw new DispatcherNotImplementedError("EcsDispatcher", "cancel");
  }
}
