import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

type ConfigModule = typeof import('./config');

async function loadConfigModule(home: string): Promise<ConfigModule> {
  process.env.HOME = home;
  process.env.HASNA_CONNECTORS_DIR = join(home, '.hasna', 'connectors');
  process.env.ZEROSETTLE_PUBLISHABLE_KEY = '';
  process.env.ZEROSETTLE_API_KEY = '';
  return import(`./config.ts?test=${Date.now()}-${Math.random()}`) as Promise<ConfigModule>;
}

describe('ZeroSettle config', () => {
  let originalHome: string | undefined;
  let originalConnectorsDir: string | undefined;
  let originalPublishableKey: string | undefined;
  let originalApiKey: string | undefined;
  let home: string;

  beforeEach(() => {
    originalHome = process.env.HOME;
    originalConnectorsDir = process.env.HASNA_CONNECTORS_DIR;
    originalPublishableKey = process.env.ZEROSETTLE_PUBLISHABLE_KEY;
    originalApiKey = process.env.ZEROSETTLE_API_KEY;
    home = mkdtempSync(join(tmpdir(), 'zerosettle-config-'));
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalConnectorsDir === undefined) {
      delete process.env.HASNA_CONNECTORS_DIR;
    } else {
      process.env.HASNA_CONNECTORS_DIR = originalConnectorsDir;
    }
    if (originalPublishableKey === undefined) {
      delete process.env.ZEROSETTLE_PUBLISHABLE_KEY;
    } else {
      process.env.ZEROSETTLE_PUBLISHABLE_KEY = originalPublishableKey;
    }
    if (originalApiKey === undefined) {
      delete process.env.ZEROSETTLE_API_KEY;
    } else {
      process.env.ZEROSETTLE_API_KEY = originalApiKey;
    }
    rmSync(home, { recursive: true, force: true });
  });

  test('writes to prefixless config directory', async () => {
    const config = await loadConfigModule(home);

    config.setPublishableKey('zs_pk_test_saved');

    expect(config.getConfigDir()).toBe(join(home, '.hasna', 'connectors', 'zerosettle'));
    expect(existsSync(join(home, '.hasna', 'connectors', 'zerosettle', 'profiles', 'default.json'))).toBe(true);
  });

  test('reads legacy connect-zerosettle profiles', async () => {
    const legacyProfileDir = join(home, '.hasna', 'connectors', 'connect-zerosettle', 'profiles');
    mkdirSync(legacyProfileDir, { recursive: true });
    writeFileSync(join(legacyProfileDir, 'default.json'), JSON.stringify({ publishableKey: 'zs_pk_legacy' }));

    const config = await loadConfigModule(home);

    expect(config.getPublishableKey()).toBe('zs_pk_legacy');
    expect(config.listProfiles()).toEqual(['default']);
  });

  test('deletes legacy-only profiles without throwing', async () => {
    const legacyProfileDir = join(home, '.hasna', 'connectors', 'connect-zerosettle', 'profiles');
    mkdirSync(legacyProfileDir, { recursive: true });
    const legacyProfilePath = join(legacyProfileDir, 'staging.json');
    writeFileSync(legacyProfilePath, JSON.stringify({ publishableKey: 'zs_pk_legacy' }));

    const config = await loadConfigModule(home);

    expect(config.deleteProfile('staging')).toBe(true);
    expect(existsSync(legacyProfilePath)).toBe(false);
  });

  test('reads shared auth apiKey profile and ZEROSETTLE_API_KEY env', async () => {
    const sharedProfileDir = join(home, '.hasna', 'connectors', 'zerosettle', 'profiles', 'default');
    mkdirSync(sharedProfileDir, { recursive: true });
    writeFileSync(join(sharedProfileDir, 'config.json'), JSON.stringify({ apiKey: 'zs_pk_profile_api_key' }));

    const config = await loadConfigModule(home);

    expect(config.getPublishableKey()).toBe('zs_pk_profile_api_key');

    process.env.ZEROSETTLE_API_KEY = 'zs_pk_env_api_key';
    expect(config.getPublishableKey()).toBe('zs_pk_env_api_key');
  });
});
