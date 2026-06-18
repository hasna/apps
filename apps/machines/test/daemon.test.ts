import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDaemonInstallPlan,
  buildDaemonLogsPlan,
  buildDaemonRestartPlan,
  buildDaemonStatusPlan,
  buildDaemonUninstallPlan,
  renderLaunchdPlist,
  renderSystemdUnit,
  runDaemonServicePlan,
  type DaemonServicePlan,
} from "../src/commands/daemon.js";

describe("daemon service lifecycle planning", () => {
  test("builds a deterministic macOS launchd install plan", () => {
    const plan = buildDaemonInstallPlan({
      platform: "macos",
      mode: "user",
      serviceName: "machines-agent.fixture",
      executable: "/opt/fixture/bin/machines-agent",
      intervalMs: 45000,
      storagePush: true,
      doctorSummary: true,
      privateMetadata: true,
    });

    expect(plan.platform).toBe("macos");
    expect(plan.mode).toBe("user");
    expect(plan.action).toBe("install");
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]?.path).toBe("$HOME/Library/LaunchAgents/machines-agent.fixture.plist");
    expect(plan.files[0]?.content).toContain("<key>Label</key>");
    expect(plan.files[0]?.content).toContain("<string>machines-agent.fixture</string>");
    expect(plan.files[0]?.content).toContain("<string>/opt/fixture/bin/machines-agent</string>");
    expect(plan.files[0]?.content).toContain("<string>--interval-ms</string>");
    expect(plan.files[0]?.content).toContain("<string>45000</string>");
    expect(plan.files[0]?.content).toContain("<key>HASNA_MACHINES_DATABASE_URL</key>");
    expect(plan.files[0]?.content).toContain("&lt;set:HASNA_MACHINES_DATABASE_URL&gt;");
    expect(plan.files[0]?.content).toContain("<key>HASNA_MACHINES_AGENT_STORAGE_PUSH_RETRIES</key>");
    expect(plan.files[0]?.content).toContain("<string>2</string>");
    expect(plan.files[0]?.content).toContain(`<string>${process.env["HOME"] ?? "/tmp"}/Library/Logs/machines-agent.fixture.out.log</string>`);
    expect(plan.files[0]?.content).not.toContain("<string>$HOME/Library/Logs/");
    expect(plan.files[0]?.content).toContain("<key>HASNA_MACHINES_AGENT_DOCTOR_SUMMARY</key>");
    expect(plan.files[0]?.content).toContain("<key>HASNA_MACHINES_PRIVATE_METADATA</key>");
    expect(plan.files[0]?.content).toContain("<string>1</string>");
    expect(plan.commands.map((cmd) => cmd.id)).toEqual([
      "launchd-bootout-existing",
      "launchd-bootstrap",
      "launchd-enable",
      "launchd-kickstart",
    ]);
    expect(plan.commands[1]?.args).toEqual(["bootstrap", "gui/$UID", "$HOME/Library/LaunchAgents/machines-agent.fixture.plist"]);
    expect(JSON.stringify(plan)).not.toContain("postgres://");
    expect(JSON.stringify(plan)).not.toContain("raw-secret");
  });

  test("builds Linux systemd user and system install plans", () => {
    const userPlan = buildDaemonInstallPlan({
      platform: "linux",
      mode: "user",
      serviceName: "machines-agent-fixture",
      executable: "/opt/fixture/bin/machines-agent",
      intervalMs: 10000,
      env: ["HASNA_MACHINES_MANIFEST_PATH"],
    });
    const systemPlan = buildDaemonInstallPlan({
      platform: "linux",
      mode: "system",
      serviceName: "machines-agent-fixture",
      executable: "/opt/fixture/bin/machines-agent",
    });

    expect(userPlan.files[0]?.path).toBe("$HOME/.config/systemd/user/machines-agent-fixture.service");
    expect(userPlan.files[0]?.content).toContain("ExecStart=/opt/fixture/bin/machines-agent --interval-ms 10000");
    expect(userPlan.files[0]?.content).toContain('Environment="HASNA_MACHINES_MANIFEST_PATH=<set:HASNA_MACHINES_MANIFEST_PATH>"');
    expect(userPlan.files[0]?.content).toContain("WantedBy=default.target");
    expect(userPlan.commands[0]?.args).toEqual(["--user", "daemon-reload"]);
    expect(userPlan.commands[1]?.args).toEqual(["--user", "enable", "--now", "machines-agent-fixture.service"]);
    expect(userPlan.commands.every((cmd) => cmd.sudo === false)).toBe(true);

    expect(systemPlan.files[0]?.path).toBe("/etc/systemd/system/machines-agent-fixture.service");
    expect(systemPlan.files[0]?.content).toContain("WantedBy=multi-user.target");
    expect(systemPlan.commands[0]?.args).toEqual(["daemon-reload"]);
    expect(systemPlan.commands[1]?.args).toEqual(["enable", "--now", "machines-agent-fixture.service"]);
    expect(systemPlan.commands.every((cmd) => cmd.sudo === true)).toBe(true);
  });

  test("adds executable directory to service PATH for non-standard bin shims", () => {
    const plan = buildDaemonInstallPlan({
      platform: "linux",
      mode: "user",
      serviceName: "machines-agent-fixture",
      executable: "/home/operator/.bun/bin/machines-agent",
    });

    expect(plan.files[0]?.content).toContain('Environment="PATH=/home/operator/.bun/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"');
  });

  test("plans uninstall, restart, status, and logs without install files", () => {
    const base = {
      platform: "linux" as const,
      mode: "user" as const,
      serviceName: "machines-agent-fixture",
      executable: "/opt/fixture/bin/machines-agent",
    };

    const uninstall = buildDaemonUninstallPlan(base);
    const restart = buildDaemonRestartPlan(base);
    const status = buildDaemonStatusPlan(base);
    const logs = buildDaemonLogsPlan(base);

    expect(uninstall.files).toEqual([]);
    expect(uninstall.commands.map((cmd) => cmd.id)).toEqual([
      "systemd-disable-now",
      "remove-systemd-unit",
      "systemd-daemon-reload",
    ]);
    expect(restart.files).toEqual([]);
    expect(restart.commands).toEqual([
      {
        id: "systemd-restart",
        description: "Restart the systemd service.",
        program: "systemctl",
        args: ["--user", "restart", "machines-agent-fixture.service"],
        sudo: false,
        mutates: true,
      },
    ]);
    expect(status.commands[0]?.mutates).toBe(false);
    expect(status.commands[0]?.args).toEqual(["--user", "status", "machines-agent-fixture.service", "--no-pager"]);
    expect(logs.commands[0]?.mutates).toBe(false);
    expect(logs.commands[0]?.program).toBe("journalctl");
  });

  test("render helpers produce platform-specific service content", () => {
    expect(renderLaunchdPlist({
      serviceName: "machines-agent-render",
      executable: "/opt/render/bin/machines-agent",
      intervalMs: 12000,
    })).toContain("<string>machines-agent-render</string>");

    expect(renderSystemdUnit({
      mode: "system",
      serviceName: "machines-agent-render",
      executable: "/opt/render/bin/machines-agent",
      intervalMs: 12000,
    })).toContain("ExecStart=/opt/render/bin/machines-agent --interval-ms 12000");
  });

  test("uses safe placeholders for requested private env names", () => {
    const plan = buildDaemonInstallPlan({
      platform: "linux",
      mode: "user",
      privateMetadata: ["HASNA_MACHINES_PRIVATE_TOKEN", "not-valid"],
    });

    const payload = JSON.stringify(plan);
    expect(payload).toContain("<set:HASNA_MACHINES_PRIVATE_TOKEN>");
    expect(payload).not.toContain("raw-token");
    expect(plan.warnings).toContain('Invalid environment variable name "not-valid"; skipped.');
  });

  test("does not apply service changes without explicit confirmation", () => {
    const plan = buildDaemonStatusPlan({
      platform: "linux",
      mode: "user",
      serviceName: "machines-agent-fixture",
    });
    const result = runDaemonServicePlan(plan, { apply: true, yes: false });
    expect(result.mode).toBe("plan");
    expect(result.applied).toBe(false);
    expect(result.warnings).toContain("apply_requires_yes");
    expect(result.commands.every((entry) => entry.skipped)).toBe(true);
  });

  test("expands launchd apply commands and tolerates missing bootout on fresh install", () => {
    const plan = buildDaemonInstallPlan({
      platform: "macos",
      mode: "user",
      serviceName: "machines-agent-fixture",
      executable: "/opt/fixture/bin/machines-agent",
    });
    const result = runDaemonServicePlan(plan, { apply: true, yes: false });

    expect(plan.commands[0]?.id).toBe("launchd-bootout-existing");
    expect(plan.commands[0]?.allowFailure).toBe(true);
    expect(result.commands[0]?.command.join(" ")).not.toContain("$UID");
    expect(result.commands[0]?.command.join(" ")).not.toContain("$HOME");
  });

  test("refuses apply when required service placeholders are unresolved", () => {
    const previous = process.env["HASNA_MACHINES_DATABASE_URL"];
    delete process.env["HASNA_MACHINES_DATABASE_URL"];
    try {
      const plan = buildDaemonInstallPlan({
        platform: "linux",
        mode: "user",
        serviceName: "machines-agent-fixture",
        executable: "/opt/fixture/bin/machines-agent",
        storagePush: true,
      });
      const result = runDaemonServicePlan(plan, { apply: true, yes: true });
      expect(result.applied).toBe(false);
      expect(result.filesWritten).toEqual([]);
      expect(result.commands.every((entry) => entry.skipped)).toBe(true);
      expect(result.warnings.join("\n")).toContain("Missing environment variable required for service apply: HASNA_MACHINES_DATABASE_URL");
    } finally {
      if (previous === undefined) delete process.env["HASNA_MACHINES_DATABASE_URL"];
      else process.env["HASNA_MACHINES_DATABASE_URL"] = previous;
    }
  });

  test("materializes systemd placeholders with unit-safe escaping", () => {
    const previous = process.env["HASNA_MACHINES_DATABASE_URL"];
    const dir = mkdtempSync(join(tmpdir(), "machines-daemon-materialize-"));
    process.env["HASNA_MACHINES_DATABASE_URL"] = 'postgres://user:p"w@example/machines?tag=100%25\\fleet';
    try {
      const plan = buildDaemonInstallPlan({
        platform: "linux",
        mode: "user",
        serviceName: "machines-agent-fixture",
        executable: "/opt/fixture/bin/machines-agent",
        storagePush: true,
      });
      const filePath = join(dir, "machines-agent-fixture.service");
      const safePlan: DaemonServicePlan = {
        ...plan,
        files: [{ ...plan.files[0]!, path: filePath }],
        commands: [],
      };
      const result = runDaemonServicePlan(safePlan, { apply: true, yes: true });
      const written = readFileSync(filePath, "utf8");
      expect(result.applied).toBe(true);
      expect(written).toContain('Environment="HASNA_MACHINES_DATABASE_URL=postgres://user:p\\"w@example/machines?tag=100%%25\\\\fleet"');
    } finally {
      if (previous === undefined) delete process.env["HASNA_MACHINES_DATABASE_URL"];
      else process.env["HASNA_MACHINES_DATABASE_URL"] = previous;
    }
  });

  test("refuses control characters in materialized service env values", () => {
    const previous = process.env["HASNA_MACHINES_DATABASE_URL"];
    process.env["HASNA_MACHINES_DATABASE_URL"] = "postgres://example/machines\nBAD=1";
    try {
      const plan = buildDaemonInstallPlan({
        platform: "linux",
        mode: "user",
        serviceName: "machines-agent-fixture",
        executable: "/opt/fixture/bin/machines-agent",
        storagePush: true,
      });
      const result = runDaemonServicePlan(plan, { apply: true, yes: true });
      expect(result.applied).toBe(false);
      expect(result.filesWritten).toEqual([]);
      expect(result.commands.every((entry) => entry.skipped)).toBe(true);
      expect(result.warnings.join("\n")).toContain("contains control characters");
    } finally {
      if (previous === undefined) delete process.env["HASNA_MACHINES_DATABASE_URL"];
      else process.env["HASNA_MACHINES_DATABASE_URL"] = previous;
    }
  });
});
