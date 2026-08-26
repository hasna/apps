#!/usr/bin/env bun
import { Command } from "commander";
import {
  EventsClient,
  getEventsDataDir,
  sanitizeChannelForOutput,
  sanitizeChannelsForOutput,
  type ChannelConfig,
  type EventEnvelope,
  type EventFilter,
  type EventSeverity,
} from "@hasna/events";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import chalk from "chalk";
import { getPackageVersion } from "../version.js";
import { getLocalMachineId } from "../db.js";
import { resolveMachineRegistryStore } from "../cloud/registry.js";
import { runMigrations } from "../server/migrate.js";
import {
  manifestAdd,
  manifestBootstrapCurrentMachine,
  manifestClearFriendlyName,
  manifestGet,
  manifestGetFriendlyName,
  manifestInit,
  manifestList,
  manifestRemove,
  manifestSetFriendlyName,
  manifestValidate,
  clearMachineFriendlyNameMutationArgs,
  machineFriendlyNameResourceId,
  setMachineFriendlyNameMutationArgs,
} from "../commands/manifest.js";
import { buildSetupPlan, runSetupPlan } from "../commands/setup.js";
import {
  applyWorkstationTestProfile,
  createNodeWorkstationTestProfileStore,
  createSystemdUserTestProfileController,
  deriveWorkstationTestProfile,
  readMachineTestAuthority,
  readWorkstationTestProfile,
  rollbackWorkstationTestProfile,
  workstationTestProfilePaths,
} from "../test-profile.js";
import {
  buildStationTemplateSteps,
  checkExitCode,
  checkStationTemplate,
  parseTemplateSpec,
  renderCloudInit,
  resolveStationTemplate,
} from "../station-template/index.js";
import { buildBackupPlan, resolveBackupTarget, runBackup } from "../commands/backup.js";
import { buildCertPlan, runCertPlan } from "../commands/cert.js";
import { addDomainMapping, listDomainMappings, renderDomainMapping } from "../commands/dns.js";
import { applyFleetHosts, planFleetHosts } from "../commands/hosts.js";
import { diffMachines } from "../commands/diff.js";
import { buildAppsPlan, diffApps, getAppsStatus, listApps, runAppsPlan, validateAppsCandidate } from "../commands/apps.js";
import { readManifest } from "../manifests.js";
import { runMachineCommand } from "../remote.js";
import {
  buildFlipPlan,
  buildFlipScript,
  getFlipApp,
  listFlipApps,
  normalizeFlipMode,
  planWaves,
  runFlip,
  selectTargets,
  type FlipMode,
  type RunnerFn,
} from "../commands/flip.js";
import {
  buildClaudeInstallPlan,
  diffClaudeCli,
  getClaudeCliStatus,
  runClaudeInstallPlan,
} from "../commands/install-claude.js";
import { buildTailscaleInstallPlan, runTailscaleInstallPlan } from "../commands/install-tailscale.js";
import {
  addNotificationChannel,
  createTrustedNotificationApproval,
  dispatchNotificationEvent,
  listNotificationChannels,
  removeNotificationChannel,
  testNotificationChannel,
} from "../commands/notifications.js";
import { listPorts } from "../commands/ports.js";
import { buildTmuxPaneDiedHookPlan, watchTmuxPane } from "../commands/runtime.js";
import { buildSshCommand, resolveSshTarget } from "../commands/ssh.js";
import { probeStationLoader, probeStationLoaderWithBareControl, renderStationLoaderProbe, renderStationLoaderProbeSuite } from "../commands/station-loader.js";
import {
  DEFAULT_MACHINE_EXEC_MAX_OUTPUT_CHARS,
  MACHINE_EXEC_MUTATION_OPERATION,
  machineExecMutationArgs,
  machineExecResourceId,
  readBoundedMachineExecScript,
  runMachineExec,
  type MachineExecInput,
} from "../commands/exec.js";
import { resolveScreenTarget, buildScreenCommand, buildScreenEnableCommand, resolveScreenCredentials, screenCredentialsFailed } from "../commands/screen.js";
import { buildSyncPlan, runSyncPlan } from "../commands/sync.js";
import {
  buildReconcilePlan,
  executeReconcilePlan,
  readInstalledSnapshot,
  releaseEventTrigger,
  type InstalledPackage,
  type ReleaseEventEnvelope,
} from "../commands/reconcile.js";
import { addFreeze, findFreeze, listActiveFreezes, removeFreeze } from "../commands/freeze.js";
import { getStatus } from "../commands/status.js";
import {
  buildHeartbeatCollectorCommand,
  collectHeartbeats,
  HEARTBEAT_COLLECT_MUTATION_OPERATION,
  heartbeatCollectMutationArgs,
  heartbeatCollectResourceId,
  type HeartbeatCollectorCommandPlan,
  type HeartbeatCollectResult,
} from "../commands/heartbeat.js";
import { repairWorkspaceManifestMappings, type WorkspaceManifestRepairResult } from "../commands/workspace.js";
import {
  assignMachineProject,
  listMachineProjectAssignments,
  projectAssignmentMutationArgs,
  projectAssignmentResourceId,
  removeMachineProjectAssignment,
  removeProjectAssignmentMutationArgs,
  type AssignMachineProjectInput,
  type MachineProjectAssignments,
} from "../projects.js";
import { DEFAULT_MACHINE_LIST_LIMIT, discoverMachineTopology, redactRouteForOutput, redactTopologyForOutput, resolveMachineRoute, resolveMachineWorkspace } from "../topology.js";
import {
  listMachineTrashPolicies,
  resolveNoteMachineContext,
  type MachineTrashPolicies,
  type NoteActorType,
  type NoteMachineContext,
  type NoteMachineContextSource,
  type NoteMachineContextSourceInput,
} from "../notes.js";
import { resolveMachineDetails, type MachineDetails } from "../details.js";
import { getBrowserPlanFleet, type BrowserPlanFleet } from "../browserplan.js";
import {
  checkMachineCompatibility,
  type CompatibilityCheck,
  type CompatibilityCommandSpec,
  type CompatibilityPackageSpec,
  type CompatibilityWorkspaceSpec,
} from "../compatibility.js";
import {
  getCommandMatrix,
  getFleetLoopPreflight,
  getFleetMachineHealth,
  getFleetRouting,
  type CommandMatrixReport,
  type FleetLoopPreflightReport,
  type FleetRoutingReport,
  type MachineHealthReport,
} from "../agent-abstractions.js";
import {
  DEFAULT_DISPATCH_COMMAND,
  DEFAULT_DISPATCH_PACKAGE_NAME,
  DEFAULT_DISPATCH_SMOKE_MAX_OUTPUT_CHARS,
  DEFAULT_DISPATCH_SMOKE_TIMEOUT_MS,
  getDispatchFleetSmoke,
  type DispatchFleetSmokeReport,
} from "../dispatch-smoke.js";
import {
  getFleetOpsCheck,
  parseFleetOpsTmuxExpectation,
  upsertFleetOpsCheckTasks,
  type FleetOpsCheck,
} from "../ops-check.js";
import {
  getCriticalDbIntegrityReport,
  getOpsStateSnapshotReport,
  upsertMachineDataTasks,
  type CriticalDbIntegrityReport,
  type OpsStateSnapshotReport,
} from "../ops-data.js";
import { doctorExitCode, runDoctor } from "../commands/doctor.js";
import { assertMutationApproved, createTrustedSdkMutationApproval, mutationArgsSha256, mutationPlanDigest } from "../commands/mutation-approval.js";
import {
  buildDaemonServicePlan,
  runDaemonServicePlan,
  type DaemonServiceAction,
  type DaemonServiceOptions,
  type DaemonServicePlan,
} from "../commands/daemon.js";
import { runSelfTest } from "../commands/self-test.js";
import { getServeInfo, startDashboardServer } from "../commands/serve.js";
import { REDACTED_VALUE } from "../redaction.js";
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
import { getManifestPath, getClipboardKeyPath, getFlipLedgerPath } from "../paths.js";
import { parseIntegerOption, renderKeyValueTable, renderList } from "../cli-utils.js";
import type {
  AppsDiffResult,
  AppsStatusResult,
  ClaudeCliDiffResult,
  ClaudeCliStatusResult,
  DoctorReport,
  FleetStatus,
  ExactBunAppsStatusResult,
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

function readExactBunInstalledState(path: string | undefined): ExactBunAppsStatusResult | undefined {
  if (!path) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("invalid");
    return parsed as ExactBunAppsStatusResult;
  } catch {
    throw new Error("installed_state_invalid");
  }
}

function renderReconcileResult(result: import("../commands/reconcile.js").ReconcileResult): string {
  const lines: string[] = [
    `Reconcile ${result.mode} for ${result.machineId}: ${result.results.length} package(s)`,
  ];
  for (const entry of result.results) {
    const versions = entry.action === "skip"
      ? entry.installedVersion ?? "-"
      : `${entry.installedVersion ?? "none"} -> ${entry.desiredVersion ?? "-"}`;
    lines.push(`  ${entry.action}\t${entry.package}\t${versions}\t${entry.status}${entry.error ? `\t${entry.error}` : ""}`);
  }
  if (result.mode === "apply") lines.push(`Records: ${result.records.length}, events emitted: ${result.emitted}`);
  if (result.warnings.length) lines.push(`Warnings: ${result.warnings.join(", ")}`);
  return lines.join("\n");
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

// Detect the JSON output flag from raw argv. Option parsing has not necessarily
// happened when usage/validation errors fire, so the resolved options are not
// available on those paths — the raw tokens are the source of truth there.
function argvWantsJson(argv: readonly string[] = process.argv): boolean {
  return argv.includes("--json") || argv.includes("-j");
}

function jsonCliError(message: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({ ok: false, error: message, ...extra }, null, 2);
}

// Emit a structured error on explicit CLI failure paths, honouring --json.
function failCli(message: string, json: boolean, extra?: Record<string, unknown>): never {
  if (json) {
    console.log(jsonCliError(message, extra));
  } else {
    console.error(chalk.red(message));
  }
  process.exit(1);
}

// Route Commander's own usage/validation errors through exitOverride so they
// can be rendered as JSON when requested instead of Commander's plain text.
function applyJsonAwareErrorHandling(command: Command): void {
  command.exitOverride();
  command.configureOutput({
    outputError: (str, write) => {
      // Under --json the structured object is emitted from reportTopLevelError;
      // suppress Commander's plain-text error so consumers get valid JSON only.
      if (!argvWantsJson()) write(str);
    },
  });
  for (const child of command.commands) applyJsonAwareErrorHandling(child);
}

// Wrap a command action so any thrown error is rendered as JSON under --json
// (falling back to the standard red-on-stderr text otherwise). Used for actions
// whose usage/validation failures bubble up from helpers rather than Commander.
function jsonAwareAction<A extends unknown[]>(
  handler: (...args: A) => void | Promise<void>,
  wantsJson: (...args: A) => boolean,
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await handler(...args);
    } catch (error) {
      failCli(error instanceof Error ? error.message : String(error), wantsJson(...args));
    }
  };
}

function reportTopLevelError(error: unknown): never {
  const code = (error as { code?: unknown }).code;
  const isCommanderError = error instanceof Error && typeof code === "string" && code.startsWith("commander.");
  if (isCommanderError) {
    const rawExitCode = (error as { exitCode?: unknown }).exitCode;
    const exitCode = typeof rawExitCode === "number" ? rawExitCode : 1;
    // Success-exit paths (help/version) already wrote their output to stdout.
    if (exitCode === 0) process.exit(0);
    // Commander usage/validation errors: emit structured JSON under --json,
    // otherwise Commander already wrote the plain message via outputError.
    if (argvWantsJson()) {
      console.log(jsonCliError(error.message.replace(/^error:\s*/i, ""), { code }));
    }
    process.exit(exitCode);
  }
  // Non-Commander throws keep their historical stderr rendering; commands that
  // need JSON on these paths opt in explicitly (see jsonAwareAction / failCli).
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
    `overall: ${result.overall} ok=${result.counts.ok} warn=${result.counts.warn} fail=${result.counts.fail}`,
    ...result.checks.map((check) => {
      const status = check.status === "ok" ? chalk.green(check.status) : check.status === "warn" ? chalk.yellow(check.status) : chalk.red(check.status);
      return `${check.id.padEnd(20)} ${status} ${check.detail}`;
    }),
  ].join("\n");
}

function checkSecretPresence(secretsCommand: string, key: string): { checked: true; present: boolean; error?: string } {
  const result = Bun.spawnSync([secretsCommand, "get", key, "--show"], {
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

function renderMachineHealthResult(result: MachineHealthReport): string {
  const lines = result.machines.map((machine) =>
    `${machine.display_name.padEnd(18)} ${machine.machine_id.padEnd(18)} ${machine.status.padEnd(8)} route:${machine.route}/${machine.confidence} heartbeat:${machine.heartbeat} issues:${machine.issues.join(",") || "none"}`
  );
  return [
    renderKeyValueTable([
      ["machines", `${result.pagination.count}/${result.pagination.total}`],
      ["ready", String(result.summary.ready)],
      ["degraded", String(result.summary.degraded)],
      ["blocked", String(result.summary.blocked)],
      ["unknown", String(result.summary.unknown)],
      ["has more", String(result.pagination.hasMore)],
      ["next", result.pagination.nextOffset === null ? "none" : `--offset ${result.pagination.nextOffset}`],
    ]),
    ...lines,
  ].join("\n");
}

function renderFleetRoutingResult(result: FleetRoutingReport): string {
  const lines = result.routes.map((route) =>
    `${route.display_name.padEnd(18)} ${route.machine_id.padEnd(18)} ${route.ok ? "ok" : "blocked"} ${route.route}/${route.confidence} target:${route.target ?? "unresolved"}`
  );
  return [
    renderKeyValueTable([
      ["routes", `${result.pagination.count}/${result.pagination.total}`],
      ["routable", String(result.summary.routable)],
      ["local", String(result.summary.local)],
      ["remote", String(result.summary.remote)],
      ["unroutable", String(result.summary.unroutable)],
      ["has more", String(result.pagination.hasMore)],
    ]),
    ...lines,
  ].join("\n");
}

function renderCommandMatrixResult(result: CommandMatrixReport): string {
  const lines = result.commands.map((row) =>
    `${row.display_name.padEnd(18)} ${row.machine_id.padEnd(18)} ${row.can_run ? "run" : "blocked"} ${row.route}/${row.confidence} exec:${row.execution.status} ${row.command.cli}`
  );
  return [
    renderKeyValueTable([
      ["mode", result.mode],
      ["commands", `${result.pagination.count}/${result.pagination.total}`],
      ["runnable", String(result.summary.runnable)],
      ["blocked", String(result.summary.blocked)],
      ["has more", String(result.pagination.hasMore)],
    ]),
    ...lines,
  ].join("\n");
}

function renderLoopPreflightResult(result: FleetLoopPreflightReport): string {
  const lines = result.machines.map((machine) =>
    `${machine.display_name.padEnd(18)} ${machine.machine_id.padEnd(18)} ${machine.ready ? "ready" : machine.status} route:${machine.route}/${machine.confidence} next:${machine.next_steps.join(",") || "none"}`
  );
  return [
    renderKeyValueTable([
      ["ok", String(result.ok)],
      ["mode", result.mode],
      ["machines", `${result.pagination.count}/${result.pagination.total}`],
      ["ready", String(result.summary.ready)],
      ["runnable", String(result.summary.runnable)],
      ["blocked", String(result.summary.blocked)],
      ["has more", String(result.pagination.hasMore)],
    ]),
    ...lines,
  ].join("\n");
}

function renderFleetOpsCheck(result: FleetOpsCheck): string {
  const lines = result.machines.map((machine) =>
    `${machine.display_name.padEnd(18)} ${machine.machine_id.padEnd(18)} ${machine.status.padEnd(9)} route:${machine.route}/${machine.route_confidence} heartbeat:${machine.heartbeat} sync:${machine.storage_sync_status ?? "unknown"}`
  );
  const issueLines = result.issues.slice(0, 8).map((issue) =>
    `${issue.severity.padEnd(8)} ${issue.classification} ${issue.machine_id ?? "fleet"} ${issue.summary}`
  );
  const taskActionLines = result.task_actions?.length
    ? [
        `task_upserts created=${result.task_actions.filter((action) => action.action === "created").length} existing=${result.task_actions.filter((action) => action.action === "existing").length} failed=${result.task_actions.filter((action) => action.action === "failed").length}`,
      ]
    : [];
  return [
    renderKeyValueTable([
      ["status", result.status],
      ["ok", String(result.ok)],
      ["machines", String(result.summary.machines)],
      ["ready", String(result.summary.ready)],
      ["blocked", String(result.summary.blocked)],
      ["issues", String(result.summary.issues)],
      ["task suggestions", String(result.summary.task_suggestions)],
      ["tmux dead panes", String(result.summary.tmux_dead_panes)],
      ["tmux missing expected", String(result.summary.tmux_missing_expected)],
    ]),
    ...taskActionLines,
    ...lines,
    ...issueLines,
    result.issues.length > issueLines.length ? `${result.issues.length - issueLines.length} more issue(s) in JSON output` : "",
  ].filter(Boolean).join("\n");
}

function renderDispatchFleetSmoke(result: DispatchFleetSmokeReport): string {
  const lines = result.machines.map((machine) =>
    `${machine.target.display_name.padEnd(18)} ${machine.status.padEnd(7)} route:${machine.route_health.route}/${machine.route_health.confidence} package:${machine.package_status.version ?? "missing"} daemon-restart:${machine.daemon.restart_readiness.ready ? "ready" : "not-ready"}`
  );
  return [
    renderKeyValueTable([
      ["ok", String(result.summary.fail === 0)],
      ["dryRun", String(result.dryRun)],
      ["mutates", String(result.mutates)],
      ["redaction", result.redaction.enabled ? result.redaction.marker : "disabled"],
      ["machines", String(result.summary.total)],
      ["package ok", String(result.summary.package_ok)],
      ["daemon restart ready", String(result.summary.daemon_restart_ready)],
      ["warnings", result.warnings.join(", ") || "none"],
    ]),
    ...lines,
  ].join("\n");
}

function renderDbIntegrityReport(result: CriticalDbIntegrityReport): string {
  const taskActions = result.task_actions?.length
    ? ` task_upserts created=${result.task_actions.filter((action) => action.action === "created").length} existing=${result.task_actions.filter((action) => action.action === "existing").length} failed=${result.task_actions.filter((action) => action.action === "failed").length} skipped=${result.task_actions.filter((action) => action.action === "skipped").length}`
    : "";
  const report = result.artifacts.find((artifact) => artifact.kind === "report")?.ref;
  return [
    `machine_data_db_integrity ok=${result.ok} discovered=${result.summary.discovered} checked=${result.summary.checked} failed=${result.summary.failed} skipped=${result.summary.skipped} truncated=${result.summary.truncated} budget_ms=${result.bounds.max_total_ms}${report ? ` report=${report}` : ""}${taskActions}`,
    ...result.findings
      .filter((finding) => finding.status === "failed")
      .slice(0, 5)
      .map((finding) => `failed path=${finding.path} message=${finding.message ?? ""}`),
  ].join("\n");
}

function renderOpsStateSnapshotReport(result: OpsStateSnapshotReport): string {
  const taskActions = result.task_actions?.length
    ? ` task_upserts created=${result.task_actions.filter((action) => action.action === "created").length} existing=${result.task_actions.filter((action) => action.action === "existing").length} failed=${result.task_actions.filter((action) => action.action === "failed").length} skipped=${result.task_actions.filter((action) => action.action === "skipped").length}`
    : "";
  const report = result.artifacts.find((artifact) => artifact.kind === "report")?.ref;
  return [
    `machine_data_ops_state_snapshot ok=${result.ok} apply=${result.apply} discovered=${result.summary.discovered} planned=${result.summary.planned} copied=${result.summary.copied} failed=${result.summary.failed} skipped=${result.summary.skipped} removed_old_snapshots=${result.summary.removed_old_snapshots} truncated=${result.summary.truncated}${result.snapshot_dir ? ` snapshot=${result.snapshot_dir}` : ""}${report ? ` report=${report}` : ""}${taskActions}`,
    ...result.items
      .filter((item) => item.status === "backup_failed" || item.status === "copy_failed")
      .slice(0, 5)
      .map((item) => `failed path=${item.path} method=${item.method} message=${item.message ?? ""}`),
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

function renderProjectAssignments(result: MachineProjectAssignments): string {
  if (result.assignments.length === 0) return "project assignments: none";
  return result.assignments.map((assignment) => {
    const primary = assignment.is_primary ? " primary" : "";
    const path = assignment.path ?? "unresolved";
    return `${assignment.machine_id.padEnd(18)} ${assignment.project_id.padEnd(24)} ${path}${primary}`;
  }).join("\n");
}

function renderNoteMachineContext(result: NoteMachineContext): string {
  const machine = (label: string, ref: NoteMachineContext["origin_machine"]) => {
    if (!ref) return [label, "none"] as [string, string];
    const known = ref.known ? "" : " unknown";
    return [label, `${ref.display_name} (${ref.machine_id})${known}`] as [string, string];
  };
  return [
    renderKeyValueTable([
      machine("origin", result.origin_machine),
      machine("source", result.source_machine),
      machine("target", result.target_machine),
      ["sync targets", result.sync_targets.map((target) => `${target.machine.display_name} (${target.machine_id})`).join(", ") || "none"],
      ["actor", `${result.actor.display_name} (${result.actor.actor_type}/${result.actor.source})`],
      ["warnings", result.warnings.join(", ") || "none"],
    ]),
  ].join("\n");
}

function renderMachineTrashPolicies(result: MachineTrashPolicies): string {
  if (result.policies.length === 0) return "machine trash policies: none";
  const lines = result.policies.map((policy) => {
    const retention = policy.retention_days === null ? "retention:unset" : `retention:${policy.retention_days}d`;
    const deleteAfter = policy.delete_after_days === null ? "delete-after:unset" : `delete-after:${policy.delete_after_days}d`;
    const enabled = policy.enabled === null ? "enabled:unspecified" : `enabled:${policy.enabled}`;
    return `${policy.display_name.padEnd(18)} ${policy.machine_id.padEnd(18)} ${enabled} ${retention} ${deleteAfter} ${policy.source}`;
  });
  return [
    renderKeyValueTable([
      ["policies", `${result.pagination.count}/${result.pagination.total}`],
      ["limit", String(result.pagination.limit ?? "all")],
      ["offset", String(result.pagination.offset)],
      ["has more", String(result.pagination.hasMore)],
      ["warnings", result.warnings.join(", ") || "none"],
    ]),
    ...lines,
  ].join("\n");
}

function renderMachineDetails(result: MachineDetails): string {
  const lines = [
    renderKeyValueTable([
      ["name", result.display_name],
      ["machine", result.machine_id],
      ["status", result.status.label],
      ["platform", result.platform ?? "unknown"],
      ["type", result.machine_type ?? "unknown"],
      ["role", result.role ?? result.roles?.join(", ") ?? "unknown"],
      ["capabilities", result.machine_capabilities?.join(", ") ?? "unknown"],
      ["updated", result.updated_at ?? "unknown"],
      ["last seen", result.last_seen_at ?? "unknown"],
      ["recent sync", result.timestamps.recent_sync_at ?? "unknown"],
      ["source", result.source.metadata_source],
      ["warnings", result.warnings.join(", ") || "none"],
    ]),
  ];
  if (result.display_metadata && Object.keys(result.display_metadata).length > 0) {
    lines.push(renderList("display metadata", Object.entries(result.display_metadata).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)));
  }
  return lines.join("\n");
}

function renderBrowserPlanFleet(result: BrowserPlanFleet): string {
  const lines = [
    renderKeyValueTable([
      ["target", result.target.name],
      ["machines", `${result.coverage.known}/${result.coverage.expected} known`],
      ["missing", result.coverage.missing.join(", ") || "none"],
      ["unreachable", result.coverage.unreachable.join(", ") || "none"],
      ["excluded", result.target.install_target_excludes.join(", ")],
      ["warnings", result.warnings.join(", ") || "none"],
    ]),
  ];
  for (const machine of result.machines) {
    const route = machine.reachability.ok ? `${machine.reachability.route}/${machine.reachability.confidence}` : "unreachable";
    const browserplan = machine.install_state.browserplan_cli.state;
    const chrome = machine.install_state.chrome.state;
    lines.push(`${machine.display_name.padEnd(18)} ${machine.machine_id.padEnd(10)} ${String(machine.platform ?? "unknown").padEnd(8)} ${machine.status.label.padEnd(7)} ${route.padEnd(16)} browserplan:${browserplan} chrome:${chrome}`);
  }
  return lines.join("\n");
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
      `${(machine.displayName ?? machine.machineId).padEnd(18)} ${machine.machineId.padEnd(18)} ${machine.platform || "unknown"} ${machine.heartbeatStatus} ${machine.agentMode || "agent:unknown"} ${machine.storageSyncStatus || "storage:unknown"} ${machine.updatedAt || machine.lastHeartbeatAt || "—"}`
    ),
  ].join("\n");
}

function renderHeartbeatCollect(results: HeartbeatCollectResult[]): string {
  return results.map((result) => {
    const marker = result.status === "imported" ? chalk.green("imported") : chalk.red("failed");
    const detail = result.status === "imported"
      ? `${result.updatedAt} ${result.daemonVersion ?? "version:unknown"} ${result.storageSyncStatus ?? "storage:unknown"}`
      : result.error ?? "unknown error";
    return `${result.machineId.padEnd(14)} ${marker} ${String(result.source ?? "unknown").padEnd(9)} ${detail}`;
  }).join("\n");
}

function renderHeartbeatCollectorCommand(plan: HeartbeatCollectorCommandPlan): string {
  return plan.command;
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
const eventWebhooksCommand = program.command("webhooks").description("Manage shared event webhook subscriptions");
const eventsCommand = program.command("events").description("Emit, list, and replay shared events");
const runtimeCommand = program.command("runtime").description("Watch runtime conditions and emit shared events");
const clipboardCommand = program.command("clipboard").description("Real-time clipboard sync across fleet machines");
const installClaudeCommand = program.command("install-claude").description("Install or inspect Claude, Codex, and Gemini CLIs");
const daemonCommand = program.command("daemon").description("Install and inspect the machines-daemon fleet daemon service");
const heartbeatCommand = program.command("heartbeat").description("Collect and inspect machines-daemon heartbeat rows");
const projectsCommand = program.command("projects").description("Expose machine/project assignments for @hasna/projects");
const notesCommand = program.command("notes").description("Expose note ownership, provenance, and per-machine trash contracts");
const browserPlanCommand = program.command("browserplan").description("Expose BrowserPlan fleet contracts for open-chrome");
const trustedNotificationApproval = createTrustedNotificationApproval();

function cliMachineId(machineId: string | null | undefined): string {
  return machineId?.trim() || "local";
}

function cliResourceId(kind: string, ...parts: Array<string | number | boolean | undefined | null>): string {
  const values = parts
    .map((part) => String(part ?? "*").trim())
    .filter(Boolean)
    .join(":");
  return values ? `${kind}:${values}` : kind;
}

function cliMutationCallerId(): string {
  return process.env["HASNA_MACHINES_MUTATION_CALLER_ID"]?.trim() || "cli";
}

function cliMutationRunId(): string {
  return process.env["HASNA_MACHINES_MUTATION_RUN_ID"]?.trim() || "cli";
}

function requireCliMutation(
  operation: string,
  approvalToken: string | undefined,
  scope: { machineId?: string | null; resourceId?: string | null; args?: unknown } = {},
): void {
  assertMutationApproved({
    surface: "cli",
    operation,
    transport: "cli",
    callerId: cliMutationCallerId(),
    runId: cliMutationRunId(),
    machineId: scope.machineId === undefined ? undefined : cliMachineId(scope.machineId),
    resourceId: scope.resourceId === undefined || scope.resourceId === null ? undefined : scope.resourceId,
    args: scope.args,
    approvalToken,
  });
}

function cliPlanApprovalArgs<T extends Record<string, unknown>>(args: T, plan: unknown): T & { plan_digest: string } {
  return {
    ...args,
    plan_digest: mutationPlanDigest(plan),
  };
}

function cliPlanResourceId(operation: string, machineId: string, plan: unknown): string {
  return cliResourceId("plan", operation, machineId, mutationPlanDigest(plan));
}

function createEventsClient(): EventsClient {
  return new EventsClient();
}

function eventStoreDir(): string {
  return resolve(getEventsDataDir());
}

function eventStoreScope(): { event_store_dir: string } {
  return { event_store_dir: eventStoreDir() };
}

function eventStoreResourceId(kind: string, ...parts: Array<string | number | boolean | undefined | null>): string {
  return cliResourceId(kind, mutationArgsSha256(eventStoreScope()), ...parts);
}

function withEventStoreScope<T extends Record<string, unknown>>(args: T): T & { event_store_dir: string } {
  return { event_store_dir: eventStoreDir(), ...args };
}

function readJsonArrayFile<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`Expected ${path} to contain a JSON array.`);
  return parsed as T[];
}

function readEventChannelsWithoutInit(): ChannelConfig[] {
  return readJsonArrayFile<ChannelConfig>(join(eventStoreDir(), "channels.json"));
}

function readEventsWithoutInit(): EventEnvelope[] {
  return readJsonArrayFile<EventEnvelope>(join(eventStoreDir(), "events.json"));
}

function filterEventsForReplay(events: EventEnvelope[], options: { id?: string; source?: string; type?: string }): EventEnvelope[] {
  return events.filter((event) => {
    if (options.id && event.id !== options.id) return false;
    if (options.source && event.source !== options.source) return false;
    if (options.type && event.type !== options.type) return false;
    return true;
  });
}

function collectOptionValues(value: string, previous: string[] = []): string[] {
  previous.push(value);
  return previous;
}

function parseNumberOption(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a finite number, got ${value}`);
  return parsed;
}

function parseJsonObjectOption(value: string | undefined, fallback: Record<string, unknown>): Record<string, unknown> {
  if (value === undefined) return fallback;
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function parseHeaderOptions(values: string[] | undefined): Record<string, string> | undefined {
  if (!values?.length) return undefined;
  const headers: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator === -1) throw new Error(`Invalid header, expected name=value: ${value}`);
    headers[value.slice(0, separator)] = value.slice(separator + 1);
  }
  return headers;
}

function buildEventFilter(options: {
  source?: string;
  type?: string;
  subject?: string;
  severity?: string;
}): EventFilter[] | undefined {
  const filter: EventFilter = {};
  if (options.source) filter.source = options.source;
  if (options.type) filter.type = options.type;
  if (options.subject) filter.subject = options.subject;
  if (options.severity) filter.severity = options.severity;
  return Object.keys(filter).length > 0 ? [filter] : undefined;
}

function wantsCommandJson(options: { json?: boolean }, command: Command): boolean {
  return Boolean(options.json || command.optsWithGlobals?.().json || command.parent?.optsWithGlobals?.().json || program.opts().quiet);
}

function printCommandResult(data: unknown, text: string, json: boolean): void {
  if (json || program.opts().quiet) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(text);
}

interface WebhookAddCliOptions {
  id: string;
  transport: "webhook" | "command" | string;
  name?: string;
  type?: string;
  source?: string;
  subject?: string;
  severity?: string;
  secret?: string;
  header?: string[];
  arg?: string[];
  timeoutMs?: number;
  retryAttempts?: number;
  retryBackoffMs?: number;
  redact?: string[];
  disabled?: boolean;
  approvalToken?: string;
  json?: boolean;
}

interface WebhookTestCliOptions {
  type: string;
  subject?: string;
  message: string;
  data?: string;
  approvalToken?: string;
  json?: boolean;
}

interface EventsEmitCliOptions {
  source?: string;
  subject?: string;
  severity: EventSeverity;
  message?: string;
  dedupeKey?: string;
  data?: string;
  metadata?: string;
  deliver?: boolean;
  dedupe?: boolean;
  approvalToken?: string;
  json?: boolean;
}

interface EventsReplayCliOptions {
  id?: string;
  source?: string;
  type?: string;
  dryRun?: boolean;
  approvalToken?: string;
  json?: boolean;
}

interface RuntimeTmuxWatchCliOptions {
  intervalMs?: string;
  maxChecks?: string;
  once?: boolean;
  deliver?: boolean;
  approvalToken?: string;
  json?: boolean;
}

function runtimeTmuxCommand(): string {
  return process.env["HASNA_MACHINES_TMUX_BIN"]?.trim() || "tmux";
}

function runtimeTmuxEventTypes(once: boolean): string[] {
  return once ? ["machines.tmux.pane_missing"] : ["machines.tmux.pane_died"];
}

eventWebhooksCommand
  .command("add")
  .description("Add or replace a webhook or command subscription")
  .argument("<target>", "Webhook URL or command binary")
  .requiredOption("--id <id>", "Subscription/channel identifier")
  .option("--transport <kind>", "Transport kind: webhook or command", "webhook")
  .option("--name <name>", "Display name")
  .option("--type <pattern>", "Event type filter, e.g. todos.task.*")
  .option("--source <pattern>", "Event source filter")
  .option("--subject <pattern>", "Event subject filter")
  .option("--severity <pattern>", "Event severity filter")
  .option("--secret <secret>", "Webhook HMAC secret")
  .option("--header <name=value...>", "Webhook header", collectOptionValues, [])
  .option("--arg <arg...>", "Command argument", collectOptionValues, [])
  .option("--timeout-ms <ms>", "Transport timeout in milliseconds", parseNumberOption)
  .option("--retry-attempts <n>", "Maximum delivery attempts", parseNumberOption)
  .option("--retry-backoff-ms <ms>", "Initial retry backoff in milliseconds", parseNumberOption)
  .option("--redact <path...>", "Event field path to redact before delivery", collectOptionValues, [])
  .option("--disabled", "Create channel disabled", false)
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action(async (target: string, options: WebhookAddCliOptions, command: Command) => {
    const headers = parseHeaderOptions(options.header);
    const commandArgs = options.arg ?? [];
    const redactPaths = options.redact ?? [];
    const enabled = !options.disabled;
    const filter = buildEventFilter(options);
    const channel: Omit<ChannelConfig, "createdAt" | "updatedAt"> = {
      id: options.id,
      name: options.name,
      enabled,
      transport: options.transport as ChannelConfig["transport"],
      filters: filter,
      retry: options.retryAttempts || options.retryBackoffMs
        ? { maxAttempts: options.retryAttempts, backoffMs: options.retryBackoffMs }
        : undefined,
      redact: redactPaths.length > 0 ? { paths: redactPaths } : undefined,
    };
    if (options.transport === "webhook") {
      channel.webhook = { url: target, secret: options.secret, headers, timeoutMs: options.timeoutMs };
    } else if (options.transport === "command") {
      channel.command = { command: target, args: commandArgs, timeoutMs: options.timeoutMs };
    } else {
      throw new Error(`Transport ${options.transport} is reserved for future use and cannot be added yet`);
    }

    requireCliMutation("machines_webhooks_add", options.approvalToken, {
      resourceId: eventStoreResourceId("webhook", options.id),
      args: withEventStoreScope({
        channel_id: options.id,
        target,
        transport: options.transport,
        name: options.name,
        event_type: options.type,
        source: options.source,
        subject: options.subject,
        severity: options.severity,
        secret: options.secret,
        headers,
        args: commandArgs,
        timeout_ms: options.timeoutMs,
        retry_attempts: options.retryAttempts,
        retry_backoff_ms: options.retryBackoffMs,
        redact: redactPaths,
        enabled,
      }),
    });
    const saved = await createEventsClient().addChannel(channel);
    printCommandResult(sanitizeChannelForOutput(saved), `Added ${saved.transport} channel ${saved.id}`, wantsCommandJson(options, command));
  });

eventWebhooksCommand.command("list").description("List configured subscriptions").option("-j, --json", "Print JSON output", false).action(async (options: { json?: boolean }, command: Command) => {
  const channels = readEventChannelsWithoutInit();
  if (wantsCommandJson(options, command)) {
    console.log(JSON.stringify(sanitizeChannelsForOutput(channels), null, 2));
    return;
  }
  if (!channels.length) {
    console.log("No channels configured.");
    return;
  }
  for (const channel of channels) {
    console.log(`${channel.id}\t${channel.enabled ? "enabled" : "disabled"}\t${channel.transport}\t${channel.webhook?.url ?? channel.command?.command ?? channel.transport}`);
  }
});

eventWebhooksCommand
  .command("remove")
  .description("Remove a subscription")
  .argument("<id>", "Subscription/channel identifier")
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action(async (id: string, options: { approvalToken?: string; json?: boolean }, command: Command) => {
    requireCliMutation("machines_webhooks_remove", options.approvalToken, {
      resourceId: eventStoreResourceId("webhook", id),
      args: withEventStoreScope({ channel_id: id }),
    });
    const removed = await createEventsClient().removeChannel(id);
    printCommandResult({ removed }, removed ? `Removed ${id}` : `Channel not found: ${id}`, wantsCommandJson(options, command));
  });

eventWebhooksCommand
  .command("test")
  .description("Send a test event to one subscription")
  .argument("<id>", "Subscription/channel identifier")
  .option("--type <type>", "Event type", "events.test")
  .option("--subject <subject>", "Event subject")
  .option("--message <message>", "Event message", "Shared events test delivery")
  .option("--data <json>", "Event data JSON object")
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action(async (id: string, options: WebhookTestCliOptions, command: Command) => {
    const data = parseJsonObjectOption(options.data, { test: true });
    const subject = options.subject ?? id;
    requireCliMutation("machines_webhooks_test", options.approvalToken, {
      resourceId: eventStoreResourceId("webhook-test", id, options.type),
      args: withEventStoreScope({ channel_id: id, event_type: options.type, subject, message: options.message, data }),
    });
    const result = await createEventsClient().testChannel(id, {
      source: "machines",
      type: options.type,
      subject,
      message: options.message,
      data,
    });
    printCommandResult(result, `${result.status}: ${result.channelId}`, wantsCommandJson(options, command));
  });

eventsCommand
  .command("emit")
  .description("Emit an event from this app")
  .argument("<type>", "Event type")
  .option("--source <source>", "Event source override")
  .option("--subject <subject>", "Event subject")
  .option("--severity <severity>", "Event severity", "info")
  .option("--message <message>", "Event message")
  .option("--dedupe-key <key>", "Dedupe key")
  .option("--data <json>", "Event data JSON object")
  .option("--metadata <json>", "Event metadata JSON object")
  .option("--no-deliver", "Record without delivering")
  .option("--no-dedupe", "Allow duplicate id/dedupeKey events")
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action(async (type: string, options: EventsEmitCliOptions, command: Command) => {
    const source = options.source ?? "machines";
    const data = parseJsonObjectOption(options.data, {});
    const metadata = parseJsonObjectOption(options.metadata, {});
    requireCliMutation("machines_events_emit", options.approvalToken, {
      resourceId: eventStoreResourceId("event", type, options.subject, options.dedupeKey),
      args: withEventStoreScope({
        event_type: type,
        source,
        subject: options.subject,
        severity: options.severity,
        message: options.message,
        data,
        metadata,
        dedupe_key: options.dedupeKey,
        deliver: options.deliver,
        dedupe: options.dedupe,
      }),
    });
    const result = await createEventsClient().emit({
      source,
      type,
      subject: options.subject,
      severity: options.severity,
      message: options.message,
      dedupeKey: options.dedupeKey,
      data,
      metadata,
    }, { deliver: options.deliver, dedupe: options.dedupe });
    printCommandResult(result, `${result.deduped ? "Deduped" : "Emitted"} ${result.event.id} to ${result.deliveries.length} channel(s)`, wantsCommandJson(options, command));
  });

eventsCommand
  .command("list")
  .description("List recorded events")
  .option("--source <source>", "Filter by source")
  .option("--type <type>", "Filter by type")
  .option("--limit <n>", "Limit results", parseNumberOption)
  .option("-j, --json", "Print JSON output", false)
  .action(async (options: { source?: string; type?: string; limit?: number; json?: boolean }, command: Command) => {
    let rows = readEventsWithoutInit();
    if (options.source) rows = rows.filter((event) => event.source === options.source);
    if (options.type) rows = rows.filter((event) => event.type === options.type);
    if (options.limit) rows = rows.slice(-options.limit);
    if (wantsCommandJson(options, command)) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (!rows.length) {
      console.log("No events recorded.");
      return;
    }
    for (const event of rows) {
      console.log(`${event.time}\t${event.id}\t${event.source}\t${event.type}\t${event.severity}`);
    }
  });

eventsCommand
  .command("replay")
  .description("Replay recorded events")
  .option("--id <id>", "Replay one event id")
  .option("--source <source>", "Filter by source")
  .option("--type <type>", "Filter by type")
  .option("--dry-run", "Preview without delivery", false)
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action(async (options: EventsReplayCliOptions, command: Command) => {
    if (options.dryRun !== true) {
      requireCliMutation("machines_events_replay", options.approvalToken, {
        resourceId: eventStoreResourceId("event-replay", options.id, options.source, options.type),
        args: withEventStoreScope({ event_id: options.id, source: options.source, event_type: options.type, dry_run: false }),
      });
    }
    const result = options.dryRun === true ? { events: filterEventsForReplay(readEventsWithoutInit(), options), deliveries: [] } : await createEventsClient().replay({
      eventId: options.id,
      source: options.source,
      type: options.type,
      dryRun: options.dryRun,
    });
    printCommandResult(result, `Replayed ${result.events.length} event(s), ${result.deliveries.length} delivery result(s)`, wantsCommandJson(options, command));
  });

function addDaemonLifecycleCommand(action: DaemonServiceAction, description: string): void {
  daemonCommand
    .command(action)
    .description(description)
    .option("--platform <platform>", "Service platform to plan for (macos, linux)")
    .option("--mode <mode>", "Service mode (user, system)", "user")
    .option("--service-name <name>", "Service name/label", "machines-daemon")
    .option("--executable <path>", "Absolute machines-daemon executable path")
    .option("--interval-ms <ms>", "Heartbeat interval in milliseconds")
    .option("--storage-push", "Configure daemon to push heartbeat rows to storage", false)
    .option("--doctor-summary", "Configure daemon to include lightweight doctor summaries", false)
    .option("--private-metadata", "Opt in to private host/network metadata in heartbeat rows", false)
    .option("--env <name...>", "Environment variable names to include as placeholders")
    .option("--apply", "Write service files and run planned commands", false)
    .option("--yes", "Confirm execution when using --apply", false)
    .option("--approval-token <token>", "Scoped mutation approval token")
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
      approvalToken?: string;
      json?: boolean;
    }) => {
      const planOptions = parseDaemonOptions(action, options);
      const plan = buildDaemonServicePlan(planOptions);
      if (options.apply) {
        requireCliMutation(`daemon_${action}`, options.approvalToken, { resourceId: cliResourceId("daemon", action, options.serviceName), args: planOptions });
      }
      const result = runDaemonServicePlan(plan, { apply: options.apply, yes: options.yes });
      if (options.json || options.apply) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(renderDaemonPlan(plan));
    });
}

addDaemonLifecycleCommand("install", "Plan or install the machines-daemon daemon service");
addDaemonLifecycleCommand("uninstall", "Plan or uninstall the machines-daemon daemon service");
addDaemonLifecycleCommand("restart", "Plan or restart the machines-daemon daemon service");
addDaemonLifecycleCommand("status", "Plan a daemon service status command");
addDaemonLifecycleCommand("logs", "Plan a daemon service log command");

heartbeatCommand
  .command("collector-command")
  .description("Print the canonical trusted OpenLoops command for the heartbeat collector")
  .option("--machine <id...>", "Machine identifier to include; repeat for low-latency peers; defaults to the local machine", collectOptionValues)
  .option("--timeout-ms <ms>", "Per-machine command timeout in milliseconds")
  .option("--machines-command <command>", "machines CLI command or absolute path", "machines")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string[]; timeoutMs?: string; machinesCommand?: string; json?: boolean }, command: Command) => {
    const plan = buildHeartbeatCollectorCommand({
      machines: options.machine,
      timeoutMs: options.timeoutMs ? parseIntegerOption(options.timeoutMs, "timeout-ms", { min: 1 }) : undefined,
      machinesCommand: options.machinesCommand,
    });
    printCommandResult(plan, renderHeartbeatCollectorCommand(plan), wantsCommandJson(options, command));
  });

heartbeatCommand
  .command("collect")
  .description("Run one-shot machines-daemon heartbeats over machine routes and import public rows locally")
  .option("--machine <id...>", "Machine identifier to collect; repeat for multiple machines", collectOptionValues, [])
  .option("--timeout-ms <ms>", "Per-machine command timeout in milliseconds")
  .option("--no-doctor-summary", "Skip doctor summary collection even when the remote agent supports it")
  .option("--fail-on-error", "Deprecated: collect now always exits non-zero on any failed import (flag retained for compatibility)", false)
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string[]; timeoutMs?: string; doctorSummary?: boolean; failOnError?: boolean; approvalToken?: string; json?: boolean }, command: Command) => {
    const collectOptions = {
      machines: options.machine,
      timeoutMs: options.timeoutMs ? parseIntegerOption(options.timeoutMs, "timeout-ms", { min: 1 }) : undefined,
      doctorSummary: options.doctorSummary,
    };
    requireCliMutation(HEARTBEAT_COLLECT_MUTATION_OPERATION, options.approvalToken, {
      resourceId: heartbeatCollectResourceId(collectOptions),
      args: heartbeatCollectMutationArgs(collectOptions),
    });
    const results = collectHeartbeats({
      ...collectOptions,
      trustedLocalMutation: createTrustedSdkMutationApproval(),
    });
    printCommandResult(results, renderHeartbeatCollect(results), wantsCommandJson(options, command));
    // collect always exits non-zero on any failed import; --fail-on-error is a
    // deprecated no-op retained for backwards compatibility.
    void options.failOnError;
    if (results.some((result) => result.status !== "imported")) {
      process.exitCode = 1;
    }
  });

manifestCommand.command("init").description("Create an empty fleet manifest")
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { approvalToken?: string; json?: boolean }) => {
    requireCliMutation("manifest_init", options.approvalToken, { resourceId: "manifest:init", args: {} });
    const manifestPath = manifestInit();
    printJsonOrText({ manifest_path: manifestPath }, manifestPath, options.json);
  });

manifestCommand.command("path").description("Print the manifest path")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { json?: boolean }) => {
    const manifestPath = getManifestPath();
    printJsonOrText({ manifest_path: manifestPath }, manifestPath, options.json);
  });

manifestCommand.command("list").description("Print the fleet manifest")
  .option("-j, --json", "Print JSON output", false)
  .action(() => {
    console.log(JSON.stringify(manifestList(), null, 2));
  });

manifestCommand.command("validate").description("Validate the fleet manifest")
  .option("-j, --json", "Print JSON output", false)
  .action(() => {
    console.log(JSON.stringify(manifestValidate(), null, 2));
  });

manifestCommand.command("bootstrap").description("Detect and upsert the current machine into the manifest")
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { approvalToken?: string }) => {
    requireCliMutation("manifest_bootstrap", options.approvalToken, { resourceId: "manifest:bootstrap", args: {} });
    console.log(JSON.stringify(manifestBootstrapCurrentMachine(), null, 2));
  });

manifestCommand
  .command("get")
  .description("Print a single machine from the manifest")
  .argument("<id>", "Machine identifier")
  .option("-j, --json", "Print JSON output", false)
  .action((id: string) => {
    const machine = manifestGet(id);
    if (!machine) {
      process.exitCode = 1;
      console.error(`Machine not found: ${id}`);
      return;
    }
    console.log(JSON.stringify(machine, null, 2));
  });

const manifestFriendlyNameCommand = manifestCommand
  .command("friendly-name")
  .description("Read or update a user-friendly display name without changing the stable machine id");

manifestFriendlyNameCommand
  .command("get")
  .description("Read a machine friendly name and computed display name")
  .argument("<id>", "Machine identifier")
  .option("-j, --json", "Print JSON output", false)
  .action((id: string, options: { json?: boolean }) => {
    try {
      const result = manifestGetFriendlyName(id);
      printJsonOrText(result, renderKeyValueTable([
        ["machine", result.machine_id],
        ["friendly name", result.friendly_name ?? "none"],
        ["display name", result.display_name],
        ["updated", result.updated_at ?? "unknown"],
      ]), options.json);
    } catch (error) {
      process.exitCode = 1;
      console.error(error instanceof Error ? error.message : String(error));
    }
  });

manifestFriendlyNameCommand
  .command("set")
  .description("Set a user-friendly display name for a machine")
  .argument("<id>", "Machine identifier")
  .argument("<name>", "Friendly display name")
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((id: string, name: string, options: { approvalToken?: string; json?: boolean }) => {
    const input = { machineId: id, friendlyName: name };
    requireCliMutation("machines_friendly_name_set", options.approvalToken, {
      machineId: input.machineId,
      resourceId: machineFriendlyNameResourceId(input.machineId),
      args: setMachineFriendlyNameMutationArgs(input),
    });
    const result = manifestSetFriendlyName(input);
    printJsonOrText(result, `display name: ${result.display_name}`, options.json);
  });

manifestFriendlyNameCommand
  .command("clear")
  .description("Clear a machine friendly name so consumers fall back to the stable id")
  .argument("<id>", "Machine identifier")
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((id: string, options: { approvalToken?: string; json?: boolean }) => {
    const input = { machineId: id };
    requireCliMutation("machines_friendly_name_clear", options.approvalToken, {
      machineId: input.machineId,
      resourceId: machineFriendlyNameResourceId(input.machineId),
      args: clearMachineFriendlyNameMutationArgs(input),
    });
    const result = manifestClearFriendlyName(input);
    printJsonOrText(result, `display name: ${result.display_name}`, options.json);
  });

manifestCommand
  .command("remove")
  .description("Remove a machine from the manifest")
  .argument("<id>", "Machine identifier")
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((id: string, options: { approvalToken?: string }) => {
    requireCliMutation("manifest_remove", options.approvalToken, { machineId: id, args: { machine_id: id } });
    console.log(JSON.stringify(manifestRemove(id), null, 2));
  });

manifestCommand
  .command("add")
  .description("Add or replace a machine in the fleet manifest")
  .option("--id <id>", "Machine identifier")
  .option("--platform <platform>", "linux | macos | windows")
  .option("--workspace-path <path>", "Primary workspace path")
  .option("--friendly-name <name>", "User-friendly display name; stable --id is unchanged")
  .option("--hostname <hostname>", "Machine hostname")
  .option("--ssh-address <sshAddress>", "Machine SSH address")
  .option("--tailscale-name <tailscaleName>", "Machine Tailscale DNS name")
  .option(
    "--connection <connection>",
    "local | ssh | tailscale. An SSM-reached AWS station is `ssh` with --ssh-address set to its VPC-private DNS: SSM carries real SSH (AWS-StartSSHSession) via a client-side ProxyCommand, which is ssh config, not registry data (ruling 2026-07-30)"
  )
  .option("--bun-path <path>", "Bun executable directory")
  .option("--tag <tag...>", "Machine tags")
  .option("--package <name...>", "Desired packages")
  .option("--app <spec...>", "Desired simple apps as name[:manager[:packageName]]; use --from-stdin for exact custom commands")
  .option("--file <spec...>", "File sync spec source:target[:copy|symlink]")
  .option("--metadata <json>", "Machine metadata as JSON")
  .option("--from-stdin", "Read the full MachineManifest JSON from stdin")
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((options: Record<string, string | string[] | boolean | undefined>) => {
    const fromStdin = Boolean(options["fromStdin"] || options["from-stdin"]);
    if (fromStdin) {
      if (process.stdin.isTTY) {
        console.error("error: --from-stdin requires piped input");
        process.exit(1);
      }
      const input = readFileSync(0, "utf8");
      const machine = JSON.parse(input) as MachineManifest;
      requireCliMutation("manifest_add", typeof options["approvalToken"] === "string" ? options["approvalToken"] : undefined, { machineId: machine.id, args: machine });
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
      friendlyName: options["friendlyName"] ? String(options["friendlyName"]) : undefined,
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
    requireCliMutation("manifest_add", typeof options["approvalToken"] === "string" ? options["approvalToken"] : undefined, { machineId: machine.id, args: machine });
    console.log(JSON.stringify(manifestAdd(machine), null, 2));
  });

appsCommand
  .command("list")
  .description("List manifest-managed apps for a machine")
  .option("--machine <id>", "Machine identifier")
  .option("--manifest <path>", "Exact candidate manifest path")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; manifest?: string; json?: boolean }) => {
    const result = listApps(options.machine, { manifestPath: options.manifest });
    printJsonOrText(result, renderAppsListResult(result), options.json);
  });

appsCommand
  .command("validate")
  .description("Validate one target-only exact app candidate manifest")
  .requiredOption("--manifest <path>", "Exact candidate manifest path")
  .requiredOption("--machine <id>", "Machine identifier")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine: string; manifest: string; json?: boolean }) => {
    const result = validateAppsCandidate(options.machine, { manifestPath: options.manifest });
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exitCode = 1;
  });

appsCommand
  .command("status")
  .description("Check installed state for manifest-managed apps")
  .option("--machine <id>", "Machine identifier")
  .option("--manifest <path>", "Exact candidate manifest path")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; manifest?: string; json?: boolean }) => {
    const result = getAppsStatus(options.machine, undefined, { manifestPath: options.manifest });
    if ("schema" in result) console.log(JSON.stringify(result, null, 2));
    else printJsonOrText(result, renderAppsStatusResult(result), options.json);
  });

appsCommand
  .command("diff")
  .description("Show missing and installed manifest-managed apps")
  .option("--machine <id>", "Machine identifier")
  .option("--manifest <path>", "Exact candidate manifest path")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; manifest?: string; json?: boolean }) => {
    const result = diffApps(options.machine, undefined, { manifestPath: options.manifest });
    printJsonOrText(result, renderAppsDiffResult(result), options.json);
  });

appsCommand
  .command("plan")
  .description("Preview app install steps for a machine")
  .option("--machine <id>", "Machine identifier")
  .option("--manifest <path>", "Exact candidate manifest path")
  .option("--installed-state <path>", "Exact status proof JSON used to derive remaining steps")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; manifest?: string; installedState?: string; json?: boolean }) => {
    const result = buildAppsPlan(options.machine, {
      manifestPath: options.manifest,
      installedState: readExactBunInstalledState(options.installedState),
    });
    console.log(JSON.stringify(result, null, 2));
  });

appsCommand
  .command("apply")
  .description("Install manifest-managed apps for a machine")
  .option("--machine <id>", "Machine identifier")
  .option("--manifest <path>", "Exact candidate manifest path")
  .option("--installed-state <path>", "Exact status proof JSON used to derive remaining steps")
  .option("--expected-plan-digest <sha256>", "Required digest of the validated exact plan")
  .option("--yes", "Confirm execution", false)
  .option("--approval-token <token>", "Scoped mutation approval token")
  .action((options: { machine?: string; manifest?: string; installedState?: string; expectedPlanDigest?: string; yes?: boolean; approvalToken?: string }) => {
    const resolvedMachineId = cliMachineId(options.machine);
    const installedState = readExactBunInstalledState(options.installedState);
    const plan = buildAppsPlan(options.machine, { manifestPath: options.manifest, installedState });
    requireCliMutation("apps_apply", options.approvalToken, {
      machineId: resolvedMachineId,
      resourceId: cliPlanResourceId("apps_apply", resolvedMachineId, plan),
      args: cliPlanApprovalArgs({ machine_id: resolvedMachineId, yes: options.yes }, plan),
    });
    const result = runAppsPlan(plan, {
      apply: true,
      yes: options.yes,
      expectedPlanDigest: options.expectedPlanDigest,
      manifestPath: options.manifest,
      installedState,
    });
    console.log(JSON.stringify(result, null, 2));
  });

const testProfileCommand = program
  .command("test-profile")
  .description("Manage the local aggregate workstation test controller profile");

testProfileCommand
  .command("check")
  .description("Verify the current derived profile, managed drop-in, and active controller")
  .option("-j, --json", "Print JSON output", false)
  .action(() => {
    const verification = readWorkstationTestProfile().verification;
    console.log(JSON.stringify(verification, null, 2));
    if (verification.admission !== "allowed") process.exitCode = 1;
  });

testProfileCommand
  .command("apply")
  .description("Apply and activate the current machine-derived aggregate test profile")
  .option("--yes", "Confirm the reversible local profile mutation", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { yes?: boolean }) => {
    if (!options.yes) throw new Error("test-profile apply requires --yes");
    const profile = deriveWorkstationTestProfile(readMachineTestAuthority());
    const paths = workstationTestProfilePaths({ homeDir: process.env["HOME"] ?? "" });
    const result = applyWorkstationTestProfile({
      profile,
      paths,
      store: createNodeWorkstationTestProfileStore(),
      controller: createSystemdUserTestProfileController(),
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.admission !== "allowed") process.exitCode = 1;
  });

testProfileCommand
  .command("rollback")
  .description("Restore the exact recorded profile preimage and prior runtime state")
  .option("--yes", "Confirm the reversible local profile rollback", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { yes?: boolean }) => {
    if (!options.yes) throw new Error("test-profile rollback requires --yes");
    const result = rollbackWorkstationTestProfile({
      paths: workstationTestProfilePaths({ homeDir: process.env["HOME"] ?? "" }),
      store: createNodeWorkstationTestProfileStore(),
      controller: createSystemdUserTestProfileController(),
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "rolled-back") process.exitCode = 1;
  });

program
  .command("setup")
  .description("Prepare a machine from the fleet manifest (optionally against a station template)")
  .option("--machine <id>", "Machine identifier")
  .option("--template <spec>", "Station template layers, e.g. 'station' or 'station,ec2' or 'station,dgx-spark'")
  .option("--station <name>", "Station identity for template renders (hostname/tailscale name, e.g. station17)")
  .option("--check", "Report LOCAL template drift as JSON without mutating anything (requires --template)", false)
  .option(
    "--no-fail-on-findings",
    "With --check, always exit 0 (the pre-template-1.8.0 behaviour) instead of 1 for findings / 2 for an incomplete check"
  )
  .option("--render <target>", "Render the template for a target ('cloud-init') instead of executing (requires --template)")
  .option("--apply", "Execute provisioning commands instead of previewing the plan", false)
  .option("--yes", "Confirm execution when using --apply", false)
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((options: {
    machine?: string;
    template?: string;
    station?: string;
    check?: boolean;
    failOnFindings?: boolean;
    render?: string;
    apply?: boolean;
    yes?: boolean;
    approvalToken?: string;
    json?: boolean;
  }) => {
    if ((options.check || options.render) && !options.template) {
      throw new Error("--check and --render require --template <spec>.");
    }
    let templateSteps: ReturnType<typeof buildStationTemplateSteps> = [];
    if (options.template) {
      const spec = parseTemplateSpec(options.template);
      const effective = resolveStationTemplate(spec.overlays, { name: spec.name });
      if (options.render) {
        if (options.render !== "cloud-init") {
          throw new Error(`Unknown render target: ${options.render} (supported: cloud-init)`);
        }
        process.stdout.write(renderCloudInit(effective, { station: options.station }));
        return;
      }
      if (options.check) {
        // --check reads THIS box's filesystem. Accepting --machine for another
        // host would report the local state under a remote name, so a fleet
        // sweep would see the coordinator's own box N times and call it
        // converged. Reject the combination instead of answering wrongly.
        const localMachineId = getLocalMachineId();
        const requested = options.machine?.trim();
        if (requested && requested !== "local" && requested !== "localhost" && requested !== localMachineId) {
          throw new Error(
            `--check inspects the local box (${localMachineId}) and cannot target --machine ${requested}. Run it over SSH on that machine instead.`
          );
        }
        const result = checkStationTemplate(effective, { machineId: localMachineId });
        console.log(JSON.stringify(result, null, 2));
        // A gate that cannot fail is not a gate (defect 2bfe61b0). Before
        // template 1.8.0 this exited 0 whether the verdict was clean or drift, so every caller
        // in the fleet parsed the JSON and recorded "check_rc=0 (NOT trusted)".
        // 0 clean / 1 findings / 2 incomplete — see checkExitCode.
        // process.exitCode, not process.exit(): the JSON above must flush.
        if (options.failOnFindings !== false) process.exitCode = checkExitCode(result);
        return;
      }
      templateSteps = buildStationTemplateSteps(effective, { station: options.station });
    }
    if (options.apply) {
      const resolvedMachineId = cliMachineId(options.machine);
      const basePlan = buildSetupPlan(options.machine);
      const plan = { ...basePlan, steps: [...basePlan.steps, ...templateSteps] };
      plan.planDigest = mutationPlanDigest(plan);
      requireCliMutation("setup_apply", options.approvalToken, {
        machineId: resolvedMachineId,
        resourceId: cliPlanResourceId("setup_apply", resolvedMachineId, plan),
        args: cliPlanApprovalArgs({ machine_id: resolvedMachineId, yes: options.yes }, plan),
      });
      const result = runSetupPlan(plan, { apply: true, yes: options.yes });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const basePlan = buildSetupPlan(options.machine);
    const result = { ...basePlan, steps: [...basePlan.steps, ...templateSteps] };
    result.planDigest = mutationPlanDigest(result);
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("sync")
  .description("Reconcile a machine against the fleet manifest")
  .option("--machine <id>", "Machine identifier")
  .option("--apply", "Execute reconciliation commands instead of previewing the plan", false)
  .option("--yes", "Confirm execution when using --apply", false)
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; apply?: boolean; yes?: boolean; approvalToken?: string; json?: boolean }) => {
    if (options.apply) {
      const resolvedMachineId = cliMachineId(options.machine);
      const plan = buildSyncPlan(options.machine);
      requireCliMutation("sync_apply", options.approvalToken, {
        machineId: resolvedMachineId,
        resourceId: cliPlanResourceId("sync_apply", resolvedMachineId, plan),
        args: cliPlanApprovalArgs({ machine_id: resolvedMachineId, yes: options.yes }, plan),
      });
      const result = runSyncPlan(plan, { apply: true, yes: options.yes });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const result = buildSyncPlan(options.machine);
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("reconcile")
  .description("Reconcile bun-global packages against the fleet manifest desired state")
  .option("--machine <id>", "Machine identifier")
  .option("--dry-run", "Preview the reconcile plan without executing (default)")
  .option("--apply", "Execute install/update/rollback commands", false)
  .option("--package <name>", "Limit reconcile to one package")
  .option("--installed-json <path>", "Read installed packages from a JSON snapshot instead of bun pm ls -g")
  .option("--event-json <path>", "Trigger from a release.published event envelope JSON file (use - for stdin)")
  .option("--no-emit", "Do not emit rollout events")
  .option("--deliver", "Deliver emitted rollout events to configured channels", false)
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action(async (options: {
    machine?: string;
    dryRun?: boolean;
    apply?: boolean;
    package?: string;
    installedJson?: string;
    eventJson?: string;
    emit?: boolean;
    deliver?: boolean;
    approvalToken?: string;
    json?: boolean;
  }, command: Command) => {
    if (options.dryRun && options.apply) {
      console.error("error: --dry-run and --apply are mutually exclusive");
      process.exitCode = 1;
      return;
    }

    let packageFilter = options.package;
    let eventVersions: Record<string, string> | undefined;
    if (options.eventJson) {
      const raw = options.eventJson === "-" ? readFileSync(0, "utf8") : readFileSync(options.eventJson, "utf8");
      const envelope = JSON.parse(raw) as ReleaseEventEnvelope;
      const trigger = releaseEventTrigger(envelope);
      if (!trigger) {
        console.error(`error: --event-json requires a release.published event with data.package and data.version (got type "${envelope.type}")`);
        process.exitCode = 1;
        return;
      }
      packageFilter = packageFilter ?? trigger.packageFilter;
      eventVersions = trigger.eventVersions;
    }

    let installed: InstalledPackage[] | undefined;
    if (options.installedJson) {
      installed = readInstalledSnapshot(options.installedJson);
    }

    const machineId = cliMachineId(options.machine ?? process.env["HASNA_MACHINES_MACHINE_ID"]);
    const plan = buildReconcilePlan({
      machineId,
      packageFilter,
      eventVersions,
      installed,
    });

    if (options.apply) {
      requireCliMutation("reconcile_apply", options.approvalToken, {
        machineId,
        resourceId: cliPlanResourceId("reconcile_apply", machineId, plan),
        args: cliPlanApprovalArgs({ machine_id: machineId, package: packageFilter ?? null }, plan),
      });
      const result = await executeReconcilePlan(plan, {
        dryRun: false,
        emitter: options.emit === false ? null : createEventsClient(),
        deliver: options.deliver === true,
      });
      printCommandResult(result, renderReconcileResult(result), wantsCommandJson(options, command));
      if (result.results.some((entry) => entry.status === "failed" || entry.status === "blocked")) process.exitCode = 1;
      return;
    }

    const result = await executeReconcilePlan(plan, { dryRun: true });
    printCommandResult(result, renderReconcileResult(result), wantsCommandJson(options, command));
  });

const freezeCommand = program.command("freeze").description("Supply-chain freeze gate blocking reconcile installs of frozen packages");

freezeCommand
  .command("list")
  .description("List active freeze entries (freeze.json plus manifest freeze list)")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { json?: boolean }, command: Command) => {
    const entries = listActiveFreezes();
    printCommandResult({ packages: entries }, entries.length
      ? entries.map((entry) => `${entry.name}\t${entry.reason ?? "no reason"}${entry.until ? `\tuntil ${entry.until}` : ""}`).join("\n")
      : "No frozen packages.", wantsCommandJson(options, command));
  });

freezeCommand
  .command("add")
  .description("Freeze a package: reconcile will block installs/updates until it is removed")
  .argument("<name>", "Package name")
  .option("--reason <reason>", "Why the package is frozen (incident reference)")
  .option("--until <iso>", "Freeze expiry timestamp")
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((name: string, options: { reason?: string; until?: string; approvalToken?: string; json?: boolean }, command: Command) => {
    requireCliMutation("freeze_add", options.approvalToken, {
      resourceId: `freeze:${name}`,
      args: { package: name, reason: options.reason ?? null, until: options.until ?? null },
    });
    const file = addFreeze({ name, reason: options.reason, until: options.until });
    printCommandResult(file, `Froze ${name} (${file.packages.length} frozen package(s))`, wantsCommandJson(options, command));
  });

freezeCommand
  .command("remove")
  .description("Remove a package from the freeze list")
  .argument("<name>", "Package name")
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((name: string, options: { approvalToken?: string; json?: boolean }, command: Command) => {
    requireCliMutation("freeze_remove", options.approvalToken, {
      resourceId: `freeze:${name}`,
      args: { package: name },
    });
    const result = removeFreeze(name);
    printCommandResult(result, result.removed ? `Unfroze ${name}` : `${name} was not frozen`, wantsCommandJson(options, command));
    if (!result.removed) process.exitCode = 1;
  });

freezeCommand
  .command("check")
  .description("Check whether a package is currently frozen (exit 1 when frozen)")
  .argument("<name>", "Package name")
  .option("-j, --json", "Print JSON output", false)
  .action((name: string, options: { json?: boolean }, command: Command) => {
    const entry = findFreeze(name, listActiveFreezes());
    printCommandResult({ package: name, frozen: Boolean(entry), entry }, entry
      ? `${name} is FROZEN: ${entry.reason ?? "no reason"}`
      : `${name} is not frozen`, wantsCommandJson(options, command));
    if (entry) process.exitCode = 1;
  });

program
  .command("topology")
  .description("Discover local, manifest, heartbeat, SSH, and Tailscale machine topology")
  .option("--no-tailscale", "Skip tailscale status probing")
  .option("--limit <n>", `Maximum machines to return (default ${DEFAULT_MACHINE_LIST_LIMIT})`)
  .option("--offset <n>", "Machine list offset for View more pagination")
  .option("--all", "Return every discovered machine", false)
  .option("--private-metadata", "Print private host/network route fields", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { tailscale?: boolean; limit?: string; offset?: string; all?: boolean; privateMetadata?: boolean; json?: boolean }) => {
    const rawTopology = discoverMachineTopology({
      includeTailscale: options.tailscale !== false,
      limit: options.all ? null : options.limit ? parseIntegerOption(options.limit, "limit", { min: 1 }) : undefined,
      offset: options.offset ? parseIntegerOption(options.offset, "offset", { min: 0 }) : undefined,
    });
    const topology = redactTopologyForOutput(rawTopology, { privateMetadata: options.privateMetadata });
    if (options.json) {
      console.log(JSON.stringify(topology, null, 2));
      return;
    }
    console.log(renderKeyValueTable([
      ["local machine", topology.local_machine_id],
      ["hostname", topology.local_hostname],
      ["platform", String(topology.current_platform)],
      ["machines", `${topology.pagination.count}/${topology.pagination.total}`],
      ["limit", String(topology.pagination.limit ?? "all")],
      ["offset", String(topology.pagination.offset)],
      ["has more", String(topology.pagination.hasMore)],
      ["warnings", topology.warnings.join(", ") || "none"],
    ]));
    for (const machine of topology.machines) {
      const route = machine.ssh.command_target ? `${machine.ssh.route}:${machine.ssh.command_target}` : machine.ssh.route;
      console.log(`${machine.display_name.padEnd(18)} ${machine.machine_id.padEnd(18)} ${String(machine.platform || "unknown").padEnd(8)} ${machine.heartbeat_status.padEnd(8)} ${machine.updated_at ?? "unknown"} ${route}`);
    }
  });

program
  .command("details")
  .description("Show consumer-safe machine details for right-click View details")
  .option("--machine <id>", "Machine identifier; defaults to local")
  .option("--tailscale", "Probe tailscale while resolving details", false)
  .option("-j, --json", "Print JSON output", false)
  .action(async (options: { machine?: string; tailscale?: boolean; json?: boolean }) => {
    const result = await resolveMachineDetails(options.machine ?? "local", {
      includeTailscale: options.tailscale,
    });
    printJsonOrText(result, renderMachineDetails(result), options.json);
  });

browserPlanCommand
  .command("fleet", { isDefault: true })
  .description("List BrowserPlan target machines and safe remote operation hooks")
  .option("--machine <id...>", "Limit to BrowserPlan machine ids; comma-separated values are accepted")
  .option("--tailscale", "Probe tailscale while resolving BrowserPlan fleet reachability", false)
  .option("--check-installs", "Run remote compatibility probes for browserplan/chrome/bun/git state", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string[]; tailscale?: boolean; checkInstalls?: boolean; json?: boolean }) => {
    const result = getBrowserPlanFleet({
      machineIds: parseMachineIdList(options.machine),
      includeTailscale: options.tailscale,
      includeInstallState: options.checkInstalls,
    });
    printJsonOrText(result, renderBrowserPlanFleet(result), options.json);
    if (result.coverage.missing.length > 0 || result.coverage.unreachable.length > 0) process.exitCode = options.json ? 0 : 1;
  });

function parseMachineIdList(values: string[] | undefined): string[] {
  return (values ?? [])
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function parsePathList(values: string[] | undefined): string[] | undefined {
  const paths = (values ?? [])
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return paths.length > 0 ? paths : undefined;
}

interface AgentApiCliOptions {
  machine?: string[];
  tailscale?: boolean;
  limit?: string;
  offset?: string;
  all?: boolean;
  privateMetadata?: boolean;
  project?: string;
  repo?: string;
  openFilesRepo?: string;
  primaryMachine?: string;
  checkCompatibility?: boolean;
  requireCommand?: string[];
  requirePackage?: string[];
  workspace?: string[];
  cmd?: string;
  commandLabel?: string;
  expectMachine?: string[];
  expectTmux?: string[];
  maxEvidenceItems?: string;
  maxTaskSuggestions?: string;
  json?: boolean;
  text?: boolean;
}

function agentLimit(options: AgentApiCliOptions): number | null | undefined {
  if (options.all) return null;
  return options.limit ? parseIntegerOption(options.limit, "limit", { min: 1 }) : undefined;
}

function agentOffset(options: AgentApiCliOptions): number | undefined {
  return options.offset ? parseIntegerOption(options.offset, "offset", { min: 0 }) : undefined;
}

function agentCompatibilityEnabled(options: AgentApiCliOptions): boolean {
  return Boolean(options.checkCompatibility || options.requireCommand?.length || options.requirePackage?.length || options.workspace?.length);
}

function printJsonDefault(data: unknown, text: string, options: { text?: boolean }): void {
  if (options.text && !program.opts().quiet) {
    console.log(text);
    return;
  }
  console.log(JSON.stringify(data));
}

function baseAgentOptions(options: AgentApiCliOptions) {
  return {
    machineIds: parseMachineIdList(options.machine),
    includeTailscale: options.tailscale !== false,
    limit: agentLimit(options),
    offset: agentOffset(options),
    privateMetadata: options.privateMetadata,
  };
}

function healthAgentOptions(options: AgentApiCliOptions) {
  return {
    ...baseAgentOptions(options),
    projectId: options.project,
    repoName: options.repo,
    openFilesRepoName: options.openFilesRepo,
    primaryMachineId: options.primaryMachine,
    checkCompatibility: agentCompatibilityEnabled(options),
    commands: options.requireCommand?.map(parseCommandSpec),
    packages: options.requirePackage?.map(parsePackageSpec),
    workspaces: options.workspace?.map(parseWorkspaceSpec),
  };
}

notesCommand
  .command("context")
  .description("Resolve note origin/source/target machine display names and actor provenance")
  .option("--origin-machine <id>", "Machine that owns/originated the note")
  .option("--source-machine <id>", "Machine where the note event or sync source came from")
  .option("--target-machine <id>", "Machine the note is being synced to")
  .option("--sync-target <id...>", "Additional sync target machine ids; comma-separated values are accepted")
  .option("--actor-type <type>", "human | agent | system | unknown")
  .option("--actor-id <id>", "Actor identifier")
  .option("--actor-name <name>", "Actor display name")
  .option("--agent-id <id>", "Agent identifier for agent-created notes")
  .option("--agent-name <name>", "Agent display name for agent-created notes")
  .option("--source <source>", "notes | agent | sync | import | machines | unknown")
  .option("--tailscale", "Probe tailscale while building machine display context", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: {
    originMachine?: string;
    sourceMachine?: string;
    targetMachine?: string;
    syncTarget?: string[];
    actorType?: string;
    actorId?: string;
    actorName?: string;
    agentId?: string;
    agentName?: string;
    source?: string;
    tailscale?: boolean;
    json?: boolean;
  }) => {
    const result = resolveNoteMachineContext({
      originMachineId: options.originMachine,
      sourceMachineId: options.sourceMachine,
      targetMachineId: options.targetMachine,
      syncTargetMachineIds: parseMachineIdList(options.syncTarget),
      includeTailscale: options.tailscale,
      actor: {
        actor_type: options.actorType as NoteActorType | undefined,
        actor_id: options.actorId,
        actor_name: options.actorName,
        agent_id: options.agentId,
        agent_name: options.agentName,
        source: options.source as NoteMachineContextSourceInput | undefined,
      },
    });
    printJsonOrText(result, renderNoteMachineContext(result), options.json);
  });

notesCommand
  .command("trash-policies")
  .description("List per-machine note trash retention metadata")
  .option("--machine <id>", "Filter by machine id")
  .option("--limit <n>", `Maximum machines to return (default ${DEFAULT_MACHINE_LIST_LIMIT})`)
  .option("--offset <n>", "Machine list offset for View more pagination")
  .option("--all", "Return every discovered machine", false)
  .option("--tailscale", "Probe tailscale while listing machine trash policies", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; limit?: string; offset?: string; all?: boolean; tailscale?: boolean; json?: boolean }) => {
    const result = listMachineTrashPolicies({
      machineId: options.machine,
      includeTailscale: options.tailscale,
      limit: options.all ? null : options.limit ? parseIntegerOption(options.limit, "limit", { min: 1 }) : undefined,
      offset: options.offset ? parseIntegerOption(options.offset, "offset", { min: 0 }) : undefined,
    });
    printJsonOrText(result, renderMachineTrashPolicies(result), options.json);
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

program
  .command("machine-health")
  .description("Return compact local/remote loop-readiness health for machines")
  .option("--machine <id...>", "Limit to machine ids; comma-separated values are accepted")
  .option("--no-tailscale", "Skip tailscale status probing")
  .option("--limit <n>", `Maximum machines to return (default ${DEFAULT_MACHINE_LIST_LIMIT})`)
  .option("--offset <n>", "Machine list offset for pagination")
  .option("--all", "Return every selected/discovered machine", false)
  .option("--project <id>", "Project/workspace id for workspace readiness")
  .option("--repo <name>", "Repository name; defaults to project id")
  .option("--open-files-repo <name>", "Open-files repository name", "open-files")
  .option("--primary-machine <id>", "Primary machine id for this project")
  .option("--check-compatibility", "Run bounded compatibility checks", false)
  .option("--require-command <command...>", "Required command or command:expectedVersion")
  .option("--require-package <spec...>", "Required package as name[:command[:expectedVersion]]")
  .option("--workspace <spec...>", "Required workspace as label=/path[:expectedPackageName[:expectedVersion]] or /path[:expectedPackageName[:expectedVersion]]")
  .option("-j, --json", "Print JSON output (default)", false)
  .option("--text", "Print compact text summary instead of JSON", false)
  .action((options: AgentApiCliOptions) => {
    const result = getFleetMachineHealth(healthAgentOptions(options));
    printJsonDefault(result, renderMachineHealthResult(result), options);
  });

program
  .command("routing")
  .description("Return compact route readiness for local and remote machines")
  .option("--machine <id...>", "Limit to machine ids; comma-separated values are accepted")
  .option("--no-tailscale", "Skip tailscale status probing")
  .option("--limit <n>", `Maximum machines to return (default ${DEFAULT_MACHINE_LIST_LIMIT})`)
  .option("--offset <n>", "Machine list offset for pagination")
  .option("--all", "Return every selected/discovered machine", false)
  .option("--private-metadata", "Print private route targets", false)
  .option("-j, --json", "Print JSON output (default)", false)
  .option("--text", "Print compact text summary instead of JSON", false)
  .action((options: AgentApiCliOptions) => {
    const result = getFleetRouting(baseAgentOptions(options));
    printJsonDefault(result, renderFleetRoutingResult(result), options);
  });

program
  .command("command-matrix")
  .description("Return command plans gated by a bounded read-only execution-authentication probe")
  .option("--machine <id...>", "Limit to machine ids; comma-separated values are accepted")
  .option("--cmd <command>", "Loop command to plan; omitted keeps <loop-command> placeholder")
  .option("--command-label <label>", "Short label for the planned command")
  .option("--no-tailscale", "Skip tailscale status probing")
  .option("--limit <n>", `Maximum machines to return (default ${DEFAULT_MACHINE_LIST_LIMIT})`)
  .option("--offset <n>", "Machine list offset for pagination")
  .option("--all", "Return every selected/discovered machine", false)
  .option("--private-metadata", "Print private resolved shell commands", false)
  .option("-j, --json", "Print JSON output (default)", false)
  .option("--text", "Print compact text summary instead of JSON", false)
  .action((options: AgentApiCliOptions) => {
    const result = getCommandMatrix({
      ...baseAgentOptions(options),
      command: options.cmd,
      commandLabel: options.commandLabel,
    });
    printJsonDefault(result, renderCommandMatrixResult(result), options);
  });

program
  .command("loop-preflight")
  .description("Return compact fleet loop readiness, route choices, and next steps")
  .option("--machine <id...>", "Limit to machine ids; comma-separated values are accepted")
  .option("--cmd <command>", "Loop command to plan; omitted keeps <loop-command> placeholder")
  .option("--command-label <label>", "Short label for the planned command")
  .option("--no-tailscale", "Skip tailscale status probing")
  .option("--limit <n>", `Maximum machines to return (default ${DEFAULT_MACHINE_LIST_LIMIT})`)
  .option("--offset <n>", "Machine list offset for pagination")
  .option("--all", "Return every selected/discovered machine", false)
  .option("--project <id>", "Project/workspace id for workspace readiness")
  .option("--repo <name>", "Repository name; defaults to project id")
  .option("--open-files-repo <name>", "Open-files repository name", "open-files")
  .option("--primary-machine <id>", "Primary machine id for this project")
  .option("--check-compatibility", "Run bounded compatibility checks", false)
  .option("--require-command <command...>", "Required command or command:expectedVersion")
  .option("--require-package <spec...>", "Required package as name[:command[:expectedVersion]]")
  .option("--workspace <spec...>", "Required workspace as label=/path[:expectedPackageName[:expectedVersion]] or /path[:expectedPackageName[:expectedVersion]]")
  .option("--private-metadata", "Print private resolved shell commands in nested command refs", false)
  .option("-j, --json", "Print JSON output (default)", false)
  .option("--text", "Print compact text summary instead of JSON", false)
  .action((options: AgentApiCliOptions) => {
    const result = getFleetLoopPreflight({
      ...healthAgentOptions(options),
      command: options.cmd,
      commandLabel: options.commandLabel,
    });
    printJsonDefault(result, renderLoopPreflightResult(result), options);
  });

const opsCommand = program.command("ops").description("Fleet operations diagnostics");

program
  .command("dispatch-smoke")
  .description("Run a bounded dry-run @hasna/dispatch fleet package, route, and daemon-readiness smoke")
  .option("--machine <id...>", "Limit to machine ids; comma-separated values are accepted")
  .option("--ssh-machine <id...>", "Force direct SSH alias probing for selected machine ids")
  .option("--include-apple01", "Include optional apple01 instead of ignoring it by default", false)
  .option("--package <name>", "Package name to report", DEFAULT_DISPATCH_PACKAGE_NAME)
  .option("--command <command>", "Package CLI command to probe", DEFAULT_DISPATCH_COMMAND)
  .option("--expected-version <version>", "Expected package version")
  .option("--timeout-ms <ms>", `Per-machine command timeout (default ${DEFAULT_DISPATCH_SMOKE_TIMEOUT_MS})`)
  .option("--max-output-chars <n>", `Maximum redacted stdout/stderr chars per command (default ${DEFAULT_DISPATCH_SMOKE_MAX_OUTPUT_CHARS})`)
  .option("--no-tailscale", "Skip tailscale status probing")
  .option("--private-metadata", "Print private route targets where allowed by the API caller", false)
  .option("-j, --json", "Print JSON output (default)", false)
  .option("--text", "Print compact text summary instead of JSON", false)
  .action((options: AgentApiCliOptions & {
    sshMachine?: string[];
    includeApple01?: boolean;
    package?: string;
    command?: string;
    expectedVersion?: string;
    timeoutMs?: string;
    maxOutputChars?: string;
  }) => {
    const result = getDispatchFleetSmoke({
      machineIds: parseMachineIdList(options.machine),
      sshMachineIds: parseMachineIdList(options.sshMachine),
      includeApple01: options.includeApple01,
      packageName: options.package,
      command: options.command,
      expectedVersion: options.expectedVersion,
      includeTailscale: options.tailscale !== false,
      timeoutMs: options.timeoutMs ? parseIntegerOption(options.timeoutMs, "timeout-ms", { min: 1 }) : undefined,
      maxOutputChars: options.maxOutputChars ? parseIntegerOption(options.maxOutputChars, "max-output-chars", { min: 1 }) : undefined,
      privateMetadata: options.privateMetadata,
    });
    printJsonDefault(result, renderDispatchFleetSmoke(result), options);
  });

opsCommand
  .command("check")
  .description("Run a read-only fleet ops check with task and event suggestions")
  .option("--machine <id...>", "Limit to machine ids; comma-separated values are accepted")
  .option("--expect-machine <id...>", "Expected machine id; comma-separated values are accepted")
  .option("--expect-tmux <machine=target...>", "Expected local tmux pane target, optionally machine=target")
  .option("--cmd <command>", "Loop command to plan; omitted keeps <loop-command> placeholder")
  .option("--command-label <label>", "Short label for the planned command")
  .option("--no-tailscale", "Skip tailscale status probing")
  .option("--limit <n>", `Maximum machines to return (default ${DEFAULT_MACHINE_LIST_LIMIT})`)
  .option("--offset <n>", "Machine list offset for pagination")
  .option("--all", "Return every selected/discovered machine", false)
  .option("--max-evidence-items <n>", "Maximum evidence entries per issue")
  .option("--max-task-suggestions <n>", "Maximum task suggestions emitted")
  .option("--upsert-tasks", "Create deduped todos tasks for emitted task suggestions", false)
  .option("--todos-project <path>", "Todos project path used with --upsert-tasks")
  .option("--task-list <id>", "Todos task list id used with --upsert-tasks")
  .option("--todos-bin <path>", "Todos executable used with --upsert-tasks", "todos")
  .option("--max-task-actions <n>", "Maximum task upsert actions")
  .option("-j, --json", "Print JSON output", false)
  .option("--text", "Print compact text summary instead of JSON", false)
  .action((options: AgentApiCliOptions & {
    upsertTasks?: boolean;
    todosProject?: string;
    taskList?: string;
    todosBin?: string;
    maxTaskActions?: string;
  }) => {
    const result = getFleetOpsCheck({
      ...baseAgentOptions(options),
      command: options.cmd,
      commandLabel: options.commandLabel,
      expectedMachines: parseMachineIdList(options.expectMachine),
      expectedTmux: (options.expectTmux ?? []).map(parseFleetOpsTmuxExpectation),
      maxEvidenceItems: options.maxEvidenceItems ? parseIntegerOption(options.maxEvidenceItems, "max-evidence-items", { min: 1 }) : undefined,
      maxTaskSuggestions: options.maxTaskSuggestions ? parseIntegerOption(options.maxTaskSuggestions, "max-task-suggestions", { min: 1 }) : undefined,
    });
    if (options.upsertTasks) {
      upsertFleetOpsCheckTasks(result, {
        project: options.todosProject,
        taskList: options.taskList,
        todosBin: options.todosBin,
        maxActions: options.maxTaskActions ? parseIntegerOption(options.maxTaskActions, "max-task-actions", { min: 1 }) : undefined,
      });
    }
    if (options.json || !options.text) {
      console.log(JSON.stringify(result));
      return;
    }
    console.log(renderFleetOpsCheck(result));
  });

opsCommand
  .command("db-integrity")
  .description("Check critical local SQLite databases with bounded read-only quick_check probes")
  .option("--root <path...>", "Root directory to scan; comma-separated values are accepted")
  .option("--max-dbs <n>", "Maximum database files to check")
  .option("--max-size-bytes <n>", "Skip database files larger than this many bytes")
  .option("--max-depth <n>", "Maximum directory depth to scan")
  .option("--quick-check-timeout-ms <n>", "Timeout per sqlite quick_check")
  .option("--max-total-ms <n>", "Overall wall-clock budget for all quick_check probes; databases still pending when it is exhausted are reported as skipped_budget")
  .option("--sqlite-bin <path>", "sqlite3 executable to use for bounded quick_check probes", "sqlite3")
  .option("--report-dir <path>", "Write private JSON evidence to this directory")
  .option("--upsert-tasks", "Create deduped todos tasks for failed integrity checks", false)
  .option("--todos-project <path>", "Todos project path used with --upsert-tasks")
  .option("--task-list <id>", "Todos task list id used with --upsert-tasks")
  .option("--todos-bin <path>", "Todos executable used with --upsert-tasks", "todos")
  .option("--max-task-actions <n>", "Maximum new todos tasks to create")
  .option("-j, --json", "Print JSON output", false)
  .option("--text", "Print compact text summary instead of JSON", false)
  .action((options: {
    root?: string[];
    maxDbs?: string;
    maxSizeBytes?: string;
    maxDepth?: string;
    quickCheckTimeoutMs?: string;
    maxTotalMs?: string;
    sqliteBin?: string;
    reportDir?: string;
    upsertTasks?: boolean;
    todosProject?: string;
    taskList?: string;
    todosBin?: string;
    maxTaskActions?: string;
    json?: boolean;
    text?: boolean;
  }) => {
    const result = getCriticalDbIntegrityReport({
      roots: parsePathList(options.root),
      maxDbs: options.maxDbs ? parseIntegerOption(options.maxDbs, "max-dbs", { min: 1 }) : undefined,
      maxSizeBytes: options.maxSizeBytes ? parseIntegerOption(options.maxSizeBytes, "max-size-bytes", { min: 1 }) : undefined,
      maxDepth: options.maxDepth ? parseIntegerOption(options.maxDepth, "max-depth", { min: 1 }) : undefined,
      quickCheckTimeoutMs: options.quickCheckTimeoutMs ? parseIntegerOption(options.quickCheckTimeoutMs, "quick-check-timeout-ms", { min: 1 }) : undefined,
      maxTotalMs: options.maxTotalMs ? parseIntegerOption(options.maxTotalMs, "max-total-ms", { min: 1 }) : undefined,
      sqliteBin: options.sqliteBin,
      reportDir: options.reportDir,
    });
    if (options.upsertTasks) {
      upsertMachineDataTasks(result, {
        project: options.todosProject,
        taskList: options.taskList,
        todosBin: options.todosBin,
        maxActions: options.maxTaskActions ? parseIntegerOption(options.maxTaskActions, "max-task-actions", { min: 1 }) : undefined,
      });
    }
    printJsonDefault(result, renderDbIntegrityReport(result), options);
    if (!result.ok) process.exitCode = 1;
  });

opsCommand
  .command("state-snapshot")
  .description("Plan or create bounded private snapshots of local ops-state SQLite databases")
  .option("--root <path...>", "Root directory to scan; comma-separated values are accepted")
  .option("--snapshot-root <path>", "Private directory where snapshots are stored")
  .option("--report-dir <path>", "Write private JSON evidence to this directory")
  .option("--max-dbs <n>", "Maximum database files to snapshot")
  .option("--max-size-bytes <n>", "Skip database files larger than this many bytes")
  .option("--max-depth <n>", "Maximum directory depth to scan")
  .option("--keep-days <n>", "Delete snapshot directories older than this many days when --apply is used")
  .option("--sqlite-bin <path>", "sqlite3 executable to use for verified .backup snapshots", "sqlite3")
  .option("--apply", "Actually create snapshots and apply retention; default is dry-run", false)
  .option("--upsert-tasks", "Create deduped todos tasks for snapshot failures", false)
  .option("--todos-project <path>", "Todos project path used with --upsert-tasks")
  .option("--task-list <id>", "Todos task list id used with --upsert-tasks")
  .option("--todos-bin <path>", "Todos executable used with --upsert-tasks", "todos")
  .option("--max-task-actions <n>", "Maximum new todos tasks to create")
  .option("-j, --json", "Print JSON output", false)
  .option("--text", "Print compact text summary instead of JSON", false)
  .action((options: {
    root?: string[];
    snapshotRoot?: string;
    reportDir?: string;
    maxDbs?: string;
    maxSizeBytes?: string;
    maxDepth?: string;
    keepDays?: string;
    sqliteBin?: string;
    apply?: boolean;
    upsertTasks?: boolean;
    todosProject?: string;
    taskList?: string;
    todosBin?: string;
    maxTaskActions?: string;
    json?: boolean;
    text?: boolean;
  }) => {
    const result = getOpsStateSnapshotReport({
      roots: parsePathList(options.root),
      snapshotRoot: options.snapshotRoot,
      reportDir: options.reportDir,
      maxDbs: options.maxDbs ? parseIntegerOption(options.maxDbs, "max-dbs", { min: 1 }) : undefined,
      maxSizeBytes: options.maxSizeBytes ? parseIntegerOption(options.maxSizeBytes, "max-size-bytes", { min: 1 }) : undefined,
      maxDepth: options.maxDepth ? parseIntegerOption(options.maxDepth, "max-depth", { min: 1 }) : undefined,
      keepDays: options.keepDays ? parseIntegerOption(options.keepDays, "keep-days", { min: 1 }) : undefined,
      sqliteBin: options.sqliteBin,
      apply: options.apply,
    });
    if (options.upsertTasks) {
      upsertMachineDataTasks(result, {
        project: options.todosProject,
        taskList: options.taskList,
        todosBin: options.todosBin,
        maxActions: options.maxTaskActions ? parseIntegerOption(options.maxTaskActions, "max-task-actions", { min: 1 }) : undefined,
      });
    }
    printJsonDefault(result, renderOpsStateSnapshotReport(result), options);
    if (!result.ok) process.exitCode = 1;
  });

const projectsAssignmentsCommand = projectsCommand
  .command("assignments")
  .description("List or update manifest-backed @hasna/projects machine assignments");

projectsAssignmentsCommand
  .command("list", { isDefault: true })
  .description("List machine-to-project location assignments")
  .option("--machine <id>", "Filter by machine id")
  .option("--project <id>", "Filter by project/workspace id")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; project?: string; json?: boolean }) => {
    const result = listMachineProjectAssignments({
      machineId: options.machine,
      projectId: options.project,
    });
    printJsonOrText(result, renderProjectAssignments(result), options.json);
  });

projectsAssignmentsCommand
  .command("assign")
  .description("Write a machine/project location assignment into the machines manifest")
  .requiredOption("--machine <id>", "Machine identifier")
  .requiredOption("--project <id>", "Project or workspace identifier")
  .requiredOption("--path <path>", "Absolute project path on the machine")
  .option("--workspace-id <id>", "projects workspace id")
  .option("--repo <name>", "Repository name; defaults to project id")
  .option("--workspace-root <path>", "Machine workspace root")
  .option("--open-files-root <path>", "open-files root on the machine")
  .option("--label <label>", "Location label", "main")
  .option("--kind <kind>", "Location kind", "machine-local")
  .option("--primary", "Mark this machine as primary for the project")
  .option("--metadata <json>", "Assignment metadata JSON object")
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((options: {
    machine: string;
    project: string;
    path: string;
    workspaceId?: string;
    repo?: string;
    workspaceRoot?: string;
    openFilesRoot?: string;
    label?: string;
    kind?: string;
    primary?: boolean;
    metadata?: string;
    approvalToken?: string;
    json?: boolean;
  }) => {
    const input: AssignMachineProjectInput = {
      machineId: options.machine,
      projectId: options.project,
      path: options.path,
      workspaceId: options.workspaceId ?? null,
      repoName: options.repo ?? null,
      workspaceRoot: options.workspaceRoot ?? null,
      openFilesRoot: options.openFilesRoot ?? null,
      label: options.label,
      kind: options.kind,
      primary: options.primary === true ? true : undefined,
      metadata: options.metadata === undefined ? undefined : parseJsonObjectOption(options.metadata, {}),
    };
    requireCliMutation("machines_projects_assign", options.approvalToken, {
      machineId: input.machineId,
      resourceId: projectAssignmentResourceId(input.machineId, input.projectId),
      args: projectAssignmentMutationArgs(input),
    });
    const result = assignMachineProject(input);
    printJsonOrText(result, renderProjectAssignments(result), options.json);
  });

projectsAssignmentsCommand
  .command("remove")
  .description("Remove a machine/project assignment from the machines manifest")
  .requiredOption("--machine <id>", "Machine identifier")
  .requiredOption("--project <id>", "Project or workspace identifier")
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine: string; project: string; approvalToken?: string; json?: boolean }) => {
    const input = { machineId: options.machine, projectId: options.project };
    requireCliMutation("machines_projects_unassign", options.approvalToken, {
      machineId: input.machineId,
      resourceId: projectAssignmentResourceId(input.machineId, input.projectId),
      args: removeProjectAssignmentMutationArgs(input),
    });
    const result = removeMachineProjectAssignment(input);
    printJsonOrText(result, renderProjectAssignments(result), options.json);
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
  .option("--approval-token <token>", "Scoped mutation approval token")
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
    approvalToken?: string;
    json?: boolean;
  }) => {
    if (options.apply) requireCliMutation("workspace_repair", options.approvalToken, { machineId: options.machine, args: {
      machine: options.machine,
      project: options.project,
      repo: options.repo,
      openFilesRepo: options.openFilesRepo,
      workspaceRoot: options.workspaceRoot,
      projectRoot: options.projectRoot,
      openFilesRoot: options.openFilesRoot,
      allowUntrusted: options.allowUntrusted,
      tailscale: options.tailscale,
    } });
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
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action(jsonAwareAction((options: { bucket?: string; prefix?: string; apply?: boolean; yes?: boolean; approvalToken?: string; json?: boolean }) => {
    if (options.apply) {
      const target = resolveBackupTarget({ bucket: options.bucket, prefix: options.prefix });
      requireCliMutation("backup_apply", options.approvalToken, { resourceId: cliResourceId("backup", target.bucket, target.prefix), args: { bucket: target.bucket, prefix: target.prefix, yes: options.yes } });
    }
    const result = options.apply
      ? runBackup(options.bucket, options.prefix, { apply: true, yes: options.yes })
      : buildBackupPlan(options.bucket, options.prefix);
    console.log(JSON.stringify(result, null, 2));
  }, (options) => Boolean(options.json)));

const certCommand = program.command("cert").description("Manage mkcert-based local SSL certificates");

certCommand
  .command("issue")
  .description("Plan or issue certificates for one or more domains")
  .argument("<domains...>", "Domains to include in the certificate")
  .option("--apply", "Execute certificate commands instead of previewing them", false)
  .option("--yes", "Confirm execution when using --apply", false)
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((domains: string[], options: { apply?: boolean; yes?: boolean; approvalToken?: string; json?: boolean }) => {
    if (options.apply) requireCliMutation("cert_apply", options.approvalToken, { resourceId: cliResourceId("cert", domains.join(",")), args: { domains, yes: options.yes } });
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
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { domain: string; port: string; targetHost: string; approvalToken?: string; json?: boolean }) => {
    const port = parseIntegerOption(options.port, "port", { min: 1, max: 65535 });
    requireCliMutation("dns_add", options.approvalToken, { resourceId: cliResourceId("dns", options.domain), args: { domain: options.domain, port, target_host: options.targetHost } });
    const result = addDomainMapping(options.domain, port, options.targetHost);
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

const hostsCommand = program
  .command("hosts")
  .description("Sync fleet machine names into /etc/hosts so machine<NN>:port resolves on the LAN and tailnet");

function printHostsResult(plan: ReturnType<typeof planFleetHosts>, applied: boolean, viaSudo = false): void {
  console.log(`hosts file: ${plan.hostsPath}`);
  console.log(`local subnets: ${plan.localSubnets.join(", ") || "none"}`);
  for (const entry of plan.entries) {
    console.log(`  ${entry.ip}\t${entry.names.join(" ")}\t(${entry.source})`);
  }
  if (plan.unresolved.length > 0) {
    console.log(`unresolved: ${plan.unresolved.join(", ")}`);
  }
  if (plan.warnings.length > 0) {
    console.log(`warnings: ${plan.warnings.join(", ")}`);
  }
  console.log(applied ? `applied ${plan.entries.length} entries${viaSudo ? " (via sudo)" : ""}` : "dry run — re-run `machines hosts apply` to write");
}

hostsCommand
  .command("plan", { isDefault: true })
  .description("Preview the managed /etc/hosts block for the fleet (dry run)")
  .option("-j, --json", "Print JSON output", false)
  .option("--no-warm", "Skip establishing direct Tailscale paths to discover LAN endpoints")
  .action((options: { json?: boolean; warm?: boolean }) => {
    const plan = planFleetHosts({ warm: options.warm });
    if (options.json) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    printHostsResult(plan, false);
  });

hostsCommand
  .command("apply")
  .description("Write the managed fleet block into /etc/hosts (uses sudo when required)")
  .option("-j, --json", "Print JSON output", false)
  .option("--no-warm", "Skip establishing direct Tailscale paths to discover LAN endpoints")
  .action((options: { json?: boolean; warm?: boolean }) => {
    const result = applyFleetHosts({ warm: options.warm });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printHostsResult(result, true, result.viaSudo);
  });

notificationsCommand
  .command("add")
  .description("Add or replace a notification channel")
  .requiredOption("--id <id>", "Channel identifier")
  .requiredOption("--type <type>", "email | webhook | command")
  .requiredOption("--target <target>", "Email, webhook URL, or command executable")
  .option("--arg <arg...>", "Command argument for command transports", collectOptionValues, [])
  .option("--event <event...>", "Events routed to this channel", ["setup_failed", "sync_failed"])
  .option("--disabled", "Create the channel in disabled state", false)
  .option("--approval-token <token>", "Operator mutation approval token for command transports")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { id: string; type: "email" | "webhook" | "command"; target: string; arg?: string[]; event: string[]; disabled?: boolean; approvalToken?: string; json?: boolean }) => {
    const enabled = !options.disabled;
    const events = [...new Set(options.event)];
    const commandArgs = options.arg ?? [];
    requireCliMutation("notifications_add", options.approvalToken, { resourceId: cliResourceId("notification", options.id), args: { id: options.id, type: options.type, target: options.target, args: commandArgs, event: events, enabled } });
    const result = addNotificationChannel({
      id: options.id,
      type: options.type,
      target: options.target,
      commandArgs: options.type === "command" && commandArgs.length > 0 ? commandArgs : undefined,
      events,
      enabled,
    }, { trustedApproval: trustedNotificationApproval });
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
  .option("--approval-token <token>", "Operator mutation approval token for command transports")
  .option("-j, --json", "Print JSON output", false)
  .action(async (options: { channel: string; event: string; message: string; apply?: boolean; yes?: boolean; approvalToken?: string; json?: boolean }) => {
    if (options.apply) requireCliMutation("notifications_test", options.approvalToken, { resourceId: cliResourceId("notification-test", options.channel, options.event), args: { channel: options.channel, event: options.event, message: options.message, yes: options.yes } });
    const result = await testNotificationChannel(options.channel, options.event, options.message, {
      apply: options.apply,
      yes: options.yes,
      trustedApproval: options.apply === true ? trustedNotificationApproval : undefined,
    });
    printJsonOrText(result, renderNotificationTestResult(result), options.json);
  });

notificationsCommand
  .command("dispatch")
  .description("Dispatch an event to matching notification channels")
  .requiredOption("--event <name>", "Event name")
  .requiredOption("--message <message>", "Message body")
  .option("--channel <id>", "Limit delivery to one channel")
  .option("--approval-token <token>", "Operator mutation approval token for command transports")
  .option("-j, --json", "Print JSON output", false)
  .action(async (options: { event: string; message: string; channel?: string; approvalToken?: string; json?: boolean }) => {
    requireCliMutation("notifications_dispatch", options.approvalToken, { resourceId: cliResourceId("notification-dispatch", options.channel, options.event), args: { event: options.event, message: options.message, channel: options.channel } });
    const result = await dispatchNotificationEvent(options.event, options.message, { channelId: options.channel, trustedApproval: trustedNotificationApproval });
    printJsonOrText(result, renderNotificationDispatchResult(result), options.json);
  });

notificationsCommand
  .command("remove")
  .description("Remove a notification channel")
  .argument("<id>", "Channel identifier")
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((id: string, options: { approvalToken?: string; json?: boolean }) => {
    requireCliMutation("notifications_remove", options.approvalToken, { resourceId: cliResourceId("notification", id), args: { id } });
    const result = removeNotificationChannel(id);
    printJsonOrText(result, renderNotificationConfigResult(result), options.json);
  });

runtimeCommand
  .command("tmux-hook-plan")
  .description("Print a tmux pane-died hook command that emits machines events")
  .option("--machines-command <command>", "machines CLI executable", "machines")
  .option("--tmux-command <command>", "tmux executable")
  .option("--deliver", "Deliver webhooks from the hook instead of recording only", false)
  .option("--approval-token <token>", "Scoped mutation token for the generated events emit command")
  .option("--trusted-local-mutation", "Include process-local trusted mutation env when no approval token is supplied", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machinesCommand?: string; tmuxCommand?: string; deliver?: boolean; approvalToken?: string; trustedLocalMutation?: boolean; json?: boolean }) => {
    if (!options.approvalToken && options.trustedLocalMutation !== true) {
      throw new Error("tmux-hook-plan requires --approval-token or explicit --trusted-local-mutation.");
    }
    const result = buildTmuxPaneDiedHookPlan({
      machinesCommand: options.machinesCommand,
      tmuxCommand: options.tmuxCommand,
      deliver: options.deliver,
      approvalToken: options.approvalToken,
      trustedLocalMutation: options.trustedLocalMutation,
    });
    printJsonOrText(result, result.shellCommand, options.json);
  });

runtimeCommand
  .command("tmux-watch")
  .description("Watch a tmux pane and emit machines.tmux.pane_died if it disappears")
  .argument("<target>", "tmux pane target, for example %1 or session:window.pane")
  .option("--interval-ms <ms>", "Polling interval in milliseconds", "5000")
  .option("--max-checks <n>", "Stop after N checks instead of watching forever")
  .option("--once", "Probe once and emit machines.tmux.pane_missing when absent", false)
  .option("--no-deliver", "Record the event without webhook delivery")
  .option("--approval-token <token>", "Scoped mutation approval token for event delivery")
  .option("-j, --json", "Print JSON output", false)
  .action(async (target: string, options: RuntimeTmuxWatchCliOptions) => {
    const normalizedTarget = target.trim();
    if (!normalizedTarget) throw new Error("tmux pane target is required");
    const intervalMs = parseIntegerOption(options.intervalMs ?? "5000", "interval-ms", { min: 0 });
    const maxChecks = options.once
      ? 1
      : options.maxChecks
        ? parseIntegerOption(options.maxChecks, "max-checks", { min: 1 })
        : undefined;
    const once = Boolean(options.once);
    const deliver = options.deliver !== false;
    const tmuxCommand = runtimeTmuxCommand();
    const eventTypes = runtimeTmuxEventTypes(once);
    const scopedIntervalMs = once ? undefined : intervalMs;
    if (deliver) {
      requireCliMutation("machines_runtime_tmux_watch_deliver", options.approvalToken, {
        resourceId: eventStoreResourceId("runtime-tmux-watch", normalizedTarget, eventTypes.join(",")),
        args: withEventStoreScope({
          target: normalizedTarget,
          event_types: eventTypes,
          interval_ms: scopedIntervalMs,
          max_checks: maxChecks,
          once,
          emit_initial_missing: once,
          deliver: true,
          tmux_command: tmuxCommand,
        }),
      });
    }
    const result = await watchTmuxPane({
      target: normalizedTarget,
      intervalMs,
      maxChecks,
      emitInitialMissing: once,
      deliver,
      tmuxCommand,
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
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; tool?: string[]; yes?: boolean; approvalToken?: string; json?: boolean }) => {
    const resolvedMachineId = cliMachineId(options.machine);
    const plan = buildClaudeInstallPlan(options.machine, options.tool);
    requireCliMutation("install_claude_apply", options.approvalToken, {
      machineId: resolvedMachineId,
      resourceId: cliPlanResourceId("install_claude_apply", resolvedMachineId, plan),
      args: cliPlanApprovalArgs({ machine_id: resolvedMachineId, tools: options.tool, yes: options.yes }, plan),
    });
    const result = runClaudeInstallPlan(plan, { apply: true, yes: options.yes });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("install-tailscale")
  .description("Install Tailscale on a machine")
  .option("--machine <id>", "Machine identifier")
  .option("--apply", "Execute installation commands instead of previewing the plan", false)
  .option("--yes", "Confirm execution when using --apply", false)
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; apply?: boolean; yes?: boolean; approvalToken?: string; json?: boolean }) => {
    if (options.apply) {
      const resolvedMachineId = cliMachineId(options.machine);
      const plan = buildTailscaleInstallPlan(options.machine);
      requireCliMutation("install_tailscale_apply", options.approvalToken, {
        machineId: resolvedMachineId,
        resourceId: cliPlanResourceId("install_tailscale_apply", resolvedMachineId, plan),
        args: cliPlanApprovalArgs({ machine_id: resolvedMachineId, yes: options.yes }, plan),
      });
      const result = runTailscaleInstallPlan(plan, { apply: true, yes: options.yes });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const result = buildTailscaleInstallPlan(options.machine);
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
    const topology = discoverMachineTopology({ includeTailscale: options.tailscale !== false, limit: null, offset: 0 });
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
  .command("cloud-loader")
  .description("Probe whether a station shell loads the Hasna cloud-env loader by CLI behavior")
  .requiredOption("--machine <id>", "Machine identifier")
  .option("--login-only", "Run only the login-shell probe; default runs login plus bare-control", false)
  .option("--bare-control", "Run only the same probe in env -i HOME=$HOME PATH=$PATH bash -c; expected status is NOT-LOADED", false)
  .option("--timeout-ms <ms>", "Probe timeout in milliseconds", "15000")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine: string; loginOnly?: boolean; bareControl?: boolean; timeoutMs?: string; json?: boolean }, command: Command) => {
    if (options.loginOnly && options.bareControl) throw new Error("--login-only and --bare-control are mutually exclusive");
    const timeoutMs = options.timeoutMs ? parseIntegerOption(options.timeoutMs, "timeout-ms", { min: 1 }) : undefined;
    const result = options.loginOnly || options.bareControl
      ? probeStationLoader({ machineId: options.machine, shellMode: options.bareControl ? "bare" : "login", timeoutMs })
      : probeStationLoaderWithBareControl({ machineId: options.machine, timeoutMs });
    const rendered = "login" in result ? renderStationLoaderProbeSuite(result) : renderStationLoaderProbe(result);
    printCommandResult(result, rendered, wantsCommandJson(options, command));
    if (!result.assertionPassed) {
      process.exitCode = result.status === "UNKNOWN" ? 2 : 1;
    }
  });

program
  .command("ssh")
  .description("Choose the best SSH route for a machine")
  .requiredOption("--machine <id>", "Machine identifier")
  .option("--cmd <command>", "Remote command to run")
  .option("--private-metadata", "Print private SSH target and command", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine: string; cmd?: string; privateMetadata?: boolean; json?: boolean }) => {
    const resolved = resolveMachineRoute(options.machine);
    const publicResolved = redactRouteForOutput(resolved, { privateMetadata: options.privateMetadata });
    const command = resolved.ok && options.privateMetadata ? buildSshCommand(options.machine, options.cmd) : resolved.ok ? REDACTED_VALUE : null;
    if (options.json) {
      console.log(JSON.stringify({ resolved: publicResolved, command }, null, 2));
      return;
    }
    if (!resolved.ok) {
      console.error(chalk.red(resolved.warnings.join("; ") || `No route found for ${options.machine}`));
      process.exitCode = 1;
      return;
    }
    if (!options.privateMetadata) {
      console.error(chalk.red("Refusing to print private SSH target; rerun with --private-metadata."));
      process.exitCode = 1;
      return;
    }
    console.log(command);
  });

program
  .command("exec")
  .description("Run a bounded command on a machine through the package-owned runner")
  .requiredOption("--machine <id>", "Machine identifier")
  .requiredOption("--timeout-ms <ms>", "Command timeout in milliseconds")
  .option("--max-output-chars <n>", `Maximum stdout/stderr chars per stream (default ${DEFAULT_MACHINE_EXEC_MAX_OUTPUT_CHARS})`)
  .option("--script", "Read the command script from stdin instead of argv", false)
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON result instead of streaming stdout/stderr", false)
  .argument("[argv...]", "Command argv when not using --script")
  .action((argv: string[], options: { machine: string; timeoutMs: string; maxOutputChars?: string; script?: boolean; approvalToken?: string; json?: boolean }) => {
    try {
      const timeoutMs = parseIntegerOption(options.timeoutMs, "timeout-ms", { min: 1 });
      const maxOutputChars = options.maxOutputChars
        ? parseIntegerOption(options.maxOutputChars, "max-output-chars", { min: 1 })
        : undefined;
      const script = options.script ? readBoundedMachineExecScript() : undefined;
      const input: MachineExecInput = {
        machineId: options.machine,
        timeoutMs,
        argv: options.script ? undefined : argv,
        script,
        maxOutputChars,
      };
      requireCliMutation(MACHINE_EXEC_MUTATION_OPERATION, options.approvalToken, {
        machineId: input.machineId,
        resourceId: machineExecResourceId(input),
        args: machineExecMutationArgs(input),
      });
      const result = runMachineExec(input);

      if (options.json) {
        console.log(JSON.stringify({
          machine_id: result.machine_id,
          source: result.source,
          exit_code: result.exit_code,
          timed_out: result.timed_out,
          signal: result.signal,
          stdout: result.stdout.text,
          stderr: result.stderr.text,
          truncated: {
            stdout: result.stdout.truncated,
            stderr: result.stderr.truncated,
          },
          redacted: result.redacted,
        }, null, 2));
      } else {
        if (result.stdout.text) process.stdout.write(result.stdout.text);
        if (result.stderr.text) process.stderr.write(result.stderr.text);
      }

      process.exitCode = result.exit_code;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ error: message }, null, 2));
      } else {
        console.error(chalk.red(message));
      }
      process.exitCode = 1;
    }
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
      const topology = discoverMachineTopology({ limit: null, offset: 0 });
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
  .option("--strict", "Exit non-zero if any machine fails to resolve or its checked secret is missing", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; all?: boolean; checkSecret?: boolean; secretsCommand: string; tailscale?: boolean; strict?: boolean; json?: boolean }) => {
    const topology = discoverMachineTopology({ includeTailscale: options.tailscale !== false, limit: null, offset: 0 });
    const machineIds = options.all
      ? topology.machines.map((machine) => machine.machine_id)
      : [options.machine].filter((machine): machine is string => Boolean(machine));
    if (machineIds.length === 0) {
      failCli("Provide --machine <id> or --all", Boolean(options.json));
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
    const hasFailures = screenCredentialsFailed(results, { strict: options.strict });
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

storageCommand.command("push").description("Push local machine runtime data to storage PostgreSQL").option("--tables <tables>", "Comma-separated table names").option("--approval-token <token>", "Scoped mutation approval token").option("-j, --json", "Print JSON output", false).action(async (options: { tables?: string; approvalToken?: string; json?: boolean }) => {
  try {
    const { parseStorageTables, resolveTables, storagePush } = await import("../storage.js");
    const tables = resolveTables(parseStorageTables(options.tables));
    requireCliMutation("storage_push", options.approvalToken, { resourceId: cliResourceId("storage-push", tables.join(",")), args: { tables } });
    const results = await storagePush({ tables, trustedLocalMutation: createTrustedSdkMutationApproval() });
    printStorageResults(results, options.json);
  } catch (error) {
    printStorageError(error);
  }
});

storageCommand.command("pull").description("Pull machine runtime data from storage PostgreSQL to local SQLite").option("--tables <tables>", "Comma-separated table names").option("--approval-token <token>", "Scoped mutation approval token").option("-j, --json", "Print JSON output", false).action(async (options: { tables?: string; approvalToken?: string; json?: boolean }) => {
  try {
    const { parseStorageTables, resolveTables, storagePull } = await import("../storage.js");
    const tables = resolveTables(parseStorageTables(options.tables));
    requireCliMutation("storage_pull", options.approvalToken, { resourceId: cliResourceId("storage-pull", tables.join(",")), args: { tables } });
    const results = await storagePull({ tables, trustedLocalMutation: createTrustedSdkMutationApproval() });
    printStorageResults(results, options.json);
  } catch (error) {
    printStorageError(error);
  }
});

storageCommand.command("sync").description("Bidirectional storage sync: pull then push").option("--tables <tables>", "Comma-separated table names").option("--approval-token <token>", "Scoped mutation approval token").option("-j, --json", "Print JSON output", false).action(async (options: { tables?: string; approvalToken?: string; json?: boolean }) => {
  try {
    const { parseStorageTables, resolveTables, storageSync } = await import("../storage.js");
    const tables = resolveTables(parseStorageTables(options.tables));
    requireCliMutation("storage_sync", options.approvalToken, { resourceId: cliResourceId("storage-sync", tables.join(",")), args: { tables } });
    const result = await storageSync({ tables, trustedLocalMutation: createTrustedSdkMutationApproval() });
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

program.command("status").description("Print local machine and storage status").option("--private-metadata", "Print private local paths and machine identifiers", false).option("-j, --json", "Print JSON output", false).action((options: { privateMetadata?: boolean; json?: boolean }) => {
  const status = getStatus({ privateMetadata: options.privateMetadata });
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
    const exitCode = doctorExitCode(result);
    if (exitCode !== 0) process.exitCode = exitCode;
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
  .option("--host <host>", "Host interface to bind", "127.0.0.1")
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

const dbCommand = program.command("db").description("Cloud database schema operations (Amendment A1: shared RDS machines database)");

dbCommand
  .command("migrate")
  .description("Apply pending cloud migrations (api-keys + machines registry). Connects as the owner role.")
  .option("--dry-run", "Report the migration plan without applying", false)
  .option("-j, --json", "Print JSON output", false)
  .action(jsonAwareAction(async (options: { dryRun?: boolean; json?: boolean }) => {
    const result = await runMigrations({ dryRun: options.dryRun === true });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (options.dryRun) {
      console.log(chalk.cyan(`pending migrations: ${result.pending.length ? result.pending.join(", ") : "(none)"}`));
      console.log(chalk.gray(`already applied: ${result.alreadyApplied.length}`));
      return;
    }
    console.log(chalk.green(`applied ${result.applied.length} migration(s)${result.applied.length ? ": " + result.applied.join(", ") : ""}`));
    console.log(chalk.gray(`already applied: ${result.alreadyApplied.length}`));
  }, (options) => Boolean(options.json)));

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

// --- fleet env-flip -------------------------------------------------------

const flipCommand = program
  .command("flip")
  .description("Coordinate fleet client-backend flips (local store <-> hosted HTTP API) per app");

function parseMachineList(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveFlipWaves(spec: ReturnType<typeof getFlipApp>, options: {
  machines?: string;
  tags?: string;
  exclude?: string;
  canary?: string;
  batch?: string;
  allMachines?: boolean;
}) {
  const manifest = readManifest();
  // --all-machines: flip the ENTIRE fleet, ignoring any --machines restriction,
  // in a single atomic wave (coordination-store cutover; no half-flip).
  const targets = selectTargets(manifest, {
    machines: options.allMachines ? undefined : parseMachineList(options.machines),
    tags: parseMachineList(options.tags),
    exclude: parseMachineList(options.exclude),
  });
  const waves = planWaves(targets, {
    atomic: Boolean(options.allMachines),
    canarySize: options.canary !== undefined ? Number(options.canary) : 1,
    batchSize: options.batch !== undefined ? Number(options.batch) : 4,
  });
  return { manifest, targets, waves, spec };
}

const machineFlipRunner: RunnerFn = (machineId, command, opts) => {
  const res = runMachineCommand(machineId, command, { timeoutMs: opts?.timeoutMs });
  return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
};

flipCommand
  .command("apps")
  .description("List apps registered for fleet flip")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { json?: boolean }) => {
    if (options.json) {
      console.log(JSON.stringify(listFlipApps(), null, 2));
      return;
    }
    for (const spec of listFlipApps()) {
      const freeze = spec.freezeRequired ? " [freeze-required]" : "";
      console.log(`${spec.app}${freeze}\n  url:    ${spec.apiUrlEnv}=${spec.apiUrl}\n  key:    ${spec.apiKeyEnv} (secret: ${spec.apiKeySecretPath})\n  unit:   ${spec.serviceUnit}\n  verify: ${spec.cliBin} ${spec.statusArgs}${spec.note ? `\n  note:   ${spec.note}` : ""}`);
    }
  });

flipCommand
  .command("plan <app>")
  .description("Show the flip plan (waves + generated script) without executing")
  .option("--mode <mode>", "api (route the client to the hosted API) or local (revert)", "api")
  .option("--machines <ids>", "Restrict to these machine ids (comma/space separated)")
  .option("--tags <tags>", "Restrict to machines carrying ALL of these tags")
  .option("--exclude <ids>", "Exclude these machine ids")
  .option("--all-machines", "Flip the ENTIRE fleet in one atomic wave (coordination cutover)", false)
  .option("--canary <n>", "Canary wave size", "1")
  .option("--batch <n>", "Batch size after canary", "4")
  .option("-j, --json", "Print JSON output", false)
  .action((app: string, options: Record<string, string | undefined> & { json?: boolean; allMachines?: boolean }) => {
    const spec = getFlipApp(app);
    const mode = normalizeFlipMode(options["mode"]);
    const { waves } = resolveFlipWaves(spec, options as never);
    const plan = buildFlipPlan(spec, mode, waves);
    if (options.json) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    console.log(`flip plan: ${spec.app} -> ${mode}${plan.freezeRequired ? " (freeze-required)" : ""}`);
    for (const wave of plan.waves) console.log(`  ${wave.name}: ${wave.machines.join(", ") || "(none)"}`);
    console.log(`secrets referenced: ${plan.secretPathsReferenced.join(", ") || "(none)"}`);
    console.log("--- remote script ---");
    console.log(plan.scriptPreview);
  });

flipCommand
  .command("script <app>")
  .description("Print the generated remote flip script for one app")
  .option("--mode <mode>", "api or local", "api")
  .option("--skip-restart", "Write env only; do not restart the service", false)
  .action((app: string, options: { mode?: string; skipRestart?: boolean }) => {
    const spec = getFlipApp(app);
    console.log(buildFlipScript(spec, normalizeFlipMode(options.mode), { skipRestart: options.skipRestart }));
  });

flipCommand
  .command("apply <app>")
  .description("Apply the flip across the fleet, wave by wave, verifying each machine")
  .option("--mode <mode>", "api (route the client to the hosted API) or local (revert)", "api")
  .option("--machines <ids>", "Restrict to these machine ids")
  .option("--tags <tags>", "Restrict to machines carrying ALL of these tags")
  .option("--exclude <ids>", "Exclude these machine ids")
  .option("--all-machines", "Flip the ENTIRE fleet in one atomic wave (coordination cutover)", false)
  .option("--canary <n>", "Canary wave size", "1")
  .option("--batch <n>", "Batch size after canary", "4")
  .option("--freeze-check <cmd>", "Freeze command required for freeze-required apps")
  .option("--execute", "Actually run (default is dry-run)", false)
  .option("-j, --json", "Print JSON output", false)
  .action((app: string, options: Record<string, string | undefined> & { execute?: boolean; json?: boolean; freezeCheck?: string; allMachines?: boolean }) => {
    const spec = getFlipApp(app);
    const mode = normalizeFlipMode(options["mode"]);
    const { waves } = resolveFlipWaves(spec, options as never);
    const ledgerPath = getFlipLedgerPath();
    const report = runFlip({
      spec,
      mode,
      waves,
      runner: machineFlipRunner,
      execute: Boolean(options.execute),
      freezeCommand: options.freezeCheck,
      // P1-C: the per-run ledger is written ONLY for a real execute; dry-runs
      // return the rows in the report but never mutate the ledger file.
      ledger: (entries) => {
        const dir = dirname(resolve(ledgerPath));
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        for (const entry of entries) appendFileSync(ledgerPath, JSON.stringify(entry) + "\n");
      },
    });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`flip ${report.app} -> ${report.mode} (${report.execute ? "EXECUTE" : "dry-run"})`);
      for (const r of report.results) {
        const status = report.execute ? (r.verification.ok ? "ok" : "FAIL") : "planned";
        console.log(`  [${r.wave}] ${r.machineId}: ${status}${r.error ? ` — ${r.error}` : ""}`);
      }
      if (report.execute && report.ledger.length > 0) {
        console.log(`flip ledger -> ${ledgerPath} (${report.ledger.length} rows)`);
        for (const entry of report.ledger) {
          const hash = entry.envSha256 ? entry.envSha256.slice(0, 12) : "-";
          console.log(`  ${entry.ts} ${entry.machine} ${entry.app} ${entry.result} source=${entry.sourceOfValue ?? "-"} sha256=${hash} provenance=${entry.provenanceOk ? "ok" : "FAIL"}`);
        }
      }
      if (report.aborted) console.log(`ABORTED: ${report.abortReason}`);
    }
    if (report.aborted || report.results.some((r) => report.execute && !r.verification.ok)) {
      process.exitCode = 1;
    }
  });

flipCommand
  .command("revert <app>")
  .description("Revert an app to local mode across the fleet (alias for apply --mode local)")
  .option("--machines <ids>", "Restrict to these machine ids")
  .option("--tags <tags>", "Restrict to machines carrying ALL of these tags")
  .option("--exclude <ids>", "Exclude these machine ids")
  .option("--all-machines", "Revert the ENTIRE fleet in one atomic wave", false)
  .option("--canary <n>", "Canary wave size", "1")
  .option("--batch <n>", "Batch size after canary", "4")
  .option("--execute", "Actually run (default is dry-run)", false)
  .option("-j, --json", "Print JSON output", false)
  .action((app: string, options: Record<string, string | undefined> & { execute?: boolean; json?: boolean; allMachines?: boolean }) => {
    const spec = getFlipApp(app);
    const { waves } = resolveFlipWaves(spec, options as never);
    const report = runFlip({ spec, mode: "local", waves, runner: machineFlipRunner, execute: Boolean(options.execute) });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`revert ${report.app} -> local (${report.execute ? "EXECUTE" : "dry-run"})`);
      for (const r of report.results) {
        const status = report.execute ? (r.verification.ok ? "ok" : "FAIL") : "planned";
        console.log(`  [${r.wave}] ${r.machineId}: ${status}${r.error ? ` — ${r.error}` : ""}`);
      }
      if (report.aborted) console.log(`ABORTED: ${report.abortReason}`);
    }
    if (report.aborted || report.results.some((r) => report.execute && !r.verification.ok)) {
      process.exitCode = 1;
    }
  });

const registryCommand = program
  .command("registry")
  .description("Machine registry CRUD (routes to <machines.host>/v1/machines when flipped to the hosted API, else local store)");

registryCommand
  .command("backend")
  .description("Show whether the registry resolves to the cloud API or the local store")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { json?: boolean }, command: Command) => {
    const store = resolveMachineRegistryStore();
    printCommandResult(
      { backend: store.backend, baseUrl: store.baseUrl },
      store.backend === "cloud-http" ? `cloud-http ${store.baseUrl}` : "local",
      wantsCommandJson(options, command),
    );
  });

registryCommand
  .command("list")
  .description("List machines in the registry")
  .option("--status <status>", "Filter by status")
  .option("--limit <n>", "Maximum rows to return")
  .option("-j, --json", "Print JSON output", false)
  .action(async (options: { status?: string; limit?: string; json?: boolean }, command: Command) => {
    const store = resolveMachineRegistryStore();
    const machines = await store.list({
      status: options.status,
      limit: options.limit ? parseIntegerOption(options.limit, "limit", { min: 1 }) : undefined,
    });
    printCommandResult(
      { backend: store.backend, machines, count: machines.length },
      machines.map((m) => `${m.id}\t${m.status}\t${m.friendlyName ?? "-"}\t${m.platform ?? "-"}`).join("\n") || "(no machines)",
      wantsCommandJson(options, command),
    );
  });

registryCommand
  .command("show <id>")
  .description("Show one machine by id")
  .option("-j, --json", "Print JSON output", false)
  .action(async (id: string, options: { json?: boolean }, command: Command) => {
    const store = resolveMachineRegistryStore();
    const machine = await store.get(id);
    if (!machine) {
      console.error(chalk.red(`machine not found: ${id}`));
      process.exitCode = 1;
      return;
    }
    printCommandResult(machine, JSON.stringify(machine, null, 2), wantsCommandJson(options, command));
  });

registryCommand
  .command("register <id>")
  .description("Create or update a machine in the registry (upsert)")
  .option("--name <name>", "Friendly name")
  .option("--platform <platform>", "Platform, e.g. linux, darwin")
  .option("--arch <arch>", "Architecture, e.g. arm64, x64")
  .option("--status <status>", "Status", "online")
  .option("--labels <json>", "Labels JSON object")
  .option("--metadata <json>", "Metadata JSON object")
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action(async (
    id: string,
    options: { name?: string; platform?: string; arch?: string; status?: string; labels?: string; metadata?: string; approvalToken?: string; json?: boolean },
    command: Command,
  ) => {
    requireCliMutation("machines_registry_register", options.approvalToken, {
      resourceId: `registry:register:${id}`,
      args: { id },
    });
    const store = resolveMachineRegistryStore();
    const record = await store.upsert({
      id,
      friendlyName: options.name ?? null,
      platform: options.platform ?? null,
      arch: options.arch ?? null,
      status: options.status ?? "online",
      labels: options.labels ? (JSON.parse(options.labels) as Record<string, unknown>) : undefined,
      metadata: options.metadata ? (JSON.parse(options.metadata) as Record<string, unknown>) : undefined,
    });
    printCommandResult(
      { backend: store.backend, machine: record },
      `registered ${record.id} (${store.backend})`,
      wantsCommandJson(options, command),
    );
  });

registryCommand
  .command("remove <id>")
  .description("Delete a machine from the registry")
  .option("--approval-token <token>", "Scoped mutation approval token")
  .option("-j, --json", "Print JSON output", false)
  .action(async (id: string, options: { approvalToken?: string; json?: boolean }, command: Command) => {
    requireCliMutation("machines_registry_remove", options.approvalToken, {
      resourceId: `registry:remove:${id}`,
      args: { id },
    });
    const store = resolveMachineRegistryStore();
    const removed = await store.remove(id);
    printCommandResult(
      { backend: store.backend, removed, id },
      removed ? `removed ${id} (${store.backend})` : `not removed: ${id}`,
      wantsCommandJson(options, command),
    );
    if (!removed) process.exitCode = 1;
  });

try {
  applyJsonAwareErrorHandling(program);
  await program.parseAsync(process.argv);
} catch (error) {
  reportTopLevelError(error);
}
