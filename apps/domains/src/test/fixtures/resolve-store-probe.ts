/**
 * Probe fixture for `store-runner-context.test.ts`. NOT a test file — it is
 * spawned as a plain `bun <file>` subprocess so that the store resolution runs
 * in the UNPROTECTED runner context, which is the one context a file executed
 * by `bun test` can never be in.
 *
 * It resolves the store and prints one line of JSON. It never calls a store
 * METHOD, so it neither reads nor writes any dataset: `LocalStore` opens sqlite
 * lazily and `ApiStore` performs no I/O at construction.
 */
import { getStore, getStoreResolution } from "../../db/store.js";

let outcome: string;
try {
  outcome = getStoreResolution(process.env).transport;
  if (outcome === "http") {
    outcome = (getStore(process.env) as unknown as { transport: string }).transport;
  }
} catch (error) {
  outcome = "THREW:" + (error instanceof Error ? error.message : String(error));
}

console.log(JSON.stringify({ outcome }));