/**
 * @hasna/knowledge — client transport resolution.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * Routing is decided by the shared @hasna/contracts credential chain, so these
 * tests drive that chain rather than a local copy of it: a fake `security`
 * runner for the Keychain tier, a real temp HOME for the credentials file, and
 * plain env objects for the env tiers. Every env passed here is a caller-built
 * object, which the shared resolver deliberately keeps away from the machine's
 * real Keychain.
 */
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KNOWLEDGE_API_KEY_ENV,
  KNOWLEDGE_API_URL_ENV,
  KNOWLEDGE_DEFAULT_API_URL,
  RETIRED_KNOWLEDGE_LOCAL_ENV,
  RetiredKnowledgeStorageSelectorError,
  resetKnowledgeLocalModeNotice,
  resolveKnowledgeClientTransport,
} from '../src/client-transport';

const KEYCHAIN_KEY_SERVICE = 'hasna.credentials.knowledge.api-key';
const KEYCHAIN_URL_SERVICE = 'hasna.credentials.knowledge.api-url';
/** `security` exits 44 (errSecItemNotFound) when no item matches. */
const ITEM_NOT_FOUND = 44;

/** A fake `/usr/bin/security` holding the given items, keyed by service name. */
function fakeKeychain(items: Record<string, string>) {
  const calls: string[][] = [];
  return {
    calls,
    run: (argv: readonly string[]) => {
      calls.push([...argv]);
      const service = argv[argv.indexOf('-s') + 1] ?? '';
      const value = items[service];
      return value === undefined
        ? { status: ITEM_NOT_FOUND, stdout: '', stderr: '' }
        : { status: 0, stdout: `${value}\n`, stderr: '' };
    },
  };
}

/** A credentials file at `<home>/.hasna/knowledge/config/credentials`, 0600. */
function writeCredentialsFile(contents: string): string {
  const home = mkdtempSync(join(tmpdir(), 'ok-knowledge-cred-home-'));
  const dir = join(home, '.hasna', 'knowledge', 'config');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'credentials');
  writeFileSync(path, contents, { mode: 0o600 });
  chmodSync(path, 0o600);
  homes.push(home);
  return home;
}

const homes: string[] = [];

afterEach(() => {
  resetKnowledgeLocalModeNotice();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

describe('Knowledge client transport', () => {
  test('the canonical env key and URL select HTTP', () => {
    expect(resolveKnowledgeClientTransport({
      [KNOWLEDGE_API_URL_ENV]: 'https://knowledge.example.test',
      [KNOWLEDGE_API_KEY_ENV]: 'test-only-key',
    })).toMatchObject({
      transport: 'http',
      source: KNOWLEDGE_API_URL_ENV,
      base_url: 'https://knowledge.example.test/v1',
      api_url_present: true,
      api_url_source: KNOWLEDGE_API_URL_ENV,
      api_key_present: true,
      api_key_source: KNOWLEDGE_API_KEY_ENV,
      api_key_tier: 'env',
    });
  });

  test('a key with no URL reaches the fleet gateway — URLs never need configuring', () => {
    // The 2026-09-04 authority ruling: a credential from any tier is enough,
    // and the default authority is the path-prefixed gateway base to which the
    // client appends /v1.
    expect(resolveKnowledgeClientTransport({
      [KNOWLEDGE_API_KEY_ENV]: 'test-only-key',
    })).toMatchObject({
      transport: 'http',
      source: 'default',
      base_url: `${KNOWLEDGE_DEFAULT_API_URL}/v1`,
      api_url_present: false,
      api_url_source: 'default',
      api_key_tier: 'env',
    });
    expect(KNOWLEDGE_DEFAULT_API_URL).toBe('https://api.hasna.com/knowledge');
  });

  test('the Keychain outranks the credentials file, which outranks the plain env key', () => {
    const home = writeCredentialsFile(`${KNOWLEDGE_API_KEY_ENV}=disk-only-key\n`);
    const keychain = fakeKeychain({ [KEYCHAIN_KEY_SERVICE]: 'keychain-only-key' });
    const env = { HOME: home, HASNA_STATION: 'station-test', [KNOWLEDGE_API_KEY_ENV]: 'env-only-key' };

    expect(resolveKnowledgeClientTransport(env, { keychain: { platform: 'darwin', run: keychain.run } }))
      .toMatchObject({
        transport: 'http',
        api_key_tier: 'keychain',
        api_key_source: `keychain:${KEYCHAIN_KEY_SERVICE}@station-test`,
      });

    // Same env, Keychain tier off: the file wins, and only then the env var.
    expect(resolveKnowledgeClientTransport(env, { keychain: { enabled: false } }))
      .toMatchObject({
        transport: 'http',
        api_key_tier: 'disk',
        api_key_source: join(home, '.hasna', 'knowledge', 'config', 'credentials'),
      });
  });

  test('the Keychain api-url item pins the authority', () => {
    const keychain = fakeKeychain({
      [KEYCHAIN_KEY_SERVICE]: 'keychain-only-key',
      [KEYCHAIN_URL_SERVICE]: 'https://knowledge.station.test',
    });
    expect(resolveKnowledgeClientTransport(
      { HASNA_STATION: 'station-test' },
      { keychain: { platform: 'darwin', run: keychain.run } },
    )).toMatchObject({
      transport: 'http',
      base_url: 'https://knowledge.station.test/v1',
      api_url_source: `keychain:${KEYCHAIN_URL_SERVICE}@station-test`,
      api_key_tier: 'keychain',
    });
  });

  test('the credentials file supplies both the key and the authority', () => {
    const home = writeCredentialsFile(
      `${KNOWLEDGE_API_URL_ENV}=https://knowledge.file.test\n${KNOWLEDGE_API_KEY_ENV}=disk-only-key\n`,
    );
    const path = join(home, '.hasna', 'knowledge', 'config', 'credentials');
    expect(resolveKnowledgeClientTransport({ HOME: home })).toMatchObject({
      transport: 'http',
      base_url: 'https://knowledge.file.test/v1',
      api_url_source: path,
      api_key_tier: 'disk',
      api_key_source: path,
    });
  });

  test('a configured authority with no resolvable credential fails LOUD, never local', () => {
    // The incident class (715712): a hosted process whose credential vanished
    // must exit non-zero, not serve a stale on-box dataset at exit 0.
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => resolveKnowledgeClientTransport({
        [KNOWLEDGE_API_URL_ENV]: 'https://knowledge.example.test',
      })).toThrow(/no API key could be resolved/);
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  test('nothing configured anywhere selects the on-box store and says so once', () => {
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const report = resolveKnowledgeClientTransport({});
      expect(report).toMatchObject({
        transport: 'sqlite',
        source: 'local',
        base_url: null,
        api_url_present: false,
        api_key_present: false,
        api_key_tier: null,
      });
      // Local is legitimate for this package, but never silent — and never
      // repeated, because the resolver is consulted many times per command.
      resolveKnowledgeClientTransport({});
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(String(errSpy.mock.calls[0]?.[0])).toMatch(/using the on-box store \(local mode\)/);
    } finally {
      errSpy.mockRestore();
    }
  });

  test('a Keychain item that exists but cannot be read is never resolved around', () => {
    const run = () => ({ status: 1, stdout: '', stderr: 'User interaction is not allowed.' });
    expect(() => resolveKnowledgeClientTransport(
      { HASNA_STATION: 'station-test' },
      { keychain: { platform: 'darwin', run } },
    )).toThrow(/Keychain lookup for keychain:hasna\.credentials\.knowledge\.api-(key|url)@station-test failed/);
  });

  test('a deliberate override that is blank throws instead of falling through', () => {
    expect(() => resolveKnowledgeClientTransport({
      HASNA_KNOWLEDGE_API_KEY_OVERRIDE: '  ',
      [KNOWLEDGE_API_KEY_ENV]: 'env-only-key',
    })).toThrow(/HASNA_KNOWLEDGE_API_KEY_OVERRIDE is set but empty/);
  });

  test('the unprefixed alias is accepted as the documented silent fallback', () => {
    // `KNOWLEDGE_API_URL` / `KNOWLEDGE_API_KEY` are the fleet-wide alias tier
    // (manifest `aliasEnvPrefix`), accepted below the canonical names.
    expect(resolveKnowledgeClientTransport({
      KNOWLEDGE_API_URL: 'https://alias.example.test',
      KNOWLEDGE_API_KEY: 'alias-only-key',
    })).toMatchObject({
      transport: 'http',
      base_url: 'https://alias.example.test/v1',
      api_url_source: 'KNOWLEDGE_API_URL',
      api_key_source: 'KNOWLEDGE_API_KEY',
    });

    // ... and the canonical name wins when both are set.
    expect(resolveKnowledgeClientTransport({
      [KNOWLEDGE_API_KEY_ENV]: 'canonical-key',
      KNOWLEDGE_API_KEY: 'canonical-key',
      [KNOWLEDGE_API_URL_ENV]: 'https://canonical.example.test',
    })).toMatchObject({ api_key_source: KNOWLEDGE_API_KEY_ENV, api_url_source: KNOWLEDGE_API_URL_ENV });
  });

  test('inherited environment properties cannot configure the client', () => {
    const env = Object.create({
      HASNA_KNOWLEDGE_API_URL: 'https://inherited.example.test',
      HASNA_KNOWLEDGE_API_KEY: 'inherited-key',
    }) as NodeJS.ProcessEnv;
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(resolveKnowledgeClientTransport(env)).toMatchObject({ transport: 'sqlite', source: 'local' });
    } finally {
      errSpy.mockRestore();
    }
  });

  test('the retired local opt-in is accepted, ignored, and reported', () => {
    // It could only ever have selected the on-box store, which is now what
    // happens when nothing resolves — so a stale station fragment lands on the
    // transport it asked for instead of failing. It never downgrades a
    // resolved credential.
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(resolveKnowledgeClientTransport({ [RETIRED_KNOWLEDGE_LOCAL_ENV]: '1' }))
        .toMatchObject({ transport: 'sqlite', legacy_local_opt_in_present: true });
    } finally {
      errSpy.mockRestore();
    }
    expect(resolveKnowledgeClientTransport({
      [RETIRED_KNOWLEDGE_LOCAL_ENV]: '1',
      [KNOWLEDGE_API_KEY_ENV]: 'test-only-key',
    })).toMatchObject({ transport: 'http', legacy_local_opt_in_present: true });
  });

  test('retired selector fails loudly even when blank', () => {
    for (const value of ['', 'selector-value-must-not-be-rendered']) {
      try {
        resolveKnowledgeClientTransport({ HASNA_KNOWLEDGE_STORAGE_MODE: value });
        throw new Error('expected retired selector rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(RetiredKnowledgeStorageSelectorError);
        expect(String(error)).toMatch(/HASNA_KNOWLEDGE_STORAGE_MODE/);
        expect(String(error)).toMatch(/HASNA_KNOWLEDGE_API_URL/);
        expect(String(error)).toMatch(/HASNA_KNOWLEDGE_DATABASE_URL/);
        expect(String(error)).not.toContain(value || 'value-was-blank');
      }
    }
  });

  test('the Keychain tier is off while the outbound network guard is armed', () => {
    // A test process must never adopt the developer's station credential: the
    // guard that refuses non-loopback egress also closes tier 3.
    const keychain = fakeKeychain({ [KEYCHAIN_KEY_SERVICE]: 'keychain-only-key' });
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const report = resolveKnowledgeClientTransport({ NODE_ENV: 'test', HASNA_STATION: 'station-test' });
      expect(report).toMatchObject({ transport: 'sqlite', keychain_tier_enabled: false, network_guard_active: true });
      expect(keychain.calls).toHaveLength(0);
    } finally {
      errSpy.mockRestore();
    }
  });
});
