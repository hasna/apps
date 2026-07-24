import {
  KnowledgeApiClient,
  type KnowledgeApiClientOptions,
  type KnowledgeNote,
  type KnowledgeNoteInput,
  type KnowledgeNoteList,
  type KnowledgeNotePatch,
} from '@hasna/knowledge';
import {
  KnowledgeApiClient as GeneratedKnowledgeApiClient,
  type KnowledgeApiClientOptions as GeneratedKnowledgeApiClientOptions,
  type Note,
  type NoteInput,
  type NoteList,
  type NotePatch,
} from '@hasna/knowledge-generated';
import * as RootSurface from '@hasna/knowledge';
import * as ArtifactSurface from '@hasna/knowledge-artifact';
import * as AuthSurface from '@hasna/knowledge-auth';
import * as ProviderSurface from '@hasna/knowledge-providers';
import * as RemoteSurface from '@hasna/knowledge-remote';
import * as ServiceSurface from '@hasna/knowledge-service';
import * as StorageSurface from '@hasna/knowledge-storage';
import * as StorageSyncSurface from '@hasna/knowledge-storage-sync';
import * as RemoteStorageSurface from '@hasna/knowledge-remote-storage';
import * as StorageKitSurface from '@hasna/knowledge-storage-kit';
import * as ServeSurface from '@hasna/knowledge-serve';
import * as KnowledgeDbSurface from '@hasna/knowledge-db';
import * as StoreSurface from '@hasna/knowledge-store';
import * as OutboxSurface from '@hasna/knowledge-outbox';
import type { Pool, QueryResultRow } from 'pg';
import type { ApiKeyStore, ApiKeyVerifier } from '@hasna/contracts/auth';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;
type PublicShape<Value> = { [Key in keyof Value]: Value[Key] };

type PinnedNote = {
  id: string;
  short_id?: string | null;
  title: string;
  content: string;
  url?: string | null;
  tags: string[];
  metadata?: Record<string, unknown>;
  archived: boolean;
  created_at: string;
  updated_at: string;
};
type PinnedServeNoteInput = {
  title: string;
  content?: string;
  url?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
};
type PinnedNotePatch = {
  title?: string;
  content?: string;
  url?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  archived?: boolean;
};
type PinnedNoteList = { items: PinnedNote[]; total: number };

type _GeneratedNote = Expect<Equal<Note, PinnedNote>>;
type _GeneratedInput = Expect<Equal<NoteInput, PinnedNoteInput>>;
type _GeneratedPatch = Expect<Equal<NotePatch, PinnedNotePatch>>;
type _GeneratedList = Expect<Equal<NoteList, PinnedNoteList>>;
type _RootNote = Expect<Equal<KnowledgeNote, PinnedNote>>;
type _RootInput = Expect<Equal<KnowledgeNoteInput, PinnedNoteInput>>;
type _RootPatch = Expect<Equal<KnowledgeNotePatch, PinnedNotePatch>>;
type _RootList = Expect<Equal<KnowledgeNoteList, PinnedNoteList>>;

type _GeneratedListReturn = Expect<Equal<Awaited<ReturnType<GeneratedKnowledgeApiClient['listNotes']>>, NoteList>>;
type _GeneratedCreateReturn = Expect<Equal<Awaited<ReturnType<GeneratedKnowledgeApiClient['createNote']>>, Note>>;
type _GeneratedGetReturn = Expect<Equal<Awaited<ReturnType<GeneratedKnowledgeApiClient['getNote']>>, Note>>;
type _GeneratedUpdateReturn = Expect<Equal<Awaited<ReturnType<GeneratedKnowledgeApiClient['updateNote']>>, Note>>;
type _GeneratedDeleteReturn = Expect<Equal<Awaited<ReturnType<GeneratedKnowledgeApiClient['deleteNote']>>, void>>;
type _GeneratedRegistryReturn = Expect<Equal<Awaited<ReturnType<GeneratedKnowledgeApiClient['getRegistry']>>, Record<string, unknown>>>;
type _RootListReturn = Expect<Equal<Awaited<ReturnType<KnowledgeApiClient['listNotes']>>, KnowledgeNoteList>>;
type _RootCreateReturn = Expect<Equal<Awaited<ReturnType<KnowledgeApiClient['createNote']>>, KnowledgeNote>>;
type _RootGetReturn = Expect<Equal<Awaited<ReturnType<KnowledgeApiClient['getNote']>>, KnowledgeNote>>;
type _RootUpdateReturn = Expect<Equal<Awaited<ReturnType<KnowledgeApiClient['updateNote']>>, KnowledgeNote>>;
type _RootDeleteReturn = Expect<Equal<Awaited<ReturnType<KnowledgeApiClient['deleteNote']>>, void>>;
type _RootRegistryReturn = Expect<Equal<Awaited<ReturnType<KnowledgeApiClient['getRegistry']>>, Record<string, unknown>>>;

type PinnedS3ClientLike = { send(command: unknown): Promise<any> };
type PinnedArtifactWrite = {
  key: string;
  body: string | Uint8Array;
  content_type?: string;
  metadata?: Record<string, unknown>;
};
type PinnedArtifactWriteResult = { key: string; uri: string; modified_at?: string };
type PinnedArtifactStore = {
  readonly type: 'local' | 's3';
  readonly canRead: boolean;
  readonly canWrite: boolean;
  put(entry: PinnedArtifactWrite): Promise<PinnedArtifactWriteResult>;
  getText(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
};
type PinnedS3Options = {
  bucket: string;
  prefix?: string;
  region?: string;
  profile?: string;
  max_attempts?: number;
  server_side_encryption?: 'AES256' | 'aws:kms';
  kms_key_id?: string;
  client?: PinnedS3ClientLike;
};
type _ArtifactWrite = Expect<Equal<ArtifactSurface.ArtifactWrite, PinnedArtifactWrite>>;
type _ArtifactStore = Expect<Equal<ArtifactSurface.ArtifactStore, PinnedArtifactStore>>;
type _S3Options = Expect<Equal<ArtifactSurface.S3ArtifactStoreOptions, PinnedS3Options>>;
type _LocalConstructor = Expect<Equal<ConstructorParameters<typeof ArtifactSurface.LocalArtifactStore>, [root: string]>>;
type LocalPublic = PublicShape<InstanceType<typeof ArtifactSurface.LocalArtifactStore>>;
type PinnedLocalPublic = Omit<PinnedArtifactStore, 'type' | 'canRead' | 'canWrite'> & {
  readonly type: 'local'; readonly canRead: true; readonly canWrite: true;
};
type _LocalKeys = Expect<Equal<keyof LocalPublic, keyof PinnedLocalPublic>>;
type _LocalForward = Expect<LocalPublic extends PinnedLocalPublic ? true : false>;
type _LocalReverse = Expect<PinnedLocalPublic extends LocalPublic ? true : false>;
type _S3Constructor = Expect<Equal<ConstructorParameters<typeof ArtifactSurface.S3ArtifactStore>, [options: PinnedS3Options]>>;
type S3Public = PublicShape<InstanceType<typeof ArtifactSurface.S3ArtifactStore>>;
type PinnedS3Public = Omit<PinnedArtifactStore, 'type' | 'canRead' | 'canWrite'> & {
  readonly type: 's3'; readonly canRead: true; readonly canWrite: true;
};
type _S3Keys = Expect<Equal<keyof S3Public, keyof PinnedS3Public>>;
type _S3Forward = Expect<S3Public extends PinnedS3Public ? true : false>;
type _S3Reverse = Expect<PinnedS3Public extends S3Public ? true : false>;
type _RootS3Constructor = Expect<Equal<
  ConstructorParameters<typeof RootSurface.S3ArtifactStore>,
  ConstructorParameters<typeof ArtifactSurface.S3ArtifactStore>
>>;

type PinnedAuthConfig = {
  api_key: string;
  email?: string;
  org_id?: string;
  org_slug?: string;
  user_id?: string;
  api_url?: string;
  created_at: string;
};
type PinnedAuthStatus = {
  authenticated: boolean;
  source: 'env' | 'file' | 'none';
  api_url: string;
  auth_path: string;
  email: string | null;
  org_id: string | null;
  org_slug: string | null;
  user_id: string | null;
  api_key_present: boolean;
};
type Env = Record<string, string | undefined>;
type _AuthConfig = Expect<Equal<AuthSurface.KnowledgeAuthConfig, PinnedAuthConfig>>;
type _AuthStatus = Expect<Equal<AuthSurface.KnowledgeAuthStatus, PinnedAuthStatus>>;
type _AuthPath = Expect<Equal<typeof AuthSurface.knowledgeAuthPath, (env?: Env) => string>>;
type _GetAuth = Expect<Equal<typeof AuthSurface.getKnowledgeAuth, (env?: Env) => PinnedAuthConfig | null>>;
type _SaveAuth = Expect<Equal<
  typeof AuthSurface.saveKnowledgeAuth,
  (auth: Omit<PinnedAuthConfig, 'created_at'> & { created_at?: string }, env?: Env) => PinnedAuthConfig
>>;
type _ClearAuth = Expect<Equal<typeof AuthSurface.clearKnowledgeAuth, (env?: Env) => boolean>>;
type _ApiKey = Expect<Equal<
  ReturnType<typeof AuthSurface.getKnowledgeApiKey>,
  { apiKey: string | null; source: PinnedAuthStatus['source'] }
>>;

type _RemoteConstructor = Expect<Equal<
  ConstructorParameters<typeof RemoteSurface.RemoteKnowledgeClient>,
  [apiKey: string, apiUrl: string]
>>;
type PinnedRemoteClient = {
  registry(): Promise<RemoteSurface.RemoteKnowledgeRegistryContract>;
  search(request: RemoteSurface.RemoteKnowledgeSearchRequest): Promise<RemoteSurface.RemoteKnowledgeRunContract>;
  ask(request: RemoteSurface.RemoteKnowledgePromptRequest): Promise<RemoteSurface.RemoteKnowledgeRunContract>;
  build(request: RemoteSurface.RemoteKnowledgePromptRequest): Promise<RemoteSurface.RemoteKnowledgeRunContract>;
  sync(request?: RemoteSurface.RemoteKnowledgeSyncRequest): Promise<RemoteSurface.RemoteKnowledgeRunContract>;
  runStatus(runId: string): Promise<RemoteSurface.RemoteKnowledgeRunContract | null>;
  runLogs(runId: string): Promise<RemoteSurface.RemoteKnowledgeLogEntry[]>;
  runArtifacts(runId: string): Promise<RemoteSurface.RemoteKnowledgeArtifact[]>;
};
type _RemotePublic = Expect<Equal<
  PublicShape<InstanceType<typeof RemoteSurface.RemoteKnowledgeClient>>,
  PinnedRemoteClient
>>;
type _RootRemotePublic = Expect<Equal<
  PublicShape<InstanceType<typeof RootSurface.RemoteKnowledgeClient>>,
  PinnedRemoteClient
>>;

type _ProviderRegistry = Expect<Equal<
  ReturnType<typeof ProviderSurface.createAiSdkProviderRegistry>,
  Promise<import('ai').ProviderRegistryProvider<never, ':'>>
>>;
type _LanguageModel = Expect<Equal<
  ReturnType<typeof ProviderSurface.languageModelFor>,
  Promise<import('@ai-sdk/provider').LanguageModelV3>
>>;
type _ProviderUsageParameters = Expect<Equal<
  Parameters<typeof ProviderSurface.recordProviderUsage>,
  [
    db: KnowledgeDbSurface.KnowledgeDatabase,
    input: ProviderSurface.NormalizedProviderUsage & { run_id?: string | null; created_at?: string },
  ]
>>;

type PinnedStorageRemote = {
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  all(sql: string, ...params: unknown[]): Promise<unknown[]>;
  get?(sql: string, ...params: unknown[]): Promise<unknown | null>;
  close(): Promise<void>;
};
type PinnedStorageSyncOptions = {
  tables?: string[];
  scope?: string;
  cwd?: string;
  remote?: PinnedStorageRemote;
};
type PinnedSyncResult = { table: string; rowsRead: number; rowsWritten: number; errors: string[] };
type _StorageRemote = Expect<Equal<StorageSyncSurface.StorageRemoteAdapter, PinnedStorageRemote>>;
type _StorageOptions = Expect<Equal<StorageSyncSurface.StorageSyncOptions, PinnedStorageSyncOptions>>;
type _StoragePush = Expect<Equal<
  typeof StorageSyncSurface.storagePush,
  (options?: PinnedStorageSyncOptions) => Promise<PinnedSyncResult[]>
>>;
type _StoragePull = Expect<Equal<
  typeof StorageSyncSurface.storagePull,
  (options?: PinnedStorageSyncOptions) => Promise<PinnedSyncResult[]>
>>;
type _StorageSync = Expect<Equal<
  ReturnType<typeof StorageSyncSurface.storageSync>,
  Promise<{ pull: PinnedSyncResult[]; push: PinnedSyncResult[] }>
>>;
type _AlternateStoragePush = Expect<Equal<typeof StorageSurface.storagePush, typeof StorageSyncSurface.storagePush>>;
type _RootStoragePush = Expect<Equal<typeof RootSurface.storagePush, typeof StorageSyncSurface.storagePush>>;
type _PgAdapterConstructor = Expect<Equal<
  ConstructorParameters<typeof RemoteStorageSurface.PgAdapterAsync>,
  [connectionString: string]
>>;
type _PgAdapterGet = Expect<Equal<
  ReturnType<RemoteStorageSurface.PgAdapterAsync['get']>,
  Promise<QueryResultRow | null>
>>;

type PinnedPgExecutor = {
  query<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<{
    rows: T[];
    rowCount: number | null;
  }>;
};
type PinnedTypedQueryClient = {
  query<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  many<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  get<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  one<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T>;
  execute(sql: string, params?: readonly unknown[]): Promise<void>;
};
type _PgExecutor = Expect<Equal<StorageKitSurface.PgExecutor, PinnedPgExecutor>>;
type _TypedClient = Expect<Equal<StorageKitSurface.TypedQueryClient, PinnedTypedQueryClient>>;
type _PoolClient = Expect<Equal<
  StorageKitSurface.PoolQueryClient,
  {
    query<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }>;
    many<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T[]>;
    get<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T | null>;
    one<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T>;
    execute(sql: string, params?: readonly unknown[]): Promise<void>;
    readonly pool: Pool;
    transaction<T>(fn: (client: PinnedTypedQueryClient) => Promise<T>): Promise<T>;
    close(): Promise<void>;
  }
>>;
type PinnedMigration = { readonly id: string; readonly sql: string; readonly checksum: string };
type _Migration = Expect<Equal<StorageKitSurface.Migration, PinnedMigration>>;
type _LedgerConstructor = Expect<Equal<
  ConstructorParameters<typeof StorageKitSurface.MigrationLedger>,
  [
    client: StorageKitSurface.TypedQueryClient,
    migrations: readonly StorageKitSurface.Migration[],
    options?: StorageKitSurface.MigrationRunnerOptions,
  ]
>>;
type _LedgerMigrate = Expect<Equal<
  StorageKitSurface.MigrationLedger['migrate'],
  (opts?: { dryRun?: boolean }) => Promise<StorageKitSurface.MigrationResult>
>>;
type _KitVersion = Expect<Equal<typeof StorageKitSurface.KIT_VERSION, '0.4.0'>>;

type PinnedNoteInput = {
  title: string;
  content?: string;
  url?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
};
type PinnedServeNoteListOptions = {
  limit?: number;
  offset?: number;
  search?: string;
  includeArchived?: boolean;
};
type PinnedServeDeps = {
  client: StorageKitSurface.PoolQueryClient;
  verifier: ApiKeyVerifier;
  store: ApiKeyStore;
  version: string;
};
type _ServeDeps = Expect<Equal<ServeSurface.ServeDeps, PinnedServeDeps>>;
type _StartServe = Expect<Equal<
  ServeSurface.StartServeOptions,
  { port?: number; hostname?: string; env?: NodeJS.ProcessEnv }
>>;
type _NoteRepoConstructor = Expect<Equal<
  ConstructorParameters<typeof ServeSurface.NoteRepo>,
  [client: StorageKitSurface.PoolQueryClient]
>>;
type PinnedRepo = {
  create(input: PinnedServeNoteInput): Promise<StoreSurface.KnowledgeItem>;
  list(options?: PinnedServeNoteListOptions): Promise<{ items: StoreSurface.KnowledgeItem[]; total: number }>;
  get(idOrShort: string): Promise<StoreSurface.KnowledgeItem | null>;
  update(idOrShort: string, patch: Partial<PinnedServeNoteInput> & { archived?: boolean }): Promise<StoreSurface.KnowledgeItem | null>;
  delete(idOrShort: string): Promise<boolean>;
};
type _NoteRepo = Expect<Equal<PublicShape<InstanceType<typeof ServeSurface.NoteRepo>>, PinnedRepo>>;
type _RootNoteRepo = Expect<Equal<PublicShape<InstanceType<typeof RootSurface.NoteRepo>>, PinnedRepo>>;
type _ServiceOptions = Expect<Equal<ServiceSurface.KnowledgeServiceOptions, { scope?: string; cwd?: string }>>;
type _DbOpen = Expect<Equal<
  typeof KnowledgeDbSurface.openKnowledgeDb,
  (path: string) => KnowledgeDbSurface.KnowledgeDatabase
>>;
type _DbMigrate = Expect<Equal<
  typeof KnowledgeDbSurface.migrateKnowledgeDb,
  (path: string) => { path: string; schema_version: number }
>>;

type PinnedOutboxConsumeOptions = {
  dbPath: string;
  input: string;
  config?: RootSurface.KnowledgeConfig;
  safetyPolicy?: OutboxSurface.OutboxConsumeOptions['safetyPolicy'];
  now?: Date;
};
type _OutboxDirect = Expect<Equal<OutboxSurface.OutboxConsumeOptions, PinnedOutboxConsumeOptions>>;
type _OutboxDirectKeys = Expect<Equal<keyof OutboxSurface.OutboxConsumeOptions, keyof PinnedOutboxConsumeOptions>>;
type _OutboxDirectMapped = Expect<Equal<
  PublicShape<OutboxSurface.OutboxConsumeOptions>,
  PublicShape<PinnedOutboxConsumeOptions>
>>;
type _OutboxRoot = Expect<Equal<RootSurface.OutboxConsumeOptions, PinnedOutboxConsumeOptions>>;
type _OutboxRootKeys = Expect<Equal<keyof RootSurface.OutboxConsumeOptions, keyof PinnedOutboxConsumeOptions>>;
type _OutboxRootMapped = Expect<Equal<
  PublicShape<RootSurface.OutboxConsumeOptions>,
  PublicShape<PinnedOutboxConsumeOptions>
>>;

const fetchImpl = Object.assign(
  async () => new Response('{}', { status: 200 }),
  { preconnect() {} },
) as typeof fetch;
const options: KnowledgeApiClientOptions = {
  baseUrl: 'https://synthetic.invalid',
  apiKey: 'synthetic-not-a-secret',
  fetch: fetchImpl,
  headers: { 'x-synthetic': 'fixture' },
};
const generatedOptions: GeneratedKnowledgeApiClientOptions = options;
const input: KnowledgeNoteInput = { title: 'Title', tags: ['fixture'] };
const patch: KnowledgeNotePatch = { archived: true };

declare const compileOnly: boolean;
if (compileOnly) {
  const root = new KnowledgeApiClient(options);
  const generated = new GeneratedKnowledgeApiClient(generatedOptions);
  void root.createNote(input);
  void root.updateNote('id', patch);
  void root.getRegistry();
  void generated.createNote(input);
  void generated.updateNote('id', patch);
  void generated.getRegistry();
}
