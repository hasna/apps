/**
 * Module-private package brand. This module is not a public package export;
 * only the excluded hermetic fake runner can carry it.
 */
export const HERMETIC_TEST_RUNNER = Symbol("sandboxes.hermetic-test-runner");

export interface HermeticTestRunnerBrand {
  readonly [HERMETIC_TEST_RUNNER]: true;
}
