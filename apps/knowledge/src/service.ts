import { createArtifactStore } from './artifact-store';
import { consumeOpenFilesOutbox } from './outbox-consume';
import { getKnowledgeDbStats, migrateKnowledgeDb } from './knowledge-db';
import { ingestOpenFilesManifest } from './manifest-ingest';
import { ingestSourceRef } from './source-ingest';
import { resolveOpenFilesSource } from './source-resolver';
import { resolveSafetyPolicy } from './safety';
import { initializeWikiLayout } from './wiki-layout';
import {
  ensureKnowledgeWorkspace,
  readKnowledgeConfig,
  resolveScopedWorkspace,
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
    return initializeWikiLayout(this.artifactStore());
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
}

export function createKnowledgeService(options: KnowledgeServiceOptions = {}): KnowledgeService {
  return new KnowledgeService(options);
}
