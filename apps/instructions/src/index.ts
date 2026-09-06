// Types
export * from "./types/index.js";

// Store — the single data abstraction (LocalStore + ApiStore). Every SDK data
// operation routes through this interface; no raw sqlite/fetch is exposed.
// Credential + authority resolution lives in the ONE shared resolver
// (@hasna/contracts, hasna/apps#1720) — see lib/transport-resolver.ts.
export {
  CloudConfigStore,
  LocalConfigStore,
  LOCAL_OPT_IN_ENV,
  isApiTransport,
  isCloudAuthError,
  isLocalOptIn,
  formatCliError,
  resolveConfigStore,
} from "./data/config-store.js";
export type { ConfigStore } from "./data/config-store.js";
export {
  INSTRUCTIONS_LOCAL_OPT_IN_ENV,
  INSTRUCTIONS_LOCAL_OPT_IN_ENV_KEYS,
  announceLocalInstructionsMode,
  getInstructionsTransportStatus,
  instructionsLocalModeNotice,
  isInstructionsLocalOptIn,
} from "./lib/transport-resolver.js";
export type { InstructionsTransportStatus } from "./lib/transport-resolver.js";
export type {
  InstructionsClientEnv,
  InstructionsCredentialChainOptions,
  InstructionsKeychainOptions,
  InstructionsRequestOptions,
  InstructionsStorageClient,
  InstructionsStorageTransport,
} from "./lib/client-types.js";
export { boundedReadPage, normalizeBoundedReadOptions } from "./lib/bounded-read.js";

// Machine + slug helpers (pure)
export { currentHostname, currentOs, currentArch } from "./db/machines.js";
export { uuid, now, slugify } from "./db/database.js";

// Status contract
export { getConfigsStatus } from "./status.js";
export type { ConfigsStatusContract } from "./status.js";

// Per-endpoint provider-context injection (provider identity for non-native harness lanes)
export {
  PROVIDER_CONTEXT_DIR,
  PROVIDER_CONTEXT_INVARIANT_ID,
  PROVIDER_CONTEXT_MANIFEST,
  PROVIDER_CONTEXT_SCHEMA,
  PROVIDER_ENDPOINT_REGISTRY,
  matchProviderEndpoint,
  normalizeEndpointOrigin,
  providerContextAuditLine,
  renderProviderFragment,
  resolveAndRenderProviderContext,
} from "./lib/provider-context.js";
export type {
  ProviderContextRenderOptions,
  ProviderContextResolution,
  ProviderEndpointEntry,
} from "./lib/provider-context.js";

// Skill-home distribution (managed skill runtimes)
export {
  INBOX_CONVERSATIONS_MINIMUM_VERSION,
  inspectManagedSkillRuntimes,
  reconcileManagedSkillRuntimes,
} from "./lib/managed-skill-runtimes.js";
export type {
  ManagedSkillRuntimeInspection,
  ManagedSkillRuntimeOptions,
  ManagedSkillRuntimeReconcileReport,
  ManagedSkillRuntimeResult,
  ManagedSkillRuntimeStatus,
} from "./lib/managed-skill-runtimes.js";

// DB — PostgreSQL migrations
export { PG_MIGRATIONS } from "./db/pg-migrations.js";

// Lib — apply
export { applyConfig, applyConfigs, applyConfigsWithReport, expandPath, previewConfigs } from "./lib/apply.js";
export type {
  ApplyOptions,
  ConfigApplyPreview,
  ConfigApplyPreviewFailure,
  ConfigApplySkippedTarget,
} from "./lib/apply.js";

// Lib — session render/apply
export {
  CODEWITH_NATIVE_IMPORTS_ENV,
  RAW_STORE_ROOT_ENV,
  SESSION_INSTRUCTION_LAYERS,
  SESSION_LAYER_RANK,
  SESSION_RENDER_MANAGED_MARKER,
  SESSION_RENDER_SCHEMA,
  SESSION_RENDER_TOOLS,
  SESSION_TOOL_ADAPTERS,
  cleanSessionPathInput,
  getRawStoreRoot,
  planSessionRender,
  resolveSessionPath,
  resolveSessionTargetOwnership,
  selectProfileConfigsForSessionRender,
  sourceFromConfig,
  sourceFromFilePath,
  sourcesFromIdentityExport,
} from "./lib/session-render.js";
// Lib — station-profile injector (owner request 2026-08-24)
export {
  STATION_PROFILE_CACHE_FILENAME,
  STATION_PROFILE_LAYER,
  STATION_PROFILE_MAX_BYTES,
  STATION_PROFILE_SOURCE_ID,
  buildStationProfileBlock,
  getStationProfileCachePath,
  readStationProfile,
  refreshStationProfile,
  resolveStationProfileMachine,
  resolveStationProfilePackages,
  stationProfileSource,
} from "./lib/station-profile.js";
export type {
  StationProfileBuildInput,
  StationProfileMachine,
  StationProfilePackages,
  StationProfileRefreshResult,
  StationProfileStatus,
} from "./lib/station-profile.js";
export {
  INSTRUCTION_GRAPH_PLAN_SCHEMA,
  PROVIDER_CAPABILITIES,
  PROVIDER_CAPABILITY_DESCRIPTORS,
  PROVIDER_CAPABILITY_SCHEMA,
  InstructionGraphValidationError,
  compileInstructionGraph,
  legacyProfileConfigBinding,
  normalizeProfileConfigBinding,
  planProfileSessionRender,
  selectProviderCapability,
} from "./lib/instruction-graph.js";
export type {
  CompiledInstructionGraph,
  InstructionGraphArtifact,
  InstructionGraphContext,
  InstructionGraphDiagnostic,
  InstructionGraphRenderPlan,
  InstructionGraphUnit,
  ProfileSessionRenderPlan,
  ProviderCapability,
} from "./lib/instruction-graph.js";
export {
  ASSET_BUNDLE_SCHEMA,
  ASSET_CAPABILITY_DESCRIPTORS,
  ASSET_CAPABILITY_SCHEMA,
  ASSET_PLAN_SCHEMA,
  AssetPlanValidationError,
  assetBundleFromConfig,
  compileAssetPlan,
  configAssetDigest,
  configAssetLocator,
  normalizeProfileAssetBinding,
  resolveAssetDestination,
  selectAssetCapability,
} from "./lib/asset-plan.js";
export type {
  AssetAction,
  AssetBundle,
  AssetCapability,
  AssetPlan,
  AssetPlanDiagnostic,
  AssetPlanItem,
  AssetPlanMode,
  AssetSupport,
  CompileAssetPlanInput,
} from "./lib/asset-plan.js";
export { providerVersionSatisfies } from "./lib/provider-version.js";
export type {
  SessionInstructionLayer,
  SessionInstructionMerge,
  SessionInstructionOwner,
  SessionInstructionRule,
  SessionInstructionSource,
  SessionInstructionSourcePath,
  SessionProfileRenderSelection,
  SessionProviderConfig,
  SessionProviderSurface,
  SessionRenderFile,
  SessionRenderFileRole,
  SessionRenderInput,
  SessionRenderManifest,
  SessionRenderMode,
  SessionRenderPlan,
  SessionRenderTargetKind,
  SessionRenderTool,
  SessionSkippedSource,
  SessionTargetOwner,
  SessionTargetOwnerKind,
  SessionToolAdapter,
} from "./lib/session-render.js";
export {
  applySessionRender,
  checkSessionRenderDrift,
  restoreSessionRenderSnapshot,
  SessionApplyError,
} from "./lib/session-apply.js";

// Lib — strict Projects context bundle rendering
export {
  LEGACY_CONFIGS_COMPAT_VERSION,
  LEGACY_CONFIGS_EXECUTABLE,
  LEGACY_CONFIGS_PACKAGE,
  PROJECT_CONTEXT_CACHE_PATH,
  PROJECT_CONTEXT_FRAGMENT_PATH,
  PROJECT_CONTEXT_LOCK_PATH,
  PROJECT_CONTEXT_MANAGED_COMMENT,
  PROJECT_CONTEXT_MANIFEST_PATH,
  PROJECT_CONTEXT_MAX_COMMANDS,
  PROJECT_CONTEXT_MAX_INPUT_BYTES,
  PROJECT_CONTEXT_MAX_RENDERED_BYTES,
  PROJECT_CONTEXT_SCHEMA,
  ProjectContextError,
  applyProjectContext,
  computeProjectContextSourceHash,
  parseProjectContextBundle,
  planProjectContext,
} from "./lib/project-context.js";
export type {
  ProjectContextApplyOptions,
  ProjectContextApplyResult,
  ProjectContextBundleV1,
  ProjectContextPlan,
  ProjectContextPlanInput,
  ProjectContextRuntime,
  ProjectContextStatus,
} from "./lib/project-context.js";
export type {
  SessionApplyAction,
  SessionApplyFileResult,
  SessionApplyOptions,
  SessionApplyResult,
  SessionDriftCheck,
  SessionDriftEntry,
  SessionRestoreConflict,
  SessionRestoreFileResult,
  SessionRestoreOptions,
  SessionRestoreResult,
} from "./lib/session-apply.js";
// Lib — transforms
export { applyTransform, buildCodexAgentsMd, buildCursorMdc, buildOpenCodeAgentsMd, stripClaudeOnlySections, transformSkillContent } from "./lib/transforms.js";
export type { TransformContext } from "./lib/transforms.js";

// Lib — machine
export { detectMachineContext, normalizeOsFamily, machineContextToVariables, resolveProfileVariables, templateizeMachineContent, renderMachineAwareContent, renderMachineAwareContentPreview } from "./lib/machine.js";
export type { MachineContextOverrides } from "./lib/machine.js";

// Lib — platform profile presets
export { PLATFORM_PROFILE_PRESETS, ensurePlatformProfiles } from "./lib/platform-profiles.js";
export {
  PROJECT_DASHBOARD_PROFILE_VARIABLES,
  PROJECT_DASHBOARD_STANDARD_CONTENT,
  PROJECT_DASHBOARD_STANDARD_SLUG,
  ensureProjectDashboardStandardConfig,
} from "./lib/project-dashboard-standard.js";
export {
  AGENT_OPERATING_RULES_SEMANTIC_POLICY_KEY,
  AGENT_OPERATING_RULES_SENTINEL_PATTERN,
  GLOBAL_AGENT_RULES_STANDARD_CONTENT,
  GLOBAL_AGENT_RULES_STANDARD_SLUG,
  compareAgentOperatingRulesVersions,
  ensureGlobalAgentRulesStandardConfig,
  parseAgentOperatingRulesVersion,
  resolveAgentOperatingRulesPayload,
  type AgentOperatingRulesPayload,
  type AgentOperatingRulesPayloadIntegrity,
  type AgentOperatingRulesPayloadOrigin,
} from "./lib/global-agent-rules-standard.js";
export {
  DANGEROUS_OPERATION_GUARD_STANDARD_CONTENT,
  DANGEROUS_OPERATION_GUARD_STANDARD_SLUG,
  ensureDangerousOperationGuardStandardConfig,
} from "./lib/dangerous-operation-guard-standard.js";
export {
  CODEWITH_SHARED_TODOS_STORAGE_POLICY_REFERENCE,
  CODEWITH_SHARED_TODOS_STORAGE_STANDARD_CONTENT,
  CODEWITH_SHARED_TODOS_STORAGE_STANDARD_SLUG,
  ensureCodewithSharedTodosStorageStandardConfig,
} from "./lib/codewith-shared-todos-storage-standard.js";

// Lib — sync
export { syncKnown, syncToDisk, syncProject, diffConfig, detectCategory, detectAgent, detectFormat, KNOWN_CONFIGS, PROJECT_CONFIG_FILES } from "./lib/sync.js";
export { syncFromDir, syncToDir } from "./lib/sync-dir.js";
export type { SyncKnownOptions, SyncToDiskOptions, SyncProjectOptions, KnownConfig } from "./lib/sync.js";
export type { SyncFromDirOptions } from "./lib/sync-dir.js";

// Lib — export/import
export { exportConfigs } from "./lib/export.js";
export { importConfigs } from "./lib/import.js";
export type { ExportOptions } from "./lib/export.js";
export type { ImportOptions, ImportResult } from "./lib/import.js";

// Lib — template
export { parseTemplateVars, extractTemplateVars, renderTemplate, renderTemplatePreview, isTemplate } from "./lib/template.js";
export type { TemplateVar } from "./lib/template.js";

// Lib — redact
export { redactContent, scanSecrets, hasSecrets } from "./lib/redact.js";
export type { RedactResult, RedactedVar, RedactFormat } from "./lib/redact.js";

// Lib — package-manager guard
export { scanPackageManagerSecrets } from "./lib/package-manager-guard.js";
export type {
  PackageManagerFinding,
  PackageManagerScanOptions,
  PackageManagerScanResult,
  PackageManagerSeverity,
  PackageManagerSurface,
} from "./lib/package-manager-guard.js";
