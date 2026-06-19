import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { daemonLogPath, launchdPlistPath, systemdServicePath } from "../lib/paths.js";

export interface InstallStartupResult {
  platform: NodeJS.Platform;
  path: string;
  instructions: string[];
}

export function installStartup(
  cliEntry: string,
  execPath: string = process.execPath,
  args: string[] = ["daemon", "run"],
): InstallStartupResult {
  const command = [execPath, cliEntry, ...args].join(" ");
  if (process.platform === "linux") {
    const path = systemdServicePath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(
      path,
      `[Unit]
Description=Hasna OpenLoops daemon
After=default.target

[Service]
Type=simple
ExecStart=${command}
Restart=always
RestartSec=5
Environment=PATH=${process.env.PATH ?? ""}

[Install]
WantedBy=default.target
`,
    );
    return {
      platform: process.platform,
      path,
      instructions: [
        "systemctl --user daemon-reload",
        "systemctl --user enable --now loops-daemon.service",
        "loginctl enable-linger $USER",
      ],
    };
  }

  if (process.platform === "darwin") {
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
    <string>${execPath}</string>
    <string>${cliEntry}</string>
${args.map((arg) => `    <string>${arg}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${daemonLogPath()}</string>
  <key>StandardErrorPath</key><string>${daemonLogPath()}</string>
</dict>
</plist>
`,
    );
    chmodSync(path, 0o600);
    return {
      platform: process.platform,
      path,
      instructions: [`launchctl load -w ${path}`],
    };
  }

  throw new Error(`startup install is not implemented for ${process.platform}`);
}
