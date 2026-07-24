/** Public Stage-A storage surface: only local role-guarded operations. */
export type {
  MaybePromise,
  ActiveWorkItem,
  TodosActiveWorkFilter,
  TodosAgentUpdateInput,
  TodosAgentStore,
  TodosAuditStore,
  TodosCommentListOptions,
  TodosPlanStore,
  TodosProjectStore,
  TodosStorageAdapter,
  TodosStorageCapabilities,
  TodosStorageContext,
  TodosStorageImportResult,
  TodosStorageKind,
  TodosStorageSnapshot,
  TodosSyncStore,
  TodosTaskClaimFilter,
  TodosTaskCompletionOptions,
  TodosTaskFailureOptions,
  TodosTaskFailureResult,
  TodosTaskListStore,
  TodosTaskStore,
  TodosTemplateStore,
  UpdateTemplateInput,
} from "./storage/interfaces.js";
export {
  CANONICAL_TODOS_RDS_CLUSTER,
  CANONICAL_TODOS_RDS_DATABASE,
  CANONICAL_TODOS_RDS_RUNTIME_PATH,
  STORAGE_TABLES,
  TODOS_STORAGE_ENV,
  TODOS_STORAGE_FALLBACK_ENV,
  TODOS_STORAGE_TABLES,
  TodosHostedStorageUnavailableError,
  assertTodosLocalStorageRole,
  assertTodosRemoteStorageConfig,
  assertTodosShadowConfig,
  getCanonicalTodosRdsConfig,
  getStorageDatabaseEnv,
  getStorageDatabaseUrl,
  getStorageMode,
  getTodosStorageDatabaseEnv,
  getTodosStorageDatabaseUrl,
  getTodosStorageEnvName,
  getTodosStorageMode,
  getTodosStorageShadowEnvName,
  isTodosRemoteStorageEnabled,
  isTodosShadowEnabled,
  loadStorageConfig,
  loadTodosStorageConfig,
  normalizeTodosStorageMode,
  parseStorageMode,
  resolveTodosStorageRole,
} from "./storage/config.js";
export {
  COMMENT_REDACTION_BACKFILL_CONFIRMATION,
  isCommentRedactionBackfillComplete,
} from "./storage/comment-redaction-contract.js";
export {
  DEFAULT_TODOS_POSTGRES_CURSOR_TABLE,
  DEFAULT_TODOS_POSTGRES_SYNC_TABLE,
  PostgresScopedSlugIndexBuildError,
  PostgresScopedSlugMigrationConflictError,
  postgresTodosCommentCursorIndexSql,
  postgresTodosScopedSlugIndexStatusSql,
  postgresTodosScopedSlugPreflightSql,
  postgresTodosScopedSlugUniqueIndexSql,
  postgresTodosSyncSchemaSql,
} from "./storage/postgres-contracts.js";
export {
  buildS3ObjectKey,
  buildS3ObjectUrl,
  signAwsV4Request,
} from "./storage/stage-a-public-helpers.js";
export { createLocalSqliteTodosStorageAdapter } from "./storage/local-sqlite-public.js";
export { createTodosStorageAdapter } from "./storage/factory.js";
export {
  TodosShadowMirror,
  TodosShadowOutbox,
  backfillPostgresCommentRedaction,
  closeRuntimeShadowCloud,
  createHybridTodosStorageAdapter,
  createPostgresTodosStorageAdapter,
  createPostgresTodosSyncStore,
  createShadowTodosStorageAdapter,
  createTodosCloudQueryClient,
  createTodosCloudQueryClientFromEnv,
  createTodosS3ArtifactStore,
  createTodosShadowOutbox,
  downloadRunArtifactsFromS3,
  ensurePostgresScopedSlugUniqueIndexes,
  getRuntimeShadowOutbox,
  installShadowOutboxSchema,
  maybeInstallShadowCapture,
  planRunArtifactsS3Sync,
  registerShadowExitFlush,
  startRuntimeShadowDrain,
  uploadRunArtifactsToS3,
} from "./storage/stage-a-public-stubs.js";
export {
  exportSqliteTodosStorageSnapshot,
  importSqliteTodosStorageSnapshot,
} from "./storage/sqlite-snapshot.js";
export type { CreateLocalSqliteTodosStorageAdapterOptions } from "./storage/local-sqlite-public.js";
export type { CreateTodosStorageAdapterOptions } from "./storage/factory.js";
export type {
  CanonicalTodosRdsConfig,
  TodosPostgresStorageConfig,
  TodosS3StorageConfig,
  TodosStorageConfig,
  TodosStorageEnv,
  TodosStorageMode,
  TodosStorageTable,
  TodosSyncConfig,
} from "./storage/config.js";
export type {
  CreateShadowTodosStorageAdapterOptions,
  ShadowTodosStorageAdapter,
  TodosShadowMirrorEvent,
  TodosShadowMirrorMetrics,
} from "./storage/shadow.js";
export type {
  CreateTodosShadowOutboxOptions,
  TodosShadowOutboxEvent,
  TodosShadowOutboxStats,
} from "./storage/shadow-outbox.js";
export type {
  CreateTodosCloudQueryClientOptions,
  TodosCloudQueryClient,
} from "./storage/cloud-client.js";
export type {
  CommentRedactionBackfillOptions,
  CommentRedactionBackfillResult,
} from "./storage/comment-redaction-contract.js";
export type {
  CreateHybridTodosStorageAdapterOptions,
  HybridTodosRemoteSync,
  HybridTodosStorageAdapter,
  HybridTodosStorageSyncResult,
} from "./storage/hybrid.js";
export type { CreatePostgresTodosStorageAdapterOptions } from "./storage/postgres-adapter.js";
export type {
  CreatePostgresTodosSyncStoreOptions,
  PostgresTodosSyncPushResult,
  PullPostgresTodosSnapshotOptions,
  TodosPostgresQueryClient,
  TodosPostgresQueryResult,
  TodosPostgresSyncRecordRow,
  TodosPostgresSyncRecordType,
} from "./storage/postgres-sync.js";
export type {
  PostgresScopedSlugConflict,
  PostgresScopedSlugIndexStatus,
} from "./storage/postgres-contracts.js";
export type {
  PutTodosS3ObjectInput,
  SignAwsV4RequestInput,
  SignedAwsV4Request,
  TodosAwsCredentials,
  TodosS3ArtifactStore,
  TodosS3ArtifactStoreOptions,
  TodosS3ObjectRef,
} from "./storage/s3-artifacts.js";
export type {
  DownloadRunArtifactsFromS3Options,
  PlanRunArtifactsS3SyncOptions,
  TodosRunArtifactRemoteRef,
  TodosRunArtifactSyncFilter,
  TodosRunArtifactSyncPlan,
  TodosRunArtifactSyncResult,
  UploadRunArtifactsToS3Options,
} from "./storage/s3-artifact-sync.js";
