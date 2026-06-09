import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, upsertHeartbeat } from "../src/db.js";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import {
  discoverMachineTopology,
  getLocalMachineTopology,
  resolveMachineRoute,
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
  process.env.HASNA_MACHINES_MACHINE_ID = "spark02";
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
        id: "spark01",
        hostname: "spark01.local",
        sshAddress: "hasna@spark01.local",
        tailscaleName: "spark01.tailnet.ts.net",
        platform: "linux",
        workspacePath: "/home/hasna/workspace",
        tags: ["server"],
      });
      upsertHeartbeat("spark02", 123, "online");

      const topology = discoverMachineTopology({
        now: new Date("2026-06-09T00:00:00.000Z"),
        runner: fakeRunner({
          Self: {
            HostName: "spark02",
            DNSName: "spark02.tailnet.ts.net.",
            OS: "linux",
            TailscaleIPs: ["100.85.234.92"],
            Online: true,
            Active: false,
          },
          Peer: {
            "nodekey:abc": {
              HostName: "spark01",
              DNSName: "spark01.tailnet.ts.net.",
              OS: "linux",
              TailscaleIPs: ["100.71.123.34"],
              Online: true,
              Active: true,
            },
          },
        }),
      });

      expect(topology.schema_version).toBe(1);
      expect(topology.package.name).toBe("@hasna/machines");
      expect(topology.capabilities.route_resolution).toBe(true);
      expect(topology.local_machine_id).toBe("spark02");
      expect(topology.machines.map((machine) => machine.machine_id)).toContain("spark01");
      expect(topology.machines.map((machine) => machine.machine_id)).toContain("spark02");

      const spark01 = topology.machines.find((machine) => machine.machine_id === "spark01");
      expect(spark01?.manifest_declared).toBe(true);
      expect(spark01?.tailscale.ips).toEqual(["100.71.123.34"]);
      expect(spark01?.ssh.route).toBe("tailscale");
      expect(spark01?.ssh.command_target).toBe("spark01.tailnet.ts.net");
      expect(spark01?.route_hints.some((hint) => hint.kind === "tailscale")).toBe(true);

      const route = resolveMachineRoute("spark01", { topology, now: new Date("2026-06-09T00:00:00.000Z") });
      expect(route.ok).toBe(true);
      expect(route.route).toBe("tailscale");
      expect(route.target).toBe("spark01.tailnet.ts.net");
      expect(route.confidence).toBe("high");

      const spark02 = topology.machines.find((machine) => machine.machine_id === "spark02");
      expect(spark02?.heartbeat_status).toBe("online");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("can skip tailscale probing and still report local topology", () => {
    const dir = setupTemp("machines-topology-local-");
    try {
      const local = getLocalMachineTopology({ includeTailscale: false });
      expect(local.machine_id).toBe("spark02");
      expect(local.route_hints.some((hint) => hint.kind === "local")).toBe(true);
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
          Self: { HostName: "spark02", DNSName: "spark02.tailnet.ts.net.", OS: "linux", Online: true },
          Peer: {
            "nodekey:abc": {
              HostName: "spark01",
              DNSName: "spark01.tailnet.ts.net.",
              OS: "linux",
              TailscaleIPs: ["100.71.123.34"],
              Online: true,
              Active: true,
            },
          },
        }),
      });

      const route = resolveMachineRoute("spark01", { topology, now: new Date("2026-06-09T00:00:00.000Z") });
      expect(route.ok).toBe(true);
      expect(route.machine_id).toBe("spark01");
      expect(route.evidence.manifest_declared).toBe(false);
      expect(route.evidence.matched_by).toBe("machine_id");
      expect(route.route).toBe("tailscale");
      expect(route.target).toBe("spark01.tailnet.ts.net");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
