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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
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

// ── CLI data path over the wire dialect ─────────────────────────────────────
// The ship proof: a CLI note command must round-trip through
// HASNA_NOTES_API_URL + HASNA_NOTES_API_KEY against a real running server —
// the client is a plain HTTP API client when configured, never a silent
// local fallback. Boots server/index.mjs in-process-free (real TCP), mints an
// API key via the OTP login flow, then drives the CLI binary.

describe('CLI note commands over the HTTP transport', () => {
  test('notes create + list + get round-trip through a real server', async () => {
    const repo = join(import.meta.dir, '..');
    const dir = mkdtempSync(join(tmpdir(), 'notes-cli-http-'));

    const proc = Bun.spawn(['bun', join(repo, 'server/index.mjs')], {
      env: {
        ...process.env,
        HASNA_NOTES_SERVER_PORT: '0',
        HASNA_NOTES_SERVER_DB: join(dir, 'server.db'),
        HASNA_NOTES_SERVER_AUTO_APPROVE: '1',
        HASNA_NOTES_SERVER_DEV: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    let url;
    try {
      let out = '';
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      while (!/listening on (http:\/\/\S+)/.test(out)) {
        const { value, done } = await reader.read();
        if (done) break;
        out += decoder.decode(value);
      }
      url = /listening on (http:\/\/\S+)/.exec(out)?.[1];
      expect(url).toBeTruthy();

      // OTP login mints the api key (auto-approve + dev mode gives devCode).
      const started = await (await fetch(`${url}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'cli-http@example.test' }),
      })).json();
      const verified = await (await fetch(`${url}/api/v1/auth/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'cli-http@example.test', code: started.devCode }),
      })).json();
      expect(verified.apiKey).toBeTruthy();

      const cliEnv = {
        ...process.env,
        HASNA_NOTES_API_URL: url,
        HASNA_NOTES_API_KEY: verified.apiKey,
        HASNA_NOTES_ROOT: join(dir, 'notes-root'),
      };
      const run = (args) =>
        spawnSync('bun', [join(repo, 'cli/notes.mjs'), ...args], { env: cliEnv, encoding: 'utf8' });

      const created = run(['create', '--title', 'over-the-wire', '--body', 'dialect body', '--json']);
      expect(created.status).toBe(0);
      const note = JSON.parse(created.stdout);
      expect(note.id).toBeTruthy();
      expect(note.title).toBe('over-the-wire');
      expect(note.bodyMarkdown).toBe('dialect body');

      const listed = run(['list', '--json']);
      expect(listed.status).toBe(0);
      const page = JSON.parse(listed.stdout);
      expect(page.items.some((n) => n.id === note.id)).toBe(true);

      const fetched = run(['get', note.id, '--json']);
      expect(fetched.status).toBe(0);
      expect(JSON.parse(fetched.stdout).bodyMarkdown).toBe('dialect body');

      const deleted = run(['delete', note.id, '--yes', '--json']);
      expect(deleted.status).toBe(0);
      expect(JSON.parse(deleted.stdout).deleted).toBe(true);
    } finally {
      proc.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  test('notes --version prints the package version', () => {
    const repo = join(import.meta.dir, '..');
    const res = spawnSync('bun', [join(repo, 'cli/notes.mjs'), '--version'], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
