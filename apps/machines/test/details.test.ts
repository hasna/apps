import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, recordSyncRun, upsertHeartbeat } from "../src/db.js";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { getMachineDetails } from "../src/details.js";
import { discoverMachineTopology } from "../src/topology.js";
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
  process.env.HASNA_MACHINES_MACHINE_ID = "details-node";
  manifestInit();
  return dir;
}

describe("machine details consumer contract", () => {
  test("builds consumer-safe details with friendly names, status, metadata, and sync timestamps", () => {
    const dir = setupTemp("machines-details-");
    try {
      manifestAdd({
        id: "details-node",
        friendlyName: "Studio Laptop",
        platform: "macos",
        workspacePath: "/Users/hasna/Workspace",
        tags: ["notes", "primary"],
        updatedAt: "2026-06-20T00:00:00.000Z",
        metadata: {
          machine_type: "laptop",
          role: "primary",
          capabilities: { notes: true, sync: true, api_key: true },
          environment: "personal",
          region: "100.64.0.7",
          location: "node.private.internal",
          team: ["notes", "10.0.0.7", "node.local"],
          owner: "Hasna",
          profile: "postgres://user:pass@10.0.0.1/db",
          api_key: "should-not-appear",
          secretToken: "should-not-appear",
          internal_path: "/Users/hasna/private",
        },
      });
      upsertHeartbeat("details-node", 100, "online", {
        agentMode: "daemon",
        storageSyncStatus: "ok",
        storageSyncLastError: "postgres://user:pass@10.0.0.1/machines",
      });
      recordSyncRun("details-node", "completed", { count: 1 });

      const details = getMachineDetails("details-node", { now: new Date("2026-06-23T00:00:00.000Z") });

      expect(details).toMatchObject({
        schema_version: 1,
        machine_id: "details-node",
        slug: "details-node",
        friendly_name: "Studio Laptop",
        friendlyName: "Studio Laptop",
        display_name: "Studio Laptop",
        displayName: "Studio Laptop",
        known: true,
        platform: "macos",
        machine_type: "laptop",
        role: "primary",
        machine_capabilities: ["notes", "sync"],
        status: {
          state: "online",
          label: "Online",
          online: true,
        },
        source: {
          authority: "open-machines",
          metadata_source: "manifest_metadata",
          manifest_declared: true,
          heartbeat_present: true,
          topology_entry: true,
          local: true,
        },
      });
      expect(details.timestamps.storage_sync_status).toBe("ok");
      expect(details.timestamps.recent_sync_status).toBe("completed");
      expect(details.timestamps.recent_sync_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(details.display_metadata).toMatchObject({
        machine_type: "laptop",
        role: "primary",
        environment: "personal",
        team: ["notes"],
        owner: "Hasna",
      });
      expect(JSON.stringify(details)).not.toContain("should-not-appear");
      expect(JSON.stringify(details)).not.toContain("postgres://user:pass");
      expect(JSON.stringify(details)).not.toContain("100.64.0.7");
      expect(JSON.stringify(details)).not.toContain("10.0.0.7");
      expect(JSON.stringify(details)).not.toContain("node.private.internal");
      expect(JSON.stringify(details)).not.toContain("node.local");
      expect(JSON.stringify(details)).not.toContain("internal_path");
      expect(validateMachinesConsumerEnvelope("machine_details", details)).toMatchObject({ ok: true, errors: [] });
      expect(validateMachinesConsumerEnvelope("machine_details", {
        ...details,
        display_metadata: { owner: { nested: "not allowed" } },
      })).toMatchObject({ ok: false, errors: ["display_metadata"] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("normalizes status from saved topology and uses Tailscale online state when heartbeat is unknown", () => {
    const dir = setupTemp("machines-details-status-");
    try {
      const topology = discoverMachineTopology({ includeTailscale: false });
      const machine = topology.machines.find((entry) => entry.machine_id === "details-node");
      expect(machine).toBeDefined();
      const staleTopology = {
        ...topology,
        machines: [{
          ...machine!,
          heartbeat_status: "stale" as never,
          tailscale: { ...machine!.tailscale, online: null },
        }],
      };
      const stale = getMachineDetails("details-node", { topology: staleTopology });
      expect(stale.status).toMatchObject({
        state: "unknown",
        label: "Unknown",
        online: null,
      });
      expect(validateMachinesConsumerEnvelope("machine_details", stale)).toMatchObject({ ok: true, errors: [] });

      const tailscaleTopology = {
        ...topology,
        machines: [{
          ...machine!,
          heartbeat_status: "unknown" as const,
          tailscale: { ...machine!.tailscale, online: true },
        }],
      };
      const online = getMachineDetails("details-node", { topology: tailscaleTopology });
      expect(online.status).toMatchObject({
        state: "online",
        label: "Online",
        online: true,
      });
      expect(validateMachinesConsumerEnvelope("machine_details", online)).toMatchObject({ ok: true, errors: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("uses neutral fallback details for unknown machines and expands paginated topology", () => {
    const dir = setupTemp("machines-details-fallback-");
    try {
      for (let index = 0; index < 12; index += 1) {
        const id = `details-node-${String(index).padStart(2, "0")}`;
        manifestAdd({
          id,
          friendlyName: index === 0 ? "Older Details Node" : undefined,
          platform: "linux",
          workspacePath: `/workspace/${id}`,
          updatedAt: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        });
      }

      const firstPage = discoverMachineTopology({ includeTailscale: false });
      expect(firstPage.machines.some((machine) => machine.machine_id === "details-node-00")).toBe(false);
      const older = getMachineDetails("details-node-00", { topology: firstPage });
      expect(older).toMatchObject({
        machine_id: "details-node-00",
        display_name: "Older Details Node",
        known: true,
      });
      expect(older.warnings).toContain("paginated_topology_expanded_for_machine_details");

      const missing = getMachineDetails("missing-node", { topology: firstPage });
      expect(missing).toMatchObject({
        machine_id: "missing-node",
        slug: "missing-node",
        display_name: "missing-node",
        displayName: "missing-node",
        known: false,
        status: {
          state: "unknown",
          label: "Unknown",
          online: null,
        },
        source: {
          metadata_source: "fallback",
          manifest_declared: false,
          heartbeat_present: false,
          topology_entry: false,
        },
      });
      expect(missing).not.toHaveProperty("friendly_name");
      expect(missing.warnings).toContain("unknown_machine:details:missing-node");
      expect(validateMachinesConsumerEnvelope("machine_details", missing)).toMatchObject({ ok: true, errors: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
