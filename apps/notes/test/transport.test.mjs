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

// The credential chain the resolver consults lives in @hasna/contracts; these
// tests pin the NOTES side of that seam: the report shape, the fail-closed
// surface, safe-URL enforcement, the retired-selector ratchet, and process
// behaviour. The chain tiers themselves (Keychain, disk file, env, default
// gateway) are exercised hermetically in test/resolver.test.mjs.
function cleanProcessEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of [
    NOTES_API_URL_ENV,
    NOTES_API_KEY_ENV,
    NOTES_DATABASE_URL_ENV,
    'HASNA_NOTES_API_KEY_OVERRIDE',
    'HASNA_NOTES_API_KEY_REF',
    'HASNA_PROFILE',
    'HASNA_HOME',
    'HASNA_CONFIG_HOME',
    ...RETIRED_SELECTOR_ENV_KEYS,
  ]) {
    if (!(key in extra)) delete env[key];
  }
  return env;
}

describe('canonical Notes client transport', () => {
  test('resolves the URL + key pair and reports the /v1 authority root', () => {
    const report = resolveNotesClientTransport({
      [NOTES_API_URL_ENV]: 'https://notes.example.test',
      [NOTES_API_KEY_ENV]: 'secret',
    });
    expect(report).toEqual({
      transport: 'http',
      baseUrl: 'https://notes.example.test/v1',
      source: 'HASNA_NOTES_API_URL',
      apiUrlSource: 'HASNA_NOTES_API_URL',
      apiKeySource: 'HASNA_NOTES_API_KEY',
      apiKeyTier: 'env',
      api_url_present: true,
      api_key_present: true,
      scheme: 'https',
      localFallback: false,
      clientDatabaseDsn: false,
      warning: null,
    });
  });

  test('missing, partial, and blank configuration fails closed', () => {
    for (const env of [
      {},
      { [NOTES_API_URL_ENV]: 'https://notes.example.test' },
      { [NOTES_API_URL_ENV]: ' ', [NOTES_API_KEY_ENV]: ' ' },
      { [NOTES_API_URL_ENV]: ' ', [NOTES_API_KEY_ENV]: 'secret' },
    ]) {
      expect(() => resolveNotesClientTransport(env)).toThrow(/required|refus|blank/i);
    }
    // A KEY ALONE is NOT a refusal: the chain resolves the fleet gateway
    // default once a credential exists (see resolver.test.mjs). The
    // no-key arm of the refusal is `{}` above.
    expect(resolveNotesClientTransport({ [NOTES_API_KEY_ENV]: 'secret' }).baseUrl)
      .toBe('https://api.hasna.com/notes/v1');
  });

  test('rejects unsafe authorities and client DSNs', () => {
    // http is refused unless the authority is an exact loopback.
    expect(() => resolveNotesClientTransport({
      [NOTES_API_URL_ENV]: 'http://notes.example.test',
      [NOTES_API_KEY_ENV]: 'secret',
    })).toThrow(/loopback/);
    for (const url of [
      'https://user:pass@notes.example.test',
      'https://notes.example.test?q=1',
      'https://notes.example.test/#fragment',
      'not-a-url',
    ]) {
      expect(() => resolveNotesClientTransport({
        [NOTES_API_URL_ENV]: url,
        [NOTES_API_KEY_ENV]: 'secret',
      })).toThrow(/Invalid API URL|credentials|query|fragment|absolute/i);
    }
    expect(() => resolveNotesClientTransport({
      [NOTES_API_URL_ENV]: 'https://notes.example.test',
      [NOTES_API_KEY_ENV]: 'secret',
      [NOTES_DATABASE_URL_ENV]: 'postgres://user:password@example.test/notes',
    })).toThrow(/server-only/);
  });

  test('the URL without a key can still resolve the fleet gateway when the credential tier allows', () => {
    // A URL with no key is a refusal on every surface — the chain never
    // fabricates a credential. The reverse (key without URL) resolves the
    // default gateway; that arm is covered hermetically in resolver.test.mjs.
    expect(() => resolveNotesClientTransport({ [NOTES_API_URL_ENV]: 'https://notes.example.test' }))
      .toThrow(/no API key could be resolved/);
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
      expect(result.stderr).not.toMatch(/local mode/i);
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