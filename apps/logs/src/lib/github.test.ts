/**
 * Test gap coverage for src/lib/github.ts.
 *
 * agent-authored: the SOL consult for this repo did not deliver a spec (two
 * distinct Codewith accounts: one capacity-refused before answering, one
 * admitted but timed out at 600s on both the initial call and its resume).
 * This analysis and these tests were produced by the sweep agent.
 *
 * The GitHub repo sync module had no sibling test. These tests pin the
 * fail-open contract: no github_repo short-circuits without a fetch, non-OK
 * and throwing responses leave the project untouched, a missing commits
 * response yields a null sha, and a healthy response projects description,
 * default branch, and head sha.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { createTestDb } from "../db/index.ts";
import { getProject } from "./projects.ts";
import { syncGithubRepo } from "./github.ts";

let ORIGINAL_FETCH: typeof fetch | undefined;
let ORIGINAL_TOKEN: string | undefined;

afterEach(() => {
  if (ORIGINAL_FETCH) globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_TOKEN === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = ORIGINAL_TOKEN;
});

function dbWithProject(githubRepo: string | null) {
  const db = createTestDb();
  db.prepare(
    "INSERT INTO projects (id, name, github_repo) VALUES (?, ?, ?)",
  ).run("proj-1", "proj-1", githubRepo);
  return db;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("syncGithubRepo", () => {
  it("short-circuits without a fetch when the project has no github_repo", async () => {
    let fetched = 0;
    ORIGINAL_FETCH = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      fetched += 1;
      return jsonResponse({});
    }) as typeof fetch;
    const db = dbWithProject(null);
    const project = getProject(db, "proj-1")!;
    const result = await syncGithubRepo(db, project);
    expect(result?.id).toBe("proj-1");
    expect(fetched).toBe(0);
  });

  it("leaves the project untouched when the repo fetch is non-OK", async () => {
    ORIGINAL_FETCH = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      jsonResponse({ message: "Not Found" }, 404)) as typeof fetch;
    const db = dbWithProject("https://github.com/acme/private-repo");
    const project = getProject(db, "proj-1")!;
    const result = await syncGithubRepo(db, project);
    const after = getProject(db, "proj-1")!;
    expect(result?.id).toBe("proj-1");
    expect(after.github_branch).toBeNull();
    expect(after.github_sha).toBeNull();
    expect(after.github_description).toBeNull();
  });

  it("leaves the project untouched when the fetch throws", async () => {
    ORIGINAL_FETCH = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      throw new Error("dns failure");
    }) as typeof fetch;
    const db = dbWithProject("https://github.com/acme/private-repo");
    const project = getProject(db, "proj-1")!;
    const result = await syncGithubRepo(db, project);
    const after = getProject(db, "proj-1")!;
    expect(result?.id).toBe("proj-1");
    expect(after.last_synced_at).toBeNull();
  });

  it("projects description and default branch with a null sha when commits are empty", async () => {
    ORIGINAL_FETCH = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      jsonResponse({
        description: "A private repo",
        default_branch: "main",
        topics: [],
      })) as typeof fetch;
    const db = dbWithProject("https://github.com/acme/private-repo");
    const project = getProject(db, "proj-1")!;
    const result = await syncGithubRepo(db, project);
    expect(result?.github_description).toBe("A private repo");
    expect(result?.github_branch).toBe("main");
    expect(result?.github_sha).toBeNull();
    expect(result?.last_synced_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("records the head commit sha and strips the github.com prefix from the repo path", async () => {
    const urls: string[] = [];
    ORIGINAL_FETCH = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      urls.push(String(input));
      if (String(input).includes("/commits")) {
        return jsonResponse([{ sha: "abc123def456" }]);
      }
      return jsonResponse({ description: "desc", default_branch: "trunk", topics: [] });
    }) as typeof fetch;
    const db = dbWithProject("https://github.com/acme/private-repo");
    const project = getProject(db, "proj-1")!;
    const result = await syncGithubRepo(db, project);
    expect(urls).toEqual([
      "https://api.github.com/repos/acme/private-repo",
      "https://api.github.com/repos/acme/private-repo/commits?per_page=1",
    ]);
    expect(result?.github_sha).toBe("abc123def456");
    expect(result?.github_branch).toBe("trunk");
  });

  it("attaches the bearer token when GITHUB_TOKEN is configured", async () => {
    const captured: Headers[] = [];
    ORIGINAL_FETCH = globalThis.fetch;
    process.env.GITHUB_TOKEN = "test" + "-github-token";
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      captured.push(new Headers(init?.headers));
      if (String(input).includes("/commits")) return jsonResponse([]);
      return jsonResponse({ description: null, default_branch: "main", topics: [] });
    }) as typeof fetch;
    const db = dbWithProject("https://github.com/acme/private-repo");
    const project = getProject(db, "proj-1")!;
    await syncGithubRepo(db, project);
    expect(captured[0]?.get("authorization")).toBe("Bearer test-github-token");
  });
});
