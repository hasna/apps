import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import {
  installRunnerStartup,
  writeRunnerEnvConfig,
  startRunnerService,
  stopRunnerService,
  runnerServiceStatus,
} from "./install.js";

interface InstallEnv {
  home: string;
  dataDir: string;
  restore: () => void;
}

function withInstallEnv(): InstallEnv {
  const oldHome = process.env.HOME;
  const oldDataDir = process.env.LOOPS_DATA_DIR;
  const home = mkdtempSync(join(tmpdir(), "loops-runner-home-"));
  const dataDir = mkdtempSync(join(tmpdir(), "loops-runner-data-"));
  process.env.HOME = home;
  process.env.LOOPS_DATA_DIR = dataDir;
  return {
    home,
    dataDir,
    restore: () => {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      if (oldDataDir === undefined) delete process.env.LOOPS_DATA_DIR;
      else process.env.LOOPS_DATA_DIR = oldDataDir;
      rmSync(home, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

describe("installRunnerStartup (linux)", () => {
  test("writes the loops-runner systemd unit referencing the mode-600 env file, never a key value", () => {
    const env = withInstallEnv();
    try {
      const result = installRunnerStartup({ cliEntry: "loops-runner", execPath: "/usr/bin/bun", platform: "linux" });
      const service = readFileSync(result.path, "utf8");
      expect(result.path).toContain(".config/systemd/user/loops-runner.service");
      expect(service).toContain("ExecStart=/usr/bin/bun loops-runner run");
      expect(service).not.toContain("loops-runner daemon run");
      expect(service).toContain(`EnvironmentFile=-${env.dataDir}/runner.env`);
      expect(service).toContain(`WorkingDirectory=${env.dataDir}`);
      expect(service).toContain("After=basic.target");
      expect(service).toContain("WantedBy=default.target");
      expect(service).toContain("Restart=always");
      expect(service).not.toContain("HASNA_LOOPS_API_KEY=");
      expect(service).not.toContain("HASNA_LOOPS_API_URL=");
      expect(result.instructions).toContain("systemctl --user daemon-reload");
      expect(result.instructions).toContain("systemctl --user enable --now loops-runner.service");
      expect(result.instructions).toContain("loginctl enable-linger $USER");
    } finally {
      env.restore();
    }
  });

  test("bakes --claim-scope and --machine-id into the unit run args and the env file", () => {
    const env = withInstallEnv();
    try {
      const result = installRunnerStartup({
        cliEntry: "loops-runner",
        execPath: "/usr/bin/bun",
        platform: "linux",
        claimScope: "bound",
        machineId: "station03",
      });
      const service = readFileSync(result.path, "utf8");
      expect(service).toContain("ExecStart=/usr/bin/bun loops-runner run --claim-scope bound");
      const envFile = readFileSync(join(env.dataDir, "runner.env"), "utf8");
      expect(envFile).toContain("LOOPS_RUNNER_MACHINE_ID=station03");
    } finally {
      env.restore();
    }
  });

  test("creates the env file at mode 0600", () => {
    const env = withInstallEnv();
    try {
      installRunnerStartup({ cliEntry: "loops-runner", execPath: "/usr/bin/bun", platform: "linux" });
      const mode = statSync(join(env.dataDir, "runner.env")).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      env.restore();
    }
  });

  test("rejects unsupported platforms", () => {
    const env = withInstallEnv();
    try {
      expect(() =>
        installRunnerStartup({ cliEntry: "loops-runner", execPath: "/usr/bin/bun", platform: "win32" }),
      ).toThrow("startup install is not implemented for win32");
    } finally {
      env.restore();
    }
  });
});

describe("installRunnerStartup (darwin)", () => {
  test("writes the com.hasna.loops.runner launchd plist with run args and logs", () => {
    const env = withInstallEnv();
    try {
      const result = installRunnerStartup({
        cliEntry: "loops-runner",
        execPath: "/opt/homebrew/bin/bun",
        platform: "darwin",
        claimScope: "bound",
      });
      const plist = readFileSync(result.path, "utf8");
      expect(result.path).toContain("Library/LaunchAgents/com.hasna.loops.runner.plist");
      expect(plist).toContain("<key>Label</key><string>com.hasna.loops.runner</string>");
      expect(plist).toContain("<string>/opt/homebrew/bin/bun</string>");
      expect(plist).toContain("<string>loops-runner</string>");
      expect(plist).toContain("<string>run</string>");
      expect(plist).toContain("<string>--claim-scope</string>");
      expect(plist).toContain("<string>bound</string>");
      expect(plist).toContain("<key>RunAtLoad</key><true/>");
      expect(plist).toContain("<key>KeepAlive</key><true/>");
      expect(plist).toContain(`<key>WorkingDirectory</key><string>${env.dataDir}</string>`);
      expect(plist).toContain("runner.log");
      expect(plist).not.toContain("HASNA_LOOPS_API_KEY");
      const mode = statSync(result.path).mode & 0o777;
      expect(mode).toBe(0o600);
      expect(result.instructions.some((line) => line.includes("launchctl bootout gui/$(id -u)"))).toBe(true);
      expect(result.instructions.some((line) => line.includes("launchctl bootstrap gui/$(id -u)"))).toBe(true);
      expect(result.instructions.some((line) => line.includes("load -w"))).toBe(false);
    } finally {
      env.restore();
    }
  });
});

describe("writeRunnerEnvConfig", () => {
  test("merges claim-scope and machine-id while preserving existing credential lines verbatim", () => {
    const env = withInstallEnv();
    try {
      const path = join(env.dataDir, "runner.env");
      writeFileSync(path, "HASNA_LOOPS_API_URL=https://loops.example.test\nHASNA_LOOPS_API_KEY=keep-me\n", { mode: 0o600 });
      const result = writeRunnerEnvConfig({ claimScope: "fleet", machineId: "station01" });
      expect(result.path).toBe(path);
      const contents = readFileSync(path, "utf8");
      expect(contents).toContain("HASNA_LOOPS_API_URL=https://loops.example.test");
      expect(contents).toContain("HASNA_LOOPS_API_KEY=keep-me");
      expect(contents).toContain("LOOPS_RUNNER_MACHINE_ID=station01");
      expect(contents).toContain("LOOPS_RUNNER_CLAIM_SCOPE=fleet");
      const mode = statSync(path).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      env.restore();
    }
  });

  test("is idempotent: re-running with the same values does not duplicate lines", () => {
    const env = withInstallEnv();
    try {
      writeRunnerEnvConfig({ claimScope: "bound", machineId: "station03" });
      writeRunnerEnvConfig({ claimScope: "bound", machineId: "station03" });
      const contents = readFileSync(join(env.dataDir, "runner.env"), "utf8");
      expect(contents.match(/LOOPS_RUNNER_CLAIM_SCOPE=/g) ?? []).toHaveLength(1);
      expect(contents.match(/LOOPS_RUNNER_MACHINE_ID=/g) ?? []).toHaveLength(1);
    } finally {
      env.restore();
    }
  });
});

describe("runner service verbs", () => {
  test("start issues daemon-reload + enable --now for the loops-runner service", () => {
    const env = withInstallEnv();
    try {
      installRunnerStartup({ cliEntry: "loops-runner", execPath: "/usr/bin/bun", platform: "linux" });
      const called: string[] = [];
      const spawnImpl = ((command: string, args: string[]) => {
        called.push(`${command} ${args.join(" ")}`);
        return { status: 0, stdout: "", stderr: "" };
      }) as unknown as typeof import("node:child_process").spawnSync;
      const result = startRunnerService({ platform: "linux", spawnImpl });
      expect(called).toContain("sh -c systemctl --user daemon-reload");
      expect(called).toContain("sh -c systemctl --user enable --now loops-runner.service");
      expect(result.commands.every((entry) => entry.status === 0)).toBe(true);
    } finally {
      env.restore();
    }
  });

  test("start refuses when the unit is not installed", () => {
    const env = withInstallEnv();
    try {
      expect(() => startRunnerService({ platform: "linux" })).toThrow("loops-runner is not installed");
    } finally {
      env.restore();
    }
  });

  test("stop issues systemctl stop for the loops-runner service", () => {
    const env = withInstallEnv();
    try {
      installRunnerStartup({ cliEntry: "loops-runner", execPath: "/usr/bin/bun", platform: "linux" });
      const called: string[] = [];
      const spawnImpl = ((command: string, args: string[]) => {
        called.push(`${command} ${args.join(" ")}`);
        return { status: 0, stdout: "", stderr: "" };
      }) as unknown as typeof import("node:child_process").spawnSync;
      const result = stopRunnerService({ platform: "linux", spawnImpl });
      expect(called).toContain("sh -c systemctl --user stop loops-runner.service");
      expect(result.commands).toHaveLength(1);
    } finally {
      env.restore();
    }
  });

  test("status reports installed and active from the service probe", () => {
    const env = withInstallEnv();
    try {
      installRunnerStartup({ cliEntry: "loops-runner", execPath: "/usr/bin/bun", platform: "linux" });
      const spawnImpl = ((_command: string, args: string[]) => {
        const probe = args[args.length - 1] ?? "";
        const status = probe.includes("systemctl --user is-active") && probe.includes("loops-runner.service") ? 0 : 1;
        return { status, stdout: "", stderr: "" };
      }) as unknown as typeof import("node:child_process").spawnSync;
      const status = runnerServiceStatus({ platform: "linux", spawnImpl });
      expect(status.installed).toBe(true);
      expect(status.active).toBe(true);
    } finally {
      env.restore();
    }
  });

  test("status reports not installed when no unit exists", () => {
    const env = withInstallEnv();
    try {
      const status = runnerServiceStatus({ platform: "linux" });
      expect(status.installed).toBe(false);
      expect(status.active).toBeNull();
    } finally {
      env.restore();
    }
  });
});
