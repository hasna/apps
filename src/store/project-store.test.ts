import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROJECTS_HOME_ENV,
  ensureProjectStore,
  linkProjectLoop,
  type LoopsClientLike,
  type ProjectStoreProject,
} from "../db/project-store.js";
import { getWorkspace } from "../db/workspaces.js";
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

  // Regression for the vacuous-read defect (todos 4c17afb1): the per-project app
  // store is a machine-local sqlite FILE (data/<id>/project.db), and the server
  // exposes no loop endpoints at all — so in api mode the ApiProjectStore used to
  // answer every app-store read from a hardcoded empty summary. `loops list`
  // returned `loops: []` and `store inspect` reported `exists: false` /
  // `loop_links: 0` against a file that demonstrably held rows, at rc=0.
  //
  // That is the vacuous-check shape in its worst form: there was NO input for
  // which the reader returned non-empty, so every zero looked like a real answer.
  // These tests pin the fix the tmux-profile precedent already established —
  // machine-local resources resolve against local sqlite in BOTH transports.
  //
  // The `calls` assertion is load-bearing in the other direction: it proves the
  // rows came from the local store rather than from the network, so a stub that
  // merely returned data could not make these pass.
  describe("machine-local app store resolves in api mode (todos 4c17afb1)", () => {
    const project: ProjectStoreProject = {
      id: "wks_apiloops",
      name: "Api Loops",
      slug: "api-loops",
      status: "active",
      kind: "project",
      primary_path: null,
    };

    const fakeLoops: LoopsClientLike = {
      get(idOrName) {
        if (idOrName !== "loop_api") throw new Error("missing");
        return {
          id: "loop_api",
          name: "Api Loop",
          status: "active",
          schedule: { type: "interval", everyMs: 3_600_000 },
          target: { type: "command" },
          nextRunAt: "2026-08-04T00:00:00.000Z",
          updatedAt: "2026-08-03T00:00:00.000Z",
        };
      },
      runs: () => [],
    };

    // Isolation is asserted, not assumed: every test drives a fresh temp
    // PROJECTS_HOME and the finally-block removes it, so no production store
    // under ~/.hasna/projects is opened, migrated, or written by this suite.
    // Awaits `fn` before restoring the env and removing the temp root. Declared
    // synchronous previously, while every call site passes an async callback, so
    // the finally block ran when the promise was RETURNED rather than when it
    // resolved -- restoring PROJECTS_HOME and deleting the root at the callback's
    // first await. The comment above asserted isolation that the helper did not
    // actually provide.
    async function withTempHome<T>(fn: (root: string) => T | Promise<T>): Promise<T> {
      const root = mkdtempSync(join(tmpdir(), "store-api-loops-"));
      const previous = process.env[PROJECTS_HOME_ENV];
      process.env[PROJECTS_HOME_ENV] = root;
      try {
        return await fn(root);
      } finally {
        if (previous === undefined) delete process.env[PROJECTS_HOME_ENV];
        else process.env[PROJECTS_HOME_ENV] = previous;
        rmSync(root, { recursive: true, force: true });
      }
    }

    test("listLoopLinks returns the rows on disk instead of a hardcoded []", async () => {
      await withTempHome(async () => {
        ensureProjectStore(project);
        linkProjectLoop(project, { loop_id: "loop_api", loop_name: "Api Loop", role: "maintenance" });

        const { store, calls } = stubStore(() => ({}));
        const links = await store.listLoopLinks(project as never);

        expect(links).toHaveLength(1);
        expect(links[0]?.loop_id).toBe("loop_api");
        expect(calls).toHaveLength(0); // read the local file, not the network
      });
    });

    test("inspectAppStore reports exists:true and the real loop_links count", async () => {
      await withTempHome(async () => {
        ensureProjectStore(project);
        linkProjectLoop(project, { loop_id: "loop_api", loop_name: "Api Loop", role: "maintenance" });

        const { store } = stubStore(() => ({}));
        const summary = await store.inspectAppStore(project as never);

        // The exact pair the audit measured as false/0 on a 5-row store.
        expect(summary.exists).toBe(true);
        expect(summary.counts.loop_links).toBe(1);
      });
    });

    test("inspectAppStore reports a missing store without creating it", async () => {
      await withTempHome(async () => {
        const { store } = stubStore(() => ({}));
        const summary = await store.inspectAppStore(project as never);

        expect(summary.exists).toBe(false);
        expect(summary.schema_version).toBeNull();
        expect(summary.counts).toEqual({ data_models: 0, data_records: 0, loop_links: 0 });
        expect(existsSync(summary.paths.db_path)).toBe(false);
      });
    });

    test("inspectAppStoreWithLoops surfaces the linked loop, not loops:[]", async () => {
      await withTempHome(async () => {
        ensureProjectStore(project);
        linkProjectLoop(project, { loop_id: "loop_api", loop_name: "Api Loop", role: "maintenance" });

        const { store } = stubStore(() => ({}));
        const summary = await store.inspectAppStoreWithLoops(project as never, { loopsClient: fakeLoops } as never);

        expect(summary.loops).toHaveLength(1);
        expect(summary.loops?.[0]?.link.loop_id).toBe("loop_api");
      });
    });

    // The instrument must be able to return a genuine zero, or the tests above
    // only prove it always returns rows. An empty store must still read empty.
    test("negative control: an empty store still reports 0 links in api mode", async () => {
      await withTempHome(async () => {
        ensureProjectStore(project);

        const { store } = stubStore(() => ({}));
        const summary = await store.inspectAppStore(project as never);

        expect(summary.exists).toBe(true);
        expect(summary.counts.loop_links).toBe(0);
        expect(await store.listLoopLinks(project as never)).toEqual([]);
      });
    });

    // Regression for the write half. Making the app store resolve in api mode
    // also made createDataModel / createDataRecord / linkLoop reachable there,
    // and each routes through withLock(project.id, ...). workspace_locks
    // .workspace_id is FK-constrained to the machine-local `workspaces` table,
    // so an api-created / cloud-only project -- which by definition has no local
    // registry row -- failed with "FOREIGN KEY constraint failed" before ever
    // touching its project.db. The reads this PR fixes were fine; the writes it
    // newly enabled were not.
    //
    // `project` here is deliberately never inserted into the local `workspaces`
    // table, which is exactly the cloud-only shape.
    test("api-mode writes succeed for a cloud-only project with no local workspaces row", async () => {
      await withTempHome(async () => {
        ensureProjectStore(project);

        // Precondition: the local registry genuinely has no row for this id, so
        // the test cannot pass by accident on a project that happens to be local.
        expect(getWorkspace(project.id)).toBeNull();

        const { store } = stubStore(() => ({}));

        const link = await store.linkLoop(
          project as never,
          { loop_id: "loop_api", loop_name: "Api Loop", role: "maintenance" } as never,
          { source: "cli" } as never,
        );
        expect(link.loop_id).toBe("loop_api");

        const model = await store.createDataModel(
          project as never,
          { name: "notes", schema: { fields: [] } } as never,
          { source: "cli" } as never,
        );
        expect(model.name).toBe("notes");

        // The write actually landed in the machine-local store, rather than the
        // call merely not throwing.
        expect(await store.listLoopLinks(project as never)).toHaveLength(1);

        // The lock is released, not leaked, so a second write still succeeds.
        const second = await store.createDataModel(
          project as never,
          { name: "notes-2", schema: { fields: [] } } as never,
          { source: "cli" } as never,
        );
        expect(second.name).toBe("notes-2");
      });
    });

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

  test("guardedReadProject uses the bounded exact-id API route and rejects slugs before transport", async () => {
    const projectId = "wks_guardedread0001";
    const project = {
      id: projectId,
      slug: "guarded-read",
      name: "Guarded Read",
      description: null,
      kind: "generic" as const,
      status: "active" as const,
      root_id: null,
      recipe_id: null,
      canonical_machine: null,
      primary_path: null,
      git_remote: null,
      s3_bucket: null,
      s3_prefix: null,
      tags: [],
      integrations: {},
      metadata: {},
      last_opened_at: null,
      created_at: "2026-08-07 00:00:00",
      updated_at: "2026-08-07 00:00:01",
      synced_at: null,
    };
    const response = {
      ok: true as const,
      project_id: projectId,
      project,
      current_revision: "2026-08-07 00:00:01",
      resource_links: [],
      resource_link_count: 0,
      resource_link_max_items: 1000,
      resource_link_collection_digest: "empty",
      response_control: {
        response_byte_limit: 16_384,
        time_budget_ms: 5_000,
        response_bytes: 512,
        elapsed_ms: 1,
        complete: true,
        truncated: false,
      },
    };
    const { store, calls } = stubStore(() => response);

    await expect(store.guardedReadProject({
      project_id: "guarded-read",
      response_byte_limit: 16_384,
      time_budget_ms: 5_000,
    })).rejects.toThrow(/complete stable project id/);
    expect(calls).toHaveLength(0);

    const result = await store.guardedReadProject({
      project_id: projectId,
      response_byte_limit: 16_384,
      time_budget_ms: 5_000,
    });
    expect(result).toMatchObject({
      ok: true,
      project_id: projectId,
      project: { id: projectId, slug: "guarded-read" },
      current_revision: "2026-08-07 00:00:01",
      response_control: {
        response_byte_limit: 16_384,
        time_budget_ms: 5_000,
        complete: true,
        truncated: false,
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.path).toBe(
      `/v1/projects/${projectId}/guarded-metadata?response_byte_limit=16384&time_budget_ms=5000`,
    );
  });

  test("typed resource-link methods preserve API routes, bounds, modes, and rollback identity", async () => {
    const projectId = "wks_resourceapi0001";
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? "GET").toUpperCase();
      const url = new URL(input);
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ method, path: `${url.pathname}${url.search}`, body });
      if (method === "GET" && url.pathname.endsWith("/resource-links")) {
        const collectionDigest = "a".repeat(64);
        return Response.json({
          project_id: projectId,
          current_revision: "revision",
          links: [],
          link_count: 0,
          max_items: 10,
          collection_digest: collectionDigest,
          complete: true,
          truncated: false,
          contract: {
            schema: "hasna.project_resource_link_collection.v1",
            project_id: projectId,
            current_revision: "revision",
            links: [],
            link_count: 0,
            max_items: 10,
            collection_digest: collectionDigest,
            complete: true,
            truncated: false,
          },
        });
      }
      return Response.json({});
    };
    __resetProjectStore();
    const store = resolveProjectStore(CLOUD_ENV, fetchImpl);
    const link = {
      authority: "conversations" as const,
      service_instance: "urn:hasna:conversations:test",
      source_package: "@hasna/conversations" as const,
      target_kind: "channel" as const,
      locator: {
        kind: "conversations_channel_id" as const,
        value: "chn_79fa9c68937a1d020d6031dcaa3dd8d7",
      },
      scope: "resource" as const,
      labels: { channel_name: "resource-api" },
    };
    const mutation = {
      project_id: projectId,
      operation_id: "resource-api",
      step_id: "links",
      mode: "add" as const,
      expected_revision: "revision",
      links: [link],
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };

    await store.readProjectResourceLinks({
      project_id: projectId,
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });
    await store.mutateProjectResourceLinks(mutation);
    await store.rollbackProjectResourceLinks({
      project_id: projectId,
      operation_id: "resource-api-rollback",
      step_id: "rollback-links",
      accepted_receipt_id: "gpmr_resource_api",
      expected_current_revision: "revision-2",
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });

    expect(calls.map((call) => [call.method, call.path])).toEqual([
      [
        "GET",
        `/v1/projects/${projectId}/resource-links?max_items=10&response_byte_limit=100000&time_budget_ms=5000`,
      ],
      ["POST", `/v1/projects/${projectId}/resource-links/add`],
      ["POST", `/v1/projects/${projectId}/resource-links/rollback`],
    ]);
    expect(calls[1]?.body).toEqual(mutation);
    expect(calls[2]?.body).toEqual(expect.objectContaining({
      accepted_receipt_id: "gpmr_resource_api",
    }));
  });

  test("resource-link migration methods preserve API routes, bounds, manifest identity, and CAS bodies", async () => {
    const projectId = "wks_resourcemigration01";
    const manifestId = "prlm_resource_migration";
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? "GET").toUpperCase();
      const url = new URL(input);
      calls.push({
        method,
        path: `${url.pathname}${url.search}`,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      return Response.json({});
    };
    __resetProjectStore();
    const store = resolveProjectStore(CLOUD_ENV, fetchImpl);
    const plan = {
      project_id: projectId,
      operation_id: "resource-migration",
      step_id: "plan",
      expected_project_revision: "revision-1",
      links: [{
        link: {
          authority: "contacts" as const,
          service_instance: "urn:hasna:contacts:test",
          source_package: "@hasna/contacts" as const,
          target_kind: "contact" as const,
          locator: {
            kind: "external_uuid" as const,
            value: "6b68e131-abe5-43b7-92cd-9930b04611df",
          },
          scope: "resource" as const,
        },
        producer_resource_kind: "contact",
        producer_binding: {
          authority_id: "contacts",
          tenant_id: "tenant-primary",
          corpus_id: null,
          capability_digest: "sha256:contacts-capability",
        },
      }],
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };
    const advance = {
      project_id: projectId,
      manifest_id: manifestId,
      expected_transition_version: 1,
      next_state: "producer_applied" as const,
      producer_evidence: [{
        created_by_operation: true,
        forward_receipt_id: "contacts-receipt-1",
        child_link_receipt_ids: [],
        target_revision: "contacts-revision-1",
        target_digest: "contacts-digest-1",
        inverse_verified: false,
        inverse_outcome: "pending",
      }],
      evidence: { phase: "producer" },
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };
    const rollback = {
      project_id: projectId,
      manifest_id: manifestId,
      expected_transition_version: 2,
      max_items: 10,
      producer_outcome: "pending" as const,
      evidence: { reason: "test" },
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };

    await store.planProjectResourceLinkMigration(plan);
    await store.readProjectResourceLinkMigration({
      project_id: projectId,
      manifest_id: manifestId,
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });
    await store.advanceProjectResourceLinkMigration(advance);
    await store.rollbackProjectResourceLinkMigration(rollback);

    expect(calls.map((call) => [call.method, call.path])).toEqual([
      ["POST", `/v1/projects/${projectId}/resource-link-migrations/plan`],
      [
        "GET",
        `/v1/projects/${projectId}/resource-link-migrations/${manifestId}?max_items=10&response_byte_limit=100000&time_budget_ms=5000`,
      ],
      ["POST", `/v1/projects/${projectId}/resource-link-migrations/${manifestId}/advance`],
      ["POST", `/v1/projects/${projectId}/resource-link-migrations/${manifestId}/rollback`],
    ]);
    expect(calls[0]?.body).toEqual(plan);
    expect(calls[2]?.body).toEqual(advance);
    expect(calls[3]?.body).toEqual(rollback);
  });

  test("resource-link POST retries an ambiguous transport outcome with one stable idempotency key", async () => {
    const projectId = "wks_resourceapiretry01";
    const requests: Array<{ path: string; idempotencyKey: string | null }> = [];
    let attempt = 0;
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      const url = new URL(input);
      const headers = new Headers(init?.headers);
      requests.push({
        path: url.pathname,
        idempotencyKey: headers.get("idempotency-key"),
      });
      attempt += 1;
      if (attempt === 1) {
        throw new Error("connection closed after server commit");
      }
      return Response.json({
        ok: true,
        outcome: "duplicate_of_accepted",
      });
    };
    __resetProjectStore();
    const store = resolveProjectStore(CLOUD_ENV, fetchImpl);

    const result = await store.mutateProjectResourceLinks({
      project_id: projectId,
      operation_id: "resource-api-retry",
      step_id: "projects-resource-link",
      mode: "add",
      expected_revision: "revision-1",
      links: [{
        authority: "contacts",
        service_instance: "urn:hasna:contacts:service:primary",
        source_package: "@hasna/contacts",
        target_kind: "contact",
        locator: {
          kind: "external_uuid",
          value: "6b68e131-abe5-43b7-92cd-9930b04611df",
        },
        scope: "resource",
      }],
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });

    expect(result.outcome).toBe("duplicate_of_accepted");
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.path)).toEqual([
      `/v1/projects/${projectId}/resource-links/add`,
      `/v1/projects/${projectId}/resource-links/add`,
    ]);
    expect(requests[0]!.idempotencyKey).toMatch(/^gpm_[0-9a-f]{48}$/);
    expect(requests[1]!.idempotencyKey).toBe(requests[0]!.idempotencyKey);
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
   * honours `offset`, and reports the complete total/offset contract required
   * for a migration to prove that its inventory is complete.
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
      return new Response(JSON.stringify({
        workspaces: page,
        count: page.length,
        total: rows.length,
        offset,
        limit,
        has_more: offset + page.length < rows.length,
        complete: offset === 0 && offset + page.length === rows.length,
      }), {
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
