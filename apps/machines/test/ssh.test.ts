import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { buildSshCommand, resolveSshTarget } from "../src/commands/ssh.js";

describe("smart ssh", () => {
  test("prefers LAN when reachable", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-ssh-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_REACHABLE_HOSTS"] = "hasna@spark01";
    process.env["HASNA_MACHINES_MACHINE_ID"] = "control";
    manifestInit();
    manifestAdd({
      id: "spark01",
      platform: "linux",
      workspacePath: "/home/hasna/workspace",
      sshAddress: "hasna@spark01",
      tailscaleName: "spark01.tailnet.ts.net",
    });

    const resolved = resolveSshTarget("spark01");
    expect(resolved.route).toBe("ssh");
    expect(resolved.confidence).toBe("high");
    expect(buildSshCommand("spark01")).toBe("ssh hasna@spark01");
  });

  test("falls back to tailscale when LAN is unavailable", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-ssh-ts-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_REACHABLE_HOSTS"] = "other-host";
    process.env["HASNA_MACHINES_MACHINE_ID"] = "control";
    manifestInit();
    manifestAdd({
      id: "apple03",
      platform: "macos",
      workspacePath: "/Users/hasna/Workspace",
      sshAddress: "hasna@apple03",
      tailscaleName: "apple03.tailnet.ts.net",
    });

    const resolved = resolveSshTarget("apple03");
    expect(resolved.route).toBe("tailscale");
    expect(buildSshCommand("apple03", "uptime")).toBe(`ssh apple03.tailnet.ts.net ${JSON.stringify("uptime")}`);
  });

  test("resolves tailscale-discovered machines without a manifest entry", () => {
    const topology = {
      schema_version: 1 as const,
      package: { name: "@hasna/machines" as const, version: "0.0.16" },
      capabilities: { topology: true as const, compatibility: true as const, route_resolution: true as const, cli_json_fallback: true as const },
      generated_at: "2026-06-09T00:00:00.000Z",
      local_machine_id: "spark02",
      local_hostname: "spark02",
      current_platform: "linux",
      manifest_path_known: false,
      machines: [{
        machine_id: "spark01",
        hostname: "spark01",
        platform: "linux",
        os: "linux",
        user: null,
        workspace_path: null,
        manifest_declared: false,
        heartbeat_status: "unknown" as const,
        last_heartbeat_at: null,
        tailscale: {
          dns_name: "spark01.tailnet.ts.net",
          ips: ["100.71.123.34"],
          online: true,
          active: true,
          last_seen: null,
        },
        ssh: {
          address: null,
          route: "tailscale" as const,
          command_target: "spark01.tailnet.ts.net",
        },
        route_hints: [{ kind: "tailscale" as const, target: "spark01.tailnet.ts.net", reachable: true }],
        tags: [],
        metadata: {},
      }],
      warnings: [],
    };

    const resolved = resolveSshTarget("spark01", { topology });
    expect(resolved.route).toBe("tailscale");
    expect(resolved.target).toBe("spark01.tailnet.ts.net");
    expect(buildSshCommand("spark01", "knowledge --version", { topology })).toBe(`ssh spark01.tailnet.ts.net ${JSON.stringify("knowledge --version")}`);
  });
});
