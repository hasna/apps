import { afterAll, describe, expect, test } from "bun:test";
import { createPgPool, createQueryClient } from "../generated/storage-kit/index.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import type {
  GuardedProjectMutationReceiptRow,
  ProjectResourceLinkRow,
  RootRow,
  WorkspaceEventRow,
  WorkspaceRow,
} from "../types/workspace.js";
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

function guardedReadClient() {
  const workspace: WorkspaceRow = {
    id: "wks_guardedread0001",
    slug: "guarded-read",
    name: "Guarded Read",
    description: null,
    kind: "project",
    status: "active",
    root_id: null,
    recipe_id: null,
    canonical_machine: null,
    primary_path: "/srv/projects/guarded-read",
    git_remote: null,
    s3_bucket: null,
    s3_prefix: null,
    tags: "[]",
    integrations: "{}",
    metadata: "{}",
    last_opened_at: null,
    created_at: "2026-08-07 00:00:00",
    updated_at: "2026-08-07 00:00:01",
    synced_at: null,
  };
  const queries: Array<{ sql: string; params: readonly unknown[] }> = [];
  const resourceLink: ProjectResourceLinkRow = {
    id: "prl_guardedread",
    project_id: workspace.id,
    authority: "conversations",
    service_instance: "urn:hasna:conversations:test",
    source_package: "@hasna/conversations",
    target_kind: "channel",
    locator_kind: "conversations_channel_id",
    locator_value: "chn_79fa9c68937a1d020d6031dcaa3dd8d7",
    scope: "resource",
    labels_json: JSON.stringify({ channel_name: "guarded-read" }),
    created_at: "2026-08-07 00:00:01",
    updated_at: "2026-08-07 00:00:01",
  };
  const client = {
    async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
      queries.push({ sql, params });
      if (sql === "SELECT * FROM workspaces WHERE id = $1" && params[0] === workspace.id) {
        return workspace as T;
      }
      return null;
    },
    async execute() { throw new Error("guarded read must not write"); },
    async many<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      queries.push({ sql, params });
      if (sql.includes("FROM project_resource_links") && params[0] === workspace.id) {
        return [resourceLink as T];
      }
      throw new Error(`Unexpected many query: ${sql}`);
    },
    async one() { throw new Error("Unexpected one query"); },
    async query() { throw new Error("Unexpected query"); },
  } as TypedQueryClient;
  return { client, workspace, queries };
}

function resourceLinkMutationClient() {
  let workspace: WorkspaceRow = {
    id: "wks_pgresource0001",
    slug: "pg-resource",
    name: "Postgres Resource",
    description: null,
    kind: "project",
    status: "active",
    root_id: null,
    recipe_id: null,
    canonical_machine: null,
    primary_path: "/srv/projects/pg-resource",
    git_remote: null,
    s3_bucket: null,
    s3_prefix: null,
    tags: "[]",
    integrations: "{}",
    metadata: "{}",
    last_opened_at: null,
    created_at: "2026-08-08 00:00:00.000",
    updated_at: "2026-08-08 00:00:00.000",
    synced_at: null,
  };
  let links: ProjectResourceLinkRow[] = [];
  let receipts: GuardedProjectMutationReceiptRow[] = [];
  let events: WorkspaceEventRow[] = [];
  let failNextWorkspaceRevisionUpdate = false;

  const client = {
    async transaction<T>(fn: (transactionClient: TypedQueryClient) => Promise<T>): Promise<T> {
      const snapshot = structuredClone({ workspace, links, receipts, events });
      try {
        return await fn(client as TypedQueryClient);
      } catch (error) {
        workspace = snapshot.workspace;
        links = snapshot.links;
        receipts = snapshot.receipts;
        events = snapshot.events;
        throw error;
      }
    },
    async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
      if (sql === "SELECT * FROM workspaces WHERE id = $1 OR slug = $1") {
        return (workspace.id === params[0] || workspace.slug === params[0] ? workspace : null) as T | null;
      }
      if (sql.startsWith("SELECT * FROM guarded_project_mutation_receipts WHERE receipt_id")) {
        return (receipts.find((receipt) => receipt.receipt_id === params[0]) ?? null) as T | null;
      }
      if (sql.includes("FROM guarded_project_mutation_receipts") && sql.includes("idempotency_key = $4")) {
        return (receipts.find((receipt) =>
          receipt.operation_id === params[0]
          && receipt.step_id === params[1]
          && receipt.direction === params[2]
          && receipt.idempotency_key === params[3]
          && receipt.target_id === params[4]
          && receipt.outcome === "accepted"
        ) ?? null) as T | null;
      }
      if (sql.includes("FROM guarded_project_mutation_receipts") && sql.includes("outcome = 'accepted'")) {
        return (receipts.find((receipt) =>
          receipt.operation_id === params[0]
          && receipt.step_id === params[1]
          && receipt.direction === params[2]
          && receipt.target_id === params[3]
          && receipt.outcome === "accepted"
        ) ?? null) as T | null;
      }
      if (sql.startsWith("UPDATE workspaces SET integrations")) {
        if (failNextWorkspaceRevisionUpdate) {
          failNextWorkspaceRevisionUpdate = false;
          throw new Error("injected postgres revision update failure");
        }
        if (workspace.id !== params[2] || workspace.updated_at !== params[3]) return null;
        workspace = {
          ...workspace,
          integrations: String(params[0]),
          updated_at: String(params[1]),
        };
        return workspace as T;
      }
      if (sql.startsWith("SELECT * FROM workspace_events WHERE id")) {
        return (events.find((event) => event.id === params[0]) ?? null) as T | null;
      }
      throw new Error(`Unexpected get query: ${sql}`);
    },
    async many<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      if (sql.includes("FROM project_resource_links")) {
        return links
          .filter((link) => link.project_id === params[0])
          .slice(0, Number(params[1])) as T[];
      }
      throw new Error(`Unexpected many query: ${sql}`);
    },
    async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
      if (sql.startsWith("DELETE FROM project_resource_links")) {
        links = links.filter((link) => link.project_id !== params[0]);
        return;
      }
      if (sql.includes("INSERT INTO project_resource_links")) {
        links.push({
          id: String(params[0]),
          project_id: String(params[1]),
          authority: String(params[2]),
          service_instance: String(params[3]),
          source_package: String(params[4]),
          target_kind: String(params[5]),
          locator_kind: String(params[6]),
          locator_value: String(params[7]),
          scope: String(params[8]),
          labels_json: String(params[9]),
          created_at: String(params[10]),
          updated_at: String(params[11]),
        });
        return;
      }
      if (sql.includes("INSERT INTO guarded_project_mutation_receipts")) {
        receipts.push({
          receipt_id: String(params[0]),
          operation_id: String(params[1]),
          step_id: String(params[2]),
          direction: String(params[3]),
          idempotency_key: String(params[4]),
          target_id: String(params[5]),
          request_digest: String(params[6]),
          precondition_digest: String(params[7]),
          expected_revision: String(params[8]),
          outcome: String(params[9]),
          reason: params[10] === null ? null : String(params[10]),
          result_project_id: params[11] === null ? null : String(params[11]),
          duplicate_of_receipt_id: params[12] === null ? null : String(params[12]),
          before_json: params[13] === null ? null : String(params[13]),
          after_json: params[14] === null ? null : String(params[14]),
          post_revision: params[15] === null ? null : String(params[15]),
          created_at: "2026-08-08 00:00:00.001",
        });
        return;
      }
      if (sql.includes("INSERT INTO workspace_events")) {
        events.push({
          id: String(params[0]),
          workspace_id: params[1] === null ? null : String(params[1]),
          agent_id: params[2] === null ? null : String(params[2]),
          event_type: String(params[3]),
          source: String(params[4]),
          prompt: params[5] === null ? null : String(params[5]),
          command: params[6] === null ? null : String(params[6]),
          before_json: params[7] === null ? null : String(params[7]),
          after_json: params[8] === null ? null : String(params[8]),
          metadata: String(params[9]),
          created_at: String(params[10]),
        });
        return;
      }
      throw new Error(`Unexpected execute query: ${sql}`);
    },
    async one() {
      throw new Error("Unexpected one query");
    },
    async query() {
      throw new Error("Unexpected query");
    },
  } as TypedQueryClient & {
    transaction<T>(fn: (transactionClient: TypedQueryClient) => Promise<T>): Promise<T>;
  };

  return {
    client,
    workspace: () => structuredClone(workspace),
    links: () => structuredClone(links),
    receipts: () => structuredClone(receipts),
    events: () => structuredClone(events),
    failNextRevisionUpdate() {
      failNextWorkspaceRevisionUpdate = true;
    },
  };
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

describe("pg-store guarded exact project read", () => {
  test("reads only by exact id and returns the current revision in a complete envelope", async () => {
    const { client, workspace, queries } = guardedReadClient();
    const result = await new ProjectsPgStore(client).guardedReadWorkspace({
      project_id: workspace.id,
      response_byte_limit: 16_384,
      time_budget_ms: 5_000,
    });

    expect(result.project_id).toBe(workspace.id);
    expect(result.project).toMatchObject({ id: workspace.id, slug: workspace.slug, name: workspace.name });
    expect(result.current_revision).toBe(workspace.updated_at);
    expect(result.resource_links).toEqual([
      expect.objectContaining({
        id: "prl_guardedread",
        locator: {
          kind: "conversations_channel_id",
          value: "chn_79fa9c68937a1d020d6031dcaa3dd8d7",
        },
        labels: { channel_name: "guarded-read" },
      }),
    ]);
    expect(result.resource_link_count).toBe(1);
    expect(result.resource_link_collection_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.response_control.complete).toBe(true);
    expect(result.response_control.truncated).toBe(false);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toEqual({
      sql: "SELECT * FROM workspaces WHERE id = $1",
      params: [workspace.id],
    });
    expect(queries[1]?.sql).toContain("FROM project_resource_links");
    expect(queries[1]?.params).toEqual([workspace.id, 1001]);
  });

  test("rejects slug and partial targets before querying", async () => {
    const { client, workspace, queries } = guardedReadClient();
    const store = new ProjectsPgStore(client);
    await expect(store.guardedReadWorkspace({
      project_id: workspace.slug,
      response_byte_limit: 16_384,
      time_budget_ms: 5_000,
    })).rejects.toThrow(/complete stable project id/);
    expect(queries).toHaveLength(0);

    const partial = workspace.id.slice(0, -1);
    await expect(store.guardedReadWorkspace({
      project_id: partial,
      response_byte_limit: 16_384,
      time_budget_ms: 5_000,
    })).rejects.toThrow(`Workspace not found: ${partial}`);
    expect(queries).toEqual([{
      sql: "SELECT * FROM workspaces WHERE id = $1",
      params: [partial],
    }]);
  });

  test("fails closed on response-byte and whole-operation time limits without writing", async () => {
    const { client, workspace } = guardedReadClient();
    const store = new ProjectsPgStore(client);
    await expect(store.guardedReadWorkspace({
      project_id: workspace.id,
      response_byte_limit: 1,
      time_budget_ms: 5_000,
    })).rejects.toThrow(/response byte budget exceeded/);
    await expect(store.guardedReadWorkspace({
      project_id: workspace.id,
      response_byte_limit: 16_384,
      time_budget_ms: 1,
    }, Date.now() - 50)).rejects.toThrow(/time budget exceeded/);
  });
});

describe("pg-store typed resource-link transaction model", () => {
  const channelLink = {
    authority: "conversations" as const,
    service_instance: "urn:hasna:conversations:pg-model",
    source_package: "@hasna/conversations" as const,
    target_kind: "channel" as const,
    locator: {
      kind: "conversations_channel_id" as const,
      value: "chn_79fa9c68937a1d020d6031dcaa3dd8d7",
    },
    scope: "resource" as const,
    labels: { channel_name: "pg-resource" },
  };

  test("serializes concurrent revisions and rolls the full transaction back after an injected write fault", async () => {
    const harness = resourceLinkMutationClient();
    const store = new ProjectsPgStore(harness.client);
    const initialRevision = harness.workspace().updated_at;
    const accepted = await store.mutateProjectResourceLinks({
      project_id: harness.workspace().id,
      operation_id: "pg-model-add",
      step_id: "add-link",
      mode: "add",
      expected_revision: initialRevision,
      links: [channelLink],
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });
    expect(accepted.outcome).toBe("accepted");
    expect(harness.links()).toHaveLength(1);
    expect(harness.events()).toHaveLength(1);

    const stale = await store.mutateProjectResourceLinks({
      project_id: harness.workspace().id,
      operation_id: "pg-model-concurrent",
      step_id: "add-link",
      mode: "add",
      expected_revision: initialRevision,
      links: [channelLink],
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });
    expect(stale.outcome).toBe("terminal_nonacceptance");
    expect(stale.receipt?.reason).toBe("stale_revision");

    const stateBeforeFault = {
      workspace: harness.workspace(),
      links: harness.links(),
      receipts: harness.receipts(),
      events: harness.events(),
    };
    harness.failNextRevisionUpdate();
    await expect(store.mutateProjectResourceLinks({
      project_id: harness.workspace().id,
      operation_id: "pg-model-fault",
      step_id: "reconcile-link",
      mode: "reconcile",
      expected_revision: harness.workspace().updated_at,
      links: [{ ...channelLink, labels: { channel_name: "pg-resource-renamed" } }],
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    })).rejects.toThrow("injected postgres revision update failure");
    expect({
      workspace: harness.workspace(),
      links: harness.links(),
      receipts: harness.receipts(),
      events: harness.events(),
    }).toEqual(stateBeforeFault);
  });
});

describe("pg-store workspace creation defaults", () => {
  test("preserves an explicit workspace slug by default", async () => {
    const store = new ProjectsPgStore(duplicateSlugClient());

    const created = await store.createWorkspace({
      id: "wks_explicit_spelling",
      name: "Team One",
      slug: "Team_One",
      root_id: "root_projects",
    });

    expect(created.slug).toBe("Team_One");
    expect(created.primary_path).toBe("/srv/projects/Team_One");
  });

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

  test("typed resource-link lifecycle is transactional and rollback-safe", async () => {
    const stamp = Date.now();
    const created = await store.createWorkspace({
      name: `Resource Links ${stamp}`,
      slug: `resource-links-${stamp}`,
    });
    const channelLink = {
      authority: "conversations" as const,
      service_instance: "urn:hasna:conversations:live-test",
      source_package: "@hasna/conversations" as const,
      target_kind: "channel" as const,
      locator: {
        kind: "conversations_channel_id" as const,
        value: "chn_79fa9c68937a1d020d6031dcaa3dd8d7",
      },
      scope: "resource" as const,
      labels: { channel_name: `resource-links-${stamp}` },
    };
    const collectionLink = {
      authority: "todos" as const,
      service_instance: "urn:hasna:todos:live-test",
      source_package: "@hasna/todos" as const,
      target_kind: "task_list" as const,
      locator: {
        kind: "canonical_uri" as const,
        value: `urn:hasna:todos:task-list:resource-links-${stamp}`,
      },
      scope: "collection" as const,
      labels: { name: "Resource Link Tasks" },
    };

    try {
      const added = await store.mutateProjectResourceLinks({
        project_id: created.id,
        operation_id: `pg-resource-links-${stamp}`,
        step_id: "add-links",
        mode: "add",
        expected_revision: created.updated_at,
        links: [channelLink, collectionLink],
        max_items: 10,
        response_byte_limit: 100_000,
        time_budget_ms: 5_000,
      });
      expect(added.outcome).toBe("accepted");
      expect(added.after?.links).toHaveLength(2);
      expect(added.after?.project.integrations).toEqual({
        conversations_channel: `resource-links-${stamp}`,
        todos_task_list_id: `urn:hasna:todos:task-list:resource-links-${stamp}`,
      });

      const duplicate = await store.mutateProjectResourceLinks({
        project_id: created.id,
        operation_id: `pg-resource-links-${stamp}`,
        step_id: "add-links",
        mode: "add",
        expected_revision: created.updated_at,
        links: [channelLink, collectionLink],
        max_items: 10,
        response_byte_limit: 100_000,
        time_budget_ms: 5_000,
      });
      expect(duplicate.outcome).toBe("duplicate_of_accepted");

      const reconciled = await store.mutateProjectResourceLinks({
        project_id: created.id,
        operation_id: `pg-resource-links-reconcile-${stamp}`,
        step_id: "reconcile-links",
        mode: "reconcile",
        expected_revision: added.after!.project.updated_at,
        links: [{ ...channelLink, labels: { channel_name: `resource-links-renamed-${stamp}` } }],
        max_items: 10,
        response_byte_limit: 100_000,
        time_budget_ms: 5_000,
      });
      expect(reconciled.outcome).toBe("accepted");
      expect(reconciled.after?.links).toHaveLength(1);

      const rolledBack = await store.rollbackProjectResourceLinks({
        project_id: created.id,
        operation_id: `pg-resource-links-rollback-${stamp}`,
        step_id: "rollback-reconcile",
        accepted_receipt_id: reconciled.receipt!.receipt_id,
        expected_current_revision: reconciled.after!.project.updated_at,
        max_items: 10,
        response_byte_limit: 100_000,
        time_budget_ms: 5_000,
      });
      expect(rolledBack.outcome).toBe("accepted");
      expect(rolledBack.after?.links).toHaveLength(2);

      const read = await store.readProjectResourceLinks({
        project_id: created.id,
        max_items: 10,
        response_byte_limit: 100_000,
        time_budget_ms: 5_000,
      });
      expect(read.links).toHaveLength(2);
      expect(read.collection_digest).toBe(rolledBack.after!.collection_digest);
    } finally {
      await store.deleteWorkspace(created.id, { hard: true });
    }
  });
});
