export * from "./types/index.js";
export { getDb, getDbPath, migrateDb, closeDb, openNonMigratingDb } from "./db/database.js";
export type { DatabaseOpenOptions, NonMigratingDatabaseContext } from "./db/database.js";
export { applyPostgresMigrations } from "./db/pg-migrations.js";
export type { PostgresMigrationClient } from "./db/pg-migrations.js";
export { sanitizeRemoteIdentity, sanitizeRemoteOutput } from "./lib/remote-identity.js";
export {
  BranchAdjudicationError,
  adjudicateBranches,
} from "./db/branch-adjudication.js";
export type {
  BranchAdjudicationErrorCode,
  BranchAdjudicationPlannedRow,
  BranchAdjudicationReceipt,
  BranchAdjudicationRequest,
  BranchAdjudicationResult,
  BranchAdjudicationRowSpec,
} from "./db/branch-adjudication.js";
export {
  PrimaryRelocationError,
  relocatePrimaryRepo,
  sanitizeGitRemoteUrl,
} from "./db/primary-relocation.js";
export type {
  CollisionDecision,
  PrimaryRelocationErrorCode,
  PrimaryRelocationReceipt,
  PrimaryRelocationRequest,
  PrimaryRelocationResult,
  SafeErrorDetails,
  TableReconcileCounts,
} from "./db/primary-relocation.js";
export {
  cleanupRemoteIdentities,
  ensureWorkspaceBootstrap,
  startAutoIndexWorker,
  syncRepoCatalog,
} from "./lib/auto-index.js";
export type {
  RemoteIdentityCleanupCounts,
  RemoteIdentityCleanupOptions,
  RemoteIdentityCleanupSummary,
} from "./lib/auto-index.js";
export {
  WORKTREE_ADOPT_SCHEMA,
  WORKTREE_LEASE_SCHEMA,
  WORKTREE_LIST_SCHEMA,
  WorktreeError,
  addWorktree,
  adoptWorktrees,
  assertWorktreeName,
  computeWorktreePath,
  listWorktrees,
  parseWorktreeRef,
  redactGitDiagnostics,
  releaseWorktree,
  removeWorktree,
  worktreeRootDir,
} from "./lib/worktrees.js";
export type {
  AddWorktreeRequest,
  AddWorktreeResult,
  AdoptWorktreeRequest,
  AdoptWorktreeResult,
  AdoptedWorktree,
  ReleaseWorktreeRequest,
  ReleaseWorktreeResult,
  RemoveWorktreeRequest,
  RemoveWorktreeResult,
  WorktreeErrorCode,
  WorktreeErrorDetails,
  WorktreeIssue,
  WorktreeLease,
  WorktreeListEntry,
  WorktreeListOptions,
  WorktreeListResult,
} from "./lib/worktrees.js";
export {
  REPO_ARCHIVE_SCHEMA,
  REPO_CLONE_SCHEMA,
  REPO_CREATE_SCHEMA,
  RepoLifecycleError,
  archiveRepository,
  cloneRepository,
  createRepository,
  isRepoSpec,
  parseRepoSpec,
  redactRepoLifecycleText,
} from "./lib/repo-lifecycle.js";
export type {
  ArchiveRepositoryRequest,
  ArchiveRepositoryResult,
  CloneRepositoryRequest,
  CloneRepositoryResult,
  CreateRepositoryRequest,
  CreateRepositoryResult,
  CredentialSource,
  RepoLifecycleErrorCode,
  RepoLifecycleErrorDetails,
  RepoSpec,
  RepoVisibility,
} from "./lib/repo-lifecycle.js";
export { resolveTrustedAccountHome } from "./lib/account-home.js";
export { getSourceMachineId } from "./lib/machine-id.js";
export { drainHookQueue, installPostCommitHook, installPostCommitHooks } from "./lib/repo-hooks.js";
export { discoverRepos, scanRepoPaths, scanRepos, watchRepos } from "./lib/scanner.js";
export {
  syncGithubPRs,
  syncAllGithubPRs,
  syncRemotePullRequests,
  fetchRepoMetadata,
  parseGithubRemote,
  type GithubPullRequestClient,
  type SyncPullRequestsResult,
} from "./lib/github.js";
export {
  applyGithubCatalogFilter,
  enumerateGithubRepoCatalog,
  extractGithubFullNameFromRemote,
  getDefaultGithubCatalogCachePath,
  iterateGithubRepoCatalog,
  loadGithubRepoCatalog,
  syncGithubRepoCatalog,
} from "./lib/github-catalog.js";
export type {
  EnumerateGithubRepoCatalogOptions,
  GithubCatalogAccount,
  GithubLocalStatus,
  GithubPackageHints,
  GithubRateLimitSnapshot,
  GithubRepoCatalogCache,
  GithubRepoCatalogEnvelope,
  GithubRepoCatalogFilter,
  GithubRepoCatalogRecord,
  SyncGithubRepoCatalogOptions,
} from "./lib/github-catalog.js";
export { getReposStatus } from "./lib/status.js";
export type { ReposStatusContract } from "./lib/status.js";
export {
  getDocsDrift,
  getManifestDependents,
  getPackageDrift,
  getPackageHealth,
  getReleaseHealth,
  getReleasePipelineParity,
  resolvePackageBin,
  scanPorts,
  triageBranches,
  triagePullRequests,
  withTodos,
} from "./lib/repo-ops.js";
export type { CommandResult, OpsCommandRunner, OpsIssue, OpsReport, TodosIntegrationOptions, TodosIntegrationResult } from "./lib/repo-ops.js";
export {
  listRepos,
  listAllRepos,
  getRepo,
  searchRepos,
  listCommits,
  searchCommits,
  listBranches,
  listTags,
  listPullRequests,
  listPullRequestsWithRepo,
  countPullRequests,
  countRepos,
  getRepoByRemote,
  listReposByRemote,
  searchAll,
  getRepoStats,
  getGlobalStats,
  AmbiguousRepoNameError,
  AmbiguousRemoteError,
  type ListPullRequestOptions,
  type PullRequestInput,
} from "./db/repos.js";
export {
  buildDependencyRefresh,
  buildDocsRulesDrift,
  buildPrQueue,
  buildProtectedRelease,
  buildReleaseCandidates,
  buildReleasePipelineParity,
  buildTaskRouteHealth,
  buildWorkspaceWorktreeHygiene,
  inspectPackageHygiene,
  runGlobalCliSmoke,
} from "./lib/ops-producers.js";
export {
  upsertTaskSeeds,
  writeLoopReport,
} from "./lib/ops-loop-tasks.js";
export type {
  CliSmokeOptions,
  CliSmokeResult,
  DependencyRefreshOptions,
  DependencyRefreshResult,
  DocsRulesDriftOptions,
  DocsRulesDriftResult,
  PackageHygieneOptions,
  PackageHygieneResult,
  PrQueueOptions,
  ProtectedReleaseOptions,
  ProtectedReleaseResult,
  RepoPrQueueResult,
  ReleaseCandidateOptions,
  ReleaseCandidateResult,
  ReleasePipelineParityItem,
  ReleasePipelineParityQueueOptions,
  ReleasePipelineParityQueueResult,
  TaskRouteHealthOptions,
  TaskRouteHealthResult,
  TaskSeed,
  WorkspaceWorktreeHygieneOptions,
  WorkspaceWorktreeHygieneResult,
} from "./lib/ops-producers.js";
export type {
  TodosCommandResult,
  TodosRunner,
  UpsertTaskSeedsOptions,
  UpsertTaskSeedsResult,
} from "./lib/ops-loop-tasks.js";
export {
  DEFAULT_MONITOR_LIMIT,
  PR_MONITOR_SCHEMA,
  runPrMonitor,
} from "./lib/pr-monitor-run.js";
export type {
  PrMonitorEnvelope,
  PrMonitorFilters,
  PrMonitorSyncedSection,
  RunPrMonitorOptions,
} from "./lib/pr-monitor-run.js";
export {
  DEFAULT_PRUNE_OLDER_THAN_DAYS,
  advanceCommentCursor,
  computeEventFingerprint,
  listWatchState,
  markEventEmitted,
  normalizePrKey,
  pruneWatchState,
  readCommentCursor,
  readLastEmittedFingerprint,
  readWatchState,
  readWatchStateByPr,
  upsertWatchState,
  watchStateKey,
} from "./lib/pr-monitor-state.js";
export type {
  CommentCursor,
  PrMonitorWatchRow,
  PruneResult,
  PruneWatchStateOptions,
  WatchStateObservation,
} from "./lib/pr-monitor-state.js";
export {
  parseVerdictLine,
  parseVerdictsFromBody,
  resolveVerdictAtHead,
} from "./lib/verdict-parser.js";
export type {
  ParsedVerdict,
  VerdictValue,
} from "./lib/verdict-parser.js";
export {
  classifyPullRequest,
  leaseMatchesPr,
  probeMergeTree,
} from "./lib/pr-monitor-classify.js";
export type {
  ClassifyPrInput,
  MergeTreeProbe,
  MonitorCommentMeta,
  MonitorLeaseInput,
  PrClassification,
  PrClassificationEvent,
  PrMonitorClass,
  PrMonitorSubject,
} from "./lib/pr-monitor-classify.js";
export {
  emitMonitorDelta,
} from "./lib/pr-monitor-emit.js";
export type {
  DeltaEmissionResult,
  EmitDeltaOptions,
  EmitPrInput,
  EmittedEvent,
  MonitorStateEntry,
} from "./lib/pr-monitor-emit.js";
