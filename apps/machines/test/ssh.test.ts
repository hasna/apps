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
    process.env["HASNA_MACHINES_REACHABLE_HOSTS"] = "operator@spark01";
    process.env["HASNA_MACHINES_MACHINE_ID"] = "control";
    manifestInit();
    manifestAdd({
      id: "spark01",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
      sshAddress: "operator@spark01",
      tailscaleName: "spark01.tailnet.ts.net",
    });

    const resolved = resolveSshTarget("spark01");
    expect(resolved.route).toBe("ssh");
    expect(resolved.confidence).toBe("high");
    expect(buildSshCommand("spark01")).toBe("ssh operator@spark01");
  });

  test("falls back to tailscale when LAN is unavailable", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-ssh-ts-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_REACHABLE_HOSTS"] = "other-host";
    process.env["HASNA_MACHINES_MACHINE_ID"] = "control";
    manifestInit();
    manifestAdd({
      id: "mac-lab-01",
      platform: "macos",
      workspacePath: "/Users/operator/Workspace",
      sshAddress: "operator@mac-lab-01",
      tailscaleName: "mac-lab-01.tailnet.example",
    });

    const routeOptions = { includeTailscale: false };
    const resolved = resolveSshTarget("mac-lab-01", routeOptions);
    expect(resolved.route).toBe("tailscale");
    expect(resolved.target).toBe("operator@mac-lab-01.tailnet.example");
    expect(buildSshCommand("mac-lab-01", "uptime", routeOptions)).toBe("ssh operator@mac-lab-01.tailnet.example 'uptime'");
  });

  test("keeps the manifest SSH user when Tailscale is the selected route", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-ssh-ts-user-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_REACHABLE_HOSTS"] = "other-host";
    process.env["HASNA_MACHINES_MACHINE_ID"] = "control";
    manifestInit();
    manifestAdd({
      id: "demo-mac-01",
      hostname: "demo-mac-01",
      platform: "macos",
      workspacePath: "/Users/operator/Workspace",
      sshAddress: "operator@demo-mac-01",
      tailscaleName: "demo-mac-01.tailnet.example",
    });

    const resolved = resolveSshTarget("demo-mac-01", { includeTailscale: false });
    expect(resolved.route).toBe("tailscale");
    expect(resolved.target).toBe("operator@demo-mac-01.tailnet.example");
    expect(buildSshCommand("demo-mac-01", "whoami", { includeTailscale: false })).toBe("ssh operator@demo-mac-01.tailnet.example 'whoami'");
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
    expect(buildSshCommand("spark01", "knowledge --version", { topology })).toBe("ssh spark01.tailnet.ts.net 'knowledge --version'");
  });
});
