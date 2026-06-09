import {
  createKnowledgeService,
  KnowledgeService,
  type KnowledgeServiceOptions,
} from './service.js';

export type KnowledgeClientOptions = KnowledgeServiceOptions;
export type KnowledgeSetupOptions = Parameters<KnowledgeService['setup']>[0];
export type KnowledgeAuthInput = Parameters<KnowledgeService['saveAuth']>[0];
export type KnowledgeAskOptions = Omit<Parameters<KnowledgeService['runPrompt']>[0], 'prompt'>;
export type KnowledgeSearchOptions = Parameters<KnowledgeService['search']>[0];
export type KnowledgeContextOptions = Parameters<KnowledgeService['retrieveContext']>[0];
export type KnowledgeWebSearchOptions = Parameters<KnowledgeService['webSearch']>[0];
export type KnowledgeSyncSnapshotOptions = Parameters<KnowledgeService['createSyncSnapshot']>[0];
export type KnowledgeSyncBundleOptions = Parameters<KnowledgeService['exportSyncBundle']>[0];
export type KnowledgeSyncImportOptions = Parameters<KnowledgeService['importSyncBundle']>[0];
export type KnowledgePeerSyncOptions = Parameters<KnowledgeService['syncPeer']>[0];
export type KnowledgeRemotePeerSyncOptions = Parameters<KnowledgeService['syncRemotePeer']>[0];

export interface KnowledgeClient {
  /**
   * Escape hatch for advanced integrations. Prefer the grouped SDK methods for
   * app-facing code; this service may expose lower-level operations over time.
   */
  readonly unstable_service: KnowledgeService;
  readonly paths: () => ReturnType<KnowledgeService['paths']>;
  readonly setup: (options?: KnowledgeSetupOptions) => ReturnType<KnowledgeService['setup']>;
  readonly auth: {
    readonly status: (env?: Record<string, string | undefined>) => ReturnType<KnowledgeService['authStatus']>;
    readonly login: (
      input: KnowledgeAuthInput,
      env?: Record<string, string | undefined>,
    ) => ReturnType<KnowledgeService['saveAuth']>;
    readonly logout: (env?: Record<string, string | undefined>) => ReturnType<KnowledgeService['clearAuth']>;
  };
  readonly remote: {
    readonly contract: () => ReturnType<KnowledgeService['remoteContract']>;
    readonly client: (env?: Record<string, string | undefined>) => ReturnType<KnowledgeService['remoteClient']>;
  };
  readonly storage: {
    readonly status: () => ReturnType<KnowledgeService['storageContract']>;
    readonly validate: () => ReturnType<KnowledgeService['validateStorage']>;
    readonly artifactStore: () => ReturnType<KnowledgeService['artifactStore']>;
  };
  readonly sync: {
    readonly status: () => ReturnType<KnowledgeService['syncStatus']>;
    readonly snapshot: (options?: KnowledgeSyncSnapshotOptions) => ReturnType<KnowledgeService['createSyncSnapshot']>;
    readonly conflicts: (options?: Parameters<KnowledgeService['syncConflicts']>[0]) => ReturnType<KnowledgeService['syncConflicts']>;
    readonly machines: () => ReturnType<KnowledgeService['syncMachines']>;
    readonly exportBundle: (options?: KnowledgeSyncBundleOptions) => ReturnType<KnowledgeService['exportSyncBundle']>;
    readonly importBundle: (options: KnowledgeSyncImportOptions) => ReturnType<KnowledgeService['importSyncBundle']>;
    readonly peer: (options: KnowledgePeerSyncOptions) => ReturnType<KnowledgeService['syncPeer']>;
    readonly remotePeer: (options: KnowledgeRemotePeerSyncOptions) => ReturnType<KnowledgeService['syncRemotePeer']>;
  };
  readonly db: {
    readonly init: () => ReturnType<KnowledgeService['initDb']>;
    readonly stats: () => ReturnType<KnowledgeService['dbStats']>;
  };
  readonly wiki: {
    readonly init: () => ReturnType<KnowledgeService['initWiki']>;
    readonly compile: (options?: Parameters<KnowledgeService['compileWiki']>[0]) => ReturnType<KnowledgeService['compileWiki']>;
    readonly fileAnswer: (options: Parameters<KnowledgeService['fileAnswer']>[0]) => ReturnType<KnowledgeService['fileAnswer']>;
    readonly lint: () => ReturnType<KnowledgeService['lintWiki']>;
  };
  readonly ingest: {
    readonly manifest: (input: string) => ReturnType<KnowledgeService['ingestManifest']>;
    readonly source: (sourceRef: string, purpose?: string) => ReturnType<KnowledgeService['ingestSource']>;
  };
  readonly sources: {
    readonly resolve: (
      sourceRef: string,
      options?: Parameters<KnowledgeService['resolveSource']>[1],
    ) => ReturnType<KnowledgeService['resolveSource']>;
    readonly consumeOutbox: (input: string) => ReturnType<KnowledgeService['consumeOutbox']>;
  };
  readonly reindex: {
    readonly health: (options?: Parameters<KnowledgeService['reindexHealth']>[0]) => ReturnType<KnowledgeService['reindexHealth']>;
    readonly enqueue: (options?: Parameters<KnowledgeService['enqueueReindex']>[0]) => ReturnType<KnowledgeService['enqueueReindex']>;
    readonly refreshEmbeddings: (
      options?: Parameters<KnowledgeService['refreshEmbeddings']>[0],
    ) => ReturnType<KnowledgeService['refreshEmbeddings']>;
  };
  readonly providers: {
    readonly status: (env?: Record<string, string | undefined>) => ReturnType<KnowledgeService['providerStatus']>;
    readonly models: () => ReturnType<KnowledgeService['modelRegistry']>;
  };
  readonly embeddings: {
    readonly status: () => ReturnType<KnowledgeService['embeddingStatus']>;
    readonly index: (options?: Parameters<KnowledgeService['indexEmbeddings']>[0]) => ReturnType<KnowledgeService['indexEmbeddings']>;
    readonly search: (options: Parameters<KnowledgeService['semanticSearch']>[0]) => ReturnType<KnowledgeService['semanticSearch']>;
  };
  readonly search: (options: KnowledgeSearchOptions) => ReturnType<KnowledgeService['search']>;
  readonly retrieveContext: (options: KnowledgeContextOptions) => ReturnType<KnowledgeService['retrieveContext']>;
  readonly ask: (prompt: string, options?: KnowledgeAskOptions) => ReturnType<KnowledgeService['runPrompt']>;
  readonly build: (prompt: string, options?: KnowledgeAskOptions) => ReturnType<KnowledgeService['runPrompt']>;
  readonly web: {
    readonly search: (options: KnowledgeWebSearchOptions) => ReturnType<KnowledgeService['webSearch']>;
  };
}

export function createKnowledgeClient(options: KnowledgeClientOptions = {}): KnowledgeClient {
  const service = createKnowledgeService(options);

  return {
    unstable_service: service,
    paths: () => service.paths(),
    setup: (input = {}) => service.setup(input),
    auth: {
      status: (env = process.env) => service.authStatus(env),
      login: (input, env = process.env) => service.saveAuth(input, env),
      logout: (env = process.env) => service.clearAuth(env),
    },
    remote: {
      contract: () => service.remoteContract(),
      client: (env = process.env) => service.remoteClient(env),
    },
    storage: {
      status: () => service.storageContract(),
      validate: () => service.validateStorage(),
      artifactStore: () => service.artifactStore(),
    },
    sync: {
      status: () => service.syncStatus(),
      snapshot: (input = {}) => service.createSyncSnapshot(input),
      conflicts: (input = {}) => service.syncConflicts(input),
      machines: () => service.syncMachines(),
      exportBundle: (input = {}) => service.exportSyncBundle(input),
      importBundle: (input) => service.importSyncBundle(input),
      peer: (input) => service.syncPeer(input),
      remotePeer: (input) => service.syncRemotePeer(input),
    },
    db: {
      init: () => service.initDb(),
      stats: () => service.dbStats(),
    },
    wiki: {
      init: () => service.initWiki(),
      compile: (input = {}) => service.compileWiki(input),
      fileAnswer: (input) => service.fileAnswer(input),
      lint: () => service.lintWiki(),
    },
    ingest: {
      manifest: (input) => service.ingestManifest(input),
      source: (sourceRef, purpose) => service.ingestSource(sourceRef, purpose),
    },
    sources: {
      resolve: (sourceRef, input = {}) => service.resolveSource(sourceRef, input),
      consumeOutbox: (input) => service.consumeOutbox(input),
    },
    reindex: {
      health: (input = {}) => service.reindexHealth(input),
      enqueue: (input = {}) => service.enqueueReindex(input),
      refreshEmbeddings: (input = {}) => service.refreshEmbeddings(input),
    },
    providers: {
      status: (env = process.env) => service.providerStatus(env),
      models: () => service.modelRegistry(),
    },
    embeddings: {
      status: () => service.embeddingStatus(),
      index: (input = {}) => service.indexEmbeddings(input),
      search: (input) => service.semanticSearch(input),
    },
    search: (input) => service.search(input),
    retrieveContext: (input) => service.retrieveContext(input),
    ask: (prompt, input = {}) => service.runPrompt({ ...input, prompt }),
    build: (prompt, input = {}) => service.runPrompt({ ...input, prompt }),
    web: {
      search: (input) => service.webSearch(input),
    },
  };
}

export const createKnowledgeSdk = createKnowledgeClient;
