import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { daemonLogPath, ensureDataDir, launchdPlistPath, systemdServicePath } from "../lib/paths.js";
import { normalizeExecutionPath } from "../lib/env.js";

export interface StartupEnableResult {
  command: string;
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface InstallStartupResult {
  platform: NodeJS.Platform;
  path: string;
  instructions: string[];
  enableResults?: StartupEnableResult[];
}

function systemdEscapeExecPart(part: string): string {
  const escaped = part.replaceAll("%", "%%");
  if (/^[A-Za-z0-9%_@+=:,./-]+$/.test(escaped)) return escaped;
  return `"${escaped.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function systemdEnvironmentLine(name: string, value: string): string {
  const escaped = value.replaceAll("%", "%%").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `Environment="${name}=${escaped}"`;
}

function systemdPathValue(value: string): string {
  return value.replaceAll("%", "%%");
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function launchctlCommands(path: string): string[] {
  return [
    `launchctl bootout gui/$(id -u) ${shellQuote(path)} 2>/dev/null || true`,
    `launchctl bootstrap gui/$(id -u) ${shellQuote(path)}`,
  ];
}

export function installStartup(
  cliEntry: string,
  execPath: string = process.execPath,
  args: string[] = ["daemon", "run"],
  platform: NodeJS.Platform = process.platform,
): InstallStartupResult {
  const pathEnv = normalizeExecutionPath(process.env);
  const dataDirPath = ensureDataDir();
  if (platform === "linux") {
    const path = systemdServicePath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const execStart = [execPath, cliEntry, ...args].map(systemdEscapeExecPart).join(" ");
    writeFileSync(
      path,
      `[Unit]
Description=Hasna Loops daemon
After=basic.target

[Service]
Type=simple
ExecStart=${execStart}
WorkingDirectory=${systemdPathValue(dataDirPath)}
Restart=always
RestartSec=5
${systemdEnvironmentLine("PATH", pathEnv)}
${systemdEnvironmentLine("LOOPS_DATA_DIR", dataDirPath)}
${systemdEnvironmentLine("HASNA_LOOPS_CONNECTION", "file")}

[Install]
WantedBy=default.target
`,
    );
    return {
      platform,
      path,
      instructions: [
        "systemctl --user daemon-reload",
        "systemctl --user enable --now loops-daemon.service",
        "loginctl enable-linger $USER",
      ],
    };
  }

  if (platform === "darwin") {
    const path = launchdPlistPath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(
      path,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.hasna.loops.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(execPath)}</string>
    <string>${xmlEscape(cliEntry)}</string>
${args.map((arg) => `    <string>${xmlEscape(arg)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>WorkingDirectory</key><string>${xmlEscape(dataDirPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xmlEscape(pathEnv)}</string>
    <key>LOOPS_DATA_DIR</key><string>${xmlEscape(dataDirPath)}</string>
    <key>HASNA_LOOPS_CONNECTION</key><string>file</string>
  </dict>
  <key>StandardOutPath</key><string>${xmlEscape(daemonLogPath())}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(daemonLogPath())}</string>
</dict>
</plist>
`,
    );
    chmodSync(path, 0o600);
    return {
      platform,
      path,
      instructions: launchctlCommands(path),
    };
  }

  throw new Error(`startup install is not implemented for ${platform}`);
}

export function enableStartup(result: InstallStartupResult): StartupEnableResult[] {
  const commands =
    result.platform === "linux"
      ? ["systemctl --user daemon-reload", "systemctl --user enable --now loops-daemon.service"]
      : result.platform === "darwin"
        ? launchctlCommands(result.path)
        : [];
  return commands.map((command) => {
    const run = spawnSync("sh", ["-c", command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      command,
      status: run.status,
      stdout: run.stdout.trim(),
      stderr: run.stderr.trim(),
    };
  });
}
