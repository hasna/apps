import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb, upsertHeartbeat } from "../src/db.js";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import {
  discoverMachineTopology,
  getLocalMachineTopology,
  resolveMachineRoute,
  resolveMachineWorkspace,
  type TopologyCommandRunner,
} from "../src/topology.js";

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
  process.env.HASNA_MACHINES_MACHINE_ID = "demo-node-02";
  manifestInit();
  return dir;
}

function fakeRunner(statusJson: unknown): TopologyCommandRunner {
  return (command) => {
    if (command.startsWith("command -v tailscale")) {
      return { stdout: "/usr/bin/tailscale\n", stderr: "", exitCode: 0 };
    }
    if (command === "tailscale status --json") {
      return { stdout: JSON.stringify(statusJson), stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: "unexpected command", exitCode: 1 };
  };
}

describe("machine topology SDK", () => {
  test("merges manifest machines, heartbeats, and tailscale peers", () => {
    const dir = setupTemp("machines-topology-");
    try {
      manifestAdd({
        id: "demo-node-01",
        hostname: "demo-node-01.local",
        sshAddress: "operator@demo-node-01.local",
        tailscaleName: "demo-node-01.tailnet.ts.net",
        platform: "linux",
        workspacePath: "/home/operator/workspace",
        tags: ["server"],
      });
      upsertHeartbeat("demo-node-02", 123, "online");

      const topology = discoverMachineTopology({
        now: new Date("2026-06-09T00:00:00.000Z"),
        runner: fakeRunner({
          Self: {
            HostName: "demo-node-02",
            DNSName: "demo-node-02.tailnet.ts.net.",
            OS: "linux",
            TailscaleIPs: ["203.0.113.92"],
            Online: true,
            Active: false,
          },
          Peer: {
            "nodekey:abc": {
              HostName: "demo-node-01",
              DNSName: "demo-node-01.tailnet.ts.net.",
              OS: "linux",
              TailscaleIPs: ["203.0.113.34"],
              Online: true,
              Active: true,
            },
          },
        }),
      });

      expect(topology.schema_version).toBe(1);
      expect(topology.package.name).toBe("@hasna/machines");
      expect(topology.capabilities.route_resolution).toBe(true);
      expect(topology.local_machine_id).toBe("demo-node-02");
      expect(topology.machines.map((machine) => machine.machine_id)).toContain("demo-node-01");
      expect(topology.machines.map((machine) => machine.machine_id)).toContain("demo-node-02");

      const demoNode01 = topology.machines.find((machine) => machine.machine_id === "demo-node-01");
      expect(demoNode01?.manifest_declared).toBe(true);
      expect(demoNode01?.friendly_name).toBe(null);
      expect(demoNode01?.display_name).toBe("demo-node-01");
      expect(demoNode01?.updated_at).toBeDefined();
      expect(demoNode01?.tailscale.ips).toEqual(["203.0.113.34"]);
      expect(demoNode01?.ssh.route).toBe("tailscale");
      expect(demoNode01?.ssh.command_target).toBe("operator@demo-node-01.tailnet.ts.net");
      expect(demoNode01?.route_hints.some((hint) => hint.kind === "tailscale")).toBe(true);

      const route = resolveMachineRoute("demo-node-01", { topology, now: new Date("2026-06-09T00:00:00.000Z") });
      expect(route.ok).toBe(true);
      expect(route.route).toBe("tailscale");
      expect(route.target).toBe("demo-node-01.tailnet.ts.net");
      expect(route.command_target).toBe("operator@demo-node-01.tailnet.ts.net");
      expect(route.confidence).toBe("high");

      const demoNode02 = topology.machines.find((machine) => machine.machine_id === "demo-node-02");
      expect(demoNode02?.heartbeat_status).toBe("online");
      expect(demoNode02?.agent.pid).toBe(123);
      expect(demoNode02?.agent.private_metadata).toBe(false);

      const workspace = resolveMachineWorkspace({
        machineId: "demo-node-01",
        projectId: "open-knowledge",
        repoName: "open-knowledge",
        topology,
        now: new Date("2026-06-09T00:00:00.000Z"),
      });
      expect(workspace.ok).toBe(true);
      expect(workspace.machine_id).toBe("demo-node-01");
      expect(workspace.paths.project_root.path).toBe("/home/operator/workspace/hasna/opensource/open-knowledge");
      expect(workspace.paths.project_root.source).toBe("inferred");
      expect(workspace.paths.open_files_root.path).toBe("/home/operator/workspace/hasna/opensource/open-files");
      expect(workspace.machine.trust_status).toBe("unknown");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resolves a legacy manifest alias to the canonical topology route", () => {
    const dir = setupTemp("machines-topology-machine-alias-");
    try {
      manifestAdd({
        id: "station03",
        friendlyName: "station03",
        aliases: ["apple03"],
        hostname: "station03.local",
        sshAddress: "operator@station03.local",
        tailscaleName: "station03.tailnet.ts.net",
        platform: "linux",
        workspacePath: "/home/operator/workspace",
      });

      const topology = discoverMachineTopology({
        now: new Date("2026-06-09T00:00:00.000Z"),
        runner: fakeRunner({
          Self: { HostName: "demo-node-02", DNSName: "demo-node-02.tailnet.ts.net.", OS: "linux", Online: true },
          Peer: {
            "nodekey:station03": {
              HostName: "station03",
              DNSName: "station03.tailnet.ts.net.",
              OS: "linux",
              TailscaleIPs: ["203.0.113.53"],
              Online: true,
              Active: true,
            },
          },
        }),
      });

      const canonical = topology.machines.find((machine) => machine.machine_id === "station03");
      expect(canonical?.aliases).toEqual(["apple03"]);

      const route = resolveMachineRoute("apple03", { topology, now: new Date("2026-06-09T00:00:00.000Z") });
      expect(route.ok).toBe(true);
      expect(route.machine_id).toBe("station03");
      expect(route.evidence.matched_by).toBe("alias");
      expect(route.target).toBe("station03.tailnet.ts.net");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resolves project paths from manifest metadata without exposing secrets", () => {
    const dir = setupTemp("machines-workspace-paths-");
    try {
      manifestAdd({
        id: "demo-node-01",
        hostname: "demo-node-01",
        platform: "linux",
        workspacePath: "/home/operator/workspace",
        tags: ["trusted"],
        metadata: {
          workspace_paths: {
            "open-knowledge": {
              path: "/mnt/projects/open-knowledge",
            },
          },
          open_files_roots: {
            "open-knowledge": "/mnt/files/open-files",
          },
          primary_projects: ["open-knowledge"],
          auth_status: "authenticated",
          api_token: "should-not-appear",
          githubAppPrivateKey: "synthetic-private-key-material",
          screenPasswordSecret: "machines/screen-sharing/demo-node-01-vnc-password",
        },
      });

      const topology = discoverMachineTopology({
        now: new Date("2026-06-09T00:00:00.000Z"),
        includeTailscale: false,
      });
      expect(JSON.stringify(topology)).not.toContain("should-not-appear");
      expect(JSON.stringify(topology)).not.toContain("private-material");
      expect(JSON.stringify(topology)).not.toContain("screen-sharing");
      const resolved = resolveMachineWorkspace({
        machineId: "demo-node-01",
        projectId: "open-knowledge",
        repoName: "open-knowledge",
        topology,
        now: new Date("2026-06-09T00:00:00.000Z"),
      });

      expect(resolved.ok).toBe(true);
      expect(resolved.project.project_id).toBe("open-knowledge");
      expect(resolved.machine.primary).toBe(true);
      expect(resolved.machine.trust_status).toBe("trusted");
      expect(resolved.machine.auth_status).toBe("authenticated");
      expect(resolved.paths.project_root).toEqual({
        path: "/mnt/projects/open-knowledge",
        source: "manifest_metadata",
      });
      expect(resolved.paths.open_files_root).toEqual({
        path: "/mnt/files/open-files",
        source: "manifest_metadata",
      });
      expect(resolved.evidence.metadata_keys).toContain("workspace_paths");
      expect(resolved.evidence.metadata_keys).not.toContain("api_token");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("can skip tailscale probing and still report local topology", () => {
    const dir = setupTemp("machines-topology-local-");
    try {
      const local = getLocalMachineTopology({ includeTailscale: false });
      expect(local.machine_id).toBe("demo-node-02");
      expect(local.route_hints.some((hint) => hint.kind === "local")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("marks stale online heartbeats offline in topology", () => {
    const dir = setupTemp("machines-topology-stale-heartbeat-");
    try {
      upsertHeartbeat("demo-node-02", 123, "online");
      getDb().query("UPDATE agent_heartbeats SET updated_at = ?, observed_at = ? WHERE machine_id = ? AND pid = ?")
        .run("2026-06-09T00:00:00.000Z", "2026-06-09T00:00:00.000Z", "demo-node-02", 123);

      const topology = discoverMachineTopology({
        now: new Date("2026-06-09T00:03:00.000Z"),
        includeTailscale: false,
      });

      const local = topology.machines.find((machine) => machine.machine_id === "demo-node-02");
      expect(local?.heartbeat_status).toBe("offline");
      expect(local?.last_heartbeat_at).toBe("2026-06-09T00:00:00.000Z");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns latest 10 machines by default with display-name fallback and view-more metadata", () => {
    const dir = setupTemp("machines-topology-pagination-");
    try {
      for (let index = 0; index < 12; index += 1) {
        const id = `demo-node-${String(index).padStart(2, "0")}`;
        manifestAdd({
          id,
          friendlyName: index === 11 ? "Studio Linux" : undefined,
          platform: "linux",
          workspacePath: `/workspace/${id}`,
          updatedAt: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        });
      }

      const firstPage = discoverMachineTopology({
        includeTailscale: false,
        now: new Date("2026-06-20T00:00:00.000Z"),
      });
      expect(firstPage.pagination).toMatchObject({
        limit: 10,
        offset: 0,
        total: 12,
        count: 10,
        hasMore: true,
        has_more: true,
        nextOffset: 10,
        next_offset: 10,
        order: "updated_at_desc",
      });
      expect(firstPage.machines.map((machine) => machine.machine_id)).toEqual([
        "demo-node-11",
        "demo-node-10",
        "demo-node-09",
        "demo-node-08",
        "demo-node-07",
        "demo-node-06",
        "demo-node-05",
        "demo-node-04",
        "demo-node-03",
        "demo-node-02",
      ]);
      expect(firstPage.machines[0]).toMatchObject({
        machine_id: "demo-node-11",
        friendly_name: "Studio Linux",
        display_name: "Studio Linux",
        updated_at: "2026-06-12T00:00:00.000Z",
      });
      expect(firstPage.machines[1]).toMatchObject({
        machine_id: "demo-node-10",
        friendly_name: null,
        display_name: "demo-node-10",
      });

      const secondPage = discoverMachineTopology({
        includeTailscale: false,
        offset: firstPage.pagination.nextOffset ?? 0,
      });
      expect(secondPage.pagination).toMatchObject({
        limit: 10,
        offset: 10,
        total: 12,
        count: 2,
        hasMore: false,
        nextOffset: null,
      });
      expect(secondPage.machines.map((machine) => machine.machine_id)).toEqual(["demo-node-01", "demo-node-00"]);

      const full = discoverMachineTopology({ includeTailscale: false, limit: null });
      expect(full.pagination.limit).toBeNull();
      expect(full.machines).toHaveLength(12);

      const zeroLimit = discoverMachineTopology({ includeTailscale: false, limit: 0 });
      expect(zeroLimit.pagination).toMatchObject({
        limit: 1,
        offset: 0,
        count: 1,
        hasMore: true,
        nextOffset: 1,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resolves a tailscale peer without requiring a manifest entry", () => {
    const dir = setupTemp("machines-topology-peer-route-");
    try {
      const topology = discoverMachineTopology({
        now: new Date("2026-06-09T00:00:00.000Z"),
        runner: fakeRunner({
          Self: { HostName: "demo-node-02", DNSName: "demo-node-02.tailnet.ts.net.", OS: "linux", Online: true },
          Peer: {
            "nodekey:abc": {
              HostName: "demo-node-01",
              DNSName: "demo-node-01.tailnet.ts.net.",
              OS: "linux",
              TailscaleIPs: ["203.0.113.34"],
              Online: true,
              Active: true,
            },
          },
        }),
      });

      const route = resolveMachineRoute("demo-node-01", { topology, now: new Date("2026-06-09T00:00:00.000Z") });
      expect(route.ok).toBe(true);
      expect(route.machine_id).toBe("demo-node-01");
      expect(route.evidence.manifest_declared).toBe(false);
      expect(route.evidence.matched_by).toBe("machine_id");
      expect(route.route).toBe("tailscale");
      expect(route.target).toBe("demo-node-01.tailnet.ts.net");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
