export * from "./types.js";
export * from "./cross-project-types.js";
export * from "./redaction.js";
export * from "./topology.js";
export * from "./agent-abstractions.js";
export * from "./dispatch-smoke.js";
export * from "./ops-check.js";
export * from "./ops-data.js";
export * from "./notes.js";
export * from "./details.js";
export * from "./browserplan.js";
export * from "./compatibility.js";
export * from "./version.js";

export {
  listMachineProjectAssignments,
  projectAssignmentMutationArgs,
  projectAssignmentResourceId,
  removeProjectAssignmentMutationArgs,
} from "./projects.js";
export type {
  AssignMachineProjectInput,
  MachineProjectAssignment,
  MachineProjectAssignmentMachineSummary,
  MachineProjectAssignmentProjectSummary,
  MachineProjectAssignmentSource,
  MachineProjectAssignments,
  MachineProjectAssignmentsOptions,
  RemoveMachineProjectAssignmentInput,
} from "./projects.js";

export {
  MACHINES_STORAGE_ENV,
  MACHINES_STORAGE_FALLBACK_ENV,
  MACHINES_STORAGE_MODE_ENV,
  MACHINES_STORAGE_MODE_FALLBACK_ENV,
  MACHINES_STORAGE_TABLES,
  STORAGE_DATABASE_ENV,
  STORAGE_MODE_ENV,
  STORAGE_TABLES,
  getStorageDatabaseEnv,
  getStorageDatabaseEnvName,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageStatus,
  getSyncMetaAll,
  parseStorageTables,
  resolveTables,
  runStorageMigrations,
  storagePull,
  storagePush,
  storageSync,
  PG_MIGRATIONS,
} from "./storage.js";
export type {
  StorageEnv,
  StorageMigrationAdapter,
  StorageMode,
  StorageMutationOptions,
  StorageStatus,
  SyncMeta,
  SyncResult as StorageSyncResult,
} from "./storage.js";

export {
  getDataDir,
  getDbPath,
  getManifestPath,
  getNotificationsPath,
  getClipboardKeyPath,
  getClipboardHistoryPath,
  ensureDataDir,
} from "./paths.js";

export {
  PRIVATE_MANIFEST_BACKEND_ENV,
  PRIVATE_MANIFEST_REF_ENV,
  fleetSchema,
  machineSchema,
  detectCurrentMachineManifest,
  getDefaultManifest,
  getManifestMachine,
  getManifestSourceRef,
  machineDisplayName,
  normalizeFriendlyName,
  readManifest,
  readManifestWithSource,
  validateManifest,
} from "./manifests.js";
export type { ManifestSourceAdapter, ReadManifestWithSourceOptions } from "./manifests.js";

export {
  manifestAdd,
  manifestBootstrapCurrentMachine,
  manifestClearFriendlyName,
  manifestInit,
  manifestRemove,
  manifestSetFriendlyName,
  assignMachineProject,
  removeMachineProjectAssignment,
} from "./sdk-mutations.js";
export {
  clearMachineFriendlyNameMutationArgs,
  manifestGet,
  manifestGetFriendlyName,
  manifestList,
  manifestValidate,
  machineFriendlyNameResourceId,
  setMachineFriendlyNameMutationArgs,
} from "./commands/manifest.js";
export type {
  ClearMachineFriendlyNameInput,
  MachineFriendlyNameResult,
  SetMachineFriendlyNameInput,
} from "./commands/manifest.js";

export {
  LEGACY_MUTATION_APPROVAL_FLAG_ENV,
  MUTATION_APPROVAL_CALLER_ENV,
  MUTATION_APPROVAL_FLAG_ENV,
  MUTATION_APPROVAL_REPLAY_PATH_ENV,
  MUTATION_APPROVAL_RUN_ENV,
  MUTATION_APPROVAL_TOKEN_ENV,
  assertMutationApproved,
  assertMutationPlanDigest,
  assertSdkMutationApproved,
  attachMutationPlanDigest,
  canonicalMutationArgs,
  createMutationApprovalToken,
  isMutationApproved,
  mutationArgsSha256,
  mutationPlanDigest,
  verifyMutationApprovalToken,
} from "./commands/mutation-approval.js";
export type {
  CreateMutationApprovalTokenOptions,
  MutationApprovalClaims,
  MutationApprovalDecision,
  MutationApprovalOptions,
  MutationApprovalScope,
  SdkMutationApprovalOptions,
} from "./commands/mutation-approval.js";

export {
  buildBackupPlan,
  resolveBackupTarget,
  MACHINES_BACKUP_BUCKET_ENV,
  MACHINES_BACKUP_BUCKET_FALLBACK_ENV,
  MACHINES_BACKUP_PREFIX_ENV,
  MACHINES_BACKUP_PREFIX_FALLBACK_ENV,
  DEFAULT_BACKUP_PREFIX,
} from "./commands/backup.js";
export type { BackupTarget } from "./commands/backup.js";
export { runBackup } from "./sdk-mutations.js";

export {
  buildAppsPlan,
  diffApps,
  getAppsStatus,
  listApps,
} from "./commands/apps.js";
export type { RunAppsInstallOptions } from "./commands/apps.js";
export {
  runAppsInstall,
  runAppsPlan,
} from "./sdk-mutations.js";

export { buildCertPlan } from "./commands/cert.js";
export { runCertPlan } from "./sdk-mutations.js";

export {
  listDomainMappings,
  renderDomainMapping,
} from "./commands/dns.js";
export type { DomainMapping } from "./commands/dns.js";
export { addDomainMapping } from "./sdk-mutations.js";

export {
  buildDaemonInstallPlan,
  buildDaemonLogsPlan,
  buildDaemonRestartPlan,
  buildDaemonServicePlan,
  buildDaemonStatusPlan,
  buildDaemonUninstallPlan,
  renderLaunchdPlist,
  renderSystemdUnit,
} from "./commands/daemon.js";
export type {
  DaemonServiceAction,
  DaemonServiceCommand,
  DaemonServiceCommandResult,
  DaemonServiceFile,
  DaemonServiceMode,
  DaemonServiceOptions,
  DaemonServicePlan,
  DaemonServicePlatform,
  DaemonServiceRunOptions,
  DaemonServiceRunResult,
} from "./commands/daemon.js";
export { runDaemonServicePlan } from "./sdk-mutations.js";

export { runDoctor, DOCTOR_OPTIONAL_ADAPTER_DOMAINS } from "./commands/doctor.js";
export type { DoctorAdapter, DoctorAdapterContext, DoctorAdapterHook, DoctorOptions, DoctorOptionalAdapterDomain } from "./commands/doctor.js";
export { diffMachines } from "./commands/diff.js";
export {
  buildHeartbeatCollectorCommand,
  collectHeartbeats,
  DEFAULT_HEARTBEAT_COLLECTOR_TIMEOUT_MS,
  HEARTBEAT_COLLECT_MUTATION_OPERATION,
  HEARTBEAT_COLLECTOR_LOOP_NAME,
  heartbeatCollectMutationArgs,
  heartbeatCollectResourceId,
} from "./commands/heartbeat.js";
export type {
  HeartbeatCollectOptions,
  HeartbeatCollectResult,
  HeartbeatCollectorCommandOptions,
  HeartbeatCollectorCommandPlan,
} from "./commands/heartbeat.js";

export {
  buildClaudeInstallPlan,
  diffClaudeCli,
  getClaudeCliStatus,
} from "./commands/install-claude.js";
export type { AiCliTool, RunClaudeInstallOptions } from "./commands/install-claude.js";
export {
  runClaudeInstall,
  runClaudeInstallPlan,
} from "./sdk-mutations.js";

export { buildTailscaleInstallPlan } from "./commands/install-tailscale.js";
export type { RunTailscaleInstallOptions } from "./commands/install-tailscale.js";
export {
  runTailscaleInstall,
  runTailscaleInstallPlan,
} from "./sdk-mutations.js";

export {
  createTrustedNotificationApproval,
  getDefaultNotificationConfig,
  listNotificationChannels,
  readNotificationConfig,
} from "./commands/notifications.js";
export type { TrustedNotificationApproval } from "./commands/notifications.js";
export {
  addNotificationChannel,
  dispatchNotificationEvent,
  removeNotificationChannel,
  testNotificationChannel,
  writeNotificationConfig,
} from "./sdk-mutations.js";

export { listPorts, parsePortOutput } from "./commands/ports.js";
export type { ListeningPort, PortsResult } from "./commands/ports.js";

export {
  buildTmuxPaneDiedHookPlan,
  probeTmuxPane,
} from "./commands/runtime.js";
export type { TmuxPaneDiedHookPlan, TmuxPaneProbeResult, TmuxWatchOptions, TmuxWatchResult } from "./commands/runtime.js";

export {
  DISTRIBUTION_EVENT_TYPES,
  ROLLOUT_RECORD_SCHEMA_ID,
  buildRolloutRecord,
  defaultAppIdForPackage,
  isValidAppId,
  rolloutRecordToEventData,
} from "./distribution.js";
export type {
  BuildRolloutRecordInput,
  EvidencePointer,
  ReleasePublishedData,
  RolloutAction,
  RolloutData,
  RolloutRecordDoc,
  RolloutResult,
  RolloutVerification,
} from "./distribution.js";

export {
  addFreeze,
  findFreeze,
  listActiveFreezes,
  readFreezeFile,
  removeFreeze,
  writeFreezeFile,
} from "./commands/freeze.js";
export type { FreezeFile } from "./commands/freeze.js";

export {
  appendRolloutRecord,
  buildReconcilePlan,
  defaultBinForPackage,
  executeReconcilePlan,
  getInstalledGlobalPackages,
  parseBunGlobalList,
  readInstalledSnapshot,
  readRolloutRecords,
  reconcileFromReleaseEvent,
  releaseEventTrigger,
  resolveDesiredPackages,
} from "./commands/reconcile.js";

export type {
  BuildReconcilePlanOptions,
  DesiredPackage,
  ExecFn,
  ExecResult,
  ExecuteReconcileOptions,
  InstalledPackage,
  ReconcileActionKind,
  ReconcileActionResult,
  ReconcilePlan,
  ReconcilePlanAction,
  ReconcileResult,
  ReconcileFromEventOptions,
  ReleaseEventEnvelope,
  ReleaseEventTrigger,
  RolloutEmitInput,
  RolloutEmitter,
} from "./commands/reconcile.js";

export { buildSetupPlan } from "./commands/setup.js";
export type { RunSetupOptions } from "./commands/setup.js";
export {
  runSetup,
  runSetupPlan,
} from "./sdk-mutations.js";

export {
  buildScreenCommand,
  buildScreenEnableCommand,
  buildScreenEnableRemoteCommand,
  buildScreenEnableRemoteCommandFromStdin,
  defaultScreenPasswordSecretKey,
  resolveScreenCredentials,
  resolveScreenTarget,
  DEFAULT_SCREEN_SECRET_NAMESPACE,
  SCREEN_SECRET_NAMESPACE_ENV,
} from "./commands/screen.js";
export type { ResolvedScreenTarget, ScreenCredentialOptions, ScreenCredentialResolution, ScreenEnableCommandOptions, ScreenEnableCommandPlan } from "./commands/screen.js";

export {
  buildSshCommand,
  buildSshCommandArgs,
  buildSshCommandPlan,
  resolveSshTarget,
  validateSshTarget,
} from "./commands/ssh.js";
export type { ResolvedSshTarget, SshCommandPlan } from "./commands/ssh.js";

export { buildSyncPlan } from "./commands/sync.js";
export type { RunSyncOptions } from "./commands/sync.js";
export {
  runSync,
  runSyncPlan,
} from "./sdk-mutations.js";

export { getStatus } from "./commands/status.js";
export type { FleetStatusOptions } from "./commands/status.js";

export { runSelfTest } from "./commands/self-test.js";
export {
  getServeInfo,
  renderDashboardHtml,
} from "./commands/serve.js";
export type { ServeInfo, ServeOptions } from "./commands/serve.js";

export {
  getAgentStatus,
  sanitizePublicString,
} from "./agent/runtime.js";
export type { AgentRuntimeOptions, AgentRuntimeStatus, AgentStatusOptions, AgentTickOptions } from "./agent/runtime.js";
export { MACHINES_CONSUMER_SCHEMA_BUNDLE } from "./consumer-schema.js";
