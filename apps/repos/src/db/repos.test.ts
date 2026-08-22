import { describe, it, expect, beforeEach, afterAll, afterEach } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, closeDb } from "./database";
import {
  listRepos,
  listAllRepos,
  getRepo,
  upsertRepo,
  deleteRepo,
  searchRepos,
  listCommits,
  bulkInsertCommits,
  searchCommits,
  listBranches,
  bulkInsertBranches,
  listTags,
  bulkInsertTags,
  listRemotes,
  bulkInsertRemotes,
  listPullRequests,
  bulkInsertPullRequests,
  searchPullRequests,
  searchAll,
  getRepoStats,
  getGlobalStats,
  resolveIdOrName,
  setRepoLookupPathStateForTests,
} from "./repos";

// Use in-memory DB for tests
let db: ReturnType<typeof getDb>;

beforeEach(() => {
  closeDb();
  process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
  db = getDb(":memory:");
});

afterAll(() => {
  closeDb();
  delete process.env["HASNA_REPOS_DB_PATH"];
});

describe("repos", () => {
  it("should list repos (empty)", () => {
    expect(listRepos()).toEqual([]);
  });

  it("should upsert a new repo", () => {
    const repo = upsertRepo({ path: "/tmp/test-repo", name: "test-repo" });
    expect(repo.name).toBe("test-repo");
    expect(repo.path).toBe("/tmp/test-repo");
    expect(repo.id).toBeGreaterThan(0);
  });

  it("should update existing repo on upsert", () => {
    upsertRepo({ path: "/tmp/test-repo", name: "test-repo" });
    const updated = upsertRepo({ path: "/tmp/test-repo", name: "test-repo", org: "myorg" });
    expect(updated.org).toBe("myorg");
    const all = listRepos();
    expect(all.length).toBe(1);
  });

  it("should get repo by path", () => {
    upsertRepo({ path: "/tmp/test-repo", name: "test-repo" });
    const repo = getRepo("/tmp/test-repo");
    expect(repo).toBeTruthy();
    expect(repo!.name).toBe("test-repo");
  });

  it("should get repo by name", () => {
    upsertRepo({ path: "/tmp/test-repo", name: "test-repo" });
    const repo = getRepo("test-repo");
    expect(repo).toBeTruthy();
    expect(repo!.path).toBe("/tmp/test-repo");
  });

  it("fails closed when an exact repo name matches multiple rows", () => {
    upsertRepo({ path: "/tmp/test-repo-a", name: "duplicate-name" });
    upsertRepo({ path: "/tmp/test-repo-b", name: "duplicate-name" });
    expect(() => getRepo("duplicate-name")).toThrow("Multiple repos have the exact name");
  });

  // Regression for todos 12ed8c6d-910b-4824-891d-ea5d7edc9c25: GitHub permits
  // all-numeric repository names, so an input like "2048" is ambiguous between
  // a registry id and a repo NAME. resolveIdOrName gives the name row
  // precedence and falls back to the safe-integer id only when no such name
  // exists — the callers (worktree verbs, MCP, HTTP) must never coerce the
  // string to a number before this decision.
  describe("resolveIdOrName", () => {
    it("resolves an all-numeric NAME before the id it resembles", () => {
      db.query("INSERT INTO repos (id, path, name) VALUES (2048, '/tmp/infra-legacy', 'infra-legacy')").run();
      db.query("INSERT INTO repos (id, path, name) VALUES (9, '/tmp/numeric-2048', '2048')").run();
      expect(resolveIdOrName("2048")).toBe("2048");
      expect(getRepo(resolveIdOrName("2048"))!.id).toBe(9);
      // The id stays reachable on its own terms.
      expect(getRepo(2048)!.name).toBe("infra-legacy");
    });

    it("falls back to the safe-integer id when no such name exists", () => {
      db.query("INSERT INTO repos (id, path, name) VALUES (2048, '/tmp/infra-legacy', 'infra-legacy')").run();
      expect(resolveIdOrName("2048")).toBe(2048);
      expect(getRepo(resolveIdOrName("2048"))!.name).toBe("infra-legacy");
    });

    it("passes every other string shape through unchanged", () => {
      expect(resolveIdOrName("0713")).toBe("0713");
      expect(resolveIdOrName("+713")).toBe("+713");
      expect(resolveIdOrName("0")).toBe("0");
      expect(resolveIdOrName("hasna/apps")).toBe("hasna/apps");
      expect(resolveIdOrName("open-loops")).toBe("open-loops");
    });

    it("propagates an ambiguous all-numeric name loudly instead of picking an id", () => {
      db.query("INSERT INTO repos (id, path, name) VALUES (7, '/tmp/dup-a', '2048')").run();
      db.query("INSERT INTO repos (id, path, name) VALUES (8, '/tmp/dup-b', '2048')").run();
      expect(() => resolveIdOrName("2048")).toThrow("Multiple repos have the exact name '2048'");
    });
  });

  // Regression for todos c357a1f3: `repos repo <name> --json` — the exact
  // lookup non-overridable rule 5 mandates for locating a repository —
  // resolved to a stale `_factory_src` scratch clone instead of the canonical
  // checkout, because the clone is indexed under a DIFFERENT `name` value
  // (the bare "loops") than the canonical checkout ("open-loops"), so the
  // clone was the ONLY exact match for the bare name. This is not the
  // multi-row tie the test above covers — a single, deterministic, wrong
  // match — and it reproduced identically on 5 of 5 packages tested live on
  // station01, on @hasna/repos 0.1.38 and still on 0.1.39.
  describe("factory scratch clones never win a bare-name lookup", () => {
    beforeEach(() => {
      // The seeded checkouts live at synthetic /home/u/ paths that do not
      // exist on the test runner. Declare them present so the canonical-remote
      // fallback (todos 0251863c) sees a live checkout and keeps the refusal
      // these tests assert.
      setRepoLookupPathStateForTests((path) =>
        path.startsWith("/home/u/") ? "present" : "missing",
      );
    });

    afterEach(() => setRepoLookupPathStateForTests(null));

    it("refuses a bare name whose only exact match is a factory scratch clone, even though the canonical checkout is indexed under a different name", () => {
      upsertRepo({
        path: "/home/u/workspace/hasna/opensource/open-loops",
        name: "open-loops",
        org: "hasna",
        remote_url: "github.com/hasna/loops",
      });
      upsertRepo({
        path: "/home/u/workspace/hasna/opensource/_factory_src/loops",
        name: "loops",
        org: "hasna",
        remote_url: "github.com/hasna/loops",
      });

      // The bug: this used to return the _factory_src row.
      expect(getRepo("loops")).toBeNull();
      // The canonical name still resolves normally — this lookup refuses the
      // derived-only match, it does not become unable to find real checkouts.
      const canonical = getRepo("open-loops");
      expect(canonical).toBeTruthy();
      expect(canonical!.path).toBe("/home/u/workspace/hasna/opensource/open-loops");
    });

    it("refuses a bare name whose only match is a factory scratch clone with no canonical sibling at all", () => {
      upsertRepo({
        path: "/home/u/workspace/hasna/opensource/_factory_src/onlymirror",
        name: "onlymirror",
        org: "hasna",
      });
      expect(getRepo("onlymirror")).toBeNull();
    });

    it("resolves to the real checkout, not AmbiguousRepoNameError, when a factory scratch clone happens to share an exact name with it", () => {
      // Distinct from the "duplicate-name" test above: there TWO real
      // checkouts share a name, which is a genuine conflict. Here only ONE of
      // the two same-named rows is a real checkout, so it is not a conflict —
      // narrowing to the non-derived row is what getRepoByRemote already does
      // for the equivalent situation on the --remote lookup path.
      const canonical = upsertRepo({
        path: "/home/u/workspace/open-shared",
        name: "shared",
        org: "hasna",
        remote_url: "github.com/hasna/shared",
      });
      upsertRepo({
        path: "/home/u/workspace/_factory_src/shared",
        name: "shared",
        org: "hasna",
        remote_url: "github.com/hasna/shared-scratch",
      });

      const resolved = getRepo("shared");
      expect(resolved).toBeTruthy();
      expect(resolved!.id).toBe(canonical.id);
    });

    it("still fails closed when a derived row precedes two real exact-name matches", () => {
      upsertRepo({
        path: "/home/u/workspace/_factory_src/duplicate",
        name: "duplicate",
        org: "hasna",
      });
      upsertRepo({
        path: "/home/u/workspace/primary-a",
        name: "duplicate",
        org: "hasna",
      });
      upsertRepo({
        path: "/home/u/workspace/primary-b",
        name: "duplicate",
        org: "hasna",
      });

      expect(() => getRepo("duplicate")).toThrow("Multiple repos have the exact name");
    });

    it("still resolves the real checkout when two derived rows precede it", () => {
      upsertRepo({
        path: "/home/u/workspace/_factory_src/shared",
        name: "shared-three-row",
        org: "hasna",
      });
      upsertRepo({
        path: "/home/u/worktrees/repos/shared",
        name: "shared-three-row",
        org: "hasna",
      });
      const canonical = upsertRepo({
        path: "/home/u/workspace/shared",
        name: "shared-three-row",
        org: "hasna",
      });

      expect(getRepo("shared-three-row")?.id).toBe(canonical.id);
    });
  });

  // Regression for todos 0251863c: `repos repo bench --json` and
  // `repos repo sandboxes --json` answered "Repo not found" and suggested the
  // dead pre-migration paths (`open-bench`, `iapp-sandboxes`). The 2026
  // monorepo migration renamed and moved those checkouts, so the canonical
  // name matches no registry row; the lookup must still bind the name to the
  // canonical remote identity (`github.com/hasna/bench`) when every row for
  // that remote has a missing path, instead of failing with a dead suggestion.
  describe("pre-migration rows resolve by canonical remote", () => {
    beforeEach(() => {
      setRepoLookupPathStateForTests(() => "missing");
    });

    afterEach(() => setRepoLookupPathStateForTests(null));

    it("resolves a bare name to the canonical remote when the only row is a dead pre-migration row", () => {
      upsertRepo({
        path: "/home/u/workspace/hasna/opensource/open-bench",
        name: "open-bench",
        org: "hasna",
        remote_url: "github.com/hasna/bench",
      });

      const repo = getRepo("bench");
      expect(repo).toBeTruthy();
      expect(repo!.remote_url).toBe("github.com/hasna/bench");
      expect(repo!.name).toBe("open-bench");
      expect(repo!.path).toBe("/home/u/workspace/hasna/opensource/open-bench");
    });

    it("resolves a qualified org/name form the same way", () => {
      upsertRepo({
        path: "/home/u/workspace/hasna/opensource/open-bench",
        name: "open-bench",
        org: "hasna",
        remote_url: "github.com/hasna/bench",
      });

      const repo = getRepo("hasna/bench");
      expect(repo).toBeTruthy();
      expect(repo!.remote_url).toBe("github.com/hasna/bench");
    });

    it("picks the identity-clean row deterministically when two dead rows share the canonical remote", () => {
      upsertRepo({
        path: "/home/u/workspace/hasnaxyz/internalapp/iapp-sandboxes",
        name: "iapp-sandboxes",
        org: "hasna",
        remote_url: "github.com/hasna/sandboxes",
      });
      upsertRepo({
        path: "/home/u/workspace/hasna/opensource/open-sandboxes",
        name: "open-sandboxes",
        org: "hasna",
        remote_url: "github.com/hasna/sandboxes",
      });

      const repo = getRepo("sandboxes");
      expect(repo).toBeTruthy();
      expect(repo!.remote_url).toBe("github.com/hasna/sandboxes");
      expect(repo!.name).toBe("open-sandboxes");
    });

    it("qualified org/name selects the canonical-named row, not the earliest, among two dead identity-clean rows", () => {
      upsertRepo({
        path: "/home/u/workspace/hasna/other-bench",
        name: "other-bench",
        org: "hasna",
        remote_url: "github.com/hasna/bench",
      });
      const canonical = upsertRepo({
        path: "/home/u/workspace/hasna/opensource/open-bench",
        name: "open-bench",
        org: "hasna",
        remote_url: "github.com/hasna/bench",
      });

      const repo = getRepo("hasna/bench");
      expect(repo).toBeTruthy();
      expect(repo!.id).toBe(canonical.id);
      expect(repo!.name).toBe("open-bench");
      expect(repo!.remote_url).toBe("github.com/hasna/bench");
    });

    it("bare name selects the canonical-named row, not the earliest, among two dead identity-clean rows", () => {
      upsertRepo({
        path: "/home/u/workspace/hasna/other-bench",
        name: "other-bench",
        org: "hasna",
        remote_url: "github.com/hasna/bench",
      });
      const canonical = upsertRepo({
        path: "/home/u/workspace/hasna/opensource/open-bench",
        name: "open-bench",
        org: "hasna",
        remote_url: "github.com/hasna/bench",
      });

      const repo = getRepo("bench");
      expect(repo).toBeTruthy();
      expect(repo!.id).toBe(canonical.id);
      expect(repo!.name).toBe("open-bench");
      expect(repo!.remote_url).toBe("github.com/hasna/bench");
    });

    it("keeps refusing a bare name whose canonical remote has a present checkout under a different name", () => {
      upsertRepo({
        path: "/home/u/workspace/hasna/opensource/open-loops",
        name: "open-loops",
        org: "hasna",
        remote_url: "github.com/hasna/loops",
      });
      setRepoLookupPathStateForTests(() => "present");

      expect(getRepo("loops")).toBeNull();
    });

    it("declines when one of several rows for the remote is still on disk", () => {
      upsertRepo({
        path: "/home/u/workspace/hasna/opensource/open-sandboxes",
        name: "open-sandboxes",
        org: "hasna",
        remote_url: "github.com/hasna/sandboxes",
      });
      upsertRepo({
        path: "/home/u/workspace/hasnaxyz/internalapp/iapp-sandboxes",
        name: "iapp-sandboxes",
        org: "hasna",
        remote_url: "github.com/hasna/sandboxes",
      });
      setRepoLookupPathStateForTests((path) =>
        path.includes("open-sandboxes") ? "present" : "missing",
      );

      expect(getRepo("sandboxes")).toBeNull();
    });

    it("returns null when the canonical remote is not indexed at all", () => {
      upsertRepo({ path: "/home/u/workspace/other", name: "other", org: "hasna" });

      expect(getRepo("bench")).toBeNull();
    });
  });

  // Regression for todos d8ed2fc2: `repos repo <owner>/<name> --json` — the
  // exact full-identity lookup the canonical repository naming policy and the
  // worktree law mandate for targeting — was rejected (rc=1, "Repo not found"
  // plus a fuzzy suggestion) even when the canonical checkout of that exact
  // remote was indexed with a live path. getRepo() fell through to
  // getRepoByCanonicalRemote, whose contract is the all-rows-missing
  // pre-migration case: any row whose path is still on disk made it refuse.
  // That refusal is correct for BARE names (c357a1f3: silently substituting a
  // checkout indexed under a different name is fuzzy matching wearing an
  // exact-match's clothes), but the qualified form has named the exact remote
  // identity, so the exact-remote resolution in getRepoByRemote is the
  // contract that applies — it refuses mirror-only remotes, prefers a live
  // checkout over a hollow sibling, and reports live multi-checkout ambiguity
  // loudly, exactly like the --remote flag.
  describe("qualified owner/name lookup resolves to the live canonical checkout", () => {
    afterEach(() => setRepoLookupPathStateForTests(null));

    it("resolves org/name to the canonical checkout when its path is on disk", () => {
      const canonical = upsertRepo({
        path: "/home/u/workspace/hasna/apps",
        name: "apps",
        org: "hasna",
        remote_url: "github.com/hasna/apps",
      });
      setRepoLookupPathStateForTests(() => "present");

      const repo = getRepo("hasna/apps");
      expect(repo).toBeTruthy();
      expect(repo!.id).toBe(canonical.id);
      expect(repo!.path).toBe("/home/u/workspace/hasna/apps");
    });

    it("resolves the full remote identity form the same way", () => {
      const canonical = upsertRepo({
        path: "/home/u/workspace/hasna/apps",
        name: "apps",
        org: "hasna",
        remote_url: "github.com/hasna/apps",
      });
      setRepoLookupPathStateForTests(() => "present");

      const repo = getRepo("github.com/hasna/apps");
      expect(repo).toBeTruthy();
      expect(repo!.id).toBe(canonical.id);
    });

    it("prefers the live canonical checkout over a dead pre-migration sibling of the same remote", () => {
      const livePath = mkdtempSync(join(tmpdir(), "repos-exact-lookup-"));
      try {
        execSync("git init", { cwd: livePath, stdio: "pipe" });
        upsertRepo({
          path: "/home/u/workspace/hasna/opensource/open-bench",
          name: "open-bench",
          org: "hasna",
          remote_url: "github.com/hasna/bench",
        });
        const live = upsertRepo({
          path: livePath,
          name: "bench",
          org: "hasna",
          remote_url: "github.com/hasna/bench",
        });
        setRepoLookupPathStateForTests((path) =>
          path === livePath ? "present" : "missing",
        );

        const repo = getRepo("hasna/bench");
        expect(repo).toBeTruthy();
        expect(repo!.id).toBe(live.id);
        expect(repo!.path).toBe(livePath);
      } finally {
        setRepoLookupPathStateForTests(null);
        rmSync(livePath, { recursive: true, force: true });
      }
    });

    it("still refuses a qualified owner/name whose remote is indexed only by a factory scratch clone", () => {
      upsertRepo({
        path: "/home/u/workspace/hasnaxyz/_factory_src/iapp-company-taxes",
        name: "iapp-company-taxes",
        org: "hasnaxyz",
        remote_url: "github.com/hasnaxyz/iapp-company-taxes",
      });
      setRepoLookupPathStateForTests(() => "present");

      expect(getRepo("hasnaxyz/iapp-company-taxes")).toBeNull();
    });

    it("returns null for a qualified owner/name that is not indexed", () => {
      upsertRepo({ path: "/tmp/other", name: "other", org: "hasna" });
      setRepoLookupPathStateForTests(() => "present");

      expect(getRepo("hasna/doesnotexist")).toBeNull();
    });
  });

  it("should get repo by ID", () => {
    const created = upsertRepo({ path: "/tmp/test-repo", name: "test-repo" });
    const repo = getRepo(created.id);
    expect(repo).toBeTruthy();
    expect(repo!.name).toBe("test-repo");
  });

  it("should return null for non-existent repo", () => {
    expect(getRepo("nonexistent")).toBeNull();
  });

  it("should delete repo", () => {
    const repo = upsertRepo({ path: "/tmp/test-repo", name: "test-repo" });
    expect(deleteRepo(repo.id)).toBe(true);
    expect(listRepos().length).toBe(0);
  });

  it("should filter repos by org", () => {
    upsertRepo({ path: "/tmp/a", name: "a", org: "hasna" });
    upsertRepo({ path: "/tmp/b", name: "b", org: "hasnaxyz" });
    upsertRepo({ path: "/tmp/c", name: "c", org: "hasna" });
    expect(listRepos({ org: "hasna" }).length).toBe(2);
    expect(listRepos({ org: "hasnaxyz" }).length).toBe(1);
  });

  it("should paginate repos", () => {
    for (let i = 0; i < 5; i++) {
      upsertRepo({ path: `/tmp/repo-${i}`, name: `repo-${i}` });
    }
    expect(listRepos({ limit: 2 }).length).toBe(2);
    expect(listRepos({ limit: 2, offset: 3 }).length).toBe(2);
  });

  it("enumerates every repository deterministically across small pages", () => {
    for (let i = 0; i < 7; i++) {
      upsertRepo({ path: `/tmp/all-${i}`, name: `all-${i}` });
    }
    const first = listAllRepos({}, 2);
    const second = listAllRepos({}, 3);
    expect(first.map((repo) => repo.id)).toEqual(second.map((repo) => repo.id));
    expect(first).toHaveLength(7);
    expect(new Set(first.map((repo) => repo.id)).size).toBe(7);
  });

  it("should search repos via FTS5", () => {
    upsertRepo({ path: "/tmp/todos", name: "todos", description: "task management for agents" });
    upsertRepo({ path: "/tmp/git", name: "git", description: "git intelligence platform" });
    const results = searchRepos("task management");
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("todos");
  });

  it("treats punctuation in repo search queries as literal text", () => {
    upsertRepo({
      path: "/tmp/repo-project-familiarization",
      name: "repo-project-familiarization",
      description: "repository familiarization",
    });

    expect(searchRepos("repo-project-familiarization").map((repo) => repo.name))
      .toEqual(["repo-project-familiarization"]);
    expect(searchRepos("missing-repo-project-familiarization")).toEqual([]);
  });

  it("sanitizes contaminated direct rows at list, get, FTS search, and unified search outputs", () => {
    const unsafe = `https://${["member", "phrase"].join(":")}@git.example.test/team/tool.git?query=marker#fragment`;
    db.query("INSERT INTO repos (path, name, remote_url) VALUES ('/tmp/unsafe', 'unsafeoutput', ?)").run(unsafe);

    expect(listRepos({ query: "unsafeoutput" })[0]!.remote_url).toBe("git.example.test/team/tool");
    expect(getRepo("unsafeoutput")!.remote_url).toBe("git.example.test/team/tool");
    expect(searchRepos("unsafeoutput")[0]!.remote_url).toBe("git.example.test/team/tool");
    expect(searchAll("unsafeoutput")[0]!.snippet).toBe("git.example.test/team/tool");
    expect(JSON.stringify({ list: listRepos(), repo: getRepo("unsafeoutput"), search: searchAll("unsafeoutput") }))
      .not.toContain(unsafe);
  });

  it("clears rejected repository remotes instead of preserving contaminated values", () => {
    const repo = upsertRepo({ path: "/tmp/rejected", name: "rejected", remote_url: "github.com/team/tool" });
    const updated = upsertRepo({ path: repo.path, name: repo.name, remote_url: "file:///tmp/tool" });
    expect(updated.remote_url).toBeNull();
    expect(db.query("SELECT remote_url FROM repos WHERE id = ?").get(repo.id)).toEqual({ remote_url: null });
  });
});

describe("commits", () => {
  it("should bulk insert commits", () => {
    const repo = upsertRepo({ path: "/tmp/test", name: "test" });
    const count = bulkInsertCommits([
      { repo_id: repo.id, sha: "abc123", author_name: "Test", author_email: "test@test.com", date: "2026-01-01T00:00:00Z", message: "initial commit", files_changed: 1, insertions: 10, deletions: 0 },
      { repo_id: repo.id, sha: "def456", author_name: "Test", author_email: "test@test.com", date: "2026-01-02T00:00:00Z", message: "add feature", files_changed: 2, insertions: 20, deletions: 5 },
    ]);
    expect(count).toBe(2);
  });

  it("should ignore duplicate commits", () => {
    const repo = upsertRepo({ path: "/tmp/test", name: "test" });
    bulkInsertCommits([
      { repo_id: repo.id, sha: "abc123", author_name: "Test", author_email: "test@test.com", date: "2026-01-01T00:00:00Z", message: "initial", files_changed: 0, insertions: 0, deletions: 0 },
    ]);
    const count = bulkInsertCommits([
      { repo_id: repo.id, sha: "abc123", author_name: "Test", author_email: "test@test.com", date: "2026-01-01T00:00:00Z", message: "initial", files_changed: 0, insertions: 0, deletions: 0 },
    ]);
    expect(count).toBe(0);
  });

  it("should list commits with filters", () => {
    const repo = upsertRepo({ path: "/tmp/test", name: "test" });
    bulkInsertCommits([
      { repo_id: repo.id, sha: "a1", author_name: "Alice", author_email: "alice@test.com", date: "2026-01-01T00:00:00Z", message: "fix bug", files_changed: 1, insertions: 1, deletions: 1 },
      { repo_id: repo.id, sha: "b2", author_name: "Bob", author_email: "bob@test.com", date: "2026-02-01T00:00:00Z", message: "add feature", files_changed: 3, insertions: 50, deletions: 0 },
    ]);
    expect(listCommits({ repo_id: repo.id }).length).toBe(2);
    expect(listCommits({ author: "alice" }).length).toBe(1);
    expect(listCommits({ since: "2026-01-15" }).length).toBe(1);
  });

  it("should search commits via FTS5", () => {
    const repo = upsertRepo({ path: "/tmp/test", name: "test" });
    bulkInsertCommits([
      { repo_id: repo.id, sha: "a1", author_name: "Alice", author_email: "alice@test.com", date: "2026-01-01T00:00:00Z", message: "fix critical authentication bug", files_changed: 1, insertions: 1, deletions: 1 },
      { repo_id: repo.id, sha: "b2", author_name: "Bob", author_email: "bob@test.com", date: "2026-01-02T00:00:00Z", message: "update README", files_changed: 1, insertions: 5, deletions: 2 },
    ]);
    const results = searchCommits("authentication");
    expect(results.length).toBe(1);
    expect(results[0]!.sha).toBe("a1");
    expect(results[0]!.repo_name).toBe("test");
  });
});

describe("branches", () => {
  it("should bulk insert branches", () => {
    const repo = upsertRepo({ path: "/tmp/test", name: "test" });
    const count = bulkInsertBranches([
      { repo_id: repo.id, name: "main", is_remote: false, last_commit_sha: "abc", last_commit_date: "2026-01-01", ahead: 0, behind: 0 },
      { repo_id: repo.id, name: "origin/main", is_remote: true, last_commit_sha: "abc", last_commit_date: "2026-01-01", ahead: 0, behind: 0 },
    ]);
    expect(count).toBe(2);
  });

  it("should filter branches by remote/local", () => {
    const repo = upsertRepo({ path: "/tmp/test", name: "test" });
    bulkInsertBranches([
      { repo_id: repo.id, name: "main", is_remote: false, last_commit_sha: null, last_commit_date: null, ahead: 0, behind: 0 },
      { repo_id: repo.id, name: "origin/main", is_remote: true, last_commit_sha: null, last_commit_date: null, ahead: 0, behind: 0 },
    ]);
    expect(listBranches({ repo_id: repo.id, is_remote: false }).length).toBe(1);
    expect(listBranches({ repo_id: repo.id, is_remote: true }).length).toBe(1);
  });
});

describe("tags", () => {
  it("should bulk insert tags", () => {
    const repo = upsertRepo({ path: "/tmp/test", name: "test" });
    const count = bulkInsertTags([
      { repo_id: repo.id, name: "v1.0.0", sha: "abc", date: "2026-01-01", message: "release 1.0" },
      { repo_id: repo.id, name: "v1.1.0", sha: "def", date: "2026-02-01", message: "release 1.1" },
    ]);
    expect(count).toBe(2);
  });

  it("should list tags by repo", () => {
    const repo = upsertRepo({ path: "/tmp/test", name: "test" });
    bulkInsertTags([
      { repo_id: repo.id, name: "v1.0.0", sha: "abc", date: "2026-01-01", message: null },
    ]);
    expect(listTags({ repo_id: repo.id }).length).toBe(1);
  });
});

describe("remotes", () => {
  it("should bulk insert remotes", () => {
    const repo = upsertRepo({ path: "/tmp/test", name: "test" });
    const count = bulkInsertRemotes([
      { repo_id: repo.id, name: "origin", url: "git@github.com:test/test.git", fetch_url: "git@github.com:test/test.git" },
    ]);
    expect(count).toBe(1);
    expect(listRemotes(repo.id).length).toBe(1);
  });

  it("sanitizes remote rows and removes rejected required URLs at write and read boundaries", () => {
    const repo = upsertRepo({ path: "/tmp/remote-boundary", name: "remote-boundary" });
    const unsafe = `ssh://${["member", "phrase"].join(":")}@git.example.test/team/tool.git`;
    db.query("INSERT INTO remotes (repo_id, name, url, fetch_url) VALUES (?, 'origin', ?, ?)")
      .run(repo.id, unsafe, unsafe);
    db.query("INSERT INTO remotes (repo_id, name, url) VALUES (?, 'local', 'file:///tmp/tool')").run(repo.id);

    expect(listRemotes(repo.id)).toEqual([expect.objectContaining({
      name: "origin",
      url: "git.example.test/team/tool",
      fetch_url: "git.example.test/team/tool",
    })]);

    expect(bulkInsertRemotes([{ repo_id: repo.id, name: "origin", url: "/tmp/tool", fetch_url: null }])).toBe(0);
    expect(listRemotes(repo.id)).toEqual([]);
  });
});

describe("pull requests", () => {
  it("should bulk insert PRs", () => {
    const repo = upsertRepo({ path: "/tmp/test", name: "test" });
    const count = bulkInsertPullRequests([
      { repo_id: repo.id, number: 1, title: "Add feature", state: "open", author: "alice", created_at: "2026-01-01", updated_at: null, merged_at: null, closed_at: null, url: "", base_branch: "main", head_branch: "feat-1", additions: 10, deletions: 2, changed_files: 3 },
      { repo_id: repo.id, number: 2, title: "Fix bug", state: "merged", author: "bob", created_at: "2026-01-02", updated_at: null, merged_at: "2026-01-03", closed_at: null, url: "", base_branch: "main", head_branch: "fix-1", additions: 5, deletions: 5, changed_files: 1 },
    ]);
    expect(count).toBe(2);
  });

  it("should filter PRs by state", () => {
    const repo = upsertRepo({ path: "/tmp/test", name: "test" });
    bulkInsertPullRequests([
      { repo_id: repo.id, number: 1, title: "Open PR", state: "open", author: "alice", created_at: "2026-01-01", updated_at: null, merged_at: null, closed_at: null, url: "", base_branch: null, head_branch: null, additions: 0, deletions: 0, changed_files: 0 },
      { repo_id: repo.id, number: 2, title: "Merged PR", state: "merged", author: "bob", created_at: "2026-01-02", updated_at: null, merged_at: null, closed_at: null, url: "", base_branch: null, head_branch: null, additions: 0, deletions: 0, changed_files: 0 },
    ]);
    expect(listPullRequests({ state: "open" }).length).toBe(1);
    expect(listPullRequests({ state: "merged" }).length).toBe(1);
  });

  it("should search PRs via FTS5", () => {
    const repo = upsertRepo({ path: "/tmp/test", name: "test" });
    bulkInsertPullRequests([
      { repo_id: repo.id, number: 1, title: "implement OAuth2 authentication", state: "open", author: "alice", created_at: "2026-01-01", updated_at: null, merged_at: null, closed_at: null, url: "", base_branch: null, head_branch: null, additions: 0, deletions: 0, changed_files: 0 },
    ]);
    const results = searchPullRequests("OAuth2");
    expect(results.length).toBe(1);
  });
});

describe("FTS query escaping", () => {
  it("treats embedded double quotes as literal input across search surfaces", () => {
    const repo = upsertRepo({
      path: "/tmp/quoted-search",
      name: "quoted-search",
      description: 'handle "quoted" repository search',
    });
    bulkInsertCommits([
      {
        repo_id: repo.id,
        sha: "quoted-commit",
        author_name: "Test",
        author_email: "test@test.com",
        date: "2026-01-01T00:00:00Z",
        message: 'handle "quoted" commit search',
        files_changed: 1,
        insertions: 1,
        deletions: 0,
      },
    ]);
    bulkInsertPullRequests([
      {
        repo_id: repo.id,
        number: 42,
        title: 'handle "quoted" pull request search',
        state: "open",
        author: "test",
        created_at: "2026-01-01",
        updated_at: null,
        merged_at: null,
        closed_at: null,
        url: "",
        base_branch: "main",
        head_branch: "quoted-search",
        additions: 1,
        deletions: 0,
        changed_files: 1,
      },
    ]);

    const query = 'handle "quoted"';
    expect(searchRepos(query).map((result) => result.name)).toEqual(["quoted-search"]);
    expect(searchCommits(query).map((result) => result.sha)).toEqual(["quoted-commit"]);
    expect(searchPullRequests(query).map((result) => result.number)).toEqual([42]);
  });
});

describe("unified search", () => {
  it("should search across entities", () => {
    const repo = upsertRepo({ path: "/tmp/test-platform", name: "test-platform", description: "platform for testing" });
    bulkInsertCommits([
      { repo_id: repo.id, sha: "abc", author_name: "Test", author_email: "test@test.com", date: "2026-01-01T00:00:00Z", message: "setup platform", files_changed: 0, insertions: 0, deletions: 0 },
    ]);
    const results = searchAll("platform");
    expect(results.length).toBeGreaterThanOrEqual(1);
    const types = results.map((r) => r.type);
    expect(types).toContain("repo");
  });
});

describe("stats", () => {
  it("should return global stats", () => {
    upsertRepo({ path: "/tmp/a", name: "a", org: "hasna" });
    upsertRepo({ path: "/tmp/b", name: "b", org: "hasnaxyz" });
    const stats = getGlobalStats();
    expect(stats.total_repos).toBe(2);
    expect(stats.repos_by_org["hasna"]).toBe(1);
    expect(stats.repos_by_org["hasnaxyz"]).toBe(1);
  });

  it("should return repo stats", () => {
    const repo = upsertRepo({ path: "/tmp/test", name: "test" });
    bulkInsertCommits([
      { repo_id: repo.id, sha: "a", author_name: "Alice", author_email: "a@t.com", date: "2026-01-01T00:00:00Z", message: "init", files_changed: 0, insertions: 0, deletions: 0 },
    ]);
    const stats = getRepoStats(repo.id);
    expect(stats.commit_count).toBe(1);
    expect(stats.recent_commits.length).toBe(1);
    expect(stats.top_authors.length).toBe(1);
  });
});
