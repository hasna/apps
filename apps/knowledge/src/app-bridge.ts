import { type KnowledgePromptResult } from './agent';
import { type RemoteKnowledgePromptRequest, type RemoteKnowledgeRunContract, type RemoteKnowledgeSearchRequest } from './remote-client';
import { createKnowledgeService, type KnowledgeService, type KnowledgeServiceOptions } from './service';
import { type HybridSearchResult } from './search';

export type KnowledgeAppModePreference = 'local' | 'cloud' | 'auto';
export type KnowledgeAppBackend = 'local' | 'cloud';

export interface KnowledgeAppRemoteClient {
  search(request: RemoteKnowledgeSearchRequest): Promise<RemoteKnowledgeRunContract>;
  ask(request: RemoteKnowledgePromptRequest): Promise<RemoteKnowledgeRunContract>;
  build(request: RemoteKnowledgePromptRequest): Promise<RemoteKnowledgeRunContract>;
  sync(request?: Record<string, unknown>): Promise<RemoteKnowledgeRunContract>;
}

export interface KnowledgeAppBridgeOptions extends KnowledgeServiceOptions {
  env?: Record<string, string | undefined>;
  remoteClient?: KnowledgeAppRemoteClient | null;
  dashboardLimit?: number;
  generatedAt?: () => Date;
}

export interface KnowledgeAppSection<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
}

export interface KnowledgeAppDashboard {
  ok: true;
  generated_at: string;
  scope: string;
  workspace_home: string;
  local: {
    mode: string;
    storage_type: string;
    database_schema_version: number | null;
    write_boundary_ok: boolean | null;
  };
  cloud: {
    enabled: boolean;
    authenticated: boolean;
    auth_source: string;
    client_ready: boolean;
    api_url: string;
    capabilities: string[];
  };
  counts: {
    legacy_items: number;
    sources: number;
    chunks: number;
    wiki_pages: number;
    indexes: number;
    storage_objects: number;
    runs: number;
    sync_conflicts: number;
    reindex_queue: number;
  };
  sections: {
    paths: KnowledgeAppSection<ReturnType<KnowledgeService['paths']>>;
    inventory: KnowledgeAppSection<ReturnType<KnowledgeService['inventory']>>;
    storage: KnowledgeAppSection<ReturnType<KnowledgeService['storageContract']>>;
    validation: KnowledgeAppSection<ReturnType<KnowledgeService['validateStorage']>>;
    provenance: KnowledgeAppSection<ReturnType<KnowledgeService['provenanceStatus']>>;
    write_boundary: KnowledgeAppSection<ReturnType<KnowledgeService['writeBoundaryStatus']>>;
    db: KnowledgeAppSection<ReturnType<KnowledgeService['dbStats']>>;
    sync: KnowledgeAppSection<ReturnType<KnowledgeService['syncStatus']>>;
    reindex: KnowledgeAppSection<ReturnType<KnowledgeService['reindexHealth']>>;
    embeddings: KnowledgeAppSection<ReturnType<KnowledgeService['embeddingStatus']>>;
    providers: KnowledgeAppSection<ReturnType<KnowledgeService['providerStatus']>>;
    auth: KnowledgeAppSection<ReturnType<KnowledgeService['authStatus']>>;
    remote: KnowledgeAppSection<ReturnType<KnowledgeService['remoteContract']>>;
    remote_client: KnowledgeAppSection<boolean>;
  };
}

export interface KnowledgeAppSearchInput {
  query: string;
  limit?: number;
  semantic?: boolean;
  purpose?: string;
  modelRef?: string;
  dimensions?: number;
  fake?: boolean;
  mode?: KnowledgeAppModePreference;
}

export interface KnowledgeAppAskInput extends KnowledgeAppSearchInput {
  prompt: string;
  generate?: boolean;
  approveWrite?: boolean;
}

export type KnowledgeAppSearchResult =
  | {
      ok: true;
      backend: 'local';
      result: HybridSearchResult;
    }
  | {
      ok: true;
      backend: 'cloud';
      result: RemoteKnowledgeRunContract;
    };

export type KnowledgeAppAskResult =
  | {
      ok: true;
      backend: 'local';
      result: KnowledgePromptResult;
    }
  | {
      ok: true;
      backend: 'cloud';
      result: RemoteKnowledgeRunContract;
    };

function capture<T>(fn: () => T): KnowledgeAppSection<T> {
  try {
    return { ok: true, data: fn(), error: null };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function sectionData<T>(section: KnowledgeAppSection<T>): T | null {
  return section.ok ? section.data : null;
}

export function resolveKnowledgeAppBackend(input: {
  preference?: KnowledgeAppModePreference;
  cloudReady: boolean;
}): KnowledgeAppBackend {
  const preference = input.preference ?? 'local';
  if (preference === 'local') return 'local';
  if (preference === 'auto') return input.cloudReady ? 'cloud' : 'local';
  if (input.cloudReady) return 'cloud';
  throw new Error('Cloud mode requires hosted credentials. Run `knowledge auth login --api-key <key>` or set KNOWLEDGE_API_KEY.');
}

export class KnowledgeAppBridge {
  private readonly service: KnowledgeService;
  private readonly env: Record<string, string | undefined>;
  private readonly injectedRemoteClient: KnowledgeAppRemoteClient | null | undefined;
  private readonly dashboardLimit: number;
  private readonly generatedAt: () => Date;

  constructor(options: KnowledgeAppBridgeOptions = {}) {
    this.service = createKnowledgeService({ scope: options.scope, cwd: options.cwd });
    this.env = options.env ?? process.env;
    this.injectedRemoteClient = options.remoteClient;
    this.dashboardLimit = options.dashboardLimit ?? 20;
    this.generatedAt = options.generatedAt ?? (() => new Date());
  }

  private remoteClient(): KnowledgeAppRemoteClient | null {
    if (this.injectedRemoteClient !== undefined) return this.injectedRemoteClient;
    return this.service.remoteClient(this.env);
  }

  dashboard(): KnowledgeAppDashboard {
    const sections = {
      paths: capture(() => this.service.paths()),
      inventory: capture(() => this.service.inventory({ limit: this.dashboardLimit })),
      storage: capture(() => this.service.storageContract()),
      validation: capture(() => this.service.validateStorage()),
      provenance: capture(() => this.service.provenanceStatus()),
      write_boundary: capture(() => this.service.writeBoundaryStatus()),
      db: capture(() => this.service.dbStats()),
      sync: capture(() => this.service.syncStatus()),
      reindex: capture(() => this.service.reindexHealth()),
      embeddings: capture(() => this.service.embeddingStatus()),
      providers: capture(() => this.service.providerStatus(this.env)),
      auth: capture(() => this.service.authStatus(this.env)),
      remote: capture(() => this.service.remoteContract()),
      remote_client: capture(() => Boolean(this.remoteClient())),
    };

    const paths = sectionData(sections.paths);
    const inventory = sectionData(sections.inventory);
    const storage = sectionData(sections.storage);
    const db = sectionData(sections.db);
    const sync = sectionData(sections.sync);
    const reindex = sectionData(sections.reindex);
    const auth = sectionData(sections.auth);
    const remote = sectionData(sections.remote);
    const writeBoundary = sectionData(sections.write_boundary);
    const clientReady = Boolean(sectionData(sections.remote_client));
    const summary = inventory?.summary ?? {};
    const fallbackConfig = paths?.config;
    const storageMode = (storage as { mode?: string } | null)?.mode;

    return {
      ok: true,
      generated_at: this.generatedAt().toISOString(),
      scope: this.service.scope,
      workspace_home: paths?.home ?? this.service.workspace.home,
      local: {
        mode: fallbackConfig?.mode ?? storageMode ?? 'local',
        storage_type: storage?.storage_type ?? fallbackConfig?.storage?.type ?? 'local',
        database_schema_version: db?.schema_version ?? null,
        write_boundary_ok: writeBoundary?.ok ?? null,
      },
      cloud: {
        enabled: Boolean(storage?.hosted.enabled ?? fallbackConfig?.mode === 'hosted'),
        authenticated: Boolean(auth?.authenticated),
        auth_source: auth?.source ?? 'none',
        client_ready: clientReady,
        api_url: auth?.api_url ?? fallbackConfig?.hosted?.api_url ?? 'https://knowledge.hasna.xyz',
        capabilities: remote?.capabilities ?? [],
      },
      counts: {
        legacy_items: Number(summary.legacy_items ?? inventory?.legacy_store.active_items ?? 0),
        sources: Number(summary.sources ?? db?.sources ?? 0),
        chunks: Number(summary.chunks ?? db?.chunks ?? 0),
        wiki_pages: Number(summary.wiki_pages ?? db?.wiki_pages ?? 0),
        indexes: Number(summary.indexes ?? db?.indexes ?? 0),
        storage_objects: Number(summary.storage_objects ?? db?.storage_objects ?? 0),
        runs: Number(summary.runs ?? db?.runs ?? 0),
        sync_conflicts: Number(summary.sync_conflicts ?? sync?.conflicts.open ?? 0),
        reindex_queue: Number(
          summary.reindex_queue
          ?? Object.values(reindex?.queued ?? {}).reduce((total, count) => total + Number(count), 0),
        ),
      },
      sections,
    };
  }

  async search(input: KnowledgeAppSearchInput): Promise<KnowledgeAppSearchResult> {
    const backend = resolveKnowledgeAppBackend({
      preference: input.mode,
      cloudReady: Boolean(this.remoteClient()),
    });

    if (backend === 'cloud') {
      const client = this.remoteClient();
      if (!client) throw new Error('Cloud mode selected without a remote client.');
      const result = await client.search({
        query: input.query,
        limit: input.limit,
        semantic: input.semantic,
      });
      return { ok: true, backend, result };
    }

    const result = await this.service.search({
      query: input.query,
      limit: input.limit,
      semantic: input.semantic,
      purpose: input.purpose,
      modelRef: input.modelRef,
      dimensions: input.dimensions,
      fake: input.fake,
    });
    return { ok: true, backend, result };
  }

  async ask(input: KnowledgeAppAskInput): Promise<KnowledgeAppAskResult> {
    const backend = resolveKnowledgeAppBackend({
      preference: input.mode,
      cloudReady: Boolean(this.remoteClient()),
    });

    if (backend === 'cloud') {
      const client = this.remoteClient();
      if (!client) throw new Error('Cloud mode selected without a remote client.');
      const request = {
        query: input.query || input.prompt,
        prompt: input.prompt,
        limit: input.limit,
        semantic: input.semantic,
        generate: input.generate,
        approve_write: input.approveWrite,
      };
      const result = await client.ask(request);
      return { ok: true, backend, result };
    }

    const result = await this.service.runPrompt({
      prompt: input.prompt,
      limit: input.limit,
      semantic: input.semantic,
      purpose: input.purpose,
      modelRef: input.modelRef,
      dimensions: input.dimensions,
      fake: input.fake,
      generate: input.generate,
      approveWrite: input.approveWrite,
    });
    return { ok: true, backend, result };
  }

  ingestSource(sourceRef: string, purpose?: string) {
    return this.service.ingestSource(sourceRef, purpose);
  }

  ingestManifest(input: string) {
    return this.service.ingestManifest(input);
  }

  setupHosted(apiUrl?: string) {
    return this.service.setup({ mode: 'hosted', apiUrl });
  }

  setupLocal() {
    return this.service.setup({ mode: 'local' });
  }
}

export function createKnowledgeAppBridge(options: KnowledgeAppBridgeOptions = {}): KnowledgeAppBridge {
  return new KnowledgeAppBridge(options);
}
