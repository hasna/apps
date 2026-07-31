import { describe, expect, test } from "bun:test";
import { resolveProjectStore, __resetProjectStore } from "./project-store.js";

describe("projects store resolution (client-flip)", () => {
  test("no env -> local store", () => {
    __resetProjectStore();
    const store = resolveProjectStore({});
    expect(store.mode).toBe("local");
    expect(store.baseUrl).toBeNull();
  });

  test("self_hosted + url + key -> api store", () => {
    __resetProjectStore();
    const store = resolveProjectStore({
      HASNA_PROJECTS_STORAGE_MODE: "self_hosted",
      HASNA_PROJECTS_API_URL: "https://projects.hasna.xyz",
      HASNA_PROJECTS_API_KEY: "k",
    });
    expect(store.mode).toBe("api");
    expect(store.baseUrl).toBe("https://projects.hasna.xyz/v1");
  });

  // Regression: the fleet flip writes ONLY HASNA_PROJECTS_API_URL +
  // HASNA_PROJECTS_API_KEY (no STORAGE_MODE). Their joint presence must route to
  // the api store, otherwise a flipped CLI silently keeps reading local sqlite.
  test("url + key (no explicit mode) -> api store", () => {
    __resetProjectStore();
    const store = resolveProjectStore({
      HASNA_PROJECTS_API_URL: "https://projects.hasna.xyz",
      HASNA_PROJECTS_API_KEY: "k",
    });
    expect(store.mode).toBe("api");
  });

  test("cloud requested but no key -> throws (never silently local)", () => {
    __resetProjectStore();
    expect(() => resolveProjectStore({ HASNA_PROJECTS_STORAGE_MODE: "self_hosted" })).toThrow();
  });

  test("cloud alias 'cloud' -> api store", () => {
    __resetProjectStore();
    const store = resolveProjectStore({
      HASNA_PROJECTS_STORAGE_MODE: "cloud",
      HASNA_PROJECTS_API_URL: "https://projects.hasna.xyz",
      HASNA_PROJECTS_API_KEY: "k",
    });
    expect(store.mode).toBe("api");
  });

  test("baseUrl never embeds the api key", () => {
    __resetProjectStore();
    const store = resolveProjectStore({
      HASNA_PROJECTS_API_URL: "https://projects.hasna.xyz",
      HASNA_PROJECTS_API_KEY: "super-secret-key",
    });
    expect(store.baseUrl).not.toContain("super-secret-key");
  });
});

// Regression for the split-brain the review flagged: in api mode, roots, agents
// and recipes MUST route to `<url>/v1/...` over HTTP with the bearer key — never
// to local sqlite. These drive the ApiProjectStore through a stub fetch and
// assert both the request path and the response unwrapping.
describe("projects store api transport (roots/agents/recipes)", () => {
  const CLOUD_ENV = {
    HASNA_PROJECTS_API_URL: "https://projects.hasna.xyz",
    HASNA_PROJECTS_API_KEY: "secret-key",
  };

  function stubStore(handler: (method: string, path: string, body: unknown) => unknown) {
    const calls: Array<{ method: string; path: string; auth: string | null }> = [];
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? "GET").toUpperCase();
      const url = new URL(input);
      const headers = new Headers(init?.headers);
      calls.push({ method, path: `${url.pathname}${url.search}`, auth: headers.get("authorization") });
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const result = handler(method, `${url.pathname}${url.search}`, body);
      return new Response(JSON.stringify(result ?? {}), { status: 200, headers: { "content-type": "application/json" } });
    };
    __resetProjectStore();
    const store = resolveProjectStore(CLOUD_ENV, fetchImpl);
    return { store, calls };
  }

  test("listRoots unwraps { roots } from GET /v1/roots with bearer auth", async () => {
    const { store, calls } = stubStore(() => ({ roots: [{ id: "r1", slug: "ws" }], count: 1 }));
    const roots = await store.listRoots();
    expect(roots).toEqual([{ id: "r1", slug: "ws" } as never]);
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v1/roots", auth: "Bearer secret-key" });
  });

  test("createRoot POSTs to /v1/roots", async () => {
    const { store, calls } = stubStore((_m, _p, body) => ({ id: "r2", slug: "new", ...(body as object) }));
    const created = await store.createRoot({ name: "New", base_path: "/tmp/new" });
    expect(created).toMatchObject({ id: "r2", slug: "new", name: "New" });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v1/roots" });
  });

  test("matchRoots scores server-fetched roots (no local sqlite)", async () => {
    const { store, calls } = stubStore(() => ({
      roots: [
        { id: "a", slug: "a", name: "a", base_path: "/code/a", tags: [], default_kind: null, github_org: "acme" },
        { id: "b", slug: "b", name: "b", base_path: "/code/b", tags: [], default_kind: null, github_org: "other" },
      ],
    }));
    const matches = await store.matchRoots({ github_org: "acme" });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.root.id).toBe("a");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v1/roots" });
  });

  test("listAgents unwraps { agents } from GET /v1/agents", async () => {
    const { store, calls } = stubStore(() => ({ agents: [{ id: "ag1", slug: "cli" }], count: 1 }));
    const agents = await store.listAgents();
    expect(agents).toEqual([{ id: "ag1", slug: "cli" } as never]);
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v1/agents" });
  });

  test("listRecipes unwraps { recipes } from GET /v1/recipes", async () => {
    const { store, calls } = stubStore(() => ({ recipes: [{ id: "rc1", slug: "cli" }], count: 1 }));
    const recipes = await store.listRecipes();
    expect(recipes).toEqual([{ id: "rc1", slug: "cli" } as never]);
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v1/recipes" });
  });

  test("deleteRoot resolves the root then DELETEs /v1/roots/{id}?detach=true", async () => {
    const { store, calls } = stubStore((method) => {
      if (method === "GET") return { id: "r9", slug: "gone", name: "gone" };
      return { deleted: true, id: "r9", detached_workspaces: 3 };
    });
    const result = await store.deleteRoot("gone", { detachProjects: true });
    expect(result.root.id).toBe("r9");
    expect(result.detached_workspaces).toBe(3);
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/v1/roots/r9?detach=true" });
  });

  // Regression for the review's write findings: in api mode an explicit event
  // record MUST POST to the server, and the on-box-only sub-resources (agent
  // assignment, extra locations, mutation locks) MUST NOT silently touch local
  // sqlite — they route through the Store and refuse rather than split-brain.
  test("recordEvent POSTs to /v1/projects/{id}/events and unwraps { event }", async () => {
    const { store, calls } = stubStore((method, _p, body) => {
      if (method === "POST") return { event: { id: "e1", event_type: (body as { event_type: string }).event_type } };
      return {};
    });
    const event = await store.recordEvent("proj1", { event_type: "note", source: "mcp", metadata: { k: 1 } });
    expect(event).toMatchObject({ id: "e1", event_type: "note" });
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/v1/projects/proj1/events", auth: "Bearer secret-key" });
  });

  test("on-box sub-resource reads return empty in api mode (no sqlite)", async () => {
    const { store, calls } = stubStore(() => ({}));
    expect(await store.getProjectAgents("p")).toEqual([]);
    expect(await store.getProjectLocations("p")).toEqual([]);
    expect(await store.listLocks()).toEqual([]);
    expect(await store.listAgentRuns({ workspace_id: "p" })).toEqual([]);
    expect(await store.releaseLock("k")).toBe(false);
    expect(calls).toHaveLength(0); // never hit the network or local sqlite
  });

  test("local-only writes throw in api mode instead of writing local sqlite", async () => {
    const { store } = stubStore(() => ({}));
    await expect(store.assignAgent("p", { agentId: "a" })).rejects.toThrow(/local-only/);
    await expect(store.addLocation("p", { path: "/x" })).rejects.toThrow(/local-only/);
    await expect(store.acquireLock({ key: "k" })).rejects.toThrow(/local-only/);
  });

  // Regression: resolving "." (or any path/marker target) in api mode must NOT
  // hit the API — the URL parser collapses `/projects/.` to the collection
  // route `/projects/`, returning a LIST payload that then masqueraded as a
  // single project and crashed renderers reading `project.metadata.stage`.
  test("getProject returns null for path-like/relative targets without a network call", async () => {
    const { store, calls } = stubStore(() => ({ workspaces: [{ id: "x", slug: "x" }], count: 1 }));
    for (const target of [".", "..", "./foo", "../bar", "/abs/path", "~/home", "a/b", "C:\\win"]) {
      expect(await store.getProject(target)).toBeNull();
    }
    expect(calls).toHaveLength(0);
    // resolveTarget surfaces a clean not-found rather than a masquerading list.
    await expect(store.resolveTarget(".")).rejects.toThrow(/Project not found/);
  });

  test("getProject normalizes null metadata/integrations/tags into safe shapes", async () => {
    const { store } = stubStore(() => ({
      id: "wks_1",
      slug: "iproj-x",
      name: "X",
      metadata: null,
      integrations: null,
      tags: null,
    }));
    const project = await store.getProject("iproj-x");
    expect(project).not.toBeNull();
    expect(project!.metadata).toEqual({});
    expect(project!.integrations).toEqual({});
    expect(project!.tags).toEqual([]);
  });

  test("getProject rejects a list-wrapper payload masquerading as a project", async () => {
    // Even if the server ever returned a collection body for a detail id, the
    // normalizer refuses it (no string id/slug) so it can't crash renderers.
    const { store } = stubStore(() => ({ workspaces: [{ id: "a", slug: "a" }], count: 1 }));
    expect(await store.getProject("iproj-x")).toBeNull();
  });
});

// Regression for dc3ba294: the projects API hard-caps every list response at
// 1000 rows and the client issued exactly one un-offset request, so
// `projects list --json` silently returned 939 of 2399 registry rows with
// rc=0, an empty stderr and no count/cursor a caller could inspect. The store
// MUST walk the pages itself, MUST NOT assume the cap is 1000, and MUST make a
// bounded result detectable rather than silent.
describe("projects list pagination (server row cap)", () => {
  const CLOUD_ENV = {
    HASNA_PROJECTS_API_URL: "https://projects.hasna.xyz",
    HASNA_PROJECTS_API_KEY: "secret-key",
  };

  /**
   * A fake registry that behaves like the deployed server: it clamps any
   * requested limit to `cap`, defaults to `defaultLimit` when none is sent,
   * honours `offset`, and reports `count` as the PAGE length (not the total) —
   * which is exactly why the truncation was undetectable.
   */
  function fakeRegistry(options: { total: number; cap: number; defaultLimit?: number; ignoreOffset?: boolean }) {
    const rows = Array.from({ length: options.total }, (_, i) => ({
      id: `wks_${String(i).padStart(5, "0")}`,
      slug: `proj-${String(i).padStart(5, "0")}`,
      name: `Project ${i}`,
      status: "active",
      tags: [],
      metadata: {},
      integrations: {},
    }));
    const requests: Array<{ limit: string | null; offset: string | null }> = [];
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      const url = new URL(input);
      if (url.pathname !== "/v1/projects" || (init?.method ?? "GET").toUpperCase() !== "GET") {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      const q = url.searchParams;
      requests.push({ limit: q.get("limit"), offset: q.get("offset") });
      const requested = q.get("limit") ? Number(q.get("limit")) : (options.defaultLimit ?? 100);
      const limit = Math.min(Math.max(requested, 1), options.cap);
      const offset = options.ignoreOffset ? 0 : Math.max(Number(q.get("offset") ?? 0), 0);
      const page = rows.slice(offset, offset + limit);
      return new Response(JSON.stringify({ workspaces: page, count: page.length }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    __resetProjectStore();
    return { store: resolveProjectStore(CLOUD_ENV, fetchImpl), requests, rows };
  }

  test("no explicit limit returns every row, not the server's capped page", async () => {
    const { store, requests } = fakeRegistry({ total: 2399, cap: 1000 });
    const projects = await store.listProjects();
    expect(projects).toHaveLength(2399);
    expect(new Set(projects.map((p) => p.id)).size).toBe(2399);
    expect(projects.at(-1)!.slug).toBe("proj-02398");
    // walked the pages rather than trusting one response
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.map((r) => r.offset)).toEqual(["0", "1000", "2000"]);
  });

  test("a status filter is paginated too (the cap applies to filtered queries)", async () => {
    const { store } = fakeRegistry({ total: 2360, cap: 1000 });
    const projects = await store.listProjects({ status: "active" });
    expect(projects).toHaveLength(2360);
  });

  test("the page stride is learned from the response, not hardcoded to 1000", async () => {
    const { store, requests } = fakeRegistry({ total: 640, cap: 250 });
    const projects = await store.listProjects();
    expect(projects).toHaveLength(640);
    // 640 rows at a 250-row cap: the page at offset 500 comes back short (140),
    // which is the tail signal — no fourth request is needed.
    expect(requests.map((r) => r.offset)).toEqual(["0", "250", "500"]);
  });

  test("a total that is an exact multiple of the cap still terminates and is complete", async () => {
    const { store } = fakeRegistry({ total: 2000, cap: 1000 });
    const projects = await store.listProjects();
    expect(projects).toHaveLength(2000);
  });

  test("an explicit limit under the cap is honoured in a single request", async () => {
    const { store, requests } = fakeRegistry({ total: 2399, cap: 1000 });
    const projects = await store.listProjects({ limit: 50 });
    expect(projects).toHaveLength(50);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ limit: "50" });
  });

  test("an explicit limit above the cap is honoured by paginating, not clamped", async () => {
    const { store } = fakeRegistry({ total: 2399, cap: 1000 });
    const projects = await store.listProjects({ limit: 1500 });
    expect(projects).toHaveLength(1500);
  });

  test("an explicit offset is respected as the starting point", async () => {
    const { store } = fakeRegistry({ total: 2399, cap: 1000 });
    const projects = await store.listProjects({ offset: 2390 });
    expect(projects).toHaveLength(9);
    expect(projects[0]!.slug).toBe("proj-02390");
  });

  test("a server that ignores offset fails loudly instead of truncating silently", async () => {
    const { store } = fakeRegistry({ total: 2399, cap: 1000, ignoreOffset: true });
    await expect(store.listProjects()).rejects.toThrow(/offset/i);
  });

  test("listProjectsPage exposes total and has_more so a bounded read is detectable", async () => {
    const { store } = fakeRegistry({ total: 2399, cap: 1000 });
    const page = await store.listProjectsPage({ limit: 25 });
    expect(page.projects).toHaveLength(25);
    expect(page.total).toBe(2399);
    expect(page.has_more).toBe(true);
    expect(page.complete).toBe(false);

    const all = await store.listProjectsPage();
    expect(all.projects).toHaveLength(2399);
    expect(all.total).toBe(2399);
    expect(all.has_more).toBe(false);
    expect(all.complete).toBe(true);
  });
});
