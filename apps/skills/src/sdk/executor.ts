/**
 * Executor seam: what actually runs a claimed skill run.
 *
 * The interface is the contract an embedder supplies an executor against. The current
 * implementation is the provider-free deterministic handler the shipped worker runs
 * (src/server/handlers.ts) — same logs, same artifacts, same terminal transitions.
 */
import { ArtifactStorage } from "../server/artifact-storage.js";
import { executeRun } from "../server/handlers.js";
import type { ServerRunRecord, SkillsProductStore } from "../server/types.js";

/** Executes one claimed run to a terminal state. */
export interface RunExecutor {
  execute(
    store: SkillsProductStore,
    run: ServerRunRecord,
    storage?: ArtifactStorage,
  ): Promise<ServerRunRecord>;
}

/** Current implementation: the shipped deterministic handler, unchanged. */
export const localRunExecutor: RunExecutor = {
  execute: (store, run, storage) => executeRun(store, run, storage),
};

export { executeRun };
