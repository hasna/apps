// DB layer
export { getDb, getDbPath, DB_PATH } from "./db/database.js";

// DB — canonical PostgreSQL data-plane schema (applied server-side only, via
// the cloud MigrationLedger). No client-side DSN, sync engine, or migrate path.
export { PG_MIGRATIONS } from "./db/pg-migrations.js";
export { getCurrentMachine, listMachines, getMachine, upsertMachine } from "./db/machines.js";
export { createSource, getSource, listSources, updateSource, deleteSource, markSourceIndexed } from "./db/sources.js";
export { buildS3ObjectIdentity, buildS3ObjectResolverContract, findS3ObjectRecordForStorage, getS3ObjectRecord, listS3ObjectRecords, upsertS3ObjectRecord } from "./db/s3-objects.js";
export { getGoogleDriveSyncState, upsertGoogleDriveSyncState, markGoogleDriveSynced, markGoogleDriveSyncError, getGoogleDriveImportedObject, getGoogleDriveImportedObjectByFileRecordId, listGoogleDriveImportedObjects, upsertGoogleDriveImportedObject, markMissingGoogleDriveObjectsDeleted, listDeletedGoogleDriveImportedObjects } from "./db/google-drive.js";
export { upsertFile, getFile, listFiles, searchFiles as searchFilesDb, markFileDeleted, markFileDeletedById, deleteFile, getFileByPath, refreshAllFts, annotateFile, getMaxSyncVersion, getFilesSince } from "./db/files.js";
export { deleteFileSearchDocument, deleteFileSearchDocumentsForFile, getFileSearchDocument, getFileSearchIndexStats, listFileSearchDocuments, refreshAllFileSearchDocumentFts, refreshFileSearchDocumentFts, upsertFileSearchDocument } from "./db/file-search-documents.js";
export { backfillFileVersions, createFileVersion, getFileVersion, getFileVersionBySourceRef, getLatestFileVersion, listFileVersions, upsertCurrentFileVersion } from "./db/file-versions.js";
export { acknowledgeKnowledgeSourceOutbox, appendKnowledgeSourceOutboxEvent, getKnowledgeSourceOutboxCheckpoint, getKnowledgeSourceOutboxEvent, getKnowledgeSourceOutboxWatermark, listKnowledgeSourceOutboxEvents, pollKnowledgeSourceOutbox } from "./db/knowledge-outbox.js";
export { createFileAsset, getFileAsset, listFileAssets, createFileUploadIntent, getFileUploadIntent, markFileUploadIntentCompleted, updateFileAssetStatus, createFileLink, listFileLinks, createFileAccessEvent, listFileAccessEvents } from "./db/evidence.js";
export { listTags, getOrCreateTag, deleteTag, tagFile, untagFile, getFileTags } from "./db/tags.js";
export { createCollection, updateCollection, listCollections, getCollection, deleteCollection, addToCollection, removeFromCollection, autoPopulateCollection } from "./db/collections.js";
export { createProject, updateProject, listProjects, getProject, deleteProject, addToProject, removeFromProject } from "./db/projects.js";
export { bootstrapGoogleDriveOrganizationQueues, exportFileOrganizationAudit, formatFileOrganizationAuditExport, getFileOrganizationStats, getFileOrganizationReview, listFileOrganizationEvents, listFileOrganizationReviews, updateFileOrganizationReview } from "./db/organization.js";
export { searchFiles } from "./db/search.js";
export { registerAgent, getAgent, listAgents, updateAgentHeartbeat, setAgentFocus } from "./db/agents.js";
export { logActivity, getFileHistory, getAgentActivity, getSessionActivity } from "./db/activity.js";

// Lib
export { indexLocalSource } from "./lib/indexer.js";
export { listGoogleDriveProfiles, listGoogleDriveProfileStatuses, listGoogleDriveSharedDrives, listGoogleDriveItems, preflightGoogleDriveSource, syncGoogleDriveSource } from "./lib/google-drive.js";
export { createConnectorProfileGoogleDriveClient } from "./lib/google-drive-client.js";
export { indexS3Source, downloadFromS3, uploadToS3, uploadBufferToS3, deleteFromS3, headS3Object, createS3ClientConfig, describeS3ClientConfig } from "./lib/s3.js";
export type { S3ClientConfigDiagnostics, S3CredentialSource } from "./lib/s3.js";
export { createEvidenceUploadIntent, uploadEvidenceFile, completeEvidenceUpload, linkEvidenceAsset, signEvidenceDownload, verifyEvidenceAsset, buildEvidenceObjectKey, buildEvidenceManifestKey, isLegacyEvidenceKey, getEvidenceStorageOptions } from "./lib/evidence.js";
export { downloadResolvedFileObject, resolveFileObject, resolvedFileObjectSummary } from "./lib/file-object.js";
export { extractTextFromBuffer, extractTextFromFile, isExtractableTextMime } from "./lib/extraction.js";
export { buildExtractionSnapshot, extractTextSnapshotFromBuffer, extractTextSnapshotFromFile } from "./lib/extraction-snapshot.js";
export { resolveKnowledgeSourceRef } from "./lib/knowledge-resolver.js";
export { doctorKnowledgeSources } from "./lib/knowledge-doctor.js";
export { exportKnowledgeSourceManifest, formatKnowledgeSourceManifest, writeKnowledgeSourceManifestArtifact } from "./lib/knowledge-manifest.js";
export { buildFilesContextPack, buildFilesSearchPack } from "./lib/context-pack.js";
export { buildKnowledgeSyncFixtureManifest, buildKnowledgeSyncFixtureOutboxEvents, buildKnowledgeSyncFixturePack, formatKnowledgeSyncFixtureJsonl, KNOWLEDGE_SYNC_FIXTURE_CASES } from "./lib/knowledge-sync-fixtures.js";
export { watchSource, unwatchSource, stopAllWatchers } from "./lib/watcher.js";
export { hashFile, hashBuffer, sha256File, sha256Buffer } from "./lib/hasher.js";
export { syncWithPeer, syncWithPeers } from "./lib/sync.js";
export { normalizeFileName, generateCanonicalName } from "./lib/normalize.js";
export { buildOpenFilesFileRef, buildOpenFilesFileRevisionRef, buildOpenFilesSourcePathRef, buildOpenFilesFleetManifestRef, describeOpenFilesSourceRef, parseOpenFilesSourceRef, isOpenFilesSourceRef } from "./lib/source-ref.js";
export type { OpenFilesAssetRef, OpenFilesFileRef, OpenFilesSourcePathRef, OpenFilesSourceRef, OpenFilesSourceRefDescriptor } from "./lib/source-ref.js";
export type { KnowledgeSyncFixtureCase, KnowledgeSyncFixtureCaseSummary, KnowledgeSyncFixtureManifest, KnowledgeSyncFixtureManifestItem, KnowledgeSyncFixtureOutboxEvent, KnowledgeSyncFixturePack } from "./lib/knowledge-sync-fixtures.js";

// Types
export type {
  Machine, Source, FileRecord, FileVersion, FileVersionState, FileVersionStorageProvider,
  FileSearchDocument, FileSearchDocumentKind, FileSearchDocumentStatus,
  FileSearchIndexStats, ListFileSearchDocumentsOptions, UpsertFileSearchDocumentInput,
  S3ObjectRecord, S3ObjectResolverContract, ExtractedTextResult,
  ExtractedTextSegment, ExtractedTextStatus, ExtractionSnapshot,
  ExtractionSnapshotPage, ExtractionSnapshotSection,
  KnowledgeSourceResolveMode, KnowledgeSourceResolution, KnowledgeSourceResolverOptions,
  KnowledgeSourceResolverStorage, KnowledgeSourceResolveStatus,
  KnowledgeSourceDoctorAclSummary, KnowledgeSourceDoctorCheck, KnowledgeSourceDoctorIssueCode,
  KnowledgeSourceDoctorOptions, KnowledgeSourceDoctorRecommendation, KnowledgeSourceDoctorReport,
  KnowledgeSourceDoctorStatus,
  KnowledgeSourceManifest, KnowledgeSourceManifestArtifact, KnowledgeSourceManifestEvidenceAssetItem,
  KnowledgeSourceManifestExtractionStatus, KnowledgeSourceManifestFileItem, KnowledgeSourceManifestFormat, KnowledgeSourceManifestItem,
  KnowledgeSourceManifestMachineEvidence, KnowledgeSourceManifestOpenFilesRootEvidence,
  KnowledgeSourceManifestOptions, KnowledgeSourceManifestOutput,
  FilesContextPack, FilesContextPackAttachmentRef, FilesContextPackCitation,
  FilesContextPackError, FilesContextPackExcerpt, FilesContextPackFile,
  FilesContextPackOptions, FilesSearchPackOptions,
  AppendKnowledgeSourceOutboxEventInput, KnowledgeSourceOutboxCheckpoint,
  KnowledgeSourceOutboxEvent, KnowledgeSourceOutboxEventType, KnowledgeSourceOutboxPollResult,
  KnowledgeSourceOutboxWatermark, ListKnowledgeSourceOutboxEventsOptions,
  FileWithTags, Tag, Collection, Project,
  SearchMatchSource, SearchScope, SearchResult, ListFilesOptions, IndexStats, SourceType, FileStatus, S3Config,
  Agent, AgentActivity, ActionType, AutoRules, ProjectStatus, GoogleDriveConfig,
  GoogleDriveSharedDrive, GoogleDriveItem, GoogleDriveSyncState, GoogleDriveImportedObject,
  FileAsset, FileAssetStatus, FileScanStatus, FileStorageProvider, FileUploadIntent,
  FileLink, FileAccessEvent, FileAccessAction, CreateFileAssetInput,
  CreateFileLinkInput, CreateFileAccessEventInput, FileOrganizationEvent,
  FileOrganizationAuditExport, FileOrganizationAuditExportEvent, FileOrganizationAuditExportFormat,
  FileOrganizationAuditExportRow, FileOrganizationReview, FileOrganizationReviewStatus,
  FileOrganizationReviewWithFile, FileOrganizationRootType,
  FileOrganizationAclReviewStatus, FileOrganizationPermissionRisk, FileOrganizationPermissionScope,
  FileOrganizationStats, GoogleDriveOrganizationBootstrapResult,
} from "./types/index.js";
