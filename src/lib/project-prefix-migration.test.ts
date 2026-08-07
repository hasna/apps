import { describe, expect, test } from "bun:test";
import type {
  GuardedProjectMutationReceipt,
  GuardedProjectMutationResult,
  Workspace,
} from "../types/workspace.js";
import type { ProjectStore } from "../store/project-store.js";
import {
  createConversationsPrefixPort,
  runProjectPrefixMigration,
  stripProjectPrefix,
  type ConversationsChannelIdentity,
  type ConversationsPrefixPort,
} from "./project-prefix-migration.js";

function project(input: Partial<Workspace> & Pick<Workspace, "id" | "name" | "status" | "integrations">): Workspace {
  return {
    id: input.id,
    slug: input.slug ?? input.id.replace(/^wks_/, "project-"),
    name: input.name,
    description: null,
    kind: "project",
    status: input.status,
    root_id: null,
    recipe_id: null,
    canonical_machine: null,
    primary_path: `/tmp/${input.id}`,
    git_remote: null,
    s3_bucket: null,
    s3_prefix: null,
    tags: [],
    integrations: input.integrations,
    metadata: {},
    last_opened_at: null,
    created_at: "2026-08-07T00:00:00Z",
    updated_at: input.updated_at ?? `${input.id}-revision`,
    synced_at: null,
  };
}

function channel(name: string, project_id: string | null, archived_at: string | null = null): ConversationsChannelIdentity {
  return { name, project_id, archived_at, member_count: 3, message_count: 7 };
}

function makeHarness(initialProjects: Workspace[], initialChannels: ConversationsChannelIdentity[]) {
  const projects = new Map(initialProjects.map((item) => [item.id, structuredClone(item)]));
  const channels = new Map(initialChannels.map((item) => [item.name, structuredClone(item)]));
  const markers: Workspace[] = [];
  const events: unknown[] = [];
  let rollbackCalls = 0;

  const conversations: ConversationsPrefixPort = {
    async listChannels() {
      const rows = [...channels.values()].sort((a, b) => a.name.localeCompare(b.name));
      return { channels: rows, total: rows.length, pages: 1, complete: true };
    },
    async renameChannel({ current_name, target_name, on_written }) {
      const before = channels.get(current_name);
      if (!before) throw new Error(`missing channel ${current_name}`);
      if (channels.has(target_name)) throw new Error(`collision ${target_name}`);
      const after = { ...before, name: target_name };
      channels.delete(current_name);
      channels.set(target_name, after);
      await on_written(after);
      return after;
    },
  };

  function receipt(projectId: string, stepId: string, before: Workspace, after: Workspace): GuardedProjectMutationReceipt {
    return {
      receipt_id: `gpmr-${stepId}`,
      operation_id: "test-operation",
      step_id: stepId,
      direction: "forward",
      idempotency_key: `idem-${stepId}`,
      target_id: projectId,
      request_digest: `request-${stepId}`,
      precondition_digest: `precondition-${stepId}`,
      expected_revision: before.updated_at,
      outcome: "accepted",
      reason: null,
      result_project_id: projectId,
      duplicate_of_receipt_id: null,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      post_revision: after.updated_at,
      created_at: "2026-08-07T00:00:00Z",
    };
  }

  const store = {
    mode: "local",
    baseUrl: null,
    async listProjectsComplete() {
      const rows = [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
      return { projects: rows, total: rows.length, pages: 1, complete: true as const };
    },
    async guardedUpdateProject(input: {
      project_id: string;
      step_id: string;
      expected_revision: string;
      patch: { name?: string; integrations?: Workspace["integrations"] };
    }): Promise<GuardedProjectMutationResult> {
      const before = projects.get(input.project_id)!;
      const after = {
        ...before,
        ...input.patch,
        updated_at: `${before.updated_at}-next`,
      };
      projects.set(after.id, after);
      return {
        ok: true,
        dry_run: false,
        outcome: "accepted",
        idempotency_key: `idem-${input.step_id}`,
        request_digest: `request-${input.step_id}`,
        precondition_digest: `precondition-${input.step_id}`,
        project_id: after.id,
        expected_revision: input.expected_revision,
        current_revision: after.updated_at,
        before,
        after,
        receipt: receipt(after.id, input.step_id, before, after),
        response_control: {
          response_byte_limit: 1_000_000,
          time_budget_ms: 30_000,
          response_bytes: 100,
          elapsed_ms: 1,
          complete: true,
          truncated: false,
        },
      };
    },
    async rollbackGuardedProjectMutation(input: {
      project_id: string;
      step_id: string;
      accepted_receipt_id: string;
      expected_current_revision: string;
    }): Promise<GuardedProjectMutationResult> {
      rollbackCalls++;
      const before = projects.get(input.project_id)!;
      const original = initialProjects.find((item) => item.id === input.project_id)!;
      const after = { ...original, updated_at: `${before.updated_at}-rolled-back` };
      projects.set(after.id, after);
      const rolledBack = receipt(after.id, input.step_id, before, after);
      rolledBack.direction = "inverse";
      return {
        ok: true,
        dry_run: false,
        outcome: "accepted",
        idempotency_key: `idem-${input.step_id}`,
        request_digest: `request-${input.step_id}`,
        precondition_digest: `precondition-${input.step_id}`,
        project_id: after.id,
        expected_revision: input.expected_current_revision,
        current_revision: after.updated_at,
        before,
        after,
        receipt: rolledBack,
        response_control: {
          response_byte_limit: 1_000_000,
          time_budget_ms: 30_000,
          response_bytes: 100,
          elapsed_ms: 1,
          complete: true,
          truncated: false,
        },
      };
    },
    async recordEvent(_id: string, input: unknown) {
      events.push(input);
      return {} as never;
    },
  } as unknown as ProjectStore;

  return {
    store,
    conversations,
    markers,
    events,
    get rollbackCalls() {
      return rollbackCalls;
    },
    projects,
    channels,
    write_marker: (updated: Workspace) => {
      markers.push(updated);
      return { type: "workspace_marker", target: `${updated.primary_path}/.project.json`, status: "completed" as const };
    },
  };
}

describe("project prefix migration", () => {
  test("strips exactly one leading prefix and leaves ordinary names unchanged", () => {
    expect(stripProjectPrefix("internal-iproj-package-arrivals")).toEqual({
      name: "package-arrivals",
      prefix: "internal-iproj-",
    });
    expect(stripProjectPrefix("iproj-package-arrivals")).toEqual({
      name: "package-arrivals",
      prefix: "iproj-",
    });
    expect(stripProjectPrefix("package-arrivals")).toEqual({ name: "package-arrivals", prefix: null });
    expect(stripProjectPrefix("internal-iproj-iproj-package-arrivals").name).toBe("iproj-package-arrivals");
  });

  test("dry-run inventories active and archived identities, then apply regenerates markers from updated rows", async () => {
    const active = project({
      id: "wks_active00001",
      name: "internal-iproj-package-arrivals",
      status: "active",
      integrations: {
        conversations_project_id: "wks_active00001",
        conversations_channel: "internal-iproj-package-arrivals",
      },
    });
    const archived = project({
      id: "wks_archived001",
      name: "iproj-archive-lane",
      status: "archived",
      integrations: {
        conversations_project_id: "wks_archived001",
        conversations_channel: "iproj-archive-lane",
      },
    });
    const harness = makeHarness(
      [active, archived],
      [channel("internal-iproj-package-arrivals", active.id), channel("iproj-archive-lane", archived.id, "2026-08-06T00:00:00Z")],
    );

    const planned = await runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
      write_marker: harness.write_marker,
    });
    expect(planned.dry_run).toBe(true);
    expect(planned.inventory.complete).toBe(true);
    expect(planned.inventory.project_candidates).toBe(2);
    expect(planned.inventory.channel_candidates).toBe(2);
    expect(planned.steps).toHaveLength(4);
    expect(harness.markers).toHaveLength(0);
    expect([...harness.channels.keys()]).toContain("internal-iproj-package-arrivals");

    const applied = await runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
      write_marker: harness.write_marker,
      dry_run: false,
      operation_id: planned.operation_id,
    });
    expect(applied.ok).toBe(true);
    expect(applied.rollback.complete).toBe(true);
    expect(harness.markers.map((item) => item.name).sort()).toEqual(["archive-lane", "package-arrivals"]);
    expect([...harness.channels.keys()].sort()).toEqual(["archive-lane", "package-arrivals"]);
    expect(harness.events).toHaveLength(4);

    const rerun = await runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
      write_marker: harness.write_marker,
      dry_run: false,
      operation_id: planned.operation_id,
    });
    expect(rerun.ok).toBe(true);
    expect(rerun.steps).toHaveLength(0);
  });

  test("refuses project and channel target collisions before any write", async () => {
    const prefixed = project({
      id: "wks_prefixed0001",
      name: "iproj-collision",
      status: "active",
      integrations: {},
    });
    const existing = project({
      id: "wks_existing0001",
      name: "collision",
      status: "active",
      integrations: {},
    });
    const harness = makeHarness([prefixed, existing], []);
    await expect(runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
    })).rejects.toThrow(/Project target collision/);
    expect(harness.projects.get(prefixed.id)!.name).toBe("iproj-collision");
  });

  test("refuses project slug target collisions independently from project names", async () => {
    const prefixed = project({
      id: "wks_fleetreports1",
      slug: "iproj-fleet-reports",
      name: "Fleet reporting migration",
      status: "active",
      integrations: {},
    });
    const existing = project({
      id: "wks_fleetreports2",
      slug: "fleet-reports",
      name: "Existing fleet reports",
      status: "active",
      integrations: {},
    });
    const harness = makeHarness([prefixed, existing], []);

    await expect(runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
    })).rejects.toThrow(/Project slug target collision: "fleet-reports" already belongs to wks_fleetreports2/);
    expect(harness.projects.get(prefixed.id)!.slug).toBe("iproj-fleet-reports");
  });

  test("migrates a project selected only by its Conversations channel integration", async () => {
    const conversationsProjectId = "conversations-integration-only";
    const source = project({
      id: "wks_integration1",
      slug: "integration-only",
      name: "Integration only",
      status: "active",
      integrations: {
        conversations_project_id: conversationsProjectId,
        conversations_channel: "iproj-integration-only",
      },
    });
    const harness = makeHarness(
      [source],
      [channel("iproj-integration-only", conversationsProjectId)],
    );

    const planned = await runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
    });
    expect(planned.inventory.project_candidates).toBe(1);
    expect(planned.steps.filter((step) => step.target_kind === "project")).toHaveLength(1);

    const applied = await runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
      write_marker: harness.write_marker,
      dry_run: false,
      operation_id: planned.operation_id,
    });
    expect(applied.ok).toBe(true);
    expect(harness.projects.get(source.id)?.name).toBe("Integration only");
    expect(harness.projects.get(source.id)?.slug).toBe("integration-only");
    expect(harness.projects.get(source.id)?.integrations.conversations_channel).toBe("integration-only");
    expect(applied.steps.find((step) => step.target_kind === "project")).toMatchObject({
      status: "accepted",
      receipt: expect.objectContaining({ outcome: "accepted" }),
      marker: expect.objectContaining({ status: "completed" }),
    });
  });

  test("migrates a project selected only by its slug", async () => {
    const source = project({
      id: "wks_slugonly001",
      slug: "internal-iproj-slug-only",
      name: "Slug only",
      status: "active",
      integrations: {},
    });
    const harness = makeHarness([source], []);

    const planned = await runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
    });
    expect(planned.inventory.project_candidates).toBe(1);
    expect(planned.steps).toEqual([
      expect.objectContaining({ target_kind: "project", project_id: source.id }),
    ]);

    const applied = await runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
      write_marker: harness.write_marker,
      dry_run: false,
      operation_id: planned.operation_id,
    });
    expect(applied.ok).toBe(true);
    expect(harness.projects.get(source.id)).toMatchObject({
      name: "Slug only",
      slug: "slug-only",
      integrations: {},
    });
    expect(harness.markers).toHaveLength(1);
  });

  test("strips project name, slug, and Conversations channel in one guarded update", async () => {
    const conversationsProjectId = "conversations-multi-field";
    const source = project({
      id: "wks_multifield1",
      slug: "iproj-multi-field",
      name: "internal-iproj-multi-field",
      status: "active",
      integrations: {
        conversations_project_id: conversationsProjectId,
        conversations_channel: "internal-iproj-multi-field",
      },
    });
    const harness = makeHarness(
      [source],
      [channel("internal-iproj-multi-field", conversationsProjectId)],
    );

    const applied = await runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
      write_marker: harness.write_marker,
      dry_run: false,
      operation_id: "multi-field-operation",
    });

    expect(applied.ok).toBe(true);
    expect(applied.inventory.project_candidates).toBe(1);
    expect(harness.projects.get(source.id)?.name).toBe("multi-field");
    expect(harness.projects.get(source.id)?.slug).toBe("multi-field");
    expect(harness.projects.get(source.id)?.integrations.conversations_channel).toBe("multi-field");
    const projectStep = applied.steps.find((step) => step.target_kind === "project");
    expect(projectStep?.status).toBe("accepted");
    expect(projectStep?.marker).toMatchObject({ status: "completed" });
    const receipt = projectStep?.receipt as GuardedProjectMutationReceipt;
    expect(receipt.outcome).toBe("accepted");
    expect(receipt.before).not.toBeNull();
    const receiptBefore = receipt.before!;
    expect(receiptBefore.name).toBe("internal-iproj-multi-field");
    expect(receiptBefore.slug).toBe("iproj-multi-field");
    expect((receiptBefore.integrations as Record<string, unknown>).conversations_channel).toBe("internal-iproj-multi-field");
    expect(receipt.after?.name).toBe("multi-field");
    expect(receipt.after?.slug).toBe("multi-field");
    expect((receipt.after?.integrations as Record<string, unknown>).conversations_channel).toBe("multi-field");
  });

  test("ignores stale project links on unrelated non-candidate channels", async () => {
    const candidate = project({
      id: "wks_candidate001",
      name: "iproj-candidate-lane",
      status: "active",
      integrations: {
        conversations_project_id: "wks_candidate001",
        conversations_channel: "iproj-candidate-lane",
      },
    });
    const harness = makeHarness(
      [candidate],
      [
        channel("iproj-candidate-lane", candidate.id),
        channel("agent-ea", "fa467316-ca8d-4627-a0b9-c76c3410daf7"),
      ],
    );

    const planned = await runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
    });

    expect(planned.ok).toBe(true);
    expect(planned.steps.map((step) => [step.target_kind, step.current_name, step.target_name])).toEqual([
      ["channel", "iproj-candidate-lane", "candidate-lane"],
      ["project", "iproj-candidate-lane", "candidate-lane"],
    ]);
  });

  test("resolves candidate channel project ids through the Conversations integration namespace", async () => {
    const conversationsProjectId = "4718abfb-8a86-422b-8994-a7cbf53311ea";
    const candidate = project({
      id: "wks_Shf9CvaMT6BC2p5jPWYvf",
      name: "iproj-cluj-glass-terrace",
      status: "active",
      integrations: {
        conversations_project_id: conversationsProjectId,
        conversations_space: conversationsProjectId,
        conversations_channel: "iproj-cluj-glass-terrace",
      },
    });
    const harness = makeHarness(
      [candidate],
      [channel("iproj-cluj-glass-terrace", conversationsProjectId)],
    );

    const planned = await runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
    });

    expect(planned.ok).toBe(true);
    expect(planned.steps).toEqual([
      expect.objectContaining({
        target_kind: "channel",
        project_id: candidate.id,
        current_name: "iproj-cluj-glass-terrace",
        target_name: "cluj-glass-terrace",
      }),
      expect.objectContaining({
        target_kind: "project",
        project_id: candidate.id,
        current_name: "iproj-cluj-glass-terrace",
        target_name: "cluj-glass-terrace",
      }),
    ]);
  });

  test("migrates an orphan-linked candidate channel as standalone while preserving its Conversations project id", async () => {
    const conversationsProjectId = "d2358f1a-ee0f-4d62-a7df-e20c1d5afc29";
    const harness = makeHarness(
      [],
      [channel("iproj-hooks-from-tools", conversationsProjectId)],
    );

    const planned = await runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
    });
    expect(planned.ok).toBe(true);
    expect(planned.steps).toEqual([
      expect.objectContaining({
        target_kind: "channel",
        project_id: null,
        current_name: "iproj-hooks-from-tools",
        target_name: "hooks-from-tools",
      }),
    ]);

    const applied = await runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
      dry_run: false,
      operation_id: planned.operation_id,
    });
    expect(applied.ok).toBe(true);
    expect(applied.steps[0]).toMatchObject({
      status: "accepted",
      project_id: null,
      receipt: expect.objectContaining({
        target_kind: "channel",
        outcome: "accepted",
        before: expect.objectContaining({ project_id: conversationsProjectId }),
        after: expect.objectContaining({ project_id: conversationsProjectId }),
      }),
    });
    expect(harness.channels.get("hooks-from-tools")?.project_id).toBe(conversationsProjectId);
    expect(harness.events).toHaveLength(0);
  });

  test("migrates a standalone candidate channel while preserving its null project link", async () => {
    const harness = makeHarness(
      [],
      [channel("iproj-accounting-books", null)],
    );

    const planned = await runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
    });

    expect(planned.ok).toBe(true);
    expect(planned.steps).toEqual([
      expect.objectContaining({
        target_kind: "channel",
        project_id: null,
        current_name: "iproj-accounting-books",
        target_name: "accounting-books",
      }),
    ]);

    const applied = await runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
      dry_run: false,
      operation_id: planned.operation_id,
    });

    expect(applied.ok).toBe(true);
    expect(applied.steps).toEqual([
      expect.objectContaining({
        target_kind: "channel",
        project_id: null,
        status: "accepted",
        receipt: expect.objectContaining({
          target_kind: "channel",
          outcome: "accepted",
        }),
      }),
    ]);
    expect([...harness.channels.keys()]).toEqual(["accounting-books"]);
    expect(harness.events).toHaveLength(0);
  });

  test("refuses candidate channel links shared by multiple Projects records", async () => {
    const conversationsProjectId = "conversations-shared-project";
    const first = project({
      id: "wks_sharedfirst1",
      name: "first-project",
      status: "active",
      integrations: { conversations_project_id: conversationsProjectId },
    });
    const second = project({
      id: "wks_sharedsecond",
      name: "second-project",
      status: "active",
      integrations: { conversations_project_id: conversationsProjectId },
    });
    const harness = makeHarness(
      [first, second],
      [channel("iproj-shared-lane", conversationsProjectId)],
    );

    await expect(runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
    })).rejects.toThrow(/shared by 2 Projects records/);
  });

  test("refuses explicit candidate channel ownership mismatches in the Conversations namespace", async () => {
    const explicitOwner = project({
      id: "wks_explicit001",
      name: "iproj-explicit-owner",
      status: "active",
      integrations: {
        conversations_project_id: "conversations-explicit-owner",
        conversations_channel: "iproj-explicit-lane",
      },
    });
    const channelOwner = project({
      id: "wks_channelowner",
      name: "channel-owner",
      status: "active",
      integrations: { conversations_project_id: "conversations-channel-owner" },
    });
    const harness = makeHarness(
      [explicitOwner, channelOwner],
      [channel("iproj-explicit-lane", "conversations-channel-owner")],
    );

    await expect(runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
    })).rejects.toThrow(/project wks_explicit001 links channel "iproj-explicit-lane" owned by conversations-channel-owner/);
  });

  test("failure injection rolls back channel first and leaves project/history state intact", async () => {
    const source = project({
      id: "wks_failure0001",
      name: "iproj-failure-lane",
      status: "active",
      integrations: {
        conversations_project_id: "wks_failure0001",
        conversations_channel: "iproj-failure-lane",
      },
    });
    const harness = makeHarness([source], [channel("iproj-failure-lane", source.id)]);
    const result = await runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
      dry_run: false,
      operation_id: "failure-operation",
      fail_step_id: "step-0002",
    });
    expect(result.ok).toBe(false);
    expect(result.rollback.attempted).toBe(true);
    expect(result.rollback.complete).toBe(true);
    expect(result.steps.find((step) => step.step_id === "step-0002")?.status).toBe("terminal_nonacceptance");
    expect(result.steps.find((step) => step.step_id === "step-0002")?.receipt).not.toBeNull();
    expect(harness.projects.get(source.id)!.name).toBe("iproj-failure-lane");
    expect([...harness.channels.keys()]).toEqual(["iproj-failure-lane"]);
  });

  test("rolls back the complete multi-field project update when marker regeneration fails", async () => {
    const source = project({
      id: "wks_markerfail0001",
      slug: "internal-iproj-marker-lane",
      name: "iproj-marker-lane",
      status: "active",
      integrations: { conversations_channel: "iproj-marker-channel" },
    });
    const harness = makeHarness([source], [channel("iproj-marker-channel", null)]);
    let markerCalls = 0;
    const result = await runProjectPrefixMigration({
      store: harness.store,
      conversations: harness.conversations,
      write_marker: (updated) => {
        markerCalls++;
        if (markerCalls === 1) {
          expect(updated.name).toBe("marker-lane");
          expect(updated.slug).toBe("marker-lane");
          expect(updated.integrations.conversations_channel).toBe("marker-channel");
          throw new Error("marker write failed");
        }
        return { type: "workspace_marker", target: "/tmp/restored/.project.json", status: "completed" as const };
      },
      dry_run: false,
      operation_id: "marker-failure-operation",
    });
    expect(result.ok).toBe(false);
    expect(result.rollback.complete).toBe(true);
    expect(harness.projects.get(source.id)?.name).toBe("iproj-marker-lane");
    expect(harness.projects.get(source.id)?.slug).toBe("internal-iproj-marker-lane");
    expect(harness.projects.get(source.id)?.integrations.conversations_channel).toBe("iproj-marker-channel");
    expect(harness.rollbackCalls).toBe(1);
    expect(result.rollback.receipts).toHaveLength(2);
    const projectRollback = result.rollback.receipts.find(
      (receipt): receipt is GuardedProjectMutationReceipt => "result_project_id" in receipt,
    );
    expect(projectRollback?.direction).toBe("inverse");
    expect(projectRollback?.outcome).toBe("accepted");
    expect(projectRollback?.before).not.toBeNull();
    const rollbackBefore = projectRollback!.before!;
    expect(rollbackBefore.name).toBe("marker-lane");
    expect(rollbackBefore.slug).toBe("marker-lane");
    expect((rollbackBefore.integrations as Record<string, unknown>).conversations_channel).toBe("marker-channel");
    expect(projectRollback?.after?.name).toBe("iproj-marker-lane");
    expect(projectRollback?.after?.slug).toBe("internal-iproj-marker-lane");
    expect((projectRollback?.after?.integrations as Record<string, unknown>).conversations_channel).toBe("iproj-marker-channel");
    expect(result.steps.find((step) => step.target_kind === "project")).toMatchObject({ status: "rolled_back" });
  });

  test("rolls back a channel rename when post-rename readback fails", async () => {
    const source = project({
      id: "wks_channelfail0001",
      name: "plain-project",
      status: "active",
      integrations: { conversations_project_id: "wks_channelfail0001" },
    });
    const harness = makeHarness([source], [channel("iproj-channel-lane", source.id)]);
    let renameCalls = 0;
    const conversations: ConversationsPrefixPort = {
      listChannels: harness.conversations.listChannels,
      async renameChannel(input) {
        const renamed = await harness.conversations.renameChannel(input);
        renameCalls++;
        if (renameCalls === 1) throw new Error("channel readback failed");
        return renamed;
      },
    };
    const result = await runProjectPrefixMigration({
      store: harness.store,
      conversations,
      dry_run: false,
      operation_id: "channel-failure-operation",
    });
    expect(result.ok).toBe(false);
    expect(result.rollback.complete).toBe(true);
    expect([...harness.channels.keys()]).toEqual(["iproj-channel-lane"]);
    expect(renameCalls).toBe(2);
    expect(result.rollback.receipts).toHaveLength(1);
    expect(result.rollback.receipts[0]).toMatchObject({ direction: "inverse", outcome: "accepted" });
    expect(result.steps[0]).toMatchObject({ status: "rolled_back" });
  });

  test("installed Conversations CLI adapter requires complete paged inventory and verifies rename preservation", async () => {
    const rows = new Map([
      ["iproj-cli-lane", channel("iproj-cli-lane", "wks_cli0000001")],
      ["plain-cli-lane", channel("plain-cli-lane", null)],
    ]);
    const runner = (args: string[]) => {
      if (args[0] === "channel" && args[1] === "list") {
        const cursor = Number(args[args.indexOf("--cursor") + 1]);
        const limit = Number(args[args.indexOf("--limit") + 1]);
        const all = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
        const page = all.slice(cursor, cursor + limit);
        return {
          ok: true,
          stdout: JSON.stringify(page),
          stderr: `Showing ${page.length} of ${all.length}.${cursor + page.length < all.length ? " More available: rerun with --cursor " + (cursor + page.length) + "." : ""}`,
        };
      }
      if (args[0] === "channel" && args[1] === "rename") {
        const current = rows.get(args[2]!);
        rows.delete(args[2]!);
        rows.set(args[3]!, { ...current!, name: args[3]! });
        return { ok: true, stdout: JSON.stringify({ name: args[3]! }), stderr: "" };
      }
      return { ok: false, stdout: "", stderr: "unsupported" };
    };
    const port = createConversationsPrefixPort(runner);
    const inventory = await port.listChannels();
    expect(inventory.complete).toBe(true);
    expect(inventory.total).toBe(2);
    const renamed = await port.renameChannel({
      current_name: "iproj-cli-lane",
      target_name: "cli-lane",
      on_written: () => undefined,
    });
    expect(renamed.name).toBe("cli-lane");
    expect(renamed.member_count).toBe(3);
    expect(renamed.message_count).toBe(7);
  });

  test("accepts a message count increase during rename readback", async () => {
    const rows = new Map([
      ["iproj-count-increase", channel("iproj-count-increase", "wks_count000001")],
    ]);
    rows.set("iproj-count-increase", { ...rows.get("iproj-count-increase")!, message_count: 0 });
    const runner = (args: string[]) => {
      if (args[0] === "channel" && args[1] === "list") {
        const cursor = Number(args[args.indexOf("--cursor") + 1]);
        const limit = Number(args[args.indexOf("--limit") + 1]);
        const all = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
        const page = all.slice(cursor, cursor + limit);
        return {
          ok: true,
          stdout: JSON.stringify(page),
          stderr: `Showing ${page.length} of ${all.length}.`,
        };
      }
      if (args[0] === "channel" && args[1] === "rename") {
        const current = rows.get(args[2]!);
        rows.delete(args[2]!);
        rows.set(args[3]!, { ...current!, name: args[3]!, message_count: 11 });
        return { ok: true, stdout: JSON.stringify({ name: args[3]! }), stderr: "" };
      }
      return { ok: false, stdout: "", stderr: "unsupported" };
    };

    const renamed = await createConversationsPrefixPort(runner).renameChannel({
      current_name: "iproj-count-increase",
      target_name: "count-increase",
      on_written: () => undefined,
    });

    expect(renamed.message_count).toBe(11);
  });

  test("rejects a message count decrease during rename readback", async () => {
    const rows = new Map([
      ["iproj-count-decrease", { ...channel("iproj-count-decrease", "wks_count000002"), message_count: 11 }],
    ]);
    const runner = (args: string[]) => {
      if (args[0] === "channel" && args[1] === "list") {
        const cursor = Number(args[args.indexOf("--cursor") + 1]);
        const limit = Number(args[args.indexOf("--limit") + 1]);
        const all = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
        const page = all.slice(cursor, cursor + limit);
        return {
          ok: true,
          stdout: JSON.stringify(page),
          stderr: `Showing ${page.length} of ${all.length}.`,
        };
      }
      if (args[0] === "channel" && args[1] === "rename") {
        const current = rows.get(args[2]!);
        rows.delete(args[2]!);
        rows.set(args[3]!, { ...current!, name: args[3]!, message_count: 10 });
        return { ok: true, stdout: JSON.stringify({ name: args[3]! }), stderr: "" };
      }
      return { ok: false, stdout: "", stderr: "unsupported" };
    };

    await expect(createConversationsPrefixPort(runner).renameChannel({
      current_name: "iproj-count-decrease",
      target_name: "count-decrease",
      on_written: () => undefined,
    })).rejects.toThrow(/decreased member\/message counts/);
  });

  test("accepts a stable producer collation that is not JavaScript lexical order", async () => {
    const producerOrder = [
      ...Array.from({ length: 999 }, (_, index) => channel(`channel-${String(index).padStart(4, "0")}`, null)),
      channel("zeta", null),
      channel("Alpha", null),
    ];
    expect(producerOrder[999]!.name > producerOrder[1_000]!.name).toBe(true);
    let traversals = 0;
    const runner = (args: string[]) => {
      if (args[0] !== "channel" || args[1] !== "list") {
        return { ok: false, stdout: "", stderr: "unsupported" };
      }
      const cursor = Number(args[args.indexOf("--cursor") + 1]);
      const limit = Number(args[args.indexOf("--limit") + 1]);
      if (cursor === 0) traversals++;
      const page = producerOrder.slice(cursor, cursor + limit);
      return {
        ok: true,
        stdout: JSON.stringify(page),
        stderr: `Showing ${page.length} of ${producerOrder.length}.`,
      };
    };

    const inventory = await createConversationsPrefixPort(runner).listChannels();
    expect(inventory.channels.map((item) => item.name)).toEqual(producerOrder.map((item) => item.name));
    expect(inventory.complete).toBe(true);
    expect(traversals).toBe(2);
  });

  const firstSnapshot = Array.from(
    { length: 1_001 },
    (_, index) => channel(`channel-${String(index).padStart(4, "0")}`, null),
  );
  test.each([
    {
      label: "sequence reorder",
      second: [
        ...firstSnapshot.slice(0, 999),
        firstSnapshot[1_000]!,
        firstSnapshot[999]!,
      ],
    },
    {
      label: "population replacement",
      second: [
        ...firstSnapshot.slice(0, 1_000),
        channel("replacement-channel", null),
      ],
    },
  ])("refuses a $label between complete channel traversals", async ({ second }) => {
    const snapshots = [
      firstSnapshot,
      second,
    ];
    let traversal = -1;
    const runner = (args: string[]) => {
      if (args[0] !== "channel" || args[1] !== "list") {
        return { ok: false, stdout: "", stderr: "unsupported" };
      }
      const cursor = Number(args[args.indexOf("--cursor") + 1]);
      const limit = Number(args[args.indexOf("--limit") + 1]);
      if (cursor === 0) traversal++;
      const rows = snapshots[Math.min(traversal, snapshots.length - 1)]!;
      const page = rows.slice(cursor, cursor + limit);
      return {
        ok: true,
        stdout: JSON.stringify(page),
        stderr: `Showing ${page.length} of ${rows.length}.`,
      };
    };

    await expect(createConversationsPrefixPort(runner).listChannels())
      .rejects.toThrow(/changed between complete traversals/);
  });
});
