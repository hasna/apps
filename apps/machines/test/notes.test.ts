import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb } from "../src/db.js";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { discoverMachineTopology } from "../src/topology.js";
import {
  listMachineTrashPolicies,
  resolveNoteMachineContext,
} from "../src/notes.js";
import { validateMachinesConsumerEnvelope } from "../src/consumer-schema.js";

const ENV_KEYS = [
  "HASNA_MACHINES_DB_PATH",
  "HASNA_MACHINES_MANIFEST_PATH",
  "HASNA_MACHINES_MACHINE_ID",
] as const;

afterEach(() => {
  closeDb();
  for (const key of ENV_KEYS) delete process.env[key];
});

function setupTemp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), name));
  process.env.HASNA_MACHINES_DB_PATH = join(dir, "machines.db");
  process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
  process.env.HASNA_MACHINES_MACHINE_ID = "notes-node-00";
  manifestInit();
  return dir;
}

describe("Hasna Notes machine contract", () => {
  test("resolves note origin, source, target, sync targets, and agent provenance display names", () => {
    const dir = setupTemp("machines-notes-context-");
    try {
      manifestAdd({
        id: "notes-node-00",
        friendlyName: "Desk Mac",
        platform: "macos",
        workspacePath: "/Users/hasna/Workspace",
        updatedAt: "2026-06-20T00:00:00.000Z",
      });
      manifestAdd({
        id: "agent-node-01",
        friendlyName: "Agent Box",
        platform: "linux",
        workspacePath: "/srv/workspace",
        updatedAt: "2026-06-21T00:00:00.000Z",
      });
      manifestAdd({
        id: "sync-node-02",
        platform: "linux",
        workspacePath: "/sync/workspace",
        updatedAt: "2026-06-22T00:00:00.000Z",
      });

      const topology = discoverMachineTopology({ includeTailscale: false, now: new Date("2026-06-23T00:00:00.000Z"), limit: null });
      const context = resolveNoteMachineContext({
        topology,
        now: new Date("2026-06-23T01:00:00.000Z"),
        originMachineId: "notes-node-00",
        sourceMachineId: "agent-node-01",
        targetMachineId: "sync-node-02",
        syncTargetMachineIds: ["sync-node-02", "missing-node"],
        actor: {
          actor_type: "agent",
          agent_id: "notes-agent",
          agent_name: "Notes Agent",
          source: "agent",
        },
      });

      expect(context.origin_machine).toMatchObject({
        machine_id: "notes-node-00",
        friendly_name: "Desk Mac",
        display_name: "Desk Mac",
        role: "origin",
        known: true,
      });
      expect(context.source_machine).toMatchObject({
        machine_id: "agent-node-01",
        display_name: "Agent Box",
        role: "source",
      });
      expect(context.target_machine).toMatchObject({
        machine_id: "sync-node-02",
        friendly_name: null,
        display_name: "sync-node-02",
        role: "target",
      });
      expect(context.sync_target_machine_ids).toEqual(["sync-node-02", "missing-node"]);
      expect(context.sync_targets[1].machine).toMatchObject({
        machine_id: "missing-node",
        display_name: "missing-node",
        known: false,
        role: "sync_target",
      });
      expect(context.actor).toMatchObject({
        actor_type: "agent",
        actor_id: "notes-agent",
        actor_name: "Notes Agent",
        agent_id: "notes-agent",
        agent_name: "Notes Agent",
        source: "agent",
        display_name: "Notes Agent",
      });
      expect(context.warnings).toContain("unknown_machine:sync_target:missing-node");
      expect(validateMachinesConsumerEnvelope("note_machine_context", context)).toMatchObject({ ok: true, errors: [] });

      const invalidActor = resolveNoteMachineContext({
        topology,
        originMachineId: "notes-node-00",
        actor: {
          actor_type: "robot" as never,
          source: "bananas" as never,
        },
      });
      expect(invalidActor.actor).toMatchObject({
        actor_type: "unknown",
        source: "unknown",
        display_name: "unknown",
      });
      expect(validateMachinesConsumerEnvelope("note_machine_context", invalidActor)).toMatchObject({ ok: true, errors: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("expands paginated topology for explicit note machine ids", () => {
    const dir = setupTemp("machines-notes-context-pagination-");
    try {
      for (let index = 0; index < 12; index += 1) {
        const id = `notes-node-${String(index).padStart(2, "0")}`;
        manifestAdd({
          id,
          friendlyName: index === 0 ? "Old Origin" : undefined,
          platform: "linux",
          workspacePath: `/workspace/${id}`,
          updatedAt: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        });
      }

      const firstPageTopology = discoverMachineTopology({ includeTailscale: false });
      expect(firstPageTopology.pagination).toMatchObject({ limit: 10, total: 12, hasMore: true });
      expect(firstPageTopology.machines.some((machine) => machine.machine_id === "notes-node-00")).toBe(false);

      const context = resolveNoteMachineContext({
        topology: firstPageTopology,
        originMachineId: "notes-node-00",
      });

      expect(context.origin_machine).toMatchObject({
        machine_id: "notes-node-00",
        friendly_name: "Old Origin",
        display_name: "Old Origin",
        known: true,
      });
      expect(context.warnings).toContain("paginated_topology_expanded_for_note_context");
      expect(context.warnings).not.toContain("unknown_machine:origin:notes-node-00");
      expect(validateMachinesConsumerEnvelope("note_machine_context", context)).toMatchObject({ ok: true, errors: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("lists per-machine trash policies with metadata and latest-10 pagination", () => {
    const dir = setupTemp("machines-notes-trash-");
    try {
      for (let index = 0; index < 12; index += 1) {
        const id = `notes-node-${String(index).padStart(2, "0")}`;
        manifestAdd({
          id,
          friendlyName: index === 11 ? "Archive Node" : undefined,
          platform: "linux",
          workspacePath: `/workspace/${id}`,
          updatedAt: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
          metadata: index === 11
            ? {
                notesTrash: {
                  enabled: true,
                  retentionDays: 45,
                  deleteAfterDays: 90,
                  trashPath: "/notes/.trash",
                  api_key: "should-not-appear",
                  secretToken: "should-not-appear",
                },
              }
            : undefined,
        });
      }

      const policies = listMachineTrashPolicies({
        now: new Date("2026-06-23T00:00:00.000Z"),
      });

      expect(policies.pagination).toMatchObject({
        limit: 10,
        offset: 0,
        total: 12,
        count: 10,
        hasMore: true,
        nextOffset: 10,
      });
      expect(policies.policies[0]).toMatchObject({
        machine_id: "notes-node-11",
        friendly_name: "Archive Node",
        display_name: "Archive Node",
        enabled: true,
        retention_days: 45,
        delete_after_days: 90,
        trash_path: "/notes/.trash",
        source: "manifest_metadata",
      });
      expect(policies.policies[0].metadata_keys).toEqual(["deleteAfterDays", "enabled", "retentionDays", "trashPath"]);
      expect(policies.policies[1]).toMatchObject({
        machine_id: "notes-node-10",
        display_name: "notes-node-10",
        enabled: null,
        retention_days: null,
        delete_after_days: null,
        source: "default",
      });
      expect(validateMachinesConsumerEnvelope("machine_trash_policies", policies)).toMatchObject({ ok: true, errors: [] });

      const firstMachine = listMachineTrashPolicies({ machineId: "notes-node-00" });
      expect(firstMachine.pagination).toMatchObject({
        limit: 1,
        offset: 0,
        total: 1,
        count: 1,
        hasMore: false,
      });
      expect(firstMachine.policies[0]).toMatchObject({
        machine_id: "notes-node-00",
        display_name: "notes-node-00",
      });

      const firstPageTopology = discoverMachineTopology({ includeTailscale: false });
      const firstMachineFromPage = listMachineTrashPolicies({
        topology: firstPageTopology,
        machineId: "notes-node-00",
      });
      expect(firstMachineFromPage.policies[0]).toMatchObject({
        machine_id: "notes-node-00",
        display_name: "notes-node-00",
      });
      expect(firstMachineFromPage.warnings).toContain("paginated_topology_expanded_for_trash_policy");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
