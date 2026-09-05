import {
  createKnowledgeService,
  KnowledgeService,
  type KnowledgeServiceOptions,
} from './service.js';
import type { KnowledgeItem } from './store.js';
import type {
  ItemStore,
  ItemCreateInput,
  ItemPatch,
  ItemListOptions,
  ItemListResult,
} from './item-store.js';
import type {
  KnowledgeProjectInverseRequest,
  KnowledgeProjectItemBindingRequest,
  KnowledgeProjectReceiptLookupRequest,
  KnowledgeProjectRegistrationRequest,
  KnowledgeProjectResourceKind,
  KnowledgeProjectResourceListOptions,
} from './project-links.js';

/**
 * The unified knowledge-item Store surface, mirrored on the SDK so app code
 * routes item CRUD through the SAME Store as the CLI and MCP: the on-box
 * db.json store, or HTTP whenever the shared @hasna/contracts credential chain
 * resolves a key. No SDK item method touches sqlite or the raw HTTP client
 * directly — the Store resolves the transport, freshly, per call.
 */
export interface KnowledgeItemsSdk {
  /** The resolved Store for this scope (`kind: 'local' | 'api'`). */
  readonly store: () => ItemStore;
  readonly list: (options?: ItemListOptions) => Promise<ItemListResult>;
  readonly get: (idOrShort: string) => Promise<KnowledgeItem | null>;
  readonly create: (input: ItemCreateInput) => Promise<KnowledgeItem>;
  readonly update: (idOrShort: string, patch: ItemPatch) => Promise<KnowledgeItem | null>;
  readonly delete: (idOrShort: string) => Promise<boolean>;
  readonly deleteMany: (idsOrShorts: string[]) => Promise<number>;
}

export interface KnowledgeProjectLinksSdk {
  readonly capability: () => ReturnType<ReturnType<KnowledgeService['projectLinksAuthority']>['capability']>;
  readonly registerCollection: (
    request: KnowledgeProjectRegistrationRequest,
  ) => ReturnType<ReturnType<KnowledgeService['projectLinksAuthority']>['registerCollection']>;
  readonly readCollection: (
    collectionId: string,
  ) => ReturnType<ReturnType<KnowledgeService['projectLinksAuthority']>['readCollection']>;
  readonly lookupReceipt: (
    request: KnowledgeProjectReceiptLookupRequest,
  ) => ReturnType<ReturnType<KnowledgeService['projectLinksAuthority']>['lookupReceipt']>;
  readonly compensateRegistration: (
    request: KnowledgeProjectInverseRequest,
  ) => ReturnType<ReturnType<KnowledgeService['projectLinksAuthority']>['compensateRegistration']>;
  readonly verifyRegistrationInverse: (
    request: KnowledgeProjectInverseRequest,
  ) => ReturnType<ReturnType<KnowledgeService['projectLinksAuthority']>['verifyRegistrationInverse']>;
  readonly bindItem: (
    request: KnowledgeProjectItemBindingRequest,
  ) => ReturnType<ReturnType<KnowledgeService['projectLinksAuthority']>['bindItem']>;
  readonly readItemBinding: (
    collectionId: string,
    itemId: string,
  ) => ReturnType<ReturnType<KnowledgeService['projectLinksAuthority']>['readItemBinding']>;
  readonly compensateItemBinding: (
    request: KnowledgeProjectInverseRequest,
  ) => ReturnType<ReturnType<KnowledgeService['projectLinksAuthority']>['compensateItemBinding']>;
  readonly verifyItemBindingInverse: (
    request: KnowledgeProjectInverseRequest,
  ) => ReturnType<ReturnType<KnowledgeService['projectLinksAuthority']>['verifyItemBindingInverse']>;
  readonly listResources: (
    projectId: string,
    options?: KnowledgeProjectResourceListOptions,
  ) => ReturnType<ReturnType<KnowledgeService['projectLinksAuthority']>['listProjectResources']>;
  readonly readResource: (
    projectId: string,
    kind: KnowledgeProjectResourceKind,
    resourceId: string,
  ) => ReturnType<ReturnType<KnowledgeService['projectLinksAuthority']>['readProjectResource']>;
  readonly readAllResources: (
    projectId: string,
    options?: Omit<KnowledgeProjectResourceListOptions, 'cursor'>,
  ) => ReturnType<ReturnType<KnowledgeService['projectLinksAuthority']>['readAllProjectResources']>;
}

export type KnowledgeClientOptions = KnowledgeServiceOptions;
export type KnowledgeSetupOptions = Parameters<KnowledgeService['setup']>[0];
export type KnowledgeAuthInput = Parameters<KnowledgeService['saveAuth']>[0];
export type KnowledgeAskOptions = Omit<Parameters<KnowledgeService['runPrompt']>[0], 'prompt'>;
export type KnowledgeSearchOptions = Parameters<KnowledgeService['search']>[0];
export type KnowledgeContextOptions = Parameters<KnowledgeService['retrieveContext']>[0];
export type KnowledgeAgentContextPackOptions = Parameters<KnowledgeService['contextPack']>[0];
export type KnowledgeWebSearchOptions = Parameters<KnowledgeService['webSearch']>[0];
export type KnowledgeInventoryOptions = Parameters<KnowledgeService['inventory']>[0];
export type KnowledgeSyncSnapshotOptions = Parameters<KnowledgeService['createSyncSnapshot']>[0];
export type KnowledgeSyncDoctorOptions = Parameters<KnowledgeService['syncDoctor']>[0];
export type KnowledgeSyncBundleOptions = Parameters<KnowledgeService['exportSyncBundle']>[0];
export type KnowledgeSyncImportOptions = Parameters<KnowledgeService['importSyncBundle']>[0];
export type KnowledgePeerSyncOptions = Parameters<KnowledgeService['syncPeer']>[0];
export type KnowledgeRemotePeerSyncOptions = Parameters<KnowledgeService['syncRemotePeer']>[0];
export type KnowledgeRulesProvenanceOptions = Parameters<KnowledgeService['importRulesProvenance']>[0];
export type KnowledgeAppWikiInitOptions = Parameters<KnowledgeService['initAppWiki']>[0];
export type KnowledgeAppWikiNoteInput = Parameters<KnowledgeService['addAppWikiNote']>[0];
export type KnowledgeAppWikiSourceInput = Parameters<KnowledgeService['addAppWikiSourceRef']>[0];
export type KnowledgeAppWikiSearchOptions = Parameters<KnowledgeService['searchAppWiki']>[0];
export type KnowledgeAppWikiQueryOptions = Parameters<KnowledgeService['queryAppWiki']>[0];

export interface KnowledgeAppWikiScopeOptions extends KnowledgeClientOptions {
  allowGlobal?: boolean;
}

export interface KnowledgeAppWikiSdk {
  readonly paths: () => ReturnType<KnowledgeService['paths']>;
  readonly init: (options?: KnowledgeAppWikiInitOptions) => ReturnType<KnowledgeService['initAppWiki']>;
  readonly notes: {
    readonly add: (input: KnowledgeAppWikiNoteInput) => ReturnType<KnowledgeService['addAppWikiNote']>;
    readonly list: (options?: Parameters<KnowledgeService['listAppWikiNotes']>[0]) => ReturnType<KnowledgeService['listAppWikiNotes']>;
    readonly get: (
      id: string,
      options?: Parameters<KnowledgeService['getAppWikiNote']>[1],
    ) => ReturnType<KnowledgeService['getAppWikiNote']>;
  };
  readonly sources: {
    readonly add: (input: KnowledgeAppWikiSourceInput) => ReturnType<KnowledgeService['addAppWikiSourceRef']>;
  };
  readonly search: (options: KnowledgeAppWikiSearchOptions) => ReturnType<KnowledgeService['searchAppWiki']>;
  readonly query: (options: KnowledgeAppWikiQueryOptions) => ReturnType<KnowledgeService['queryAppWiki']>;
}

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
  readonly storage: {
    readonly status: () => ReturnType<KnowledgeService['storageContract']>;
    readonly validate: () => ReturnType<KnowledgeService['validateStorage']>;
    readonly migrateLegacyPath: (options?: Parameters<KnowledgeService['migrateLegacyPath']>[0]) => ReturnType<KnowledgeService['migrateLegacyPath']>;
    readonly migrateProjectPath: (options?: Parameters<KnowledgeService['migrateProjectPath']>[0]) => ReturnType<KnowledgeService['migrateProjectPath']>;
    readonly mergeLegacyPath: (options?: Parameters<KnowledgeService['mergeLegacyPath']>[0]) => ReturnType<KnowledgeService['mergeLegacyPath']>;
    readonly artifactStore: () => ReturnType<KnowledgeService['artifactStore']>;
  };
  readonly sync: {
    readonly status: () => ReturnType<KnowledgeService['syncStatus']>;
    readonly doctor: (options?: KnowledgeSyncDoctorOptions) => ReturnType<KnowledgeService['syncDoctor']>;
    readonly snapshot: (options?: KnowledgeSyncSnapshotOptions) => ReturnType<KnowledgeService['createSyncSnapshot']>;
    readonly conflicts: (options?: Parameters<KnowledgeService['syncConflicts']>[0]) => ReturnType<KnowledgeService['syncConflicts']>;
    readonly conflict: (id: string) => ReturnType<KnowledgeService['syncConflict']>;
    readonly proposeConflictResolution: (id: string) => ReturnType<KnowledgeService['proposeSyncConflictResolution']>;
    readonly proposeConflictResolutionAi: (options: Parameters<KnowledgeService['proposeSyncConflictResolutionWithAi']>[0]) => ReturnType<KnowledgeService['proposeSyncConflictResolutionWithAi']>;
    readonly resolveConflict: (options: Parameters<KnowledgeService['resolveSyncConflict']>[0]) => ReturnType<KnowledgeService['resolveSyncConflict']>;
    readonly machines: () => ReturnType<KnowledgeService['syncMachines']>;
    readonly exportBundle: (options?: KnowledgeSyncBundleOptions) => ReturnType<KnowledgeService['exportSyncBundle']>;
    readonly importBundle: (options: KnowledgeSyncImportOptions) => ReturnType<KnowledgeService['importSyncBundle']>;
    readonly peer: (options: KnowledgePeerSyncOptions) => ReturnType<KnowledgeService['syncPeer']>;
    readonly remotePeer: (options: KnowledgeRemotePeerSyncOptions) => ReturnType<KnowledgeService['syncRemotePeer']>;
  };
  /**
   * Knowledge-item CRUD routed through the unified Store. Identical behavior to
   * the `knowledge add/list/get/update/delete` CLI commands over either transport.
   */
  readonly items: KnowledgeItemsSdk;
  /** Project collection registration, explicit membership, receipts, and complete resource enumeration. */
  readonly projectLinks: KnowledgeProjectLinksSdk;
  /**
   * Inventory of the knowledge corpus. Routes to the shared API item corpus in
   * the HTTP API when selected and the on-box sqlite/JSON catalog otherwise, so the SDK never
   * diverges from the CLI/MCP. Always async.
   */
  readonly inventory: (options?: KnowledgeInventoryOptions) => ReturnType<KnowledgeService['resolveInventory']>;
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
  readonly appWiki: KnowledgeAppWikiSdk;
  readonly ingest: {
    readonly manifest: (input: string) => ReturnType<KnowledgeService['ingestManifest']>;
    readonly source: (sourceRef: string, purpose?: string) => ReturnType<KnowledgeService['ingestSource']>;
    readonly rules: (options?: KnowledgeRulesProvenanceOptions) => ReturnType<KnowledgeService['importRulesProvenance']>;
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
  readonly contextPack: (options: KnowledgeAgentContextPackOptions) => ReturnType<KnowledgeService['contextPack']>;
  readonly context: {
    readonly pack: (options: KnowledgeAgentContextPackOptions) => ReturnType<KnowledgeService['contextPack']>;
  };
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
    storage: {
      status: () => service.storageContract(),
      validate: () => service.validateStorage(),
      migrateLegacyPath: (input = {}) => service.migrateLegacyPath(input),
      migrateProjectPath: (input = {}) => service.migrateProjectPath(input),
      mergeLegacyPath: (input = {}) => service.mergeLegacyPath(input),
      artifactStore: () => service.artifactStore(),
    },
    sync: {
      status: () => service.syncStatus(),
      doctor: (input = {}) => service.syncDoctor(input),
      snapshot: (input = {}) => service.createSyncSnapshot(input),
      conflicts: (input = {}) => service.syncConflicts(input),
      conflict: (id) => service.syncConflict(id),
      proposeConflictResolution: (id) => service.proposeSyncConflictResolution(id),
      proposeConflictResolutionAi: (input) => service.proposeSyncConflictResolutionWithAi(input),
      resolveConflict: (input) => service.resolveSyncConflict(input),
      machines: () => service.syncMachines(),
      exportBundle: (input = {}) => service.exportSyncBundle(input),
      importBundle: (input) => service.importSyncBundle(input),
      peer: (input) => service.syncPeer(input),
      remotePeer: (input) => service.syncRemotePeer(input),
    },
    items: {
      store: () => service.itemStore(),
      list: (options = {}) => service.listItems(options),
      get: (idOrShort) => service.getItem(idOrShort),
      create: (input) => service.createItem(input),
      update: (idOrShort, patch) => service.updateItem(idOrShort, patch),
      delete: (idOrShort) => service.deleteItem(idOrShort),
      deleteMany: (idsOrShorts) => service.deleteItems(idsOrShorts),
    },
    projectLinks: {
      capability: () => service.projectLinksAuthority().capability(),
      registerCollection: (request) => service.projectLinksAuthority().registerCollection(request),
      readCollection: (collectionId) => service.projectLinksAuthority().readCollection(collectionId),
      lookupReceipt: (request) => service.projectLinksAuthority().lookupReceipt(request),
      compensateRegistration: (request) => service.projectLinksAuthority().compensateRegistration(request),
      verifyRegistrationInverse: (request) => service.projectLinksAuthority().verifyRegistrationInverse(request),
      bindItem: (request) => service.projectLinksAuthority().bindItem(request),
      readItemBinding: (collectionId, itemId) => service.projectLinksAuthority().readItemBinding(collectionId, itemId),
      compensateItemBinding: (request) => service.projectLinksAuthority().compensateItemBinding(request),
      verifyItemBindingInverse: (request) => service.projectLinksAuthority().verifyItemBindingInverse(request),
      listResources: (projectId, input = {}) => service.projectLinksAuthority().listProjectResources(projectId, input),
      readResource: (projectId, kind, resourceId) => service.projectLinksAuthority().readProjectResource(
        projectId,
        kind,
        resourceId,
      ),
      readAllResources: (projectId, input = {}) => service.projectLinksAuthority().readAllProjectResources(
        projectId,
        input,
      ),
    },
    inventory: (input = {}) => service.resolveInventory(input),
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
    appWiki: {
      paths: () => service.paths(),
      init: (input = {}) => service.initAppWiki(input),
      notes: {
        add: (input) => service.addAppWikiNote(input),
        list: (input = {}) => service.listAppWikiNotes(input),
        get: (id, input = {}) => service.getAppWikiNote(id, input),
      },
      sources: {
        add: (input) => service.addAppWikiSourceRef(input),
      },
      search: (input) => service.searchAppWiki(input),
      query: (input) => service.queryAppWiki(input),
    },
    ingest: {
      manifest: (input) => service.ingestManifest(input),
      source: (sourceRef, purpose) => service.ingestSource(sourceRef, purpose),
      rules: (input = {}) => service.importRulesProvenance(input),
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
    contextPack: (input) => service.contextPack(input),
    context: {
      pack: (input) => service.contextPack(input),
    },
    ask: (prompt, input = {}) => service.runPrompt({ ...input, prompt }),
    build: (prompt, input = {}) => service.runPrompt({ ...input, prompt }),
    web: {
      search: (input) => service.webSearch(input),
    },
  };
}

export const createKnowledgeSdk = createKnowledgeClient;

function withDefaultAllowGlobal<T extends { allowGlobal?: boolean } | undefined>(
  input: T,
  allowGlobal: boolean | undefined,
): T {
  if (allowGlobal !== true) return input;
  return { ...(input ?? {}), allowGlobal: input?.allowGlobal ?? true } as T;
}

export function createAppWikiScope(options: KnowledgeAppWikiScopeOptions = {}): KnowledgeAppWikiSdk {
  const { allowGlobal, ...clientOptions } = options;
  const client = createKnowledgeClient({
    ...clientOptions,
    scope: clientOptions.scope ?? 'project',
  });
  return {
    paths: () => client.appWiki.paths(),
    init: (input = {}) => client.appWiki.init(withDefaultAllowGlobal(input, allowGlobal)),
    notes: {
      add: (input) => client.appWiki.notes.add(withDefaultAllowGlobal(input, allowGlobal)),
      list: (input = {}) => client.appWiki.notes.list(input),
      get: (id, input = {}) => client.appWiki.notes.get(id, input),
    },
    sources: {
      add: (input) => client.appWiki.sources.add(withDefaultAllowGlobal(input, allowGlobal)),
    },
    search: (input) => client.appWiki.search(input),
    query: (input) => client.appWiki.query(input),
  };
}

export function openProjectWiki(options: Omit<KnowledgeAppWikiScopeOptions, 'scope' | 'allowGlobal'> = {}): KnowledgeAppWikiSdk {
  return createAppWikiScope({ ...options, scope: 'project' });
}

export function openGlobalWiki(options: Omit<KnowledgeAppWikiScopeOptions, 'scope'> & { allowGlobal: true }): KnowledgeAppWikiSdk {
  return createAppWikiScope({ ...options, scope: 'global', allowGlobal: true });
}
