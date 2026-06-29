export type {
  McpServerEntry,
  AddServerOptions,
  McpTool,
  RegistryServer,
  ConnectedServer,
  FinderResult,
  MachineEntry,
  AddMachineOptions,
  MachinePlatform,
  MachineArch,
  MachineInstaller,
  HasnaMcpCatalogEntry,
  MachinePackageHealth,
  FleetHealthReport,
  FleetInstallPackageResult,
  FleetInstallReport,
  ProviderAuthMetadata,
  ProviderEndpointFallback,
  ProviderInstallFallback,
  ProviderProfile,
  ProviderProfileAuthType,
  ProviderProfileBearerTokenMode,
  ProviderProfileSource,
  ProviderProfileTokenMode,
  ProviderProfileTransport,
  ProviderSafetyMetadata,
  ProviderSourceProvenance,
  InstallProviderProfileOptions,
  UpsertProviderProfileOptions,
  CredentialReference,
  CredentialReferenceMap,
  CredentialReferenceSource,
} from "./types.js";

export {
  addServer,
  removeServer,
  listServers,
  getServer,
  updateServer,
  enableServer,
  disableServer,
  getToolCounts,
  getCachedTools,
  setServerEnv,
  setServerCredentialRef,
  unsetServerEnv,
  unsetServerCredentialRef,
  cloneServer,
} from "./lib/registry.js";

export { diagnoseServer } from "./lib/doctor.js";
export type { DoctorReport, DoctorCheck } from "./lib/doctor.js";

export { searchRegistry, getRegistryServer, installFromRegistry } from "./lib/remote.js";
export { findServers, listAwesomeServers } from "./lib/finder.js";
export type { FindOptions } from "./lib/finder.js";

export {
  listSources,
  getSource,
  addSource,
  removeSource,
  enableSource,
  disableSource,
} from "./lib/sources.js";
export {
  upsertProviderProfile,
  listProviderProfiles,
  searchProviderProfiles,
  getProviderProfile,
  installProviderProfile,
  removeProviderProfile,
  enableProviderProfile,
  disableProviderProfile,
  seedDefaultProviderProfiles,
} from "./lib/provider-profiles.js";
export { DEFAULT_PROVIDER_PROFILE_SEEDS } from "./lib/provider-profile-seeds.js";
export { installToAgents } from "./lib/install.js";
export type { AgentTarget, InstallResult } from "./lib/install.js";
export type { McpSource, AddSourceOptions } from "./types.js";
export {
  addMachine,
  upsertMachine,
  listMachines,
  getMachine,
  updateMachine,
  removeMachine,
  seedDefaultMachines,
  DEFAULT_MACHINE_SEEDS,
} from "./lib/machines.js";
export { listHasnaMcpCatalog, runFleetHealthCheck, runFleetInstall } from "./lib/fleet.js";
export { readPackageVersion } from "./lib/version.js";
export { buildMcpsStatus, getMcpsStatus } from "./lib/status.js";
export type { McpsStatusContract } from "./lib/status.js";
export {
  assertLocalCommandConsent,
  formatLocalCommandReview,
  inspectLocalCommand,
  LocalCommandConsentError,
} from "./lib/local-command-consent.js";
export {
  CredentialReferenceError,
  REDACTED_CREDENTIAL_VALUE,
  credentialRefPlaceholders,
  isSecretLikeEnvKey,
  isSecretLikeValue,
  normalizeCredentialRefs,
  normalizeCredentialRef,
  normalizeLiteralEnv,
  redactEnv,
  redactServerCredentials,
  resolveServerEnv,
} from "./lib/credentials.js";
export type {
  LocalCommandConsent,
  LocalCommandInput,
  LocalCommandOperation,
  LocalCommandReview,
  LocalCommandRisk,
} from "./lib/local-command-consent.js";

export {
  connectToServer,
  disconnectServer,
  listAllTools,
  callTool,
  refreshTools,
  disconnectAll,
} from "./lib/proxy.js";

export { getDb, closeDb } from "./lib/db.js";
export {
  STORAGE_SYNC_TABLES,
  PostgresStorageClient,
  getRemoteDatabaseUrl,
  getRemotePostgresClient,
  getStorageSyncMetaAll,
  getStorageSyncStatus,
  resolveStorageSyncTables,
  runStorageMigrations,
  shouldUsePostgresSsl,
  storagePull,
  storagePush,
  storageSync,
} from "./lib/storage-sync.js";
export type {
  StorageSyncMeta,
  StorageSyncResult,
  StorageSyncStatus,
  StorageSyncTable,
} from "./lib/storage-sync.js";
