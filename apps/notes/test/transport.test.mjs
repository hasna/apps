// Regression tests for the client transport resolver (client/transport.mjs).
//
// The two-backend contract: a Notes client has exactly two connections —
// the local SQLite+markdown store, or the server HTTP API selected by
// HASNA_NOTES_API_URL. An API URL without its key FAILS CLOSED. The client
// never reads HASNA_NOTES_DATABASE_URL and never opens PostgreSQL.
//
// This replaces the old sync/client.mjs selection, whose absence of a URL
// fell back to a localhost server default — the new resolver must stay
// on-box instead.

import { describe, expect, test } from 'bun:test';
import {
  NOTES_API_URL_ENV,
  NOTES_API_KEY_ENV,
  NOTES_DATABASE_URL_ENV,
  RETIRED_SELECTOR_ENV_KEYS,
  resolveNotesClientTransport,
} from '../client/transport.mjs';

function envWith(entries) {
  return { ...entries };
}

describe('notes client transport selection', () => {
  test('API URL + API key present -> http transport', () => {
    const report = resolveNotesClientTransport(
      envWith({ [NOTES_API_URL_ENV]: 'https://notes.example.test/v1', [NOTES_API_KEY_ENV]: 'k' }),
    );
    expect(report.transport).toBe('http');
    expect(report.source).toBe(NOTES_API_URL_ENV);
    expect(report.api_url_present).toBe(true);
    expect(report.api_key_present).toBe(true);
  });

  test('API URL present without API key -> fail closed (throws)', () => {
    expect(() =>
      resolveNotesClientTransport(envWith({ [NOTES_API_URL_ENV]: 'https://notes.example.test/v1' })),
    ).toThrow(new RegExp(NOTES_API_KEY_ENV));
  });

  test('no API URL -> local store transport, no localhost server fallback', () => {
    const report = resolveNotesClientTransport(envWith({}));
    expect(report.transport).toBe('local');
    expect(report.source).toBe('default');
    expect(report.api_url_present).toBe(false);
  });

  test('client ignores HASNA_NOTES_DATABASE_URL entirely (never selects http)', () => {
    // A database URL is server configuration; on the client it must not flip
    // the transport and must not be echoed anywhere in the report.
    const report = resolveNotesClientTransport(
      envWith({ [NOTES_DATABASE_URL_ENV]: 'postgres://user:pass@db.example.test/notes' }),
    );
    expect(report.transport).toBe('local');
    expect(JSON.stringify(report)).not.toContain('postgres://');
    expect(JSON.stringify(report)).not.toContain('DATABASE_URL');
  });

  test('retired selector env keys fail loud even when blank', () => {
    for (const key of RETIRED_SELECTOR_ENV_KEYS) {
      expect(() => resolveNotesClientTransport(envWith({ [key]: '' }))).toThrow(/retired/i);
    }
  });

  test('http transport requires the key at construction time too', async () => {
    const { createNotesHttpStore } = await import('../client/http-store.mjs');
    expect(() =>
      createNotesHttpStore(envWith({ [NOTES_API_URL_ENV]: 'https://notes.example.test/v1' })),
    ).toThrow(new RegExp(NOTES_API_KEY_ENV));
  });
});
