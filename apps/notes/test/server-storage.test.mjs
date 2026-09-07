import { expect, test } from 'bun:test';
import { requirePostgresDsn, openStorage } from '../server/storage.mjs';
import { createApp, resolveConfig } from '../server/app.mjs';
import { openDb } from '../server/db.mjs';

test('server never defaults to SQLite or inherits a prototype DSN', () => {
  for (const env of [{}, { HASNA_NOTES_DATABASE_URL: '' }, { HASNA_NOTES_DATABASE_URL: '  ' },
    Object.create({ HASNA_NOTES_DATABASE_URL: 'postgresql://example.test/notes' })]) {
    expect(() => openStorage(env)).toThrow(/required/);
  }
});

test('server accepts only syntactically valid canonical PostgreSQL URLs without connecting', () => {
  for (const value of ['sqlite:/tmp/store', 'https://example.test/notes', 'not-a-url', 'postgresql://example.test',
    'postgresql://example.test/notes#fragment']) {
    expect(() => requirePostgresDsn({ HASNA_NOTES_DATABASE_URL: value })).toThrow(/valid PostgreSQL URL/);
  }
  expect(requirePostgresDsn({ HASNA_NOTES_DATABASE_URL: 'postgresql://example.test/notes' }).resolution.backend).toBe('postgresql');
});

test('retired storage-mode selectors are inert on the server too', () => {
  for (const key of ['HASNA_NOTES_STORAGE_MODE', 'HASNA_NOTES_MODE', 'NOTES_STORAGE_MODE', 'NOTES_MODE',
    'HASNA_NOTES_SERVER_DB', 'HASNA_NOTES_DB_PATH']) {
    const resolved = requirePostgresDsn({ [key]: 'anything', HASNA_NOTES_DATABASE_URL: 'postgresql://example.test/notes' });
    expect(resolved.resolution.backend).toBe('postgresql');
    expect(() => requirePostgresDsn({ [key]: 'anything' })).toThrow(/required/);
  }
});

test('NOTES_DATABASE_URL is honoured as the vendored kit alias', () => {
  const viaAlias = requirePostgresDsn({ NOTES_DATABASE_URL: 'postgresql://alias.example.test/notes' });
  expect(viaAlias.resolution.source).toBe('NOTES_DATABASE_URL');
  const both = requirePostgresDsn({
    HASNA_NOTES_DATABASE_URL: 'postgresql://alias.example.test/notes',
    NOTES_DATABASE_URL: 'postgresql://alias.example.test/notes',
  });
  expect(both.resolution.source).toBe('HASNA_NOTES_DATABASE_URL');
  expect(() => requirePostgresDsn({
    HASNA_NOTES_DATABASE_URL: 'postgresql://one.example.test/notes',
    NOTES_DATABASE_URL: 'postgresql://two.example.test/notes',
  })).toThrow(/disagree/);
  expect(() => requirePostgresDsn({ NOTES_DATABASE_URL: '' })).toThrow(/required/);
});

test('the removed --db flag still fails loud; retired server DB selectors no longer block startup', () => {
  expect(() => resolveConfig({}, ['--db', 'ignored.db'])).toThrow(/removed/);
  expect(() => resolveConfig({}, ['--db=ignored.db'])).toThrow(/removed/);
  expect(resolveConfig({ HASNA_NOTES_SERVER_DB: '' })).toBeTruthy();
});

test('SQLite is rejected unless explicitly injected as an isolated test fixture', async () => {
  const db = openDb(':memory:');
  try {
    await expect(createApp({ db, config: {} })).rejects.toThrow(/PostgreSQL is required/);
    const app = await createApp({ db, config: { jwtSecret: 'test-only', log() {} }, testOnlySqlite: true });
    expect((await app.request('/health')).status).toBe(200);
  } finally { db.close(); }
});
