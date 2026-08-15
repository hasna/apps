import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/migrations";
import { createSearch } from "../db/searches";
import { createResult } from "../db/results";
import { exportResults } from "./export";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
});

describe("export", () => {
  function seedData() {
    const s = createSearch({ query: "test export", providers: ["google"] }, db);
    createResult(
      { searchId: s.id, title: "Result One", url: "https://one.com", snippet: "First result", source: "google", provider: "Google", rank: 1, score: 0.9 },
      db,
    );
    createResult(
      { searchId: s.id, title: "Result Two", url: "https://two.com", snippet: "Second result", source: "exa", provider: "Exa", rank: 2, score: 0.7 },
      db,
    );
    return s;
  }

  it("should export as JSON", () => {
    const s = seedData();
    const output = exportResults(s.id, "json", db);
    const parsed = JSON.parse(output);
    expect(parsed.length).toBe(2);
    expect(parsed[0].title).toBe("Result One");
  });

  it("should export as CSV", () => {
    const s = seedData();
    const output = exportResults(s.id, "csv", db);
    const lines = output.split("\n");
    expect(lines[0]).toBe("rank,title,url,snippet,source,provider,score,published_at");
    expect(lines.length).toBe(3); // header + 2 rows
  });

  it("should export as Markdown", () => {
    const s = seedData();
    const output = exportResults(s.id, "md", db);
    expect(output).toContain("# Search Results: test export");
    expect(output).toContain("Result One");
    expect(output).toContain("https://one.com");
  });

  it("should throw for non-existent search", () => {
    expect(() => exportResults("nonexistent", "json", db)).toThrow("Search not found");
  });
});
