import { afterAll, describe, expect, test } from "bun:test";
import { createPgPool, createQueryClient } from "../generated/storage-kit/index.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import type { RootRow, WorkspaceEventRow, WorkspaceRow } from "../types/workspace.js";
import { runProjectsMigrations } from "./migrations.js";
import { ProjectsPgStore, generateWorkspaceId, generateRootId, slugify } from "./pg-store.js";

function duplicateSlugClient(): TypedQueryClient {
  const createdAt = "2026-08-03 00:00:00";
  const roots: RootRow[] = [{
    id: "root_projects",
    slug: "projects-root",
    name: "Projects Root",
    base_path: "/srv/projects",
    tags: "[]",
    default_kind: "project",
    default_recipe_id: null,
    default_tmux_profile_id: null,
    github_org: null,
    repo_visibility: null,
    path_template: "{slug}",
    name_template: null,
    allowed_recipes: "[]",
    allowed_agents: "[]",
    metadata: "{}",
    created_at: createdAt,
    updated_at: createdAt,
  }];
  const workspaces: WorkspaceRow[] = [{
    id: "wks_existing",
    slug: "duplicate-project",
    name: "Duplicate Project",
    description: null,
    kind: "project",
    status: "active",
    root_id: "root_projects",
    recipe_id: null,
    canonical_machine: null,
    primary_path: "/srv/projects/duplicate-project",
    git_remote: null,
    s3_bucket: null,
    s3_prefix: null,
    tags: "[]",
    integrations: JSON.stringify({ conversations_channel: "duplicate-project" }),
    metadata: "{}",
    last_opened_at: null,
    created_at: createdAt,
    updated_at: createdAt,
    synced_at: null,
  }];
  const events: WorkspaceEventRow[] = [];

  const get = async <T>(sql: string, params: readonly unknown[] = []): Promise<T | null> => {
    if (sql.startsWith("SELECT id FROM workspaces WHERE slug")) {
      const row = workspaces.find((workspace) => workspace.slug === params[0]);
      return (row ? { id: row.id } : null) as T | null;
    }
    if (sql.startsWith("SELECT * FROM roots WHERE")) {
      return (roots.find((root) => root.id === params[0] || root.slug === params[0]) ?? null) as T | null;
    }
    if (sql.startsWith("SELECT * FROM recipes WHERE")) return null;
    if (sql.startsWith("SELECT * FROM workspaces WHERE")) {
      return (workspaces.find((workspace) => workspace.id === params[0] || workspace.slug === params[0]) ?? null) as T | null;
    }
    if (sql.startsWith("SELECT * FROM workspace_events WHERE")) {
      return (events.find((event) => event.id === params[0]) ?? null) as T | null;
    }
    throw new Error(`Unexpected get query: ${sql}`);
  };

  const execute = async (sql: string, params: readonly unknown[] = []): Promise<void> => {
    if (sql.includes("INSERT INTO workspaces")) {
      workspaces.push({
        id: params[0] as string,
        slug: params[1] as string,
        name: params[2] as string,
        description: params[3] as string | null,
        kind: params[4] as string,
        status: "active",
        root_id: params[5] as string | null,
        recipe_id: params[6] as string | null,
        canonical_machine: null,
        primary_path: params[7] as string | null,
        git_remote: params[8] as string | null,
        s3_bucket: params[9] as string | null,
        s3_prefix: params[10] as string | null,
        tags: params[11] as string,
        integrations: params[12] as string,
        metadata: params[13] as string,
        last_opened_at: null,
        created_at: params[14] as string,
        updated_at: params[15] as string,
        synced_at: null,
      });
      return;
    }
    if (sql.includes("INSERT INTO workspace_events")) {
      events.push({
        id: params[0] as string,
        workspace_id: params[1] as string | null,
        agent_id: params[2] as string | null,
        event_type: params[3] as string,
        source: params[4] as string,
        prompt: params[5] as string | null,
        command: params[6] as string | null,
        before_json: params[7] as string | null,
        after_json: params[8] as string | null,
        metadata: params[9] as string,
        created_at: params[10] as string,
      });
      return;
    }
    throw new Error(`Unexpected execute query: ${sql}`);
  };

  return {
    get,
    execute,
    async many() { throw new Error("Unexpected many query"); },
    async one() { throw new Error("Unexpected one query"); },
    async query() { throw new Error("Unexpected query"); },
  } as TypedQueryClient;
}

describe("pg-store pure helpers", () => {
  test("slugify normalizes to kebab-case", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("  Multi   Space  ")).toBe("multi-space");
  });

  test("id generators carry stable prefixes", () => {
    expect(generateWorkspaceId()).toMatch(/^wks_/);
    expect(generateRootId()).toMatch(/^root_/);
  });
});

describe("pg-store workspace creation defaults", () => {
  test("duplicate slug derives path and channel from the persisted server slug", async () => {
    const store = new ProjectsPgStore(duplicateSlugClient());

    const created = await store.createWorkspace({
      id: "wks_duplicate_second",
      name: "Duplicate Project",
      slug: "duplicate-project",
      root_id: "root_projects",
    });

    expect(created.slug).toBe("duplicate-project-2");
    expect(created.primary_path).toBe("/srv/projects/duplicate-project-2");
    expect(created.integrations.conversations_channel).toBe("duplicate-project-2");
    expect(await store.getWorkspace(created.id)).toEqual(created);
  });

  test("explicit path and conversations channel still win after slug suffixing", async () => {
    const store = new ProjectsPgStore(duplicateSlugClient());

    const created = await store.createWorkspace({
      id: "wks_duplicate_explicit",
      name: "Duplicate Project",
      slug: "duplicate-project",
      root_id: "root_projects",
      primary_path: "/srv/elsewhere/explicit-project",
      integrations: { conversations_channel: "pinned-project-channel" },
    });

    expect(created.slug).toBe("duplicate-project-2");
    expect(created.primary_path).toBe("/srv/elsewhere/explicit-project");
    expect(created.integrations.conversations_channel).toBe("pinned-project-channel");
  });
});

// Live CRUD against a real Postgres, gated on PROJECTS_TEST_DATABASE_URL.
const LIVE_URL = process.env.PROJECTS_TEST_DATABASE_URL;

if (LIVE_URL) describe("pg-store live CRUD", () => {
  const pool = createPgPool({ connectionString: LIVE_URL, applicationName: "projects-test" });
  const client = createQueryClient(pool);
  const store = new ProjectsPgStore(client);

  afterAll(async () => {
    await pool.end();
  });

  test("migrations apply idempotently", async () => {
    await runProjectsMigrations(client);
    const second = await runProjectsMigrations(client);
    expect(second.plan.every((p: { state: string }) => p.state === "already_applied")).toBe(true);
  });

  test("create/list/get/update/archive/delete a project", async () => {
    const name = `Test Project ${Date.now()}`;
    const created = await store.createWorkspace({ name, tags: ["test", "serve"] });
    expect(created.id).toMatch(/^wks_/);
    expect(created.tags).toContain("test");

    const fetched = await store.getWorkspace(created.slug);
    expect(fetched?.id).toBe(created.id);

    const updated = await store.updateWorkspace(created.id, { description: "updated" });
    expect(updated.description).toBe("updated");

    const archived = await store.archiveWorkspace(created.id);
    expect(archived.status).toBe("archived");

    const events = await store.listWorkspaceEvents(created.id);
    expect(events.some((e) => e.event_type === "created")).toBe(true);

    const del = await store.deleteWorkspace(created.id, { hard: true });
    expect(del.hard).toBe(true);
    expect(await store.getWorkspace(created.id)).toBeNull();
  });
});
