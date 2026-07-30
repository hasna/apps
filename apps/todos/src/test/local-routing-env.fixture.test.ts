/**
 * Explicit local routing baseline for subprocess tests.
 *
 * Developer machines can carry live self-hosted credentials. Local-intent tests
 * must never inherit those implicitly. Callers may still exercise remote or
 * hybrid modes by passing explicit overrides, which are applied last.
 *
 * This is now a thin alias over the shipped `@hasna/todos/testing` export. The scrub
 * list moved there so consumers outside this repo (iapp-takumi, open-loops) share one
 * source of truth with the resolver instead of hand-copying it — `src/testing.ts`
 * carries the leak history that forced that. The `HASNA_TODOS_DB_PATH: ""` default is
 * preserved here because existing in-repo callers rely on it.
 */
import { localTodosTestEnv } from "../testing.js";

export function localRoutingTestEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return localTodosTestEnv({ HASNA_TODOS_DB_PATH: "", ...overrides });
}
