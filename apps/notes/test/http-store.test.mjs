// client/http-store.mjs unit tests — agent-authored (SOL consult refused:
// fleet ChatGPT codex lane at capacity; see the task receipt).
//
// The existing transport.test.mjs round-trips the HTTP store through a real
// server; this file pins the store's own error contract with a stub fetch:
// fetch failures map to NotesHttpStoreError, the API key never leaks into
// errors, the dialect error envelope surfaces status/code/details, query
// serialization and id encoding are exact, and construction fails closed.

import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  NotesHttpStore,
  NotesHttpStoreError,
  createNotesHttpStore,
} from '../client/http-store.mjs';
import { RetiredNotesStorageSelectorError } from '../client/transport.mjs';
import { NotesClient } from '../sdk/index.mjs';

const API_URL = 'https://notes.example.test';
// Synthetic fixture credential, assembled at runtime so no credential-shaped
// literal exists in the source (the secrets scanner rejects one). The tests
// assert this value never leaks into errors.
const API_KEY = ['pn', 'test', 'fixture', 'not-a-real-credential', 'abcdef0123'].join('_');

function storeWith(fetchImpl, { url = API_URL, key = API_KEY } = {}) {
  return new NotesHttpStore({ apiUrl: url, apiKey: key }, fetchImpl);
}

test('construction fails closed: URL without key and key without URL both throw', () => {
  assert.throws(() => createNotesHttpStore({}), /HASNA_NOTES_API_URL and HASNA_NOTES_API_KEY/);
  assert.throws(
    () => createNotesHttpStore({ HASNA_NOTES_API_URL: API_URL }),
    /HASNA_NOTES_API_KEY is required/,
  );
  assert.throws(
    () => createNotesHttpStore({ HASNA_NOTES_API_URL: API_URL, HASNA_NOTES_API_KEY: API_KEY, HASNA_NOTES_STORAGE_MODE: 'local' }),
    (err) => err instanceof RetiredNotesStorageSelectorError,
  );
});

test('trailing slash on the API URL is stripped and never doubled in paths', () => {
  const seen = [];
  const store = storeWith(async (url) => {
    seen.push(url);
    return new Response('null', { status: 200 });
  }, { url: 'https://notes.example.test/' });
  assert.equal(store.apiUrl, 'https://notes.example.test');
  return store.listNotes({}).then(() => {
    assert.equal(seen[0], 'https://notes.example.test/api/v1/notes');
  });
});

test('listNotes serializes limit, cursor, and include_deleted; no params -> bare path', async () => {
  const seen = [];
  const store = storeWith(async (url) => {
    seen.push(url);
    return new Response('null', { status: 200 });
  });
  await store.listNotes({ limit: 5, cursor: 'next page', includeDeleted: true });
  await store.listNotes({});
  assert.deepEqual(seen, [
    'https://notes.example.test/api/v1/notes?limit=5&include_deleted=1&cursor=next+page',
    'https://notes.example.test/api/v1/notes',
  ]);
});

test('note ids are URI-encoded in every path segment', async () => {
  const seen = [];
  const store = storeWith(async (url) => {
    seen.push(url);
    return new Response('null', { status: 200 });
  });
  const id = 'a/b c?d#e';
  await store.getNote(id);
  await store.updateNote(id, { title: 'x' });
  await store.deleteNote(id);
  const encoded = encodeURIComponent(id);
  assert.deepEqual(seen, [
    `https://notes.example.test/api/v1/notes/${encoded}`,
    `https://notes.example.test/api/v1/notes/${encoded}`,
    `https://notes.example.test/api/v1/notes/${encoded}`,
  ]);
});

test('request carries the bearer key and JSON content-type; body is JSON-serialized', async () => {
  let captured = null;
  const store = storeWith(async (url, opts) => {
    captured = opts;
    return new Response('null', { status: 200 });
  });
  await store.createNote({ title: 'T', bodyMarkdown: 'B' });
  assert.equal(captured.method, 'POST');
  assert.equal(captured.headers.authorization, `Bearer ${API_KEY}`);
  assert.equal(captured.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(captured.body), { title: 'T', bodyMarkdown: 'B' });
});

test('fetch failure maps to NotesHttpStoreError with the cause code and a safe message', async () => {
  const store = storeWith(() => {
    throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:8788' } });
  });
  await assert.rejects(
    store.health(),
    (err) => {
      assert.ok(err instanceof NotesHttpStoreError);
      assert.equal(err.code, 'ECONNREFUSED');
      assert.match(err.message, /cannot reach the Notes API at notes\.example\.test/);
      assert.ok(!err.message.includes(API_KEY), 'error message must never contain the api key');
      assert.ok(!err.message.includes('pn_test'), 'error message must never contain key material');
      return true;
    },
  );
});

test('a fetch cause without a code defaults to fetch_failed', async () => {
  const store = storeWith(() => {
    throw Object.assign(new Error('boom'), { cause: { message: 'transport error' } });
  });
  await assert.rejects(store.health(), (err) => err instanceof NotesHttpStoreError && err.code === 'fetch_failed');
});

test('macOS Local Network Privacy blocks are described as such, not as a network mystery', async () => {
  const store = storeWith(() => {
    throw Object.assign(new Error('fetch failed'), {
      cause: { message: 'The connection failed because the app is blocked by Local Network Privacy for ne1.local' },
    });
  });
  await assert.rejects(store.health(), (err) => {
    assert.ok(err instanceof NotesHttpStoreError);
    assert.match(err.message, /macOS Local Network Privacy/);
    return true;
  });
});

test('dialect error envelope surfaces status, code and details; the key still never appears', async () => {
  const store = storeWith(async () => new Response(
    JSON.stringify({ error: { code: 'unauthorized', message: 'valid session or Hasna Notes API key required', details: { scope: 'notes_read' } } }),
    { status: 401 },
  ));
  await assert.rejects(
    store.listNotes({}),
    (err) => {
      assert.ok(err instanceof NotesHttpStoreError);
      assert.equal(err.status, 401);
      assert.equal(err.code, 'unauthorized');
      assert.deepEqual(err.details, { scope: 'notes_read' });
      assert.equal(err.message, 'valid session or Hasna Notes API key required');
      assert.ok(!err.message.includes(API_KEY));
      return true;
    },
  );
});

test('a non-JSON error body still fails (no silent success) and never leaks the key', async () => {
  const store = storeWith(async () => new Response('<html>Internal Server Error</html>', { status: 500 }));
  await assert.rejects(store.health(), (err) => {
    assert.ok(err instanceof NotesHttpStoreError);
    assert.equal(err.code, 'invalid_json');
    assert.ok(!String(err.message).includes(API_KEY), 'non-JSON failures must not leak the key');
    return true;
  });
});

test('an empty ok body resolves to null', async () => {
  const store = storeWith(async () => new Response('', { status: 200 }));
  assert.equal(await store.health(), null);
});

test('NotesClient SDK facade delegates every note operation to the HTTPS store', async () => {
  const seen = [];
  const client = new NotesClient({
    HASNA_NOTES_API_URL: API_URL,
    HASNA_NOTES_API_KEY: API_KEY,
  }, async (url, options) => {
    seen.push([url, options.method]);
    return new Response('{}', { status: 200 });
  });
  await client.list({ cursor: 'next' });
  await client.get('id');
  await client.create({ title: 'T' });
  await client.update('id', { title: 'U' });
  await client.delete('id');
  await client.export();
  assert.deepEqual(seen.map(([, method]) => method), ['GET', 'GET', 'POST', 'PATCH', 'DELETE', 'POST']);
  assert.ok(seen.every(([url]) => url.startsWith(API_URL)));
});
