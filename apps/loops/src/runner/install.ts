import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { hostname } from "node:os";
import {
  ensureDataDir,
  dataDir,
  runnerEnvPath,
  runnerLaunchdPlistPath,
  runnerLogPath,
  runnerSystemdServicePath,
} from "../lib/paths.js";
import { normalizeExecutionPath } from "../lib/env.js";
import {
  RUNNER_CLAIM_SCOPES,
  RUNNER_PERMANENT_DENIAL_EXIT_CODE,
  type RunnerClaimScope,
} from "./index.js";

const SERVICE_NAME = "loops-runner";
const LAUNCHD_LABEL = "com.hasna.loops.runner";

/**
 * The runner must never import the local daemon (the cloud-boundary test
 * enforces this across every file under src/runner), so the small unit/plist
 * formatting helpers are mirrored here rather than imported from the daemon's
 * install module.
 */

export interface StartupEnableResult {
  command: string;
  status: number | null;
  stdout: string;
  stderr: string;
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

export interface RunnerStartupOptions {
  cliEntry: string;
  execPath?: string;
  platform?: NodeJS.Platform;
  claimScope?: RunnerClaimScope;
  machineId?: string;
}

export interface RunnerStartupResult {
  platform: NodeJS.Platform;
  path: string;
  instructions: string[];
  enableResults?: StartupEnableResult[];
  /** The mode-600 per-station config surface this unit references. */
  envFile: RunnerEnvConfigResult;
}

export interface RunnerEnvConfigResult {
  path: string;
  present: boolean;
  wrote: string[];
}

function assertClaimScope(value: string | undefined): RunnerClaimScope | undefined {
  if (value === undefined) return undefined;
  if (!RUNNER_CLAIM_SCOPES.includes(value as RunnerClaimScope)) {
    throw new Error(`claimScope must be one of: ${RUNNER_CLAIM_SCOPES.join(", ")} (got ${JSON.stringify(value)})`);
  }
  return value as RunnerClaimScope;
}

function envFileKey(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;
  const assignment = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const eq = assignment.indexOf("=");
  if (eq <= 0) return undefined;
  const key = assignment.slice(0, eq).trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : undefined;
}

/**
 * Write (or merge into) the per-station runner env file at mode 0600. Only the
 * non-credential identity keys (`LOOPS_RUNNER_MACHINE_ID`,
 * `LOOPS_RUNNER_CLAIM_SCOPE`) are written here; existing lines — including the
 * control-plane URL and API key written by the provision step — are preserved
 * byte-for-byte, so this never touches a live credential.
 */
export function writeRunnerEnvConfig(
  values: { claimScope?: string; machineId?: string },
): RunnerEnvConfigResult {
  const claimScope = assertClaimScope(values.claimScope);
  const path = runnerEnvPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const updates: Array<[string, string]> = [];
  if (claimScope !== undefined) updates.push(["LOOPS_RUNNER_CLAIM_SCOPE", claimScope]);
  if (values.machineId !== undefined && values.machineId.trim() !== "") {
    updates.push(["LOOPS_RUNNER_MACHINE_ID", values.machineId.trim()]);
  }
  const updateKeys = new Set(updates.map(([key]) => key));
  let present = false;
  let kept: string[] = [];
  if (existsSync(path)) {
    present = true;
    kept = readFileSync(path, "utf8").split("\n").filter((line) => {
      const key = envFileKey(line);
      return !(key !== undefined && updateKeys.has(key));
    });
  }
  const body = [...kept, ...updates.map(([key, value]) => `${key}=${value}`)].join("\n") + "\n";
  writeFileSync(path, body, { mode: 0o600 });
  chmodSync(path, 0o600);
  return { path, present, wrote: updates.map(([key]) => key) };
}

/**
 * Write the package-owned runner service unit: a systemd-user unit on Linux
 * referencing the mode-600 env file via `EnvironmentFile` (the credential
 * never appears in the unit), and a launchd plist on macOS. On macOS launchd
 * has no EnvironmentFile primitive, so the runner loads the same env file
 * itself at startup. The run args carry `--claim-scope` so the unit's claim
 * scope is visible in the unit file, while the machine id lives in the env
 * file with the rest of the per-station config.
 */
export function installRunnerStartup(opts: RunnerStartupOptions): RunnerStartupResult {
  const cliEntry = opts.cliEntry;
  const execPath = opts.execPath ?? process.execPath;
  const platform = opts.platform ?? process.platform;
  const claimScope = assertClaimScope(opts.claimScope);
  const machineId = opts.machineId?.trim() || hostname();
  const pathEnv = normalizeExecutionPath(process.env);
  const dataDirPath = ensureDataDir();
  const runArgs = ["run", ...(claimScope === undefined ? [] : ["--claim-scope", claimScope])];
  const envFile = writeRunnerEnvConfig({ claimScope, machineId });
  if (platform === "linux") {
    const path = runnerSystemdServicePath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const execStart = [execPath, cliEntry, ...runArgs].map(systemdEscapeExecPart).join(" ");
    writeFileSync(
      path,
      `[Unit]
Description=Hasna Loops runner
After=basic.target

[Service]
Type=simple
ExecStart=${execStart}
WorkingDirectory=${systemdPathValue(dataDirPath)}
Restart=always
RestartPreventExitStatus=${RUNNER_PERMANENT_DENIAL_EXIT_CODE}
RestartSec=5
EnvironmentFile=-${systemdPathValue(runnerEnvPath())}
${systemdEnvironmentLine("PATH", pathEnv)}
${systemdEnvironmentLine("LOOPS_DATA_DIR", dataDirPath)}

[Install]
WantedBy=default.target
`,
    );
    return {
      platform,
      path,
      instructions: [
        "systemctl --user daemon-reload",
        `systemctl --user enable --now ${SERVICE_NAME}.service`,
        "loginctl enable-linger $USER",
      ],
      envFile,
    };
  }

  if (platform === "darwin") {
    const path = runnerLaunchdPlistPath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(
      path,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(execPath)}</string>
    <string>${xmlEscape(cliEntry)}</string>
${runArgs.map((arg) => `    <string>${xmlEscape(arg)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>WorkingDirectory</key><string>${xmlEscape(dataDirPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xmlEscape(pathEnv)}</string>
    <key>LOOPS_DATA_DIR</key><string>${xmlEscape(dataDirPath)}</string>
  </dict>
  <key>StandardOutPath</key><string>${xmlEscape(runnerLogPath())}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(runnerLogPath())}</string>
</dict>
</plist>
`,
    );
    chmodSync(path, 0o600);
    return {
      platform,
      path,
      instructions: launchctlCommands(path),
      envFile,
    };
  }

  throw new Error(`startup install is not implemented for ${platform}`);
}

export interface RunnerServiceResult {
  commands: StartupEnableResult[];
}

/**
 * Exit code the CLI should propagate for a service-control result: non-zero
 * when any underlying systemctl/launchctl command failed, so deployment
 * automation never sees exit 0 for a runner that failed to start or stop.
 */
export function runnerServiceExitCode(result: RunnerServiceResult): number {
  return result.commands.some((entry) => entry.status !== 0) ? 1 : 0;
}

function runServiceCommands(commands: string[], spawnImpl?: typeof spawnSync): RunnerServiceResult {
  const run = spawnImpl ?? spawnSync;
  return {
    commands: commands.map((command) => {
      const result = run("sh", ["-c", command], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return {
        command,
        status: result.status,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      };
    }),
  };
}

export function startRunnerService(
  opts: { platform?: NodeJS.Platform; spawnImpl?: typeof spawnSync } = {},
): RunnerServiceResult {
  const platform = opts.platform ?? process.platform;
  if (platform === "linux") {
    if (!existsSync(runnerSystemdServicePath())) {
      throw new Error(`${SERVICE_NAME} is not installed; run: loops-runner install`);
    }
    return runServiceCommands(
      ["systemctl --user daemon-reload", `systemctl --user enable --now ${SERVICE_NAME}.service`],
      opts.spawnImpl,
    );
  }
  if (platform === "darwin") {
    const plist = runnerLaunchdPlistPath();
    if (!existsSync(plist)) {
      throw new Error(`${SERVICE_NAME} is not installed; run: loops-runner install`);
    }
    return runServiceCommands(launchctlCommands(plist), opts.spawnImpl);
  }
  throw new Error(`runner service control is not implemented for ${platform}`);
}

export function stopRunnerService(
  opts: { platform?: NodeJS.Platform; spawnImpl?: typeof spawnSync } = {},
): RunnerServiceResult {
  const platform = opts.platform ?? process.platform;
  if (platform === "linux") {
    if (!existsSync(runnerSystemdServicePath())) {
      throw new Error(`${SERVICE_NAME} is not installed; run: loops-runner install`);
    }
    return runServiceCommands([`systemctl --user stop ${SERVICE_NAME}.service`], opts.spawnImpl);
  }
  if (platform === "darwin") {
    const plist = runnerLaunchdPlistPath();
    if (!existsSync(plist)) {
      throw new Error(`${SERVICE_NAME} is not installed; run: loops-runner install`);
    }
    return runServiceCommands(
      [
        `launchctl bootout gui/$(id -u) ${shellQuote(plist)} 2>/dev/null; s=$?; if [ "$s" -ne 0 ] && [ "$s" -ne 113 ]; then exit "$s"; fi`,
      ],
      opts.spawnImpl,
    );
  }
  throw new Error(`runner service control is not implemented for ${platform}`);
}

export interface RunnerServiceStatus {
  installed: boolean;
  active: boolean | null;
  unitPath?: string;
}

export function runnerServiceStatus(
  opts: { platform?: NodeJS.Platform; spawnImpl?: typeof spawnSync } = {},
): RunnerServiceStatus {
  const platform = opts.platform ?? process.platform;
  const unitPath =
    platform === "linux"
      ? runnerSystemdServicePath()
      : platform === "darwin"
        ? runnerLaunchdPlistPath()
        : undefined;
  if (unitPath === undefined || !existsSync(unitPath)) return { installed: false, active: null };
  const probe =
    platform === "linux"
      ? `systemctl --user is-active ${SERVICE_NAME}.service`
      : `launchctl print gui/$(id -u)/${LAUNCHD_LABEL}`;
  const run = (opts.spawnImpl ?? spawnSync)("sh", ["-c", probe], { encoding: "utf8" });
  return { installed: true, active: run.status === 0, unitPath };
}
