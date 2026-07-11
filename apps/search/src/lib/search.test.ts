import { afterEach, describe, expect, mock, test } from "bun:test";
import { getDbForTesting } from "../db/database.js";
import { getResult } from "../db/results.js";
import { unifiedSearch } from "./search.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("unifiedSearch persistence", () => {
  test("returned search and result ids match persisted history", async () => {
    const db = getDbForTesting();
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            hits: [
              {
                objectID: "1",
                title: "SQLite FTS discussion",
                url: "https://example.com/sqlite-fts",
                points: 10,
                num_comments: 2,
                created_at: "2026-01-01T00:00:00Z",
              },
            ],
          }),
        ),
      ),
    ) as unknown as typeof fetch;

    const response = await unifiedSearch("sqlite fts", {
      providers: ["hackernews"],
      db,
    });

    expect(response.results.length).toBe(1);
    expect(response.results[0]!.searchId).toBe(response.search.id);
    expect(getResult(response.results[0]!.id, db)?.searchId).toBe(response.search.id);
  });
});
