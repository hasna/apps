// Shared contract for SDK-based training data gatherers.
// Every open-* repo exports a `gatherTrainingData` function matching this interface.
// open-brains imports it directly — no direct DB reads, no schema coupling.

import type { GathererOptions, GatherResult } from "./types.js";

/**
 * A function that gathers training examples from a data source.
 * Implemented by each open-* repo and exported from their SDK.
 *
 * @example
 * // In open-styles:
 * export const gatherTrainingData: GatherTrainingDataFn = async (options) => { ... }
 *
 * // In open-brains gatherer registry:
 * import { gatherTrainingData } from "@hasnaxyz/styles";
 * registerGatherer("styles", gatherTrainingData);
 */
export type GatherTrainingDataFn = (options?: GathererOptions) => Promise<GatherResult>;

/**
 * A named, registered training data provider.
 * Used by the gatherer registry to map source names to gatherer functions.
 */
export interface TrainingDataProvider {
  /** Source name used in `brains data gather --source <name>` */
  name: string;
  /** The gather function — imported from the repo's SDK */
  gather: GatherTrainingDataFn;
  /** Human-readable description shown in `brains data gather --list` */
  description: string;
  /** Optional: package name of the SDK this gatherer comes from */
  package?: string;
}
