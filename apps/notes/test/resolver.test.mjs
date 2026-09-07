// Hermetic credential-resolver tests (checklist 6): fake HOME/HASNA_HOME,
// injected `security` runner, no ambient machine state.
//
// The credential chain itself lives in @hasna/contracts; these tests pin what
// NOTES guarantees on top of it: the tiers resolve (Keychain with an injected
// runner, the owner-only credentials file under a fake HOME, the canonical env
// var, the default fleet gateway), fail-closed is loud and side-effect free,
// and the transport report names sources without ever carrying values.

import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  resolveNotesClientTransport,
  NOTES_API_URL_ENV,
  NOTES_API_KEY_ENV,
  NOTES_APP_SLUG,
} from '../client/transport.mjs';
import { createNotesHttpStore } from '../client/http-store.mjs';
import { NotesClient } from '../sdk/index.mjs';

const REPO = join(import.meta.dir, '..');

function fakeHome() {
  const dir = mkdtempSync(join(tmpdir(), 'notes-resolver-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function writeCredentialFile(dir, { key, url, hasnaRoot } = {}) {
  const base = hasnaRoot ?? join(dir, '.hasna');
  const configDir = join(base, NOTES_APP_SLUG, 'config');
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const lines = [];
  if (key) lines.push(`HASNA_NOTES_API_KEY=${key}`);
  if (url) lines.push(`HASNA_NOTES_API_URL=${url}`);
  const path = join(configDir, 'credentials');
  writeFileSync(path, lines.join('\n') + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/** A hermetic env: no HOME/HASNA_HOME unless supplied, nothing ambient. */
function envWith(extra = {}) {
  const env = { ...extra };
  return env;
}

/** Injected Keychain `security` runner. The api-url item is absent (exit 44)
 * unless a `url` is supplied, so a key-only fixture does not configure an
 * authority from the Keychain by accident. */
function keychainRunner({ status = 0, stdout = 'keychain-key', stderr = '', url } = {}) {
  const calls = [];
  const run = (argv) => {
    calls.push([...argv]);
    if (argv.some((arg) => arg.endsWith('.api-url'))) {
      if (url) return { status: 0, stdout: url, stderr: '' };
      return { status: 44, stdout: '', stderr: '' };
    }
    return { status, stdout, stderr };
  };
  return { run, calls };
}

const keychainOptions = (runner) => ({
  keychain: { platform: 'darwin', hostname: () => 'station-test', run: runner.run },
});

describe('credential resolution through the @hasna/contracts chain', () => {
  test('Keychain tier resolves with an injected security runner (darwin)', () => {
    const { run, calls } = keychainRunner();
    const report = resolveNotesClientTransport(envWith(), keychainOptions({ run }));
    expect(report.apiKeyTier).toBe('keychain');
    expect(report.apiKeySource).toBe('keychain:hasna.credentials.notes.api-key@station-test');
    // No URL anywhere: a key alone is complete configuration — the authority
    // defaults to the fleet gateway, with /v1 appended by the resolver.
    expect(report.apiUrlSource).toBe('default');
    expect(report.baseUrl).toBe('https://api.hasna.com/notes/v1');
    expect(calls).toEqual([
      ['find-generic-password', '-a', 'station-test', '-s', 'hasna.credentials.notes.api-url', '-w'],
      ['find-generic-password', '-a', 'station-test', '-s', 'hasna.credentials.notes.api-key', '-w'],
    ]);
  });

  test('Keychain url item is consulted for the authority when the key comes from the chain', () => {
    const { run } = keychainRunner({ url: 'https://pn.example.test' });
    const report = resolveNotesClientTransport(envWith(), keychainOptions({ run }));
    expect(report.apiKeyTier).toBe('keychain');
    expect(report.apiUrlSource).toBe('keychain:hasna.credentials.notes.api-url@station-test');
    expect(report.baseUrl).toBe('https://pn.example.test/v1');
  });

  test('disk tier resolves under a fake HOME from the owner-only credentials file', () => {
    const home = fakeHome();
    try {
      const path = writeCredentialFile(home.dir, { key: 'disk-key', url: 'https://disk.example.test' });
      const report = resolveNotesClientTransport(envWith({ HOME: home.dir }));
      expect(report.apiKeyTier).toBe('disk');
      expect(report.apiKeySource).toBe(path);
      expect(report.apiUrlSource).toBe(path);
      expect(report.baseUrl).toBe('https://disk.example.test/v1');
    } finally {
      home.cleanup();
    }
  });

  test('HASNA_HOME replaces the ~/.hasna root', () => {
    const home = fakeHome();
    try {
      const root = join(home.dir, 'custom-hasna-root');
      const path = writeCredentialFile(home.dir, { key: 'root-key', hasnaRoot: root });
      const report = resolveNotesClientTransport(envWith({ HASNA_HOME: root }));
      expect(report.apiKeyTier).toBe('disk');
      expect(report.apiKeySource).toBe(path);
      expect(report.apiUrlSource).toBe('default');
    } finally {
      home.cleanup();
    }
  });

  test('a credential file that is not owner-only fails loud', () => {
    const home = fakeHome();
    try {
      const path = writeCredentialFile(home.dir, { key: 'loose-key' });
      chmodSync(path, 0o644);
      expect(() => resolveNotesClientTransport(envWith({ HOME: home.dir })))
        .toThrow(/owner-only|permission mode/);
    } finally {
      home.cleanup();
    }
  });

  test('env tier resolves from the canonical key; the authority defaults to the fleet gateway', () => {
    const report = resolveNotesClientTransport(envWith({ [NOTES_API_KEY_ENV]: 'env-key' }));
    expect(report.apiKeyTier).toBe('env');
    expect(report.apiKeySource).toBe('HASNA_NOTES_API_KEY');
    expect(report.apiUrlSource).toBe('default');
    expect(report.baseUrl).toBe('https://api.hasna.com/notes/v1');
  });

  test('explicit URL env plus env key yields the /v1 authority root', () => {
    const report = resolveNotesClientTransport(envWith({
      [NOTES_API_URL_ENV]: 'https://pn.example.test/',
      [NOTES_API_KEY_ENV]: 'env-key',
    }));
    expect(report.baseUrl).toBe('https://pn.example.test/v1');
    expect(report.scheme).toBe('https');
  });

  test('an unresolvable Keychain item is a loud error, never a silent skip', () => {
    const { run } = keychainRunner({ status: 3, stdout: '', stderr: 'user canceled' });
    expect(() => resolveNotesClientTransport(envWith(), keychainOptions({ run })))
      .toThrow(/Keychain/);
  });

  test('a missing Keychain item (exit 44) is an absent tier: env key still resolves', () => {
    const { run } = keychainRunner({ status: 44, stdout: '', stderr: '' });
    const report = resolveNotesClientTransport(envWith({ [NOTES_API_KEY_ENV]: 'env-key' }), keychainOptions({ run }));
    expect(report.apiKeyTier).toBe('env');
    expect(report.baseUrl).toBe('https://api.hasna.com/notes/v1');
    // Same absence, no other tier: still fails closed.
    expect(() => resolveNotesClientTransport(envWith(), keychainOptions({ run })))
      .toThrow(/no API key could be resolved/);
  });
});

describe('fail-closed', () => {
  test('no credential anywhere: every surface throws, writes nothing, resolves no local mode', () => {
    const home = fakeHome();
    try {
      const env = envWith({ HOME: home.dir }); // empty fake home: no disk credential
      expect(() => resolveNotesClientTransport(env)).toThrow(/no API key could be resolved/);
      expect(() => createNotesHttpStore(env)).toThrow(/no API key could be resolved/);
      expect(() => new NotesClient(env)).toThrow(/no API key could be resolved/);
      // The fail-closed path never created any data root (contracts only reads).
      expect(existsSync(join(home.dir, '.hasna'))).toBe(false);
    } finally {
      home.cleanup();
    }
  });

  test('CLI failure is a non-zero exit with no local-fallback notice and no data dirs', () => {
    const home = fakeHome();
    try {
      const result = spawnSync('bun', [join(REPO, 'bin/notes.mjs'), 'list', '--limit', '1', '--json'], {
        env: envWith({ HOME: home.dir, PATH: process.env.PATH ?? '' }),
        encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/no API key could be resolved/);
      expect(result.stderr).not.toMatch(/local mode/i);
      expect(existsSync(join(home.dir, '.hasna'))).toBe(false);
    } finally {
      home.cleanup();
    }
  });
});

describe('transport report', () => {
  test('storage status reports sources and tiers, never values', () => {
    const home = fakeHome();
    try {
      const path = writeCredentialFile(home.dir, { key: 'status-key', url: 'https://status.example.test' });
      const result = spawnSync('bun', [join(REPO, 'bin/notes.mjs'), 'storage', 'status', '--json'], {
        env: envWith({ HOME: home.dir, PATH: process.env.PATH ?? '' }),
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.client.transport).toBe('http');
      expect(report.client.baseUrl).toBe('https://status.example.test/v1');
      expect(report.client.apiUrlSource).toBe(path);
      expect(report.client.apiKeySource).toBe(path);
      expect(report.client.apiKeyTier).toBe('disk');
      expect(report.client.scheme).toBe('https');
      expect(report.localFallback).toBe(false);
      expect(report.clientDatabaseDsn).toBe(false);
      expect(result.stderr).toBe('');
      expect(result.stdout).not.toContain('status-key');
    } finally {
      home.cleanup();
    }
  });

  test('the SDK report carries the same shape through resolveNotesClientStore', async () => {
    const { resolveNotesClientStore } = await import('../sdk/index.mjs');
    const { report } = resolveNotesClientStore(envWith({
      [NOTES_API_URL_ENV]: 'https://notes.example.test',
      [NOTES_API_KEY_ENV]: 'sdk-key',
    }));
    expect(report.baseUrl).toBe('https://notes.example.test/v1');
    expect(report.apiKeyTier).toBe('env');
    expect(report.apiKeySource).toBe('HASNA_NOTES_API_KEY');
    expect(report.api_key_present).toBe(true);
    expect(report.localFallback).toBe(false);
  });
});