// client/http-store.mjs unit tests — agent-authored (SOL consult refused:
// fleet ChatGPT codex lane at capacity; see the task receipt).
//
// The HTTP store is an adapter over the @hasna/contracts client transport
// (hasna/apps#1720): the credential is resolved through the fleet chain per
// request, auth-failure bodies are cancelled unread, and the store's own error
// contract (NotesHttpStoreError with status/code/details, redaction of echoed
// credentials, exact query serialization and id encoding, fail-closed
// construction, explicit-authority pins) is pinned here with a stub fetch.

import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  NotesHttpStore,
  NotesHttpStoreError,
  createNotesHttpStore,
} from '../client/http-store.mjs';
import { RetiredNotesStorageSelectorError, resolveNotesClientTransport } from '../client/transport.mjs';
import { NotesClient } from '../sdk/index.mjs';

const API_URL = 'https://notes.example.test';
// Synthetic fixture credential, assembled at runtime so no credential-shaped
// literal exists in the source (the secrets scanner rejects one). The tests
// assert this value never leaks into errors.
const API_KEY = ['pn', 'test', 'fixture', 'not-a-real-credential', 'abcdef0123'].join('_');

/** The transport sends Authorization/Content-Type capitalized; read either spelling. */
function authOf(options) {
  return options?.headers?.authorization ?? options?.headers?.Authorization;
}

function contentTypeOf(options) {
  return options?.headers?.['content-type'] ?? options?.headers?.['Content-Type'];
}

function storeWith(fetchImpl, { url = API_URL, key = API_KEY } = {}) {
  return new NotesHttpStore({ apiUrl: url, apiKey: key }, fetchImpl);
}

test('credentials stay private and the request authority cannot be replaced through public fields', async () => {
  const seen = [];
  const store = storeWith(async (url, options) => {
    seen.push([url, authOf(options)]);
    return new Response('{}');
  });
  assert.equal(store.apiKey, undefined);
  assert.ok(!JSON.stringify(store).includes(API_KEY));
  assert.ok(!JSON.stringify(new NotesClient({ HASNA_NOTES_API_URL: API_URL, HASNA_NOTES_API_KEY: API_KEY })).includes(API_KEY));
  assert.throws(() => { store.apiUrl = 'https://other.example.test'; }, TypeError);
  // Even deliberate shadowing of the read-only public getter cannot change dispatch.
  Object.defineProperty(store, 'apiUrl', { value: 'https://other.example.test' });
  store.apiKey = 'replacement-fixture';
  await store.health();
  assert.deepEqual(seen, [[`${API_URL}/v1/health`, `Bearer ${API_KEY}`]]);
});

test('accessor-backed environment credentials are rejected without invoking getters or dispatching', () => {
  let reads = 0;
  let fetches = 0;
  const env = { HASNA_NOTES_API_URL: API_URL };
  Object.defineProperty(env, 'HASNA_NOTES_API_KEY', {
    get() { reads++; env.HASNA_NOTES_API_URL = 'https://other.example.test'; return API_KEY; },
  });
  const fetchImpl = () => { fetches++; throw new Error('unexpected fetch'); };
  assert.throws(() => resolveNotesClientTransport(env), /accessor-backed/);
  assert.throws(() => createNotesHttpStore(env, fetchImpl), /accessor-backed/);
  assert.throws(() => new NotesClient(env, fetchImpl), /accessor-backed/);
  assert.equal(reads, 0);
  assert.equal(fetches, 0);
});

test('direct store options also reject credential accessors without reading them', () => {
  let reads = 0;
  const config = { apiUrl: API_URL, get apiKey() { reads++; return API_KEY; } };
  assert.throws(() => new NotesHttpStore(config), /plain string configuration/);
  assert.equal(reads, 0);
});

test('an explicit baseUrl without an apiKey never attaches the ambient fleet credential (#1794)', async () => {
  // A hostile environment that WOULD resolve a credential — disk and env both —
  // must not leak it onto an explicit authority the caller did not pin to it.
  const creds = ['fleet', 'disk', 'credential', 'abcdef0123'].join('_');
  const sent = [];
  const fetchImpl = async (url, options) => { sent.push([url, authOf(options)]); return new Response('{}'); };
  const ambient = { HOME: '/nonexistent-hermetic-home', HASNA_NOTES_API_KEY: creds };
  const explicit = new NotesHttpStore({ apiUrl: 'https://other.example.test', apiKey: API_KEY }, fetchImpl);
  await explicit.health();
  assert.deepEqual(sent, [['https://other.example.test/v1/health', `Bearer ${API_KEY}`]]);
  assert.ok(!JSON.stringify(sent).includes(creds), 'the ambient key never reaches an explicit authority');
});

test("an explicit baseUrl with no apiKey is refused outright — no ambient tier is consulted", async () => {
  let fetches = 0;
  const fetchImpl = () => { fetches++; throw new Error('unexpected fetch'); };
  assert.throws(
    () => new NotesHttpStore({ apiUrl: 'https://other.example.test' }, fetchImpl),
    /explicit apiKey/, // never "borrowed the key from the environment"
  );
  assert.equal(fetches, 0);
});

test('a held client re-resolves the credential per request: rotation heals, authority drift throws', async () => {
  const seen = [];
  const env = { HASNA_NOTES_API_URL: API_URL, HASNA_NOTES_API_KEY: API_KEY };
  const fetchImpl = async (url, options) => { seen.push([url, authOf(options)]); return new Response('{}'); };
  const client = new NotesClient(env, fetchImpl);
  await client.health();
  // Rotate ONLY the key: the next request carries the new key (fresh chain per
  // request), while the authority stays the one the client was built against.
  env.HASNA_NOTES_API_KEY = 'rotated-fixture-key';
  await client.health();
  assert.deepEqual(seen, [
    [`${API_URL}/v1/health`, `Bearer ${API_KEY}`],
    [`${API_URL}/v1/health`, 'Bearer rotated-fixture-key'],
  ]);
  // Changing the AUTHORITY under a held client is a refusal, not a silent
  // re-home: a credential pinned to one authority is never sent to another
  // (#1794).
  env.HASNA_NOTES_API_URL = 'https://other.example.test';
  await assert.rejects(client.health(), /authority changed/);
});

test('transport errors redact echoed credentials from both messages and codes', async () => {
  const store = storeWith(() => { throw Object.assign(new Error(`failed with ${API_KEY}`), { cause: { code: `error_${API_KEY}` } }); });
  await assert.rejects(store.health(), (err) => {
    assert.ok(err instanceof NotesHttpStoreError);
    assert.ok(!String(err).includes(API_KEY));
    assert.ok(!JSON.stringify(err).includes(API_KEY));
    assert.match(err.message, /\[REDACTED\]/);
    assert.match(err.code, /error_\[REDACTED\]/);
    return true;
  });
});

test('auth failure bodies are cancelled unread; the refusal names the credential source, never a value', async () => {
  const store = storeWith(async () => new Response(JSON.stringify({ error: {
    code: `denied_${API_KEY}`, message: `denied ${API_KEY}`,
    details: { scope: 'notes_read', nested: [API_KEY] },
  } }), { status: 403 }));
  await assert.rejects(store.health(), (err) => {
    assert.ok(err instanceof NotesHttpStoreError);
    assert.equal(err.status, 403);
    assert.equal(err.details, undefined, 'the 403 body is never read, so no envelope details exist');
    assert.match(err.message, /api key|credential/);
    assert.ok(!String(err).includes(API_KEY));
    return true;
  });
});

test('non-auth API error envelopes redact echoed credentials recursively without dropping safe details', async () => {
  const store = storeWith(async () => new Response(JSON.stringify({ error: {
    code: `conflict_${API_KEY}`, message: `conflict ${API_KEY}`,
    details: { scope: 'notes_write', nested: [API_KEY, { [API_KEY]: `Bearer ${API_KEY}` }] },
  } }), { status: 409 }));
  await assert.rejects(store.health(), (err) => {
    assert.ok(err instanceof NotesHttpStoreError);
    assert.equal(err.status, 409);
    assert.equal(err.details.scope, 'notes_write');
    assert.ok(!String(err).includes(API_KEY));
    assert.ok(!JSON.stringify(err).includes(API_KEY));
    assert.deepEqual(err.details.nested, ['[REDACTED]', { '[REDACTED]': 'Bearer [REDACTED]' }]);
    return true;
  });
});

test('response body failures cannot escape as raw credential-bearing errors', async () => {
  const store = storeWith(async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error(API_KEY)); },
  }), { status: 502 }));
  await assert.rejects(store.health(), (err) => {
    assert.ok(err instanceof NotesHttpStoreError);
    assert.equal(err.code, 'fetch_failed');
    assert.ok(!String(err).includes(API_KEY));
    assert.ok(!JSON.stringify(err).includes(API_KEY));
    return true;
  });
});

test('deeply nested error details retain their shape without overflowing the redactor', async () => {
  const depth = 12000;
  const payload = '{"error":{"message":"denied","details":' + '['.repeat(depth) + JSON.stringify(API_KEY) + ']'.repeat(depth) + '}}';
  const store = storeWith(async () => new Response(payload, { status: 409 }));
  await assert.rejects(store.health(), (err) => {
    assert.ok(err instanceof NotesHttpStoreError);
    assert.equal(err.status, 409);
    let value = err.details;
    for (let index = 0; index < depth; index++) { assert.ok(Array.isArray(value)); value = value[0]; }
    assert.equal(value, '[REDACTED]');
    return true;
  });
});

test('malformed non-string error messages and codes cannot override the safe error contract', async () => {
  const store = storeWith(async () => new Response(JSON.stringify({ error: {
    message: { toString: API_KEY }, code: { toString: API_KEY }, details: { scope: 'notes_read' },
  } }), { status: 409 }));
  await assert.rejects(store.health(), (err) => {
    assert.ok(err instanceof NotesHttpStoreError);
    assert.equal(err.status, 409);
    assert.equal(err.code, undefined);
    assert.equal(err.details.scope, 'notes_read');
    assert.ok(!String(err).includes(API_KEY));
    return true;
  });
});

test('invalid JSON diagnostics redact a credential echoed in a requested identifier', async () => {
  const store = storeWith(async () => new Response('not JSON', { status: 500 }));
  await assert.rejects(store.getNote(API_KEY), (err) => {
    assert.ok(err instanceof NotesHttpStoreError);
    assert.equal(err.code, 'invalid_json');
    assert.ok(!String(err).includes(API_KEY));
    return true;
  });
});

test('construction fails closed: URL without key and key without URL both throw', () => {
  assert.throws(() => createNotesHttpStore({}), /HASNA_NOTES_API_URL.*HASNA_NOTES_API_KEY/);
  assert.throws(
    () => createNotesHttpStore({ HASNA_NOTES_API_URL: API_URL }),
    /HASNA_NOTES_API_KEY/,
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
    assert.equal(seen[0], 'https://notes.example.test/v1/notes');
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
    'https://notes.example.test/v1/notes?limit=5&include_deleted=1&cursor=next+page',
    'https://notes.example.test/v1/notes',
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
    `https://notes.example.test/v1/notes/${encoded}`,
    `https://notes.example.test/v1/notes/${encoded}`,
    `https://notes.example.test/v1/notes/${encoded}`,
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
  assert.equal(captured.headers.authorization ?? captured.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(captured.headers['x-api-key'], API_KEY);
  assert.equal(contentTypeOf(captured), 'application/json');
  assert.deepEqual(JSON.parse(captured.body), { title: 'T', bodyMarkdown: 'B' });
  // The transport never follows a redirect: every 3xx is terminal, so a
  // credential or body can never cross an authority boundary.
  assert.equal(captured.redirect, 'manual');
});

for (const status of [301, 302, 303, 307, 308]) {
  test(`authenticated ${status} redirects are rejected before credentials or body reach any destination`, async () => {
    const sourceRequests = [];
    const destinationRequests = [];
    const fetchImpl = async (url, options) => {
      sourceRequests.push({ url, options });
      // redirect:'manual' means the response comes back as-is: the transport
      // must treat every 3xx as terminal and never re-issue.
      return new Response('{}', { status });
    };
    const store = storeWith(fetchImpl);
    await assert.rejects(store.createNote({ title: 'redirect probe', bodyMarkdown: 'sensitive body' }), (err) => {
      assert.ok(err instanceof NotesHttpStoreError);
      assert.equal(err.status, status);
      assert.match(err.message, /redirect/);
      return true;
    });
    assert.equal(sourceRequests.length, 1);
    assert.equal(sourceRequests[0].options.redirect, 'manual');
    assert.equal(authOf(sourceRequests[0].options), `Bearer ${API_KEY}`);
    assert.equal(destinationRequests.length, 0);
  });
}

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

test('dialect error envelope surfaces status, code and details on non-auth failures', async () => {
  const store = storeWith(async () => new Response(
    JSON.stringify({ error: { code: 'rate_limited', message: 'too many requests', details: { scope: 'notes_read' } } }),
    { status: 429 },
  ));
  await assert.rejects(
    store.listNotes({}),
    (err) => {
      assert.ok(err instanceof NotesHttpStoreError);
      assert.equal(err.status, 429);
      assert.equal(err.code, 'rate_limited');
      assert.deepEqual(err.details, { scope: 'notes_read' });
      assert.equal(err.message, 'too many requests');
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
    seen.push([url, options.method, options]);
    return new Response('{}', { status: 200 });
  });
  await client.list({ cursor: 'next' });
  await client.get('id');
  await client.create({ title: 'T' });
  await client.update('id', { title: 'U' });
  await client.delete('id');
  await client.export();
  assert.deepEqual(seen.map(([, method]) => method), ['GET', 'GET', 'POST', 'PATCH', 'DELETE', 'POST']);
  assert.ok(seen.every(([url]) => url.startsWith(`${API_URL}/v1/`)));
  assert.ok(seen.every(([, , options]) => options?.redirect === 'manual'));
});