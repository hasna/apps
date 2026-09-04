import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  NOTES_API_KEY_ENV,
  NOTES_API_URL_ENV,
  NOTES_DATABASE_URL_ENV,
  RETIRED_SELECTOR_ENV_KEYS,
  resolveNotesClientTransport,
} from '../client/transport.mjs';

const REPO = join(import.meta.dir, '..');

function cleanProcessEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of [NOTES_API_URL_ENV, NOTES_API_KEY_ENV, NOTES_DATABASE_URL_ENV, ...RETIRED_SELECTOR_ENV_KEYS]) {
    delete env[key];
  }
  return { ...env, ...extra };
}

describe('canonical Notes client transport', () => {
  test('requires the canonical URL and key together', () => {
    const report = resolveNotesClientTransport({
      [NOTES_API_URL_ENV]: 'https://notes.example.test/v1',
      [NOTES_API_KEY_ENV]: 'secret',
    });
    expect(report).toEqual({
      transport: 'http',
      source: 'HASNA_NOTES_API_URL+HASNA_NOTES_API_KEY',
      api_url_present: true,
      api_key_present: true,
      scheme: 'https',
    });
  });

  test('missing, partial, and blank configuration fails closed', () => {
    for (const env of [
      {},
      { [NOTES_API_URL_ENV]: 'https://notes.example.test' },
      { [NOTES_API_KEY_ENV]: 'secret' },
      { [NOTES_API_URL_ENV]: ' ', [NOTES_API_KEY_ENV]: ' ' },
    ]) {
      expect(() => resolveNotesClientTransport(env)).toThrow(/required|incomplete/i);
    }
  });

  test('requires safe HTTPS and rejects client DSNs', () => {
    for (const url of [
      'http://notes.example.test',
      'https://user:pass@notes.example.test',
      'https://notes.example.test?q=1',
      'https://notes.example.test/#fragment',
      'not-a-url',
    ]) {
      expect(() => resolveNotesClientTransport({
        [NOTES_API_URL_ENV]: url,
        [NOTES_API_KEY_ENV]: 'secret',
      })).toThrow(/HTTPS URL/i);
    }
    expect(() => resolveNotesClientTransport({
      [NOTES_API_URL_ENV]: 'https://notes.example.test',
      [NOTES_API_KEY_ENV]: 'secret',
      [NOTES_DATABASE_URL_ENV]: 'postgres://user:password@example.test/notes',
    })).toThrow(/server-only/);
  });

  test('retired selectors fail loud even when blank', () => {
    for (const key of RETIRED_SELECTOR_ENV_KEYS) {
      expect(() => resolveNotesClientTransport({ [key]: '' })).toThrow(/retired/i);
    }
  });

  test('CLI missing configuration fails without creating legacy or XDG data', () => {
    const home = mkdtempSync(join(tmpdir(), 'notes-fail-closed-'));
    try {
      const result = spawnSync('bun', [join(REPO, 'cli/notes.mjs'), 'list', '--json'], {
        env: cleanProcessEnv({ HOME: home, HASNA_DATA_HOME: join(home, 'xdg-data') }),
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/HASNA_NOTES_API_URL/);
      expect(existsSync(join(home, '.hasna'))).toBe(false);
      expect(existsSync(join(home, 'xdg-data'))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('static help and version do not require client configuration', () => {
    for (const args of [['--help'], ['--version']]) {
      const result = spawnSync('bun', [join(REPO, 'cli/notes.mjs'), ...args], {
        env: cleanProcessEnv(),
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim().length).toBeGreaterThan(0);
    }
  });
});
