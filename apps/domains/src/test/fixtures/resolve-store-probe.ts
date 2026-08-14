/**
 * Probe fixture for `store-runner-context.test.ts`. NOT a test file — it is
 * spawned as a plain `bun <file>` subprocess so that the store resolution runs
 * in the UNPROTECTED runner context, which is the one context a file executed
 * by `bun test` can never be in.
 *
 * It resolves the store and prints one line of JSON. It never calls a store
 * METHOD, so it neither reads nor writes any dataset: `LocalStore` opens sqlite
 * lazily and `ApiStore` performs no I/O at construction.
 *
 * It also reports the runner indicators it observed. The test asserts those are
 * absent, so that if a future bun release starts setting `NODE_ENV=test` for a
 * plain `bun <file>` run, the regression fails loudly instead of passing for
 * the wrong reason.
 */
import { getStore } from "../../db/store.js";

let outcome: string;
try {
  outcome = (getStore(process.env) as unknown as { transport: string }).transport;
} catch (error) {
  outcome = "THREW:" + (error instanceof Error ? error.message : String(error));
}

console.log(
  JSON.stringify({
    outcome,
    nodeEnv: process.env["NODE_ENV"] ?? "<unset>",
    vitest: process.env["VITEST"] ?? "<unset>",
    jestWorkerId: process.env["JEST_WORKER_ID"] ?? "<unset>",
  }),
);
