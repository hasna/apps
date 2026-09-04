/**
 * Bun test preload: make this package's own suite physically unable to reach a
 * store shared with other people.
 *
 * ## Why this file exists
 *
 * `src/testing.ts` already solves this problem — it owns the list of variables
 * that route this client at a shared store, next to the resolver that reads
 * them, with a coverage test that fails if the resolver grows a variable the
 * scrub list does not know about. Its own doc comment names the intended entry
 * point: "call before the SDK is imported — e.g. a bun test preload".
 *
 * That preload was never written. So the package shipped the fix to its
 * consumers (`open-loops`, other consumer repos) and did not apply it to itself:
 * measured on station01 2026-07-31, `bun test` in this repo ran with
 * `HASNA_TODOS_STORAGE_MODE=remote` and `HASNA_TODOS_API_URL` pointing at the
 * live fleet coordination store, with 0 of 237 test files clearing them. A
 * reviewer's `TODOS_DB_PATH` was silently overridden by that ambient mode and
 * briefly completed production task `b9cdd17c` (#incidents 615551).
 *
 * A wrongly-completed task is invisible by construction: the search that would
 * find it is the search that filters it out. So the guarantee has to be
 * structural rather than a rule reviewers remember.
 *
 * ## What it does, and what it deliberately does not do
 *
 * It runs ONCE at preload, before any test module is imported — not in a
 * `beforeEach`. A per-test reset would clobber the `beforeAll` setup that
 * existing test files already do across 237 files, trading one silent failure
 * for another. Running once establishes a hermetic floor that any test may
 * still override explicitly: overrides are applied after the scrub, so a test
 * that deliberately exercises the hosted transport against a throwaway server
 * opts back in exactly as it does today.
 *
 * The database path is pinned to a per-process temporary file rather than left
 * blank. Blank resolves to the developer's real local todos database, which is
 * a live store too — smaller blast radius than the hosted one, still not this
 * process's to write to.
 *
 * `applyLocalTodosTestEnv` also defaults the EXPLICIT local opt-in
 * (`HASNA_TODOS_LOCAL=1` / `TODOS_LOCAL=1`) on this process's env — required
 * since the 2026-09-04 fail-closed ruling (hasna/apps#1613), where the
 * resolver refuses an absent API pair without it. In-process tests inherit it
 * directly; subprocess tests inherit it through `{...process.env}` spreads or
 * via `localTodosTestEnv`/`localRoutingTestEnv`. A test that spawns a CLI with
 * an env built from scratch must set the opt-in itself or it fails closed by
 * design.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyLocalTodosTestEnv } from "../src/testing.js";

const workerRoot = mkdtempSync(join(tmpdir(), "todos-test-store-"));
const databasePath = join(workerRoot, "todos.db");

applyLocalTodosTestEnv({
  // Pin the LOWER-precedence variable only, and deliberately leave
  // HASNA_TODOS_DB_PATH unset. `resolveDatabasePath` (src/db/database.ts:71-75)
  // prefers HASNA_TODOS_DB_PATH and falls through to TODOS_DB_PATH, both
  // truthy-checked. Pinning the higher-precedence one here would silently
  // OUTRANK the many existing tests that set only TODOS_DB_PATH for their own
  // per-test temp database — src/cli-events.test.ts is one — collapsing them
  // onto this single process-wide file and bleeding state between cases.
  //
  // Setting the lower one instead is strictly safer in all three directions: a
  // test that sets TODOS_DB_PATH overrides this by assigning the same key, a
  // test that sets HASNA_TODOS_DB_PATH wins on precedence, and a test that sets
  // neither lands here instead of on the developer's real database.
  TODOS_DB_PATH: databasePath,
});

// The restore function is intentionally discarded: this process is a test
// runner and there is no later phase that should see the ambient routing back.

// Remove the temporary database on the way out so a repeated `bun test` does
// not leave one directory per run behind in the system temp. Registered with
// `process.once` rather than in an afterAll hook: the preload has no test
// lifecycle of its own, and this must also run when the suite exits early.
// Guarded so a failure to clean can never turn a green suite red.
process.once("exit", () => {
  try {
    rmSync(workerRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  } catch {
    // Best effort: a leaked temp directory is not worth failing a test run over.
  }
});
