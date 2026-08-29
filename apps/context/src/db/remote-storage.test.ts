/**
 * Regression coverage for hosted-backend search error semantics.
 *
 * ROOT CAUSE guarded here: PgAdapterAsync.searchChunks / searchLibraries
 * suppressed every query failure as `return []`, so a pre-migration database
 * or a PostgreSQL failure made the server respond HTTP 200 with no matches
 * while stored results existed. Search failures must propagate to the caller
 * (the server then surfaces a 500), while a genuinely empty query remains an
 * empty result, never an error.
 *
 * No real Postgres is needed: the class is subclassed and `all` is stubbed to
 * throw, which exercises the exact suppression site without a network round
 * trip. bun's test runner executes every file in one process, so process.env
 * must stay untouched here (the local storage mode is never consulted).
 */
import { describe, expect, test } from "bun:test";
import { PgAdapterAsync } from "./remote-storage.js";

class FailingAdapter extends PgAdapterAsync {
  override async all(): Promise<unknown[]> {
    throw new Error("column c.content_tsv does not exist");
  }
}

describe("PgAdapterAsync hosted search error semantics", () => {
  test("searchChunks propagates a query failure instead of returning an empty array", async () => {
    const adapter = new FailingAdapter("postgres://unused@127.0.0.1:1/unused");
    try {
      await expect(adapter.searchChunks("typescript", undefined, 10)).rejects.toThrow(
        "column c.content_tsv does not exist",
      );
    } finally {
      await adapter.close();
    }
  });

  test("searchLibraries propagates an FTS query failure instead of returning an empty array", async () => {
    const adapter = new FailingAdapter("postgres://unused@127.0.0.1:1/unused");
    try {
      await expect(adapter.searchLibraries("typescript", 10)).rejects.toThrow(
        "column c.content_tsv does not exist",
      );
    } finally {
      await adapter.close();
    }
  });

  test("a query with no FTS tokens stays a legitimate empty result, not an error", async () => {
    const adapter = new FailingAdapter("postgres://unused@127.0.0.1:1/unused");
    try {
      // All tokens stripped by buildPrefixTsQuery (e.g. punctuation only):
      // no query is built, so no database round trip happens at all.
      await expect(adapter.searchChunks("!!!", undefined, 10)).resolves.toEqual([]);
      await expect(adapter.searchLibraries("!!!", 10)).resolves.toEqual([]);
    } finally {
      await adapter.close();
    }
  });
});
