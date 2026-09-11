import * as root from '@hasna/notes';
import {
  NotesClient, NotesHttpStore, NotesHttpStoreError, RetiredNotesStorageSelectorError,
  createNotesHttpStore, resolveNotesClientStore, resolveNotesClientTransport,
  assertNoRetiredNotesStorageSelector, NOTES_APP_SLUG, NOTES_API_URL_ENV,
  NOTES_API_KEY_ENV, NOTES_DATABASE_URL_ENV, NOTES_API_URL_ENV_KEYS,
  NOTES_API_KEY_ENV_KEYS, RETIRED_SELECTOR_ENV_KEYS, NOTES_CLIENT_TRANSPORTS,
  type Note, type NoteInput, type NoteUpdate, type NotesEnvironment,
  type NotesPage, type NotesExport, type NotesDeleteResult, type NotesHealth,
  type NotesTransportReport, type NotesStoreConfiguration, type NotesErrorOptions,
  type NotesRequestOptions, type JsonValue,
} from '@hasna/notes/sdk';
import { NotesClient as BrowserClient } from '@hasna/notes/sdk/browser';

type NotAny<T> = 0 extends (1 & T) ? false : true;
type Assert<T extends true> = T;
type ReturnedNoteIsTyped = Assert<NotAny<Awaited<ReturnType<NotesClient['get']>>>>;
type ReturnedTitleIsTyped = Assert<NotAny<Awaited<ReturnType<NotesClient['get']>>['title']>>;
type RootReturnIsTyped = Assert<NotAny<Awaited<ReturnType<root.NotesClient['export']>>['notes'][number]>>;

// Compiled only: no credentials are resolved and no application request is sent.
async function consumer(env: NotesEnvironment, fetchImpl: typeof fetch) {
  const client: root.NotesClient = new NotesClient(env, fetchImpl);
  const input: NoteInput = { title: 'Typed note', bodyMarkdown: 'Body', labels: ['typed'], frontmatterJson: { nested: [true, null, 3] } };
  const created: Note = await client.create(input);
  const inferred = await client.get(created.id);
  const text: string = inferred.bodyMarkdown;
  const seq: number = inferred.seq;
  const purge: string | null = inferred.purgedAt;
  const page: NotesPage = await client.list({ limit: 2, cursor: 's:1', includeDeleted: true });
  const titles: string[] = page.data.map((note) => note.title);
  const next: string | null = page.nextCursor;
  const update: NoteUpdate = { folder: null, pinned: true, archived: false };
  const updated: Note = await client.update(created.id, update);
  const deleted: NotesDeleteResult = await client.delete(created.id);
  const literal: true = deleted.deleted;
  const health: NotesHealth = await client.health();
  const healthy: 'healthy' = health.status;
  const exported: NotesExport = await client.export();
  const exportedTitles: string[] = exported.notes.map((note) => note.title);
  const config: NotesStoreConfiguration = { apiUrl: 'https://notes.example.test', apiKey: 'fictional' };
  const store = new NotesHttpStore(config, fetchImpl);
  const generated: NotesHttpStore = createNotesHttpStore(env, fetchImpl);
  const storeNote: Note = await store.createNote(input);
  const storeGet: Note = await store.getNote(created.id);
  const storeUpdate: Note = await store.updateNote(created.id, update);
  const storeDelete: NotesDeleteResult = await store.deleteNote(created.id);
  const storeExport: NotesExport = await store.exportNotes();
  const storePage: NotesPage = await store.listNotes();
  const storeHealth: NotesHealth = await store.health();
  const request: NotesRequestOptions = { query: { cursor: 's:1' }, body: null };
  const unknownBody: unknown = await store.request('GET', '/notes', request);
  const options: NotesErrorOptions = { status: 409, code: 'conflict', details: { id: created.id } };
  const error = new NotesHttpStoreError('Conflict', options);
  const details: unknown = error.details;
  const mapped: NotesHttpStoreError = store.mapTransportError(error, 'GET', '/notes');
  const retired: Error = new RetiredNotesStorageSelectorError('NOTES_MODE');
  const report: NotesTransportReport = resolveNotesClientTransport(env, { keychain: { enabled: false } });
  const resolved = resolveNotesClientStore(env);
  const http: 'http' = resolved.transport;
  const noFallback: false = report.localFallback;
  assertNoRetiredNotesStorageSelector(env);
  const slug: 'notes' = NOTES_APP_SLUG;
  const keys: string[] = [...NOTES_API_URL_ENV_KEYS, ...NOTES_API_KEY_ENV_KEYS, ...RETIRED_SELECTOR_ENV_KEYS, ...NOTES_CLIENT_TRANSPORTS];
  const json: JsonValue = { typed: [1, true, null] };
  void [text, seq, purge, titles, next, updated, literal, healthy, exportedTitles, generated, storeNote, storeGet, storeUpdate, storeDelete, storeExport, storePage, storeHealth, unknownBody, details, mapped, retired, http, noFallback, slug, keys, json, NOTES_API_URL_ENV, NOTES_API_KEY_ENV, NOTES_DATABASE_URL_ENV];
  // @ts-expect-error Returned fields are inferred, not any.
  const invalidNumber: number = inferred.bodyMarkdown;
  // @ts-expect-error IDs are strings.
  client.get(1);
  // @ts-expect-error Note input fields retain their types.
  client.create({ title: 12 });
  // @ts-expect-error List limits are numeric.
  client.list({ limit: '2' });
  // @ts-expect-error Classic pagination has no hasMore field.
  page.hasMore;
  // @ts-expect-error Classic PATCH has no optimistic concurrency guarantee.
  client.update(created.id, { baseRevision: 1 });
  // @ts-expect-error The explicit store config requires a credential.
  new NotesHttpStore({ apiUrl: 'https://notes.example.test' });
  // @ts-expect-error A raw request returns unknown until the caller validates it.
  const raw: string = await store.request('GET', '/notes');
  // @ts-expect-error Export notes remain typed through the package root.
  const wrong: number = (await new root.NotesClient(env, fetchImpl).export()).notes[0]!.title;
  // @ts-expect-error The classic facade does not expose the browser changes API.
  client.changes();
}

// The separately published browser API keeps its distinct constructor/methods.
async function browserConsumer() {
  const browser = new BrowserClient({ apiBase: 'https://notes.example.test/v1/', credential: async () => 'fictional' });
  const changes = await browser.changes();
  const cursor: string | null = changes.cursor;
  // @ts-expect-error Browser constructor requires a credential provider.
  new BrowserClient({ apiBase: 'https://notes.example.test', credential: 'fictional' });
  return cursor;
}
void [consumer, browserConsumer];
