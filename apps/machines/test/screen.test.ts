import { describe, expect, test } from "bun:test";
import {
  resolveScreenTarget,
  buildScreenCommand,
  buildScreenEnableRemoteCommand,
  buildScreenEnableRemoteCommandFromStdin,
  buildScreenEnableCommand,
  defaultScreenPasswordSecretKey,
  resolveScreenCredentials,
} from "../src/commands/screen.js";

function topologyWith(entry: Record<string, unknown>) {
  return {
    schema_version: 1 as const,
    package: { name: "@hasna/machines" as const, version: "0.0.24" },
    capabilities: {
      topology: true as const,
      compatibility: true as const,
      route_resolution: true as const,
      cli_json_fallback: true as const,
    },
    generated_at: "2026-06-11T00:00:00.000Z",
    local_machine_id: "apple03",
    local_hostname: "apple03",
    current_platform: "macos",
    manifest_path_known: false,
    machines: [
      {
        machine_id: "machine005",
        hostname: "machine005",
        platform: "macos",
        os: "macos",
        user: null,
        workspace_path: null,
        manifest_declared: false,
        heartbeat_status: "unknown" as const,
        last_heartbeat_at: null,
        tailscale: {
          dns_name: "machine005.tailnet.ts.net",
          ips: ["100.122.241.64"],
          online: true,
          active: true,
          last_seen: null,
        },
        ssh: { address: null, route: "tailscale" as const, command_target: "machine005.tailnet.ts.net" },
        route_hints: [{ kind: "tailscale" as const, target: "machine005.tailnet.ts.net", reachable: true }],
        tags: [],
        metadata: {},
        ...entry,
      },
    ],
    warnings: [],
  };
}

describe("machines screen", () => {
  test("builds vnc URL from a tailscale route + topology user", () => {
    const topology = topologyWith({ user: "jo" });
    const resolved = resolveScreenTarget("machine005", { topology });
    expect(resolved.route).toBe("tailscale");
    expect(resolved.user).toBe("jo");
    expect(resolved.host).toBe("machine005.tailnet.ts.net");
    expect(resolved.url).toBe("vnc://jo@machine005.tailnet.ts.net");
    expect(buildScreenCommand("machine005", { topology })).toBe(
      "open vnc://jo@machine005.tailnet.ts.net",
    );
  });

  test("uses the user from a user@host ssh route target", () => {
    const topology = topologyWith({
      user: null,
      ssh: { address: "hank@machine005", route: "ssh" as const, command_target: "hank@machine005" },
      route_hints: [{ kind: "ssh" as const, target: "hank@machine005", reachable: true }],
      tailscale: { dns_name: null, ips: [], online: null, active: null, last_seen: null },
    });
    const resolved = resolveScreenTarget("machine005", { topology });
    expect(resolved.user).toBe("hank");
    expect(resolved.host).toBe("machine005");
    expect(resolved.url).toBe("vnc://hank@machine005");
  });

  test("falls back to host-only vnc URL when no user is known", () => {
    const topology = topologyWith({ user: null });
    const resolved = resolveScreenTarget("machine005", { topology });
    expect(resolved.user).toBeNull();
    expect(resolved.url).toBe("vnc://machine005.tailnet.ts.net");
  });

  test("throws for an unknown machine", () => {
    const topology = topologyWith({ user: "jo" });
    expect(() => resolveScreenTarget("does-not-exist", { topology })).toThrow();
  });

  test("screen-enable command includes kickstart, SRP, and VNC password", () => {
    const cmd = buildScreenEnableRemoteCommand("jo", "steaua17");
    expect(cmd).toContain("kickstart");
    expect(cmd).toContain("-activate");
    expect(cmd).toContain("AllowSRPForNetworkNodes -bool true");
    expect(cmd).toContain("-setvncpw -vncpw 'steaua17'");
    expect(cmd).toContain("com.apple.access_screensharing");
    expect(cmd).toContain("-users 'jo'");
  });

  test("screen-enable shell-quotes a user with special characters", () => {
    const cmd = buildScreenEnableRemoteCommand("o'brien", "pw");
    expect(cmd).toContain("'o'\\''brien'");
  });

  test("resolves screen credentials from route user and default secret key", () => {
    const topology = topologyWith({
      ssh: { address: "hasna@machine005", route: "ssh" as const, command_target: "hasna@machine005" },
      route_hints: [{ kind: "ssh" as const, target: "hasna@machine005", reachable: true }],
      tailscale: { dns_name: null, ips: [], online: null, active: null, last_seen: null },
    });
    const credentials = resolveScreenCredentials("machine005", { topology });
    expect(credentials.user).toBe("hasna");
    expect(credentials.userSource).toBe("route");
    expect(credentials.passwordSecretKey).toBe(defaultScreenPasswordSecretKey("machine005"));
    expect(credentials.passwordSecretSource).toBe("default");
  });

  test("resolves screen password secret from manifest metadata", () => {
    const topology = topologyWith({
      user: "hasna",
      metadata: {
        screenPasswordSecret: "hasna/xyz/opensource/machines/prod/screen-machine005-vnc-password",
      },
    });
    const credentials = resolveScreenCredentials("machine005", { topology });
    expect(credentials.passwordSecretKey).toBe("hasna/xyz/opensource/machines/prod/screen-machine005-vnc-password");
    expect(credentials.passwordSecretSource).toBe("metadata");
  });

  test("secure screen-enable command reads password from stdin", () => {
    const cmd = buildScreenEnableRemoteCommandFromStdin("hasna");
    expect(cmd).toContain("sudo -n -p ''");
    expect(cmd).toContain("IFS= read -r vnc_pw");
    expect(cmd).toContain("-setvncpw -vncpw \"$vnc_pw\"");
    expect(cmd).not.toContain("steaua17");
  });

  test("screen-enable plan pipes secrets CLI output into SSH without exposing the password value", () => {
    const topology = topologyWith({
      user: "hasna",
      ssh: { address: "hasna@machine005", route: "ssh" as const, command_target: "hasna@machine005" },
      route_hints: [{ kind: "ssh" as const, target: "hasna@machine005", reachable: true }],
      tailscale: { dns_name: null, ips: [], online: null, active: null, last_seen: null },
      metadata: {
        screenPasswordSecret: "hasna/xyz/opensource/machines/prod/screen-machine005-vnc-password",
      },
    });
    const plan = buildScreenEnableCommand("machine005", { topology, secretsCommand: "secrets" });
    expect(plan.command).toContain("secrets' 'get' 'hasna/xyz/opensource/machines/prod/screen-machine005-vnc-password'");
    expect(plan.command).toContain("| ssh hasna@machine005 ");
    expect(plan.command).not.toContain("steaua17");
  });
});
