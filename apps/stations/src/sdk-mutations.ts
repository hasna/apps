import type { MachineCommandRunner } from "./remote.js";
import type {
  DaemonServicePlan,
  DaemonServiceRunOptions,
  DaemonServiceRunResult,
} from "./commands/daemon.js";
import {
  runDaemonServicePlan as rawRunDaemonServicePlan,
} from "./commands/daemon.js";
import type {
  NotificationChannel,
  NotificationConfig,
  NotificationDispatchSummary,
  NotificationTestResult,
  AppsPlanResult,
  SetupResult,
  SyncResult,
} from "./types.js";
import type { DomainMapping } from "./commands/dns.js";
import {
  addDomainMapping as rawAddDomainMapping,
} from "./commands/dns.js";
import {
  clearMachineFriendlyNameMutationArgs,
  manifestAdd as rawManifestAdd,
  manifestBootstrapCurrentMachine as rawManifestBootstrapCurrentMachine,
  manifestClearFriendlyName as rawManifestClearFriendlyName,
  manifestInit as rawManifestInit,
  manifestRemove as rawManifestRemove,
  manifestSetFriendlyName as rawManifestSetFriendlyName,
  machineFriendlyNameResourceId,
  setMachineFriendlyNameMutationArgs,
  type ClearMachineFriendlyNameInput,
  type MachineFriendlyNameResult,
  type SetMachineFriendlyNameInput,
} from "./commands/manifest.js";
import {
  runAppsInstall as rawRunAppsInstall,
  runAppsPlan as rawRunAppsPlan,
  type RunAppsInstallOptions,
} from "./commands/apps.js";
import {
  runBackup as rawRunBackup,
} from "./commands/backup.js";
import {
  runCertPlan as rawRunCertPlan,
} from "./commands/cert.js";
import {
  runClaudeInstall as rawRunClaudeInstall,
  runClaudeInstallPlan as rawRunClaudeInstallPlan,
  type RunClaudeInstallOptions,
} from "./commands/install-claude.js";
import {
  runSetup as rawRunSetup,
  runSetupPlan as rawRunSetupPlan,
  type RunSetupOptions,
} from "./commands/setup.js";
import {
  runSync as rawRunSync,
  runSyncPlan as rawRunSyncPlan,
  type RunSyncOptions,
} from "./commands/sync.js";
import {
  runTailscaleInstall as rawRunTailscaleInstall,
  runTailscaleInstallPlan as rawRunTailscaleInstallPlan,
  type RunTailscaleInstallOptions,
} from "./commands/install-tailscale.js";
import {
  addNotificationChannel as rawAddNotificationChannel,
  createTrustedNotificationApproval,
  dispatchNotificationEvent as rawDispatchNotificationEvent,
  removeNotificationChannel as rawRemoveNotificationChannel,
  testNotificationChannel as rawTestNotificationChannel,
  writeNotificationConfig as rawWriteNotificationConfig,
  type TrustedNotificationApproval,
} from "./commands/notifications.js";
import {
  assertSdkMutationApproved,
  mutationArgsSha256,
  mutationPlanDigest,
  type SdkMutationApprovalOptions,
} from "./commands/mutation-approval.js";
import type { FleetManifest, MachineManifest } from "./types.js";
import {
  assignMachineProject as rawAssignMachineProject,
  removeMachineProjectAssignment as rawRemoveMachineProjectAssignment,
  projectAssignmentMutationArgs,
  projectAssignmentResourceId,
  removeProjectAssignmentMutationArgs,
  type AssignMachineProjectInput,
  type MachineProjectAssignments,
  type RemoveMachineProjectAssignmentInput,
} from "./projects.js";

type ApplyOptions = { apply?: boolean; yes?: boolean };
type SdkApplyOptions<T extends ApplyOptions> = T & SdkMutationApprovalOptions;
type MutationPlan = SetupResult | SyncResult | AppsPlanResult;
type NotificationSdkOptions = SdkMutationApprovalOptions & {
  approvalToken?: string;
  trustedApproval?: TrustedNotificationApproval;
};
type NotificationTestSdkOptions = NotificationSdkOptions & ApplyOptions;

function planResourceId(operation: string, plan: MutationPlan): string {
  return `plan:${operation}:${plan.machineId}:${mutationPlanDigest(plan)}`;
}

function assertPlanApplyApproved(
  operation: string,
  plan: MutationPlan,
  options: SdkApplyOptions<ApplyOptions>,
): void {
  if (options.apply !== true) return;
  assertSdkMutationApproved({
    operation,
    machineId: plan.machineId,
    resourceId: planResourceId(operation, plan),
    args: {
      machine_id: plan.machineId,
      yes: options.yes === true,
      plan_digest: mutationPlanDigest(plan),
    },
  }, options);
}

function assertLocalApplyApproved(
  operation: string,
  resourceId: string,
  args: Record<string, unknown>,
  options: SdkApplyOptions<ApplyOptions>,
): void {
  if (options.apply !== true) return;
  assertSdkMutationApproved({
    operation,
    machineId: "local",
    resourceId,
    args,
  }, options);
}

export function manifestInit(options: SdkMutationApprovalOptions = {}): string {
  assertSdkMutationApproved({
    operation: "stations_manifest_init",
    resourceId: "manifest:init",
    args: {},
  }, options);
  return rawManifestInit();
}

export function manifestAdd(machine: MachineManifest, options: SdkMutationApprovalOptions = {}): FleetManifest {
  assertSdkMutationApproved({
    operation: "stations_manifest_add",
    machineId: machine.id,
    resourceId: `manifest:machine:${machine.id}`,
    args: machine,
  }, options);
  return rawManifestAdd(machine);
}

export function manifestBootstrapCurrentMachine(options: SdkMutationApprovalOptions = {}): FleetManifest {
  assertSdkMutationApproved({
    operation: "stations_manifest_bootstrap",
    resourceId: "manifest:bootstrap",
    args: {},
  }, options);
  return rawManifestBootstrapCurrentMachine();
}

export function manifestRemove(machineId: string, options: SdkMutationApprovalOptions = {}): FleetManifest {
  assertSdkMutationApproved({
    operation: "stations_manifest_remove",
    machineId,
    resourceId: `manifest:machine:${machineId}`,
    args: { machine_id: machineId },
  }, options);
  return rawManifestRemove(machineId);
}

export function manifestSetFriendlyName(
  input: SetMachineFriendlyNameInput,
  options: SdkMutationApprovalOptions = {},
): MachineFriendlyNameResult {
  assertSdkMutationApproved({
    operation: "stations_friendly_name_set",
    machineId: input.machineId,
    resourceId: machineFriendlyNameResourceId(input.machineId),
    args: setMachineFriendlyNameMutationArgs(input),
  }, options);
  return rawManifestSetFriendlyName(input);
}

export function manifestClearFriendlyName(
  input: ClearMachineFriendlyNameInput,
  options: SdkMutationApprovalOptions = {},
): MachineFriendlyNameResult {
  assertSdkMutationApproved({
    operation: "stations_friendly_name_clear",
    machineId: input.machineId,
    resourceId: machineFriendlyNameResourceId(input.machineId),
    args: clearMachineFriendlyNameMutationArgs(input),
  }, options);
  return rawManifestClearFriendlyName(input);
}

export function assignMachineProject(
  input: AssignMachineProjectInput,
  options: SdkMutationApprovalOptions = {},
): MachineProjectAssignments {
  assertSdkMutationApproved({
    operation: "stations_projects_assign",
    machineId: input.machineId,
    resourceId: projectAssignmentResourceId(input.machineId, input.projectId),
    args: projectAssignmentMutationArgs(input),
  }, options);
  return rawAssignMachineProject(input);
}

export function removeMachineProjectAssignment(
  input: RemoveMachineProjectAssignmentInput,
  options: SdkMutationApprovalOptions = {},
): MachineProjectAssignments {
  assertSdkMutationApproved({
    operation: "stations_projects_unassign",
    machineId: input.machineId,
    resourceId: projectAssignmentResourceId(input.machineId, input.projectId),
    args: removeProjectAssignmentMutationArgs(input),
  }, options);
  return rawRemoveMachineProjectAssignment(input);
}

export function runSetup(
  machineId?: string,
  options: SdkApplyOptions<RunSetupOptions> = {},
  runner?: MachineCommandRunner,
): SetupResult {
  const plan = rawRunSetup(machineId, { apply: false });
  assertPlanApplyApproved("stations_setup_apply", plan, options);
  return rawRunSetup(machineId, options, runner);
}

export function runSetupPlan(
  plan: SetupResult,
  options: SdkApplyOptions<RunSetupOptions> = {},
  runner?: MachineCommandRunner,
): SetupResult {
  assertPlanApplyApproved("stations_setup_apply", plan, options);
  return rawRunSetupPlan(plan, options, runner);
}

export function runSync(
  machineId?: string,
  options: SdkApplyOptions<RunSyncOptions> = {},
  runner?: MachineCommandRunner,
): SyncResult {
  const plan = rawRunSync(machineId, { apply: false }, runner);
  assertPlanApplyApproved("stations_sync_apply", plan, options);
  return rawRunSync(machineId, options, runner);
}

export function runSyncPlan(
  plan: SyncResult,
  options: SdkApplyOptions<RunSyncOptions> = {},
  runner?: MachineCommandRunner,
): SyncResult {
  assertPlanApplyApproved("stations_sync_apply", plan, options);
  return rawRunSyncPlan(plan, options, runner);
}

export function runAppsInstall(
  machineId?: string,
  options: SdkApplyOptions<RunAppsInstallOptions> = {},
  runner?: MachineCommandRunner,
): AppsPlanResult {
  const plan = rawRunAppsInstall(machineId, {
    apply: false,
    manifestPath: options.manifestPath,
    env: options.env,
  });
  assertPlanApplyApproved("stations_apps_apply", plan, options);
  return rawRunAppsInstall(machineId, options, runner);
}

export function runAppsPlan(
  plan: AppsPlanResult,
  options: SdkApplyOptions<RunAppsInstallOptions> = {},
  runner?: MachineCommandRunner,
): AppsPlanResult {
  assertPlanApplyApproved("stations_apps_apply", plan, options);
  return rawRunAppsPlan(plan, options, runner);
}

export function runClaudeInstall(
  machineId?: string,
  tools?: string[],
  options: SdkApplyOptions<RunClaudeInstallOptions> = {},
  runner?: MachineCommandRunner,
): SetupResult {
  const plan = rawRunClaudeInstall(machineId, tools, { apply: false });
  assertPlanApplyApproved("stations_install_claude_apply", plan, options);
  return rawRunClaudeInstall(machineId, tools, options, runner);
}

export function runClaudeInstallPlan(
  plan: SetupResult,
  options: SdkApplyOptions<RunClaudeInstallOptions> = {},
  runner?: MachineCommandRunner,
): SetupResult {
  assertPlanApplyApproved("stations_install_claude_apply", plan, options);
  return rawRunClaudeInstallPlan(plan, options, runner);
}

export function runTailscaleInstall(
  machineId?: string,
  options: SdkApplyOptions<RunTailscaleInstallOptions> = {},
  runner?: MachineCommandRunner,
): SetupResult {
  const plan = rawRunTailscaleInstall(machineId, { apply: false });
  assertPlanApplyApproved("stations_install_tailscale_apply", plan, options);
  return rawRunTailscaleInstall(machineId, options, runner);
}

export function runTailscaleInstallPlan(
  plan: SetupResult,
  options: SdkApplyOptions<RunTailscaleInstallOptions> = {},
  runner?: MachineCommandRunner,
): SetupResult {
  assertPlanApplyApproved("stations_install_tailscale_apply", plan, options);
  return rawRunTailscaleInstallPlan(plan, options, runner);
}

export function addDomainMapping(
  domain: string,
  port: number,
  targetHost = "127.0.0.1",
  options: SdkMutationApprovalOptions = {},
): DomainMapping[] {
  assertSdkMutationApproved({
    operation: "stations_dns_add_domain_mapping",
    resourceId: `dns:${domain}`,
    args: { domain, port, target_host: targetHost },
  }, options);
  return rawAddDomainMapping(domain, port, targetHost);
}

export function runCertPlan(
  domains: string[],
  options: SdkApplyOptions<{ apply?: boolean; yes?: boolean }> = {},
): SetupResult {
  assertLocalApplyApproved("stations_cert_apply", `cert:${domains.join(",")}`, {
    domains,
    yes: options.yes === true,
  }, options);
  return rawRunCertPlan(domains, options);
}

export function runBackup(
  bucket?: string,
  prefix?: string,
  options: SdkApplyOptions<{ apply?: boolean; yes?: boolean }> = {},
): SetupResult {
  assertLocalApplyApproved("stations_backup_apply", `backup:${bucket ?? "env"}:${prefix ?? "default"}`, {
    bucket: bucket ?? null,
    prefix: prefix ?? null,
    yes: options.yes === true,
  }, options);
  return rawRunBackup(bucket, prefix, options);
}

export function runDaemonServicePlan(
  plan: DaemonServicePlan,
  options: SdkApplyOptions<DaemonServiceRunOptions> = {},
): DaemonServiceRunResult {
  if (options.apply === true) {
    assertSdkMutationApproved({
      operation: "stations_daemon_apply",
      machineId: "local",
      resourceId: `daemon:${plan.serviceId}:${plan.action}:${plan.platform}:${plan.mode}`,
      args: {
        action: plan.action,
        service_id: plan.serviceId,
        platform: plan.platform,
        mode: plan.mode,
        plan_digest: mutationArgsSha256(plan),
        yes: options.yes === true,
      },
    }, options);
  }
  return rawRunDaemonServicePlan(plan, options);
}

export function writeNotificationConfig(
  config: NotificationConfig,
  pathOrOptions?: string | SdkMutationApprovalOptions,
  maybeOptions: SdkMutationApprovalOptions = {},
): NotificationConfig {
  const path = typeof pathOrOptions === "string" ? pathOrOptions : undefined;
  const options = typeof pathOrOptions === "string" ? maybeOptions : pathOrOptions ?? {};
  assertSdkMutationApproved({
    operation: "stations_notifications_write_config",
    resourceId: path ? `notifications:${mutationArgsSha256(path)}` : "notifications:default",
    args: { path: path ?? null, channel_count: config.channels.length },
  }, options);
  return rawWriteNotificationConfig(config, path);
}

export function addNotificationChannel(
  channel: NotificationChannel,
  options: NotificationSdkOptions = {},
): NotificationConfig {
  assertSdkMutationApproved({
    operation: "stations_notifications_add_channel",
    resourceId: `notifications:channel:${channel.id}`,
    args: channel,
  }, options);
  return rawAddNotificationChannel(channel, {
    ...options,
    trustedApproval: options.trustedApproval ?? createTrustedNotificationApproval(),
  });
}

export function removeNotificationChannel(
  channelId: string,
  options: SdkMutationApprovalOptions = {},
): NotificationConfig {
  assertSdkMutationApproved({
    operation: "stations_notifications_remove_channel",
    resourceId: `notifications:channel:${channelId}`,
    args: { channel_id: channelId },
  }, options);
  return rawRemoveNotificationChannel(channelId);
}

export async function dispatchNotificationEvent(
  event: string,
  message: string,
  options: NotificationSdkOptions & { channelId?: string } = {},
): Promise<NotificationDispatchSummary> {
  assertSdkMutationApproved({
    operation: "stations_notifications_dispatch",
    resourceId: `notifications:dispatch:${event}:${options.channelId ?? "all"}`,
    args: { event, message, channel_id: options.channelId ?? null },
  }, options);
  return rawDispatchNotificationEvent(event, message, {
    ...options,
    trustedApproval: options.trustedApproval ?? createTrustedNotificationApproval(),
  });
}

export async function testNotificationChannel(
  channelId: string,
  event = "manual.test",
  message = "stations notification test",
  options: NotificationTestSdkOptions = {},
): Promise<NotificationTestResult> {
  if (options.apply === true) {
    assertSdkMutationApproved({
      operation: "stations_notifications_test_channel",
      resourceId: `notifications:channel:${channelId}`,
      args: { channel_id: channelId, event, message, yes: options.yes === true },
    }, options);
  }
  return rawTestNotificationChannel(channelId, event, message, options.apply === true
    ? { ...options, trustedApproval: options.trustedApproval ?? createTrustedNotificationApproval() }
    : options);
}
