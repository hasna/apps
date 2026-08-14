import { afterAll, describe, expect, test } from "bun:test";
import { createPgPool, createQueryClient } from "../generated/storage-kit/index.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import type {
  AgentRow,
  GuardedProjectMutationReceiptRow,
  ProjectQuarantineRequest,
  ProjectResourceLinkMigrationEvent,
  ProjectResourceLinkMigrationManifestRow,
  ProjectResourceLinkRow,
  RootRow,
  WorkspaceEventRow,
  WorkspaceRow,
} from "../types/workspace.js";
import {
  projectResourceLinkProducerAttestationId,
  projectResourceLinkProducerEvidenceDigest,
  type AsyncProjectResourceLinkProducerEvidenceVerifier,
} from "../lib/project-resource-link-migrations.js";
import {
  TEST_PRODUCER_VERIFIER_NOW,
  testConversationsProducerFixture,
} from "../lib/project-resource-link-producer-verifier.test-support.js";
import { runProjectsMigrations } from "./migrations.js";
import {
  ProjectsPgStore,
  ValidationError,
  generateWorkspaceId,
  generateRootId,
  slugify,
} from "./pg-store.js";
import { createProjectsPgStore } from "./index.js";

const trustedProducerEvidenceVerifier: AsyncProjectResourceLinkProducerEvidenceVerifier = (input) => {
  const evidenceDigest = projectResourceLinkProducerEvidenceDigest(
    input.manifest,
    input.phase,
    input.producer_evidence,
  );
  return {
    attestation_id: projectResourceLinkProducerAttestationId(
      input.manifest.manifest_id,
      input.phase,
      evidenceDigest,
    ),
    manifest_id: input.manifest.manifest_id,
    phase: input.phase,
    evidence_digest: evidenceDigest,
    verifier: "test-producer-authority-readback",
    verified_at: "2026-08-08T20:00:00.000Z",
  };
};

function eventAgentFkClient() {
  const createdAt = "2026-08-08 00:00:00";
  const agents: AgentRow[] = [{
    id: "agt_hosted",
    slug: "hosted-agent",
    name: "Hosted Agent",
    kind: "ai",
    provider: null,
    model: null,
    role: null,
    permissions: "[]",
    metadata: "{}",
    created_at: createdAt,
    updated_at: createdAt,
  }];
  const events: WorkspaceEventRow[] = [];

  const client = {
    async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
      if (sql.startsWith("SELECT * FROM agents WHERE")) {
        return (agents.find((agent) => agent.id === params[0] || agent.slug === params[0]) ?? null) as T | null;
      }
      if (sql.startsWith("SELECT * FROM workspace_events WHERE id")) {
        return (events.find((event) => event.id === params[0]) ?? null) as T | null;
      }
      throw new Error(`Unexpected get query: ${sql}`);
    },
    async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
      if (!sql.includes("INSERT INTO workspace_events")) throw new Error(`Unexpected execute query: ${sql}`);
      const agentId = params[2] === null ? null : String(params[2]);
      if (agentId && !agents.some((agent) => agent.id === agentId)) {
        throw new Error('insert or update on table "workspace_events" violates foreign key constraint "workspace_events_agent_id_fkey"');
      }
      events.push({
        id: String(params[0]),
        workspace_id: params[1] === null ? null : String(params[1]),
        agent_id: agentId,
        event_type: String(params[3]),
        source: String(params[4]),
        prompt: params[5] === null ? null : String(params[5]),
        command: params[6] === null ? null : String(params[6]),
        before_json: params[7] === null ? null : String(params[7]),
        after_json: params[8] === null ? null : String(params[8]),
        metadata: String(params[9]),
        created_at: String(params[10]),
      });
    },
    async many() { throw new Error("Unexpected many query"); },
    async one() { throw new Error("Unexpected one query"); },
    async query() { throw new Error("Unexpected query"); },
  } as TypedQueryClient;

  return { client, events };
}

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
  let migrationManifests: ProjectResourceLinkMigrationManifestRow[] = [];
  let migrationEvents: ProjectResourceLinkMigrationEvent[] = [];
  let failNextWorkspaceRevisionUpdate = false;

  const client = {
    async transaction<T>(fn: (transactionClient: TypedQueryClient) => Promise<T>): Promise<T> {
      const snapshot = structuredClone({
        workspace,
        links,
        receipts,
        events,
        migrationManifests,
        migrationEvents,
      });
      try {
        return await fn(client as TypedQueryClient);
      } catch (error) {
        workspace = snapshot.workspace;
        links = snapshot.links;
        receipts = snapshot.receipts;
        events = snapshot.events;
        migrationManifests = snapshot.migrationManifests;
        migrationEvents = snapshot.migrationEvents;
        throw error;
      }
    },
    async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
      if (sql === "SELECT id FROM workspaces WHERE slug = $1") {
        return (workspace.slug === params[0] ? { id: workspace.id } : null) as T | null;
      }
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
      if (sql.startsWith("UPDATE workspaces SET ")) {
        if (failNextWorkspaceRevisionUpdate && sql.startsWith("UPDATE workspaces SET integrations")) {
          failNextWorkspaceRevisionUpdate = false;
          throw new Error("injected postgres revision update failure");
        }
        const id = params.at(-2);
        const expectedRevision = params.at(-1);
        if (workspace.id !== id || workspace.updated_at !== expectedRevision) return null;
        const setClause = sql.match(/UPDATE workspaces SET ([\s\S]+?)\s+WHERE/)?.[1] ?? "";
        const updated = { ...workspace } as Record<string, unknown>;
        for (const match of setClause.matchAll(/([a-z_]+) = \$(\d+)/g)) {
          updated[match[1]!] = params[Number(match[2]) - 1];
        }
        workspace = updated as unknown as WorkspaceRow;
        return workspace as T;
      }
      if (sql.startsWith("SELECT * FROM workspace_events WHERE id")) {
        return (events.find((event) => event.id === params[0]) ?? null) as T | null;
      }
      if (
        sql.includes("FROM project_resource_link_migration_manifests")
        && sql.includes("operation_id = $2")
      ) {
        return (migrationManifests.find((manifest) =>
          manifest.project_id === params[0]
          && manifest.operation_id === params[1]
          && manifest.step_id === params[2]
        ) ?? null) as T | null;
      }
      if (
        sql.includes("FROM project_resource_link_migration_manifests")
        && sql.includes("manifest_id = $1")
      ) {
        return (migrationManifests.find((manifest) =>
          manifest.manifest_id === params[0] && manifest.project_id === params[1]
        ) ?? null) as T | null;
      }
      if (sql.startsWith("UPDATE project_resource_link_migration_manifests")) {
        const index = migrationManifests.findIndex((manifest) =>
          manifest.manifest_id === params[9]
          && manifest.project_id === params[10]
          && manifest.transition_version === params[11]
        );
        if (index < 0) return null;
        const current = migrationManifests[index]!;
        migrationManifests[index] = {
          ...current,
          state: String(params[0]),
          links_json: String(params[1]),
          projects_forward_receipt_id: params[2] === null ? null : String(params[2]),
          projects_inverse_receipt_id: params[3] === null ? null : String(params[3]),
          projects_reference_proof_json: params[4] === null ? null : String(params[4]),
          last_verified_projects_revision: params[5] === null ? null : String(params[5]),
          last_verified_projects_digest: params[6] === null ? null : String(params[6]),
          transition_version: Number(params[7]),
          updated_at: String(params[8]),
        };
        return { manifest_id: current.manifest_id } as T;
      }
      throw new Error(`Unexpected get query: ${sql}`);
    },
    async many<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      if (sql.includes("FROM project_resource_links")) {
        return links
          .filter((link) => link.project_id === params[0])
          .slice(0, Number(params[1])) as T[];
      }
      if (sql.includes("FROM workspace_locations")) {
        return [];
      }
      if (sql.includes("FROM project_resource_link_migration_events")) {
        return migrationEvents
          .filter((event) => event.manifest_id === params[0])
          .sort((a, b) => a.transition_version - b.transition_version)
          .slice(0, Number(params[1]))
          .map((event) => ({
            ...event,
            evidence_json: JSON.stringify(event.evidence),
          })) as T[];
      }
      throw new Error(`Unexpected many query: ${sql}`);
    },
    async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
      if (sql.includes("INSERT INTO project_resource_link_migration_manifests")) {
        migrationManifests.push({
          manifest_id: String(params[0]),
          project_id: String(params[1]),
          operation_id: String(params[2]),
          step_id: String(params[3]),
          state: String(params[4]),
          expected_project_revision: String(params[5]),
          desired_collection_digest: String(params[6]),
          links_json: String(params[7]),
          projects_forward_receipt_id: null,
          projects_inverse_receipt_id: null,
          projects_reference_proof_json: null,
          last_verified_projects_revision: null,
          last_verified_projects_digest: null,
          transition_version: Number(params[8]),
          created_at: String(params[9]),
          updated_at: String(params[10]),
        });
        return;
      }
      if (sql.includes("INSERT INTO project_resource_link_migration_events")) {
        migrationEvents.push({
          event_id: String(params[0]),
          manifest_id: String(params[1]),
          transition_version: Number(params[2]),
          from_state: params[3] === null ? null : params[3] as ProjectResourceLinkMigrationEvent["from_state"],
          to_state: params[4] as ProjectResourceLinkMigrationEvent["to_state"],
          request_digest: String(params[5]),
          precondition_digest: String(params[6]),
          evidence: JSON.parse(String(params[7])),
          created_at: String(params[8]),
        });
        return;
      }
      if (sql.startsWith("DELETE FROM project_resource_links")) {
        links = links.filter((link) => link.id !== params[0]);
        return;
      }
      if (sql.includes("UPDATE project_resource_links")) {
        const index = links.findIndex((link) => link.id === params[3]);
        if (index < 0) throw new Error(`Project resource link not found: ${String(params[3])}`);
        links[index] = {
          ...links[index]!,
          scope: String(params[0]),
          labels_json: String(params[1]),
          updated_at: String(params[2]),
        };
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
    migrationManifests: () => structuredClone(migrationManifests),
    migrationEvents: () => structuredClone(migrationEvents),
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

describe("pg-store event attribution", () => {
  test("drops a machine-local agent id that does not exist in the hosted agents table", async () => {
    const { client, events } = eventAgentFkClient();
    const store = new ProjectsPgStore(client);

    const event = await store.recordEvent({
      workspace_id: "wks_hosted",
      agent_id: "agt_machine_local",
      event_type: "started",
      source: "cli",
    });

    expect(event.agent_id).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0]?.agent_id).toBeNull();
  });

  test("preserves an agent id that exists in the hosted agents table", async () => {
    const { client, events } = eventAgentFkClient();
    const store = new ProjectsPgStore(client);

    const event = await store.recordEvent({
      workspace_id: "wks_hosted",
      agent_id: "agt_hosted",
      event_type: "started",
      source: "cli",
    });

    expect(event.agent_id).toBe("agt_hosted");
    expect(events[0]?.agent_id).toBe("agt_hosted");
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
  const contactLink = {
    authority: "contacts" as const,
    service_instance: "https://contacts.example.test/v1",
    source_package: "@hasna/contacts" as const,
    target_kind: "contact" as const,
    locator: {
      kind: "external_uuid" as const,
      value: "33333333-3333-4333-8333-333333333333",
    },
    scope: "resource" as const,
    labels: { name: "Existing contact" },
  };

  test("classifies a direct typed-integration update as validation before any hosted write", async () => {
    const harness = resourceLinkMutationClient();
    const before = harness.workspace();

    await expect(new ProjectsPgStore(harness.client).updateWorkspace(
      harness.workspace().id,
      {
        integrations: {
          conversations_channel: "moved-outside-resource-links",
        },
      },
    )).rejects.toBeInstanceOf(ValidationError);

    expect(harness.workspace()).toEqual(before);
    expect(harness.receipts()).toEqual([]);
    expect(harness.events()).toEqual([]);
  });

  test("classifies a guarded typed-integration dry run as validation before any hosted write", async () => {
    const harness = resourceLinkMutationClient();
    const before = harness.workspace();

    await expect(new ProjectsPgStore(harness.client).guardedUpdateWorkspace({
      project_id: harness.workspace().id,
      operation_id: "pg-invalid-guarded-integration-update",
      step_id: "integrations",
      expected_revision: harness.workspace().updated_at,
      patch: {
        integrations: {
          conversations_channel: "moved-outside-resource-links",
        },
      },
      dry_run: true,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    })).rejects.toBeInstanceOf(ValidationError);

    expect(harness.workspace()).toEqual(before);
    expect(harness.receipts()).toEqual([]);
    expect(harness.events()).toEqual([]);
  });

  test("rejects non-string integration values before any hosted write", async () => {
    const harness = resourceLinkMutationClient();
    const before = {
      workspace: harness.workspace(),
      links: harness.links(),
      receipts: harness.receipts(),
      events: harness.events(),
    };
    await expect(new ProjectsPgStore(harness.client).mutateProjectResourceLinks({
      project_id: harness.workspace().id,
      operation_id: "pg-invalid-integrations",
      step_id: "invalid-integrations",
      mode: "reconcile",
      expected_revision: harness.workspace().updated_at,
      links: [channelLink],
      integrations: { conversations_channel: { nested: true } } as never,
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    })).rejects.toThrow(/integration keys and values must be non-empty strings/);
    expect({
      workspace: harness.workspace(),
      links: harness.links(),
      receipts: harness.receipts(),
      events: harness.events(),
    }).toEqual(before);
  });

  test("commits a registration-merged snapshot without dropping unrelated hosted state", async () => {
    const harness = resourceLinkMutationClient();
    const store = new ProjectsPgStore(harness.client);
    const seeded = await store.mutateProjectResourceLinks({
      project_id: harness.workspace().id,
      operation_id: "pg-registration-preserve-seed",
      step_id: "seed-contact",
      mode: "add",
      expected_revision: harness.workspace().updated_at,
      links: [contactLink],
      integrations: { github_repo: "hasna/projects" },
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });
    expect(seeded.outcome).toBe("accepted");

    const registered = await store.mutateProjectResourceLinks({
      project_id: harness.workspace().id,
      operation_id: "pg-registration-preserve",
      step_id: "projects-resource-links",
      mode: "reconcile",
      expected_revision: harness.workspace().updated_at,
      links: [contactLink, channelLink],
      integrations: {
        github_repo: "hasna/projects",
        conversations_channel: "pg-resource",
        todos_project_id: "td_project_pg_resource",
        todos_task_list_id: "td_task_list_pg_resource",
        mementos_project_id: "mm_project_pg_resource",
      },
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });

    expect(registered.outcome).toBe("accepted");
    expect(harness.links()).toHaveLength(2);
    expect(harness.links().some((link) => link.authority === "contacts")).toBe(true);
    expect(JSON.parse(harness.workspace().integrations)).toMatchObject({
      github_repo: "hasna/projects",
      conversations_channel: "pg-resource",
    });
  });

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
      integrations: {
        conversations_channel: "pg-resource",
        todos_project_id: "td_project_pg_resource",
        todos_task_list_id: "td_task_list_pg_resource",
        mementos_project_id: "mm_project_pg_resource",
      },
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });
    expect(accepted.outcome).toBe("accepted");
    expect(harness.links()).toHaveLength(1);
    expect(JSON.parse(harness.workspace().integrations)).toEqual({
      conversations_channel: "pg-resource",
      todos_project_id: "td_project_pg_resource",
      todos_task_list_id: "td_task_list_pg_resource",
      mementos_project_id: "mm_project_pg_resource",
    });
    expect(harness.events()).toHaveLength(1);
    const acceptedLink = accepted.after!.links[0]!;
    const acceptedDigest = accepted.after!.collection_digest;

    const scopeChanged = await store.mutateProjectResourceLinks({
      project_id: harness.workspace().id,
      operation_id: "pg-model-scope",
      step_id: "change-scope",
      mode: "reconcile",
      expected_revision: accepted.after!.project.updated_at,
      links: [{ ...channelLink, scope: "collection" }],
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });
    expect(scopeChanged.outcome).toBe("accepted");
    expect(scopeChanged.after!.links[0]).toMatchObject({
      id: acceptedLink.id,
      created_at: acceptedLink.created_at,
      scope: "collection",
    });
    expect(scopeChanged.after!.collection_digest).not.toBe(acceptedDigest);

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

  test("recovers an accepted Projects inverse after process loss before proof persistence", async () => {
    const harness = resourceLinkMutationClient();
    const store = new ProjectsPgStore(harness.client);
    const bounds = {
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };
    const planned = await store.planProjectResourceLinkMigration({
      project_id: harness.workspace().id,
      operation_id: "pg-migration-inverse-crash",
      step_id: "channel-link",
      expected_project_revision: harness.workspace().updated_at,
      links: [{
        link: channelLink,
        producer_resource_kind: "conversations_channel",
        producer_binding: {
          authority_id: "conversations",
          tenant_id: "tenant-primary",
          corpus_id: null,
          capability_digest: "sha256:conversations-capability",
        },
      }],
      max_items: 10,
      ...bounds,
    });
    const producerApplied = await store.advanceProjectResourceLinkMigration({
      project_id: harness.workspace().id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: planned.manifest.transition_version,
      next_state: "producer_applied",
      producer_evidence: [{
        created_by_operation: true,
        forward_receipt_id: "conversations-forward-receipt",
        child_link_receipt_ids: [],
        target_revision: "conversations-revision-1",
        target_digest: "sha256:conversations-target-1",
        inverse_verified: null,
        inverse_outcome: null,
      }],
      evidence: { producer: "accepted" },
      ...bounds,
    });
    const projectsWrite = await store.mutateProjectResourceLinks({
      project_id: harness.workspace().id,
      operation_id: planned.manifest.operation_id,
      step_id: planned.manifest.step_id,
      mode: "add",
      expected_revision: harness.workspace().updated_at,
      links: [channelLink],
      max_items: 10,
      ...bounds,
    });
    const projectsApplied = await store.advanceProjectResourceLinkMigration({
      project_id: harness.workspace().id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: producerApplied.manifest.transition_version,
      next_state: "projects_applied",
      projects_forward_receipt_id: projectsWrite.receipt!.receipt_id,
      evidence: { projects: "accepted" },
      ...bounds,
    });
    const inverseInput = {
      project_id: harness.workspace().id,
      operation_id: `${planned.manifest.operation_id}:migration-rollback`,
      step_id: `${planned.manifest.step_id}:projects-reference`,
      accepted_receipt_id: projectsWrite.receipt!.receipt_id,
      expected_current_revision: harness.workspace().updated_at,
      max_items: 10,
      ...bounds,
    };

    const acceptedInverse = await store.rollbackProjectResourceLinks(inverseInput);
    expect(acceptedInverse.outcome).toBe("accepted");
    expect(harness.migrationManifests()[0]).toMatchObject({
      state: "projects_applied",
      projects_inverse_receipt_id: null,
      projects_reference_proof_json: null,
    });

    const directRetry = await store.rollbackProjectResourceLinks(inverseInput);
    expect(directRetry.outcome).toBe("duplicate_of_accepted");
    expect(directRetry.receipt?.duplicate_of_receipt_id).toBe(acceptedInverse.receipt!.receipt_id);

    const recovered = await store.rollbackProjectResourceLinkMigration({
      project_id: harness.workspace().id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: projectsApplied.manifest.transition_version,
      producer_outcome: "pending",
      evidence: { recovered_after_inverse_process_loss: true },
      max_items: 10,
      ...bounds,
    });
    expect(recovered.manifest.state).toBe("rollback_in_progress");
    expect(recovered.manifest.projects_inverse_receipt_id).toBe(acceptedInverse.receipt!.receipt_id);
    expect(recovered.manifest.projects_reference_proof).toEqual(expect.objectContaining({
      kind: "accepted_inverse",
      inverse_receipt_id: acceptedInverse.receipt!.receipt_id,
      complete: true,
      truncated: false,
    }));
    expect(harness.links()).toEqual([]);
  });

  test("requires exact producer proof for terminal migration states and bounds event reads", async () => {
    const harness = resourceLinkMutationClient();
    const store = new ProjectsPgStore(harness.client);
    const fixture = testConversationsProducerFixture({
      operationId: "pg-migration-proof",
      stepId: "channel-link",
      targetId: channelLink.locator.value,
      projectId: harness.workspace().id,
      projectSlug: harness.workspace().slug,
      projectName: harness.workspace().name,
      projectKind: "project",
    });
    const trustedStore = createProjectsPgStore(harness.client, {
      producerAuthorityOptions: fixture.authorityOptions,
      producerVerifierNow: () => TEST_PRODUCER_VERIFIER_NOW,
    });
    const defaultStore = createProjectsPgStore(harness.client);
    const bounds = {
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };
    const producerEvidence = fixture.producerEvidence("forward");
    const planned = await store.planProjectResourceLinkMigration({
      project_id: harness.workspace().id,
      operation_id: "pg-migration-proof",
      step_id: "channel-link",
      expected_project_revision: harness.workspace().updated_at,
      links: [{
        link: channelLink,
        producer_resource_kind: "conversations_channel",
        producer_binding: {
          authority_id: "conversations",
          tenant_id: "tenant-primary",
          corpus_id: fixture.capability.corpus_id,
          capability_digest: fixture.capabilityDigest,
        },
      }],
      max_items: 10,
      ...bounds,
    });
    const producerApplied = await store.advanceProjectResourceLinkMigration({
      project_id: harness.workspace().id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: planned.manifest.transition_version,
      next_state: "producer_applied",
      producer_evidence: producerEvidence,
      evidence: { producer: "accepted" },
      ...bounds,
    });
    const projectsWrite = await store.mutateProjectResourceLinks({
      project_id: harness.workspace().id,
      operation_id: "pg-migration-projects-write",
      step_id: "channel-link",
      mode: "add",
      expected_revision: harness.workspace().updated_at,
      links: [channelLink],
      max_items: 10,
      ...bounds,
    });
    const projectsApplied = await store.advanceProjectResourceLinkMigration({
      project_id: harness.workspace().id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: producerApplied.manifest.transition_version,
      next_state: "projects_applied",
      projects_forward_receipt_id: projectsWrite.receipt!.receipt_id,
      evidence: { projects: "accepted" },
      ...bounds,
    });

    const verifiedInput = {
      project_id: harness.workspace().id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: projectsApplied.manifest.transition_version,
      next_state: "verified" as const,
      last_verified_projects_revision: harness.workspace().updated_at,
      last_verified_projects_digest: projectsWrite.after!.collection_digest,
      evidence: { verification: "exact-readback" },
      ...bounds,
    };
    await expect(defaultStore.advanceProjectResourceLinkMigration(verifiedInput))
      .rejects.toThrow(/producer readback proof/i);
    await expect(store.advanceProjectResourceLinkMigration({
      ...verifiedInput,
      evidence: { producer_attestation: { caller_fabricated: true } },
      producer_evidence: [{
        ...producerEvidence[0]!,
        forward_receipt_id: "forged-receipt",
        target_revision: "conversations-revision-2",
        target_digest: "sha256:conversations-target-2",
      }],
    })).rejects.toThrow(/persisted producer receipt/i);
    await expect(store.advanceProjectResourceLinkMigration({
      ...verifiedInput,
      evidence: { producer_attestation: { caller_fabricated: true } },
      producer_evidence: [{
        ...producerEvidence[0]!,
        target_revision: "conversations-revision-2",
        target_digest: "sha256:conversations-target-2",
      }],
    })).rejects.toThrow(/trusted producer receipt\/readback attestation/i);
    await expect(defaultStore.advanceProjectResourceLinkMigration({
      ...verifiedInput,
      producer_evidence: fixture.producerEvidence("readback"),
      evidence: {},
    })).rejects.toThrow(/producer verification evidence must be an object/i);
    await expect(trustedStore.advanceProjectResourceLinkMigration({
      ...verifiedInput,
      evidence: fixture.verificationEvidence(planned.manifest.links[0]!.link_id, {
        forwardReceipt: {
          ...fixture.forwardReceipt,
          created_at: "2026-08-10T11:00:01.000Z",
        },
      }),
      producer_evidence: fixture.producerEvidence("readback"),
    })).rejects.toThrow(/stored producer receipt/i);
    const verified = await trustedStore.advanceProjectResourceLinkMigration({
      ...verifiedInput,
      evidence: fixture.verificationEvidence(planned.manifest.links[0]!.link_id),
      producer_evidence: fixture.producerEvidence("readback"),
    });
    expect(verified.manifest.state).toBe("verified");
    expect(verified.manifest.links[0]?.producer_evidence).toMatchObject({
      forward_receipt_id: "conversations-forward-receipt",
      target_revision: "conversations-revision-2",
    });
    expect(verified.events.at(-1)?.evidence.producer_attestation).toEqual(expect.objectContaining({
      phase: "readback",
      verifier: "projects.production-producer-authority-readback.v1",
    }));

    const bounded = await store.readProjectResourceLinkMigration({
      project_id: harness.workspace().id,
      manifest_id: planned.manifest.manifest_id,
      max_items: 1,
      ...bounds,
    });
    expect(bounded.events).toHaveLength(1);
    expect(bounded.response_control.complete).toBe(false);
    expect(bounded.response_control.truncated).toBe(true);

    const rollbackProof = await store.rollbackProjectResourceLinkMigration({
      project_id: harness.workspace().id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: verified.manifest.transition_version,
      producer_outcome: "pending",
      evidence: { projects_reference_proof: "persisted" },
      max_items: 10,
      ...bounds,
    });
    const rollbackInput = {
      project_id: harness.workspace().id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: rollbackProof.manifest.transition_version,
      producer_outcome: "complete" as const,
      evidence: { producer_inverse: "verified" },
      max_items: 10,
      ...bounds,
    };
    await expect(store.rollbackProjectResourceLinkMigration(rollbackInput))
      .rejects.toThrow(/producer inverse proof/i);
    await expect(store.rollbackProjectResourceLinkMigration({
      ...rollbackInput,
      evidence: { producer_attestation: { caller_fabricated: true } },
      producer_evidence: [{
        ...producerEvidence[0]!,
        target_revision: "conversations-revision-3",
        target_digest: "sha256:conversations-target-3",
        inverse_verified: false,
        inverse_outcome: "complete",
      }],
    })).rejects.toThrow(/inverse_verified=true/i);
    await expect(store.rollbackProjectResourceLinkMigration({
      ...rollbackInput,
      evidence: { producer_attestation: { caller_fabricated: true } },
      producer_evidence: [{
        ...producerEvidence[0]!,
        target_revision: "conversations-revision-3",
        target_digest: "sha256:conversations-target-3",
        inverse_verified: true,
        inverse_outcome: "complete",
      }],
    })).rejects.toThrow(/trusted producer receipt\/readback attestation/i);
    const rolledBack = await trustedStore.rollbackProjectResourceLinkMigration({
      ...rollbackInput,
      evidence: fixture.verificationEvidence(planned.manifest.links[0]!.link_id, {
        inverse: true,
      }),
      producer_evidence: fixture.producerEvidence("inverse"),
    });
    expect(rolledBack.manifest.state).toBe("rolled_back");
    expect(rolledBack.manifest.links[0]?.producer_evidence).toMatchObject({
      inverse_verified: true,
      inverse_outcome: "complete",
    });
    expect(rolledBack.events.at(-1)?.evidence.producer_attestation).toEqual(expect.objectContaining({
      phase: "inverse_complete",
      verifier: "projects.production-producer-authority-readback.v1",
    }));
    expect(fixture.calls).toEqual([
      "capability",
      "lookup:forward",
      "capability",
      "lookup:forward",
      "readExact",
      "capability",
      "lookup:forward",
      "lookup:inverse",
      "verifyInverse",
    ]);
  });

  test("public PostgreSQL construction rejects a project-A receipt replayed into project B", async () => {
    const harness = resourceLinkMutationClient();
    const rawStore = new ProjectsPgStore(harness.client);
    const projectAReceipt = testConversationsProducerFixture({
      operationId: "pg-cross-project-producer-replay",
      stepId: "channel-link",
      targetId: channelLink.locator.value,
      projectId: "wks_pg_producer_project_a",
      projectSlug: "pg-producer-project-a",
      projectName: "Postgres Producer Project A",
      projectKind: "project",
    });
    const trustedStore = createProjectsPgStore(harness.client, {
      producerAuthorityOptions: projectAReceipt.authorityOptions,
      producerVerifierNow: () => TEST_PRODUCER_VERIFIER_NOW,
    });
    const bounds = {
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };
    const planned = await rawStore.planProjectResourceLinkMigration({
      project_id: harness.workspace().id,
      operation_id: "pg-cross-project-producer-replay",
      step_id: "channel-link",
      expected_project_revision: harness.workspace().updated_at,
      links: [{
        link: channelLink,
        producer_resource_kind: "conversations_channel",
        producer_binding: {
          authority_id: projectAReceipt.capability.authority_id,
          tenant_id: projectAReceipt.capability.tenant_id,
          corpus_id: projectAReceipt.capability.corpus_id,
          capability_digest: projectAReceipt.capabilityDigest,
        },
      }],
      max_items: 10,
      ...bounds,
    });
    const producerApplied = await rawStore.advanceProjectResourceLinkMigration({
      project_id: harness.workspace().id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: planned.manifest.transition_version,
      next_state: "producer_applied",
      producer_evidence: projectAReceipt.producerEvidence("forward"),
      evidence: { producer: "accepted" },
      ...bounds,
    });
    const projectsWrite = await rawStore.mutateProjectResourceLinks({
      project_id: harness.workspace().id,
      operation_id: "pg-cross-project-producer-replay:projects",
      step_id: "channel-link",
      mode: "add",
      expected_revision: harness.workspace().updated_at,
      links: [channelLink],
      max_items: 10,
      ...bounds,
    });
    const projectsApplied = await rawStore.advanceProjectResourceLinkMigration({
      project_id: harness.workspace().id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: producerApplied.manifest.transition_version,
      next_state: "projects_applied",
      projects_forward_receipt_id: projectsWrite.receipt!.receipt_id,
      evidence: { projects: "accepted" },
      ...bounds,
    });

    await expect(trustedStore.advanceProjectResourceLinkMigration({
      project_id: harness.workspace().id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: projectsApplied.manifest.transition_version,
      next_state: "verified",
      producer_evidence: projectAReceipt.producerEvidence("readback"),
      last_verified_projects_revision: harness.workspace().updated_at,
      last_verified_projects_digest: projectsWrite.after!.collection_digest,
      evidence: projectAReceipt.verificationEvidence(planned.manifest.links[0]!.link_id),
      ...bounds,
    })).rejects.toThrow(/trusted project subject/i);
  });
});

describe("pg-store duplicate project quarantine", () => {
  test("stale dry runs are repeatable without hosted receipts or domain writes", async () => {
    const harness = resourceLinkMutationClient();
    const store = new ProjectsPgStore(harness.client);
    const read = await store.readDuplicateProjectQuarantinePreimage({
      project_id: harness.workspace().id,
      resource_link_max_items: 10,
      workspace_location_max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });
    const staleDryRun: ProjectQuarantineRequest = {
      project_id: read.project_id,
      operation_id: "pg-quarantine-stale-dry-run",
      step_id: "retire-duplicate",
      expected_revision: "2026-01-01 00:00:00",
      expected_project_digest: read.snapshot.project_digest,
      expected_resource_link_collection_digest: read.snapshot.resource_link_collection_digest,
      expected_resource_link_ids: read.snapshot.resource_links.map((link) => link.id),
      resource_link_max_items: 10,
      expected_workspace_location_collection_digest: read.snapshot.workspace_location_collection_digest,
      expected_workspace_location_ids: read.snapshot.workspace_locations.map((location) => location.id),
      workspace_location_max_items: 10,
      quarantine_name: "Postgres Resource provenance",
      quarantine_slug: "pg-resource-provenance",
      dry_run: true,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };
    const before = {
      workspace: harness.workspace(),
      links: harness.links(),
      receipts: harness.receipts(),
      events: harness.events(),
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await store.quarantineDuplicateProject(staleDryRun);
      expect(result).toMatchObject({
        ok: false,
        dry_run: true,
        outcome: "terminal_nonacceptance",
        receipt: null,
        rollback: null,
      });
      expect({
        workspace: harness.workspace(),
        links: harness.links(),
        receipts: harness.receipts(),
        events: harness.events(),
      }).toEqual(before);
    }

    const applied = await store.quarantineDuplicateProject({
      ...staleDryRun,
      dry_run: false,
    });
    expect(applied).toMatchObject({
      ok: false,
      dry_run: false,
      outcome: "terminal_nonacceptance",
      receipt: {
        operation_id: staleDryRun.operation_id,
        reason: "stale_revision",
      },
      rollback: null,
    });
    expect(harness.workspace()).toEqual(before.workspace);
    expect(harness.links()).toEqual(before.links);
    expect(harness.events()).toEqual(before.events);
    expect(harness.receipts()).toHaveLength(before.receipts.length + 1);
  });
});

describe("pg-store guarded workspace mutation", () => {
  test("previews, writes, and rolls back identity fields and last_opened_at", async () => {
    const harness = resourceLinkMutationClient();
    const store = new ProjectsPgStore(harness.client);
    const openedAt = "2026-08-08T11:00:00.000Z";
    const forwardPath = "/srv/projects/pg-resource-next";
    const forwardRemote = "https://example.invalid/hasna/pg-resource-next.git";
    const request = {
      project_id: harness.workspace().id,
      operation_id: "pg-open-timestamp",
      step_id: "record-open",
      expected_revision: harness.workspace().updated_at,
      patch: {
        kind: "open-source" as const,
        primary_path: forwardPath,
        git_remote: forwardRemote,
        last_opened_at: openedAt,
      },
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };

    const dryRun = await store.guardedUpdateWorkspace({ ...request, dry_run: true });
    expect(dryRun.after).toMatchObject({
      kind: "open-source",
      primary_path: forwardPath,
      git_remote: forwardRemote,
      last_opened_at: openedAt,
    });
    expect(harness.workspace()).toMatchObject({
      kind: "project",
      primary_path: "/srv/projects/pg-resource",
      git_remote: null,
      last_opened_at: null,
    });

    const accepted = await store.guardedUpdateWorkspace(request);
    expect(accepted.after).toMatchObject({
      kind: "open-source",
      primary_path: forwardPath,
      git_remote: forwardRemote,
      last_opened_at: openedAt,
    });
    expect(harness.workspace()).toMatchObject({
      kind: "open-source",
      primary_path: forwardPath,
      git_remote: forwardRemote,
      last_opened_at: openedAt,
    });

    const rolledBack = await store.rollbackGuardedWorkspaceMutation({
      project_id: request.project_id,
      operation_id: "pg-open-timestamp-rollback",
      step_id: "restore-open-timestamp",
      accepted_receipt_id: accepted.receipt!.receipt_id,
      expected_current_revision: accepted.receipt!.post_revision!,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });
    expect(rolledBack.after).toMatchObject({
      kind: "project",
      primary_path: "/srv/projects/pg-resource",
      git_remote: null,
      last_opened_at: null,
    });
    expect(harness.workspace()).toMatchObject({
      kind: "project",
      primary_path: "/srv/projects/pg-resource",
      git_remote: null,
      last_opened_at: null,
    });
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
