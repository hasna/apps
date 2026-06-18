#!/usr/bin/env bun
import { Command } from "commander";
import { registerEventCommands, registerWebhookCommands } from "@hasna/events/commander";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import { getPackageVersion } from "../version.js";
import {
  manifestAdd,
  manifestBootstrapCurrentMachine,
  manifestGet,
  manifestInit,
  manifestList,
  manifestRemove,
  manifestValidate,
} from "../commands/manifest.js";
import { buildSetupPlan, runSetup } from "../commands/setup.js";
import { buildBackupPlan, runBackup } from "../commands/backup.js";
import { buildCertPlan, runCertPlan } from "../commands/cert.js";
import { addDomainMapping, listDomainMappings, renderDomainMapping } from "../commands/dns.js";
import { diffMachines } from "../commands/diff.js";
import { buildAppsPlan, diffApps, getAppsStatus, listApps, runAppsInstall } from "../commands/apps.js";
import {
  buildClaudeInstallPlan,
  diffClaudeCli,
  getClaudeCliStatus,
  runClaudeInstall,
} from "../commands/install-claude.js";
import { buildTailscaleInstallPlan, runTailscaleInstall } from "../commands/install-tailscale.js";
import {
  addNotificationChannel,
  dispatchNotificationEvent,
  listNotificationChannels,
  removeNotificationChannel,
  testNotificationChannel,
} from "../commands/notifications.js";
import { listPorts } from "../commands/ports.js";
import { watchTmuxPane } from "../commands/runtime.js";
import { buildSshCommand, resolveSshTarget } from "../commands/ssh.js";
import { resolveScreenTarget, buildScreenCommand, buildScreenEnableCommand, resolveScreenCredentials } from "../commands/screen.js";
import { buildSyncPlan, runSync } from "../commands/sync.js";
import { getStatus } from "../commands/status.js";
import { repairWorkspaceManifestMappings, type WorkspaceManifestRepairResult } from "../commands/workspace.js";
import { discoverMachineTopology, redactRouteForOutput, redactTopologyForOutput, resolveMachineRoute, resolveMachineWorkspace } from "../topology.js";
import {
  checkMachineCompatibility,
  type CompatibilityCheck,
  type CompatibilityCommandSpec,
  type CompatibilityPackageSpec,
  type CompatibilityWorkspaceSpec,
} from "../compatibility.js";
import { runDoctor } from "../commands/doctor.js";
import {
  buildDaemonServicePlan,
  runDaemonServicePlan,
  type DaemonServiceAction,
  type DaemonServiceOptions,
  type DaemonServicePlan,
} from "../commands/daemon.js";
import { runSelfTest } from "../commands/self-test.js";
import { getServeInfo, startDashboardServer } from "../commands/serve.js";
import { clearClipboardHistory, getDefaultClipboardConfig, getOrCreateClipboardKey, getClipboardStatus, readClipboardConfig, readClipboardHistory, writeClipboardConfig, getConfigPath } from "../commands/clipboard.js";
import { startClipboardDaemon, stopClipboardDaemon } from "../commands/clipboard-daemon.js";
import { readHealConfig, writeHealConfig, readHealState, type HealConfig } from "../commands/heal.js";
import {
  runHealOnce,
  startHealDaemon,
  stopHealDaemon,
  applyDeterminism,
  enableHardwareWatchdog,
  installHealService,
  uninstallHealService,
  healServiceStatus,
} from "../commands/heal-daemon.js";
import { getManifestPath, getClipboardKeyPath } from "../paths.js";
import { parseIntegerOption, renderKeyValueTable, renderList } from "../cli-utils.js";
import { rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import type {
  AppsDiffResult,
  AppsStatusResult,
  ClaudeCliDiffResult,
  ClaudeCliStatusResult,
  DoctorReport,
  FleetStatus,
  MachineManifest,
  NotificationConfig,
  NotificationDispatchSummary,
  NotificationTestResult,
  SelfTestResult,
  ClipboardConfig,
} from "../types.js";

const program = new Command();

function printJsonOrText(data: unknown, text: string, json = false): void {
  if (json || program.opts().quiet) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(text);
}

interface PrintableStorageResult {
  table: string;
  rowsRead: number;
  rowsWritten: number;
  errors: string[];
}

function printStorageResults(results: PrintableStorageResult[], json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const result of results) {
    const marker = result.errors.length > 0 ? chalk.red("!") : chalk.green("✓");
    const suffix = result.errors.length > 0 ? `  ${chalk.red(result.errors.join("; "))}` : "";
    console.log(`${marker} ${result.table}: read ${result.rowsRead}, wrote ${result.rowsWritten}${suffix}`);
  }
}

function printStorageError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red(message));
  process.exit(1);
}

function renderAppsListResult(result: ReturnType<typeof listApps>): string {
  return [
    `machine: ${result.machineId}`,
    renderList("apps", result.apps.map((app) => `${app.name}${app.manager ? ` (${app.manager})` : ""}`)),
  ].join("\n");
}

function renderAppsStatusResult(result: AppsStatusResult): string {
  const lines = result.apps.map((app) => {
    const state = app.installed ? chalk.green("installed") : chalk.yellow("missing");
    return `${app.name.padEnd(18)} ${state} ${app.version ? `v${app.version}` : ""}`.trimEnd();
  });
  return [`machine: ${result.machineId} (${result.source})`, ...lines].join("\n");
}

function renderAppsDiffResult(result: AppsDiffResult): string {
  return [
    `machine: ${result.machineId} (${result.source})`,
    renderList("missing", result.missing),
    renderList("installed", result.installed),
  ].join("\n");
}

function renderClaudeStatusResult(result: ClaudeCliStatusResult): string {
  const lines = result.tools.map((tool) => {
    const state = tool.installed ? chalk.green("installed") : chalk.yellow("missing");
    return `${tool.tool.padEnd(8)} ${state} ${tool.version || ""}`.trimEnd();
  });
  return [`machine: ${result.machineId} (${result.source})`, ...lines].join("\n");
}

function renderClaudeDiffResult(result: ClaudeCliDiffResult): string {
  return [
    `machine: ${result.machineId} (${result.source})`,
    renderList("missing", result.missing),
    renderList("installed", result.installed),
  ].join("\n");
}

function renderNotificationConfigResult(config: NotificationConfig): string {
  if (config.channels.length === 0) {
    return "notification channels: none";
  }
  return config.channels
    .map((channel) => `${channel.id} ${channel.enabled ? chalk.green("enabled") : chalk.yellow("disabled")} ${channel.type} -> ${channel.target}`)
    .join("\n");
}

function renderNotificationTestResult(result: NotificationTestResult): string {
  return renderKeyValueTable([
    ["channel", result.channelId],
    ["mode", result.mode],
    ["delivered", String(result.delivered)],
    ["detail", result.detail],
    ["preview", result.preview],
  ]);
}

function renderNotificationDispatchResult(result: NotificationDispatchSummary): string {
  return [
    `event: ${result.event}`,
    `message: ${result.message}`,
    ...result.deliveries.map((delivery) =>
      `${delivery.channelId} ${delivery.delivered ? chalk.green("delivered") : chalk.red("failed")} ${delivery.transport} ${delivery.detail}`
    ),
  ].join("\n");
}

function renderDoctorResult(report: DoctorReport): string {
  const header = `machine: ${report.machineId} (${report.source})`;
  const lines = report.checks.map((check) => {
    const status = check.status === "ok" ? chalk.green(check.status) : check.status === "warn" ? chalk.yellow(check.status) : chalk.red(check.status);
    return `${check.id.padEnd(20)} ${status} ${check.detail}`;
  });
  return [header, ...lines].join("\n");
}

function renderSelfTestResult(result: SelfTestResult): string {
  return [
    `machine: ${result.machineId}`,
    ...result.checks.map((check) => {
      const status = check.status === "ok" ? chalk.green(check.status) : check.status === "warn" ? chalk.yellow(check.status) : chalk.red(check.status);
      return `${check.id.padEnd(20)} ${status} ${check.detail}`;
    }),
  ].join("\n");
}

function checkSecretPresence(secretsCommand: string, key: string): { checked: true; present: boolean; error?: string } {
  const result = Bun.spawnSync([secretsCommand, "get", key], {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const stdout = result.stdout.toString().trim();
  return {
    checked: true,
    present: result.exitCode === 0 && stdout.length > 0,
    error: result.exitCode === 0 ? undefined : result.stderr.toString().trim() || `secrets get exited ${result.exitCode}`,
  };
}

function parseCommandSpec(value: string): CompatibilityCommandSpec {
  const [command, expectedVersion] = value.split(":");
  return {
    command,
    expectedVersion: expectedVersion || undefined,
    required: true,
  };
}

function parsePackageSpec(value: string): CompatibilityPackageSpec {
  const [name, command, expectedVersion] = value.split(":");
  return {
    name,
    command: command || undefined,
    expectedVersion: expectedVersion || undefined,
    required: true,
  };
}

function parseWorkspaceSpec(value: string): CompatibilityWorkspaceSpec {
  const [label, rest] = value.includes("=") ? value.split(/=(.*)/s).filter(Boolean) : ["workspace", value];
  const [path, expectedPackageName, expectedVersion] = rest.split(":");
  return {
    label,
    path,
    expectedPackageName: expectedPackageName || undefined,
    expectedVersion: expectedVersion || undefined,
    required: true,
  };
}

function renderCompatibilityCheck(check: CompatibilityCheck): string {
  const marker = check.status === "ok" ? chalk.green("✓") : check.status === "warn" ? chalk.yellow("!") : chalk.red("✗");
  const expected = check.expected ? ` expected=${check.expected}` : "";
  return `${marker} ${check.id} ${check.actual ?? "unknown"}${expected}`;
}

function renderCompatibilityResult(result: ReturnType<typeof checkMachineCompatibility>): string {
  return [
    renderKeyValueTable([
      ["machine", result.machine_id],
      ["source", result.source],
      ["ok", String(result.ok)],
      ["checks", `${result.summary.ok} ok, ${result.summary.warn} warn, ${result.summary.fail} fail`],
    ]),
    "",
    ...result.checks.map(renderCompatibilityCheck),
  ].join("\n");
}

function renderWorkspaceResolution(result: ReturnType<typeof resolveMachineWorkspace>): string {
  const diagnosticSummary = result.diagnostics.reduce((summary, entry) => {
    summary[entry.severity] += 1;
    return summary;
  }, { ok: 0, warn: 0, fail: 0 });
  const diagnosticLines = result.diagnostics
    .filter((entry) => entry.severity !== "ok")
    .map((entry) => `${entry.id}: ${entry.status} ${entry.message}`);
  const repairLines = result.repair_hints.map((hint) => `${hint.reason}: ${hint.shell_command}`);
  return renderKeyValueTable([
    ["machine", result.machine_id ?? result.requested_machine_id],
    ["ok", String(result.ok)],
    ["project", result.project.project_id],
    ["repo", result.project.repo_name ?? "unknown"],
    ["current", String(result.machine.current)],
    ["primary", String(result.machine.primary)],
    ["trust", result.machine.trust_status],
    ["auth", result.machine.auth_status],
    ["workspace root", `${result.paths.workspace_root.path ?? "unresolved"} (${result.paths.workspace_root.source})`],
    ["project root", `${result.paths.project_root.path ?? "unresolved"} (${result.paths.project_root.source})`],
    ["open-files root", `${result.paths.open_files_root.path ?? "unresolved"} (${result.paths.open_files_root.source})`],
    ["diagnostics", `${diagnosticSummary.ok} ok, ${diagnosticSummary.warn} warn, ${diagnosticSummary.fail} fail`],
    ["warnings", result.warnings.join(", ") || "none"],
  ]) + "\n" + renderList("issues", diagnosticLines) + "\n" + renderList("repair hints", repairLines);
}

function renderWorkspaceRepairResult(result: WorkspaceManifestRepairResult): string {
  const patchLines = result.patches.map((patch) => {
    const path = patch.path ?? "unresolved";
    const previous = patch.previous_path ? ` previous=${patch.previous_path}` : "";
    return `${patch.field}.${patch.key}: ${patch.status} ${path}${previous}`;
  });
  return [
    renderKeyValueTable([
      ["machine", result.machine_id ?? "unresolved"],
      ["project", result.project_id],
      ["trusted", String(result.trusted)],
      ["applied", String(result.applied)],
      ["manifest", result.manifest_path],
      ["warnings", result.warnings.join(", ") || "none"],
    ]),
    renderList("patches", patchLines),
  ].join("\n");
}

function renderFleetStatus(status: FleetStatus): string {
  return [
    renderKeyValueTable([
      ["machine", status.machineId],
      ["manifest", status.manifestPath],
      ["db", status.dbPath],
      ["notifications", status.notificationsPath],
      ["manifest machines", String(status.manifestMachineCount)],
      ["heartbeats", String(status.heartbeatCount)],
      ["setup runs", String(status.recentSetupRuns)],
      ["sync runs", String(status.recentSyncRuns)],
    ]),
    "",
    ...status.machines.map((machine) =>
      `${machine.machineId.padEnd(18)} ${machine.platform || "unknown"} ${machine.heartbeatStatus} ${machine.agentMode || "agent:unknown"} ${machine.storageSyncStatus || "storage:unknown"} ${machine.lastHeartbeatAt || "—"}`
    ),
  ].join("\n");
}

function renderShellCommand(command: { program: string; args: string[]; sudo: boolean }): string {
  const parts = command.sudo ? ["sudo", command.program, ...command.args] : [command.program, ...command.args];
  return parts.map((part) => /^[A-Za-z0-9_@%+=:,./$-]+$/.test(part) ? part : JSON.stringify(part)).join(" ");
}

function renderDaemonPlan(plan: DaemonServicePlan): string {
  const files = plan.files.map((file) => `${file.path} (${file.mode})`);
  const commands = plan.commands.map((command) => `${command.mutates ? "apply" : "read"} ${command.id}: ${renderShellCommand(command)}`);
  return [
    renderKeyValueTable([
      ["action", plan.action],
      ["platform", plan.platform],
      ["mode", plan.mode],
      ["service", plan.serviceName],
      ["executable", plan.executable],
      ["interval", `${plan.intervalMs}ms`],
      ["warnings", plan.warnings.join(", ") || "none"],
    ]),
    renderList("files", files),
    renderList("commands", commands),
    renderList("manual steps", plan.manualSteps),
  ].join("\n");
}

function parseDaemonOptions(action: DaemonServiceAction, options: {
  platform?: string;
  mode?: string;
  serviceName?: string;
  executable?: string;
  intervalMs?: string;
  storagePush?: boolean;
  doctorSummary?: boolean;
  privateMetadata?: boolean;
  env?: string[];
}): DaemonServiceOptions {
  return {
    action,
    platform: options.platform as DaemonServiceOptions["platform"],
    mode: options.mode as DaemonServiceOptions["mode"],
    serviceName: options.serviceName,
    executable: options.executable,
    intervalMs: options.intervalMs ? parseIntegerOption(options.intervalMs, "interval-ms", { min: 1 }) : undefined,
    storagePush: options.storagePush,
    doctorSummary: options.doctorSummary,
    privateMetadata: options.privateMetadata,
    env: options.env,
  };
}

program
  .name("machines")
  .description("Machine fleet management CLI + MCP for developers")
  .version(getPackageVersion())
  .option("-q, --quiet", "Suppress non-essential output");

const manifestCommand = program.command("manifest").description("Manage the fleet manifest");
const appsCommand = program.command("apps").description("Manage installed applications per machine");
const notificationsCommand = program.command("notifications").description("Manage fleet alert delivery channels");
const eventWebhooksCommand = registerWebhookCommands(program, { source: "machines" });
eventWebhooksCommand.description("Manage shared event webhook subscriptions");
const webhookTestCommand = eventWebhooksCommand.commands.find((command: Command) => command.name() === "test");
const webhookOptions = (webhookTestCommand?.options ?? []) as Array<{ long?: string; defaultValue?: string }>;
const webhookMessageOption = webhookOptions.find((option) => option.long === "--message");
if (webhookMessageOption) {
  webhookMessageOption.defaultValue = "Shared events test delivery";
}
const eventsCommand = registerEventCommands(program, { source: "machines" });
eventsCommand.description("Emit, list, and replay shared events");
const runtimeCommand = program.command("runtime").description("Watch runtime conditions and emit shared events");
const clipboardCommand = program.command("clipboard").description("Real-time clipboard sync across fleet machines");
const installClaudeCommand = program.command("install-claude").description("Install or inspect Claude, Codex, and Gemini CLIs");
const daemonCommand = program.command("daemon").description("Install and inspect the machines-agent fleet daemon service");

function addDaemonLifecycleCommand(action: DaemonServiceAction, description: string): void {
  daemonCommand
    .command(action)
    .description(description)
    .option("--platform <platform>", "Service platform to plan for (macos, linux)")
    .option("--mode <mode>", "Service mode (user, system)", "user")
    .option("--service-name <name>", "Service name/label", "machines-agent")
    .option("--executable <path>", "Absolute machines-agent executable path")
    .option("--interval-ms <ms>", "Heartbeat interval in milliseconds")
    .option("--storage-push", "Configure daemon to push heartbeat rows to storage", false)
    .option("--doctor-summary", "Configure daemon to include lightweight doctor summaries", false)
    .option("--private-metadata", "Opt in to private host/network metadata in heartbeat rows", false)
    .option("--env <name...>", "Environment variable names to include as placeholders")
    .option("--apply", "Write service files and run planned commands", false)
    .option("--yes", "Confirm execution when using --apply", false)
    .option("-j, --json", "Print JSON output", false)
    .action((options: {
      platform?: string;
      mode?: string;
      serviceName?: string;
      executable?: string;
      intervalMs?: string;
      storagePush?: boolean;
      doctorSummary?: boolean;
      privateMetadata?: boolean;
      env?: string[];
      apply?: boolean;
      yes?: boolean;
      json?: boolean;
    }) => {
      const plan = buildDaemonServicePlan(parseDaemonOptions(action, options));
      const result = runDaemonServicePlan(plan, { apply: options.apply, yes: options.yes });
      if (options.json || options.apply) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(renderDaemonPlan(plan));
    });
}

addDaemonLifecycleCommand("install", "Plan or install the machines-agent daemon service");
addDaemonLifecycleCommand("uninstall", "Plan or uninstall the machines-agent daemon service");
addDaemonLifecycleCommand("restart", "Plan or restart the machines-agent daemon service");
addDaemonLifecycleCommand("status", "Plan a daemon service status command");
addDaemonLifecycleCommand("logs", "Plan a daemon service log command");

manifestCommand.command("init").description("Create an empty fleet manifest").action(() => {
  console.log(manifestInit());
});

manifestCommand.command("path").description("Print the manifest path").action(() => {
  console.log(getManifestPath());
});

manifestCommand.command("list").description("Print the fleet manifest").action(() => {
  console.log(JSON.stringify(manifestList(), null, 2));
});

manifestCommand.command("validate").description("Validate the fleet manifest").action(() => {
  console.log(JSON.stringify(manifestValidate(), null, 2));
});

manifestCommand.command("bootstrap").description("Detect and upsert the current machine into the manifest").action(() => {
  console.log(JSON.stringify(manifestBootstrapCurrentMachine(), null, 2));
});

manifestCommand
  .command("get")
  .description("Print a single machine from the manifest")
  .argument("<id>", "Machine identifier")
  .action((id: string) => {
    const machine = manifestGet(id);
    if (!machine) {
      process.exitCode = 1;
      console.error(`Machine not found: ${id}`);
      return;
    }
    console.log(JSON.stringify(machine, null, 2));
  });

manifestCommand
  .command("remove")
  .description("Remove a machine from the manifest")
  .argument("<id>", "Machine identifier")
  .action((id: string) => {
    console.log(JSON.stringify(manifestRemove(id), null, 2));
  });

manifestCommand
  .command("add")
  .description("Add or replace a machine in the fleet manifest")
  .option("--id <id>", "Machine identifier")
  .option("--platform <platform>", "linux | macos | windows")
  .option("--workspace-path <path>", "Primary workspace path")
  .option("--hostname <hostname>", "Machine hostname")
  .option("--ssh-address <sshAddress>", "Machine SSH address")
  .option("--tailscale-name <tailscaleName>", "Machine Tailscale DNS name")
  .option("--connection <connection>", "local | ssh | tailscale")
  .option("--bun-path <path>", "Bun executable directory")
  .option("--tag <tag...>", "Machine tags")
  .option("--package <name...>", "Desired packages")
  .option("--app <spec...>", "Desired apps as name[:manager[:packageName]]")
  .option("--file <spec...>", "File sync spec source:target[:copy|symlink]")
  .option("--metadata <json>", "Machine metadata as JSON")
  .option("--from-stdin", "Read the full MachineManifest JSON from stdin")
  .action((options: Record<string, string | string[] | boolean | undefined>) => {
    const fromStdin = Boolean(options["fromStdin"] || options["from-stdin"]);
    if (fromStdin) {
      if (process.stdin.isTTY) {
        console.error("error: --from-stdin requires piped input");
        process.exit(1);
      }
      const input = readFileSync(0, "utf8");
      const machine = JSON.parse(input) as MachineManifest;
      console.log(JSON.stringify(manifestAdd(machine), null, 2));
      return;
    }

    for (const key of ["id", "platform", "workspacePath"] as const) {
      if (typeof options[key] !== "string" || !options[key].trim()) {
        throw new Error(`manifest add requires --${key === "workspacePath" ? "workspace-path" : key} unless --from-stdin is used`);
      }
    }

    const packages = Array.isArray(options["package"])
      ? options["package"].map((name) => ({ name: String(name) }))
      : undefined;
    const files = Array.isArray(options["file"])
      ? options["file"].map((value) => {
          const [source, target, mode] = String(value).split(":");
          const normalizedMode: "copy" | "symlink" | undefined =
            mode === "symlink" ? "symlink" : mode === "copy" ? "copy" : undefined;
          return { source, target, mode: normalizedMode };
        })
      : undefined;
    const apps = Array.isArray(options["app"])
      ? options["app"].map((value) => {
          const [name, manager, packageName] = String(value).split(":");
          return {
            name,
            manager: manager as "brew" | "cask" | "apt" | "winget" | "custom" | undefined,
            packageName,
          };
        })
      : undefined;
    const metadata = typeof options["metadata"] === "string" ? JSON.parse(options["metadata"]) : undefined;
    const machine: MachineManifest = {
      id: String(options["id"]),
      hostname: options["hostname"] ? String(options["hostname"]) : undefined,
      sshAddress: options["sshAddress"] ? String(options["sshAddress"]) : undefined,
      tailscaleName: options["tailscaleName"] ? String(options["tailscaleName"]) : undefined,
      platform: String(options["platform"]) as MachineManifest["platform"],
      connection: options["connection"] ? (String(options["connection"]) as MachineManifest["connection"]) : undefined,
      workspacePath: String(options["workspacePath"]),
      bunPath: options["bunPath"] ? String(options["bunPath"]) : undefined,
      tags: Array.isArray(options["tag"]) ? options["tag"].map(String) : undefined,
      metadata,
      packages,
      apps,
      files,
    };
    console.log(JSON.stringify(manifestAdd(machine), null, 2));
  });

appsCommand
  .command("list")
  .description("List manifest-managed apps for a machine")
  .option("--machine <id>", "Machine identifier")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; json?: boolean }) => {
    const result = listApps(options.machine);
    printJsonOrText(result, renderAppsListResult(result), options.json);
  });

appsCommand
  .command("status")
  .description("Check installed state for manifest-managed apps")
  .option("--machine <id>", "Machine identifier")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; json?: boolean }) => {
    const result = getAppsStatus(options.machine);
    printJsonOrText(result, renderAppsStatusResult(result), options.json);
  });

appsCommand
  .command("diff")
  .description("Show missing and installed manifest-managed apps")
  .option("--machine <id>", "Machine identifier")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; json?: boolean }) => {
    const result = diffApps(options.machine);
    printJsonOrText(result, renderAppsDiffResult(result), options.json);
  });

appsCommand
  .command("plan")
  .description("Preview app install steps for a machine")
  .option("--machine <id>", "Machine identifier")
  .action((options: { machine?: string }) => {
    const result = buildAppsPlan(options.machine);
    console.log(JSON.stringify(result, null, 2));
  });

appsCommand
  .command("apply")
  .description("Install manifest-managed apps for a machine")
  .option("--machine <id>", "Machine identifier")
  .option("--yes", "Confirm execution", false)
  .action((options: { machine?: string; yes?: boolean }) => {
    const result = runAppsInstall(options.machine, { apply: true, yes: options.yes });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("setup")
  .description("Prepare a machine from the fleet manifest")
  .option("--machine <id>", "Machine identifier")
  .option("--apply", "Execute provisioning commands instead of previewing the plan", false)
  .option("--yes", "Confirm execution when using --apply", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; apply?: boolean; yes?: boolean; json?: boolean }) => {
    const result = options.apply ? runSetup(options.machine, { apply: true, yes: options.yes }) : buildSetupPlan(options.machine);
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("sync")
  .description("Reconcile a machine against the fleet manifest")
  .option("--machine <id>", "Machine identifier")
  .option("--apply", "Execute reconciliation commands instead of previewing the plan", false)
  .option("--yes", "Confirm execution when using --apply", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; apply?: boolean; yes?: boolean; json?: boolean }) => {
    const result = options.apply ? runSync(options.machine, { apply: true, yes: options.yes }) : buildSyncPlan(options.machine);
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("topology")
  .description("Discover local, manifest, heartbeat, SSH, and Tailscale machine topology")
  .option("--no-tailscale", "Skip tailscale status probing")
  .option("--private-metadata", "Print private host/network route fields", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { tailscale?: boolean; privateMetadata?: boolean; json?: boolean }) => {
    const rawTopology = discoverMachineTopology({ includeTailscale: options.tailscale !== false });
    const topology = redactTopologyForOutput(rawTopology, { privateMetadata: options.privateMetadata });
    if (options.json) {
      console.log(JSON.stringify(topology, null, 2));
      return;
    }
    console.log(renderKeyValueTable([
      ["local machine", topology.local_machine_id],
      ["hostname", topology.local_hostname],
      ["platform", String(topology.current_platform)],
      ["machines", String(topology.machines.length)],
      ["warnings", topology.warnings.join(", ") || "none"],
    ]));
    for (const machine of topology.machines) {
      const route = machine.ssh.command_target ? `${machine.ssh.route}:${machine.ssh.command_target}` : machine.ssh.route;
      console.log(`${machine.machine_id.padEnd(18)} ${String(machine.platform || "unknown").padEnd(8)} ${machine.heartbeat_status.padEnd(8)} ${route}`);
    }
  });

program
  .command("compatibility")
  .description("Check remote package, command, and workspace compatibility for open-* consumers")
  .option("--machine <id>", "Machine identifier")
  .option("--command <command...>", "Required command or command:expectedVersion")
  .option("--package <spec...>", "Required package as name[:command[:expectedVersion]]")
  .option("--workspace <spec...>", "Required workspace as label=/path[:expectedPackageName[:expectedVersion]] or /path[:expectedPackageName[:expectedVersion]]")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; command?: string[]; package?: string[]; workspace?: string[]; json?: boolean }) => {
    const result = checkMachineCompatibility({
      machineId: options.machine,
      commands: options.command?.map(parseCommandSpec),
      packages: options.package?.map(parsePackageSpec),
      workspaces: options.workspace?.map(parseWorkspaceSpec),
    });
    printJsonOrText(result, renderCompatibilityResult(result), options.json);
    if (!result.ok && !options.json) process.exitCode = 1;
  });

const workspaceCommand = program.command("workspace").description("Resolve sync-safe workspace paths for open-* consumers");

workspaceCommand
  .command("resolve")
  .description("Resolve repo and open-files roots for a machine/project")
  .requiredOption("--machine <id>", "Machine identifier")
  .requiredOption("--project <id>", "Canonical project id")
  .option("--repo <name>", "Repository name; defaults to project id")
  .option("--open-files-repo <name>", "Open-files repository name", "open-files")
  .option("--primary-machine <id>", "Primary machine id for the project")
  .option("--workspace-root <path>", "Override the machine workspace root")
  .option("--project-root <path>", "Override the resolved project root")
  .option("--open-files-root <path>", "Override the resolved open-files root")
  .option("--no-tailscale", "Skip tailscale status probing")
  .option("-j, --json", "Print JSON output", false)
  .action((options: {
    machine: string;
    project: string;
    repo?: string;
    openFilesRepo?: string;
    primaryMachine?: string;
    workspaceRoot?: string;
    projectRoot?: string;
    openFilesRoot?: string;
    tailscale?: boolean;
    json?: boolean;
  }) => {
    const result = resolveMachineWorkspace({
      machineId: options.machine,
      projectId: options.project,
      repoName: options.repo,
      openFilesRepoName: options.openFilesRepo,
      primaryMachineId: options.primaryMachine,
      workspaceRoot: options.workspaceRoot,
      projectRoot: options.projectRoot,
      openFilesRoot: options.openFilesRoot,
      includeTailscale: options.tailscale !== false,
    });
    printJsonOrText(result, renderWorkspaceResolution(result), options.json);
    if (!result.ok && !options.json) process.exitCode = 1;
  });

workspaceCommand
  .command("doctor")
  .description("Diagnose repo and open-files workspace mappings and print repair hints")
  .requiredOption("--machine <id>", "Machine identifier")
  .requiredOption("--project <id>", "Canonical project id")
  .option("--repo <name>", "Repository name; defaults to project id")
  .option("--open-files-repo <name>", "Open-files repository name", "open-files")
  .option("--primary-machine <id>", "Primary machine id for the project")
  .option("--workspace-root <path>", "Override the machine workspace root")
  .option("--project-root <path>", "Override the resolved project root")
  .option("--open-files-root <path>", "Override the resolved open-files root")
  .option("--no-tailscale", "Skip tailscale status probing")
  .option("-j, --json", "Print JSON output", false)
  .action((options: {
    machine: string;
    project: string;
    repo?: string;
    openFilesRepo?: string;
    primaryMachine?: string;
    workspaceRoot?: string;
    projectRoot?: string;
    openFilesRoot?: string;
    tailscale?: boolean;
    json?: boolean;
  }) => {
    const result = resolveMachineWorkspace({
      machineId: options.machine,
      projectId: options.project,
      repoName: options.repo,
      openFilesRepoName: options.openFilesRepo,
      primaryMachineId: options.primaryMachine,
      workspaceRoot: options.workspaceRoot,
      projectRoot: options.projectRoot,
      openFilesRoot: options.openFilesRoot,
      includeTailscale: options.tailscale !== false,
    });
    printJsonOrText(result, renderWorkspaceResolution(result), options.json);
    if (result.diagnostics.some((entry) => entry.severity === "fail") && !options.json) process.exitCode = 1;
  });

workspaceCommand
  .command("repair")
  .description("Preview or write explicit manifest path mappings for inferred workspace roots")
  .requiredOption("--machine <id>", "Machine identifier")
  .requiredOption("--project <id>", "Canonical project id")
  .option("--repo <name>", "Repository name; defaults to project id")
  .option("--open-files-repo <name>", "Open-files repository name", "open-files")
  .option("--workspace-root <path>", "Override the machine workspace root for resolution")
  .option("--project-root <path>", "Explicit project root to write")
  .option("--open-files-root <path>", "Explicit open-files root to write")
  .option("--apply", "Write the mappings into the manifest", false)
  .option("--allow-untrusted", "Allow writing mappings for machines not marked trusted", false)
  .option("--no-tailscale", "Skip tailscale status probing")
  .option("-j, --json", "Print JSON output", false)
  .action((options: {
    machine: string;
    project: string;
    repo?: string;
    openFilesRepo?: string;
    workspaceRoot?: string;
    projectRoot?: string;
    openFilesRoot?: string;
    apply?: boolean;
    allowUntrusted?: boolean;
    tailscale?: boolean;
    json?: boolean;
  }) => {
    const result = repairWorkspaceManifestMappings({
      machineId: options.machine,
      projectId: options.project,
      repoName: options.repo,
      openFilesRepoName: options.openFilesRepo,
      workspaceRoot: options.workspaceRoot,
      projectRoot: options.projectRoot,
      openFilesRoot: options.openFilesRoot,
      apply: options.apply,
      allowUntrusted: options.allowUntrusted,
      includeTailscale: options.tailscale !== false,
    });
    printJsonOrText(result, renderWorkspaceRepairResult(result), options.json);
    if (!result.ok && !options.json) process.exitCode = 1;
  });

program
  .command("diff")
  .description("Show manifest differences between two machines")
  .requiredOption("--left <id>", "Left machine identifier")
  .option("--right <id>", "Right machine identifier (defaults to current machine)")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { left: string; right?: string; json?: boolean }) => {
    const result = diffMachines(options.left, options.right);
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("backup")
  .description("Create and optionally upload a machine backup archive")
  .option("--bucket <name>", "S3 bucket name; defaults to HASNA_MACHINES_S3_BUCKET or MACHINES_S3_BUCKET")
  .option("--prefix <prefix>", "S3 key prefix; defaults to HASNA_MACHINES_S3_PREFIX, MACHINES_S3_PREFIX, or machines")
  .option("--apply", "Execute backup commands instead of previewing the plan", false)
  .option("--yes", "Confirm execution when using --apply", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { bucket?: string; prefix?: string; apply?: boolean; yes?: boolean; json?: boolean }) => {
    const result = options.apply
      ? runBackup(options.bucket, options.prefix, { apply: true, yes: options.yes })
      : buildBackupPlan(options.bucket, options.prefix);
    console.log(JSON.stringify(result, null, 2));
  });

const certCommand = program.command("cert").description("Manage mkcert-based local SSL certificates");

certCommand
  .command("issue")
  .description("Plan or issue certificates for one or more domains")
  .argument("<domains...>", "Domains to include in the certificate")
  .option("--apply", "Execute certificate commands instead of previewing them", false)
  .option("--yes", "Confirm execution when using --apply", false)
  .option("-j, --json", "Print JSON output", false)
  .action((domains: string[], options: { apply?: boolean; yes?: boolean; json?: boolean }) => {
    const result = options.apply ? runCertPlan(domains, { apply: true, yes: options.yes }) : buildCertPlan(domains);
    console.log(JSON.stringify(result, null, 2));
  });

const dnsCommand = program.command("dns").description("Manage local domain mappings");

dnsCommand
  .command("add")
  .description("Add or replace a local domain mapping")
  .requiredOption("--domain <domain>", "Domain name")
  .requiredOption("--port <port>", "Target port")
  .option("--target-host <host>", "Target host", "127.0.0.1")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { domain: string; port: string; targetHost: string; json?: boolean }) => {
    const result = addDomainMapping(options.domain, parseIntegerOption(options.port, "port", { min: 1, max: 65535 }), options.targetHost);
    console.log(JSON.stringify(result, null, 2));
  });

dnsCommand.command("list").description("List saved local domain mappings").option("-j, --json", "Print JSON output", false).action(() => {
  console.log(JSON.stringify(listDomainMappings(), null, 2));
});

dnsCommand
  .command("render")
  .description("Render hosts/proxy configuration for a domain")
  .argument("<domain>", "Domain name")
  .option("-j, --json", "Print JSON output", false)
  .action((domain: string) => {
    console.log(JSON.stringify(renderDomainMapping(domain), null, 2));
  });

notificationsCommand
  .command("add")
  .description("Add or replace a notification channel")
  .requiredOption("--id <id>", "Channel identifier")
  .requiredOption("--type <type>", "email | webhook | command")
  .requiredOption("--target <target>", "Email, webhook URL, or shell command")
  .option("--event <event...>", "Events routed to this channel", ["setup_failed", "sync_failed"])
  .option("--disabled", "Create the channel in disabled state", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { id: string; type: "email" | "webhook" | "command"; target: string; event: string[]; disabled?: boolean; json?: boolean }) => {
    const result = addNotificationChannel({
      id: options.id,
      type: options.type,
      target: options.target,
      events: options.event,
      enabled: !options.disabled,
    });
    printJsonOrText(result, renderNotificationConfigResult(result), options.json);
  });

notificationsCommand.command("list").description("List configured notification channels").option("-j, --json", "Print JSON output", false).action((options: { json?: boolean }) => {
  const result = listNotificationChannels();
  printJsonOrText(result, renderNotificationConfigResult(result), options.json);
});

notificationsCommand
  .command("test")
  .description("Preview or execute a notification test")
  .requiredOption("--channel <id>", "Channel identifier")
  .option("--event <name>", "Event name", "manual.test")
  .option("--message <message>", "Test message", "machines notification test")
  .option("--apply", "Execute the notification test instead of previewing it", false)
  .option("--yes", "Confirm execution when using --apply", false)
  .option("-j, --json", "Print JSON output", false)
  .action(async (options: { channel: string; event: string; message: string; apply?: boolean; yes?: boolean; json?: boolean }) => {
    const result = await testNotificationChannel(options.channel, options.event, options.message, {
      apply: options.apply,
      yes: options.yes,
    });
    printJsonOrText(result, renderNotificationTestResult(result), options.json);
  });

notificationsCommand
  .command("dispatch")
  .description("Dispatch an event to matching notification channels")
  .requiredOption("--event <name>", "Event name")
  .requiredOption("--message <message>", "Message body")
  .option("--channel <id>", "Limit delivery to one channel")
  .option("-j, --json", "Print JSON output", false)
  .action(async (options: { event: string; message: string; channel?: string; json?: boolean }) => {
    const result = await dispatchNotificationEvent(options.event, options.message, { channelId: options.channel });
    printJsonOrText(result, renderNotificationDispatchResult(result), options.json);
  });

notificationsCommand
  .command("remove")
  .description("Remove a notification channel")
  .argument("<id>", "Channel identifier")
  .option("-j, --json", "Print JSON output", false)
  .action((id: string, options: { json?: boolean }) => {
    const result = removeNotificationChannel(id);
    printJsonOrText(result, renderNotificationConfigResult(result), options.json);
  });

runtimeCommand
  .command("tmux-watch")
  .description("Watch a tmux pane and emit machines.tmux.pane_died if it disappears")
  .argument("<target>", "tmux pane target, for example %1 or session:window.pane")
  .option("--interval-ms <ms>", "Polling interval in milliseconds", "5000")
  .option("--max-checks <n>", "Stop after N checks instead of watching forever")
  .option("--once", "Probe once and emit machines.tmux.pane_missing when absent", false)
  .option("--no-deliver", "Record the event without webhook delivery")
  .option("-j, --json", "Print JSON output", false)
  .action(async (target: string, options: { intervalMs?: string; maxChecks?: string; once?: boolean; deliver?: boolean; json?: boolean }) => {
    const maxChecks = options.once
      ? 1
      : options.maxChecks
        ? parseIntegerOption(options.maxChecks, "max-checks", { min: 1 })
        : undefined;
    const result = await watchTmuxPane({
      target,
      intervalMs: parseIntegerOption(options.intervalMs ?? "5000", "interval-ms", { min: 0 }),
      maxChecks,
      emitInitialMissing: Boolean(options.once),
      deliver: options.deliver !== false,
      onProbe: options.json ? undefined : (probe) => {
        const status = probe.exists ? chalk.green("present") : chalk.yellow("missing");
        console.error(`tmux ${probe.target}: ${status}${probe.paneId ? ` ${probe.paneId}` : ""}`);
      },
    });
    printJsonOrText(result, renderKeyValueTable([
      ["target", result.target],
      ["status", result.status],
      ["checks", String(result.checks)],
      ["event", result.emitted?.event.type ?? "none"],
    ]), options.json);
  });

clipboardCommand
  .command("init")
  .description("Initialize clipboard sync (generate shared secret)")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { json?: boolean }) => {
    const key = getOrCreateClipboardKey();
    const config = getDefaultClipboardConfig();
    writeClipboardConfig(config);
    const result = { keyPath: getClipboardKeyPath(), key, configPath: getConfigPath(), config };
    printJsonOrText(result, `clipboard initialized\nkey: ${key}\nport: ${config.port}`, options.json);
  });

clipboardCommand
  .command("status")
  .description("Check clipboard sync status")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { json?: boolean }) => {
    const status = getClipboardStatus();
    const config = readClipboardConfig();
    const result = { ...status, enabled: config.enabled };
    printJsonOrText(result, `clipboard sync ${config.enabled ? chalk.green("enabled") : chalk.yellow("disabled")} (port ${status.port}, ${status.historyCount} entries)`, options.json);
  });

clipboardCommand
  .command("config")
  .description("View or set clipboard sync config")
  .option("--set <json>", "Set config values as JSON")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { set?: string; json?: boolean }) => {
    if (options.set) {
      const partial = JSON.parse(options.set) as Partial<ClipboardConfig>;
      const config = { ...readClipboardConfig(), ...partial };
      writeClipboardConfig(config);
    }
    const config = readClipboardConfig();
    printJsonOrText(config, renderKeyValueTable([
      ["enabled", String(config.enabled)],
      ["port", String(config.port)],
      ["maxHistory", String(config.maxHistory)],
      ["maxSizeBytes", `${config.maxSizeBytes} bytes`],
      ["skipPatterns", config.skipPatterns.join(", ")],
    ]), options.json);
  });

clipboardCommand
  .command("history")
  .description("Show clipboard sync history")
  .option("-j, --json", "Print JSON output", false)
  .option("--limit <n>", "Show only the last N entries", "20")
  .action((options: { json?: boolean; limit: string }) => {
    const limit = parseIntegerOption(options.limit, "limit", { min: 1, max: 100 });
    const entries = readClipboardHistory().slice(0, limit);
    if (options.json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }
    if (entries.length === 0) {
      console.log("clipboard history: empty");
      return;
    }
    for (const entry of entries) {
      const preview = entry.content.length > 80 ? `${entry.content.slice(0, 80)}...` : entry.content;
      console.log(`${chalk.dim(entry.timestamp)} ${entry.sourceMachine.padEnd(12)} ${entry.contentType.padEnd(5)} ${preview.replace(/\n/g, " ")}`);
    }
  });

clipboardCommand
  .command("clear-history")
  .description("Clear clipboard sync history")
  .option("--yes", "Confirm without prompt", false)
  .action((options: { yes?: boolean }) => {
    if (!options.yes) {
      console.error("error: this command requires --yes");
      process.exit(1);
    }
    clearClipboardHistory();
    console.log("clipboard history cleared");
  });

clipboardCommand
  .command("key")
  .description("Show or rotate the shared secret key")
  .option("--rotate", "Generate a new key", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { rotate?: boolean; json?: boolean }) => {
    if (options.rotate) {
      rmSync(getClipboardKeyPath(), { force: true });
    }
    const key = getOrCreateClipboardKey();
    printJsonOrText({ key }, key, options.json);
  });

clipboardCommand
  .command("start")
  .description("Start clipboard sync daemon")
  .option("--port <port>", "Port to listen on")
  .action((options: { port?: string }) => {
    const port = options.port ? Number(options.port) : undefined;
    startClipboardDaemon(port);
  });

clipboardCommand
  .command("stop")
  .description("Stop clipboard sync daemon")
  .action(() => {
    const result = stopClipboardDaemon();
    console.log(result.stopped ? `daemon stopped (pid ${result.pid})` : "daemon not running");
  });

installClaudeCommand
  .command("status")
  .description("Check installed state for Claude, Codex, and Gemini CLIs")
  .option("--machine <id>", "Machine identifier")
  .option("--tool <name...>", "CLI tools to inspect (claude, codex, gemini)")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; tool?: string[]; json?: boolean }) => {
    const result = getClaudeCliStatus(options.machine, options.tool);
    printJsonOrText(result, renderClaudeStatusResult(result), options.json);
  });

installClaudeCommand
  .command("diff")
  .description("Show missing and installed Claude, Codex, and Gemini CLIs")
  .option("--machine <id>", "Machine identifier")
  .option("--tool <name...>", "CLI tools to inspect (claude, codex, gemini)")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; tool?: string[]; json?: boolean }) => {
    const result = diffClaudeCli(options.machine, options.tool);
    printJsonOrText(result, renderClaudeDiffResult(result), options.json);
  });

installClaudeCommand
  .command("plan")
  .description("Preview CLI install steps")
  .option("--machine <id>", "Machine identifier")
  .option("--tool <name...>", "CLI tools to install (claude, codex, gemini)")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; tool?: string[]; json?: boolean }) => {
    const result = buildClaudeInstallPlan(options.machine, options.tool);
    console.log(JSON.stringify(result, null, 2));
  });

installClaudeCommand
  .command("apply")
  .description("Install or update the requested CLIs")
  .option("--machine <id>", "Machine identifier")
  .option("--tool <name...>", "CLI tools to install (claude, codex, gemini)")
  .option("--yes", "Confirm execution when using apply", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; tool?: string[]; yes?: boolean; json?: boolean }) => {
    const result = runClaudeInstall(options.machine, options.tool, { apply: true, yes: options.yes });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("install-tailscale")
  .description("Install Tailscale on a machine")
  .option("--machine <id>", "Machine identifier")
  .option("--apply", "Execute installation commands instead of previewing the plan", false)
  .option("--yes", "Confirm execution when using --apply", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; apply?: boolean; yes?: boolean; json?: boolean }) => {
    const result = options.apply
      ? runTailscaleInstall(options.machine, { apply: true, yes: options.yes })
      : buildTailscaleInstallPlan(options.machine);
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("route")
  .description("Resolve the best route for a machine")
  .requiredOption("--machine <id>", "Machine identifier")
  .option("--no-tailscale", "Skip tailscale status probing")
  .option("--private-metadata", "Print private route targets", false)
  .option("--cmd <command>", "Remote command to run")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine: string; tailscale?: boolean; privateMetadata?: boolean; cmd?: string; json?: boolean }) => {
    const topology = discoverMachineTopology({ includeTailscale: options.tailscale !== false });
    const resolved = resolveMachineRoute(options.machine, { topology });
    const publicResolved = redactRouteForOutput(resolved, { privateMetadata: options.privateMetadata });
    const command = resolved.ok && resolved.target
      ? resolved.route === "local"
        ? options.cmd ?? null
        : buildSshCommand(options.machine, options.cmd, { topology })
      : null;
    const payload = { ...publicResolved, command: options.privateMetadata ? command : command ? "[redacted]" : null };
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    if (!resolved.ok) {
      console.error(chalk.red(resolved.warnings.join("; ") || `No route found for ${options.machine}`));
      process.exitCode = 1;
      return;
    }
    console.log(options.privateMetadata ? command ?? `${resolved.route}:${resolved.target}` : `${publicResolved.route}:${publicResolved.target ?? "unresolved"}`);
  });

program
  .command("ssh")
  .description("Choose the best SSH route for a machine")
  .requiredOption("--machine <id>", "Machine identifier")
  .option("--cmd <command>", "Remote command to run")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine: string; cmd?: string; json?: boolean }) => {
    if (options.json) {
      const resolved = resolveMachineRoute(options.machine);
      console.log(JSON.stringify({ resolved, command: resolved.ok ? buildSshCommand(options.machine, options.cmd) : null }, null, 2));
      return;
    }
    console.log(buildSshCommand(options.machine, options.cmd));
  });

program
  .command("screen")
  .description("Open Screen Sharing (VNC) to a machine using its best live route")
  .argument("[machine]", "Machine identifier")
  .option("--machine <id>", "Machine identifier (alternative to positional arg)")
  .option("--all", "Open every reachable machine", false)
  .option("--print", "Print the vnc:// URL instead of opening it", false)
  .option("-j, --json", "Print JSON output", false)
  .action((machineArg: string | undefined, options: { machine?: string; all?: boolean; print?: boolean; json?: boolean }) => {
    if (options.all) {
      const topology = discoverMachineTopology();
      type ScreenAllResult = { machine: string; ok: boolean; url?: string; route?: string; error?: string };
      const results: ScreenAllResult[] = topology.machines.map((m) => {
        try {
          const resolved = resolveScreenTarget(m.machine_id, { topology });
          return { machine: m.machine_id, ok: true, url: resolved.url, route: resolved.route };
        } catch (error) {
          return { machine: m.machine_id, ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      });
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }
      for (const r of results) {
        if (r.ok && r.url) {
          if (!options.print) execFileSync("open", [r.url], { stdio: "ignore" });
          console.log(`${r.ok ? "✓" : "✗"} ${r.machine.padEnd(14)} ${r.url ?? r.error}`);
        } else {
          console.log(`✗ ${r.machine.padEnd(14)} ${r.error}`);
        }
      }
      return;
    }

    const machineId = machineArg ?? options.machine;
    if (!machineId) {
      console.error("Provide a machine: machines screen <id>  (or --all)");
      process.exitCode = 1;
      return;
    }
    const resolved = resolveScreenTarget(machineId);
    if (options.json) {
      console.log(JSON.stringify(resolved, null, 2));
      return;
    }
    if (options.print) {
      console.log(resolved.url);
      return;
    }
    execFileSync("open", [resolved.url], { stdio: "ignore" });
    console.log(`Opening Screen Sharing → ${resolved.url} (route: ${resolved.route})`);
  });

program
  .command("screen-credentials")
  .description("Inspect screen-sharing user and password secret references without printing secrets")
  .option("--machine <id>", "Machine identifier")
  .option("--all", "Inspect every discovered machine", false)
  .option("--check-secret", "Check whether the password secret exists in the local secrets vault", false)
  .option("--secrets-command <command>", "Secrets CLI command to inspect", "secrets")
  .option("--no-tailscale", "Skip tailscale status probing")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; all?: boolean; checkSecret?: boolean; secretsCommand: string; tailscale?: boolean; json?: boolean }) => {
    const topology = discoverMachineTopology({ includeTailscale: options.tailscale !== false });
    const machineIds = options.all
      ? topology.machines.map((machine) => machine.machine_id)
      : [options.machine].filter((machine): machine is string => Boolean(machine));
    if (machineIds.length === 0) {
      console.error("Provide --machine <id> or --all");
      process.exitCode = 1;
      return;
    }
    const results = machineIds.map((machineId) => {
      try {
        const credentials = resolveScreenCredentials(machineId, { topology });
        const secret = options.checkSecret
          ? checkSecretPresence(options.secretsCommand, credentials.passwordSecretKey)
          : { checked: false as const, present: null };
        return { ok: true as const, ...credentials, passwordSecret: secret };
      } catch (error) {
        return { ok: false as const, machineId, error: error instanceof Error ? error.message : String(error) };
      }
    });
    const hasFailures = results.some((result) => !result.ok || (result.ok && result.passwordSecret.checked && !result.passwordSecret.present));
    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      if (hasFailures) process.exitCode = 1;
      return;
    }
    for (const result of results) {
      if (!result.ok) {
        console.log(`✗ ${result.machineId.padEnd(14)} ${result.error}`);
        continue;
      }
      const secret = result.passwordSecret.checked
        ? result.passwordSecret.present
          ? chalk.green("present")
          : chalk.red("missing")
        : chalk.yellow("unchecked");
      console.log(`${result.machineId.padEnd(14)} user=${result.user ?? "(missing)"} passwordSecret=${result.passwordSecretKey} (${secret})`);
    }
    if (hasFailures) process.exitCode = 1;
  });

program
  .command("screen-enable")
  .description("Enable Remote Management / Screen Sharing on a macOS machine over SSH")
  .requiredOption("--machine <id>", "Machine identifier")
  .option("--user <user>", "macOS user to grant screen-sharing (overrides manifest)")
  .option("--vnc-password-secret <key>", "Secret key containing the legacy VNC password")
  .option("--secrets-command <command>", "Secrets CLI command to read the password", "secrets")
  .option("--vnc-password <pw>", "Deprecated: use --vnc-password-secret instead", "")
  .option("--print", "Print the remote command instead of running it", false)
  .action((options: { machine: string; user?: string; vncPasswordSecret?: string; secretsCommand?: string; vncPassword?: string; print?: boolean }) => {
    if (options.vncPassword) {
      console.error("Direct --vnc-password values are not accepted. Store the password with `secrets set` and pass --vnc-password-secret.");
      process.exitCode = 1;
      return;
    }
    const plan = buildScreenEnableCommand(options.machine, {
      user: options.user,
      passwordSecretKey: options.vncPasswordSecret,
      secretsCommand: options.secretsCommand,
    });
    if (options.print) {
      console.log(plan.command);
      return;
    }
    console.log(`Run this to enable Screen Sharing on ${options.machine} (password comes from ${plan.passwordSecretKey}):`);
    console.log(`  ${plan.command}`);
  });

program.command("ports").description("List listening ports on a machine").option("--machine <id>", "Machine identifier").option("-j, --json", "Print JSON output", false).action((options: { machine?: string; json?: boolean }) => {
  const result = listPorts(options.machine);
  console.log(JSON.stringify(result, null, 2));
});

const storageCommand = program.command("storage").description("Sync local machine runtime data with storage PostgreSQL");

storageCommand.command("status").description("Show storage sync status").option("-j, --json", "Print JSON output", false).action(async (options: { json?: boolean }) => {
  const { getStorageStatus } = await import("../storage.js");
  const status = getStorageStatus();
  printJsonOrText(status, renderKeyValueTable([
    ["mode", status.mode],
    ["configured", status.configured ? "yes" : "no"],
    ["active env", status.activeEnv || "none"],
    ["tables", status.tables.join(", ")],
  ]), options.json);
});

storageCommand.command("push").description("Push local machine runtime data to storage PostgreSQL").option("--tables <tables>", "Comma-separated table names").option("-j, --json", "Print JSON output", false).action(async (options: { tables?: string; json?: boolean }) => {
  try {
    const { parseStorageTables, storagePush } = await import("../storage.js");
    const results = await storagePush({ tables: parseStorageTables(options.tables) });
    printStorageResults(results, options.json);
  } catch (error) {
    printStorageError(error);
  }
});

storageCommand.command("pull").description("Pull machine runtime data from storage PostgreSQL to local SQLite").option("--tables <tables>", "Comma-separated table names").option("-j, --json", "Print JSON output", false).action(async (options: { tables?: string; json?: boolean }) => {
  try {
    const { parseStorageTables, storagePull } = await import("../storage.js");
    const results = await storagePull({ tables: parseStorageTables(options.tables) });
    printStorageResults(results, options.json);
  } catch (error) {
    printStorageError(error);
  }
});

storageCommand.command("sync").description("Bidirectional storage sync: pull then push").option("--tables <tables>", "Comma-separated table names").option("-j, --json", "Print JSON output", false).action(async (options: { tables?: string; json?: boolean }) => {
  try {
    const { parseStorageTables, storageSync } = await import("../storage.js");
    const result = await storageSync({ tables: parseStorageTables(options.tables) });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(chalk.bold("Pull"));
    printStorageResults(result.pull);
    console.log(chalk.bold("Push"));
    printStorageResults(result.push);
  } catch (error) {
    printStorageError(error);
  }
});

program.command("status").description("Print local machine and storage status").option("-j, --json", "Print JSON output", false).action((options: { json?: boolean }) => {
  const status = getStatus();
  printJsonOrText(status, renderFleetStatus(status), options.json);
});

program
  .command("doctor")
  .description("Run machine preflight checks")
  .option("--machine <id>", "Machine identifier")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; json?: boolean }) => {
    const result = runDoctor(options.machine);
    printJsonOrText(result, renderDoctorResult(result), options.json);
  });

program
  .command("self-test")
  .description("Run local package smoke checks")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { json?: boolean }) => {
    const result = runSelfTest();
    printJsonOrText(result, renderSelfTestResult(result), options.json);
  });

program
  .command("serve")
  .description("Serve a local fleet dashboard and JSON API")
  .option("--host <host>", "Host interface to bind", "0.0.0.0")
  .option("--port <port>", "Port to bind", "7676")
  .option("-j, --json", "Print serve config and exit", false)
  .action((options: { host: string; port: string; json?: boolean }) => {
    const info = getServeInfo({ host: options.host, port: parseIntegerOption(options.port, "port", { min: 1, max: 65535 }) });
    if (options.json) {
      console.log(JSON.stringify(info, null, 2));
      return;
    }
    const server = startDashboardServer({ host: info.host, port: info.port });
    console.log(chalk.green(`machines dashboard listening on http://${server.hostname}:${server.port}`));
  });

const healCommand = program.command("heal").description("Self-healing network watchdog: keeps a Wi-Fi node reachable (SSID pinning + peer-reachability + gated reboot)");

function requireRoot(): boolean {
  const uid = process.getuid ? process.getuid() : 1;
  if (uid !== 0) {
    console.error(chalk.red("error: this command must run as root (try: sudo machines heal install)"));
    return false;
  }
  return true;
}

healCommand
  .command("config")
  .description("View or update self-healing config (e.g. --set '{\"preferredSsid\":\"X81ND\",\"fallbackSsid\":\"DIGI-s2N5\"}')")
  .option("--set <json>", "Merge a JSON object into the config")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { set?: string; json?: boolean }) => {
    if (options.set) {
      const current = readHealConfig();
      const partial = JSON.parse(options.set) as Partial<HealConfig>;
      writeHealConfig({
        ...current,
        ...partial,
        thresholds: { ...current.thresholds, ...(partial.thresholds || {}) },
      });
    }
    const config = readHealConfig();
    printJsonOrText(config, renderKeyValueTable([
      ["enabled", String(config.enabled)],
      ["preferredSsid", config.preferredSsid || chalk.yellow("(unset)")],
      ["fallbackSsid", config.fallbackSsid || "(none)"],
      ["anchors", config.tailscaleAnchors.length ? config.tailscaleAnchors.join(", ") : "(auto-discover)"],
      ["quorumRequired", String(config.quorumRequired)],
      ["intervalSec", String(config.intervalSec)],
      ["thresholds", `reconnect=${config.thresholds.reconnect} nm=${config.thresholds.nmRestart} fallback=${config.thresholds.fallback} reboot=${config.thresholds.reboot}`],
      ["allowReboot", String(config.allowReboot)],
      ["gpuJobGuard", String(config.gpuJobGuard)],
    ]), options.json);
  });

healCommand
  .command("check")
  .description("Run one health + decision tick read-only (no side effects)")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { json?: boolean }) => {
    const result = runHealOnce(readHealConfig(), { dryRun: true });
    printJsonOrText(result, renderList("heal check", [
      `health: ${result.healthy ? chalk.green("HEALTHY") : chalk.red("UNHEALTHY")} (remote quorum ${result.remoteScore})`,
      `reasons: ${result.reasons.length ? result.reasons.join(", ") : "none"}`,
      `would do: ${result.action}${result.suppressedReason ? ` (reboot suppressed: ${result.suppressedReason})` : ""}`,
      `consecutive fails: ${result.failCount}`,
    ]), options.json);
  });

healCommand
  .command("status")
  .description("Show watchdog service status and last persisted state")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { json?: boolean }) => {
    const svc = healServiceStatus();
    const state = readHealState();
    const config = readHealConfig();
    printJsonOrText({ service: svc, state, config }, renderKeyValueTable([
      ["service installed", svc.installed ? chalk.green("yes") : "no"],
      ["service active", svc.active ? chalk.green("yes") : chalk.yellow("no")],
      ["service enabled", svc.enabled ? "yes" : "no"],
      ["preferredSsid", config.preferredSsid || chalk.yellow("(unset)")],
      ["consecutive fails", String(state.failCount)],
      ["pending reboot recovery", String(state.pendingRebootRecovery)],
      ["failed boot recoveries", String(state.failedBootRecoveries)],
    ]), options.json);
  });

healCommand
  .command("daemon")
  .description("Run the watchdog loop in the foreground (used by systemd)")
  .action(() => {
    startHealDaemon();
  });

healCommand
  .command("stop")
  .description("Stop a foreground daemon started via `heal daemon`")
  .action(() => {
    const r = stopHealDaemon();
    console.log(r.stopped ? `stopped heal daemon (pid ${r.pid})` : "heal daemon not running");
  });

healCommand
  .command("determinism")
  .description("Pin the preferred SSID, disable other autoconnects, turn off Wi-Fi power save")
  .action(() => {
    const log = applyDeterminism(readHealConfig());
    console.log(renderList("determinism", log));
  });

healCommand
  .command("install")
  .description("Install the watchdog: determinism + hardware watchdog + systemd service (requires root)")
  .option("--no-determinism", "Skip SSID pinning / power-save changes")
  .option("--no-watchdog", "Skip enabling the systemd hardware watchdog")
  .option("--no-service", "Skip installing the systemd service")
  .action((options: { determinism?: boolean; watchdog?: boolean; service?: boolean }) => {
    if (!requireRoot()) {
      process.exitCode = 1;
      return;
    }
    const config = readHealConfig();
    if (!config.preferredSsid) {
      console.error(chalk.red("error: set preferredSsid first: machines heal config --set '{\"preferredSsid\":\"X81ND\"}'"));
      process.exitCode = 1;
      return;
    }
    const out: string[] = [];
    if (options.determinism !== false) out.push(...applyDeterminism(config));
    if (options.watchdog !== false) out.push(...enableHardwareWatchdog());
    if (options.service !== false) out.push(...installHealService());
    console.log(renderList("install", out));
    console.log(chalk.green("self-healing watchdog installed"));
  });

healCommand
  .command("uninstall")
  .description("Remove the systemd watchdog service (requires root)")
  .action(() => {
    if (!requireRoot()) {
      process.exitCode = 1;
      return;
    }
    console.log(renderList("uninstall", uninstallHealService()));
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red(message));
  process.exit(1);
}
