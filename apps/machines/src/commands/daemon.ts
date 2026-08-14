import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname } from "node:path";
import { platform as osPlatform } from "node:os";

export type DaemonServicePlatform = "macos" | "linux";
export type DaemonServiceMode = "user" | "system";
export type DaemonServiceAction = "install" | "uninstall" | "restart" | "status" | "logs";

export interface DaemonServiceOptions {
  action: DaemonServiceAction;
  platform?: DaemonServicePlatform | "darwin";
  mode?: DaemonServiceMode;
  serviceName?: string;
  executable?: string;
  intervalMs?: number;
  storagePush?: boolean;
  doctorSummary?: boolean;
  privateMetadata?: boolean | readonly string[];
  env?: readonly string[];
}

export interface DaemonServiceCommand {
  id: string;
  description: string;
  program: string;
  args: string[];
  sudo: boolean;
  mutates: boolean;
  allowFailure?: boolean;
  env?: Record<string, string>;
}

export interface DaemonServiceFile {
  id: string;
  description: string;
  path: string;
  mode: string;
  content: string;
}

export interface DaemonServicePlan {
  platform: DaemonServicePlatform;
  mode: DaemonServiceMode;
  action: DaemonServiceAction;
  serviceName: string;
  serviceId: string;
  executable: string;
  intervalMs: number;
  commands: DaemonServiceCommand[];
  files: DaemonServiceFile[];
  warnings: string[];
  manualSteps: string[];
}

export interface DaemonServiceRunOptions {
  apply?: boolean;
  yes?: boolean;
}

export interface DaemonServiceCommandResult {
  id: string;
  command: string[];
  skipped: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface DaemonServiceRunResult {
  mode: "plan" | "apply";
  applied: boolean;
  plan: DaemonServicePlan;
  filesWritten: string[];
  commands: DaemonServiceCommandResult[];
  warnings: string[];
}

interface ResolvedDaemonServiceOptions {
  action: DaemonServiceAction;
  platform: DaemonServicePlatform;
  mode: DaemonServiceMode;
  serviceName: string;
  serviceId: string;
  executable: string;
  intervalMs: number;
  env: Record<string, string>;
  warnings: string[];
}

const DEFAULT_SERVICE_NAME = "machines-agent";
const DEFAULT_EXECUTABLE = "/usr/local/bin/machines-agent";
const DEFAULT_INTERVAL_MS = 30000;
const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const SERVICE_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function buildDaemonServicePlan(options: DaemonServiceOptions): DaemonServicePlan {
  const resolved = resolveDaemonServiceOptions(options);
  const files = resolved.action === "install" ? [buildServiceFile(resolved)] : [];
  return {
    platform: resolved.platform,
    mode: resolved.mode,
    action: resolved.action,
    serviceName: resolved.serviceName,
    serviceId: resolved.serviceId,
    executable: resolved.executable,
    intervalMs: resolved.intervalMs,
    commands: buildActionCommands(resolved),
    files,
    warnings: resolved.warnings,
    manualSteps: buildManualSteps(resolved, files),
  };
}

export function runDaemonServicePlan(plan: DaemonServicePlan, options: DaemonServiceRunOptions = {}): DaemonServiceRunResult {
  const apply = options.apply === true;
  const allowed = apply && options.yes === true;
  const warnings = [...plan.warnings];
  const filesWritten: string[] = [];
  const commands: DaemonServiceCommandResult[] = [];

  if (apply && !allowed) {
    warnings.push("apply_requires_yes");
  }

  if (allowed) {
    for (const file of plan.files) {
      const path = expandShellPath(file.path);
      let content: string;
      try {
        content = materializePlaceholders(file.content);
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
        return {
          mode: "plan",
          applied: false,
          plan,
          filesWritten,
          commands: plan.commands.map((commandSpec) => ({
            id: commandSpec.id,
            command: renderCommand(commandSpec),
            skipped: true,
            exitCode: null,
            stdout: "",
            stderr: "",
          })),
          warnings,
        };
      }
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
      chmodSync(path, Number.parseInt(file.mode, 8));
      filesWritten.push(path);
    }
  }

  for (const commandSpec of plan.commands) {
    const commandLine = renderCommand(commandSpec);
    if (!allowed) {
      commands.push({
        id: commandSpec.id,
        command: commandLine,
        skipped: true,
        exitCode: null,
        stdout: "",
        stderr: "",
      });
      continue;
    }
    const program = commandLine[0]!;
    const args = commandLine.slice(1);
    try {
      const result = execFileSync(program, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      commands.push({
        id: commandSpec.id,
        command: commandLine,
        skipped: false,
        exitCode: 0,
        stdout: result,
        stderr: "",
      });
    } catch (error) {
      const maybe = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
      if (commandSpec.allowFailure) {
        commands.push({
          id: commandSpec.id,
          command: commandLine,
          skipped: false,
          exitCode: typeof maybe.status === "number" ? maybe.status : 1,
          stdout: String(maybe.stdout ?? ""),
          stderr: String(maybe.stderr ?? ""),
          error: maybe.message ?? String(error),
        });
        continue;
      }
      commands.push({
        id: commandSpec.id,
        command: commandLine,
        skipped: false,
        exitCode: typeof maybe.status === "number" ? maybe.status : 1,
        stdout: String(maybe.stdout ?? ""),
        stderr: String(maybe.stderr ?? ""),
        error: maybe.message ?? String(error),
      });
      break;
    }
  }

  return {
    mode: allowed ? "apply" : "plan",
    applied: allowed,
    plan,
    filesWritten,
    commands,
    warnings,
  };
}

export function buildDaemonInstallPlan(options: Omit<DaemonServiceOptions, "action"> = {}): DaemonServicePlan {
  return buildDaemonServicePlan({ ...options, action: "install" });
}

export function buildDaemonUninstallPlan(options: Omit<DaemonServiceOptions, "action"> = {}): DaemonServicePlan {
  return buildDaemonServicePlan({ ...options, action: "uninstall" });
}

export function buildDaemonRestartPlan(options: Omit<DaemonServiceOptions, "action"> = {}): DaemonServicePlan {
  return buildDaemonServicePlan({ ...options, action: "restart" });
}

export function buildDaemonStatusPlan(options: Omit<DaemonServiceOptions, "action"> = {}): DaemonServicePlan {
  return buildDaemonServicePlan({ ...options, action: "status" });
}

export function buildDaemonLogsPlan(options: Omit<DaemonServiceOptions, "action"> = {}): DaemonServicePlan {
  return buildDaemonServicePlan({ ...options, action: "logs" });
}

export function renderLaunchdPlist(options: Omit<DaemonServiceOptions, "action"> = {}): string {
  const resolved = resolveDaemonServiceOptions({ ...options, action: "install", platform: "macos" });
  return launchdPlist(resolved);
}

export function renderSystemdUnit(options: Omit<DaemonServiceOptions, "action"> = {}): string {
  const resolved = resolveDaemonServiceOptions({ ...options, action: "install", platform: "linux" });
  return systemdUnit(resolved);
}

function resolveDaemonServiceOptions(options: DaemonServiceOptions): ResolvedDaemonServiceOptions {
  const warnings: string[] = [];
  const serviceName = normalizeServiceName(options.serviceName, warnings);
  const platform = normalizePlatform(options.platform, warnings);
  const mode = options.mode ?? "user";
  const intervalMs = normalizeIntervalMs(options.intervalMs, warnings);
  const executable = options.executable?.trim() || DEFAULT_EXECUTABLE;
  if (platform === "linux" && !executable.startsWith("/")) {
    warnings.push("systemd units should use an absolute executable path; install plan keeps the provided path unchanged.");
  }

  return {
    action: options.action,
    platform,
    mode,
    serviceName,
    serviceId: serviceName,
    executable,
    intervalMs,
    env: buildEnvironment(serviceName, executable, options, warnings),
    warnings,
  };
}

function normalizeServiceName(value: string | undefined, warnings: string[]): string {
  const serviceName = value?.trim() || DEFAULT_SERVICE_NAME;
  if (SERVICE_NAME_PATTERN.test(serviceName)) return serviceName;
  warnings.push(`Invalid serviceName "${serviceName}"; using ${DEFAULT_SERVICE_NAME}.`);
  return DEFAULT_SERVICE_NAME;
}

function normalizePlatform(value: DaemonServiceOptions["platform"], warnings: string[]): DaemonServicePlatform {
  const raw = value ?? osPlatform();
  if (raw === "darwin" || raw === "macos") return "macos";
  if (raw === "linux") return "linux";
  warnings.push(`Unsupported platform "${raw}"; using linux service planning.`);
  return "linux";
}

function normalizeIntervalMs(value: number | undefined, warnings: string[]): number {
  if (value === undefined) return DEFAULT_INTERVAL_MS;
  if (Number.isInteger(value) && value > 0) return value;
  warnings.push(`Invalid intervalMs "${String(value)}"; using ${DEFAULT_INTERVAL_MS}.`);
  return DEFAULT_INTERVAL_MS;
}

function buildEnvironment(
  serviceName: string,
  executable: string,
  options: DaemonServiceOptions,
  warnings: string[],
): Record<string, string> {
  const env: Record<string, string> = {
    HASNA_MACHINES_AGENT_MODE: "daemon",
    HASNA_MACHINES_AGENT_SERVICE: serviceName,
  };
  const executableDir = dirname(executable);
  if (!isStandardExecutableDir(executableDir)) {
    env["PATH"] = `${executableDir}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
  }

  if (options.storagePush) {
    env["HASNA_MACHINES_AGENT_STORAGE_PUSH"] = "1";
    env["HASNA_MACHINES_AGENT_STORAGE_PUSH_BACKOFF_MS"] = "250";
    env["HASNA_MACHINES_AGENT_STORAGE_PUSH_RETRIES"] = "2";
    // No mode var: storage push needs only the DSN placeholder, and deployment
    // modes were removed (owner directive 2026-07-29).
    env["HASNA_MACHINES_DATABASE_URL"] = placeholderForEnv("HASNA_MACHINES_DATABASE_URL");
    warnings.push("storagePush is represented with env placeholders; no database URL is embedded in the plan.");
  }

  if (options.doctorSummary) {
    env["HASNA_MACHINES_AGENT_DOCTOR_SUMMARY"] = "1";
  }

  if (options.privateMetadata === true) {
    env["HASNA_MACHINES_PRIVATE_METADATA"] = "1";
    warnings.push("privateMetadata=true enables private host/network facts in heartbeat rows; do not share private-mode output publicly.");
  } else if (Array.isArray(options.privateMetadata)) {
    addEnvPlaceholders(env, options.privateMetadata, warnings);
  }

  addEnvPlaceholders(env, options.env ?? [], warnings);
  return Object.fromEntries(Object.entries(env).sort(([left], [right]) => left.localeCompare(right)));
}

function isStandardExecutableDir(path: string): boolean {
  return ["/bin", "/usr/bin", "/usr/local/bin", "/usr/sbin", "/sbin"].includes(path);
}

function addEnvPlaceholders(env: Record<string, string>, names: readonly string[], warnings: string[]): void {
  for (const rawName of names) {
    const name = rawName.trim();
    if (!ENV_NAME_PATTERN.test(name)) {
      warnings.push(`Invalid environment variable name "${rawName}"; skipped.`);
      continue;
    }
    env[name] = placeholderForEnv(name);
  }
}

function placeholderForEnv(name: string): string {
  return `<set:${name}>`;
}

function buildServiceFile(options: ResolvedDaemonServiceOptions): DaemonServiceFile {
  if (options.platform === "macos") {
    return {
      id: "launchd-plist",
      description: "launchd property list for machines-agent",
      path: launchdPlistPath(options),
      mode: "0644",
      content: launchdPlist(options),
    };
  }
  return {
    id: "systemd-unit",
    description: "systemd unit for machines-agent",
    path: systemdUnitPath(options),
    mode: "0644",
    content: systemdUnit(options),
  };
}

function buildActionCommands(options: ResolvedDaemonServiceOptions): DaemonServiceCommand[] {
  if (options.platform === "macos") return buildLaunchdCommands(options);
  return buildSystemdCommands(options);
}

function buildLaunchdCommands(options: ResolvedDaemonServiceOptions): DaemonServiceCommand[] {
  const domain = launchdDomain(options);
  const serviceTarget = `${domain}/${options.serviceId}`;
  const plistPath = launchdPlistPath(options);
  const sudo = options.mode === "system";

  if (options.action === "install") {
    return [
      command("launchd-bootout-existing", "Unload any existing launchd job before bootstrap.", "launchctl", ["bootout", domain, plistPath], sudo, true, true),
      command("launchd-bootstrap", "Load the planned launchd plist.", "launchctl", ["bootstrap", domain, plistPath], sudo, true),
      command("launchd-enable", "Enable the launchd service.", "launchctl", ["enable", serviceTarget], sudo, true),
      command("launchd-kickstart", "Start or restart the launchd service.", "launchctl", ["kickstart", "-k", serviceTarget], sudo, true),
    ];
  }

  if (options.action === "uninstall") {
    return [
      command("launchd-bootout", "Unload the launchd job.", "launchctl", ["bootout", domain, plistPath], sudo, true),
      command("remove-launchd-plist", "Remove the planned launchd plist file.", "rm", ["-f", plistPath], sudo, true),
    ];
  }

  if (options.action === "restart") {
    return [command("launchd-kickstart", "Restart the launchd service.", "launchctl", ["kickstart", "-k", serviceTarget], sudo, true)];
  }

  if (options.action === "status") {
    return [command("launchd-print", "Print launchd service status.", "launchctl", ["print", serviceTarget], sudo, false)];
  }

  return [
    command(
      "launchd-logs",
      "Stream logs for machines-agent.",
      "log",
      ["stream", "--style", "compact", "--predicate", `process == "${basename(options.executable)}" OR eventMessage CONTAINS "${options.serviceId}"`],
      false,
      false,
    ),
  ];
}

function buildSystemdCommands(options: ResolvedDaemonServiceOptions): DaemonServiceCommand[] {
  const userFlag = options.mode === "user" ? ["--user"] : [];
  const sudo = options.mode === "system";
  const unitName = systemdUnitName(options);
  const daemonReload = command("systemd-daemon-reload", "Reload systemd unit metadata.", "systemctl", [...userFlag, "daemon-reload"], sudo, true);

  if (options.action === "install") {
    return [
      daemonReload,
      command("systemd-enable-now", "Enable and start the systemd service.", "systemctl", [...userFlag, "enable", "--now", unitName], sudo, true),
    ];
  }

  if (options.action === "uninstall") {
    return [
      command("systemd-disable-now", "Stop and disable the systemd service.", "systemctl", [...userFlag, "disable", "--now", unitName], sudo, true),
      command("remove-systemd-unit", "Remove the planned systemd unit file.", "rm", ["-f", systemdUnitPath(options)], sudo, true),
      daemonReload,
    ];
  }

  if (options.action === "restart") {
    return [command("systemd-restart", "Restart the systemd service.", "systemctl", [...userFlag, "restart", unitName], sudo, true)];
  }

  if (options.action === "status") {
    return [command("systemd-status", "Show systemd service status.", "systemctl", [...userFlag, "status", unitName, "--no-pager"], sudo, false)];
  }

  return [
    command("systemd-logs", "Follow journal logs for the service.", "journalctl", [...userFlag, "-u", unitName, "-f", "--no-pager"], sudo, false),
  ];
}

function buildManualSteps(options: ResolvedDaemonServiceOptions, files: DaemonServiceFile[]): string[] {
  const steps: string[] = [];
  if (files[0]) steps.push(`Write ${files[0].id} content to ${files[0].path} with mode ${files[0].mode}.`);
  if (options.mode === "system") steps.push("Run commands marked sudo with root privileges.");
  if (options.platform === "linux" && options.mode === "user") {
    steps.push("Run commands as the target user; enable lingering separately if the service must survive logout.");
  }
  if (options.action === "logs") steps.push("Stop the log command manually when finished.");
  return steps;
}

function command(
  id: string,
  description: string,
  program: string,
  args: string[],
  sudo: boolean,
  mutates: boolean,
  allowFailure = false,
): DaemonServiceCommand {
  return { id, description, program, args, sudo, mutates, ...(allowFailure ? { allowFailure: true } : {}) };
}

function renderCommand(commandSpec: DaemonServiceCommand): string[] {
  const expanded = [commandSpec.program, ...commandSpec.args].map(expandShellPath);
  if (commandSpec.sudo) return ["sudo", ...expanded];
  return expanded;
}

function expandShellPath(path: string): string {
  if (path.startsWith("$HOME/")) return `${process.env["HOME"] ?? ""}/${path.slice("$HOME/".length)}`;
  return path
    .replaceAll("$HOME", process.env["HOME"] ?? "")
    .replaceAll("$UID", String(process.getuid ? process.getuid() : ""));
}

function materializePlaceholders(content: string): string {
  return content.replace(/(?:<set:([A-Z_][A-Z0-9_]*)>|&lt;set:([A-Z_][A-Z0-9_]*)&gt;)/g, (_match, rawName: string | undefined, escapedName: string | undefined) => {
    const name = rawName ?? escapedName ?? "";
    const value = process.env[name];
    if (value === undefined || value === "") {
      throw new Error(`Missing environment variable required for service apply: ${name}`);
    }
    if (/[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error(`Environment variable ${name} contains control characters; refusing to write service file.`);
    }
    return escapedName ? xmlEscape(value) : escapeSystemdEnvironmentValue(value);
  });
}

function escapeSystemdEnvironmentValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%");
}

function launchdPlist(options: ResolvedDaemonServiceOptions): string {
  const env = Object.entries(options.env)
    .map(([name, value]) => `    <key>${xmlEscape(name)}</key>\n    <string>${xmlEscape(value)}</string>`)
    .join("\n");
  const programArguments = daemonProgramArguments(options)
    .map((value) => `    <string>${xmlEscape(value)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(options.serviceId)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(launchdLogPath(options, "out"))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(launchdLogPath(options, "err"))}</string>
</dict>
</plist>
`;
}

function systemdUnit(options: ResolvedDaemonServiceOptions): string {
  const env = Object.entries(options.env)
    .map(([name, value]) => `Environment=${quoteSystemdEnvironment(name, value)}`)
    .join("\n");
  const execStart = daemonProgramArguments(options).map(quoteSystemdExecArg).join(" ");
  return `[Unit]
Description=Hasna machines agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=always
RestartSec=10
${env}

[Install]
WantedBy=${options.mode === "system" ? "multi-user.target" : "default.target"}
`;
}

function daemonProgramArguments(options: ResolvedDaemonServiceOptions): string[] {
  const bunRuntime = bunRuntimeForExecutable(options.executable);
  const base = bunRuntime ? [bunRuntime, options.executable] : [options.executable];
  return [...base, "--interval-ms", String(options.intervalMs)];
}

function bunRuntimeForExecutable(executable: string): string | null {
  if (!isBunShebangScript(executable)) return null;
  for (const candidate of bunRuntimeCandidates(executable)) {
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

function bunRuntimeCandidates(executable: string): string[] {
  const candidates = [
    `${dirname(executable)}/bun`,
    process.env["BUN_INSTALL"] ? `${process.env["BUN_INSTALL"]}/bin/bun` : null,
    process.env["HOME"] ? `${process.env["HOME"]}/.bun/bin/bun` : null,
    ...(process.env["PATH"] ?? "").split(delimiter).filter(Boolean).map((entry) => `${entry}/bun`),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(candidates)];
}

function isBunShebangScript(executable: string): boolean {
  try {
    const content = readFileSync(executable, "utf8").slice(0, 256);
    const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
    return /^#!.*\bbun\b/.test(firstLine);
  } catch {
    return false;
  }
}

function isExecutableFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const stats = statSync(path);
    return stats.isFile() && (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function launchdDomain(options: ResolvedDaemonServiceOptions): string {
  return options.mode === "system" ? "system" : "gui/$UID";
}

function launchdPlistPath(options: ResolvedDaemonServiceOptions): string {
  if (options.mode === "system") return `/Library/LaunchDaemons/${options.serviceId}.plist`;
  return `$HOME/Library/LaunchAgents/${options.serviceId}.plist`;
}

function launchdLogPath(options: ResolvedDaemonServiceOptions, stream: "out" | "err"): string {
  const fileName = `${options.serviceId}.${stream}.log`;
  if (options.mode === "system") return `/var/log/${fileName}`;
  return `${process.env["HOME"] ?? "/tmp"}/Library/Logs/${fileName}`;
}

function systemdUnitName(options: ResolvedDaemonServiceOptions): string {
  return `${options.serviceId}.service`;
}

function systemdUnitPath(options: ResolvedDaemonServiceOptions): string {
  if (options.mode === "system") return `/etc/systemd/system/${systemdUnitName(options)}`;
  return `$HOME/.config/systemd/user/${systemdUnitName(options)}`;
}

function xmlEscape(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function quoteSystemdExecArg(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value) && !value.includes("%")) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;
}

function quoteSystemdEnvironment(name: string, value: string): string {
  return `"${name}=${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) || path;
}
