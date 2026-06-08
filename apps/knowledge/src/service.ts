import { createArtifactStore } from './artifact-store';
import {
  clearKnowledgeAuth,
  knowledgeAuthStatus,
  normalizeKnowledgeApiOrigin,
  saveKnowledgeAuth,
  type KnowledgeAuthStatus,
} from './auth';
import { runKnowledgePrompt, type KnowledgePromptOptions } from './agent';
import {
  embeddingIndexStatus,
  indexKnowledgeEmbeddings,
  searchVectorIndex,
  type EmbeddingIndexOptions,
  type EmbeddingSearchOptions,
} from './embeddings';
import { consumeOpenFilesOutbox } from './outbox-consume';
import { getKnowledgeDbStats, migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import { ingestOpenFilesManifest } from './manifest-ingest';
import { ingestSourceRef } from './source-ingest';
import { resolveOpenFilesSource } from './source-resolver';
import { providerStatus, listModelRegistry, type ProviderStatusResult, type ModelRegistryEntry } from './providers';
import { enqueueMissingEmbeddings, refreshEmbeddingIndex, reindexHealth, type ReindexRuntimeOptions } from './reindex';
import { knowledgeRegistryContract, RemoteKnowledgeClient, type RemoteKnowledgeRegistryContract } from './remote-client';
import { retrieveKnowledgeContext, type RetrievalOptions } from './retrieval';
import { hybridSearch, type HybridSearchOptions } from './search';
import { resolveSafetyPolicy } from './safety';
import { runProviderWebSearch, type WebSearchOptions } from './web-search';
import { compileWikiPage, fileAnswerToWiki, lintWiki, type WikiCompileOptions } from './wiki-compiler';
import {
  recordStorageObjects,
  resolveStorageContract,
  validateStorageConfig,
  type StorageContract,
  type StorageValidationResult,
} from './storage-contract';
import { initializeWikiLayout, recordWikiLayoutCatalog } from './wiki-layout';
import {
  ensureKnowledgeWorkspace,
  readKnowledgeConfig,
  resolveScopedWorkspace,
  writeKnowledgeConfig,
  type KnowledgeConfig,
  type KnowledgeWorkspace,
} from './workspace';

export interface KnowledgeServiceOptions {
  scope?: string;
  cwd?: string;
}

export interface KnowledgePathsResult {
  ok: true;
  scope: string;
  home: string;
  config_path: string;
  json_store_path: string;
  knowledge_db_path: string;
  artifacts_dir: string;
  indexes_dir: string;
  logs_dir: string;
  runs_dir: string;
  schemas_dir: string;
  wiki_dir: string;
  config: KnowledgeConfig;
  message: string;
}

export interface KnowledgeSetupResult {
  ok: true;
  mode: KnowledgeConfig['mode'];
  api_url: string | null;
  config_path: string;
  next: string[];
  message: string;
}

function normalizeMode(value: string | undefined): KnowledgeConfig['mode'] | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'local' || normalized === 'offline') return 'local';
  if (normalized === 'hosted' || normalized === 'remote' || normalized === 'knowledge.hasna.xyz') return 'hosted';
  throw new Error('Invalid setup mode. Use hosted or local.');
}

export class KnowledgeService {
  private ensuredWorkspace?: KnowledgeWorkspace;
  private cachedConfig?: KnowledgeConfig;

  constructor(private readonly options: KnowledgeServiceOptions = {}) {}

  get scope(): string {
    return this.options.scope ?? 'global';
  }

  get workspace(): KnowledgeWorkspace {
    return this.ensuredWorkspace ?? resolveScopedWorkspace(this.options.scope, this.options.cwd);
  }

  ensureWorkspace(): KnowledgeWorkspace {
    if (!this.ensuredWorkspace) this.ensuredWorkspace = ensureKnowledgeWorkspace(this.workspace.home);
    return this.ensuredWorkspace;
  }

  jsonStorePath(): string {
    return this.ensureWorkspace().jsonStorePath;
  }

  config(): KnowledgeConfig {
    if (!this.cachedConfig) {
      const workspace = this.ensureWorkspace();
      this.cachedConfig = readKnowledgeConfig(workspace.configPath);
    }
    return this.cachedConfig;
  }

  safetyPolicy() {
    return resolveSafetyPolicy(this.config(), this.ensureWorkspace());
  }

  artifactStore() {
    return createArtifactStore(this.config(), this.ensureWorkspace());
  }

  storageContract(): StorageContract {
    return resolveStorageContract(this.config(), this.ensureWorkspace(), this.scope);
  }

  validateStorage(): StorageValidationResult {
    return validateStorageConfig(this.config(), this.ensureWorkspace());
  }

  setup(options: { mode?: string; apiUrl?: string } = {}): KnowledgeSetupResult {
    const workspace = this.ensureWorkspace();
    const current = this.config();
    const mode = normalizeMode(options.mode) ?? current.mode;
    const apiUrl = options.apiUrl
      ? normalizeKnowledgeApiOrigin(options.apiUrl)
      : current.hosted?.api_url
        ? normalizeKnowledgeApiOrigin(current.hosted.api_url)
        : null;
    const nextConfig: KnowledgeConfig = {
      ...current,
      mode,
      hosted: {
        ...(current.hosted ?? {}),
        ...(apiUrl ? { api_url: apiUrl } : {}),
      },
    };
    writeKnowledgeConfig(workspace.configPath, nextConfig);
    this.cachedConfig = nextConfig;
    return {
      ok: true,
      mode,
      api_url: nextConfig.hosted?.api_url ?? null,
      config_path: workspace.configPath,
      next: mode === 'hosted'
        ? ['open-knowledge auth login --api-key <key>', 'open-knowledge remote contracts --json']
        : ['open-knowledge search <query>', 'knowledge <prompt>'],
      message: `Set knowledge mode to ${mode}`,
    };
  }

  authStatus(env: Record<string, string | undefined> = process.env): KnowledgeAuthStatus {
    return knowledgeAuthStatus(this.config(), env);
  }

  saveAuth(input: {
    apiKey: string;
    email?: string;
    orgId?: string;
    orgSlug?: string;
    userId?: string;
    apiUrl?: string;
  }, env: Record<string, string | undefined> = process.env) {
    const apiUrl = input.apiUrl ?? this.config().hosted?.api_url;
    return saveKnowledgeAuth({
      api_key: input.apiKey,
      email: input.email,
      org_id: input.orgId,
      org_slug: input.orgSlug,
      user_id: input.userId,
      api_url: apiUrl,
    }, env);
  }

  clearAuth(env: Record<string, string | undefined> = process.env) {
    return clearKnowledgeAuth(env);
  }

  remoteContract(): RemoteKnowledgeRegistryContract {
    const storage = this.storageContract();
    return knowledgeRegistryContract({
      mode: this.config().mode,
      sourceSchemes: this.config().sources.allowed_schemes,
      storageType: storage.artifact_store.type,
      artifactUriPrefix: storage.artifact_store.uri_prefix,
    });
  }

  remoteClient(env: Record<string, string | undefined> = process.env): RemoteKnowledgeClient | null {
    return RemoteKnowledgeClient.fromConfig(this.config(), env);
  }

  paths(): KnowledgePathsResult {
    const workspace = this.ensureWorkspace();
    return {
      ok: true,
      scope: this.scope,
      home: workspace.home,
      config_path: workspace.configPath,
      json_store_path: workspace.jsonStorePath,
      knowledge_db_path: workspace.knowledgeDbPath,
      artifacts_dir: workspace.artifactsDir,
      indexes_dir: workspace.indexesDir,
      logs_dir: workspace.logsDir,
      runs_dir: workspace.runsDir,
      schemas_dir: workspace.schemasDir,
      wiki_dir: workspace.wikiDir,
      config: this.config(),
      message: workspace.home,
    };
  }

  initDb() {
    return migrateKnowledgeDb(this.ensureWorkspace().knowledgeDbPath);
  }

  dbStats() {
    const workspace = this.ensureWorkspace();
    migrateKnowledgeDb(workspace.knowledgeDbPath);
    return getKnowledgeDbStats(workspace.knowledgeDbPath);
  }

  async initWiki() {
    const workspace = this.ensureWorkspace();
    migrateKnowledgeDb(workspace.knowledgeDbPath);
    const result = await initializeWikiLayout(this.artifactStore());
    const db = openKnowledgeDb(workspace.knowledgeDbPath);
    try {
      recordStorageObjects(db, result.artifacts);
      recordWikiLayoutCatalog(db, result.artifacts);
    } finally {
      db.close();
    }
    return result;
  }

  async compileWiki(options: Omit<WikiCompileOptions, 'dbPath' | 'store'> = {}) {
    const workspace = this.ensureWorkspace();
    return compileWikiPage({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      store: this.artifactStore(),
    });
  }

  async fileAnswer(options: {
    prompt: string;
    answer: string;
    approveWrite?: boolean;
    limit?: number;
    semantic?: boolean;
    modelRef?: string;
    dimensions?: number;
    fake?: boolean;
  }) {
    const workspace = this.ensureWorkspace();
    const context = await this.retrieveContext({
      query: options.prompt,
      limit: options.limit,
      semantic: options.semantic,
      modelRef: options.modelRef,
      dimensions: options.dimensions,
      fake: options.fake,
    });
    return fileAnswerToWiki({
      dbPath: workspace.knowledgeDbPath,
      store: this.artifactStore(),
      prompt: options.prompt,
      answer: options.answer,
      context,
      approveWrite: options.approveWrite,
    });
  }

  lintWiki() {
    const workspace = this.ensureWorkspace();
    return lintWiki({ dbPath: workspace.knowledgeDbPath });
  }

  async ingestManifest(input: string) {
    const workspace = this.ensureWorkspace();
    return ingestOpenFilesManifest({
      dbPath: workspace.knowledgeDbPath,
      input,
      config: this.config(),
      safetyPolicy: this.safetyPolicy(),
    });
  }

  async ingestSource(sourceRef: string, purpose?: string) {
    const workspace = this.ensureWorkspace();
    return ingestSourceRef({
      dbPath: workspace.knowledgeDbPath,
      sourceRef,
      purpose,
      config: this.config(),
      safetyPolicy: this.safetyPolicy(),
    });
  }

  async resolveSource(sourceRef: string, options: { purpose?: string; limit?: number } = {}) {
    const workspace = this.ensureWorkspace();
    return resolveOpenFilesSource({
      dbPath: workspace.knowledgeDbPath,
      sourceRef,
      purpose: options.purpose,
      limit: options.limit,
      safetyPolicy: this.safetyPolicy(),
    });
  }

  async consumeOutbox(input: string) {
    const workspace = this.ensureWorkspace();
    return consumeOpenFilesOutbox({
      dbPath: workspace.knowledgeDbPath,
      input,
      config: this.config(),
      safetyPolicy: this.safetyPolicy(),
    });
  }

  reindexHealth(options: Omit<ReindexRuntimeOptions, 'dbPath' | 'config'> = {}) {
    const workspace = this.ensureWorkspace();
    return reindexHealth({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
    });
  }

  enqueueReindex(options: Omit<ReindexRuntimeOptions, 'dbPath' | 'config'> = {}) {
    const workspace = this.ensureWorkspace();
    return enqueueMissingEmbeddings({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
    });
  }

  async refreshEmbeddings(options: Omit<ReindexRuntimeOptions & { full?: boolean; limit?: number }, 'dbPath' | 'config'> = {}) {
    const workspace = this.ensureWorkspace();
    return refreshEmbeddingIndex({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
    });
  }

  providerStatus(env: Record<string, string | undefined> = process.env): ProviderStatusResult {
    return providerStatus(this.config(), env);
  }

  modelRegistry(): ModelRegistryEntry[] {
    return listModelRegistry(this.config());
  }

  embeddingStatus() {
    const workspace = this.ensureWorkspace();
    return embeddingIndexStatus(workspace.knowledgeDbPath);
  }

  async indexEmbeddings(options: Omit<EmbeddingIndexOptions, 'dbPath' | 'config'> = {}) {
    const workspace = this.ensureWorkspace();
    return indexKnowledgeEmbeddings({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
    });
  }

  async semanticSearch(options: Omit<EmbeddingSearchOptions, 'dbPath' | 'config'>) {
    const workspace = this.ensureWorkspace();
    return searchVectorIndex({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
    });
  }

  async search(options: Omit<HybridSearchOptions, 'dbPath' | 'config'>) {
    const workspace = this.ensureWorkspace();
    return hybridSearch({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
    });
  }

  async retrieveContext(options: Omit<RetrievalOptions, 'dbPath' | 'config'>) {
    const workspace = this.ensureWorkspace();
    return retrieveKnowledgeContext({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
    });
  }

  async runPrompt(options: Omit<KnowledgePromptOptions, 'dbPath' | 'config'>) {
    const workspace = this.ensureWorkspace();
    return runKnowledgePrompt({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
    });
  }

  async webSearch(options: Omit<WebSearchOptions, 'dbPath' | 'config' | 'safetyPolicy'>) {
    const workspace = this.ensureWorkspace();
    return runProviderWebSearch({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
      safetyPolicy: this.safetyPolicy(),
    });
  }
}

export function createKnowledgeService(options: KnowledgeServiceOptions = {}): KnowledgeService {
  return new KnowledgeService(options);
}
