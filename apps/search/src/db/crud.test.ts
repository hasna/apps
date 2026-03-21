import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "./migrations";
import { createSearch, getSearch, listSearches, deleteSearch, getSearchStats } from "./searches";
import { createResult, createResults, getResult, listResults, searchResultsFts } from "./results";
import { createSavedSearch, getSavedSearch, listSavedSearches, deleteSavedSearch, updateSavedSearchLastRun } from "./saved-searches";
import { getProvider, listProviders, enableProvider, disableProvider, updateProvider } from "./providers";
import { getProfile, getProfileByName, listProfiles, createProfile, deleteProfile } from "./profiles";

let db: Database;

function freshDb(): Database {
  const d = new Database(":memory:");
  d.exec("PRAGMA journal_mode = WAL");
  d.exec("PRAGMA foreign_keys = ON");
  runMigrations(d);
  return d;
}

beforeEach(() => {
  db = freshDb();
});

describe("searches CRUD", () => {
  it("should create and get a search", () => {
    const s = createSearch({ query: "test query", providers: ["google", "exa"] }, db);
    expect(s.query).toBe("test query");
    expect(s.providers).toEqual(["google", "exa"]);
    expect(s.resultCount).toBe(0);

    const got = getSearch(s.id, db);
    expect(got).toBeTruthy();
    expect(got!.query).toBe("test query");
  });

  it("should list searches with pagination", () => {
    for (let i = 0; i < 5; i++) {
      createSearch({ query: `query ${i}`, providers: ["google"] }, db);
    }
    const { searches, total } = listSearches({ limit: 3 }, db);
    expect(total).toBe(5);
    expect(searches.length).toBe(3);
  });

  it("should filter searches by query", () => {
    createSearch({ query: "typescript tips", providers: ["google"] }, db);
    createSearch({ query: "python tips", providers: ["google"] }, db);
    const { searches } = listSearches({ query: "typescript" }, db);
    expect(searches.length).toBe(1);
    expect(searches[0]!.query).toBe("typescript tips");
  });

  it("should delete a search", () => {
    const s = createSearch({ query: "to delete", providers: ["exa"] }, db);
    expect(deleteSearch(s.id, db)).toBe(true);
    expect(getSearch(s.id, db)).toBeNull();
  });

  it("should return stats", () => {
    createSearch({ query: "q1", providers: ["google"], resultCount: 5 }, db);
    const stats = getSearchStats(db);
    expect(stats.totalSearches).toBe(1);
  });
});

describe("results CRUD", () => {
  it("should create and get a result", () => {
    const s = createSearch({ query: "test", providers: ["google"] }, db);
    const r = createResult(
      { searchId: s.id, title: "Test Result", url: "https://example.com", snippet: "A test", source: "google", provider: "Google", rank: 1 },
      db,
    );
    expect(r.title).toBe("Test Result");

    const got = getResult(r.id, db);
    expect(got).toBeTruthy();
    expect(got!.url).toBe("https://example.com");
  });

  it("should batch create results", () => {
    const s = createSearch({ query: "batch", providers: ["google"] }, db);
    const results = createResults(
      [
        { searchId: s.id, title: "R1", url: "https://a.com", snippet: "a", source: "google", provider: "Google", rank: 1 },
        { searchId: s.id, title: "R2", url: "https://b.com", snippet: "b", source: "exa", provider: "Exa", rank: 2 },
      ],
      db,
    );
    expect(results.length).toBe(2);

    const listed = listResults(s.id, {}, db);
    expect(listed.length).toBe(2);
  });

  it("should cascade delete results when search deleted", () => {
    const s = createSearch({ query: "cascade", providers: ["google"] }, db);
    createResult({ searchId: s.id, title: "R", url: "https://c.com", snippet: "", source: "google", provider: "Google", rank: 1 }, db);
    deleteSearch(s.id, db);
    const results = listResults(s.id, {}, db);
    expect(results.length).toBe(0);
  });

  it("should FTS search results", () => {
    const s = createSearch({ query: "fts", providers: ["google"] }, db);
    createResult({ searchId: s.id, title: "TypeScript Guide", url: "https://ts.com", snippet: "Learn TypeScript", source: "google", provider: "Google", rank: 1 }, db);
    createResult({ searchId: s.id, title: "Python Guide", url: "https://py.com", snippet: "Learn Python", source: "google", provider: "Google", rank: 2 }, db);

    const ftsResults = searchResultsFts("TypeScript", {}, db);
    expect(ftsResults.length).toBe(1);
    expect(ftsResults[0]!.title).toBe("TypeScript Guide");
  });
});

describe("saved searches CRUD", () => {
  it("should create and get saved search", () => {
    const s = createSavedSearch({ name: "My Search", query: "test", providers: ["google"] }, db);
    expect(s.name).toBe("My Search");
    expect(s.lastRunAt).toBeNull();

    const got = getSavedSearch(s.id, db);
    expect(got!.query).toBe("test");
  });

  it("should list and delete saved searches", () => {
    createSavedSearch({ name: "S1", query: "q1", providers: [] }, db);
    createSavedSearch({ name: "S2", query: "q2", providers: [] }, db);
    expect(listSavedSearches(db).length).toBe(2);

    const items = listSavedSearches(db);
    deleteSavedSearch(items[0]!.id, db);
    expect(listSavedSearches(db).length).toBe(1);
  });

  it("should update lastRunAt", () => {
    const s = createSavedSearch({ name: "Run", query: "q", providers: [] }, db);
    expect(s.lastRunAt).toBeNull();
    updateSavedSearchLastRun(s.id, db);
    const got = getSavedSearch(s.id, db);
    expect(got!.lastRunAt).toBeTruthy();
  });
});

describe("providers CRUD", () => {
  it("should list seeded providers", () => {
    const providers = listProviders(db);
    expect(providers.length).toBe(12);
    const names = providers.map((p) => p.name);
    expect(names).toContain("google");
    expect(names).toContain("arxiv");
    expect(names).toContain("hackernews");
  });

  it("should get a provider", () => {
    const p = getProvider("google", db);
    expect(p).toBeTruthy();
    expect(p!.apiKeyEnv).toBe("SERP_API_KEY");
    expect(p!.enabled).toBe(true);
  });

  it("should enable/disable a provider", () => {
    disableProvider("google", db);
    expect(getProvider("google", db)!.enabled).toBe(false);
    enableProvider("google", db);
    expect(getProvider("google", db)!.enabled).toBe(true);
  });

  it("should update provider config", () => {
    updateProvider("google", { rateLimit: 200 }, db);
    expect(getProvider("google", db)!.rateLimit).toBe(200);
  });
});

describe("profiles CRUD", () => {
  it("should list seeded profiles", () => {
    const profiles = listProfiles(db);
    expect(profiles.length).toBe(6);
    const names = profiles.map((p) => p.name);
    expect(names).toContain("research");
    expect(names).toContain("social");
    expect(names).toContain("code");
    expect(names).toContain("academic");
  });

  it("should get profile by name", () => {
    const p = getProfileByName("research", db);
    expect(p).toBeTruthy();
    expect(p!.providers).toContain("google");
    expect(p!.providers).toContain("exa");
  });

  it("should create and delete a profile", () => {
    const p = createProfile({ name: "custom", providers: ["brave", "bing"], description: "Custom profile" }, db);
    expect(p.name).toBe("custom");
    expect(listProfiles(db).length).toBe(7);

    deleteProfile(p.id, db);
    expect(listProfiles(db).length).toBe(6);
  });
});
