import { describe, expect, test } from "bun:test";
import {
  resolveScreenTarget,
  buildScreenCommand,
  buildScreenEnableRemoteCommand,
  buildScreenEnableRemoteCommandFromStdin,
  buildScreenEnableCommand,
  defaultScreenPasswordSecretKey,
  resolveScreenCredentials,
  screenCredentialsFailed,
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
    local_machine_id: "controller-01",
    local_hostname: "controller-01",
    current_platform: "macos",
    manifest_path_known: false,
    machines: [
      {
        machine_id: "demo-mac-005",
        hostname: "demo-mac-005",
        platform: "macos",
        os: "macos",
        user: null,
        workspace_path: null,
        manifest_declared: false,
        heartbeat_status: "unknown" as const,
        last_heartbeat_at: null,
        tailscale: {
          dns_name: "demo-mac-005.tailnet.example",
          ips: ["203.0.113.64"],
          online: true,
          active: true,
          last_seen: null,
        },
        ssh: { address: null, route: "tailscale" as const, command_target: "demo-mac-005.tailnet.example" },
        route_hints: [{ kind: "tailscale" as const, target: "demo-mac-005.tailnet.example", reachable: true }],
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
    const topology = topologyWith({ user: "operator" });
    const resolved = resolveScreenTarget("demo-mac-005", { topology });
    expect(resolved.route).toBe("tailscale");
    expect(resolved.user).toBe("operator");
    expect(resolved.host).toBe("demo-mac-005.tailnet.example");
    expect(resolved.url).toBe("vnc://operator@demo-mac-005.tailnet.example");
    expect(buildScreenCommand("demo-mac-005", { topology })).toBe(
      "open vnc://operator@demo-mac-005.tailnet.example",
    );
  });

  test("uses the user from a user@host ssh route target", () => {
    const topology = topologyWith({
      user: null,
      ssh: { address: "remote-user@demo-mac-005", route: "ssh" as const, command_target: "remote-user@demo-mac-005" },
      route_hints: [{ kind: "ssh" as const, target: "remote-user@demo-mac-005", reachable: true }],
      tailscale: { dns_name: null, ips: [], online: null, active: null, last_seen: null },
    });
    const resolved = resolveScreenTarget("demo-mac-005", { topology });
    expect(resolved.user).toBe("remote-user");
    expect(resolved.host).toBe("demo-mac-005");
    expect(resolved.url).toBe("vnc://remote-user@demo-mac-005");
  });

  test("falls back to host-only vnc URL when no user is known", () => {
    const topology = topologyWith({ user: null });
    const resolved = resolveScreenTarget("demo-mac-005", { topology });
    expect(resolved.user).toBeNull();
    expect(resolved.url).toBe("vnc://demo-mac-005.tailnet.example");
  });

  test("throws for an unknown machine", () => {
    const topology = topologyWith({ user: "operator" });
    expect(() => resolveScreenTarget("does-not-exist", { topology })).toThrow();
  });

  test("screen-enable command includes kickstart, SRP, and VNC password", () => {
    const cmd = buildScreenEnableRemoteCommand("operator", "example-vnc-password");
    expect(cmd).toContain("kickstart");
    expect(cmd).toContain("-activate");
    expect(cmd).toContain("AllowSRPForNetworkNodes -bool true");
    expect(cmd).toContain("-setvncpw -vncpw 'example-vnc-password'");
    expect(cmd).toContain("com.apple.access_screensharing");
    expect(cmd).toContain("-users 'operator'");
  });

  test("screen-enable shell-quotes a user with special characters", () => {
    const cmd = buildScreenEnableRemoteCommand("o'brien", "pw");
    expect(cmd).toContain("'o'\\''brien'");
  });

  test("resolves screen credentials from route user and default secret key", () => {
    const topology = topologyWith({
      ssh: { address: "operator@demo-mac-005", route: "ssh" as const, command_target: "operator@demo-mac-005" },
      route_hints: [{ kind: "ssh" as const, target: "operator@demo-mac-005", reachable: true }],
      tailscale: { dns_name: null, ips: [], online: null, active: null, last_seen: null },
    });
    const credentials = resolveScreenCredentials("demo-mac-005", { topology });
    expect(credentials.user).toBe("operator");
    expect(credentials.userSource).toBe("route");
    expect(credentials.passwordSecretKey).toBe(defaultScreenPasswordSecretKey("demo-mac-005"));
    expect(credentials.passwordSecretSource).toBe("default");
  });

  test("resolves screen password secret from manifest metadata", () => {
    const topology = topologyWith({
      user: "operator",
      metadata: {
        screenPasswordSecret: "machines/screen-sharing/screen-demo-mac-005-vnc-password",
      },
    });
    const credentials = resolveScreenCredentials("demo-mac-005", { topology });
    expect(credentials.passwordSecretKey).toBe("machines/screen-sharing/screen-demo-mac-005-vnc-password");
    expect(credentials.passwordSecretSource).toBe("metadata");
  });

  test("secure screen-enable command reads password from stdin", () => {
    const cmd = buildScreenEnableRemoteCommandFromStdin("operator");
    expect(cmd).toContain("sudo -n -p ''");
    expect(cmd).toContain("IFS= read -r vnc_pw");
    expect(cmd).toContain("-setvncpw -vncpw \"$vnc_pw\"");
    expect(cmd).not.toContain("example-vnc-password");
  });

  test("screen-enable plan pipes secrets CLI output into SSH without exposing the password value", () => {
    const topology = topologyWith({
      user: "operator",
      ssh: { address: "operator@demo-mac-005", route: "ssh" as const, command_target: "operator@demo-mac-005" },
      route_hints: [{ kind: "ssh" as const, target: "operator@demo-mac-005", reachable: true }],
      tailscale: { dns_name: null, ips: [], online: null, active: null, last_seen: null },
      metadata: {
        screenPasswordSecret: "machines/screen-sharing/screen-demo-mac-005-vnc-password",
      },
    });
    const plan = buildScreenEnableCommand("demo-mac-005", { topology, secretsCommand: "secrets" });
    expect(plan.secretsCommandArgs).toEqual(["secrets", "get", "machines/screen-sharing/screen-demo-mac-005-vnc-password"]);
    expect(plan.sshCommand).toBe("ssh");
    expect(plan.sshCommandArgs[0]).toBe("operator@demo-mac-005");
    expect(plan.sshCommandArgs[1]).toContain("IFS= read -r vnc_pw");
    expect(plan.command).toContain("secrets' 'get' 'machines/screen-sharing/screen-demo-mac-005-vnc-password'");
    expect(plan.command).toContain("| ssh 'operator@demo-mac-005' ");
    expect(plan.command).not.toContain("example-vnc-password");
  });
});

describe("screen-credentials exit code", () => {
  const okEntry = { ok: true as const, passwordSecret: { checked: false as const, present: null } };
  const unroutable = { ok: false as const };
  const secretMissing = { ok: true as const, passwordSecret: { checked: true as const, present: false } };
  const secretPresent = { ok: true as const, passwordSecret: { checked: true as const, present: true } };

  test("does not fail closed when a full listing includes unroutable machines", () => {
    // Regression: `screen-credentials --all --json` returned a full, valid array but
    // exited 1 solely because >=1 machine was unroutable ("Machine route not found").
    const results = [okEntry, okEntry, unroutable, okEntry];
    expect(screenCredentialsFailed(results)).toBe(false);
  });

  test("still fails when no machine could be resolved", () => {
    expect(screenCredentialsFailed([unroutable, unroutable])).toBe(true);
  });

  test("fails on empty result set", () => {
    expect(screenCredentialsFailed([])).toBe(true);
  });

  test("passes when no secret check was requested", () => {
    expect(screenCredentialsFailed([okEntry, okEntry, unroutable])).toBe(false);
  });

  test("still fails on a missing checked secret in non-strict mode", () => {
    // --check-secret is an explicit, requested check; a resolved machine whose secret is
    // absent stays fatal even though unroutable machines do not.
    expect(screenCredentialsFailed([okEntry, secretMissing])).toBe(true);
  });

  test("strict mode fails closed on any unroutable machine", () => {
    expect(screenCredentialsFailed([okEntry, unroutable], { strict: true })).toBe(true);
  });

  test("strict mode fails closed on a missing checked secret", () => {
    expect(screenCredentialsFailed([okEntry, secretMissing], { strict: true })).toBe(true);
  });

  test("strict mode passes when every machine resolves and secrets are present", () => {
    expect(screenCredentialsFailed([secretPresent, okEntry], { strict: true })).toBe(false);
  });
});
